/* Application use cases. Repository and clock are ports, never global services. */
(function(root) {
  'use strict';
  function create({domain, repository, clock}) {
    let state = domain.load(), loaded = false, busy = false, alive = true, revision = 0, generation = 0;
    const listeners = new Set();
    function freeze(value) {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {Object.values(value).forEach(freeze); Object.freeze(value);}
      return value;
    }
    freeze(state);
    const snapshot = () => ({state, loaded, busy, alive, revision});
    function emit() { if (alive) for (const listener of listeners) listener(snapshot()); }
    async function load() {
      if (!alive || busy) return {status: 'unavailable'};
      const token = ++generation;
      loaded = false; emit();
      try {
        const next = domain.load(await repository.load({pet: 'dog'}));
        if (!alive || token !== generation) return {status: 'disposed'};
        state = freeze(next); loaded = true; revision++; emit(); return {status: 'loaded'};
      } catch (error) {
        if (!alive || token !== generation) return {status: 'disposed'};
        emit(); return {status: 'failed', code: 'readFailed'};
      }
    }
    async function dispatch(kind, index) {
      if (!alive || !loaded) return {status: 'unavailable'};
      if (busy) return {status: 'busy'};
      const result = domain.act(state, kind, index, clock.wall());
      if (result.state === state) return {...result, status: 'noop'};
      busy = true; emit();
      try {
        const ack = await repository.save(result.state);
        if (!alive) return {status: 'disposed'};
        state = freeze(result.state); revision++;
        return {...result, status: 'committed', preview: ack?.mode === 'preview'};
      } catch (error) {
        return alive ? {status: 'failed', code: 'saveFailed', events: []} : {status: 'disposed'};
      } finally { busy = false; emit(); }
    }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    function dispose() { alive = false; generation++; listeners.clear(); }
    return {snapshot, load, dispatch, subscribe, dispose};
  }
  root.YardSession = {create};
  if (typeof module !== 'undefined') module.exports = root.YardSession;
})(globalThis);
