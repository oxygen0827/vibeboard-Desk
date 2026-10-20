"""Small, validated theme store. Python 3.7+, no third party dependencies."""
import json
import re
import threading
from pathlib import Path
from app_icons import theme_glyph

KEYS = ('bg', 'ink', 'accent', 'action', 'muted', 'line', 'card')
COLOR = re.compile(r'^#[0-9a-fA-F]{6}$')
ID = re.compile(r'^[a-z][a-z0-9_-]{0,47}$')


def icon_style(surface='card', foreground='ink', border='line', radius=8, stroke=2.4, border_style='solid'):
    return dict(surface=surface,foreground=foreground,border=border,radius=radius,stroke=stroke,border_style=border_style,overrides={})

def validate_icons(value):
    if value is None:return icon_style()
    if not isinstance(value,dict) or set(value)-set(icon_style()):raise ValueError('invalid icon theme fields')
    result=icon_style();result.update(value)
    for k in ('surface','foreground','border'):
        if result[k] not in KEYS+('transparent',):raise ValueError('icon colors must reference theme tokens')
    if result['foreground']=='transparent':raise ValueError('icon foreground cannot be transparent')
    for key,low,high in [('radius',0,20),('stroke',1,4)]:
        v=result[key]
        if isinstance(v,bool) or not isinstance(v,(int,float)) or not low<=v<=high:raise ValueError('invalid icon '+key)
    if result['border_style'] not in ('none','solid','dashed'):raise ValueError('invalid icon border style')
    overrides=result['overrides']
    if not isinstance(overrides,dict) or len(overrides)>64:raise ValueError('invalid icon overrides')
    result['overrides']={}
    for aid,svg in overrides.items():
        if not isinstance(aid,str) or not ID.fullmatch(aid):raise ValueError('invalid icon override id')
        result['overrides'][aid]=theme_glyph(svg)
    if len(json.dumps(result).encode('utf-8'))>65536:raise ValueError('icon theme too large')
    return result


def theme(id, name, description, colors, icons=None):
    return dict(id=id, name=name, description=description, tokens=dict(zip(KEYS, colors)), builtin=True,icons=icons or icon_style())


# One system foundation replaces the retired theme collection.
BUILTINS = [theme('system', '系统外观', '清晰排版、圆润控件与统一应用体验',
    ['#f2f2f7','#1c1c1e','#007aff','#0066d6','#6c6c70','#d9d9df','#ffffff'],
    icon_style('card','accent','transparent',16,2.2,'none'))]



class ThemeStore:
    def __init__(self, state_dir):
        self.root = Path(state_dir)
        self.lock = threading.RLock()
        self.path = self.root / 'themes.json'
        self.custom = []
        self.active = 'system'
        try:
            saved = json.loads(self.path.read_text(encoding='utf-8'))
            self.custom = [self._validate(t) for t in saved.get('themes', [])] if saved.get('appearance_generation') == 2 else []
            if saved.get('appearance_generation') == 2 and saved.get('active') in [t['id'] for t in BUILTINS + self.custom]:
                self.active = saved['active']
        except (OSError, ValueError, TypeError, AttributeError):
            self.custom = []
        self._save()

    def _validate(self, data):
        if not isinstance(data, dict) or set(data) - {'id','name','description','tokens','builtin','icons'}:
            raise ValueError('invalid theme fields')
        if not isinstance(data.get('id'), str) or not ID.fullmatch(data['id']) or data['id'] in [t['id'] for t in BUILTINS]:
            raise ValueError('invalid or reserved theme id')
        name, desc = data.get('name'), data.get('description', '')
        if not isinstance(name, str) or not 1 <= len(name) <= 80 or not isinstance(desc, str) or len(desc) > 500:
            raise ValueError('invalid theme name or description')
        tokens = data.get('tokens')
        if not isinstance(tokens, dict) or set(tokens) != set(KEYS) or any(not isinstance(c, str) or not COLOR.fullmatch(c) for c in tokens.values()):
            raise ValueError('tokens must contain seven #RRGGBB colors')
        return dict(id=data['id'],name=name,description=desc,tokens=dict(tokens),builtin=False,icons=validate_icons(data.get('icons')))

    def _save(self):
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix('.tmp')
        tmp.write_text(json.dumps(dict(active=self.active,themes=self.custom,appearance_generation=2),ensure_ascii=False),encoding='utf-8')
        tmp.replace(self.path)

    def list_themes(self):
        with self.lock:
            return json.loads(json.dumps(dict(active=self.active,themes=BUILTINS+self.custom)))

    def activate(self, id):
        with self.lock:
            if id not in [t['id'] for t in BUILTINS+self.custom]: raise ValueError('theme not found')
            self.active=id; self._save()
            return self.list_themes()

    def install(self, data):
        with self.lock:
            value=self._validate(data)
            self.custom=[t for t in self.custom if t['id']!=value['id']]+[value]
            self._save()
            return value

    def css(self, id=None):
        with self.lock:
            values=[t for t in BUILTINS+self.custom if t['id']==(id or self.active)]
            if not values: raise ValueError('theme not found')
            selected=values[0];t=selected['tokens'];icons=selected['icons']
            aliases={'paper':'bg','ink':'ink','accent':'accent','action':'action','muted':'muted','secondary-text':'muted','line':'line','card':'card'}
            declarations=['--atom-'+k+':'+t[v] for k,v in aliases.items()]
            declarations += ['--'+k+':'+v for k,v in t.items()]
            declarations += ['--paper:'+t['bg'],'--text:'+t['ink'],'--secondary-text:'+t['muted'],
                             '--secondaryText:'+t['muted'],'--atom-secondaryText:'+t['muted'],'--atom-bg:'+t['bg']]
            declarations += ['--icon-bg:'+(t[icons['surface']] if icons['surface']!='transparent' else 'transparent'), '--icon-ink:'+t[icons['foreground']], '--icon-border:'+(t[icons['border']] if icons['border']!='transparent' else 'transparent'), '--icon-radius:'+str(icons['radius'])+'px', '--icon-stroke:'+str(icons['stroke']), '--icon-border-style:'+icons['border_style']]
            return ':root{'+ ';'.join(declarations)+'}'
