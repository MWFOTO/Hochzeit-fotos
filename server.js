Warning: truncated output (original token count: 26096)
Total output lines: 1162

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
const { prepareVideo, MAX_VIDEO_BYTES, MAX_VIDEOS_PER_EVENT } = require('./video-greetings');
const { createPhotoStorage } = require('./photo-storage');
const { createBackupService } = require('./backup-service');
const { createOperationsMonitor } = require('./operations-monitor');
const { createContractConfirmation } = require('./contract-confirmation');
const { createPaymentReceipt } = require('./payment-receipt');
const { createUploadCapacity, GiB, MiB, MIN_UPLOAD_FREE_BYTES, uploadDiskWarningThreshold } = require('./upload-capacity');
const scrypt = promisify(crypto.scrypt);
const PLANS = { event:{label:'FinalSnap Fotoalbum',months:3,retentionDays:90,priceCents:4990}, '1m':{label:'1 Monat (alt)',months:1,priceCents:1900,legacy:true}, '3m':{label:'3 Monate (alt)',months:3,priceCents:2900,legacy:true}, '6m':{label:'6 Monate (alt)',months:6,priceCents:3900,legacy:true}, '12m':{label:'12 Monate (alt)',months:12,priceCents:5900,legacy:true} };
const TERMS_VERSION = '2026-11-04-2';
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
const MAX_UPLOAD_FILE_BYTES = 20*1024*1024;
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
  const invoicePdfFetcher=options.invoicePdfFetcher||(async(url)=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`Stripe-PDF konnte nicht geladen werden (${response.status}).`);
    const finalUrl=new URL(response.url||url);
    const allowedPdfHost=finalUrl.hostname==='invoice.stripe.com'||finalUrl.hostname==='pay.stripe.com'||finalUrl.hostname==='stripe-upload-api.s3.us-west-1.amazonaws.com';
    if(finalUrl.protocol!=='https:'||!allowedPdfHost)throw new Error(`Stripe-PDF wurde von einem nicht freigegebenen Host geladen (${finalUrl.protocol}//${finalUrl.hostname}).`);
    const content=Buffer.from(await response.arrayBuffer());
    if(content.length>15*1024*1024)throw new Error('Stripe-PDF überschreitet die zulässige Dateigröße.');
    if(content.subarray(0,5).toString()!=='%PDF-')throw new Error('Stripe hat keine gültige PDF-Rechnung geliefert.');
    return content;
  });
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
  const videoAvailable=cfg.VIDEO_GREETINGS_ENABLED==='1';
  const photoStorage = options.photoStorage || createPhotoStorage(cfg);
  const storageLimit = Number(cfg.S3_MAX_STORAGE_BYTES || 900 * 1024 ** 3);
  if (!Number.isSafeInteger(storageLimit) || storageLimit <= 100 * 1024 ** 2) throw new Error('S3_MAX_STORAGE_BYTES muss größer als 100 MiB sein.');
  const db = openDatabase(cfg.DB_PATH || path.join(__dirname,'events.db'));
  const backupService=createBackupService({config:cfg,db,mailer});
  const operationsMonitor=createOperationsMonitor({config:cfg,db,mailer});
  const uploadCapacity=createUploadCapacity({root,maxConcurrent:2,statfs:options.uploadCapacityStatfs});
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
  const paymentAdminEmails=new Set(String(cfg.PAYMENT_ADMIN_EMAILS||'').split(',').map(email=>email.trim().toLowerCase()).filter(Boolean));
  const app = express();
  if (cfg.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'"], 'script-src-attr':["'none'"], 'img-src':["'self'",'data:','blob:'], 'upgrade-insecure-requests': baseUrl.protocol === 'https:' ? [] : null}}}));
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
  const relevantPaymentEvents=new Set(['refund.created','refund.updated','refund.failed','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_reinstated','charge.dispute.funds_withdrawn','invoice.finalized','invoice.finalization_failed','invoice.paid','invoice.payment_failed']);
  const paymentAlertEvents=new Set(['refund.created','refund.updated','refund.failed','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','charge.dispute.funds_reinstated','charge.dispute.funds_withdrawn','invoice.finalization_failed','invoice.payment_failed','customer.withdrawal.submitted']);
  function paymentForStripeObject(object) {
    const paymentIntent=typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id;
    if(paymentIntent){const payment=db.prepare('SELECT * FROM payments WHERE stripe_payment_intent_id=?').get(paymentIntent);if(payment)return payment;}
    const paymentId=object.metadata?.paymentId;
    if(paymentId){const payment=db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);if(payment)return payment;}
    const charge=typeof object.charge==='string'?object.charge:object.charge?.id;
    if(charge){const refund=db.prepare('SELECT payment_id FROM refunds WHERE stripe_refund_id=?').get(charge);if(refund)return db.prepare('SELECT * FROM payments WHERE id=?').get(refund.payment_id);}
    return null;
  }
  function auditPaymentEvent({stripeEventId=null,paymentId,source,eventType,status,amountCents=null,actorEmail=null,note=null,details={}}) {
    const id=crypto.randomUUID(),now=Date.now();
    db.prepare('INSERT INTO payment_events (id,stripe_event_id,payment_id,source,event_type,status,amount_cents,actor_email,note,details_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,stripeEventId,paymentId,source,eventType,status,amountCents,actorEmail,note,JSON.stringify(details),now);
    if(paymentAlertEvents.has(eventType)||eventType.startsWith('manual.refund.'))db.prepare('INSERT INTO payment_alerts (event_id,status,attempts,created_at) VALUES (?,\'pending\',0,?)').run(id,now);
    return id;
  }
  async function flushPaymentAlerts() {
    const pending=db.prepare("SELECT a.event_id,a.attempts,p.id payment_id,p.event_id album_id,p.amount_cents,e.event_type,e.status,e.amount_cents event_amount,e.note,e.details_json FROM payment_alerts a JOIN payment_events e ON e.id=a.event_id JOIN payments p ON p.id=e.payment_id ORDER BY e.created_at LIMIT 20").all();
    const recipient=String(cfg.PAYMENT_ALERT_EMAIL||[...paymentAdminEmails][0]||cfg.BREVO_SENDER_EMAIL||'').trim();
    for(const alert of pending){
      try{
        if(!recipient||!mailer)throw new Error(!recipient?'PAYMENT_ALERT_EMAIL fehlt.':'Brevo-Versand ist nicht eingerichtet.');
        const info=JSON.parse(alert.details_json||'{}');
        await mailer({to:recipient,subject:`FinalSnap Zahlung: ${alert.event_type}`,text:[`Zahlungsereignis: ${alert.event_type}`,`Status: ${alert.status}`,`Album-ID: ${alert.album_id}`,`Zahlungs-ID: ${alert.payment_id}`,`Betrag: ${((alert.event_amount??alert.amount_cents??alert.amount_cents??0)/100).toFixed(2)} EUR`,alert.note?`Notiz: ${alert.note}`:'',`Details: ${JSON.stringify(info)}`,'Prüfen: Stripe Dashboard und interner Zahlungsablauf.'].filter(Boolean).join('\n')});
        db.prepare("UPDATE payment_alerts SET status='sent',attempts=attempts+1,last_error=NULL,sent_at=? WHERE event_id=?").run(Date.now(),alert.event_id);
      }catch(error){
        db.prepare('UPDATE payment_alerts SET attempts=attempts+1,last_error=? WHERE event_id=?').run(String(error.message||error).slice(0,300),alert.event_id);
        console.error('Zahlungsalarm konnte nicht versendet werden:',String(error.message||error));
      }
    }
  }
  async function flushContractConfirmations() {
    const pending=db.prepare("SELECT c.*,p.amount_cents,p.customer_type,p.early_start_requested_at,p.early_start_acknowledged_at,p.terms_version,p.stripe_invoice_id,e.id album_id,e.title,e.event_date,e.email,e.status event_status FROM contract_confirmations c JOIN payments p ON p.id=c.payment_id JOIN events e ON e.id=p.event_id WHERE c.status='pending' ORDER BY c.created_at LIMIT 20").all();
    for(const confirmation of pending){
      try{
        if(!mailer)throw new Error('Brevo-Versand ist nicht eingerichtet.');
        if(!confirmation.stripe_invoice_id||!stripe?.invoices?.retrieve)throw new Error('Die Stripe-Rechnung ist noch nicht verfügbar.');
        const invoice=await stripe.invoices.retrieve(confirmation.stripe_invoice_id);
        if(invoice.status!=='paid'||!invoice.invoice_pdf)throw new Error('Die bezahlte Stripe-PDF-Rechnung ist noch nicht verfügbar.');
        const invoiceUrl=new URL(invoice.invoice_pdf);
        if(invoiceUrl.protocol!=='https:'||!['invoice.stripe.com','pay.stripe.com'].includes(invoiceUrl.hostname))throw new Error('Stripe hat keinen gültigen sicheren Rechnungslink geliefert.');
        const invoicePdf=await invoicePdfFetcher(invoice.invoice_pdf);
        const receiptPdf=createPaymentReceipt({invoice,isTestMode:invoice.livemode===false});
        const message=createContractConfirmation({confirmation,baseUrl:baseUrl.origin,storageLimitBytes:eventStorageLimit({status:confirmation.event_status,event_date:confirmation.event_date,created_at:confirmation.created_at},cfg),invoiceNumber:invoice.number,invoiceUrl:invoice.invoice_pdf,isTestMode:invoice.livemode===false});
        const safeInvoiceName=String(invoice.number||confirmation.album_id).replace(/[^a-zA-Z0-9_-]/g,'-');
        await mailer({to:confirmation.recipient,...message,attachments:[
          {name:`FinalSnap-Rechnung-${safeInvoiceName}.pdf`,content:invoicePdf.toString('base64')},
          {name:`FinalSnap-Zahlungsbestaetigung-${safeInvoiceName}.pdf`,content:receiptPdf.toString('base64')}
        ]});
        db.prepare("UPDATE contract_confirmations SET status='sent',recipient='',attempts=attempts+1,last_error=NULL,sent_at=? WHERE payment_id=?").run(Date.now(),confirmation.payment_id);
      }catch(error){
        db.prepare("UPDATE contract_confirmations SET attempts=attempts+1,last_error=? WHERE payment_id=?").run(String(error.message||error).slice(0,300),confirmation.payment_id);
        console.error('Vertragsbestätigung konnte nicht versendet werden:',String(error.message||error));
      }
    }
  }
  async function flushWithdrawalConfirmations() {
    const sending=app.locals.withdrawalEmailsInFlight||(app.locals.withdrawalEmailsInFlight=new Set());
    const pending=db.prepare("SELECT w.*,e.id album_id,e.title FROM withdrawal_confirmations w JOIN payments p ON p.id=w.payment_id JOIN events e ON e.id=p.event_id WHERE w.status='pending' ORDER BY w.submitted_at LIMIT 20").all();
    for(const notice of pending){
      if(sending.has(notice.payment_id))continue;
      sending.add(notice.payment_id);
      try{
        if(!mailer)throw new Error('Brevo-Versand ist nicht eingerichtet.');
        await mailer({to:notice.recipient,subject:'Eingangsbestätigung deines Widerrufs · FinalSnap',text:[
          'Eingangsbestätigung – Widerruf bei FinalSnap','',
          `Vertrag: FinalSnap Fotoalbum „${notice.title}“ (Album-ID ${notice.album_id}).`,
          `Name: ${notice.customer_name}`,
          `E-Mail für die Eingangsbestätigung: ${notice.recipient}`,
          `Eingang: ${new Date(notice.submitted_at).toLocaleString('de-DE',{dateStyle:'long',timeStyle:'medium',timeZone:'Europe/Berlin'})} Uhr (Europe/Berlin).`,
          '',`Deine Erklärung: ${notice.statement}`,'',
          'Wir bestätigen den Eingang deines Widerrufs. Die Erstattung und die weitere Vertragsabwicklung werden separat geprüft; diese Eingangsbestätigung ist noch keine Bestätigung einer bereits ausgeführten Erstattung.'
        ].join('\n')});
        db.prepare("UPDATE withdrawal_confirmations SET status='sent',attempts=attempts+1,last_error=NULL,sent_at=? WHERE payment_id=?").run(Date.now(),notice.payment_id);
      }catch(error){
        db.prepare('UPDATE withdrawal_confirmations SET attempts=attempts+1,last_error=? WHERE payment_id=?').run(String(error.message||error).slice(0,300),notice.payment_id);
        console.error('Widerrufsbestätigung konnte nicht versendet werden:',String(error.message||error));
      }finally{sending.delete(notice.payment_id);}
    }
  }
  async function flushAccountDeletionConfirmations() {
    const now=Date.now();
    db.prepare('DELETE FROM account_deletion_confirmations WHERE created_at<?').run(now-7*86400000);
    const pending=db.prepare('SELECT * FROM account_deletion_confirmations ORDER BY created_at LIMIT 20').all();
    const sending=app.locals.accountDeletionEmailsInFlight||(app.locals.accountDeletionEmailsInFlight=new Set());
    for(const notice of pending){
      if(sending.has(notice.id))continue;
      sending.add(notice.id);
      try{
        if(!mailer)throw new Error('Brevo-Versand ist nicht eingerichtet.');
        const deletedAt=new Date(notice.created_at).toLocaleString('de-DE',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Berlin'});
        await mailer({to:notice.recipient,subject:'Dein FinalSnap-Konto wurde gelöscht',text:[
          'Bestätigung der Kontolöschung bei FinalSnap','',
          `Dein Veranstalterkonto wurde am ${deletedAt} dauerhaft gelöscht.`,
          'Deine Anmeldedaten und Sitzungen sowie deine Veranstaltungsalben, Fotos, Gästebucheinträge und Gästelinks wurden aus dem …16096 tokens truncated…uestbook',access,(req,res)=>{
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
      : db.prepare('SELECT * FROM photos WHERE event_id=? AND approved=1 ORDER BY created_at,id').all(req.event.id);
    res.json({photos:photos.map(p=>({id:p.id,url:photoUrl(req,p),timestamp:p.created_at,approved:!!p.approved})),serverTime:Date.now()});
  });
  app.get('/uploads/:eventId/:filename',access,wrap(async(req,res)=>{
    const p=db.prepare('SELECT * FROM photos WHERE event_id=? AND filename=?').get(req.event.id,req.params.filename);
    if(!p || (!p.approved && !own(req,req.event))) return fail(res,404,'Foto nicht gefunden.');
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
    await photoStorage.deletePhoto(req.event.id,p.filename);await backupService.deletePhoto(req.event.id,p.filename);db.prepare('DELETE FROM photos WHERE id=?').run(p.id);res.json({success:true});
  }));
  app.get('/api/event/:eventId/download',access,wrap(async(req,res)=>{
    const photos=own(req,req.event)
      ? db.prepare('SELECT * FROM photos WHERE event_id=?').all(req.event.id)
      : db.prepare('SELECT * FROM photos WHERE event_id=? AND approved=1 ORDER BY created_at,id').all(req.event.id);
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
    await backupService.deleteEvent(e.id);
    db.transaction(()=>{db.prepare('DELETE FROM photos WHERE event_id=?').run(e.id);db.prepare('DELETE FROM guestbook_entries WHERE event_id=?').run(e.id);db.prepare('DELETE FROM video_greetings WHERE event_id=?').run(e.id);db.prepare("UPDATE events SET status='expired', deleted_at=?, guest_token=NULL WHERE id=?").run(Date.now(),e.id);})();
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
    const confirmationRecipient=user.email;
    const events=db.prepare('SELECT * FROM events WHERE owner_id=?').all(req.user.id);
    if(events.some(event=>busy.has(event.id))) return fail(res,409,'Für eine Veranstaltung läuft gerade ein Foto-Upload. Bitte warte kurz und versuche es erneut.');
    deletingUsers.add(req.user.id);
    try {
      // Prevent a still-open checkout from charging after the owner has deleted the albums.
      for(const event of events) {
        const payment=db.prepare('SELECT * FROM payments WHERE event_id=?').get(event.id);
        if(!payment?.stripe_session_id||['paid','partially_refunded','refunded','disputed','disputed_lost'].includes(payment.status)) continue;
        if(!stripe) return fail(res,503,'Ein offener Zahlungs-Checkout kann gerade nicht geprüft werden. Bitte später erneut versuchen.');
        let session;
        try {
          session=await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
        } catch(error) {
          // A checkout created in an older Stripe test account cannot be looked up
          // with the current account's key. Such sessions are test-only legacy data;
          // mark their attempts stale and let account deletion continue.
          if(error.code!=='resource_missing') throw error;
          db.prepare("UPDATE payment_attempts SET status='expired',updated_at=? WHERE payment_id=? AND status='open'").run(Date.now(),payment.id);
          continue;
        }
        if(session.status==='open') await stripe.checkout.sessions.expire(session.id);
        if(session.payment_status==='paid'&&payment.status!=='paid') db.prepare("UPDATE payments SET status='paid' WHERE id=?").run(payment.id);
      }
      for(const event of events) if(!await erase(event)) return fail(res,409,'Für eine Veranstaltung läuft gerade ein Foto-Upload. Bitte versuche es erneut.');
      const retainedPayments=events.filter(event=>db.prepare("SELECT 1 FROM payments WHERE event_id=? AND status IN ('paid','partially_refunded','refunded','disputed','disputed_lost')").get(event.id)).length;
      db.transaction(()=>{
        const updatePaid=db.prepare("UPDATE events SET owner_id=NULL,email=NULL,title='Gelöschtes Album',event_date=NULL,design_json='{}',guest_token=NULL,stripe_session_id=NULL,status='expired',deleted_at=?,upload_successes=0,upload_failures=0 WHERE id=?");
        const deletePayments=db.prepare("DELETE FROM payments WHERE event_id=? AND status NOT IN ('paid','partially_refunded','refunded','disputed','disputed_lost')");
        const deleteUnpaid=db.prepare('DELETE FROM events WHERE id=?');
        for(const event of events) {
          deletePayments.run(event.id);
          if(db.prepare("SELECT 1 FROM payments WHERE event_id=? AND status IN ('paid','partially_refunded','refunded','disputed','disputed_lost')").get(event.id)) updatePaid.run(Date.now(),event.id);
          else deleteUnpaid.run(event.id);
        }
        db.prepare('INSERT INTO account_deletion_confirmations (id,recipient,created_at) VALUES (?,?,?)').run(crypto.randomUUID(),confirmationRecipient,Date.now());
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);
        db.prepare('DELETE FROM password_resets WHERE user_id=?').run(req.user.id);
        db.prepare('DELETE FROM email_verifications WHERE user_id=?').run(req.user.id);
        db.prepare('DELETE FROM users WHERE id=?').run(req.user.id);
      })();
      res.clearCookie('event_session',{path:'/'});
      await flushAccountDeletionConfirmations();
      res.json({success:true,deletedEvents:events.length,retainedPayments});
    } finally {deletingUsers.delete(req.user.id);}
  }));
  function cleanup() {
    const expired=db.prepare("SELECT * FROM events WHERE owner_id IS NOT NULL AND deleted_at IS NULL AND status IN ('paid','trial','pilot','refunded') ").all().filter(e=>retentionUntil(e)<=Date.now());
    const pruneRecords=()=>{
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
      db.prepare('DELETE FROM email_verifications WHERE expires_at<=?').run(Date.now());
      db.prepare('DELETE FROM password_resets WHERE expires_at<=?').run(Date.now());
      db.prepare('DELETE FROM experience_reviews WHERE created_at<?').run(Date.now()-365*86400000);
      for(const entry of fs.readdirSync(temp)) {const file=path.join(temp,entry);if(fs.statSync(file).mtimeMs<Date.now()-86400000) fs.rmSync(file,{force:true});}
    };
    if(photoStorage.mode==='local') {for(const e of expired) {if(!busy.has(e.id)){fs.rmSync(path.join(root,e.id),{recursive:true,force:true});db.transaction(()=>{db.prepare('DELETE FROM photos WHERE event_id=?').run(e.id);db.prepare('DELETE FROM guestbook_entries WHERE event_id=?').run(e.id);db.prepare('DELETE FROM video_greetings WHERE event_id=?').run(e.id);db.prepare("UPDATE events SET status='expired', deleted_at=?, guest_token=NULL WHERE id=?").run(Date.now(),e.id);})();}}pruneRecords();return;}
    return (async()=>{for(const e of expired) await erase(e);pruneRecords();})();
  }
  const pub=path.join(__dirname,'public');
  app.get('/',(req,res)=>{
    res.set('Content-Security-Policy',[
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self' https://*.trustpilot.com",
      "font-src 'self' https: data:",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "frame-src https://*.trustpilot.com https://www.youtube-nocookie.com",
      "img-src 'self' data: blob: https://*.trustpilot.com",
      "object-src 'none'",
      "script-src 'self' https://widget.trustpilot.com",
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      ...(baseUrl.protocol==='https:'?['upgrade-insecure-requests']:[])
    ].join('; '));
    res.sendFile(path.join(pub,'landing.html'));
  });
  app.get(['/forgot-password','/reset-password'],(req,res)=>res.sendFile(path.join(pub,'password-recovery.html')));
  app.get('/verify-email',(req,res)=>res.sendFile(path.join(pub,'verify-email.html')));
  app.get('/impressum',(req,res)=>res.sendFile(path.join(pub,'impressum.html')));
  app.get('/datenschutz',(req,res)=>res.sendFile(path.join(pub,'datenschutz.html')));
  app.get('/widerruf',(req,res)=>res.sendFile(path.join(pub,'widerruf.html')));
  app.get('/bedingungen',(req,res)=>res.sendFile(path.join(pub,'bedingungen.html')));
  app.get('/register',(req,res)=>req.user?res.redirect(['event','1m','3m','6m'].includes(req.query.plan)?`/dashboard?plan=${encodeURIComponent(req.query.plan)}`:'/dashboard'):res.sendFile(path.join(pub,'login.html')));
  app.get('/login',(req,res)=>res.sendFile(path.join(pub,'login.html')));
  app.get('/dashboard',(req,res)=>req.user?res.sendFile(path.join(pub,'dashboard.html')):res.redirect('/login'));
  app.get('/success',(req,res)=>req.user?res.sendFile(path.join(pub,'success.html')):res.redirect('/login'));
  app.locals.paymentAlertTimer=setInterval(()=>{flushPaymentAlerts().catch(error=>console.error('Zahlungsalarme konnten nicht verarbeitet werden:',error.message));flushContractConfirmations().catch(error=>console.error('Vertragsbestätigungen konnten nicht verarbeitet werden:',error.message));flushWithdrawalConfirmations().catch(error=>console.error('Widerrufsbestätigungen konnten nicht verarbeitet werden:',error.message));flushAccountDeletionConfirmations().catch(error=>console.error('Kontolöschungsbestätigungen konnten nicht verarbeitet werden:',error.message));},60000);app.locals.paymentAlertTimer.unref();
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
      "script-src 'self'",
      "script-src-attr 'none'",
      "style-src 'self' 'unsafe-inline'",
      ...(baseUrl.protocol==='https:'?['upgrade-insecure-requests']:[])
    ].join('; '));
    res.sendFile(path.join(pub,'design-editor.html'));
  });
  for(const [suffix,file] of [['','gallery.html'],['/upload','upload.html'],['/gallery','gallery.html'],['/slideshow','slideshow.html'],['/games','games.html'],['/guestbook','guestbook.html']]) app.get(`/event/:eventId${suffix}`,access,(req,res)=>res.sendFile(path.join(pub,file)));
  app.get('/event/:eventId/video-grussbox',access,(req,res)=>{
    if(!videoAvailable||!req.event.video_greetings_enabled||!active(req.event))return fail(res,404,'Die Videogrußbox ist für diese Feier geschlossen.');
    res.set('Permissions-Policy','camera=(self), microphone=(self)');
    const policy=res.get('Content-Security-Policy');
    if(policy)res.set('Content-Security-Policy',policy+";media-src 'self' blob:");
    res.sendFile(path.join(pub,'video-grussbox.html'));
  });
  // Only intended public assets; source code and generic HTML routes cannot bypass guards.
  for(const file of ['style.css','design-editor.css','design-editor.js','upload.js','slideshow.js','guest-access.js','account.js','verify-email.js','password-recovery.js','games.js','guestbook.js','video-grussbox.js','payments-admin.js','backups-admin.js','landing.js','reviews.js','reviews-admin.js','finalsnap-logo.webp','success.js','gallery-init.js','admin.js','johanna-bastian.png','photographer.webp','event-wedding.webp','event-birthday.jpg','event-summer.jpg','event-company.jpg']) app.get(`/${file}`,(req,res)=>res.sendFile(path.join(pub,file)));
  for(const file of ['qr-einladung.webp','fotos-sammeln.webp','live-diashow.webp','hochzeit-party.webp','geburtstag.webp','party.webp','why-finalsnap-poster.jpg']) app.get(`/preview-assets/${file}`,(req,res)=>res.sendFile(path.join(pub,'preview-assets',file)));
  for(const file of ['finalsnap-mascot-landscape-poster.jpg','finalsnap-mascot-landscape.mp4']) app.get(`/animations/${file}`,(req,res)=>res.sendFile(path.join(pub,'animations',file)));
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
  app.locals.db=db;app.locals.cleanup=cleanup;app.locals.fulfill=fulfill;app.locals.flushPaymentAlerts=flushPaymentAlerts;app.locals.flushContractConfirmations=flushContractConfirmations;app.locals.flushWithdrawalConfirmations=flushWithdrawalConfirmations;app.locals.flushAccountDeletionConfirmations=flushAccountDeletionConfirmations;app.locals.photoStorage=photoStorage;app.locals.backupService=backupService;app.locals.operationsMonitor=operationsMonitor;
  return app;
}
if(require.main===module) {
  const app=createApp();
  app.locals.backupService.start();
  app.locals.operationsMonitor.start();
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
    app.locals.backupService.stop();
    app.locals.operationsMonitor.stop();
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
