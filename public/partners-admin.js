(() => {
  let csrf, filter = 'pending', partners = [], info = {};
  const status = document.getElementById('status'), root = document.getElementById('partners'), summary = document.getElementById('summary');
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const euro = cents => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  async function api(url, method = 'GET', body) {
    if (method !== 'GET' && !csrf) { const me = await fetch('/api/auth/me'); if (me.ok) csrf = (await me.json()).csrf; }
    const res = await fetch(url, { method, headers: { ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen.'); return data;
  }
  const statusLabel = { pending: 'Wartet auf Prüfung', approved: 'Freigeschaltet', rejected: 'Abgelehnt' };
  function render(p) {
    const card = el('article', undefined, 'event-card partner-admin-card');
    if (p.logoUrl) { const img = el('img', undefined, 'partner-logo'); img.src = p.logoUrl; img.alt = ''; card.append(img); } else card.append(el('div', p.company.slice(0, 1), 'partner-logo is-empty'));
    const body = el('div');
    const meta = el('div', undefined, 'partner-meta');
    meta.append(el('span', statusLabel[p.status] || p.status, 'partner-chip' + (p.status === 'approved' ? '' : ` is-${p.status}`)), el('span', p.categoryLabel, 'partner-chip'));
    const dateLabel = ms => new Date(ms).toLocaleDateString('de-DE', { dateStyle: 'medium' });
    if (p.premium) meta.append(el('span', p.premiumUntil ? `Premium bis ${dateLabel(p.premiumUntil)}` : 'Premium', 'partner-chip is-premium'));
    else if (p.premiumFlag && p.premiumUntil) meta.append(el('span', `Premium abgelaufen am ${dateLabel(p.premiumUntil)}`, 'partner-chip is-rejected'));
    body.append(meta, el('h2', p.company));
    const dl = el('dl');
    const row = (k, v) => { if (!v && v !== 0) return; dl.append(el('dt', k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); };
    row('Ort', `${p.postcode} ${p.city}`.trim()); row('Einsatzgebiete', p.regions.map(r => r + 'xxx').join(', '));
    row('Intern', `${p.contactName} · ${p.email}${p.phone ? ' · ' + p.phone : ''}`);
    row('Öffentlich', [p.publicEmail, p.publicPhone, p.instagram ? '@' + p.instagram : ''].filter(Boolean).join(' · ') || '–');
    if (p.website) { const a = el('a', p.website); a.href = p.website; a.target = '_blank'; a.rel = 'noopener nofollow'; row('Webseite', a); }
    row('Angemeldet', new Date(p.createdAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }));
    if (p.referralCode) row('Empfehlungs-Code', p.referralCode);
    const c = p.clicks30 || {};
    row('Letzte 30 Tage', `${c.view || 0}× angezeigt · ${(c.email || 0) + (c.phone || 0)} Anfragen (Mail/Anruf) · ${c.website || 0}× Webseite · ${c.instagram || 0}× Instagram`);
    row('Vermittelt', `${p.referred} Alben angelegt · ${p.paid} bezahlt · Provision ${euro(p.commissionCents)}`);
    body.append(dl);
    if (p.description) body.append(el('p', p.description));
    const edit = el('details'); edit.append(el('summary', 'Bearbeiten'));
    const form = el('form', undefined, 'partner-admin-edit');
    const field = (label, value, name) => { const l = el('label', label); const i = el('input'); i.name = name; i.value = value || ''; l.append(i); form.append(l); return i; };
    const code = field('Empfehlungs-Code', p.referralCode, 'code'); const regions = field('Einsatzgebiete (PLZ-Bereiche)', p.regions.join(', '), 'regions');
    const website = field('Webseite', p.website, 'website'); const publicEmail = field('E-Mail für Anfragen', p.publicEmail, 'publicEmail');
    const publicPhone = field('Telefon für Anfragen', p.publicPhone, 'publicPhone'); const instagram = field('Instagram', p.instagram, 'instagram');
    const desc = el('textarea'); desc.value = p.description || ''; desc.maxLength = 600; form.append(desc);
    const save = el('button', 'Speichern', 'primary'); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', e => { e.preventDefault(); change(p.id, { ...(code.value.trim() ? { referralCode: code.value } : {}), regions: regions.value, description: desc.value, website: website.value, publicEmail: publicEmail.value, publicPhone: publicPhone.value, instagram: instagram.value }); });
    edit.append(form); body.append(edit);
    const actions = el('div', undefined, 'actions');
    const button = (text, cls, fn) => { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); actions.append(b); };
    if (p.status !== 'approved') button('Freigeben', 'primary', () => change(p.id, { status: 'approved' }));
    if (p.status !== 'rejected') button(p.status === 'approved' ? 'Aus Verzeichnis nehmen' : 'Ablehnen', 'secondary', () => change(p.id, { status: 'rejected' }));
    if (p.premium) button('Premium beenden', 'secondary', () => change(p.id, { premium: false }));
    const premiumBox = el('label', 'Premium bis', 'partner-premium-date'); const until = el('input'); until.type = 'date';
    const nextYear = new Date(); nextYear.setFullYear(nextYear.getFullYear() + 1);
    until.value = new Date(p.premium && p.premiumUntil ? p.premiumUntil : nextYear.getTime()).toISOString().slice(0, 10); premiumBox.append(until); actions.append(premiumBox);
    button(p.premium ? 'Premium verlängern' : 'Premium aktivieren', 'secondary', () => change(p.id, { premium: true, premiumUntil: until.value }));
    button('Löschen', 'danger', () => erase(p));
    body.append(actions); card.append(body); return card;
  }
  function renderSettlement(s, rules) {
    const card = el('article', undefined, 'event-card partner-settlement');
    card.append(el('h2', s.company));
    const facts = el('dl');
    const row = (k, v) => { dl(facts, k, v); };
    row('Fällig', s.due.count ? `${s.due.count} ${s.due.count === 1 ? 'Album' : 'Alben'} · ${euro(s.due.netCents)} netto${s.billing.smallBusiness ? ' (Kleinunternehmer, ohne USt)' : ` + ${euro(s.due.vatCents)} USt = ${euro(s.due.grossCents)}`}` : 'nichts fällig');
    row('In Widerrufsfrist', s.waiting.count ? `${s.waiting.count} · ${euro(s.waiting.netCents)} netto · frühestens fällig am ${new Date(s.waiting.nextDueAt).toLocaleDateString('de-DE')}` : '–');
    card.append(facts);
    const billing = el('details'); billing.open = !s.billing.complete && s.due.count > 0;
    billing.append(el('summary', s.billing.complete ? 'Rechnungsdaten des Partners ✓' : 'Rechnungsdaten des Partners fehlen'));
    const form = el('form', undefined, 'partner-admin-edit');
    const field = (label, value, tag) => { const l = el('label', label); const i = el(tag || 'input'); i.value = value || ''; l.append(i); form.append(l); return i; };
    const name = field('Rechnungsname', s.billing.name); const taxId = field('Steuernummer oder USt-IdNr.', s.billing.taxId);
    const address = field('Anschrift (Straße, PLZ Ort)', s.billing.address, 'textarea');
    const smallLabel = el('label', undefined, 'check-label'); const small = el('input'); small.type = 'checkbox'; small.checked = s.billing.smallBusiness; smallLabel.append(small, el('span', ' Kleinunternehmer (§ 19 UStG) – Gutschrift ohne Umsatzsteuer')); form.append(smallLabel);
    const save = el('button', 'Rechnungsdaten speichern', 'secondary'); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', async e => { e.preventDefault(); try { await api(`/api/admin/partners/${encodeURIComponent(s.partnerId)}/billing`, 'PATCH', { name: name.value, taxId: taxId.value, address: address.value, smallBusiness: small.checked }); status.textContent = 'Rechnungsdaten gespeichert.'; await loadSettlement(); } catch (error) { status.textContent = error.message; } });
    billing.append(el('p', 'Bankverbindung wird hier bewusst nicht gespeichert – bitte bei der Überweisung aus deinen Unterlagen nehmen.', 'small'), form);
    card.append(billing);
    const actions = el('div', undefined, 'actions');
    const create = el('button', `Gutschrift erstellen${s.due.count ? ' · ' + euro(s.due.grossCents) : ''}`, 'primary'); create.type = 'button'; create.disabled = !s.canPayout;
    create.title = s.canPayout ? '' : s.due.netCents < rules.minPayoutCents ? `Auszahlung ab ${euro(rules.minPayoutCents)} fälliger Provision` : 'Rechnungsdaten fehlen';
    create.addEventListener('click', async () => { if (!confirm(`Gutschrift über ${euro(s.due.grossCents)} für ${s.company} erstellen?`)) return; try { await api(`/api/admin/partners/${encodeURIComponent(s.partnerId)}/payouts`, 'POST', {}); status.textContent = 'Gutschrift erstellt. PDF herunterladen, an den Partner senden und Betrag überweisen.'; await loadSettlement(); } catch (error) { status.textContent = error.message; } });
    if (s.due.count) { actions.append(create); if (!s.canPayout) actions.append(el('span', create.title, 'small')); card.append(actions); }
    if (s.payouts.length) {
      const list = el('div', undefined, 'partner-payouts'); list.append(el('h3', 'Gutschriften'));
      for (const p of s.payouts) {
        const line = el('div', undefined, 'partner-payout-line');
        line.append(el('strong', p.number), el('span', `${new Date(p.created_at).toLocaleDateString('de-DE')} · ${p.item_count} Alben · ${euro(p.gross_cents)}`));
        const pdf = el('a', 'PDF', 'button secondary'); pdf.href = `/api/admin/partner-payouts/${encodeURIComponent(p.id)}/gutschrift.pdf`; line.append(pdf);
        if (p.paid_at) line.append(el('span', `überwiesen am ${new Date(p.paid_at).toLocaleDateString('de-DE')}`, 'partner-chip'));
        else { const mark = el('button', 'Als überwiesen markieren', 'secondary'); mark.type = 'button'; mark.addEventListener('click', async () => { try { await api(`/api/admin/partner-payouts/${encodeURIComponent(p.id)}`, 'PATCH', { paid: true }); await loadSettlement(); } catch (error) { status.textContent = error.message; } }); line.append(mark); }
        list.append(line);
      }
      card.append(list);
    }
    return card;
  }
  function dl(target, k, v) { target.append(el('dt', k), el('dd', v)); }
  async function loadSettlement() {
    root.replaceChildren();
    try {
      const data = await api('/api/admin/partner-settlement');
      const r = data.rules;
      root.append(el('p', `Regeln: ${euro(r.commissionCents)} Provision netto je bezahltem Album · fällig ${r.withdrawalDays} Tage nach Zahlung (Widerrufsfrist) · Auszahlung ab ${euro(r.minPayoutCents)} · erstattete oder widerrufene Buchungen zählen nicht.`, 'small'));
      if (!data.partners.length) { status.textContent = 'Noch keine Partner mit Provision.'; return; }
      status.textContent = '';
      for (const s of data.partners) root.append(renderSettlement(s, r));
    } catch (error) { status.textContent = error.message; }
  }
  function draw() {
    root.replaceChildren();
    if (filter === 'settlement') { document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === filter))); loadSettlement(); return; }
    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
    const shown = partners.filter(p => filter === 'all' || p.status === filter);
    status.textContent = shown.length ? '' : 'Keine Einträge in dieser Ansicht.';
    for (const p of shown) root.append(render(p));
  }
  async function change(id, body) { try { await api(`/api/admin/partners/${encodeURIComponent(id)}`, 'PATCH', body); await load(); status.textContent = 'Gespeichert.'; } catch (error) { status.textContent = error.message; } }
  async function erase(p) { if (!confirm(`„${p.company}“ endgültig löschen? Kontaktdaten, Logo und Beschreibung werden entfernt.`)) return; try { await api(`/api/admin/partners/${encodeURIComponent(p.id)}`, 'DELETE'); await load(); } catch (error) { status.textContent = error.message; } }
  async function load() {
    try {
      info = await api('/api/admin/partners'); partners = info.partners;
      const count = s => partners.filter(p => p.status === s).length; const open = partners.reduce((sum, p) => sum + p.commissionCents, 0);
      summary.textContent = `${count('approved')} freigeschaltet · ${count('pending')} warten auf Prüfung · Rabatt für Kund:innen ${euro(info.discountCents)} · Provision ${euro(info.commissionCents)} pro bezahlter Buchung · Provision gesamt ${euro(open)}`;
      document.querySelector('[data-filter="pending"]').textContent = `Warten auf Prüfung (${count('pending')})`;
      draw();
    } catch (error) { status.textContent = error.message; }
  }
  document.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.filter; draw(); }));
  document.getElementById('refresh').addEventListener('click', load); load();
})();
