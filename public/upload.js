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
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const QUEUE_DB_NAME = 'finalsnap-offline-uploads';
  const QUEUE_DB_VERSION = 1;
  const QUEUE_STORE = 'uploads';
  const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const memoryQueue = new Map();
  let queuePersistenceAvailable = true;
  let uploadBusy = false;
  const queueDbPromise = openQueueDatabase().catch(() => {
    queuePersistenceAvailable = false;
    return null;
  });
  const queueReady = queueDbPromise.then(() => removeExpiredQueueItems()).catch(() => {});

  cameraTrigger.addEventListener('click', () => cameraInput.click());
  cameraInput.addEventListener('change', () => cameraInput.files.length ? uploadFiles(Array.from(cameraInput.files)) : undefined);
  uploadTrigger.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => fileInput.files?.length ? uploadFiles(Array.from(fileInput.files)) : undefined);

  window.addEventListener('online', () => { void resumeQueuedUploads(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void resumeQueuedUploads();
  });
  void queueReady.then(() => resumeQueuedUploads());

  async function uploadFiles(files) {
    if (!files.length) return;
    if (files.some(file => file.size > MAX_FILE_BYTES)) {
      setStatus('Ein Foto ist größer als 50 MB. Bitte wähle eine kleinere Datei aus.', 'error');
      return;
    }
    await queueReady;
    while (uploadBusy) await new Promise(resolve => setTimeout(resolve, 50));
    if (uploadBusy) return;
    uploadBusy = true;
    uploadTrigger.disabled = true;
    cameraTrigger.disabled = true;
    showProgress(true);
    try {
      await removeExpiredQueueItems();
      for (let index = 0; index < files.length; index++) {
        const originalFile = files[index];
        setStatus(`${index} von ${files.length} Fotos vorbereitet · Foto ${index + 1} von ${files.length} wird vorbereitet …`, 'loading');
        // Keep the upload byte-for-byte original; derivatives are generated server-side.
        const file = originalFile;
        await storeQueueItem({
          id: crypto.randomUUID(),
          eventId,
          file,
          createdAt: Date.now(),
        });
      }
      await transmitQueuedUploads();
    } catch (_) {
      setStatus('Deine Fotos konnten nicht für den späteren Versand gespeichert werden. Bitte lass diese Seite geöffnet und versuche es erneut.', 'error');
    } finally {
      showProgress(false);
      uploadBusy = false;
      uploadTrigger.disabled = false;
      cameraTrigger.disabled = false;
      fileInput.value = '';
      cameraInput.value = '';
    }
  }

  async function resumeQueuedUploads() {
    if (uploadBusy) return;
    uploadBusy = true;
    try {
      await removeExpiredQueueItems();
      const queued = await getQueueItems(eventId);
      if (!queued.length) return;
      if (navigator.onLine === false) {
        showWaitingForConnection(queued.length);
        return;
      }
      uploadTrigger.disabled = true;
      cameraTrigger.disabled = true;
      showProgress(true);
      await transmitQueuedUploads();
    } catch (_) {
      setStatus('Die gespeicherten Fotos konnten nicht abgerufen werden. Bitte lass diese Seite geöffnet.', 'notice');
    } finally {
      if (uploadBusy) {
        showProgress(false);
        uploadBusy = false;
        uploadTrigger.disabled = false;
        cameraTrigger.disabled = false;
      }
    }
  }

  async function transmitQueuedUploads() {
    const items = await getQueueItems(eventId);
    if (!items.length) return;
    if (navigator.onLine === false) {
      showWaitingForConnection(items.length);
      return;
    }
    let uploaded = 0;
    let failed = 0;
    let waiting = false;
    let quotaMessage = '';
    let firstFailure = '';

    for (let index = 0; index < items.length; index++) {
      if (navigator.onLine === false) { waiting = true; break; }
      const item = items[index];
      setProgress(0);
      setStatus(`${uploaded} von ${items.length} Fotos hochgeladen · Foto ${index + 1} von ${items.length} wird gesendet …`, 'loading');
      const result = await sendWithRetry(item.file, item.id, percent => setProgress(percent), retryResult => {
        setProgress(0);
        const waitMessage = retryResult.status === 429
          ? 'Viele Gäste laden gerade hoch – dein Foto ist in der Warteschlange.'
          : retryResult.status === 503
            ? 'Der Upload ist gerade ausgelastet – dein Foto bleibt gespeichert.'
            : 'Verbindung kurz unterbrochen – dein Foto bleibt gespeichert.';
        setStatus(`${uploaded} von ${items.length} Fotos hochgeladen · ${waitMessage}`, 'loading');
      });
      if (result.status >= 200 && result.status < 300) {
        await removeQueueItem(item.id);
        uploaded++;
        showLocalPreview([item.file]);
        setProgress(100);
        continue;
      }

      const message = responseMessage(result.body);
      if (result.status === 0 || RETRY_STATUS.has(result.status)) {
        waiting = true;
        firstFailure = message;
        break;
      }

      await removeQueueItem(item.id);
      failed++;
      firstFailure ||= message;
      if (message.startsWith('Die 25 kostenlosen')) {
        quotaMessage = message;
        break;
      }
    }

    if (uploaded) window.refreshEventQuota?.().catch(() => {});
    const pending = await getQueueItems(eventId);
    if (waiting || (pending.length && quotaMessage)) {
      showWaitingForConnection(pending.length);
      if (quotaMessage) setStatus(`${quotaMessage} ${pending.length} weitere Fotos bleiben gespeichert.`, 'notice');
      return;
    }
    if (failed) {
      setStatus(`${uploaded} Fotos hochgeladen, ${failed} konnten nicht hochgeladen werden: ${firstFailure}`, 'notice');
      return;
    }
    if (uploaded) setStatus(`✓ ${uploaded} ${uploaded === 1 ? 'Foto wurde' : 'Fotos wurden'} hochgeladen.`, 'success');
  }

  function showWaitingForConnection(count) {
    const storageNote = queuePersistenceAvailable ? '' : ' Diese Warteschlange bleibt nur erhalten, solange die Seite geöffnet ist.';
    setStatus(`📶 ${count} ${count === 1 ? 'Foto wartet' : 'Fotos warten'} auf Empfang – sie werden automatisch hochgeladen. Lass die Seite kurz offen, sobald du wieder Empfang hast.${storageNote}`, 'notice');
  }

  function openQueueDatabase() {
    const indexedDBApi = window.indexedDB || globalThis.indexedDB;
    if (!indexedDBApi) return Promise.reject(new Error('IndexedDB ist nicht verfügbar.'));
    return new Promise((resolve, reject) => {
      const request = indexedDBApi.open(QUEUE_DB_NAME, QUEUE_DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(QUEUE_STORE)) request.result.createObjectStore(QUEUE_STORE, {keyPath: 'id'});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB konnte nicht geöffnet werden.'));
    });
  }

  async function queueTransaction(mode, run) {
    const db = await queueDbPromise;
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(QUEUE_STORE, mode);
      const request = run(transaction.objectStore(QUEUE_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB-Anfrage fehlgeschlagen.'));
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB-Transaktion fehlgeschlagen.'));
    });
  }

  async function storeQueueItem(item) {
    memoryQueue.set(item.id, item);
    try {
      const result = await queueTransaction('readwrite', store => store.put(item));
      if (result !== null) memoryQueue.delete(item.id);
    } catch (_) {
      queuePersistenceAvailable = false;
    }
  }

  async function getQueueItems(forEventId) {
    let items;
    try {
      const result = await queueTransaction('readonly', store => store.getAll());
      items = result === null ? Array.from(memoryQueue.values()) : result;
    } catch (_) {
      queuePersistenceAvailable = false;
      items = Array.from(memoryQueue.values());
    }
    return items.filter(item => item.eventId === forEventId).sort((a, b) => a.createdAt - b.createdAt);
  }

  async function removeQueueItem(id) {
    memoryQueue.delete(id);
    try { await queueTransaction('readwrite', store => store.delete(id)); }
    catch (_) { queuePersistenceAvailable = false; }
  }

  async function removeExpiredQueueItems() {
    let items;
    try {
      const result = await queueTransaction('readonly', store => store.getAll());
      items = result === null ? Array.from(memoryQueue.values()) : result;
    } catch (_) {
      queuePersistenceAvailable = false;
      items = Array.from(memoryQueue.values());
    }
    const cutoff = Date.now() - MAX_QUEUE_AGE_MS;
    for (const item of items) if (item.createdAt < cutoff) await removeQueueItem(item.id);
  }

  async function sendWithRetry(file, requestId, onProgress, onWaiting) {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      const result = await sendOnce(file, requestId, onProgress);
      if (navigator.onLine === false && result.status === 0) return result;
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
      xhr.setRequestHeader('X-Upload-Id', requestId);
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
