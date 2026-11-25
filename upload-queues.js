function createEventUploadQueues({maxPendingPerEvent = 30, maxWaitMs = 90_000} = {}) {
  const states = new Map();

  function stateFor(id) {
    let state = states.get(id);
    if (!state) {
      state = {tail: Promise.resolve(), pending: 0, running: false};
      states.set(id, state);
    }
    return state;
  }

  function reserve(id) {
    const state = stateFor(id);
    if (state.pending >= maxPendingPerEvent) return {ok: false, reason: 'queue'};
    state.pending++;
    let released = false;
    let runStarted = false;
    let cancelled = false;
    let timer = null;

    const release = () => {
      if (released) return;
      released = true;
      if (timer) clearTimeout(timer);
      state.pending = Math.max(0, state.pending - 1);
      if (state.pending === 0 && !state.running) states.delete(id);
    };

    return {
      ok: true,
      release,
      run(task) {
        if (runStarted) throw new Error('Event-Upload-Warteschlange kann nur einmal verwendet werden.');
        runStarted = true;
        let resolveTimeout;
        const timeout = new Promise(resolve => { resolveTimeout = resolve; });
        timer = setTimeout(() => {
          cancelled = true;
          release();
          resolveTimeout({ok: false, reason: 'timeout'});
        }, maxWaitMs);
        const execution = state.tail.then(async () => {
          if (cancelled) return {ok: false, reason: 'timeout'};
          if (timer) clearTimeout(timer);
          state.running = true;
          try { return {ok: true, value: await task()}; }
          finally {
            state.running = false;
            if (state.pending === 0) states.delete(id);
          }
        });
        state.tail = execution.catch(() => {});
        return Promise.race([execution, timeout]);
      },
    };
  }

  return {
    reserve,
    isBusy(id) { return (states.get(id)?.pending || 0) > 0; },
    get pendingEvents() { return states.size; },
    pending(id) { return states.get(id)?.pending || 0; },
  };
}

module.exports = {createEventUploadQueues};
