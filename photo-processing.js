const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const {exiftool} = require('exiftool-vendored');

const FORMATS = Object.freeze({
  jpeg: {extension: 'jpg', mime: 'image/jpeg'},
  png: {extension: 'png', mime: 'image/png'},
  webp: {extension: 'webp', mime: 'image/webp'},
  heif: {extension: 'heic', mime: 'image/heic'},
});

function safeOriginalName(value, extension) {
  const leaf = path.basename(String(value || 'Foto')).normalize('NFKC');
  const stem = leaf.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}._ -]/gu, '_').trim().slice(0, 100) || 'Foto';
  return `${stem}.${extension}`;
}

async function removeGps(filename) {
  await exiftool.write(filename, {}, {writeArgs: ['-GPS:all=', '-XMP:GPS*=', '-overwrite_original']});
  const metadata = await exiftool.read(filename);
  const remainingGps = Object.entries(metadata).filter(([key, value]) => /GPS/i.test(key) && value != null && value !== '');
  if (remainingGps.length) throw new Error('GPS-Standortdaten konnten nicht sicher aus dem Foto entfernt werden.');
}

async function preparePhoto({inputPath, outputDirectory, id, originalName}) {
  const source = sharp(inputPath, {limitInputPixels: 40000000, animated: false});
  const metadata = await source.metadata();
  const format = FORMATS[metadata.format];
  if (!format) throw new Error('Nur JPEG, PNG, WebP und unterstützte HEIF-Bilder erlaubt. RAW/DNG-Dateien werden nicht unterstützt.');
  const originalFilename = safeOriginalName(originalName, format.extension);
  const originalKey = `original/${id}.${format.extension}`;
  const displayFilename = `${id}.jpg`;
  const thumbFilename = `thumb/${id}.jpg`;
  const originalPath = path.join(outputDirectory, originalKey);
  const displayPath = path.join(outputDirectory, displayFilename);
  const thumbPath = path.join(outputDirectory, thumbFilename);
  await fs.promises.mkdir(path.dirname(originalPath), {recursive: true});
  await fs.promises.mkdir(path.dirname(thumbPath), {recursive: true});
  try {
    await fs.promises.copyFile(inputPath, originalPath);
    await removeGps(originalPath);
    const display = sharp(originalPath, {limitInputPixels: 40000000, animated: false}).rotate()
      .resize({width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true})
      .jpeg({quality: 82, mozjpeg: true});
    const thumbnail = sharp(originalPath, {limitInputPixels: 40000000, animated: false}).rotate()
      .resize({width: 480, height: 480, fit: 'inside', withoutEnlargement: true})
      .jpeg({quality: 75, mozjpeg: true});
    const [displayInfo, thumbInfo] = await Promise.all([
      display.toFile(displayPath),
      thumbnail.toFile(thumbPath),
    ]);
    const [originalStat, displayStat, thumbStat] = await Promise.all([
      fs.promises.stat(originalPath), fs.promises.stat(displayPath), fs.promises.stat(thumbPath),
    ]);
    return {
      id, filename: displayFilename, originalFilename, originalKey, originalPath,
      originalBytes: originalStat.size, originalMime: format.mime,
      displayFilename, displayPath, displayBytes: displayStat.size,
      thumbFilename, thumbPath, thumbBytes: thumbStat.size,
      bytes: originalStat.size + displayStat.size + thumbStat.size,
      width: displayInfo.width, height: displayInfo.height,
      thumbWidth: thumbInfo.width, thumbHeight: thumbInfo.height,
    };
  } catch (error) {
    await Promise.all([originalPath, displayPath, thumbPath].map(filename=>fs.promises.rm(filename,{force:true})));
    throw error;
  }
}

function originalKey(photo) {
  const extension = path.extname(photo.original_filename || '').slice(1).toLowerCase();
  return `original/${photo.id}.${extension || 'jpg'}`;
}

module.exports = {FORMATS, preparePhoto, originalKey, removeGps, safeOriginalName};
