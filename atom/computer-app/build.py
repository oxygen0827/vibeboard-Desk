"""Build the full installed application bundle from reviewed source files."""
import runpy
import json
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().parents[1]/'design/sync_device_ui.py'),run_name='__main__')
base = Path(__file__).resolve().parent
bundle = {"manifest": json.loads((base / "manifest.json").read_text()), "files": {name: (base / name).read_text() for name in ("index.html", "style.css", "device-ui.css", "app.js", "icon.svg")}}
(base.parent / "examples" / "my-computer.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n")
