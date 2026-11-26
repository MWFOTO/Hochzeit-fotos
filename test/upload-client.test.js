const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {File} = require('node:buffer');

const script = fs.readFileSync(path.join(__dirname, '../public/upload.js'), 'utf8');

function element() {
  const listeners = {};
  return {
    disabled: false,
    value: '',
    files: [],
    textContent: '',
    className: '',
    style: {},
    classList: {toggle() {}},
    addEventListener(name, callback) { listeners[name] = callback; },
    click() {},
    appendChild() {},
    prepend() {},
    remove() {},
    listeners,
  };
}

function createFakeIndexedDB() {
  const values = new Map();
  const store = {
    put(value) { return request(() => { values.set(value.id, value); return value.id; }); },
    getAll() { return request(() => Array.from(values.values())); },
    delete(id) { return request(() => values.delete(id)); },
  };
  function request(run) {
    const req = {};
    queueMicrotask(() => { req.result = run(); req.onsuccess?.(); });
    return req;
  }
  const db = {
    objectStoreNames: {contains: () => true},
    createObjectStore() {},
    transaction: () => ({objectStore: () => store}),
  };
  return {open() {
    const req = {result: db};
    queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
    return req;
  }, values};
}

function runUploader({files = [], responses, decode = async () => ({width: 4000, height: 3000, close() {}}), indexedDB = createFakeIndexedDB(), online = true}) {
  const ids = [];
  const requests = [];
  const createdCanvases = [];
  const windowListeners = {};
  const documentListeners = {};
  let activeDecodes = 0;
  let maxActiveDecodes = 0;
  const controls = Object.fromEntries(['upload-trigger', 'file-input', 'camera-input', 'camera-trigger', 'status', 'progress-wrap', 'progress-bar', 'thumbs'].map(id => [id, element()]));
  controls['file-input'].files = files;

  class FakeXHR {
    constructor() {
      this.upload = {addEventListener: (name, callback) => { this.onProgress = callback; }};
      this.headers = {};
    }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(name, value) { this.headers[name] = value; }
    getResponseHeader() { return null; }
    send(data) {
      const file = data.get('photos');
      requests.push({method: this.method, url: this.url, file, headers: this.headers});
      const response = responses.shift();
      assert.ok(response, 'unexpected additional upload request');
      queueMicrotask(() => {
        if (response.setOffline) context.navigator.onLine = false;
        if (response.status === 0) return this.onerror();
        this.status = response.status;
        this.responseText = response.body || '';
        this.onProgress?.({lengthComputable: true, loaded: file.size, total: file.size});
        this.onload();
      });
    }
  }

  class FakeOffscreenCanvas {
    constructor(width, height) { this.width = width; this.height = height; createdCanvases.push(this); }
    getContext() { return {drawImage() {}}; }
    async convertToBlob(options) {
      this.options = options;
      return new Blob([new Uint8Array(800 * 1024)], {type: 'image/jpeg'});
    }
  }

  const context = {
    window: {location: {pathname: '/event/demo'}, addEventListener: (name, callback) => { windowListeners[name] = callback; }, indexedDB},
    document: {getElementById: id => controls[id], createElement: () => element(), addEventListener: (name, callback) => { documentListeners[name] = callback; }, hidden: false},
    XMLHttpRequest: FakeXHR,
    FormData,
    Blob,
    File,
    OffscreenCanvas: FakeOffscreenCanvas,
    crypto: {randomUUID: () => { const id = `upload-${ids.length}`; ids.push(id); return id; }},
    navigator: {onLine: online},
    setTimeout: callback => { queueMicrotask(callback); return 1; },
    clearTimeout() {},
    FileReader: class { readAsDataURL() { this.onload?.({target: {result: 'data:image/jpeg;base64,'}}); } },
    createImageBitmap: async (...args) => {
      activeDecodes++;
      maxActiveDecodes = Math.max(maxActiveDecodes, activeDecodes);
      try { return await decode(...args); }
      finally { activeDecodes--; }
    },
    console,
  };
  vm.runInNewContext(script, context);
  return {
    controls, requests, createdCanvases, ids, indexedDB, windowListeners, documentListeners,
    setOnline(value) { context.navigator.onLine = value; },
    get maxActiveDecodes() { return maxActiveDecodes; },
  };
}

