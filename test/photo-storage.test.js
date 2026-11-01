const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Readable}=require('node:stream');
const {createPhotoStorage}=require('../photo-storage');
const {createApp}=require('../server');
const sharp=require('sharp');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-storage-'));
test.after(()=>fs.rmSync(temp,{recursive:true,force:true}));

test('local photo storage keeps existing disk behavior and deletes only the requested event',async()=>{
  const root=path.join(temp,'local');
  const storage=createPhotoStorage({UPLOAD_DIR:root});
  fs.mkdirSync(path.join(root,'event-one'),{recursive:true});
  fs.mkdirSync(path.join(root,'event-two'),{recursive:true});
  fs.writeFileSync(path.join(root,'event-one','photo.jpg'),'one');
  fs.writeFileSync(path.join(root,'event-two','photo.jpg'),'two');
  assert.equal(storage.mode,'local');
  assert.equal(await storage.photoSize('event-one','photo.jpg'),3);
  await storage.deletePhoto('event-one','photo.jpg');
  await storage.deleteEvent('event-one');
  assert.equal(fs.existsSync(path.join(root,'event-one')),false);
  assert.equal(fs.existsSync(path.join(root,'event-two','photo.jpg')),true);
});

test('S3 configuration is restricted to a matching German Hetzner endpoint',()=>{
  const config={S3_BUCKET:'finalsnap-photos',S3_ENDPOINT:'https://fsn1.your-objectstorage.com',S3_REGION:'nbg1',S3_ACCESS_KEY_ID:'test',S3_SECRET_ACCESS_KEY:'test'};
  assert.throws(()=>createPhotoStorage(config,{sdk:{}}),/S3_ENDPOINT zu S3_REGION/);
  assert.throws(()=>createPhotoStorage({...config,S3_ENDPOINT:'https://s3.amazonaws.com',S3_REGION:'us-east-1'},{sdk:{}}),/deutschen Fotospeicher/);
  assert.throws(()=>createPhotoStorage({...config,S3_SECRET_ACCESS_KEY:''}),/unvollständig/);
});

test('S3 photo storage streams private objects and removes all event keys across pages',async()=>{
  const sent=[];
  const objects=new Map();
  const listedPages=new Map();
  const sdk={};
  for(const name of ['PutObjectCommand','GetObjectCommand','DeleteObjectCommand','ListObjectsV2Command','HeadObjectCommand']) {
    sdk[name]=class {constructor(input){this.input=input;this.name=name;}};
  }
  const client={send:async command=>{
    sent.push(command);
    const {Bucket,Key,Prefix,ContinuationToken}=command.input;
    assert.equal(Bucket,'finalsnap-photos');
    if(command.name==='PutObjectCommand'){const chunks=[];for await(const chunk of command.input.Body)chunks.push(chunk);objects.set(Key,Buffer.concat(chunks));return {};}
    if(command.name==='HeadObjectCommand'){
      const value=objects.get(Key);if(!value){const error=new Error('missing');error.name='NotFound';error.$metadata={httpStatusCode:404};throw error;}return {ContentLength:value.length};
    }
    if(command.name==='GetObjectCommand')return {Body:Readable.from(objects.get(Key))};
    if(command.name==='ListObjectsV2Command'){
      if(ContinuationToken)return {Contents:(listedPages.get(ContinuationToken)||[]).map(Key=>({Key})),IsTruncated:false};
      const keys=[...objects.keys()].filter(key=>key.startsWith(Prefix));
      if(keys.length>1){listedPages.set('next',keys.slice(1));return {Contents:keys.slice(0,1).map(Key=>({Key})),IsTruncated:true,NextContinuationToken:'next'};}
      return {Contents:keys.map(Key=>({Key})),IsTruncated:false};
    }
    if(command.name==='DeleteObjectCommand'){objects.delete(Key);return {};}
    throw new Error('Unexpected command');
  }};
  const storage=createPhotoStorage({S3_BUCKET:'finalsnap-photos',S3_ENDPOINT:'https://nbg1.your-objectstorage.com',S3_REGION:'nbg1',S3_ACCESS_KEY_ID:'test',S3_SECRET_ACCESS_KEY:'test'},{sdk,client});
  const local=path.join(temp,'source.jpg');fs.writeFileSync(local,'photo-data');
  await storage.put('event-one','one.jpg',local);
  await storage.put('event-one','two.jpg',local);
  await storage.put('event-two','other.jpg',local);
  assert.equal(storage.mode,'s3');
  assert.equal(await storage.photoSize('event-one','one.jpg'),10);
  assert.equal(await storage.photoSize('event-one','missing.jpg'),null);
  const stream=await storage.getStream('event-one','one.jpg');
  const chunks=[];for await(const chunk of stream)chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(),'photo-data');
  await storage.deleteEvent('event-one');
  assert.equal(objects.has('events/event-one/one.jpg'),false);
  assert.equal(objects.has('events/event-one/two.jpg'),false);
  assert.equal(objects.has('events/event-two/other.jpg'),true);
  assert.ok(sent.every(command=>!String(command.input.ACL||'').toLowerCase().includes('public')));
});

