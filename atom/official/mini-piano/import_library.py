"""Rebuild offline piano assets. Requires ffmpeg; sources and modifications in SOURCE.md."""
from pathlib import Path
import urllib.request, json, struct, math, base64, subprocess, tempfile, concurrent.futures, hashlib
ROOT=Path(__file__).resolve().parent
SOURCES=[
 ('nocturne','夜曲 · Op.9 No.2','肖邦','ChopinFF/O9/chopin_nocturne_op9_n2/chopin_nocturne_op9_n2',66,6,'CC BY-SA 3.0','Renato Biolcati Rinaldi'),
 ('clair','月光 · 贝加莫组曲','德彪西','DebussyC/L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair',72,4.5,'Public Domain','Keith OHara'),
 ('maple','枫叶拉格','乔普林','JoplinS/maple/maple',100,2,'Public Domain','Chris Sawer'),
 ('waltz','小狗圆舞曲 · Op.64 No.1','肖邦','ChopinFF/O64/chopin_valse_op64_no1/chopin_valse_op64_no1',180,3,'Public Domain','Magnus Lewis-Smith'),
 ('moonlight','月光奏鸣曲 · 第三乐章','贝多芬','BeethovenLv/O27/moonlight/moonlight3',160,4,'CC BY-SA 2.5','Chris Sawer and Stewart Holmes')]
def get(url):
 for attempt in range(3):
  try:return urllib.request.urlopen(url,timeout=30).read()
  except Exception:
   if attempt==2:raise

def parse(b):
 fmt,nt,ppq=struct.unpack('>HHH',b[8:14]);assert ppq<32768
 pos=14;notes=[];tempos=[]
 for tr in range(nt):
  size=int.from_bytes(b[pos+4:pos+8],'big');d=b[pos+8:pos+8+size];pos+=8+size;i=0;t=0;running=0;active={}
  def vlq():
   nonlocal i
   v=0
   while True:
    x=d[i];i+=1;v=(v<<7)|(x&127)
    if x<128:return v
  while i<len(d):
   t+=vlq();s=d[i]
   if s>=128:i+=1
   else:s=running
   if s==255:
    typ=d[i];i+=1;l=vlq();data=d[i:i+l];i+=l
    if typ==81:tempos.append((t/ppq,int.from_bytes(data,'big')))
   elif s in (240,247):l=vlq();i+=l
   else:
    running=s;l=1 if (s&240) in (192,208) else 2;data=d[i:i+l];i+=l
    if s&240 in (128,144):
     key=(s&15,data[0])
     if s&240==144 and data[1]>0:active.setdefault(key,[]).append((t,data[1]))
     elif active.get(key):
      st,vel=active[key].pop(0);notes.append([round(st/ppq,5),data[0],round((t-st)/ppq,5),vel,tr])
  assert not any(active.values()),'unclosed notes'
 return sorted(notes),tempos

def main():
 songs=[];provenance=[]
 for id,name,composer,path,bpm,meter,license,author in SOURCES:
  url='https://www.mutopiaproject.org/ftp/'+path+'.mid'
  if id=='moonlight':url='https://www.mutopiaproject.org/ftp/BeethovenLv/O27/moonlight/moonlight-mids.zip'
  raw=get(url)
  if id=='moonlight':
   import zipfile,io
   z=zipfile.ZipFile(io.BytesIO(raw));raw=z.read(next(n for n in z.namelist() if n.endswith('moonlight3.mid')))
  notes,tempos=parse(raw);tracks=sorted(set(n[4] for n in notes));means={t:sum(n[1] for n in notes if n[4]==t)/sum(n[4]==t for n in notes) for t in tracks};right=max(means,key=means.get)
  for n in notes:n[4]=0 if n[4]==right else 1
  songs.append(dict(id=id,name=name,composer=composer,bpm=bpm,meter=meter,notes=notes,beats=max(n[0]+n[2] for n in notes),license=license,author=author))
  provenance.append(dict(id=id,url=url,sha256=hashlib.sha256(raw).hexdigest(),license=license,author=author,sourceTempo=tempos))
  print(id,len(notes),tempos,flush=True)
 (ROOT/'songs.js').write_text('/* Score adaptations: see SOURCE.md for per-work licenses. */\nconst PIANO_SONGS='+json.dumps(songs,ensure_ascii=False,separators=(',',':'))+';\n')
 # Two sampled dynamic layers; every tritone plus low A. Nearest sample is at most 3 semitones away.
 roots=[21]+list(range(24,109,6));names=['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B']
 def sample(args):
  note,layer=args;name=names[note%12]+str(note//12-1)+'v'+str(layer)+'.mp3';url='https://raw.githubusercontent.com/tambien/Piano/master/audio/'+name;raw=get(url)
  with tempfile.TemporaryDirectory() as tmp:
   src=Path(tmp)/'in.mp3';out=Path(tmp)/'out.mp3';src.write_bytes(raw)
   subprocess.run(['ffmpeg','-v','error','-i',str(src),'-t','6','-af','afade=t=out:st=5.5:d=0.5','-ac','1','-ar','24000','-b:a','32k',str(out)],check=True)
   return [note,layer,base64.b64encode(out.read_bytes()).decode()],dict(url=url,sha256=hashlib.sha256(raw).hexdigest())
 results=list(concurrent.futures.ThreadPoolExecutor(6).map(sample,[(n,l) for n in roots for l in (5,12)]))
 (ROOT/'samples.js').write_text('/* Alexander Holm, Salamander Grand Piano, CC BY 3.0; trimmed/downsampled by ATOM. */\nconst PIANO_SAMPLES='+json.dumps([r[0] for r in results],separators=(',',':'))+';\n')
 (ROOT/'asset-sources.json').write_text(json.dumps(dict(scores=provenance,samples=[r[1] for r in results]),indent=2)+'\n')
 (ROOT/'licenses/salamander-CC-BY-3.0.txt').write_bytes(get('https://raw.githubusercontent.com/sfzinstruments/SalamanderGrandPiano/master/LICENSE'))
 print('asset bytes',sum((ROOT/n).stat().st_size for n in ['songs.js','samples.js']))
if __name__=='__main__':main()
