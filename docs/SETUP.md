# Einrichtung und sicherer Umzug

## Stripe lokal testen

1. Stripe-Sandbox/Testmodus nutzen. Secret ausschließlich in `.env` oder als
   Server-Umgebungsvariable hinterlegen: `STRIPE_SECRET_KEY=sk_test_…`.
   Kein Schlüssel im Browser, Repository oder Chat.
2. Stripe CLI anmelden und lokal weiterleiten:

   ```bash
   stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded --forward-to localhost:3000/api/stripe/webhook
   ```

3. Den angezeigten `whsec_…` als `STRIPE_WEBHOOK_SECRET` setzen und Server neu starten.
4. Konto anlegen, Event erstellen und über Dashboard Checkout starten.
5. Stripe-Testkarte `4242 4242 4242 4242`, Zukunftsdatum und beliebige CVC benutzen.
   Keine echte Karte. Nach Webhook stehen Gästelink und QR-Code im Dashboard.
6. Webhook erneut senden: Ablaufdatum darf sich nicht verändern.
   Ohne Webhook bleibt das Event pending, auch auf der Erfolgsseite.
7. Generische `stripe trigger`-Sessions enthalten keine lokale Bestellung und
   können daher nicht zur Freischaltung dienen. Den wirklichen App-Checkout testen.

## Separater Testservice auf Render – erst nach Freigabe einrichten

Produktiven Service unverändert lassen. Kein Blueprint mit kostenpflichtigen
Ressourcen wird automatisch angelegt.

| Einstellung | Wert |
| --- | --- |
| Branch | development/phase-1-event-platform |
| Runtime | Node.js 22.13+ oder 24 |
| Build Command | npm ci |
| Start Command | npm start |
| Health Check (Liveness) | /health |
| NODE_ENV | production |
| BASE_URL | https://DEIN-TESTSERVICE.onrender.com |
| TRUST_PROXY | 1 (genau ein vertrauenswürdiger Proxy) |
| DB_PATH | /data/events.db |
| UPLOAD_DIR | /data/uploads |
| STRIPE_SECRET_KEY | sk_test_… als Secret |
| STRIPE_WEBHOOK_SECRET | whsec_… des Test-Webhooks als Secret |
| MAX_EVENT_PHOTOS | Nur für geschlossene Pilot-Events; im Verkaufspaket keine feste Fotoanzahl |
| MAX_EVENT_BYTES | 26843545600 als 25-GB-Ziel pro bezahltem Event; Hosting-Wert vor Verkauf prüfen |

Für SQLite und Bilder muss `/data` auf einer Persistent Disk liegen.
Nur Pfade auf dem gemounteten Datenträger sind dauerhaft. Free-Webservices haben
keine Persistent Disk; Bilder/SQLite gehen bei Neustart/Redeploy/Spin-down verloren.
Deshalb Free nur für wegwerfbare Tests, nicht für Kundendaten einsetzen.
Disk und Service können Kosten verursachen: erst nach ausdrücklicher Freigabe.
Ein einzelner Prozess/eine Instanz; kein Node-Cluster und keine horizontale Skalierung.
Datenträger ist während Build/Pre-deploy nicht verfügbar: Import dort nicht ausführen.
Zusätzlich prüft `/ready` Datenbank, Upload-Datenträger und Object Storage. Für externe Alarmierung `/ready` überwachen; eine solche Überwachung ist nicht automatisch eingerichtet.

## Zielbetrieb Deutschland: Render Frankfurt plus Hetzner Object Storage

Diese Zielumgebung ist vorbereitet, aber noch nicht erstellt oder bereitgestellt.
Der bestehende Render-Dienst in Ohio kann nicht in eine andere Region verschoben
werden. Für Deutschland muss ein neuer Render-Dienst in Frankfurt angelegt und die
Anwendungsdaten müssen dorthin migriert werden.

**Deutschland ist eine feste Standortvorgabe für den Produktivbetrieb.** Vor dem
Start müssen App, Datenbank, temporäre Uploads, Fotos, Sicherungen und relevante
Protokolle auf ausdrücklich in Deutschland gewählten Standorten liegen. Ein
EU-Standort in einem anderen Land genügt dafür nicht. Der aktuelle Render-Testdienst
liegt in Ohio (USA) und darf daher nicht als Produktivumgebung für Kundendaten
verwendet werden. Er bleibt bis zum geprüften Umzug ein bestehender Teststand.

