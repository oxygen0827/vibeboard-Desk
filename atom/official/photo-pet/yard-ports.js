/* Application-owned contracts, implemented by browser/ATOM adapters or test doubles. */
(function(root) {
  'use strict';
  const contracts = {
    repository: ['load', 'save'],
    clock: ['wall', 'monotonic'],
    scheduler: ['start', 'stop'],
    lifecycle: ['deferReady', 'ready', 'onSuspend', 'setBackHandler', 'home'],
    environment: ['read', 'subscribe', 'dispose'],
    renderer: ['render', 'portrait', 'residentPortrait'],
    view: ['mount', 'render', 'feedback', 'context', 'open', 'close', 'back', 'dispose']
  };
  function check(name, value) {
    for (const method of contracts[name] || []) {
      if (typeof value?.[method] !== 'function') throw Error(name + '.' + method + ' is required');
    }
    return value;
  }
  const api = {contracts, check};
  root.YardPorts = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
