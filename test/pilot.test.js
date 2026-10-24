const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {openDatabase}=require('../db');
const {createApp}=require('../server');
test('Operator pilot preserves guest access, lifts trial quota, expires and cannot resurrect a deleted album',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pilot-'));
 const cfg={DB_PATH:path.join(dir,'db.sqlite'),UPLOAD_DIR:path.join(dir,'photos'),BASE_URL:'http://localhost:3000',PILOT_EVENT_ID:'wedding-test',PILOT_ENDS_AT:'2030-11-30T00:00:00+01:00',PILOT_TITLE:'Test Wedding',MAX_EVENT_PHOTOS:1000,MAX_EVENT_BYTES:600*1024**2};
 let db=openDatabase(cfg.DB_PATH);
 db.prepare('INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)').run('owner','pilot@example.com','unused',Date.now());
 const add=db.prepare("INSERT INTO events (id,status,created_at,expires_at,owner_id,guest_token,title) VALUES (?,?,?,?,?,?,?)");
 add.run('wedding-test','trial',Date.now(),Date.now()+100000,'owner','guest-secret','old title');
 add.run('other-event','trial',Date.now(),Date.now()+100000,'owner','other-secret','other');db.close();
 const app=createApp(cfg),server=app.listen(0);db=app.locals.db;
 try {
  const origin=`http://127.0.0.1:${server.address().port}`;
  let r=await fetch(origin+'/api/event/wedding-test/info?token=guest-secret');assert.equal(r.status,200);const info=await r.json();assert.equal(info.title,'Test Wedding');assert.equal(info.pilot,true);assert.equal(info.trial,false);assert.equal(info.photoLimit,1000);assert.equal(info.expiresAt,Date.parse(cfg.PILOT_ENDS_AT));
  assert.equal((await fetch(origin+'/api/event/wedding-test/info?token=wrong')).status,403);
  assert.equal(db.prepare('SELECT status FROM events WHERE id=?').get('other-event').status,'trial');
  const eventDir=path.join(cfg.UPLOAD_DIR,'wedding-test');fs.mkdirSync(eventDir);fs.writeFileSync(path.join(eventDir,'image.jpg'),'test');
  db.prepare('UPDATE events SET expires_at=0 WHERE id=?').run('wedding-test');
  assert.equal((await fetch(origin+'/api/event/wedding-test/info?token=guest-secret')).status,402);
  app.locals.cleanup();assert.equal(fs.existsSync(eventDir),false);assert.equal(db.prepare('SELECT guest_token FROM events WHERE id=?').get('wedding-test').guest_token,null);
 } finally {server.close();db.close();}
 const restarted=createApp(cfg);assert.equal(restarted.locals.db.prepare('SELECT status FROM events WHERE id=?').get('wedding-test').status,'expired');restarted.locals.db.close();fs.rmSync(dir,{recursive:true,force:true});
});
