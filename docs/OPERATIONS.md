# FinalSnap – Betriebsablauf

Stand: 4. November 2026. FinalSnap ist auf Render Frankfurt live; echte Zahlungen und externer Verkauf bleiben gesperrt.

## Bekannter Betriebsstand

- Deutschland ist eine feste Vorgabe für den Produktivbetrieb. Ein Dienst außerhalb Deutschlands ist dafür nicht freigegeben.
- Der aktive Dienst heißt `finalsnap-deutschland` (`srv-dbkbkmnf3r2c7399hr9g`), läuft in Frankfurt und ist unter `https://finalsnap.de` erreichbar. Er hängt am GitHub-Zweig `codex/germany-storage`; Auto-Deploy ist ausgeschaltet.
- Die aktive Render Persistent Disk ist 10 GB groß und unter `/data` eingehängt. SQLite liegt unter `/data/events.db`; temporäre Uploads liegen unter `/data/staging`.
- Der aktive Prozess meldet den temporären Uploadspeicher und prüft Hetzner Object Storage beim Bereitschaftscheck. Der konfigurierte S3-Endpunkt ist Nürnberg (`nbg1`); die Anwendung verlangt im Produktionsbetrieb SSE-C-Verschlüsselung.
- Ein älterer Ohio-Dienst existiert getrennt. Vor Kundendaten stets prüfen, dass ausschließlich `finalsnap-deutschland` verwendet wird.
- Der Backup-Code liegt im App-Zweig, ist aber mit `BACKUP_ENABLED=0` deaktiviert, bis ein separater Bucket konfiguriert und dessen Versioning/Lifecycle-Regel geprüft sind. Es gab noch keinen echten Restore-Test.
- Brevo dokumentiert EU-weite Verarbeitung und Datenspeicherung auch in Belgien; das erfüllt keine strikte Deutschland-only-Vorgabe. GitHub als Quellcode-/Build-Dienst und Stripe für spätere Zahlungen benötigen eine eigene Standortprüfung. Bis zur Klärung ist eine vollständige Deutschland-Zusage für alle Dienste nicht belegt.
- Die App nutzt SQLite und ist auf eine Instanz ausgelegt. Keine zweite Instanz und keine horizontale Skalierung aktivieren, solange die Datenbank nicht umgestellt ist.
- Zahlungen bleiben technisch auf Stripe-Testmodus gesperrt. `STRIPE_TAX_ENABLED=0`; USt.-Rechnungen wurden im Stripe-Testcheckout noch nicht abgenommen.
- Sobald Stripe eine Rechnung zur Zahlung erstellt hat, kann der berechtigte Veranstalter sie im Dashboard über „Rechnung / Zahlungsbeleg öffnen“ abrufen. Der Link wird nur für das eigene Album ausgegeben; Verfügbarkeit und PDF mit ausgewiesener USt. sind im Testcheckout noch abzunehmen.

## Erreichbarkeit und Bereitschaft

