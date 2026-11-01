/* Browser check of 像素办公室 in an opaque iframe at 480×360: demo flow, layout bounds, five-way reachability.
   node atom/official/agent-office/ui.integration.cjs [screenshot-dir] */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {chromium, executablePath} = require('../../tools/browser-test-runtime.cjs');
const APP = __dirname, STATIC = path.join(__dirname, '../../static'), shots = process.argv[2];
const PARENT = `<meta charset="utf-8"><style>body{margin:0}iframe{width:480px;height:360px;border:0}</style><iframe sandbox="allow-scripts" src="/app/index.html"></iframe>
<script>let saved=null;window.saves=0;onmessage=e=>{const d=e.data;if(d&&d.type==='atom:storage'){if(d.action==='set'){saved=d.data;saves++;}e.source.postMessage({type:'atom:storage-result',request_id:d.request_id,ok:true,data:saved,mode:'device'},'*');}
// State requests in the first 10 s go unanswered, as when the user leaves the permission sheet open past the client deadline.
const pc={client_id:'pc1',name:'测试电脑',online:true,e2e:'on',projects:[{id:'p1',name:'测试项目'}],agents:['codex','claude','opencode','kimi','pi'].map(id=>({id,name:id,available:true,authenticated:true}))};
if(d&&d.type==='atom:office'&&d.action==='state'&&Date.now()-window.t0>10000)e.source.postMessage({type:'atom:office-result',id:d.id,result:{configured:true,computers:[pc,Object.assign({},pc,{client_id:'pc2',name:'第二台电脑',projects:[]})]}},'*');};window.t0=Date.now();</script>`;

