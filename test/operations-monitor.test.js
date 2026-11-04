const test=require('node:test');
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const {createOperationsMonitor,GiB}=require('../operations-monitor');

test('storage monitor sends threshold alerts once and recovery notices after hysteresis',async()=>{
  const db=new Database(':memory:');
  db.exec('CREATE TABLE photos (bytes INTEGER NOT NULL);');
  db.prepare('INSERT INTO photos(bytes) VALUES (?)').run(760);
  let free=GiB/2;
  const sent=[];
  const monitor=createOperationsMonitor({config:{UPLOAD_DIR:'/tmp',S3_MAX_STORAGE_BYTES:'1000',PAYMENT_ALERT_EMAIL:'owner@example.test'},db,mailer:async mail=>sent.push(mail),dependencies:{statfs:()=>({bavail:free,bsize:1,blocks:10*GiB}),now:()=>1000}});

  assert.equal((await monitor.check()).status,'checked');
  assert.deepEqual(sent.map(item=>item.subject),['FinalSnap: Render-Datenträger wird knapp','FinalSnap: Hetzner-Fotospeicher bei 75 %']);
  await monitor.check();assert.equal(sent.length,2);

  db.prepare('UPDATE photos SET bytes=950').run();
  await monitor.check();assert.equal(sent.at(-1).subject,'FinalSnap: Hetzner-Fotospeicher bei 90 %');
  assert.equal(sent.length,3);

  free=2*GiB;db.prepare('UPDATE photos SET bytes=600').run();
  await monitor.check();
  assert.deepEqual(sent.slice(-3).map(item=>item.subject),[
    'FinalSnap: wieder normal – Render-Datenträger wird knapp',
    'FinalSnap: wieder normal – Hetzner-Fotospeicher bei 75 %',
    'FinalSnap: wieder normal – Hetzner-Fotospeicher bei 90 %'
  ]);
  const cleared=db.prepare('SELECT COUNT(*) AS count FROM operational_alerts WHERE active=0').get();
  assert.equal(cleared.count,3);
  db.close();
});

test('storage monitor retries an undelivered alert without revealing secrets',async()=>{
  const db=new Database(':memory:');db.exec('CREATE TABLE photos (bytes INTEGER NOT NULL);');
  let failed=true,calls=0;
  const monitor=createOperationsMonitor({config:{UPLOAD_DIR:'/tmp',S3_MAX_STORAGE_BYTES:'1000',PAYMENT_ALERT_EMAIL:'owner@example.test'},db,mailer:async()=>{calls++;if(failed)throw new Error('smtp offline');},dependencies:{statfs:()=>({bavail:1,bsize:1,blocks:10*GiB}),now:()=>1000}});
  await monitor.check();assert.equal(calls,1);
  failed=false;await monitor.check();assert.equal(calls,2);
  await monitor.check();assert.equal(calls,2);
  db.close();
});
