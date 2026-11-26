#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');
const sharp = require('sharp');
const {createApp} = require('../server');

const MiB = 1024 ** 2;
const PHOTO_BYTES_REFERENCE = 8.85 * MiB;
const REFERENCE_EDGE = 2200;
const MAX_FILES_PER_REQUEST = 10;

function parseArgs(argv) {
  const options = {guests: 20, photos: 200, minMb: 3, maxMb: 8, durationMinutes: null, all: false};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--all') options.all = true;
    else if (['--guests', '--photos', '--min-mb', '--max-mb', '--duration-minutes'].includes(arg)) {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`Ungültiger Wert für ${arg}.`);
      if (arg === '--guests') options.guests = Math.floor(value);
      if (arg === '--photos') options.photos = Math.floor(value);
      if (arg === '--min-mb') options.minMb = value;
      if (arg === '--max-mb') options.maxMb = value;
      if (arg === '--duration-minutes') options.durationMinutes = value;
    } else throw new Error(`Unbekannte Option: ${arg}`);
  }
  if (options.guests < 1 || options.photos < 1 || options.maxMb <= options.minMb) throw new Error('Gäste/Fotos müssen positiv sein und --max-mb größer als --min-mb.');
  if (options.photos > 2000 && !options.all) throw new Error('Einzelne Läufe sind auf 2.000 Fotos begrenzt.');
  return options;
}

function showHelp() {
  console.log(`FinalSnap lokaler Album-Lasttest

Aufruf:
  node scripts/load-test.js --guests 20 --photos 200
  node scripts/load-test.js --all

Optionen:
  --guests N            Simulierte Gäste (jeweils eigenes Gästecookie)
  --photos N            Anzahl der zu erzeugenden und hochzuladenden JPGs
  --min-mb N            Mindestgröße je JPG, Standard: 3
  --max-mb N            Höchstgröße je JPG, Standard: 8
  --duration-minutes N  Dauer der Upload-Ankunftsverteilung; Standard proportional
                        zu 30 Minuten für 2.000 Fotos
  --all                 Klein (20/200), mittel (80/800), groß (150/2.000)

Das Skript startet nur einen lokalen Server mit eigener SQLite-Testdatenbank und
lokalem Fotospeicher. Es sendet keine Anfragen an Render oder finalsnap.de.`);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const randomHex = bytes => crypto.randomBytes(bytes).toString('hex');
const pctl = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};
const mb = bytes => Number((bytes / MiB).toFixed(2));

async function directorySize(directory) {
  let total = 0;
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = await fsp.readdir(current, {withFileTypes: true}); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) {
        try { total += (await fsp.stat(fullPath)).size; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }
  return total;
}

async function createRandomJpeg(filename, minMb, maxMb) {
  const safeMin = Math.ceil(minMb * MiB);
  const safeMax = Math.floor(maxMb * MiB);
  const target = (minMb + 0.35 + Math.random() * Math.max(0.2, maxMb - minMb - 0.7)) * MiB;
  let edge = Math.max(900, Math.round(REFERENCE_EDGE * Math.sqrt(target / PHOTO_BYTES_REFERENCE)));
  let actual;
  for (let attempt = 0; attempt < 6; attempt++) {
    const raw = crypto.randomBytes(edge * edge * 3);
    const result = await sharp(raw, {raw: {width: edge, height: edge, channels: 3}})
      .jpeg({quality: 94, chromaSubsampling: '4:4:4'})
      .toFile(filename);
    actual = result.size;
    if (actual >= safeMin && actual <= safeMax) return actual;
    const correction = Math.sqrt(target / Math.max(1, actual));
    edge = Math.max(900, Math.min(5000, Math.round(edge * correction)));
  }
  await fsp.rm(filename, {force: true});
  throw new Error(`Sharp konnte die Zielgröße nicht treffen: ${filename} (${mb(actual || 0)} MB, erlaubt ${minMb}–${maxMb} MB).`);
}

