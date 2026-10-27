# ETABS Model Register
 
Visual diff for ETABS models. Load two exports of the same model (`.e2k` or `.$et`, same text format) and show what changed: members added, removed or modified in a 3D view, plus tables for materials, sections, load patterns, load cases, combos and mass source.
 
Browser only, no backend. Model files never leave the user's machine.
 
## Stack
 
TypeScript, React, three.js, Vite, Vitest. Parsing and diffing run in a Web Worker.
 
## Contract
 
- `fixtures/types.ts` is the shared schema. Parsers produce `Model`, the diff engine produces `Diff`, the UI reads only those two.
- Do not change `types.ts` without the diff engine owner. Post schema changes in the team channel.
- `fixtures/model-a.json`, `fixtures/model-b.json` and `fixtures/diff.json` are the reference case. `diff(modelA, modelB)` must equal `diff.json`.
- Import fixture JSON with `as unknown as Model` (JSON arrays don't type as tuples).
## Rules
 
- Normalize to kip and inch on parse. Two files saved in different units must diff clean.
- `Props` is a flat bag of raw keyword values. Compare generically, no per-field code.
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
| 3 | Diff engine | matching, field compare, `affects` tags, `types.ts` |
| 4 | 3D viewer | three.js scene, status colors, story isolate, filters, selection |
| 5 | App shell + tables | file drop, summary, table tabs, before/after panel |
| 6 | Test models, QA, demo | ETABS test files, golden diffs, demo script |
 
Work on a branch per workstream. Merge small and often.
 
## Tiers
 
- MVP: frames added / removed / moved, section reassigned, section edited, material edited.
- 2nd pass: property modifiers, releases / offsets / local axis, supports and springs, applied loads.
- 3rd pass: added mass, mass source, load patterns, load cases, combos.
- Stretch: walls and slabs in 3D, diaphragms, spectrum and time history functions.
## Commands
 
Fill in once the scaffold exists: install, dev, test.
