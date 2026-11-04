const test=require('node:test');
const assert=require('node:assert/strict');
const {createUploadCapacity,GiB}=require('../upload-capacity');

test('upload capacity bounds simultaneous staging and releases a slot once',()=>{
  const capacity=createUploadCapacity({root:'/uploads',maxConcurrent:2,minFreeBytes:2*GiB,statfs:()=>({bavail:4*GiB,bsize:1})});
  const first=capacity.acquire(),second=capacity.acquire();
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.equal(capacity.active,2);
  assert.deepEqual(capacity.acquire(),{ok:false,reason:'concurrency'});
  first.release();first.release();assert.equal(capacity.active,1);
  assert.equal(capacity.acquire().ok,true);
  second.release();assert.equal(capacity.active,1);
});

test('upload capacity rejects new staging before the disk reserve is consumed',()=>{
  let free=2*GiB-1;
  const capacity=createUploadCapacity({root:'/uploads',maxConcurrent:2,minFreeBytes:2*GiB,statfs:()=>({bavail:free,bsize:1})});
  assert.deepEqual(capacity.acquire(),{ok:false,reason:'disk',freeBytes:free});
  free=2*GiB;
  const lease=capacity.acquire();assert.equal(lease.ok,true);lease.release();
});
