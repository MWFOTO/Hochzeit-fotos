const fs=require('node:fs');
const path=require('node:path');
const {uploadDiskWarningThreshold}=require('./upload-capacity');

const GiB=1024**3;

function createOperationsMonitor({config,db,mailer,dependencies={}}){
  const statfs=dependencies.statfs||fs.statfsSync;
  const now=dependencies.now||Date.now;
  const root=path.resolve(config.UPLOAD_DIR||path.join(__dirname,'uploads'));
  const storageLimit=Number(config.S3_MAX_STORAGE_BYTES||900*GiB);
  const recipient=String(config.PAYMENT_ALERT_EMAIL||config.BREVO_SENDER_EMAIL||'').trim();
  let timer=null,busy=false;

  db.exec(`CREATE TABLE IF NOT EXISTS operational_alerts (
    alert_key TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 0,
    last_sent_at INTEGER, last_value INTEGER NOT NULL DEFAULT 0
  )`);

  async function transition(key,triggered,value,subject,message,recoveryMessage,shouldRecover){
    const existing=db.prepare('SELECT * FROM operational_alerts WHERE alert_key=?').get(key);
    const timestamp=now();
    const active=existing?.active? !shouldRecover:triggered;
    if(!active){
      if(!existing)return;
      db.prepare('UPDATE operational_alerts SET active=0,last_value=? WHERE alert_key=?').run(value,key);
      if(existing.active&&mailer&&recipient){
        try{await mailer({to:recipient,subject:`FinalSnap: wieder normal – ${subject}`,text:recoveryMessage});}
        catch(error){console.error('Entwarnung konnte nicht zugestellt werden:',String(error.message||error));}
      }
      return;
    }
    const due=!existing?.active||!existing.last_sent_at||timestamp-existing.last_sent_at>=24*60*60*1000;
    if(due){
      if(!mailer||!recipient){console.error(`Betriebsalarm ${key}: ${message}`);return;}
      try{
        await mailer({to:recipient,subject:`FinalSnap: ${subject}`,text:message});
        db.prepare(`INSERT INTO operational_alerts (alert_key,active,last_sent_at,last_value)
          VALUES (?,1,?,?) ON CONFLICT(alert_key) DO UPDATE SET active=1,last_sent_at=excluded.last_sent_at,last_value=excluded.last_value`).run(key,timestamp,value);
      }catch(error){
        console.error(`Betriebsalarm ${key} konnte nicht zugestellt werden:`,String(error.message||error));
        db.prepare(`INSERT INTO operational_alerts (alert_key,active,last_sent_at,last_value)
          VALUES (?,1,?,?) ON CONFLICT(alert_key) DO UPDATE SET active=1,last_value=excluded.last_value`).run(key,existing?.last_sent_at||null,value);
      }
      return;
    }
    db.prepare('UPDATE operational_alerts SET last_value=? WHERE alert_key=?').run(value,key);
  }

  async function check(){
    if(busy)return {status:'skipped',reason:'already-running'};
    busy=true;
    try{
      const disk=statfs(root),free=Number(disk.bavail)*Number(disk.bsize),total=Number(disk.blocks)*Number(disk.bsize);
      const diskWarn=uploadDiskWarningThreshold(total);
      await transition('render-disk-low',free<diskWarn,free,'Render-Datenträger wird knapp',
        `Auf dem Render-Datenträger sind noch ${(free/GiB).toFixed(2)} GiB von ${(total/GiB).toFixed(2)} GiB frei. Temporäre Uploads und SQLite nutzen diesen Datenträger. Bitte Speicherbelegung und laufende Uploads prüfen.`,
        `Der Render-Datenträger hat wieder ausreichend freien Platz: ${(free/GiB).toFixed(2)} GiB von ${(total/GiB).toFixed(2)} GiB frei.`,free>=diskWarn+256*1024**2);

      const used=Number(db.prepare('SELECT COALESCE(SUM(bytes),0) AS bytes FROM photos').get().bytes)||0;
      const warning=storageLimit*.75,critical=storageLimit*.9;
      await transition('hetzner-storage-75',used>=warning,used,'Hetzner-Fotospeicher bei 75 %',
        `FinalSnap erfasst ${(used/GiB).toFixed(2)} GiB aktive Fotos von der konfigurierten Grenze ${(storageLimit/GiB).toFixed(2)} GiB (${(used/storageLimit*100).toFixed(1)} %). Dies ist eine App-Schätzung aus der SQLite-Fototabelle, keine Hetzner-Rechnung oder vollständige Bucket-Messung. Bitte Hetzner-Verbrauch im Anbieter-Dashboard prüfen.`,
        `Der in FinalSnap erfasste Fotospeicher liegt wieder unter 70 % der App-Grenze: ${(used/GiB).toFixed(2)} GiB von ${(storageLimit/GiB).toFixed(2)} GiB.`,used<warning*.95);
      await transition('hetzner-storage-90',used>=critical,used,'Hetzner-Fotospeicher bei 90 %',
        `FinalSnap erfasst ${(used/GiB).toFixed(2)} GiB aktive Fotos von der konfigurierten Grenze ${(storageLimit/GiB).toFixed(2)} GiB (${(used/storageLimit*100).toFixed(1)} %). Bitte Speicherbedarf, Hetzner-Verbrauch und mögliche Zusatzkosten prüfen; FinalSnap stoppt neue Uploads an der konfigurierten Grenze.`,
        `Der in FinalSnap erfasste Fotospeicher ist wieder unter 85 %: ${(used/GiB).toFixed(2)} GiB von ${(storageLimit/GiB).toFixed(2)} GiB.`,used<critical*.95);
      return {status:'checked',diskFreeBytes:free,photoBytes:used,photoLimitBytes:storageLimit};
    }catch(error){
      console.error('Speicherüberwachung fehlgeschlagen:',String(error.message||error));
      return {status:'failed',error:String(error.message||error)};
    }finally{busy=false;}
  }

  function start(){
    if(timer)return;
    timer=setInterval(()=>check(),15*60*1000);timer.unref();
    setTimeout(()=>check(),5000).unref();
  }
  function stop(){if(timer){clearInterval(timer);timer=null;}}
  return {check,start,stop};
}

module.exports={createOperationsMonitor,GiB};
