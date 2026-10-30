"""Build the complete, self-contained source bundle. No network resources."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FILES = ("index.html", "style.css", "physics.js", "app.js", "icon.svg", "LICENSE", "README.md", "SOURCE.md")
bundle = {"manifest": json.loads((ROOT / "manifest.json").read_text()),
          "files": {name: (ROOT / name).read_text() for name in FILES}}
payload = json.dumps(bundle, ensure_ascii=False, indent=2) + "\n"
assert len(payload.encode()) < 96 * 1024
(ROOT / "bundle.json").write_text(payload)
print(f"motion-music: {len(payload.encode())} bytes, {len(FILES)} source files")
