# Karten-Assistent (Tischkarten-Studio)

Stand: 26.11.2026 · gebaut von Claude

## Was es macht
Im Design-Editor (`/event/:id/design`) führt ein Assistent mit fünf Fragen zur fertigen Tischkarte:
Wer feiert? · Stimmung · Farben · Anrede (ihr/du) · optional ein eigener Satz.
Ergebnis: Titel, Kartentexte (Vorder- und Rückseite), Stil, Akzentfarbe, Schrift. Der echte Event-QR wird automatisch eingesetzt.
Download als druckfertige PDF (Tischaufsteller A4, Karte A6, Poster A4), als PNG oder nur der QR-Code (PNG/SVG/PDF).

## Datenschutz
Alles läuft im Browser (`public/card-studio.js`). Es gibt **keine KI und keine Übertragung an Dritte**.
Gespeichert werden nur die übernommenen Kartentexte im Design des Albums (`cardText`, `qrPosition`).

## Textbausteine erweitern
In `public/card-studio.js`: `KICKERS` (je Anlass), `INVITES` (je Stimmung, ihr/du), `BACK` (Rückseite).
„Neuer Vorschlag“ blättert durch die Varianten. Neue Sätze einfach in die Listen schreiben (max. 120 Zeichen, Kicker max. 40).

## Später: KI?
Entscheidung 26.11.2026: vorerst keine KI, weil Daten sonst in die USA gingen. Falls später gewünscht:
ein EU-Anbieter (z. B. Mistral AI) mit Auftragsverarbeitungsvertrag, Datenschutzerklärung ergänzen,
nur die Fragebogen-Antworten übertragen. Die frühere Claude-Anbindung liegt in der Git-Historie (Commit 0c471e4).
