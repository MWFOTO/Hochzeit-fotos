const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createApp,eventDeadline,retentionUntil}=require('../server');

test('90 calendar days start at the Berlin event date, across DST and year boundaries',()=>{
  assert.equal(new Date(eventDeadline('2026-11-02')).toISOString(),'2027-01-30T23:00:00.000Z');
  assert.equal(new Date(eventDeadline('2027-01-01')).toISOString(),'2027-03-31T22:00:00.000Z');
  assert.equal(new Date(eventDeadline('2026-08-01')).toISOString(),'2026-10-29T23:00:00.000Z');
  assert.equal(retentionUntil({event_date:'2026-11-02',expires_at:Date.parse('2027-11-02')}),eventDeadline('2026-11-02'));
});

for(const remote of [false,true])test(`dated albums expire and delete at day 90 with ${remote?'S3':'local'} storage`,async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-retention-'));
  const removed=[];
  const photoStorage=remote?{mode:'s3',check:async()=>{},getStream:async()=>Readable.from(['photo']),deleteEvent:async id=>removed.push(id)}:undefined;
  const app=createApp({DB_PATH:path.join(root,'db.sqlite'),UPLOAD_DIR:path.join(root,'uploads'),BASE_URL:'http://localhost:3000',photoStorage});
  const db=app.locals.db;
  db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('owner','owner@example.test','unused',1);
  const realNow=Date.now;
  let clock=Date.parse('2026-11-02T12:00:00Z');
  Date.now=()=>clock;
  const token='a'.repeat(64),csrf='b'.repeat(64);
  const crypto=require('node:crypto');
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),'owner',csrf,Date.parse('2028-01-01'));
  const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const headers={Cookie:`event_session=${token}`,'X-CSRF-Token':csrf,Origin:'http://localhost:3000','Content-Type':'application/json'};
  const call=(url,method='GET',body)=>fetch(base+url,{method,headers,body:body?JSON.stringify(body):undefined});
  try {
    // Book today for an event 90 days away: the deadline is another 90 days after the event.
    const created=await call('/api/events','POST',{eventId:'future-event',title:'Birthday',eventDate:'2027-01-31'});
    assert.equal(created.status,201);
    assert.equal(db.prepare('SELECT expires_at FROM events WHERE id=?').get('future-event').expires_at,eventDeadline('2027-01-31'));
    const changed=await call('/api/event/future-event','PATCH',{eventDate:'2027-02-01'});
    assert.equal(changed.status,200);
    const deadline=eventDeadline('2027-02-01');
    assert.equal(db.prepare('SELECT expires_at FROM events WHERE id=?').get('future-event').expires_at,deadline);
    db.prepare('INSERT INTO payments (id,event_id,stripe_session_id,amount_cents,months) VALUES (?,?,?,?,?)').run('payment','future-event','cs_retention',3490,3);
    const notification={id:'evt_retention',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_retention',livemode:false,payment_status:'paid',currency:'eur',amount_total:3490,mode:'payment',metadata:{paymentId:'payment',eventId:'future-event'}}}};
    app.locals.fulfill(notification);app.locals.fulfill(notification);
    const paid=db.prepare('SELECT status,expires_at FROM events WHERE id=?').get('future-event');
    assert.equal(paid.status,'paid');assert.equal(paid.expires_at,deadline);
    // Existing albums with the old 12-month expiry are capped as well.
    db.prepare("UPDATE events SET status='paid', expires_at=? WHERE id=?").run(Date.parse('2028-02-01'),'future-event');
    const row=(await (await call('/api/events')).json()).events[0];
    assert.equal(row.expires_at,deadline);assert.equal(row.retentionUntil,deadline);
    const folder=path.join(root,'uploads','future-event');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'photo.jpg'),'photo');
    db.prepare('INSERT INTO photos (id,event_id,filename,bytes,approved,created_at) VALUES (?,?,?,?,?,?)').run('photo','future-event','photo.jpg',5,1,clock);
    clock=deadline-1;
    assert.equal((await call('/api/event/future-event/info')).status,200);
    await app.locals.cleanup();assert.equal(db.prepare('SELECT COUNT(*) n FROM photos').get().n,1);
    clock=deadline;
    assert.equal((await call('/api/event/future-event/info')).status,402);
    assert.equal((await call('/api/event/future-event/download')).status,402);
    await app.locals.cleanup();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM photos').get().n,0);
    assert.equal(db.prepare('SELECT status FROM events WHERE id=?').get('future-event').status,'expired');
    if(remote)assert.deepEqual(removed,['future-event']);else assert.equal(fs.existsSync(folder),false);
  } finally {Date.now=realNow;await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(root,{recursive:true,force:true});}
});
