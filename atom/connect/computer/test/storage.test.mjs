import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writePrivate} from '../store.mjs';

test('failed flush or rename preserves old private state and removes temporary files',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atom-storage-'));
 const file=path.join(root,'state.json');
 try{
  writePrivate(file,{saved:'original'});
  for(const operation of ['fsyncSync','renameSync']){
   const original=fs[operation];fs[operation]=()=>{throw Error('injected disk failure')};
   try{assert.throws(()=>writePrivate(file,{saved:'new'}),/disk failure/);}finally{fs[operation]=original;}
   assert.deepEqual(JSON.parse(fs.readFileSync(file)),{saved:'original'});
   assert.deepEqual(fs.readdirSync(root),['state.json']);
  }
  writePrivate(file,{saved:'new'});
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),{saved:'new'});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