async function createInputs(inputDirectory, photos, minMb, maxMb, progress) {
  await fsp.mkdir(inputDirectory, {recursive: true});
  const files = [];
  let bytes = 0;
  for (let i = 0; i < photos; i++) {
    const filename = path.join(inputDirectory, `photo-${String(i + 1).padStart(5, '0')}.jpg`);
    bytes += await createRandomJpeg(filename, minMb, maxMb);
    files.push(filename);
    if ((i + 1) % 50 === 0 || i + 1 === photos) progress(`Erzeugt: ${i + 1}/${photos} JPGs (${mb(bytes)} MB).`);
  }
  return {files, bytes};
}

async function readResponse(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return {message: text.slice(0, 500)}; }
}

async function runScenario(input, scenarioName) {
  const started = Date.now();
  const durationMs = (input.durationMinutes ?? 30 * input.photos / 2000) * 60_000;
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'finalsnap-loadtest-'));
  const inputDirectory = path.join(tempRoot, 'input');
  const uploadDirectory = path.join(tempRoot, 'uploads');
  const databasePath = path.join(tempRoot, 'loadtest.sqlite');
  const zipPath = path.join(tempRoot, 'album.zip');
  await fsp.mkdir(uploadDirectory, {recursive: true});

  const serverErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    const line = args.map(value => value instanceof Error ? value.stack || value.message : String(value)).join(' ');
    serverErrors.push(line);
    originalConsoleError(...args);
  };

  let app;
  let server;
  let sampler;
  let sizeSampler;
  let sampleBusy = false;
  let maxRss = process.memoryUsage().rss;
  let measuringZip = false;
  let zipPeakRssBytes = maxRss;
  let maxUploadDirBytes = 0;
  let maxTempDirBytes = 0;
  let uploadDirBytesAtEnd = 0;
  let tempDirBytesAtEnd = 0;
  const uploadDurations = [];
  const statusCounts = {};
  const failedRequests = [];
  let attemptedRequests = 0;
  let successfulRequests = 0;
  let successfulPhotos = 0;
  let submittedPhotos = 0;
  let zipBytes = 0;
  let zipDurationMs = null;
  let zipPeakRss = null;
  let testAccountCookie;
  let eventId;

  const progress = message => console.log(`[${scenarioName}] ${new Date().toISOString()} ${message}`);
  const scanDirectories = async () => {
    if (sampleBusy) return;
    sampleBusy = true;
    try {
      const [uploadBytes, tempBytes] = await Promise.all([
        directorySize(uploadDirectory),
        directorySize(path.join(uploadDirectory, '.tmp')),
      ]);
      maxUploadDirBytes = Math.max(maxUploadDirBytes, uploadBytes);
      maxTempDirBytes = Math.max(maxTempDirBytes, tempBytes);
    } catch (error) { serverErrors.push(`Speichermessung: ${error.message}`); }
    finally { sampleBusy = false; }
  };

  try {
    app = createApp({
      DB_PATH: databasePath,
      UPLOAD_DIR: uploadDirectory,
      BASE_URL: 'http://localhost:3000',
      MAX_EVENT_PHOTOS: input.photos,
      MAX_EVENT_BYTES: 100 * 1024 ** 3,
      uploadCapacityOptions: {minFreeBytes: 100 * MiB},
      mailer: async () => {},
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const ownerId = `loadtest-${randomHex(8)}`;
    const accountToken = randomHex(32);
    const guestToken = randomHex(32);
    eventId = `loadtest-${randomHex(8)}`;
    const now = Date.now();
    app.locals.db.prepare('INSERT INTO users (id,email,password_hash,created_at,email_verified_at) VALUES (?,?,?,?,?)')
      .run(ownerId, `${ownerId}@example.test`, 'not-used-in-load-test', now, now);
    app.locals.db.prepare('INSERT INTO sessions (token_hash,user_id,csrf,expires_at) VALUES (?,?,?,?)')
      .run(hash(accountToken), ownerId, randomHex(32), now + 60 * 60_000);
    app.locals.db.prepare(`INSERT INTO events
      (id,email,plan,amount_cents,status,created_at,expires_at,owner_id,title,guest_token,moderation,guestbook_moderation)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(eventId, `${ownerId}@example.test`, 'event', 4990, 'pilot', now, now + 60 * 86400_000, ownerId, `Lokaler Lasttest ${scenarioName}`, guestToken, 0, 0);
    testAccountCookie = `event_session=${accountToken}`;

    sampler = setInterval(() => {
      const rss = process.memoryUsage().rss;
      maxRss = Math.max(maxRss, rss);
      if (measuringZip) zipPeakRssBytes = Math.max(zipPeakRssBytes, rss);
    }, 100);
    const {files: photoFiles, bytes: sourceBytes} = await createInputs(inputDirectory, input.photos, input.minMb, input.maxMb, progress);
    progress(`Eingabedaten bereit: ${input.photos} Fotos, ${mb(sourceBytes)} MB.`);

    const guestCookies = [];
    for (let i = 0; i < input.guests; i++) {
      const response = await fetch(`${base}/event/${eventId}?token=${guestToken}`, {headers: {Origin: 'http://localhost:3000'}});
      if (!response.ok) throw new Error(`Gast ${i + 1} konnte keinen Testzugang öffnen (HTTP ${response.status}).`);
      const setCookie = response.headers.get('set-cookie') || '';
      const match = new RegExp(`(?:^|,\\s*)?(finalsnap_guest_${eventId}=[a-f0-9]{64})(?:;|,)`).exec(setCookie);
      if (!match) throw new Error(`Gast ${i + 1} erhielt kein eigenes Gast-Cookie.`);
      guestCookies.push(match[1]);
    }

    sizeSampler = setInterval(() => { void scanDirectories(); }, 2000);
    await scanDirectories();
    const uploadStarted = Date.now();
    let completedGuests = 0;
    const guestTasks = guestCookies.map(async (cookie, guestIndex) => {
      const countForGuest = Math.floor(input.photos / input.guests) + (guestIndex < input.photos % input.guests ? 1 : 0);
      const guestOffset = Math.floor(durationMs * guestIndex / Math.max(input.guests, 1));
      await sleep(guestOffset);
      const firstPhoto = Math.floor(input.photos / input.guests) * guestIndex + Math.min(guestIndex, input.photos % input.guests);
      for (let offset = 0; offset < countForGuest; offset += MAX_FILES_PER_REQUEST) {
        const batch = photoFiles.slice(firstPhoto + offset, firstPhoto + Math.min(countForGuest, offset + MAX_FILES_PER_REQUEST));
        const form = new FormData();
        for (const filename of batch) form.append('photos', await fs.openAsBlob(filename, {type: 'image/jpeg'}), path.basename(filename));
        attemptedRequests++;
        submittedPhotos += batch.length;
        const requestStarted = Date.now();
        let status = 0;
        let body;
        try {
          const response = await fetch(`${base}/api/event/${eventId}/upload?token=${guestToken}`, {
            method: 'POST',
            headers: {Origin: 'http://localhost:3000', Cookie: cookie},
            body: form,
          });
          status = response.status;
          body = await readResponse(response);
          statusCounts[status] = (statusCounts[status] || 0) + 1;
          if (response.ok && body.success) {
            successfulRequests++;
            successfulPhotos += Number(body.count || batch.length);
          } else failedRequests.push({guest: guestIndex + 1, status, photos: batch.length, error: body.error || body.message || 'Upload fehlgeschlagen'});
        } catch (error) {
          statusCounts.network = (statusCounts.network || 0) + 1;
          failedRequests.push({guest: guestIndex + 1, status: 'network', photos: batch.length, error: error.message});
        } finally { uploadDurations.push(Date.now() - requestStarted); }
      }
      completedGuests++;
      if (completedGuests % 25 === 0 || completedGuests === input.guests) progress(`Gäste abgeschlossen: ${completedGuests}/${input.guests}; Uploads ${successfulPhotos}/${input.photos}.`);
    });
    await Promise.all(guestTasks);
    const uploadFinished = Date.now();
    await scanDirectories();
    uploadDirBytesAtEnd = await directorySize(uploadDirectory);
    tempDirBytesAtEnd = await directorySize(path.join(uploadDirectory, '.tmp'));
    maxUploadDirBytes = Math.max(maxUploadDirBytes, uploadDirBytesAtEnd);
    maxTempDirBytes = Math.max(maxTempDirBytes, tempDirBytesAtEnd);

    if (successfulPhotos > 0) {
      progress('ZIP-Download des vollständigen Albums läuft.');
      const zipStarted = Date.now();
      measuringZip = true;
      zipPeakRssBytes = process.memoryUsage().rss;
      const zipResponse = await fetch(`${base}/api/event/${eventId}/download`, {headers: {Cookie: testAccountCookie}});
      if (!zipResponse.ok) {
        const errorBody = await readResponse(zipResponse);
        failedRequests.push({stage: 'zip', status: zipResponse.status, error: errorBody.error || errorBody.message || 'ZIP-Download fehlgeschlagen'});
      } else {
        await pipeline(Readable.fromWeb(zipResponse.body), fs.createWriteStream(zipPath, {flags: 'wx'}));
        zipBytes = (await fsp.stat(zipPath)).size;
      }
      zipDurationMs = Date.now() - zipStarted;
      measuringZip = false;
      maxRss = Math.max(maxRss, process.memoryUsage().rss);
      zipPeakRss = mb(Math.max(zipPeakRssBytes, process.memoryUsage().rss));
    }
    await scanDirectories();

    const elapsedMs = Date.now() - uploadStarted;
    const [storedPhotos, uploadedSourceBytes] = [
      app.locals.db.prepare('SELECT COUNT(*) count FROM photos WHERE event_id=?').get(eventId).count,
      sourceBytes,
    ];
    const result = {
      scenario: scenarioName,
      guests: input.guests,
      requestedPhotos: input.photos,
      submittedPhotos,
      successfulPhotos,
      storedPhotos,
      requestedDurationMinutes: Number((durationMs / 60_000).toFixed(2)),
      uploadElapsedMinutes: Number((elapsedMs / 60_000).toFixed(2)),
      uploadsPerMinute: Number((successfulPhotos / (elapsedMs / 60_000)).toFixed(2)),
      requestsPerMinute: Number((attemptedRequests / (elapsedMs / 60_000)).toFixed(2)),
      attemptedRequests,
      successfulRequests,
      errorRatePercent: Number((((attemptedRequests - successfulRequests) / Math.max(1, attemptedRequests)) * 100).toFixed(2)),
      statusCounts,
      uploadDurationMs: {p50: pctl(uploadDurations, 0.50), p95: pctl(uploadDurations, 0.95), max: uploadDurations.length ? Math.max(...uploadDurations) : null},
      maxRssMb: mb(maxRss),
      zip: {status: zipBytes ? 200 : (failedRequests.find(item => item.stage === 'zip')?.status || null), durationMs: zipDurationMs, sizeMb: mb(zipBytes), peakRssMb: zipPeakRss},
      uploadDirectory: {atEndMb: mb(uploadDirBytesAtEnd), peakObservedMb: mb(maxUploadDirBytes)},
      tempDirectory: {atEndMb: mb(tempDirBytesAtEnd), peakObservedMb: mb(maxTempDirBytes)},
      generatedSourceMb: mb(uploadedSourceBytes),
      failures: failedRequests.slice(0, 30),
      serverLogExcerpt: serverErrors.slice(-30),
      localOnly: true,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
    };
    progress(`Fertig: ${successfulPhotos}/${input.photos} Fotos, Fehler ${result.errorRatePercent} %, ZIP ${result.zip.sizeMb} MB in ${result.zip.durationMs} ms.`);
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (sampler) clearInterval(sampler);
    if (sizeSampler) clearInterval(sizeSampler);
    console.error = originalConsoleError;
    if (server) await new Promise(resolve => server.close(resolve));
    if (app) {
      app.locals.backupService.stop();
      app.locals.operationsMonitor.stop();
      app.locals.db.close();
    }
    await fsp.rm(tempRoot, {recursive: true, force: true});
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return showHelp();
  if (options.all) {
    const scenarios = [
      {name: 'klein', guests: 20, photos: 200},
      {name: 'mittel', guests: 80, photos: 800},
      {name: 'gross', guests: 150, photos: 2000},
    ];
    const results = [];
    for (const scenario of scenarios) {
      results.push(await runScenario({...options, ...scenario, durationMinutes: options.durationMinutes}, scenario.name));
    }
    console.log('LASTTEST_RESULT=' + JSON.stringify(results));
    return;
  }
  await runScenario(options, `${options.guests}-gaeste-${options.photos}-fotos`);
}

if (!process.env.NODE_TEST_CONTEXT) {
  main().catch(error => {
    console.error(`Lasttest abgebrochen: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
