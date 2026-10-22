"""Shared five-way admission rules. Static admission is not behavioral certification."""
import re
from html.parser import HTMLParser


def validate_input_manifest(manifest, required=True):
    value = manifest.get('input')
    if value is None and not required:
        return None
    if not isinstance(value, dict):
        raise ValueError('五向输入规范：manifest.input 必须声明 version、profile、back')
    if set(value) - {'version', 'profile', 'back', 'scene'}:
        raise ValueError('五向输入规范：未知 input 字段')
    if type(value.get('version')) is not int or value['version'] != 1 or value.get('profile') != 'five-way':
        raise ValueError('五向输入规范：要求 version=1、profile=five-way')
    if value.get('back') not in ('root', 'custom') or value.get('scene', 'none') not in ('none', 'controls', 'passive'):
        raise ValueError('五向输入规范：back=root/custom，scene=none/controls/passive')
    return dict(value)


class Controls(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canvas = False
        self.controls = 0
        self.invalid = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.canvas |= tag == 'canvas'
        semantic = tag in ('button', 'input', 'textarea', 'select') or tag == 'a' and 'href' in a
        custom = a.get('tabindex') == '0' and a.get('role') in ('button', 'switch', 'checkbox', 'tab', 'slider')
        self.controls += int(semantic or custom)
        if 'onclick' in a and not semantic and not custom:
            self.invalid = True


def validate_input_bundle(bundle, required=True):
    if not isinstance(bundle, dict) or not isinstance(bundle.get('manifest'), dict) or not isinstance(bundle.get('files'), dict):
        raise ValueError('五向输入规范：应用需要 manifest 和 files 对象')
    declaration = validate_input_manifest(bundle['manifest'], required)
    if declaration is None:
        return None
    scan = Controls()
    files = bundle['files']
    for name, source in files.items():
        if name.lower().endswith(('.html', '.htm')) and isinstance(source, str):
            scan.feed(source)
    if scan.invalid:
        raise ValueError('五向输入规范：onclick 自定义控件须用原生按钮，或 role 与 tabindex="0"')
    if scan.canvas and declaration.get('scene', 'none') == 'none':
        raise ValueError('五向输入规范：Canvas 应声明 scene=controls 或 passive')
    if scan.canvas and declaration.get('scene') == 'controls' and not scan.controls:
        raise ValueError('五向输入规范：交互画布须提供可聚焦的 DOM 操作控件')
    if declaration['back'] == 'custom':
        source = '\n'.join(v for k, v in files.items() if k.lower().endswith(('.html', '.js', '.mjs')) and isinstance(v, str))
        if not re.search(r'AtomApp\s*\.\s*navigation\s*\.\s*setBackHandler\s*\(', source):
            raise ValueError('五向输入规范：多级页面须注册 AtomApp.navigation.setBackHandler')
    return declaration
