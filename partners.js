// Partner-Programm: regionales Dienstleister-Verzeichnis und Empfehlungs-Codes.
// Regionen werden über die ersten zwei Ziffern der Postleitzahl (Leitregion)
// abgeglichen – ohne externe Geodienste, alles bleibt in der eigenen Datenbank.
const crypto = require('node:crypto');
const path = require('node:path');
const multer = require('multer');
const sharp = require('sharp');
const { rateLimit } = require('express-rate-limit');

const PARTNER_CATEGORIES = {
  photographer: 'Fotograf:in',
  videographer: 'Videograf:in',
  location: 'Location',
  music: 'DJ & Musik',
  flowers: 'Floristik & Deko',
  cake: 'Konditorei & Catering',
  planner: 'Hochzeits- & Eventplanung',
  officiant: 'Freie Trauung & Redner:in',
  styling: 'Styling, Haare & Make-up',
  other: 'Weitere Dienstleister'
};
const REFERRAL_DISCOUNT_CENTS = 500;
const PARTNER_COMMISSION_CENTS = 1000;
const LIMITS = { company:80, contactName:80, email:120, phone:40, website:200, description:600, city:60 };

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanText = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const validPostcode = value => /^\d{5}$/.test(String(value || ''));
const normalizeCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
const validCode = value => /^[A-Z0-9][A-Z0-9-]{3,19}$/.test(value);

