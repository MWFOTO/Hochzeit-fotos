const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const sharp=require('sharp');
const Stripe=require('stripe');
const {createApp}=require('../server');
const {openDatabase}=require('../db');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'event-platform-'));
const signing='whsec_local_test_only';
const signer=new Stripe('sk_test_local_test_only');
let creations=0;
const sessions=new Map();
const fake={webhooks:signer.webhooks,checkout:{sessions:{create:async(data,options)=>{
  creations++;const session={id:'cs_test_'+options.idempotencyKey,livemode:false,status:'open',payment_status:'unpaid',mode:data.mode,metadata:data.metadata,currency:'eur',amount_total:data.line_items[0].price_data.unit_amount,url:'https://checkout.stripe.com/test'};sessions.set(session.id,session);return session;
},retrieve:async id=>sessions.get(id)}}};
const sentMail=[];
const app=createApp({mailer:async message=>sentMail.push(message),DB_PATH:path.join(tmp,'events.db'),UPLOAD_DIR:path.join(tmp,'uploads'),BASE_URL:'http://localhost:3000',STRIPE_WEBHOOK_SECRET:signing,stripe:fake,MAX_EVENT_PHOTOS:2});
const server=app.listen(0);
const origin=`http://127.0.0.1:${server.address().port}`;
after(()=>{server.close();app.locals.db.close();fs.rmSync(tmp,{recursive:true,force:true});});
async function request(url,{user,body,method='GET',headers={},form}={}) {
  const res=await fetch(origin+url,{method,headers:{...(user?{Cookie:user.cookie,'X-CSRF-Token':user.csrf}:{}),...(method!=='GET'?{Origin:'http://localhost:3000'}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:form || (body?JSON.stringify(body):undefined),redirect:'manual'});
  return {status:res.status,res,data:res.headers.get('content-type')?.includes('application/json')?await res.json():await res.arrayBuffer()};
}
async function register(email) {const r=await request('/api/auth/register',{method:'POST',body:{email,password:'a-good-long-password'}});assert.equal(r.status,200);return {cookie:r.res.headers.get('set-cookie').split(';')[0],csrf:r.data.csrf,id:r.data.user.id};}
async function webhook(session,{type='checkout.session.completed',id='evt_'+Math.random(),signature=true}={}) {
  const payload=JSON.stringify({id,type,livemode:false,data:{object:session}});
  const header=signature?signer.webhooks.generateTestHeaderString({payload,secret:signing}):'invalid';
  const res=await fetch(origin+'/api/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':header},body:payload});return res.status;
}
let user,other,paidSession,token,photo;
test('Registration, login, session, CSRF and protected dashboard',async()=>{
  assert.equal((await request('/dashboard')).status,302);
  user=await register('owner@example.com');other=await register('other@example.com');
  assert.equal((await request('/api/auth/login',{method:'POST',body:{email:'owner@example.com',password:'wrong-password'}})).status,401);
  assert.equal((await request('/api/auth/login',{method:'POST',body:{email:'owner@example.com',password:'a-good-long-password'}})).status,200);
  assert.equal((await request('/api/events',{method:'POST',user:{...user,csrf:''},body:{}})).status,403);
  assert.equal((await request('/api/events',{method:'POST',user,headers:{Origin:'https://evil.example'},body:{}})).status,403);
  assert.equal((await request('/dashboard',{user})).status,200);
});
test('Multiple events, ownership and pending payment gate',async()=>{
  for(const eventId of ['birthday','company'])assert.equal((await request('/api/events',{method:'POST',user,body:{eventId,title:'Test Event',plan:'1m',trial:false,...(eventId==='birthday'?{moderation:true}:{})}})).status,201);
  assert.equal((await request('/api/events',{user})).data.events.length,2);
  assert.equal((await request('/api/events',{method:'POST',user:other,body:{eventId:'birthday',title:'Collision',plan:'1m'}})).status,409);
  assert.equal((await request('/event/birthday')).status,402);
  assert.equal((await request('/api/event/birthday/qr',{user})).status,402);
  assert.equal((await request('/api/checkout',{method:'POST',user:other,body:{eventId:'birthday'}})).status,404);
});
test('Checkout idempotency, signature, unpaid/amount/live rejection and delayed payment',async()=>{
  for(let i=0;i<2;i++)assert.equal((await request('/api/checkout',{method:'POST',user,body:{eventId:'birthday'}})).status,200);
  assert.equal(creations,1);paidSession=[...sessions.values()][0];
  assert.equal(await webhook(paidSession,{signature:false}),400);
  assert.equal(await webhook(paidSession),200);assert.equal(app.locals.db.prepare('SELECT status FROM events WHERE id=?').get('birthday').status,'pending');
  const paid={...paidSession,payment_status:'paid'};
  assert.equal(await webhook({...paid,amount_total:1}),500);
  assert.equal(await webhook({...paid,livemode:true}),500);
  assert.equal(await webhook(paid,{type:'checkout.session.async_payment_succeeded',id:'evt_paid'}),200);
  const expiry=app.locals.db.prepare('SELECT expires_at FROM events WHERE id=?').get('birthday').expires_at;
  assert.equal(await webhook(paid,{id:'evt_paid'}),200);assert.equal(await webhook(paid,{id:'evt_second'}),200);
  assert.equal(app.locals.db.prepare('SELECT expires_at FROM events WHERE id=?').get('birthday').expires_at,expiry);
  assert.equal((await request(`/api/checkout/${paid.id}`,{user:other})).status,404);
  token=app.locals.db.prepare('SELECT guest_token FROM events WHERE id=?').get('birthday').guest_token;
  assert.equal((await request('/event/birthday')).status,403);
  const guestLanding=await request(`/event/birthday?token=${token}`);
  assert.equal(guestLanding.status,200);
  assert.match(Buffer.from(guestLanding.data).toString(),/id="upload-link"/);
  const uploadPage=await request(`/event/birthday/upload?token=${token}`);
  assert.equal(uploadPage.status,200);
  assert.match(Buffer.from(uploadPage.data).toString(),/id="file-input"/);
  assert.equal((await request('/photographer.webp')).status,200);
  assert.equal((await request('/public/server.js')).status,404);assert.equal((await request('/server.js')).status,404);
  assert.equal((await request('/upload.html')).status,404);
});
async function upload(buffer,name='photo.jpg') {const form=new FormData();form.append('photos',new Blob([buffer],{type:'image/jpeg'}),name);return request(`/api/event/birthday/upload?token=${token}`,{method:'POST',form});}
test('Content validation, guest upload, moderation, protected files, QR, quota and ZIP',async()=>{
  assert.equal((await upload(Buffer.from('<script>evil</script>'))).status,400);
  const image=await sharp({create:{width:20,height:20,channels:3,background:'red'}}).jpeg().toBuffer();
  assert.equal((await upload(image)).status,200);
  assert.equal((await request(`/api/event/birthday/photos?token=${token}`)).data.photos.length,0);
  const stats=(await request('/api/events',{user})).data.events.find(e=>e.id==='birthday');
  assert.equal(stats.photoCount,1);assert.ok(stats.storageBytes>0);assert.equal(stats.storageLimitBytes,2*1024**3);
  assert.equal((await request('/api/events',{user:other})).data.events.length,0);
  photo=(await request('/api/event/birthday/photos?manage=1',{user})).data.photos[0];
  assert.equal((await request(photo.url)).status,403);
  assert.equal((await request(photo.url+`?token=${token}`)).status,404);
  assert.equal((await request(`/api/event/birthday/photos/${photo.id}`,{method:'PATCH',user:other,body:{approved:true}})).status,404);
  assert.equal((await request(`/api/event/birthday/photos/${photo.id}`,{method:'PATCH',user,body:{approved:true}})).status,200);
  assert.equal((await request(photo.url+`?token=${token}`)).status,200);
  const meta=await sharp(Buffer.from((await request(photo.url,{user})).data)).metadata();assert.equal(meta.exif,undefined);
  assert.equal((await request(`/api/event/birthday/download?token=${token}`)).status,200);
  const qr=await request('/api/event/birthday/qr',{user});assert.equal(qr.status,200);assert.equal((await sharp(Buffer.from(qr.data)).metadata()).width,1200);
  assert.equal(app.locals.db.prepare('SELECT moderation FROM events WHERE id=?').get('company').moderation,0);
  assert.equal((await request('/api/event/birthday',{method:'PATCH',user,body:{moderation:false}})).status,200);
  assert.equal((await upload(image)).status,200);
  assert.equal((await request(`/api/event/birthday/photos?token=${token}`)).data.photos.length,2);
  assert.equal((await upload(image)).status,400);
  assert.equal(fs.readdirSync(path.join(tmp,'uploads','.tmp')).length,0);
  assert.equal((await request(`/api/event/birthday/photos/${photo.id}`,{method:'DELETE',user})).status,200);
  assert.equal((await request(photo.url,{user})).status,404);
});
test('Rotating guest links, expiry and automatic deletion',async()=>{
  assert.equal((await request('/api/event/birthday/rotate-token',{method:'POST',user})).status,200);
  assert.equal((await request(`/event/birthday?token=${token}`)).status,403);
  app.locals.db.prepare('UPDATE events SET expires_at=? WHERE id=?').run(Date.now()-1,'birthday');
  assert.equal((await request('/api/event/birthday/photos',{user})).status,402);
  app.locals.cleanup();assert.equal(fs.existsSync(path.join(tmp,'uploads','birthday')),false);
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) n FROM photos').get().n,0);
});
test('Live key blocked and old SQLite schema migrated without overwriting rows',()=>{
  assert.throws(()=>createApp({STRIPE_SECRET_KEY:'sk_live_forbidden'}),/Testschlüssel/);
  const Database=require('better-sqlite3');const filename=path.join(tmp,'legacy.db');const old=new Database(filename);
  old.exec("CREATE TABLE events (id TEXT PRIMARY KEY,email TEXT,plan TEXT,amount_cents INTEGER,stripe_session_id TEXT,status TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER); INSERT INTO events VALUES ('legacy','old@example.com','1m',1900,'cs_old','paid',1,9999999999999)");old.close();
  const migrated=openDatabase(filename);const e=migrated.prepare('SELECT * FROM events').get();assert.equal(e.status,'paid');assert.equal(e.stripe_session_id,'cs_old');assert.equal(e.owner_id,null);migrated.close();
});
test('Legacy import dry-run, backup, ownership, no overwrite and repeatability',async()=>{
  const {importLegacy}=require('../scripts/import-legacy');
  const dbPath=path.join(tmp,'import.db'),uploadRoot=path.join(tmp,'import-uploads');
  const db=openDatabase(dbPath);db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('legacy-owner','legacy@example.com','unused',1);db.close();
  fs.mkdirSync(path.join(uploadRoot,'legacy-photo'),{recursive:true});
  const original=await sharp({create:{width:10,height:10,channels:3,background:'blue'}}).png().toBuffer();
  const file=path.join(uploadRoot,'legacy-photo','original.png');fs.writeFileSync(file,original);
  const args={dbPath,uploadRoot,eventId:'legacy-photo',ownerEmail:'legacy@example.com'};
  assert.equal((await importLegacy(args)).newPhotos,1);
  let check=openDatabase(dbPath);assert.equal(check.prepare('SELECT COUNT(*) n FROM events').get().n,0);check.close();
  await importLegacy({...args,apply:true});
  check=openDatabase(dbPath);assert.equal(check.prepare('SELECT status FROM events').get().status,'pending');assert.equal(check.prepare('SELECT approved FROM photos').get().approved,0);check.close();
  assert.deepEqual(fs.readFileSync(file),original);
  assert.equal((await importLegacy({...args,apply:true})).newPhotos,0);
  assert.ok(fs.readdirSync(tmp).some(name=>name.startsWith('import.db.before-import-')));
});
test('Sessions persist across application restart and logout invalidates them',async()=>{
  const second=createApp({DB_PATH:path.join(tmp,'events.db'),UPLOAD_DIR:path.join(tmp,'uploads'),BASE_URL:'http://localhost:3000'});
  const restarted=second.listen(0);
  try{
    const response=await fetch(`http://127.0.0.1:${restarted.address().port}/api/auth/me`,{headers:{Cookie:other.cookie}});
    assert.equal(response.status,200);
  }finally{restarted.close();second.locals.db.close();}
  assert.equal((await request('/api/auth/logout',{method:'POST',user:other})).status,200);
  assert.equal((await request('/api/auth/me',{user:other})).status,401);
});

