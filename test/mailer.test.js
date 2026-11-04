const {test}=require('node:test');const assert=require('node:assert/strict');const {createMailer}=require('../mailer');
test('Brevo adapter uses configured sender, API key and plain text; disabled without key',async()=>{
 assert.equal(createMailer({}),null);let request;
 const mailer=createMailer({BREVO_API_KEY:'local-fake-key'},async(url,options)=>{request={url,options};return {ok:true};});
 const attachments=[{name:'FinalSnap-Rechnung-TEST-001.pdf',url:'https://invoice.stripe.com/i/test-pdf'}];
 await mailer({to:'test@example.com',subject:'Test',text:'Token link',html:'<p>Order confirmed</p>',attachments});const body=JSON.parse(request.options.body);
 assert.equal(request.url,'https://api.brevo.com/v3/smtp/email');assert.equal(request.options.headers['api-key'],'local-fake-key');assert.equal(body.sender.email,'info@finalsnap.de');assert.equal(body.textContent,'Token link');assert.equal(body.htmlContent,'<p>Order confirmed</p>');assert.deepEqual(body.attachment,attachments);
 const broken=createMailer({BREVO_API_KEY:'local-fake-key'},async()=>({ok:false,status:401}));await assert.rejects(broken({to:'test@example.com',subject:'Test',text:'Text'}),/401/);
});
