const fs = require('node:fs');

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const MIN_UPLOAD_FREE_BYTES = 2 * GiB;
const UPLOAD_DISK_WARNING_BYTES = 2.5 * GiB;

function uploadDiskWarningThreshold(totalBytes) {
  return Math.max(UPLOAD_DISK_WARNING_BYTES, Number(totalBytes) * 0.25);
}

function createUploadCapacity({root, maxConcurrent = 2, minFreeBytes = MIN_UPLOAD_FREE_BYTES, statfs = fs.statfsSync}) {
  let active = 0;

  function acquire() {
    if (active >= maxConcurrent) return {ok: false, reason: 'concurrency'};
    const disk = statfs(root);
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    if (!Number.isFinite(freeBytes) || freeBytes < minFreeBytes) {
      return {ok: false, reason: 'disk', freeBytes};
    }
    active++;
    let released = false;
    return {
      ok: true,
      freeBytes,
      release() {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
      },
    };
  }

  return {acquire, get active() { return active; }};
}

module.exports = {createUploadCapacity, GiB, MiB, MIN_UPLOAD_FREE_BYTES, UPLOAD_DISK_WARNING_BYTES, uploadDiskWarningThreshold};
