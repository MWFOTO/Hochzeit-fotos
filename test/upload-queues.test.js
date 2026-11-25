const test=require('node:test');
const assert=require('node:assert/strict');
const {createEventUploadQueues}=require('../upload-queues');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('same-event uploads run one at a time and remain busy while waiting',async()=>{
  const queues=createEventUploadQueues();
  const hold=queues.reserve('event');let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const first=hold.run(()=>gate);
  const next=queues.reserve('event');
  let started=false;
  const second=next.run(async()=>{started=true;return 'done';});
  await tick();assert.equal(started,false);assert.equal(queues.isBusy('event'),true);
  release('first');await first;
  assert.deepEqual(await second,{ok:true,value:'done'});
  hold.release();next.release();assert.equal(queues.isBusy('event'),false);
});

test('event queue caps waiters and cancels timed out work',async()=>{
  const queues=createEventUploadQueues({maxPendingPerEvent:2,maxWaitMs:10});
  const hold=queues.reserve('event');let release;
  const first=hold.run(()=>new Promise(resolve=>{release=resolve;}));
  await tick();
  const extra=queues.reserve('event');
  assert.deepEqual(queues.reserve('event'),{ok:false,reason:'queue'});
  release('ok');await first;hold.release();

  const blocker=queues.reserve('blocked');let unblock;
  const blocked=blocker.run(()=>new Promise(resolve=>{unblock=resolve;}));
  await tick();
  const timed=queues.reserve('blocked');let ran=false;
  assert.equal((await timed.run(()=>{ran=true;})).reason,'timeout');
  timed.release();unblock();await blocked;blocker.release();await tick();
  assert.equal(ran,false);
});
