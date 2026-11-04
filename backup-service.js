const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const Database = require('better-sqlite3');

const DAY_MS = 86400000;
const DB_RETENTION_DAYS = 30;
const PHOTO_PREFIX = 'photos/events/';
const DB_PREFIX = 'database/';
const token = value => crypto.createHash('md5').update(value).digest('base64');

function keyFor(value) {
  const key = Buffer.from(String(value||''), 'base64');
  if(key.length!==32 || key.toString('base64')!==value) throw new Error('Der Backup-SSE-C-Schlüssel muss Base64-kodiert genau 32 Bytes enthalten.');
  return {SSECustomerAlgorithm:'AES256',SSECustomerKey:key,SSECustomerKeyMD5:token(key)};
}

function makeS3Store({endpoint,region,keyId,secret,key}, dependencies={}) {
  const sdk=dependencies.sdk||require('@aws-sdk/client-s3');
  const {S3Client,HeadBucketCommand,GetBucketVersioningCommand,GetBucketLifecycleConfigurationCommand,ListObjectsV2Command,ListObjectVersionsCommand,HeadObjectCommand,GetObjectCommand,PutObjectCommand,DeleteObjectCommand}=sdk;
  const client=dependencies.client||new S3Client({endpoint,region,requestChecksumCalculation:'WHEN_REQUIRED',forcePathStyle:false,credentials:{accessKeyId:keyId,secretAccessKey:secret}});
  const encryption=key;
  async function* list(bucket,prefix) {
    let ContinuationToken;
    do {
      const result=await client.send(new ListObjectsV2Command({Bucket:bucket,Prefix:prefix,ContinuationToken}));
      for(const item of result.Contents||[])yield item;
      ContinuationToken=result.IsTruncated?result.NextContinuationToken:undefined;
    } while(ContinuationToken);
  }
  async function* listVersions(bucket,prefix) {
    let KeyMarker,VersionIdMarker;
    do {
      const result=await client.send(new ListObjectVersionsCommand({Bucket:bucket,Prefix:prefix,KeyMarker,VersionIdMarker}));
      for(const item of [...(result.Versions||[]),...(result.DeleteMarkers||[])])yield item;
      KeyMarker=result.IsTruncated?result.NextKeyMarker:undefined;VersionIdMarker=result.IsTruncated?result.NextVersionIdMarker:undefined;
    } while(KeyMarker||VersionIdMarker);
  }
  return {
    client,bucket:null,
    async checkBucket(bucket){await client.send(new HeadBucketCommand({Bucket:bucket}));},
    async versioningEnabled(bucket){const result=await client.send(new GetBucketVersioningCommand({Bucket:bucket}));return result.Status==='Enabled';},
    async photoRetentionSafe(bucket){
      const result=await client.send(new GetBucketLifecycleConfigurationCommand({Bucket:bucket}));
      const rules=(result.Rules||[]).filter(rule=>rule.Status==='Enabled');
      const broadExpiry=rules.some(rule=>{
        const prefix=rule.Filter?.Prefix??rule.Prefix??'';
        return 'photos/events/'.startsWith(prefix)&&!!rule.Expiration;
      });
      return !broadExpiry&&rules.some(rule=>{
        const prefix=rule.Filter?.Prefix??rule.Prefix??'';
        const filter=rule.Filter;
        const simplePrefix=!filter||Object.keys(filter).every(key=>key==='Prefix');
        return prefix==='photos/'&&simplePrefix&&Number(rule.NoncurrentVersionExpiration?.NoncurrentDays)>0&&Number(rule.NoncurrentVersionExpiration.NoncurrentDays)<=7&&!rule.Expiration;
      });
    },
    list,
    listVersions,
    async head(bucket,keyName){return client.send(new HeadObjectCommand({Bucket:bucket,Key:keyName,...encryption}));},
    async get(bucket,keyName){return client.send(new GetObjectCommand({Bucket:bucket,Key:keyName,...encryption}));},
    async put(bucket,keyName,body,{size,contentType,metadata={}}={}){return client.send(new PutObjectCommand({Bucket:bucket,Key:keyName,Body:body,ContentLength:size,ContentType:contentType||'application/octet-stream',Metadata:metadata,CacheControl:'private, no-store',...encryption}));},
    async delete(bucket,keyName,versionId){return client.send(new DeleteObjectCommand({Bucket:bucket,Key:keyName,...(versionId?{VersionId:versionId}:{})}));}
  };
}

