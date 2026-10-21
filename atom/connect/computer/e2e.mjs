// End-to-end encryption shared with the ATOM device (twin: atom/e2e.py). Same formats, same associated data.
import crypto from 'node:crypto';

const SALT=Buffer.from('atom-e2e-v1'),PASSWORD_ITERATIONS=310000,CROCKFORD='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PKCS8=Buffer.from('302e020100300506032b656e04220420','hex'),SPKI=Buffer.from('302a300506032b656e032100','hex');
export class E2EError extends Error{}

export const b64=data=>Buffer.from(data).toString('base64url');
export function unb64(text,size){if(typeof text!=='string'||!/^[A-Za-z0-9_-]*$/.test(text))throw new E2EError('invalid encoding');const data=Buffer.from(text,'base64url');if(size!==undefined&&data.length!==size)throw new E2EError('invalid key length');return data;}
const hkdf=(material,info)=>Buffer.from(crypto.hkdfSync('sha256',material,SALT,Buffer.from(info,'utf8'),32));
const privateObject=raw=>crypto.createPrivateKey({key:Buffer.concat([PKCS8,unb64(raw,32)]),format:'der',type:'pkcs8'});
const publicObject=raw=>crypto.createPublicKey({key:Buffer.concat([SPKI,unb64(raw,32)]),format:'der',type:'spki'});

export function newPrivateKey(){const {privateKey}=crypto.generateKeyPairSync('x25519');return b64(privateKey.export({format:'der',type:'pkcs8'}).subarray(PKCS8.length));}
export function publicKey(privateRaw){return b64(crypto.createPublicKey(privateObject(privateRaw)).export({format:'der',type:'spki'}).subarray(SPKI.length));}
export function pairKey(privateRaw,peerPublic,deviceId,computerId){return hkdf(crypto.diffieHellman({privateKey:privateObject(privateRaw),publicKey:publicObject(peerPublic)}),'atom-task|'+deviceId+'|'+computerId);}
export function safetyCode(devicePublic,computerPublic){const v=crypto.createHash('sha256').update(Buffer.concat([unb64(devicePublic,32),unb64(computerPublic,32)])).digest().readUInt32BE(0)%1000000;return String(Math.floor(v/1000)).padStart(3,'0')+' '+String(v%1000).padStart(3,'0');}

export function seal(key,text,aad){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from(aad,'utf8'));const ct=Buffer.concat([c.update(String(text),'utf8'),c.final(),c.getAuthTag()]);return {v:1,iv:b64(iv),ct:b64(ct)};}
export function open(key,envelope,aad){if(!envelope||envelope.v!==1||typeof envelope.iv!=='string'||typeof envelope.ct!=='string')throw new E2EError('invalid envelope');
  const data=unb64(envelope.ct);if(data.length<16)throw new E2EError('cannot decrypt');
  try{const d=crypto.createDecipheriv('aes-256-gcm',key,unb64(envelope.iv,12));d.setAAD(Buffer.from(aad,'utf8'));d.setAuthTag(data.subarray(data.length-16));return Buffer.concat([d.update(data.subarray(0,data.length-16)),d.final()]).toString('utf8');}catch{throw new E2EError('cannot decrypt');}}
export const sealJSON=(key,value,aad)=>seal(key,JSON.stringify(value),aad);
export function openJSON(key,envelope,aad){const text=open(key,envelope,aad);try{return JSON.parse(text);}catch{throw new E2EError('invalid sealed JSON');}}

// Account keys (notes and agenda)
export const passwordKey=(password,salt,iterations=PASSWORD_ITERATIONS)=>crypto.pbkdf2Sync(Buffer.from(password,'utf8'),unb64(salt),iterations,32,'sha256');
export function newRecoveryCode(){let bits=BigInt('0x'+crypto.randomBytes(15).toString('hex')),chars='';for(let i=0;i<24;i++){chars=CROCKFORD[Number(bits&31n)]+chars;bits>>=5n;}return chars.match(/.{4}/g).join('-');}
export function recoveryKey(code){const clean=String(code).toUpperCase().replace(/[-\s]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1');if(clean.length!==24||[...clean].some(c=>!CROCKFORD.includes(c)))throw new E2EError('invalid recovery code');
  let bits=0n;for(const c of clean)bits=(bits<<5n)|BigInt(CROCKFORD.indexOf(c));return hkdf(Buffer.from(bits.toString(16).padStart(30,'0'),'hex'),'atom-recovery');}
export function newAccountKeys(password){const dataKey=crypto.randomBytes(32),salt=b64(crypto.randomBytes(16)),code=newRecoveryCode();
  return {dataKey,code,record:{v:1,key_id:b64(crypto.createHash('sha256').update(dataKey).digest().subarray(0,9)),salt,iterations:PASSWORD_ITERATIONS,by_password:seal(passwordKey(password,salt),b64(dataKey),'atom-account-key'),by_recovery:seal(recoveryKey(code),b64(dataKey),'atom-account-key')}};}
export const unlockWithPassword=(record,password)=>unb64(open(passwordKey(password,record.salt,record.iterations||PASSWORD_ITERATIONS),record.by_password,'atom-account-key'),32);
export const unlockWithRecovery=(record,code)=>unb64(open(recoveryKey(code),record.by_recovery,'atom-account-key'),32);
export function rewrapPassword(record,dataKey,password){const salt=b64(crypto.randomBytes(16));return {...record,salt,iterations:PASSWORD_ITERATIONS,by_password:seal(passwordKey(password,salt),b64(dataKey),'atom-account-key')};}
