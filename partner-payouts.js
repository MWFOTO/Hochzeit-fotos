// Provisionsabrechnung für Partner: monatliche Gutschrift (Gutschriftverfahren),
// Provision erst nach Ablauf der Widerrufsfrist, Auszahlung ab Mindestbetrag.
// Bankdaten werden bewusst NICHT gespeichert – überwiesen wird außerhalb von FinalSnap.
const crypto = require('node:crypto');
const PDFDocument = require('pdfkit');

const WITHDRAWAL_DAYS = 14;
const MIN_PAYOUT_CENTS = 2500;
const VAT_RATE = 19;
const ISSUER = {
  name: 'Matthias Wendland Fotografie (FinalSnap)',
  lines: ['Matthias Wendland Fotografie', 'Einzelunternehmen · FinalSnap', 'Kupferweg 10', '33334 Gütersloh'],
  vatId: 'DE350648288',
  email: 'info@finalsnap.de'
};
const euro = cents => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const berlinDate = ms => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium' }).format(new Date(ms));
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max);

function setupPayoutTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS partner_payouts (
      id TEXT PRIMARY KEY, number TEXT UNIQUE NOT NULL, partner_id TEXT NOT NULL, item_count INTEGER NOT NULL,
      net_cents INTEGER NOT NULL, vat_cents INTEGER NOT NULL, gross_cents INTEGER NOT NULL, small_business INTEGER NOT NULL,
      billing_json TEXT NOT NULL, period_from INTEGER NOT NULL, period_to INTEGER NOT NULL, created_at INTEGER NOT NULL, paid_at INTEGER, note TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS partner_payout_items (
      payment_id TEXT PRIMARY KEY, payout_id TEXT NOT NULL REFERENCES partner_payouts(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL, paid_at INTEGER NOT NULL, commission_cents INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS partner_payouts_partner ON partner_payouts(partner_id,created_at);`);
  const columns = new Set(db.prepare('PRAGMA table_info(partners)').all().map(x => x.name));
  for (const [name, type] of Object.entries({ billing_name: "TEXT NOT NULL DEFAULT ''", billing_address: "TEXT NOT NULL DEFAULT ''", tax_id: "TEXT NOT NULL DEFAULT ''", small_business: 'INTEGER NOT NULL DEFAULT 0' }))
    if (!columns.has(name)) db.exec(`ALTER TABLE partners ADD COLUMN ${name} ${type}`);
}

function createPartnerPayouts({ app, db, fail, wrap, paymentAdminRequired, commissionCents }) {
  setupPayoutTables(db);
  const cutoff = () => Date.now() - WITHDRAWAL_DAYS * 86400000;
  // Bezahlte, nicht erstattete/widerrufene Buchungen mit Partner-Code, die noch in keiner Gutschrift stehen.
  const openItems = partnerId => db.prepare(`SELECT p.id payment_id, e.id event_id, e.title, p.paid_at FROM payments p JOIN events e ON e.id=p.event_id
      WHERE e.referral_partner_id=? AND p.status='paid' AND p.paid_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM withdrawal_confirmations w WHERE w.payment_id=p.id)
      AND NOT EXISTS (SELECT 1 FROM partner_payout_items i WHERE i.payment_id=p.id)
      ORDER BY p.paid_at`).all(partnerId);
  const billingComplete = p => !!(p.billing_name && p.billing_address && p.tax_id);
  const vatFor = (net, small) => small ? 0 : Math.round(net * VAT_RATE / 100);

  function settlement(partner) {
    const limit = cutoff();
    const items = openItems(partner.id);
    const due = items.filter(i => i.paid_at <= limit), waiting = items.filter(i => i.paid_at > limit);
    const net = due.length * commissionCents;
    const payouts = db.prepare('SELECT id,number,item_count,net_cents,vat_cents,gross_cents,created_at,paid_at FROM partner_payouts WHERE partner_id=? ORDER BY created_at DESC').all(partner.id);
    return {
      partnerId: partner.id, company: partner.company, status: partner.status,
      billing: { name: partner.billing_name, address: partner.billing_address, taxId: partner.tax_id, smallBusiness: !!partner.small_business, complete: billingComplete(partner) },
      due: { count: due.length, netCents: net, vatCents: vatFor(net, partner.small_business), grossCents: net + vatFor(net, partner.small_business) },
      waiting: { count: waiting.length, netCents: waiting.length * commissionCents, nextDueAt: waiting.length ? waiting[0].paid_at + WITHDRAWAL_DAYS * 86400000 : null },
      canPayout: net >= MIN_PAYOUT_CENTS && billingComplete(partner),
      payouts
    };
  }

  app.get('/api/admin/partner-settlement', paymentAdminRequired, (req, res) => {
    const partners = db.prepare("SELECT * FROM partners WHERE status<>'deleted' OR EXISTS (SELECT 1 FROM partner_payouts WHERE partner_id=partners.id) ORDER BY company COLLATE NOCASE").all();
    const rows = partners.map(settlement).filter(s => s.status === 'approved' || s.due.count || s.waiting.count || s.payouts.length);
    res.json({ rules: { withdrawalDays: WITHDRAWAL_DAYS, minPayoutCents: MIN_PAYOUT_CENTS, commissionCents, vatRate: VAT_RATE }, partners: rows });
  });

  app.patch('/api/admin/partners/:partnerId/billing', paymentAdminRequired, (req, res) => {
    const partner = db.prepare('SELECT id FROM partners WHERE id=?').get(req.params.partnerId);
    if (!partner) return fail(res, 404, 'Partner nicht gefunden.');
    const b = req.body || {};
    const name = clean(b.name, 120), address = String(b.address ?? '').replace(/\r\n?/g, '\n').split('\n').map(l => clean(l, 80)).filter(Boolean).slice(0, 4).join('\n');
    const taxId = clean(b.taxId, 30);
    db.prepare('UPDATE partners SET billing_name=?,billing_address=?,tax_id=?,small_business=?,updated_at=? WHERE id=?').run(name, address, taxId, b.smallBusiness === true ? 1 : 0, Date.now(), partner.id);
    res.json({ success: true });
  });

  app.post('/api/admin/partners/:partnerId/payouts', paymentAdminRequired, (req, res) => {
    const partner = db.prepare('SELECT * FROM partners WHERE id=?').get(req.params.partnerId);
    if (!partner) return fail(res, 404, 'Partner nicht gefunden.');
    if (!billingComplete(partner)) return fail(res, 400, 'Bitte zuerst Rechnungsname, Anschrift und Steuernummer des Partners eintragen.');
    const create = db.transaction(() => {
      const limit = cutoff();
      const due = openItems(partner.id).filter(i => i.paid_at <= limit);
      const net = due.length * commissionCents;
      if (net < MIN_PAYOUT_CENTS) return null;
      const vat = vatFor(net, partner.small_business), now = Date.now();
      const year = new Date(now).getUTCFullYear();
      const last = db.prepare('SELECT number FROM partner_payouts WHERE number LIKE ? ORDER BY number DESC LIMIT 1').get(`GS-${year}-%`);
      const number = `GS-${year}-${String((last ? Number(last.number.slice(-4)) : 0) + 1).padStart(4, '0')}`;
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO partner_payouts (id,number,partner_id,item_count,net_cents,vat_cents,gross_cents,small_business,billing_json,period_from,period_to,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, number, partner.id, due.length, net, vat, net + vat, partner.small_business ? 1 : 0, JSON.stringify({ name: partner.billing_name, address: partner.billing_address, taxId: partner.tax_id, company: partner.company }), due[0].paid_at, due[due.length - 1].paid_at, now);
      const insert = db.prepare('INSERT INTO partner_payout_items (payment_id,payout_id,event_id,paid_at,commission_cents) VALUES (?,?,?,?,?)');
      for (const item of due) insert.run(item.payment_id, id, item.event_id, item.paid_at, commissionCents);
      return { id, number };
    });
    const created = create();
    if (!created) return fail(res, 409, `Auszahlung erst ab ${euro(MIN_PAYOUT_CENTS)} fälliger Provision.`);
    res.status(201).json(created);
  });

  app.patch('/api/admin/partner-payouts/:payoutId', paymentAdminRequired, (req, res) => {
    const payout = db.prepare('SELECT id FROM partner_payouts WHERE id=?').get(req.params.payoutId);
    if (!payout) return fail(res, 404, 'Gutschrift nicht gefunden.');
    db.prepare('UPDATE partner_payouts SET paid_at=? WHERE id=?').run(req.body?.paid === true ? Date.now() : null, payout.id);
    res.json({ success: true });
  });

  app.get('/api/admin/partner-payouts/:payoutId/gutschrift.pdf', paymentAdminRequired, (req, res) => {
    const payout = db.prepare('SELECT * FROM partner_payouts WHERE id=?').get(req.params.payoutId);
    if (!payout) return fail(res, 404, 'Gutschrift nicht gefunden.');
    const items = db.prepare('SELECT i.*, e.title FROM partner_payout_items i LEFT JOIN events e ON e.id=i.event_id WHERE payout_id=? ORDER BY i.paid_at').all(payout.id);
    res.type('pdf').set('Content-Disposition', `attachment; filename="${payout.number}.pdf"`);
    const pdf = creditNotePdf(payout, JSON.parse(payout.billing_json), items);
    pdf.pipe(res);
    pdf.end();
  });

  return { settlement };
}

function creditNotePdf(payout, billing, items) {
  const pdf = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Gutschrift ${payout.number}`, Author: 'FinalSnap' } });
  const left = 56, width = 483, dark = '#172b48', muted = '#596b85';
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(12).text('FinalSnap', left, 48);
  pdf.fillColor(muted).font('Helvetica').fontSize(8.5).text(`${ISSUER.lines.join(' · ')} · USt-IdNr. ${ISSUER.vatId}`, left, 64, { width });
  // Empfänger = leistender Unternehmer (Partner)
  pdf.fillColor(dark).font('Helvetica').fontSize(10.5).text([billing.name, ...String(billing.address).split('\n')].join('\n'), left, 120, { width: 260 });
  pdf.fillColor(muted).fontSize(9).text(`Gutschrift-Nr.\nDatum\nLeistungszeitraum`, 330, 120, { width: 90 });
  pdf.fillColor(dark).text(`${payout.number}\n${berlinDate(payout.created_at)}\n${berlinDate(payout.period_from)} – ${berlinDate(payout.period_to)}`, 420, 120, { width: 119 });
  pdf.fillColor(dark).font('Helvetica-Bold').fontSize(22).text('Gutschrift', left, 220);
  pdf.font('Helvetica').fontSize(10).fillColor(dark).text(`Provision für die Vermittlung von FinalSnap-Fotoalben über den Empfehlungs-Code von ${billing.company}. Die Abrechnung erfolgt im Gutschriftverfahren (§ 14 Abs. 2 Satz 2 UStG) gemäß den Partner-Bedingungen.`, left, 252, { width });
  pdf.fillColor(muted).fontSize(9).text(`Steuernummer / USt-IdNr. des Leistenden: ${billing.taxId}`, left, 290, { width });
  let y = 320;
  pdf.font('Helvetica-Bold').fontSize(9).fillColor(muted);
  pdf.text('Pos.', left, y, { width: 30 }); pdf.text('Album', left + 34, y, { width: 260 }); pdf.text('Bezahlt am', left + 300, y, { width: 90 }); pdf.text('Provision (netto)', left + 390, y, { width: 93, align: 'right' });
  y += 16; pdf.moveTo(left, y).lineTo(left + width, y).strokeColor('#d6dde8').stroke(); y += 6;
  pdf.font('Helvetica').fontSize(9.5).fillColor(dark);
  items.forEach((item, index) => {
    if (y > 700) { pdf.addPage(); y = 60; }
    pdf.text(String(index + 1), left, y, { width: 30 });
    pdf.text(item.event_id, left + 34, y, { width: 260, ellipsis: true, height: 12 });
    pdf.text(berlinDate(item.paid_at), left + 300, y, { width: 90 });
    pdf.text(euro(item.commission_cents), left + 390, y, { width: 93, align: 'right' });
    y += 18;
  });
  y += 6; pdf.moveTo(left + 260, y).lineTo(left + width, y).strokeColor('#d6dde8').stroke(); y += 10;
  const row = (label, value, bold) => { pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 10).fillColor(dark); pdf.text(label, left + 260, y, { width: 130 }); pdf.text(value, left + 390, y, { width: 93, align: 'right' }); y += bold ? 20 : 16; };
  row(`Summe netto (${payout.item_count} ${payout.item_count === 1 ? 'Album' : 'Alben'})`, euro(payout.net_cents));
  if (payout.small_business) row('Umsatzsteuer', '0,00 €'); else row(`Umsatzsteuer ${VAT_RATE} %`, euro(payout.vat_cents));
  row('Auszahlungsbetrag', euro(payout.gross_cents), true);
  y += 10;
  pdf.font('Helvetica').fontSize(9).fillColor(muted);
  if (payout.small_business) { pdf.text('Kein Ausweis von Umsatzsteuer, da der Leistende Kleinunternehmer im Sinne von § 19 UStG ist.', left, y, { width }); y += 16; }
  pdf.text('Der Betrag wird auf das uns bekannte Konto überwiesen. Bitte prüfe die Gutschrift; widersprichst du nicht innerhalb von 14 Tagen, gilt sie als anerkannt.', left, y, { width });
  pdf.text(`${ISSUER.name} · ${ISSUER.email}`, left, 740, { width, align: 'center', lineBreak: false });
  return pdf;
}

module.exports = { createPartnerPayouts, WITHDRAWAL_DAYS, MIN_PAYOUT_CENTS };
