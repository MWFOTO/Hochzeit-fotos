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
  async function refreshQuota(){
    if(!eventId)return;
    const res=await window.fetch(`/api/event/${encodeURIComponent(eventId)}/info`);if(!res.ok)return;
    const info=await res.json();
    let notice=document.getElementById('quota-notice');
    if(!notice){notice=document.createElement('div');notice.id='quota-notice';notice.className='quota-notice';notice.setAttribute('role','status');const parent=document.querySelector('.gallery-header')||document.querySelector('.upload-page');if(parent)parent.append(notice);}
    if(notice){notice.replaceChildren();notice.hidden=!info.trial;
      if(info.trial){const left=Math.max(0,info.photoLimit-info.photoCount);const text=document.createElement('p');text.textContent=left===0?'Die 25 kostenlosen Fotos sind genutzt. Erweitere das Album mit einem Paket.':`Noch ${left} kostenlose ${left===1?'Foto':'Fotos'} verfügbar.`;notice.append(text);
        if(left<=5){notice.classList.add('quota-near');const a=document.createElement('a');a.className='button primary';a.textContent=info.canManage?'Paket auswählen':'Veranstalter? Paket auswählen';a.href=info.canManage?`/dashboard?event=${encodeURIComponent(eventId)}`:`/login?event=${encodeURIComponent(eventId)}`;notice.append(a);if(!info.canManage){const hint=document.createElement('p');hint.textContent='Gäste zahlen nichts. Das Paket wird im Veranstalterkonto gebucht.';notice.append(hint);}}
      }
    }
    const back=document.getElementById('album-back');if(back)back.href=window.guestUrl(`/event/${encodeURIComponent(eventId)}/gallery`);
    const manage=document.getElementById('manage-back');if(manage){manage.hidden=!info.canManage;manage.href=`/dashboard?event=${encodeURIComponent(eventId)}`;}
  }
  window.refreshEventQuota=refreshQuota;
  document.addEventListener('DOMContentLoaded',()=>{refreshQuota().catch(()=>{});if(!location.pathname.endsWith('/slideshow'))setInterval(()=>refreshQuota().catch(()=>{}),10000);});
  if (eventId) window.fetch(`/api/event/${encodeURIComponent(eventId)}/info`).then(res => res.json()).then(info => {
    const title = document.querySelector('.event-title');
    if (title && info.title) title.textContent = info.title;
    const subtitle = document.querySelector('.event-subtitle');
    if (subtitle) subtitle.textContent = info.moderation ? 'Teile deine schönsten Momente. Nach Freigabe sind sie für die Gäste in Galerie und Diashow sichtbar.' : 'Teile deine schönsten Momente. Deine Fotos sind direkt für die Gäste in Galerie und Diashow sichtbar.';
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
