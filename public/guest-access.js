// Keep the guest capability on same-origin API requests and navigation.
(() => {
  const token = new URLSearchParams(location.search).get('token');
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    if (token && url.origin === location.origin && url.pathname.startsWith('/api/event/')) headers.set('X-Event-Token', token);
    if (['POST','PATCH','DELETE','PUT'].includes((options.method || 'GET').toUpperCase())) {
      if (!window.eventCsrf) {
        const me = await nativeFetch('/api/auth/me');
        if (me.ok) window.eventCsrf = (await me.json()).csrf;
      }
      if (window.eventCsrf) headers.set('X-CSRF-Token', window.eventCsrf);
    }
    return nativeFetch(input, {...options, headers});
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    const parsed = new URL(url, location.origin);
    if (token && parsed.origin === location.origin && parsed.pathname.startsWith('/api/event/')) parsed.searchParams.set('token', token);
    nativeOpen.call(this, method, parsed.href, ...args);
  };
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    nativeFetch('/api/auth/me').then(async res => {
      if (res.ok) xhr.setRequestHeader('X-CSRF-Token', (await res.json()).csrf);
      nativeSend.call(xhr, body);
    }).catch(() => nativeSend.call(xhr, body));
  };
  const eventId = location.pathname.split('/')[2];
  if (eventId) window.fetch(`/api/event/${encodeURIComponent(eventId)}/info`).then(res => res.json()).then(info => {
    const title = document.querySelector('.event-title');
    if (title && info.title) title.textContent = info.title;
    const hint = document.getElementById('retention-hint');
    if (hint && info.expiresAt) hint.textContent = `Diese Veranstaltung läuft bis ${new Date(info.expiresAt).toLocaleString('de-DE')}. Danach sind die Bilder nicht mehr erreichbar und werden im nächsten Löschlauf entfernt.`;
    const link = document.getElementById('gallery-link');
    if (link) link.href = window.guestUrl(`/event/${encodeURIComponent(eventId)}/gallery`);
  }).catch(() => {});
  window.guestUrl = url => {
    const parsed = new URL(url, location.origin);
    if (token) parsed.searchParams.set('token', token);
    return parsed.href;
  };
})();
