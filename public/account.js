(() => {
  let csrf;
  const message = document.getElementById('message');
  const report = error => {message.textContent = error.message;};
  async function api(url, method='GET', body) {
    const res=await fetch(url,{method,headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Anfrage fehlgeschlagen.');
    if(data.csrf) csrf=data.csrf;
    return data;
  }
  const login=document.getElementById('login-form');
  if(login) {
    const registering=location.pathname==='/register';
    const password=document.getElementById('password');
    const confirmation=document.getElementById('password-confirm');
    if(registering){
      document.getElementById('auth-eyebrow').textContent='DEIN ERSTES GEMEINSAMES ALBUM';
      document.getElementById('auth-title').textContent='Konto erstellen';
      document.getElementById('auth-description').textContent='Mit deinem Konto legst du Veranstaltungen an, erhältst den QR-Code und verwaltest alle Fotos.';
      document.getElementById('password-hint').hidden=false;
      document.getElementById('confirm-label').hidden=false;confirmation.required=true;
      password.autocomplete='new-password';
      document.getElementById('auth-submit').textContent='Konto erstellen & Event anlegen';
      const switcher=document.getElementById('auth-switch');switcher.replaceChildren(document.createTextNode('Schon ein Konto? '));const a=document.createElement('a');a.href='/login';a.textContent='Anmelden';switcher.append(a);
    }
    login.onsubmit=async e=>{
      e.preventDefault();
      if(registering && password.value!==confirmation.value){report(new Error('Die Passwörter stimmen nicht überein.'));confirmation.focus();return;}
      const button=document.getElementById('auth-submit');button.disabled=true;
      try{await api(`/api/auth/${registering?'register':'login'}`,'POST',{email:document.getElementById('email').value,password:password.value});location.href='/dashboard';}catch(err){report(err);button.disabled=false;}
    };return;
  }

  const element=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  const button=(parent,label,action)=>{const el=element('button',label);el.onclick=()=>Promise.resolve(action()).catch(report);parent.append(el);return el;};
  const link=(parent,label,url)=>{const el=element('a',label);el.href=url;el.className='button secondary';parent.append(el);};
  async function manage(event) {
    const section=document.getElementById('photo-manager');section.hidden=false;
    document.getElementById('manager-title').textContent=`Fotos: ${event.title}`;
    section.scrollIntoView({behavior:'smooth',block:'start'});
    const {photos}=await api(`/api/event/${event.id}/photos?manage=1`);
    const list=document.getElementById('managed-photos');list.replaceChildren();
    if(!photos.length)list.textContent='Noch keine Fotos vorhanden.';
    for(const photo of photos) {
      const card=element('article'),img=element('img');img.src=photo.url;img.alt='Veranstaltungsfoto';img.loading='lazy';card.append(img,element('p',photo.approved?'Sichtbar für Gäste':'Wartet auf Freigabe'));card.lastChild.className='photo-state';
      button(card,photo.approved?'Freigabe zurücknehmen':'Freigeben',async()=>{await api(`/api/event/${event.id}/photos/${photo.id}`,'PATCH',{approved:!photo.approved});await manage(event);});
      button(card,'Foto löschen',async()=>{if(confirm('Dieses Foto endgültig löschen?')){await api(`/api/event/${event.id}/photos/${photo.id}`,'DELETE');await manage(event);}});
      list.append(card);
    }
  }
  async function load() {
    const {events}=await api('/api/events');const section=document.getElementById('events');section.replaceChildren();
    if(!events.length){section.append(element('p','Dein erstes Album wartet auf dich. Erstelle oben eine Veranstaltung.'));document.querySelector('.create-panel').open=true;}
    for(const event of events) {
      const card=element('article');card.className='event-card';const heading=element('div');heading.className='page-heading';const badge=element('span',event.status==='paid'?'Aktiv':event.status==='pending'?'Zahlung offen':'Abgelaufen');badge.className='status-pill '+(event.status==='pending'?'pending':'');heading.append(element('h2',event.title),badge);card.append(heading,element('p',`${event.id}${event.expires_at?` · Verfügbar bis ${new Date(event.expires_at).toLocaleString('de-DE')}`:''}`));card.lastChild.className='event-meta';
      if(event.status==='pending')button(card,'Im Stripe-Testmodus bezahlen',async()=>{const data=await api('/api/checkout','POST',{eventId:event.id});location.href=data.url;});
      if(event.guestUrl) {
        const photosSection=element('div');photosSection.className='event-section';photosSection.append(element('h3','Fotos & Live-Diashow'));card.append(photosSection);const photoActions=element('div');photoActions.className='actions';photosSection.append(photoActions);
        const accessSection=element('div');accessSection.className='event-section';accessSection.append(element('h3','QR-Code & Gästezugang'));card.append(accessSection);const accessActions=element('div');accessActions.className='actions';accessSection.append(accessActions);
        const settings=element('details');settings.className='event-section event-settings';settings.append(element('summary','Einstellungen & Freigabe'));card.append(settings);const settingsActions=element('div');settingsActions.className='actions';settings.append(element('p',event.moderation?'Neue Fotos warten auf deine Freigabe.':'Neue Fotos sind sofort für eure Gäste sichtbar.'),settingsActions);
        link(accessActions,'Gästeansicht öffnen',event.guestUrl);
        link(photoActions,'Galerie öffnen',event.guestUrl.replace('?','/gallery?'));
        link(photoActions,'Live-Diashow',event.guestUrl.replace('?','/slideshow?'));
        link(accessActions,'QR-Code herunterladen',`/api/event/${event.id}/qr`);
        button(accessActions,'QR-Karte drucken',async()=>{
          const blob=await (await fetch(`/api/event/${event.id}/qr`)).blob();
          const url=URL.createObjectURL(blob),frame=document.createElement('iframe');frame.hidden=true;document.body.append(frame);
          const doc=frame.contentDocument;doc.body.append(element('h1',event.title),element('p','Fotos teilen: QR-Code scannen.'));
          const img=doc.createElement('img');img.width=350;img.onload=()=>{frame.contentWindow.focus();frame.contentWindow.print();setTimeout(()=>{frame.remove();URL.revokeObjectURL(url);},60000);};img.src=url;doc.body.append(img);
        });
        link(photoActions,'Alle Fotos herunterladen',`/api/event/${event.id}/download`);
        button(photoActions,'Fotos verwalten',()=>manage(event)).className='primary';
        button(settingsActions,event.moderation?'Automatische Freigabe aktivieren':'Manuelle Freigabe aktivieren',async()=>{await api(`/api/event/${event.id}`,'PATCH',{moderation:!event.moderation});await load();});
        button(settingsActions,'Gästelink erneuern',async()=>{if(confirm('Alte Links und QR-Codes werden dadurch ungültig. Fortfahren?')){await api(`/api/event/${event.id}/rotate-token`,'POST');await load();}});
      }
      const danger=element('details');danger.className='event-section event-settings';danger.append(element('summary','Veranstaltung löschen'));card.append(danger);
      button(danger,'Event und Fotos löschen',async()=>{if(confirm('Event und alle Fotos endgültig löschen?')){await api(`/api/event/${event.id}`,'DELETE');document.getElementById('photo-manager').hidden=true;await load();}}).className='danger';
      section.append(card);
    }
  }
  document.getElementById('close-manager').onclick=()=>document.getElementById('photo-manager').hidden=true;
  document.getElementById('logout').onclick=()=>api('/api/auth/logout','POST').then(()=>location.href='/login').catch(report);
  document.getElementById('event-form').onsubmit=async e=>{
    e.preventDefault();try{await api('/api/events','POST',{title:document.getElementById('title').value,eventId:document.getElementById('event-id').value,plan:document.getElementById('plan').value,moderation:document.getElementById('moderation').checked});message.textContent='Event erstellt. Die Freischaltung erfolgt nach bestätigter Testzahlung.';await load();}catch(err){report(err);}
  };
  (async()=>{
    try{await api('/api/auth/me');const plans=await api('/api/plans');for(const [key,plan] of Object.entries(plans)){const option=element('option',`${plan.label} · ${(plan.priceCents/100).toFixed(2)} €`);option.value=key;document.getElementById('plan').append(option);}await load();}catch(err){report(err);}
  })();
})();