function parseRegions(value, postcode) {
  const regions = new Set();
  if (validPostcode(postcode)) regions.add(postcode.slice(0, 2));
  for (const part of String(value || '').split(/[^0-9]+/)) if (/^\d{2}$/.test(part)) regions.add(part);
  return [...regions].sort().slice(0, 20);
}
function normalizeWebsite(value) {
  const raw = clean(value, LIMITS.website);
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    return url.href;
  } catch { return null; }
}
function slugify(value) {
  return String(value || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'partner';
}

function setupPartnerTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, company TEXT NOT NULL, category TEXT NOT NULL,
    contact_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '',
    postcode TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', regions TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    logo BLOB, status TEXT NOT NULL DEFAULT 'pending', premium INTEGER NOT NULL DEFAULT 0,
    referral_code TEXT UNIQUE, consent_at INTEGER NOT NULL, created_at INTEGER NOT NULL, approved_at INTEGER, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS partners_status ON partners(status,premium,company);`);
  const columns = new Set(db.prepare('PRAGMA table_info(events)').all().map(x => x.name));
  for (const [name, type] of Object.entries({ referral_partner_id: 'TEXT', location_postcode: 'TEXT' }))
    if (!columns.has(name)) db.exec(`ALTER TABLE events ADD COLUMN ${name} ${type}`);
}

function createPartnerProgram({ app, db, cfg, baseUrl, mailer, fail, wrap, loginRequired, owner, paymentAdminRequired, adminEmails, basePriceCents }) {
  setupPartnerTables(db);
  const signupLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });
  const referralLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 20, parts: 21 } }).single('logo');

  const partnerById = id => db.prepare('SELECT * FROM partners WHERE id=?').get(id);
  const partnerByCode = code => validCode(code) ? db.prepare("SELECT * FROM partners WHERE referral_code=? AND status='approved'").get(code) : null;
  const eventPriceCents = event => {
    if (!event?.referral_partner_id) return basePriceCents;
    const partner = db.prepare("SELECT status FROM partners WHERE id=?").get(event.referral_partner_id);
    return partner?.status === 'approved' ? basePriceCents - REFERRAL_DISCOUNT_CENTS : basePriceCents;
  };
  const publicPartner = p => ({
    id: p.id, slug: p.slug, company: p.company, category: p.category, categoryLabel: PARTNER_CATEGORIES[p.category] || PARTNER_CATEGORIES.other,
    website: p.website, city: p.city, postcode: p.postcode, regions: p.regions.split(',').filter(Boolean), description: p.description,
    premium: !!p.premium, logoUrl: p.logo ? `/api/partners/${encodeURIComponent(p.id)}/logo?v=${p.updated_at}` : null
  });
  function uniqueCode(company) {
    const stem = slugify(company).replace(/-/g, '').toUpperCase().slice(0, 10) || 'PARTNER';
    for (let i = 0; i < 20; i++) {
      const code = `${stem}${String(crypto.randomInt(10, 100))}`;
      if (!db.prepare('SELECT 1 FROM partners WHERE referral_code=?').get(code)) return code;
    }
    return `P${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  }
  function uniqueSlug(company, city) {
    const base = slugify(`${company} ${city}`);
    let slug = base;
    for (let i = 2; db.prepare('SELECT 1 FROM partners WHERE slug=?').get(slug); i++) slug = `${base}-${i}`;
    return slug;
  }
  async function notify(message) {
    try { await mailer(message); } catch (error) { console.error('Partner-Mail fehlgeschlagen:', String(error.message || error)); }
  }
  function findNearby(postcode, category, limit = 60) {
    const region = validPostcode(postcode) ? postcode.slice(0, 2) : /^\d{2}$/.test(String(postcode || '')) ? String(postcode) : null;
    const params = [];
    let sql = "SELECT * FROM partners WHERE status='approved'";
    if (region) { sql += " AND (','||regions||',') LIKE ?"; params.push(`%,${region},%`); }
    if (category && PARTNER_CATEGORIES[category]) { sql += ' AND category=?'; params.push(category); }
    sql += ' ORDER BY premium DESC, company COLLATE NOCASE LIMIT ?'; params.push(limit);
    return db.prepare(sql).all(...params).map(publicPartner);
  }

  // ---- Öffentliche Seiten ----
  const pub = path.join(__dirname, 'public');
  app.get('/partner', (req, res) => res.sendFile(path.join(pub, 'partner.html')));
  app.get('/partner/anmelden', (req, res) => res.sendFile(path.join(pub, 'partner-signup.html')));
  app.get('/ops/partners', paymentAdminRequired, (req, res) => res.sendFile(path.join(pub, 'partners-admin.html')));

  app.get('/api/partners', (req, res) => {
    const postcode = String(req.query.plz || '').trim();
    const category = String(req.query.category || '');
    res.json({ categories: PARTNER_CATEGORIES, partners: findNearby(postcode, category) });
  });
  app.get('/api/partners/:partnerId/logo', (req, res) => {
    const partner = db.prepare("SELECT logo,status FROM partners WHERE id=?").get(req.params.partnerId);
    if (!partner?.logo || partner.status !== 'approved') return fail(res, 404, 'Kein Logo vorhanden.');
    res.type('webp').set('Cache-Control', 'public, max-age=86400').send(partner.logo);
  });

  app.post('/api/partners/signup', signupLimit, (req, res, next) => logoUpload(req, res, err => err ? fail(res, 400, err.code === 'LIMIT_FILE_SIZE' ? 'Das Logo darf höchstens 4 MB groß sein.' : 'Die Anmeldung konnte nicht gelesen werden.') : next()), wrap(async (req, res) => {
    const body = req.body || {};
    if (clean(body.website_confirm, 20)) return res.status(201).json({ success: true });
    const data = {
      company: clean(body.company, LIMITS.company), category: String(body.category || ''), contactName: clean(body.contactName, LIMITS.contactName),
      email: clean(body.email, LIMITS.email).toLowerCase(), phone: clean(body.phone, LIMITS.phone), postcode: clean(body.postcode, 5),
      city: clean(body.city, LIMITS.city), description: cleanText(body.description, LIMITS.description)
    };
    const website = normalizeWebsite(body.website);
    if (data.company.length < 2) return fail(res, 400, 'Bitte den Namen deines Unternehmens angeben.');
    if (!PARTNER_CATEGORIES[data.category]) return fail(res, 400, 'Bitte eine Kategorie wählen.');
    if (data.contactName.length < 2) return fail(res, 400, 'Bitte eine Ansprechperson angeben.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return fail(res, 400, 'Bitte eine gültige E-Mail-Adresse angeben.');
    if (!validPostcode(data.postcode)) return fail(res, 400, 'Bitte eine fünfstellige Postleitzahl angeben.');
    if (website === null) return fail(res, 400, 'Die Webseite sieht nicht wie eine gültige Adresse aus.');
    if (body.consent !== 'true') return fail(res, 400, 'Bitte bestätige, dass dein Eintrag veröffentlicht werden darf.');
    let logo = null;
    if (req.file) {
      try { logo = await sharp(req.file.buffer).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 86 }).toBuffer(); }
      catch { return fail(res, 400, 'Das Logo konnte nicht gelesen werden. Bitte JPG, PNG oder WebP verwenden.'); }
    }
    const now = Date.now(), id = crypto.randomUUID();
    db.prepare(`INSERT INTO partners (id,slug,company,category,contact_name,email,phone,website,postcode,city,regions,description,logo,status,premium,consent_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,?,?,?)`).run(id, uniqueSlug(data.company, data.city), data.company, data.category, data.contactName, data.email, data.phone, website || '', data.postcode, data.city, parseRegions(body.regions, data.postcode).join(','), data.description, logo, now, now, now);
    for (const to of adminEmails) await notify({ to, subject: `Neue Partner-Anmeldung: ${data.company}`, text: [`${data.company} (${PARTNER_CATEGORIES[data.category]}) aus ${data.postcode} ${data.city} möchte Partner werden.`, `Ansprechperson: ${data.contactName}, ${data.email}`, '', `Prüfen und freigeben: ${baseUrl.origin}/ops/partners`].join('\n') });
    res.status(201).json({ success: true, message: 'Danke! Wir prüfen deine Anmeldung und melden uns per E-Mail, sobald dein Eintrag freigeschaltet ist.' });
  }));

  // ---- Verwaltung ----
  app.get('/api/admin/partners', paymentAdminRequired, (req, res) => {
    const rows = db.prepare("SELECT * FROM partners WHERE status<>'deleted' ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, created_at DESC").all();
    const stats = db.prepare(`SELECT e.referral_partner_id id, COUNT(*) referred,
      SUM(CASE WHEN p.status='paid' THEN 1 ELSE 0 END) paid
      FROM events e LEFT JOIN payments p ON p.event_id=e.id WHERE e.referral_partner_id IS NOT NULL GROUP BY e.referral_partner_id`).all();
    const byId = new Map(stats.map(s => [s.id, s]));
    res.json({ categories: PARTNER_CATEGORIES, commissionCents: PARTNER_COMMISSION_CENTS, discountCents: REFERRAL_DISCOUNT_CENTS, partners: rows.map(p => {
      const s = byId.get(p.id) || { referred: 0, paid: 0 };
      return { ...publicPartner(p), logoUrl: p.logo ? `/api/admin/partners/${encodeURIComponent(p.id)}/logo?v=${p.updated_at}` : null, contactName: p.contact_name, email: p.email, phone: p.phone, status: p.status, referralCode: p.referral_code, createdAt: p.created_at, approvedAt: p.approved_at, referred: Number(s.referred || 0), paid: Number(s.paid || 0), commissionCents: Number(s.paid || 0) * PARTNER_COMMISSION_CENTS };
    }) });
  });
  app.get('/api/admin/partners/:partnerId/logo', paymentAdminRequired, (req, res) => {
    const partner = db.prepare('SELECT logo FROM partners WHERE id=?').get(req.params.partnerId);
    if (!partner?.logo) return fail(res, 404, 'Kein Logo vorhanden.');
    res.type('webp').send(partner.logo);
  });
  app.patch('/api/admin/partners/:partnerId', paymentAdminRequired, wrap(async (req, res) => {
    const partner = partnerById(req.params.partnerId);
    if (!partner) return fail(res, 404, 'Partner nicht gefunden.');
    const body = req.body || {};
    const next = { status: partner.status, premium: partner.premium, referral_code: partner.referral_code, regions: partner.regions, description: partner.description, approved_at: partner.approved_at };
    if (body.status !== undefined) {
      if (!['pending', 'approved', 'rejected'].includes(body.status)) return fail(res, 400, 'Ungültiger Status.');
      next.status = body.status;
      if (body.status === 'approved' && !next.approved_at) next.approved_at = Date.now();
    }
    if (body.premium !== undefined) next.premium = body.premium === true ? 1 : 0;
    if (body.regions !== undefined) next.regions = parseRegions(body.regions, partner.postcode).join(',');
    if (body.description !== undefined) next.description = cleanText(body.description, LIMITS.description);
    if (body.referralCode !== undefined) {
      const code = normalizeCode(body.referralCode);
      if (!validCode(code)) return fail(res, 400, 'Der Code braucht 4 bis 20 Zeichen (Buchstaben, Zahlen, Bindestrich).');
      if (db.prepare('SELECT 1 FROM partners WHERE referral_code=? AND id<>?').get(code, partner.id)) return fail(res, 409, 'Dieser Code ist schon vergeben.');
      next.referral_code = code;
    }
    if (next.status === 'approved' && !next.referral_code) next.referral_code = uniqueCode(partner.company);
    db.prepare('UPDATE partners SET status=?,premium=?,referral_code=?,regions=?,description=?,approved_at=?,updated_at=? WHERE id=?').run(next.status, next.premium, next.referral_code, next.regions, next.description, next.approved_at, Date.now(), partner.id);
    if (partner.status !== 'approved' && next.status === 'approved') {
      await notify({ to: partner.email, subject: 'Dein FinalSnap-Partnereintrag ist freigeschaltet', text: [
        `Hallo ${partner.contact_name},`, '',
        `dein Eintrag „${partner.company}“ ist jetzt im FinalSnap-Partnerverzeichnis sichtbar:`, `${baseUrl.origin}/partner?plz=${partner.postcode}`, '',
        `Dein persönlicher Empfehlungs-Code: ${next.referral_code}`,
        `Paare sparen damit ${(REFERRAL_DISCOUNT_CENTS / 100).toFixed(2).replace('.', ',')} € auf ihr FinalSnap-Album. Für jede bezahlte Buchung mit deinem Code erhältst du ${(PARTNER_COMMISSION_CENTS / 100).toFixed(2).replace('.', ',')} € Provision.`,
        `Direkter Link für deine Kund:innen: ${baseUrl.origin}/?ref=${encodeURIComponent(next.referral_code)}`, '',
        'Viele Grüße', 'FinalSnap'
      ].join('\n') });
    }
    res.json({ success: true });
  }));
  app.delete('/api/admin/partners/:partnerId', paymentAdminRequired, (req, res) => {
    const partner = partnerById(req.params.partnerId);
    if (!partner) return fail(res, 404, 'Partner nicht gefunden.');
    db.transaction(() => {
      // Bezahlte Vermittlungen bleiben als Zahl erhalten, verlieren aber den Bezug.
      db.prepare('UPDATE events SET referral_partner_id=NULL WHERE referral_partner_id=? AND status IN (\'pending\',\'trial\')').run(partner.id);
      db.prepare("UPDATE partners SET status='deleted',company='Gelöschter Partner',contact_name='',email='',phone='',website='',description='',logo=NULL,city='',updated_at=? WHERE id=?").run(Date.now(), partner.id);
    })();
    res.json({ success: true });
  });

  // ---- Für Veranstalter ----
  app.get('/api/event/:eventId/partners', loginRequired, owner, (req, res) => {
    const postcode = req.event.location_postcode || '';
    const referral = req.event.referral_partner_id ? db.prepare('SELECT company,referral_code FROM partners WHERE id=? AND status=\'approved\'').get(req.event.referral_partner_id) : null;
    res.json({ postcode, partners: postcode ? findNearby(postcode, '', 6) : [], referral: referral ? { company: referral.company, code: referral.referral_code } : null, priceCents: eventPriceCents(req.event), basePriceCents, discountCents: REFERRAL_DISCOUNT_CENTS });
  });
  app.patch('/api/event/:eventId/location', loginRequired, owner, (req, res) => {
    const postcode = clean(req.body?.postcode, 5);
    if (postcode && !validPostcode(postcode)) return fail(res, 400, 'Bitte eine fünfstellige Postleitzahl angeben.');
    db.prepare('UPDATE events SET location_postcode=? WHERE id=?').run(postcode || null, req.event.id);
    res.json({ success: true, postcode });
  });
  app.post('/api/event/:eventId/referral', referralLimit, loginRequired, owner, (req, res) => {
    const e = req.event;
    const payment = db.prepare('SELECT status FROM payments WHERE event_id=?').get(e.id);
    if (!['pending', 'trial'].includes(e.status) || (payment && payment.status !== 'pending')) return fail(res, 409, 'Für dieses Album kann kein Code mehr eingelöst werden.');
    const code = normalizeCode(req.body?.code);
    if (!code) { db.prepare('UPDATE events SET referral_partner_id=NULL WHERE id=?').run(e.id); return res.json({ success: true, referral: null, priceCents: basePriceCents }); }
    const partner = partnerByCode(code);
    if (!partner) return fail(res, 404, 'Diesen Empfehlungs-Code kennen wir nicht. Bitte prüfe die Schreibweise.');
    db.prepare('UPDATE events SET referral_partner_id=? WHERE id=?').run(partner.id, e.id);
    res.json({ success: true, referral: { company: partner.company, code: partner.referral_code }, priceCents: basePriceCents - REFERRAL_DISCOUNT_CENTS });
  });

  // Beim Anlegen einer Feier: optionaler Code und Location-PLZ.
  function applyToNewEvent(eventId, body) {
    const postcode = clean(body?.locationPostcode, 5);
    const partner = body?.referralCode ? partnerByCode(normalizeCode(body.referralCode)) : null;
    db.prepare('UPDATE events SET location_postcode=?, referral_partner_id=? WHERE id=?').run(validPostcode(postcode) ? postcode : null, partner?.id || null, eventId);
    return { referralApplied: !!partner };
  }

  return { eventPriceCents, applyToNewEvent, categories: PARTNER_CATEGORIES };
}

module.exports = { createPartnerProgram, PARTNER_CATEGORIES, REFERRAL_DISCOUNT_CENTS, PARTNER_COMMISSION_CENTS, parseRegions };
