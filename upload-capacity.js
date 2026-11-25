const fs = require('node:fs');

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const MIN_UPLOAD_FREE_BYTES = 2 * GiB;
const UPLOAD_DISK_WARNING_BYTES = 2.5 * GiB;

function uploadDiskWarningThreshold(totalBytes) {
  return Math.max(UPLOAD_DISK_WARNING_BYTES, Number(totalBytes) * 0.25);
}

function createUploadCapacity({
  root,
  maxConcurrent = 2,
  maxQueued = 30,
  maxStaged = 30,
  maxWaitMs = 90_000,
  minFreeBytes = MIN_UPLOAD_FREE_BYTES,
  statfs = fs.statfsSync,
}) {
  let active = 0;
  let staged = 0;
  let reservedBytes = 0;
  const waiters = [];

  function freeBytes() {
    const disk = statfs(root);
    return Number(disk.bavail) * Number(disk.bsize);
  }

  function reserveStaging(req, {maxBytes}) {
    const declared = Number(req?.headers?.['content-length']);
    if (Number.isSafeInteger(declared) && declared > maxBytes) return {ok: false, reason: 'size'};
    const bytes = Number.isSafeInteger(declared) && declared > 0
      ? Math.min(declared, maxBytes)
      : maxBytes;
    if (staged >= maxStaged) return {ok: false, reason: 'queue'};
    let available;
    try { available = freeBytes(); }
    catch { return {ok: false, reason: 'disk', freeBytes: 0}; }
    if (!Number.isFinite(available) || available - reservedBytes - bytes < minFreeBytes) {
      return {ok: false, reason: 'disk', freeBytes: available};
    }
    staged++;
    reservedBytes += bytes;
    let released = false;
    return {
      ok: true,
      bytes,
      release() {
        if (released) return;
        released = true;
        staged = Math.max(0, staged - 1);
        reservedBytes = Math.max(0, reservedBytes - bytes);
      },
    };
  }

  function makeLease() {
    active++;
    let released = false;
    return {
      ok: true,
      release() {
        if (released) return;
        released = true;
        active = Math.max(0, active - 1);
        while (waiters.length) {
          const next = waiters.shift();
          if (next.cancelled) continue;
          clearTimeout(next.timer);
          next.resolve(makeLease());
          break;
        }
      },
    };
  }

  function acquire() {
    if (active < maxConcurrent && waiters.length === 0) return Promise.resolve(makeLease());
    if (waiters.filter(waiter => !waiter.cancelled).length >= maxQueued) {
      return Promise.resolve({ok: false, reason: 'queue'});
    }
    return new Promise(resolve => {
      const waiter = {resolve, cancelled: false, timer: null};
      waiter.timer = setTimeout(() => {
        waiter.cancelled = true;
        resolve({ok: false, reason: 'timeout'});
      }, maxWaitMs);
      waiters.push(waiter);
    });
  }

  return {
    acquire,
    reserveStaging,
    get active() { return active; },
    get queued() { return waiters.filter(waiter => !waiter.cancelled).length; },
    get staged() { return staged; },
    get reservedBytes() { return reservedBytes; },
  };
}

module.exports = {createUploadCapacity, GiB, MiB, MIN_UPLOAD_FREE_BYTES, UPLOAD_DISK_WARNING_BYTES, uploadDiskWarningThreshold};
