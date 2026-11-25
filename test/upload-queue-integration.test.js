const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const sharp=require('sharp');
const {createApp}=require('../server');

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-upload-queue-'));
const app=createApp({DB_PATH:path.join(tmp,'events.db'),UPLOAD_DIR:path.join(tmp,'uploads'),BASE_URL:'http://localhost:3000',uploadCapacityStatfs:()=>({bavail:10*1024**3,bsize:1}),eventUploadQueueOptions:{maxWaitMs:2000}});
const server=app.listen(0,'127.0.0.1');
const origin=()=>`http://127.0.0.1:${server.address().port}`;
const token='guest-album-token-test';
const future=Date.now()+86400000;
function addEvent(id,status='paid') {
  app.locals.db.prepare('INSERT OR IGNORE INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('test-owner','owner@example.test','unused',Date.now());
  app.locals.db.prepare(`INSERT INTO events (id,email,plan,amount_cents,status,created_at,expires_at,title,event_date,guest_token,moderation,guestbook_moderation,video_greetings_enabled,trial_used,upload_successes,upload_failures,design_json,owner_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,'owner@example.test','event',4990,status,Date.now(),future,'Upload Test','2027-01-01',token,1,1,0,0,0,0,'{}','test-owner');
}
async function send(id,{requestId,buffer=image}={}) {
  buffer=await buffer;const form=new FormData();form.append('photos',new Blob([buffer],{type:'image/jpeg'}),'photo.jpg');
  const headers={Origin:'http://localhost:3000'};
  if(requestId)headers['X-Upload-Id']=requestId;
  const response=await fetch(`${origin()}/api/event/${id}/upload?token=${token}`,{method:'POST',headers,body:form});
  return {status:response.status,body:await response.json()};
}
const image=sharp({create:{width:32,height:24,channels:3,background:'#4287f5'}}).jpeg().toBuffer();
const waitUntil=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Timed out waiting for upload queue.');};

test('concurrent same-event uploads both finish and retry keys do not create duplicates',async()=>{
  addEvent('parallel');
  const [a,b]=await Promise.all([send('parallel'),send('parallel')]);
  assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(b.status,200,JSON.stringify(b.body));
  const first=await send('parallel',{requestId:'repeatable-upload-id-001'});
  const retry=await send('parallel',{requestId:'repeatable-upload-id-001'});
  assert.equal(first.status,200);assert.equal(retry.status,200);
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) count FROM photos WHERE event_id=?').get('parallel').count,3);
});

test('concurrent trial uploads never exceed the 25-photo cap',async()=>{
  addEvent('trial-quota','trial');
  const uploads=await Promise.all(Array.from({length:27},(_,index)=>send('trial-quota',{requestId:`quota-upload-${String(index).padStart(3,'0')}`})));
  const count=app.locals.db.prepare('SELECT COUNT(*) count FROM photos WHERE event_id=?').get('trial-quota').count;
  assert.equal(count,25);
  assert.equal(uploads.filter(result=>result.status===200).length,25);
  assert.equal(uploads.filter(result=>result.status===400&&result.body.error.startsWith('Die 25 kostenlosen')).length,2);
});

test('deleting an album is blocked while an upload is queued',async()=>{
  addEvent('delete-while-waiting');
  const sessionToken='a'.repeat(64);
  const tokenHash=crypto.createHash('sha256').update(sessionToken).digest('hex');
  app.locals.db.prepare('INSERT INTO sessions (token_hash,user_id,csrf,expires_at) VALUES (?,?,?,?)').run(tokenHash,'test-owner','csrf-test',Date.now()+60000);
  const blocker=app.locals.uploadQueues.reserve('delete-while-waiting');
  let unblock;
  const waiting=blocker.run(()=>new Promise(resolve=>{unblock=resolve;}));
  await waitUntil(()=>typeof unblock==='function');
  const response=await fetch(`${origin()}/api/event/delete-while-waiting`,{method:'DELETE',headers:{Origin:'http://localhost:3000',Cookie:`event_session=${sessionToken}`,'X-CSRF-Token':'csrf-test'}});
  assert.equal(response.status,409);
  assert.equal(app.locals.db.prepare('SELECT deleted_at FROM events WHERE id=?').get('delete-while-waiting').deleted_at,null);
  unblock();await waiting;blocker.release();
});

test('full event queue responds with a retry delay instead of losing the upload',async()=>{
  addEvent('full-queue');
  const reservations=Array.from({length:30},()=>app.locals.uploadQueues.reserve('full-queue'));
  assert.ok(reservations.every(item=>item.ok));
  const form=new FormData();form.append('photos',new Blob([await image],{type:'image/jpeg'}),'photo.jpg');
  const response=await fetch(`${origin()}/api/event/full-queue/upload?token=${token}`,{method:'POST',headers:{Origin:'http://localhost:3000'},body:form});
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'3');
  for(const reservation of reservations)reservation.release();
});

test('expiry during a queued upload rejects it and clears the staged file',async()=>{
  addEvent('expires-in-queue');
  const queues=app.locals.uploadQueues;
  const blocker=queues.reserve('expires-in-queue');
  let unblock;
  const blocked=blocker.run(()=>new Promise(resolve=>{unblock=resolve;}));
  await waitUntil(()=>typeof unblock==='function');
  const pending=send('expires-in-queue',{requestId:'expiry-upload-id-0001'});
  await waitUntil(()=>queues.pending('expires-in-queue')===2);
  app.locals.db.prepare('UPDATE events SET expires_at=? WHERE id=?').run(Date.now()-1,'expires-in-queue');
  await app.locals.cleanup();
  assert.equal(app.locals.db.prepare('SELECT status,deleted_at FROM events WHERE id=?').get('expires-in-queue').status,'paid');
  unblock();
  await blocked;
  const result=await pending;
  assert.equal(result.status,402);
  assert.equal(app.locals.db.prepare('SELECT COUNT(*) count FROM photos WHERE event_id=?').get('expires-in-queue').count,0);
  assert.equal(fs.readdirSync(path.join(tmp,'uploads','.tmp')).length,0);
  blocker.release();
  await app.locals.cleanup();
  assert.equal(app.locals.db.prepare('SELECT status FROM events WHERE id=?').get('expires-in-queue').status,'expired');
});

test.after(async()=>{
  await new Promise(resolve=>server.close(resolve));
  clearInterval(app.locals.paymentAlertTimer);
  clearInterval(app.locals.cleanupTimer);
  app.locals.backupService.stop();app.locals.operationsMonitor.stop();
  app.locals.db.close();fs.rmSync(tmp,{recursive:true,force:true});
});
