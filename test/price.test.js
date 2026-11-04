const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createApp}=require('../server');

test('new events and checkout use 49.90 EUR; existing quoted orders keep 34.90 EUR',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-price-'));
  const amounts=[];
  const checkoutMessages=[];
  const stripe={checkout:{sessions:{create:async data=>{
    amounts.push(data.line_items[0].price_data.unit_amount);
    checkoutMessages.push(data.custom_text.submit.message);
    return {id:`cs_price_${amounts.length}`,livemode:false,status:'open',url:'https://checkout.stripe.com/test'};
  }}}};
  const app=createApp({DB_PATH:path.join(root,'events.db'),UPLOAD_DIR:path.join(root,'uploads'),BASE_URL:'http://localhost:3000',STRIPE_WEBHOOK_SECRET:'whsec_test',stripe});
  const db=app.locals.db,token='a'.repeat(64),csrf='b'.repeat(64);
  db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('owner','owner@example.test','unused',Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),'owner',csrf,Date.now()+86400000);
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(url,body)=>fetch(base+url,{method:body?'POST':'GET',headers:{Cookie:`event_session=${token}`,'X-CSRF-Token':csrf,Origin:'http://localhost:3000','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  try {
    const plans=await (await request('/api/plans')).json();assert.equal(plans.event.priceCents,4990);
    const eventDate=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    for(const id of ['new-price','existing-price']) {
      assert.equal((await request('/api/events',{eventId:id,title:'Price test',eventDate,trial:false})).status,201);
      assert.equal(db.prepare('SELECT amount_cents FROM events WHERE id=?').get(id).amount_cents,4990);
    }
    // Simulate a quote created before the price update.
    db.prepare('UPDATE events SET amount_cents=3490 WHERE id=?').run('existing-price');
    for(const id of ['new-price','existing-price'])assert.equal((await request('/api/checkout',{termsAccepted:true,eventId:id})).status,200);
    assert.deepEqual(amounts,[4990,3490]);
    assert.match(checkoutMessages[0],/49,90 €/);assert.match(checkoutMessages[1],/34,90 €/);assert.match(checkoutMessages[1],/kein echtes Geld eingezogen/);
    assert.deepEqual(db.prepare('SELECT amount_cents FROM payments ORDER BY amount_cents DESC').all().map(row=>row.amount_cents),[4990,3490]);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(root,{recursive:true,force:true});}
});
