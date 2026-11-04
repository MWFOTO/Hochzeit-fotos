# FinalSnap – Sicherungs- und Wiederherstellungsplan

Stand: 4. November 2026. Sicherungscode ist vorbereitet, aber deaktiviert, bis der separate Bucket und seine Zugangsdaten eingerichtet und geprüft sind.

## Daten und Risiken

- SQLite-Datenbank `/data/events.db` auf der Render-Disk in Frankfurt: Konten, Veranstaltungsdaten, Foto-Metadaten und Zahlungsstatus.
- Fotos liegen im primären privaten Hetzner Object Storage in Nürnberg (`nbg1`), verschlüsselt mit dem Render-Secret `S3_SSE_C_KEY`.
- Render erstellt für die Persistent Disk eigene tägliche Snapshots; sie enthalten keine Hetzner-Fotoobjekte und sind kein getesteter SQLite-Wiederherstellungsweg.
- Geht der SSE-C-Schlüssel verloren, lassen sich verschlüsselte Fotos nicht lesen. Der Schlüssel muss getrennt vom App-Backup in einem Passwortmanager liegen.

## Empfohlener Startumfang

1. **SQLite täglich sichern:** Die App verwendet die SQLite-Backup-API für eine konsistente Momentaufnahme inklusive WAL; sie kopiert nicht einfach die aktive `.db`-Datei. Die gesicherte Datei wird erneut heruntergeladen und täglich mit `PRAGMA integrity_check` geprüft.
2. **Fotos täglich sichern:** Verarbeitete Fotoobjekte in einen separaten privaten Sicherungs-Bucket am deutschen Standort kopieren. Dafür nur einen eingeschränkten, getrennten Backup-Zugang verwenden.
3. **Verschlüsselung:** Datenbank und Fotos werden im separaten Bucket mit einem eigenen SSE-C-Schlüssel verschlüsselt. Der Schlüssel wird getrennt vom Backup aufbewahrt.
4. **Überwachung:** Erfolg, Zeitpunkt, Größe und Ergebnis jeder Sicherung protokollieren. Bei fehlender oder fehlgeschlagener Tageskopie einen Alarm auslösen.
5. **Wiederherstellung:** Vor Annahme echter Zahlungen einmal Datenbank und Fotos in einer isolierten Testumgebung wiederherstellen und Gast-/Veranstalterzugriff, Albumzuordnung und Fotoanzeige nachvollziehen. Danach monatlich sowie vor größeren Datenbankänderungen wiederholen.

## Umsetzung mit der bestehenden Render-Architektur

Render-Cronjobs können keine Persistent Disk einhängen. Ein Cronjob kann deshalb `/data/events.db` nicht direkt konsistent sichern. Der Code führt den Sicherungslauf in der bestehenden App-Instanz aus; die App bleibt auf eine Instanz ausgelegt und eine zweite Instanz darf nicht parallel auf die SQLite-Datei zugreifen. Die Sicherung ist mit `BACKUP_ENABLED=0` deaktiviert, bis ein eigener Bucket eingerichtet und geprüft wurde.

Für Fotos ist ein eigener, privater Hetzner-Bucket in Falkenstein (`fsn1`) mit separatem Zugang und eigenem SSE-C-Schlüssel vorgesehen. Der tägliche Abgleich spiegelt aktive Fotos in den Sicherungs-Bucket. Reguläre Foto- und Albumlöschungen erhalten sofort einen Löschmarker; falls das fehlschlägt, legt die App den Vorgang dauerhaft in die SQLite-Warteschlange und versucht ihn mindestens alle 15 Minuten erneut. Hetzner löscht die nicht aktuelle Fotoversion nach höchstens sieben Tagen. Dafür verlangt der Code aktiviertes Versioning und eine Lifecycle-Regel nur für den Prefix `photos/`, ohne automatische Löschung aktiver Versionen. Die Konfiguration wird vor jedem Lauf und bei Löschungen geprüft. Der zweite Standort schützt vor einzelnen Standortproblemen, aber nicht vor einem Ausfall oder Zugriff auf dasselbe Hetzner-Konto.

Lifecycle-Regel für den Sicherungs-Bucket (die konkrete Bucket-ID einsetzen):

