# Oberfläche – Phase 2

Der Name Event-Fotos bleibt ein austauschbarer Platzhalter. Comic-Fotograf aus der Fahrzeugvorlage als transparente WebP-Datei, Blau/Gelb/Orange mit neutralen Flächen. Lokale Systemschrift Trebuchet MS mit Segoe UI als Ersatz: keine externen Schriftanbieter.

Startseite, Login und Dashboard überarbeitet. Dashboard: Fotoaktionen, QR-Code/Gästezugang, ausklappbare Freigabeeinstellungen und getrennte Löschaktion. Fotoverwaltung scrollt nach Öffnen in den sichtbaren Bereich.

QR-Codes führen zur persönlichen Gästegalerie dieses Browsers. Veranstalter sehen zusätzlich die Gesamtübersicht. /event/:id/upload ist die Upload-Seite; /gallery bleibt kompatibel. Tokenprüfung, Eigentümerrechte und Zahlungsfreischaltung bleiben erhalten. Dateiauswahl ohne erzwungene Kamera, Zoom wieder möglich.

Prüfung: acht Integrationstests einschließlich geschützter Galerie- und Upload-Routen sowie öffentlicher Illustration. JavaScript-Syntax geprüft. Desktop- und Mobilansichten per CSS angepasst; eine vollständige visuelle Browserprüfung war in der Arbeitsumgebung wegen fehlendem Browser und blockiertem Download nicht möglich. Prüfung auf echten Geräten bleibt offen.

## Anforderungen nach dem Praxistest

- **Private Gästegalerie:** Gäste sehen auf ihrem Gerät nur Fotos, die im gleichen Browser mit ihrem anonymen Event-Cookie hochgeladen wurden. Upload, Galerie, Diashow, Einzelabruf und ZIP-Download müssen alle dieselbe Berechtigung anwenden. Veranstalter sehen und verwalten alle Bilder. Bestehende Fotos ohne Zuordnung bleiben Gästen verborgen, bis der Veranstalter sie bewusst neu zuordnet oder hochlädt.
- **Grenze der anonymen Zuordnung:** Mehrere Personen, die denselben Browser oder dasselbe Gerät benutzen, teilen dort dieselbe Gästegalerie. Eindeutige Identität pro Person würde ein Konto, einen Einmalcode oder eine andere Anmeldung voraussetzen. Gäste benötigen im aktuellen Konzept weiterhin kein Konto.
- **90 Tage nach Ende des Albumzeitraums:** Nur noch ansehen und herunterladen; neue Uploads sind gesperrt. Danach werden Fotos und zugehörige Datenbankeinträge automatisch entfernt. Die Sicherungs- und Provider-Logfristen müssen getrennt geprüft werden.
- **Spätere Ausbaustufe, noch nicht implementiert:** Fotospiele/Fotoaufgaben als Motivation, ein digitales Gästebuch und ein 10-%-Gutschein für die nächste Feier. Vor Umsetzung brauchen diese Funktionen Regeln für Moderation, Missbrauch, Gutscheinbedingungen und Datenschutz.
- **Weiterhin offen:** Pakete nach Fotoanzahl statt Laufzeit, Foto-Kontingente, Aufbewahrungsbeginn ab Veranstaltungstag oder Zahlung, endgültige Preise und zusätzliche Fotos. Die sichtbaren Angebote bleiben Testangebote, bis diese Regeln entschieden sind.
