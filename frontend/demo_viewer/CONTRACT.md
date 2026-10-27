# Diff Output Contract (schemaVersion 0.1)

The diff engine compares two ETABS exports of the same model, A (before) and B (after), and writes one JSON file. That file is the only thing the viewer reads. The exact types live in [`contract.ts`](contract.ts); this page explains them in plain words. A small working example is in [`example-diff.json`](example-diff.json).

Version 0.1 is close to final but not frozen. Field names and shapes should hold; a few fields may still be added.

## Units

All lengths and coordinates are in **inches**, whatever units the ETABS files used. The engine converts on parse. `meta.lengthUnit` is always `"in"` so you can check.

Each current-engine `changes` entry has `unit`: a normalized display string such as `in`, `kip`, `ksi`, `kip-in`, `kip/in`, `deg`, or null. Names, modifiers and scale factors are unitless. Unrecognized dimensions also return null rather than an inferred unit; this does not certify that an unrecognized numeric keyword is dimensionless. Older saved diffs may omit the field.

Structured changes (such as a load record containing force and distance together) have `unit: null` and, when known dimensions exist, `valueUnits: { before: { "0.FVAL": "kip", "0.DIST": "in", "0.TYPE": null }, after: ... }`. Keys are dot-separated paths into that side's JSON value, including array indices. Render units next to their individual values. A response-spectrum case's acceleration factor is `in/s^2`; spring stiffness follows its translational/rotational definition. The CSV includes both `unit` and `valueUnits` columns.

## Top Level

| Field | What it is |
|---|---|
| `schemaVersion` | Always `"0.1"` for now. Check it and warn if it differs. |
| `meta` | Which files were compared and how. See below. |
| `stories` | Every story in either model, bottom up. |
| `elements` | **Every** element in either model, changed or not. This is what you draw. |
| `tables` | Changes to definitions that aren't drawn (materials, sections, load patterns, and so on). |
| `summary` | Count of elements per status. Handy for a legend. |

## `meta`

- `a`, `b`: the two input files. `file` is the file name, `etabsVersion` is the ETABS version that wrote it, `units` is the unit string from the file (for display only, since geometry is already in inches).
- `lengthUnit`: always `"in"`.
- `tolerance`: how close (in inches) two elements' positions have to be to count as the same element. Defaults to the model's own merge tolerance.

## `stories`

A list of `{ name, elevA, elevB }`, bottom story first. `elevA` and `elevB` are that story's elevation in inches in each model. One of them is `null` when the story only exists on one side (a story was added or removed).

## `elements`

One entry per element in the union of A and B. Unchanged elements are included so you can draw the whole building as context.

| Field | What it is |
|---|---|
| `key` | The id the engine used to match this element between A and B. It's built from the element's story and its position relative to that story, rounded to the tolerance. It's stable and unique within one file. Use it as the element's id. Don't try to parse it. |
| `kind` | `point`, `frame`, or `area`. Decides how to draw it. |
| `subtype` | Finer type: `beam`, `column`, `brace` (frames), `floor`, `wall` (areas), `joint` (points), or `other`. |
| `label` | The element's ETABS label (like `B12` or `C3`) so people can find it in ETABS. **Display only.** Labels are not used for matching and can change between A and B. B's label is shown, or A's if the element was removed. |
| `story` | The story the element belongs to. B's story, or A's if removed. |
| `grid` | Plan location on the model's global Cartesian grid, e.g. `C/4`, `C-D/4`, or `C/3-4`. Areas can span ranges on both axes. B's grid is used, or A's for a removal. Every vertex must lie on a unique X/Y intersection within `meta.tolerance`; otherwise null. Multiple grid systems are qualified (`G2:C/4`); ambiguous, rotated, offset, and cylindrical systems return null. This is location metadata; edits to grid definitions are not yet compared. |
| `status` | What happened to it. See the table below. |
| `geometry` | Where to draw it, as `[x, y, z]` points in inches, global coordinates, Z up. A point has one, a frame has two (start and end), an area has its corners in order around the edge. B's position, or A's if removed. **For drawing only**: matching uses `key`, not these numbers. |
| `changes` | What changed, as a list of `{ field, before, after, affects }`. Empty when unchanged. |
| `via` | Only on `affected` elements: which definitions it inherited the change from. |
| `movedTo` | Optional, only on `removed` elements: the `key` of the `added` element it moved to. |
| `movedFrom` | Optional, only on `added` elements: the `key` of the `removed` element it moved from. |