```json
{
  "Rules": [
    {
      "ID": "finalsnap-photo-backup-retention",
      "Status": "Enabled",
      "Prefix": "photos/",
      "NoncurrentVersionExpiration": { "NoncurrentDays": 7 }
    }
  ]
}
```

Diese Regel löscht keine aktuelle Fotoversion. Das Backup-Programm löscht Datenbankversionen nach 30 Tagen gezielt. Den Backup-Schalter nach Aktivierung nicht abschalten, solange sich noch Fotos im Backup-Bucket befinden; sonst werden Löschmarker und Fristen nicht weiter verarbeitet.

Ein Tageslauf gilt erst dann als erfolgreich, wenn die SQLite-Momentaufnahme hochgeladen, erneut heruntergeladen und mit `PRAGMA integrity_check` geprüft sowie der Fotoabgleich abgeschlossen ist. Die App protokolliert Laufzeit, Objektzahlen, Datenmenge und Ergebnis in SQLite und sendet bei Fehlern höchstens alle sechs Stunden eine Meldung an `info@finalsnap.de`. Das ersetzt keinen unabhängigen Erreichbarkeitsmonitor und den regelmäßigen vollständigen Wiederherstellungstest nicht.

## Fristen, die vor Aktivierung festgelegt werden müssen

- **Bestätigt:** tägliche Sicherungen der Betriebsdatenbank 30 Tage aufbewahren; abgelaufene Datenbankobjektversionen werden gezielt entfernt.
- **Bestätigt:** Foto-Sicherungskopien höchstens 7 Tage nach ihrer Löschung aus dem aktiven Album behalten und danach endgültig löschen.
- Die Foto-Kopie verlängert die tatsächliche Löschfrist um bis zu 7 Tage. Das muss vor Aktivierung in Datenschutzhinweisen und Betriebsablauf benannt werden.
- Ein älterer Datenbankstand kann nach Ablauf dieser Frist auf Fotos verweisen, die aus der Sicherung bereits entfernt wurden; für einen vollständigen Systemrestore wird der jüngste tägliche Datenbankstand verwendet.
- Gesetzlich aufzubewahrende Rechnungs- und Buchungsnachweise sind getrennt von Fotos zu behandeln. Die steuerliche Aufbewahrungsfrist muss vor echten Zahlungen mit der Steuerberatung festgelegt werden.
- Der Sicherungs-Bucket und seine Region, Zugriffsrollen, Schlüssel, Aufbewahrung und Löschbestätigung müssen vorab dokumentiert werden. Eine zweite Hetzner-Region schützt gegen einzelne Bucket-/Standortprobleme, aber nicht gegen einen vollständigen Ausfall oder eine Kompromittierung desselben Kontos.

## Abnahmekriterien

- Letzte erfolgreiche Datenbank- und Fotosicherung ist höchstens 24 Stunden alt.
- Eine Wiederherstellung aus einer benannten Sicherung wurde mit Datum, Sicherungs-ID, Dauer und Ergebnis dokumentiert.
- Kontrolliert nachgewiesen: Veranstaltungsdaten passen zu den Fotos; private Fotos sind weiterhin nur über gültigen Veranstaltungszugang sichtbar.
- Nach Ablauf der festgelegten Frist ist ein gelöschtes Album auch aus Sicherungen entfernt.
- Ein fehlgeschlagener Sicherungslauf erzeugt eine Meldung an `info@finalsnap.de`.

## Vor der Umsetzung entscheiden

1. Einen separaten, privaten Sicherungs-Bucket in Falkenstein (`fsn1`) anlegen, Versioning und die begrenzte Lifecycle-Regel setzen sowie eigene Zugangsdaten und einen separaten SSE-C-Schlüssel erzeugen.
2. Die Variablen `BACKUP_S3_*` in Render setzen und erst nach Kontrolle der Hetzner-Einstellungen `BACKUP_ENABLED=1` aktivieren.
3. Den monatlichen vollständigen Wiederherstellungstest und die Benachrichtigung an `info@finalsnap.de` organisatorisch festlegen und nach dem ersten Sicherungslauf durchführen.