function createBackupService({config,db,mailer,dependencies={}}) {
  const enabled=String(config.BACKUP_ENABLED||'0')==='1';
  const required=['DB_PATH','S3_BUCKET','S3_ENDPOINT','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_SSE_C_KEY','BACKUP_S3_BUCKET','BACKUP_S3_ENDPOINT','BACKUP_S3_REGION','BACKUP_S3_ACCESS_KEY_ID','BACKUP_S3_SECRET_ACCESS_KEY','BACKUP_S3_SSE_C_KEY'];
  const missing=required.filter(name=>!String(config[name]||'').trim());
  let source=null,destination=null,busy=false,deleteBusy=false,timer=null,deleteTimer=null,lastFailureNotification=0;
  if(enabled&&!missing.length){
    const sourceRegion=/^https:\/\/(fsn1|nbg1)\.your-objectstorage\.com$/.exec(config.S3_ENDPOINT)?.[1];
    const destinationRegion=/^https:\/\/(fsn1|nbg1)\.your-objectstorage\.com$/.exec(config.BACKUP_S3_ENDPOINT)?.[1];
    if(!sourceRegion||sourceRegion!==config.S3_REGION||!destinationRegion||destinationRegion!==config.BACKUP_S3_REGION)throw new Error('Backup-Speicher muss einen passenden deutschen Hetzner-S3-Endpunkt verwenden.');
    if(sourceRegion===destinationRegion)throw new Error('Der Sicherungs-Bucket muss in der jeweils anderen deutschen Hetzner-Region liegen.');
    if(config.S3_BUCKET===config.BACKUP_S3_BUCKET)throw new Error('Foto- und Backup-Bucket müssen getrennt sein.');
    source=dependencies.sourceStorage||makeS3Store({endpoint:config.S3_ENDPOINT,region:sourceRegion,keyId:config.S3_ACCESS_KEY_ID,secret:config.S3_SECRET_ACCESS_KEY,key:keyFor(config.S3_SSE_C_KEY)},dependencies.source||{});
    destination=dependencies.destinationStorage||makeS3Store({endpoint:config.BACKUP_S3_ENDPOINT,region:destinationRegion,keyId:config.BACKUP_S3_ACCESS_KEY_ID,secret:config.BACKUP_S3_SECRET_ACCESS_KEY,key:keyFor(config.BACKUP_S3_SSE_C_KEY)},dependencies.destination||{});
  }
  const status=()=>({enabled,configured:enabled&&!missing.length,missing});
  async function* itemsFrom(items){const resolved=await items;if(resolved?.[Symbol.asyncIterator]){yield*resolved;return;}for(const item of resolved||[])yield item;}
  async function notifyFailure(message){
    console.error('Sicherung fehlgeschlagen:',message);
    const recipient=String(config.PAYMENT_ALERT_EMAIL||config.BREVO_SENDER_EMAIL||'').trim();
    if(!mailer||!recipient||Date.now()-lastFailureNotification<6*3600000)return;
    try{await mailer({to:recipient,subject:'FinalSnap: Sicherung fehlgeschlagen',text:`Der tägliche Sicherungslauf ist fehlgeschlagen.\n\nFehler: ${message}\n\nBitte Datenbank- und Fotosicherung prüfen.`});}
    catch(error){console.error('Sicherungsalarm konnte nicht zugestellt werden:',String(error.message||error));}
    finally{lastFailureNotification=Date.now();}
  }
  async function downloadToFile(body,filename){
    if(!body)throw new Error('Sicherungsobjekt enthält keinen Datenstrom.');
    await pipeline(body,fs.createWriteStream(filename,{flags:'wx'}));
  }
  async function verifyDatabaseObject(key,filename){
    fs.rmSync(filename,{force:true});
    const downloaded=await destination.get(config.BACKUP_S3_BUCKET,key);
    await downloadToFile(downloaded.Body,filename);
    let restoreDb;
    try{
      restoreDb=new Database(filename,{readonly:true,fileMustExist:true});
      return restoreDb.pragma('integrity_check',{simple:true})==='ok';
    }catch{return false;}
    finally{restoreDb?.close();}
  }
  async function pruneDatabaseVersions(){
    const cutoff=Date.now()-DB_RETENTION_DAYS*DAY_MS;
    for await(const item of itemsFrom(destination.listVersions(config.BACKUP_S3_BUCKET,DB_PREFIX))){
      const match=/^database\/(.+)\.sqlite$/.exec(item.Key||'');
      if(match&&Date.parse(match[1])<cutoff&&item.VersionId)await destination.delete(config.BACKUP_S3_BUCKET,item.Key,item.VersionId);
    }
  }
  async function run(){
    if(!enabled)return {status:'disabled'};
    if(missing.length){const message=`Backup-Konfiguration unvollständig: ${missing.join(', ')}`;await notifyFailure(message);return {status:'failed',error:message};}
    if(busy)return {status:'skipped',reason:'already-running'};
    busy=true;const started=Date.now(),runId=crypto.randomUUID();let dbKey=null,photoCount=0,photoBytes=0,tmp=null;
    db.prepare('INSERT INTO backup_runs (id,started_at,status) VALUES (?, ?, \'running\')').run(runId,started);
    try{
      tmp=fs.mkdtempSync(path.join(os.tmpdir(),'finalsnap-backup-'));
      await Promise.all([source.checkBucket(config.S3_BUCKET),destination.checkBucket(config.BACKUP_S3_BUCKET)]);
      if(!await destination.versioningEnabled(config.BACKUP_S3_BUCKET))throw new Error('Backup-Bucket benötigt aktiviertes Versioning, damit Fotolöschungen erst nach der Nachlaufzeit endgültig werden.');
      if(!await destination.photoRetentionSafe(config.BACKUP_S3_BUCKET))throw new Error('Backup-Bucket benötigt eine Lifecycle-Regel für Prefix photos/: nicht aktuelle Versionen nach höchstens 7 Tagen löschen, aktive Versionen nicht automatisch ablaufen lassen.');
      const localDb=path.join(tmp,'events.sqlite');
      const dayPrefix=`${DB_PREFIX}${new Date(started).toISOString().slice(0,10)}T`;
      dbKey=`${DB_PREFIX}${new Date(started).toISOString().slice(0,10)}T00:00:00.000Z.sqlite`;
      const verifyPath=path.join(tmp,'restore-check.sqlite');
      let restoreValid=await verifyDatabaseObject(dbKey,verifyPath).catch(()=>false);
      if(!restoreValid){
        await db.backup(localDb);
        const dbSize=fs.statSync(localDb).size;
        await destination.put(config.BACKUP_S3_BUCKET,dbKey,fs.createReadStream(localDb),{size:dbSize,contentType:'application/vnd.sqlite3'});
      }
      const verified=await destination.head(config.BACKUP_S3_BUCKET,dbKey);
      const dbSize=Number(verified.ContentLength);
      if(!Number.isSafeInteger(dbSize)||dbSize<=0)throw new Error('Größe der SQLite-Sicherung stimmt nicht.');
      if(!restoreValid)restoreValid=await verifyDatabaseObject(dbKey,verifyPath);
      if(!restoreValid)throw new Error('SQLite-Wiederherstellungsprüfung fehlgeschlagen.');

      for await(const item of itemsFrom(source.list(config.S3_BUCKET,'events/'))){
        if(!item.Key||item.Key.endsWith('/'))continue;
        const backupKey=`${PHOTO_PREFIX}${item.Key}`;
        const sourceEtag=String(item.ETag||'').replaceAll('"','');
        let current=null;try{current=await destination.head(config.BACKUP_S3_BUCKET,backupKey);}catch(error){if(error?.$metadata?.httpStatusCode!==404&&error?.name!=='NotFound'&&error?.name!=='NoSuchKey')throw error;}
        if(current?.Metadata?.['source-etag']===sourceEtag){photoCount++;photoBytes+=Number(item.Size||0);continue;}
        const object=await source.get(config.S3_BUCKET,item.Key);
        await destination.put(config.BACKUP_S3_BUCKET,backupKey,object.Body,{size:Number(item.Size||0),contentType:object.ContentType||'image/jpeg',metadata:{'source-etag':sourceEtag}});
        const copied=await destination.head(config.BACKUP_S3_BUCKET,backupKey);
        if(Number(copied.ContentLength)!==Number(item.Size||0)||copied.Metadata?.['source-etag']!==sourceEtag)throw new Error(`Foto-Backupprüfung fehlgeschlagen (${item.Key}).`);
        photoCount++;photoBytes+=Number(item.Size||0);
      }
      const sourceObjects=itemsFrom(source.list(config.S3_BUCKET,'events/'))[Symbol.asyncIterator]();
      const backupObjects=itemsFrom(destination.list(config.BACKUP_S3_BUCKET,PHOTO_PREFIX))[Symbol.asyncIterator]();
      let sourceItem=await sourceObjects.next(),backupItem=await backupObjects.next();
      while(!backupItem.done){
        const sourceKey=sourceItem.done?null:`${PHOTO_PREFIX}${sourceItem.value.Key}`;
        if(sourceKey===backupItem.value.Key){sourceItem=await sourceObjects.next();backupItem=await backupObjects.next();}
        else if(sourceKey!==null&&sourceKey<backupItem.value.Key)sourceItem=await sourceObjects.next();
        else{await destination.delete(config.BACKUP_S3_BUCKET,backupItem.value.Key);backupItem=await backupObjects.next();}
      }
      await flushDeletes();
      const completed=Date.now();
      db.prepare("UPDATE backup_runs SET completed_at=?,status='succeeded',db_object_key=?,photo_objects=?,photo_bytes=? WHERE id=?").run(completed,dbKey,photoCount,photoBytes,runId);
      console.info(`Sicherung erfolgreich: DB ${dbKey}, ${photoCount} Fotos (${photoBytes} Bytes).`);
      return {status:'succeeded',dbKey,photoCount,photoBytes,startedAt:started,completedAt:completed};
    }catch(error){
      const message=String(error.message||error).slice(0,500);
      db.prepare("UPDATE backup_runs SET completed_at=?,status='failed',db_object_key=?,error=? WHERE id=?").run(Date.now(),dbKey,message,runId);
      await notifyFailure(message);return {status:'failed',error:message};
    }finally{if(tmp)fs.rmSync(tmp,{recursive:true,force:true});busy=false;}
  }
  function start(){
    if(!enabled||timer)return;
    if(missing.length){const message=`Sicherungsdienst nicht konfiguriert: ${missing.join(', ')}`;console.error(message);notifyFailure(message).catch(()=>{});return;}
    const tick=async()=>{
      const dayPrefix=`${DB_PREFIX}${new Date().toISOString().slice(0,10)}T`;
      const last=db.prepare("SELECT db_object_key FROM backup_runs WHERE status='succeeded' ORDER BY completed_at DESC LIMIT 1").get();
      if(!last?.db_object_key?.startsWith(dayPrefix))await run();
      await flushDeletes();
    };
    timer=setInterval(()=>tick().catch(error=>notifyFailure(String(error.message||error))),3600000);timer.unref();
    deleteTimer=setInterval(()=>flushDeletes().catch(error=>notifyFailure(String(error.message||error))),900000);deleteTimer.unref();
    setTimeout(()=>tick().catch(error=>notifyFailure(String(error.message||error))),30000).unref();
  }
  function stop(){if(timer){clearInterval(timer);timer=null;}if(deleteTimer){clearInterval(deleteTimer);deleteTimer=null;}}
  function queuePhotoDelete(eventId,filename,message){
    db.prepare('INSERT INTO backup_photo_deletes (event_id,filename,created_at,attempts,last_error) VALUES (?, ?, ?, 1, ?) ON CONFLICT(event_id,filename) DO UPDATE SET attempts=attempts+1,last_error=excluded.last_error').run(eventId,filename,Date.now(),message.slice(0,300));
  }
  async function flushDeletes(){
    if(!enabled||missing.length||!destination||deleteBusy)return {status:'skipped'};
    deleteBusy=true;let processed=0;
    try{
      if(!await destination.versioningEnabled(config.BACKUP_S3_BUCKET)||!await destination.photoRetentionSafe(config.BACKUP_S3_BUCKET))throw new Error('Backup-Bucket hat keine sichere Versionierungs- und 7-Tage-Lifecycle-Konfiguration.');
      const queued=db.prepare('SELECT event_id,filename FROM backup_photo_deletes ORDER BY created_at LIMIT 500').all();
      for(const item of queued){
        try{
          if(item.filename==='*'){
            const prefix=`${PHOTO_PREFIX}events/${item.event_id}/`;
            for(const object of await destination.list(config.BACKUP_S3_BUCKET,prefix))if(object.Key)await destination.delete(config.BACKUP_S3_BUCKET,object.Key);
          }else await destination.delete(config.BACKUP_S3_BUCKET,`${PHOTO_PREFIX}events/${item.event_id}/${item.filename}`);
          db.prepare('DELETE FROM backup_photo_deletes WHERE event_id=? AND filename=?').run(item.event_id,item.filename);processed++;
        }catch(error){
          db.prepare('UPDATE backup_photo_deletes SET attempts=attempts+1,last_error=? WHERE event_id=? AND filename=?').run(String(error.message||error).slice(0,300),item.event_id,item.filename);
          await notifyFailure(`Gelöschte Fotos konnten nicht aus der Sicherung entfernt werden (${item.event_id}): ${String(error.message||error).slice(0,250)}`);
        }
      }
      await pruneDatabaseVersions();
      return {status:'succeeded',processed};
    }finally{deleteBusy=false;}
  }
  async function deletePhoto(eventId,filename){
    if(!enabled)return false;
    if(!destination||missing.length){const message=`Backup-Zugang fehlt: ${missing.join(', ')}`;queuePhotoDelete(eventId,filename,message);await notifyFailure(message);return false;}
    try{if(!await destination.versioningEnabled(config.BACKUP_S3_BUCKET)||!await destination.photoRetentionSafe(config.BACKUP_S3_BUCKET))throw new Error('Backup-Bucket hat keine sichere Versionierungs- und 7-Tage-Lifecycle-Konfiguration.');const key=`${PHOTO_PREFIX}events/${eventId}/${filename}`;await destination.delete(config.BACKUP_S3_BUCKET,key);db.prepare('DELETE FROM backup_photo_deletes WHERE event_id=? AND filename=?').run(eventId,filename);return true;}
    catch(error){const message=String(error.message||error);queuePhotoDelete(eventId,filename,message);await notifyFailure(`Gelöschtes Foto konnte nicht aus der Sicherung entfernt werden: ${message.slice(0,300)}`);return false;}
  }
  async function deleteEvent(eventId){
    if(!enabled)return false;
    if(!destination||missing.length){const message=`Backup-Zugang fehlt: ${missing.join(', ')}`;queuePhotoDelete(eventId,'*',message);await notifyFailure(message);return false;}
    try{if(!await destination.versioningEnabled(config.BACKUP_S3_BUCKET)||!await destination.photoRetentionSafe(config.BACKUP_S3_BUCKET))throw new Error('Backup-Bucket hat keine sichere Versionierungs- und 7-Tage-Lifecycle-Konfiguration.');const prefix=`${PHOTO_PREFIX}events/${eventId}/`;for(const item of await destination.list(config.BACKUP_S3_BUCKET,prefix)){if(item.Key)await destination.delete(config.BACKUP_S3_BUCKET,item.Key);}db.prepare('DELETE FROM backup_photo_deletes WHERE event_id=?').run(eventId);return true;}
    catch(error){const message=String(error.message||error);queuePhotoDelete(eventId,'*',message);await notifyFailure(`Gelöschtes Album konnte nicht aus der Sicherung entfernt werden: ${message.slice(0,300)}`);return false;}
  }
  return {status,run,start,stop,deletePhoto,deleteEvent,flushDeletes};
}

module.exports={createBackupService,makeS3Store,DB_RETENTION_DAYS,PHOTO_PREFIX,DB_PREFIX};
