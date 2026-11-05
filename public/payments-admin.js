(() => {
  let csrf;
  const status=document.getElementById('status'), root=document.getElementById('payments');
  const money=cents=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(Number(cents||0)/100);
  const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  async function api(url,method='GET',body){
    if(method!=='GET'&&!csrf){const session=await fetch('/api/auth/me');if(session.ok)csrf=(await session.json()).csrf;}
    const response=await fetch(url,{method,headers:{...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Anfrage fehlgeschlagen.');return data;
  }
  function render(payment){
    const card=el('article');card.className='event-card';
    card.append(el('h2',payment.title||payment.event_id),el('p',`Album ${payment.event_id} · ${payment.email||'kein Konto-E-Mail-Eintrag'} · ${new Date(payment.created_at||Date.now()).toLocaleString('de-DE')}`),el('p',`Status ${payment.status} · Gesamt ${money(payment.amount_cents)} · erstattet ${money(payment.refunded_cents)}`));
    if(payment.stripe_invoice_id)card.append(el('p',`Stripe-Rechnungs-ID: ${payment.stripe_invoice_id}`));
    if(payment.attempts.length)card.append(el('p',`Checkout-Versuche: ${payment.attempts.length} · ${payment.attempts.map(item=>`Versuch ${item.attempt_no}: ${item.status}`).join(', ')}`));
    if(['paid','partially_refunded'].includes(payment.status)){
      const form=el('form');form.className='event-form';
      const amountLabel=el('label','Erstattungsbetrag in Euro (leer = Restbetrag)');const amount=el('input');amount.type='number';amount.min='0.01';amount.step='0.01';amount.max=((payment.amount_cents-payment.refunded_cents)/100).toFixed(2);amountLabel.append(amount);
      const reasonLabel=el('label','Grund');const reason=el('select');for(const [value,label] of [['requested_by_customer','Kundenanfrage / Widerruf'],['duplicate','Doppelzahlung'],['fraudulent','Betrugsverdacht']]){const option=el('option',label);option.value=value;reason.append(option);}reasonLabel.append(reason);
      const noteLabel=el('label','Entscheidung und Begründung (mindestens 20 Zeichen)');const note=el('input');note.required=true;note.minLength=20;note.maxLength=1000;noteLabel.append(note);
      const submit=el('button','Erstattung im Stripe-Testmodus auslösen');submit.className='danger';form.append(amountLabel,reasonLabel,noteLabel,submit);
      form.onsubmit=async event=>{event.preventDefault();if(!confirm('Erstattung ausführen? Die Entscheidung wird protokolliert. Auch nach einem bestätigten Vollrefund bleibt das Album bis zum gebuchten Ablaufdatum zugänglich.'))return;submit.disabled=true;try{const data=await api(`/api/admin/payments/${encodeURIComponent(payment.id)}/refunds`,'POST',{amountCents:amount.value?Math.round(Number(amount.value)*100):undefined,reason:reason.value,note:note.value});status.textContent=`Erstattung ${data.refundId}: ${data.status}.${data.message?` ${data.message}`:''}`;await load();}catch(error){status.textContent=error.message;submit.disabled=false;}};
      card.append(form);
    }
    const history=el('details');history.className='event-section';history.append(el('summary','Zahlungsverlauf und Entscheidungen'));
    for(const item of payment.events){const line=el('p',`${new Date(item.created_at).toLocaleString('de-DE')} · ${item.event_type} · ${item.status}${item.amount_cents?` · ${money(item.amount_cents)}`:''}${item.actor_email?` · ${item.actor_email}`:''}${item.note?` · ${item.note}`:''}${item.alert_status?` · Alarm ${item.alert_status} (${item.alert_attempts} Versuch(e))${item.alert_error?`: ${item.alert_error}`:''}`:''}`);history.append(line);}
    for(const refund of payment.refunds)history.append(el('p',`Erstattung ${money(refund.amount_cents)} · ${refund.status} · ${refund.reason} · Entscheidung: ${refund.decision_note} · ${refund.actor_email}`));
    card.append(history);return card;
  }
  async function load(){status.textContent='Lade Zahlungen …';root.replaceChildren();try{const {payments}=await api('/api/admin/payments');if(!payments.length){status.textContent='Noch keine Zahlungen vorhanden.';return;}status.textContent=`${payments.length} Zahlung(en) · neueste zuerst.`;for(const payment of payments)root.append(render(payment));}catch(error){status.textContent=error.message;}}
  document.getElementById('refresh').onclick=load;load();
})();
