/**
 * db.js
 * ---------------------------------------------------------
 * Kleine SQLite-Datenbank, die verwaltet:
 * - welche Event-IDs es gibt
 * - ob sie bezahlt sind
 * - bis wann sie laufen (expires_at)
 *
 * SQLite speichert alles in einer einzigen Datei (events.db).
 * Für den Produktivbetrieb auf Render sollte diese Datei auf dem
 * Persistent Disk liegen (siehe DB_PATH unten), damit sie Neustarts
 * übersteht – genau wie der uploads-Ordner.
 * ---------------------------------------------------------
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// DB_PATH kann per Umgebungsvariable überschrieben werden, z.B.
// DB_PATH=/data/events.db, damit sie auf demselben Persistent Disk
// liegt wie die Fotos (UPLOAD_DIR=/data/uploads).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'events.db');

// Sicherstellen, dass der Ordner existiert, in dem die DB-Datei liegen soll
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Tabelle einmalig anlegen, falls sie noch nicht existiert
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    email TEXT,
    plan TEXT,
    amount_cents INTEGER,
    stripe_session_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' oder 'paid'
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  )
`);

/**
 * Legt einen "pending" (noch nicht bezahlten) Event-Eintrag an,
 * bevor der Nutzer zu Stripe weitergeleitet wird.
 * Falls die ID schon existiert und "pending" ist, wird sie überschrieben
 * (z.B. wenn jemand den Bezahlvorgang abbricht und es erneut versucht).
 */
function createPendingEvent({ eventId, email, plan, amountCents, sessionId }) {
  db.prepare(`
    INSERT INTO events (id, email, plan, amount_cents, stripe_session_id, status, created_at)
    VALUES (@id, @email, @plan, @amountCents, @sessionId, 'pending', @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      plan = excluded.plan,
      amount_cents = excluded.amount_cents,
      stripe_session_id = excluded.stripe_session_id,
      status = 'pending',
      created_at = excluded.created_at,
      expires_at = NULL
    WHERE events.status != 'paid' OR events.expires_at < @createdAt
  `).run({
    id: eventId,
    email,
    plan,
    amountCents,
    sessionId,
    createdAt: Date.now()
  });
}

/**
 * Markiert ein Event als bezahlt und setzt das Ablaufdatum,
 * basierend auf der Anzahl gebuchter Monate.
 * Wird vom Stripe-Webhook aufgerufen, sobald die Zahlung bestätigt ist.
 */
function markEventPaid(sessionId, months) {
  const now = Date.now();
  const expiresAt = now + months * 30 * 24 * 60 * 60 * 1000; // ca. 30 Tage pro Monat

  const result = db.prepare(`
    UPDATE events
    SET status = 'paid', expires_at = @expiresAt
    WHERE stripe_session_id = @sessionId
  `).run({ sessionId, expiresAt });

  return result.changes > 0;
}

/** Liefert den Event-Datensatz oder undefined, falls es ihn nicht gibt */
function getEvent(eventId) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
}

/** Liefert den Event-Datensatz anhand der Stripe-Session-ID (für die Erfolgsseite) */
function getEventBySessionId(sessionId) {
  return db.prepare('SELECT * FROM events WHERE stripe_session_id = ?').get(sessionId);
}

/** true, wenn das Event existiert, bezahlt ist und noch nicht abgelaufen ist */
function isEventActive(eventId) {
  const event = getEvent(eventId);
  if (!event) return false;
  if (event.status !== 'paid') return false;
  if (!event.expires_at || event.expires_at < Date.now()) return false;
  return true;
}

/** true, wenn diese ID noch frei ist (kein aktives, bezahltes Event) */
function isEventIdAvailable(eventId) {
  const event = getEvent(eventId);
  if (!event) return true;
  if (event.status === 'paid' && event.expires_at && event.expires_at > Date.now()) {
    return false; // aktiv bezahlt -> vergeben
  }
  return true; // pending oder abgelaufen -> darf neu vergeben/überschrieben werden
}

module.exports = {
  createPendingEvent,
  markEventPaid,
  getEvent,
  getEventBySessionId,
  isEventActive,
  isEventIdAvailable
};
