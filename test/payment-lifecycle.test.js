const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Stripe=require('stripe');
const {createApp}=require('../server');

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-payment-lifecycle-'));
const signing='whsec_payment_lifecycle_test';
const signer=new Stripe('sk_test_payment_lifecycle');
const sessions=new Map();
let created=0;
const checkoutRequests=[];
const notifications=[];
const fake={
  webhooks:signer.webhooks,
  invoices:{retrieve:async id=>({id,invoice_pdf:'https://invoice.stripe.com/i/test-pdf'})},
  checkout:{sessions:{
    create:async(data,options)=>{
      created++;
      checkoutRequests.push(data);
      const session={id:`cs_test_${created}`,livemode:false,status:'open',payment_status:'unpaid',mode:data.mode,metadata:data.metadata,currency:'eur',amount_total:data.line_items[0].price_data.unit_amount,payment_intent:`pi_test_${created}`,invoice:`in_test_${created}`,customer:`cus_test_${created}`,url:'https://checkout.stripe.com/test'};
      sessions.set(session.id,session);return session;
    },
    retrieve:async id=>{const session=sessions.get(id);if(!session){const error=new Error('No such checkout session');error.code='resource_missing';throw error;}return session;},
    expire:async id=>{const session=sessions.get(id);session.status='expired';return session;}
  }},
  refunds:{create:async(data,options)=>{const refund={id:`re_test_${options.idempotencyKey}`,livemode:false,status:'pending',amount:data.amount,reason:data.reason,payment_intent:data.payment_intent,metadata:data.metadata};await webhook('refund.created',refund,`evt_${refund.id}_created`);return {...refund,status:'succeeded'};}}
};
const app=createApp({
  DB_PATH:path.join(tmp,'events.db'),UPLOAD_DIR:path.join(tmp,'uploads'),BASE_URL:'http://localhost:3000',
  STRIPE_WEBHOOK_SECRET:signing,STRIPE_TAX_ENABLED:'1',PAYMENT_ADMIN_EMAILS:'admin@finalsnap.de',PAYMENT_ALERT_EMAIL:'admin@finalsnap.de',
  stripe:fake,mailer:async message=>notifications.push(message)
});
const server=app.listen(0),origin=`http://127.0.0.1:${server.address().port}`;
after(()=>{server.close();app.locals.db.close();fs.rmSync(tmp,{recursive:true,force:true});});
async function request(url,{user,method='GET',body,headers={}}={}){
  const response=await fetch(origin+url,{method,headers:{...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...(method!=='GET'?{Origin:'http://localhost:3000'}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,redirect:'manual'});
  return {response,data:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text()};
}
async function register(email){
  const result=await request('/api/auth/register',{method:'POST',body:{email,password:'a-long-test-password'}});
  assert.equal(result.response.status,200);
  return {id:result.data.user.id,cookie:result.response.headers.get('set-cookie').split(';')[0],csrf:result.data.csrf};
}
async function webhook(type,object,id){
  const payload=JSON.stringify({id,type,livemode:false,data:{object}});
  const signature=signer.webhooks.generateTestHeaderString({payload,secret:signing});
  const response=await fetch(origin+'/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature,'Content-Type':'application/json'},body:payload});
  return response.status;
}
test('Checkout retries the same album; refund decisions and dispute events are audited and control access',async()=>{
  const admin=await register('admin@finalsnap.de');
  assert.equal((await request('/ops/payments',{user:admin})).response.status,403);
  app.locals.db.prepare('UPDATE users SET email_verified_at=? WHERE id=?').run(Date.now(),admin.id);
  assert.equal((await request('/ops/payments',{user:admin})).response.status,200);
  const eventDate=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  assert.equal((await request('/api/events',{user:admin,method:'POST',body:{eventId:'refund-event',title:'Refund test album',eventDate,trial:false}})).response.status,201);
  const first=await request('/api/checkout',{user:admin,method:'POST',body:{eventId:'refund-event'}});
  assert.equal(first.response.status,200);assert.equal(created,1);
  assert.equal(checkoutRequests[0].automatic_tax.enabled,true);assert.equal(checkoutRequests[0].billing_address_collection,'required');assert.equal(checkoutRequests[0].tax_id_collection.enabled,true);assert.equal(checkoutRequests[0].invoice_creation.enabled,true);assert.equal(checkoutRequests[0].line_items[0].price_data.tax_behavior,'inclusive');
  const payment=app.locals.db.prepare('SELECT * FROM payments WHERE event_id=?').get('refund-event');
  const session1=sessions.get(payment.stripe_session_id);
  const repeated=await request('/api/checkout',{user:admin,method:'POST',body:{eventId:'refund-event'}});
  assert.equal(repeated.response.status,200);assert.equal(created,1);assert.equal(repeated.data.url,first.data.url);
  session1.status='expired';
  assert.equal(await webhook('checkout.session.expired',session1,'evt_expired'),200);
  const retryState=await request(`/api/checkout/${session1.id}`,{user:admin});
  assert.equal(retryState.data.status,'retry_available');assert.equal(retryState.data.retryAvailable,true);
  const second=await request('/api/checkout',{user:admin,method:'POST',body:{eventId:'refund-event'}});
  assert.equal(second.response.status,200);assert.equal(second.data.attempt,2);assert.equal(created,2);
  const session2=sessions.get(app.locals.db.prepare('SELECT stripe_session_id FROM payments WHERE id=?').get(payment.id).stripe_session_id);
  assert.notEqual(session1.id,session2.id);
  session2.status='complete';session2.payment_status='paid';
  assert.equal(await webhook('checkout.session.completed',session2,'evt_paid'),200);
  assert.equal(app.locals.db.prepare('SELECT stripe_invoice_id,stripe_customer_id FROM payments WHERE id=?').get(payment.id).stripe_invoice_id,'in_test_2');
  const albumInvoices=await request('/api/events',{user:admin});assert.equal(albumInvoices.data.events[0].hasInvoice,true);
  const invoiceLink=await request('/api/event/refund-event/invoice',{user:admin});assert.equal(invoiceLink.response.status,302);assert.equal(invoiceLink.response.headers.get('location'),'https://invoice.stripe.com/i/test-pdf');
  const token=app.locals.db.prepare('SELECT guest_token FROM events WHERE id=?').get('refund-event').guest_token;
  assert.equal((await request(`/event/refund-event?token=${token}`)).response.status,200);

  const dispute={id:'dp_test_1',livemode:false,status:'needs_response',reason:'product_not_received',amount:4990,currency:'eur',charge:'ch_test_1',payment_intent:session2.payment_intent};
  assert.equal(await webhook('charge.dispute.created',dispute,'evt_dispute_open'),200);
  assert.equal(app.locals.db.prepare('SELECT status FROM payments WHERE id=?').get(payment.id).status,'disputed');
  assert.equal(app.locals.db.prepare('SELECT status FROM events WHERE id=?').get('refund-event').status,'paid');
  assert.equal((await request(`/event/refund-event?token=${token}`)).response.status,200);
  assert.equal(await webhook('charge.dispute.updated',{...dispute,status:'needs_response'},'evt_dispute_updated'),200);
  assert.equal(app.locals.db.prepare("SELECT a.status FROM payment_alerts a JOIN payment_events e ON e.id=a.event_id WHERE e.stripe_event_id='evt_dispute_updated'").get().status,'sent');
  await app.locals.flushPaymentAlerts();
  assert.equal(app.locals.db.prepare("SELECT COUNT(*) n FROM payment_alerts WHERE status='pending'").get().n,0);
  assert.equal(await webhook('charge.dispute.closed',{...dispute,status:'won'},'evt_dispute_won'),200);
  assert.equal(app.locals.db.prepare('SELECT status FROM payments WHERE id=?').get(payment.id).status,'paid');
  const disputedAgain={...dispute,id:'dp_test_2'};
  assert.equal(await webhook('charge.dispute.created',disputedAgain,'evt_dispute_reopened'),200);
  assert.equal(await webhook('charge.dispute.closed',{...disputedAgain,status:'lost'},'evt_dispute_lost'),200);
  assert.equal(app.locals.db.prepare('SELECT status FROM payments WHERE id=?').get(payment.id).status,'disputed_lost');
  assert.equal((await request(`/event/refund-event?token=${token}`)).response.status,402);
  assert.equal(await webhook('charge.dispute.funds_reinstated',disputedAgain,'evt_funds_reinstated'),200);
  assert.equal(app.locals.db.prepare('SELECT status FROM payments WHERE id=?').get(payment.id).status,'paid');
  assert.equal((await request(`/event/refund-event?token=${token}`)).response.status,200);

  const noReason=await request(`/api/admin/payments/${payment.id}/refunds`,{user:admin,method:'POST',body:{amountCents:1000,reason:'requested_by_customer',note:'zu kurz'}});
  assert.equal(noReason.response.status,400);
  const partial=await request(`/api/admin/payments/${payment.id}/refunds`,{user:admin,method:'POST',body:{amountCents:1000,reason:'requested_by_customer',note:'Kunde hat eine Teilerstattung angefragt.'}});
  assert.equal(partial.response.status,202);assert.equal(partial.data.status,'succeeded');
  assert.equal(app.locals.db.prepare('SELECT status FROM payments WHERE id=?').get(payment.id).status,'partially_refunded');
  assert.equal((await request(`/event/refund-event?token=${token}`)).response.status,200);
  const externalRefund={id:'re_test_external',livemode:false,status:'pending',amount:500,currency:'eur',reason:'requested_by_customer',payment_intent:session2.payment_intent};
  assert.equal(await webhook('refund.created',externalRefund,'evt_refund_created'),200);
  assert.equal(await webhook('refund.updated',{...externalRefund,status:'succeeded'},'evt_refund_updated'),200);
  assert.equal(app.locals.db.prepare("SELECT status FROM refunds WHERE stripe_refund_id='re_test_external'").get().status,'succeeded');
  assert.equal(app.locals.db.prepare('SELECT status FROM payments WHERE id=?').get(payment.id).status,'partially_refunded');
  assert.equal(await webhook('charge.refunded',{id:'ch_test_1',livemode:false,payment_intent:session2.payment_intent,amount:4990,amount_refunded:1500,currency:'eur',refunded:false},'evt_charge_refunded'),200);
  const full=await request(`/api/admin/payments/${payment.id}/refunds`,{user:admin,method:'POST',body:{reason:'requested_by_customer',note:'Vertrag widerrufen; vollständiger Betrag wird erstattet.'}});
  assert.equal(full.response.status,202);assert.equal(full.data.status,'succeeded');
  assert.equal(app.locals.db.prepare('SELECT status FROM payments WHERE id=?').get(payment.id).status,'refunded');
  assert.equal(app.locals.db.prepare('SELECT status FROM events WHERE id=?').get('refund-event').status,'refunded');
  assert.equal((await request(`/event/refund-event?token=${token}`)).response.status,402);
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM payment_attempts WHERE payment_id=?').get(payment.id).n,2);
  assert.ok(app.locals.db.prepare('SELECT COUNT(*) n FROM payment_events WHERE payment_id=?').get(payment.id).n>=11);
  assert.ok(notifications.length>=5);
  assert.ok(notifications.every(message=>message.to==='admin@finalsnap.de'));
  assert.equal(app.locals.db.prepare("SELECT COUNT(*) n FROM payment_alerts WHERE status='pending'").get().n,0);
  const other=await register('other@finalsnap.de');assert.equal((await request('/api/event/refund-event/invoice',{user:other})).response.status,404);
  const payments=await request('/api/admin/payments',{user:admin});
  assert.equal(payments.response.status,200);assert.equal(payments.data.payments[0].refunds.length,3);
});
