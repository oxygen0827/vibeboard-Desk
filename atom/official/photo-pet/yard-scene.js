/* Scene simulation and read model. No DOM, canvas, storage, wall clock or timers. */
(function(root) {
  'use strict';
  function create({domain, life, layout}) {
    const actor = {...layout.actor, walk: false, left: false, speed: 0, distance: 0};
    const pet = {...layout.pet, walk: false, left: false, speed: 0, distance: 0};
    let target = null, pending = null, time = 0, lastInput = 0, autonomous = false, ambientStart = 0, effect = null;
    let previousResidents = null, previousMono = null, frameCount = 0;
    function touch(monotonic) {
      lastInput = monotonic; autonomous = false; pet.ambientMode = null; pet.speed = 0;
    }
    function cancelRoute() { target = null; pending = null; actor.walk = false; actor.speed = 0; }
    function request(kind, index) {
      const oldTarget = target; cancelRoute();
      if (kind === 'plot') { target = layout.plots[index]?.x; pending = {kind, index}; }
      if (kind === 'feed') { target = Math.max(22, Math.min(365, pet.x + (actor.x >= pet.x ? 38 : -38))); pending = {kind}; }
      if (kind === 'stroll') target = oldTarget !== null ? oldTarget > 270 ? 30 : 365 : actor.x > 270 ? 30 : 365;
      return target !== null && target !== undefined;
    }
    function react(events) {
      for (const event of events || []) {
        if (['feed', 'water', 'harvest'].includes(event.kind)) effect = {...event, at: time};
        if (event.kind === 'pet') {pet.x = actor.x - 40; pet.y = layout.pathY(pet.x) + 16; pet.walk = false;}
      }
    }
    function advance(a, x, y, dt, speed, motion) {
      const dx = x - a.x, dy = y - a.y, distance = Math.hypot(dx, dy);
      if (distance < .5 || !motion) {a.x = x; a.y = y; a.walk = false; a.speed = 0; return true;}
      a.walk = true; if (Math.abs(dx) > .5) a.left = dx < 0;
      a.speed = Math.min(Math.min(speed, Math.sqrt(280 * distance)), a.speed + 140 * dt);
      const step = Math.min(distance, a.speed * dt);
      a.x += dx / distance * step; a.y += dy / distance * step; a.distance += step;
      return step === distance;
    }
    function tick({state, wallTime, monotonic, motion, paused, ready, busy}) {
      const dt = previousMono === null || paused ? 0 : Math.max(0, Math.min(.1, (monotonic - previousMono) / 1000));
      previousMono = monotonic;
      const commands = [];
      if (!paused) {
        time += dt;
        if (target !== null && target !== undefined && advance(actor, target, layout.pathY(target), dt, 68, motion)) {
          target = null; actor.walk = false;
          if (pending) commands.push(pending); pending = null;
        }
        const idle = ready && !busy && target === null && !commands.length && motion && monotonic - lastInput >= 12000;
        if (idle && !autonomous) ambientStart = time;
        autonomous = idle;
        if (autonomous) {
          const plan = life.petPlan(time - ambientStart, state.pet);
          pet.ambientMode = plan.mode; pet.ambientTime = Math.max(0, plan.time);
          if (plan.mode === 'walk' && state.follow) advance(pet, plan.x, layout.pathY(plan.x) + 16, dt, 38, motion);
          else { pet.walk = false; pet.speed = 0; }
        } else {
          pet.ambientMode = null;
          const dx = actor.x - pet.x, x = Math.abs(dx) > 40 ? actor.x - Math.sign(dx) * 38 : pet.x;
          if (state.follow) advance(pet, x, layout.pathY(x) + 16, dt, 62, motion);
          else { pet.walk = false; pet.speed = 0; }
        }
      } else autonomous = false;
      const world = domain.project(state, wallTime);
      const planned = domain.residents.map(r => life.npc(r, state, wallTime, time, autonomous, motion));
      const residents = planned.map((n, i) => {
        const previous = previousResidents?.[i];
        if (paused && previous) return previous;
        if (!motion || !previous) return n;
        const dx = n.x - previous.x, dy = n.y - previous.y, d = Math.hypot(dx, dy), maxStep = 72 * dt;
        // After a hidden/modal interval, walk back into the live schedule instead of teleporting.
        if (d > maxStep + .5) return {...n, x: previous.x + dx / d * maxStep, y: previous.y + dy / d * maxStep,
          left: dx < 0, stage: 'walk', frame: 1, rejoining: true};
        return n;
      });
      previousResidents = residents;
      const jobs = world.jobs.map(job => {
        const current = planned.find(n => n.id === job.id);
        return {...job, stage: current.stage, plot: current.plot};
      });
      const careJob = state.jobs.gardener, careTime = careJob?.care === domain.CARE.version ? domain.careTime(careJob, wallTime) : 0;
      return {...world, jobs, residents, actor: {...actor}, pet: {...pet}, time,
        plots: world.plots.map((plot, i) => ({...plot, ...layout.plots[i]})),
        motion: motion && !paused, effect, autonomous, commands, frameCount: ++frameCount,
        route: target === null ? '' : String(target), parkedCan: careTime >= 44 && careTime < 86,
        readyProducts: jobs.filter(j => j.canClaim).map(j => j.id)};
    }
    function resetClock() { previousMono = null; }
    function dispose() { cancelRoute(); previousResidents = null; }
    return {tick, request, react, touch, cancelRoute, resetClock, dispose};
  }
  root.YardScene = {create};
  if (typeof module !== 'undefined') module.exports = root.YardScene;
})(globalThis);
