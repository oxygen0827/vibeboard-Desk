#!/usr/bin/env python3
"""Add the capability-gated `office-control` bridge to an ATOM device core (static/app.js + server.py).

Idempotent and text-anchored so it applies to the repository copy or an installed device copy:
    python3 atom/tools/patch_office_shell.py /home/linaro/atom
It refuses to write when an anchor is missing instead of guessing.
"""
import re
import sys
from pathlib import Path

MARK = '/* office-control bridge v2 */'
OLD_MARKS = ('/* office-control bridge v1 */',)
# The back control of a preview opened from the office returns to the office, not the desktop (Home still goes home).
HOME_ANCHOR = 'function handleHomeReturn(){'
HOME_HOOK = HOME_ANCHOR + 'if(officePreviewBack())return;'
BLOCK = MARK + r"""
/* Office control: capability-gated Connect tasks, scoped to tasks the installed app itself created.
   No tokens, paths or other apps' tasks cross this bridge. App tasks can be previewed and, after a
   shell-owned confirmation, installed; the frame never receives the bundle or installs by itself. */
var officePreview=null;
function officePreviewBack(){var p=officePreview;officePreview=null;if(!p||view!=='connect-preview'||connectPreviewTask!==p.task)return false;navigate(p.view);return true;}
(function(){var ACTIONS=['state','create-task','task-events','cancel-task','approve-task','preview-app','install-app'],KEY='atom.office.tasks.v1',ID=/^[A-Za-z0-9_-]{1,128}$/,confirming=false;
function clean(v,max){return typeof v==='string'?v.slice(0,max):'';}
function confirmInstall(name){if(confirming)return Promise.resolve(false);confirming=true;return new Promise(function(resolve){var overlay=document.createElement('div');overlay.className='app-action-backdrop';overlay.innerHTML='<section class="app-action-sheet" role="dialog" aria-modal="true"><h2>把「'+esc(name)+'」放到桌面？</h2><p class="app-action-description">这个应用由办公室员工在电脑上生成，安装后出现在桌面最后。可随时长按图标卸载。</p><div class="app-action-buttons"><button id="office-install-yes">放到桌面</button><button id="office-install-no">取消</button></div></section>';document.body.appendChild(overlay);function done(yes){confirming=false;overlay.remove();resolve(yes);}overlay.querySelector('#office-install-yes').onclick=function(){done(true);};overlay.querySelector('#office-install-no').onclick=function(){done(false);};overlay.querySelector('#office-install-no').focus();});}
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
  var body={request_id:'office_'+payload.request_id,computer_id:payload.computer_id,project_id:payload.project_id,agent_id:payload.agent_id,prompt:payload.prompt,kind:payload.kind==='app'?'app':'task'};
  return post('/api/connect/create-task',body).then(function(r){var t=r&&r.task,owned=read(KEY,{});if(!t||typeof t.id!=='string'||!ID.test(t.id))throw Error('电脑没有返回任务编号');
   if(owned[t.id]&&owned[t.id]!==owner){var err=Error('这个任务不属于此应用');err.status=403;throw err;}
   owned[t.id]=owner;var ids=Object.keys(owned);if(ids.length>300)ids.slice(0,ids.length-300).forEach(function(k){delete owned[k];});
   if(!write(KEY,owned))throw Error('任务归属未能保存，请重试');
   return {task:{id:t.id,status:t.status,last_seq:t.last_seq||0}};});}
 if(d.action==='task-events')return post('/api/connect/task-events',{task_id:own(payload.task_id),after:Number.isInteger(payload.after)&&payload.after>=0?payload.after:0}).then(function(r){var t=r.task||{};
  return {task:{id:t.id,status:t.status,last_seq:t.last_seq||0},events:(r.events||[]).map(function(ev){var o={seq:ev.seq,event_id:ev.event_id,type:ev.type,status:ev.status};if(typeof ev.text==='string')o.text=ev.text;if(ev.approval&&typeof ev.approval==='object')o.approval={request_id:String(ev.approval.request_id||''),title:clean(ev.approval.title,200),detail:clean(ev.approval.detail,3000),choices:['accept','decline']};return o;})};});
 if(d.action==='cancel-task')return post('/api/connect/cancel-task',{task_id:own(payload.task_id)}).then(function(){return {ok:true};});
 if(d.action==='approve-task'){if(['accept','decline'].indexOf(payload.decision)<0)throw Error('审批选项无效');return post('/api/connect/approve-task',{task_id:own(payload.task_id),request_id:String(payload.request_id||''),decision:payload.decision}).then(function(){return {ok:true};});}
 // Preview runs in the shell's own sandboxed preview view with temporary storage; its back control returns here.
 if(d.action==='preview-app'){var task=own(payload.task_id);return post('/api/connect/preview-app',{task_id:task}).then(function(r){if(!r||!r.bundle)throw Error('电脑尚未提供可预览的应用');if(!frame.isConnected||view!==originalView)throw Error('应用已关闭');
  reply({result:{ok:true,name:clean(r.bundle.manifest.name,80)}});connectPreview=r.bundle;connectPreviewTask=task;officePreview={view:originalView,task:task};navigate('connect-preview');showToast('试玩 · 返回键回到办公室');return null;});}
 if(d.action==='install-app'){var job=own(payload.task_id);return post('/api/connect/preview-app',{task_id:job}).then(function(r){if(!r||!r.bundle)throw Error('电脑尚未提供可安装的应用');var name=clean(r.bundle.manifest.name,80),id=r.bundle.manifest.id;
  if(apps.some(function(a){return a.id===id;})){var dup=Error('桌面上已经有「'+name+'」了');dup.code='installed';throw dup;}
  return confirmInstall(name).then(function(yes){try{frame.contentWindow.focus();}catch(_){}if(!yes){var no=Error('已取消安装');no.code='declined';throw no;}
   return post('/api/connect/install-app',{task_id:job}).then(function(res){loadApps();return {ok:true,app:{id:res.app.id,name:clean(res.app.name,80)}};});});});}
 throw Error('不支持的操作');
}).then(function(result){if(result!==null)reply({result:result});}).catch(function(err){reply({error:err.message||'操作失败',status:err.status||0,code:err.code||''});});});})();
"""


def patch_app(text):
    if MARK in text:
        return text, False
    for old in OLD_MARKS:
        if old in text:
            # Upgrade in place: the old block runs to the core's closing IIFE.
            cut = text.rindex('})();')
            return hook_home(text[:text.index(old)] + BLOCK + text[cut:]), True
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
    return hook_home(text[:cut] + BLOCK + text[cut:]), True


def hook_home(text):
    if HOME_HOOK in text:
        return text
    if text.count(HOME_ANCHOR) != 1:
        raise SystemExit('handleHomeReturn anchor missing')
    return text.replace(HOME_ANCHOR, HOME_HOOK, 1)


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
