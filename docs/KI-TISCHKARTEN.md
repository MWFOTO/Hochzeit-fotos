# KI-Karten-Assistent (Tischkarten-Studio)

Stand: 26.11.2026 · gebaut von Claude

## Was es macht
Im Design-Editor (`/event/:id/design`) führt ein Assistent mit 4–5 Fragen zur fertigen Tischkarte
(Wer feiert? · Stimmung · Farben · Anrede · optionaler Wunsch). Ergebnis: Titel, Kartentexte (Vorder- und
Rückseite), Stil, Akzentfarbe, Schrift und QR-Position. Der echte Event-QR wird automatisch eingesetzt.
Download als druckfertige PDF (Tischaufsteller A4, Karte A6, Poster A4), als PNG oder nur der QR-Code (PNG/SVG/PDF).

## Zwei Modi
- **Ohne KI (Standard):** Der Entwurf entsteht vollständig im Browser aus Vorlagen. Keine Datenübertragung.
- **Mit KI:** Server-Route `POST /api/event/:id/card-assistant` ruft Claude (`claude-opus-5-5`) über die Anthropic-API auf.
  Übertragen werden NUR die Fragebogen-Antworten (keine Fotos, keine E-Mail, kein Gästelink).
  Antworten werden streng geprüft (`card-assistant.js`), Fehler fallen auf den Vorlagen-Entwurf zurück.
  Rate-Limit: 20 Entwürfe pro Stunde und Konto.

## Einschalten (erst nach Auftragsverarbeitungsvertrag!)
1. Konto bei Anthropic für die API anlegen (console.anthropic.com), als Geschäftskunde.
2. Die Commercial Terms inkl. Data Processing Addendum (DPA, mit EU-Standardvertragsklauseln) prüfen, akzeptieren
   und eine Kopie ablegen (Ordner „Verträge“). Ggf. Abrechnungslimit setzen.
3. API-Schlüssel erstellen.
4. In Render (Service finalsnap-deutschland → Environment) eintragen:
   - `ANTHROPIC_API_KEY` = der Schlüssel (nur dort, nie in Chat/E-Mail/Code)
   - `AI_CARD_ASSISTANT` = `on`
5. Speichern/neu starten. Im Editor erscheint dann „EUER KARTEN-ASSISTENT · MIT KI“ und der Datenschutzhinweis.

Ausschalten: `AI_CARD_ASSISTANT` auf `off` setzen.

## Datenschutz
Abschnitt „KI-Assistent für Tischkarten“ (`/datenschutz#ki-assistent`) und Empfängerliste sind ergänzt.
Vor dem Einschalten bitte rechtlich gegenlesen lassen (Drittlandübermittlung USA, Speicherdauer laut Anthropic-Bedingungen).

## Kosten
Ein Entwurf braucht nur wenige Tausend Tokens: grob 1–5 Cent pro Entwurf.
