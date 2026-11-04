// Idempotent copy from a mounted local photo directory to a private S3 bucket.
// Dry-run is the default; originals are never removed.
const fs=require('node:fs');
const path=require('node:path');
const Database=require('better-sqlite3');
const {createPhotoStorage}=require('../photo-storage');

async function migrate({dbPath,uploadRoot,config=process.env,apply=false}) {
  if(!dbPath||!fs.existsSync(dbPath))throw new Error('SQLite-Datenbank fehlt. DB_PATH prüfen.');
  if(!uploadRoot||!fs.existsSync(uploadRoot))throw new Error('Fotoverzeichnis fehlt. UPLOAD_DIR prüfen.');
  if(!config.S3_BUCKET)throw new Error('S3_BUCKET ist nicht gesetzt.');
  const db=new Database(dbPath,{readonly:true,fileMustExist:true});
  const storage=createPhotoStorage(config);
  try {
    const photos=db.prepare('SELECT event_id,filename,bytes FROM photos ORDER BY event_id,filename').all();
    const result={mode:apply?'apply':'dry-run',total:photos.length,copied:0,alreadyPresent:0,missing:0,errors:[]};
    for(const photo of photos) {
      const file=path.join(uploadRoot,photo.event_id,photo.filename);
      if(!fs.existsSync(file)) {result.missing++;result.errors.push(`Datei fehlt: ${photo.event_id}/${photo.filename}`);continue;}
      const info=fs.statSync(file);
      if(!info.isFile()||info.size!==Number(photo.bytes)) {result.errors.push(`Dateigröße stimmt nicht: ${photo.event_id}/${photo.filename}`);continue;}
      if(!apply) {result.copied++;continue;}
      try {
        const existingSize=await storage.photoSize(photo.event_id,photo.filename);
        if(existingSize===info.size) {result.alreadyPresent++;continue;}
        if(existingSize!==null) {result.errors.push(`Vorhandenes Object hat eine andere Größe: ${photo.event_id}/${photo.filename}`);continue;}
        await storage.put(photo.event_id,photo.filename,file);
        result.copied++;
      } catch(error) {result.errors.push(`${photo.event_id}/${photo.filename}: ${error.message}`);}
    }
    return result;
  } finally {db.close();}
}

if(require.main===module) {
  const apply=process.argv.includes('--apply');
  migrate({dbPath:process.env.DB_PATH,uploadRoot:process.env.UPLOAD_DIR,apply})
    .then(summary=>{console.log(JSON.stringify(summary,null,2));if(summary.errors.length)process.exitCode=2;})
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}

module.exports={migrate};
