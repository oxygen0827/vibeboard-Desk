"""Bounded AI scene planning. Model credentials never enter application frames."""
import json
import math
import re
import threading
import time
import uuid
from urllib.request import Request, build_opener
from urllib.parse import urlsplit
from workshop import NoRedirect

KINDS = ('world', 'visual', 'duet')

def number(v, low, high):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not low <= v <= high:
        raise ValueError('模型返回了超出范围的参数')
    return v

def validate(kind, value):
    if not isinstance(value, dict): raise ValueError('模型未返回有效对象')
    result = {'title': str(value.get('title', '新作品'))[:40]}
    if kind == 'world':
        result.update(sky=value.get('sky'), weather=value.get('weather'), atmosphere=number(value.get('atmosphere', .5), 0, 1))
        if result['sky'] not in ('day', 'sunset', 'night') or result['weather'] not in ('clear', 'rain', 'snow'): raise ValueError('场景天气无效')
        objects = value.get('objects')
        if not isinstance(objects, list) or len(objects) > 32: raise ValueError('场景物体过多')
        result['objects'] = []
        for i, obj in enumerate(objects):
            if not isinstance(obj, dict) or obj.get('type') not in ('cafe','house','tree','cat','lamp','boat','mountain','flower'): raise ValueError('场景物体类型无效')
            color = obj.get('color', '#76a386')
            if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color): raise ValueError('场景颜色无效')
            result['objects'].append(dict(id=str(obj.get('id', i))[:40], type=obj['type'], x=number(obj.get('x', 0), -4, 4), z=number(obj.get('z', 0), -4, 4), scale=number(obj.get('scale', 1), .4, 2), color=color))
    elif kind == 'duet':
        result.update(bpm=number(value.get('bpm', 90), 50, 160), instrument=value.get('instrument', 'piano'))
        if result['instrument'] not in ('piano', 'bell', 'pad'): raise ValueError('音色无效')
        notes = value.get('notes')
        if not isinstance(notes, list) or not 1 <= len(notes) <= 128: raise ValueError('乐句音符数量无效')
        result['notes'] = []
        for note in notes:
            if not isinstance(note, dict): raise ValueError('音符无效')
            pitch=number(note.get('pitch'),48,84)
            if int(pitch) != pitch: raise ValueError('音高须为整数')
            result['notes'].append(dict(pitch=pitch,time=number(note.get('time'),0,32),duration=number(note.get('duration'),.1,2),velocity=number(note.get('velocity',.7),.1,1)))
    elif kind == 'visual':
        fragment=value.get('fragment')
        if not isinstance(fragment,str) or len(fragment.encode())>20000 or not re.search(r'void\s+main\s*\(',fragment): raise ValueError('着色器无效')
        # Rendering is not a general purpose compute capability: disallow unbounded loops and extensions.
        clean=re.sub(r'/\*.*?\*/|//[^\n]*','',fragment,flags=re.S)
        if re.search(r'\b(while|do|discard)\b|#\s*(extension|include|define)',clean): raise ValueError('着色器包含不支持的指令')
        loops=list(re.finditer(r'\bfor\s*\(([^)]*)\)',clean))
        if len(loops)>4 or len(re.findall(r'\bfor\b',clean))!=len(loops): raise ValueError('着色器循环过于复杂')
        for loop in loops:
            m=re.fullmatch(r'\s*int\s+(\w+)\s*=\s*0\s*;\s*\1\s*<\s*(\d+)\s*;\s*(?:\1\s*\+\+|\+\+\s*\1)\s*',loop.group(1))
            if not m or not 1<=int(m.group(2))<=32: raise ValueError('着色器循环必须使用不超过32次的固定上限')
        # No loop may contain another loop: even fixed 32^4 iterations would overwhelm this GPU.
        for loop in loops:
            pos=loop.end()
            while pos<len(clean) and clean[pos].isspace(): pos+=1
            if pos<len(clean) and clean[pos]=='{':
                end=pos+1;depth=1
                while end<len(clean) and depth:
                    depth+=(clean[end]=='{')-(clean[end]=='}');end+=1
                if re.search(r'\bfor\b',clean[pos+1:end-1]): raise ValueError('着色器不支持嵌套循环')
            elif re.search(r'\bfor\b',clean[pos:clean.find(';',pos)+1]): raise ValueError('着色器不支持嵌套循环')
        # Reject cyclic user-defined function call graphs, including mutual recursion.
        functions={}
        for match in re.finditer(r'\b(?:void|float|int|bool|vec[234]|mat[234])\s+(\w+)\s*\([^;{}]*\)\s*\{',clean):
            start=match.end();end=start;depth=1
            while end<len(clean) and depth:
                depth+=(clean[end]=='{')-(clean[end]=='}');end+=1
            functions[match.group(1)]=clean[start:end-1]
        def acyclic(name,trail):
            if name in trail: raise ValueError('着色器不支持递归')
            for called in set(re.findall(r'\b(\w+)\s*\(',functions[name])) & set(functions): acyclic(called,trail|{name})
        for name in functions: acyclic(name,set())
        palette=value.get('palette',[])
        if not isinstance(palette,list) or len(palette)>8 or any(not isinstance(c,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',c) for c in palette): raise ValueError('色板无效')
        result.update(fragment=fragment,palette=palette,description=str(value.get('description',''))[:240])
    else: raise ValueError('未知体验')
    return result

SCHEMAS={
'world':'{title,sky:"day"|"sunset"|"night",weather:"clear"|"rain"|"snow",atmosphere:0..1,objects:[{id,type:"cafe"|"house"|"tree"|"cat"|"lamp"|"boat"|"mountain"|"flower",x:-4..4,z:-4..4,scale:0.4..2,color:"#RRGGBB"}]}. Maximum 32 objects. Preserve existing objects unless asked to replace them; compose a delightful coherent isometric island.',
'duet':'{title,bpm:50..160,instrument:"piano"|"bell"|"pad",notes:[{pitch:integer48..84,time:seconds0..32,duration:seconds0.1..2,velocity:0.1..1}]}. 1..128 notes. Compose a musically coherent response to the input phrase; time is seconds from start, not beats.',
'visual':'{title,fragment:"complete WebGL1 GLSL fragment source",palette:["#RRGGBB"],description}. Fragment must declare precision mediump float; uniforms float u_time; vec2 u_resolution; vec2 u_mouse; float u_audio; and void main(). Write gl_FragColor. Produce beautiful original interactive art for Mali G52 at 320x240. No textures, extensions, defines, while, do, discard or recursion. At most 4 for loops, each exactly for(int i=0;i<N;i++) with literal N<=32. Avoid nested loops and expensive raymarching. Mouse normalized 0..1. Limit source to 20000 bytes.'}

class Experiences:
    def __init__(self):
        self.jobs={}
        self.lock=threading.Lock()

    def status(self, job_id, kind):
        with self.lock:
            job=self.jobs.get(job_id)
            if not job or job['kind']!=kind: raise ValueError('生成任务不存在')
            return {'job':dict(job)}

    def cancel(self, job_id, kind):
        with self.lock:
            job=self.jobs.get(job_id)
            if not job or job['kind']!=kind: raise ValueError('生成任务不存在')
            if job['status'] in ('queued','generating','validating'): job.update(status='cancelled',phase='已取消')
        return self.status(job_id,kind)

    def start(self, config, data):
        kind=data.get('kind'); prompt=data.get('prompt'); state=data.get('state',{})
        if kind not in KINDS or not isinstance(prompt,str) or not 1<=len(prompt.strip())<=2000: raise ValueError('请输入不超过2000字的创作需求')
        if len(json.dumps(state,ensure_ascii=False).encode())>65536: raise ValueError('当前作品过大')
        if not config.get('api_key'): raise ValueError('请先在工作坊设置模型 API')
        with self.lock:
            if sum(j['status'] in ('queued','generating','validating') for j in self.jobs.values())>=2: raise ValueError('已有两个创作任务，请完成或取消后重试')
            # Retain a bounded task history without storing user credentials.
            if len(self.jobs)>=64:
                for key in list(self.jobs):
                    if self.jobs[key]['status'] not in ('queued','generating','validating'):
                        del self.jobs[key]
                        if len(self.jobs)<48: break
            job_id=uuid.uuid4().hex
            self.jobs[job_id]=dict(id=job_id,kind=kind,status='queued',phase='等待模型',created_at=time.time())
        threading.Thread(target=self._run,args=(job_id,dict(config),prompt,state),daemon=True).start()
        return self.status(job_id,kind)

    def _set(self,jid,**fields):
        with self.lock:
            if self.jobs[jid]['status']=='cancelled': return False
            self.jobs[jid].update(fields)
            return True

    def _run(self,jid,config,prompt,state):
        kind=self.jobs[jid]['kind']
        try:
            if not self._set(jid,status='generating',phase='模型正在创作'): return
            url=urlsplit(config['base_url'])
            if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment: raise ValueError('模型地址必须为 HTTPS')
            system='You are the creative planner for an ATOM interactive artwork. Return ONLY valid JSON, no markdown, code fences or explanations. Never output credentials. Required schema: '+SCHEMAS[kind]
            message=json.dumps(dict(request=prompt,current=state),ensure_ascii=False)
            headers={'Content-Type':'application/json'}
            if config.get('protocol')=='anthropic':
                endpoint='/messages'; headers.update({'x-api-key':config['api_key'],'anthropic-version':'2023-06-01'})
                payload=dict(model=config['model'],max_tokens=5000,system=system,messages=[dict(role='user',content=message)])
            else:
                endpoint='/chat/completions';headers['Authorization']='Bearer '+config['api_key']
                payload=dict(model=config['model'],max_tokens=5000,messages=[dict(role='system',content=system),dict(role='user',content=message)])
                if config.get('provider')=='deepseek': payload.update(thinking={'type':'disabled'},response_format={'type':'json_object'})
            request=Request(config['base_url'].rstrip('/')+endpoint,data=json.dumps(payload).encode(),headers=headers)
            with build_opener(NoRedirect()).open(request,timeout=100) as response:
                raw=response.read(128*1024+1)
                if len(raw)>128*1024: raise ValueError('模型回复过大')
            value=json.loads(raw)
            if config.get('protocol')=='anthropic': text=''.join(p.get('text','') for p in value.get('content',[]) if p.get('type')=='text')
            else: text=value['choices'][0]['message']['content']
            if not self._set(jid,status='validating',phase='检查作品参数'): return
            text=text.strip()
            if text.startswith('```'): text=re.sub(r'^```(?:json)?\s*|\s*```$','',text)
            result=validate(kind,json.loads(text))
            self._set(jid,status='completed',phase='作品已生成',result=result)
        except Exception as error:
            # Upstream bodies/URLs can contain sensitive material. Only validated local errors are public.
            message='模型生成失败，请稍后重试或检查工作坊模型设置'
            self._set(jid,status='failed',phase='生成失败',error=message)
