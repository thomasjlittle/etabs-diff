# keepTABS

Visual diff for ETABS models. Load two exports of the same model (`.e2k` or `.$et`, same text format) and show what changed: members added, removed, moved or modified in a 3D view, plus tables for materials, sections, load patterns, load cases, combos and mass source.

Runs locally. The dev server and the engine's viewer server listen on 127.0.0.1 only, so model files never leave the user's machine.

## Layout

```
backend/diff_engine/   Python 3.9+, stdlib only, strict pyright: parser, matching, diff, CSV, viewer server, egit
  contract.py            the output contract as TypedDicts (mirrors contract.ts)
  tests/                 unittest
frontend/              Vite, React, TypeScript, three.js: keepTABS, the React app
  src/engineAdapter.ts   engine output -> the app's Result (src/keeptabsTypes.ts)
  compareE2k.ts          dev-server route behind upload: runs the engine on the two files
  saveRevision.ts        dev-server route behind Add version
  demo_viewer/           HTML demo viewer, contract.ts + CONTRACT.md, hackathon models, precomputed diffs
fixtures/demo/         seeded synthetic before/after pair, its diff, CSV, seeded-changes.json and generator
egit                   git-style CLI over the model history (frontend/demo_viewer/models/revisions.json)
```

## Contract

- `frontend/demo_viewer/contract.ts` is the engine's output contract (schemaVersion 0.2), explained in `CONTRACT.md`. `backend/diff_engine/contract.py` mirrors it field for field. Change all three together.
- The engine writes one JSON per comparison. The React app reads it only through `engineAdapter.ts`; the HTML demo viewer reads it directly.
- Field names are camelCase in Python too, so the JSON matches the front end with no aliasing.

## Rules

- Normalize to kip and inch on parse. Two files saved in different units must diff clean.
- `props` is a flat dict of raw keyword values. Compare generically, no per-field code.
- Never drop data silently. A change outside the 17-row change list still comes through, with `row: null`.
- Elements match by geometry relative to their level (same level, plan X/Y and offset within the tolerance), never by label. A label change on a matched element is a rename.
- A story elevation change is reported once under `stories`. Nodes and members compare relative to their story, so anything that moved only because its story moved is not flagged.
- Every change carries `affects` (geometry, stiffness, mass, load).
- Editing a section or material marks every member using it as `affected`, with `via`; the viewers highlight them in 3D.
- Ignore as noise: file header and version stamps, GUIDs, display settings, line order.

## Commands

From the repo root, with [just](https://github.com/casey/just):

```
just test    # strict pyright, the engine tests, and the React app's tests
just ui      # keepTABS at http://127.0.0.1:5173 (installs frontend deps if needed)
just demo    # HTML demo viewer on the hackathon models
./egit log   # model history; ./egit --help for the rest
```

The React app's own commands run from `frontend/`: `npm ci`, `npm run dev`, `npm test`, `npm run build`. Rerun `python3 -m diff_engine.demo_diffs` (from `backend/`) after changing a model by hand.
