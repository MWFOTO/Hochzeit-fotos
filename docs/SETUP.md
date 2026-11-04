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

## Separater Testservice auf Render – nur falls später benötigt

Der aktuelle Dienst `finalsnap-deutschland` läuft in Frankfurt unter
`https://finalsnap.de`. Vor Änderungen immer Dienst-ID, Region und Branch prüfen;
der ältere Dienst in Ohio ist vom Deutschland-Dienst getrennt.

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

Nach erfolgreicher Stripe-Zahlung wird eine Vertragsbestätigung mit dem bei Bestellung geltenden Bedingungstext und der Widerrufsinformation an die Konto-E-Mail gestellt. Der Versand wird persistent wiederholt, bis er erfolgreich ist. Vor Verkaufsfreigabe im Stripe- und Brevo-Testbetrieb verifizieren, dass die Nachricht zugestellt wird und im Postfach gespeichert werden kann. Steuerberechnung/Rechnung über Stripe Tax separat testen; `STRIPE_TAX_ENABLED` bleibt aus, bis die deutsche Steuerregistrierung im Stripe-Testmodus eingerichtet und bestätigt wurde.

Die schrittweise Betreiber-Anleitung für Stripe Tax, Backup-Bucket und Testkäufe steht in [`OWNER-SETUP-BLOCKERS.md`](OWNER-SETUP-BLOCKERS.md).

## Zielbetrieb Deutschland: Render Frankfurt plus Hetzner Object Storage

Der deutsche Dienst `finalsnap-deutschland` ist unter `https://finalsnap.de` live.
Der ältere Dienst in Ohio ist getrennt und darf nicht für Kundendaten eingesetzt
werden. Vor jeder Änderung die Dienst-ID und Region im Render-Dashboard prüfen.

**Deutschland ist die Standortvorgabe für App und dauerhafte Kundendaten.** Die
App und SQLite laufen in Frankfurt; der konfigurierte Hetzner-Fotospeicher-Endpunkt
ist Nürnberg (`nbg1`). Damit ist nicht automatisch belegt, dass E-Mail, Zahlung,
Quellcode-Builds, Supportzugriffe und Backups ausschließlich in Deutschland
verarbeitet werden. Diese Anbieter- und Datenflüsse sind separat zu prüfen.

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
| S3_SSE_C_KEY | Base64-kodierter, zufälliger 32-Byte-Schlüssel; als Render-Secret und separat im Passwortmanager speichern |
| S3_MAX_STORAGE_BYTES | 900 GiB standardmäßig; stoppt Uploads vor dem 1-TB-Speicherkontingent |
| BACKUP_ENABLED | bleibt `0`, bis separater Backup-Bucket, Zugang, Versioning und Lifecycle-Regel geprüft sind |
| BACKUP_S3_BUCKET | privater Hetzner-Sicherungs-Bucket, getrennt vom Fotobucket und in Falkenstein (`fsn1`) |
| BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY | eigener Schlüssel mit Zugriff nur auf den Sicherungs-Bucket |
| BACKUP_S3_SSE_C_KEY | eigener Base64-kodierter 32-Byte-Schlüssel, separat vom Fotoschlüssel verwahren |

`render.yaml` beschreibt den neuen Dienst: Frankfurt, Starter-Plan, 10-GB-Datenträger,
`finalsnap.de`, `/health` und zunächst deaktivierte automatische Deploys. Render
stellt nach erfolgreicher DNS-Prüfung TLS bereit. Die DNS-Einträge müssen beim
Domainanbieter auf den neuen Render-Dienst zeigen; vorhandene Website-Einträge erst
ändern, wenn klar ist, dass `finalsnap.de` künftig FinalSnap ausliefern soll. Die
Blueprint-Datei legt
keinen Hetzner-Bucket an. Für Fotos zuerst einen privaten Bucket in `nbg1` oder `fsn1`
und Zugangsdaten erstellen; die S3-Werte sowie den Brevo-Schlüssel beim Einrichten
des Render-Blueprints als geheime Variablen setzen. Zusätzlich vor dem ersten
Deploy einen zufälligen 32-Byte-SSE-C-Schlüssel erzeugen und sowohl als
`S3_SSE_C_KEY` in Render als auch getrennt in einem Passwortmanager sichern.
Hetzner speichert diesen Schlüssel nicht; geht er verloren, lassen sich die
verschlüsselten Fotos nicht mehr lesen. Vor dem kostenpflichtigen Blueprint-Sync
den im Render-Dashboard angezeigten Gesamtpreis bestätigen.

