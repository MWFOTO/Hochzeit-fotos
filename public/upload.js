/**
 * Mobile guest photo uploader. Sends one photo at a time and retries transient
 * network/server failures with a stable idempotency key for each photo.
 */
(function () {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const eventId = pathParts[1] || 'default';
  const uploadTrigger = document.getElementById('upload-trigger');
  const fileInput = document.getElementById('file-input');
  const cameraInput = document.getElementById('camera-input');
  const cameraTrigger = document.getElementById('camera-trigger');
  const statusEl = document.getElementById('status');
  const progressWrap = document.getElementById('progress-wrap');
  const progressBar = document.getElementById('progress-bar');
  const thumbsEl = document.getElementById('thumbs');
  const RETRY_STATUS = new Set([429, 503]);
  const MAX_RETRY_MS = 3 * 60 * 1000;
  const MAX_IMAGE_EDGE = 2560;
  const SMALL_FILE_BYTES = 1.5 * 1024 * 1024;

  cameraTrigger.addEventListener('click', () => cameraInput.click());
  cameraInput.addEventListener('change', () => cameraInput.files.length ? uploadFiles(Array.from(cameraInput.files)) : undefined);
  uploadTrigger.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => fileInput.files?.length ? uploadFiles(Array.from(fileInput.files)) : undefined);

  async function uploadFiles(files) {
    if (!files.length) return;
    uploadTrigger.disabled = true;
    cameraTrigger.disabled = true;
    showProgress(true);
    let succeeded = 0;
    const failures = [];
    const retryableFailures = [];
    try {
      for (let index = 0; index < files.length; index++) {
        const originalFile = files[index];
        setStatus(`${succeeded} von ${files.length} Fotos hochgeladen · Foto ${index + 1} von ${files.length} wird vorbereitet …`, 'loading');
        // Only one bitmap/canvas is held at a time, which keeps older phones responsive.
        const file = await prepareUploadFile(originalFile);
        setProgress(0);
        setStatus(`${succeeded} von ${files.length} Fotos hochgeladen · Foto ${index + 1} von ${files.length} wird hochgeladen …`, 'loading');
        const result = await sendWithRetry(file, percent => setProgress(percent), retryResult => {
          setProgress(0);
          const waitMessage = retryResult.status === 429
            ? 'Viele Gäste laden gerade hoch – dein Foto ist in der Warteschlange.'
            : retryResult.status === 503
              ? 'Der Upload ist gerade ausgelastet – dein Foto bleibt ausgewählt. Wir versuchen es erneut.'
              : 'Verbindung kurz unterbrochen – wir versuchen es erneut.';
          setStatus(`${succeeded} von ${files.length} Fotos hochgeladen · Foto ${index + 1} von ${files.length}: ${waitMessage}`, 'loading');
        });
        if (result.status >= 200 && result.status < 300) {
          succeeded++;
          showLocalPreview([originalFile]);
          setProgress(100);
          setStatus(`${succeeded} von ${files.length} Fotos hochgeladen`, 'loading');
          continue;
        }
        const message = responseMessage(result.body);
        failures.push(message);
        if (result.status === 0 || RETRY_STATUS.has(result.status)) retryableFailures.push(originalFile);
        if (message.startsWith('Die 25 kostenlosen')) break;
      }
      if (succeeded) window.refreshEventQuota?.().catch(() => {});
      if (!failures.length) setStatus(`✓ ${succeeded === 1 ? 'Dein Foto wurde hochgeladen.' : `${succeeded} Fotos wurden hochgeladen.`}`, 'success');
      else if (succeeded) {
        setStatus(`✓ ${succeeded} von ${files.length} Fotos hochgeladen. ${failures.length} Foto${failures.length === 1 ? '' : 's'} konnten nicht hochgeladen werden: ${failures[0]}`, 'notice');
      }
      else setStatus('✗ ' + failures[0], failures[0].startsWith('Die 25 kostenlosen') ? 'notice' : 'error');
      if (retryableFailures.length) addRetryButton(retryableFailures);
    } catch (_) {
      setStatus('✗ Verbindung fehlgeschlagen. Bitte erneut versuchen.', 'error');
    } finally {
      showProgress(false);
      uploadTrigger.disabled = false;
      cameraTrigger.disabled = false;
      fileInput.value = '';
      cameraInput.value = '';
    }
  }

  async function prepareUploadFile(file) {
    if (typeof createImageBitmap !== 'function') return file;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, {imageOrientation: 'from-image'});
      const width = bitmap.width;
      const height = bitmap.height;
      if (!width || !height) return file;
      if (width <= MAX_IMAGE_EDGE && height <= MAX_IMAGE_EDGE && file.size < SMALL_FILE_BYTES) return file;

      const scale = Math.min(1, MAX_IMAGE_EDGE / width, MAX_IMAGE_EDGE / height);
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      let canvas;
      let blob;
      if (typeof OffscreenCanvas === 'function') {
        canvas = new OffscreenCanvas(targetWidth, targetHeight);
        const context = canvas.getContext('2d');
        if (!context) return file;
        context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
        blob = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.9});
      } else {
        canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d');
        if (!context) return file;
        context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
        blob = await new Promise((resolve, reject) => {
          canvas.toBlob(result => result ? resolve(result) : reject(new Error('JPEG-Konvertierung fehlgeschlagen.')), 'image/jpeg', 0.9);
        });
      }
      if (!blob || blob.type !== 'image/jpeg') return file;
      const filename = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], filename, {type: 'image/jpeg', lastModified: file.lastModified});
    } catch (_) {
      // Unsupported formats (including some HEIF variants) are sent unchanged.
      return file;
    } finally {
      bitmap?.close?.();
    }
  }

  function addRetryButton(files) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button secondary';
    button.textContent = 'Fehlgeschlagene Fotos erneut versuchen';
    button.addEventListener('click', () => {
      button.remove();
      uploadFiles(files);
    }, {once: true});
    statusEl.appendChild(document.createTextNode(' '));
    statusEl.appendChild(button);
  }

  async function sendWithRetry(file, onProgress, onWaiting) {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    for (let attempt = 0; ; attempt++) {
      const result = await sendOnce(file, requestId, onProgress);
      if (!(result.status === 0 || RETRY_STATUS.has(result.status)) || Date.now() - started >= MAX_RETRY_MS) return result;
      onWaiting(result);
      const base = Math.min(10000, 2000 * (2 ** Math.min(attempt, 10)));
      const hinted = result.retryAfter ? Math.min(10000, result.retryAfter * 1000) : base;
      const delay = Math.min(MAX_RETRY_MS - (Date.now() - started), hinted * (0.7 + Math.random() * 0.6));
      if (delay <= 0) return result;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  function sendOnce(file, requestId, onProgress) {
    return new Promise(resolve => {
      const formData = new FormData();
      formData.append('photos', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/event/${encodeURIComponent(eventId)}/upload`);
      xhr.setRequestHeader('X-FinalSnap-Upload-Id', requestId);
      xhr.upload.addEventListener('progress', event => {
        if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
      });
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText, retryAfter: Number(xhr.getResponseHeader('Retry-After')) || 0 });
      xhr.onerror = () => resolve({ status: 0, body: '', retryAfter: 0 });
      xhr.ontimeout = () => resolve({ status: 0, body: '', retryAfter: 0 });
      xhr.send(formData);
    });
  }

  function responseMessage(body) {
    try { return JSON.parse(body).error || 'Beim Hochladen ist ein Fehler aufgetreten.'; }
    catch (_) { return 'Beim Hochladen ist ein Fehler aufgetreten.'; }
  }

  function setStatus(text, type) { statusEl.textContent = text; statusEl.className = 'status ' + (type || ''); }
  function showProgress(active) { progressWrap.classList.toggle('active', !!active); }
  function setProgress(percent) { progressBar.style.width = percent + '%'; }

  function showLocalPreview(files) {
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = event => { const img = document.createElement('img'); img.src = event.target.result; thumbsEl.prepend(img); };
      reader.readAsDataURL(file);
    }
  }
})();
