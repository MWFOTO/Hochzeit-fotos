(() => {
  const $ = selector => document.querySelector(selector);
  const eventId = decodeURIComponent(location.pathname.split('/')[2] || '');
  const endpoint = `/api/event/${encodeURIComponent(eventId)}`;
  const form = $('#designForm');
  const titleInput = $('#eventTitle');
  const occasionInput = $('#occasion');
  const dateInput = $('#eventDate');
  const colorInput = $('#accentColor');
  const fontInput = $('#fontStyle');
  const customArtworkInput=$('#customArtwork');
  const phone = $('#phonePreview');
  const coverName = $('#uploadFilename');
  const status = $('#saveStatus');
  const fonts = {
    classic: { name: 'Georgia', css: 'Georgia, serif' },
    palatino: { name: 'Palatino Linotype', css: 'Palatino Linotype, Palatino, serif' },
    modern: { name: 'Arial', css: 'Arial, sans-serif' },
    verdana: { name: 'Verdana', css: 'Verdana, sans-serif' },
    relaxed: { name: 'Trebuchet MS', css: 'Trebuchet MS, sans-serif' },
    typewriter: { name: 'Courier New', css: 'Courier New, monospace' }
  };
  const themes = {
    afterglow: { accent: '#e99a69', label: 'Pfirsich', end: '#48343b' },
    midnight: { accent: '#64cdd1', label: 'Lagune', end: '#203c48' },
    garden: { accent: '#a8bf83', label: 'Salbei', end: '#3e5947' }
  };
  const stylePresets={elegant:{theme:'garden',font:'palatino'},playful:{theme:'afterglow',font:'relaxed'},modern:{theme:'midnight',font:'modern'},romantic:{theme:'garden',font:'classic'}};
  const palettes={sage:{accent:'#a8bf83',name:'Salbei'},gold:{accent:'#d3ad63',name:'Gold'},rose:{accent:'#e8a9b8',name:'Rosé'},neon:{accent:'#49d5e8',name:'FinalSnap Türkis'}};
  const occasions = {
    wedding: 'UNSERE HOCHZEIT', birthday: 'GEBURTSTAG', party:'UNSERE PARTY', summer: 'SOMMERFEST',
    company: 'FIRMENFEIER', jubilee: 'JUBILÄUM', graduation: 'ABSCHLUSSFEIER', other: 'UNSER EVENT'
  };
  let csrf = '';
  let coverUrl = '';
  let coverDataUrl = '';
  let qrDataUrl = '';
  let selectedFormat = 'tent';

  async function api(url, method = 'GET', body) {
    const headers = {};
    if (method !== 'GET') {
      if (!csrf) {
        const me = await fetch('/api/auth/me');
        if (me.ok) csrf = (await me.json()).csrf || '';
      }
      if (csrf) headers['X-CSRF-Token'] = csrf;
      if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, {
      method,
      headers,
      ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {})
    });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || 'Anfrage fehlgeschlagen.');
    return data || response;
  }

  function toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function setCover(dataUrl, name = 'Eigenes Titelmotiv') {
    coverDataUrl = dataUrl;
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    const blob = dataUrlToBlob(dataUrl);
    coverUrl = URL.createObjectURL(blob);
    phone.classList.add('custom-cover');
    phone.style.setProperty('--custom-cover', `linear-gradient(0deg,#161415a8,#16141508 76%),url("${coverUrl}")`);
    coverName.textContent = name;
    customArtworkInput.disabled=false;
  }

  function dataUrlToBlob(value) {
    const [meta, encoded] = value.split(',');
    const mime = /data:([^;]+)/.exec(meta)?.[1] || 'image/jpeg';
    const binary = atob(encoded || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function updatePreview() {
    $('#previewTitle').textContent = titleInput.value.trim() || 'Euer Albumtitel';
    $('#previewOccasion').textContent = occasions[occasionInput.value] || occasions.other;
    if (dateInput.value) {
      const date = new Date(`${dateInput.value}T12:00:00`);
      $('#previewDate').textContent = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }).format(date).toUpperCase();
    } else $('#previewDate').textContent = 'GEMEINSAM ERLEBT';
    document.documentElement.style.setProperty('--accent', colorInput.value);
    document.documentElement.style.setProperty('--accent-rgb', hexToRgb(colorInput.value));
    document.documentElement.style.setProperty('--display-font', fonts[fontInput.value]?.name || fonts.classic.name);
  }

  function hexToRgb(hex) {
    const value = hex.replace('#', '');
    return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16)).join(',');
  }

  function selectTheme(theme) {
    const chosen = themes[theme] ? theme : 'afterglow';
    document.querySelectorAll('.template-card').forEach(card => {
      const selected = card.dataset.template === chosen;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
    phone.classList.remove('template-afterglow', 'template-midnight', 'template-garden');
    phone.classList.add(`template-${chosen}`);
    colorInput.value = themes[chosen].accent;
    $('#colorLabel').textContent = themes[chosen].label;
    updatePreview();
  }

  function updateColorLabel() {
    const theme = $('.template-card.selected')?.dataset.template;
    $('#colorLabel').textContent = themes[theme]?.accent.toLowerCase() === colorInput.value.toLowerCase()
      ? themes[theme].label
      : 'Eigene Farbe';
  }

  document.querySelectorAll('.template-card').forEach(button => button.addEventListener('click', () => selectTheme(button.dataset.template)));
  const guidedStyleInputs=[...document.querySelectorAll('[name="guided-style"]')];
  const guidedPalette=$('#guided-palette');
  const guidedIdea=$('#guided-idea');
  const guidedStatus=$('#guided-inspiration-status');
  const guidedInspiration=$('#guided-inspiration');
  function applyGuidedDesign({rotate=false}={}){
    if(rotate){const current=Math.max(0,guidedStyleInputs.findIndex(input=>input.checked));guidedStyleInputs[(current+1)%guidedStyleInputs.length].checked=true;const palettesList=Object.keys(palettes);guidedPalette.value=palettesList[(palettesList.indexOf(guidedPalette.value)+1)%palettesList.length];}
    const style=guidedStyleInputs.find(input=>input.checked)?.value||'elegant';const preset=stylePresets[style]||stylePresets.elegant;const palette=palettes[guidedPalette.value]||palettes.sage;
    selectTheme(preset.theme);fontInput.value=preset.font;colorInput.value=palette.accent;$('#colorLabel').textContent=palette.name;updatePreview();
    $('#guided-title').textContent='Euer Entwurf ist bereit';
    status.textContent='Entwurf wird gespeichert …';
    form.requestSubmit();
  }
  $('#generate-guided-design').addEventListener('click',()=>applyGuidedDesign());
  $('#another-guided-variant').addEventListener('click',()=>applyGuidedDesign({rotate:true}));
  $('#customize-guided-design').addEventListener('click',()=>{$('#step-design').scrollIntoView({behavior:'smooth',block:'start'});titleInput.focus({preventScroll:true});});
  guidedInspiration.addEventListener('change',()=>{const file=guidedInspiration.files?.[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8*1024*1024){guidedStatus.textContent='Bitte ein JPG-, PNG- oder WEBP-Bild bis 8 MB auswählen.';guidedInspiration.value='';$('#use-guided-inspiration').hidden=true;return;}guidedStatus.textContent=`„${file.name}“ bleibt als Orientierung auf diesem Gerät. Es wird nicht an FinalSnap übertragen.`;$('#use-guided-inspiration').hidden=false;});
  $('#use-guided-inspiration').addEventListener('click',()=>{const file=guidedInspiration.files?.[0];if(!file)return;if(typeof DataTransfer!=='function'){guidedStatus.textContent='Wähle das Bild bitte zusätzlich über „PNG, JPG oder WEBP auswählen“ aus, um es als Titelmotiv zu speichern.';return;}const transfer=new DataTransfer();transfer.items.add(file);$('#coverUpload').files=transfer.files;$('#coverUpload').dispatchEvent(new Event('change',{bubbles:true}));guidedStatus.textContent='Du hast ausgewählt, dieses Bild als Titelmotiv bei FinalSnap zu speichern.';});
  document.querySelectorAll('.progress-step, .next-step-button').forEach(link => link.addEventListener('click', () => {
    const target = link.getAttribute('href');
    document.querySelectorAll('.progress-step').forEach(step => step.classList.toggle('active', step.getAttribute('href') === target));
  }));
  titleInput.addEventListener('input', updatePreview);
  occasionInput.addEventListener('change', updatePreview);
  dateInput.addEventListener('input', updatePreview);
  colorInput.addEventListener('input', () => { $('#colorLabel').textContent = 'Eigene Farbe'; updatePreview(); });
  fontInput.addEventListener('change', updatePreview);

  $('#coverUpload').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      coverName.textContent = 'Bitte wähle eine JPG-, PNG- oder WEBP-Datei bis 8 MB.';
      event.target.value = '';
      return;
    }
    coverName.textContent = 'Titelmotiv wird sicher für dieses Event gespeichert …';
    try {
      const upload = new FormData();
      upload.append('cover', file, file.name);
      await api(`${endpoint}/design-cover`, 'POST', upload);
      const response = await fetch(`${endpoint}/design-cover`);
      if (!response.ok) throw new Error('Titelmotiv konnte nicht geladen werden.');
      setCover(await toDataUrl(await response.blob()), file.name);
      $('#downloadStatus').textContent = 'Titelmotiv gespeichert. Druckdateien nutzen diese Version.';
    } catch (error) {
      coverName.textContent = error.message;
    }
  });

  document.querySelectorAll('.format-card').forEach(button => button.addEventListener('click', () => {
    selectedFormat = button.dataset.format;
    document.querySelectorAll('.format-card').forEach(card => {
      const selected = card === button;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
  }));

  $('#copyAiBrief').addEventListener('click', async () => {
    const templateName = $('.template-card.selected .template-name')?.textContent || 'Afterglow';
    const occasionName = occasionInput.options[occasionInput.selectedIndex]?.text || occasionInput.value;
    const prompt = `Erstelle ein hochwertiges Kartendesign für FinalSnap. Anlass: ${occasionName}. Albumtitel: ${titleInput.value.trim() || 'Euer Event'}. Stil: ${templateName}. Akzentfarbe: ${colorInput.value}. Schriftstil: ${fonts[fontInput.value]?.name || fonts.classic.name}. Idee: ${guidedIdea.value.trim()||'keine zusätzliche Idee'}. Hochformat, klare gut lesbare Gestaltung, ausreichender Kontrast. Lass in der Mitte ein freies Feld von ca. 4 × 4 cm für den QR-Code. Keinen QR-Code selbst zeichnen. Keine fehleranfälligen Texte und kein FinalSnap-Logo einbauen; Titel und echter QR-Code werden anschließend im FinalSnap-Editor ergänzt.`;
    const field = $('#aiBriefText');
    field.value = prompt;
    try {
      await navigator.clipboard.writeText(prompt);
      $('#aiBriefStatus').textContent = 'Design-Brief kopiert. Öffne eines der kostenlosen Werkzeuge und füge ihn dort ein.';
    } catch {
      field.hidden = false; field.focus(); field.select();
      $('#aiBriefStatus').textContent = 'Design-Brief ist markiert. Kopiere ihn in dein gewähltes Werkzeug.';
    }
  });

  function getPrintData() {
    const selected = $('.template-card.selected');
    return {
      title: titleInput.value.trim() || 'Euer Album',
      occasionLabel: occasions[occasionInput.value] || occasions.other,
      date: dateInput.value ? new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${dateInput.value}T12:00:00`)) : '',
      accent: colorInput.value,
      image: coverDataUrl,
      qr: qrDataUrl,
      fontFamily: fonts[fontInput.value]?.css || fonts.classic.css,
      format: selectedFormat,
      theme: selected?.dataset.template || 'afterglow'
      ,qrPosition:$('#qrPlacement')?.value||'center',customArtwork:!!customArtworkInput?.checked
    };
  }

  function safeText(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function printMarkup(data) {
    const tent = data.format === 'tent';
    const poster = data.format === 'poster';
    const pageSize = tent ? 'A4 landscape' : poster ? 'A4 portrait' : 'A6 portrait';
    const qrSize = tent ? '33mm' : poster ? '50mm' : '36mm';
    const themeEnd = data.theme === 'midnight' ? '#203c48' : data.theme === 'garden' ? '#3e5947' : '#44343a';
    const designBg = data.image ? `linear-gradient(0deg,#151416bb,#15141624 82%),url('${data.image}') center/cover` : `linear-gradient(145deg,${data.accent} 0%,${themeEnd} 100%)`;
    const qr = `<div class="qr-placeholder real-qr qr-${data.qrPosition}" style="width:${qrSize};height:${qrSize};padding:2mm"><img src="${data.qr}" alt="QR-Code zum Eventalbum" style="width:100%;height:100%;object-fit:contain"></div>`;
    const panel = (back = false) => `<section class="panel ${back ? 'back' : ''}" style="--art:${designBg};--accent:${data.accent}"><div class="wash"></div><div class="content"><div class="brand">FINAL<span>SNAP</span></div><p class="kicker">${safeText(back ? 'TEILT EURE MOMENTE' : data.occasionLabel)}</p><h1 style="font-family:${data.fontFamily}">${safeText(data.title)}</h1>${data.date ? `<p class="date">${safeText(data.date)}</p>` : ''}<p class="invite" style="font-family:${data.fontFamily}">${back ? 'Scannen, Fotos teilen und die Feier aus vielen Blickwinkeln erleben.' : 'Macht mit und ladet eure Fotos in unser gemeinsames Album.'}</p>${qr}<p class="qr-hint">Scannen und eigene Fotos teilen</p></div></section>`;
    const body = tent ? `<main class="sheet tent">${panel(true)}${panel(false)}<div class="fold"></div></main>` : `<main class="sheet single ${poster ? 'poster' : 'card'}">${panel(false)}</main>`;
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${safeText(data.title)} · FinalSnap Druck</title><style>@page{size:${pageSize};margin:0}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:Arial,sans-serif;color:#fff}.sheet{position:relative;width:100vw;height:100vh;overflow:hidden;background:#29252a}.tent{display:flex}.panel{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;background:var(--art);background-position:center;background-size:cover;overflow:hidden}.tent .panel{width:50%;height:100%}.tent .panel.back{transform:rotate(180deg)}.fold{position:absolute;left:50%;top:0;height:100%;border-left:1px dashed #fff9;z-index:2}.wash{position:absolute;inset:0;background:linear-gradient(180deg,#17151952,#171519a6)}.content{position:relative;z-index:1;width:82%;max-width:460px;margin:auto;display:flex;align-items:center;flex-direction:column}.tent .content{width:78%}.brand{font-size:14px;letter-spacing:.22em;font-weight:800;margin-bottom:9%}.brand span{font-weight:400}.kicker{font-size:9px;letter-spacing:.24em;font-weight:700;margin:0 0 12px}.content h1{font-size:clamp(27px,5vw,64px);line-height:1.03;font-weight:500;letter-spacing:-.04em;max-width:100%;margin:0 0 10px;overflow-wrap:anywhere}.tent .content h1{font-size:clamp(20px,3vw,38px)}.date{font-size:10px;letter-spacing:.16em;text-transform:uppercase;margin:0 0 14px}.invite{font-style:italic;font-size:14px;line-height:1.4;max-width:340px;margin:0 0 18px}.tent .invite{font-size:11px}.qr-placeholder{background:#fff;color:#272329;display:flex;align-items:center;justify-content:center;flex-direction:column;border:3px solid #fff;border-radius:3px;box-shadow:0 3px 14px #0003}.qr-hint{font:8px Arial,sans-serif;margin:8px 0 0;opacity:.9}.card .content{width:80%}.card .content h1{font-size:28px}.poster .content h1{font-size:44px}@media screen{body{background:#e9e5de;padding:24px;min-height:100vh}.sheet{margin:auto;box-shadow:0 10px 40px #0004}.tent{width:min(100%,1100px);height:auto;aspect-ratio:297/210}.single{width:min(100%,650px);height:auto;aspect-ratio:${data.format === 'card' ? '105/148' : '210/297'}}.tent .content h1{font-size:clamp(22px,4vw,42px)}.single .content h1{font-size:clamp(25px,5vw,52px)}}@media print{.sheet{width:100vw;height:100vh}.fold{border-color:#fff7}}</style></head><body>${body}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));</script></body></html>`;
  }

  async function renderArtwork(data) {
    const [width,height] = data.format === 'tent' ? [1600,1141] : data.format === 'card' ? [1020,1414] : [1000,1403];
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    let uploadedImage = null; let uploadedQr = null;
    const panels = data.format === 'tent' ? [[0,0,width/2,height,true],[width/2,0,width/2,height,false]] : [[0,0,width,height,false]];
    const drawPanel = (x,y,w,h,back) => {
      const gradient=ctx.createLinearGradient(x,y,x+w,y+h); gradient.addColorStop(0,data.accent); gradient.addColorStop(1,themes[data.theme]?.end||themes.afterglow.end); ctx.fillStyle=gradient; ctx.fillRect(x,y,w,h);
      if(uploadedImage){ctx.save();ctx.globalAlpha=data.customArtwork?1:.43;ctx.drawImage(uploadedImage,x,y,w,h);ctx.restore();}
      if(!data.customArtwork){ctx.fillStyle='#15141680';ctx.fillRect(x,y,w,h);}ctx.textAlign='center';ctx.fillStyle='#fff';const centerX=x+w/2;let top=y+h*.18;
      if(back){ctx.save();ctx.translate(centerX,y+h/2);ctx.rotate(Math.PI);ctx.translate(-centerX,-(y+h/2));}
      if(!data.customArtwork){
      ctx.font='700 22px Arial';ctx.fillText('FINALSNAP',centerX,top);top+=h*.12;
      ctx.font='700 13px Arial';ctx.letterSpacing='3px';ctx.fillText(back?'TEILT EURE MOMENTE':data.occasionLabel,centerX,top);top+=h*.095;ctx.letterSpacing='0px';
      ctx.font=`500 ${data.format==='tent'?38:54}px ${data.fontFamily}`;const title=data.title.length>25?`${data.title.slice(0,23)}…`:data.title;ctx.fillText(title,centerX,top,w*.84);top+=h*.07;
      if(data.date){ctx.font='14px Arial';ctx.fillText(data.date.toUpperCase(),centerX,top);top+=h*.07;}
      ctx.font=`italic 17px ${data.fontFamily}`;ctx.fillText(back?'Scannen, Fotos teilen und feiern':'Macht mit und ladet Fotos hoch',centerX,top,w*.82);top+=h*.1;
      }
      const qrSize=data.format==='poster'?240:data.format==='card'?330:250;const qrPoint=data.qrPosition==='lowerCenter'?[centerX,y+h*.72]:data.qrPosition==='lowerRight'?[x+w*.75,y+h*.72]:[centerX,data.customArtwork?y+h*.64:top+qrSize/2];const qrX=qrPoint[0]-qrSize/2,qrY=qrPoint[1]-qrSize/2;ctx.fillStyle='#fff';ctx.fillRect(qrX,qrY,qrSize,qrSize);
      ctx.imageSmoothingEnabled=false;ctx.drawImage(uploadedQr,qrX+4,qrY+4,qrSize-8,qrSize-8);ctx.imageSmoothingEnabled=true;
      if(!data.customArtwork){ctx.font='11px Arial';ctx.fillStyle='#fff';ctx.fillText('Scannen und eigene Fotos teilen',qrPoint[0],qrY+qrSize+25,w*.88);}if(back)ctx.restore();
    };
    try {
      uploadedQr=new Image();uploadedQr.src=data.qr;await uploadedQr.decode();
      if(data.image){uploadedImage=new Image();uploadedImage.src=data.image;await uploadedImage.decode();}
      panels.forEach(([x,y,w,h,back])=>drawPanel(x,y,w,h,back));
      return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG konnte nicht erstellt werden.')),'image/png'));
    } catch { throw new Error('Druckmotiv konnte nicht erstellt werden. Bitte erneut versuchen.'); }
  }
  function downloadBlob(blob,name) {
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('#pngButton').addEventListener('click',async()=>{
    try {const data=getPrintData(),blob=await renderArtwork(data);downloadBlob(blob,`finalsnap-${data.format}-${Date.now()}.png`);$('#downloadStatus').textContent='PNG mit dem Event-QR heruntergeladen. Der QR hat einen hellen Rand zum sicheren Scannen.';}
    catch(error){$('#downloadStatus').textContent=error.message;}
  });
  $('#pdfButton').addEventListener('click',async()=>{
    const button=$('#pdfButton');button.disabled=true;$('#downloadStatus').textContent='Druckfertige PDF wird erstellt …';
    try {
      const data=getPrintData(),artwork=await renderArtwork(data),formData=new FormData();formData.append('design',artwork,`finalsnap-${data.format}.png`);
      const response=await api(`${endpoint}/design-print.pdf?format=${encodeURIComponent(data.format)}`,'POST',formData);
      downloadBlob(await response.blob(),`finalsnap-${data.format}-${Date.now()}.pdf`);
      $('#downloadStatus').textContent='Druckfertige PDF mit 3 mm Beschnitt heruntergeladen. Tischaufsteller: an der Mittellinie falten.';
    } catch(error){$('#downloadStatus').textContent=error.message;}
    finally{button.disabled=false;}
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await api(`${endpoint}/design`, 'PATCH', { design: { title:titleInput.value, occasion:occasionInput.value, theme:$('.template-card.selected')?.dataset.template||'afterglow', accent:colorInput.value, font:fontInput.value,customArtwork:customArtworkInput.checked } });
      status.textContent='Design für dieses Event gespeichert.';
    } catch(error) { status.textContent=error.message; }
  });

  async function loadCover() {
    try {
      const response=await fetch(`${endpoint}/design-cover`);
      if(!response.ok)throw new Error('Kein eigenes Motiv gespeichert');
      setCover(await toDataUrl(await response.blob()),'Eigenes Titelmotiv gespeichert');
    } catch { coverName.textContent='Noch kein eigenes Motiv ausgewählt'; }
  }

  async function loadEvent() {
    if(!eventId)throw new Error('Event nicht gefunden.');
    const {event,design}=await api(`${endpoint}/design`);
    titleInput.value=design.title||event.title;
    occasionInput.value=design.occasion||'other';
    dateInput.value=event.eventDate||'';
    colorInput.value=design.accent||themes.afterglow.accent;
    fontInput.value=design.font||'classic';
    customArtworkInput.checked=!!design.customArtwork;
    selectTheme(design.theme||'afterglow');
    colorInput.value=design.accent||themes.afterglow.accent;
    updateColorLabel();
    updatePreview();
    if(design.hasCover)await loadCover();
    const qrResponse=await fetch(`${endpoint}/qr`);
    if(!qrResponse.ok)throw new Error('Der Event-QR konnte nicht geladen werden.');
    qrDataUrl=await toDataUrl(await qrResponse.blob());
    const qr=$('#qrPreviewImage');qr.src=qrDataUrl;qr.hidden=false;$('#qrPreview').classList.add('has-qr');
    $('#eventQrCode').src=qrDataUrl;$('#eventQrCode').hidden=false;$('#qrLoading').hidden=true;
    $('#qrFileStatus').textContent='Automatisch aus dem aktuellen Gästelink erzeugt.';
    $('#downloadStatus').textContent='Der echte Event-QR ist in PDF und PNG enthalten.';
    status.textContent='Design geladen. Änderungen kannst du für dieses Event speichern.';
    $('#pageTitle').textContent='Gestalte euer gemeinsames Album.';
    updatePreview();
  }

  updatePreview();
  loadEvent().catch(error=>{status.textContent=error.message;$('#qrFileStatus').textContent='Event-QR konnte nicht geladen werden.';$('#pdfButton').disabled=true;$('#pngButton').disabled=true;});
})();