Für Sicherungen einen weiteren privaten Bucket in der anderen deutschen Region
(`fsn1`, getrennt vom Fotospeicher) anlegen. Versioning muss aktiviert sein; eine
Lifecycle-Regel nur für `photos/` muss nicht aktuelle Versionen nach höchstens 7
Tagen löschen und aktive Versionen behalten. Einen eigenen beschränkten S3-Schlüssel
und separaten SSE-C-Schlüssel dafür erzeugen. Erst nach Prüfung im Hetzner-Dashboard
die Backup-Zugangsdaten in Render setzen und `BACKUP_ENABLED=1` aktivieren. Die App
prüft Versioning und die Foto-Lifecycle-Regel vor jedem Sicherungslauf; ohne passende
Einstellungen wird der Lauf als fehlgeschlagen protokolliert und nicht als Erfolg
gewertet. Datenbankkopien werden nach 30 Tagen aus dem Bucket entfernt.

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

Für Veranstaltungen mit Datum endet die gesamte Nutzung 90 Kalendertage nach
dem Veranstaltungsdatum (Mitternacht Europe/Berlin). Buchung und Zahlung vorab
verkürzen diese Frist nicht. Es gibt keine zusätzliche Downloadphase. Ab dem
Ablauf sind Upload, Galerie und Download gesperrt; der nächste stündliche Löschlauf
oder App-Start entfernt die Fotos und ihre Datenbankeinträge. Bereits vorhandene
datierte Alben werden ebenfalls auf diese Frist begrenzt. Kürzere explizite
Ablaufdaten bleiben wirksam. Undatierte Altalben behalten ihre bestehende Frist,
bis ein Veranstaltungsdatum geprüft und zugeordnet wurde. Der private Hetzner-Bucket erhält keine pauschale S3-Löschfrist,
die ein noch gültiges Album vorzeitig entfernen könnte. Backups der SQLite-Datenbank,
Provider-Logs und deren eigene Aufbewahrungsfristen müssen vor dem Produktivbetrieb
separat eingerichtet und geprüft werden.

Der Hetzner Object Storage hat ein gemeinsames Speicher- und Traffic-Kontingent;
die Anwendung begrenzt den Speicher standardmäßig auf 900 GiB. Das ist keine
Traffic-Sperre. Bei sehr großen Downloads kann zusätzlicher Egress berechnet
werden. Die aktuellen Tarife sind vor dem Verkauf zu prüfen.

Render und Hetzner sind auf deutsche Standorte konfiguriert: Frankfurt und
Nürnberg (`nbg1`). Für Hetzner kommen grundsätzlich
Nürnberg (`nbg1`) oder Falkenstein (`fsn1`) infrage, Helsinki nicht. Das erfüllt
die Standortvorgabe für App, Upload-Verarbeitung und dauerhafte Fotospeicherung;
der ältere Ohio-Dienst erfüllt sie nicht. Das belegt aber nicht automatisch
den Standort aller weiteren Dienste. Brevo dokumentiert Datenverarbeitung innerhalb
der EU, mit Speicherung unter anderem in Belgien; das ist EU-, aber nicht
Deutschland-exklusiv. GitHub ist der Quellcode- und Build-Ausgangspunkt und Stripe
ist für spätere Livezahlungen vorgesehen. Ihre konkreten Datenflüsse und
Speicherorte müssen separat geklärt werden, bevor eine Aussage „alles liegt in
Deutschland“ getroffen wird. Solange die Vorgabe auch diese Anbieter umfasst,
bleiben sie für den Produktivbetrieb offen und dürfen nicht stillschweigend als
deutsch behandelt werden.

Im Stripe-Testmodus einen Webhook für
`https://finalsnap.de/api/stripe/webhook` im Stripe-Testmodus anlegen:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`,
`charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
`charge.dispute.funds_reinstated`, `charge.dispute.funds_withdrawn`,
`invoice.finalized`, `invoice.finalization_failed`, `invoice.paid` und
`invoice.payment_failed`.
CLI- und Dashboard-Endpunkte besitzen unterschiedliche Webhook-Secrets.
BASE_URL muss exakt zur aufgerufenen HTTPS-Origin passen (CSRF/Herkunftsprüfung).
Keine CORS-Freigabe nötig. Der Anbieter darf nicht Querystrings mit Gasttokens in
öffentlichen Logs exportieren. HTTPS und Referrer-Policy werden berücksichtigt.

### Testmodus für Brutto-USt. und Belege