test('the app authorizes S3 photo reads and expiry deletes stored objects',async()=>{
  const dir=path.join(temp,'app');
  const objects=new Map();
  const storage={
    mode:'s3',
    put:async(eventId,filename,file)=>objects.set(`${eventId}/${filename}`,fs.readFileSync(file)),
    getStream:async(eventId,filename)=>Readable.from([objects.get(`${eventId}/${filename}`)]),
    deletePhoto:async(eventId,filename)=>objects.delete(`${eventId}/${filename}`),
    deleteEvent:async eventId=>{for(const key of objects.keys())if(key.startsWith(`${eventId}/`))objects.delete(key);},
  };
  const app=createApp({DB_PATH:path.join(dir,'events.db'),UPLOAD_DIR:path.join(dir,'staging'),BASE_URL:'http://localhost:3000',MAX_EVENT_PHOTOS:10,S3_MAX_STORAGE_BYTES:1024**3,photoStorage:storage});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const headers={Origin:'http://localhost:3000'};
  try {
    const register=await fetch(`${origin}/api/auth/register`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({email:'owner@example.test',password:'correct horse battery staple'})});
    assert.equal(register.status,200);
    const sessionCookie=register.headers.get('set-cookie').split(';')[0];
    const auth={...headers,Cookie:sessionCookie,'X-CSRF-Token':(await register.json()).csrf,'Content-Type':'application/json'};
    const created=await fetch(`${origin}/api/events`,{method:'POST',headers:auth,body:JSON.stringify({eventId:'s3event',plan:'1m',title:'S3 Event'})});
    assert.equal(created.status,201);
    const guestToken=app.locals.db.prepare('SELECT guest_token FROM events WHERE id=?').get('s3event').guest_token;
    const form=new FormData();form.append('photos',new Blob([await sharp({create:{width:16,height:16,channels:3,background:'#123456'}}).jpeg().toBuffer()],{type:'image/jpeg'}),'photo.jpg');
    const upload=await fetch(`${origin}/api/event/s3event/upload?token=${guestToken}`,{method:'POST',headers:{...headers,Origin:'http://localhost:3000'},body:form});
    assert.equal(upload.status,200);
    assert.equal(objects.size,1);
    const photos=await fetch(`${origin}/api/event/s3event/photos?token=${guestToken}`);
    const payload=await photos.json();
    assert.equal(payload.photos.length,1);
    const image=await fetch(`${origin}${payload.photos[0].url}`);
    assert.equal(image.status,200);
    assert.equal(image.headers.get('cache-control'),'private, no-store');
    assert.ok((await image.arrayBuffer()).byteLength>0);
    app.locals.db.prepare('UPDATE events SET expires_at=? WHERE id=?').run(Date.now()-1,'s3event');
    await app.locals.cleanup();
    assert.equal(objects.size,0);
    assert.equal(app.locals.db.prepare('SELECT status FROM events WHERE id=?').get('s3event').status,'expired');
  } finally {
    await new Promise(resolve=>server.close(resolve));
    app.locals.db.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
