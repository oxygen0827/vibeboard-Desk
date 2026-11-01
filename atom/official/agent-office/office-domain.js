/* Office rules: persisted shape, plans, work packages and the read models the scene uses.
   Pure functions; no DOM, timers, storage or network. */
(function(root) {
  'use strict';
  const ROLES = {
    coordinator: {role: '协调员', name: '小序', desc: '理解需求、提出分工、汇总交付'},
    researcher: {role: '研究员', name: '小研', desc: '阅读资料、比较信息、核实来源'},
    writer: {role: '文案员', name: '小文', desc: '写作、总结、整理文档'},
    engineer: {role: '工程师', name: '小工', desc: '编码、脚本、文件处理'}
  };
  const STAFF = ['researcher', 'writer', 'engineer', 'coordinator'];
  const EXECUTORS = ['researcher', 'writer', 'engineer'];
  const TERMINAL = ['completed', 'failed', 'cancelled', 'interrupted'];
  const PKG_DONE = TERMINAL.concat(['blocked']);
  const MAX_PACKAGES = 3, PREVIEW = 600, GOAL_MAX = 2000;
  const PLAN_MARK = '[ATOM 像素办公室 · 分工拟定]', WORK_MARK = '[ATOM 像素办公室 · 工作包]', SUMMARY_MARK = '[ATOM 像素办公室 · 综合报告]';

  function defaults() {
    const staff = {};
    for (const id of STAFF) staff[id] = {name: ROLES[id].name, desc: ROLES[id].desc};
    return {v: 1, draft: '', staff, target: null, demo: false, mission: null, reports: []};
  }
  const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  const ident = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : null;
  // Accept a saved record only in its known shape; unknown fields are dropped.
  function normalize(saved) {
    const base = defaults();
    if (!saved || typeof saved !== 'object' || saved.v !== 1) return base;
    base.draft = str(saved.draft, GOAL_MAX);
    base.demo = saved.demo === true;
    for (const id of STAFF) {
      const s = saved.staff && saved.staff[id];
      if (s) base.staff[id] = {name: str(s.name, 12).trim() || ROLES[id].name, desc: str(s.desc, 80).trim() || ROLES[id].desc};
    }
    const t = saved.target;
    if (t && ident(t.computer_id) && ident(t.project_id) && ident(t.agent_id)) base.target = {computer_id: t.computer_id, project_id: t.project_id, agent_id: t.agent_id};
    if (saved.mission && typeof saved.mission === 'object' && ident(saved.mission.id)) base.mission = saved.mission;
    if (Array.isArray(saved.reports)) base.reports = saved.reports.filter(r => r && ident(r.id)).slice(0, 12);
    // Set just before an app preview so the office reopens on the same report when the preview's back returns here.
    if (saved.resume && ident(saved.resume.report)) base.resume = {report: saved.resume.report};
    return base;
  }

  function staffLine(state, id) { return id + '（' + state.staff[id].name + '）：' + state.staff[id].desc; }
  function planPrompt(state, goal) {
    return [PLAN_MARK, '你是办公室协调员。这一步只做分工规划：不执行任务，不读写、创建或修改任何文件，不运行命令。',
      '用户目标：' + goal, '可分配的员工：', ...EXECUTORS.map(id => '- ' + staffLine(state, id)),
      '规则：简单目标只分配一名员工；复杂目标最多 ' + MAX_PACKAGES + ' 个工作包，每名员工最多一个；需要先后顺序时用 depends_on 写上游工作包 id；可以同时进行的不要写依赖。',
      '如果目标是做一个能直接打开使用的小应用、小工具、小游戏、计时器等，把制作交给 engineer，并给这个工作包加 "app":true（整个分工最多一个）；它会生成可以在 ATOM 小电脑上试玩和安装的应用。只是写代码片段、脚本或文档时不要加。',
      '只输出一个 JSON 对象，不要输出其它文字或代码块标记：',
      '{"summary":"一句话说明方案","packages":[{"id":"p1","staff":"researcher","title":"不超过 20 字","deliverable":"交付物说明","depends_on":[],"modifies_files":false}]}'].join('\n');
  }
  function packagePrompt(state, mission, pkg, upstream) {
    const s = mission.staff[pkg.staff];
    const lines = [WORK_MARK, '你是' + ROLES[pkg.staff].role + '「' + s.name + '」，职责：' + s.desc + '。',
      '总目标：' + mission.goal, '你的工作包：' + pkg.title, '交付物：' + pkg.deliverable];
    if (upstream.length) {
      lines.push('以下是上游同事已完成成果的固定版本，只以此为准：');
      for (const u of upstream) lines.push('--- ' + u.title + '（' + mission.staff[u.staff].name + '）---\n' + String(u.text || '').slice(0, 4000));
    }
    lines.push(PATH_RULE);
    lines.push('要求：本版本不应用文件改动——不要修改、创建、移动或删除项目中的任何文件，把成果直接写在回复里。只使用实际可用的资料与工具；没有联网搜索能力时直接说明限制，不要编造搜索记录或来源。',
      '最后用以下小标题汇报：', '## 完成内容', '## 实际来源', '## 文件清单', '## 验证结果', '## 未完成事项');
    return lines.join('\n');
  }
  /* An app package becomes a Connect `app` task: the computer wraps this request in the ATOM bundle contract
     (manifest, icon, five-way input) and returns an installable bundle instead of a text report. */
  function appPrompt(state, mission, pkg, upstream) {
    const lines = [WORK_MARK, '由工程师「' + mission.staff.engineer.name + '」制作一个 ATOM 小电脑应用。',
      '总目标：' + mission.goal, '应用要求：' + pkg.title + '——' + pkg.deliverable,
      // Five-way, browser-baseline and AtomApp rules come from the shared policy the computer adds to every app task.
      '界面全部使用简体中文；屏幕 480×360，用五向键（方向键 + 确认）即可完成所有操作；应用名称简短。',
      '颜色要同时适配浅色和深色（prefers-color-scheme）：卡片背景和上面的文字必须一起切换，不要白底配浅色字。'];
    if (pkg.problem) lines.push('上一次生成的应用没有通过小电脑检查：' + String(pkg.problem).slice(0, 300) + '。这次必须避免这个问题。');
    if (upstream.length) {
      lines.push('以下资料只作为内容参考（其中的代码可以改写，但必须满足 ATOM 应用要求）：');
      for (const u of upstream) lines.push('--- ' + u.title + '（' + (mission.staff[u.staff] ? mission.staff[u.staff].name : '') + '）---\n' + String(u.text || '').slice(0, 12000));
    }
    return lines.join('\n');
  }
  /* A single app package, confirmed before dispatch:
     - "做成应用" on a text report (e.g. HTML pasted in a reply): the report's full text is the reference;
     - "重新制作" on an app report whose bundle the device refused: same request plus the refusal reason. */
  function appMission(state, {id, report, target, demo, now}) {
    const name = state.staff.engineer.name, again = !!report.app, base = again && report.remake ? report.remake : null;
    const title = String(base ? base.title : report.title || '').replace(/^(做成应用|重新制作)：/, '').slice(0, 14);
    const pkg = {id: 'p1', staff: 'engineer', title: ((again ? '重新制作：' : '做成应用：') + title).slice(0, 20),
      deliverable: base ? str(base.deliverable, 300) : '把汇报「' + title + '」里的成果改写成完整的 ATOM 应用', depends_on: [], modifies_files: false, app: true,
      // An app task's own text is only "应用已生成", never a useful reference.
      source_task: ident(base ? base.source_task : again ? null : report.task_id) || null};
    if (again && report.problem) pkg.problem = str(report.problem, 300);
    return {id, demo: !!demo, goal: (again ? '重新制作「' : '把「') + title + (again ? '」应用' : '」做成小电脑应用'), mode: 'single', assignee: 'engineer', target,
      staff: JSON.parse(JSON.stringify(state.staff)), created_at: now, status: 'awaiting_confirm', plan_version: 1, planTask: null,
      plan: {summary: again ? '交给工程师「' + name + '」重新制作这个应用' + (pkg.problem ? '，并避开上次没通过检查的问题' : '') : '交给工程师「' + name + '」把这份成果做成可以试玩、可以放到桌面的应用', packages: [pkg]},
      packages: [], summaryTask: null, summary: '', note: ''};
  }
  // A completed text report that contains a full web page or code can be turned into an app.
  const convertible = (r, text) => !!r && !r.app && !r.demo && r.status === 'completed' && !!ident(r.task_id) && /```(?:html|htm)\b|<!doctype html|<html[\s>]/i.test(String(text || ''));
  function summaryPrompt(state, mission, results) {
    const lines = [SUMMARY_MARK, '你是办公室协调员「' + mission.staff.coordinator.name + '」。汇总同事的成果，形成给用户的综合报告。不要修改任何文件，不运行命令。',
      '总目标：' + mission.goal];
    for (const r of results) lines.push('--- ' + r.title + '（' + mission.staff[r.staff].name + '，' + (r.status === 'completed' ? '已完成' : '未完成') + '）---\n' + String(r.text || '').slice(0, 3000));
    lines.push(PATH_RULE);
    lines.push('如实说明哪些部分完成、哪些没有完成；不要把部分完成写成全部成功。', '按以下小标题输出：', '## 综合结论', '## 各工作包', '## 实际来源', '## 未完成事项');
    return lines.join('\n');
  }

  // Strict plan parser: anything outside the documented shape is a failure, never a guess.
  function parsePlan(text) {
    const raw = String(text || '');
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw Error('回复中没有分工 JSON');
    let data;
    try { data = JSON.parse(raw.slice(start, end + 1)); } catch (e) { throw Error('分工 JSON 无法解析'); }
    if (!data || !Array.isArray(data.packages) || !data.packages.length) throw Error('分工里没有工作包');
    if (data.packages.length > MAX_PACKAGES) throw Error('工作包超过 ' + MAX_PACKAGES + ' 个');
    const ids = new Set(), staff = new Set();
    const packages = data.packages.map((p, i) => {
      const id = typeof p.id === 'string' && /^[a-z0-9_-]{1,16}$/i.test(p.id) ? p.id : 'p' + (i + 1);
      if (ids.has(id)) throw Error('工作包编号重复');
      if (!EXECUTORS.includes(p.staff)) throw Error('分配给了不存在的员工');
      if (staff.has(p.staff)) throw Error('同一员工被分配了多个工作包');
      ids.add(id); staff.add(p.staff);
      const title = str(p.title, 40).trim(), deliverable = str(p.deliverable, 300).trim();
      if (!title || !deliverable) throw Error('工作包缺少任务或交付物');
      const out = {id, staff: p.staff, title, deliverable, depends_on: Array.isArray(p.depends_on) ? p.depends_on.filter(d => typeof d === 'string') : [], modifies_files: p.modifies_files === true};
      if (p.app === true) { if (p.staff !== 'engineer') throw Error('只有工程师可以制作应用'); out.app = true; }
      return out;
    });
    if (packages.filter(p => p.app).length > 1) throw Error('一次分工最多制作一个应用');
    for (const p of packages) for (const d of p.depends_on) if (!ids.has(d) || d === p.id) throw Error('依赖关系引用了不存在的工作包');
    // Reject cycles.
    const seen = {}, visit = id => { if (seen[id] === 1) throw Error('依赖关系存在循环'); if (seen[id] === 2) return; seen[id] = 1; packages.find(p => p.id === id).depends_on.forEach(visit); seen[id] = 2; };
    packages.forEach(p => visit(p.id));
    return {summary: str(data.summary, 200).trim() || '协调员已拟定分工', packages};
  }

  function newMission(state, {id, goal, mode, assignee, target, demo, now}) {
    const m = {id, demo: !!demo, goal: str(goal, GOAL_MAX).trim(), mode, assignee: mode === 'single' ? assignee : null,
      target, staff: JSON.parse(JSON.stringify(state.staff)), created_at: now, status: 'planning', plan_version: 0,
      planTask: null, plan: null, packages: [], summaryTask: null, summary: '', note: ''};
    if (mode === 'single') {
      m.plan_version = 1; m.status = 'awaiting_confirm';
      m.plan = {summary: '直接交给' + ROLES[assignee].role + '「' + m.staff[assignee].name + '」负责', packages: [{id: 'p1', staff: assignee, title: m.goal.split('\n')[0].slice(0, 20), deliverable: '按目标完成并汇报', depends_on: [], modifies_files: false}]};
    }
    return m;
  }
  function applyPlan(m, plan) { m.plan = plan; m.plan_version += 1; m.status = 'awaiting_confirm'; return m; }
  function confirm(m, version) {
    if (m.status !== 'awaiting_confirm' || !m.plan || version !== m.plan_version) throw Error('分工已变化，请重新确认');
    m.packages = m.plan.packages.map(p => Object.assign({}, p, {status: 'queued', attempt: 1, request_id: null, task_id: null, after: 0, approval: null, preview: '', error: '', reported: false, stopping: false}));
    m.status = 'running';
    return m;
  }
  const pkg = (m, id) => m.packages.find(p => p.id === id);
  function depsMet(m, p) { return p.depends_on.every(d => pkg(m, d) && pkg(m, d).status === 'completed'); }
  function depsBroken(m, p) { return p.depends_on.some(d => pkg(m, d) && ['failed', 'cancelled', 'interrupted', 'blocked'].includes(pkg(m, d).status)); }
  const activeStatus = s => ['starting', 'running', 'waiting_approval'].includes(s);
  // Packages that may start now under the computer's concurrency limit.
  function dispatchable(m, maxParallel) {
    if (m.status !== 'running') return [];
    for (const p of m.packages) if (p.status === 'queued' && depsBroken(m, p)) { p.status = 'blocked'; p.error = '上游工作包没有完成'; }
    let slots = maxParallel - m.packages.filter(p => activeStatus(p.status)).length;
    const out = [];
    for (const p of m.packages) if (slots > 0 && p.status === 'queued' && depsMet(m, p)) { out.push(p); slots--; }
    return out;
  }
  // Mission status follows its packages; returns 'summarize' when a coordinator summary is due.
  function settle(m) {
    if (!['running', 'cancelling'].includes(m.status)) return null;
    if (!m.packages.every(p => PKG_DONE.includes(p.status))) return null;
    const ok = m.packages.filter(p => p.status === 'completed').length;
    if (m.status === 'cancelling') { m.status = 'cancelled'; return null; }
    if (ok && m.packages.length > 1 && !m.summaryTask) { m.status = 'summarizing'; return 'summarize'; }
    m.status = ok === m.packages.length ? 'completed' : ok ? 'partial' : 'failed';
    return null;
  }
  function finishSummary(m, task) {
    const ok = m.packages.filter(p => p.status === 'completed').length;
    m.status = ok === m.packages.length && task.status === 'completed' ? 'completed' : ok ? 'partial' : 'failed';
    if (task.status !== 'completed') m.note = '综合报告没有完成：' + (task.error || '协调员执行失败');
  }
  function retryable(m) { return ['partial', 'failed'].includes(m.status) && m.packages.some(p => ['failed', 'interrupted', 'blocked', 'cancelled'].includes(p.status)); }
  // A retry creates a new attempt only for failed nodes and their downstream.
  function retry(m) {
    if (!retryable(m)) throw Error('没有可以重试的工作包');
    for (const p of m.packages) if (['failed', 'interrupted', 'blocked', 'cancelled'].includes(p.status)) {
      Object.assign(p, {status: 'queued', attempt: p.attempt + 1, request_id: null, task_id: null, after: 0, approval: null, error: '', reported: false, stopping: false});
    }
    m.status = 'running'; m.summaryTask = null; m.summary = ''; m.note = '';
    return m;
  }
  const finished = m => !m || ['plan_failed', 'completed', 'partial', 'failed', 'cancelled'].includes(m.status);

  /* What each staff member visibly does, derived only from real task facts. */
  function staffActivity(state, id, connection) {
    const m = state.mission, stale = connection === 'stale';
    const tag = (kind, reason) => ({kind: stale && ['working', 'approval', 'waiting'].includes(kind) ? 'stale' : kind, reason: stale && kind !== 'idle' ? '状态待同步：' + reason : reason});
    if (!m || m.status === 'cancelled') return tag('idle', '空闲');
    if (id === 'coordinator') {
      if (m.status === 'planning') return tag('working', '正在拟定分工');
      if (m.status === 'summarizing') return tag('working', '正在汇总综合报告');
      if (m.status === 'awaiting_confirm') return tag('waiting', '分工已拟好，等待你确认');
      if (m.status === 'plan_failed') return tag('failed', '分工拟定失败');
    }
    const p = m.packages.find(x => x.staff === id);
    if (!p) return tag('idle', m.status === 'running' ? '这次没有分配工作' : '空闲');
    if (p.stopping && activeStatus(p.status)) return tag('waiting', '正在停止');
    switch (p.status) {
      case 'queued': {
        const wait = p.depends_on.map(d => pkg(m, d)).filter(d => d && d.status !== 'completed');
        return tag('waiting', wait.length ? '等待' + wait.map(d => m.staff[d.staff].name).join('、') + '的成果' : '排队等待开始');
      }
      case 'starting': return tag('waiting', '正在派发到电脑');
      case 'running': return tag('working', '正在执行：' + p.title);
      case 'waiting_approval': return tag('approval', '等待你的审批');
      case 'completed': return tag('idle', '已完成：' + p.title);
      case 'failed': case 'interrupted': return tag('failed', (p.status === 'failed' ? '失败：' : '已中断：') + (p.error || p.title));
      case 'blocked': return tag('waiting', '上游没有完成，未开始');
      default: return tag('idle', '已取消');
    }
  }
  // The device must not learn the computer's absolute paths: prompts ask for project-relative paths and links render as text.
  const PATH_RULE = '引用文件时只写项目内的相对路径（如 docs/a.md），不要写绝对路径、用户名或文件链接。';
  /* Agent text → focusable blocks. Escaped first; only headings, list items and **bold** are interpreted, so
     five-way Down walks the report paragraph by paragraph and the runtime scrolls each into view. */
  function reportBlocks(text) {
    const esc = s => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const unlink = s => s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
    const blocks = [];
    for (const raw of String(text || '').split(/\n\s*\n/)) {
      const lines = unlink(raw).split('\n').map(l => l.trimEnd()).filter(l => l.trim());
      if (!lines.length) continue;
      let para = [];
      const flush = () => { if (para.length) blocks.push({kind: 'p', html: para.map(inline).join('<br>')}); para = []; };
      for (const line of lines) {
        const h = /^#{1,6}\s+(.*)$/.exec(line), li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
        if (h) { flush(); blocks.push({kind: 'h', html: inline(h[1])}); }
        else if (li) { flush(); blocks.push({kind: 'li', html: inline(li[1])}); }
        else para.push(line);
      }
      flush();
    }
    return blocks;
  }
  const missionLabels = {planning: '正在拟定分工', plan_failed: '分工拟定失败', awaiting_confirm: '等待确认分工', running: '执行中', summarizing: '协调员汇总中',
    completed: '已完成', partial: '部分完成', failed: '未完成', cancelling: '正在停止', cancelled: '已取消'};
  const packageLabels = {queued: '排队', starting: '派发中', running: '执行中', waiting_approval: '等待审批', completed: '已完成', failed: '失败', interrupted: '已中断', cancelled: '已取消', blocked: '未开始'};
  const api = {ROLES, STAFF, EXECUTORS, TERMINAL, MAX_PACKAGES, PREVIEW, GOAL_MAX, defaults, normalize, reportBlocks, planPrompt, packagePrompt, summaryPrompt, parsePlan,
    newMission, appMission, appPrompt, convertible, applyPlan, confirm, dispatchable, settle, finishSummary, retryable, retry, finished, staffActivity, depsMet, missionLabels, packageLabels, marks: {PLAN_MARK, WORK_MARK, SUMMARY_MARK}};
  root.OfficeDomain = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