(async () => {
  const browser = await chromium.launch({headless: true, executablePath});
  try {
    for (const scheme of ['light', 'dark']) {
      const page = await browser.newPage({viewport: {width: 480, height: 360}, colorScheme: scheme}), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', r => {
        const v = new URL(r.request().url()).pathname;
        if (v === '/') return r.fulfill({contentType: 'text/html', body: PARENT});
        if (v === '/app/index.html') return r.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(APP, 'index.html'), 'utf8').replace('<head>', '<head><script src="/input-navigation.js"></script><script src="/app-runtime.js"></script>')});
        const file = v.startsWith('/app/') ? path.join(APP, v.slice(5)) : path.join(STATIC, v.slice(1));
        return fs.existsSync(file) ? r.fulfill({path: file}) : r.fulfill({status: 404, body: ''});
      });
      await page.goto('http://atom.test/');
      const f = await (await page.waitForSelector('iframe')).contentFrame();
      await f.waitForFunction(() => window.__office && window.__office.state());
      const shot = name => shots && page.screenshot({path: path.join(shots, scheme + '-' + name + '.png')});
      const overflow = () => f.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
      await page.waitForTimeout(600); await shot('office');
      if (scheme === 'light') {
        // Recovers by itself after a timed-out first check instead of staying on “需升级系统”; two computers → choose one.
        await f.waitForFunction(() => window.__office.conn().kind === 'setup', null, {timeout: 40000});
      }
      assert.equal(await overflow(), false, 'office page overflows');
      if (scheme === 'light') {
        // Setup choices must be reachable with arrows only; the runtime's spatial scoring favours aligned columns.
        await f.click('#btn-setup'); await page.waitForTimeout(200);
        await f.click('[data-computer="pc1"]');
        const missing = await f.evaluate(() => {
          // Setup opens on its first choice; Down then walks every control in document order and Up from the top reaches back.
          const want = [...document.querySelectorAll('#dlg-setup .page-body button:not([hidden]), #dlg-setup .page-body input')], walked = [document.activeElement];
          AtomInput.focus(document.activeElement); // the runtime's first key press only adopts the current focus
          for (let i = 1; i < want.length; i++) { AtomInput.move('ArrowDown'); walked.push(document.activeElement); }
          const lost = want.filter((el, i) => walked[i] !== el).map(el => el.id || el.textContent.trim() || el.value);
          AtomInput.focus(want[0]); AtomInput.move('ArrowUp');
          return document.activeElement === document.querySelector('#dlg-setup .back') ? lost : lost.concat('back');
        });
        assert.deepEqual(missing, [], 'setup controls unreachable by five-way: ' + missing);
        // Every advertised executor can be selected with the shared input runtime, without a hard-coded CLI list.
        for (const id of ['codex','claude','opencode','kimi','pi']) {
          await f.evaluate(id => AtomInput.focus(document.querySelector('[data-agent="'+id+'"]')), id);
          await page.keyboard.press('Enter');
          assert.equal(await f.getAttribute('[data-agent="'+id+'"]', 'aria-pressed'), 'true');
        }

        // Real keys at device pace: open setup from the chip, Down, select. The page must stay open with the second
        // computer chosen (the five-way cursor follows the app's own focus moves; the choice buttons re-render).
        await f.click('#dlg-setup [data-close]'); await page.waitForTimeout(300);
        await f.evaluate(() => AtomInput.focus(document.getElementById('btn-setup'))); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
        await page.keyboard.press('ArrowDown'); await page.waitForTimeout(350); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
        const chosen = await f.evaluate(() => { const now = document.activeElement; return [document.getElementById('dlg-setup').open, now.dataset.computer, now.getAttribute('aria-pressed')]; });
        assert.deepEqual(chosen, [true, 'pc2', 'true']);
        await f.click('#dlg-setup [data-close]'); await page.waitForTimeout(200);
      }

      // Five-way: every primary control is reachable with arrows from the injected back control.
      const reachable = await f.evaluate(() => {
        const start = document.getElementById('atom-app-back'), want = ['btn-assign', 'btn-board', 'btn-reports', 'btn-setup'], seen = new Set(), q = [start];
        while (q.length) { const el = q.shift(); if (!el || seen.has(el)) continue; seen.add(el); for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) { AtomInput.focus(el); AtomInput.move(k); q.push(document.activeElement); } }
        return want.filter(id => !seen.has(document.getElementById(id)));
      });
      assert.deepEqual(reachable, [], 'unreachable controls: ' + reachable);
      assert.ok(await f.evaluate(() => document.querySelectorAll('#spots button').length >= 6), 'desk/table/cabinet spots are buttons');

      // Turn on demo mode and run one goal through plan → confirm → board.
      await f.click('#btn-setup'); await page.waitForTimeout(200); await shot('setup');
      await f.click('#setup-demo'); await f.click('#setup-save');
      await f.waitForFunction(() => window.__office.conn().kind === 'demo');
      await f.click('#btn-assign'); await f.fill('#goal-text', '阅读两份资料、比较结论并生成说明文档'); await shot('goal');
      await f.click('#goal-submit');
      await f.waitForSelector('#plan-confirm:not([hidden])', {timeout: 15000}); await shot('plan');
      assert.match(await f.textContent('#plan-status'), /演示/);
      await f.click('#plan-confirm');
      await f.waitForFunction(() => document.querySelector('#dlg-board').open, null, {timeout: 5000}).catch(() => f.click('#btn-board'));
      await page.waitForTimeout(2500); await shot('board');
      assert.match(await f.textContent('#board-list .goal h3'), /演示/);
      await f.click('#dlg-board [data-close]'); await page.waitForTimeout(1500); await shot('working');
      if (scheme === 'light') {
        // A long report is read with Down alone: the list opens on its row, the report on its first block, Down scrolls.
        await f.waitForFunction(() => window.__office.state().reports.length > 0, null, {timeout: 20000});
        await f.evaluate(() => { const s = window.__office.state(); s.reports[0].preview = Array.from({length: 14}, (_, i) => '## 第' + i + '段\n' + '演示正文'.repeat(20)).join('\n\n'); });
        await f.click('#btn-reports'); await page.waitForTimeout(300);
        assert.ok(await f.evaluate(() => document.activeElement.classList.contains('report-row')), 'report list opens on a row');
        await f.evaluate(() => AtomInput.focus(document.activeElement)); await page.keyboard.press('Enter'); await page.waitForTimeout(400); await shot('report');
        const before = await f.evaluate(() => document.getElementById('report-text').scrollTop);
        for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(120); }
        const after = await f.evaluate(() => { const box = document.getElementById('report-text'), el = document.activeElement, a = el.getBoundingClientRect(), b = box.getBoundingClientRect();
          return [box.scrollTop, [...box.children].indexOf(el), a.top >= b.top - 1 && a.bottom <= b.bottom + 1]; });
        assert.ok(after[0] > before && after[1] >= 7 && after[2], 'Down walks and scrolls the report: ' + JSON.stringify([before, after]));
        await page.keyboard.press('Escape'); await page.waitForTimeout(200); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      }
      assert.equal(await overflow(), false, 'working office overflows');
      assert.deepEqual(errors, [], scheme + ' page errors');
      await page.close();
    }
    await appReports(browser);
    await approvalsPage(browser);
    console.log('agent-office ui integration passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });

/* Host mode with a fake shell: app reports offer 试玩 / 放到桌面 with five-way, the office reopens on the report after a
   preview, and a text report holding a web page becomes a confirmed `app` task. */
const HTML_REPORT = '## 完成内容\n番茄钟代码如下。\n\n```html\n<!doctype html><title>番茄钟</title>\n```';
const SEED = {v: 1, draft: '', demo: false, target: {computer_id: 'pc1', project_id: 'p1', agent_id: 'codex'}, mission: null, resume: {report: 'rapp1'},
  reports: [{id: 'rapp1', mission_id: 'm1', staff: 'engineer', title: '做成应用：番茄钟', preview: '应用已生成，可以预览并安装。', task_id: 'app-task', status: 'completed', read: false, announced: true, demo: false, at: 1, app: true},
    {id: 'rbad1', mission_id: 'm2', staff: 'engineer', title: '做成应用：番茄钟', preview: '应用已生成，可以预览并安装。', task_id: 'bad-task', status: 'completed', read: true, announced: true, demo: false, at: 0, app: true, remake: {title: '做成应用：番茄钟', deliverable: '改写成 ATOM 应用', source_task: 't-html'}},
    {id: 'rhtml1', mission_id: 'm0', staff: 'engineer', title: '制作番茄钟', preview: HTML_REPORT, task_id: 't-html', status: 'completed', read: true, announced: true, demo: false, at: 0}]};
const HOST_PARENT = `<meta charset="utf-8"><style>body{margin:0}iframe{width:480px;height:360px;border:0}</style><iframe sandbox="allow-scripts" src="/app/index.html"></iframe>
<script>let saved=${JSON.stringify(SEED)};window.calls=[];window.saved=()=>saved;
const pc={client_id:'pc1',name:'测试电脑',online:true,e2e:'on',projects:[{id:'p1',name:'测试项目'}],agents:[{id:'codex',name:'Codex',available:true,authenticated:true}]};
onmessage=e=>{const d=e.data;if(!d)return;if(d.type==='atom:storage'){if(d.action==='set')saved=d.data;e.source.postMessage({type:'atom:storage-result',request_id:d.request_id,ok:true,data:saved,mode:'device'},'*');return;}
if(d.type!=='atom:office')return;calls.push([d.action,d.data]);const ok=result=>e.source.postMessage({type:'atom:office-result',id:d.id,result},'*');
if(d.action==='state')ok({configured:true,computers:[pc]});
else if(d.action==='task-events')ok(d.data.task_id==='t-html'?{task:{id:'t-html',status:'completed'},events:[{seq:1,type:'result',status:'completed',text:${JSON.stringify(HTML_REPORT)}}]}:{task:{id:d.data.task_id,status:'queued'},events:[]});
else if(d.action==='create-task')ok({task:{id:'new-app-task',status:'queued',last_seq:0}});
else if(d.action==='preview-app'&&d.data.task_id==='bad-task')e.source.postMessage({type:'atom:office-result',id:d.id,error:'五向输入规范：多级页面须注册 AtomApp.navigation.setBackHandler',status:400},'*');
else if(d.action==='preview-app')ok({ok:true,name:'番茄钟'});
else if(d.action==='install-app')ok({ok:true,app:{id:'pomodoro',name:'番茄钟'}});};</script>`;
async function appReports(browser) {
  const page = await browser.newPage({viewport: {width: 480, height: 360}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => {
    const v = new URL(r.request().url()).pathname;
    if (v === '/') return r.fulfill({contentType: 'text/html', body: HOST_PARENT});
    if (v === '/app/index.html') return r.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(APP, 'index.html'), 'utf8').replace('<head>', '<head><script src="/input-navigation.js"></script><script src="/app-runtime.js"></script>')});
    const file = v.startsWith('/app/') ? path.join(APP, v.slice(5)) : path.join(STATIC, v.slice(1));
    return fs.existsSync(file) ? r.fulfill({path: file}) : r.fulfill({status: 404, body: ''});
  });
  await page.goto('http://atom.test/');
  const f = await (await page.waitForSelector('iframe')).contentFrame();
  const calls = () => page.evaluate(() => window.calls.map(c => c[0]));
  // Back from a preview: the office reopens on that report, focused on 试玩, and forgets the hand-off.
  await f.waitForFunction(() => document.getElementById('dlg-report').open);
  assert.equal(await f.evaluate(() => document.activeElement.id), 'report-try');
  assert.equal(await page.evaluate(() => window.saved().resume), undefined, 'resume is consumed once');
  assert.equal(await f.isVisible('#report-convert'), false, 'app reports are not converted again');
  assert.equal(await f.textContent('#report-remake'), '重做', 'a working app can still be made again');
  if (shots) await page.screenshot({path: path.join(shots, 'app-report.png')});
  await f.evaluate(() => AtomInput.focus(document.activeElement));
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => window.calls.filter(c => c[0] === 'preview-app').map(c => c[1].task_id)), ['app-task']);
  assert.deepEqual(await page.evaluate(() => window.saved().resume), {report: 'rapp1'}, 'the report is remembered before the preview leaves the office');
  // 放到桌面 is one Right away; after the shell confirms, the button settles on 已在桌面.
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
  assert.equal(await f.evaluate(() => document.activeElement.id), 'report-install');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  assert.ok((await calls()).includes('install-app'));
  assert.deepEqual(await f.evaluate(() => [document.getElementById('report-install').textContent, document.getElementById('report-install').disabled]), ['已在桌面', true]);
  // The HTML report offers 做成应用 → a single engineer app package, confirmed before dispatch.
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await f.click('[data-report="rhtml1"]');
  await f.waitForSelector('#report-convert:not([hidden])');
  assert.equal(await f.isVisible('#report-try'), false);
  await f.click('#report-convert'); await page.waitForTimeout(300);
  assert.ok(await f.evaluate(() => document.getElementById('dlg-plan').open), 'plan opens for confirmation');
  assert.equal((await calls()).filter(c => c === 'create-task').length, 0, 'nothing is dispatched before confirmation');
  if (shots) await page.screenshot({path: path.join(shots, 'convert-plan.png')});
  await f.click('#plan-confirm'); await page.waitForTimeout(2500);
  const create = await page.evaluate(() => window.calls.find(c => c[0] === 'create-task')[1]);
  assert.equal(create.kind, 'app'); assert.match(create.prompt, /<title>番茄钟<\/title>/);
  // A bundle the device refuses: the reason shows inside the report and 试玩 gives way to 重新制作, which carries the reason.
  await f.evaluate(() => { const s = window.__office.state(); s.missions = []; });
  await f.click('#btn-reports'); await page.waitForTimeout(300); await f.click('[data-report="rbad1"]'); await page.waitForTimeout(300);
  await f.click('#report-try'); await page.waitForTimeout(500);
  assert.match(await f.textContent('#report-status'), /没有接受这个应用：五向输入规范/);
  assert.deepEqual(await f.evaluate(() => [document.activeElement.id, document.getElementById('report-try').hidden]), ['report-remake', true]);
  if (shots) await page.screenshot({path: path.join(shots, 'app-refused.png')});
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  assert.match(await f.textContent('#plan-list'), /重新制作：番茄钟/);
  await f.click('#plan-confirm'); await page.waitForTimeout(2500);
  const remake = await page.evaluate(() => window.calls.filter(c => c[0] === 'create-task').pop()[1]);
  assert.match(remake.prompt, /没有通过小电脑检查：五向输入规范/); assert.match(remake.prompt, /<title>番茄钟<\/title>/);
  assert.equal(await f.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, [], 'app report page errors');
  await page.close();
}

