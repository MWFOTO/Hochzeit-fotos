# Zusammenarbeit Claude & ChatGPT an FinalSnap

> **Neu ab 26.11.2026 (Matthias):** Claude übernimmt das gesamte Projekt, also Design, Fehlerbehebung **und** Server/Funktionen. ChatGPT arbeitet nicht mehr eigenständig am Code. Die folgenden Regeln gelten weiter für jede KI, die am Projekt arbeitet. Merge und Deploy bleiben bei Matthias bzw. erfolgen nur mit seiner ausdrücklichen Freigabe.

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
- **N3 KI-Tischkarten-Studio:** Server-Endpunkt und Claude-API-Anbindung. Die Oberfläche gestaltet Claude. Die API-Übermittlung bleibt gesperrt, bis der Anthropic-DPA abgeschlossen und der Datenschutzhinweis angepasst und geprüft wurde.
- **F4 Gastname:** Server-Seite. Das Feld im Design liefert Claude. Umsetzung erst nach der im Funktionsdokument vorgesehenen rechtlichen Abstimmung zur freiwilligen Speicherung des Gastnamens.
- Optional: `qr_shared_at` am Event speichern. Dann stellt Claude `event-journey.js` von `localStorage` darauf um.
- **F7 ZIP-Download:** Ein belastbarer Test mit großem Album auf dem aktiven Render-Dienst steht aus. Lokal ist ZIP-STORE bereits umgesetzt.

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

### 26.11.2026 · ChatGPT · Branch `codex/germany-storage-followup` · Merge-Commit nach PR #10
- PR #10 nach dem Merge lokal eingelesen und mit den bestehenden Server-Änderungen zusammengeführt. Die neuen Oberflächen und Gästerouten von Claude bleiben maßgeblich.
- Anlass, Designfarbe und Thema werden beim Anlegen serverseitig validiert und gemeinsam mit Anlass-Bezeichnung gespeichert. Die Anlassliste unterstützt Hochzeit, Geburtstag, Party, Sommerfest, Firmenfeier, Jubiläum und Abschlussfeier.
- Lokale Änderungen enthalten außerdem Originalfotos ohne GPS-Daten und ZIP-Downloads ohne erneute Komprimierung. Das Browser-Uploadskript überträgt die ausgewählte Datei bereits unverändert.
- Vor der Übergabe lagen außerdem `78f9ef9` (Kartendesigner-Oberfläche, vor der Zuständigkeitsaufteilung) und `d028996` (ZIP-STORE) lokal auf diesem Branch. Die Kartendesigner-Oberfläche wird bis zur Abstimmung mit Claude nicht weiter verändert.
- Prüfung nach Zusammenführung: `npm test` 52/52 grün; JavaScript-Syntaxprüfung erfolgreich. Kein Deploy.
- Damals offen: N3-Serverendpunkt mit Claude-API, F4-Gastname serverseitig, F6-Betrieb und ein Belastungstest des ZIP-Downloads auf Render. N1 ist lokal umgesetzt, aber noch nicht live; die Textanpassung folgt erst nach dem Livegang.

### 26.11.2026 · ChatGPT · Branch `codex/germany-storage-followup`
- F6-Betriebsschutz geprüft: Deploy-Regel und Veranstaltungsübersicht sind in `docs/OPERATIONS.md` beschrieben; `operations-monitor.js` protokolliert aggregierte Upload-Erfolge/-Fehler und sendet eventbezogene Warnungen mit 1-Stunden-Cooldown, ohne Gast- oder Fotodaten.
- Ergänzt wurde ein gezielter Test für die Schwelle von fünf Fehlern und den Mail-Cooldown. F6 ist damit im Code und in der lokalen Testsuite abgedeckt; externe Alarmzustellung und tatsächliche Deploy-Prüfung bleiben Betriebschecks.
- Offen bleiben N3 (bis DPA/Datenschutzhinweis geklärt), F4 (bis rechtlich abgestimmt), N1-Livegang und der F7-Großalbumtest auf Render. Kein Deploy.

### 26.11.2026 · Claude · Branch `claude/uebernahme-chatgpt`
- ChatGPTs bis dahin nur lokal liegende 13 Commits (`codex/germany-storage-followup`, gesichert als `backup/chatgpt-followup-2026-11-26`) mit dem Hauptstand zusammengeführt: Originalfotos ohne GPS mit Vorschau- und Anzeigeversionen, ZIP ohne Neukomprimierung, Betriebsübersicht und Upload-Warnungen (F6), Diashow für Fernseher, Kartendesigner-Ablauf, Startseite fürs Handy.
- Doppelte Lösungen bereinigt: Für die Startseite gilt ChatGPTs Umsetzung (`landing.js`/`landing.html`), mein `landing-enhance.js` ist entfernt. Die ungenutzte `welcome.html`/`welcome.js` ist entfernt, die Gästeseite bleibt `upload.html`.
- Galerie: Blättern funktioniert jetzt auch mit den neuen Vorschaubildern. Texte zur Fotoqualität auf „volle Originalauflösung, GPS entfernt“ vereinheitlicht.
- 53/53 Tests grün. Lokal geprüft: Upload großer Fotos (Original unverändert gespeichert, Vorschau 480 px), Galerie mit Blättern und Original-Download.

### 26.11.2026 · Claude · KI-Karten-Assistent
- Design-Editor: neuer Frage-Assistent (`public/card-studio.js`) ersetzt die alte Stil-Auswahl, Kartentexte editierbar,
  Live-Druckvorschau mit echtem QR, „Nur den QR-Code“ (PNG/SVG/PDF), lesbare Schriftgrößen im Druck, Logo statt ϟ.
- Server: `card-assistant.js`, Routen `GET/POST /api/event/:id/card-assistant` (aus, bis `AI_CARD_ASSISTANT=on` + `ANTHROPIC_API_KEY`),
  Design speichert jetzt `qrPosition` und `cardText`.
- Datenschutz ergänzt (Abschnitt KI-Assistent). Anleitung zum Einschalten: `docs/KI-TISCHKARTEN.md`.
