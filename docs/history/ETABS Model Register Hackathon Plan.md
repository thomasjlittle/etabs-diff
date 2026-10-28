# ETABS Model Register: Hackathon Plan

Oct 27, 2026 · @Mason Moritz

## Scope

Drop in two exports of the same ETABS model and see what changed: a 3D view colored added / removed / modified, plus tables for the non-spatial data. Runs in the browser, so client models ~~never leave t~~he machine.

**Demo target:** two versions of a mid-rise model with 20 seeded changes. The tool finds all 20 and flags nothing else.

|  | Included |
| --- | --- |
| **In** | `.e2k` and `.$et` (same text format, one parser). Frames (beams, columns, braces) in 3D. Materials, frame sections, load patterns, load cases, combos in tables. Click a member to see its before/after. |
| **Stretch** | Areas (slabs, walls) in 3D. Matching that survives a relabel. CSV change report. |
| **Out** | `.EDB` (binary; export `.e2k` from ETABS first). Analysis results. More than two versions. |

## Architecture

&#91;embedded content: architecture · parse, diff, render\]

TypeScript, React and three.js, built with Vite, tested with Vitest. Static build with no backend, so it deploys anywhere and model files stay local.

## Changes we detect

Mass and stiffness aren't single fields in the file. Each comes from several inputs, so every change carries an `affects` tag and the UI filters on it ("show me everything that changed stiffness").

