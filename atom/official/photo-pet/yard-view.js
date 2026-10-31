/* DOM adapter. Formats read models and emits intents; never changes game state. */
(function(root) {
  'use strict';
  const messages = {
    loading: '正在读取小院…', loaded: '找居民安排工作，或亲手照顾菜地', saving: '正在保存…',
    readFailed: '读取失败，已暂停操作以保护进度', assetsFailed: '画面资源未能加载，请退出后重新打开',
    saveFailed: '保存失败，进度未改变；请重试', choosePlot: '请选择菜地',
    plotManaged: '小禾正在照料菜地，请找她领取收获', planted: '种下萝卜啦，再确认一次浇水',
    watered: '浇好水了，30 秒后收获', harvested: d => '收获 '+d.count+' 根萝卜，可以喂伙伴了',
    growing: '萝卜正在长大，先去散散步吧', noFood: '先收获萝卜，或安排阿澈钓鱼',
    flowers: '亲密度 3，小院开出了一圈花', fed: '伙伴吃得很开心，亲密度 +1',
    following: '伙伴会跟着你一起走', staying: '伙伴留在原地等你', choosePet: '请选择伙伴',
    petChanged: '今天一起照顾小院吧', petUnchanged: '今天继续一起照顾小院吧',
    chooseResident: '请选择居民', jobExists: '已有任务，请等待完成后领取',
    toolsComplete: '园艺工具已备齐，菜地产量已提升至每块 5 根',
    assigned: d => d.name+'接下了任务，完成后找居民领取成果', notReady: '任务还没有完成',
    toolClaimed: '获得园艺工具，菜地每次收获增加 1 根', gardenClaimed: d => '小禾交给你 '+d.count+' 根萝卜',
    fishClaimed: '阿澈带回 2 条鱼，可用来喂伙伴', unknown: '未知操作',
    walkToPlot: d => '走到第 '+(d.index+1)+' 块菜地…', stroll: '沿着小路散步…'
  };
  const stages = {
    smith: {walk: '往返炉台', heat: '炉中加热', forge: '锻打成形', strike: '锻打成形', polish: '打磨工具', deliver: '整理成品'},
    gardener: {walk: '前往菜地', sow: '松土播种', water: '浇水', fertilize: '撒堆肥', inspect: '检查长势', harvest: '采收', deliver: '整理收获'},
    fisher: {cast: '抛出鱼线', wait: '等待鱼讯', reel: '收线提竿', catch: '把鱼收入桶', deliver: '整理鱼获'}
  };
  function create({document: doc, portraits}) {
    const $ = id => doc.getElementById(id);
    let intent = () => {}, content, mounted = false, selected = null, noticeUntil = null, controlKey = '';
    const cleanups = [];
    function listen(el, name, fn) {el.addEventListener(name, fn); cleanups.push(() => el.removeEventListener(name, fn));}
    function context() {return {modal: $('picker').open ? 'picker' : $('job-panel').open ? 'job' : null, residentId: selected};}
    function close() {
      if ($('picker').open) {$('picker').close(); $('choose').focus();}
      if ($('job-panel').open) {$('job-panel').close(); $('npc-'+selected)?.focus();}
      controlKey = '';
    }
    function open(kind, id) {
      if (kind === 'job') {
        selected = id; const r = content.residents.find(r => r.id === id);
        $('job-title').textContent = r.name+' · '+r.role; $('job-desc').textContent = r.description;
        $('job-status').textContent = '任务进度会保存在这台小电脑';
        portraits.resident($('job-portrait'), id); $('job-panel').showModal(); $('close-job').focus();
      } else {
        $('picker-status').textContent = '种植和任务进度都会保留'; $('picker').showModal();
        $('pet-list').querySelector('[aria-pressed=true]')?.focus();
      }
      controlKey = '';
    }
    function feedback(result, monotonic) {
      if (!result.code) return;
      const value = messages[result.code], text = typeof value === 'function' ? value(result.data || {}) : value;
      if (!text) return;
      const message = text + (result.preview ? '（临时预览）' : '');
      $('status').textContent = message; $('status').hidden = false;
      noticeUntil = result.persistent || ['readFailed','assetsFailed','saveFailed','saving','loading'].includes(result.code) ? null : monotonic + 3000;
      if ($('picker').open) $('picker-status').textContent = message;
      if ($('job-panel').open) $('job-status').textContent = message;
      $('retry').hidden = result.code !== 'readFailed';
    }
    function mount(data, onIntent) {
      if (mounted) return;
      mounted = true; content = data; intent = onIntent;
      for (let i = 0; i < 4; i++) {
        const b = doc.createElement('button'); b.id = 'plot-'+i; b.className = 'plot'; b.innerHTML = '<span>播种</span>';
        listen(b, 'click', () => intent('plot', i)); $('plots').append(b);
      }
      for (const r of data.residents) {
        const b = doc.createElement('button'); b.id = 'npc-'+r.id; b.className = 'resident';
        listen(b, 'click', () => intent('openResident', r.id)); $('residents').append(b);
      }
      for (const pet of data.pets) {
        const b = doc.createElement('button'); b.className = 'pet-card'; b.dataset.pet = pet.id;
        b.setAttribute('aria-label', pet.kind+' '+pet.name);
        b.innerHTML = '<canvas width="96" height="96"></canvas><span></span>';
        b.querySelector('span').textContent = pet.name+' · '+pet.kind;
        b.querySelector('canvas').getContext('2d').drawImage(portraits.pet(pet), 0, 0);
        listen(b, 'click', () => intent('pet', pet.id)); $('pet-list').append(b);
      }
      for (const id of ['feed','follow','stroll','choose','retry']) listen($(id), 'click', () => intent(id));
      listen($('job-action'), 'click', () => intent('job', selected));
      for (const id of ['close-picker','close-job']) listen($(id), 'click', () => intent('close'));
      for (const id of ['picker','job-panel']) listen($(id), 'cancel', event => {event.preventDefault(); intent('close');});
    }
    function render({frame: f, loaded, busy, revision, wallTime, monotonic}) {
      if (noticeUntil !== null && monotonic >= noticeUntil) {$('status').hidden = true; noticeUntil = null;}
      const canvas = $('scene'), gardener = f.residents.find(n => n.id === 'gardener');
      const eat = f.effect?.kind === 'feed' && f.time - f.effect.at < 2.5;
      const fields = {frame: f.frameCount, autonomous: f.autonomous, route: f.route, pet: f.petId, food: f.food, bond: f.bond,
        actorX: f.actor.x.toFixed(1), actorY: f.actor.y.toFixed(1), petX: f.pet.x.toFixed(1), petY: f.pet.y.toFixed(1),
        petMode: eat ? 'nibble' : f.pet.walk ? 'walk' : f.pet.ambientMode || 'idle',
        residentFrames: f.residents.map(n => n.frame).join(','), environment: f.motion ? 'flowing' : 'still',
        gardenerStage: gardener.stage, gardenerX: gardener.x.toFixed(1), gardenerPlot: gardener.plot === undefined ? '' : gardener.plot,
        cropCare: f.plots.map(p => p.harvested ? 'harvested' : p.fertilized ? 'fertilized' : p.stage).join(','),
        readyProducts: f.readyProducts.join(',')};
      for (const [key, value] of Object.entries(fields)) if (canvas.dataset[key] !== String(value)) canvas.dataset[key] = value;
      for (const r of f.residents) {
        const b = $('npc-'+r.id); if (!b) continue;
        const left = r.x/480*100+'%', top = (r.y+4)/360*100+'%';
        if (b.style.left !== left) b.style.left = left; if (b.style.top !== top) b.style.top = top;
      }
      const ctx = context(), key = [loaded,busy,revision,Math.floor(wallTime/1000),ctx.modal,selected].join('|');
      if (key === controlKey) return; controlKey = key;
      doc.querySelectorAll('main button:not(#retry),#picker .pet-card,#job-action').forEach(b => b.disabled = !loaded || busy);
      $('inventory').textContent = '萝卜 '+f.food+' · 鱼 '+f.fish+' · ♥ '+f.bond;
      $('follow').textContent = f.follow ? '跟随 · 开' : '跟随 · 关'; $('follow').setAttribute('aria-pressed', String(f.follow));
      if (!mounted) return;
      for (const p of f.plots) {
        const label = p.locked ? '照料中' : {empty:'播种',dry:'浇水',ready:'收获',growing:p.remaining+'秒'}[p.stage], b = $('plot-'+p.index);
        b.firstChild.textContent = label; b.setAttribute('aria-label', '菜地'+(p.index+1)+' '+label); b.disabled = !loaded || busy || p.locked;
      }
      for (const r of content.residents) {
        const job = f.jobs.find(j => j.id === r.id);
        $('npc-'+r.id).setAttribute('aria-label', '与'+r.role+r.name+'交谈'+(job.phase === 'idle' ? '' : '，'+(job.canClaim ? '可领取成果' : '工作中')));
      }
      for (const b of $('pet-list').children) b.setAttribute('aria-pressed', String(b.dataset.pet === f.petId));
      if (ctx.modal === 'job') {
        const r = content.residents.find(r => r.id === selected), job = f.jobs.find(j => j.id === selected);
        const activity = (job.plot === undefined ? '' : '第 '+(job.plot+1)+' 块 · ') + (stages[selected][job.stage] || '工作中');
        $('job-progress').textContent = job.phase === 'working' ? activity+' · 还需 '+job.remaining+' 秒' : job.canClaim ? '任务完成，成果等你领取' : job.quotaReached ? '工具已备齐' : '空闲 · 任务约 '+r.duration/1000+' 秒';
        $('job-action').textContent = job.canClaim ? '领取成果' : job.phase === 'working' ? '正在工作…' : job.quotaReached ? '已完成全部工具' : '安排：'+r.task;
        $('job-action').disabled = !loaded || busy || !(job.canAssign || job.canClaim);
        $('job-tools').textContent = '工具 '+f.tools+'/'+f.maxTools+' · 每块 '+f.yieldPerPlot+' 根'+(job.careBonus ? ' · 堆肥 +'+job.careBonus : '');
      }
    }
    function dispose() {cleanups.splice(0).forEach(fn => fn()); intent = () => {};}
    return {mount, render, feedback, context, open, close, back() {if (!context().modal) return false; close(); return true;}, dispose};
  }
  root.YardView = {create};
  if (typeof module !== 'undefined') module.exports = root.YardView;
})(globalThis);