| Einstellung | Wert |
| --- | --- |
| Git-Branch | `codex/germany-storage` |
| Hosting | Render, Region Frankfurt (Deutschland) |
| Öffentliche Adresse | `https://finalsnap.de` (mit automatischer `www`-Weiterleitung) |
| Instanzen | 1 (SQLite wird nicht horizontal geteilt) |
| Dauer-Volume-Mount | `/data` |
| DB_PATH | `/data/events.db` |
| UPLOAD_DIR | `/data/staging` (temporäre Uploads; die Fotos gehen in S3) |
| S3_BUCKET | privater Hetzner-Bucket in Nürnberg oder Falkenstein |
| S3_ENDPOINT | `https://nbg1.your-objectstorage.com` oder `https://fsn1.your-objectstorage.com` |
| S3_REGION | passend zum Endpunkt: `nbg1` oder `fsn1` |
| S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY | nur als geheime Hosting-Variablen eintragen |
| S3_MAX_STORAGE_BYTES | 900 GiB standardmäßig; stoppt Uploads vor dem 1-TB-Speicherkontingent |

`render.yaml` beschreibt den neuen Dienst: Frankfurt, Starter-Plan, 10-GB-Datenträger,
`finalsnap.de`, `/health` und zunächst deaktivierte automatische Deploys. Render
stellt nach erfolgreicher DNS-Prüfung TLS bereit. Die DNS-Einträge müssen beim
Domainanbieter auf den neuen Render-Dienst zeigen; vorhandene Website-Einträge erst
ändern, wenn klar ist, dass `finalsnap.de` künftig FinalSnap ausliefern soll. Die
Blueprint-Datei legt
keinen Hetzner-Bucket an. Dafür zuerst einen privaten Bucket in `nbg1` oder `fsn1`
und Zugangsdaten erstellen; die S3-Werte sowie den Brevo-Schlüssel beim Einrichten
des Render-Blueprints als geheime Variablen setzen. Vor dem kostenpflichtigen
Blueprint-Sync den im Render-Dashboard angezeigten Gesamtpreis bestätigen.

Die App wird aus dem GitHub-Zweig auf Render bereitgestellt. Datenbank und
temporäre Uploads liegen auf einem dauerhaften Volume am deutschen Standort.
Fotoobjekte werden ausschließlich in einen deutschen Hetzner-Standort geschrieben.
Der Bucket bleibt privat; die App prüft Veranstaltungsstatus, Freigabe und Gastlink,
bevor sie ein Foto aus S3 ausliefert. Zugangsdaten kommen nie in Browsercode oder
Repository. Die alten lokalen Fotos werden durch einen wiederholbaren Kopierlauf
nach S3 kopiert; das Original wird dabei nicht gelöscht.

Der Kopierlauf ist standardmäßig eine Vorschau:

```bash
npm run migrate:photos-to-s3
```

Erst mit `--apply` kopiert er die in der Datenbank erfassten Fotos. Vor dem
endgültigen Umschalten muss der Kopierlauf nach einer kurzen Upload-Pause erneut
ausgeführt werden, damit neue Fotos seit dem ersten Lauf ebenfalls enthalten sind.
Fotos ohne Datenbankeintrag werden nicht automatisch übernommen; solche Altordner
müssen vorher geprüft und zugeordnet werden.

Nach dem gebuchten Albumzeitraum beginnt eine 90-tägige Downloadphase. In dieser
Zeit bleiben Galerie, Diashow und Downloads erreichbar; neue Uploads sind gesperrt.
Danach löscht der Anwendungsprozess die Fotos und ihre Datenbankeinträge stündlich
und beim Start. Der private Hetzner-Bucket erhält keine pauschale S3-Löschfrist,
die ein noch gültiges Album vorzeitig entfernen könnte. Backups der SQLite-Datenbank,
Provider-Logs und deren eigene Aufbewahrungsfristen müssen vor dem Produktivbetrieb
separat eingerichtet und geprüft werden.

Der Hetzner-Grundpreis enthält 1 TB Speicher und ein Kontingent für ausgehenden
Traffic; die Anwendung begrenzt den Speicher standardmäßig auf 900 GiB. Das ist keine
Traffic-Sperre. Bei sehr großen Downloads kann zusätzlicher Egress berechnet
werden. Die aktuellen Tarife sind vor der Bestellung zu prüfen.

Render bietet Frankfurt als Region. Der neue Dienst und der Hetzner-Bucket müssen
jeweils ausdrücklich in Deutschland angelegt werden. Für Hetzner kommen
Nürnberg (`nbg1`) oder Falkenstein (`fsn1`) infrage, Helsinki nicht. Das erfüllt
die Standortvorgabe für App, Upload-Verarbeitung und dauerhafte Fotospeicherung;
die vorhandene Ohio-Instanz erfüllt sie nicht. Das belegt aber nicht automatisch
den Standort aller weiteren Dienste. Brevo dokumentiert Datenverarbeitung innerhalb
der EU, mit Speicherung unter anderem in Belgien; das ist EU-, aber nicht
Deutschland-exklusiv. GitHub ist der Quellcode- und Build-Ausgangspunkt und Stripe
ist für spätere Livezahlungen vorgesehen. Ihre konkreten Datenflüsse und
Speicherorte müssen separat geklärt werden, bevor eine Aussage „alles liegt in
Deutschland“ getroffen wird. Solange die Vorgabe auch diese Anbieter umfasst,
bleiben sie für den Produktivbetrieb offen und dürfen nicht stillschweigend als
deutsch behandelt werden.

