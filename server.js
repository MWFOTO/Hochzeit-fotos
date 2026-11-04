Warning: truncated output (original token count: 13344)
Total output lines: 644

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
const { createPhotoStorage } = require('./photo-storage');
const scrypt = promisify(crypto.scrypt);
const PLANS = { event:{label:'FinalSnap Fotoalbum',months:3,retentionDays:90,priceCents:4990}, '1m':{label:'1 Monat (alt)',months:1,priceCents:1900,legacy:true}, '3m':{label:'3 Monate (alt)',months:3,priceCents:2900,legacy:true}, '6m':{label:'6 Monate (alt)',months:6,priceCents:3900,legacy:true}, '12m':{label:'12 Monate (alt)',months:12,priceCents:5900,legacy:true} };
const RETENTION_MS = 90*86400000;
// Event deadlines use calendar days in Europe/Berlin, including DST changes.
function eventDeadline(date) {
  const day=new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate()+90);
  return berlinMidnight(day.toISOString().slice(0,10));
}
function retentionUntil(e) {
  if(!e?.expires_at)return null;
  // Undated legacy albums keep their existing expiry/download policy.
  return e.event_date ? Math.min(e.expires_at,eventDeadline(e.event_date)) : e.expires_at+RETENTION_MS;
}
const TEST_PHOTO_LIMIT = 25;
const TEST_STORAGE_BYTES = 250*1024**2;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
const fail = (res, status, error) => res.status(status).json({error});
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const berlinParts = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function berlinMidnight(date) {
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date||''));
  if(!match)return NaN;
  const [,year,month,day]=match.map(Number);
  const target=Date.UTC(year,month-1,day);
  let instant=target;
  for(let i=0;i<3;i++) {
    const parts=Object.fromEntries(berlinParts.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
    const local=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
    instant+=target-local;
  }
  return instant;
}
function addMonthsToDate(date,months) {
  const [year,month,day]=date.split('-').map(Number), first=new Date(Date.UTC(year,month-1,1));
  first.setUTCMonth(first.getUTCMonth()+months);
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  first.setUTCDate(Math.min(day,last));
  return first.toISOString().slice(0,10);
}
function validEventDate(value,now=Date.now()) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) || !Number.isFinite(berlinMidnight(value)))return false;
  const [year,month,day]=value.split('-').map(Number);
  if(new Date(Date.UTC(year,month-1,day)).toISOString().slice(0,10)!==value)return false;
  const parts=Object.fromEntries(berlinParts.formatToParts(new Date(now)).map(part=>[part.type,part.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`;
  return value>=today && value<=addMonthsToDate(today,24);
}
const startAt = e => e?.event_date ? berlinMidnight(e.event_date) : Number(e?.created_at||0);
const testMode = e => !!e && (e.status==='trial' || (e.status==='paid' && startAt(e)>Date.now()));
const eventStorageLimit = (e,cfg) => testMode(e)?Math.min(TEST_STORAGE_BYTES,Number(cfg.MAX_EVENT_BYTES||25*1024**3)):Number(cfg.MAX_EVENT_BYTES||25*1024**3);
const eventPhotoLimit = (e,cfg={}) => testMode(e)?TEST_PHOTO_LIMIT:e?.status==='pilot'?Number(cfg.MAX_EVENT_PHOTOS||2000):null;
const active = e => e && ['paid','trial','pilot'].includes(e.status) && Math.min(e.expires_at,retentionUntil(e)) > Date.now() && !e.deleted_at;
const readable = e => e && ['paid','trial','pilot'].includes(e.status) && retentionUntil(e) > Date.now() && !e.deleted_at;
function createApp(options = {}) {
  const cfg = {...process.env, ...options};
  const mailer=options.mailer||require('./mailer').createMailer(cfg);
  if (cfg.STRIPE_SECRET_KEY && !cfg.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error('Phase 1 erlaubt ausschließlich Stripe-Testschlüssel.');
  const configuredBase = String(cfg.BASE_URL || cfg.RENDER_EXTERNAL_URL || '').trim();
  const platformDomain = String(cfg.SLIPLANE_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const unresolvedBase = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(configuredBase);
  const base = configuredBase && !unresolvedBase
    ? configuredBase
    : platformDomain ? `https://${platformDomain}` : 'http://localhost:3000';
  const baseUrl = new URL(base);
  if (baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash || baseUrl.username || !['http:','https:'].includes(baseUrl.protocol)) throw new Error('BASE_URL muss eine HTTP(S)-Origin sein.');
  if (cfg.NODE_ENV === 'production' && (baseUrl.protocol !== 'https:' || !cfg.DB_PATH || !cfg.UPLOAD_DIR)) throw new Error('HTTPS, DB_PATH und UPLOAD_DIR sind im Hosting erforderlich.');
  const root = path.resolve(cfg.UPLOAD_DIR || path.join(__dirname,'uploads'));
  fs.mkdirSync(root, {recursive:true});
  const photoStorage = options.photoStorage || createPhotoStorage(cfg);
  const storageLimit = Number(cfg.S3_MAX_STORAGE_BYTES || 900 * 1024 ** 3);
  if (!Number.isSafeInteger(storageLimit) || storageLimit <= 100 * 1024 ** 2) throw new Error('S3_MAX_STORAGE_BYTES muss größer als 100 MiB sein.');
  const db = openDatabase(cfg.DB_PATH || path.join(__dirname,'events.db'));
  // Unpaid draft events from the earlier one-trial-per-account flow can now
  // use the same free 25-photo test as newly created events.
  db.prepare("UPDATE events SET status='trial', trial_used=1 WHERE status='pending' AND owner_id IS NOT NULL AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM payments WHERE payments.event_id=events.id)").run();
  // Operator-only pilot provisioning. No guest endpoint can enable a pilot.
  // The original capability and owner remain unchanged; deleted albums stay deleted.
  if (cfg.PILOT_EVENT_ID) {
    const expires = Date.parse(cfg.PILOT_ENDS_AT || '');
    if (!Number.isFinite(expires) || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(cfg.PILOT_EVENT_ID)) throw new Error('Pilot-Konfiguration ungültig.');
    const title = String(cfg.PILOT_TITLE || '').trim();
    if (title.length > 120) throw new Error('Pilot-Titel zu lang.');
    db.prepare("UPDATE events SET status='pilot', expires_at=?, title=CASE WHEN ?='' THEN title ELSE ? END WHERE id=? AND owner_id IS NOT NULL AND deleted_at IS NULL AND status IN ('pending','trial','pilot')").run(expires,title,title,cfg.PILOT_EVENT_ID);
  }
  const stripe = options.stripe || (cfg.STRIPE_SECRET_KEY ? new Stripe(cfg.STRIPE_SECRET_KEY) : null);
  const app = express();
  if (cfg.TRUST_PROXY === '1') app.set('trust proxy', 1);
  // Inline scripts in the existing HTML are retained until the design phase.
  app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'", "'unsafe-inline'"], 'img-src':["'self'",'data:','blob:'], 'upgrade-insecure-requests': baseUrl.protocol === 'https:' ? [] : null}}}));
  app.use((req,res,next)=>{ res.set('Cache-Control','no-store'); next(); });
  const lookup = id => db.prepare('SELECT * FROM events WHERE id=?').get(id);
  const own = (req,e) => !!(req.user && e && e.owner_id === req.user.id);
  const deletingUsers = new Set();
  const readDesign = e => {
    try { return JSON.parse(e?.design_json || '{}'); }
    catch { return {}; }
  };
  const publicDesign = e => {
    const design=readDesign(e);
    return {
      title:typeof design.title==='string'?design.title:e?.title||'Veranstaltung',
      occasion:['wedding','birthday','summer','company','jubilee','graduation','other'].includes(design.occasion)?design.occasion:'other',
      theme:['afterglow','midnight','garden'].includes(design.theme)?design.theme:'afterglow',
      accent:/^#[0-9a-f]{6}$/i.test(design.accent||'')?design.accent:'#e99a69',
      font:['classic','palatino','modern','verdana','relaxed','typewriter'].includes(design.font)?design.font:'classic',
      hasCover:typeof design.coverFilename==='string'&&/^[a-z0-9-]+\.jpg$/.test(design.coverFilename)
    };
  };
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
        const eventEnd=e.event_date?eventDeadline(e.event_date):e.expires_at||Date.now()+payment.months*30*86400000;
        db.prepare("UPDATE events SET status='paid', expires_at=? WHERE id=?").run(eventEnd,e.id);
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
  const guestbookLimit=rateLimit({windowMs:15*60*1000,limit:5,standardHeaders:'draft-8',legacyHeaders:false});
  function loginRequired(req,res,next) { if(!req.user) return fail(res,401,'Bitte anmelden.'); if(deletingUsers.has(req.user.id)) return fail(res,409,'Kontolöschung läuft. Bitte kurz warten.'); next(); }
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
      try{await mailer({to:email,subject:'Willkommen bei FinalSnap – bestätige deine E-Mail',text:`Dein Konto ist erstellt.\nBestätige deine E-Mail-Adresse: ${baseUrl.origin}/verify-email#${token}\nDer Link gilt 24 Stunden.\nDein Veranstalterkonto: ${baseUrl.origin}/dashboard\nFalls du kein Konto erstellt hast, ignoriere diese Nachricht.`});}
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
      try{await mailer({to:user.email,subject:'Passwort zurücksetzen · FinalSnap',text:`Neues Passwort festlegen: ${baseUrl.origin}/reset-password#${token}\nDieser Link ist eine Stunde gültig. Falls du ihn nicht angefordert hast, ignoriere diese Nachricht.`});}catch{db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(hash(token));}}
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
    try{await mailer({to:req.user.email,subject:'Bestätige deine E-Mail-Adresse · FinalSnap',text:`Bestätige deine E-Mail-Adresse: ${baseUrl.origin}/verify-email#${token}\nDieser Link ist 24 Stunden gültig. Falls du ihn nicht angefordert hast, ignoriere diese Nachricht.`});}
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
  app.get('/api/storage',loginRequired,(req,res)=>{
    if (photoStorage.mode === 's3') {
      const usedBytes = Number(db.prepare('SELECT COALESCE(SUM(bytes),0) bytes FROM photos').get().bytes);
      const freeBytes = Math.max(0, storageLimit - usedBytes);
      return res.json({freeBytes,totalBytes:storageLimit,warning:freeBytes<200*1024**2,uploadsPaused:freeBytes<100*1024**2,location:'object-storage'});
    }
    const disk=fs.statfsSync(root);const freeBytes=Number(disk.bavail)*Number(disk.bsize);res.json({freeBytes,totalBytes:Number(disk.blocks)*Number(disk.bsize),warning:freeBytes<200*1024**2,uploadsPaused:freeBytes<100*1024**2,location:'server-disk'});
  });
  app.get('/api/plans',(req,res)=>res.json(Object.fromEntries(Object.entries(PLANS).map(([key,plan])=>[key,{...plan,photoLimit:key==='event'?null:Number(cfg.MAX_EVENT_PHOTOS||2000),storageLimitMB:Math.floor(Number(cfg.MAX_EVENT_BYTES||25*1024**3)/1024**2),storageLimitGB:Number((Number(cfg.MAX_EVENT_BYTES||25*1024**3)/1024**3).toFixed(1))}]))));
  app.get('/api/events',loginRequired,(req,res)=>{
    const events=db.prepare(`SELECT e.*, COUNT(p.id) photoCount, COALESCE(SUM(p.bytes),0) storageBytes
      FROM events e LEFT JOIN photos p ON p.event_id=e.id
      WHERE e.owner_id=? AND e.deleted_…3344 tokens truncated…t ab dem Veranstaltungsdatum.');
        let bytes=total.bytes;
        for(const file of req.files) {
          const image=sharp(file.path,{limitInputPixels:40000000,animated:false});
          const meta=await image.metadata();
          if(!['jpeg','png','webp','heif'].includes(meta.format)) throw new Error('Nur JPEG, PNG, WebP und unterstützte HEIF-Bilder erlaubt.');
          const id=crypto.randomUUID(), filename=`${id}.jpg`, dest=path.join(dir,filename);
          written.push({id,filename,dest});
          await image.rotate().resize({width:2560,height:2560,fit:'inside',withoutEnlargement:true}).jpeg({quality:82,mozjpeg:true}).toFile(dest);
          const size=fs.statSync(dest).size;bytes+=size;written[written.length-1].bytes=size;
          if(bytes>storageLimit) throw new Error('Der Fotospeicher dieses Albums ist ausgeschöpft. Bitte den Veranstalter informieren.');
        }
        if(photoStorage.mode==='s3') {
          const usedBytes=Number(db.prepare('SELECT COALESCE(SUM(bytes),0) bytes FROM photos').get().bytes);
          const incomingBytes=written.reduce((sum,file)=>sum+file.bytes,0);
          if(usedBytes+remoteStorageReservedBytes+incomingBytes>storageLimit) throw new Error('Der gemeinsame Fotospeicher ist ausgeschöpft. Bitte den Veranstalter informieren.');
          remoteStorageReservedBytes+=incomingBytes;
          try {for(const file of written) await photoStorage.put(req.event.id,file.filename,file.dest);}
          finally {remoteStorageReservedBytes-=incomingBytes;}
        }
        // Recheck expiry after processing and before publication.
        if(!active(lookup(req.event.id))) throw new Error('Event inzwischen abgelaufen.');
        db.transaction(()=>{for(const f of written) db.prepare('INSERT INTO photos (id,event_id,filename,bytes,approved,created_at,uploader_token_hash) VALUES (?,?,?,?,?,?,?)').run(f.id,req.event.id,f.filename,f.bytes,req.event.moderation?0:1,Date.now(),req.guestTokenHash||null);})();
        db.prepare('UPDATE events SET upload_successes=upload_successes+1 WHERE id=?').run(req.event.id);
        res.json({success:true,count:written.length,pending:!!req.event.moderation});
      } catch(error) {db.prepare('UPDATE events SET upload_failures=upload_failures+1 WHERE id=?').run(req.event.id);for(const f of written){try{if(photoStorage.mode==='s3')await photoStorage.deletePhoto(req.event.id,f.filename);else fs.rmSync(f.dest,{force:true});}catch(cleanupError){console.error('Upload-Aufräumen fehlgeschlagen:',cleanupError.message);}}if(error.code==='PHOTO_STORAGE_UNAVAILABLE')console.error('Hetzner Object Storage:',error.cause?.message||error.message);fail(res,error.code==='PHOTO_STORAGE_UNAVAILABLE'?503:400,error.message);}
      finally {for(const f of req.files||[]) fs.rmSync(f.path,{force:true});if(photoStorage.mode==='s3')for(const f of written)fs.rmSync(f.dest,{force:true});busy.delete(req.event.id);}
    });
  });
  function photoUrl(req,p) {return `/uploads/${req.event.id}/${p.filename}${own(req,req.event)?'':`?token=${req.event.guest_token}`}`;}
  app.get('/api/event/:eventId/info',access,(req,res)=>{
    const canManage=own(req,req.event);
    const photoCount=canManage
      ? db.prepare('SELECT COUNT(*) count FROM photos WHERE event_id=?').get(req.event.id).count
      : db.prepare('SELECT COUNT(*) count FROM photos WHERE event_id=? AND uploader_token_hash=?').get(req.event.id,req.guestTokenHash).count;
    res.json({title:req.event.title,eventDate:req.event.event_date,startsAt:startAt(req.event),expiresAt:req.event.event_date?retentionUntil(req.event):req.event.expires_at,retentionUntil:retentionUntil(req.event),readOnly:!active(req.event),moderation:!!req.event.moderation,guestbookModeration:!!req.event.guestbook_moderation,trial:req.event.status==='trial',preEventTest:req.event.status==='paid'&&startAt(req.event)>Date.now(),testMode:testMode(req.event),photoCount,photoLimit:eventPhotoLimit(req.event,cfg),storageBytes:Number(db.prepare('SELECT COALESCE(SUM(bytes),0) bytes FROM photos WHERE event_id=?').get(req.event.id).bytes),storageLimitBytes:eventStorageLimit(req.event,cfg),pilot:req.event.status==='pilot',canManage,design:publicDesign(req.event)});
  });
  app.get('/api/event/:eventId/guestbook',access,(req,res)=>{
    const entries=own(req,req.event)
      ? db.prepare('SELECT id,guest_name name,message,approved,created_at createdAt FROM guestbook_entries WHERE event_id=? ORDER BY created_at DESC LIMIT 200').all(req.event.id)
      : db.prepare('SELECT id,guest_name name,message,approved,created_at createdAt FROM guestbook_entries WHERE event_id=? AND approved=1 ORDER BY created_at DESC LIMIT 200').all(req.event.id);
    res.json({entries,canManage:own(req,req.event),moderation:!!req.event.guestbook_moderation});
  });
  app.post('/api/event/:eventId/guestbook',guestbookLimit,access,(req,res)=>{
    if(!active(req.event))return fail(res,402,'Das Album ist in der Downloadphase. Neue Gästebucheinträge sind geschlossen.');
    const name=String(req.body.name||'').trim(),message=String(req.body.message||'').trim();
    if(name.length>40||!message||message.length>500)return fail(res,400,'Bitte einen Namen mit höchstens 40 und eine Nachricht mit höchstens 500 Zeichen eingeben.');
    if(db.prepare('SELECT COUNT(*) count FROM guestbook_entries WHERE event_id=?').get(req.event.id).count>=500)return fail(res,429,'Das Gästebuch ist voll. Bitte wende dich an den Veranstalter.');
    const approved=req.event.guestbook_moderation?0:1,id=crypto.randomUUID();
    db.prepare('INSERT INTO guestbook_entries (id,event_id,guest_name,message,approved,created_at) VALUES (?,?,?,?,?,?)').run(id,req.event.id,name,message,approved,Date.now());
    res.status(201).json({success:true,pending:!approved});
  });
  app.patch('/api/event/:eventId/guestbook/:entryId',loginRequired,owner,(req,res)=>{
    if(typeof req.body.approved!=='boolean')return fail(res,400,'Freigabe muss true oder false sein.');
    const result=db.prepare('UPDATE guestbook_entries SET approved=? WHERE id=? AND event_id=?').run(req.body.approved?1:0,req.params.entryId,req.event.id);
    if(!result.changes)return fail(res,404,'Eintrag nicht gefunden.');res.json({success:true});
  });
  app.delete('/api/event/:eventId/guestbook/:entryId',loginRequired,owner,(req,res)=>{
    const result=db.prepare('DELETE FROM guestbook_entries WHERE id=? AND event_id=?').run(req.params.entryId,req.event.id);
    if(!result.changes)return fail(res,404,'Eintrag nicht gefunden.');res.json({success:true});
  });
  app.get('/api/event/:eventId/photos',access,(req,res)=>{
    const admin=own(req,req.event)&&req.query.manage==='1';
    const photos=own(req,req.event)
      ? db.prepare(`SELECT * FROM photos WHERE event_id=? ${admin?'':'AND approved=1'} ORDER BY created_at,id`).all(req.event.id)
      : db.prepare('SELECT * FROM photos WHERE event_id=? AND approved=1 AND uploader_token_hash=? ORDER BY created_at,id').all(req.event.id,req.guestTokenHash);
    res.json({photos:photos.map(p=>({id:p.id,url:photoUrl(req,p),timestamp:p.created_at,approved:!!p.approved})),serverTime:Date.now()});
  });
  app.get('/uploads/:eventId/:filename',access,wrap(async(req,res)=>{
    const p=db.prepare('SELECT * FROM photos WHERE event_id=? AND filename=?').get(req.event.id,req.params.filename);
    if(!p || (!p.approved && !own(req,req.event))) return fail(res,404,'Foto nicht gefunden.');
    if(!own(req,req.event) && p.uploader_token_hash!==req.guestTokenHash) return fail(res,404,'Foto nicht gefunden.');
    if(photoStorage.mode==='local') return res.sendFile(path.join(root,req.event.id,p.filename));
    const stream=await photoStorage.getStream(req.event.id,p.filename);
    res.type('jpeg');res.set('Cache-Control','private, no-store');stream.on('error',()=>res.destroy());stream.pipe(res);
  }));
  app.patch('/api/event/:eventId/photos/:photoId',loginRequired,owner,(req,res)=>{
    if(typeof req.body.approved!=='boolean') return fail(res,400,'Freigabe muss true oder false sein.');
    const result=db.prepare('UPDATE photos SET approved=? WHERE id=? AND event_id=?').run(req.body.approved?1:0,req.params.photoId,req.event.id);
    if(!result.changes) return fail(res,404,'Foto nicht gefunden.');res.json({success:true});
  });
  app.delete('/api/event/:eventId/photos/:photoId',loginRequired,owner,wrap(async(req,res)=>{
    const p=db.prepare('SELECT * FROM photos WHERE id=? AND event_id=?').get(req.params.photoId,req.event.id);
    if(!p) return fail(res,404,'Foto nicht gefunden.');
    await photoStorage.deletePhoto(req.event.id,p.filename);db.prepare('DELETE FROM photos WHERE id=?').run(p.id);res.json({success:true});
  }));
  app.get('/api/event/:eventId/download',access,wrap(async(req,res)=>{
    const photos=own(req,req.event)
      ? db.prepare('SELECT * FROM photos WHERE event_id=?').all(req.event.id)
      : db.prepare('SELECT * FROM photos WHERE event_id=? AND approved=1 AND uploader_token_hash=?').all(req.event.id,req.guestTokenHash);
    if(!photos.length) return fail(res,404,'Keine Fotos vorhanden.');
    res.attachment(`event-${req.event.id}-fotos.zip`);
    const archive=new archiver.ZipArchive({zlib:{level:1}});
    archive.on('error',()=>res.destroy());res.on('close',()=>archive.abort());archive.pipe(res);
    for(const p of photos) {
      if(photoStorage.mode==='local') archive.file(path.join(root,req.event.id,p.filename),{name:p.filename});
      else archive.append(await photoStorage.getStream(req.event.id,p.filename),{name:p.filename});
    }
    archive.finalize();
  }));
  async function erase(e) {
    if(busy.has(e.id)) return false;
    // Legacy unowned events are never removed automatically: review/import first.
    await photoStorage.deleteEvent(e.id);
    db.transaction(()=>{db.prepare('DELETE FROM photos WHERE event_id=?').run(e.id);db.prepare('DELETE FROM guestbook_entries WHERE event_id=?').run(e.id);db.prepare("UPDATE events SET status='expired', deleted_at=?, guest_token=NULL WHERE id=?").run(Date.now(),e.id);})();
    return true;
  }
  app.delete('/api/event/:eventId',loginRequired,owner,wrap(async(req,res)=>{if(!await erase(req.event)) return fail(res,409,'Upload läuft. Bitte erneut versuchen.');res.json({success:true});}));
  app.delete('/api/auth/account',authLimit,loginRequired,wrap(async(req,res)=>{
    const password=req.body.password;
    if(req.body.confirm!=='KONTO LÖSCHEN') return fail(res,400,'Bitte die Löschung mit „KONTO LÖSCHEN“ bestätigen.');
    if(typeof password!=='string'||password.length>128) return fail(res,400,'Bitte dein Passwort eingeben.');
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    const [salt,stored]=(user?.password_hash||`${'0'.repeat(64)}:${'0'.repeat(128)}`).split(':');
    const derived=await scrypt(password,salt,64);
    if(!user||!crypto.timingSafeEqual(Buffer.from(stored,'hex'),derived)) return fail(res,401,'Das Passwort stimmt nicht.');
    const events=db.prepare('SELECT * FROM events WHERE owner_id=?').all(req.user.id);
    if(events.some(event=>busy.has(event.id))) return fail(res,409,'Für eine Veranstaltung läuft gerade ein Foto-Upload. Bitte warte kurz und versuche es erneut.');
    deletingUsers.add(req.user.id);
    try {
      // Prevent a still-open checkout from charging after the owner has deleted the albums.
      for(const event of events) {
        const payment=db.prepare('SELECT * FROM payments WHERE event_id=?').get(event.id);
        if(!payment?.stripe_session_id||payment.status==='paid') continue;
        if(!stripe) return fail(res,503,'Ein offener Zahlungs-Checkout kann gerade nicht geprüft werden. Bitte später erneut versuchen.');
        const session=await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
        if(session.status==='open') await stripe.checkout.sessions.expire(session.id);
        if(session.payment_status==='paid'&&payment.status!=='paid') db.prepare("UPDATE payments SET status='paid' WHERE id=?").run(payment.id);
      }
      for(const event of events) if(!await erase(event)) return fail(res,409,'Für eine Veranstaltung läuft gerade ein Foto-Upload. Bitte versuche es erneut.');
      const retainedPayments=events.filter(event=>db.prepare("SELECT 1 FROM payments WHERE event_id=? AND status='paid'").get(event.id)).length;
      db.transaction(()=>{
        const updatePaid=db.prepare("UPDATE events SET owner_id=NULL,email=NULL,title='Gelöschtes Album',event_date=NULL,design_json='{}',guest_token=NULL,stripe_session_id=NULL,status='expired',deleted_at=?,upload_successes=0,upload_failures=0 WHERE id=?");
        const deletePayments=db.prepare("DELETE FROM payments WHERE event_id=? AND status!='paid'");
        const deleteUnpaid=db.prepare('DELETE FROM events WHERE id=?');
        for(const event of events) {
          deletePayments.run(event.id);
          if(db.prepare("SELECT 1 FROM payments WHERE event_id=? AND status='paid'").get(event.id)) updatePaid.run(Date.now(),event.id);
          else deleteUnpaid.run(event.id);
        }
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
        db.prepare('DELETE FROM password_resets WHERE user_id=?').run(req.user.id);
        db.prepare('DELETE FROM email_verifications WHERE user_id=?').run(req.user.id);
        db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);
      })();
      res.clearCookie('event_session',{path:'/'});
      res.json({success:true,deletedEvents:events.length,retainedPayments});
    } finally {deletingUsers.delete(req.user.id);}
  }));
  function cleanup() {
    const expired=db.prepare("SELECT * FROM events WHERE owner_id IS NOT NULL AND deleted_at IS NULL AND status IN ('paid','trial','pilot') ").all().filter(e=>retentionUntil(e)<=Date.now());
    const pruneRecords=()=>{
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
      db.prepare('DELETE FROM email_verifications WHERE expires_at<=?').run(Date.now());
      db.prepare('DELETE FROM password_resets WHERE expires_at<=?').run(Date.now());
      for(const entry of fs.readdirSync(temp)) {const file=path.join(temp,entry);if(fs.statSync(file).mtimeMs<Date.now()-86400000) fs.rmSync(file,{force:true});}
    };
    if(photoStorage.mode==='local') {for(const e of expired) {if(!busy.has(e.id)){fs.rmSync(path.join(root,e.id),{recursive:true,force:true});db.transaction(()=>{db.prepare('DELETE FROM photos WHERE event_id=?').run(e.id);db.prepare('DELETE FROM guestbook_entries WHERE event_id=?').run(e.id);db.prepare("UPDATE events SET status='expired', deleted_at=?, guest_token=NULL WHERE id=?").run(Date.now(),e.id);})();}}pruneRecords();return;}
    return (async()=>{for(const e of expired) await erase(e);pruneRecords();})();
  }
  const pub=path.join(__dirname,'public');
  app.get('/',(req,res)=>res.sendFile(path.join(pub,'landing.html')));
  app.get(['/forgot-password','/reset-password'],(req,res)=>res.sendFile(path.join(pub,'password-recovery.html')));
  app.get('/verify-email',(req,res)=>res.sendFile(path.join(pub,'verify-email.html')));
  app.get('/impressum',(req,res)=>res.sendFile(path.join(pub,'impressum.html')));
  app.get('/datenschutz',(req,res)=>res.sendFile(path.join(pub,'datenschutz.html')));
  app.get('/register',(req,res)=>req.user?res.redirect(['event','1m','3m','6m'].includes(req.query.plan)?`/dashboard?plan=${encodeURIComponent(req.query.plan)}`:'/dashboard'):res.sendFile(path.join(pub,'login.html')));
  app.get('/login',(req,res)=>res.sendFile(path.join(pub,'login.html')));
  app.get('/dashboard',(req,res)=>req.user?res.sendFile(path.join(pub,'dashboard.html')):res.redirect('/login'));
  app.get('/success',(req,res)=>req.user?res.sendFile(path.join(pub,'success.html')):res.redirect('/login'));
  app.get('/event/:eventId/admin',loginRequired,owner,(req,res)=>res.redirect('/dashboard'));
  app.get('/event/:eventId/design',loginRequired,owner,(req,res)=>{
    if(!readable(req.event))return res.redirect(`/dashboard?event=${encodeURIComponent(req.event.id)}`);
    // The editor's print window builds a self-contained page with inline layout styles.
    // Allow those styles only on this authenticated editor page; other pages keep Helmet's policy.
    res.set('Content-Security-Policy',[
      "default-src 'self'",
      "base-uri 'self'",
      "font-src 'self' https: data:",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "img-src 'self' data: blob:",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      ...(baseUrl.protocol==='https:'?['upgrade-insecure-requests']:[])
    ].join('; '));
    res.sendFile(path.join(pub,'design-editor.html'));
  });
  for(const [suffix,file] of [['','gallery.html'],['/upload','upload.html'],['/gallery','gallery.html'],['/slideshow','slideshow.html'],['/games','games.html'],['/guestbook','guestbook.html']]) app.get(`/event/:eventId${suffix}`,access,(req,res)=>res.sendFile(path.join(pub,file)));
  // Only intended public assets; source code and generic HTML routes cannot bypass guards.
  for(const file of ['style.css','design-editor.css','design-editor.js','upload.js','slideshow.js','guest-access.js','account.js','verify-email.js','password-recovery.js','games.js','guestbook.js','johanna-bastian.png','photographer.webp','event-wedding.jpg','event-birthday.jpg','event-summer.jpg','event-company.jpg']) app.get(`/${file}`,(req,res)=>res.sendFile(path.join(pub,file)));
  // Liveness stays cheap for the host's restart check. Readiness checks critical dependencies.
  app.get('/health',(req,res)=>res.json({ok:true}));
  app.get('/ready',async(req,res)=>{
    try {
      db.prepare('SELECT 1').get();
      const disk=fs.statfsSync(root),freeBytes=Number(disk.bavail)*Number(disk.bsize);
      if(freeBytes<100*1024**2)throw new Error('Upload volume below the 100 MiB operating reserve.');
      await photoStorage.check();
      res.json({ok:true});
    } catch(error) {
      console.error('Readiness check failed:',error.message);
      res.status(503).json({ok:false});
    }
  });
  app.use((req,res)=>fail(res,404,'Nicht gefunden.'));
  app.use((err,req,res,next)=>{console.error(err.message);if(!res.headersSent) fail(res,500,'Interner Fehler.');});
  app.locals.db=db;app.locals.cleanup=cleanup;app.locals.fulfill=fulfill;app.locals.photoStorage=photoStorage;
  return app;
}
if(require.main===module) {
  const app=createApp();
  Promise.resolve(app.locals.cleanup()).catch(err=>console.error('Löschung fehlgeschlagen:',err.message));
  const disk=fs.statfsSync(path.resolve(process.env.UPLOAD_DIR || path.join(__dirname,'uploads')));
  console.info(app.locals.photoStorage.mode==='s3'?'Temporärer Upload-Speicher verfügbar (MiB):':'Fotospeicher verfügbar (MiB):',Math.floor(Number(disk.bavail)*Number(disk.bsize)/1024**2));
  const cleanupTimer=setInterval(()=>{try{Promise.resolve(app.locals.cleanup()).catch(err=>console.error('Löschung fehlgeschlagen:',err.message));}catch(err){console.error('Löschung fehlgeschlagen:',err.message);}},3600000);
  cleanupTimer.unref();
  const server=app.listen(process.env.PORT||3000,()=>console.log('Event-Foto-Plattform gestartet (Stripe-Testmodus).'));
  let shuttingDown=false;
  const shutdown=signal=>{
    if(shuttingDown)return;
    shuttingDown=true;
    console.info(`${signal}: Beende laufende Anfragen.`);
    clearInterval(cleanupTimer);
    const timeout=setTimeout(()=>{
      console.error('Geordnetes Herunterfahren dauerte zu lange; offene Verbindungen werden geschlossen.');
      server.closeAllConnections?.();
      try{app.locals.db.close();}catch{}
      process.exit(1);
    },25000);
    timeout.unref();
    server.close(()=>{
      clearTimeout(timeout);
      app.locals.db.close();
      console.info('Server sauber beendet.');
    });
  };
  process.once('SIGTERM',()=>shutdown('SIGTERM'));
  process.once('SIGINT',()=>shutdown('SIGINT'));
}
module.exports={createApp,eventDeadline,retentionUntil};