test('Free trial quota, compression, counters and upgrade preserve photos and guest link',async()=>{
  const trialUser=await register('trial@example.com');
  const created=await request('/api/events',{method:'POST',user:trialUser,body:{eventId:'trial-event',title:'Trial',plan:'1m'}});assert.equal(created.data.trial,true);
  let event=(await request('/api/events',{user:trialUser})).data.events[0];assert.equal(event.status,'trial');assert.equal(event.photoLimit,25);assert.ok(event.guestUrl);
  const trialToken=new URL(event.guestUrl).searchParams.get('token');
  const small=await sharp({create:{width:30,height:20,channels:3,background:'blue'}}).jpeg().toBuffer();
  const large=await sharp({create:{width:4000,height:3000,channels:3,background:'red'}}).jpeg().toBuffer();
  const send=async(n,buffer=small)=>{const form=new FormData();for(let i=0;i<n;i++)form.append('photos',new Blob([buffer],{type:'image/jpeg'}),'test.jpg');return request(`/api/event/trial-event/upload?token=${trialToken}`,{method:'POST',form});};
  assert.equal((await send(1,large)).status,200);
  const photoList=(await request('/api/event/trial-event/photos',{user:trialUser})).data.photos;
  const resized=await sharp(Buffer.from((await request(photoList[0].url,{user:trialUser})).data)).metadata();assert.equal(resized.width,2560);assert.equal(resized.height,1920);
  assert.equal((await send(10)).status,200);assert.equal((await send(10)).status,200);assert.equal((await send(4)).status,200);assert.equal((await send(1)).status,400);
  event=(await request('/api/events',{user:trialUser})).data.events[0];assert.equal(event.photoCount,25);assert.equal(event.upload_successes,4);assert.equal(event.upload_failures,1);
  assert.equal((await request('/api/event/trial-event/qr',{user:trialUser})).status,200);
  const second=await request('/api/events',{method:'POST',user:trialUser,body:{eventId:'second-trial',title:'Second',plan:'1m'}});assert.equal(second.data.trial,false);
  assert.equal((await request('/api/checkout',{method:'POST',user:trialUser,body:{eventId:'trial-event'}})).status,200);
  const row=app.locals.db.prepare('SELECT stripe_session_id FROM payments WHERE event_id=?').get('trial-event');const session=sessions.get(row.stripe_session_id);session.payment_status='paid';
  assert.equal(await webhook(session),200);
  event=(await request('/api/events',{user:trialUser})).data.events.find(e=>e.id==='trial-event');assert.equal(event.status,'paid');assert.equal(event.photoCount,25);assert.equal(event.guest_token,trialToken);
  assert.equal((await request('/api/storage',{user:trialUser})).status,200);assert.equal((await request('/api/storage')).status,401);
});

test('Email verification uses expiring single-use tokens without plaintext storage',async()=>{
 const u=await register('verify@example.com');
 assert.equal((await request('/api/auth/request-verification',{method:'POST',user:u})).status,200);
 const token=sentMail.at(-1).text.match(/#([a-f0-9]{64})/)[1];
 assert.equal(app.locals.db.prepare('SELECT 1 FROM email_verifications WHERE token_hash=?').get(token),undefined);
 assert.equal((await request('/api/auth/verify-email',{method:'POST',body:{token}})).status,200);
 assert.equal((await request('/api/auth/me',{user:u})).data.emailVerified,true);
 assert.equal((await request('/api/auth/verify-email',{method:'POST',body:{token}})).status,400);
 assert.equal((await request('/api/auth/request-verification',{method:'POST',user:u})).status,200);
 const expired=sentMail.at(-1).text.match(/#([a-f0-9]{64})/)[1];app.locals.db.prepare('UPDATE email_verifications SET expires_at=0 WHERE user_id=?').run(u.id);
 assert.equal((await request('/api/auth/verify-email',{method:'POST',body:{token:expired}})).status,400);
});
