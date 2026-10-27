# keepTABS (get it, like ETABS...)

Visual diff for ETABS models. Point it at two exports of the same model (`.e2k`, or the `.$et` ETABS writes on save) and it shows what changed: members added, removed, moved, or modified in a 3D view, plus tables for materials, sections, load patterns, cases, combos, and the rest.

# Quick Start

Needs Python 3.9+ (stdlib only). The viewer loads three.js from a CDN, so it needs internet. Everything serves on 127.0.0.1 only.

With [just](https://github.com/casey/just), from the repo root:

| Recipe | What it does | What you see |
| --- | --- | --- |
| `just` | lists the recipes | the list |
| `just demo` | serves the viewer on the six hackathon models in `frontend/demo_viewer/models/` | Before/After dropdowns (opens on `Hack_v01` to `Hack_v01a`), pick any pair |
| `just demo-seeded` | diffs the seeded synthetic pair in `fixtures/demo/` (the one the tests use) | the viewer on that diff |
| `just view before.e2k after.e2k` | diffs two files of your own | the viewer on the result |
| `just csv before.e2k after.e2k changes.csv` | diffs two files, writes one CSV row per change | the status counts in the terminal |
| `just example` | serves the viewer on the bundled made-up example diff | a small 3-story steel model in every status |
| `just demo-diffs` | rediffs every pair of the hackathon models into `frontend/demo_viewer/diffs/` | nothing to open (run after adding or changing a model; a test fails if they're stale) |
| `just typecheck` | runs pyright in strict mode on `backend/diff_engine/` | type errors, if any |
| `just test` | type-checks, then runs the diff engine tests | the unittest results |
| `just ui-install` | installs the React app's dependencies in `frontend/` from the lockfile (`npm ci`) | npm output |
| `just ui-build` | type-checks and builds the React app into `frontend/dist/` (installs first if needed) | the Vite build summary |
| `just ui-dev` | runs the React app's dev server | the app at http://127.0.0.1:5173 |
| `just ui-test` | runs the React app's tests (vitest) | the test results |
| `just ui-preview` | serves the built app from `frontend/dist/` (run `just ui-build` first) | the built app at http://127.0.0.1:4173 |

The viewer recipes print a URL and try to open your browser (under WSL they may not, so open the printed URL). Ctrl+C stops the server. `just typecheck` and `just test` need pyright on your PATH (`npm install -g pyright` or `pip install pyright`); it's a dev tool only. The `ui-*` recipes need node and npm.

Without `just`, run from `backend/` (or set `PYTHONPATH=backend` from the root):

```
python3 -m diff_engine before.e2k after.e2k -o diff.json     # JSON diff
python3 -m diff_engine before.e2k after.e2k --view           # open the viewer on it
python3 -m diff_engine before.e2k after.e2k --csv changes.csv --summary
python3 -m diff_engine.serve                                 # same as just demo
```

`--tolerance` (node match, in inches, defaults to the before file's `MERGETOL`, or 0.1 in) and `--move-tolerance` (default 36 in, `0` turns moves off) tune matching.

# How It Compares Models

- Both files are normalized to kip and inch, so the same model saved in different units diffs clean (`Hack_v02a` is `Hack_v02` in lb and ft).
- Elements match by geometry relative to their level: same level, plan X/Y and offset within the tolerance. Labels are never used for matching (ETABS relabels on redraw), only for display.
- A story elevation change is reported once in the stories table. Members on that story aren't flagged just because the story moved.
- A removed and an added frame of the same type are linked as one move when neither end travelled more than 36 in, or when they're colinear, overlap, and have identical properties (a beam extended, shortened, or slid along its line).
- Editing a section or material marks every member using it as "affected", with a `via` list saying which definition did it. The viewer highlights them in 3D.

Full details are in [`backend/diff_engine/README.md`](backend/diff_engine/README.md).

# What It Catches

Against the team's 17-row change list:

| Row | Change | Status |
| --- | --- | --- |
| 1 | Geometry: members, nodes, shells added / removed / moved, story elevation | caught |
| 2 | Section reassigned | caught |
| 3 | Section definition edited | caught |
| 4 | Material edited | caught |
| 5 | Property modifiers | caught |
| 6 | Releases, offsets, insertion point, local axis | caught |
| 7 | Nodes modified | caught |
| 8 | Supports and springs | caught |
| 9 | Applied loads | caught |
| 10 | Additional mass | deferred (keyword guess only, never seen in a real export) |
| 11 | Mass source | caught |
| 12 | Load patterns, auto seismic and wind inputs | caught |
| 13 | Load cases, P-delta | caught |
| 14 | Combos | caught |
| 15 | Walls and slabs added / removed | caught |
| 16 | Diaphragms | caught |
| 17 | Response spectrum and time history functions | caught |

Every change carries its row and an `affects` tag (geometry, stiffness, mass, load), and the viewer filters on both. Anything outside the list comes through with `row: null` rather than being dropped.

# Repo Layout

| Folder | What's in it |
| --- | --- |
| `backend/diff_engine/` | the working engine: parser, matching, diff, CSV report, viewer server (stdlib Python, strict pyright) |
| `frontend/demo_viewer/` | the working viewer: one static HTML file with three.js, plus the hackathon models and their precomputed diffs |
| `fixtures/demo/` | the seeded synthetic before/after pair, its diff, CSV, and generator |
| `fixtures/` (top level files) | JSON fixtures for the React/FastAPI scaffold |
| `backend/src/`, `backend/tests/` | a teammate's FastAPI scaffold, separate from the working engine |
| `frontend/src/` | a teammate's React app scaffold, separate from the working viewer |

# Output

- JSON contract: [`frontend/demo_viewer/contract.ts`](frontend/demo_viewer/contract.ts) is the source of truth, explained field by field in [`frontend/demo_viewer/CONTRACT.md`](frontend/demo_viewer/CONTRACT.md). The engine builds it through matching `TypedDict`s in `backend/diff_engine/contract.py`.
- CSV: one row per change with columns `table, key, kind, subtype, label, story, status, field, before, after, affects, row, via` (`COLUMNS` in `backend/diff_engine/report.py`).

# Model Files

Real client models never go in the repo (`.gitignore` blocks `.e2k`, `.$et`, `.edb` and friends). The only models committed are the approved hackathon models in `frontend/demo_viewer/models/` and the synthetic ones under `fixtures/`.

# Links

[Miro](https://miro.com/welcomeonboard/UlBzSDVtUjZIMHlLU2pQRjkzNlZZSTJhUXhlTlkvSlJwdjU1WmNMTFk2MXdUVDNVeEp3Vk1sd3p3ZjFzSmRhS3orYmtFTWhVWnQrQmhWeUVrRjRDemZhdkJDbDhrdTFuNzZYL1ZUOXdGZDBJZittcG1pVHBta0U2MllVc2FpR3dBd044SHFHaVlWYWk0d3NxeHNmeG9BPT0hdjE=?share_link_id=573872713675)
