/* Application orchestration. Every outside capability arrives through an injected port. */
(function(root) {
  'use strict';
  function create({session, scene, view, renderer, clock, scheduler, lifecycle, environment, content}) {
    let alive = true, assetsReady = false, loading = false;
    function feedback(result) { if (alive) view.feedback(result, clock.monotonic()); }
    function touch() { scene.touch(clock.monotonic()); }
    function paint() {
      if (!alive || environment.read().hidden) return;
      const snap = session.snapshot(), settings = environment.read(), wallTime = clock.wall(), monotonic = clock.monotonic();
      const frame = scene.tick({state: snap.state, wallTime, monotonic, motion: settings.motion,
        paused: !!view.context().modal || !snap.loaded, ready: snap.loaded, busy: snap.busy});
      if (assetsReady) renderer.render(frame);
      view.render({frame, loaded: snap.loaded, busy: snap.busy, revision: snap.revision, wallTime, monotonic});
      for (const command of frame.commands) commit(command.kind, command.index);
    }
    function restart() {
      scheduler.stop(); scene.resetClock();
      if (!alive || environment.read().hidden) return;
      paint(); scheduler.start(paint, () => assetsReady && session.snapshot().loaded && environment.read().motion && !view.context().modal);
    }
    async function commit(kind, index) {
      const promise = session.dispatch(kind, index);
      if (session.snapshot().busy) feedback({code: 'saving'});
      const result = await promise;
      if (!alive) return;
      if (result.status === 'committed') scene.react(result.events);
      if (kind === 'pet' && ['committed','noop'].includes(result.status)) view.close();
      feedback(result); paint();
    }
    function intent(kind, index) {
      if (!alive) return;
      touch();
      if (kind === 'close') {scene.cancelRoute(); view.close(); restart(); return;}
      if (kind === 'retry') {load(); return;}
      const snap = session.snapshot();
      if (!snap.loaded || snap.busy) return;
      if (kind === 'openResident' || kind === 'choose') {
        scene.cancelRoute(); view.open(kind === 'choose' ? 'picker' : 'job', index); restart(); return;
      }
      if (scene.request(kind, index)) {
        if (kind === 'plot') feedback({code: 'walkToPlot', data: {index}});
        if (kind === 'stroll') feedback({code: 'stroll'});
        paint(); return;
      }
      commit(kind, index);
    }
    async function load() {
      if (loading || !alive) return;
      loading = true; feedback({code: 'loading'});
      const result = await session.load(); loading = false;
      if (!alive) return;
      touch(); feedback(result.status === 'loaded' ? {code: 'loaded'} : result); restart();
    }
    const unsubscribe = session.subscribe(() => paint());
    const unobserve = environment.subscribe(event => {
      if (event.type === 'input') touch();
      else {if (event.type === 'motion') touch(); restart();}
    });
    function back() {
      touch(); scene.cancelRoute();
      if (view.back()) restart(); else lifecycle.home();
    }
    function dispose() {
      if (!alive) return;
      alive = false; scheduler.stop(); unsubscribe(); unobserve(); session.dispose(); scene.dispose(); view.dispose(); environment.dispose();
    }
    async function start() {
      lifecycle.deferReady(); lifecycle.onSuspend(dispose); lifecycle.setBackHandler(back);
      feedback({code: 'loading'}); paint();
      try {
        await renderer.ready;
        if (!alive) return;
        assetsReady = true; view.mount(content, intent); await load();
      } catch (error) {feedback({code: 'assetsFailed'});}
      finally {if (alive) {restart(); lifecycle.ready();}}
    }
    return {start, dispose, intent};
  }
  root.YardController = {create};
  if (typeof module !== 'undefined') module.exports = root.YardController;
})(globalThis);
