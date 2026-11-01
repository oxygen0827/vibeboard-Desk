/* Drives one mission through real Connect tasks: plan → confirm → packages → summary.
   Request IDs are persisted before sending so network retries never start a model twice. */
(function(root) {
  'use strict';
  function create({domain, getState, persist, client, clock, newId, onReport, onChange}) {
    const live = new Map();      // task_id -> {text, result} (full text, not persisted)
    const answered = new Set();  // approval request ids already decided
    let busy = false, lastOk = clock.wall(), lastError = '', connection = 'ok';

    const mission = () => getState().mission;
    function cacheText(taskId, events) {
      const entry = live.get(taskId) || {text: '', result: ''};
      for (const e of events) {
        if (e.type === 'delta' && typeof e.text === 'string') entry.text = (entry.text + e.text).slice(-6000);
        if ((e.type === 'result' || e.type === 'error') && typeof e.text === 'string') entry.result = e.text;
      }
      live.set(taskId, entry); return entry;
    }
    async function call(action, data) {
      try { const r = await client.send(action, data); lastOk = clock.wall(); connection = 'ok'; lastError = ''; return r; }
      catch (e) { lastError = e.message; if (clock.wall() - lastOk > 20000) connection = 'stale'; throw e; }
    }
    // Create (or idempotently re-find) a task. The request id is saved first.
    async function startTask(holder, prompt, kind) {
      const m = mission();
      if (!holder.request_id) { holder.request_id = newId(); await persist(); }
      const r = await call('create-task', Object.assign({request_id: holder.request_id, prompt, kind: kind === 'app' ? 'app' : 'task'}, m.target));
      if (!r || !r.task || typeof r.task.id !== 'string') throw Error('电脑没有返回任务编号');
      holder.task_id = r.task.id; holder.after = holder.after || 0;
      await persist();
    }
    async function pull(holder) {
      const r = await call('task-events', {task_id: holder.task_id, after: holder.after || 0});
      const events = Array.isArray(r.events) ? r.events : [];
      for (const e of events) if (typeof e.seq === 'number' && e.seq > (holder.after || 0)) holder.after = e.seq;
      const entry = cacheText(holder.task_id, events);
      let approval;
      for (const e of events) {
        if (e.type === 'approval' && e.approval && !answered.has(String(e.approval.request_id))) approval = {request_id: String(e.approval.request_id), title: String(e.approval.title || '需要审批'), detail: String(e.approval.detail || '').slice(0, 600)};
        if (e.type === 'status' && e.status === 'running') approval = null;
        if (e.type === 'error' && e.text) holder.error = String(e.text).slice(0, 300);
      }
      const status = r.task && r.task.status;
      return {status, approval, entry, changed: events.length > 0};
    }
    function preview(text) { return String(text || '').slice(0, domain.PREVIEW); }
    function upstream(m, p) {
      return p.depends_on.map(id => m.packages.find(x => x.id === id)).filter(Boolean).map(u => ({title: u.title, staff: u.staff, text: (live.get(u.task_id) || {}).result || u.preview}));
    }
    function report(m, staff, title, text, status, taskId, p) {
      const state = getState();
      const r = {id: newId(), mission_id: m.id, staff, title, preview: preview(text), task_id: taskId, status, read: false, announced: false, demo: m.demo, at: clock.wall()};
      // An app report keeps its request so it can be made again if the device refuses the bundle.
      if (p && p.app) { r.app = true; r.remake = {title: p.title, deliverable: p.deliverable, source_task: p.source_task || null}; }
      state.reports.unshift(r); state.reports = state.reports.slice(0, 12);
      onReport(r);
    }

    async function stepPlan(m) {
      const t = m.planTask || (m.planTask = {request_id: null, task_id: null, after: 0, status: 'starting', error: ''});
      if (!t.task_id) { await startTask(t, domain.planPrompt(getState(), m.goal)); t.status = 'queued'; return true; }
      const r = await pull(t);
      if (r.status) t.status = r.status;
      if (r.status === 'completed' && m.status === 'cancelling') { m.status = 'cancelled'; await persist(); }
      else if (r.status === 'completed') {
        try { domain.applyPlan(m, domain.parsePlan(r.entry.result)); }
        catch (e) { m.status = 'plan_failed'; t.error = e.message + '。没有生成可执行的分工，请重新生成。'; }
        await persist();
      } else if (['failed', 'cancelled', 'interrupted'].includes(r.status)) {
        m.status = m.status === 'cancelling' ? 'cancelled' : 'plan_failed';
        t.error = t.error || '协调员没有完成分工（' + (domain.packageLabels[r.status] || r.status) + '）';
        await persist();
      } else if (r.changed) onChange();
      return true;
    }
    async function stepPackage(m, p) {
      if (!p.task_id) {
        p.status = 'starting';
        if (p.app) {
          // "做成应用" carries the original report's full text as the reference.
          const up = upstream(m, p);
          if (p.source_task) up.unshift({title: '原汇报', staff: 'engineer', text: await fullText(p.source_task)});
          await startTask(p, domain.appPrompt(getState(), m, p, up), 'app');
        } else await startTask(p, domain.packagePrompt(getState(), m, p, upstream(m, p)));
        p.status = 'running'; await persist(); return;
      }
      const r = await pull(p);
      const before = p.status;
      if (r.approval && !answered.has(r.approval.request_id)) p.approval = r.approval;
      if (r.status === 'waiting_approval' && !p.approval) p.status = 'running';
      else if (r.status && r.status !== 'queued') p.status = r.status;
      if (p.status !== 'waiting_approval') p.approval = null;
      if (domain.TERMINAL.includes(p.status)) {
        p.stopping = false;
        const text = r.entry.result || p.error;
        p.preview = preview(text);
        if (p.status === 'completed' && !p.reported) { p.reported = true; report(m, p.staff, p.title, text, 'completed', p.task_id, p); }
        else if (['failed', 'interrupted'].includes(p.status) && !p.reported) { p.reported = true; report(m, p.staff, p.title, text || '工作包没有完成', p.status, p.task_id); }
      }
      if (before !== p.status) await persist(); else if (r.changed) onChange();
    }
    async function stepSummary(m) {
      const t = m.summaryTask;
      if (!t.task_id) {
        const results = m.packages.map(p => ({title: p.title, staff: p.staff, status: p.status, text: (live.get(p.task_id) || {}).result || p.preview || p.error}));
        await startTask(t, domain.summaryPrompt(getState(), m, results)); t.status = 'queued'; return;
      }
      const r = await pull(t);
      if (r.status) t.status = r.status;
      if (domain.TERMINAL.includes(r.status)) {
        t.error = r.status === 'completed' ? '' : (t.error || domain.packageLabels[r.status]);
        m.summary = preview(r.entry.result);
        domain.finishSummary(m, t);
        report(m, 'coordinator', '综合报告', r.entry.result || m.note, m.status === 'completed' ? 'completed' : 'partial', t.task_id);
        await persist();
      } else if (r.changed) onChange();
    }

    /* One polling step. Returns whether real work is still in flight (drives poll cadence). */
    async function tick() {
      if (busy) return true; busy = true;
      try {
        const m = mission(); if (!m) return false;
        if (m.status === 'planning' || m.status === 'cancelling' && m.planTask && m.planTask.task_id && !domain.TERMINAL.includes(m.planTask.status)) {
          if (m.status === 'planning') return await stepPlan(m);
          await stepPlan(m); return true;
        }
        if (m.status === 'running' || m.status === 'cancelling') {
          if (m.status === 'running') for (const p of domain.dispatchable(m, client.parallel)) await stepPackage(m, p);
          for (const p of m.packages) if (p.task_id && !domain.TERMINAL.includes(p.status)) await stepPackage(m, p);
          if (m.status === 'cancelling') for (const p of m.packages) if (!p.task_id && !domain.TERMINAL.includes(p.status) && p.status !== 'blocked') { p.status = 'cancelled'; }
          const next = domain.settle(m);
          if (next === 'summarize') m.summaryTask = {request_id: null, task_id: null, after: 0, status: 'starting', error: ''};
          if (next || domain.finished(m)) await persist();
          return !domain.finished(m);
        }
        if (m.status === 'summarizing') { await stepSummary(m); return !domain.finished(m); }
        return false;
      } catch (e) { onChange(); return true; }
      finally { busy = false; }
    }
    async function approve(pkgId, decision) {
      const m = mission(), p = m && m.packages.find(x => x.id === pkgId);
      if (!p || !p.approval || p.status !== 'waiting_approval') throw Error('这个审批已经失效');
      const requestId = p.approval.request_id;
      if (answered.has(requestId)) throw Error('已经提交过这个审批');
      await call('approve-task', {task_id: p.task_id, request_id: requestId, decision});
      answered.add(requestId); p.approval = null; p.status = 'running';
      await persist();
    }
    async function cancel() {
      const m = mission(); if (!m || domain.finished(m)) return;
      if (m.status === 'awaiting_confirm') { m.status = 'cancelled'; await persist(); return; }
      m.status = 'cancelling';
      for (const p of m.packages) if (p.task_id && !domain.TERMINAL.includes(p.status)) { p.stopping = true; await call('cancel-task', {task_id: p.task_id}).catch(() => {}); }
      if (m.planTask && m.planTask.task_id && !domain.TERMINAL.includes(m.planTask.status)) await call('cancel-task', {task_id: m.planTask.task_id}).catch(() => {});
      if (m.summaryTask && m.summaryTask.task_id && !domain.TERMINAL.includes(m.summaryTask.status)) await call('cancel-task', {task_id: m.summaryTask.task_id}).catch(() => {});
      if (!m.planTask || !m.planTask.task_id) { if (!m.packages.length) m.status = 'cancelled'; }
      await persist();
    }
    // Full text of a finished task for the report page; fetched on demand, never stored in the 64 KiB slot.
    async function fullText(taskId) {
      const cached = live.get(taskId); if (cached && cached.result) return cached.result;
      const r = await call('task-events', {task_id: taskId, after: 0});
      return cacheText(taskId, r.events || []).result;
    }
    const liveText = taskId => (live.get(taskId) || {}).text || '';
    // App tasks: the shell previews or (after its own confirmation sheet) installs the bundle the computer produced.
    const previewApp = taskId => call('preview-app', {task_id: taskId});
    const installApp = taskId => call('install-app', {task_id: taskId});
    return {tick, approve, cancel, fullText, liveText, previewApp, installApp, connection: () => connection, lastError: () => lastError, state: () => call('state', {})};
  }
  const api = {create};
  root.OfficeRunner = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