- `GET /health` ist der schnelle Liveness-Endpunkt für den Prozess.
- `GET /ready` prüft SQLite, mindestens 100 MiB freien Upload-Speicher und den konfigurierten Fotospeicher. Bei einem Fehler antwortet die App mit HTTP 503, ohne interne Details öffentlich auszugeben.
- Die App prüft alle 15 Minuten den Render-Datenträger und den aus der Fototabelle summierten Hetzner-Speicher. Sie warnt, wenn der freie Render-Platz unter dem höheren Wert aus 25 % der Disk und 2,5 GiB liegt, sowie bei 75-%- und 90-%-Schwellen des Hetzner-Fotospeichers. Bei weniger als 2 GiB freiem Render-Platz werden neue Uploads vor dem Empfang der Dateien pausiert. Es sind höchstens zwei Upload-Requests gleichzeitig aktiv, pro Album einer. Meldungen und Entwarnungen gehen an `PAYMENT_ALERT_EMAIL`; je Alarm wird höchstens einmal in 24 Stunden erneut benachrichtigt.
- Der Hetzner-Wert ist eine App-Schätzung aus aktiven Fotometadaten. Er umfasst keine verwaisten Objekte oder Anbieter-Abrechnung. Hetzner-Kostenwarnungen müssen zusätzlich im Hetzner-Konto eingerichtet werden.
- Die GitHub-Actions-Datei `.github/workflows/finalsnap-availability.yml` im Standardzweig prüft `/health` und `/ready` alle fünf Minuten von außerhalb Render; nach zwei Wiederholungen schlägt der Workflow fehl. Ein geplanter Lauf ist noch nicht verifiziert, und der E-Mail-Empfang bei fehlgeschlagenen Läufen ist nicht bestätigt. Vor Verlass darauf GitHub-Actions-Fehlerbenachrichtigungen im Konto aktivieren und einen Alarmempfang prüfen.
- Bei wiederholtem Fehler zuerst Providerstatus und Runtime-Logs ansehen, dann Datenbank, Upload-Datenträger und Object Storage prüfen. Nicht durch mehrfaches Neustarten versuchen, einen Speicher- oder Datenbankfehler zu beheben.

## Speicherbetrieb

- Jedes bezahlte Album hat derzeit ein technisches Limit von 25 GB im Hetzner-Fotospeicher. Alle Veranstaltungen teilen sich zusätzlich das Provider-Kontingent. Render hält SQLite und vorübergehend Original- und verarbeitete Uploaddateien; die Anwendung begrenzt die parallele Staging-Last und hält mindestens 2 GiB als Uploadreserve frei.
- Im Object-Storage-Betrieb stoppt die App Uploads standardmäßig bei 900 GiB gemeinsam genutzter Fotos. Das lässt Abstand zum 1-TB-Kontingent; es ist keine separate Warnung im Hostinganbieter.
- Bei lokalem Fotospeicher stoppt die App Uploads ebenfalls bei weniger als 2 GiB freiem Speicher. Der Veranstalterbereich zeigt den Foto- und Uploadspeicher getrennt an.
- Gespeicherte Bilder sind verkleinerte JPEGs; Originaldateien werden nicht aufbewahrt.
- Hetzner Object Storage verschlüsselt Objekte nicht automatisch im Ruhezustand. Der Produktivcode verlangt für S3-Betrieb SSE-C mit `S3_SSE_C_KEY`; der 32-Byte-Schlüssel muss getrennt vom Hosting-Secret gesichert werden. Bei Schlüsselverlust sind die verschlüsselten Fotos nicht wiederherstellbar. Objektmetadaten werden durch SSE-C nicht verschlüsselt.
- Datierte Alben laufen 90 Kalendertage ab Veranstaltungsdatum (Europe/Berlin), ohne zusätzliche Downloadphase. Der Zugriff endet an der Frist; der stündliche Löschlauf und der Startlauf entfernen die Fotos. Undatierte Altalben behalten ihre bisherige Frist. Der tatsächliche Ablauf muss vor Verkauf mit einem Testevent bestätigt werden.
- Ein Hosting-Datenträger oder Object Storage ist kein geprüftes, unabhängiges Backup.

## Sicherungen und Wiederherstellung

Vor Verkauf fehlen noch aktivierte Sicherungen und ein vollständiger Wiederherstellungstest. Der konkrete Zielentwurf steht in `docs/BACKUP-RESTORE-PLAN.md`; die Aufbewahrung von 30 Tagen für Datenbanksicherungen und höchstens 7 Tagen nach aktiver Fotolöschung wurde bestätigt. Für die Freigabe müssen noch erfolgen:

