// Operator-only migration. Never assigns events based solely on an email address.
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const sharp=require('sharp');
const {openDatabase}=require('../db');
async function importLegacy({dbPath,uploadRoot,eventId,ownerEmail,apply=false}) {
  if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(eventId)) throw new Error('Ungültige Bestands-ID; manuelle Prüfung nötig.');
  if(!fs.existsSync(dbPath)) throw new Error('Datenbank fehlt. Erst lokales Kundenkonto erstellen.');
  const db=openDatabase(dbPath);
  try {
    const owner=db.prepare('SELECT * FROM users WHERE email=?').get(ownerEmail.toLowerCase());
    if(!owner) throw new Error('Zielkonto fehlt. Erst registrieren und Identität prüfen.');
    const event=db.prepare('SELECT * FROM events WHERE id=?').get(eventId);
    if(event?.owner_id && event.owner_id!==owner.id) throw new Error('Event gehört bereits einem anderen Konto.');
    if(event?.deleted_at) throw new Error('Gelöschte Veranstaltung darf nicht reaktiviert werden.');
    const dir=path.join(uploadRoot,eventId);
    const files=fs.existsSync(dir)?fs.readdirSync(dir):[];
    const photos=[];
    for(const filename of files) {
      const file=path.join(dir,filename);
      if(!fs.lstatSync(file).isFile()) throw new Error(`Keine reguläre Datei: ${filename}`);
      const known=db.prepare('SELECT 1 FROM photos WHERE event_id=? AND filename=?').get(eventId,filename);
      if(known) continue;
      const meta=await sharp(file,{limitInputPixels:40000000}).metadata();
      if(!['jpeg','png','webp'].includes(meta.format)) throw new Error(`Datei muss separat geprüft werden: ${filename}`);
      const extensions={jpeg:['.jpg','.jpeg'],png:['.png'],webp:['.webp']};
      if(!extensions[meta.format].includes(path.extname(filename).toLowerCase())) throw new Error(`Bildendung muss zum tatsächlichen Format passen: ${filename}`);
      if(!/^[a-zA-Z0-9_.-]+$/.test(filename)) throw new Error(`Dateiname muss separat geprüft werden: ${filename}`);
      photos.push({filename,bytes:fs.statSync(file).size,time:Math.floor(fs.statSync(file).mtimeMs)});
    }
    const summary={eventId,newPhotos:photos.length,status:event?.status||'pending',mode:apply?'apply':'dry-run'};
    if(!apply) return summary;
    // SQLite backup captures committed WAL data too. Originals remain unmodified.
    await db.backup(`${dbPath}.before-import-${Date.now()}.db`);
    db.transaction(()=>{
      if(!event)db.prepare("INSERT INTO events (id,email,plan,amount_cents,status,created_at) VALUES (?,?,'1m',1900,'pending',?)").run(eventId,owner.email,Date.now());
      db.prepare('UPDATE events SET owner_id=?, guest_token=COALESCE(guest_token,?) WHERE id=?').run(owner.id,crypto.randomBytes(32).toString('hex'),eventId);
      for(const p of photos)db.prepare('INSERT INTO photos VALUES (?,?,?,?,0,?)').run(crypto.randomUUID(),eventId,p.filename,p.bytes,p.time);
    })();
    return summary;
  } finally {db.close();}
}
if(require.main===module) {
  const args=process.argv.slice(2);
  const value=key=>args[args.indexOf(key)+1];
  if(!args.includes('--event') || !args.includes('--owner-email')) {console.error('npm run import:legacy -- --event EVENT-ID --owner-email KONTO [--apply]');process.exitCode=1;}
  else importLegacy({dbPath:process.env.DB_PATH||path.join(__dirname,'../events.db'),uploadRoot:process.env.UPLOAD_DIR||path.join(__dirname,'../uploads'),eventId:value('--event'),ownerEmail:value('--owner-email'),apply:args.includes('--apply')}).then(x=>console.log(JSON.stringify(x))).catch(err=>{console.error(err.message);process.exitCode=1;});
}
module.exports={importLegacy};
