# Diff Output Contract (schemaVersion 0.1)

The diff engine compares two ETABS exports of the same model, A (before) and B (after), and writes one JSON file. That file is the only thing the viewer reads. The exact types live in [`contract.ts`](contract.ts); this page explains them in plain words. A small working example is in [`example-diff.json`](example-diff.json).

Version 0.1 is close to final but not frozen. Field names and shapes should hold; a few fields may still be added.

## Units

All lengths and coordinates are in **inches**, whatever units the ETABS files used. The engine converts on parse. `meta.lengthUnit` is always `"in"` so you can check.

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
| `status` | What happened to it. See the table below. |
| `geometry` | Where to draw it, as `[x, y, z]` points in inches, global coordinates, Z up. A point has one, a frame has two (start and end), an area has its corners in order around the edge. B's position, or A's if removed. **For drawing only**: matching uses `key`, not these numbers. |
| `changes` | What changed, as a list of `{ field, before, after, affects }`. Empty when unchanged. |
| `via` | Only on `affected` elements: which definitions it inherited the change from. |

### `status` values

| Status | Meaning |
|---|---|
| `unchanged` | Same in A and B. |
| `added` | Only in B. |
| `removed` | Only in A. Its geometry is A's position. |
| `modified` | In both, and something on the element itself changed (its section, a release, a load on it, a support). `changes` lists what. |
| `affected` | The element itself is the same, but something it uses changed upstream, like its section's properties or its material's strength. `changes` lists the upstream changes and `via` says the path, e.g. `["frameSection:W14X22", "material:A992Fy50"]`. |

### `changes`

Each change is `{ field, before, after, affects }`:

- `field`: what changed, e.g. `"section"`, `"restraint"`, `"load:LIVE.FZ"`, `"material:A992Fy50.Fy"`.
- `before`, `after`: the old and new values. Any JSON type (number, string, object). `before` is `null` for things that didn't exist in A, and `after` is `null` for things gone in B.
- `affects`: which kinds of behavior the change matters for: any of `geometry`, `stiffness`, `mass`, `load`. Useful later for filtering or coloring.

### Which points are included

Not every joint. Only points that carry something of their own: a support (restraint), a spring, or a point load. Plain joints where members meet are left out because the frames already show them.

## `tables`

Definitions that aren't elements in space: `stories`, `materials`, `frameSections`, `shellSections`, `pointSprings`, `loadPatterns`. Each one is:

- `added`: names only in B.
- `removed`: names only in A.
- `modified`: an object from name to its list of `changes` (same shape as above).

These are the upstream causes behind `affected` elements. The simplified viewer doesn't show them yet.

## `summary`

`{ unchanged, added, removed, modified, affected }`, the number of elements with each status. It always matches counting `elements` by `status`.
