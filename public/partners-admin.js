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
    if (p.premium) meta.append(el('span', 'Premium', 'partner-chip is-premium'));
    body.append(meta, el('h2', p.company));
    const dl = el('dl');
    const row = (k, v) => { if (!v && v !== 0) return; dl.append(el('dt', k)); const dd = el('dd'); if (v instanceof Node) dd.append(v); else dd.textContent = v; dl.append(dd); };
    row('Ort', `${p.postcode} ${p.city}`.trim()); row('Einsatzgebiete', p.regions.map(r => r + 'xxx').join(', '));
    row('Kontakt', `${p.contactName} · ${p.email}${p.phone ? ' · ' + p.phone : ''}`);
    if (p.website) { const a = el('a', p.website); a.href = p.website; a.target = '_blank'; a.rel = 'noopener nofollow'; row('Webseite', a); }
    row('Angemeldet', new Date(p.createdAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }));
    if (p.referralCode) row('Empfehlungs-Code', p.referralCode);
    row('Vermittelt', `${p.referred} Alben angelegt · ${p.paid} bezahlt · Provision ${euro(p.commissionCents)}`);
    body.append(dl);
    if (p.description) body.append(el('p', p.description));
    const edit = el('details'); edit.append(el('summary', 'Bearbeiten'));
    const form = el('form', undefined, 'partner-admin-edit');
    const field = (label, value, name) => { const l = el('label', label); const i = el('input'); i.name = name; i.value = value || ''; l.append(i); form.append(l); return i; };
    const code = field('Empfehlungs-Code', p.referralCode, 'code'); const regions = field('Einsatzgebiete (PLZ-Bereiche)', p.regions.join(', '), 'regions');
    const desc = el('textarea'); desc.value = p.description || ''; desc.maxLength = 600; form.append(desc);
    const save = el('button', 'Speichern', 'primary'); save.type = 'submit'; form.append(save);
    form.addEventListener('submit', e => { e.preventDefault(); change(p.id, { ...(code.value.trim() ? { referralCode: code.value } : {}), regions: regions.value, description: desc.value }); });
    edit.append(form); body.append(edit);
    const actions = el('div', undefined, 'actions');
    const button = (text, cls, fn) => { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); actions.append(b); };
    if (p.status !== 'approved') button('Freigeben', 'primary', () => change(p.id, { status: 'approved' }));
    if (p.status !== 'rejected') button(p.status === 'approved' ? 'Aus Verzeichnis nehmen' : 'Ablehnen', 'secondary', () => change(p.id, { status: 'rejected' }));
    button(p.premium ? 'Premium entfernen' : 'Als Premium markieren', 'secondary', () => change(p.id, { premium: !p.premium }));
    button('Löschen', 'danger', () => erase(p));
    body.append(actions); card.append(body); return card;
  }
  function draw() {
    root.replaceChildren();
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