Im Stripe-Testmodus sind nun die Unternehmensadresse und die deutsche
Regelbesteuerungs-Registrierung eingetragen. Für die FinalSnap-Webapp ist
`txcd_10103000` (SaaS, persönliche Nutzung) als vorläufige Produktkategorie
gesetzt; sie wird im Testmodus für Deutschland geprüft. Vor Verkäufen außerhalb
Deutschlands oder einer Änderung des Produkts muss die Kategorie fachlich
bestätigt werden.

`STRIPE_TAX_ENABLED=1` aktiviert automatische Steuerberechnung. Der Checkout
blockiert mit einer verständlichen Meldung, falls
`STRIPE_PRODUCT_TAX_CODE` fehlt. Rechnungsanschrift, Steuer-ID-Abfrage,
Kunden-/Firmennamen und Stripe-Rechnung werden auch dann angefordert, wenn die
Steuerberechnung ausgeschaltet ist. Für echte Testkäufe im Render-Service beide
Variablen setzen und manuell deployen; Stripe muss in diesem Service weiterhin
im Testmodus laufen. Der Checkout wird
auf Deutsch mit einer Zahlungsschaltfläche vom Typ `pay` und einer
Bestellzusammenfassung mit Bruttopreis, Leistungsumfang, Dauer und Anbieter
angelegt. Die tatsächlich gerenderte Schaltfläche und Zusammenfassung müssen
trotzdem im Stripe-Testmodus visuell geprüft werden.

Im Testmodus je einen Kauf als Privatperson und mit deutscher USt-IdNr. durchführen; bei beiden
muss der Gesamtbetrag 49,90 € bleiben und die Rechnung die Steuer ausweisen.
Erst nach Prüfung der Rechnung-PDFs und Steuerangaben den Live-Steuersetup und
die Preislogik für den Verkauf vorbereiten.

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

## Zahlungsversuche, Erstattungen und Streitfälle

- Ein Album behält einen Zahlungsdatensatz. Nach Ablauf oder Fehlschlag eines
  Checkout-Versuchs erzeugt der nächste Klick einen neuen Checkout-Link; offene
  Links werden wiederverwendet, abgeschlossene Zahlungen nicht doppelt gestartet.
- Zahlungs-Admins erhalten über `PAYMENT_ADMIN_EMAILS` Zugriff auf
  `/ops/payments`. Dafür ist ein registriertes, per E-Mail bestätigtes Konto
  erforderlich. `PAYMENT_ALERT_EMAIL` erhält Refund- und Streitfallalarme;
  ohne diesen Wert wird die erste Admin-Adresse verwendet.
- Refunds werden manuell im internen Zahlungsbereich entschieden. Grund,
  Freitextbegründung, Betrag, Bearbeiter, Stripe-Status und Webhook-Verlauf
  bleiben im lokalen Zahlungsjournal erhalten. Stripe-Dashboard bleibt
  maßgeblich, falls der API-Aufruf in einen unklaren Status läuft.
- Policy: bestätigter Vollrefund beendet sofort Gäste- und Veranstalterzugang;
  die Fotos werden weiterhin spätestens zum ursprünglich ausgewiesenen
  Löschtermin entfernt. Teilrefunds ändern den Albumzugang nicht. Während eines
  offenen Kartenstreitfalls bleibt der Zugang bis zur Entscheidung bestehen;
  bei verlorenem Streitfall endet er, bei gewonnenem Streitfall bleibt er aktiv.
  Diese Vertragsregel muss in AGB/Widerrufsinformationen widerspruchsfrei erklärt
  und vor Livebetrieb rechtlich geprüft werden.
- Erforderliche Stripe-Test-Webhooks: `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`,
  `refund.created`, `refund.updated`, `refund.failed`, `charge.refunded`,
  `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`,
  `charge.dispute.funds_reinstated` und `charge.dispute.funds_withdrawn`.
- Webhook-Ereignisse werden idempotent gespeichert und Zahlungsalarme werden
  sofort per Brevo versandt. Nicht versandte Meldungen bleiben in einer
  ausstehenden Queue und werden minütlich erneut versucht.

20 MB pro Eingangs- und verarbeiteter Datei, maximal 10 Dateien pro Request,
maximal 40 Megapixel beim Dekodieren. Disk-Staging begrenzt den RAM-Verbrauch; global werden maximal
zwei Upload-Requests gleichzeitig zugelassen, pro Event nur einer. Bei weniger
als 2 GiB freiem Staging-Datenträger werden neue Requests vor Empfang der Dateien
abgewiesen. Fotoanzahl und Bytes gelten für die neu
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
