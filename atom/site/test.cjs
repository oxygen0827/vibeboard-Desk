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
      for (const name of ['world','duet','alchemy']) {
        await page.locator(`#tab-${name}`).click();
        assert(await page.locator(`#panel-${name}`).isVisible());
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
    assert(await page.locator('#panel-duet').isVisible());
    await page.keyboard.press('Home');
    await page.locator('#material-toggle').click();
    assert(await page.locator('canvas').isVisible());
    assert(await page.locator('canvas').evaluate(c=>!!c.getContext('webgl')));
    const first = await page.locator('canvas').screenshot();
    await page.waitForTimeout(350);
    assert(!first.equals(await page.locator('canvas').screenshot()),'live shader changes');
    await page.locator('#tab-world').click();
    assert(!(await page.locator('canvas').isVisible()),'tab switch suspends preview');
    await page.locator('#tab-alchemy').click();
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
    await page.locator('#material-toggle').click();
    const still = await page.locator('canvas').screenshot();
    await page.waitForTimeout(200);
    assert(still.equals(await page.locator('canvas').screenshot()),'reduced motion freezes time');
    await page.locator('canvas').focus();
    await page.keyboard.press('ArrowRight');
    assert(!still.equals(await page.locator('canvas').screenshot()),'keyboard changes material');
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

    const nojs = await browser.newPage({javaScriptEnabled:false}); errors(nojs);
    await nojs.goto(origin+'/atom/');
    assert.equal(await nojs.locator('video').getAttribute('controls'),'');
    assert(await nojs.locator('#panel-alchemy img').isVisible());
    await nojs.close();
    assert.deepEqual(failures,[]);
    console.log(JSON.stringify({ok:true,viewports:[1440,390,768,320],checks:['assets and anchors','actual MP4 playback and chapter seeking','no autoplay','keyboard tabs','real WebGL animation and keyboard interaction','reduced motion','graphics fallback','FAQ','guide search/filter/empty/reset','no horizontal overflow','console errors','no-JS video fallback'],screenshots:os.tmpdir()},null,2));
  } finally { await browser?.close(); server.kill(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
