const {chromium,executablePath} = require('../tools/browser-test-runtime.cjs');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const port = 18943;
  const server = spawn('python3',[path.join(__dirname,'preview.py'),'--port',String(port)],{stdio:'ignore'});
  let browser;
  const origin = `http://127.0.0.1:${port}`;
  const failures = [];
  try {
    let ready = false;
    for (let i=0;i<40;i++) {
      try { if ((await fetch(origin+'/atom/')).ok) {ready=true;break;} } catch {}
      await new Promise(r=>setTimeout(r,100));
    }
    assert(ready,'preview did not start');
    browser = await chromium.launch({headless:true,...executablePath?{executablePath}:{},args:['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
    const page = await browser.newPage();
    const errors = p => {
      p.on('pageerror',e=>failures.push(e.message));
      p.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400)failures.push(r.status()+' '+r.url());});
    };
    errors(page);
    for (const [width,height] of [[1440,1000],[390,844],[768,1024],[320,720]]) {
      await page.setViewportSize({width,height});
      await page.goto(origin+'/atom/');
      assert(await page.locator('h1').textContent());
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow home '+width);
      assert(await page.locator('#product-film').evaluate(v=>v.paused),'no autoplay');
      assert(await page.locator('#film-play').isVisible());
      const bad = await page.locator('a[href^="#"]').evaluateAll(as=>as.filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.href));
      assert.deepEqual(bad,[]);
      for (const name of ['alchemy','world','duet','water','flow','ocean','planets','studio','physics','eyes','circuit','math']) {
        await page.locator(`#tab-${name}`).click();
        assert.equal(await page.locator(`#tab-${name}`).getAttribute('aria-selected'),'true');
        await page.waitForTimeout(650);
        assert(await page.locator(`#panel-${name}`).isVisible());
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'carousel overflow '+width+' '+name);
        await page.locator(`#panel-${name} img`).evaluate(img=>img.decode());
      }
      // Decode lazy content before a full-page screenshot, so empty frames cannot pass QA.
      await page.locator('.computer-visual').scrollIntoViewIfNeeded();
      await page.locator('.computer-visual img').evaluate(img=>img.decode());
      await page.evaluate(()=>scrollTo(0,0));
      await page.screenshot({path:path.join(os.tmpdir(),`atom-site-home-${width}.png`),fullPage:true});
      await page.goto(origin+'/atom/guide/');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal overflow guide '+width);
      assert.deepEqual(await page.locator('a[href^="#"]').evaluateAll(as=>as.filter(a=>!document.getElementById(a.hash.slice(1))).map(a=>a.href)),[]);
      await page.locator('#guide-search').fill('恢复密钥');
      assert(await page.locator('#account').isVisible());
      assert(!(await page.locator('#desktop').isVisible()));
      await page.locator('#guide-search').fill('没有这条资料ZXY123');
      assert(await page.locator('.no-results').isVisible());
      await page.locator('#guide-search').fill('');
      assert(await page.locator('#desktop').isVisible());
      await page.screenshot({path:path.join(os.tmpdir(),`atom-site-guide-${width}.png`),fullPage:true});
    }

    await page.setViewportSize({width:1440,height:1000});
    await page.goto(origin+'/atom/');
    await page.locator('#film-play').click();
    await page.waitForFunction(()=>{const v=document.querySelector('video');return !v.paused&&v.currentTime>.2&&v.videoWidth===1920;});
    assert.equal(await page.locator('video').evaluate(v=>v.duration),40);
    assert.equal(await page.locator('video').evaluate(v=>v.controls),true);
    await page.locator('[data-seek="28"]').click();
    await page.waitForFunction(()=>document.querySelector('video').currentTime>=28);
    await page.locator('video').evaluate(v=>v.pause());
    await page.screenshot({path:path.join(os.tmpdir(),'atom-site-video-playing.png')});
    await page.locator('.film-transcript summary').click();
    assert(await page.locator('.film-transcript p').first().isVisible());

    await page.locator('#tab-alchemy').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#tab-world').getAttribute('aria-selected'),'true');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#tab-math').getAttribute('aria-selected'),'true');
    await page.keyboard.press('Home');
    await page.locator('#material-toggle').click();
    assert(await page.locator('canvas').isVisible());
    assert(await page.locator('canvas').evaluate(c=>!!c.getContext('webgl')));
    const first = await page.locator('canvas').evaluate(c=>c.toDataURL());
    await page.waitForTimeout(350);
    assert(first !== await page.locator('canvas').evaluate(c=>c.toDataURL()),'live shader changes');
    await page.locator('#tab-world').click();
    assert(!(await page.locator('canvas').isVisible()),'tab switch suspends preview');
    await page.locator('#tab-alchemy').click();
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
    await page.locator('#material-toggle').click();
    await page.locator('canvas').scrollIntoViewIfNeeded();
    await page.mouse.move(0,0);
    await page.waitForTimeout(150);
    const still = await page.locator('canvas').evaluate(c=>c.toDataURL());
    await page.waitForTimeout(200);
    // Compare shader pixels, avoiding the rotated CSS border's subpixel rasterization.
    assert.equal(still,await page.locator('canvas').evaluate(c=>c.toDataURL()),'reduced motion freezes time');
    await page.locator('canvas').focus();
    await page.keyboard.press('ArrowRight');
    assert(still !== await page.locator('canvas').evaluate(c=>c.toDataURL()),'keyboard changes material');
    await page.locator('#material-toggle').click();

    for (const summary of await page.locator('.faq-list summary').all()) {
      await summary.click();
      assert(await summary.locator('..').evaluate(d=>d.open));
      await summary.click();
    }
    const links = await page.locator('a[href^="/atom/"]').evaluateAll(as=>[...new Set(as.map(a=>a.getAttribute('href').split('#')[0]))]);
    for(const link of links) assert((await fetch(origin+link)).ok,'bad local link '+link);

    // Graceful degradation: unsupported graphics keeps the real screenshot and explains why.
    const fallback = await browser.newPage(); errors(fallback);
    await fallback.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl'?null:original.call(this,kind,...args);};});
    await fallback.goto(origin+'/atom/'); await fallback.locator('#material-toggle').click();
    assert(await fallback.locator('#preview-status').isVisible());
    assert(!(await fallback.locator('canvas').isVisible()));
    await fallback.close();

    // A real three-second cycle, including transition and fixed stage height.
    const carousel = await browser.newPage({viewport:{width:1440,height:1000}}); errors(carousel);
    await carousel.goto(origin+'/atom/');
    await carousel.locator('.exhibit-stage').scrollIntoViewIfNeeded();
    await carousel.waitForFunction(()=>document.querySelector('.exhibit-stage').dataset.rotating==='true');
    await carousel.locator('#exhibit-pause').click();
    await carousel.locator('#tab-alchemy').click();
    const before = await carousel.locator('.exhibit-stage').boundingBox();
    await carousel.locator('#exhibit-pause').click();
    await carousel.waitForTimeout(2400);
    assert.equal(await carousel.locator('#tab-alchemy').getAttribute('aria-selected'),'true','does not advance early');
    await carousel.waitForFunction(()=>document.querySelector('#tab-world').getAttribute('aria-selected')==='true',{},{timeout:1500});
    const animation = await carousel.locator('#panel-world').evaluate(p=>p.getAnimations().map(a=>({duration:a.effect.getTiming().duration,state:a.playState})));
    assert(animation.some(a=>a.duration===600&&a.state==='running'),'uses a smooth 600 ms transition');
    await carousel.waitForTimeout(650);
    const after = await carousel.locator('.exhibit-stage').boundingBox();
    assert(Math.abs(before.height-after.height)<1,'carousel height stays fixed');
    await carousel.locator('#exhibit-pause').click();
    await carousel.waitForTimeout(3100);
    assert.equal(await carousel.locator('#tab-world').getAttribute('aria-selected'),'true','pause persists');
    await carousel.locator('#tab-math').click();
    await carousel.locator('#exhibit-next').click();
    assert.equal(await carousel.locator('#tab-alchemy').getAttribute('aria-selected'),'true','last wraps to first');
    await carousel.locator('#material-toggle').click();
    await carousel.locator('#exhibit-pause').click();
    await carousel.waitForTimeout(3100);
    assert.equal(await carousel.locator('#tab-alchemy').getAttribute('aria-selected'),'true','interactive preview holds the slide');
    await carousel.locator('#material-toggle').click();
    await carousel.locator('#exhibit-next').focus();
    await carousel.locator('h1').scrollIntoViewIfNeeded();
    await carousel.waitForTimeout(500);
    assert.equal(await carousel.locator('.exhibit-stage').getAttribute('data-rotating'),'false','offscreen timer stops');
    await carousel.emulateMedia({reducedMotion:'reduce'});
    await carousel.locator('.exhibit-stage').scrollIntoViewIfNeeded();
    assert.equal(await carousel.locator('#exhibit-pause').textContent(),'开始轮播','reduced motion starts paused');
    assert.equal(await carousel.locator('.exhibit-stage').getAttribute('data-rotating'),'false');
    await carousel.close();

    const nojs = await browser.newPage({javaScriptEnabled:false}); errors(nojs);
    await nojs.goto(origin+'/atom/');
    assert.equal(await nojs.locator('video').getAttribute('controls'),'');
    assert(await nojs.locator('#panel-alchemy img').isVisible());
    await nojs.close();
    assert.deepEqual(failures,[]);
    console.log(JSON.stringify({ok:true,viewports:[1440,390,768,320],checks:['assets and anchors','actual MP4 playback and chapter seeking','no autoplay','12 curated cases','3-second automatic carousel','600ms transition without layout jump','pause/wrap/preview hold/offscreen stop','keyboard tabs','real WebGL animation and keyboard interaction','reduced motion','graphics fallback','FAQ','guide search/filter/empty/reset','no horizontal overflow','console errors','no-JS video fallback'],screenshots:os.tmpdir()},null,2));
  } finally { await browser?.close(); server.kill(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
