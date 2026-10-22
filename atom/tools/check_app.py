#!/usr/bin/env python3
"""Static ATOM bundle checks; warnings are review prompts, not visual judgments."""
import argparse
import json
import re
import tempfile
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app_icons import validate_svg
from app_input import validate_input_bundle


class HTMLScan(HTMLParser):
    def __init__(self):
        super().__init__(); self.viewport = False; self.controls = 0; self.external = []; self.links = []
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'meta' and values.get('name', '').lower() == 'viewport': self.viewport = True
        if tag in ('button', 'input', 'select', 'textarea') or (tag == 'a' and 'href' in values): self.controls += 1
        for attr in ('src', 'href'):
            link = values.get(attr, '')
            if re.match(r'^(https?:)?//', link): self.external.append(link)
            elif link and not link.startswith(('#', 'data:', 'mailto:', 'tel:', 'javascript:')): self.links.append(link)


def valid_path(value):
    return isinstance(value, str) and value and '\\' not in value and '\x00' not in value and not PurePosixPath(value).is_absolute() and all(p not in ('', '.', '..') for p in value.split('/'))


def check_directory(root):
    errors = []; warnings = []; root = Path(root)
    if not root.is_dir(): return ['bundle directory does not exist'], warnings
    manifest_file = root / 'manifest.json'
    try:
        if manifest_file.is_symlink(): raise ValueError('manifest symlink')
        manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
        if not isinstance(manifest, dict): raise ValueError('manifest must be object')
    except (OSError, ValueError) as exc: return ['manifest.json: ' + str(exc)], warnings
    app_id = manifest.get('id')
    if not isinstance(app_id, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,47}', app_id): errors.append('manifest.id invalid')
    if app_id in ('clock', 'timer', 'status'): errors.append('manifest.id reserved')
    if not isinstance(manifest.get('name'), str) or not 1 <= len(manifest['name']) <= 80: errors.append('manifest.name must be 1–80 characters')
    if not isinstance(manifest.get('description', ''), str) or len(manifest.get('description', '')) > 500: errors.append('manifest.description invalid')
    if 'layout' in manifest and manifest['layout'] != 'fullscreen': errors.append('manifest.layout must be fullscreen')
    if manifest.get('entry') != 'index.html': errors.append('manifest.entry must be index.html')
    if manifest.get('icon') != 'icon.svg': errors.append('manifest.icon must reference icon.svg')
    else:
        try:
            icon = root / 'icon.svg'
            if icon.is_symlink() or icon.stat().st_size > 32768: raise ValueError('unsafe/oversized icon')
            validate_svg(icon.read_text(encoding='utf-8'))
        except (OSError, ValueError): errors.append('icon.svg missing or unsafe')
    if not (root / 'index.html').is_file(): errors.append('index.html missing')
    all_text = []; size = 0; count = 0; controls = 0
    for file in sorted(root.rglob('*')):
        if file.is_symlink(): errors.append(str(file.relative_to(root)) + ': symlinks forbidden'); continue
        if not file.is_file(): continue
        name = file.relative_to(root).as_posix()
        if not valid_path(name): errors.append(name + ': unsafe path'); continue
        if name != 'manifest.json': count += 1
        if file.stat().st_size > 2 * 1024 * 1024: errors.append(name + ': exceeds bundle size limit'); continue
        try: text = file.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError): errors.append(name + ': must be UTF-8 text for JSON deployment'); continue
        size += len(text.encode('utf-8')); all_text.append(text)
        if file.suffix.lower() in ('.html', '.htm'):
            scan = HTMLScan(); scan.feed(text); controls += scan.controls
            if not scan.viewport: warnings.append(name + ': missing viewport meta; inspect at 480×360')
            if scan.external: warnings.append(name + ': external links/dependencies: ' + ', '.join(scan.external[:5]))
            for link in scan.links:
                path = link.split('?', 1)[0].split('#', 1)[0]
                if not path: continue
                if path.startswith('/'): warnings.append(name + ': absolute local URL may escape bundle: ' + path)
                elif not valid_path(path): warnings.append(name + ': relative resource path needs review: ' + path)
                elif not (file.parent / path).is_file(): warnings.append(name + ': local resource missing: ' + path)
        if file.suffix.lower() in ('.html', '.css'):
            tiny = sorted(set(re.findall(r'font-size\s*:\s*(\d+(?:\.\d+)?)px', text, re.I)))
            tiny = [v for v in tiny if float(v) < 14]
            if tiny: warnings.append(name + ': font-size below 14px (' + ', '.join(tiny) + '); inspect physical legibility')
        if file.suffix.lower() in ('.html', '.css'):
            for selector, body in re.findall(r'([^{}]+)\{([^{}]*)\}', text):
                selector = selector.strip()
                if re.search(r'(?<![-\w])(?:html|body)(?![-\w])', selector):
                    if re.search(r'(?:^|;)\s*height\s*:\s*auto', body, re.I):
                        warnings.append(name + ': root height:auto; inspect fullscreen root scrollHeight at 480×360')
                    if re.search(r'\bmin-height\s*:', body, re.I):
                        warnings.append(name + ': root min-height does not bound long content; inspect root scrolling and split views if needed')
                if re.search(r'\boverflow(?:-[xy])?\s*:\s*(?:auto|scroll)', body, re.I):
                    if '.atom-scroll' not in selector and 'data-atom-scroll' not in selector:
                        warnings.append(name + ': scrolling selector not explicitly marked .atom-scroll or [data-atom-scroll]: ' + selector[:100])
                    elif not re.search(r'(?<![-\w])(?:height|max-height|block-size|max-block-size)\s*:', body, re.I):
                        warnings.append(name + ': marked scroll region has no local height bound; verify inherited/grid bounds on device')
        if re.search(r'https?://|@import\s', re.sub(r'xmlns=[\"\']http://www.w3.org/2000/svg[\"\']', '', text)): warnings.append(name + ': network references/imports detected; verify offline behavior')
    try:
        input_files = {p.relative_to(root).as_posix(): p.read_text(encoding='utf-8') for p in root.rglob('*') if p.is_file() and not p.is_symlink() and p.suffix.lower() in ('.html', '.htm', '.js', '.mjs') and p.stat().st_size <= 2*1024*1024}
        validate_input_bundle({'manifest': manifest, 'files': input_files})
    except (ValueError, OSError, UnicodeError) as exc: errors.append(str(exc))
    joined = '\n'.join(all_text)
    if count > 100: errors.append('more than 100 app files')
    if size > 2 * 1024 * 1024: errors.append('bundle exceeds 2 MiB')
    if controls == 0: warnings.append('no semantic interactive controls detected; may be valid for passive/canvas apps')
    gradients = len(re.findall(r'(?:linear|radial|conic)-gradient\s*\(', joined, re.I))
    if gradients > 3: warnings.append(str(gradients) + ' gradient declarations; inspect hierarchy and rendering cost (not an aesthetic verdict)')
    if re.search(r'Math\.random\s*\(|\b(?:mock|fake|demoData|sampleData)\b', joined, re.I): warnings.append('random/mock/sample identifiers detected; verify displayed data is labeled or real; this may be legitimate gameplay')
    if re.search(r'setInterval\s*\(|requestAnimationFrame\s*\(', joined): warnings.append('recurring updates detected; verify idle CPU and timer lifecycle on device')
    return errors, list(dict.fromkeys(warnings))


