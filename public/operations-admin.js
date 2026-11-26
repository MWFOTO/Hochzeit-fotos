(() => {
  const status=document.getElementById('status'),eventsNode=document.getElementById('events');
  const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  const date=value=>new Date(`${value}T12:00:00`).toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'});
  async function load(){
    try{
      const response=await fetch('/api/admin/upcoming-events',{headers:{Accept:'application/json'}}),data=await response.json();
      if(!response.ok)throw new Error(data.error||'Veranstaltungen konnten nicht geladen werden.');
      eventsNode.replaceChildren();
      if(!data.events.length){eventsNode.append(node('article','Keine Veranstaltung in den nächsten drei Tagen.'));status.textContent=`Geprüfter Zeitraum: ${date(data.today)} bis ${date(data.through)}.`;return;}
      for(const event of data.events){
        const card=node('article');card.className='backup-stat';
        card.append(node('h2',event.title),node('strong',date(event.eventDate)),node('p',`Album-ID: ${event.id} · Status: ${event.status}`),node('p',`Uploads bisher: ${event.uploadSuccesses} erfolgreich · ${event.uploadFailures} fehlgeschlagen`));
        eventsNode.append(card);
      }
      status.textContent=`Geprüfter Zeitraum: ${date(data.today)} bis ${date(data.through)} · ${data.events.length} Veranstaltung${data.events.length===1?'':'en'}.`;
    }catch(error){status.textContent=error.message;status.className='error';}
  }
  load();
})();
