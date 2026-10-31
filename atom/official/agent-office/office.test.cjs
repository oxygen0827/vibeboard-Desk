/* Node tests: plan parsing, mission flow with the simulated client, idempotency, approvals, scene rules. */
const assert = require('assert');
const D = require('./office-domain.js'), C = require('./office-client.js'), Runner = require('./office-runner.js'), Map_ = require('./office-map.js'), Scene = require('./office-scene.js');

// Plan parser is strict.
assert.throws(() => D.parsePlan('好的'), /没有分工/);
assert.throws(() => D.parsePlan('{"packages":[{"id":"p1","staff":"boss","title":"a","deliverable":"b"}]}'), /不存在的员工/);
assert.throws(() => D.parsePlan('{"packages":[{"id":"a","staff":"writer","title":"x","deliverable":"y","depends_on":["b"]},{"id":"b","staff":"researcher","title":"x","deliverable":"y","depends_on":["a"]}]}'), /循环/);
assert.throws(() => D.parsePlan(JSON.stringify({packages: [1, 2, 3, 4].map(i => ({id: 'p' + i, staff: 'writer', title: 't', deliverable: 'd'}))})), /超过/);
const ok = D.parsePlan('说明：{"summary":"s","packages":[{"id":"p1","staff":"researcher","title":"t","deliverable":"d","depends_on":[]}]}');
assert.equal(ok.packages[0].staff, 'researcher');

// Report text becomes escaped, focusable blocks; only headings, list items and bold are interpreted.
const blocks = D.reportBlocks('## 完成内容\n\n资料A<b>x</b> **重点**\n第二行\n\n- 一\n- 二\n\n');
assert.deepEqual(blocks.map(b => b.kind), ['h', 'p', 'li', 'li']);
assert.equal(blocks[1].html, '资料A&lt;b&gt;x&lt;/b&gt; <strong>重点</strong><br>第二行');
assert.deepEqual(D.reportBlocks(''), []);
assert.equal(D.reportBlocks('- [资料A.md](/Users/x/p/资料A.md)：要点')[0].html, '资料A.md：要点', 'link targets (absolute paths) are not shown');

// Paths avoid furniture.
const route = Map_.path(Map_.points.boss, Map_.approach.researcher);
assert(route && route.length > 5 && route.every(p => Map_.walkable(p.x, p.y)));
for (const id of D.STAFF) assert(Map_.walkable(Map_.desks[id].seat.x, Map_.desks[id].seat.y), id + ' seat walkable');

