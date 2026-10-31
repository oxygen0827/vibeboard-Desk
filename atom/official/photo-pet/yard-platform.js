/* Concrete browser and AtomApp adapters. The application owns their contracts. */
(function(root) {
  'use strict';
  function create({host: AtomApp, window: win, document: doc}) {
    const media = win.matchMedia('(prefers-reduced-motion: reduce)'), listeners = new Set();
    let systemMotion = true, disposed = false;
    const read = () => ({motion: systemMotion && !media.matches, hidden: doc.hidden});
    function emit(type) { if (!disposed) for (const fn of listeners) fn({type, ...read()}); }
    const input = () => emit('input'), visibility = () => emit('visibility'), motion = () => emit('motion');
    function settings(event) {
      if (event.source === win.parent && event.data?.type === 'atom:input-settings') {
        systemMotion = event.data.motion !== false; emit('motion');
      }
    }
    win.addEventListener('message', settings);
    win.addEventListener('pointerdown', input, true); win.addEventListener('keydown', input, true);
    doc.addEventListener('visibilitychange', visibility); media.addEventListener('change', motion);
    function dispose() {
      disposed = true; listeners.clear();
      win.removeEventListener('message', settings);
      win.removeEventListener('pointerdown', input, true); win.removeEventListener('keydown', input, true);
      doc.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', motion);
    }
    let raf = 0, timer = 0, running = false, lastPaint = null, epoch = 0;
    const FRAME = 1000 / 30;
    function stop() {
      running = false; epoch++; win.cancelAnimationFrame(raf); win.clearTimeout(timer); raf = timer = 0; lastPaint = null;
    }
    function start(paint, continuous) {
      stop(); running = true; const token = epoch;
      function queue() {
        if (!running || token !== epoch || doc.hidden) return;
        if (continuous()) raf = win.requestAnimationFrame(now => {
          raf = 0;
          if (!running || token !== epoch) return;
          if (lastPaint === null || now - lastPaint >= FRAME - .5) {
            lastPaint = now - (lastPaint === null ? 0 : (now - lastPaint) % FRAME); paint();
          }
          queue();
        });
        else timer = win.setTimeout(() => {timer = 0; if (running && token === epoch) {paint(); queue();}}, 250);
      }
      queue();
    }
    return {
      clock: {wall: () => Date.now(), monotonic: () => win.performance.now()},
      repository: {load: defaults => AtomApp.load(defaults), save: state => AtomApp.save(state)},
      scheduler: {start, stop},
      lifecycle: {deferReady: () => AtomApp.deferReady(), ready: () => AtomApp.ready(),
        onSuspend: fn => AtomApp.onSuspend(fn), setBackHandler: fn => AtomApp.navigation.setBackHandler(fn), home: () => AtomApp.home()},
      environment: {read, subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn);}, dispose}
    };
  }
  root.YardPlatform = {create};
  if (typeof module !== 'undefined') module.exports = root.YardPlatform;
})(globalThis);