test('preserves original photos and uploads more than ten individually in sequence', async () => {
  const files = Array.from({length: 30}, (_, index) => new File([new Uint8Array(8 * 1024 * 1024)], `photo-${index}.heic`, {type: 'image/heic'}));
  const responses = [
    {status: 429, body: JSON.stringify({error: 'busy'})},
    ...Array.from({length: 30}, () => ({status: 200, body: JSON.stringify({success: true, count: 1})})),
  ];
  const app = runUploader({files, responses});

  await app.controls['file-input'].listeners.change();

  assert.equal(app.requests.length, 31);
  assert.ok(app.requests.every(request => request.method === 'POST' && request.url.endsWith('/api/event/demo/upload')));
  assert.ok(app.requests.every(request => request.file.type === 'image/heic' && request.file.size === 8 * 1024 * 1024));
  assert.ok(app.requests.every(request => /^photo-\d+\.heic$/.test(request.file.name)));
  assert.equal(new Set(app.requests.map(request=>request.file.name)).size,30);
  assert.equal(app.createdCanvases.length, 0);
  assert.equal(app.maxActiveDecodes, 0);
  assert.equal(app.requests[0].headers['X-Upload-Id'], app.requests[1].headers['X-Upload-Id']);
  assert.equal(app.controls.status.textContent, '✓ 30 Fotos wurden hochgeladen.');
});

test('sends an image unchanged when browser decoding fails', async () => {
  const original = new File([new Uint8Array(128)], 'broken.heic', {type: 'image/heic'});
  const app = runUploader({
    files: [original],
    responses: [{status: 200, body: JSON.stringify({success: true, count: 1})}],
    decode: async () => { throw new Error('unsupported image format'); },
  });

  await app.controls['file-input'].listeners.change();

  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].file.name, original.name);
  assert.equal(app.requests[0].file.type, original.type);
  assert.equal(app.requests[0].file.size, original.size);
});

test('keeps photos through an offline interruption and resumes the same IDs after reload', async () => {
  const files = Array.from({length: 3}, (_, index) => new File([new Uint8Array([index + 1])], `photo-${index}.jpg`, {type: 'image/jpeg'}));
  const indexedDB = createFakeIndexedDB();
  const firstPage = runUploader({files, indexedDB, responses: [{status: 0, setOffline: true}]});

  await firstPage.controls['file-input'].listeners.change();

  assert.equal(indexedDB.values.size, 3);
  assert.match(firstPage.controls.status.textContent, /3 Fotos warten auf Empfang/);
  const originalIds = Array.from(indexedDB.values.values()).map(item => item.id);
  const serverAccepted = new Set([originalIds[0]]); // The response for photo one was lost after server acceptance.

  const nextPage = runUploader({
    indexedDB,
    responses: Array.from({length: 3}, () => ({status: 200, body: JSON.stringify({success: true, count: 1})})),
  });
  for (let attempt = 0; attempt < 100 && indexedDB.values.size; attempt++) await new Promise(resolve => setImmediate(resolve));

  assert.equal(nextPage.requests.length, 3);
  assert.deepEqual(nextPage.requests.map(request => request.headers['X-Upload-Id']), originalIds);
  assert.equal(new Set(nextPage.requests.map(request => request.headers['X-Upload-Id'])).size, 3);
  for (const request of nextPage.requests) serverAccepted.add(request.headers['X-Upload-Id']);
  assert.equal(serverAccepted.size, 3);
  assert.equal(indexedDB.values.size, 0);
  assert.match(nextPage.controls.status.textContent, /3 Fotos wurden hochgeladen/);
});

test('resumes the saved queue when the browser reports a connection again', async () => {
  const indexedDB = createFakeIndexedDB();
  const app = runUploader({
    files: [new File([new Uint8Array([7])], 'photo.jpg', {type: 'image/jpeg'})],
    indexedDB,
    responses: [
      {status: 0, setOffline: true},
      {status: 200, body: JSON.stringify({success: true, count: 1})},
    ],
  });
  await app.controls['file-input'].listeners.change();
  app.setOnline(true);
  app.windowListeners.online();
  for (let attempt = 0; attempt < 100 && indexedDB.values.size; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[0].headers['X-Upload-Id'], app.requests[1].headers['X-Upload-Id']);
  assert.equal(indexedDB.values.size, 0);
});

test('removes saved photos that have been queued for more than seven days', async () => {
  const indexedDB = createFakeIndexedDB();
  indexedDB.values.set('old-item', {
    id: 'old-item', eventId: 'demo', file: new File([new Uint8Array([1])], 'old.jpg'),
    createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
  });
  const app = runUploader({indexedDB, responses: []});
  for (let attempt = 0; attempt < 100 && indexedDB.values.size; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(indexedDB.values.size, 0);
  assert.equal(app.requests.length, 0);
});
