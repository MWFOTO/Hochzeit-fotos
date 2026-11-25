const test=require('node:test');
const assert=require('node:assert/strict');
const {createUploadCapacity,GiB}=require('../upload-capacity');

const freeDisk=()=>({bavail:8*GiB,bsize:1});

test('global upload capacity queues FIFO and releases each slot once',async()=>{
  const capacity=createUploadCapacity({root:'/uploads',maxConcurrent:2,maxQueued:2,minFreeBytes:2*GiB,statfs:freeDisk});
  const first=await capacity.acquire(),second=await capacity.acquire();
  assert.equal(capacity.active,2);
  const thirdPromise=capacity.acquire(),fourthPromise=capacity.acquire();
  assert.equal(capacity.queued,2);
  assert.deepEqual(await capacity.acquire(),{ok:false,reason:'queue'});
  first.release();first.release();
  const third=await thirdPromise;
  assert.equal(third.ok,true);assert.equal(capacity.active,2);
  second.release();
  const fourth=await fourthPromise;
  assert.equal(fourth.ok,true);
  third.release();fourth.release();
  assert.equal(capacity.active,0);
});

test('capacity wait times out and does not consume a later slot',async()=>{
  const capacity=createUploadCapacity({root:'/uploads',maxConcurrent:1,maxWaitMs:10,minFreeBytes:2*GiB,statfs:freeDisk});
  const first=await capacity.acquire();
  assert.deepEqual(await capacity.acquire(),{ok:false,reason:'timeout'});
  first.release();
  const next=await capacity.acquire();assert.equal(next.ok,true);next.release();
});

test('staging reserves disk and rejects before the safety reserve is consumed',()=>{
  let free=4*GiB;
  const capacity=createUploadCapacity({root:'/uploads',minFreeBytes:2*GiB,statfs:()=>({bavail:free,bsize:1})});
  const request={headers:{'content-length':String(150*1024**2)}};
  const first=capacity.reserveStaging(request,{maxBytes:200*1024**2});
  assert.equal(first.ok,true);assert.equal(first.bytes,150*1024**2);
  assert.equal(capacity.staged,1);
  free=2*GiB+100*1024**2;
  assert.equal(capacity.reserveStaging(request,{maxBytes:200*1024**2}).reason,'disk');
  first.release();first.release();assert.equal(capacity.staged,0);
  assert.equal(capacity.reserveStaging({headers:{'content-length':'999999999'}},{maxBytes:200*1024**2}).reason,'size');
});
