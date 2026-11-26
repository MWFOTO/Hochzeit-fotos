const {test, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {exiftool} = require('exiftool-vendored');
const {preparePhoto, removeGps} = require('../photo-processing');

const directory = path.join(os.tmpdir(), `finalsnap-photo-processing-${process.pid}`);
after(async () => { await exiftool.end(); await fs.rm(directory, {recursive:true,force:true}); });

test('keeps full-resolution original and camera/date metadata while stripping GPS', async () => {
  const inputPath = path.join(directory, 'input.jpg');
  const outputDirectory = path.join(directory, 'event');
  await fs.mkdir(directory, {recursive:true});
  await sharp({create:{width:4000,height:3000,channels:3,background:'#4787b8'}}).jpeg({quality:91}).toFile(inputPath);
  await exiftool.write(inputPath, {GPSLatitude:52.5,GPSLongitude:13.4,Make:'FinalSnap Test Camera',Model:'FS-1',DateTimeOriginal:'2026:11:25 12:00:00'});
  const prepared = await preparePhoto({inputPath,outputDirectory,id:'photo-test',originalName:'Hochzeit.jpg'});

  const originalMetadata = await exiftool.read(prepared.originalPath);
  assert.equal(originalMetadata.GPSLatitude, undefined);
  assert.equal(originalMetadata.GPSLongitude, undefined);
  assert.equal(originalMetadata.Make, 'FinalSnap Test Camera');
  assert.equal(originalMetadata.Model, 'FS-1');
  assert.equal(originalMetadata.DateTimeOriginal.rawValue, '2026:11:25 12:00:00');
  assert.equal((await sharp(prepared.originalPath).metadata()).width, 4000);
  assert.equal((await sharp(prepared.displayPath).metadata()).width, 2560);
  assert.equal((await sharp(prepared.thumbPath).metadata()).width, 480);
  assert.equal(prepared.originalFilename, 'Hochzeit.jpg');
  assert.equal(prepared.bytes, prepared.originalBytes + prepared.displayBytes + prepared.thumbBytes);
  assert.equal(await fs.stat(prepared.originalPath).then(stat=>stat.size), prepared.originalBytes);
});

test('supports original files with no EXIF GPS data without losing the file', async () => {
  const inputPath = path.join(directory, 'plain.png');
  await fs.mkdir(directory, {recursive:true});
  const input = await sharp({create:{width:32,height:24,channels:4,background:'#e8d4bf'}}).png().toBuffer();
  await fs.writeFile(inputPath,input);
  const prepared = await preparePhoto({inputPath,outputDirectory:path.join(directory,'plain-event'),id:'plain-test',originalName:'original.png'});
  assert.equal(prepared.originalMime,'image/png');
  assert.deepEqual(await fs.readFile(prepared.originalPath),input);
  await removeGps(prepared.originalPath);
});