| Change | Shows in | Affects | Tier |
| --- | --- | --- | --- |
| Frame members added / removed | 3D | Geometry, stiffness, mass | MVP |
| Member moved (end coordinates, story elevation) | 3D | Geometry | MVP |
| Section reassigned | 3D | Stiffness, mass | MVP |
| Section definition edited (dims, material) | Table + 3D highlight of every member using it | Stiffness, mass | MVP |
| Material edited (E, f'c, Fy, unit weight) | Table + 3D highlight of every member using it | Stiffness, mass | MVP |
| Property modifiers (frame and shell) | 3D | Stiffness, mass | MVP |
| End releases, end offsets, insertion point, local axis | 3D | Stiffness | MVP |
| Supports and springs | 3D | Stiffness | MVP |
| Applied loads on points, members, areas | 3D | Load | MVP |
| Additional mass assigns | 3D | Mass | MVP |
| Mass source definition | Table | Mass | MVP |
| Load patterns (type, self-weight multiplier, auto seismic / wind inputs) | Table | Load | MVP |
| Load cases (type, P-delta, spectrum function, scale factors) | Table | Load | MVP |
| Combos (cases and factors) | Table | Load | MVP |
| Walls and slabs added / removed | 3D | Geometry, stiffness, mass | Stretch |
| Diaphragm assigns | 3D | Stiffness, mass | Stretch |
| Response spectrum and time history functions | Table | Load | Stretch |

Ignore as noise: file header and version stamps, GUIDs, display settings, line order. The 20 seeded changes in workstream 6 should hit every MVP row at least once.

## Shared schema

Lock this in the first hour. Parsers produce `Model`, the diff engine produces `Diff`, the UI only reads those two. Changes after lock go through the diff owner and get posted in the team channel.

```ts
type Model = {
  meta: { file: string; etabsVersion: string; sourceUnits: string };
  stories: { name: string; elev: number }[];          // in, top down as in file
  nodes: Node[];                                       // 2nd pass
  frames: Frame[];
  areas: Area[];                                       // stretch, but 1D shell modifiers need it
  loads: Load[];                                       // 2nd pass
  materials: Record<string, Props>;
  frameSections: Record<string, Props>;                // props.material always set
  shellSections: Record<string, Props>;                // props.material always set
  loadPatterns: Record<string, Props>;
  loadCases: Record<string, Props>;
  combos: Record<string, { type: string; factors: Record<string, number> }>;
  massSource: Record<string, Props>;                   // 3rd pass
  unparsed: string[];                                  // section headers we skipped
};

type Node = {
  id: string;                                          // `${label}@${story}`
  label: string; story: string;
  xyz: [number, number, number];                       // global, in
  props: Props;                                        // restraints, springs, added mass
};

type Frame = {
  id: string;                                          // `${label}@${story}`, e.g. "B23@L4"
  label: string; story: string;
  kind: 'beam' | 'column' | 'brace';
  nodes: [string, string];                             // Node ids, i then j
  i: [number, number, number]; j: [number, number, number]; // global, in
  section: string;
  props: Props;                                        // releases, modifiers, offsets, local axis, added mass
};

type Area = {
  id: string; label: string; story: string;
  kind: 'wall' | 'slab';
  nodes: string[];
  corners: [number, number, number][];
  section: string;
  props: Props;                                        // modifiers, diaphragm, pier / spandrel
};

type Load = {
  id: string;                                          // `${on}|${pattern}|${type}|${dir}`
  on: string;                                          // Node, Frame or Area id
  pattern: string; type: string; dir: string;
  values: number[];                                    // kip, in
};

type Props = Record<string, string | number>;          // raw keyword/value pairs

type Change = { field: string; before: unknown; after: unknown; affects: ('geometry' | 'stiffness' | 'mass' | 'load')[] };
type SetDiff = { added: string[]; removed: string[]; modified: Record<string, Change[]> };

type Diff = {
  frames: SetDiff & { matchedBy: Record<string, 'label' | 'geometry'> };
  tables: Record<string, SetDiff>;                     // keyed by Model field: stories, nodes, areas, loads, materials, ...
};
```

Rules:

- Normalize to kip and inch on parse. Two files saved in different units must diff clean.
- `Props` stays a flat bag of raw values so the diff compares generically with no per-field code.
- Anything the parser doesn't handle goes in `unparsed` and shows in the UI as "not compared". Nothing gets dropped silently.

* A story elevation change is reported once, under `stories`. The diff compares nodes and members relative to their story, so anything that moved only because its story moved is not flagged.

## Workstreams

Two on parsing, one on diff, two on UI, one on test data and the demo. Workstream 6 hands out mock `Model` JSON in hour one so nobody waits on the parser.

| # | Workstream | Owner | Builds | Done when |
| --- | --- | --- | --- | --- |
| 1 | Parser: geometry |  | Tokenizer for the `$ SECTION` format (quoted names, continuation lines). Stories, point coordinates, line connectivities, line assigns into `Frame[]` in global coords. Column story spans, point offsets, unit normalization. | Frame count on both test models matches ETABS. |
| 2 | Parser: properties |  | Materials, frame sections, load patterns, load cases, combos into keyed records. Unknown sections into `unparsed`. Checks `.e2k` and `.$et` of the same save parse identical. | Every line in the test files lands in a record or in `unparsed`. |
| 3 | Diff engine |  | Match frames by `label@story`, then match leftovers by endpoints within 0.5 in. Field-level compare with numeric tolerance. Same `SetDiff` logic for all five tables. Runs in a Web Worker with the parsers. | Golden diff from workstream 6 passes 20/20 with zero false flags. |
| 4 | 3D viewer |  | three.js scene. Frames colored by status, unchanged members ghosted, removed members drawn from model A. Story isolate, status filter, click to select. | Stays smooth orbiting a 5,000-member model. |
| 5 | App shell + tables |  | Two file drop slots (A / B), summary counts, tabs for the five tables with changed cells highlighted, before/after panel for the selected member. Filters shared with the viewer. | Full flow works on mock JSON before the parsers land. |
| 6 | Test models, QA, demo |  | Base model in ETABS plus a v2 with 20 seeded changes (adds, deletes, section swaps, release changes, a moved column, a new combo, a material edit). Golden diff JSON listing each one. Mock `Model` JSON for the UI. Demo script and pitch. | Demo runs start to finish three times in a row without a hitch. |

## Milestones

One repo, one main branch, merge small and often. Whole team checks in at each gate.

1. **M0, hour 1: schema locked.** Types above committed. Mock `Model` A/B and mock `Diff` JSON in the repo. Repo scaffold builds.
2. **M1, \~25% of clock: end to end on mocks.** Drop two files, see colored members and tables, all from mock data.
3. **M2, \~50%: real files through.** Real parsers feed the real diff. Test models from workstream 6 load without errors.
4. **M3, \~75%: golden diff passes, feature freeze.** 20/20 found, zero false flags. After this, bug fixes and polish only.
5. **M4, final 10%: demo locked.** Deployed static build, demo script rehearsed, backup screen recording made.

## Risks

| Risk | Fallback | Owner |
| --- | --- | --- |
| Labels renumbered between saves, so everything reads as removed + added | Geometric match on leftovers. Banner if more than half the frames matched by geometry. | 3 |
| Files saved in different units | Normalize on parse. Golden test includes a v2 saved in kN-m. | 1 |
| Keyword drift between ETABS versions | Unknown lines go to `unparsed`, not errors. Test files from at least two ETABS versions. | 2 |
| No ETABS license at the venue | Build all test models before kickoff. | 6 |
| Large model is slow in the browser | Parse and diff in a Web Worker. Instanced geometry in the viewer. | 4 |
| Integration crunch at the end | Schema locked at M0, mocks from hour one, feature freeze at M3. | All |
