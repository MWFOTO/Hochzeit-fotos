# FinalSnap – Prüfbrief für Bestellablauf und Verbraucherinformationen

Stand: 4. November 2026. Interner Sachstand für fachkundige Prüfung; kein veröffentlichter Rechtstext und keine Rechtsberatung.

## Produktfakten

- Betreiber: Matthias Wendland, Matthias Wendland Fotografie, Einzelunternehmen, Kupferweg 10, 33334 Gütersloh, Deutschland; Kontakt `info@finalsnap.de`.
- Verkauf zunächst nur in Deutschland, an Privat- und Geschäftskunden.
- Einmalpreis: 49,90 € einschließlich 19 % deutscher Umsatzsteuer.
- Ein Paket je Veranstaltung; bis zu 25 GB verarbeitete Fotos, keine feste Fotoanzahl.
- Albumstart am vom Kunden angegebenen Veranstaltungsdatum. Das Album ist 90 Tage ab diesem Datum für Upload, Ansicht und Download verfügbar; danach löscht die Anwendung Fotos und Gästebucheinträge automatisch. Es gibt keine zusätzliche Downloadphase.
- Vor dem Veranstaltungsdatum sind bis zu 25 Testfotos kostenlos. Bei Buchung bleiben sie erhalten und zählen ab dem Albumstart zum Speicherlimit.
- Uploads werden auf maximal 2.560 Pixel und JPEG-Qualität 82 verarbeitet. Originaldateien werden nicht behalten.
- Stripe ist ausschließlich im Testbetrieb; der Livebetrieb ist gesperrt. Steuerberechnung und Rechnungserstellung über Stripe sind noch nicht im Testcheckout abgenommen.
- Der Checkout verlangt die Annahme der versionierten Leistungsbedingungen und protokolliert Zeitstempel und Version. Bei bestätigter Testzahlung wird eine Vertragsbestätigung mit Preis, Laufzeit, wesentlichen Bedingungen und Widerrufsinformation samt Musterformular an die Konto-E-Mail in eine persistente Versandwarteschlange gestellt. Versand, Darstellung und konkrete Rechnungs-/USt.-Angaben sind im echten Stripe-/Brevo-Konto noch praktisch abzunehmen.
- Verbraucher können den Widerruf im Kundenkonto elektronisch erklären. Die hervorgehobene Funktion „Vertrag widerrufen“ identifiziert das Album, bestätigt Name und E-Mail-Adresse und verlangt danach den zweiten Schritt „Widerruf bestätigen“. Erklärung, Zeitpunkt, Versandstatus und Betreiberalarm werden gespeichert; die Eingangsbestätigung enthält Erklärungstext sowie Datum/Uhrzeit. E-Mail-Zustellung und Wiederholungsversand müssen im Brevo-Test noch praktisch abgenommen werden. Gesetzesquelle: [BGB § 356a](https://www.gesetze-im-internet.de/bgb/__356a.html).
- Die Checkout-Session wird technisch auf Deutsch gestellt, nutzt den Stripe-Zahlungstyp `pay` und zeigt neben dem Zahlungsbutton eine Zusammenfassung mit Preis, Umsatzsteuer, Leistungsumfang, Laufzeit und Anbieter. Die tatsächliche Darstellung im Stripe-Checkout ist noch nicht visuell abgenommen; die letzte Bestellschaltfläche und die hervorgehobenen Pflichtangaben müssen § 312j BGB entsprechen.
- Geschäftsentscheidung vom 5. November 2026: Auch nach vollständiger Erstattung bleibt der Albumzugang bis zum gebuchten Ablaufdatum bestehen. Die Implementierung wurde dafür angepasst; der Testkauf/Refund-Ablauf und die Kundenanzeige müssen nach Deployment noch praktisch geprüft werden. Während eines offenen Streitfalls bleibt der Zugang bestehen; bei verlorenem Streitfall endet er und bei erfolgreicher Wiederherstellung kann er zurückkehren. Zwingende Kundenrechte bleiben davon unberührt.

## Bitte fachkundig entscheiden und prüfen

1. **Vertragstyp und Leistungsbeginn:** Ist das Paket rechtlich als digitale Dienstleistung, digitaler Inhalt oder gemischter Vertrag einzuordnen? Wann beginnt FinalSnap mit der Vertragserfüllung: beim Kauf, bei der Vorbereitung, am Veranstaltungsdatum oder schrittweise?
2. **Widerruf:** Fachkundig prüfen, ob Widerrufsbelehrung, vorzeitiger Leistungsbeginn und Wertersatz zur konkreten Vertragsklassifikation passen. Die Online-Funktion nach § 356a BGB und Eingangsbestätigung sind implementiert; deren E-Mail-Zustellung im Testbetrieb nachweisen.
3. **Bestellschritt:** Welche Produkt-, Laufzeit-, Preis-, Zahlungs- und Löschinformationen müssen unmittelbar vor Bestellung stehen? Ist der Text der Stripe-Checkout-Schaltfläche hinreichend eindeutig? Im Produktcode ist eine E-Mail-Vertragsbestätigung samt Bedingungen und Widerrufsinformation mit wiederholbarem Versand angelegt; im Stripe-/Brevo-Testkonto sind Zustellung, vollständige Fassung und dauerhafte Abrufbarkeit noch praktisch nachzuweisen.
4. **B2B/B2C und Steuern:** Sind die Angaben `49,90 € inkl. 19 % USt.` und die Stripe-Rechnung für beide Kundengruppen richtig? Welche Angaben zur Verkäuferidentität, Steuernummer/USt-IdNr. und Rechnungsnummer sind auf Rechnung/Beleg nötig? Wie werden Firmenname und USt-IdNr. erhoben und auf der Rechnung ausgegeben?
5. **Leistung und Mängel:** Prüfen, ob Leistungsbeschreibung, technische Grenzen, Komprimierung, Browser-/Geräteanforderungen, Support, Verfügbarkeit, Störungen und Umgang mit Datenverlust ausreichend klar sind.
6. **Löschung und Backups:** Die aktive Albumlöschung erfolgt 90 Tage ab Veranstaltungsdatum. Als technische Backup-Fristen sind tägliche Datenbanksicherungen für 30 Tage und Fotokopien bis höchstens 7 Tage nach aktiver Albumlöschung festgelegt. Der Sicherungsdienst ist noch deaktiviert. Vor Aktivierung müssen diese Fristen in den Datenschutzhinweisen genannt und fachlich bestätigt werden; Zahlungs-/Rechnungsnachweise sind davon getrennt.
7. **Datenschutzrollen:** Vertragsrollen zwischen Veranstalter und FinalSnap für Fotos von Gästen, Löschersuchen, Meldungen unzulässiger Inhalte und Auskunftsanfragen klären; nötige Vereinbarung zur Auftragsverarbeitung prüfen.

## Quellen für die Prüfung

- [BGB § 312j – Verbraucherbestellung im elektronischen Geschäftsverkehr](https://www.gesetze-im-internet.de/bgb/__312j.html)
- [BGB § 312f – Vertragsbestätigung auf dauerhaftem Datenträger](https://www.gesetze-im-internet.de/bgb/__312f.html)
- [BGB § 356 – Widerruf und Beginn digitaler Inhalte/Dienstleistungen](https://www.gesetze-im-internet.de/bgb/__356.html)
- [PAngV § 3 – Gesamtpreis](https://www.gesetze-im-internet.de/pangv_2022/__3.html)

## Umsetzung nach der Prüfung

Die Checkout-Bestätigungen, Verbraucherinformationen, elektronische Widerrufsfunktion und Vertragsbestätigung sind im Produktcode umgesetzt. Die rechtliche Einordnung, Rechtstexte, tatsächliche Stripe-Darstellung sowie E-Mail- und Rechnungszustellung müssen noch fachkundig beziehungsweise im Testbetrieb abgenommen werden. Erst danach Checkout und Rechnungs-PDFs für deutsche Privat- und Geschäftskunden freigeben. Livezahlungen bleiben bis zu einer gesonderten Freigabe gesperrt.