def check(source):
    source = Path(source)
    if source.is_dir(): return check_directory(source)
    if not source.is_file(): return ['bundle file or directory does not exist'], []
    if source.is_symlink(): return ['bundle symlink forbidden'], []
    try:
        if source.stat().st_size > 2 * 1024 * 1024: return ['JSON bundle exceeds 2 MiB'], []
        bundle = json.loads(source.read_text(encoding='utf-8'))
        if not isinstance(bundle, dict) or not isinstance(bundle.get('manifest'), dict) or not isinstance(bundle.get('files'), dict):
            return ['JSON bundle requires manifest object and files object'], []
        files = bundle['files']
        errors = []
        for name, content in files.items():
            if not valid_path(name) or name == 'manifest.json': errors.append('unsafe/reserved bundle file path: ' + repr(name))
            if not isinstance(content, str): errors.append('bundle file content must be UTF-8 text: ' + repr(name))
        if errors: return errors, []
        with tempfile.TemporaryDirectory(prefix='atom-check-') as temp:
            root = Path(temp)
            (root / 'manifest.json').write_text(json.dumps(bundle['manifest'], ensure_ascii=False), encoding='utf-8')
            for name, content in files.items():
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content, encoding='utf-8')
            return check_directory(root)
    except (OSError, ValueError, UnicodeError) as exc:
        return ['invalid JSON bundle: ' + str(exc)], []


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('bundle'); args = parser.parse_args()
    errors, warnings = check(args.bundle)
    print('ATOM bundle review: ' + args.bundle)
    for label, items in [('ERROR', errors), ('WARNING', warnings)]:
        for item in items: print(label + ': ' + item)
    print('{} errors, {} warnings. Static checks do not judge visual quality or identify AI-generated design.'.format(len(errors), len(warnings)))
    return 1 if errors else 0

if __name__ == '__main__': raise SystemExit(main())
