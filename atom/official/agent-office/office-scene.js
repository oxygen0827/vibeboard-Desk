/* Scene simulation: where people stand and how they move. It reads activity facts and never
   creates, changes or completes tasks. Idle life is fully separate from task data. */
(function(root) {
  'use strict';
  function create({map, random = Math.random}) {
    const STAFF = ['researcher', 'writer', 'engineer', 'coordinator'];
    const actors = {}, reportQueue = [];
    let motion = true, lastIdle = 0, bossGoalVersion = 0;
    const same = (a, b) => a && b && Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);
    function actor(id, look, at) { return {id, look, x: at.x, y: at.y, path: [], goal: {x: at.x, y: at.y}, facing: 'down', speed: id === 'boss' ? 4.5 : 3.5, walking: false, report: null, idle: null, nextIdle: 0, workPose: 'type', poseUntil: 0, slot: null}; }
    function reset(now) {
      actors.boss = actor('boss', 'boss', map.points.boss);
      for (const id of STAFF) { actors[id] = actor(id, id, map.desks[id].seat); actors[id].facing = 'up'; actors[id].nextIdle = now + 20000 + random() * 25000; }
      reportQueue.length = 0;
    }
    function setMotion(on, now) {
      motion = !!on;
      if (!motion) for (const a of Object.values(actors)) { a.idle = null; a.report = null; place(a, a.goal); }
      else for (const id of STAFF) actors[id].nextIdle = now + 20000 + random() * 25000;
    }
    function place(a, p) { a.x = p.x; a.y = p.y; a.path = []; a.walking = false; }
    function head(a, target) {
      if (same(a.goal, target) && (a.walking || same(a, target))) return;
      a.goal = {x: target.x, y: target.y};
      if (!motion) { place(a, target); return; }
      const route = map.path({x: a.x, y: a.y}, target);
      if (route === null) { place(a, target); return; }
      a.path = route; a.walking = route.length > 0;
    }
    function step(a, dt) {
      let budget = a.speed * dt / 1000;
      while (budget > 0 && a.path.length) {
        const n = a.path[0], dx = n.x - a.x, dy = n.y - a.y, dist = Math.abs(dx) + Math.abs(dy);
        a.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        if (dist <= budget) { a.x = n.x; a.y = n.y; a.path.shift(); budget -= dist; }
        else { a.x += Math.sign(dx) * Math.min(Math.abs(dx), budget); a.y += Math.sign(dy) * Math.min(Math.abs(dy), budget); budget = 0; }
      }
      a.walking = a.path.length > 0;
    }
    function walkBoss(key) {
      const target = map.approach[key] || map.points.boss;
      bossGoalVersion++; head(actors.boss, target);
    }
    // Slots near the boss's destination; reserved so reporters never overlap.
    function freeSlot(list, owner) {
      const taken = new Set(Object.values(actors).filter(a => a.slot && a.id !== owner).map(a => a.slot.x + ',' + a.slot.y));
      return list.find(s => !taken.has(s.x + ',' + s.y) && map.walkable(s.x, s.y)) || list[0];
    }
    function nearBoss() {
      const g = actors.boss.goal, offsets = [[-2, 0], [2, 0], [-1, 1], [1, 1], [-2, 1], [2, 1], [0, 1]];
      return offsets.map(([dx, dy]) => ({x: g.x + dx, y: g.y + dy})).filter(p => map.walkable(p.x, p.y));
    }
    /* A real completion announces once: the reporter walks over, lingers, then returns. */
    function announce(id, now) {
      const a = actors[id]; if (!a || !motion) return false;
      if (a.report || reportQueue.includes(id)) return true;
      reportQueue.push(id); return true;
    }
    function update(now, dt, activity) {
      dt = Math.min(Math.max(dt, 0), 100);
      const boss = actors.boss; if (!boss) return;
      step(boss, dt);
      if (!boss.walking && boss.goal) { const gk = Object.keys(map.approach).find(k => same(map.approach[k], boss.goal)); boss.facing = gk && map.desks[gk] ? (map.desks[gk].seat.x < boss.x ? 'left' : 'right') : gk === 'meeting' || gk === 'cabinet' ? 'up' : 'down'; }
      // Start at most one queued report walk at a time per reporter, in order.
      while (reportQueue.length) {
        const id = reportQueue[0], a = actors[id];
        if (activity[id] && activity[id].kind === 'approval') break;
        reportQueue.shift();
        const slot = freeSlot(nearBoss().concat(map.points.reportSlots), id);
        a.idle = null; a.slot = slot; a.report = {phase: 'go', until: 0, version: bossGoalVersion, retargeted: false};
      }
      let idleBusy = false;
      for (const id of STAFF) {
        const a = actors[id], act = activity[id] || {kind: 'idle'};
        if (act.kind === 'approval' && motion) {
          if (!a.slot || a.report) { a.report = null; a.idle = null; a.slot = freeSlot(map.points.approvalSlots, id); }
          head(a, a.slot);
        } else if (a.report) {
          const r = a.report;
          if (r.phase === 'go') {
            if (r.version !== bossGoalVersion) { // boss moved: retarget once, then wait at the fixed report point
              r.version = bossGoalVersion;
              a.slot = r.retargeted ? freeSlot(map.points.reportSlots, id) : freeSlot(nearBoss().concat(map.points.reportSlots), id);
              r.retargeted = true;
            }
            head(a, a.slot);
            if (!a.walking && same(a, a.slot)) { r.phase = 'linger'; r.until = now + 5000; a.facing = boss.x < a.x ? 'left' : 'right'; }
          } else if (r.phase === 'linger') { if (now >= r.until) { r.phase = 'return'; a.slot = null; } }
          else { head(a, map.desks[id].seat); if (!a.walking && same(a, map.desks[id].seat)) a.report = null; }
        } else if (a.idle) {
          idleBusy = true;
          const i = a.idle;
          if (act.kind !== 'idle') { a.idle = null; head(a, map.desks[id].seat); }
          else if (i.kind === 'lounge') {
            if (i.phase === 'go') { head(a, i.point); if (!a.walking && same(a, i.point)) { i.phase = 'stay'; i.until = now + 3000; a.facing = 'down'; } }
            else if (i.phase === 'stay') { if (now >= i.until) i.phase = 'back'; }
            else { head(a, map.desks[id].seat); if (!a.walking && same(a, map.desks[id].seat)) { a.idle = null; a.nextIdle = now + 20000 + random() * 25000; } }
          } else if (now >= i.until) { a.idle = null; a.nextIdle = now + 20000 + random() * 25000; }
        } else {
          if (a.slot) a.slot = null;
          head(a, map.desks[id].seat);
        }
        step(a, dt);
        if (!a.walking && same(a, map.desks[id].seat) && !a.report && !(a.idle && a.idle.kind !== 'lounge')) a.facing = 'up';
        if (act.kind === 'working' && now >= a.poseUntil) { a.workPose = ['type', 'type', 'read', 'check'][Math.floor(random() * 4)]; a.poseUntil = now + 5000 + random() * 4000; }
      }
      // Ambient idle life: one small action every 20–45 s per idle person, never task-like.
      if (motion && !idleBusy && now - lastIdle > 6000) {
        for (const id of STAFF) {
          const a = actors[id], act = activity[id] || {kind: 'idle'};
          if (act.kind !== 'idle' || a.report || a.walking || now < a.nextIdle || !same(a, map.desks[id].seat)) continue;
          const roll = random();
          if (roll < 0.3) a.idle = {kind: 'lounge', phase: 'go', point: [{x: 4, y: 16}, {x: 2, y: 15}, {x: 5, y: 17}][Math.floor(random() * 3)]};
          else a.idle = {kind: roll < 0.65 ? 'stretch' : 'sip', until: now + 2000 + random() * 2000};
          lastIdle = now; break;
        }
      }
    }
    const seatedPose = {working: null, waiting: 'sit', failed: 'sit', stale: 'sit', idle: 'sit'};
    function frame(now, activity) {
      const t = Math.floor(now / 220), list = [], glows = [];
      const toPx = a => ({px: a.x * 8 + 4, py: a.y * 8 + 8});
      const b = actors.boss;
      list.push(Object.assign({id: 'boss', look: 'boss', pose: b.walking ? 'walk' : 'stand', frame: t, facing: b.facing, bubble: null}, toPx(b)));
      for (const id of STAFF) {
        const a = actors[id], act = activity[id] || {kind: 'idle'}, seat = map.desks[id].seat;
        const seated = !a.walking && same(a, seat) && !a.report && !(a.idle && a.idle.kind !== 'lounge');
        let pose = a.walking ? 'walk' : 'stand', bubble = null;
        if (seated) pose = act.kind === 'working' ? (motion ? a.workPose : 'sit') : seatedPose[act.kind] || 'sit';
        if (a.idle && !a.walking) pose = a.idle.kind === 'lounge' ? 'sip' : a.idle.kind;
        if (a.report && a.report.phase === 'linger') { pose = 'wave'; bubble = 'done'; }
        if (act.kind === 'approval') bubble = 'approval';
        else if (!a.report && ['working', 'waiting', 'failed', 'stale'].includes(act.kind)) bubble = act.kind;
        if (act.kind === 'working' && !a.report) glows.push(id);
        const p = toPx(a); if (seated) p.py -= 1;
        list.push({id, look: id, px: p.px, py: p.py, pose, frame: motion ? t : 0, facing: a.facing, bubble});
      }
      list.sort((x, y) => x.py - y.py);
      return {actors: list, glows, frame: motion ? t : 0};
    }
    // Moving people need 30 fps; typing or bubbles need only a few frames per second.
    function moving() { return Object.values(actors).some(a => a.walking); }
    function animated(activity) { return motion && (Object.values(actors).some(a => a.report || a.idle) || Object.values(activity).some(x => x.kind === 'working')); }
    const pendingReports = () => reportQueue.length + Object.values(actors).filter(a => a.report).length;
    const position = id => actors[id] && {x: actors[id].x, y: actors[id].y, walking: actors[id].walking};
    return {reset, setMotion, walkBoss, announce, update, frame, moving, animated, pendingReports, position};
  }
  const api = {create};
  root.OfficeScene = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
