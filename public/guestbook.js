(() => {
  const eventId = location.pathname.split('/')[2];
  const form = document.getElementById('guestbook-form');
  const message = document.getElementById('guest-message');
  const status = document.getElementById('guestbook-status');
  const list = document.getElementById('guestbook-entries');
  const count = document.getElementById('guestbook-count');
  const link = window.guestUrl || (url => url);
  document.getElementById('album-back').href = link(`/event/${encodeURIComponent(eventId)}`);
  message.addEventListener('input', () => { document.getElementById('character-count').textContent = `${message.value.length} / 500`; });
  fetch(`/api/event/${encodeURIComponent(eventId)}/info`).then(response => response.ok ? response.json() : null).then(info => {
    if (info?.readOnly) {
      form.querySelectorAll('input,textarea,button').forEach(control => { control.disabled = true; });
      status.textContent = `Die Schreibfrist ist abgelaufen. Das Gästebuch bleibt bis ${new Date(info.retentionUntil).toLocaleDateString('de-DE')} lesbar.`;
    }
  }).catch(() => {});

  const el = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  const formatDate = value => new Intl.DateTimeFormat('de-DE', {dateStyle:'medium', timeStyle:'short'}).format(new Date(value));

  async function load() {
    const response = await fetch(`/api/event/${encodeURIComponent(eventId)}/guestbook`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Das Gästebuch konnte nicht geladen werden.');
    list.replaceChildren();
    count.textContent = `${data.entries.length} ${data.entries.length === 1 ? 'Eintrag' : 'Einträge'}`;
    if (data.canManage) {
      const note = el('p', data.moderation ? 'Neue Grüße erscheinen erst nach deiner Freigabe.' : 'Neue Grüße erscheinen direkt im Gästebuch.');
      note.className = 'small'; list.append(note);
    }
    if (!data.entries.length) list.append(el('p', 'Noch keine Einträge. Der erste Gruß ist deiner!'));
    for (const entry of data.entries) {
      const card = el('article'); card.className = 'guestbook-entry';
      const heading = el('div'); heading.className = 'guestbook-entry-heading';
      heading.append(el('strong', entry.name || 'Ein Gast'), el('time', formatDate(entry.createdAt)));
      card.append(heading, el('p', entry.message));
      if (data.canManage) {
        if (!entry.approved) { const approve = el('button', 'Freigeben'); approve.className = 'primary'; approve.onclick = () => change(entry.id, 'PATCH', {approved:true}); card.append(approve); }
        else { const hide = el('button', 'Verbergen'); hide.className = 'secondary'; hide.onclick = () => change(entry.id, 'PATCH', {approved:false}); card.append(hide); }
        const remove = el('button', 'Löschen'); remove.className = 'danger'; remove.onclick = () => change(entry.id, 'DELETE'); card.append(remove);
        if (!entry.approved) { const pending = el('span', 'Wartet auf Freigabe'); pending.className = 'status-pill pending'; card.append(pending); }
      }
      list.append(card);
    }
  }
  async function change(id, method, body) {
    const response = await fetch(`/api/event/${encodeURIComponent(eventId)}/guestbook/${encodeURIComponent(id)}`, {method, headers:{'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Änderung fehlgeschlagen.'); await load();
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector('button'); button.disabled = true; status.textContent = '';
    try {
      const response = await fetch(`/api/event/${encodeURIComponent(eventId)}/guestbook`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('guest-name').value,message:message.value})});
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Der Gruß konnte nicht gespeichert werden.');
      form.reset(); document.getElementById('character-count').textContent = '0 / 500';
      status.textContent = data.pending ? 'Danke! Dein Gruß wird nach Freigabe durch den Veranstalter sichtbar.' : 'Danke für deinen Gruß!'; await load();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  load().catch(error => { status.textContent = error.message; });
})();
