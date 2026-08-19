/**
 * server.js
 * ---------------------------------------------------------
 * Minimaler Express-Server für die Event-Foto-App.
 *
 * Routen:
 *  GET  /event/:eventId             -> Upload-Seite für Gäste
 *  GET  /event/:eventId/slideshow   -> Vollbild-Diashow für den Beamer
 *  POST /api/event/:eventId/upload  -> Nimmt Fotos entgegen (multipart/form-data)
 *  GET  /api/event/:eventId/photos  -> Liefert Liste der Fotos (JSON), optional
 *                                       nur neuere via ?since=<timestamp in ms>
 *
 * Speicherung: Bilder landen lokal unter /uploads/<eventId>/...
 * (Für einen echten Betrieb später z.B. gegen S3 / Cloud-Storage austauschen.)
 * ---------------------------------------------------------
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver'); // zum Erstellen der ZIP-Datei mit allen Fotos

const app = express();
const PORT = process.env.PORT || 3000;

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

// Verhindert simple Path-Traversal-Angriffe über die Event-ID in der URL
function sanitizeEventId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}

// ---------------------------------------------------------
// Statische Dateien
// ---------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_ROOT));

// ---------------------------------------------------------
// Seiten-Routen
// ---------------------------------------------------------

// Upload-Seite für Gäste: /event/123
app.get('/event/:eventId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

// Diashow-Seite für den Beamer: /event/123/slideshow
app.get('/event/:eventId/slideshow', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'slideshow.html'));
});

// Kleine Verwaltungsseite für den Organisator (Download aller Fotos): /event/123/admin
// Achtung: bewusst ohne Login, wie der Rest der App. Diesen Link nur für dich behalten,
// nicht an die Gäste weitergeben.
app.get('/event/:eventId/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ---------------------------------------------------------
// API-Routen
// ---------------------------------------------------------

// Foto-Upload (ein oder mehrere Fotos gleichzeitig, Feldname "photos")
app.post('/api/event/:eventId/upload', (req, res) => {
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
app.get('/api/event/:eventId/photos', (req, res) => {
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
app.get('/api/event/:eventId/download', (req, res) => {
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
  console.log(`   Upload-Seite:  http://localhost:${PORT}/event/123`);
  console.log(`   Diashow:       http://localhost:${PORT}/event/123/slideshow\n`);
});
