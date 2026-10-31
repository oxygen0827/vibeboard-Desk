const path=require('node:path');
const catalog=require('./yard-catalog.js'),layout=require('./yard-layout.js');
const Y=require('./yard.js').create({catalog});
const Life=require('./yard-life.js').create({domain:Y,layout});
const scripts=['assets.js','pets.js','renderer.js','yard-catalog.js','yard-layout.js','yard-ports.js','yard.js','yard-life.js','yard-scene.js','yard-environment.js','yard-rig.js','yard-renderer.js'];
async function installRenderer(page){
 for(const file of scripts)await page.addScriptTag({path:path.join(__dirname,file)});
 await page.addScriptTag({path:path.join(__dirname,'test-fixtures/render-harness.js')});
}
module.exports={Y,Life,layout,catalog,installRenderer};
