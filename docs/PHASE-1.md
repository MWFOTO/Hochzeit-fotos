# Technische Bestandsaufnahme und Umsetzung – 10.10.2026

Ausgangscommit: a247746. Lokaler Entwicklungsbranch: development/phase-1-event-platform.
Keine Änderung am produktiven Render-Service, kein Stripe-Kontozugriff, keine Zahlung.

## Befund im vollständigen Repository

- Einstieg `server.js`: funktionierender Express-Prototyp mit Gastupload, Foto-Liste,
  ZIP-Download, Galerie und Diashow. Keine Zahlungsprüfung, kein Login.
- `public/server.js`: zweiter Serverentwurf mit Stripe und Aktivitätsprüfung, nicht
  über das Root-Startskript gestartet. `require('./db.js')` würde hier eine fehlende
  Datei laden. Stripe und better-sqlite3 fehlten in den Root-Abhängigkeiten.
- Serverentwurf und abweichendes package.json lagen im öffentlich ausgelieferten
  Ordner. Sie wurden nach `legacy/` verschoben; der originale Root-Server liegt
  dort ebenfalls als Vergleich. Keine geheimen Schlüssel im analysierten Code.
- `db.js`: vorhandenes Event-Schema mit pending/paid und Ablaufdatum. Webhook
  verlängerte die Laufzeit bei Wiederholung und prüfte den Zahlungsstatus nicht.
- Upload akzeptierte allein den behaupteten MIME-Typ und die Original-Endung.
  Beliebige Event-IDs erzeugten Ordner. Dateizugriff umging Event-Sperren.
- Admin ohne Login; keine Freigabe, Löschung, Konten oder QR-Generierung.
- Frontend: XHR-Upload mit Fortschritt, Galerie mit Lightbox/ZIP, Diashow mit
  Polling und Tastatur. Hochzeitstexte, vorhandenes gemeinsames Styling und PNG.
- README beschrieb den alten Prototyp. Keine Tests, kein Lockfile, keine Migration.
- Repository enthält keine produktive SQLite-Datei und keine Gästefotos.
  Ihre Existenz und Speicherung auf Render konnten hier nicht überprüft werden.

## Konkreter Plan und Implementierungsstand

1. Separater Branch, additive Datenbankmigration, Originalstände archivieren: umgesetzt.
2. Kundenkonten, scrypt-Passwortschutz, persistente Sessions, CSRF/Herkunftsprüfung:
   umgesetzt. Session-Tokens liegen nur gehasht in SQLite; Cookie HttpOnly/SameSite.
3. Mehrere Events je Konto, strikt geprüfte eindeutige IDs, stabile Checkout-Bestellung:
   umgesetzt. Bestehende IDs werden niemals überschrieben oder wiedervergeben.
4. Stripe-Testmodus: Checkout, signierter Raw-Body-Webhook, Betrag/Währung/Metadaten,
   completed + async_payment_succeeded, idempotente Freischaltung: umgesetzt.
   Browser-Weiterleitung aktiviert kein Event. Schlüssel mit sk_live_ werden abgewiesen.
5. Zufällige Gastlinks, private Bildrouten, QR-PNG und druckbare Karte: umgesetzt.
6. Gastupload, Galerie, Diashow und ZIP erhalten. Moderation und Bildlöschung:
   umgesetzt. Moderation standardmäßig an; automatische Freigabe wählbar.
7. Upload auf Disk zwischenspeichern, wirklich dekodieren, als JPEG neu schreiben,
   EXIF/GPS entfernen, Foto-/Speicherlimits und Rate-Limits: umgesetzt.
8. Ablauf sofort sperren; Bilder im Stundenlauf und beim Start löschen: umgesetzt.
   Konservativer Bestandsimport mit Dry-run und Datenbankbackup: umgesetzt.
9. Lokale Integrationstests und Dependency-Audit: siehe TESTS.md.
10. Separaten Stripe-/Render-Test mit echten Testschlüsseln, Bestandskopie und
    Smartphone/Beamer durchführen: offen; benötigt Kontoeinrichtung bzw. Zugang.

## Architektur und bewusste Grenzen

Ein Node-Prozess, Express 4, better-sqlite3/WAL, privates Dateisystem. Das passt zum
vorhandenen Projekt und einem einzelnen Render-Service mit dauerhaftem Datenträger.
Keine parallelen Instanzen mit separaten SQLite-Dateien. Beim späteren Wachstum
Objektspeicher und PostgreSQL gesondert planen, nicht jetzt neu aufbauen.

