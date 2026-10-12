const express = require('express');
const multer = require('multer');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const Stripe = require('stripe');
const sharp = require('sharp');
const QRCode = require('qrcode');
const archiver = require('archiver');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const { openDatabase } = require('./db');
const scrypt = promisify(crypto.scrypt);
const PLANS = { '1m': {label:'1 Monat',months:1,priceCents:1900}, '3m':{label:'3 Monate',months:3,priceCents:2900}, '6m':{label:'6 Monate',months:6,priceCents:3900}, '12m':{label:'12 Monate',months:12,priceCents:5900} };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
const fail = (res, status, error) => res.status(status).json({error});
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const active = e => e && ['paid','trial'].includes(e.status) && e.expires_at > Date.now() && !e.deleted_at;
function createApp(options = {}) {
  const cfg = {...process.env, ...options};
  const mailer=options.mailer||require('./mailer').createMailer(cfg);
  if (cfg.STRIPE_SECRET_KEY && !cfg.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error('Phase 1 erlaubt ausschließlich Stripe-Testschlüssel.');
  const base = cfg.BASE_URL || 'http://localhost:3000';
  const baseUrl = new URL(base);
  if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash || baseUrl.username || !['http:','https:'].includes(baseUrl.protocol)) throw new Error('BASE_URL muss eine HTTP(S)-Origin sein.');
  if (cfg.NODE_ENV === 'production' && (baseUrl.protocol !== 'https:' || !cfg.DB_PATH || !cfg.UPLOAD_DIR)) throw new Error('HTTPS, DB_PATH und UPLOAD_DIR sind im Hosting erforderlich.');
  const root = path.resolve(cfg.UPLOAD_DIR || path.join(__dirname,'uploads'));
  fs.mkdirSync(root, {recursive:true});
  const db = openDatabase(cfg.DB_PATH || path.join(__dirname,'events.db'));
  const stripe = options.stripe || (cfg.STRIPE_SECRET_KEY ? new Stripe(cfg.STRIPE_SECRET_KEY) : null);
  const app = express();
  if (cfg.TRUST_PROXY === '1') app.set('trust proxy', 1);
  // Inline scripts in the existing HTML are retained until the design phase.
  app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'", "'unsafe-inline'"], 'img-src':["'self'",'data:','blob:'], 'upgrade-insecure-requests': baseUrl.protocol === 'https:' ? [] : null}}}));
  app.use((req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });
  const lookup = id => db.prepare('SELECT * FROM events WHERE id=?').get(id);
  const own = (req,e) => !!(req.user && e && e.owner_id === req.user.id);
  function fulfill(notification) {
    const session = notification.data.object;
    if (notification.livemode !== false || session.livemode !== false) throw new Error('Live-Webhook gesperrt');
    if (!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(notification.type) || session.payment_status !== 'paid') return;
    db.transaction(()=>{
      if (db.prepare('SELECT 1 FROM webhook_receipts WHERE id=?').get(notification.id)) return;
      const payment = db.prepare('SELECT * FROM payments WHERE stripe_session_id=?').get(session.id);
      if (!payment) throw new Error('Unbekannte Checkout-Session; Webhook erneut zustellen');
      if (session.currency !== 'eur' || session.amount_total !== payment.amount_cents || session.mode !== 'payment' || session.metadata?.paymentId !== payment.id || session.metadata?.eventId !== payment.event_id) throw new Error('Zahlungsdaten stimmen nicht überein');
      const e = lookup(payment.event_id);
      if (payment.status !== 'paid' && ['pending','trial'].includes(e.status) && !e.deleted_at) {
        db.prepare("UPDATE events SET status='paid', expires_at=? WHERE id=?").run(Date.now()+payment.months*30*86400000,e.id);
        db.prepare("UPDATE payments SET status='paid' WHERE id=?").run(payment.id);
      }
      db.prepare('INSERT INTO webhook_receipts VALUES (?,?)').run(notification.id, Date.now());
    })();
  }
  app.post('/api/stripe/webhook', express.raw({type:'application/json',limit:'1mb'}),(req,res)=>{
    if (!stripe || !cfg.STRIPE_WEBHOOK_SECRET) return fail(res,503,'Stripe noch nicht eingerichtet.');
    let event;
    try { event = stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],cfg.STRIPE_WEBHOOK_SECRET); }
    catch { return fail(res,400,'Ungültige Webhook-Signatur.'); }
    try { fulfill(event); res.json({received:true}); }
    catch(err) { console.error('Webhook:',err.message); fail(res,500,'Zahlungsbestätigung konnte nicht verarbeitet werden.'); }
  });
  app.use(express.json({limit:'32kb'}));
  app.use((req,res,next)=>{
    const match = /(?:^|;\s*)event_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    if(match) {
      const session = db.prepare('SELECT s.*, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?').get(hash(match[1]),Date.now());
      if(session) {req.user={id:session.user_id,email:session.email}; req.session=session;}
    }
    next();
  });
  // Guest uploads are unauthenticated but must originate from the application.
  app.use((req,res,next)=>{
    if (!['POST','PATCH','DELETE','PUT'].includes(req.method)) return next();
    if(req.headers.origin !== baseUrl.origin) return fail(res,403,'Ungültige Herkunft der Anfrage.');
    if(req.user && req.headers['x-csrf-token'] !== req.session.csrf) return fail(res,403,'Sicherheits-Token fehlt.');
    next();
  });
  const authLimit=rateLimit({windowMs:15*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
  const uploadLimit=rateLimit({windowMs:60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false});
  function loginRequired(req,res,next) { if(!req.user) return fail(res,401,'Bitte anmelden.'); next(); }
  async function passwordHash(password,salt=random()) {return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;}
  function startSession(req,res,user) {
    const token=random(), csrf=random();
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(token),user.id,csrf,Date.now()+7*86400000);
    res.cookie('event_session',token,{httpOnly:true,secure:baseUrl.protocol==='https:',sameSite:'lax',maxAge:7*86400000,path:'/'});
    res.json({user:{id:user.id,email:user.email},csrf});
  }
  app.post('/api/auth/register',authLimit,wrap(async(req,res)=>{
    const email=String(req.body.email||'').trim().toLowerCase(), password=req.body.password;
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || typeof password!=='string' || password.length<12 || password.length>128) return fail(res,400,'Gültige E-Mail und Passwort mit 12–128 Zeichen erforderlich.');
    const encoded=await passwordHash(password);
    const user={id:crypto.randomUUID(),email};
    try {db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run(user.id,email,encoded,Date.now());}
    catch(err) {if(err.code==='SQLITE_CONSTRAINT_UNIQUE') return fail(res,409,'Registrierung nicht möglich. Bitte anmelden.'); throw err;}
    if(mailer){const token=random();db.prepare('INSERT INTO email_verifications VALUES (?,?,?)').run(hash(token),user.id,Date.now()+86400000);
      try{await mailer({to:email,subject:'Willkommen bei Event-Fotos – bestätige deine E-Mail',text:`Dein Konto ist erstellt.\nBestätige deine E-Mail-Adresse: ${baseUrl.origin}/verify-email#${token}\nDer Link gilt 24 Stunden.\nDein Veranstalterkonto: ${baseUrl.origin}/dashboard\nFalls du kein Konto erstellt hast, ignoriere diese Nachricht.`});}
      catch{db.prepare('DELETE FROM email_verifications WHERE token_hash=?').run(hash(token));console.error('Registrierungs-E-Mail konnte nicht zugestellt werden.');}}
    startSession(req,res,user);
  }));
  app.post('/api/auth/login',authLimit,wrap(async(req,res)=>{
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email||'').trim().toLowerCase());
    const password=req.body.password;
    if(typeof password!=='string' || password.length>128) return fail(res,401,'Anmeldedaten stimmen nicht.');
    const [salt,stored]=(user?.password_hash || `${'0'.repeat(64)}:${'0'.repeat(128)}`).split(':');
    const derived=await scrypt(password,salt,64);
    if(!crypto.timingSafeEqual(Buffer.from(stored,'hex'),derived) || !user) return fail(res,401,'Anmeldedaten stimmen nicht.');
    startSession(req,res,user);
  }));
  app.get('/api/auth/me',loginRequired,(req,res)=>res.json({user:req.user,csrf:req.session.csrf,emailVerified:!!db.prepare('SELECT email_verified_at FROM users WHERE id=?').get(req.user.id).email_verified_at,emailDeliveryAvailable:!!mailer}));
  app.post('/api/auth/forgot-password',authLimit,wrap(async(req,res)=>{
    if(!mailer)return fail(res,503,'Passwort zurücksetzen ist noch nicht verfügbar: Der E-Mail-Versand wird gerade eingerichtet.');
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email||'').trim().toLowerCase());
    if(user){const token=random();db.prepare('INSERT INTO password_resets VALUES (?,?,?)').run(hash(token),user.id,Date.now()+3600000);
      try{await mailer({to:user.email,subject:'Passwort zurücksetzen · Event-Fotos',text:`Neues Passwort festlegen: ${baseUrl.origin}/reset-password#${token}\nDieser Link ist eine Stunde gültig. Falls du ihn nicht angefordert hast, ignoriere diese Nachricht.`});}catch{db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(hash(token));}}
    res.json({success:true,message:'Falls ein Konto existiert, erhältst du einen Link zum Zurücksetzen.'});
  }));
  app.post('/api/auth/reset-password',authLimit,wrap(async(req,res)=>{
    const token=String(req.body.token||''),password=req.body.password;
    if(!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<12||password.length>128)return fail(res,400,'Gültigen Link und Passwort mit 12–128 Zeichen verwenden.');
    const encoded=await passwordHash(password);
    const changed=db.transaction(()=>{const record=db.prepare('SELECT * FROM password_resets WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now());if(!record)return false;
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(encoded,record.user_id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(record.user_id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(record.user_id);return true;})();
    if(!changed)return fail(res,400,'Link ungültig oder abgelaufen. Bitte einen neuen anfordern.');res.clearCookie('event_session',{path:'/'});res.json({success:true});
  }));
  app.post('/api/auth/request-verification',authLimit,loginRequired,wrap(async(req,res)=>{
    if(!mailer)return fail(res,503,'E-Mail-Versand ist noch nicht eingerichtet.');
    const token=random();const expires=Date.now()+86400000;
    db.prepare('INSERT INTO email_verifications VALUES (?,?,?)').run(hash(token),req.user.id,expires);
    try{await mailer({to:req.user.email,subject:'Bestätige deine E-Mail-Adresse · Event-Fotos',text:`Bestätige deine E-Mail-Adresse: ${baseUrl.origin}/verify-email#${token}\nDieser Link ist 24 Stunden gültig. Falls du ihn nicht angefordert hast, ignoriere diese Nachricht.`});}
    catch(error){db.prepare('DELETE FROM email_verifications WHERE token_hash=?').run(hash(token));console.error('Bestätigungsmail: Versandstatus',Number(error.deliveryStatus)||'Netzwerkfehler');return fail(res,503,error.deliveryHint||'E-Mail-Versand nicht erreichbar. Bitte später erneut versuchen.');}
    res.json({success:true});
  }));
  app.post('/api/auth/verify-email',authLimit,(req,res)=>{
    const token=String(req.body.token||'');if(!/^[a-f0-9]{64}$/.test(token))return fail(res,400,'Bestätigungslink ungültig oder abgelaufen.');
    const verification=db.prepare('SELECT * FROM email_verifications WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now());
    if(!verification)return fail(res,400,'Bestätigungslink ungültig oder abgelaufen.');
    db.transaction(()=>{db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(Date.now(),verification.user_id);db.prepare('DELETE FROM email_verifications WHERE user_id=?').run(verification.user_id);})();res.json({success:true});
  });
  app.post('/api/auth/logout',loginRequired,(req,res)=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(req.session.token_hash);res.clearCookie('event_session',{path:'/'});res.json({success:true});});
  app.get('/api/storage',loginRequired,(req,res)=>{const disk=fs.statfsSync(root);const freeBytes=Number(disk.bavail)*Number(disk.bsize);res.json({warning:freeBytes<200*1024**2,uploadsPaused:freeBytes<100*1024**2});});
  app.get('/api/plans',(req,res)=>res.json(Object.fromEntries(Object.entries(PLANS).map(([key,plan])=>[key,{...plan,photoLimit:Number(cfg.MAX_EVENT_PHOTOS||2000),storageLimitMB:Math.floor(Number(cfg.MAX_EVENT_BYTES||2*1024**3)/1024**2)}]))));
  app.get('/api/events',loginRequired,(req,res)=>{
    const events=db.prepare(`SELECT e.*, COUNT(p.id) photoCount, COALESCE(SUM(p.bytes),0) storageBytes
      FROM events e LEFT JOIN photos p ON p.event_id=e.id
      WHERE e.owner_id=? AND e.deleted_at IS NULL GROUP BY e.id ORDER BY e.created_at DESC`).all(req.user.id);
    res.json({events:events.map(e=>({...e,storageLimitBytes:e.status==='trial'?Math.min(250*1024**2,Number(cfg.MAX_EVENT_BYTES||2*1024**3)):Number(cfg.MAX_EVENT_BYTES||2*1024**3),photoLimit:e.status==='trial'?25:Number(cfg.MAX_EVENT_PHOTOS||2000),guestUrl:active(e)?`${baseUrl.origin}/event/${e.id}?token=${e.guest_token}`:null}))});
  });
  app.post('/api/events',loginRequired,(req,res)=>{
    const id=String(req.body.eventId||''); const plan=PLANS[req.body.plan]; const title=String(req.body.title||'').trim();
    if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(id) || !plan || !title || title.length>120) return fail(res,400,'Event-ID (3–64 Zeichen, klein), Titel und Laufzeit prüfen.');
    if(lookup(id) || fs.existsSync(path.join(root,id))) return fail(res,409,'Event-ID bereits vergeben, auch für Bestandsdaten.');
    const trial=req.body.trial!==false&&!db.prepare('SELECT 1 FROM events WHERE owner_id=? AND trial_used=1').get(req.user.id);
    db.prepare('INSERT INTO events (id,email,plan,amount_cents,status,created_at,owner_id,title,guest_token,moderation) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,req.user.email,req.body.plan,plan.priceCents,'pending',Date.now(),req.user.id,title,random(),req.body.moderation===true?1:0);
    if(trial)db.prepare("UPDATE events SET status='trial', trial_used=1, expires_at=? WHERE id=?").run(Date.now()+14*86400000,id);
    res.status(201).json({eventId:id,trial:!!trial});
  });
  app.get('/api/event/:eventId/availability',(req,res)=>res.json({available:/^[a-z0-9][a-z0-9_-]{2,63}$/.test(req.params.eventId)&&!lookup(req.params.eventId)&&!fs.existsSync(path.join(root,req.params.eventId))}));
  function owner(req,res,next) { const e=lookup(req.params.eventId); if(!own(req,e)) return fail(res,404,'Event nicht gefunden.'); req.event=e; next(); }
  app.post('/api/checkout',loginRequired,wrap(async(req,res)=>{
    const e=lookup(String(req.body.eventId||''));
    if(!own(req,e)) return fail(res,404,'Event nicht gefunden.');
    if(!['pending','trial'].includes(e.status) || e.deleted_at) return fail(res,409,'Dieses Event kann nicht bezahlt werden.');
    if(!stripe || !cfg.STRIPE_WEBHOOK_SECRET) return fail(res,503,'Stripe-Testmodus noch nicht eingerichtet.');
    // One stable payment/idempotency key per event prevents parallel checkout overwrites.
    let payment=db.prepare('SELECT * FROM payments WHERE event_id=?').get(e.id);
    if(!payment) {
      const plan=PLANS[e.plan];
      db.prepare('INSERT INTO payments (id,event_id,amount_cents,months) VALUES (?,?,?,?)').run(crypto.randomUUID(),e.id,e.amount_cents,plan.months);
      payment=db.prepare('SELECT * FROM payments WHERE event_id=?').get(e.id);
    }
    let session;
    if(payment.stripe_session_id) session=await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
    else {
      session=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],customer_email:e.email,line_items:[{price_data:{currency:'eur',unit_amount:payment.amount_cents,product_data:{name:`Event-Fotos: ${PLANS[e.plan].label}`}},quantity:1}],metadata:{eventId:e.id,paymentId:payment.id},success_url:`${baseUrl.origin}/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${baseUrl.origin}/dashboard`},{idempotencyKey:`payment-${payment.id}`});
      if(session.livemode!==false) throw new Error('Live-Checkout gesperrt');
      db.prepare('UPDATE payments SET stripe_session_id=? WHERE id=?').run(session.id,payment.id);
      db.prepare('UPDATE events SET stripe_session_id=? WHERE id=?').run(session.id,e.id);
    }
    if(session.livemode!==false) throw new Error('Live-Checkout gesperrt');
    if(session.status==='expired') return fail(res,409,'Checkout abgelaufen. Neues Event erstellen; diese Event-ID bleibt reserviert.');
    res.json({url:session.url || `${baseUrl.origin}/success?session_id=${session.id}`});
  }));
  app.get('/api/checkout/:sessionId',loginRequired,(req,res)=>{
    const e=db.prepare('SELECT * FROM events WHERE stripe_session_id=?').get(req.params.sessionId);
    if(!own(req,e)) return fail(res,404,'Bestellung nicht gefunden.');
    res.json({eventId:e.id,status:e.status,expiresAt:e.expires_at});
  });
  function access(req,res,next) {
    const e=lookup(req.params.eventId);
    if(!active(e)) return fail(res,402,'Event nicht aktiv.');
    if(!own(req,e)) {
      const token=req.query.token || req.headers['x-event-token'];
      if(typeof token!=='string' || !e.guest_token || Buffer.byteLength(token)!==Buffer.byteLength(e.guest_token) || !crypto.timingSafeEqual(Buffer.from(token),Buffer.from(e.guest_token))) return fail(res,403,'Gültiger Veranstaltungslink erforderlich.');
    }
    req.event=e; next();
  }
  app.patch('/api/event/:eventId',loginRequired,owner,(req,res)=>{
    if(typeof req.body.moderation!=='boolean') return fail(res,400,'Moderation muss true oder false sein.');
    db.prepare('UPDATE events SET moderation=? WHERE id=?').run(req.body.moderation?1:0,req.event.id);res.json({success:true});
  });
  app.post('/api/event/:eventId/rotate-token',loginRequired,owner,(req,res)=>{db.prepare('UPDATE events SET guest_token=? WHERE id=?').run(random(),req.event.id);res.json({success:true});});
  app.get('/api/event/:eventId/qr',loginRequired,owner,wrap(async(req,res)=>{
    if(!active(req.event)) return fail(res,402,'QR-Code erst nach Zahlung verfügbar.');
    const url=`${baseUrl.origin}/event/${req.event.id}?token=${req.event.guest_token}`;
    res.type('png').attachment(`${req.event.id}-qr.png`).send(await QRCode.toBuffer(url,{width:1200,margin:4,errorCorrectionLevel:'M'}));
  }));
  // Disk staging bounds RAM usage. Re-encoding validates content and strips EXIF/GPS.
  const temp=path.join(root,'.tmp');fs.mkdirSync(temp,{recursive:true});
  const upload=multer({dest:temp,limits:{fileSize:20*1024*1024,files:10,fields:0,parts:10}}).array('photos',10);
  const busy=new Set();
  app.post('/api/event/:eventId/upload',uploadLimit,access,(req,res,next)=>{
    if(busy.has(req.event.id)) return fail(res,429,'Upload läuft bereits. Bitte kurz warten.');
    busy.add(req.event.id);
    upload(req,res,async err=>{
      const written=[];
      try {
        if(err) throw err;
        const disk=fs.statfsSync(root);if(Number(disk.bavail)*Number(disk.bsize)<100*1024**2)throw new Error('Fotospeicher vorübergehend ausgelastet. Bitte den Veranstalter informieren.');
        if(!req.files?.length) return fail(res,400,'Keine Fotos empfangen.');
        const dir=path.join(root,req.event.id);fs.mkdirSync(dir,{recursive:true});
        const total=db.prepare('SELECT COUNT(*) count, COALESCE(SUM(bytes),0) bytes FROM photos WHERE event_id=?').get(req.event.id);
        if(total.count+req.files.length>(req.event.status==='trial'?25:Number(cfg.MAX_EVENT_PHOTOS||2000))) throw new Error(req.event.status==='trial'?'Die 25 kostenlosen Fotos sind genutzt. Das Album kann mit einem Paket erweitert werden. Vorhandene Fotos bleiben sichtbar.':'Fotoanzahl für dieses Event überschritten.');
        let bytes=total.bytes;
        for(const file of req.files) {
          const image=sharp(file.path,{limitInputPixels:40000000,animated:false});
          const meta=await image.metadata();
          if(!['jpeg','png','webp','heif'].includes(meta.format)) throw new Error('Nur JPEG, PNG, WebP und unterstützte HEIF-Bilder erlaubt.');
          const id=crypto.randomUUID(), filename=`${id}.jpg`, dest=path.join(dir,filename);
          written.push({id,filename,dest});
          await image.rotate().resize({width:2560,height:2560,fit:'inside',withoutEnlargement:true}).jpeg({quality:82,mozjpeg:true}).toFile(dest);
          const size=fs.statSync(dest).size;bytes+=size;written[written.length-1].bytes=size;
          if(bytes>(req.event.status==='trial'?Math.min(250*1024**2,Number(cfg.MAX_EVENT_BYTES||2*1024**3)):Number(cfg.MAX_EVENT_BYTES||2*1024**3))) throw new Error('Speicherlimit für dieses Event überschritten.');
        }
        // Recheck expiry after processing and before publication.
        if(!active(lookup(req.event.id))) throw new Error('Event inzwischen abgelaufen.');
        db.transaction(()=>{for(const f of written) db.prepare('INSERT INTO photos VALUES (?,?,?,?,?,?)').run(f.id,req.event.id,f.filename,f.bytes,req.event.moderation?0:1,Date.now());})();
        db.prepare('UPDATE events SET upload_successes=upload_successes+1 WHERE id=?').run(req.event.id);
        res.json({success:true,count:written.length,pending:!!req.event.moderation});
      } catch(error) {db.prepare('UPDATE events SET upload_failures=upload_failures+1 WHERE id=?').run(req.event.id);for(const f of written) fs.rmSync(f.dest,{force:true}); fail(res,400,error.message);}
      finally {for(const f of req.files||[]) fs.rmSync(f.path,{force:true});busy.delete(req.event.id);}
    });
  });
  function photoUrl(req,p) {return `/uploads/${req.event.id}/${p.filename}${own(req,req.event)?'':`?token=${req.event.guest_token}`}`;}
  app.get('/api/event/:eventId/info',access,(req,res)=>res.json({title:req.event.title,expiresAt:req.event.expires_at,moderation:!!req.event.moderation,trial:req.event.status==='trial',photoCount:db.prepare('SELECT COUNT(*) count FROM photos WHERE event_id=?').get(req.event.id).count,photoLimit:req.event.status==='trial'?25:Number(cfg.MAX_EVENT_PHOTOS||2000),canManage:own(req,req.event)}));
  app.get('/api/event/:eventId/photos',access,(req,res)=>{
    const admin=own(req,req.event)&&req.query.manage==='1';
    const photos=db.prepare(`SELECT * FROM photos WHERE event_id=? ${admin?'':'AND approved=1'} ORDER BY created_at,id`).all(req.event.id);
    res.json({photos:photos.map(p=>({id:p.id,url:photoUrl(req,p),timestamp:p.created_at,approved:!!p.approved})),serverTime:Date.now()});
  });
  app.get('/uploads/:eventId/:filename',access,(req,res)=>{
    const p=db.prepare('SELECT * FROM photos WHERE event_id=? AND filename=?').get(req.event.id,req.params.filename);
    if(!p || (!p.approved && !own(req,req.event))) return fail(res,404,'Foto nicht gefunden.');
    res.sendFile(path.join(root,req.event.id,p.filename));
  });
  app.patch('/api/event/:eventId/photos/:photoId',loginRequired,owner,(req,res)=>{
    if(typeof req.body.approved!=='boolean') return fail(res,400,'Freigabe muss true oder false sein.');
    const result=db.prepare('UPDATE photos SET approved=? WHERE id=? AND event_id=?').run(req.body.approved?1:0,req.params.photoId,req.event.id);
    if(!result.changes) return fail(res,404,'Foto nicht gefunden.');res.json({success:true});
  });
  app.delete('/api/event/:eventId/photos/:photoId',loginRequired,owner,(req,res)=>{
    const p=db.prepare('SELECT * FROM photos WHERE id=? AND event_id=?').get(req.params.photoId,req.event.id);
    if(!p) return fail(res,404,'Foto nicht gefunden.');
    fs.rmSync(path.join(root,req.event.id,p.filename),{force:true});db.prepare('DELETE FROM photos WHERE id=?').run(p.id);res.json({success:true});
  });
  app.get('/api/event/:eventId/download',access,(req,res)=>{
    const photos=db.prepare(`SELECT * FROM photos WHERE event_id=? ${own(req,req.event)?'':'AND approved=1'}`).all(req.event.id);
    if(!photos.length) return fail(res,404,'Keine Fotos vorhanden.');
    res.attachment(`event-${req.event.id}-fotos.zip`);
    const archive=archiver('zip',{zlib:{level:1}});
    archive.on('error',()=>res.destroy());res.on('close',()=>archive.abort());archive.pipe(res);
    for(const p of photos) archive.file(path.join(root,req.event.id,p.filename),{name:p.filename});archive.finalize();
  });
  function erase(e) {
    if(busy.has(e.id)) return false;
    // Legacy unowned events are never removed automatically: review/import first.
    fs.rmSync(path.join(root,e.id),{recursive:true,force:true});
    db.transaction(()=>{db.prepare('DELETE FROM photos WHERE event_id=?').run(e.id);db.prepare("UPDATE events SET status='expired', deleted_at=?, guest_token=NULL WHERE id=?").run(Date.now(),e.id);})();
    return true;
  }
  app.delete('/api/event/:eventId',loginRequired,owner,(req,res)=>{if(!erase(req.event)) return fail(res,409,'Upload läuft. Bitte erneut versuchen.');res.json({success:true});});
  function cleanup() {
    for(const e of db.prepare("SELECT * FROM events WHERE owner_id IS NOT NULL AND deleted_at IS NULL AND status IN ('paid','trial') AND expires_at<=?").all(Date.now())) erase(e);
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    db.prepare('DELETE FROM email_verifications WHERE expires_at<=?').run(Date.now());
    db.prepare('DELETE FROM password_resets WHERE expires_at<=?').run(Date.now());
    for(const entry of fs.readdirSync(temp)) {const file=path.join(temp,entry);if(fs.statSync(file).mtimeMs<Date.now()-86400000) fs.rmSync(file,{force:true});}
  }
  const pub=path.join(__dirname,'public');
  app.get('/',(req,res)=>res.sendFile(path.join(pub,'landing.html')));
  app.get(['/forgot-password','/reset-password'],(req,res)=>res.sendFile(path.join(pub,'password-recovery.html')));
  app.get('/verify-email',(req,res)=>res.sendFile(path.join(pub,'verify-email.html')));
  app.get('/impressum',(req,res)=>res.sendFile(path.join(pub,'impressum.html')));
  app.get('/register',(req,res)=>req.user?res.redirect('/dashboard'):res.sendFile(path.join(pub,'login.html')));
  app.get('/login',(req,res)=>res.sendFile(path.join(pub,'login.html')));
  app.get('/dashboard',(req,res)=>req.user?res.sendFile(path.join(pub,'dashboard.html')):res.redirect('/login'));
  app.get('/success',(req,res)=>req.user?res.sendFile(path.join(pub,'success.html')):res.redirect('/login'));
  app.get('/event/:eventId/admin',loginRequired,owner,(req,res)=>res.redirect('/dashboard'));
  for(const [suffix,file] of [['','gallery.html'],['/upload','upload.html'],['/gallery','gallery.html'],['/slideshow','slideshow.html']]) app.get(`/event/:eventId${suffix}`,access,(req,res)=>res.sendFile(path.join(pub,file)));
  // Only intended public assets; source code and generic HTML routes cannot bypass guards.
  for(const file of ['style.css','upload.js','slideshow.js','guest-access.js','account.js','verify-email.js','password-recovery.js','johanna-bastian.png','photographer.webp']) app.get(`/${file}`,(req,res)=>res.sendFile(path.join(pub,file)));
  app.get('/health',(req,res)=>res.json({ok:true}));
  app.use((req,res)=>fail(res,404,'Nicht gefunden.'));
  app.use((err,req,res,next)=>{console.error(err.message);if(!res.headersSent) fail(res,500,'Interner Fehler.');});
  app.locals.db=db;app.locals.cleanup=cleanup;app.locals.fulfill=fulfill;
  return app;
}
if(require.main===module) {
  const app=createApp();
  app.locals.cleanup();
  setInterval(()=>{try{app.locals.cleanup();}catch(err){console.error('Löschung fehlgeschlagen:',err.message);}},3600000).unref();
  app.listen(process.env.PORT||3000,()=>console.log('Event-Foto-Plattform gestartet (Stripe-Testmodus).'));
}
module.exports={createApp};
