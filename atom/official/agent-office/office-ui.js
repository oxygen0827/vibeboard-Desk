/* Application controller and DOM adapter. Owns lifecycle, persistence, polling and rendering cadence.
   Rendering and the scene never create or change tasks; only explicit user intents reach the runner. */
(function(root) {
  'use strict';
  function create({document: doc, window: win, host, domain, map, clients, Runner, scene, renderer, clock}) {
    const $ = id => doc.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
    const R = domain.ROLES, painted = {};
    // Re-render lists only when content changes, so a focused button is not destroyed by polling.
    function setHtml(id, html) { if (painted[id] !== html) { painted[id] = html; $(id).innerHTML = html; } }
    let state = domain.defaults(), loaded = false, readFailed = false, disposed = false;
    let client = null, runner = null, conn = {kind: 'checking', text: '检查连接…', computers: []};
    let pollTimer = 0, pollDelay = 1500, frameTimer = 0, raf = 0, lastFrame = 0, motion = true, systemMotion = true;
    let saveChain = Promise.resolve(), stack = [], goalMode = {mode: 'team', assignee: null}, staffOpen = null, reportOpen = null, planOpen = null, cancelArmed = {id: null, until: 0}, setupDraft = null, focusSpot = null;
    const media = win.matchMedia('(prefers-reduced-motion: reduce)');
    const newId = () => 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

    /* ---------- persistence: confirmed saves only, never overwrite after a failed read ---------- */
    function compact() {
      let text = JSON.stringify(state);
      while (text.length > 60000 && state.reports.length > 2) { state.reports.pop(); text = JSON.stringify(state); }
      return JSON.parse(text);
    }
    function persist() {
      if (readFailed || !loaded) return Promise.reject(Error('读取失败，暂不保存'));
      const snapshot = compact();
      const run = saveChain.then(() => host.save(snapshot));
      saveChain = run.catch(() => {});
      return run.then(r => { refresh(); return r; }, e => { say('保存失败：' + e.message, true); refresh(); throw e; });
    }

    /* ---------- feedback ---------- */
    let statusUntil = 0;
    function say(text, sticky) { const s = $('status'); s.textContent = text; s.hidden = !text; statusUntil = sticky ? Infinity : clock.monotonic() + 3500; }
    function expireStatus() { if (clock.monotonic() > statusUntil && !focusSpot) $('status').hidden = true; }

    /* ---------- connection ---------- */
    function useClient() {
      if (client) client.dispose();
      client = state.demo ? clients.demo({clock, marks: domain.marks}) : clients.host({window: win});
      runner = Runner.create({domain, getState: () => state, persist, client, clock, newId, onReport, onChange: refresh});
    }
    function pickComputer() { return conn.computers.find(c => state.target && c.client_id === state.target.computer_id); }
    async function checkConnection() {
      conn = {kind: 'checking', text: '检查连接…', computers: conn.computers};
      refreshChip();
      try {
        const s = await runner.state();
        conn.computers = Array.isArray(s.computers) ? s.computers : [];
        if (!s.configured) conn = {kind: 'setup', text: '未连接电脑', detail: '请先在「我的电脑」配对电脑', computers: []};
        else if (!conn.computers.length) conn = {kind: 'setup', text: '没有已配对电脑', detail: '请在「我的电脑」完成配对', computers: []};
        else {
          if (!pickComputer() && conn.computers.length === 1) autoTarget(conn.computers[0]);
          const c = pickComputer();
          if (!c) conn.kind = 'setup', conn.text = '选择电脑', conn.detail = '请选择执行任务的电脑和项目';
          else if (!c.online) conn.kind = 'warn', conn.text = c.name + ' 离线', conn.detail = '电脑需开机并运行 ATOM Connect';
          else if (!c.projects.some(p => p.id === state.target.project_id)) conn.kind = 'setup', conn.text = '选择项目', conn.detail = '已选项目不再授权，请重新选择';
          else {
            const a = c.agents.find(x => x.id === state.target.agent_id);
            if (!a || !a.available || !a.authenticated) conn.kind = 'warn', conn.text = '执行器不可用', conn.detail = a ? a.reason || '执行器未登录' : '请选择执行器';
            else conn.kind = state.demo ? 'demo' : 'ready', conn.text = state.demo ? '演示模式' : c.name + ' · 在线', conn.detail = '';
          }
        }
      } catch (e) {
        conn = {kind: e.code === 'unsupported' ? 'unsupported' : e.status === 403 ? 'denied' : 'warn', text: e.code === 'unsupported' ? '需升级系统' : e.status === 403 ? '未授权' : '连接失败', detail: e.message, computers: [], retry: !!e.retryable || e.code === 'timeout'};
      }
      refresh();
    }
    function autoTarget(c) {
      const project = c.projects.length === 1 ? c.projects[0] : null, agent = c.agents.find(a => a.available && a.authenticated);
      if (project && agent) { state.target = {computer_id: c.client_id, project_id: project.id, agent_id: agent.id}; if (loaded && !readFailed) persist().catch(() => {}); }
    }
    const canDispatch = () => conn.kind === 'ready' || conn.kind === 'demo';

    /* ---------- polling: ~1.5 s while tasks run, 5 s idle, backoff to 30 s ---------- */
    function schedulePoll(delay) { win.clearTimeout(pollTimer); if (!disposed && !doc.hidden) pollTimer = win.setTimeout(poll, delay); }
    async function poll() {
      pollTimer = 0;
      if (disposed || doc.hidden || !loaded) return;
      let active = false, ok = true;
      if (conn.retry) { await checkConnection(); if (disposed) return; if (conn.retry) ok = false; }
      try { active = await runner.tick(); } catch (e) { ok = false; }
      if (runner.lastError()) ok = false;
      pollDelay = ok ? (active ? 1500 : 5000) : Math.min(30000, Math.max(3000, pollDelay * 2));
      refresh(); schedulePoll(pollDelay);
    }
    function onReport(r) {
      if (motion && !doc.hidden && scene.announce(r.staff, clock.monotonic())) r.announced = true;
      else r.announced = true; // without motion the unread badge alone carries the news
      refresh(); wake();
    }

    /* ---------- render cadence: 30 fps only while someone walks ---------- */
    function activity() { const out = {}; for (const id of domain.STAFF) out[id] = domain.staffActivity(state, id, runner ? runner.connection() : 'ok'); return out; }
    function paint() {
      const now = clock.monotonic(), act = activity();
      scene.update(now, lastFrame ? now - lastFrame : 0, act); lastFrame = now;
      renderer.render(scene.frame(now, act)); expireStatus();
      return act;
    }
    function loop() {
      raf = 0; frameTimer = 0;
      if (disposed || doc.hidden) return;
      const act = paint();
      if (scene.moving()) raf = win.requestAnimationFrame(() => { frameTimer = win.setTimeout(loop, Math.max(0, 33 - (clock.monotonic() - lastFrame))); });
      else frameTimer = win.setTimeout(loop, scene.animated(act) ? 220 : 1000);
    }
    function wake() { win.cancelAnimationFrame(raf); win.clearTimeout(frameTimer); raf = frameTimer = 0; if (!disposed && !doc.hidden) loop(); }

    /* ---------- DOM: scene hit targets ---------- */
    function spot(id, label, r) {
      const b = doc.createElement('button'); b.className = 'spot'; b.id = 'spot-' + id; b.setAttribute('aria-label', label);
      Object.assign(b.style, {left: r.x / 30 * 100 + '%', top: r.y * 8 / 180 * 100 + '%', width: r.w / 30 * 100 + '%', height: r.h * 8 / 180 * 100 + '%'});
      b.addEventListener('click', () => intent(id));
      const show = () => { focusSpot = id; caption(id); }, hide = () => { if (focusSpot === id) { focusSpot = null; $('status').hidden = true; } };
      b.addEventListener('focus', show); b.addEventListener('pointerenter', show); b.addEventListener('blur', hide); b.addEventListener('pointerleave', hide);
      $('spots').appendChild(b);
    }
    function mountSpots() {
      for (const id of domain.STAFF) { const d = map.desks[id]; spot(id, R[id].role, {x: d.x, y: d.y - 1, w: d.w, h: d.seat.y - d.y + 2}); }
      spot('meeting', '会议桌：派任务给小队', {x: 12, y: 6, w: 6, h: 5});
      spot('cabinet', '资料柜：查看汇报', {x: 18, y: 3, w: 3, h: 3});
    }
    function caption(id) {
      const s = $('status');
      if (map.desks[id]) { const a = domain.staffActivity(state, id, runner.connection()); s.textContent = state.staff[id].name + ' · ' + R[id].role + ' · ' + a.reason; }
      else s.textContent = id === 'meeting' ? '会议桌 · 派任务给小队' : '资料柜 · 汇报 ' + state.reports.length + ' 份';
      s.hidden = false; statusUntil = Infinity;
    }
    function intent(id) {
      if (map.desks[id]) { scene.walkBoss(id); wake(); openStaff(id); }
      else if (id === 'meeting') { scene.walkBoss('meeting'); wake(); openGoal('team'); }
      else if (id === 'cabinet') { scene.walkBoss('cabinet'); wake(); open('dlg-reports'); }
    }

    /* ---------- dialogs with a back stack and focus restore ---------- */
    // Programmatic focus goes through the injected input runtime so its five-way cursor follows; plain focus() leaves it behind.
    function focusEl(el) { if (!el) return; if (win.AtomInput && typeof win.AtomInput.focus === 'function') win.AtomInput.focus(el); else el.focus(); }
    function open(id, opener) {
      const d = $(id);
      if (!d.open) { stack.push({id, opener: opener || doc.activeElement}); d.showModal(); }
      render(id);
      // Setup starts on its current (or first) choice and the report list on its newest row, not on actions or back.
      const first = d.querySelector('[data-default]:not([hidden]):not(:disabled)') || d.querySelector('.choices [aria-pressed=true]:not(:disabled)') || d.querySelector('.choices button:not(:disabled)') || d.querySelector('.report-row') ||
        d.querySelector('.page-actions:not(.stacked) button:not([hidden]):not(:disabled)') || d.querySelector('button:not([hidden])');
      if (first) focusEl(first);
    }
    function close(id) {
      const i = stack.findIndex(s => s.id === id); if (i < 0) return;
      const [entry] = stack.splice(i, 1); const d = $(id); if (d.open) d.close();
      if (id === 'dlg-staff') staffOpen = null;
      if (id === 'dlg-report') reportOpen = null;
      if (entry.opener && entry.opener.isConnected && typeof entry.opener.focus === 'function') focusEl(entry.opener);
      refresh();
    }
    function back() { if (stack.length) close(stack[stack.length - 1].id); else host.home(); }
    function render(id) {
      if (id === 'dlg-staff') renderStaff(); else if (id === 'dlg-goal') renderGoal(); else if (id === 'dlg-plan') renderPlan();
      else if (id === 'dlg-board') renderBoard(); else if (id === 'dlg-reports') renderReports(); else if (id === 'dlg-setup') renderSetup();
      else if (id === 'dlg-approvals') renderApprovals();
    }
    function refresh() {
      if (disposed) return;
      refreshChip();
      const unread = state.reports.filter(r => !r.read).length;
      $('badge').hidden = !unread; $('badge').textContent = unread;
      const waiting = domain.pendingApprovals(state).length;
      $('approvals-badge').hidden = !waiting; $('approvals-badge').textContent = waiting;
      for (const s of stack) if (s.id !== 'dlg-report' && s.id !== 'dlg-goal' && s.id !== 'dlg-setup') render(s.id);
      if (focusSpot) caption(focusSpot);
    }
    function refreshChip() {
      const chip = $('btn-setup');
      chip.textContent = runner && runner.connection() === 'stale' && domain.open(state).length ? '状态待同步' : conn.text;
      chip.dataset.state = conn.kind === 'ready' ? 'ready' : conn.kind === 'demo' ? 'demo' : conn.kind === 'checking' ? '' : 'warn';
    }

    /* ---------- staff sheet ---------- */
    // Someone showing "！" opens straight onto their request: focus lands on 允许.
    function openStaff(id) { staffOpen = id; renderer.portrait($('portrait'), id); sheetSay('staff-status', ''); open('dlg-staff'); if (!$('staff-approval').hidden) focusEl($('staff-allow')); }
    function renderStaff() {
      const id = staffOpen; if (!id) return;
      const a = domain.staffActivity(state, id, runner.connection()), m = domain.missionFor(state, id), p = m && m.packages.find(x => x.staff === id);
      $('staff-title').textContent = state.staff[id].name + ' · ' + R[id].role;
      $('staff-reason').textContent = a.reason;
      const live = p && p.task_id && ['running', 'waiting_approval'].includes(p.status) ? runner.liveText(p.task_id).slice(-160).trim() : '';
      $('staff-live').hidden = !live; $('staff-live').textContent = live;
      const ap = p && p.status === 'waiting_approval' && p.approval;
      $('staff-approval').hidden = !ap;
      if (ap) $('staff-approval-text').textContent = ap.title + '：' + ap.detail;
      const latest = state.reports.find(r => r.staff === id);
      $('staff-report').hidden = !latest;
      $('staff-assign').textContent = domain.staffBusy(state, id) ? state.staff[id].name + '正在忙' : '交给' + state.staff[id].name;
      $('staff-assign').disabled = domain.staffBusy(state, id);
    }
    // Feedback goes inside the dialog that was used: the office status line sits under modal dialogs.
    function sheetSay(id, text, problem) { const el = $(id); el.textContent = text; el.hidden = !text; el.classList.toggle('problem', !!problem); }
    async function decide(id, decision, where) {
      const target = where || (staffOpen === id ? 'staff-status' : null), name = state.staff[id].name;
      const tell = (text, problem) => target ? sheetSay(target, text, problem) : say(text);
      try { await runner.approve(id, decision); tell(decision === 'accept' ? '已允许，' + name + '继续工作' : '已拒绝，' + name + '不会执行这个操作'); }
      catch (e) { tell(name + '的审批没有提交：' + e.message, true); }
      refresh(); schedulePoll(300);
      // The decided row leaves the 申请表; keep the cursor on the next request.
      if (target === 'approvals-status') focusEl($('approvals-list').querySelector('[data-allow]') || $('dlg-approvals').querySelector('.back'));
    }
    /* ---------- 申请表: every pending request in one place ---------- */
    function renderApprovals() {
      const list = domain.pendingApprovals(state);
      $('approvals-empty').hidden = list.length > 0;
      setHtml('approvals-list', list.map(({staff, mission, pkg}) => '<li class="card"><h4><span>' + esc(state.staff[staff].name + ' · ' + R[staff].role) + '</span><em>' + esc(mission.goal.slice(0, 16)) + '</em></h4>' +
        '<p><b>' + esc(pkg.approval.title) + '</b></p><p class="muted approval-detail">' + esc(pkg.approval.detail) + '</p>' +
        '<div class="row"><button class="primary" data-allow="' + esc(staff) + '">允许</button><button data-deny="' + esc(staff) + '">拒绝</button></div></li>').join(''));
    }

    /* ---------- goal input ---------- */
    function openGoal(mode, assignee) {
      goalMode = {mode, assignee: assignee || null};
      $('goal-text').value = state.draft || '';
      $('goal-status').textContent = '';
      open('dlg-goal');
      const block = domain.assignBlock(state, goalMode.mode, goalMode.assignee);
      if (block) $('goal-status').textContent = block + '。';
    }
    function renderGoal() {
      const single = goalMode.mode === 'single';
      $('goal-title').textContent = single ? '交给' + state.staff[goalMode.assignee].name : '派任务';
      $('goal-who').textContent = single ? '由' + R[goalMode.assignee].role + '「' + state.staff[goalMode.assignee].name + '」独立负责，开工前仍需确认。' : '交给小队：协调员先拟定分工（一次真实模型调用），确认后才开工。';
      $('goal-submit').textContent = single ? '查看安排' : '拟定分工';
      const c = pickComputer(), p = c && c.projects.find(x => x.id === state.target.project_id), ag = c && c.agents.find(x => x.id === state.target.agent_id);
      $('goal-target').textContent = state.demo ? '演示模式：模拟电脑与执行器（更改）' : c ? '电脑 ' + c.name + ' · 项目 ' + (p ? p.name : '未选') + ' · ' + (ag ? ag.name : '未选执行器') + '（更改）' : conn.text + '：' + (conn.detail || '点此设置');
    }
    async function submitGoal() {
      const goal = $('goal-text').value.trim();
      if (!goal) { $('goal-status').textContent = '请先输入目标'; return; }
      const block = domain.assignBlock(state, goalMode.mode, goalMode.assignee);
      if (block) { $('goal-status').textContent = block + '。'; return; }
      if (!canDispatch()) { $('goal-status').textContent = '暂时不能派工：' + conn.text + (conn.detail ? '。' + conn.detail : ''); return; }
      const m = domain.newMission(state, {id: newId(), goal, mode: goalMode.mode, assignee: goalMode.assignee, target: Object.assign({}, state.target), demo: state.demo, now: clock.wall()});
      const previous = {missions: state.missions.slice(), draft: state.draft};
      domain.addMission(state, m); state.draft = '';
      try { await persist(); }
      catch (e) { Object.assign(state, previous); $('goal-status').textContent = '保存失败，没有派工：' + e.message; return; }
      planOpen = m.id; close('dlg-goal'); open('dlg-plan'); schedulePoll(0);
    }
    async function saveDraft() {
      state.draft = $('goal-text').value.slice(0, domain.GOAL_MAX);
      try { await persist(); $('goal-status').textContent = '草稿已保存'; } catch (e) { $('goal-status').textContent = '草稿保存失败：' + e.message; }
    }

    /* ---------- plan ---------- */
    function packageCard(m, p, board) {
      const deps = p.depends_on.map(d => m.packages.concat(m.plan ? m.plan.packages : []).find(x => x.id === d)).filter(Boolean);
      const status = board ? domain.packageLabels[p.status] + (p.stopping && !domain.TERMINAL.includes(p.status) ? ' · 正在停止' : '') + (p.attempt > 1 ? ' · 第 ' + p.attempt + ' 次' : '') : '';
      let html = '<li class="card"><h4><span>' + esc(m.staff[p.staff].name + ' · ' + R[p.staff].role) + '</span><em>' + esc(status) + '</em></h4>' +
        '<p><b>' + esc(p.title) + '</b></p><p class="muted">交付：' + esc(p.deliverable) + '</p>' +
        (deps.length ? '<p class="muted">依赖：' + esc(deps.map(d => m.staff[d.staff].name + '的「' + d.title + '」').join('、')) + '</p>' : '<p class="muted">无依赖</p>') +
        (!board ? '<p class="muted">' + (p.app ? '交付一个应用：做好后可以试玩，满意再放到桌面' : p.modifies_files ? '方案提到会改文件：本版本只交付文本，不应用文件改动' : '不修改项目文件') + '</p>' : '');
      if (board && p.status === 'waiting_approval' && p.approval) html += '<div class="approval"><p>' + esc(p.approval.title + '：' + p.approval.detail) + '</p><p class="muted">在「审批」申请表里允许或拒绝</p></div>';
      if (board && p.error && ['failed', 'interrupted', 'blocked'].includes(p.status)) html += '<p>' + esc(p.error) + '</p>';
      return html + '</li>';
    }
    // The plan page shows one goal: the one just submitted or picked on the task board.
    const planMission = () => state.missions.find(x => x.id === planOpen) || state.missions.find(x => ['planning', 'awaiting_confirm', 'plan_failed'].includes(x.status));
    function renderPlan() {
      const m = planMission(); if (!m) return;
      const t = m.planTask;
      let status = '';
      if (m.status === 'planning') status = '协调员正在拟定分工…（' + (t && t.task_id ? domain.packageLabels[t.status] || t.status : '正在派发到电脑') + '）';
      else if (m.status === 'plan_failed') status = '分工拟定失败：' + ((t && t.error) || '未知原因') + '。不会使用未经确认的执行计划。';
      else if (m.status === 'awaiting_confirm') status = m.plan.summary.replace(/[。.\s]+$/, '') + (m.demo ? '（演示数据）' : '') + (client.parallel > 1 ? '' : '。电脑端一次执行一个任务，工作包将按顺序进行。');
      else if (m.status === 'cancelled') status = '已取消。';
      else status = '已确认，员工正在工作。可在任务板查看进度。';
      if (runner.lastError() && m.status === 'planning') status += ' 连接问题：' + runner.lastError();
      $('plan-status').textContent = status;
      $('plan-list').innerHTML = m.plan && ['awaiting_confirm'].includes(m.status) ? m.plan.packages.map(p => packageCard(m, p, false)).join('') : '';
      $('plan-confirm').hidden = m.status !== 'awaiting_confirm';
      $('plan-retry').hidden = m.status !== 'plan_failed';
      $('plan-edit').textContent = m.status === 'awaiting_confirm' || m.status === 'plan_failed' ? '修改需求' : '任务板';
    }
    async function confirmPlan() {
      const m = planMission(); if (!m) return;
      try { domain.confirm(m, m.plan_version, state); await persist(); }
      catch (e) { say(e.message); return; }
      close('dlg-plan'); say(m.packages.length > 1 ? '已开工：' + m.packages.length + ' 个工作包' : '已开工'); schedulePoll(0); wake();
    }
    async function editPlan() {
      const m = planMission();
      if (m && (m.status === 'awaiting_confirm' || m.status === 'plan_failed')) {
        // Going back to edit abandons this unconfirmed plan; nothing was dispatched for it.
        const goal = m.goal, mode = m.mode, assignee = m.assignee;
        m.status = 'cancelled'; state.draft = goal;
        try { await persist(); } catch (e) { say(e.message); return; }
        close('dlg-plan'); openGoal(mode, assignee);
      } else { close('dlg-plan'); open('dlg-board'); }
    }
    async function retryPlan() {
      const m = planMission(); if (!m || m.status !== 'plan_failed') return;
      m.status = 'planning'; m.planTask = null;
      try { await persist(); } catch (e) { say(e.message); return; }
      render('dlg-plan'); schedulePoll(0);
    }

    /* ---------- board ---------- */
    // Every goal in one list, open ones first; each carries its own stop / retry / plan actions.
    function renderBoard() {
      const list = domain.open(state).concat(state.missions.filter(m => domain.finished(m)));
      $('board-goal').textContent = list.length ? '' : '还没有目标。';
      $('board-status').textContent = list.length ? (client.parallel === 1 ? '电脑一次执行一个任务，其余排队。' : '每名员工各做各的，互不等待。') : '在会议桌或「派任务」发起一个目标；也可以选中某个员工直接交给TA。';
      const html = list.map(m => {
        const parts = [domain.missionLabels[m.status]];
        if (m.note) parts.push(m.note);
        if (runner.connection() === 'stale' && !domain.finished(m)) parts.push('状态待同步：' + runner.lastError());
        const armed = cancelArmed.id === m.id && cancelArmed.until > clock.monotonic(), id = esc(m.id);
        const actions = (['planning', 'awaiting_confirm', 'plan_failed'].includes(m.status) ? '<button data-plan="' + id + '">查看分工</button>' : '') +
          (domain.retryable(m) ? '<button data-retry="' + id + '">重试失败</button>' : '') +
          (!domain.finished(m) && m.status !== 'cancelling' ? '<button data-cancel="' + id + '">' + (armed ? '确认停止' : '停止') + '</button>' : '');
        return '<li class="goal"><h3>' + esc((m.demo ? '【演示】' : '') + m.goal) + '</h3><p class="muted">' + esc(parts.join(' · ')) + '</p>' +
          (m.packages.length ? '<ol>' + m.packages.map(p => packageCard(m, p, true)).join('') + '</ol>' : '') + (actions ? '<div class="row">' + actions + '</div>' : '') + '</li>';
      }).join('');
      setHtml('board-list', html);
    }
    async function cancelMission(id) {
      if (cancelArmed.id !== id || cancelArmed.until < clock.monotonic()) { cancelArmed = {id, until: clock.monotonic() + 5000}; renderBoard(); focusEl($('board-list').querySelector('[data-cancel="' + id + '"]')); return; }
      cancelArmed = {id: null, until: 0};
      try { await runner.cancel(id); say('正在停止，等电脑确认后显示已取消'); } catch (e) { say(e.message); }
      refresh(); schedulePoll(300);
    }
    async function retryMission(id) {
      const m = state.missions.find(x => x.id === id); if (!m) return;
      const taken = m.packages.find(p => ['failed', 'interrupted', 'blocked', 'cancelled'].includes(p.status) && domain.staffBusy(state, p.staff, m));
      if (taken) { say(m.staff[taken.staff].name + '正在忙另一件事，等TA做完再重试'); return; }
      try { domain.retry(m); await persist(); say('重新执行未完成的工作包'); } catch (e) { say(e.message); }
      refresh(); schedulePoll(0);
    }

    /* ---------- reports ---------- */
    function renderReports() {
      const list = state.reports;
      $('reports-empty').hidden = list.length > 0;
      const html = list.map(r => '<li><button class="report-row" data-report="' + esc(r.id) + '"><b>' + (r.read ? '' : '<span class="dot" aria-label="未读"></span>') + esc(state.staff[r.staff] ? state.staff[r.staff].name : '') + ' · ' + esc(r.title) + '</b>' +
        (r.demo ? '<span class="tag demo">演示</span>' : '') + '<span class="tag">' + esc({completed: '完成', partial: '部分完成', failed: '失败', interrupted: '中断'}[r.status] || r.status) + '</span>' +
        '<span class="muted small">' + esc(new Date(r.at).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'})) + '</span></button></li>').join('');
      setHtml('reports-list', html);
    }
    function showReport(text, keepFocus) {
      const box = $('report-text'), at = keepFocus ? [...box.children].indexOf(doc.activeElement) : -1;
      const tag = {h: 'h3', li: 'p class="li"', p: 'p'};
      box.innerHTML = domain.reportBlocks(text).map(b => '<' + tag[b.kind] + ' tabindex="0">' + b.html + '</' + tag[b.kind].split(' ')[0] + '>').join('');
      if (at >= 0 && box.children[at]) focusEl(box.children[at]);
    }
    async function openReport(id) {
      const r = state.reports.find(x => x.id === id); if (!r) return;
      reportOpen = id;
      $('report-title').textContent = (state.staff[r.staff] ? state.staff[r.staff].name : '') + ' · ' + r.title;
      const app = r.app && r.status === 'completed';
      $('report-meta').textContent = (r.demo ? '演示数据 · ' : '') + (app ? '应用已做好 · 先试玩，满意再放到桌面' : ({completed: '完成', partial: '部分完成', failed: '失败', interrupted: '中断'}[r.status] || r.status) + ' · 文件改动不会自动应用');
      showReport(r.preview + (r.preview.length >= domain.PREVIEW ? '\n\n正在读取完整内容…' : ''));
      reportActions(r, r.preview);
      open('dlg-report'); focusEl(app ? $('report-try') : $('report-text').firstElementChild || $('report-text'));
      if (!r.read) { r.read = true; persist().catch(() => {}); }
      if (r.task_id && r.preview.length >= domain.PREVIEW) {
        try { const full = await runner.fullText(r.task_id); if (reportOpen === id && full) { showReport(full, true); reportActions(r, full); } }
        catch (e) { if (reportOpen === id) showReport(r.preview + '\n\n完整内容暂时无法读取：' + e.message, true); }
      }
    }
    /* App reports offer 试玩 / 放到桌面; a text report holding a web page offers 做成应用 (a new single app package). */
    function reportActions(r, text) {
      const app = !!r.app && r.status === 'completed', convert = domain.convertible(r, text);
      // A bundle the device refused can be made again; trying or installing it would only fail the same way.
      $('report-try').hidden = $('report-install').hidden = !app || !!r.problem;
      $('report-remake').hidden = !app;
      $('report-remake').textContent = r.problem ? '重新制作' : '重做';
      $('report-remake').classList.toggle('primary', !!r.problem);
      if (app) $('report-meta').textContent = (r.demo ? '演示数据 · ' : '') + (r.problem ? '应用没通过小电脑检查 · 可以让' + state.staff.engineer.name + '重新制作' : '应用已做好 · 先试玩，满意再放到桌面');
      $('report-status').hidden = !r.problem; $('report-status').textContent = r.problem ? '小电脑没有接受这个应用：' + r.problem : ''; $('report-status').classList.toggle('problem', !!r.problem);
      $('report-install').disabled = !!r.installed;
      $('report-install').textContent = r.installed ? '已在桌面' : '放到桌面';
      $('report-convert').hidden = !convert;
      $('report-actions').hidden = !app && !convert;
    }
    // Feedback inside the report page: the office status line sits under the modal dialog.
    function reportSay(text, problem) { const el = $('report-status'); el.textContent = text; el.hidden = !text; el.classList.toggle('problem', !!problem); }
    // The shell refused the bundle itself (admission rules), not the connection: remember it on the report.
    const refused = e => !e.retryable && !['timeout', 'declined', 'installed', 'demo', 'unsupported'].includes(e.code) && e.status !== 403;
    const openedReport = () => state.reports.find(x => x.id === reportOpen);
    async function tryApp() {
      const r = openedReport(); if (!r) return;
      // Remember the report so the office reopens on it when the preview's back control returns here.
      state.resume = {report: r.id};
      try { await persist(); } catch (e) { delete state.resume; return; }
      reportSay('正在从电脑取回应用…');
      try { await runner.previewApp(r.task_id); }
      catch (e) { delete state.resume; failed(r, e); }
    }
    function failed(r, e) {
      if (refused(e)) r.problem = String(e.message || '').slice(0, 200);
      persist().catch(() => {});
      if (reportOpen !== r.id) return;
      reportActions(r, ''); if (!r.problem) reportSay(e.message, true);
      focusEl(r.problem ? $('report-remake') : $('report-try'));
    }
    async function installApp() {
      const r = openedReport(); if (!r || r.installed) return;
      reportSay('正在从电脑取回应用…');
      try {
        const res = await runner.installApp(r.task_id);
        r.installed = res.app.name; persist().catch(() => {});
        if (reportOpen === r.id) { reportActions(r, ''); reportSay('「' + res.app.name + '」已放到桌面最后一页'); focusEl($('report-try')); }
      } catch (e) {
        if (e.code === 'installed') r.installed = true;
        if (e.code === 'declined' || e.code === 'installed') { persist().catch(() => {}); if (reportOpen === r.id) { reportActions(r, ''); reportSay(e.code === 'declined' ? '没有安装' : e.message); focusEl($('report-try')); } }
        else failed(r, e);
      }
    }
    async function convertReport() {
      const r = openedReport(); if (!r) return;
      const block = domain.assignBlock(state, 'single', 'engineer');
      if (block) { reportSay(block); return; }
      if (state.demo) { reportSay('演示模式不连接电脑：关闭演示模式后再做'); return; }
      if (!canDispatch()) { reportSay('暂时不能派工：' + conn.text + (conn.detail ? '。' + conn.detail : '')); return; }
      const previous = state.missions.slice(), source = state.missions.find(m => m.id === r.mission_id), origin = source && source.packages.find(p => p.app);
      // Reports made before 重新制作 existed: recover the request from the mission that produced them.
      if (r.app && !r.remake && origin) r.remake = {title: origin.title, deliverable: origin.deliverable, source_task: origin.source_task || null};
      const m = domain.appMission(state, {id: newId(), report: r, target: Object.assign({}, state.target), demo: false, now: clock.wall()});
      domain.addMission(state, m);
      try { await persist(); } catch (e) { state.missions = previous; reportSay('保存失败：' + e.message); return; }
      planOpen = m.id;
      close('dlg-report'); if (stack.some(x => x.id === 'dlg-reports')) close('dlg-reports');
      open('dlg-plan');
    }

    /* ---------- setup ---------- */
    function openSetup() { setupDraft = {target: state.target ? Object.assign({}, state.target) : {}, demo: state.demo}; open('dlg-setup'); }
    function renderSetup() {
      const d = setupDraft; if (!d) return;
      $('setup-status').textContent = d.demo ? '演示模式：使用模拟数据，不连接电脑。' : conn.text + (conn.detail ? '：' + conn.detail : '');
      const comps = d.demo ? [] : conn.computers, c = comps.find(x => x.client_id === d.target.computer_id);
      const choice = (kind, id, label, on, disabled) => '<button data-' + kind + '="' + esc(id) + '" aria-pressed="' + on + '"' + (disabled ? ' disabled' : '') + '>' + esc(label) + '</button>';
      $('setup-computers').innerHTML = comps.length ? comps.map(x => choice('computer', x.client_id, x.name + (x.online ? ' · 在线' : ' · 离线'), x === c)).join('') : '<p class="muted small">' + (d.demo ? '演示模式不使用电脑' : '没有已配对电脑。请在「我的电脑」完成配对。') + '</p>';
      $('setup-projects').innerHTML = c ? (c.projects.length ? c.projects.map(p => choice('project', p.id, p.name, p.id === d.target.project_id)).join('') : '<p class="muted small">这台电脑还没有授权项目</p>') : '';
      $('setup-agents').innerHTML = c ? c.agents.map(a => choice('agent', a.id, a.name + (a.available && a.authenticated ? '' : ' · ' + (a.reason || '不可用')), a.id === d.target.agent_id, !(a.available && a.authenticated))).join('') : '';
      $('setup-staff').innerHTML = domain.STAFF.map(id => '<label>' + esc(R[id].role) + '<input data-staff="' + id + '" maxlength="12" value="' + esc(state.staff[id].name) + '"></label>').join('');
      $('setup-demo').setAttribute('aria-pressed', String(d.demo)); $('setup-demo').textContent = '演示模式 · ' + (d.demo ? '开' : '关');
    }
    async function saveSetup() {
      const d = setupDraft, busy = domain.open(state).length > 0;
      if (d.demo !== state.demo && busy) { $('setup-status').textContent = '当前目标还没结束，不能切换演示模式。'; return; }
      const names = {};
      doc.querySelectorAll('[data-staff]').forEach(i => { names[i.dataset.staff] = i.value.trim().slice(0, 12) || R[i.dataset.staff].name; });
      const prev = JSON.stringify(state);
      for (const id of domain.STAFF) state.staff[id].name = names[id];
      if (!d.demo && d.target.computer_id && d.target.project_id && d.target.agent_id) state.target = Object.assign({}, d.target);
      const switching = d.demo !== state.demo;
      state.demo = d.demo;
      if (switching) state.missions = state.missions.filter(m => m.demo === state.demo);
      try { await persist(); } catch (e) { Object.assign(state, JSON.parse(prev)); $('setup-status').textContent = '保存失败：' + e.message; return; }
      if (switching) useClient();
      close('dlg-setup'); say('已保存' + (busy ? '；当前目标仍按原配置执行' : '')); checkConnection();
    }

    /* ---------- wiring ---------- */
    function bind() {
      $('btn-assign').onclick = () => { scene.walkBoss('meeting'); wake(); openGoal('team'); };
      $('btn-board').onclick = () => open('dlg-board');
      $('btn-reports').onclick = () => { scene.walkBoss('cabinet'); wake(); open('dlg-reports'); };
      $('btn-approvals').onclick = () => { sheetSay('approvals-status', ''); open('dlg-approvals'); focusEl($('approvals-list').querySelector('[data-allow]') || $('dlg-approvals').querySelector('.back')); };
      $('approvals-list').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.allow) decide(b.dataset.allow, 'accept', 'approvals-status'); if (b.dataset.deny) decide(b.dataset.deny, 'decline', 'approvals-status'); });
      $('btn-setup').onclick = openSetup;
      doc.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => back(); });
      $('staff-close').onclick = () => close('dlg-staff');
      $('staff-assign').onclick = () => { const id = staffOpen; close('dlg-staff'); openGoal('single', id); };
      $('staff-allow').onclick = () => decide(staffOpen, 'accept');
      $('staff-deny').onclick = () => decide(staffOpen, 'decline');
      $('staff-report').onclick = () => { const r = state.reports.find(x => x.staff === staffOpen); if (r) openReport(r.id); };
      $('goal-submit').onclick = submitGoal; $('goal-save').onclick = saveDraft;
      $('goal-target').onclick = openSetup;
      $('plan-confirm').onclick = confirmPlan; $('plan-edit').onclick = editPlan; $('plan-retry').onclick = retryPlan;
      $('board-new').onclick = () => { close('dlg-board'); openGoal('team'); };
      $('board-list').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
        if (d.cancel) cancelMission(d.cancel); if (d.retry) retryMission(d.retry); if (d.plan) { planOpen = d.plan; close('dlg-board'); open('dlg-plan'); } });
      $('report-try').onclick = tryApp; $('report-install').onclick = installApp; $('report-convert').onclick = $('report-remake').onclick = convertReport;
      $('reports-list').addEventListener('click', e => { const b = e.target.closest('[data-report]'); if (b) openReport(b.dataset.report); });
      $('setup-computers').addEventListener('click', e => { const b = e.target.closest('[data-computer]'); if (!b) return; const c = conn.computers.find(x => x.client_id === b.dataset.computer); setupDraft.target = {computer_id: c.client_id, project_id: c.projects.length === 1 ? c.projects[0].id : null, agent_id: (c.agents.find(a => a.available && a.authenticated) || {}).id || null}; renderSetup(); focusEl($('setup-computers').querySelector('[data-computer="' + b.dataset.computer + '"]')); });
      $('setup-projects').addEventListener('click', e => { const b = e.target.closest('[data-project]'); if (!b) return; setupDraft.target.project_id = b.dataset.project; renderSetup(); focusEl($('setup-projects').querySelector('[data-project="' + b.dataset.project + '"]')); });
      $('setup-agents').addEventListener('click', e => { const b = e.target.closest('[data-agent]'); if (!b) return; setupDraft.target.agent_id = b.dataset.agent; renderSetup(); focusEl($('setup-agents').querySelector('[data-agent="' + b.dataset.agent + '"]')); });
      $('setup-demo').onclick = () => { setupDraft.demo = !setupDraft.demo; renderSetup(); focusEl($('setup-demo')); };
      $('setup-save').onclick = saveSetup; $('setup-refresh').onclick = () => checkConnection().then(() => renderSetup());
      // Esc / cancel on native dialogs goes through the same back stack.
      doc.querySelectorAll('dialog').forEach(d => d.addEventListener('cancel', e => { e.preventDefault(); close(d.id); }));
    }
    function applyMotion() {
      const next = systemMotion && !media.matches;
      if (next !== motion) { motion = next; scene.setMotion(motion, clock.monotonic()); wake(); }
    }
    function onMessage(e) { if (e.source === win.parent && e.data && e.data.type === 'atom:input-settings') { systemMotion = e.data.motion !== false; applyMotion(); } }
    function onVisibility() { if (doc.hidden) { win.clearTimeout(pollTimer); win.cancelAnimationFrame(raf); win.clearTimeout(frameTimer); } else { lastFrame = 0; wake(); schedulePoll(0); } }
    function dispose() {
      if (disposed) return; disposed = true;
      win.clearTimeout(pollTimer); win.clearTimeout(frameTimer); win.cancelAnimationFrame(raf);
      win.removeEventListener('message', onMessage); doc.removeEventListener('visibilitychange', onVisibility);
      if (media.removeEventListener) media.removeEventListener('change', applyMotion);
      if (client) client.dispose();
    }
    async function load() {
      try {
        state = domain.normalize(await host.load(domain.defaults()));
        readFailed = false; loaded = true; $('status').hidden = true;
      } catch (e) {
        readFailed = true; loaded = false;
        say('读取失败：' + e.message + '。已暂停保存以保护旧记录。', true);
        const retry = doc.getElementById('btn-setup'); retry.textContent = '重试读取'; retry.onclick = () => { retry.onclick = openSetup; load().then(afterLoad); };
        return false;
      }
      return true;
    }
    async function afterLoad(ok) {
      if (!ok) return;
      useClient(); refresh();
      // Re-entering shows unread results once, never replays history.
      const pending = state.reports.filter(r => !r.announced);
      if (pending.length) { if (motion) scene.announce(pending[0].staff, clock.monotonic()); pending.forEach(r => { r.announced = true; }); persist().catch(() => {}); }
      // Back from an app preview: reopen the report it was started from, once.
      if (state.resume) { const id = state.resume.report; delete state.resume; persist().catch(() => {}); if (state.reports.some(r => r.id === id)) { open('dlg-reports'); openReport(id); } }
      await checkConnection(); schedulePoll(0);
    }
    async function start() {
      host.deferReady();
      mountSpots(); bind();
      win.addEventListener('message', onMessage); doc.addEventListener('visibilitychange', onVisibility);
      if (media.addEventListener) media.addEventListener('change', applyMotion);
      motion = !media.matches; scene.reset(clock.monotonic()); scene.setMotion(motion, clock.monotonic());
      host.onSuspend(dispose);
      host.setBackHandler(back);
      // Draw the office first; connection checks run afterwards.
      runner = Runner.create({domain, getState: () => state, persist, client: {parallel: 1, send: () => Promise.reject(Error('尚未读取')), dispose() {}}, clock, newId, onReport, onChange: refresh});
      loop(); host.ready();
      afterLoad(await load());
    }
    return {start, dispose, debug: {state: () => state, conn: () => conn, scene, activity}};
  }
  const api = {create};
  root.OfficeUI = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