async function run() {
  let t = 0; const clock = {wall: () => 1e12 + t, monotonic: () => t};
  const state = D.defaults(); state.demo = true; state.target = {computer_id: 'demo-pc', project_id: 'demo-project', agent_id: 'codex'};
  let saves = 0, reports = [];
  const client = C.demo({clock, marks: D.marks});
  const sent = [];
  const spy = {parallel: client.parallel, dispose() {}, send(a, d) { sent.push([a, d]); return client.send(a, d); }};
  let n = 0;
  const runner = Runner.create({domain: D, getState: () => state, persist: async () => { saves++; }, client: spy, clock, newId: () => 'id' + (++n) + 'xxxxxxxx', onReport: r => reports.push(r), onChange() {}});
  state.mission = D.newMission(state, {id: 'm1', goal: '阅读两份资料、比较结论并生成说明文档', mode: 'team', target: state.target, demo: true, now: 0});
  assert.equal(D.staffActivity(state, 'coordinator', 'ok').kind, 'working');
  const step = async ms => { t += ms; await runner.tick(); };
  await step(0);
  assert.equal(sent.filter(s => s[0] === 'create-task').length, 1, 'plan task created once');
  for (let i = 0; i < 5; i++) await step(1000);
  assert.equal(state.mission.status, 'awaiting_confirm');
  assert.equal(state.mission.plan.packages.length, 3);
  // Idle staff never look busy before confirmation.
  assert.equal(D.staffActivity(state, 'researcher', 'ok').kind, 'idle');
  D.confirm(state.mission, state.mission.plan_version);
  await step(0);
  const pk = id => state.mission.packages.find(p => p.id === id);
  assert.equal(pk('p2').status, 'queued', 'writer waits for research');
  assert.match(D.staffActivity(state, 'writer', 'ok').reason, /等待/);
  assert(['running', 'starting'].includes(pk('p1').status) && ['running', 'starting'].includes(pk('p3').status), 'independent packages overlap (simulated parallel)');
  for (let i = 0; i < 6; i++) await step(1000);
  assert.equal(pk('p3').status, 'waiting_approval');
  assert.equal(D.staffActivity(state, 'engineer', 'ok').kind, 'approval');
  // Approval for engineer does not block the researcher.
  for (let i = 0; i < 3; i++) await step(1000);
  assert.equal(pk('p1').status, 'completed');
  assert.equal(reports.filter(r => r.staff === 'researcher').length, 1);
  await runner.approve('p3', 'accept');
  await assert.rejects(() => runner.approve('p3', 'accept'), /失效|提交过/);
  for (let i = 0; i < 25; i++) await step(1000);
  assert.equal(pk('p2').status, 'completed');
  assert.equal(pk('p3').status, 'completed');
  for (let i = 0; i < 8; i++) await step(1000);
  assert.equal(state.mission.status, 'completed');
  assert.equal(reports.length, 4, 'three packages + one summary, each reported once');
  for (let i = 0; i < 5; i++) await step(1000);
  assert.equal(reports.length, 4, 'no duplicate reports on later polls');
  const creates = sent.filter(s => s[0] === 'create-task').map(s => s[1].request_id);
  assert.equal(new Set(creates).size, creates.length, 'unique request ids');

  // Idempotent re-send: same request id returns the same task.
  const a = await client.send('create-task', {request_id: 'same', prompt: D.marks.WORK_MARK + '\n你是研究员'});
  const b = await client.send('create-task', {request_id: 'same', prompt: D.marks.WORK_MARK + '\n你是研究员'});
  assert.equal(a.task.id, b.task.id);

  // Single-staff mode skips the model plan but still needs confirmation; sequential client runs one at a time.
  state.mission = D.newMission(state, {id: 'm2', goal: '写一段介绍', mode: 'single', assignee: 'writer', target: state.target, demo: true, now: 0});
  assert.equal(state.mission.status, 'awaiting_confirm');
  assert.throws(() => D.confirm(state.mission, 99), /变化/);

  // Partial failure is reported as partial and retry only re-runs failed nodes.
  const m = {status: 'running', packages: [{id: 'p1', status: 'completed', depends_on: []}, {id: 'p2', status: 'failed', depends_on: [], attempt: 1}], summaryTask: {status: 'completed'}};
  D.settle(m); assert.equal(m.status, 'partial');
  D.retry(m); assert.equal(m.packages[0].status, 'completed'); assert.equal(m.packages[1].status, 'queued'); assert.equal(m.packages[1].attempt, 2);

  // Scene: report walk happens once, reporters do not share a slot.
  let now = 0; const sc = Scene.create({map: Map_, random: () => 0.5});
  sc.reset(0);
  const idle = {researcher: {kind: 'idle'}, writer: {kind: 'idle'}, engineer: {kind: 'idle'}, coordinator: {kind: 'idle'}};
  sc.announce('researcher', 0); sc.announce('writer', 0); sc.announce('researcher', 0);
  for (let i = 0; i < 80; i++) { now += 100; sc.update(now, 100, idle); }
  const r1 = sc.position('researcher'), r2 = sc.position('writer');
  assert(!(Math.round(r1.x) === Math.round(r2.x) && Math.round(r1.y) === Math.round(r2.y)), 'separate report slots');
  for (let i = 0; i < 200; i++) { now += 100; sc.update(now, 100, idle); }
  assert.equal(sc.pendingReports(), 0);
  const seat = Map_.desks.researcher.seat, p = sc.position('researcher');
  assert(Math.round(p.x) === seat.x && Math.round(p.y) === seat.y, 'returns to desk');
  // Reduced motion: no walking at all.
  sc.setMotion(false, now); sc.walkBoss('engineer'); sc.update(now + 100, 100, idle);
  assert.equal(sc.moving(), false);
  console.log('office tests passed');
}
run().catch(e => { console.error(e); process.exit(1); });
