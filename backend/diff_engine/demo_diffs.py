"""Precompute the viewer's bundled comparisons: every ordered pair of the models in frontend/demo_viewer/models/.

The viewer is static, so its Before/After dropdowns read these files instead of running the engine.
python -m diff_engine.demo_diffs (just demo-diffs) rewrites frontend/demo_viewer/diffs/; a test keeps them current.
"""

import json
from pathlib import Path
from typing import Dict

from .diff import diff_files
from .serve import VIEWER_DIR

MODELS_DIR = VIEWER_DIR / "models"
DIFFS_DIR = VIEWER_DIR / "diffs"
MANIFEST = "manifest.json"


def pair_name(before: str, after: str) -> str:
    return f"{before}__{after}.json"


def build(models_dir: Path = MODELS_DIR) -> Dict[str, str]:
    """{file name: JSON text} for diffs/: the manifest plus one diff per ordered pair, a model against itself included."""
    models = sorted(models_dir.glob("*.e2k"))
    files = {MANIFEST: json.dumps({"models": [m.stem for m in models]}, indent=1) + "\n"}
    for a in models:
        for b in models:
            files[pair_name(a.stem, b.stem)] = json.dumps(diff_files(a, b), indent=1) + "\n"
    return files


def write(models_dir: Path = MODELS_DIR, diffs_dir: Path = DIFFS_DIR) -> int:
    """Rewrite diffs_dir from models_dir, dropping stale pair files. Returns how many files it wrote."""
    files = build(models_dir)
    diffs_dir.mkdir(exist_ok=True)
    for stale in diffs_dir.glob("*.json"):
        if stale.name not in files:
            stale.unlink()
    for name, text in files.items():
        (diffs_dir / name).write_text(text, encoding="utf-8")
    return len(files)


def main() -> None:
    print(f"wrote {write()} files to {DIFFS_DIR}")


if __name__ == "__main__":
    main()
