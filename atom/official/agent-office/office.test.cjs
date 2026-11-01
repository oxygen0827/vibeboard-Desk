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
// App packages: only the engineer, at most one per plan; other packages never carry the flag.
const appPlan = D.parsePlan(JSON.stringify({summary: 's', packages: [{id: 'p1', staff: 'writer', title: '文案', deliverable: 'd'}, {id: 'p2', staff: 'engineer', title: '番茄钟', deliverable: '可运行', depends_on: ['p1'], app: true}]}));
assert.equal(appPlan.packages[1].app, true); assert.equal('app' in appPlan.packages[0], false);
assert.throws(() => D.parsePlan('{"packages":[{"id":"p1","staff":"writer","title":"t","deliverable":"d","app":true}]}'), /只有工程师/);
assert.equal(D.parsePlan('{"packages":[{"id":"p1","staff":"engineer","title":"t","deliverable":"d","app":"yes"}]}').packages[0].app, undefined, 'only a literal true marks an app');
assert.match(D.planPrompt(D.defaults(), '做个番茄钟'), /"app":true/);
const ap = D.appPrompt(D.defaults(), {goal: '番茄钟', staff: D.defaults().staff}, {title: '番茄钟', deliverable: '25 分钟'}, [{title: '原汇报', staff: 'engineer', text: '<html>旧代码</html>'}]);
assert.match(ap, /480×360/); assert.match(ap, /旧代码/); assert.doesNotMatch(ap, /## 完成内容/, 'app tasks return a bundle, not a report');
// "做成应用": completed real text reports holding a web page; never app or demo reports.
const htmlReport = {id: 'r1', title: '制作番茄钟', status: 'completed', task_id: 't-html', demo: false};
assert.equal(D.convertible(htmlReport, '说明\n```html\n<!doctype html><p>x</p>\n```'), true);
assert.equal(D.convertible(htmlReport, '只有文字说明'), false);
assert.equal(D.convertible(Object.assign({}, htmlReport, {app: true}), '```html'), false);
assert.equal(D.convertible(Object.assign({}, htmlReport, {demo: true}), '```html'), false);
const conv = D.appMission(D.defaults(), {id: 'm-app', report: htmlReport, target: {computer_id: 'c', project_id: 'p', agent_id: 'codex'}, now: 1});
assert.equal(conv.status, 'awaiting_confirm'); assert.equal(conv.plan.packages.length, 1);
assert.deepEqual([conv.plan.packages[0].staff, conv.plan.packages[0].app, conv.plan.packages[0].source_task], ['engineer', true, 't-html']);
assert.equal(D.confirm(conv, 1).packages[0].app, true, 'confirmation keeps the app flag');
assert.doesNotMatch(D.appPrompt(D.defaults(), conv, conv.packages[0], []), /Chromium 91|别名/, 'shared policy rules are not copied into the office prompt');
// "重新制作": an app report the device refused is made again from its saved request, with the refusal reason.
const refusedReport = {id: 'r2', title: '做成应用：制作番茄钟', app: true, status: 'completed', task_id: 'bad', problem: '五向输入规范：多级页面须注册 AtomApp.navigation.setBackHandler',
  remake: {title: '做成应用：制作番茄钟', deliverable: '改写成完整的 ATOM 应用', source_task: 't-html'}};
const again = D.appMission(D.defaults(), {id: 'm-again', report: refusedReport, target: {computer_id: 'c', project_id: 'p', agent_id: 'codex'}, now: 2});
assert.deepEqual([again.plan.packages[0].title, again.plan.packages[0].source_task], ['重新制作：制作番茄钟', 't-html']);
assert.match(D.appPrompt(D.defaults(), again, again.plan.packages[0], []), /没有通过小电脑检查：五向输入规范/);
// A saved preview hand-off survives normalisation; junk does not.
assert.deepEqual(D.normalize(Object.assign(D.defaults(), {resume: {report: 'r1'}})).resume, {report: 'r1'});
assert.equal(D.normalize(Object.assign(D.defaults(), {resume: {report: '../x'}})).resume, undefined);

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
  D.addMission(state, D.newMission(state, {id: 'm1', goal: '阅读两份资料、比较结论并生成说明文档', mode: 'team', target: state.target, demo: true, now: 0}));
  assert.equal(D.staffActivity(state, 'coordinator', 'ok').kind, 'working');
  const step = async ms => { t += ms; await runner.tick(); };
  await step(0);
  assert.equal(sent.filter(s => s[0] === 'create-task').length, 1, 'plan task created once');
  for (let i = 0; i < 5; i++) await step(1000);
  assert.equal(state.missions[0].status, 'awaiting_confirm');
  assert.equal(state.missions[0].plan.packages.length, 3);
  // Idle staff never look busy before confirmation.
  assert.equal(D.staffActivity(state, 'researcher', 'ok').kind, 'idle');
  D.confirm(state.missions[0], state.missions[0].plan_version);
  await step(0);
  const pk = id => state.missions[0].packages.find(p => p.id === id);
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
  await runner.approve('engineer', 'accept');
  await assert.rejects(() => runner.approve('engineer', 'accept'), /失效|提交过/);
  for (let i = 0; i < 25; i++) await step(1000);
  assert.equal(pk('p2').status, 'completed');
  assert.equal(pk('p3').status, 'completed');
  for (let i = 0; i < 8; i++) await step(1000);
  assert.equal(state.missions[0].status, 'completed');
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
  D.addMission(state, D.newMission(state, {id: 'm2', goal: '写一段介绍', mode: 'single', assignee: 'writer', target: state.target, demo: true, now: 0}));
  assert.equal(state.missions[0].status, 'awaiting_confirm');
  assert.throws(() => D.confirm(state.missions[0], 99), /变化/);

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
  await appFlow();
  await parallelFlow();
  await approvalsFlow();
  console.log('office tests passed');
}
// An app package becomes a Connect `app` task built from the original report, and reports back as an app.
async function appFlow() {
  const state = D.defaults(); state.target = {computer_id: 'c', project_id: 'p', agent_id: 'codex'};
  const calls = [], reports = []; let status = 'running', n = 0;
  const client = {parallel: 1, dispose() {}, async send(a, d) {
    calls.push([a, d]);
    if (a === 'create-task') return {task: {id: 'app-task', status: 'queued', last_seq: 0}};
    if (a === 'task-events' && d.task_id === 't-html') return {task: {id: 't-html', status: 'completed'}, events: [{seq: 1, type: 'result', status: 'completed', text: '```html\n<!doctype html><title>番茄钟</title>\n```'}]};
    if (a === 'task-events') return {task: {id: 'app-task', status}, events: status === 'completed' ? [{seq: 2, type: 'result', status: 'completed', text: '应用已生成，可以预览并安装。'}] : []};
    if (a === 'preview-app' || a === 'install-app') return {ok: true, app: {id: 'pomodoro', name: '番茄钟'}};
    throw Error(a);
  }};
  const clock = {wall: () => 5, monotonic: () => 5};
  const runner = Runner.create({domain: D, getState: () => state, persist: async () => {}, client, clock, newId: () => 'req' + (++n) + 'abcdefgh', onReport: r => reports.push(r), onChange() {}});
  D.addMission(state, D.appMission(state, {id: 'm-app', report: {title: '制作番茄钟', task_id: 't-html'}, target: state.target, now: 1}));
  D.confirm(state.missions[0], 1);
  await runner.tick();
  const create = calls.find(c => c[0] === 'create-task')[1];
  assert.equal(create.kind, 'app'); assert.match(create.prompt, /<title>番茄钟<\/title>/, 'app prompt carries the original report text');
  status = 'completed'; await runner.tick();
  assert.equal(state.missions[0].status, 'completed');
  assert.equal(reports.length, 1); assert.equal(reports[0].app, true); assert.equal(reports[0].task_id, 'app-task');
  assert.deepEqual(reports[0].remake.source_task, 't-html', 'the app report keeps its request for 重新制作');
  await runner.previewApp('app-task'); await runner.installApp('app-task');
  assert.deepEqual(calls.slice(-2).map(c => [c[0], c[1].task_id]), [['preview-app', 'app-task'], ['install-app', 'app-task']]);
  // Ordinary packages still create plain tasks.
  const plain = []; const r2 = Runner.create({domain: D, getState: () => s2, persist: async () => {}, client: {parallel: 1, dispose() {}, async send(a, d) { plain.push(d); return {task: {id: 'x', status: 'queued'}}; }}, clock, newId: () => 'plainreq' + (++n), onReport() {}, onChange() {}});
  const s2 = D.defaults(); s2.target = state.target;
  D.addMission(s2, D.newMission(s2, {id: 'm2', goal: '写说明', mode: 'single', assignee: 'writer', target: s2.target, now: 1})); D.confirm(s2.missions[0], 1);
  await r2.tick(); assert.equal(plain[0].kind, 'task');
}
// Each staff member runs their own goal; an older one-task computer answering busy only delays a package.
async function parallelFlow() {
  const target = {computer_id: 'c', project_id: 'p', agent_id: 'codex'};
  // Saved records from the one-goal version become a one-item list.
  const migrated = D.normalize(Object.assign(D.defaults(), {missions: undefined, mission: {id: 'old1', status: 'completed', packages: [], staff: D.defaults().staff}}));
  assert.deepEqual(migrated.missions.map(m => m.id), ['old1']);
  const state = D.defaults(); state.target = target;
  let t = 1000, n = 0, k = 0, refuseFirst = true; const created = [], status = {};
  const client = {parallel: 3, dispose() {}, async send(a, d) {
    if (a === 'create-task') {
      const id = 'task' + (++k); created.push([id, d.prompt.split('\n')[1]]);
      status[id] = refuseFirst && k === 1 ? 'busy' : 'running'; return {task: {id, status: 'queued'}};
    }
    if (a === 'task-events') { const st = status[d.task_id];
      if (st === 'busy') return {task: {id: d.task_id, status: 'failed'}, events: [{seq: 1, type: 'error', status: 'failed', text: '电脑正在执行另一个任务，请稍后重试'}]};
      return {task: {id: d.task_id, status: st}, events: st === 'completed' ? [{seq: 2, type: 'result', status: 'completed', text: '## 完成内容\n好'}] : []}; }
    throw Error(a);
  }};
  const runner = Runner.create({domain: D, getState: () => state, persist: async () => {}, client, clock: {wall: () => t, monotonic: () => t}, newId: () => 'req' + (++n) + 'abcdefgh', onReport() {}, onChange() {}});
  const give = (id, assignee, goal) => { const m = D.newMission(state, {id, goal, mode: 'single', assignee, target, now: t}); D.addMission(state, m); D.confirm(m, 1, state); return m; };
  const write = give('mw', 'writer', '写介绍');
  assert.match(D.assignBlock(state, 'single', 'writer'), /小文正在忙/); assert.equal(D.assignBlock(state, 'single', 'researcher'), '');
  const research = give('mr', 'researcher', '查资料');
  await runner.tick();
  assert.equal(created.length, 2, 'both staff members start at once');
  assert.equal(D.staffActivity(state, 'researcher', 'ok').kind, 'working');
  // The first task met an old computer that was busy: it waits, then goes out again instead of failing.
  await runner.tick();
  assert.equal(write.packages[0].status, 'queued'); assert.equal(write.packages[0].error, '');
  assert.match(D.staffActivity(state, 'writer', 'ok').reason, /电脑正忙/);
  await runner.tick(); assert.equal(created.length, 2, 'no resend before the retry time');
  t += D.BUSY_RETRY_MS + 1; await runner.tick();
  assert.equal(created.length, 3); assert.equal(write.packages[0].status, 'running');
  // A team plan cannot start someone who is busy elsewhere.
  const team = D.newMission(state, {id: 'mt', goal: '团队', mode: 'team', target, now: t}); D.addMission(state, team);
  D.applyPlan(team, D.parsePlan('{"packages":[{"id":"p1","staff":"writer","title":"写","deliverable":"d"}]}'));
  assert.throws(() => D.confirm(team, team.plan_version, state), /小文正在忙/);
  // Finishing one goal frees that staff member without touching the other.
  for (const k of Object.keys(status)) if (status[k] === 'running') status[k] = 'completed';
  await runner.tick();
  assert.equal(research.status, 'completed'); assert.equal(write.status, 'completed');
  assert.doesNotThrow(() => D.confirm(team, team.plan_version, state));
}
// Executors number requests per session, so two staff can both be waiting on request "0".
async function approvalsFlow() {
  const target = {computer_id: 'c', project_id: 'p', agent_id: 'codex'}, state = D.defaults(); state.target = target;
  const approvals = {}, sent = []; let k = 0, n = 0;
  const client = {parallel: 3, dispose() {}, async send(a, d) {
    if (a === 'create-task') return {task: {id: 'T' + (++k), status: 'queued'}};
    if (a === 'task-events') { const ap = approvals[d.task_id];
      return {task: {id: d.task_id, status: ap ? 'waiting_approval' : 'running'}, events: ap && d.after < ap.seq ? [{seq: ap.seq, type: 'approval', status: 'waiting_approval', approval: {request_id: ap.id, title: '允许执行命令？', detail: ap.detail}}] : []}; }
    if (a === 'approve-task') { sent.push(d.task_id + ':' + d.request_id); delete approvals[d.task_id]; return {ok: true}; }
    throw Error(a);
  }};
  const runner = Runner.create({domain: D, getState: () => state, persist: async () => {}, client, clock: {wall: () => 1, monotonic: () => 1}, newId: () => 'req' + (++n) + 'abcdefgh', onReport() {}, onChange() {}});
  for (const [id, who] of [['mw', 'writer'], ['mr', 'researcher']]) { const m = D.newMission(state, {id, goal: who, mode: 'single', assignee: who, target, now: 1}); D.addMission(state, m); D.confirm(m, 1, state); }
  await runner.tick();
  const task = who => state.missions.find(m => m.assignee === who).packages[0].task_id;
  approvals[task('writer')] = {seq: 3, id: '0', detail: 'rg A'}; await runner.tick();
  await runner.approve('writer', 'accept');
  approvals[task('researcher')] = {seq: 3, id: '0', detail: 'rg B'}; await runner.tick();
  assert.deepEqual(D.pendingApprovals(state).map(a => a.staff), ['researcher'], 'the second staff member\'s request 0 is not mistaken for the first');
  await runner.approve('researcher', 'accept');
  assert.deepEqual(sent, [task('writer') + ':0', task('researcher') + ':0']);
  assert.deepEqual(D.pendingApprovals(state), []);
}
run().catch(e => { console.error(e); process.exit(1); });
