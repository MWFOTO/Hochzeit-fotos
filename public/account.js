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
  let activeEvent=null;
  async function manage(event) {
    const section=document.getElementById('photo-manager');section.hidden=false;
    document.getElementById('manager-title').textContent=`Fotos: ${event.title}`;
    if(!section.dataset.opened){section.scrollIntoView({behavior:'smooth',block:'start'});section.dataset.opened='1';}
    const {photos}=await api(`/api/event/${event.id}/photos?manage=1`);
    const list=document.getElementById('managed-photos');list.replaceChildren();
    if(!photos.length)list.textContent='Noch keine Fotos vorhanden.';
    const toolbar=element('div');toolbar.className='actions photo-toolbar';list.before(toolbar);document.querySelectorAll('.photo-toolbar').forEach(el=>{if(el!==toolbar)el.remove();});
    const selected=new Set();const counter=element('span','0 ausgewählt');counter.setAttribute('role','status');
    const all=button(toolbar,'Alle auswählen',()=>{const check=selected.size!==photos.length;list.querySelectorAll('input[type=checkbox]').forEach(box=>{box.checked=check;box.dispatchEvent(new Event('change'));});});
    toolbar.append(counter);
    const bulk=async(method,body)=>{if(!selected.size)return;if(method==='DELETE'&&!confirm(`${selected.size} ausgewählte Fotos endgültig löschen?`))return;toolbar.querySelectorAll('button').forEach(b=>b.disabled=true);try{for(const id of selected)await api(`/api/event/${event.id}/photos/${id}`,method,body);await load();}catch(err){await load();throw err;}};
    button(toolbar,'Auswahl freigeben',()=>bulk('PATCH',{approved:true}));button(toolbar,'Auswahl verbergen',()=>bulk('PATCH',{approved:false}));button(toolbar,'Auswahl löschen',()=>bulk('DELETE')).className='danger';
    for(const photo of photos) {
      const card=element('article'),img=element('img');img.src=photo.url;img.alt='Veranstaltungsfoto';img.loading='lazy';const choice=element('label','Auswählen');choice.className='check-label';const box=element('input');box.type='checkbox';box.setAttribute('aria-label','Foto auswählen');box.onchange=()=>{box.checked?selected.add(photo.id):selected.delete(photo.id);counter.textContent=`${selected.size} ausgewählt`;card.classList.toggle('selected',box.checked);};choice.prepend(box);card.append(choice,img,element('p',photo.approved?'Sichtbar für Gäste':'Wartet auf Freigabe'));card.lastChild.className='photo-state';
      button(card,photo.approved?'Freigabe zurücknehmen':'Freigeben',async()=>{await api(`/api/event/${event.id}/photos/${photo.id}`,'PATCH',{approved:!photo.approved});await manage(event);});
      button(card,'Foto löschen',async()=>{if(confirm('Dieses Foto endgültig löschen?')){await api(`/api/event/${event.id}/photos/${photo.id}`,'DELETE');await load();}});
      list.append(card);
    }
  }
  async function load() {
    const {events}=await api('/api/events');if(activeEvent&&!events.some(e=>e.id===activeEvent))activeEvent=null;document.querySelector('.create-panel').hidden=!!activeEvent;const section=document.getElementById('events');section.replaceChildren();
    if(!events.length){section.append(element('p','Dein erstes Album wartet auf dich. Erstelle oben eine Veranstaltung.'));document.querySelector('.create-panel').open=true;}
    for(const event of events) {
      const card=element('article');card.className='event-card';const heading=element('div');heading.className='page-heading';const badge=element('span',event.status==='paid'?'Aktiv':event.status==='pending'?'Zahlung offen':'Abgelaufen');badge.className='status-pill '+(event.status==='pending'?'pending':'');heading.append(element('h2',event.title),badge);card.append(heading,element('p',`${event.id}${event.expires_at?` · Verfügbar bis ${new Date(event.expires_at).toLocaleString('de-DE')}`:''}`));card.lastChild.className='event-meta';
      const stats=element('p',`${event.photoCount} Fotos · ${(event.storageBytes/1024**2).toFixed(1)} MB von ${(event.storageLimitBytes/1024**2).toFixed(0)} MB belegt`);stats.id=`stats-${event.id}`;card.append(stats);const meter=element('progress');meter.max=event.storageLimitBytes;meter.value=event.storageBytes;meter.setAttribute('aria-label','Belegter Fotospeicher');card.append(meter);
      const open=button(card,'Veranstaltung verwalten',()=>{activeEvent=event.id;history.replaceState(null,'',`/dashboard?event=${encodeURIComponent(event.id)}`);load();});open.className='primary event-open';
      const tabs=element('nav');tabs.className='actions event-tabs';tabs.setAttribute('aria-label','Veranstaltungsbereiche');card.append(tabs);
      const panels=[];
      const showPanel=index=>{panels.forEach((panel,i)=>panel.hidden=i!==index);tabs.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));document.getElementById('photo-manager').hidden=index!==0;if(index===0)return manage(event);};
      if(event.status==='pending')button(card,'Im Stripe-Testmodus bezahlen',async()=>{const data=await api('/api/checkout','POST',{eventId:event.id});location.href=data.url;});
      if(event.guestUrl) {
        const photosSection=element('div');photosSection.className='event-section';photosSection.append(element('h3','Fotos & Live-Diashow'));card.append(photosSection);const photoActions=element('div');photoActions.className='actions';photosSection.append(photoActions);
        const accessSection=element('div');accessSection.className='event-section';accessSection.append(element('h3','QR-Code & Gästezugang'));card.append(accessSection);const accessActions=element('div');accessActions.className='actions';accessSection.append(accessActions);
        const settings=element('details');settings.className='event-section event-settings';settings.open=true;settings.append(element('summary','Einstellungen & Freigabe'));card.append(settings);const settingsActions=element('div');settingsActions.className='actions';settings.append(element('p',event.moderation?'Neue Fotos warten auf deine Freigabe.':'Neue Fotos sind sofort für eure Gäste sichtbar.'),settingsActions);
        panels.push(photosSection,accessSection,settings);
        ['Fotos','Gästezugang','Einstellungen'].forEach((label,i)=>button(tabs,label,()=>showPanel(i)));
        button(accessActions,'Gästelink kopieren',async()=>{try{await navigator.clipboard.writeText(event.guestUrl);message.textContent='Gästelink kopiert.';}catch{const input=element('input');input.value=event.guestUrl;input.readOnly=true;accessSection.append(input);input.select();message.textContent='Bitte den markierten Gästelink kopieren.';}});
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
      if(activeEvent){card.hidden=event.id!==activeEvent;open.hidden=true;if(event.id===activeEvent){tabs.hidden=false;if(event.guestUrl)await showPanel(0);else document.getElementById('photo-manager').hidden=true;}}else{tabs.hidden=true;panels.forEach(panel=>panel.hidden=true);danger.hidden=true;}
      if(activeEvent===event.id){button(card,'Zur Veranstaltungsübersicht',()=>{activeEvent=null;history.replaceState(null,'','/dashboard');document.getElementById('photo-manager').hidden=true;load();}).className='secondary';}

    }
  }
  document.getElementById('close-manager').onclick=()=>{activeEvent=null;history.replaceState(null,'','/dashboard');document.getElementById('photo-manager').hidden=true;load().catch(report);};
  activeEvent=new URLSearchParams(location.search).get('event');
  document.getElementById('logout').onclick=()=>api('/api/auth/logout','POST').then(()=>location.href='/login').catch(report);
  const eventIdInput=document.getElementById('event-id');
  const normalizeEventId=value=>value.trim().toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]+/g,'-').replace(/^[-_]+|[-_]+$/g,'');
  eventIdInput.addEventListener('blur',()=>{eventIdInput.value=normalizeEventId(eventIdInput.value);});
  document.getElementById('event-form').onsubmit=async e=>{
    e.preventDefault();eventIdInput.value=normalizeEventId(eventIdInput.value);if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(eventIdInput.value)){message.textContent='Bitte einen Kurznamen mit mindestens 3 Buchstaben oder Zahlen eingeben.';message.scrollIntoView({block:'center'});eventIdInput.focus();return;}try{await api('/api/events','POST',{title:document.getElementById('title').value,eventId:document.getElementById('event-id').value,plan:document.getElementById('plan').value,moderation:document.getElementById('moderation').checked});message.textContent='Veranstaltung erstellt. Als Nächstes kannst du die Testzahlung starten.';e.target.reset();await load();message.scrollIntoView({block:'center',behavior:'smooth'});}catch(err){report(err);message.scrollIntoView({block:'center',behavior:'smooth'});}
  };
  (async()=>{
    try{await api('/api/auth/me');const plans=await api('/api/plans');for(const [key,plan] of Object.entries(plans)){const option=element('option',`${plan.label} · ${(plan.priceCents/100).toFixed(2)} €`);option.value=key;document.getElementById('plan').append(option);}await load();}catch(err){report(err);}
  })();
})();
