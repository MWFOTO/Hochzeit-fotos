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

  free=3*GiB;db.prepare('UPDATE photos SET bytes=600').run();
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

test('upload failure monitor warns on event-specific failures without guest or photo data',async()=>{
  const db=new Database(':memory:');db.exec('CREATE TABLE photos (bytes INTEGER NOT NULL);');
  let time=1000;const sent=[];
  const monitor=createOperationsMonitor({config:{UPLOAD_DIR:'/tmp',S3_MAX_STORAGE_BYTES:String(10*GiB),PAYMENT_ALERT_EMAIL:'owner@example.test'},db,mailer:async mail=>sent.push(mail),dependencies:{statfs:()=>({bavail:5*GiB,bsize:1,blocks:10*GiB}),now:()=>time}});
  monitor.recordUploadAttempt('event-safe','failure','format');
  monitor.recordUploadAttempt('event-safe','success');
  monitor.recordUploadAttempt('event-safe','success');
  await monitor.check();assert.equal(sent.length,1);
  assert.match(sent[0].text,/Album event-safe/);assert.match(sent[0].text,/Dateiformat: 1/);
  assert.doesNotMatch(sent[0].text,/guest@example|IMG_123|photo\.jpg|Lisa/);
  await monitor.check();assert.equal(sent.length,1);
  time+=60*60*1000+1;monitor.recordUploadAttempt('event-safe','failure','queue');await monitor.check();assert.equal(sent.length,2);
  assert.match(sent[1].text,/Warteschlange: 1/);
  db.close();
});

test('upload failure monitor alerts at five failures and sends only one mail per event per hour',async()=>{
  const db=new Database(':memory:');db.exec('CREATE TABLE photos (bytes INTEGER NOT NULL);');
  let time=5000;const sent=[];
  const monitor=createOperationsMonitor({config:{UPLOAD_DIR:'/tmp',S3_MAX_STORAGE_BYTES:String(10*GiB),PAYMENT_ALERT_EMAIL:'owner@example.test'},db,mailer:async mail=>sent.push(mail),dependencies:{statfs:()=>({bavail:5*GiB,bsize:1,blocks:10*GiB}),now:()=>time}});
  for(let index=0;index<5;index++)monitor.recordUploadAttempt('event-threshold','failure','timeout');

  await monitor.check();
  assert.equal(sent.length,1);
  assert.match(sent[0].text,/5 fehlgeschlagene/);
  assert.match(sent[0].text,/Zeitüberschreitung: 5/);
  assert.doesNotMatch(sent[0].text,/guest@example|IMG_123|photo\.jpg|Lisa/);

  monitor.recordUploadAttempt('event-threshold','failure','storage');
  await monitor.check();
  assert.equal(sent.length,1);

  time+=60*60*1000+1;
  for(let index=0;index<5;index++)monitor.recordUploadAttempt('event-threshold','failure','storage');
  await monitor.check();
  assert.equal(sent.length,2);
  assert.match(sent[1].text,/Speicher: 5/);
  db.close();
});
