# Oberfläche – Phase 2

Der Name Event-Fotos bleibt ein austauschbarer Platzhalter. Comic-Fotograf aus der Fahrzeugvorlage als transparente WebP-Datei, Blau/Gelb/Orange mit neutralen Flächen. Lokale Systemschrift Trebuchet MS mit Segoe UI als Ersatz: keine externen Schriftanbieter.

Startseite, Login und Dashboard überarbeitet. Dashboard: Fotoaktionen, QR-Code/Gästezugang, ausklappbare Freigabeeinstellungen und getrennte Löschaktion. Fotoverwaltung scrollt nach Öffnen in den sichtbaren Bereich.

Bestehende QR-Codes führen jetzt zur gemeinsamen Galerie. /event/:id/upload ist die Upload-Seite; /gallery bleibt kompatibel. Tokenprüfung, Eigentümerrechte und Zahlungsfreischaltung bleiben erhalten. Dateiauswahl ohne erzwungene Kamera, Zoom wieder möglich.

Prüfung: acht Integrationstests einschließlich geschützter Galerie- und Upload-Routen sowie öffentlicher Illustration. JavaScript-Syntax geprüft. Desktop- und Mobilansichten per CSS angepasst; eine vollständige visuelle Browserprüfung war in der Arbeitsumgebung wegen fehlendem Browser und blockiertem Download nicht möglich. Prüfung auf echten Geräten bleibt offen.
