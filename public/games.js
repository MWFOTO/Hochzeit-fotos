(() => {
  const eventId = location.pathname.split('/')[2];
  const guestUrl = window.guestUrl || (url => url);
  const ideas = [
    ['Ein kleiner Blick fürs Detail','Fotografiere eine Deko, Blume oder Tischkarte, die dir gefällt.'],
    ['Ein Prost auf den Tag','Halte einen gemeinsamen Toast fest – natürlich nur, wenn alle einverstanden sind.'],
    ['Tanzfläche in Bewegung','Fange einen lustigen Tanzmoment ein, ohne jemanden bloßzustellen.'],
    ['Menschen, die sich heute kennenlernen','Fragt zwei Gäste, ob sie zusammen ein Erinnerungsfoto machen möchten.'],
    ['Die Lieblingsfarbe der Feier','Entdecke etwas in deiner Lieblingsfarbe und fotografiere es.'],
    ['Ein Gruppenbild mit Perspektive','Macht ein Gruppenfoto aus einem ungewöhnlichen, sicheren Blickwinkel.'],
    ['Hinter den Kulissen','Fotografiere einen schönen Vorbereitungs- oder Helfermoment – mit Zustimmung der Personen.'],
    ['Der schönste Ausblick','Halte fest, was du von der Feier aus am liebsten anschaust.'],
    ['Ein gemeinsames Herz','Formt mit freiwilligen Mitmachenden ein Herz mit euren Händen.'],
    ['Ein Moment voller Lachen','Sammelt einen fröhlichen Moment, den alle gern in Erinnerung behalten.'],
    ['Damals und heute','Stellt mit Einverständnis ein altes Gruppenfoto oder eine Pose nach.'],
    ['Dein persönlicher Höhepunkt','Fotografiere den Moment, der für dich heute besonders ist.']
  ];
  const key = `finalsnap-games-${eventId}`;
  let completed = new Set();
  try { completed = new Set(JSON.parse(localStorage.getItem(key) || '[]').filter(i => Number.isInteger(i) && i >= 0 && i < ideas.length)); } catch {}
  const guestLink = url => guestUrl(url);
  document.getElementById('album-back').href = guestLink(`/event/${encodeURIComponent(eventId)}`);
  document.getElementById('upload-link').href = guestLink(`/event/${encodeURIComponent(eventId)}/upload`);
  document.getElementById('guestbook-link').href = guestLink(`/event/${encodeURIComponent(eventId)}/guestbook`);
  const tasks = document.getElementById('game-tasks');
  const render = () => {
    tasks.replaceChildren();
    for (const [index, [title, description]] of ideas.entries()) {
      const card = document.createElement('article'); card.className = `game-task${completed.has(index) ? ' is-complete' : ''}`;
      const label = document.createElement('label'); label.className = 'game-task-check';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = completed.has(index); checkbox.setAttribute('aria-label', `${title} erledigt`);
      checkbox.addEventListener('change', () => { checkbox.checked ? completed.add(index) : completed.delete(index); localStorage.setItem(key, JSON.stringify([...completed])); render(); });
      const copy = document.createElement('span'); copy.append(Object.assign(document.createElement('strong'), {textContent:title}), Object.assign(document.createElement('span'), {textContent:description}));
      label.append(checkbox, copy); card.append(label);
      const upload = document.createElement('a'); upload.className='button secondary'; upload.textContent='Foto dazu hochladen'; upload.href=guestLink(`/event/${encodeURIComponent(eventId)}/upload`); card.append(upload);
      tasks.append(card);
    }
    document.getElementById('game-progress').textContent = `${completed.size} von ${ideas.length} erledigt`;
  };
  document.getElementById('shuffle-task').addEventListener('click', () => {
    const remaining = ideas.map((_, i) => i).filter(i => !completed.has(i));
    const chosen = remaining.length ? remaining[Math.floor(Math.random() * remaining.length)] : Math.floor(Math.random() * ideas.length);
    tasks.children[chosen]?.scrollIntoView({behavior:'smooth',block:'center'});
    tasks.children[chosen]?.classList.add('is-highlighted');
    setTimeout(() => tasks.children[chosen]?.classList.remove('is-highlighted'), 1400);
  });
  render();
})();
