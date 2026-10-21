"""Build the reviewed robot companion bundle; no credentials or runtime state."""
import json
from pathlib import Path
base = Path(__file__).resolve().parent
bundle = {"manifest": json.loads((base / "manifest.json").read_text()), "files": {name: (base / name).read_text() for name in ("index.html", "style.css", "app.js", "icon.svg")}}
(base.parent / "examples" / "robot.json").write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n")
