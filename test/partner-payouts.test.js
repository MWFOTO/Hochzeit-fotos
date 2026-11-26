const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createApp}=require('../server');

test('partner commissions become due after the withdrawal period and are settled by credit note',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-payout-'));
  const app=createApp({DB_PATH:path.join(root,'events.db'),UPLOAD_DIR:path.join(root,'uploads'),BASE_URL:'http://localhost:3000',PAYMENT_ADMIN_EMAILS:'admin@example.test',mailer:async()=>{}});
  const db=app.locals.db,token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO users (id,email,password_hash,created_at,email_verified_at) VALUES (?,?,?,?,?)').run('admin','admin@example.test','unused',Date.now(),Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),'admin',csrf,Date.now()+86400000);
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(url,method='GET',body)=>{const res=await fetch(base+url,{method,headers:{Cookie:`event_session=${token}`,'X-CSRF-Token':csrf,...(method!=='GET'?{Origin:'http://localhost:3000'}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const type=res.headers.get('content-type')||'';return {status:res.status,type,data:type.includes('json')?await res.json():Buffer.from(await res.arrayBuffer())};};
  try {
    const now=Date.now(),day=86400000;
    db.prepare("INSERT INTO partners (id,slug,company,category,contact_name,email,postcode,regions,status,consent_at,created_at,updated_at,referral_code) VALUES ('p1','studio','Studio Test','photographer','Anna','anna@example.test','33330','33','approved',?,?,?,'STUDIO10')").run(now,now,now);
    // 4 paid long ago, 1 refunded, 1 withdrawn, 1 still inside the withdrawal period, 1 without partner.
    const add=(id,status,paidAgo,partner='p1')=>{
      db.prepare("INSERT INTO events (id,email,status,created_at,expires_at,referral_partner_id) VALUES (?,?,?,?,?,?)").run(id,'kunde@example.test','paid',now,now+90*day,partner);
      db.prepare('INSERT INTO payments (id,event_id,amount_cents,months,status,paid_at) VALUES (?,?,?,?,?,?)').run('pay-'+id,id,4490,3,status,now-paidAgo*day);
    };
    for(const id of ['a1','a2','a3'])add(id,'paid',20);
    add('a4','refunded',20);add('a5','paid',20);add('a6','paid',3);add('a7','paid',20,null);
    db.prepare("INSERT INTO withdrawal_confirmations (payment_id,customer_name,recipient,statement,submitted_at) VALUES ('pay-a5','X','x@example.test','Widerruf',?)").run(now);

    let s=(await call('/api/admin/partner-settlement')).data.partners.find(p=>p.partnerId==='p1');
    assert.equal(s.due.count,3);assert.equal(s.due.netCents,3000);assert.equal(s.due.vatCents,570);assert.equal(s.waiting.count,1);
    assert.equal(s.canPayout,false);
    assert.equal((await call('/api/admin/partners/p1/payouts','POST',{})).status,400);
    assert.equal((await call('/api/admin/partners/p1/billing','PATCH',{name:'Studio Test GbR',address:'Musterweg 1\n33330 Gütersloh',taxId:'347/5000/1234',smallBusiness:true})).status,200);
    s=(await call('/api/admin/partner-settlement')).data.partners.find(p=>p.partnerId==='p1');
    assert.equal(s.canPayout,true);assert.equal(s.due.grossCents,3000);
    const created=await call('/api/admin/partners/p1/payouts','POST',{});
    assert.equal(created.status,201);assert.match(created.data.number,/^GS-\d{4}-0001$/);
    // Items are settled only once.
    assert.equal((await call('/api/admin/partners/p1/payouts','POST',{})).status,409);
    s=(await call('/api/admin/partner-settlement')).data.partners.find(p=>p.partnerId==='p1');
    assert.equal(s.due.count,0);assert.equal(s.payouts.length,1);assert.equal(s.payouts[0].gross_cents,3000);
    const pdf=await call(`/api/admin/partner-payouts/${created.data.id}/gutschrift.pdf`);
    assert.equal(pdf.status,200);assert.match(pdf.type,/pdf/);assert.equal(pdf.data.subarray(0,5).toString(),'%PDF-');
    assert.equal((await call(`/api/admin/partner-payouts/${created.data.id}`,'PATCH',{paid:true})).status,200);
    assert.ok(db.prepare('SELECT paid_at FROM partner_payouts WHERE id=?').get(created.data.id).paid_at);
  } finally {await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(root,{recursive:true,force:true});}
});