Konten brauchen keine kostenpflichtigen Dienste. Passwort-Reset und E-Mail-
Verifizierung sind noch nicht enthalten; vor kommerziellem Start ergänzen.
Es werden keine E-Mails versendet. Bestellstatus steht im Dashboard; Stripe-Belege
sind eine gesonderte Kontoeinstellung. Zahlungsarten zunächst Karte, kein Abo.
Die bisherigen Preise 19/29/39/59 Euro sind übernommen, keine neue Preiskalkulation.
Ein Monat bedeutet weiterhin 30 Tage ab Zahlungsbestätigung, nicht ab Eventdatum.
Ein abgelaufener Checkout kann noch nicht neu gestartet werden: neues Event mit
anderer ID erstellen. Verlängerungen, Refund-/Dispute-Abgleich und Self-Service
Account-Löschung gehören zur nächsten Härtung vor dem Verkaufsstart.

Gastlinks sind Zugangsschlüssel: Jeder, der sie erhält, kann die freigegebenen Fotos
sehen, herunterladen und Fotos hochladen. Teilen ist möglich. Erneuern macht alte
Links/QRs ungültig. Das ist bewusst keine persönliche Gäste-Authentifizierung.
Fotos standardmäßig manuell freigeben; um die Diashow sofort zu aktualisieren,
automatische Freigabe einschalten. Entzogene/gelöschte Fotos verschwinden auch aus
bereits laufender Galerie/Diashow beim nächsten Polling.

Die bestehenden inline Skripte bleiben erhalten. CSP erlaubt hierfür unsafe-inline;
eine Umstellung auf externe Skripte ist vor einer strikteren CSP erforderlich.
JPEG/PNG/WebP unterstützt; HEIF nur bei Decoder-Unterstützung des installierten
Sharp-Builds. iPhone HEIC auf echten Geräten prüfen; keine pauschale HEIC-Zusage.
Neue Fotos werden neu als JPEG kodiert. Originale aus dem Altbestand bleiben beim
Import bytegleich erhalten und können daher noch EXIF/GPS enthalten.

## Datenschutz und Löschverhalten

Technische Maßnahmen: private Speicherung, Owner-Isolation, Token-Gastzugang,
TLS im Hosting, Moderation, Metadatenentfernung bei neuen Uploads, keine
öffentlichen Fotoverzeichnisse, Sofortsperre nach Ablauf und Löschlauf.
Der Upload zeigt einen Hinweis auf Teilen, Empfänger und Löschung. Das ersetzt
keine vollständige Datenschutzerklärung bzw. Prüfung der Rechtsgrundlage.
Verantwortliche, Kontakt, Hosting-/Stripe-Verträge, Region, Betroffenenanfragen,
Nutzungsbedingungen und Datenschutzerklärung vor Veröffentlichung festlegen.

Automatisch werden abgelaufene, zugeordnete, bezahlte Events gelöscht: Bilddateien
und Foto-Metadaten. Event-ID bleibt als reservierter Tombstone erhalten;
Event-/Payment-Zeilen und Kontodaten haben noch keine automatische Aufbewahrungs-
regel. Diese fachlich/rechtlich festlegen. Kein unkontrolliertes Löschen von
zahlungsbezogenen Daten. Sessions nach sieben Tagen ungültig und bereinigt.
Zwischendateien älter als 24 Stunden werden bereinigt.

Löschlauf setzt einen laufenden Service voraus; bei Ausfall erfolgt er beim
nächsten Start. Backups haben eigene Aufbewahrungsfristen und müssen separat
bereinigt werden. Gäste können heruntergeladene Kopien behalten.
Unzugeordnete Alt-Events werden niemals automatisch entfernt.

## Vor Produktionsfreigabe

- Render-Datenpfade und vollständige Sicherung inklusive WAL prüfen.
- Bestandskopie importieren, Eigentümer und vorhandene Zahlungen verifizieren.
- Test-Checkout + signierter Stripe-Webhook auf separater Umgebung durchführen.
- Smartphone-Upload, Browserlogin, QR-Scan/-Druck und Beamer prüfen.
- Datenschutztexte/Verträge sowie Backup-/Restore-Verfahren abschließen.
- Betriebsgröße, Limits und Speichervolumen festlegen; Lasttests durchführen.
- Danach ausdrückliche Freigabe für Produktionsumzug und separat für Live-Zahlung.

## Offizielle technische Referenzen

- https://docs.stripe.com/checkout/fulfillment
- https://docs.stripe.com/webhooks
- https://render.com/docs/disks
- https://render.com/docs/free

Diese Hinweise dokumentieren den Entwicklungsstand, keine rechtliche Freigabe.
