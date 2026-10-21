// Talks to the ATOM simulator that the Mac app runs on 127.0.0.1:8790 (see atom/tools/simulator.py).
// The direct link never touches the relay; pairing deliberately goes through it like a real device.
import http from 'node:http';

export const SIMULATOR_ORIGIN = process.env.ATOM_SIMULATOR_ORIGIN || 'http://127.0.0.1:8790';

export function call(path, {method = 'GET', body} = {}) {
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const started = performance.now();
  return new Promise((resolve, reject) => {
    // The device backend only accepts same-origin POSTs, so present the simulator's own origin.
    const req = http.request(SIMULATOR_ORIGIN + path, {method, timeout: 4000, headers: {Accept: 'application/json', Origin: SIMULATOR_ORIGIN, ...(data ? {'Content-Type': 'application/json', 'Content-Length': data.length} : {})}}, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; if (text.length > 1 << 20) req.destroy(new Error('模拟设备响应过大')); });
      res.on('end', () => {
        let value;
        try { value = JSON.parse(text || '{}'); } catch { return reject(new Error('模拟设备响应格式错误')); }
        if (res.statusCode >= 400) return reject(Object.assign(new Error(value.error || '模拟设备拒绝了请求'), {status: res.statusCode}));
        resolve({ms: Math.round(performance.now() - started), value});
      });
    });
    req.on('timeout', () => req.destroy(new Error('模拟设备无响应')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Live view of both test links: Mac ⇄ simulator directly, and simulator ⇄ relay ⇄ Mac.
export async function simulatorState(companion) {
  let status;
  try { status = await call('/api/status'); } catch (e) { return {running: false, error: e.code === 'ECONNREFUSED' ? '' : e.message}; }
  const result = {running: true, direct_ms: status.ms, hostname: status.value.hostname};
  try { result.apps = (await call('/api/apps')).value.apps.length; } catch {}
  try {
    const link = (await call('/api/connect/state')).value;
    const mac = companion.state().client_id;
    const own = (link.paired || []).find(p => p.client_id === mac);
    result.device = {configured: !!link.configured, relay_url: link.relay_url || '', name: link.device_name || '', client_id: link.client_id || '', error: link.connection_error || '', pair_requests: (link.pair_requests || []).length};
    // Pairing is only real when both ends see it through the relay.
    const seen = (companion.relayState?.paired || []).find(p => p.client_id === link.client_id);
    result.pairing = {device_sees_mac: !!own, mac_online_for_device: !!own?.online, mac_sees_device: !!seen, device_online_for_mac: !!seen?.online, e2e: seen ? (companion.pairings?.[seen.client_id]?.state || 'off') : ''};
  } catch (e) { result.device = {error: e.message}; }
  return result;
}

// Same steps a person does by hand: the device shows a code, the Mac claims it, the device confirms.
export async function pairSimulator(companion) {
  const before = (await call('/api/connect/state')).value;
  if (!before.configured) throw new Error('模拟设备还没有连上中继服务器');
  if (before.relay_url && companion.state().relay_url && before.relay_url.replace(/\/$/, '') !== companion.state().relay_url.replace(/\/$/, '')) throw new Error('模拟设备和这台 Mac 连的不是同一个中继服务器');
  const code = (await call('/api/connect/pair-code', {method: 'POST', body: {}})).value.code;
  if (!code) throw new Error('模拟设备没有生成配对码');
  const claim = await companion.request('/v1/pair/claim', {code: String(code), public_key: companion.publicKey()});
  if (!claim?.request_id) throw new Error('中继没有返回配对请求');
  const request = {request_id: claim.request_id};
  await call('/api/connect/pair-confirm', {method: 'POST', body: {request_id: request.request_id, accept: true}});
  companion.relayState = await companion.request('/v1/state');
  await companion.syncKeys?.();
  return simulatorState(companion);
}

// One-way, explicit import; only an already paired computer can decrypt a device snapshot.
export async function mirrorDevice(companion, deviceId, {confirm=false}={}) {
  if(confirm!==true)throw new Error('请先确认覆盖模拟设备中的桌面与本地记录');
  if(typeof deviceId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(deviceId))throw new Error('请选择已配对设备');
  const peer=(companion.relayState?.paired||[]).find(p=>p.client_id===deviceId);
  const pair=companion.pairings[deviceId];
  if(!peer||pair?.state!=='on')throw new Error('请先完成加密配对');
  const encrypted=await companion.request('/v1/device/snapshot/'+deviceId);
  const {openJSON}=await import('./e2e.mjs');
  const data=openJSON(pair.key,encrypted.envelope,'snapshot|'+deviceId+'|'+encrypted.version);
  if(Buffer.byteLength(JSON.stringify(data))>65536)throw new Error('快照超过 64 KiB');
  await call('/api/device-data/preview',{method:'POST',body:{data}});
  return {version:encrypted.version,updated:encrypted.updated};
}
