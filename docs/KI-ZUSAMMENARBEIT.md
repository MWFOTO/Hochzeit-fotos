# Zusammenarbeit Claude & ChatGPT an FinalSnap

Festgelegt von Matthias am 26.11.2026. Diese Datei lesen **beide KIs vor jeder Arbeit** und ergänzen sie danach unter „Verlauf“.

## Zuständigkeiten

| Bereich | Zuständig |
|---|---|
| Design, Aussehen, Texte auf den Seiten, Animationen, Handy-Darstellung | **Claude** |
| Fehlerbehebung (Bugs), auch in bestehendem Code | **Claude** (meldet größere Eingriffe vorher an Matthias) |
| Server-Logik, neue Funktionen, Datenbank, Zahlungen, Speicher, Backups, Betrieb | **ChatGPT** |
| Freigabe, Zusammenführen (Merge) und Deploy auf Render | **Matthias** |

Design-Dateien, an denen ChatGPT **nicht** gestalterisch arbeitet (technische Anschlüsse nach Absprache sind in Ordnung):
`public/fs-design.css`, `public/guest-experience.js`, `public/event-journey.js`, `public/event-wizard.js`, `public/landing-enhance.js`, `public/upload.html` (Aufbau und Texte).
Braucht eine neue Funktion eine Oberfläche, baut ChatGPT die Technik und hinterlässt hier eine Notiz. Claude gestaltet dann die Oberfläche.

## Regeln
1. **Vor jeder Arbeit** den aktuellen Stand von GitHub holen (`git pull`), nie auf alten lokalen Kopien arbeiten.
2. **Eigener Branch je KI und Aufgabe:** Claude nutzt `claude/…`, ChatGPT `codex/…`. Zusammengeführt wird nur über Matthias.
3. Kleine, gut beschriebene Commits. Alle Tests (`npm test`) müssen grün sein.
4. **Kein Deploy** ohne ausdrückliche Freigabe von Matthias. Keine Deploys Freitag ab 12 Uhr bis Sonntag (Feiern laufen).
5. Nach jeder Arbeit unten unter „Verlauf“ eintragen: Datum, wer, Branch/Commit, was geändert wurde, was offen ist.
6. Bestehende IDs und Klassen, die andere Dateien nutzen, nicht umbenennen, ohne es hier zu notieren.

## Offene Aufgaben für ChatGPT (Stand 26.11.2026)
- **N1 Originalauflösung** (siehe `FinalSnap-Originale-und-Tischkarten-Studio.md`). Dabei `prepareUploadFile()` in `public/upload.js` entfernen bzw. abschalten, denn das Verkleinern im Browser (F1) wurde zurückgezogen. GPS-Daten werden entfernt (entschieden). Wenn N1 live ist, meldet ChatGPT das hier. Claude passt dann die mit `TODO` markierten Texte an (`upload.html`, Assistent im Dashboard, Startseite).
- **N3 KI-Tischkarten-Studio:** Server-Endpunkt und Claude-API-Anbindung. Die Oberfläche gestaltet Claude.
- **F4 Gastname:** Server-Seite. Das Feld im Design liefert Claude.
- Optional: `qr_shared_at` am Event speichern. Dann stellt Claude `event-journey.js` von `localStorage` darauf um.

## Verlauf

### 26.11.2026 · Claude · Branch `claude/design-pakete`
- `8a54d14` Fehler behoben: Beim Öffnen einer Veranstaltung im Dashboard kam „summarySection is not defined“ (seit `a03f49b`), und die Kartenliste brach ab.
- `50be976` Design-Grundlage und geführte Kundenreise:
  - Der Gästelink `/event/:id` öffnet jetzt die Willkommensseite (`upload.html`) statt der Galerie. Die Galerie bleibt unter `/event/:id/gallery`. Test in `test/platform.test.js` angepasst.
  - Dashboard: Countdown, Checkliste, sichtbarer QR-Bereich (`event-journey.js`). Doppelte QR-Buttons in `account.js` entfernt. Neues Ereignis `finalsnap:event-rendered`.
  - Assistent „Neue Feier anlegen“ mit Anlass. `POST /api/events` speichert `occasion` in `design_json` (Test ergänzt).
  - Startseite: schmaler Handy-Header mit Menü, Mitmach-Demo, Erkennung angemeldeter Kunden (`landing-enhance.js`).
  - Alle 47 Tests grün. Lokal mit echtem Server geprüft (Gästeseite, Anlass-Begrüßung, Kontingent-Hinweis).

### 26.11.2026 · Claude · Branch `claude/galerie-login`
- Gäste-Galerie (`gallery.html`) im neuen Design. Neu: `gallery-experience.js` mit Blättern in der Großansicht (Buttons, Pfeiltasten, Wischen, Zähler) und dem Button „Fotos teilen“, der auf dem Handy unten immer erreichbar ist. Alle IDs für `gallery-init.js` und `guest-access.js` unverändert.
- Einheitliches Logo statt ϟ-Icon auf allen Unterseiten (außer `design-editor.html`, wartet auf ChatGPTs Kartendesigner-Abgleich).
- Anmelden/Registrieren: „Mein Konto“ → „← Zur Startseite“, Maskottchen ersetzt durch drei Vorteile.
- 47/47 Tests grün. Lokal mit echtem Server und 6 Testfotos geprüft.
