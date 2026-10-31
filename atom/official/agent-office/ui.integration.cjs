/* Browser check of 像素办公室 in an opaque iframe at 480×360: demo flow, layout bounds, five-way reachability.
   node atom/official/agent-office/ui.integration.cjs [screenshot-dir] */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {chromium, executablePath} = require('../../tools/browser-test-runtime.cjs');
const APP = __dirname, STATIC = path.join(__dirname, '../../static'), shots = process.argv[2];
const PARENT = `<meta charset="utf-8"><style>body{margin:0}iframe{width:480px;height:360px;border:0}</style><iframe sandbox="allow-scripts" src="/app/index.html"></iframe>
<script>let saved=null;window.saves=0;onmessage=e=>{const d=e.data;if(d&&d.type==='atom:storage'){if(d.action==='set'){saved=d.data;saves++;}e.source.postMessage({type:'atom:storage-result',request_id:d.request_id,ok:true,data:saved,mode:'device'},'*');}
// State requests in the first 10 s go unanswered, as when the user leaves the permission sheet open past the client deadline.
const pc={client_id:'pc1',name:'测试电脑',online:true,e2e:'on',projects:[{id:'p1',name:'测试项目'}],agents:[{id:'codex',name:'Codex',available:true,authenticated:true}]};
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
      assert.match(await f.textContent('#board-goal'), /演示/);
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
    console.log('agent-office ui integration passed');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
