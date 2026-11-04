const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createApp}=require('../server');

test('all new and previously quoted unpaid albums check out at 49.90 EUR',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-price-'));
  const amounts=[];
  const checkoutMessages=[];
  const sessions=new Map([['cs_stale',{id:'cs_stale',livemode:false,status:'open',amount_total:3490,payment_status:'unpaid',metadata:{customerType:'consumer',earlyStartRequest:'false'},url:'https://checkout.stripe.com/stale'}]]);
  const stripe={checkout:{sessions:{create:async data=>{
    amounts.push(data.line_items[0].price_data.unit_amount);
    checkoutMessages.push(data.custom_text.submit.message);
    const session={id:`cs_price_${amounts.length}`,livemode:false,status:'open',payment_status:'unpaid',amount_total:data.line_items[0].price_data.unit_amount,metadata:data.metadata,url:'https://checkout.stripe.com/test'};sessions.set(session.id,session);return session;
  },retrieve:async id=>({...sessions.get(id)}),expire:async id=>{sessions.set(id,{...sessions.get(id),status:'expired'});}}}};
  const app=createApp({DB_PATH:path.join(root,'events.db'),UPLOAD_DIR:path.join(root,'uploads'),BASE_URL:'http://localhost:3000',STRIPE_WEBHOOK_SECRET:'whsec_test',stripe});
  const db=app.locals.db,token='a'.repeat(64),csrf='b'.repeat(64);
  db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('owner','owner@example.test','unused',Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),'owner',csrf,Date.now()+86400000);
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(url,body)=>fetch(base+url,{method:body?'POST':'GET',headers:{Cookie:`event_session=${token}`,'X-CSRF-Token':csrf,Origin:'http://localhost:3000','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  try {
    const plans=await (await request('/api/plans')).json();assert.deepEqual(Object.keys(plans),['event']);assert.equal(plans.event.priceCents,4990);
    const eventDate=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    for(const id of ['new-price','existing-price','legacy-price']) {
      assert.equal((await request('/api/events',{eventId:id,title:'Price test',eventDate,trial:false})).status,201);
      assert.equal(db.prepare('SELECT amount_cents FROM events WHERE id=?').get(id).amount_cents,4990);
    }
    // Simulate a quote created before the price update.
    db.prepare('UPDATE events SET amount_cents=3490 WHERE id=?').run('existing-price');
    db.prepare("UPDATE events SET plan='6m',amount_cents=3900 WHERE id=?").run('legacy-price');
    db.prepare('INSERT INTO payments (id,event_id,amount_cents,months) VALUES (?,?,?,3)').run('old-payment','existing-price',3490);
    db.prepare('INSERT INTO payment_attempts (id,payment_id,stripe_session_id,attempt_no,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('old-attempt','old-payment','cs_stale',1,'open',Date.now(),Date.now());
    for(const id of ['new-price','existing-price','legacy-price'])assert.equal((await request('/api/checkout',{termsAccepted:true,eventId:id})).status,200);
    assert.deepEqual(amounts,[4990,4990,4990]);
    assert.equal(sessions.get('cs_stale').status,'expired');
    assert.match(checkoutMessages[0],/49,90 €/);assert.match(checkoutMessages[1],/49,90 €/);assert.match(checkoutMessages[2],/49,90 €/);assert.match(checkoutMessages[1],/kein echtes Geld eingezogen/);
    assert.deepEqual(db.prepare('SELECT amount_cents FROM payments ORDER BY amount_cents DESC').all().map(row=>row.amount_cents),[4990,4990,4990]);
    assert.equal(db.prepare('SELECT amount_cents FROM events WHERE id=?').get('existing-price').amount_cents,4990);
    assert.equal(db.prepare('SELECT amount_cents FROM events WHERE id=?').get('legacy-price').amount_cents,4990);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(root,{recursive:true,force:true});}
});
