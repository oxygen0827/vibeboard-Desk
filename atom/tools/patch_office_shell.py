#!/usr/bin/env python3
"""Add the capability-gated `office-control` bridge to an ATOM device core (static/app.js + server.py).

Idempotent and text-anchored so it applies to the repository copy or an installed device copy:
    python3 atom/tools/patch_office_shell.py /home/linaro/atom
It refuses to write when an anchor is missing instead of guessing.
"""
import re
import sys
from pathlib import Path

MARK = '/* office-control bridge v1 */'
BLOCK = MARK + r"""
/* Office control: capability-gated Connect tasks, scoped to tasks the installed app itself created.
   No tokens, paths or other apps' tasks cross this bridge. */
(function(){var ACTIONS=['state','create-task','task-events','cancel-task','approve-task'],KEY='atom.office.tasks.v1',ID=/^[A-Za-z0-9_-]{1,128}$/;
function clean(v,max){return typeof v==='string'?v.slice(0,max):'';}
window.addEventListener('message',function(e){var d=e.data,frame=main.querySelector('iframe'),originalView=view;
if(!d||d.type!=='atom:office'||!frame||frame.contentWindow!==e.source||typeof d.id!=='string'||d.id.length>128||ACTIONS.indexOf(d.action)<0||!declaredCapability('office-control'))return;
var payload=d.data&&typeof d.data==='object'&&!Array.isArray(d.data)?d.data:{},installed=apps.find(function(x){return x.id===originalView;}),owner=originalView+':'+(installed&&installed.installation_id||'legacy');
function reply(msg){if(frame.isConnected&&view===originalView)e.source.postMessage(Object.assign({type:'atom:office-result',id:d.id},msg),'*');}
function own(id){var owned=read(KEY,{});if(typeof id!=='string'||!ID.test(id)||owned[id]!==owner){var err=Error('这个任务不属于此应用');err.status=403;throw err;}return id;}
allowCapability('office-control',frame,originalView).then(function(granted){
 if(!granted){var denied=Error('尚未允许办公室派工');denied.status=403;throw denied;}
 if(!frame.isConnected||view!==originalView)throw Error('应用已关闭');
 // After the grant sheet closes, hand input focus back to the app frame.
 if(document.activeElement===document.body||!document.activeElement){try{frame.contentWindow.focus();}catch(_){}}
 if(d.action==='state')return post('/api/connect/state',{}).then(function(s){return {configured:!!s.configured,connection_error:s.connection_error||'',computers:(s.paired||[]).map(function(p){return {client_id:p.client_id,name:clean(p.name,80),online:!!p.online,e2e:p.e2e||'off',projects:(p.projects||[]).map(function(x){return {id:x.id,name:clean(x.name,80)};}),agents:(p.agents||[]).map(function(a){return {id:a.id,name:clean(a.name,40),available:!!a.available,authenticated:!!a.authenticated,reason:clean(a.reason,80)};})};})};});
 if(d.action==='create-task'){
  if(typeof payload.request_id!=='string'||!/^[A-Za-z0-9_-]{8,96}$/.test(payload.request_id))throw Error('请求编号无效');
  // A private prefix keeps office request ids apart from other clients' idempotency keys.
  var body={request_id:'office_'+payload.request_id,computer_id:payload.computer_id,project_id:payload.project_id,agent_id:payload.agent_id,prompt:payload.prompt,kind:'task'};
  return post('/api/connect/create-task',body).then(function(r){var t=r&&r.task,owned=read(KEY,{});if(!t||typeof t.id!=='string'||!ID.test(t.id))throw Error('电脑没有返回任务编号');
   if(owned[t.id]&&owned[t.id]!==owner){var err=Error('这个任务不属于此应用');err.status=403;throw err;}
   owned[t.id]=owner;var ids=Object.keys(owned);if(ids.length>300)ids.slice(0,ids.length-300).forEach(function(k){delete owned[k];});
   if(!write(KEY,owned))throw Error('任务归属未能保存，请重试');
   return {task:{id:t.id,status:t.status,last_seq:t.last_seq||0}};});}
 if(d.action==='task-events')return post('/api/connect/task-events',{task_id:own(payload.task_id),after:Number.isInteger(payload.after)&&payload.after>=0?payload.after:0}).then(function(r){var t=r.task||{};
  return {task:{id:t.id,status:t.status,last_seq:t.last_seq||0},events:(r.events||[]).map(function(ev){var o={seq:ev.seq,event_id:ev.event_id,type:ev.type,status:ev.status};if(typeof ev.text==='string')o.text=ev.text;if(ev.approval&&typeof ev.approval==='object')o.approval={request_id:String(ev.approval.request_id||''),title:clean(ev.approval.title,200),detail:clean(ev.approval.detail,3000),choices:['accept','decline']};return o;})};});
 if(d.action==='cancel-task')return post('/api/connect/cancel-task',{task_id:own(payload.task_id)}).then(function(){return {ok:true};});
 if(d.action==='approve-task'){if(['accept','decline'].indexOf(payload.decision)<0)throw Error('审批选项无效');return post('/api/connect/approve-task',{task_id:own(payload.task_id),request_id:String(payload.request_id||''),decision:payload.decision}).then(function(){return {ok:true};});}
 throw Error('不支持的操作');
}).then(function(result){reply({result:result});}).catch(function(err){reply({error:err.message||'操作失败',status:err.status||0,code:err.code||''});});});})();
"""


def patch_app(text):
    if MARK in text:
        return text, False
    # 1. Device-scoped grant (no market login needed), like task-state.
    start = text.index('function allowCapability(')
    end = text.index('\n', start)
    line = text[start:end]
    if "cap==='task-state'" not in line:
        raise SystemExit('allowCapability anchor missing')
    text = text[:start] + line.replace("cap==='task-state'", "cap==='office-control'||cap==='task-state'", 1) + text[end:]
    # 2. Grant prompt description and permission label.
    desc = "'task-state':'读取"
    label = "'task-state':'电脑任务摘要'"
    if desc not in text or label not in text:
        raise SystemExit('capability text anchors missing')
    text = text.replace(desc, "'office-control':'在已配对电脑上创建、查看、审批和取消由此应用发起的任务；不能读取其他任务或电脑上的文件路径'," + desc, 1)
    text = text.replace(label, "'office-control':'办公室派工'," + label, 1)
    # 3. Bridge block just before the closing IIFE.
    tail = text.rstrip()
    if not tail.endswith('})();'):
        raise SystemExit('app.js closing anchor missing')
    cut = text.rindex('})();')
    return text[:cut] + BLOCK + text[cut:], True


def patch_server(text):
    old = re.search(r"c not in \(('notes','agenda','task-state','photos'[^)]*)\)", text)
    if not old:
        raise SystemExit('server capability anchor missing')
    if "'office-control'" in old.group(1):
        return text, False
    return text[:old.start(1)] + old.group(1) + ",'office-control'" + text[old.end(1):], True


def main(root):
    root = Path(root)
    for rel, fn in (('static/app.js', patch_app), ('server.py', patch_server)):
        path = root / rel
        new, changed = fn(path.read_text(encoding='utf-8'))
        if changed:
            path.write_text(new, encoding='utf-8')
        print(rel, 'patched' if changed else 'already patched')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1])
