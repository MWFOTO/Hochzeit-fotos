(() => {
  let csrf;
  const status=document.getElementById('status'),root=document.getElementById('reviews');
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  async function api(url,method='GET',body){
    if(method!=='GET'&&!csrf){const session=await fetch('/api/auth/me');if(session.ok)csrf=(await session.json()).csrf;}
    const response=await fetch(url,{method,headers:{...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Anfrage fehlgeschlagen.');return data;
  }
  function render(review){
    const card=el('article');card.className='event-card';
    card.append(el('h2',`${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)} · ${new Date(review.created_at).toLocaleString('de-DE')}`),el('p',review.message));
    card.append(el('p',`Freigabe zur Veröffentlichung: ${review.publish_consent?'ja':'nein'} · Status: ${review.approved?'veröffentlicht':'wartet auf Prüfung'}`));
    const actions=el('div');actions.className='actions';
    if(review.publish_consent){const toggle=el('button',review.approved?'Von Website nehmen':'Freigeben und veröffentlichen');toggle.className=review.approved?'secondary':'primary';toggle.onclick=()=>change(review.id,!review.approved);actions.append(toggle);}
    const remove=el('button','Endgültig löschen');remove.className='danger';remove.onclick=()=>erase(review.id);actions.append(remove);card.append(actions);return card;
  }
  async function change(id,approved){try{await api(`/api/admin/reviews/${encodeURIComponent(id)}`,'PATCH',{approved});await load();}catch(error){status.textContent=error.message;}}
  async function erase(id){if(!confirm('Diese Rückmeldung endgültig löschen?'))return;try{await api(`/api/admin/reviews/${encodeURIComponent(id)}`,'DELETE');await load();}catch(error){status.textContent=error.message;}}
  async function load(){root.replaceChildren();status.textContent='Lade Rückmeldungen …';try{const {reviews}=await api('/api/admin/reviews');if(!reviews.length){status.textContent='Noch keine Rückmeldungen eingegangen.';return;}status.textContent=`${reviews.length} Rückmeldung(en), neueste zuerst.`;for(const review of reviews)root.append(render(review));}catch(error){status.textContent=error.message;}}
  document.getElementById('refresh').onclick=load;load();
})();
