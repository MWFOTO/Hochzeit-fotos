const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const Database=require('better-sqlite3');
const {createBackupService,DB_PREFIX,PHOTO_PREFIX}=require('../backup-service');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-backup-test-'));
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));

function fakeStores(){
  const sourceObjects=new Map([['events/event-one/photo.jpg',Buffer.from('photo-data')]]);
  const backupObjects=new Map();
  const removed=[];
  const versions=[{Key:'database/2020-01-01T00:00:00.000Z.sqlite',VersionId:'expired-db-version'}];
  const deleteControl={fail:false};
  const source={
    checkBucket:async()=>{},
    list:async(_bucket,prefix)=>[...sourceObjects].filter(([Key])=>Key.startsWith(prefix)).map(([Key,Body])=>({Key,Size:Body.length,ETag:'"source-etag"'})),
    get:async(_bucket,key)=>({Body:Readable.from([sourceObjects.get(key)]),ContentType:'image/jpeg'})
  };
  const destination={
    checkBucket:async()=>{},versioningEnabled:async()=>true,photoRetentionSafe:async()=>true,
    list:async(_bucket,prefix)=>[...backupObjects].filter(([Key])=>Key.startsWith(prefix)).map(([Key,value])=>({Key,Size:value.Body.length})),
    listVersions:async()=>versions,
    head:async(_bucket,key)=>{const item=backupObjects.get(key);if(!item){const error=new Error('missing');error.$metadata={httpStatusCode:404};throw error;}return {ContentLength:item.Body.length,Metadata:item.Metadata};},
    get:async(_bucket,key)=>({Body:Readable.from([backupObjects.get(key).Body])}),
    put:async(_bucket,key,body,options={})=>{const chunks=[];for await(const chunk of body)chunks.push(Buffer.from(chunk));backupObjects.set(key,{Body:Buffer.concat(chunks),Metadata:options.metadata||{}});},
    delete:async(_bucket,key)=>{if(deleteControl.fail)throw new Error('temporary failure');removed.push(key);backupObjects.delete(key);}
  };
  return {sourceObjects,backupObjects,removed,deleteControl,source,destination};
}

function config(){
  const key=Buffer.alloc(32,7).toString('base64');
  return {BACKUP_ENABLED:'1',DB_PATH:path.join(temp,`source-${Math.random()}.sqlite`),S3_BUCKET:'primary',S3_ENDPOINT:'https://nbg1.your-objectstorage.com',S3_REGION:'nbg1',S3_ACCESS_KEY_ID:'source',S3_SECRET_ACCESS_KEY:'secret',S3_SSE_C_KEY:key,BACKUP_S3_BUCKET:'backup',BACKUP_S3_ENDPOINT:'https://fsn1.your-objectstorage.com',BACKUP_S3_REGION:'fsn1',BACKUP_S3_ACCESS_KEY_ID:'backup',BACKUP_S3_SECRET_ACCESS_KEY:'secret',BACKUP_S3_SSE_C_KEY:key,PAYMENT_ALERT_EMAIL:'owner@example.test'};
}

test('disabled backup service does not touch storage',async()=>{
  const service=createBackupService({config:{BACKUP_ENABLED:'0'},db:{}});
  assert.deepEqual(service.status(),{enabled:false,configured:false,missing:[
    'DB_PATH','S3_BUCKET','S3_ENDPOINT','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_SSE_C_KEY','BACKUP_S3_BUCKET','BACKUP_S3_ENDPOINT','BACKUP_S3_REGION','BACKUP_S3_ACCESS_KEY_ID','BACKUP_S3_SECRET_ACCESS_KEY','BACKUP_S3_SSE_C_KEY'
  ]});
  assert.deepEqual(await service.run(),{status:'disabled'});
});

test('daily backup snapshots SQLite consistently and mirrors then expires deleted photos',async()=>{
  const cfg=config(),db=new Database(cfg.DB_PATH);
  db.exec('CREATE TABLE backup_runs (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, completed_at INTEGER, status TEXT NOT NULL, db_object_key TEXT, photo_objects INTEGER, photo_bytes INTEGER, error TEXT); CREATE TABLE backup_photo_deletes (event_id TEXT NOT NULL, filename TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, PRIMARY KEY(event_id,filename)); CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES (\'preserved\')');
  const stores=fakeStores();
  const service=createBackupService({config:cfg,db,dependencies:{sourceStorage:stores.source,destinationStorage:stores.destination}});

  const first=await service.run();
  assert.equal(first.status,'succeeded');
  assert.equal(first.photoCount,1);
  assert.ok(stores.removed.includes('database/2020-01-01T00:00:00.000Z.sqlite'));
  assert.equal(stores.backupObjects.get(`${PHOTO_PREFIX}events/event-one/photo.jpg`).Body.toString(),'photo-data');
  assert.ok([...stores.backupObjects.keys()].some(key=>key.startsWith(DB_PREFIX)&&key.endsWith('.sqlite')));
  const integrity=db.prepare('SELECT status,photo_objects FROM backup_runs ORDER BY started_at DESC LIMIT 1').get();
  assert.deepEqual(integrity,{status:'succeeded',photo_objects:1});

  stores.deleteControl.fail=true;
  assert.equal(await service.deletePhoto('event-one','photo.jpg'),false);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM backup_photo_deletes').get().count,1);
  stores.deleteControl.fail=false;
  assert.deepEqual(await service.flushDeletes(),{status:'succeeded',processed:1});
  assert.equal(db.prepare('SELECT COUNT(*) count FROM backup_photo_deletes').get().count,0);

  const dbKey=[...stores.backupObjects.keys()].find(key=>key.startsWith(DB_PREFIX));
  stores.backupObjects.set(dbKey,{Body:Buffer.from('corrupted backup'),Metadata:{}});
  stores.sourceObjects.clear();
  const second=await service.run();
  assert.equal(second.status,'succeeded');
  assert.equal(stores.backupObjects.get(dbKey).Body.subarray(0,16).equals(Buffer.from('SQLite format 3\u0000')),true);
  assert.ok(stores.removed.includes(`${PHOTO_PREFIX}events/event-one/photo.jpg`));
  assert.equal(stores.backupObjects.has(`${PHOTO_PREFIX}events/event-one/photo.jpg`),false);
  db.close();
});