/* 申请表: every staff member's pending request in one list, decided with five-way, feedback inside the dialog.
   Both requests are numbered 0 (executors number per session) and must not be confused. */
const STAFF = {researcher: {name: '小研', desc: 'd'}, writer: {name: '小文', desc: 'd'}, engineer: {name: '小工', desc: 'd'}, coordinator: {name: '小序', desc: 'd'}};
const pk = (staff, task) => ({id: 'p1', staff, title: staff, deliverable: 'd', depends_on: [], modifies_files: false, status: 'running', attempt: 1, request_id: 'req' + staff, task_id: task, after: 0, approval: null, preview: '', error: '', reported: false, stopping: false});
const APPROVAL_SEED = {v: 1, draft: '', demo: false, staff: STAFF, target: {computer_id: 'pc1', project_id: 'p1', agent_id: 'codex'}, reports: [],
  missions: [['mw', 'writer', 'TW'], ['mr', 'researcher', 'TR']].map(([id, staff, task]) => ({id, goal: staff + '的目标', mode: 'single', assignee: staff, status: 'running', plan_version: 1, plan: {summary: 's', packages: []}, packages: [pk(staff, task)], staff: STAFF, created_at: 1, planTask: null, summaryTask: null, summary: '', note: ''}))};
const APPROVAL_PARENT = `<meta charset="utf-8"><style>body{margin:0}iframe{width:480px;height:360px;border:0}</style><iframe sandbox="allow-scripts" src="/app/index.html"></iframe>
<script>let saved=${JSON.stringify(APPROVAL_SEED)};window.calls=[];const waiting={TW:'rg 资料B',TR:'rg 资料A'};
const pc={client_id:'pc1',name:'测试电脑',online:true,e2e:'on',projects:[{id:'p1',name:'p'}],agents:[{id:'codex',name:'Codex',available:true,authenticated:true}]};
onmessage=e=>{const d=e.data;if(!d)return;if(d.type==='atom:storage'){if(d.action==='set')saved=d.data;e.source.postMessage({type:'atom:storage-result',request_id:d.request_id,ok:true,data:saved,mode:'device'},'*');return;}
if(d.type!=='atom:office')return;calls.push([d.action,d.data]);const ok=r=>e.source.postMessage({type:'atom:office-result',id:d.id,result:r},'*');
if(d.action==='state')ok({configured:true,computers:[pc]});
else if(d.action==='task-events'){const w=waiting[d.data.task_id];ok({task:{id:d.data.task_id,status:w?'waiting_approval':'running'},events:w&&d.data.after<2?[{seq:2,type:'approval',status:'waiting_approval',approval:{request_id:'0',title:'允许执行命令？',detail:w,choices:['accept','decline']}}]:[]});}
else if(d.action==='approve-task'){delete waiting[d.data.task_id];ok({ok:true});}};</script>`;
async function approvalsPage(browser) {
  const page = await browser.newPage({viewport: {width: 480, height: 360}}), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => {
    const v = new URL(r.request().url()).pathname;
    if (v === '/') return r.fulfill({contentType: 'text/html', body: APPROVAL_PARENT});
    if (v === '/app/index.html') return r.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(APP, 'index.html'), 'utf8').replace('<head>', '<head><script src="/input-navigation.js"></script><script src="/app-runtime.js"></script>')});
    const file = v.startsWith('/app/') ? path.join(APP, v.slice(5)) : path.join(STATIC, v.slice(1));
    return fs.existsSync(file) ? r.fulfill({path: file}) : r.fulfill({status: 404, body: ''});
  });
  await page.goto('http://atom.test/');
  const f = await (await page.waitForSelector('iframe')).contentFrame();
  await f.waitForFunction(() => document.getElementById('approvals-badge').textContent === '2', null, {timeout: 15000});
  await f.click('#btn-approvals'); await page.waitForTimeout(300);
  assert.equal(await f.locator('#approvals-list [data-allow]').count(), 2, 'both requests are listed');
  assert.equal(await f.evaluate(() => document.activeElement.dataset.allow), 'writer', '申请表 opens on the first 允许');
  if (shots) await page.screenshot({path: path.join(shots, 'approvals.png')});
  await f.evaluate(() => AtomInput.focus(document.activeElement)); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  assert.match(await f.textContent('#approvals-status'), /已允许，小文继续工作/, 'feedback shows inside the 申请表');
  assert.equal(await f.evaluate(() => document.activeElement.dataset.allow), 'researcher', 'the cursor moves to the next request');
  await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  assert.match(await f.textContent('#approvals-status'), /已允许，小研继续工作/);
  assert.deepEqual(await page.evaluate(() => calls.filter(c => c[0] === 'approve-task').map(c => c[1].task_id + ':' + c[1].request_id)), ['TW:0', 'TR:0']);
  assert.equal(await f.isVisible('#approvals-empty'), true);
  assert.deepEqual(errors, [], 'approvals page errors');
  await page.close();
}
