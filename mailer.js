// Transactional delivery only. Never log keys, tokens or message bodies.
function createMailer(cfg, transport=fetch){
 if(!cfg.BREVO_API_KEY)return null;
 const sender={email:cfg.BREVO_SENDER_EMAIL||'info@matthiaswendlandfotografie.com',name:cfg.BREVO_SENDER_NAME||'Event-Fotos · Matthias Wendland'};
 return async({to,subject,text})=>{const response=await transport('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':cfg.BREVO_API_KEY,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({sender,to:[{email:to}],subject,textContent:text}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Mailversand fehlgeschlagen (${response.status})`);};
}
module.exports={createMailer};
