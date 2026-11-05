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
const { createBackupService } = require('./backup-service');
const { createOperationsMonitor } = require('./operations-monitor');
const { createContractConfirmation } = require('./contract-confirmation');
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
    if(finalUrl.protocol!=='https:'||!(finalUrl.hostname==='stripe.com'||finalUrl.hostname.endsWith('.stripe.com')))throw new Error(`Stripe-PDF wurde von einem nicht freigegebenen Host geladen (${finalUrl.protocol}//${finalUrl.hostname}).`);
    const contentType=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    const content=Buffer.from(await response.arrayBuffer());
    if(content.length>15*1024*1024)throw new Error('Stripe-PDF überschreitet die zulässige Dateigröße.');
    if(contentType!=='application/pdf'||content.subarray(0,5).toString()!=='%PDF-')throw new Error('Stripe hat keine gültige PDF-Rechnung geliefert.');
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
        const message=createContractConfirmation({confirmation,baseUrl:baseUrl.origin,storageLimitBytes:eventStorageLimit({status:confirmation.event_status,event_date:confirmation.event_date,created_at:confirmation.created_at},cfg),invoiceNumber:invoice.number,invoiceUrl:invoice.invoice_pdf,isTestMode:testMode({status:confirmation.event_status,event_date:confirmation.event_date,created_at:confirmation.created_at})});
        const safeInvoiceName=String(invoice.number||confirmation.album_id).replace(/[^a-zA-Z0-9_-]/g,'-');
        await mailer({to:confirmation.recipient,...message,attachments:[{name:`FinalSnap-Rechnung-${safeInvoiceName}.pdf`,content:invoicePdf.toString('base64')}]});
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
  function refreshRefundState(paymentId) {
    const payment=db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    const refunded=Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) amount FROM refunds WHERE payment_id=? AND status='succeeded'").get(paymentId).amount);
    if(refunded>=payment.amount_cents){
      db.prepare("UPDATE payments SET status='refunded',refunded_at=COALESCE(refunded_at,?) WHERE id=?").run(Date.now(),paymentId);
    }else if(refunded>0){
      db.prepare("UPDATE payments SET status='partially_refunded' WHERE id=? AND status!='disputed'").run(paymentId);
    }else{
      db.prepare("UPDATE payments SET status='paid',refunded_at=NULL WHERE id=? AND status IN ('refunded','partially_refunded','disputed_lost')").run(paymentId);
      db.prepare("UPDATE events SET status='paid' WHERE id=? AND status='refunded'").run(payment.event_id);
    }
    return refunded;
  }
  function fulfill(notification) {
    const object=notification.data.object,type=notification.type;
    if(notification.livemode!==false||object.livemode===true)throw new Error('Live-Webhook gesperrt');
    if(db.prepare('SELECT 1 FROM webhook_receipts WHERE id=?').get(notification.id))return false;
    const checkoutTypes=new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired']);
    if(!checkoutTypes.has(type)&&!relevantPaymentEvents.has(type)){db.prepare('INSERT INTO webhook_receipts VALUES (?,?)').run(notification.id,Date.now());return false;}
    let payment;
    if(checkoutTypes.has(type))payment=db.prepare('SELECT p.* FROM payments p LEFT JOIN payment_attempts a ON a.payment_id=p.id WHERE p.stripe_session_id=? OR a.stripe_session_id=? LIMIT 1').get(object.id,object.id);
    else payment=paymentForStripeObject(object);
    if(!payment)throw new Error(`Unbekanntes Zahlungsereignis ${type}; Webhook erneut zustellen`);
    let alert=paymentAlertEvents.has(type);
    db.transaction(()=>{
      const now=Date.now();
      db.prepare('INSERT INTO webhook_receipts VALUES (?,?)').run(notification.id,now);
      const attempt=db.prepare('SELECT * FROM payment_attempts WHERE stripe_session_id=?').get(object.id);
      if(checkoutTypes.has(type)){
        const metadata=object.metadata||{};
        const consentMatches=(metadata.customerType||'consumer')===payment.customer_type&&(metadata.earlyStartRequest||'false')===String(!!payment.early_start_requested_at)&&(metadata.earlyStartAcknowledged||'false')===String(!!payment.early_start_acknowledged_at)&&(metadata.termsAccepted||'false')===String(!!payment.terms_accepted_at)&&(metadata.termsVersion||'')===(payment.terms_version||'');
        if(object.currency!=='eur'||object.amount_total!==payment.amount_cents||object.mode!=='payment'||metadata.paymentId!==payment.id||metadata.eventId!==payment.event_id||!consentMatches)throw new Error('Zahlungsdaten stimmen nicht überein');
        if(attempt)db.prepare('UPDATE payment_attempts SET status=?,updated_at=? WHERE id=?').run(type==='checkout.session.expired'?'expired':type==='checkout.session.async_payment_failed'?'failed':object.payment_status==='paid'?'paid':'complete',now,attempt.id);
        if(object.payment_intent){const pi=typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent.id;db.prepare('UPDATE payments SET stripe_payment_intent_id=? WHERE id=?').run(pi,payment.id);}
        if(object.invoice||object.customer){const invoice=typeof object.invoice==='string'?object.invoice:object.invoice?.id;const customer=typeof object.customer==='string'?object.customer:object.customer?.id;db.prepare('UPDATE payments SET stripe_invoice_id=COALESCE(?,stripe_invoice_id),stripe_customer_id=COALESCE(?,stripe_customer_id) WHERE id=?').run(invoice,customer,payment.id);}
        if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(type)&&object.payment_status==='paid'&&payment.status==='pending'){
          const e=lookup(payment.event_id);
          if(['pending','trial'].includes(e.status)&&!e.deleted_at){const eventEnd=e.event_date?eventDeadline(e.event_date):e.expires_at||now+payment.months*30*86400000;db.prepare("UPDATE events SET status='paid',expires_at=? WHERE id=?").run(eventEnd,e.id);db.prepare("UPDATE payments SET status='paid',paid_at=COALESCE(paid_at,?) WHERE id=?").run(now,payment.id);db.prepare("INSERT OR IGNORE INTO contract_confirmations (payment_id,recipient,status,attempts,created_at) VALUES (?,?,'pending',0,?)").run(payment.id,e.email,now);}
        }
      }else if(type.startsWith('refund.')||type==='charge.refunded'){
        const refund=type==='charge.refunded'?null:object;
        const amount=Number(refund?.amount??object.amount_refunded??0),refundStatus=type==='refund.failed'?'failed':refund?.status==='succeeded'||type==='charge.refunded'?'succeeded':'pending';
        if(refund){
          const known=db.prepare('SELECT * FROM refunds WHERE stripe_refund_id=?').get(refund.id)||db.prepare('SELECT * FROM refunds WHERE id=?').get(refund.metadata?.decisionId||'');
          if(known)db.prepare('UPDATE refunds SET stripe_refund_id=COALESCE(stripe_refund_id,?),status=?,updated_at=? WHERE id=?').run(refund.id,refundStatus,now,known.id);
          else db.prepare("INSERT INTO refunds (id,payment_id,stripe_refund_id,amount_cents,reason,decision_note,actor_email,status,created_at,updated_at) VALUES (?,?,?,?,'stripe','Von Stripe gemeldet','Stripe',?,?,?)").run(crypto.randomUUID(),payment.id,refund.id,amount,refundStatus,now,now);
        }else if(object.refunded){db.prepare("UPDATE refunds SET status='succeeded',updated_at=? WHERE payment_id=? AND status IN ('submitted','pending')").run(now,payment.id);}
        refreshRefundState(payment.id);
        alert=true;
      }else if(type.startsWith('charge.dispute.')){
        if(type==='charge.dispute.created'||type==='charge.dispute.updated'||type==='charge.dispute.funds_withdrawn')db.prepare("UPDATE payments SET status='disputed' WHERE id=? AND status NOT IN ('refunded','disputed_lost')").run(payment.id);
        if(type==='charge.dispute.closed'){
          if(['won','warning_closed'].includes(object.status)){db.prepare("UPDATE payments SET status='paid' WHERE id=? AND status IN ('disputed','disputed_lost')").run(payment.id);db.prepare("UPDATE events SET status='paid' WHERE id=? AND status='refunded'").run(payment.event_id);refreshRefundState(payment.id);}
          else if(object.status==='lost'){db.prepare("UPDATE payments SET status='disputed_lost',refunded_at=? WHERE id=?").run(now,payment.id);db.prepare("UPDATE events SET status='refunded' WHERE id=? AND status='paid'").run(payment.event_id);}
        }
        if(type==='charge.dispute.funds_reinstated'){db.prepare("UPDATE payments SET status='paid',refunded_at=NULL WHERE id=? AND status='disputed_lost'").run(payment.id);db.prepare("UPDATE events SET status='paid' WHERE id=? AND status='refunded'").run(payment.event_id);refreshRefundState(payment.id);}
        alert=true;
      }
      const safeDetails={objectId:object.id,status:object.status||object.payment_status||null,reason:object.reason||null,amount:object.amount??object.amount_refunded??object.amount_total??null,currency:object.currency||null,paymentIntent:typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id||null,charge:typeof object.charge==='string'?object.charge:object.charge?.id||null};
      const eventId=auditPaymentEvent({stripeEventId:notification.id,paymentId:payment.id,source:'stripe',eventType:type,status:object.status||object.payment_status||'received',amountCents:safeDetails.amount,details:safeDetails});
      if(alert&&!db.prepare('SELECT 1 FROM payment_alerts WHERE event_id=?').get(eventId))db.prepare("INSERT INTO payment_alerts (event_id,status,attempts,created_at) VALUES (?,'pending',0,?)").run(eventId,now);
    })();
    return true;
  }
  app.post('/api/stripe/webhook', express.raw({type:'application/json',limit:'1mb'}),async(req,res)=>{
    if (!stripe || !cfg.STRIPE_WEBHOOK_SECRET) return fail(res,503,'Stripe noch nicht eingerichtet.');
    let event;
    try { event = stripe.webhooks.constructEvent(req.body,req.headers['stripe-signature'],cfg.STRIPE_WEBHOOK_SECRET); }
    catch { return fail(res,400,'Ungültige Webhook-Signatur.'); }
    try { fulfill(event); await flushContractConfirmations(); await flushWithdrawalConfirmations(); await flushPaymentAlerts(); res.json({received:true}); }
    catch(err) { console.error('Webhook:',err.message); fail(res,500,'Zahlungsbestätigung konnte nicht verarbeitet werden.'); }
  });
  app.use(express.json({limit:'32kb'}));
  app.use((req,res,next)=>{
    const match = /(?:^|;\s*)event_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    if(match) {
      const session = db.prepare('SELECT s.*, u.email, u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>?').get(hash(match[1]),Date.now());
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
    const disk=fs.statfsSync(root);
    const diskFreeBytes=Number(disk.bavail)*Number(disk.bsize);
    const diskTotalBytes=Number(disk.blocks)*Number(disk.bsize);
    const uploadDisk={freeBytes:diskFreeBytes,totalBytes:diskTotalBytes,warning:diskFreeBytes<uploadDiskWarningThreshold(diskTotalBytes),uploadsPaused:diskFreeBytes<MIN_UPLOAD_FREE_BYTES,minimumFreeBytes:MIN_UPLOAD_FREE_BYTES};
    if (photoStorage.mode === 's3') {
      const usedBytes = Number(db.prepare('SELECT COALESCE(SUM(bytes),0) bytes FROM photos').get().bytes);
      const freeBytes = Math.max(0, storageLimit - usedBytes);
      const warning=freeBytes<200*MiB||uploadDisk.warning;
      return res.json({freeBytes,totalBytes:storageLimit,usedBytes,warning,uploadsPaused:freeBytes<100*MiB||uploadDisk.uploadsPaused,location:'object-storage',uploadDisk});
    }
    res.json({freeBytes:diskFreeBytes,totalBytes:diskTotalBytes,usedBytes:diskTotalBytes-diskFreeBytes,warning:uploadDisk.warning,uploadsPaused:uploadDisk.uploadsPaused,location:'server-disk',uploadDisk});
  });
  app.get('/api/plans',(req,res)=>{const plan=PLANS.event;res.json({event:{...plan,photoLimit:null,storageLimitMB:Math.floor(Number(cfg.MAX_EVENT_BYTES||25*1024**3)/1024**2),storageLimitGB:Number((Number(cfg.MAX_EVENT_BYTES||25*1024**3)/1024**3).toFixed(1))}});});
  app.get('/api/events',loginRequired,(req,res)=>{
    const events=db.prepare(`SELECT e.*, COUNT(p.id) photoCount, COALESCE(SUM(p.bytes),0) storageBytes
      FROM events e LEFT JOIN photos p ON p.event_id=e.id
      WHERE e.owner_id=? AND e.deleted_at IS NULL GROUP BY e.id ORDER BY e.created_at DESC`).all(req.user.id);
    res.json({events:events.map(e=>{const payment=db.prepare('SELECT id,status,customer_type,paid_at,early_start_requested_at,early_start_acknowledged_at,terms_accepted_at,terms_version,stripe_invoice_id FROM payments WHERE event_id=?').get(e.id);const withdrawal=payment?db.prepare('SELECT submitted_at,status FROM withdrawal_confirmations WHERE payment_id=?').get(payment.id):null;return {...e,expires_at:e.event_date?retentionUntil(e):e.expires_at,storageLimitBytes:eventStorageLimit(e,cfg),photoLimit:eventPhotoLimit(e,cfg),checkoutStarted:!!payment,customerType:payment?.customer_type||null,paymentStatus:payment?.status||null,paymentConcludedAt:payment?.paid_at||null,withdrawalSubmittedAt:withdrawal?.submitted_at||null,withdrawalConfirmationStatus:withdrawal?.status||null,earlyStartRequested:!!payment?.early_start_requested_at,earlyStartAcknowledged:!!payment?.early_start_acknowledged_at,termsAccepted:!!payment?.terms_accepted_at,termsVersion:payment?.terms_version||null,hasInvoice:!!payment?.stripe_invoice_id,readOnly:!active(e)&&readable(e),retentionUntil:retentionUntil(e),startsAt:startAt(e),guestUrl:readable(e)?`${baseUrl.origin}/event/${e.id}?token=${e.guest_token}`:null};})});
  });
  app.post('/api/events/:eventId/withdrawal',loginRequired,owner,wrap(async(req,res)=>{
    const customerName=String(req.body.customerName||'').trim().replace(/\s+/g,' ');
    if(!customerName||customerName.length>160)return fail(res,400,'Bitte deinen vollständigen Namen angeben (höchstens 160 Zeichen).');
    if(req.body.emailConfirmed!==true)return fail(res,400,'Bitte bestätige die E-Mail-Adresse für die Eingangsbestätigung.');
    const payment=db.prepare('SELECT id,status,customer_type,paid_at FROM payments WHERE event_id=?').get(req.event.id);
    if(!payment||payment.customer_type!=='consumer'||!payment.paid_at)return fail(res,409,'Für dieses Album ist kein bezahlter Verbrauchervertrag vorhanden.');
    const statement=`Hiermit widerrufe ich, ${customerName}, den Vertrag über das FinalSnap-Fotoalbum „${req.event.title}“ (Album-ID ${req.event.id}).`;
    const now=Date.now();
    const inserted=db.prepare("INSERT OR IGNORE INTO withdrawal_confirmations (payment_id,customer_name,recipient,statement,submitted_at,status,attempts) VALUES (?,?,?,?,?,'pending',0)").run(payment.id,customerName,req.user.email,statement,now);
    if(inserted.changes){auditPaymentEvent({paymentId:payment.id,source:'customer',eventType:'customer.withdrawal.submitted',status:'received',actorEmail:req.user.email,note:'Elektronischer Widerruf eingegangen',details:{customerName,recipient:req.user.email,statement,submittedAt:now}});}
    const confirmation=db.prepare('SELECT submitted_at FROM withdrawal_confirmations WHERE payment_id=?').get(payment.id);
    await flushWithdrawalConfirmations();
    await flushPaymentAlerts();
    const result=db.prepare('SELECT status,attempts,submitted_at FROM withdrawal_confirmations WHERE payment_id=?').get(payment.id);
    res.status(202).json({received:true,submittedAt:confirmation.submitted_at,confirmationStatus:result.status,email:req.user.email,attempts:result.attempts,message:result.status==='sent'?'Widerruf eingegangen. Die Eingangsbestätigung wurde per E-Mail versandt.':'Widerruf eingegangen und gespeichert. Die E-Mail-Eingangsbestätigung wird erneut versucht.'});
  }));
  app.get('/api/event/:eventId/invoice',loginRequired,owner,wrap(async(req,res)=>{
    const payment=db.prepare('SELECT stripe_invoice_id FROM payments WHERE event_id=?').get(req.event.id);
    if(!payment?.stripe_invoice_id||!stripe?.invoices?.retrieve)return fail(res,404,'Für dieses Album ist noch kein Stripe-Beleg verfügbar.');
    let invoice;
    try{invoice=await stripe.invoices.retrieve(payment.stripe_invoice_id);}catch(error){console.error('Stripe-Beleg konnte nicht geladen werden:',String(error.message||error));return fail(res,502,'Der Beleg ist gerade nicht erreichbar. Bitte später erneut versuchen.');}
    const url=invoice.invoice_pdf||invoice.hosted_invoice_url;
    if(!url)return fail(res,409,'Stripe erstellt den Beleg noch. Bitte später erneut versuchen.');
    let parsed;try{parsed=new URL(url);}catch{return fail(res,502,'Stripe hat keinen gültigen Beleg-Link geliefert.');}
    if(parsed.protocol!=='https:')return fail(res,502,'Stripe hat keinen sicheren Beleg-Link geliefert.');
    res.redirect(302,parsed.href);
  }));
  app.post('/api/events',loginRequired,(req,res)=>{
    const id=String(req.body.eventId||''); const plan=PLANS.event; const title=String(req.body.title||'').trim(),eventDate=String(req.body.eventDate||'');
    if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(id) || !title || title.length>120 || !validEventDate(eventDate)) return fail(res,400,'Bitte Event-ID, Titel und ein Veranstaltungsdatum innerhalb der nächsten 24 Monate angeben.');
    if(lookup(id) || fs.existsSync(path.join(root,id))) return fail(res,409,'Event-ID bereits vergeben, auch für Bestandsdaten.');
    // During the test-only phase each newly created event can use the 25-photo
    // trial. Checkout remains a Stripe test checkout and can never charge live.
    const trial=req.body.trial!==false;
    const expiresAt=eventDeadline(eventDate);
    db.prepare('INSERT INTO events (id,email,plan,amount_cents,status,created_at,owner_id,title,event_date,guest_token,moderation,guestbook_moderation,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,req.user.email,'event',plan.priceCents,'pending',Date.now(),req.user.id,title,eventDate,random(),req.body.moderation===true?1:0,req.body.guestbookModeration===false?0:1,expiresAt);
    if(trial)db.prepare("UPDATE events SET status='trial', trial_used=1 WHERE id=?").run(id);
    res.status(201).json({eventId:id,trial:!!trial,eventDate});
  });
  app.get('/api/event/:eventId/availability',(req,res)=>res.json({available:/^[a-z0-9][a-z0-9_-]{2,63}$/.test(req.params.eventId)&&!lookup(req.params.eventId)&&!fs.existsSync(path.join(root,req.params.eventId))}));
  function owner(req,res,next) { const e=lookup(req.params.eventId); if(!own(req,e)) return fail(res,404,'Event nicht gefunden.'); req.event=e; next(); }
  function paymentAdminRequired(req,res,next) {
    if(!req.user)return fail(res,401,'Bitte anmelden.');
    const user=db.prepare('SELECT email_verified_at FROM users WHERE id=?').get(req.user.id);
    if(!user?.email_verified_at||!paymentAdminEmails.has(String(req.user.email||'').toLowerCase()))return fail(res,403,'Kein Zugriff auf die Zahlungsverwaltung.');
    next();
  }
  app.get('/ops/payments',paymentAdminRequired,(req,res)=>res.sendFile(path.join(__dirname,'public','payments-admin.html')));
  app.get('/ops/backups',paymentAdminRequired,(req,res)=>res.sendFile(path.join(__dirname,'public','backups-admin.html')));
  app.get('/api/admin/backups',paymentAdminRequired,(req,res)=>{
    const cutoff=Date.now()-7*86400000;
    const queued=db.prepare('SELECT COUNT(*) count,MIN(created_at) oldest FROM backup_photo_deletes').get();
    res.json({configuration:backupService.status(),retention:{databaseDays:30,photosAfterAlbumDeletionDays:7},recentRuns:db.prepare('SELECT id,started_at,completed_at,status,db_object_key,photo_objects,photo_bytes,error FROM backup_runs ORDER BY started_at DESC LIMIT 20').all(),queuedPhotoDeletes:Number(queued.count||0),oldestQueuedPhotoDeleteAt:queued.oldest||null,staleQueuedPhotoDeletes:Number(queued.oldest&&queued.oldest<cutoff?queued.count:0)});
  });
  app.get('/api/admin/payments',paymentAdminRequired,(req,res)=>{
    const payments=db.prepare('SELECT p.*,e.title,e.email,e.status album_status,e.event_date FROM payments p JOIN events e ON e.id=p.event_id ORDER BY p.rowid DESC LIMIT 100').all();
    res.json({payments:payments.map(payment=>({...payment,
      refunded_cents:Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) amount FROM refunds WHERE payment_id=? AND status='succeeded'").get(payment.id).amount),
      attempts:db.prepare('SELECT id,attempt_no,status,created_at,updated_at FROM payment_attempts WHERE payment_id=? ORDER BY attempt_no DESC').all(payment.id),
      refunds:db.prepare('SELECT id,stripe_refund_id,amount_cents,reason,decision_note,actor_email,status,created_at,updated_at FROM refunds WHERE payment_id=? ORDER BY created_at DESC').all(payment.id),
      events:db.prepare('SELECT e.event_type,e.status,e.amount_cents,e.actor_email,e.note,e.details_json,e.created_at,a.status alert_status,a.attempts alert_attempts,a.last_error alert_error FROM payment_events e LEFT JOIN payment_alerts a ON a.event_id=e.id WHERE e.payment_id=? ORDER BY e.created_at DESC LIMIT 30').all(payment.id).map(event=>({...event,details:JSON.parse(event.details_json||'{}')}))
    }))});
  });
  app.post('/api/admin/payments/:paymentId/refunds',paymentAdminRequired,wrap(async(req,res)=>{
    const payment=db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.paymentId);
    if(!payment)return fail(res,404,'Zahlung nicht gefunden.');
    if(!stripe||!payment.stripe_payment_intent_id)return fail(res,409,'Für diese Zahlung ist keine erstattungsfähige Stripe-Zahlungsreferenz vorhanden.');
    if(!['paid','partially_refunded'].includes(payment.status))return fail(res,409,'Diese Zahlung kann aktuell nicht manuell erstattet werden.');
    const reason=String(req.body?.reason||'requested_by_customer');
    if(!['duplicate','fraudulent','requested_by_customer'].includes(reason))return fail(res,400,'Bitte einen gültigen Erstattungsgrund wählen.');
    const note=String(req.body?.note||'').trim();
    if(note.length<20||note.length>2000)return fail(res,400,'Bitte die Entscheidung mit mindestens 20 Zeichen dokumentieren.');
    const already=Number(db.prepare("SELECT COALESCE(SUM(amount_cents),0) amount FROM refunds WHERE payment_id=? AND status IN ('requested','submitted','pending','succeeded')").get(payment.id).amount);
    const remaining=Math.max(0,payment.amount_cents-already);
    const amount=req.body?.amountCents===undefined?remaining:Number(req.body.amountCents);
    if(!Number.isSafeInteger(amount)||amount<=0||amount>remaining)return fail(res,400,'Der Erstattungsbetrag überschreitet den noch offenen Betrag.');
    const refundId=crypto.randomUUID(),now=Date.now();
    db.prepare("INSERT INTO refunds (id,payment_id,amount_cents,reason,decision_note,actor_email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'requested',?,?)").run(refundId,payment.id,amount,reason,note,req.user.email,now,now);
    auditPaymentEvent({paymentId:payment.id,source:'manual',eventType:'manual.refund.requested',status:'requested',amountCents:amount,actorEmail:req.user.email,note,details:{refundId,reason}});
    try{
      const refund=await stripe.refunds.create({payment_intent:payment.stripe_payment_intent_id,amount,reason,metadata:{paymentId:payment.id,decisionId:refundId}},{idempotencyKey:`finalsnap-refund-${refundId}`});
      if(refund.livemode!==false)throw new Error('Live-Erstattung gesperrt');
      const status=refund.status==='succeeded'?'succeeded':refund.status==='failed'?'failed':'pending';
      db.prepare('UPDATE refunds SET stripe_refund_id=?,status=?,updated_at=? WHERE id=?').run(refund.id,status,Date.now(),refundId);
      auditPaymentEvent({paymentId:payment.id,source:'manual',eventType:`manual.refund.${status}`,status,amountCents:amount,actorEmail:req.user.email,note,details:{refundId,stripeRefundId:refund.id,reason}});
      refreshRefundState(payment.id);
      await flushPaymentAlerts();
      return res.status(202).json({id:refundId,refundId,status,amountCents:amount});
    }catch(error){
      const message=String(error.message||error).slice(0,300);
      const definitiveFailure=['StripeInvalidRequestError','StripeAuthenticationError','StripePermissionError','StripeCardError'].includes(error.type)||error.code==='resource_missing';
      const refundStatus=definitiveFailure?'failed':'submitted';
      db.prepare('UPDATE refunds SET status=?,updated_at=? WHERE id=?').run(refundStatus,Date.now(),refundId);
      auditPaymentEvent({paymentId:payment.id,source:'manual',eventType:definitiveFailure?'manual.refund.failed':'manual.refund.uncertain',status:refundStatus,amountCents:amount,actorEmail:req.user.email,note,details:{refundId,error:message}});
      await flushPaymentAlerts();
      console.error('Erstattung fehlgeschlagen:',message);
      if(!definitiveFailure)return res.status(202).json({id:refundId,refundId,status:refundStatus,amountCents:amount,message:'Stripe hat den Status nicht eindeutig bestätigt. Der Vorgang ist gegen eine doppelte Erstattung gesperrt; bitte den Stripe-Testmodus prüfen.'});
      return fail(res,502,'Stripe konnte die Erstattung nicht bestätigen. Bitte Zahlungsstatus in Stripe prüfen, bevor du es erneut versuchst.');
    }
  }));
  app.post('/api/checkout',loginRequired,wrap(async(req,res)=>{
    const e=lookup(String(req.body.eventId||''));
    if(!own(req,e))return fail(res,404,'Event nicht gefunden.');
    if(!['pending','trial'].includes(e.status)||e.deleted_at||(e.status==='trial'&&!active(e)))return fail(res,409,'Dieses Event kann nicht bezahlt werden.');
    if(!stripe||!cfg.STRIPE_WEBHOOK_SECRET)return fail(res,503,'Stripe-Testmodus noch nicht eingerichtet.');
    if(req.body.termsAccepted!==true)return fail(res,400,'Bitte bestätige vor dem Checkout die Leistungsbedingungen.');
    const customerType=['consumer','business'].includes(req.body.customerType)?req.body.customerType:'consumer';
    const earlyStartNeeded=customerType==='consumer'&&!!e.event_date&&startAt(e)<Date.now()+14*86400000;
    if(earlyStartNeeded&&(req.body.earlyStartRequest!==true||req.body.earlyStartAcknowledged!==true))return fail(res,400,'Bitte bestätige den möglichen vorzeitigen Leistungsbeginn und die Hinweise zum Widerruf.');
    const earlyStartRequestedAt=earlyStartNeeded?Date.now():null;
    const earlyStartAcknowledgedAt=earlyStartNeeded?earlyStartRequestedAt:null;
    if(req.body.plan!==undefined){const plan=PLANS[req.body.plan];if(!plan)return fail(res,400,'Bitte ein gültiges Paket wählen.');if(req.body.plan!==e.plan)return fail(res,409,'Das Paket und der Preis für dieses Album sind bereits festgelegt.');}
    let payment=db.prepare('SELECT * FROM payments WHERE event_id=?').get(e.id);
    if(!payment){const plan=PLANS.event;db.prepare('INSERT INTO payments (id,event_id,amount_cents,months) VALUES (?,?,?,?)').run(crypto.randomUUID(),e.id,plan.priceCents,plan.months);payment=db.prepare('SELECT * FROM payments WHERE event_id=?').get(e.id);}
    if(['refunded','disputed','disputed_lost'].includes(payment.status))return fail(res,409,'Für diese Zahlung ist aktuell kein neuer Checkout möglich. Bitte kontaktiere den Support.');
    let attempt=db.prepare('SELECT * FROM payment_attempts WHERE payment_id=? ORDER BY attempt_no DESC LIMIT 1').get(payment.id);
    let session=null;
    if(attempt&&attempt.status==='open'&&!attempt.stripe_session_id.startsWith('creating_')){
      try{session=await stripe.checkout.sessions.retrieve(attempt.stripe_session_id);}catch(error){if(error.code!=='resource_missing')throw error;db.prepare("UPDATE payment_attempts SET status='expired',updated_at=? WHERE id=?").run(Date.now(),attempt.id);attempt=null;}
      if(session&&session.livemode!==false)throw new Error('Live-Checkout gesperrt');
      if(session?.status==='open'&&session.amount_total===PLANS.event.priceCents&&payment.amount_cents===PLANS.event.priceCents&&session.metadata?.customerType===customerType&&session.metadata?.earlyStartRequest===String(earlyStartNeeded))return res.json({url:session.url||`${baseUrl.origin}/success?session_id=${session.id}`,attempt:attempt.attempt_no});
      if(session?.status==='open'){
        await stripe.checkout.sessions.expire(session.id);
        db.prepare("UPDATE payment_attempts SET status='expired',updated_at=? WHERE id=?").run(Date.now(),attempt.id);
        attempt=null;
      }
      if(session?.status==='expired')db.prepare("UPDATE payment_attempts SET status='expired',updated_at=? WHERE id=?").run(Date.now(),attempt.id);
      else if(session?.status==='complete'&&session.payment_status!=='paid')return fail(res,409,'Die Zahlung wird noch verarbeitet. Bitte aktualisiere die Seite in Kürze.');
      else if(session?.payment_status==='paid')return fail(res,409,'Die Zahlung ist bereits eingegangen. Bitte lade dein Album neu.');
      if(session?.status==='complete')db.prepare("UPDATE payment_attempts SET status='failed',updated_at=? WHERE id=?").run(Date.now(),attempt.id);
      if(session?.status==='expired'||session?.status==='complete')attempt=null;
    }
    if(payment.status==='pending'&&(payment.amount_cents!==PLANS.event.priceCents||e.amount_cents!==PLANS.event.priceCents)){
      const canonicalPrice=PLANS.event.priceCents;
      db.transaction(()=>{
        db.prepare('UPDATE payments SET amount_cents=? WHERE id=? AND status=\'pending\'').run(canonicalPrice,payment.id);
        db.prepare('UPDATE events SET amount_cents=? WHERE id=? AND status IN (\'pending\',\'trial\')').run(canonicalPrice,e.id);
      })();
      payment.amount_cents=canonicalPrice;
    }
    if(!attempt||!['open','creating'].includes(attempt.status)){
      const attemptNo=Number(db.prepare('SELECT COALESCE(MAX(attempt_no),0)+1 n FROM payment_attempts WHERE payment_id=?').get(payment.id).n);
      const id=crypto.randomUUID(),placeholder=`creating_${id}`;
      db.prepare("INSERT INTO payment_attempts (id,payment_id,stripe_session_id,attempt_no,status,created_at,updated_at) VALUES (?,?,?,?, 'creating',?,?)").run(id,payment.id,placeholder,attemptNo,Date.now(),Date.now());
      attempt=db.prepare('SELECT * FROM payment_attempts WHERE id=?').get(id);
    }
    const taxEnabled=String(cfg.STRIPE_TAX_ENABLED||'0')==='1';
    const priceData={currency:'eur',unit_amount:payment.amount_cents,tax_behavior:'inclusive',product_data:{name:PLANS.event.label}};
    const productTaxCode=String(cfg.STRIPE_PRODUCT_TAX_CODE||'').trim();
    if(taxEnabled&&!productTaxCode)return fail(res,503,'Die Steuerkategorie für den Test-Checkout ist noch nicht eingerichtet.');
    if(taxEnabled)priceData.product_data.tax_code=productTaxCode;
    const checkoutAmount=(payment.amount_cents/100).toFixed(2).replace('.',',');
    const taxDescription=taxEnabled?'inkl. 19 % deutscher USt.':'Steuer ist in diesem Testlauf nicht aktiviert';
    const params={
      mode:'payment',
      integration_identifier:`finalsnap-${Array.from(crypto.randomBytes(8),value=>String.fromCharCode(97+value%26)).join('')}`,
      locale:'de',
      submit_type:'pay',
      customer_email:e.email,
      customer_creation:'always',
      billing_address_collection:'required',
      tax_id_collection:{enabled:true},
      name_collection:{individual:{enabled:true},business:{enabled:true,optional:true}},
      invoice_creation:{enabled:true},
      line_items:[{price_data:priceData,quantity:1}],
      custom_text:{submit:{message:`TESTBETRIEB – Es wird kein echtes Geld eingezogen. Gesamtbetrag: ${checkoutAmount} € (${taxDescription}). Testalbum: höchstens 250 MB. Anbieter: Matthias Wendland Fotografie (Einzelunternehmen), Gütersloh.`}},
      metadata:{eventId:e.id,paymentId:payment.id,attemptId:attempt.id,customerType,earlyStartRequest:String(earlyStartNeeded),earlyStartAcknowledged:String(earlyStartNeeded),termsAccepted:'true',termsVersion:TERMS_VERSION},
      success_url:`${baseUrl.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${baseUrl.origin}/dashboard`
    };
    if(taxEnabled){
      params.automatic_tax={enabled:true};
    }
    try{session=await stripe.checkout.sessions.create(params,{idempotencyKey:`finalsnap-checkout-${attempt.id}`});}
    catch(error){console.error('Stripe-Testcheckout fehlgeschlagen:',error.type||error.code||'Stripe-Fehler');return fail(res,502,'Der Test-Checkout konnte gerade nicht geöffnet werden. Es wurde keine Zahlung bestätigt. Bitte versuche es erneut.');}
    if(session.livemode!==false){console.error('Checkout mit Live-Modus abgewiesen.');return fail(res,503,'Der Checkout wurde aus Sicherheitsgründen blockiert. FinalSnap akzeptiert derzeit nur Stripe-Testzahlungen.');}
    const now=Date.now();
    db.transaction(()=>{
      db.prepare('UPDATE payments SET customer_type=?,early_start_requested_at=?,early_start_acknowledged_at=?,terms_accepted_at=?,terms_version=? WHERE id=?').run(customerType,earlyStartRequestedAt,earlyStartAcknowledgedAt,now,TERMS_VERSION,payment.id);
      db.prepare("UPDATE payment_attempts SET stripe_session_id=?,status='open',updated_at=? WHERE id=?").run(session.id,now,attempt.id);
      db.prepare('UPDATE payments SET stripe_session_id=? WHERE id=?').run(session.id,payment.id);
      db.prepare('UPDATE events SET stripe_session_id=? WHERE id=?').run(session.id,e.id);
    })();
    res.json({url:session.url||`${baseUrl.origin}/success?session_id=${session.id}`,attempt:attempt.attempt_no});
  }));
  app.get('/api/checkout/:sessionId',loginRequired,(req,res)=>{
    const e=db.prepare('SELECT e.* FROM events e JOIN payments p ON p.event_id=e.id LEFT JOIN payment_attempts a ON a.payment_id=p.id WHERE e.stripe_session_id=? OR p.stripe_session_id=? OR a.stripe_session_id=? LIMIT 1').get(req.params.sessionId,req.params.sessionId,req.params.sessionId);
    if(!own(req,e))return fail(res,404,'Bestellung nicht gefunden.');
    const payment=db.prepare('SELECT * FROM payments WHERE event_id=?').get(e.id);
    const attempt=db.prepare('SELECT status FROM payment_attempts WHERE stripe_session_id=?').get(req.params.sessionId);
    const status=['refunded','disputed_lost'].includes(payment?.status)?'refunded':payment?.status==='disputed'?'disputed':['expired','failed'].includes(attempt?.status)?'retry_available':payment?.status==='paid'?'paid':e.status;
    res.json({eventId:e.id,status,retryAvailable:status==='retry_available',expiresAt:e.event_date?retentionUntil(e):e.expires_at});
  });
  function access(req,res,next) {
    const e=lookup(req.params.eventId);
    if(!readable(e)) return fail(res,402,'Album und Downloadzeitraum sind abgelaufen.');
    if(!own(req,e)) {
      const token=req.query.token || req.headers['x-event-token'];
      if(typeof token!=='string' || !e.guest_token || Buffer.byteLength(token)!==Buffer.byteLength(e.guest_token) || !crypto.timingSafeEqual(Buffer.from(token),Buffer.from(e.guest_token))) return fail(res,403,'Gültiger Veranstaltungslink erforderlich.');
      const cookieName=`finalsnap_guest_${e.id}`;
      const escapedName=cookieName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const match=new RegExp(`(?:^|;\\s*)${escapedName}=([a-f0-9]{64})(?:;|$)`).exec(req.headers.cookie||'');
      let guestToken=match?.[1];
      if(!guestToken) {
        guestToken=random();
        res.cookie(cookieName,guestToken,{httpOnly:true,secure:baseUrl.protocol==='https:',sameSite:'lax',maxAge:Math.max(0,Math.min(500*86400000,retentionUntil(e)-Date.now())),path:'/'});
      }
      req.guestTokenHash=hash(guestToken);
    }
    req.event=e; next();
  }
  app.get('/api/event/:eventId/design',loginRequired,owner,(req,res)=>{
    if(!readable(req.event))return fail(res,402,'Für dieses Event ist noch kein Gästezugang verfügbar.');
    res.json({event:{id:req.event.id,title:req.event.title,eventDate:req.event.event_date},design:publicDesign(req.event)});
  });
  app.patch('/api/event/:eventId/design',loginRequired,owner,(req,res)=>{
    if(!readable(req.event))return fail(res,402,'Für dieses Event ist noch kein Gästezugang verfügbar.');
    const value=req.body?.design;
    if(!value||typeof value!=='object'||Array.isArray(value))return fail(res,400,'Bitte ein gültiges Design senden.');
    const title=String(value.title||'').trim();
    const occasion=String(value.occasion||'');
    const theme=String(value.theme||'');
    const accent=String(value.accent||'');
    const font=String(value.font||'');
    if(!title||title.length>80||!['wedding','birthday','summer','company','jubilee','graduation','other'].includes(occasion)||!['afterglow','midnight','garden'].includes(theme)||!/^#[0-9a-f]{6}$/i.test(accent)||!['classic','palatino','modern','verdana','relaxed','typewriter'].includes(font))return fail(res,400,'Bitte prüfe Titel, Anlass, Vorlage, Farbe und Schrift.');
    const design={...readDesign(req.event),title,occasion,theme,accent,font};
    db.prepare('UPDATE events SET design_json=? WHERE id=?').run(JSON.stringify(design),req.event.id);
    res.json({success:true,design:publicDesign(lookup(req.event.id))});
  });
  app.patch('/api/event/:eventId',loginRequired,owner,(req,res)=>{
    const updates=[];
    if(req.body.eventDate!==undefined) {
      if(startAt(req.event)<=Date.now())return fail(res,409,'Das Veranstaltungsdatum kann nach Beginn der Sammlung nicht mehr geändert werden.');
      if(!validEventDate(req.body.eventDate))return fail(res,400,'Bitte ein gültiges Veranstaltungsdatum innerhalb der nächsten 24 Monate angeben.');
      updates.push(['event_date',req.body.eventDate]);updates.push(['expires_at',eventDeadline(req.body.eventDate)]);
    }
    if(typeof req.body.moderation==='boolean')updates.push(['moderation',req.body.moderation?1:0]);
    if(typeof req.body.guestbookModeration==='boolean')updates.push(['guestbook_moderation',req.body.guestbookModeration?1:0]);
    if(!updates.length)return fail(res,400,'Mindestens eine gültige Freigabeeinstellung ist erforderlich.');
    for(const [column,value] of updates)db.prepare(`UPDATE events SET ${column}=? WHERE id=?`).run(value,req.event.id);
    res.json({success:true});
  });
  app.post('/api/event/:eventId/rotate-token',loginRequired,owner,(req,res)=>{db.prepare('UPDATE events SET guest_token=? WHERE id=?').run(random(),req.event.id);res.json({success:true});});
  app.get('/api/event/:eventId/qr',loginRequired,owner,wrap(async(req,res)=>{
    if(!readable(req.event)) return fail(res,402,'Album und Downloadzeitraum sind abgelaufen.');
    const url=`${baseUrl.origin}/event/${req.event.id}?token=${req.event.guest_token}`;
    res.type('png').attachment(`${req.event.id}-qr.png`).send(await QRCode.toBuffer(url,{width:1200,margin:4,errorCorrectionLevel:'M'}));
  }));
  // Disk staging bounds RAM usage. Re-encoding validates content and strips EXIF/GPS.
  const temp=path.join(root,'.tmp');fs.mkdirSync(temp,{recursive:true});
  const upload=multer({dest:temp,limits:{fileSize:MAX_UPLOAD_FILE_BYTES,files:10,fields:0,parts:10}}).array('photos',10);
  const designCoverUpload=multer({dest:temp,limits:{fileSize:8*1024*1024,files:1,fields:0,parts:1}}).single('cover');
  app.get('/api/event/:eventId/design-cover',access,wrap(async(req,res)=>{
    const filename=readDesign(req.event).coverFilename;
    if(typeof filename!=='string'||!/^design-[a-z0-9-]+\.jpg$/.test(filename))return fail(res,404,'Kein Titelmotiv vorhanden.');
    res.type('jpeg').set('Cache-Control','private, no-store');
    if(photoStorage.mode==='local')return res.sendFile(path.join(root,req.event.id,filename));
    const stream=await photoStorage.getStream(req.event.id,filename);
    stream.on('error',()=>res.destroy());stream.pipe(res);
  }));
  app.post('/api/event/:eventId/design-cover',loginRequired,owner,uploadLimit,(req,res,next)=>designCoverUpload(req,res,err=>err?next(err):next()),wrap(async(req,res)=>{
    if(!readable(req.event))return fail(res,402,'Für dieses Event ist noch kein Gästezugang verfügbar.');
    if(!req.file)return fail(res,400,'Bitte wähle ein Titelmotiv aus.');
    const processed=path.join(temp,`${random()}.jpg`);
    const filename=`design-${crypto.randomUUID()}.jpg`;
    let stored=false;
    try {
      await sharp(req.file.path).rotate().resize(2000,2000,{fit:'inside',withoutEnlargement:true}).jpeg({quality:84,mozjpeg:true}).toFile(processed);
      if(photoStorage.mode==='local') {
        const eventDirectory=path.join(root,req.event.id);
        await fs.promises.mkdir(eventDirectory,{recursive:true});
        await fs.promises.copyFile(processed,path.join(eventDirectory,filename));
      } else await photoStorage.put(req.event.id,filename,processed);
      stored=true;
      const previous=readDesign(req.event).coverFilename;
      const next={...readDesign(req.event),coverFilename:filename};
      db.prepare('UPDATE events SET design_json=? WHERE id=?').run(JSON.stringify(next),req.event.id);
      if(typeof previous==='string'&&/^design-[a-z0-9-]+\.jpg$/.test(previous)){await photoStorage.deletePhoto(req.event.id,previous);await backupService.deletePhoto(req.event.id,previous);}
      res.json({success:true,design:publicDesign(lookup(req.event.id))});
    } catch(error) {
      if(stored)try{await photoStorage.deletePhoto(req.event.id,filename);await backupService.deletePhoto(req.event.id,filename);}catch(cleanupError){console.error('Designmotiv konnte nicht aufgeräumt werden:',cleanupError.message);}
      throw error;
    } finally {
      fs.rmSync(req.file.path,{force:true});
      fs.rmSync(processed,{force:true});
    }
  }));
  const busy=new Set();
  let remoteStorageReservedBytes=0;
  app.post('/api/event/:eventId/upload',uploadLimit,access,(req,res,next)=>{
    if(req.event.owner_id && deletingUsers.has(req.event.owner_id)) return fail(res,409,'Das Konto wird gerade gelöscht. Uploads sind gesperrt.');
    if(!active(req.event)) return fail(res,402,'Der Albumzeitraum ist beendet. Fotos können noch während der Downloadphase angesehen und heruntergeladen werden.');
    if(busy.has(req.event.id)) return fail(res,429,'Upload läuft bereits. Bitte kurz warten.');
    const capacity=uploadCapacity.acquire();
    if(!capacity.ok){
      if(capacity.reason==='concurrency')res.set('Retry-After','60');
      return fail(res,capacity.reason==='disk'?503:429,capacity.reason==='disk'?'Der temporäre Uploadspeicher ist gerade stark belegt. Bitte in einigen Minuten erneut versuchen.':'Der Fotospeicher verarbeitet gerade andere Uploads. Bitte in einer Minute erneut versuchen.');
    }
    busy.add(req.event.id);
    upload(req,res,async err=>{
      const written=[];
      try {
        if(err) throw err;
        const disk=fs.statfsSync(root);if(Number(disk.bavail)*Number(disk.bsize)<100*1024**2)throw new Error('Fotospeicher vorübergehend ausgelastet. Bitte den Veranstalter informieren.');
        if(!req.files?.length) return fail(res,400,'Keine Fotos empfangen.');
        const dir=photoStorage.mode==='local'?path.join(root,req.event.id):temp;if(photoStorage.mode==='local')fs.mkdirSync(dir,{recursive:true});
        const total=db.prepare('SELECT COUNT(*) count, COALESCE(SUM(bytes),0) bytes FROM photos WHERE event_id=?').get(req.event.id);
        const photoLimit=eventPhotoLimit(req.event),storageLimit=eventStorageLimit(req.event,cfg);
        if(photoLimit!==null&&total.count+req.files.length>photoLimit) throw new Error('Die 25 kostenlosen Testfotos sind genutzt. Nach bestätigter Buchung gilt das Eventpaket ab dem Veranstaltungsdatum.');
        let bytes=total.bytes;
        for(const file of req.files) {
          const image=sharp(file.path,{limitInputPixels:40000000,animated:false});
          const meta=await image.metadata();
          if(!['jpeg','png','webp','heif'].includes(meta.format)) throw new Error('Nur JPEG, PNG, WebP und unterstützte HEIF-Bilder erlaubt.');
          const id=crypto.randomUUID(), filename=`${id}.jpg`, dest=path.join(dir,filename);
          written.push({id,filename,dest});
          await image.rotate().resize({width:2560,height:2560,fit:'inside',withoutEnlargement:true}).jpeg({quality:82,mozjpeg:true}).toFile(dest);
          const size=fs.statSync(dest).size;if(size>MAX_UPLOAD_FILE_BYTES)throw new Error('Dieses Foto ist nach der Verarbeitung zu groß. Bitte eine kleinere Datei hochladen.');bytes+=size;written[written.length-1].bytes=size;
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
      } catch(error) {db.prepare('UPDATE events SET upload_failures=upload_failures+1 WHERE id=?').run(req.event.id);for(const f of written){try{if(photoStorage.mode==='s3'){await photoStorage.deletePhoto(req.event.id,f.filename);await backupService.deletePhoto(req.event.id,f.filename);}else fs.rmSync(f.dest,{force:true});}catch(cleanupError){console.error('Upload-Aufräumen fehlgeschlagen:',cleanupError.message);}}if(error.code==='PHOTO_STORAGE_UNAVAILABLE')console.error('Hetzner Object Storage:',error.cause?.message||error.message);fail(res,error.code==='PHOTO_STORAGE_UNAVAILABLE'?503:400,error.message);}
      finally {for(const f of req.files||[]) fs.rmSync(f.path,{force:true});if(photoStorage.mode==='s3')for(const f of written)fs.rmSync(f.dest,{force:true});busy.delete(req.event.id);capacity.release();}
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
    await photoStorage.deletePhoto(req.event.id,p.filename);await backupService.deletePhoto(req.event.id,p.filename);db.prepare('DELETE FROM photos WHERE id=?').run(p.id);res.json({success:true});
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
    await backupService.deleteEvent(e.id);
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
        if(!payment?.stripe_session_id||['paid','partially_refunded','refunded','disputed','disputed_lost'].includes(payment.status)) continue;
        if(!stripe) return fail(res,503,'Ein offener Zahlungs-Checkout kann gerade nicht geprüft werden. Bitte später erneut versuchen.');
        const session=await stripe.checkout.sessions.retrieve(payment.stripe_session_id);
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
    const expired=db.prepare("SELECT * FROM events WHERE owner_id IS NOT NULL AND deleted_at IS NULL AND status IN ('paid','trial','pilot','refunded') ").all().filter(e=>retentionUntil(e)<=Date.now());
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
  app.get('/widerruf',(req,res)=>res.sendFile(path.join(pub,'widerruf.html')));
  app.get('/bedingungen',(req,res)=>res.sendFile(path.join(pub,'bedingungen.html')));
  app.get('/register',(req,res)=>req.user?res.redirect(['event','1m','3m','6m'].includes(req.query.plan)?`/dashboard?plan=${encodeURIComponent(req.query.plan)}`:'/dashboard'):res.sendFile(path.join(pub,'login.html')));
  app.get('/login',(req,res)=>res.sendFile(path.join(pub,'login.html')));
  app.get('/dashboard',(req,res)=>req.user?res.sendFile(path.join(pub,'dashboard.html')):res.redirect('/login'));
  app.get('/success',(req,res)=>req.user?res.sendFile(path.join(pub,'success.html')):res.redirect('/login'));
  app.locals.paymentAlertTimer=setInterval(()=>{flushPaymentAlerts().catch(error=>console.error('Zahlungsalarme konnten nicht verarbeitet werden:',error.message));flushContractConfirmations().catch(error=>console.error('Vertragsbestätigungen konnten nicht verarbeitet werden:',error.message));flushWithdrawalConfirmations().catch(error=>console.error('Widerrufsbestätigungen konnten nicht verarbeitet werden:',error.message));},60000);app.locals.paymentAlertTimer.unref();
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
  // Only intended public assets; source code and generic HTML routes cannot bypass guards.
  for(const file of ['style.css','design-editor.css','design-editor.js','upload.js','slideshow.js','guest-access.js','account.js','verify-email.js','password-recovery.js','games.js','guestbook.js','payments-admin.js','backups-admin.js','landing.js','success.js','gallery-init.js','admin.js','johanna-bastian.png','photographer.webp','event-wedding.jpg','event-birthday.jpg','event-summer.jpg','event-company.jpg']) app.get(`/${file}`,(req,res)=>res.sendFile(path.join(pub,file)));
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
  app.locals.db=db;app.locals.cleanup=cleanup;app.locals.fulfill=fulfill;app.locals.flushPaymentAlerts=flushPaymentAlerts;app.locals.flushContractConfirmations=flushContractConfirmations;app.locals.flushWithdrawalConfirmations=flushWithdrawalConfirmations;app.locals.photoStorage=photoStorage;app.locals.backupService=backupService;app.locals.operationsMonitor=operationsMonitor;
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
