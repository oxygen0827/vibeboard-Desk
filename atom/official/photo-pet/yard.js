/* Pure domain. All time is supplied by callers; commands never perform I/O. */
(function(root) {
  'use strict';
  function create({catalog}) {
    const {grow: GROW, care: CARE, residents, petIds, maxTools} = catalog;
    const clone = value => JSON.parse(JSON.stringify(value));
    const ratio = (job, now) => job.until <= job.started ? 1 : Math.max(0, Math.min(1, (now - job.started) / (job.until - job.started)));

    function validBase(s) {
      return petIds.includes(s.pet) && Array.isArray(s.plots) && s.plots.length === 4 &&
        Number.isSafeInteger(s.food) && s.food >= 0 && Number.isSafeInteger(s.bond) && s.bond >= 0 &&
        typeof s.follow === 'boolean' && s.plots.every(p => p === null ||
          (p && Number.isFinite(p.watered) && p.watered >= 0));
    }
    function validJob(j, id) {
      return j === null || (j && Number.isFinite(j.started) && Number.isFinite(j.until) &&
        j.started >= 0 && j.until >= j.started && (j.care === undefined ||
          (id === 'gardener' && j.care === CARE.version && j.until > j.started)));
    }
    function load(s) {
      let n;
      if (s?.version === 2 || s?.version === 3) {
        if (!validBase(s)) throw Error('invalid save');
        n = clone(s);
        if (s.version === 3) {
          if (!Number.isSafeInteger(n.fish) || n.fish < 0 || !Number.isSafeInteger(n.tools) ||
              n.tools < 0 || !n.jobs || residents.some(r => !validJob(n.jobs[r.id], r.id))) throw Error('invalid jobs');
          return n;
        }
      } else {
        if (s && s.version !== undefined) throw Error('unsupported save');
        n = {pet: petIds.includes(s?.pet) ? s.pet : 'dog', food: 0, bond: 0, follow: true,
          plots: [null, null, null, null]};
      }
      return {...n, version: 3, fish: 0, tools: 0, jobs: {smith: null, gardener: null, fisher: null}};
    }
    function phase(p, now) {
      return !p ? 'empty' : !p.watered ? 'dry' : now - p.watered >= GROW ? 'ready' : 'growing';
    }
    function jobPhase(s, id, now) {
      const j = s.jobs[id];
      return !j ? 'idle' : now >= j.until ? 'ready' : 'working';
    }
    function careTime(j, now) { return ratio(j, now) * CARE.duration / 1000; }
    function crop(s, index, now) {
      const p = s.plots[index], j = s.jobs.gardener;
      if (j?.care !== CARE.version) return p;
      const b = CARE.beds[index], t = careTime(j, now);
      if (t < b.seed) return p;
      const result = {...(p || {watered: 0})};
      if (!result.watered && t >= b.water) result.watered = j.started + (j.until - j.started) * b.water / (CARE.duration / 1000);
      if (t >= b.fertilized) result.fertilized = true;
      return result;
    }
    function harvested(s, index, now) {
      const j = s.jobs.gardener;
      if (!j) return false;
      return j.care === CARE.version ? careTime(j, now) >= CARE.beds[index].harvested : ratio(j, now) * 60 >= 35 + (3 - index) * 5;
    }
    function yieldPerPlot(s) { return 2 + Math.min(maxTools, s.tools); }
    function project(s, now) {
      return {
        petId: s.pet, food: s.food, fish: s.fish, bond: s.bond, follow: s.follow,
        flowers: s.bond >= 3, tools: s.tools, maxTools, yieldPerPlot: yieldPerPlot(s),
        plots: s.plots.map((_, i) => {
          const p = crop(s, i, now), stage = phase(p, now), collected = harvested(s, i, now);
          return {index: i, stage, harvested: collected, watered: !!p?.watered, fertilized: !!p?.fertilized,
            age: stage === 'ready' ? 3 : stage === 'growing' ? Math.min(2, 1 + Math.floor(Math.max(0, now - p.watered) / 15000)) : 0,
            remaining: stage === 'growing' ? Math.max(1, Math.ceil((GROW - now + p.watered) / 1000)) : 0,
            locked: !!s.jobs.gardener};
        }),
        jobs: residents.map(r => {
          const j = s.jobs[r.id], stage = jobPhase(s, r.id, now), quotaReached = r.id === 'smith' && s.tools >= maxTools;
          return {id: r.id, phase: stage, progress: j ? ratio(j, now) : 0,
            remaining: j ? Math.max(0, Math.ceil((j.until - now) / 1000)) : 0,
            canAssign: stage === 'idle' && !quotaReached, canClaim: stage === 'ready', quotaReached,
            careBonus: r.id === 'gardener' && (!j || j.care === CARE.version) ? 1 : 0};
        })
      };
    }
    function act(s, kind, index, now) {
      if (!Number.isFinite(now) || now < 0) throw Error('invalid command time');
      if (kind === 'job') kind = jobPhase(s, index, now) === 'ready' ? 'claim' : 'assign';
      const n = clone(s), events = [];
      const no = code => ({state: s, code, events: []});
      const done = (code, data = {}) => ({state: n, code, data, events});
      if (kind === 'plot') {
        if (!Number.isInteger(index) || index < 0 || index > 3) return no('choosePlot');
        if (s.jobs.gardener) return no('plotManaged');
        const p = n.plots[index];
        switch (phase(p, now)) {
          case 'empty': n.plots[index] = {watered: 0}; events.push({kind: 'plant', index}); return done('planted');
          case 'dry': p.watered = Math.max(1, now); events.push({kind: 'water', index}); return done('watered');
          case 'ready': {
            const count = yieldPerPlot(n); n.plots[index] = null; n.food += count;
            events.push({kind: 'harvest', index}); return done('harvested', {count});
          }
          default: return no('growing');
        }
      }
      if (kind === 'feed') {
        if (n.food) n.food--; else if (n.fish) n.fish--; else return no('noFood');
        n.bond++; events.push({kind: 'feed'}); return done(n.bond === 3 ? 'flowers' : 'fed');
      }
      if (kind === 'follow') { n.follow = !n.follow; return done(n.follow ? 'following' : 'staying'); }
      if (kind === 'pet') {
        if (!petIds.includes(index)) return no('choosePet');
        if (s.pet === index) return no('petUnchanged');
        n.pet = index; events.push({kind: 'pet', id: index}); return done('petChanged');
      }
      const resident = residents.find(r => r.id === index);
      if (!resident) return no('chooseResident');
      if (kind === 'assign') {
        if (n.jobs[index]) return no('jobExists');
        if (index === 'smith' && n.tools >= maxTools) return no('toolsComplete');
        n.jobs[index] = {started: now, until: now + resident.duration};
        if (index === 'gardener') n.jobs[index].care = CARE.version;
        events.push({kind: 'assigned', id: index}); return done('assigned', {name: resident.name});
      }
      if (kind === 'claim') {
        if (jobPhase(n, index, now) !== 'ready') return no('notReady');
        let code, count;
        if (index === 'smith') { n.tools++; code = 'toolClaimed'; }
        if (index === 'gardener') {
          const bonus = n.jobs.gardener.care === CARE.version ? CARE.beds.filter((_, i) => crop(n, i, now)?.fertilized).length : 0;
          count = 4 * yieldPerPlot(n) + bonus; n.food += count; n.plots = [null, null, null, null]; code = 'gardenClaimed';
        }
        if (index === 'fisher') { n.fish += 2; code = 'fishClaimed'; }
        n.jobs[index] = null; events.push({kind: 'claimed', id: index}); return done(code, {count});
      }
      return no('unknown');
    }
    return {load, phase, jobPhase, careTime, crop, harvested, act, project, residents, GROW, CARE};
  }
  root.YardDomain = {create};
  if (typeof module !== 'undefined') module.exports = root.YardDomain;
})(globalThis);
