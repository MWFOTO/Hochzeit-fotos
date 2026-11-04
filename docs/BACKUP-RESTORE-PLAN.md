# FinalSnap – Sicherungs- und Wiederherstellungsplan

Stand: 4. November 2026. Zielentwurf; Sicherungen und Wiederherstellung sind noch nicht eingerichtet oder getestet.

## Daten und Risiken

- SQLite-Datenbank `/data/events.db` auf der Render-Disk in Frankfurt: Konten, Veranstaltungsdaten, Foto-Metadaten und Zahlungsstatus.
- Fotos liegen im primären privaten Hetzner Object Storage in Nürnberg (`nbg1`), verschlüsselt mit dem Render-Secret `S3_SSE_C_KEY`.
- Render erstellt für die Persistent Disk eigene tägliche Snapshots; sie enthalten keine Hetzner-Fotoobjekte und sind kein getesteter SQLite-Wiederherstellungsweg.
- Geht der SSE-C-Schlüssel verloren, lassen sich verschlüsselte Fotos nicht lesen. Der Schlüssel muss getrennt vom App-Backup in einem Passwortmanager liegen.

## Empfohlener Startumfang

1. **SQLite täglich sichern:** Über die SQLite-Backup-API eine konsistente Momentaufnahme inklusive WAL erstellen; nicht einfach die aktive `.db`-Datei kopieren.
2. **Fotos täglich sichern:** Verarbeitete Fotoobjekte in einen separaten privaten Sicherungs-Bucket am deutschen Standort kopieren. Dafür nur einen eingeschränkten, getrennten Backup-Zugang verwenden.
3. **Verschlüsselung:** Datenbank-Backup zusätzlich verschlüsseln. Fotos bleiben SSE-C-verschlüsselt; Restore-Anleitung und Schlüssel werden getrennt vom Backup aufbewahrt.
4. **Überwachung:** Erfolg, Zeitpunkt, Größe und Ergebnis jeder Sicherung protokollieren. Bei fehlender oder fehlgeschlagener Tageskopie einen Alarm auslösen.
5. **Wiederherstellung:** Vor Annahme echter Zahlungen einmal Datenbank und Fotos in einer isolierten Testumgebung wiederherstellen und Gast-/Veranstalterzugriff, Albumzuordnung und Fotoanzeige nachvollziehen. Danach monatlich sowie vor größeren Datenbankänderungen wiederholen.

## Fristen, die vor Aktivierung festgelegt werden müssen

- Vorschlag: tägliche Sicherungen der Betriebsdatenbank 30 Tage aufbewahren.
- Vorschlag: Foto-Sicherungskopien höchstens 7 Tage nach ihrer Löschung aus dem aktiven Album behalten und danach endgültig löschen.
- Die Foto-Kopie verlängert die tatsächliche Löschfrist um bis zu 7 Tage. Das muss vor Aktivierung in Datenschutzhinweisen und Betriebsablauf benannt werden.
- Gesetzlich aufzubewahrende Rechnungs- und Buchungsnachweise sind getrennt von Fotos zu behandeln. Die steuerliche Aufbewahrungsfrist muss vor echten Zahlungen mit der Steuerberatung festgelegt werden.
- Der Sicherungs-Bucket und seine Region, Zugriffsrollen, Schlüssel, Aufbewahrung und Löschbestätigung müssen vorab dokumentiert werden. Eine zweite Hetzner-Region schützt gegen einzelne Bucket-/Standortprobleme, aber nicht gegen einen vollständigen Ausfall oder eine Kompromittierung desselben Kontos.

## Abnahmekriterien

- Letzte erfolgreiche Datenbank- und Fotosicherung ist höchstens 24 Stunden alt.
- Eine Wiederherstellung aus einer benannten Sicherung wurde mit Datum, Sicherungs-ID, Dauer und Ergebnis dokumentiert.
- Kontrolliert nachgewiesen: Veranstaltungsdaten passen zu den Fotos; private Fotos sind weiterhin nur über gültigen Veranstaltungszugang sichtbar.
- Nach Ablauf der festgelegten Frist ist ein gelöschtes Album auch aus Sicherungen entfernt.
- Ein fehlgeschlagener Sicherungslauf erzeugt eine Meldung an `info@finalsnap.de`.

## Vor der Umsetzung entscheiden

1. Die vorgeschlagenen Fristen von 30 Tagen (Datenbank) und 7 Tagen nach aktiver Fotolöschung bestätigen oder ändern.
2. Einen separaten, privaten Sicherungs-Bucket in Falkenstein (`fsn1`) oder Nürnberg (`nbg1`) anlegen und eigene Zugangsdaten erzeugen.
3. Den monatlichen Wiederherstellungstest und die Benachrichtigung an `info@finalsnap.de` festlegen.
