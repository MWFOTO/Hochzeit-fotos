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
      amount_cents INTEGER NOT NULL, months INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending');
    CREATE TABLE IF NOT EXISTS webhook_receipts (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
  const columns = new Set(db.prepare('PRAGMA table_info(events)').all().map(x => x.name));
  for (const [name, type] of Object.entries({owner_id:'TEXT REFERENCES users(id)', title:"TEXT NOT NULL DEFAULT 'Veranstaltung'", guest_token:'TEXT', moderation:'INTEGER NOT NULL DEFAULT 1', deleted_at:'INTEGER', trial_used:'INTEGER NOT NULL DEFAULT 0', upload_successes:'INTEGER NOT NULL DEFAULT 0', upload_failures:'INTEGER NOT NULL DEFAULT 0'})) {
    if (!columns.has(name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS photos_event ON photos(event_id); CREATE INDEX IF NOT EXISTS events_owner ON events(owner_id); CREATE UNIQUE INDEX IF NOT EXISTS payments_event ON payments(event_id);');
  return db;
}
module.exports = { openDatabase };
