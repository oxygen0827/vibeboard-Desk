const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),crypto=require('crypto');
const source=fs.readFileSync(__dirname+'/app.js','utf8');const fn=source.slice(source.indexOf('function fingerprint('),source.indexOf('function request('));const context={TextEncoder};vm.createContext(context);vm.runInContext(fn,context);
for(const text of ['', 'abc', '你好，ATOM！', '😀'.repeat(6000), '汉'.repeat(12000), '\0'.repeat(12000)])assert.equal(context.fingerprint(text),crypto.createHash('sha256').update(text).digest('hex'));
console.log('PASS: SHA-256 matches Node crypto for empty, ASCII, Chinese, emoji and maximum-size inputs.');
