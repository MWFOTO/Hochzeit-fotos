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
    if(notice){notice.replaceChildren();notice.hidden=!info.testMode;
      if(info.testMode){const left=Math.max(0,info.photoLimit-info.photoCount);const text=document.createElement('p');text.textContent=left===0?(info.preEventTest?'Die 25 Testfotos sind genutzt. Das 25-GB-Paket startet am Veranstaltungsdatum.':'Die 25 kostenlosen Testfotos sind genutzt. Buche das Album im Veranstalterkonto.'):(info.preEventTest?`Vorabtest: noch ${left} ${left===1?'Foto':'Fotos'} bis zum Veranstaltungsdatum.`:`Noch ${left} kostenlose ${left===1?'Testfoto':'Testfotos'} verfügbar.`);notice.append(text);
        if(info.trial&&left<=5){notice.classList.add('quota-near');const a=document.createElement('a');a.className='button primary';a.textContent=info.canManage?'Album buchen':'Veranstalter? Album buchen';a.href=info.canManage?`/dashboard?event=${encodeURIComponent(eventId)}`:`/login?event=${encodeURIComponent(eventId)}`;notice.append(a);if(!info.canManage){const hint=document.createElement('p');hint.textContent='Gäste zahlen nichts. Das Album wird im Veranstalterkonto gebucht.';notice.append(hint);}}
      }
    }
    const back=document.getElementById('album-back');if(back)back.href=window.guestUrl(`/event/${encodeURIComponent(eventId)}/gallery`);
    const games=document.getElementById('games-link');if(games)games.href=window.guestUrl(`/event/${encodeURIComponent(eventId)}/games`);
    const guestbook=document.getElementById('guestbook-link');if(guestbook)guestbook.href=window.guestUrl(`/event/${encodeURIComponent(eventId)}/guestbook`);
    document.querySelectorAll('.game-task .button').forEach(item=>{item.hidden=info.readOnly;});
    const manage=document.getElementById('manage-back');if(manage){manage.hidden=!info.canManage;manage.href=`/dashboard?event=${encodeURIComponent(eventId)}`;}
  }
  window.refreshEventQuota=refreshQuota;
  document.addEventListener('DOMContentLoaded',()=>{refreshQuota().catch(()=>{});if(!location.pathname.endsWith('/slideshow'))setInterval(()=>refreshQuota().catch(()=>{}),10000);});
  const applyEventInfo = info => {
    const update = () => {
      const design=info.design||{};
      const eventFonts={classic:'Georgia,serif',palatino:'Palatino Linotype,Palatino,serif',modern:'Arial,sans-serif',verdana:'Verdana,sans-serif',relaxed:'Trebuchet MS,sans-serif',typewriter:'Courier New,monospace'};
      if(design.accent)document.documentElement.style.setProperty('--color-accent',design.accent);
      if(design.theme)document.body.dataset.designTheme=design.theme;
      const title = document.querySelector('.event-title');
      if (title && (design.title||info.title)) {title.textContent=design.title||info.title;title.style.fontFamily=eventFonts[design.font]||eventFonts.classic;}
      const galleryHeader=document.querySelector('.gallery-header');
      if(galleryHeader&&design.hasCover) {
        let cover=galleryHeader.querySelector('.event-design-cover');
        if(!cover){cover=document.createElement('img');cover.className='event-design-cover';cover.alt='Titelmotiv der Veranstaltung';const eyebrow=galleryHeader.querySelector('.eyebrow');galleryHeader.insertBefore(cover,eyebrow||galleryHeader.firstChild);}
        cover.src=window.guestUrl(`/api/event/${encodeURIComponent(eventId)}/design-cover`);
      }
      const subtitle = document.querySelector('.event-subtitle');
      if (subtitle) subtitle.textContent = info.readOnly
        ? `Der Albumzeitraum ist beendet. Fotos bleiben bis ${new Date(info.retentionUntil).toLocaleDateString('de-DE')} abrufbar.`
        : info.canManage
          ? 'Verwalte alle Fotos eurer Feier. Gäste sehen auf ihrem eigenen Gerät nur die Fotos, die sie selbst hochgeladen haben.'
          : info.moderation
            ? 'Teile deine schönsten Momente. Deine Fotos erscheinen nach Freigabe in deiner Galerie.'
            : 'Teile deine schönsten Momente. Deine Fotos erscheinen in der Galerie auf diesem Gerät.';
      const galleryHeading=document.querySelector('.gallery-header .eyebrow');
      if(galleryHeading)galleryHeading.textContent=info.canManage?'ALLE MOMENTE EURER FEIER':'DEINE FOTOS AUF DIESEM GERÄT';
      const galleryDescription=document.querySelector('.gallery-header > p');
      if(galleryDescription)galleryDescription.textContent=info.readOnly
        ? `Downloadphase: Fotos sind bis ${new Date(info.retentionUntil).toLocaleDateString('de-DE')} abrufbar. Neue Uploads sind geschlossen.`
        : info.canManage?'Verwalte alle Fotos eurer Feier. Gäste sehen jeweils ihre eigenen Uploads.':'Hier siehst du die Fotos, die du mit diesem Browser hochgeladen hast.';
      const emptyMessage=document.getElementById('empty-msg');
      if(emptyMessage)emptyMessage.textContent=info.canManage?'Noch keine Fotos vorhanden.':'Du hast mit diesem Browser noch keine Fotos hochgeladen.';
      const downloadButton=document.getElementById('download-all-btn');
      if(downloadButton)downloadButton.textContent=info.canManage?'Alle Fotos als ZIP herunterladen':'Meine Fotos als ZIP herunterladen';
      const uploadLink=document.getElementById('upload-link');if(uploadLink)uploadLink.hidden=info.readOnly;
      for(const id of ['upload-trigger','camera-trigger']){const button=document.getElementById(id);if(button)button.hidden=info.readOnly;}
      const hint = document.getElementById('retention-hint');
      if (hint && info.expiresAt) hint.textContent = info.eventDate ? `Fotos sind bis zum ${new Date(info.retentionUntil).toLocaleDateString('de-DE')} verfügbar: 90 Tage ab Veranstaltungsdatum. Bitte vorher herunterladen; am Ablaufdatum werden sie automatisch gelöscht.` : `Der Albumzeitraum endet am ${new Date(info.expiresAt).toLocaleDateString('de-DE')}. Du kannst Fotos noch bis zum ${new Date(info.retentionUntil).toLocaleDateString('de-DE')} ansehen und herunterladen. Danach werden sie gelöscht.`;
      const link = document.getElementById('gallery-link');
      if (link) link.href = window.guestUrl(`/event/${encodeURIComponent(eventId)}/gallery`);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',update,{once:true});else update();
  };
  if (eventId) window.fetch(`/api/event/${encodeURIComponent(eventId)}/info`).then(res => res.ok?res.json():null).then(info => {if(info)applyEventInfo(info);}).catch(() => {});
  window.guestUrl = url => {
    const parsed = new URL(url, location.origin);
    if (token) parsed.searchParams.set('token', token);
    return parsed.href;
  };
})();