Im Stripe-Testmodus einen Webhook für
`https://DEIN-TESTSERVICE/api/stripe/webhook` anlegen:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`.
CLI- und Dashboard-Endpunkte besitzen unterschiedliche Webhook-Secrets.
BASE_URL muss exakt zur aufgerufenen HTTPS-Origin passen (CSRF/Herkunftsprüfung).
Keine CORS-Freigabe nötig. Der Anbieter darf nicht Querystrings mit Gasttokens in
öffentlichen Logs exportieren. HTTPS und Referrer-Policy werden berücksichtigt.

## Bestandsdaten erhalten

Vor irgendeinem Produktionswechsel zuerst feststellen: tatsächliche Render-
Startdatei, Git-Branch, DB_PATH, UPLOAD_DIR und gemounteter Datenträger.
Nicht annehmen, dass `db.js` bereits produktiv verwendet wird.

1. Vollständige Kopie der Upload-Verzeichnisse erstellen. SQLite über dessen
   Backup-API konsistent sichern; eine aktive `.db` ohne WAL darf nicht einfach
   allein kopiert werden. Backup zunächst lokal/isoliert prüfen.
2. Originalservice weiterlaufen lassen. Diese Version nur auf einer **Kopie**
   der Datenbank und Fotos starten. Die additive Migration ergänzt Tabellen
   und Spalten und erhält vorhandene Eventzeilen/Status/IDs.
3. Zielkunde registriert ein Konto. Betreiber prüft Eigentum und ggf. bestehende
   Zahlungsnachweise; E-Mail-Gleichheit allein beweist kein Eigentum.
4. Auf der Kopie nach expliziter Zuordnung ausführen (Variablen auf Kopie setzen):

   ```bash
   npm run import:legacy -- --event johanna-bastian --owner-email owner@example.com
   ```

   Standard ist Dry-run. Nach Prüfung:

   ```bash
   npm run import:legacy -- --event johanna-bastian --owner-email owner@example.com --apply
   ```

5. Vor Apply entsteht ein konsistentes SQLite-Backup neben der DB.
   Bestehende Fotos bleiben unverändert und werden zunächst **nicht freigegeben**.
   Im Dashboard kontrollieren und freigeben. Unbekannte Formate/Dateinamen stoppen
   den Import; Originale bleiben bestehen. Der Import ist wiederholbar.
6. Vorhandene bezahlte DB-Events behalten ihren Status und ihre Laufzeit.
   Reine Altordner ohne DB-Eintrag werden pending: keine automatische Gratis-
   Freischaltung. Zahlung über Test-Checkout; reale Bestandszahlungen vor einem
   späteren Produktivumzug gesondert verifizieren/migrieren.
7. Unzugeordnete Event-IDs/Ordner sind reserviert und gegen Übernahme geschützt.
   Sie werden automatisch weder zugeordnet noch gelöscht.
8. Alte Gästelinks benötigen künftig das neue Token. QR-Codes neu verteilen.
   Alte Dateiadressen/Dateinamen bleiben erhalten, benötigen aber Zugang/Freigabe.
   Fotoordnernamen außerhalb der erlaubten ID-Regel separat prüfen.

Produktive Datenübernahme, Umschalten des Hosting-Branches und Live-Schlüssel sind
nicht Teil der automatischen Schritte. Vor Umzug/Rollback Datenbankbackup und
Foto-Kopie bereitstellen; Code-Rollback allein macht Schemaänderungen nicht rückgängig.
Backups nach vereinbarter Frist löschen. Restore regelmäßig auf einer Kopie testen.

## Limits und Betrieb

20 MB pro Eingangsdatei, maximal 10 Dateien pro Request, maximal 40 Megapixel
beim Dekodieren. Disk-Staging begrenzt den RAM-Verbrauch; Upload-Requests werden
pro Event nacheinander zugelassen. Fotoanzahl und Bytes gelten für die neu
kodierten Dateien plus importierte Bestandsbilder. Erreichtes Limit stoppt den
kompletten Request; bereits geschriebene Dateien werden zurückgenommen.
Keine Video-/SVG-/GIF-Uploads. Neue Fotos als JPEG, hohe Qualität, Metadaten entfernt.

Speicher ist dennoch endlich: Disk-Auslastung überwachen, Gesamtzahl verkaufter
Events/parallel aktiver Gäste berücksichtigen, Limits passend festlegen.
Login/Registrierung 20 Versuche je IP/15 Minuten, Upload 20 Requests je IP/Minute.
Ein gemeinsames Veranstaltungs-WLAN kann das Upload-Limit erreichen;
vor realem Event unter Last testen und gegebenenfalls anpassen.

Auto-Löschung prüft zugeordnete bezahlte Events beim Start und stündlich. Abgelaufene
Events sind unabhängig vom Löschlauf sofort gesperrt. Kein Zusatz-Cron gebucht.
