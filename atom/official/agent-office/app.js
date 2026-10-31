/* Composition root: the only module that names concrete implementations. */
(() => {
  'use strict';
  const host = {
    load: d => AtomApp.load(d), save: v => AtomApp.save(v), deferReady: () => AtomApp.deferReady(), ready: () => AtomApp.ready(),
    onSuspend: fn => AtomApp.onSuspend(fn), setBackHandler: fn => AtomApp.navigation.setBackHandler(fn), home: () => AtomApp.home()
  };
  const scene = OfficeScene.create({map: OfficeMap});
  const renderer = OfficeRender.create(document.getElementById('scene'), {map: OfficeMap, art: OfficeArt, document});
  const clock = {wall: () => Date.now(), monotonic: () => performance.now()};
  const ui = OfficeUI.create({document, window, host, domain: OfficeDomain, map: OfficeMap, clients: OfficeClient, Runner: OfficeRunner, scene, renderer, clock});
  window.__office = ui.debug;
  ui.start();
})();
