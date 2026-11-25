(() => {
  const eventId = location.pathname.split('/').filter(Boolean)[1];
  if (!eventId) return;
  const url = path => window.guestUrl(`/event/${encodeURIComponent(eventId)}${path}`);
  const upload = document.getElementById('welcome-upload');
  const camera = document.getElementById('welcome-camera');
  const gallery = document.getElementById('welcome-gallery');
  const guestbook = document.getElementById('welcome-guestbook');
  const games = document.getElementById('welcome-games');
  upload.href = url('/upload');
  camera.href = `${url('/upload')}#camera`;
  gallery.href = url('/gallery');
  guestbook.href = url('/guestbook');
  games.href = url('/games');

  fetch(`/api/event/${encodeURIComponent(eventId)}/info`).then(response => response.ok ? response.json() : null).then(info => {
    if (!info) return;
    const design = info.design || {};
    const title = design.title || info.title || 'eurer Feier';
    document.title = `Willkommen bei ${title} · FinalSnap`;
    document.getElementById('welcome-title').textContent = `Willkommen bei ${title} 🎉`;
    if (info.readOnly) {
      document.getElementById('welcome-copy').textContent = 'Die Feier ist vorbei. Schau dir die gemeinsamen Erinnerungen an und lade deine Fotos herunter.';
      upload.hidden = true;
      camera.hidden = true;
    }
    if (design.accent) document.documentElement.style.setProperty('--color-accent', design.accent);
    if (design.theme) document.body.dataset.designTheme = design.theme;
    if (design.hasCover) {
      const cover = document.getElementById('welcome-cover');
      cover.src = window.guestUrl(`/api/event/${encodeURIComponent(eventId)}/design-cover`);
      cover.hidden = false;
    }
  }).catch(() => {});
})();