1. einen separaten Hetzner-Bucket in Falkenstein mit eigenem Zugang und SSE-C-Schlüssel anlegen;
2. Versioning und eine Lifecycle-Regel für `photos/` einrichten; der App-Code verweigert einen Lauf, wenn Versioning fehlt oder aktive Fotos automatisch ablaufen könnten;
3. Zugangsdaten eintragen und `BACKUP_ENABLED=1` aktivieren; die App erstellt täglich eine konsistente SQLite-Sicherung und gleicht Fotos ab, Foto-Löschungen werden sofort markiert und bei Fehlern alle 15 Minuten erneut versucht;
4. Datenbanksicherung erneut herunterladen und Integrität prüfen; danach einen dokumentierten vollständigen Restore-Test mindestens monatlich sowie vor größeren Datenbankänderungen durchführen.

Render-Cronjobs können nicht auf die Web-Service-Disk zugreifen. Deshalb läuft die tägliche Sicherung innerhalb der einzelnen Web-Service-Instanz. Keine Datenbankdatei im laufenden Betrieb einfach kopieren; SQLite muss konsistent gesichert werden. Ein Rollback der App setzt Datenbankänderungen nicht zurück.

## Deploy und Störungen

Vor jeder Änderung am Live-Dienst Identität des Dienstes, Branch, Region, Umgebungswerte, Datenpfade und letzten erfolgreichen Deploy verifizieren. Vor einem Datenbank- oder Speicherwechsel zuerst Sicherung und Wiederherstellung nachweisen.

Nach einem Deploy `/health`, `/ready`, Anmeldung, Eventübersicht und einen kontrollierten Fotozugriff prüfen. Bei Fehlern Logs sichern und zum vorherigen App-Stand zurückkehren; Datenbank und Fotos nicht zurücksetzen oder löschen, solange Ursache und Kompatibilität unklar sind.

Supportfälle mit Event-Kurzname, Zeitpunkt, Gerät/Browser und genauer Fehlermeldung erfassen. Häufige erste Prüfungen:

- **QR-Code oder Gästelink funktioniert nicht:** Eventstatus und Fristen prüfen. Ein erneuerter Gästelink macht bereits gedruckte QR-Codes ungültig.
- **Foto-Upload schlägt fehl:** Verbindung, Dateityp, Dateigröße, Testfoto-Limit, Eventlimit und gemeinsamen Speicher prüfen.
- **Foto fehlt:** Veranstalterfreigabe, Uploadstatus und Eventfilter prüfen. Gäste sehen auf ihrem Gerät nur die dort hochgeladenen Fotos; der Veranstalter sieht alle.
- **Ablauf:** Datierte Alben sind nach 90 Tagen vollständig gesperrt und werden beim nächsten Löschlauf entfernt. Eine getrennte Downloadphase gilt nur noch für undatierte Altalben.

## Noch einzurichten

- Tarif, Standort und Datenpfade regelmäßig in den Anbieter-Konten prüfen und dieses Runbook aktuell halten.
- Geplanten GitHub-Actions-Monitor erfolgreich laufen lassen und Fehlerbenachrichtigungen im Betreiberkonto aktivieren und bestätigen.
- Hetzner-Kosten-/Verbrauchswarnungen im Anbieter-Konto konfigurieren; die FinalSnap-App meldet nur ihre erfasste Fotoauslastung und sieht keine Rechnung.
- SQLite- und Foto-Backups an einem unabhängigen Ziel einrichten und Wiederherstellung nachweisen.
- Alarmkontakt, Supportzeiten und Verantwortlichkeit bei Störungen festlegen.

## Prüfung der 90-Tage-Frist (2026-11-02)

`node --test test/retention.test.js` prüft Vorabbuchung, Datumsänderung,
Zahlungsbestätigung, Sommer-/Winterzeit, bestehende datierte Alben sowie Zugriffssperre
und Löschung am Fristende für lokalen und S3-Speicher. Die bestehende Gesamtsuite
hat bereits im unveränderten Ausgangsstand acht Fehler (unter anderem alte
Event-Erstellung ohne das inzwischen erforderliche Veranstaltungsdatum).
Erinnerungsmails vor der Löschung sind noch nicht implementiert.
