const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const euro = cents => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`;
const date = value => value ? new Date(value).toLocaleDateString('de-DE',{dateStyle:'long',timeZone:'Europe/Berlin'}) : 'mit Freischaltung';
const bytes = value => Number(value) >= 1024 ** 3
  ? `${(Number(value) / 1024 ** 3).toLocaleString('de-DE',{maximumFractionDigits:1})} GB`
  : `${Math.round(Number(value) / 1024 ** 2).toLocaleString('de-DE')} MB`;

function createContractConfirmation({confirmation, baseUrl, storageLimitBytes, invoiceNumber, invoiceUrl, isTestMode}) {
  const amount = euro(confirmation.amount_cents);
  const start = date(confirmation.event_date ? `${confirmation.event_date}T12:00:00Z` : null);
  const event = escapeHtml(confirmation.title);
  const eventId = escapeHtml(confirmation.album_id);
  const storage = bytes(storageLimitBytes);
  const legalText = [
    'VERTRAGSBEDINGUNGEN – Fassung '+(confirmation.terms_version||'2026-11-04-2'),
    'Anbieter: Matthias Wendland – Matthias Wendland Fotografie, Kupferweg 10, 33334 Gütersloh, Deutschland; info@finalsnap.de.',
    '1. Geltung: Diese Bedingungen gelten für das kostenpflichtige FinalSnap-Fotoalbum. Verbraucher und Unternehmen können buchen. Unternehmen handeln bei einer Geschäftskundenbuchung im Rahmen ihrer gewerblichen oder selbstständigen Tätigkeit. Zwingende Verbraucherrechte bleiben unberührt.',
    `2. Vertrag und Preis: Für diese Bestellung wurde einmalig ${amount} einschließlich der gesetzlichen Umsatzsteuer berechnet. Es gibt keine laufende Abonnementgebühr. Der Vertrag kommt mit bestätigter Zahlung und Freischaltung zustande.`,
    `3. Leistung: Das Fotoalbum beginnt am angegebenen Veranstaltungsdatum und ist ab diesem Datum 90 Tage für Upload, Ansicht und Download verfügbar. Je Veranstaltung stehen bis zu ${storage} für verarbeitete Fotos zur Verfügung. Uploads werden auf höchstens 2.560 Pixel längste Kante verkleinert und als JPEG komprimiert; unveränderte Originaldateien und Videos sind nicht enthalten. Nach Ende des Albumzeitraums endet der Zugang; Fotos und Gästebucheinträge werden nach dem beschriebenen Löschablauf entfernt.`,
    '4. Nutzung: Der Veranstalter verwaltet das Album und teilt Gästen Link oder QR-Code. Er ist dafür verantwortlich, Zugänge nur berechtigten Gästen zu geben, Gäste geeignet zu informieren und nur Inhalte mit den erforderlichen Rechten zu teilen. Unzulässige Inhalte können gemeldet und entfernt werden.',
    '5. Verfügbarkeit und Support: Für die Nutzung sind Internetverbindung, geeignetes Gerät und aktueller Browser erforderlich. Wir bemühen uns um zuverlässigen Betrieb, schulden aber keine ununterbrochene oder jederzeit fehlerfreie Verfügbarkeit. Wartung und Störungen können den Dienst beeinträchtigen. Support: info@finalsnap.de. Gesetzliche Rechte bleiben bestehen.',
    '6. Zahlung und Erstattung: Die einmalige Zahlung erfolgt über Stripe. Nach erfolgreicher Zahlung wird der Albumdienst freigeschaltet. Gesetzliche Erstattungsansprüche bleiben unberührt. Eine freiwillige vollständige Erstattung beendet nach ihrer Bestätigung den Albumzugang; zwingende Rechte haben Vorrang.',
    '7. Datenschutz und Löschung: Einzelheiten zur Verarbeitung und zu Dienstleistern stehen unter '+baseUrl+'/datenschutz. Gesetzliche Aufbewahrungspflichten für Zahlungs- und Buchungsunterlagen bleiben unberührt.',
    '8. Recht: Es gilt deutsches Recht. Bei Verbrauchern gilt diese Rechtswahl nur, soweit dadurch nicht der Schutz zwingender Bestimmungen ihres gewöhnlichen Aufenthaltsstaates entzogen wird.',
    '',
    'WIDERRUFSBELEHRUNG FÜR VERBRAUCHER',
    'Sie können binnen vierzehn Tagen ab Vertragsschluss ohne Angabe von Gründen widerrufen. Zur Ausübung können Sie die Widerrufsfunktion in Ihrem Kundenkonto unter '+baseUrl+'/dashboard verwenden oder Matthias Wendland – Matthias Wendland Fotografie, Kupferweg 10, 33334 Gütersloh, Deutschland, info@finalsnap.de, mittels einer eindeutigen Erklärung (zum Beispiel Brief oder E-Mail) informieren. Zur Fristwahrung genügt die rechtzeitige Absendung.',
    'Im Fall des Widerrufs erstatten wir alle erhaltenen Zahlungen unverzüglich und spätestens binnen vierzehn Tagen ab Eingang Ihrer Mitteilung mit demselben Zahlungsmittel, sofern nichts anderes vereinbart wurde. Für die Rückzahlung berechnen wir kein Entgelt.',
    'Wenn Sie ausdrücklich verlangen, dass der entgeltliche Dienst während der Widerrufsfrist beginnt, kann bei einem späteren Widerruf angemessener Wertersatz für bis dahin erbrachte Leistungen anfallen, sofern die gesetzlichen Voraussetzungen erfüllt sind. Das Widerrufsrecht bei einer Dienstleistung erlischt erst mit vollständiger Vertragserfüllung und nur, wenn Sie dem vorzeitigen Beginn ausdrücklich zugestimmt und Ihre Kenntnis vom Erlöschen bei vollständiger Erfüllung bestätigt haben.',
    'Muster-Widerrufsformular: An Matthias Wendland – Matthias Wendland Fotografie, Kupferweg 10, 33334 Gütersloh, Deutschland, info@finalsnap.de: Hiermit widerrufe ich den Vertrag über das FinalSnap-Fotoalbum für die Veranstaltung __________. Bestellt am __________. Name __________. Anschrift __________. Datum __________. Unterschrift (nur bei Papiermitteilung) __________.',
    'Die Widerrufsinformation und das Musterformular stehen zusätzlich unter '+baseUrl+'/widerruf.',
    confirmation.early_start_requested_at&&confirmation.early_start_acknowledged_at?'Bei dieser Bestellung wurden das ausdrückliche Verlangen nach vorzeitigem Leistungsbeginn und die Bestätigung der Widerrufsfolgen gespeichert.':'Für diese Bestellung wurde kein vorzeitiger Leistungsbeginn innerhalb der Widerrufsfrist angefordert.'
  ];
  const subject = `Deine Bestellbestätigung und Rechnung · FinalSnap${isTestMode?' (Testbetrieb)':''}`;
  const text = [
    'BESTELLBESTÄTIGUNG UND ZAHLUNGSBELEG',
    isTestMode?'TESTBETRIEB: Es wurde kein echtes Geld eingezogen.':'',
    '',`Produkt: FinalSnap Fotoalbum für „${confirmation.title}” (${confirmation.album_id}).`,
    `Bezahlt: ${amount} einschließlich deutscher Umsatzsteuer.`,
    `Rechnungsnummer: ${invoiceNumber||'siehe beigefügte PDF-Rechnung'}.`,
    `Kundentyp: ${confirmation.customer_type==='business'?'Geschäftskunde':'Privatkunde'}.`,
    `Leistungsbeginn: ${start}. Laufzeit: 90 Tage ab Veranstaltungsdatum.`,
    `Fotospeicher dieses Albums: bis zu ${storage}. Fotos werden auf höchstens 2.560 Pixel längste Kante verkleinert und als JPEG komprimiert; Originaldateien und Videos sind nicht enthalten.`,
    '',invoiceUrl?`Die PDF-Rechnung ist als Datei angehängt. Sie kann außerdem über das Konto geöffnet werden: ${invoiceUrl}`:'Die PDF-Rechnung ist beigefügt.',
    '',...legalText,'',`Fragen: info@finalsnap.de · ${baseUrl}`
  ].filter(Boolean).join('\n');
  const section = (heading, body) => `<section style="margin:24px 0"><h2 style="font-size:17px;color:#182b48;margin:0 0 8px">${escapeHtml(heading)}</h2><p style="font-size:14px;line-height:1.6;color:#34445c;margin:0">${escapeHtml(body)}</p></section>`;
  const legalHtml = legalText.map(line=>line?`<p style="font-size:13px;line-height:1.65;color:#34445c;margin:0 0 12px">${escapeHtml(line)}</p>`:'').join('');
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#f3f6fa;font-family:Arial,Helvetica,sans-serif;color:#182b48"><main style="max-width:680px;margin:24px auto;padding:0 12px"><article style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden"><header style="padding:28px 32px;background:#172b48;color:#fff"><div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">FinalSnap</div><h1 style="font-size:25px;margin:10px 0 0">Bestellung bestätigt</h1></header><div style="padding:28px 32px"><p style="font-size:15px;line-height:1.6;margin:0 0 18px">Danke für deine Bestellung. Hier findest du die Zusammenfassung und die Vertragsinformationen.</p>${isTestMode?'<p style="padding:12px 14px;background:#fff7dd;border-radius:8px;color:#704c00;font-size:14px">Testbetrieb: Es wurde kein echtes Geld eingezogen. Dieses Album ist im Testbetrieb auf 250 MB Speicher begrenzt.</p>':''}<div style="padding:18px;background:#f3f6fa;border-radius:10px">${section('Dein Album',`FinalSnap Fotoalbum · ${confirmation.title} · Album-ID ${confirmation.album_id}`)}${section('Zahlung',`Bezahlt: ${amount} inkl. deutscher Umsatzsteuer · Rechnung ${invoiceNumber||'als PDF angehängt'}`)}${section('Leistungszeitraum',`Beginn: ${start} · 90 Tage ab Veranstaltungsdatum`)}${section('Fotospeicher',`Bis zu ${storage} verarbeitete Fotos. Uploads werden auf höchstens 2.560 Pixel längste Kante verkleinert und als JPEG komprimiert. Originaldateien und Videos sind nicht enthalten.`)}</div><p style="font-size:14px;line-height:1.6;margin:20px 0">Die PDF-Rechnung ist dieser E-Mail angehängt. Du kannst sie auch in deinem <a href="${escapeHtml(baseUrl)}/dashboard" style="color:#3e55d8">FinalSnap-Konto</a> aufrufen.</p><hr style="border:0;border-top:1px solid #e2e8f0;margin:26px 0"><h2 style="font-size:19px">Vertrags- und Widerrufsinformationen</h2>${legalHtml}<p style="font-size:13px;color:#596b85;margin-top:24px">Matthias Wendland · Matthias Wendland Fotografie · Kupferweg 10 · 33334 Gütersloh · <a href="mailto:info@finalsnap.de">info@finalsnap.de</a><br><a href="${escapeHtml(baseUrl)}/datenschutz">Datenschutz</a> · <a href="${escapeHtml(baseUrl)}/widerruf">Widerruf</a></p></div></article></main></body></html>`;
  return {subject,text,html};
}

module.exports={createContractConfirmation};
