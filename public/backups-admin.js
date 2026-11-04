(() => {
  const status=document.getElementById('status');
  const summary=document.getElementById('summary');
  const runs=document.getElementById('runs');
  const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
  function card(title,value,detail){const article=node('article');article.className='backup-stat';article.append(node('h2',title),node('strong',value),node('p',detail));return article;}
  function date(value){return value?new Date(value).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'}):'–';}
  async function load(){
    try{
      const response=await fetch('/api/admin/backups',{headers:{Accept:'application/json'}});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'Sicherungsstatus konnte nicht geladen werden.');
      const config=data.configuration;
      summary.replaceChildren(
        card('Status',config.enabled?(config.configured?'Aktiviert':'Unvollständig'):'Deaktiviert',config.enabled?(config.configured?'Der Dienst prüft Bucket, Verschlüsselung und Aufbewahrung vor jedem Lauf.':`Fehlende Einstellungen: ${config.missing.join(', ')}`):'BACKUP_ENABLED ist aus. Erst nach dem separaten Hetzner-Backup-Bucket aktivieren.'),
        card('Datenbank',`${data.retention.databaseDays} Tage`,data.recentRuns.find(run=>run.status==='succeeded')?`Letzter Erfolg: ${date(data.recentRuns.find(run=>run.status==='succeeded').completed_at)}`:'Noch kein erfolgreicher Lauf protokolliert.'),
        card('Fotos',`max. ${data.retention.photosAfterAlbumDeletionDays} Tage`,`${data.queuedPhotoDeletes} Foto-Löschung(en) warten auf die Sicherung${data.oldestQueuedPhotoDeleteAt?`; älteste: ${date(data.oldestQueuedPhotoDeleteAt)}`:''}.`)
      );
      runs.replaceChildren();
      if(!data.recentRuns.length)runs.append(node('p','Noch keine Sicherungsläufe protokolliert.'));
      for(const run of data.recentRuns){
        const row=node('article');row.className='backup-run';
        const label=run.status==='succeeded'?'Erfolgreich':run.status==='running'?'Läuft':run.status==='failed'?'Fehlgeschlagen':run.status;
        row.append(node('h3',`${label} · ${date(run.started_at)}`));
        if(run.db_object_key)row.append(node('p',`Datenbank: ${run.db_object_key}`));
        if(run.status==='succeeded')row.append(node('p',`${run.photo_objects??0} Fotoobjekte · ${((run.photo_bytes||0)/1024**3).toFixed(2)} GB · beendet ${date(run.completed_at)}`));
        if(run.error)row.append(node('p',`Fehler: ${run.error}`));
        runs.append(row);
      }
      status.textContent=data.staleQueuedPhotoDeletes?'Achtung: Foto-Löschungen warten länger als sieben Tage auf die Sicherungsbereinigung.':'Sicherungsstatus geladen. Bitte regelmäßig den Wiederherstellungstest dokumentieren.';
    }catch(error){status.textContent=error.message;}
  }
  load();
})();
