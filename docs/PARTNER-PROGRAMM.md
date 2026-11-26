# Partner-Programm (Stufe 1)

## Für den Inhaber
- **Partner anmelden lassen:** Link `https://finalsnap.de/partner/anmelden` an Fotograf:innen, Locations, DJs usw. schicken.
  Wer telefonisch zusagt, kann dort auch direkt von dir eingetragen werden.
- **Freigeben:** `https://finalsnap.de/ops/partners` (nur Admin-Konten aus `PAYMENT_ADMIN_EMAILS`).
  Beim Freigeben entsteht automatisch ein Empfehlungs-Code (z. B. `STUDIOLICH74`), der Partner bekommt ihn per E-Mail.
  Den Code kannst du unter „Bearbeiten“ ändern (z. B. `MUELLER10`). Dort auch Einsatzgebiete und Beschreibung anpassen.
- **Premium:** per Knopf; Premium-Partner stehen oben und tragen den Hinweis „Premium“ (Kennzeichnung bezahlter Platzierung).
- **Provision:** Die Verwaltung zeigt pro Partner „angelegt / bezahlt / Provision“. Ausgezahlt wird manuell (z. B. monatlich per Gutschrift).

## Regeln
- Rabatt für Kund:innen: 5 € (49,90 → 44,90 €). Provision: 10 € je bezahlter Buchung. Konstanten in `partners.js`.
- Region = die ersten zwei Ziffern der PLZ (Leitregion). Partner geben weitere Bereiche an („32, 59“). Keine externen Geodienste.
- Code einlösen: beim Anlegen (über `?ref=CODE`-Link, im Browser gemerkt) oder im Dashboard unter „Paket & Buchung“.
  Nach der Zahlung ist der Code fest. Ein abgelehnter/gelöschter Partner-Code gibt keinen Rabatt mehr.
- Paare können optional die PLZ der Location angeben und sehen dann „Dienstleister in eurer Nähe“.
  Partner erhalten keine Daten der Paare.

## Technik
- `partners.js`: Tabelle `partners`, Spalten `events.referral_partner_id` und `events.location_postcode`, alle Routen.
- Seiten: `public/partner.html` (Verzeichnis), `partner-signup.html`, `partners-admin.html`, Dashboard-Teil `partner-nearby.js`.
- Checkout nimmt den Preis aus `eventPriceCents(event)`; offene Stripe-Sitzungen mit altem Preis werden ersetzt.
- Test: `test/partners.test.js`.

## Onboarding (Stufe 1b)
- Öffentliche Kontaktdaten (Anfrage-E-Mail, Telefon, Instagram) getrennt von internen Kontaktdaten; mindestens ein Kontaktweg Pflicht.
- Kontakt-Knöpfe auf der Karte, Zähler je Tag (Anzeigen, Klicks) ohne Besucherbezug; Verwaltung zeigt die letzten 30 Tage.
- Premium immer mit Enddatum (Standard 12 Monate), danach automatisch kostenlos.
- Eigener Code für eigene Feiern gesperrt (gleiche E-Mail).
- Öffentliche Formulare funktionieren auch, wenn man bei FinalSnap angemeldet ist.
- Offene Geschäftsfragen: `App Entwickeln/Partner-Programm-Klaerung.md`.

## Provisionsabrechnung
- Entscheidung 26.11.2026: 5 € Rabatt, 10 € Provision netto; monatliche Gutschrift.
- Fällig 14 Tage nach Zahlung; erstattete oder widerrufene Buchungen zählen nicht; Auszahlung ab 25 €.
- `/ops/partners` → „Abrechnung“: Rechnungsdaten (Name, Anschrift, Steuernummer, Kleinunternehmer) eintragen → „Gutschrift erstellen“ → PDF senden → überweisen → „Als überwiesen markieren“.
- Nummern `GS-JJJJ-NNNN`, jede Buchung nur einmal abgerechnet. Keine Bankdaten in FinalSnap. Code: `partner-payouts.js`, Test `test/partner-payouts.test.js`.
- Gutschrift-Text von Steuerberatung prüfen lassen.

## Noch offen
- Rechtlich prüfen lassen: Partner-Bedingungen (Provision, Auszahlung, Kündigung), Hinweis zum Rabatt in den Leistungsbedingungen,
  Kennzeichnung „Premium“.
- Stufe 2: Partner-Login mit Statistik, „Euer Fotograf“-Hinweis im Album. Stufe 3: Premium als Abo über Stripe.
