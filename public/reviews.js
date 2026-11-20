(() => {
  const form=document.getElementById('experience-form');
  if(!form)return;
  const list=document.getElementById('review-list');
  const summary=document.getElementById('review-summary');
  const status=document.getElementById('review-form-status');
  let csrf;
  const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  function renderReviews(reviews,stats){
    summary.replaceChildren();
    list.replaceChildren();
    if(stats.count){
      const heading=element('strong',`${stats.average.toLocaleString('de-DE')} / 5 ★`);
      summary.append(heading,element('span',`${stats.count} freigegebene Rückmeldung${stats.count===1?'':'en'}`));
    }else summary.textContent='';
    if(!reviews.length){
      const empty=element('div');empty.className='review-empty';
      empty.append(element('span','★'));
      const copy=element('div');copy.append(element('strong','Deine Erfahrung zählt'),element('p','Freigegebene Rückmeldungen erscheinen hier nach einer kurzen Prüfung.'));
      empty.append(copy);list.append(empty);return;
    }
    for(const review of reviews){
      const card=element('article');card.className='review-card';
      card.append(element('div','★'.repeat(review.rating)+'☆'.repeat(5-review.rating)));
      card.lastChild.className='review-stars';
      card.append(element('p',review.message));
      card.append(element('p',`Gastgeber/in · ${new Date(review.created_at).toLocaleDateString('de-DE')}`));
      card.lastChild.className='review-date';list.append(card);
    }
  }
  async function loadReviews(){
    try{const response=await fetch('/api/reviews');if(!response.ok)throw new Error();const data=await response.json();renderReviews(data.reviews||[],data.summary||{count:0});}
    catch{renderReviews([],{count:0});}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();status.textContent='';
    const data=new FormData(form);
    const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
    try{
      if(!csrf){const session=await fetch('/api/auth/me');if(session.ok)csrf=(await session.json()).csrf;}
      const response=await fetch('/api/reviews',{method:'POST',headers:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})},body:JSON.stringify({rating:Number(data.get('rating')),message:data.get('message'),tried:data.get('tried')==='on',publishConsent:data.get('publishConsent')==='on',website:data.get('website')})});
      const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Die Rückmeldung konnte gerade nicht gesendet werden. Bitte versuche es später erneut.');
      status.textContent=result.message||'Danke für deine Rückmeldung.';form.reset();
    }catch(error){status.textContent=error.message;}
    finally{submit.disabled=false;}
  });
  loadReviews();
})();
