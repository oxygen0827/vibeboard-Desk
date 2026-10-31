// The shell restores the device's saved copy when browser storage comes up empty, before defaults can replace it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'static', 'maintenance.js'), 'utf8');
const SAVED = {'atom.desktop.sort.v1': 'frequency', 'atom.desktop.usage.v1': '{"clock":{"count":7}}', 'atom.desktop.v2': '{"order":["robot","clock"]}', 'atom.app.v1.robot': '{"history":[1]}'};

function shell(initial, backend) {
  const store = new Map(Object.entries(initial));
  const localStorage = {get length() { return store.size; }, key: i => [...store.keys()][i], getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)};
  const calls = [];
  let reloaded = 0;
  const fetch = async (url, options) => {
    const action = url.split('/').pop(), body = JSON.parse(options.body);
    calls.push(action);
    let value;
    if (action === 'status') value = {size: backend.saved ? 100 : 0, backups: [], pending: backend.pending || null};
    else if (action === 'recover') { backend.pending = {id: 'p1', data: backend.saved, source: 'recover'}; value = {pending: 'p1'}; }
    else if (action === 'ack') { backend.pending = null; value = {ok: true}; }
    else if (action === 'capture') { if(backend.failSave) return {ok:false,json:async()=>({error:'disk unavailable'})}; backend.saved = body.data; value = {}; }
    else value = {};
    return {ok: true, json: async () => value};
  };
  const timers = [];
  const context = {localStorage, fetch, location: {reload: () => { reloaded++; }}, confirm: () => true,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval() {}, addEventListener() {},
    document: {addEventListener() {}, getElementById: () => null}, window: {}, URL, Blob: class {}, console};
  context.window = context;
  const httpContext = {window: {}, fetch, AbortController, setTimeout, clearTimeout};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/request.js'), 'utf8'), httpContext);
  context.AtomRequest = httpContext.window.AtomRequest;
  vm.runInNewContext(source, context);
  return {store, calls, backend, context, reloaded: () => reloaded, runTimers: async () => { while (timers.length) { await timers.shift()(); await new Promise(r => setImmediate(r)); } }};
}

test('empty browser storage restores the saved copy before defaults are captured', async () => {
  const s = shell({}, {saved: SAVED});
  s.store.set('atom.desktop.v2', '{"order":["default"]}');  // what app.js writes on first load
  await s.runTimers();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(s.calls.includes('recover'));
  assert.ok(!s.calls.includes('capture'), 'defaults never replace the saved copy');
  assert.equal(s.store.get('atom.desktop.v2'), SAVED['atom.desktop.v2']);
  assert.equal(s.store.get('atom.desktop.sort.v1'), SAVED['atom.desktop.sort.v1']);
  assert.equal(s.store.get('atom.desktop.usage.v1'), SAVED['atom.desktop.usage.v1']);
  assert.equal(s.store.get('atom.app.v1.robot'), SAVED['atom.app.v1.robot']);
  assert.equal(s.reloaded(), 1);
  assert.deepEqual(s.backend.saved, SAVED);
});

test('existing browser data is captured normally and never replaced', async () => {
  const s = shell({'atom.desktop.v2': '{"order":["mine"]}'}, {saved: SAVED});
  await s.runTimers();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(!s.calls.includes('recover'));
  assert.equal(s.store.get('atom.desktop.v2'), '{"order":["mine"]}');
  assert.deepEqual(s.backend.saved, {'atom.desktop.v2': '{"order":["mine"]}'});
});

test('a fresh device with nothing saved just starts capturing', async () => {
  const s = shell({}, {saved: null});
  s.store.set('atom.desktop.v2', '{"order":["default"]}');
  await s.runTimers();
  await new Promise(r => setTimeout(r, 20));
  assert.ok(!s.calls.includes('recover'));
  assert.deepEqual(s.backend.saved, {'atom.desktop.v2': '{"order":["default"]}'});
});

test('application save waits for the device and rolls back failed writes', async () => {
  const s=shell({'atom.app.v1.robot':'{"n":1}'},{saved:SAVED,failSave:true});
  await assert.rejects(s.context.AtomMaintenance.persist('atom.app.v1.robot',{n:2}),/disk unavailable/);
  assert.equal(s.store.get('atom.app.v1.robot'),' {"n":1}'.trim());
  s.backend.failSave=false;
  assert.equal(await s.context.AtomMaintenance.persist('atom.app.v1.robot',{n:3}),true);
  assert.equal(s.backend.saved['atom.app.v1.robot'],'{"n":3}');
});
