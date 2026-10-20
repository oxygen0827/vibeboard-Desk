/* Portable browser-test runtime. Prefer this checkout's npm install. */
const fs=require('node:fs'),path=require('node:path');
let runtime;
const candidates=[process.env.ATOM_PLAYWRIGHT_MODULE,'playwright',path.join(process.env.HOME||'','.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')].filter(Boolean);
for(const candidate of candidates){try{runtime=require(candidate);break}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error}}
if(!runtime)throw Error('Install browser test dependencies: npm --prefix atom install && npx --prefix atom playwright install chromium');
let executablePath=process.env.ATOM_CHROME_EXECUTABLE;
if(!executablePath&&process.platform==='darwin'&&fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))executablePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
module.exports={chromium:runtime.chromium,executablePath};
