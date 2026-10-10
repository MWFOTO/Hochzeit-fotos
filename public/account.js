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
    const submit=async mode=>{
      try{await api(`/api/auth/${mode}`,'POST',{email:document.getElementById('email').value,password:document.getElementById('password').value});location.href='/dashboard';}catch(err){report(err);}
    };
    login.onsubmit=e=>{e.preventDefault();submit('login');};
    document.getElementById('register').onclick=()=>submit('register');return;
  }
  const element=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  const button=(parent,label,action)=>{const el=element('button',label);el.onclick=()=>Promise.resolve(action()).catch(report);parent.append(el);};
  const link=(parent,label,url)=>{const el=element('a',label);el.href=url;parent.append(el,document.createTextNode(' '));};
  async function manage(event) {
    const section=document.getElementById('photo-manager');section.hidden=false;
    document.getElementById('manager-title').textContent=`Fotos: ${event.title}`;
    const {photos}=await api(`/api/event/${event.id}/photos?manage=1`);
    const list=document.getElementById('managed-photos');list.replaceChildren();
    if(!photos.length)list.textContent='Noch keine Fotos vorhanden.';
    for(const photo of photos) {
      const card=element('article'),img=element('img');img.src=photo.url;img.alt='Veranstaltungsfoto';img.width=180;card.append(img);
      button(card,photo.approved?'Freigabe zurücknehmen':'Freigeben',async()=>{await api(`/api/event/${event.id}/photos/${photo.id}`,'PATCH',{approved:!photo.approved});await manage(event);});
      button(card,'Foto löschen',async()=>{if(confirm('Dieses Foto endgültig löschen?')){await api(`/api/event/${event.id}/photos/${photo.id}`,'DELETE');await manage(event);}});
      list.append(card);
    }
  }
  async function load() {
    const {events}=await api('/api/events');const section=document.getElementById('events');section.replaceChildren();
    for(const event of events) {
      const card=element('article');card.append(element('h2',event.title),element('p',`${event.id} · ${event.status}${event.expires_at?` · Ablauf: ${new Date(event.expires_at).toLocaleString('de-DE')}`:''}`));
      if(event.status==='pending')button(card,'Im Stripe-Testmodus bezahlen',async()=>{const data=await api('/api/checkout','POST',{eventId:event.id});location.href=data.url;});
      if(event.guestUrl) {
        link(card,'Gästelink',event.guestUrl);
        link(card,'Galerie',event.guestUrl.replace('?','/gallery?'));
        link(card,'Diashow',event.guestUrl.replace('?','/slideshow?'));
        link(card,'QR-Code herunterladen',`/api/event/${event.id}/qr`);
        button(card,'QR-Karte drucken',async()=>{
          const blob=await (await fetch(`/api/event/${event.id}/qr`)).blob();
          const url=URL.createObjectURL(blob),frame=document.createElement('iframe');frame.hidden=true;document.body.append(frame);
          const doc=frame.contentDocument;doc.body.append(element('h1',event.title),element('p','Fotos teilen: QR-Code scannen.'));
          const img=doc.createElement('img');img.width=350;img.onload=()=>{frame.contentWindow.focus();frame.contentWindow.print();setTimeout(()=>{frame.remove();URL.revokeObjectURL(url);},60000);};img.src=url;doc.body.append(img);
        });
        link(card,'Alle Fotos als ZIP',`/api/event/${event.id}/download`);
        button(card,'Fotos verwalten',()=>manage(event));
        button(card,event.moderation?'Automatische Freigabe aktivieren':'Manuelle Freigabe aktivieren',async()=>{await api(`/api/event/${event.id}`,'PATCH',{moderation:!event.moderation});await load();});
        button(card,'Gästelink erneuern',async()=>{if(confirm('Alte Links und QR-Codes werden dadurch ungültig. Fortfahren?')){await api(`/api/event/${event.id}/rotate-token`,'POST');await load();}});
      }
      button(card,'Event und Fotos löschen',async()=>{if(confirm('Event und alle Fotos endgültig löschen?')){await api(`/api/event/${event.id}`,'DELETE');document.getElementById('photo-manager').hidden=true;await load();}});
      section.append(card);
    }
  }
  document.getElementById('logout').onclick=()=>api('/api/auth/logout','POST').then(()=>location.href='/login').catch(report);
  document.getElementById('event-form').onsubmit=async e=>{
    e.preventDefault();try{await api('/api/events','POST',{title:document.getElementById('title').value,eventId:document.getElementById('event-id').value,plan:document.getElementById('plan').value,moderation:document.getElementById('moderation').checked});message.textContent='Event erstellt. Die Freischaltung erfolgt nach bestätigter Testzahlung.';await load();}catch(err){report(err);}
  };
  (async()=>{
    try{await api('/api/auth/me');const plans=await api('/api/plans');for(const [key,plan] of Object.entries(plans)){const option=element('option',`${plan.label} · ${(plan.priceCents/100).toFixed(2)} €`);option.value=key;document.getElementById('plan').append(option);}await load();}catch(err){report(err);}
  })();
})();
