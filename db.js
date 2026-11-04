// Additive migration: existing events and their IDs remain intact.
const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');
function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, email TEXT, plan TEXT, amount_cents INTEGER,
    stripe_session_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL, expires_at INTEGER);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id), filename TEXT NOT NULL,
      bytes INTEGER NOT NULL, approved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, UNIQUE(event_id, filename));
    CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id), stripe_session_id TEXT UNIQUE,
      amount_cents INTEGER NOT NULL, months INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      stripe_payment_intent_id TEXT, stripe_invoice_id TEXT, stripe_customer_id TEXT, refunded_at INTEGER);
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      stripe_session_id TEXT NOT NULL UNIQUE, attempt_no INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(payment_id,attempt_no));
    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      stripe_refund_id TEXT UNIQUE, amount_cents INTEGER NOT NULL,
      reason TEXT NOT NULL, decision_note TEXT NOT NULL, actor_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_events (
      id TEXT PRIMARY KEY, stripe_event_id TEXT UNIQUE, payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      source TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL,
      amount_cents INTEGER, actor_email TEXT, note TEXT, details_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_alerts (
      event_id TEXT PRIMARY KEY REFERENCES payment_events(id), status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER);
    CREATE TABLE IF NOT EXISTS backup_runs (
      id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, completed_at INTEGER,
      status TEXT NOT NULL, db_object_key TEXT, photo_objects INTEGER, photo_bytes INTEGER,
      error TEXT);
    CREATE TABLE IF NOT EXISTS backup_photo_deletes (
      event_id TEXT NOT NULL, filename TEXT NOT NULL, created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      PRIMARY KEY(event_id,filename));
    CREATE TABLE IF NOT EXISTS webhook_receipts (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
  const paymentColumns=new Set(db.prepare('PRAGMA table_info(payments)').all().map(x=>x.name));
  if(!paymentColumns.has('stripe_payment_intent_id'))db.exec('ALTER TABLE payments ADD COLUMN stripe_payment_intent_id TEXT');
  if(!paymentColumns.has('stripe_invoice_id'))db.exec('ALTER TABLE payments ADD COLUMN stripe_invoice_id TEXT');
  if(!paymentColumns.has('stripe_customer_id'))db.exec('ALTER TABLE payments ADD COLUMN stripe_customer_id TEXT');
  if(!paymentColumns.has('refunded_at'))db.exec('ALTER TABLE payments ADD COLUMN refunded_at INTEGER');
  db.prepare(`INSERT OR IGNORE INTO payment_attempts (id,payment_id,stripe_session_id,attempt_no,status,created_at,updated_at)
    SELECT 'legacy-'||p.id,p.id,p.stripe_session_id,1,CASE WHEN p.status='paid' THEN 'paid' ELSE 'open' END,e.created_at,e.created_at
    FROM payments p JOIN events e ON e.id=p.event_id WHERE p.stripe_session_id IS NOT NULL`).run();
  const columns = new Set(db.prepare('PRAGMA table_info(events)').all().map(x => x.name));
  for (const [name, type] of Object.entries({owner_id:'TEXT REFERENCES users(id)', title:"TEXT NOT NULL DEFAULT 'Veranstaltung'", event_date:'TEXT', guest_token:'TEXT', moderation:'INTEGER NOT NULL DEFAULT 1', guestbook_moderation:'INTEGER NOT NULL DEFAULT 1', deleted_at:'INTEGER', trial_used:'INTEGER NOT NULL DEFAULT 0', upload_successes:'INTEGER NOT NULL DEFAULT 0', upload_failures:'INTEGER NOT NULL DEFAULT 0', design_json:"TEXT NOT NULL DEFAULT '{}'"})) {
    if (!columns.has(name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`);
  }
  const userColumns=new Set(db.prepare('PRAGMA table_info(users)').all().map(x=>x.name));
  if(!userColumns.has('email_verified_at'))db.exec('ALTER TABLE users ADD COLUMN email_verified_at INTEGER');
  const photoColumns=new Set(db.prepare('PRAGMA table_info(photos)').all().map(x=>x.name));
  if(!photoColumns.has('uploader_token_hash'))db.exec('ALTER TABLE photos ADD COLUMN uploader_token_hash TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS guestbook_entries (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), guest_name TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS email_verifications (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);`);
  db.exec('CREATE INDEX IF NOT EXISTS photos_event ON photos(event_id); CREATE INDEX IF NOT EXISTS guestbook_event ON guestbook_entries(event_id,created_at); CREATE INDEX IF NOT EXISTS events_owner ON events(owner_id); CREATE UNIQUE INDEX IF NOT EXISTS payments_event ON payments(event_id); CREATE INDEX IF NOT EXISTS payment_attempts_payment ON payment_attempts(payment_id,attempt_no); CREATE INDEX IF NOT EXISTS payment_events_payment ON payment_events(payment_id,created_at); CREATE INDEX IF NOT EXISTS payment_alerts_status ON payment_alerts(status,created_at); CREATE INDEX IF NOT EXISTS backup_runs_status ON backup_runs(status,completed_at); CREATE INDEX IF NOT EXISTS backup_photo_deletes_created ON backup_photo_deletes(created_at);');
  return db;
}
module.exports = { openDatabase };
