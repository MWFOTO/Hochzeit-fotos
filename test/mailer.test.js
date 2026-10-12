const {test}=require('node:test');const assert=require('node:assert/strict');const {createMailer}=require('../mailer');
test('Brevo adapter uses configured sender, API key and plain text; disabled without key',async()=>{
 assert.equal(createMailer({}),null);let request;
 const mailer=createMailer({BREVO_API_KEY:'local-fake-key'},async(url,options)=>{request={url,options};return {ok:true};});
 await mailer({to:'test@example.com',subject:'Test',text:'Token link'});const body=JSON.parse(request.options.body);
 assert.equal(request.url,'https://api.brevo.com/v3/smtp/email');assert.equal(request.options.headers['api-key'],'local-fake-key');assert.equal(body.sender.email,'info@matthiaswendlandfotografie.com');assert.equal(body.textContent,'Token link');
 const broken=createMailer({BREVO_API_KEY:'local-fake-key'},async()=>({ok:false,status:401}));await assert.rejects(broken({to:'test@example.com',subject:'Test',text:'Text'}),/401/);
});
