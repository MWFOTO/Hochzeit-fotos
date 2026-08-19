# Event Photo Share — Prototyp

Minimalistische Foto-Sharing-App für Events. Gäste können ohne Login
über einen Link Fotos hochladen, die live in einer Beamer-Diashow erscheinen.

## Struktur

```
event-photo-share/
├── server.js           # Express-Server (Routen, Upload, API)
├── package.json
├── public/
│   ├── style.css        # gemeinsames Styling
│   ├── upload.html       # Upload-Seite für Gäste
│   ├── upload.js
│   ├── slideshow.html    # Diashow für den Beamer
│   └── slideshow.js
└── uploads/              # wird beim ersten Upload automatisch angelegt
    └── <eventId>/        # ein Unterordner pro Event
```

## Lokal starten

```bash
npm install
npm start
```

Der Server läuft danach auf **http://localhost:3000**.

- **Upload-Seite (Gäste, z. B. per QR-Code):**
  `http://localhost:3000/event/123`

- **Diashow (Beamer, im Vollbildmodus öffnen, z. B. F11 im Browser):**
  `http://localhost:3000/event/123/slideshow`

- **Admin (nur für dich – alle Fotos als ZIP herunterladen):**
  `http://localhost:3000/event/123/admin`
  Diese Seite hat kein Passwort, also den Link nicht an Gäste weitergeben.

Die `123` ist die Event-ID und frei wählbar — jede beliebige ID erzeugt
automatisch ihren eigenen, getrennten Fotoordner. So könnt ihr mehrere
Events parallel betreiben, z. B. `/event/hochzeit-anna-tom`.

## Wie es funktioniert

- **Upload:** Der Button öffnet über `<input type="file" accept="image/*"
  capture="environment" multiple>` auf dem Smartphone direkt die Kamera
  (Nutzer können aber auch zur Galerie wechseln). Die Auswahl wird sofort
  per `XMLHttpRequest` hochgeladen, inkl. Fortschrittsbalken.
- **Speicherung:** Bilder landen unverändert unter `uploads/<eventId>/`
  mit einem eindeutigen, generierten Dateinamen.
- **Diashow:** Fragt alle 4 Sekunden `GET /api/event/:id/photos?since=...`
  ab, um nur neu hinzugekommene Fotos zu holen, und blendet alle 5 Sekunden
  sanft zum nächsten Bild über. Kein Neuladen der Seite nötig.

## Deployment auf Render.com (öffentlich erreichbar)

1. Code über die GitHub-Weboberfläche (ohne Kommandozeile) in ein neues Repository hochladen
2. Auf render.com mit GitHub anmelden → "New +" → "Web Service" → Repo auswählen
3. Build Command: `npm install`, Start Command: `node server.js`
4. Für dauerhaften Speicher (empfohlen, damit beim "Aufwachen" des kostenlosen
   Plans keine Fotos verloren gehen): auf den Starter-Plan ($7/Monat) wechseln,
   unter "Disks" einen Persistent Disk mit Mount Path `/data` anlegen, und unter
   "Environment" die Variable `UPLOAD_DIR=/data/uploads` setzen.
5. Nach dem Event: über `/event/<id>/admin` alle Fotos als ZIP sichern, danach
   den Service löschen oder auf den kostenlosen Plan zurückstufen, um weitere
   Kosten zu vermeiden.

## Hinweise für den produktiven Einsatz

Dieser Code ist bewusst auf einen lokal testbaren Prototyp zugeschnitten.
Für den echten Einsatz solltet ihr zusätzlich bedenken:

- **Persistenter Speicher:** Lokale Ordner sind auf den meisten Hosting-
  Plattformen (Heroku, Vercel, …) *nicht* dauerhaft. Für den Produktivbetrieb
  Bilder z. B. in einem S3-Bucket / Cloud-Storage ablegen.
- **Bildkompression:** Aktuell werden Originalfotos direkt gespeichert.
  Für viele Gäste/Smartphones lohnt sich eine serverseitige Verkleinerung
  (z. B. mit `sharp`), um Speicher und Ladezeit zu sparen.
- **Moderation:** Es gibt aktuell keine Möglichkeit, unerwünschte Fotos aus
  der Diashow zu entfernen. Für den echten Betrieb wäre ein einfaches
  Admin-Panel mit Lösch-Funktion sinnvoll.
- **HTTPS:** Damit die Handy-Kamera zuverlässig über `capture="environment"`
  angesprochen werden kann, sollte die Seite live über HTTPS laufen
  (lokal per `http://localhost` ist das für Tests kein Problem).
