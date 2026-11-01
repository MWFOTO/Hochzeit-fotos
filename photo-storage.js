const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createPhotoStorage(config = {}, dependencies = {}) {
  const bucket = String(config.S3_BUCKET || '').trim();
  const supplied = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']
    .filter(key => String(config[key] || '').trim());

  if (!bucket) {
    if (supplied.length) throw new Error('Für S3-Fotospeicher müssen Bucket, Endpunkt, Region und Zugangsdaten zusammen eingerichtet sein.');
    const root = path.resolve(config.UPLOAD_DIR || path.join(__dirname, 'uploads'));
    return {
      mode: 'local',
      root,
      check: async () => fs.promises.access(root, fs.constants.R_OK | fs.constants.W_OK),
      put: async () => {},
      getStream: async (eventId, filename) => fs.createReadStream(path.join(root, eventId, filename)),
      deletePhoto: async (eventId, filename) => fs.promises.rm(path.join(root, eventId, filename), {force: true}),
      deleteEvent: async eventId => fs.promises.rm(path.join(root, eventId), {recursive: true, force: true}),
      photoSize: async (eventId, filename) => {
        try { return fs.statSync(path.join(root, eventId, filename)).size; }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      },
    };
  }

  const required = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  const missing = required.filter(key => !String(config[key] || '').trim());
  if (missing.length) throw new Error(`S3-Fotospeicher ist unvollständig konfiguriert (${missing.join(', ')}).`);
  const endpoint = String(config.S3_ENDPOINT).replace(/\/$/, '');
  const endpointRegion = /^https:\/\/(fsn1|nbg1)\.your-objectstorage\.com$/.exec(endpoint)?.[1];
  if (!endpointRegion || endpointRegion !== config.S3_REGION) throw new Error('Für den deutschen Fotospeicher muss S3_ENDPOINT zu S3_REGION fsn1 oder nbg1 passen.');
  const encodedEncryptionKey = String(config.S3_SSE_C_KEY || '').trim();
  if (config.NODE_ENV === 'production' && !encodedEncryptionKey) throw new Error('Im Produktivbetrieb benötigt der Fotospeicher einen S3_SSE_C_KEY für die Verschlüsselung.');
  let encryption = {};
  if (encodedEncryptionKey) {
    const key = Buffer.from(encodedEncryptionKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encodedEncryptionKey) throw new Error('S3_SSE_C_KEY muss ein Base64-kodierter Schlüssel mit genau 32 Bytes sein.');
    encryption = {
      SSECustomerAlgorithm: 'AES256',
      SSECustomerKey: key,
      SSECustomerKeyMD5: crypto.createHash('md5').update(key).digest('base64'),
    };
  }

  const sdk = dependencies.sdk || require('@aws-sdk/client-s3');
  const {S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand, HeadBucketCommand} = sdk;
  const client = dependencies.client || new S3Client({
    endpoint,
    region: config.S3_REGION,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
  });
  const keyFor = (eventId, filename) => `events/${eventId}/${filename}`;
  const send = async (command, options) => {
    try { return await client.send(command, options); }
    catch (cause) {
      const error = new Error('Fotospeicher derzeit nicht erreichbar. Bitte später erneut versuchen.');
      error.code = 'PHOTO_STORAGE_UNAVAILABLE';error.cause = cause;throw error;
    }
  };

  return {
    mode: 's3',
    bucket,
    check: async () => send(new HeadBucketCommand({Bucket: bucket}), {abortSignal: AbortSignal.timeout(3000)}),
    put: async (eventId, filename, filePath) => {
      await send(new PutObjectCommand({
        Bucket: bucket,
        Key: keyFor(eventId, filename),
        Body: fs.createReadStream(filePath),
        ContentType: 'image/jpeg',
        CacheControl: 'private, no-store',
        ...encryption,
      }));
    },
    getStream: async (eventId, filename) => {
      const result = await send(new GetObjectCommand({Bucket: bucket, Key: keyFor(eventId, filename), ...encryption}));
      if (!result.Body) throw new Error('Foto konnte aus dem Object Storage nicht gelesen werden.');
      return result.Body;
    },
    deletePhoto: async (eventId, filename) => {
      await send(new DeleteObjectCommand({Bucket: bucket, Key: keyFor(eventId, filename)}));
    },
    deleteEvent: async eventId => {
      const Prefix = `events/${eventId}/`;
      let ContinuationToken;
      do {
        const listed = await send(new ListObjectsV2Command({Bucket: bucket, Prefix, ContinuationToken}));
        for (const item of listed.Contents || []) {
          if (item.Key) await send(new DeleteObjectCommand({Bucket: bucket, Key: item.Key}));
        }
        ContinuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
      } while (ContinuationToken);
    },
    photoSize: async (eventId, filename) => {
      try {
        const result=await send(new HeadObjectCommand({Bucket: bucket, Key: keyFor(eventId, filename), ...encryption}));
        return Number(result.ContentLength);
      } catch (error) {
        if (error?.cause?.$metadata?.httpStatusCode === 404 || error?.cause?.name === 'NotFound' || error?.cause?.name === 'NoSuchKey') return null;
        throw error;
      }
    },
  };
}

module.exports = {createPhotoStorage};
