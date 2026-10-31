/* Two interchangeable task clients with the same contract:
   - host: the device shell's capability-gated `atom:office` bridge (real Connect tasks);
   - demo: an in-page simulator, always labelled as simulated data. */
(function(root) {
  'use strict';
  function host({window: win, timeoutMs = 9000}) {
    const pending = new Map(); let serial = 0;
    function receive(e) {
      const d = e.data;
      if (e.source !== win.parent || !d || d.type !== 'atom:office-result') return;
      const p = pending.get(d.id); if (!p) return;
      pending.delete(d.id); win.clearTimeout(p.timer);
      if (d.error) { const err = Error(d.error); err.status = d.status || 0; err.code = d.code || ''; p.reject(err); } else p.resolve(d.result);
    }
    win.addEventListener('message', receive);
    function send(action, data) {
      return new Promise((resolve, reject) => {
        if (win.parent === win) { const e = Error('只有在 ATOM 小电脑上才能连接电脑'); e.code = 'unsupported'; reject(e); return; }
        const id = 'office-' + Date.now().toString(36) + '-' + (++serial);
        const timer = win.setTimeout(() => {
          pending.delete(id);
          const e = Error(action === 'state' ? '系统没有响应办公室能力：设备核心可能需要升级' : '设备没有响应，请稍后重试');
          // A permission sheet can hold the first reply past the deadline: the caller may retry.
          e.code = action === 'state' ? 'unsupported' : 'timeout'; e.retryable = true; reject(e);
        }, timeoutMs);
        pending.set(id, {resolve, reject, timer});
        win.parent.postMessage({type: 'atom:office', id, action, data: data || {}}, '*');
      });
    }
    function dispose() { win.removeEventListener('message', receive); for (const p of pending.values()) win.clearTimeout(p.timer); pending.clear(); }
    return {kind: 'host', parallel: 1, send, dispose};
  }

  /* Simulated computer. Timeline driven by the injected clock so tests can fast-forward. */
  function demo({clock, marks}) {
    const tasks = new Map(); let n = 0;
    const plan = JSON.stringify({summary: '研究员先整理资料，文案员据此写说明；工程师同时准备示例脚本', packages: [
      {id: 'p1', staff: 'researcher', title: '整理两份资料要点', deliverable: '要点对照表与来源', depends_on: []},
      {id: 'p2', staff: 'writer', title: '撰写说明文档', deliverable: '一页说明文档正文', depends_on: ['p1']},
      {id: 'p3', staff: 'engineer', title: '准备示例脚本', deliverable: '脚本草稿与运行说明', depends_on: []}]});
    function script(prompt) {
      if (prompt.startsWith(marks.PLAN_MARK)) return {steps: [[600, 'status', 'running', '正在阅读目标'], [2600, 'result', 'completed', plan]]};
      if (prompt.startsWith(marks.SUMMARY_MARK)) return {steps: [[600, 'status', 'running', ''], [1500, 'delta', null, '正在汇总各工作包…'], [3500, 'result', 'completed', '## 综合结论\n（演示数据）三个工作包的模拟成果已汇总。\n## 各工作包\n- 要点对照表\n- 说明文档\n- 示例脚本\n## 实际来源\n演示模式没有读取任何真实资料。\n## 未完成事项\n无（模拟）']]};
      const approval = /工程师/.test(prompt.split('\n')[1] || '');
      const steps = [[700, 'status', 'running', 'Agent 已连接'], [2000, 'delta', null, '正在阅读资料…'], [3600, 'delta', null, '\n正在整理输出…']];
      if (approval) steps.push([4200, 'approval', 'waiting_approval', {request_id: 'demo-approval', title: '允许执行命令？', detail: 'ls -la（演示审批，不会真的执行）', choices: ['accept', 'decline']}]);
      steps.push([approval ? 9000 : 7000, 'result', 'completed', '## 完成内容\n（演示数据）模拟完成了这个工作包。\n## 实际来源\n演示模式没有读取任何真实文件或网页。\n## 文件清单\n无\n## 验证结果\n未执行真实验证。\n## 未完成事项\n这是模拟结果。']);
      return {steps};
    }
    function advance(t) {
      const now = clock.monotonic();
      while (t.cursor < t.steps.length && !t.paused && !t.terminal) {
        const [at, type, status, payload] = t.steps[t.cursor];
        if (t.started + t.shift + at > now) break;
        t.cursor++;
        const ev = {seq: ++t.seq, event_id: 'e' + t.seq, type};
        if (status) { ev.status = status; t.status = status; }
        if (type === 'approval') { ev.approval = payload; t.paused = true; t.pausedAt = now; }
        else ev.text = payload;
        if (['completed', 'failed', 'cancelled'].includes(status)) t.terminal = true;
        t.events.push(ev);
      }
    }
    function view(t) { return {id: t.id, status: t.status, last_seq: t.seq}; }
    async function send(action, data) {
      if (action === 'state') return {configured: true, demo: true, computers: [{client_id: 'demo-pc', name: '演示电脑', online: true, e2e: 'on',
        projects: [{id: 'demo-project', name: '演示项目'}], agents: [{id: 'codex', name: 'Codex（模拟）', available: true, authenticated: true}]}]};
      if (action === 'create-task') {
        for (const t of tasks.values()) if (t.request_id === data.request_id) return {task: view(t)};
        const t = Object.assign({id: 'demo-task-' + (++n), request_id: data.request_id, status: 'queued', seq: 0, events: [], cursor: 0, started: clock.monotonic(), shift: 0, paused: false, terminal: false}, script(data.prompt));
        tasks.set(t.id, t); return {task: view(t)};
      }
      const t = tasks.get(data.task_id); if (!t) { const e = Error('任务不存在或已失效'); e.status = 404; throw e; }
      if (action === 'task-events') { advance(t); return {task: view(t), events: t.events.filter(e => e.seq > (data.after || 0))}; }
      if (action === 'cancel-task') { if (!t.terminal) { t.terminal = true; t.status = 'cancelled'; t.events.push({seq: ++t.seq, event_id: 'e' + t.seq, type: 'status', status: 'cancelled', text: '任务已停止（模拟）'}); } return {ok: true}; }
      if (action === 'approve-task') {
        if (!t.paused || data.request_id !== 'demo-approval') { const e = Error('审批已失效'); e.status = 409; throw e; }
        t.paused = false; t.shift += clock.monotonic() - t.pausedAt; t.status = 'running';
        if (data.decision === 'decline') { t.steps.splice(t.cursor, t.steps.length, [0, 'result', 'failed', '你拒绝了操作，工作包停止（模拟）']); t.shift = clock.monotonic() - t.started; }
        t.events.push({seq: ++t.seq, event_id: 'e' + t.seq, type: 'status', status: 'running', text: '已提交审批决定'});
        return {ok: true};
      }
      throw Error('不支持的操作');
    }
    return {kind: 'demo', parallel: 3, send, dispose() { tasks.clear(); }};
  }
  const api = {host, demo};
  root.OfficeClient = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
