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
- Die Checkout-Session wird technisch auf Deutsch gestellt, nutzt den Stripe-Zahlungstyp `pay` und zeigt neben dem Zahlungsbutton eine Zusammenfassung mit Preis, Umsatzsteuer, Leistungsumfang, Laufzeit und Anbieter. Die tatsächliche Darstellung im Stripe-Checkout ist noch nicht visuell abgenommen; die letzte Bestellschaltfläche und die hervorgehobenen Pflichtangaben müssen § 312j BGB entsprechen.
- Ein vollständiger Refund beendet derzeit den Albumzugang; bei Teilrefund bleibt er bestehen. Während eines offenen Streitfalls bleibt der Zugang bestehen; bei verlorenem Streitfall endet er und bei erfolgreicher Wiederherstellung kann er zurückkehren. Zwingende Kundenrechte bleiben davon unberührt.

## Bitte fachkundig entscheiden und prüfen

1. **Vertragstyp und Leistungsbeginn:** Ist das Paket rechtlich als digitale Dienstleistung, digitaler Inhalt oder gemischter Vertrag einzuordnen? Wann beginnt FinalSnap mit der Vertragserfüllung: beim Kauf, bei der Vorbereitung, am Veranstaltungsdatum oder schrittweise?
2. **Widerruf:** Welche Widerrufsbelehrung und welches Musterformular sind zu verwenden? Welche Einwilligung bzw. ausdrückliche Aufforderung ist erforderlich, falls eine Privatperson den Leistungsbeginn vor Ablauf der Widerrufsfrist verlangt? Welche Folgen hat ein Widerruf während des 90-Tage-Zeitraums? Keine pauschale Erlöschens-Erklärung einbauen, bevor diese Einordnung feststeht.
3. **Bestellschritt:** Welche Produkt-, Laufzeit-, Preis-, Zahlungs- und Löschinformationen müssen unmittelbar vor Bestellung stehen? Ist der Text der Stripe-Checkout-Schaltfläche hinreichend eindeutig und wie werden die Vertragsinformationen auf einem dauerhaften Datenträger bestätigt? § 312f BGB verlangt eine Vertragsbestätigung auf einem dauerhaften Datenträger; im Testcheckout ist E-Mail-Zustellung eines vollständigen Vertragstextes samt Widerrufsinformation nachzuweisen.
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

Nach schriftlicher Entscheidung die Verbraucherinformationen und Vertragsbestätigung veröffentlichen, die passenden Einwilligungsfelder und den Checkout implementieren und im Stripe-Testmodus testen. Erst danach Checkout und Rechnungs-PDFs für deutsche Privat- und Geschäftskunden abnehmen. Livezahlungen bleiben bis zu einer gesonderten Freigabe gesperrt.
