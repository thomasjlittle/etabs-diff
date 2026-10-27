# ETABS Model Register

Visual diff for ETABS models. Load two exports of the same model (`.e2k` or `.$et`, same text format) and show what changed: members added, removed or modified in a 3D view, plus tables for materials, sections, load patterns, load cases, combos and mass source.

Runs locally. The Python server listens on localhost only, so model files never leave the user's machine.

## Layout

```
backend/    Python 3.12, FastAPI, pydantic v2, pytest, ruff
  src/etabs_register/schema.py   shared schema (source of truth)
  src/etabs_register/parse/      .e2k parser
  src/etabs_register/diff.py     diff engine
  src/etabs_register/api.py      POST /api/diff
frontend/   Vite, React, TypeScript, three.js
  src/types.ts                   mirror of schema.py
fixtures/   model-a.json, model-b.json, diff.json (reference case)
```

## Contract

- `backend/src/etabs_register/schema.py` is the shared schema. The parser produces `Model`, the diff engine produces `Diff`, the front end reads only those two.
- `frontend/src/types.ts` mirrors `schema.py`. Change both in the same PR, and only with the diff engine owner.
- `POST /api/diff` takes two files (`a`, `b`) and returns `{ modelA, modelB, diff }`.
- `diff(model_a, model_b)` on the fixtures must equal `fixtures/diff.json`.
- Field names stay camelCase in Python too, so JSON matches the front end with no aliasing.

## Rules

- Normalize to kip and inch on parse. Two files saved in different units must diff clean.
- `Props` is a flat dict of raw keyword values. Compare generically, no per-field code.
- Anything the parser doesn't handle goes in `unparsed` and shows as "not compared". Never drop data silently.
- Frames match by `label@story`, then leftovers match by geometry (endpoints within 0.5 in). Record which in `matchedBy`.
- A story elevation change is reported once under `stories`. Nodes and members compare relative to their story, so anything that moved only because its story moved is not flagged.
- Every `Change` carries `affects` (geometry, stiffness, mass, load). The UI filters on it.
- Editing a section or material highlights every member using it in 3D.
- Ignore as noise: file header and version stamps, GUIDs, display settings, line order.

## Workstreams

| # | Workstream | Owns |
| --- | --- | --- |
| 1 | Parser: geometry | stories, nodes, frames, areas, unit normalization |
| 2 | Parser: properties | materials, sections, load patterns, cases, combos, mass source, `unparsed` |
| 3 | Diff engine + API | matching, field compare, `affects` tags, `schema.py`, `api.py` |
| 4 | 3D viewer | three.js scene, status colors, story isolate, filters, selection |
| 5 | App shell + tables | file drop, summary, table tabs, before/after panel |
| 6 | Test models, QA, demo | ETABS test files, golden diffs, demo script |

Work on a branch per workstream. Merge small and often. Pull main every couple of hours.

## Tiers

- MVP: frames added / removed / moved, section reassigned, section edited, material edited.
- 2nd pass: property modifiers, releases / offsets / local axis, supports and springs, applied loads.
- 3rd pass: added mass, mass source, load patterns, load cases, combos.
- Stretch: walls and slabs in 3D, diaphragms, spectrum and time history functions.

## Commands

Fill in once the scaffold exists: backend install / run / test, frontend install / dev, how to run both.
