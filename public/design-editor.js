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
    const prompt = `Erstelle ein hochwertiges Kartendesign für FinalSnap. Anlass: ${occasionName}. Albumtitel: ${titleInput.value.trim() || 'Euer Event'}. Stil: ${templateName}. Akzentfarbe: ${colorInput.value}. Schriftstil: ${fonts[fontInput.value]?.name || fonts.classic.name}. Idee: ${$('#cs-wish')?.value.trim()||'keine zusätzliche Idee'}. Hochformat, klare gut lesbare Gestaltung, ausreichender Kontrast. Lass in der Mitte ein freies Feld von ca. 4 × 4 cm für den QR-Code. Keinen QR-Code selbst zeichnen. Keine fehleranfälligen Texte und kein FinalSnap-Logo einbauen; Titel und echter QR-Code werden anschließend im FinalSnap-Editor ergänzt.`;
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
      ,qrPosition:$('#qrPlacement')?.value||'center',customArtwork:!!customArtworkInput?.checked,
      ...cardTexts()
    };
  }

  const textFields={kicker:'#cardKicker',invite:'#cardInvite',backKicker:'#cardBackKicker',backInvite:'#cardBackInvite'};
  function cardTexts(){const out={};for(const [key,sel] of Object.entries(textFields)){const v=$(sel)?.value.trim();if(v)out[key]=v;}return out;}
  function setCardTexts(values={}){for(const [key,sel] of Object.entries(textFields)){if($(sel))$(sel).value=values[key]||'';}}
  // Bricht Text für die Leinwand in höchstens maxLines Zeilen um
  function wrapLines(ctx,text,maxWidth,maxLines=2){
    const words=String(text).split(/\s+/).filter(Boolean),lines=[];let line='';
    for(const word of words){const test=line?`${line} ${word}`:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word;}else line=test;}
    if(line)lines.push(line);
    if(lines.length>maxLines){lines.length=maxLines;lines[maxLines-1]=lines[maxLines-1].replace(/\s*\S*$/,'')+'…';}
    return lines;
  }
  function safeText(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
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
      // Schriftgrößen relativ zur Kartenbreite, damit der Druck in jedem Format gut lesbar ist
      const u=w/100;
      ctx.font=`800 ${2.6*u}px Arial`;ctx.letterSpacing=`${.5*u}px`;ctx.fillText('FINALSNAP',centerX,top);ctx.letterSpacing='0px';top+=h*.1;
      ctx.font=`700 ${2.3*u}px Arial`;ctx.letterSpacing=`${.45*u}px`;ctx.fillText((back?(data.backKicker||'TEILT EURE MOMENTE'):(data.kicker||data.occasionLabel)).toUpperCase(),centerX,top,w*.86);ctx.letterSpacing='0px';top+=h*.075;
      const titleSize=(data.format==='tent'?7.2:8)*u;ctx.font=`500 ${titleSize}px ${data.fontFamily}`;const titleLines=wrapLines(ctx,data.title,w*.84,2);titleLines.forEach((line,i)=>ctx.fillText(line,centerX,top+i*titleSize*1.08,w*.86));top+=(titleLines.length-1)*titleSize*1.08+h*.055;
      if(data.date){ctx.font=`${2.1*u}px Arial`;ctx.letterSpacing=`${.3*u}px`;ctx.fillText(data.date.toUpperCase(),centerX,top);ctx.letterSpacing='0px';top+=h*.06;}
      const inviteSize=3.3*u;ctx.font=`italic ${inviteSize}px ${data.fontFamily}`;const invite=back?(data.backInvite||'Scannen, Fotos teilen und feiern.'):(data.invite||'Macht mit und ladet eure Fotos in unser gemeinsames Album.');const inviteLines=wrapLines(ctx,invite,w*.78,2);inviteLines.forEach((line,i)=>ctx.fillText(line,centerX,top+i*inviteSize*1.3,w*.82));top+=(inviteLines.length-1)*inviteSize*1.3+h*.035;
      }
      const qrSize=data.format==='poster'?240:data.format==='card'?330:250;const qrPoint=data.qrPosition==='lowerCenter'?[centerX,y+h*.72]:data.qrPosition==='lowerRight'?[x+w*.75,y+h*.72]:[centerX,data.customArtwork?y+h*.64:top+qrSize/2];const qrX=qrPoint[0]-qrSize/2,qrY=qrPoint[1]-qrSize/2;ctx.fillStyle='#fff';ctx.fillRect(qrX,qrY,qrSize,qrSize);
      ctx.imageSmoothingEnabled=false;ctx.drawImage(uploadedQr,qrX+4,qrY+4,qrSize-8,qrSize-8);ctx.imageSmoothingEnabled=true;
      if(!data.customArtwork){ctx.font=`${2*w/100}px Arial`;ctx.fillStyle='#fff';ctx.fillText('Scannen und eigene Fotos teilen',qrPoint[0],qrY+qrSize+w*.045,w*.88);}if(back)ctx.restore();
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
      await api(`${endpoint}/design`, 'PATCH', { design: { title:titleInput.value, occasion:occasionInput.value, theme:$('.template-card.selected')?.dataset.template||'afterglow', accent:colorInput.value, font:fontInput.value,customArtwork:customArtworkInput.checked,qrPosition:$('#qrPlacement')?.value||'center',cardText:cardTexts() } });
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
    setCardTexts(design.cardText||{});
    if($('#qrPlacement'))$('#qrPlacement').value=design.qrPosition||'center';
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
    for(const [id,path] of [['#qrOnlyPng','/qr'],['#qrOnlySvg','/qr.svg'],['#qrOnlyPdf','/qr.pdf']]){const link=$(id);if(link)link.href=`${endpoint}${path}`;}
    updatePreview();
    schedulePrintPreview();
    document.dispatchEvent(new CustomEvent('finalsnap:editor-ready',{detail:{title:titleInput.value,occasion:occasionInput.value}}));
  }

  /* ---------- Live-Vorschau der Druckdatei (mit echtem QR-Code) ---------- */
  let previewTimer=null,previewUrl='';
  async function renderPrintPreview(){
    if(!qrDataUrl)return null;
    try{const blob=await renderArtwork(getPrintData());if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(blob);const img=$('#printPreview');if(img)img.src=previewUrl;return previewUrl;}catch{return null;}
  }
  function schedulePrintPreview(){clearTimeout(previewTimer);previewTimer=setTimeout(renderPrintPreview,250);}
  ['#eventTitle','#cardKicker','#cardInvite','#cardBackKicker','#cardBackInvite','#accentColor'].forEach(sel=>$(sel)?.addEventListener('input',schedulePrintPreview));
  ['#fontStyle','#qrPlacement','#occasion','#customArtwork'].forEach(sel=>$(sel)?.addEventListener('change',schedulePrintPreview));
  document.querySelectorAll('.template-card,.format-card').forEach(b=>b.addEventListener('click',schedulePrintPreview));

  /* ---------- Schnittstelle für den Karten-Assistenten (card-studio.js) ---------- */
  window.fsEditor={
    endpoint,api,
    apply(s){
      if(s.title)titleInput.value=s.title;
      selectTheme(s.theme);
      if(/^#[0-9a-f]{6}$/i.test(s.accent||''))colorInput.value=s.accent;
      updateColorLabel();
      if(fonts[s.font])fontInput.value=s.font;
      if($('#qrPlacement')&&s.qrPosition)$('#qrPlacement').value=s.qrPosition;
      setCardTexts(s);
      updatePreview();
    },
    async save(){
      await api(`${endpoint}/design`,'PATCH',{design:{title:titleInput.value.trim()||'Unser Album',occasion:occasionInput.value,theme:$('.template-card.selected')?.dataset.template||'afterglow',accent:colorInput.value,font:fontInput.value,customArtwork:customArtworkInput.checked,qrPosition:$('#qrPlacement')?.value||'center',cardText:cardTexts()}});
      status.textContent='Design für dieses Event gespeichert.';
    },
    renderPreview:renderPrintPreview,
    get title(){return titleInput.value;},
    get occasion(){return occasionInput.value;}
  };

  updatePreview();
  loadEvent().catch(error=>{status.textContent=error.message;$('#qrFileStatus').textContent='Event-QR konnte nicht geladen werden.';$('#pdfButton').disabled=true;$('#pngButton').disabled=true;});
})();
