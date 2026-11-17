'use strict';

const maxSeconds = 30;
const maxBytes = 50 * 1024 * 1024;
const preview = document.getElementById('preview');
const status = document.getElementById('status');
const camera = document.getElementById('camera');
const record = document.getElementById('record');
const stop = document.getElementById('stop');
const reset = document.getElementById('reset');
const file = document.getElementById('file');
const fileLabel = document.getElementById('file-label');
const send = document.getElementById('send');
const eventId = encodeURIComponent(location.pathname.split('/')[2]);
document.getElementById('back').href = window.guestUrl(`/event/${eventId}/upload`);
let selectedClip;
let stream;
let recorder;
let timer;
let clipUrl;
let revision = 0;

function releaseCamera() {
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  preview.srcObject = null;
}

function clearClip() {
  if (clipUrl) URL.revokeObjectURL(clipUrl);
  clipUrl = null;
  preview.removeAttribute('src');
  preview.load();
  send.hidden = true;
  selectedClip = null;
}

function clearPreview(message) {
  revision += 1;
  clearInterval(timer);
  if (recorder?.state === 'recording') recorder.stop();
  recorder = null;
  releaseCamera();
  clearClip();
  preview.hidden = true;
  record.hidden = stop.hidden = reset.hidden = true;
  camera.hidden = fileLabel.hidden = false;
  camera.disabled = false;
  status.textContent = message;
}

function showClip(blob, name, checkDuration) {
  releaseCamera();
  clearClip();
  if (!blob.size || blob.size > maxBytes) {
    clearPreview('Bitte wähle ein Video mit höchstens 50 MB.');
    return;
  }
  clipUrl = URL.createObjectURL(blob);
  preview.hidden = false;
  preview.muted = false;
  preview.controls = true;
  record.hidden = stop.hidden = true;
  camera.hidden = true;
  reset.hidden = false;
  status.textContent = 'Vorschau wird geladen …';
  const current = ++revision;
  preview.onloadedmetadata = () => {
    if (current !== revision) return;
    if (checkDuration && (!Number.isFinite(preview.duration) || preview.duration > maxSeconds)) {
      clearPreview('Bitte wähle ein Video von höchstens 30 Sekunden.');
      return;
    }
    selectedClip = { blob, name };
    send.hidden = false;
    status.textContent = 'Schau dir deinen Gruß an. Wenn er passt, schick ihn ab.';
  };
  preview.onerror = () => {
    if (current === revision) clearPreview('Dieses Video lässt sich im Browser nicht abspielen. Versuche es mit einer anderen Datei.');
  };
  preview.src = clipUrl;
}

camera.addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    status.textContent = 'Die Aufnahme ist hier nicht verfügbar. Du kannst ein Video auswählen.';
    return;
  }
  const current = ++revision;
  camera.disabled = true;
  status.textContent = 'Erlaube der Kamera und dem Mikrofon den Zugriff.';
  try {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: 'user', width: { ideal: 720 }, frameRate: { max: 30 } },
    });
    if (current !== revision) {
      media.getTracks().forEach(track => track.stop());
      return;
    }
    stream = media;
    preview.controls = false;
    preview.muted = true;
    preview.hidden = false;
    preview.srcObject = stream;
    await preview.play();
    if (current !== revision) return;
    camera.hidden = true;
    record.hidden = reset.hidden = false;
    status.textContent = 'Kamera bereit. Starte, wenn du so weit bist.';
  } catch {
    if (current === revision) clearPreview('Kamera oder Mikrofon sind nicht verfügbar. Du kannst ein Video auswählen.');
  }
});

record.addEventListener('click', () => {
  const current = revision;
  const chunks = [];
  try {
    const mimeType = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), videoBitsPerSecond: 2_000_000 });
    const capture = recorder;
    capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    capture.onerror = () => {
      if (current === revision) clearPreview('Die Aufnahme ist fehlgeschlagen. Versuche es erneut oder wähle ein Video.');
    };
    capture.onstop = () => {
      if (current !== revision) return;
      clearInterval(timer);
      const type = capture.mimeType || chunks[0]?.type || 'video/webm';
      const extension = type.startsWith('video/mp4') ? 'mp4' : 'webm';
      showClip(new Blob(chunks, { type }), 'finalsnap-videogruss.' + extension, false);
    };
    capture.start();
    record.hidden = fileLabel.hidden = reset.hidden = true;
    stop.hidden = false;
    const until = performance.now() + maxSeconds * 1000;
    status.textContent = 'Aufnahme läuft · noch 30 Sekunden';
    timer = setInterval(() => {
      const remaining = Math.ceil((until - performance.now()) / 1000);
      if (remaining <= 0) stop.click();
      else status.textContent = 'Aufnahme läuft · noch ' + remaining + ' Sekunden';
    }, 200);
  } catch {
    clearPreview('Die Aufnahme konnte nicht gestartet werden. Du kannst ein Video auswählen.');
  }
});

stop.addEventListener('click', () => {
  clearInterval(timer);
  stop.hidden = true;
  status.textContent = 'Aufnahme wird vorbereitet …';
  if (recorder?.state === 'recording') recorder.stop();
});

reset.addEventListener('click', () => clearPreview('Du kannst einen neuen Gruß aufnehmen oder ein Video auswählen.'));
fileLabel.addEventListener('click', () => file.click());
file.addEventListener('change', () => {
  const clip = file.files[0];
  file.value = '';
  if (!clip) return;
  clearPreview('');
  showClip(clip, clip.name, true);
});
window.addEventListener('pagehide', () => clearPreview(''));

send.addEventListener('click', async () => {
  if (!selectedClip || send.disabled) return;
  send.disabled = reset.disabled = file.disabled = true;
  fileLabel.hidden = true;
  const form = new FormData();
  form.append('video', selectedClip.blob, selectedClip.name);
  status.textContent = 'Dein Videogruß wird hochgeladen und verarbeitet …';
  try {
    const response = await fetch(`/api/event/${eventId}/video-greetings`, { method: 'POST', body: form });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw Error(result?.error || 'Upload fehlgeschlagen. Bitte versuche es erneut.');
    clearPreview('Dein Videogruß ist angekommen. Danke!');
    camera.hidden = fileLabel.hidden = true;
  } catch (error) {
    status.textContent = error.message || 'Upload fehlgeschlagen. Bitte versuche es erneut.';
    fileLabel.hidden = false;
  } finally {
    send.disabled = reset.disabled = file.disabled = false;
  }
});
