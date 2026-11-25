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

function runUploader({files, responses, decode = async () => ({width: 4000, height: 3000, close() {}})}) {
  const ids = [];
  const requests = [];
  const createdCanvases = [];
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
    window: {location: {pathname: '/event/demo'}},
    document: {getElementById: id => controls[id], createElement: () => element()},
    XMLHttpRequest: FakeXHR,
    FormData,
    Blob,
    File,
    OffscreenCanvas: FakeOffscreenCanvas,
    crypto: {randomUUID: () => { const id = `upload-${ids.length}`; ids.push(id); return id; }},
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
  return {controls, requests, createdCanvases, ids, get maxActiveDecodes() { return maxActiveDecodes; }};
}

test('shrinks selected photos and uploads more than ten individually in sequence', async () => {
  const files = Array.from({length: 30}, (_, index) => new File([new Uint8Array(8 * 1024 * 1024)], `photo-${index}.heic`, {type: 'image/heic'}));
  const responses = [
    {status: 429, body: JSON.stringify({error: 'busy'})},
    ...Array.from({length: 30}, () => ({status: 200, body: JSON.stringify({success: true, count: 1})})),
  ];
  const app = runUploader({files, responses});

  await app.controls['file-input'].listeners.change();

  assert.equal(app.requests.length, 31);
  assert.ok(app.requests.every(request => request.method === 'POST' && request.url.endsWith('/api/event/demo/upload')));
  assert.ok(app.requests.every(request => request.file.type === 'image/jpeg' && request.file.size < 1.5 * 1024 * 1024));
  assert.ok(app.requests.every(request => request.file.name.endsWith('.jpg')));
  assert.equal(app.createdCanvases[0].width, 2560);
  assert.equal(app.createdCanvases[0].height, 1920);
  assert.equal(app.createdCanvases[0].options.quality, 0.9);
  assert.equal(app.maxActiveDecodes, 1);
  assert.equal(app.requests[0].headers['X-FinalSnap-Upload-Id'], app.requests[1].headers['X-FinalSnap-Upload-Id']);
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
