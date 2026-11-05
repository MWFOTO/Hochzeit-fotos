const {test}=require('node:test');const assert=require('node:assert/strict');const {createMailer}=require('../mailer');
test('Brevo adapter uses configured sender, API key and plain text; disabled without key',async()=>{
 assert.equal(createMailer({}),null);let request;
 const mailer=createMailer({BREVO_API_KEY:'local-fake-key'},async(url,options)=>{request={url,options};return {ok:true};});
 const attachments=[{name:'FinalSnap-Rechnung-TEST-001.pdf',content:'JVBERi0xLjQ='}];
 await mailer({to:'test@example.com',subject:'Test',text:'Token link',html:'<p>Order confirmed</p>',attachments});const body=JSON.parse(request.options.body);
 assert.equal(request.url,'https://api.brevo.com/v3/smtp/email');assert.equal(request.options.headers['api-key'],'local-fake-key');assert.equal(body.sender.email,'info@finalsnap.de');assert.equal(body.textContent,'Token link');assert.equal(body.htmlContent,'<p>Order confirmed</p>');assert.deepEqual(body.attachment,attachments);
 const broken=createMailer({BREVO_API_KEY:'local-fake-key'},async()=>({ok:false,status:400,json:async()=>({code:'invalid_parameter',message:'Invalid attachment URL https://private.example/file?token=secret for test@example.com'})}));await assert.rejects(broken({to:'test@example.com',subject:'Test',text:'Text'}),error=>{assert.match(error.message,/400: invalid_parameter/);assert.doesNotMatch(error.message,/secret|private\.example|test@example\.com/);return true;});
});
