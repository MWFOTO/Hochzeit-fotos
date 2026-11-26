const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const sharp=require('sharp');
const {createApp}=require('../server');

test('partner signup, approval, regional listing and referral discount',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-partner-'));
  const amounts=[],mails=[];
  const sessions=new Map();
  const stripe={checkout:{sessions:{create:async data=>{amounts.push(data.line_items[0].price_data.unit_amount);const session={id:`cs_partner_${amounts.length}`,livemode:false,status:'open',payment_status:'unpaid',amount_total:data.line_items[0].price_data.unit_amount,metadata:data.metadata,url:'https://checkout.stripe.com/test'};sessions.set(session.id,session);return session;},retrieve:async id=>({...sessions.get(id)}),expire:async id=>{sessions.set(id,{...sessions.get(id),status:'expired'});}}}};
  const app=createApp({DB_PATH:path.join(root,'events.db'),UPLOAD_DIR:path.join(root,'uploads'),BASE_URL:'http://localhost:3000',STRIPE_WEBHOOK_SECRET:'whsec_test',PAYMENT_ADMIN_EMAILS:'admin@example.test',stripe,mailer:async message=>{mails.push(message);}});
  const db=app.locals.db;
  const users={};
  for(const [id,email,verified] of [['owner','owner@example.test',null],['admin','admin@example.test',Date.now()]]){
    const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO users (id,email,password_hash,created_at,email_verified_at) VALUES (?,?,?,?,?)').run(id,email,'unused',Date.now(),verified);
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),id,csrf,Date.now()+86400000);
    users[id]={token,csrf};
  }
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(url,{user,method='GET',body,form}={})=>{
    const res=await fetch(base+url,{method,headers:{...(user?{Cookie:`event_session=${users[user].token}`,'X-CSRF-Token':users[user].csrf}:{}),...(method!=='GET'?{Origin:'http://localhost:3000'}:{}),...(body?{'Content-Type':'application/json'}:{})},body:form||(body?JSON.stringify(body):undefined)});
    const type=res.headers.get('content-type')||'';
    return {status:res.status,data:type.includes('json')?await res.json():await res.arrayBuffer(),type};
  };
  try {
    for(const page of ['/partner','/partner/anmelden','/partner.js','/partner.css','/partner-signup.js','/partner-nearby.js','/partners-admin.js'])assert.equal((await call(page)).status,200,page);
    assert.equal((await call('/ops/partners')).status,401);
    assert.equal((await call('/ops/partners',{user:'owner'})).status,403);
    assert.equal((await call('/ops/partners',{user:'admin'})).status,200);

    const logo=await sharp({create:{width:900,height:600,channels:3,background:'#49d5e8'}}).png().toBuffer();
    const signup=fields=>{const form=new FormData();for(const [k,v] of Object.entries(fields))form.set(k,v);return form;};
    const valid={company:'Studio Müller',category:'photographer',contactName:'Anna Müller',email:'anna@example.test',postcode:'33330',city:'Gütersloh',regions:'32, 59',website:'studio-mueller.example',description:'Hochzeitsfotografie in OWL.',consent:'true'};
    assert.equal((await call('/api/partners/signup',{method:'POST',form:signup({...valid,consent:'false'})})).status,400);
    assert.equal((await call('/api/partners/signup',{method:'POST',form:signup({...valid,postcode:'333'})})).status,400);
    const withLogo=signup(valid);withLogo.set('logo',new Blob([logo],{type:'image/png'}),'logo.png');
    const created=await call('/api/partners/signup',{method:'POST',form:withLogo});
    assert.equal(created.status,201);
    assert.ok(mails.some(m=>m.to==='admin@example.test'&&/Studio Müller/.test(m.subject)));
    assert.equal((await call('/api/partners/signup',{method:'POST',form:signup({...valid,company:'DJ Süd',category:'music',postcode:'80331',city:'München',regions:''})})).status,201);
    // Honeypot: accepted silently, nothing stored.
    assert.equal((await call('/api/partners/signup',{method:'POST',form:signup({...valid,company:'Spam',website_confirm:'x'})})).status,201);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM partners').get().n,2);

    // Pending partners are not public.
    assert.equal((await call('/api/partners?plz=33330')).data.partners.length,0);
    const admin=(await call('/api/admin/partners',{user:'admin'})).data;
    assert.equal(admin.partners.length,2);
    const mueller=admin.partners.find(p=>p.company==='Studio Müller');
    assert.deepEqual(mueller.regions,['32','33','59']);
    assert.equal(mueller.website,'https://studio-mueller.example/');
    assert.equal((await call(`/api/admin/partners/${mueller.id}`,{user:'owner',method:'PATCH',body:{status:'approved'}})).status,403);
    assert.equal((await call(`/api/admin/partners/${mueller.id}`,{user:'admin',method:'PATCH',body:{status:'approved'}})).status,200);
    const approved=db.prepare('SELECT referral_code,approved_at FROM partners WHERE id=?').get(mueller.id);
    assert.match(approved.referral_code,/^STUDIOMUEL\d{2}$/);
    assert.ok(mails.some(m=>m.to==='anna@example.test'&&m.text.includes(approved.referral_code)));
    assert.equal((await call(`/api/admin/partners/${mueller.id}`,{user:'admin',method:'PATCH',body:{referralCode:'mueller-10'}})).status,200);
    assert.equal(db.prepare('SELECT referral_code FROM partners WHERE id=?').get(mueller.id).referral_code,'MUELLER-10');

    // Regional search uses the first two postcode digits.
    const near=(await call('/api/partners?plz=33415')).data.partners;
    assert.deepEqual(near.map(p=>p.company),['Studio Müller']);
    assert.equal(near[0].email,undefined);
    assert.equal((await call('/api/partners?plz=59555')).data.partners.length,1);
    assert.equal((await call('/api/partners?plz=80331')).data.partners.length,0);
    assert.equal((await call('/api/partners?plz=33415&category=music')).data.partners.length,0);
    const logoRes=await call(near[0].logoUrl);assert.equal(logoRes.status,200);assert.match(logoRes.type,/webp/);
    const meta=await sharp(Buffer.from(logoRes.data)).metadata();assert.ok(meta.width<=480);

    // Album with code and location postcode.
    const eventDate=new Date(Date.now()+60*86400000).toISOString().slice(0,10);
    const ev=await call('/api/events',{user:'owner',method:'POST',body:{eventId:'partner-hochzeit',title:'Hochzeit',eventDate,locationPostcode:'33378',referralCode:'mueller-10'}});
    assert.equal(ev.status,201);assert.equal(ev.data.referralApplied,true);
    const list=(await call('/api/events',{user:'owner'})).data.events;
    assert.equal(list[0].priceCents,4490);
    const nearby=(await call('/api/event/partner-hochzeit/partners',{user:'owner'})).data;
    assert.equal(nearby.postcode,'33378');assert.equal(nearby.partners.length,1);assert.equal(nearby.referral.code,'MUELLER-10');
    assert.equal((await call('/api/event/partner-hochzeit/location',{user:'owner',method:'PATCH',body:{postcode:'12'}})).status,400);
    assert.equal((await call('/api/event/partner-hochzeit/referral',{user:'owner',method:'POST',body:{code:'GIBTSNICHT'}})).status,404);

    assert.equal((await call('/api/checkout',{user:'owner',method:'POST',body:{termsAccepted:true,eventId:'partner-hochzeit'}})).status,200);
    assert.deepEqual(amounts,[4490]);
    assert.equal(db.prepare('SELECT amount_cents FROM payments WHERE event_id=?').get('partner-hochzeit').amount_cents,4490);
    // Removing the code before payment restores the normal price and replaces the open checkout.
    assert.equal((await call('/api/event/partner-hochzeit/referral',{user:'owner',method:'POST',body:{code:''}})).status,200);
    assert.equal((await call('/api/checkout',{user:'owner',method:'POST',body:{termsAccepted:true,eventId:'partner-hochzeit'}})).status,200);
    assert.deepEqual(amounts,[4490,4990]);
    assert.equal(sessions.get('cs_partner_1').status,'expired');
    // Code cannot be changed once paid.
    db.prepare("UPDATE payments SET status='paid' WHERE event_id=?").run('partner-hochzeit');
    assert.equal((await call('/api/event/partner-hochzeit/referral',{user:'owner',method:'POST',body:{code:'MUELLER-10'}})).status,409);

    // Admin stats and deletion.
    db.prepare('UPDATE events SET referral_partner_id=? WHERE id=?').run(mueller.id,'partner-hochzeit');
    const stats=(await call('/api/admin/partners',{user:'admin'})).data.partners.find(p=>p.id===mueller.id);
    assert.equal(stats.paid,1);assert.equal(stats.commissionCents,1000);
    assert.equal((await call(`/api/admin/partners/${mueller.id}`,{user:'admin',method:'DELETE'})).status,200);
    assert.equal((await call('/api/partners?plz=33415')).data.partners.length,0);
    assert.equal(db.prepare('SELECT email,logo FROM partners WHERE id=?').get(mueller.id).email,'');
  } finally {await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(root,{recursive:true,force:true});}
});
