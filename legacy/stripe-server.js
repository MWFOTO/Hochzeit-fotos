/**
 * server.js
 * ---------------------------------------------------------
 * Express-Server für die Event-Foto-App MIT Bezahlfunktion.
 *
 * Ablauf:
 *  1. Kunde besucht "/" (Landingpage), wählt Laufzeit + Event-ID, gibt E-Mail ein
 *  2. POST /api/checkout legt einen "pending" Event-Eintrag an und erzeugt eine
 *     Stripe-Checkout-Session, der Kunde wird zu Stripe weitergeleitet
 *  3. Nach erfolgreicher Zahlung sendet Stripe einen Webhook an
 *     POST /api/stripe/webhook -> Event wird als "paid" markiert, Ablaufdatum gesetzt
 *  4. Kunde landet auf /success -> sieht seine 4 Links (Upload/Diashow/Galerie/Admin)
 *  5. Alle Event-Routen prüfen per requireActiveEvent(), ob das Event bezahlt
 *     und noch nicht abgelaufen ist, bevor sie etwas anzeigen
 *
 * Speicherung: Bilder liegen lokal unter /uploads/<eventId>/...
 * Bezahlstatus liegt in einer SQLite-Datei (siehe db.js).
 * ---------------------------------------------------------
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const Stripe = require('stripe');
const db = require('./db.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe-Secret-Key aus einer Umgebungsvariable (NIEMALS im Code fest eintragen!)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || '');
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Basis-URL der App, für Stripe-Weiterleitungen nach Erfolg/Abbruch.
// Lokal: http://localhost:3000, auf Render z.B. https://deine-app.onrender.com
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ---------------------------------------------------------
// Preis-Konfiguration: hier lassen sich Preise/Laufzeiten einfach anpassen
// ---------------------------------------------------------
const PLANS = {
  '1m':  { label: '1 Monat',   months: 1,  priceCents: 1900 },
  '3m':  { label: '3 Monate',  months: 3,  priceCents: 2900 },
  '6m':  { label: '6 Monate',  months: 6,  priceCents: 3900 },
  '12m': { label: '12 Monate', months: 12, priceCents: 5900 }
};

// ---------------------------------------------------------
// Stripe-Webhook — WICHTIG: braucht die rohen (unverarbeiteten) Request-Daten,
// um die Signatur zu prüfen. Muss deshalb VOR express.json() stehen und
// bekommt sein eigenes express.raw() nur für diese eine Route.
// ---------------------------------------------------------
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;

  try {
    // Prüft, dass die Anfrage wirklich von Stripe kommt (Signatur-Check)
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook-Signatur ungültig:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const months = parseInt(session.metadata.months, 10);
    const ok = db.markEventPaid(session.id, months);
    if (!ok) {
      console.warn('Webhook: keine passende pending-Session gefunden für', session.id);
    } else {
      console.log(`✅ Zahlung bestätigt für Event "${session.metadata.eventId}" (${months} Monate)`);
    }
  }

  res.json({ received: true });
});

// Ab hier: normales JSON-Parsing für alle anderen Routen
app.use(express.json());

// Basis-Ordner, in dem alle Event-Uploads liegen.
// UPLOAD_DIR kann per Umgebungsvariable gesetzt werden (z.B. für einen
// dauerhaften Speicher-Ordner auf Render: UPLOAD_DIR=/data/uploads).
// Lokal ohne diese Variable wird einfach der Ordner "uploads" im Projekt genutzt.
const UPLOAD_ROOT = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT);
}

// ---------------------------------------------------------
// Multer-Konfiguration: Speicherort & Dateinamen
// ---------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const eventId = sanitizeEventId(req.params.eventId);
    const eventDir = path.join(UPLOAD_ROOT, eventId);
    if (!fs.existsSync(eventDir)) {
      fs.mkdirSync(eventDir, { recursive: true });
    }
    cb(null, eventDir);
  },
  filename: (req, file, cb) => {
    // Eindeutiger Dateiname: Zeitstempel + Zufallszahl, Original-Endung bleibt erhalten
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

// Nur Bilddateien akzeptieren, max. 20 MB pro Datei, max. 10 Dateien pro Request
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Nur Bilddateien sind erlaubt.'));
    }
  }
});

// Verhindert simple Path-Traversal-Angriffe über die Event-ID in der URL.
// Zusätzlich wird die ID klein geschrieben, damit z.B. "Johanna-Bastian" und
// "johanna-bastian" garantiert im selben Ordner landen (Gäste vertippen sich
// bei Groß-/Kleinschreibung erfahrungsgemäß leicht).
function sanitizeEventId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
}

// ---------------------------------------------------------
// Statische Dateien
// ---------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_ROOT));

// ---------------------------------------------------------
// Landingpage & Bezahl-Ablauf
// ---------------------------------------------------------

// Startseite: Preise, Event-ID wählen, zu Stripe weiterleiten
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// Liefert die Preis-Konfiguration an die Landingpage (damit Preise nur an
// einer Stelle im Code gepflegt werden müssen)
app.get('/api/plans', (req, res) => {
  res.json(PLANS);
});

// Prüft per Live-Eingabe, ob eine Event-ID noch frei ist (für die Landingpage)
app.get('/api/event/:eventId/availability', (req, res) => {
  const eventId = sanitizeEventId(req.params.eventId);
  res.json({ eventId, available: eventId.length >= 3 && db.isEventIdAvailable(eventId) });
});

// Erstellt eine Stripe-Checkout-Session und leitet den Kunden dorthin weiter
app.post('/api/checkout', async (req, res) => {
  const eventId = sanitizeEventId(req.body.eventId || '');
  const email = String(req.body.email || '').trim();
  const planKey = req.body.plan;
  const plan = PLANS[planKey];

  if (eventId.length < 3) {
    return res.status(400).json({ error: 'Die Event-ID muss mindestens 3 Zeichen haben.' });
  }
  if (!plan) {
    return res.status(400).json({ error: 'Ungültige Laufzeit ausgewählt.' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' });
  }
  if (!db.isEventIdAvailable(eventId)) {
    return res.status(409).json({ error: 'Diese Event-ID ist bereits vergeben. Bitte eine andere wählen.' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: 'eur',
          unit_amount: plan.priceCents,
          product_data: {
            name: `Event-Fotos: ${plan.label} Laufzeit`,
            description: `Event-ID: ${eventId}`
          }
        },
        quantity: 1
      }],
      metadata: { eventId, months: String(plan.months) },
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/`
    });

    // Vor der Weiterleitung schon als "pending" speichern, damit der Webhook
    // später etwas zum Aktualisieren findet.
    db.createPendingEvent({
      eventId,
      email,
      plan: planKey,
      amountCents: plan.priceCents,
      sessionId: session.id
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe-Fehler:', err.message);
    res.status(500).json({ error: 'Zahlung konnte nicht gestartet werden: ' + err.message });
  }
});

// Erfolgsseite nach der Zahlung
app.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'success.html'));
});

// Liefert die Event-Infos zur Erfolgsseite anhand der Stripe-Session-ID
app.get('/api/checkout/:sessionId', (req, res) => {
  const event = db.getEventBySessionId(req.params.sessionId);
  if (!event) {
    return res.status(404).json({ error: 'Bestellung nicht gefunden.' });
  }
  res.json({
    eventId: event.id,
    status: event.status,
    expiresAt: event.expires_at
  });
});

// ---------------------------------------------------------
// Zugriffsschutz: nur bezahlte, nicht abgelaufene Events sind erreichbar
// ---------------------------------------------------------
function requireActiveEvent(req, res, next) {
  const eventId = sanitizeEventId(req.params.eventId);
  if (!db.isEventActive(eventId)) {
    // API-Aufrufe (Pfad beginnt mit /api/) bekommen JSON, alle anderen die HTML-Hinweisseite
    if (req.path.startsWith('/api/')) {
      return res.status(402).json({ error: 'Dieses Event ist nicht aktiv (nicht bezahlt oder abgelaufen).' });
    }
    return res.status(402).sendFile(path.join(__dirname, 'public', 'inactive.html'));
  }
  next();
}

// ---------------------------------------------------------
// Seiten-Routen
// ---------------------------------------------------------

// Upload-Seite für Gäste: /event/123
app.get('/event/:eventId', requireActiveEvent, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

// Diashow-Seite für den Beamer: /event/123/slideshow
app.get('/event/:eventId/slideshow', requireActiveEvent, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'slideshow.html'));
});

// Kleine Verwaltungsseite für den Organisator (Download aller Fotos): /event/123/admin
// Achtung: bewusst ohne Login, wie der Rest der App. Diesen Link nur für dich behalten,
// nicht an die Gäste weitergeben.
app.get('/event/:eventId/admin', requireActiveEvent, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Galerie für Gäste: alle Fotos ansehen und einzeln oder als ZIP herunterladen
app.get('/event/:eventId/gallery', requireActiveEvent, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

// ---------------------------------------------------------
// API-Routen
// ---------------------------------------------------------

// Foto-Upload (ein oder mehrere Fotos gleichzeitig, Feldname "photos")
app.post('/api/event/:eventId/upload', requireActiveEvent, (req, res) => {
  upload.array('photos', 10)(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Keine Dateien empfangen.' });
    }
    res.json({ success: true, count: req.files.length });
  });
});

// Foto-Liste abrufen. Optional: ?since=<timestamp in ms>, liefert nur neuere Fotos
// -> wird von der Diashow per Polling genutzt, um neue Bilder zu erkennen.
app.get('/api/event/:eventId/photos', requireActiveEvent, (req, res) => {
  const eventId = sanitizeEventId(req.params.eventId);
  const eventDir = path.join(UPLOAD_ROOT, eventId);

  if (!fs.existsSync(eventDir)) {
    return res.json({ photos: [], serverTime: Date.now() });
  }

  const since = req.query.since ? parseInt(req.query.since, 10) : 0;

  const photos = fs.readdirSync(eventDir)
    .map((filename) => {
      const filePath = path.join(eventDir, filename);
      const stat = fs.statSync(filePath);
      return { filename, mtime: stat.mtimeMs };
    })
    .filter((f) => f.mtime > since)
    .sort((a, b) => a.mtime - b.mtime)
    .map((f) => ({
      url: `/uploads/${eventId}/${f.filename}`,
      timestamp: f.mtime
    }));

  res.json({ photos, serverTime: Date.now() });
});

// Alle Fotos eines Events als ZIP-Datei herunterladen
app.get('/api/event/:eventId/download', requireActiveEvent, (req, res) => {
  const eventId = sanitizeEventId(req.params.eventId);
  const eventDir = path.join(UPLOAD_ROOT, eventId);

  if (!fs.existsSync(eventDir) || fs.readdirSync(eventDir).length === 0) {
    return res.status(404).json({ error: 'Für dieses Event wurden noch keine Fotos hochgeladen.' });
  }

  res.attachment(`event-${eventId}-fotos.zip`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => {
    console.error(err);
    res.status(500).end();
  });

  // ZIP-Stream direkt an die Antwort weiterleiten (kein Zwischenspeichern nötig)
  archive.pipe(res);
  archive.directory(eventDir, false); // alle Dateien im Event-Ordner, ohne Unterordner-Struktur
  archive.finalize();
});

// ---------------------------------------------------------
// Zentrale Fehlerbehandlung
// ---------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Interner Serverfehler' });
});

// ---------------------------------------------------------
// Server starten
// ---------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n✅ Server läuft auf http://localhost:${PORT}`);
  console.log(`   Landingpage (Preise/Kauf): http://localhost:${PORT}/`);
  console.log(`   Test-Event nach Kauf z.B.: http://localhost:${PORT}/event/123\n`);
});
