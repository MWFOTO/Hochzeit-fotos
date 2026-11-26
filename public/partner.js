(() => {
  const form = document.getElementById('partner-search'), plz = document.getElementById('plz'), category = document.getElementById('category');
  const list = document.getElementById('partners'), status = document.getElementById('status');
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  window.finalsnapPartnerCard = function (p, headingTag) {
    const card = el('article', undefined, 'partner-card' + (p.premium ? ' is-premium' : ''));
    if (p.logoUrl) { const img = el('img', undefined, 'partner-logo'); img.src = p.logoUrl; img.alt = `Logo ${p.company}`; img.loading = 'lazy'; card.append(img); }
    else card.append(el('div', p.company.slice(0, 1).toUpperCase(), 'partner-logo is-empty'));
    const meta = el('div', undefined, 'partner-meta'); meta.append(el('span', p.categoryLabel, 'partner-chip')); if (p.premium) meta.append(el('span', 'Premium', 'partner-chip is-premium'));
    meta.append(el('span', [p.postcode, p.city].filter(Boolean).join(' ')));
    card.append(meta, el(headingTag || 'h2', p.company));
    if (p.description) card.append(el('p', p.description));
    if (p.website) { const actions = el('div', undefined, 'actions'); const a = el('a', 'Webseite besuchen ↗', 'button secondary'); a.href = p.website; a.target = '_blank'; a.rel = 'noopener nofollow'; actions.append(a); card.append(actions); }
    return card;
  };
  if (!form) return;
  async function search(push) {
    const q = new URLSearchParams(); if (plz.value.trim()) q.set('plz', plz.value.trim()); if (category.value) q.set('category', category.value);
    if (push) history.replaceState(null, '', `/partner${q.toString() ? '?' + q : ''}`);
    if (plz.value.trim() && !/^\d{5}$/.test(plz.value.trim())) { status.textContent = 'Bitte eine fünfstellige Postleitzahl eingeben.'; return; }
    status.textContent = 'Suche läuft …'; list.replaceChildren();
    try {
      const res = await fetch(`/api/partners?${q}`); const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Suche fehlgeschlagen.');
      if (category.options.length === 1) for (const [key, label] of Object.entries(data.categories)) { const o = el('option', label); o.value = key; category.append(o); }
      const wanted = new URLSearchParams(location.search).get('category'); if (wanted && !category.value && data.categories[wanted]) category.value = wanted;
      for (const p of data.partners) list.append(window.finalsnapPartnerCard(p));
      status.textContent = data.partners.length ? `${data.partners.length} ${data.partners.length === 1 ? 'Partner' : 'Partner'}${plz.value ? ' in eurer Region' : ''}` : plz.value ? 'In dieser Region gibt es noch keine Partner. Schaut bald wieder vorbei!' : 'Noch keine Partner eingetragen.';
    } catch (error) { status.textContent = error.message; }
  }
  const params = new URLSearchParams(location.search); plz.value = params.get('plz') || ''; if (params.get('category')) category.dataset.wanted = params.get('category');
  form.addEventListener('submit', e => { e.preventDefault(); search(true); });
  search(false).then(() => { if (params.get('category')) { category.value = params.get('category'); if (category.value) search(false); } });
})();