### `status` values

| Status | Meaning |
|---|---|
| `unchanged` | Same in A and B. |
| `added` | Only in B. |
| `removed` | Only in A. Its geometry is A's position. |
| `modified` | In both, and something on the element itself changed (its section, a release, a load on it, a support). `changes` lists what. |
| `affected` | The element itself is the same, but something it uses changed upstream, like its section's properties or its material's strength. `changes` lists the upstream changes and `via` says the path, e.g. `["frameSection:W14X22", "material:A992Fy50"]`. |

### Moved members

When the engine decides a removed element and an added element are the same member in a new spot, it links them: the old one gets `movedTo` and the new one gets `movedFrom`, each pointing at the other's `key`. Both keep their `removed` / `added` status (and `summary` still counts them that way). Any change on the pair itself (a load, an assign) is in the removed one's `changes`. The viewer shows a linked pair as one "moved" member: old position dashed, a thin arrow to the new position, and old and new end coordinates in the details. Removals and additions without a link are drawn as plain removals and additions.

### `changes`

Each change is `{ field, before, after, affects }`:

- `field`: what changed, e.g. `"section"`, `"restraint"`, `"load:LIVE.FZ"`, `"material:A992Fy50.Fy"`.
- `before`, `after`: the old and new values. Any JSON type (number, string, object). `before` is `null` for things that didn't exist in A, and `after` is `null` for things gone in B.
- `affects`: which kinds of behavior the change matters for: any of `geometry`, `stiffness`, `mass`, `load`. Useful later for filtering or coloring.
- `kind`: optional `"renamed"` on a `label` or definition `name` change. The old/new names are in `before` / `after`, with an empty `affects` list. Elements retain `status: "modified"` and are counted there for compatibility; viewers can show label-only changes as renamed. A rename can coexist with physical changes on the same element.

### Renamed definitions

An unambiguous removed/added pair with identical properties is reported once under `tables[table].modified[newName]`, as a `name` change with `kind: "renamed"`. It is absent from `added` and `removed`. This applies to materials, frame/shell sections, load patterns, cases, combinations, and the other compared definition tables. References to a renamed material, section, pattern or case compare by identity, so the rename alone does not create a reassignment or load-term edit. Users carry the upstream name change through `via`. Multiple identical candidates remain added/removed because their identities cannot be determined reliably. CSV reports use `status: "renamed"` for the rename row.

### Which points are included

Not every joint. Only points that carry something of their own (a support, a spring, a mass, or a point load), plus any joint where something assigned to it changed, such as a joint newly tied to a diaphragm. Plain joints where members meet are left out because the frames already show them.

## `tables`

Definitions that aren't elements in space: `stories`, `materials`, `frameSections`, `shellSections`, `pointSprings`, `loadPatterns`, plus `loadCases`, `combos`, `massSource`, `diaphragms`, `functions` (response spectrum and time history) and `analysisOptions` (the global P-delta setting) when the engine compares them. Each one is:

- `added`: names only in B.
- `removed`: names only in A.
- `modified`: an object from name to its list of `changes` (same shape as above).

These are the upstream causes behind `affected` elements. The viewer lists them in its side panel.

Load cases, combos and the mass source are lists of load terms, so each term is its own change: `field` is `LOADPAT:Live` (a pattern in a case or the mass source), `LOADCASE:Dead` or `LOADCOMBO:1.4D` (a term in a combo), and `before` / `after` is its scale factor, `null` when the term is missing on that side. They don't make any element `affected`. Load patterns list their auto seismic and wind inputs one field each, like `SEISMIC:R` or `WIND:VB`. A diaphragm edit does make its floors and joints `affected`, with `via` set to `["diaphragm:D1"]`.

## `summary`

`{ unchanged, added, removed, modified, affected }`, the number of elements with each status. It always matches counting `elements` by `status`.
