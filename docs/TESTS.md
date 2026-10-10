# Prüfprotokoll Phase 1

Lokale Umgebung: Node 24.19.0, Linux, temporäre SQLite-Dateien und Fotoverzeichnisse.
`npm test`: 8 Integrationstests bestanden, 0 Fehler.
`npm audit --omit=dev`: 0 bekannte gemeldete Schwachstellen nach Sharp-Update.
`git diff --check`: bestanden. Kein produktiver Datenzugriff.

| Testgruppe | Geprüft |
| --- | --- |
| Kundenkonto | Registrierung, korrekter/falscher Login, Dashboard-Schutz, CSRF, fremde Origin |
| Veranstaltungen | Mehrere Events, eindeutige IDs, fremder Eigentümer, pending-Sperre für Gastseite/QR |
| Stripe | Stabiler Checkout, signierte Payloads, falsche Signatur, unpaid, falscher Betrag, Live-Daten, asynchrone Bestätigung, wiederholte Webhooks ohne Laufzeitverlängerung, geschützter Bestellstatus |
| Fotos und QR | Fake-Bild abgelehnt, wirkliche Bilddekodierung, Gastupload, manuelle Freigabe, Owner-Isolation, privater Dateizugriff, JPEG ohne EXIF, ZIP, QR-PNG, Fotoanzahl-Limit, Temp-Cleanup, Bildlöschung |
| Ablauf | Token-Erneuerung, alte Links gesperrt, sofortige Ablaufsperre, Bild-/Metadatenlöschung |
| Alte Datenbank | Bestehendes Schema ergänzt, bezahlter Status und Session-ID bleiben erhalten, keine automatische Eigentümerzuordnung |
| Altbilder | Dry-run ohne Eventänderung, Import mit DB-Backup, Originalbild unverändert, keine automatische Freischaltung, keine doppelte Registrierung |
| Sessions | Überleben neuen App-Prozess, Logout invalidiert Session |

Checkout-Aufrufe sind in diesen Tests simuliert; Signaturen werden mit dem realen
Stripe-SDK lokal erzeugt und geprüft. Das ist **kein** erfolgreicher End-to-End-Test
mit einem Stripe-Konto. Eine Freigabe für Verkauf/Produktivbetrieb folgt daraus nicht.

## Noch durchzuführen

- Stripe-Sandbox mit echten Test-API-Schlüsseln, Weiterleitung, Webhook-Auslieferung,
  Retry und Dashboard-Zahlungsnachweis.
- Render-Testservice: dauerhafte Bilder/SQLite nach Neustart und Redeploy,
  Origin/Proxy/HTTPS/Cookie-Verhalten sowie Datenbank-/Foto-Restore.
- Browserprüfung: Kundenlogin, XHR-Fortschritt, Moderation, QR-Scan, QR-Druck,
  ZIP, Smartphone-Formate (insbesondere HEIC), Vollbild-/Beamer-Diashow.
- Reale Bestandskopie importieren und abgleichen; keine Originaldaten hier verfügbar.
- Lasttest unter Veranstaltungs-WLAN: gleichzeitige Gäste, gemeinsame IP,
  Disk-Auslastung und Speicher-/CPU-Verbrauch.
- 20-MB-/10-Dateien-/2-GiB-Grenzen und Unterbrechung während größerer Uploads
  unter realer Hostinglast gesondert prüfen. Lokale Tests prüfen das Fotoanzahl-Limit.
- Datenschutztexte, Betriebsabläufe und kaufmännische Freigabe abschließen.
