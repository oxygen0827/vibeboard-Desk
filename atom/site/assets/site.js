'use strict';
(() => {
  const film = document.querySelector('#product-film');
  if (film) {
    const status = document.querySelector('#film-status');
    const cover = document.querySelector('#film-play');
    film.controls = false; cover.hidden = false;
    let pendingTime = null;
    const report = message => { status.textContent = message; status.hidden = !message; };
    const play = async () => {
      try { const focusPlayer = document.activeElement === cover; film.controls = true; await film.play(); cover.hidden = true; film.tabIndex = 0; if (focusPlayer) film.focus({preventScroll:true}); report(''); }
      catch { report('请点击视频中的播放键继续；也可以选择「单独观看」。'); }
    };
    const seekAndPlay = time => {
      pendingTime = time;
      if (film.readyState >= 1) {
        film.currentTime = pendingTime;
        pendingTime = null;
      }
      play();
    };
    film.addEventListener('loadedmetadata', () => {
      if (pendingTime !== null) { film.currentTime = pendingTime; pendingTime = null; }
    });
    film.addEventListener('error', () => report('视频暂时无法加载。请检查网络，或选择「单独观看」后重试。'));
    cover.addEventListener('click', () => seekAndPlay(0));
    film.addEventListener('play', () => { cover.hidden = true; film.controls = true; });
    document.querySelectorAll('[data-watch]').forEach(link => link.addEventListener('click', () => seekAndPlay(0)));
    document.querySelectorAll('[data-seek]').forEach(button => button.addEventListener('click', () => seekAndPlay(Number(button.dataset.seek))));
    // Only an explicit visitor action starts playback; leaving the page stops sound.
    document.addEventListener('visibilitychange', () => { if (document.hidden) film.pause(); });
    window.addEventListener('pagehide', () => film.pause());
  }

  let pausePreview = () => {};
  let previewInteracting = false;
  let scheduleExhibit = () => {};
  const tabs = [...document.querySelectorAll('[data-experience]')];
  const stage = document.querySelector('.exhibit-stage');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0, userPaused = motion.matches, exhibitVisible = false, cycle = null, progress = null;
  const transitions = new Set();
  const pauseButton = document.querySelector('#exhibit-pause');
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  function selectTab(tab, direction = 1) {
    const next = tabs.indexOf(tab);
    if (next < 0) return;
    const old = panels[current], incoming = panels[next], changed = next !== current;
    transitions.forEach(animation => animation.cancel()); transitions.clear();
    panels.forEach(panel => panel.classList.remove('is-leaving'));
    if (changed) pausePreview();
    current = next;
    tabs.forEach((item,index) => {
      const selected = index === current;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      panels[index].hidden = !selected;
      panels[index].setAttribute('aria-hidden', String(!selected));
      panels[index].inert = !selected;
    });
    if (changed && !motion.matches && incoming.animate) {
      old.classList.add('is-leaving');
      const options = {duration:600,easing:'cubic-bezier(.22,.75,.18,1)',fill:'both'};
      for (const [panel,frames] of [[old,[{opacity:1,transform:'translateX(0)'},{opacity:0,transform:`translateX(${-direction*16}px)`}]],
        [incoming,[{opacity:0,transform:`translateX(${direction*16}px)`},{opacity:1,transform:'translateX(0)'}]]]) {
        const animation = panel.animate(frames,options); transitions.add(animation);
        animation.finished.catch(()=>{}).finally(()=>{
          if (transitions.delete(animation)) { panel.classList.remove('is-leaving'); animation.cancel(); }
        });
      }
    }
    document.querySelector('#exhibit-current').textContent = String(current+1).padStart(2,'0');
    // Scroll only the label strip; scrollIntoView would pull the whole page away from its reader.
    const strip = tab.parentElement, left = tab.offsetLeft-strip.offsetLeft-(strip.clientWidth-tab.offsetWidth)/2;
    strip.scrollTo({left,behavior:motion.matches?'auto':'smooth'});
    scheduleExhibit();
  }
  if (stage && tabs.length) {
    stage.classList.add('is-enhanced');
    document.querySelector('.exhibit-controls').hidden = false;
    const pace = document.querySelector('#exhibit-pace');
    scheduleExhibit = () => {
      clearTimeout(cycle); cycle = null; progress?.cancel(); progress = null;
      pauseButton.textContent = userPaused ? '开始轮播' : '暂停轮播';
      pauseButton.setAttribute('aria-label',userPaused?'开始自动轮播':'暂停自动轮播');
      const focused = stage.contains(document.activeElement);
      const running = !userPaused && !previewInteracting && !focused && exhibitVisible && !document.hidden;
      pace.textContent = previewInteracting ? '交互中 · 自动轮播已暂停' : userPaused ? '已暂停 · 慢慢看' : focused ? '阅读中 · 暂停切换' : '每 3 秒，下一种可能';
      stage.dataset.rotating = String(running);
      if (!running) return;
      if (!motion.matches) progress = document.querySelector('.exhibit-progress span').animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration:3000,fill:'forwards'});
      cycle = setTimeout(()=>selectTab(tabs[(current+1)%tabs.length]),3000);
    };
    tabs.forEach((tab,index) => {
      tab.addEventListener('click',()=>selectTab(tab,index<current?-1:1));
      tab.addEventListener('keydown',e=>{
        let next;
        if (e.key === 'ArrowRight') next = (index+1)%tabs.length;
        if (e.key === 'ArrowLeft') next = (index+tabs.length-1)%tabs.length;
        if (e.key === 'Home') next = 0;
        if (e.key === 'End') next = tabs.length-1;
        if (next === undefined) return;
        e.preventDefault(); selectTab(tabs[next],e.key==='ArrowLeft'?-1:1); tabs[next].focus({preventScroll:true});
      });
    });
    document.querySelector('#exhibit-previous').addEventListener('click',()=>selectTab(tabs[(current+tabs.length-1)%tabs.length],-1));
    document.querySelector('#exhibit-next').addEventListener('click',()=>selectTab(tabs[(current+1)%tabs.length]));
    pauseButton.addEventListener('click',()=>{userPaused=!userPaused;scheduleExhibit();});
    stage.addEventListener('focusin',scheduleExhibit);
    stage.addEventListener('focusout',()=>queueMicrotask(scheduleExhibit));
    document.addEventListener('visibilitychange',scheduleExhibit);
    motion.addEventListener('change',()=>{userPaused=motion.matches;selectTab(tabs[current]);});
    if ('IntersectionObserver' in window) new IntersectionObserver(entries=>{
      exhibitVisible=entries[0].isIntersecting;
      if (exhibitVisible) panels.forEach(panel=>panel.querySelectorAll('img').forEach(img=>{img.loading='eager';img.decode().catch(()=>{});}));
      scheduleExhibit();
    },{threshold:.15}).observe(stage);
    else {exhibitVisible=true;scheduleExhibit();}
    window.addEventListener('pagehide',()=>{exhibitVisible=false;scheduleExhibit();transitions.forEach(a=>a.cancel());transitions.clear();});
    window.addEventListener('pageshow',()=>{exhibitVisible=stage.getBoundingClientRect().bottom>0&&stage.getBoundingClientRect().top<innerHeight;scheduleExhibit();});
    selectTab(tabs[0]);
  }

  const canvas = document.querySelector('#material-preview');
  if (canvas) {
    const toggle = document.querySelector('#material-toggle');
    const label = document.querySelector('#preview-label');
    const status = document.querySelector('#preview-status');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let gl, program, buffer, enabled = false, visible = true, raf = 0, last = 0;
    let elapsed = 0, mouse = [.5, .5];
    const fragment = `precision mediump float;
      uniform float u_time; uniform vec2 u_resolution; uniform vec2 u_mouse;
      void main(){
        vec2 p=(gl_FragCoord.xy*2.-u_resolution)/u_resolution.y;
        vec2 m=(u_mouse*2.-1.)*vec2(u_resolution.x/u_resolution.y,1.);
        float t=u_time*.2;
        float w=sin(p.x*3.+sin(p.y*3.+t))*cos(p.y*2.-t);
        float r=length(p-m*.25);
        float f=sin(w*3.+r*4.-t*2.);
        float line=pow(.5+.5*sin(f*5.+p.y*3.),12.);
        vec3 base=mix(vec3(.025,.065,.1),vec3(.22,.55,.58),.5+.5*f);
        vec3 col=base+line*vec3(.66,.83,.78)*.7;
        col*=.55+.45*max(0.,1.-length(p)*.3);
        gl_FragColor=vec4(col,1.);
      }`;
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw Error('shader'); }
      return shader;
    }
    function dispose() {
      cancelAnimationFrame(raf); raf = 0;
      if (gl && program) gl.deleteProgram(program);
      if (gl && buffer) gl.deleteBuffer(buffer);
      program = buffer = null;
    }
    function init() {
      gl = canvas.getContext('webgl', {alpha:false,antialias:false,powerPreference:'low-power',preserveDrawingBuffer:true});
      if (!gl) throw Error('webgl');
      const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){gl_Position=vec4(a,0.,1.);}');
      let pixel;
      try {
        pixel = compile(gl.FRAGMENT_SHADER, fragment);
        program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, pixel); gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('link');
      } finally { gl.deleteShader(vertex); if (pixel) gl.deleteShader(pixel); }
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(program, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
      gl.viewport(0,0,canvas.width,canvas.height);
    }
    function draw() {
      if (!program || !enabled) return;
      gl.uniform1f(gl.getUniformLocation(program,'u_time'),elapsed);
      gl.uniform2f(gl.getUniformLocation(program,'u_resolution'),canvas.width,canvas.height);
      gl.uniform2f(gl.getUniformLocation(program,'u_mouse'),...mouse);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
    function tick(now) {
      raf = 0;
      if (!enabled || !visible || document.hidden || reduced.matches) return;
      if (!last || now-last >= 1000/30) { elapsed += last ? Math.min((now-last)/1000,.1) : 0; last = now; draw(); }
      raf = requestAnimationFrame(tick);
    }
    function resume() {
      cancelAnimationFrame(raf); raf = 0; last = 0;
      if (enabled && visible && !document.hidden) { draw(); if (!reduced.matches) raf = requestAnimationFrame(tick); }
    }
    function stop() {
      enabled = false; previewInteracting = false; scheduleExhibit(); cancelAnimationFrame(raf); raf = 0;
      canvas.hidden = true; toggle.setAttribute('aria-pressed','false');
      toggle.textContent = '用鼠标试试 ↗'; label.textContent = '实际应用界面';
    }
    pausePreview = stop;
    toggle.addEventListener('click', () => {
      if (enabled) { stop(); return; }
      try {
        if (!program) init();
        enabled = true; previewInteracting = true; scheduleExhibit(); canvas.hidden = false; status.hidden = true;
        toggle.setAttribute('aria-pressed','true'); toggle.textContent = '返回应用画面';
        label.textContent = reduced.matches ? '静态预览 · 移动光标改变光纹' : '网页交互预览 · 移动光标试试';
        resume();
      } catch {
        dispose(); stop(); status.hidden = false;
        status.textContent = '当前浏览器无法开启 WebGL，仍可查看实际应用画面。';
      }
    });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect(); mouse = [(e.clientX-r.left)/r.width,1-(e.clientY-r.top)/r.height];
      if (reduced.matches) draw();
    });
    canvas.addEventListener('keydown', e => {
      const delta = .08;
      if (e.key === 'ArrowLeft') mouse[0] -= delta;
      else if (e.key === 'ArrowRight') mouse[0] += delta;
      else if (e.key === 'ArrowUp') mouse[1] += delta;
      else if (e.key === 'ArrowDown') mouse[1] -= delta;
      else if (e.key === 'Home') mouse = [.5,.5];
      else return;
      e.preventDefault(); mouse = mouse.map(v => Math.max(0,Math.min(1,v))); draw();
    });
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault(); stop(); program = buffer = null;
      status.hidden = false; status.textContent = '交互预览已暂停，图形环境恢复后可重新开启。';
    });
    if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; resume(); },{threshold:.05}).observe(canvas.parentElement);
    document.addEventListener('visibilitychange', resume);
    if (reduced.addEventListener) reduced.addEventListener('change', resume);
    window.addEventListener('pagehide', () => { stop(); dispose(); });
  }

  const field = document.querySelector('#guide-search');
  if (!field) return;
  const sections = [...document.querySelectorAll('.guide-content section')];
  const links = [...document.querySelectorAll('.guide-side nav a')];
  const empty = document.querySelector('.no-results');
  field.addEventListener('input', () => {
    const q = field.value.trim().toLocaleLowerCase(); let count = 0;
    for (const section of sections) {
      const hit = !q || section.textContent.toLocaleLowerCase().includes(q);
      section.hidden = !hit; if (hit) count++;
      const link = links.find(a => a.hash === '#'+section.id); if (link) link.hidden = !hit;
    }
    empty.hidden = count > 0;
  });
  const mark = id => { for (const a of links) { const active = a.hash === '#'+id; a.classList.toggle('active',active); if(active) a.setAttribute('aria-current','location'); else a.removeAttribute('aria-current'); } };
  for (const a of links) a.addEventListener('click', () => mark(a.hash.slice(1)));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) mark(e.target.id); },{rootMargin:'-100px 0px -65% 0px'});
    sections.forEach(s => observer.observe(s));
  }
})();
