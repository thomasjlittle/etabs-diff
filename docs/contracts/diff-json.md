# Diff JSON contract (v1)

Produced by Team 2 (`model_diff`), consumed by Team 3 (`viewer`).

- Schema: [diff.schema.json](diff.schema.json)
- Complete example: [`fixtures/diff/base_vs_revised.diff.json`](../../fixtures/diff/base_vs_revised.diff.json), the exact expected diff of the two fixture models

The diff is self-contained: it carries coordinates for every object, unchanged ones included, so the viewer draws the whole building from this one file.

## How objects are matched

Objects in the two models are paired by **resolved 3D coordinates within a tolerance, never by label**. Labels change whenever someone redraws or renumbers in ETABS, so a label is just another field.

| Kind | Two objects are the same object when |
|---|---|
| point | positions are within `match` |
| frame | both ends are within `match`, in either end order |
| area | same vertex count, and every vertex of each has a vertex of the other within `match` |

`match` defaults to **0.01 ft (about 1/8 in)** and is a parameter of the engine. Why that value: both real ETABS files we read had a joint merge tolerance (`MERGETOL`) of 0.1 in, so two distinct joints in one model are never closer than about 0.0083 ft and 0.01 ft can't pair two different joints. It's 100 times the rounding noise of a 7 significant digit unit round trip on a 1,000 ft model (about 1e-4 ft), and far below any real member move, which is inches or more.

What falls out of that:

- moved more than `match`: the old position shows `removed`, the new one `added`
- moved less than `match`: matched, and `offset` says by how much
- relabeled at the same spot: matched, status `relabeled`, a `label` field change
- split into two members, or two merged into one: the endpoints differ, so removed plus added
- two overlapping duplicates at the same coordinates: paired one-to-one, the leftover is added or removed

The algorithm is in [../team-2-diff.md](../team-2-diff.md).

## Top level

| Field | Type | Notes |
|---|---|---|
| `schema_version` | `1` | |
| `before`, `after` | object | the `source` block of each model: `file`, `program`, `program_version`, `file_units` |
| `units` | object | always `{"force": "KIP", "length": "FT", "temperature": "F"}`. Show it in the viewer header |
| `tolerances` | object | `{"match": 0.01, "rel": 1e-05, "abs": 1e-09}`, the values the engine used. `match` in ft, `rel`/`abs` for comparing field values |
| `stories` | object | `{"before": [...], "after": [...]}`, each a copy of that model's `stories` |
| `summary` | object | counts, see below |
| `objects` | array | every spatial object from both models, sorted by `(kind, after_id or before_id)` |
| `definitions` | array | changed non-spatial definitions only, sorted by `(category, name)` |

## `objects[]`

| Field | Type | Notes |
|---|---|---|
| `kind` | `"point"`, `"frame"`, `"area"` | |
| `status` | string | see the table below |
| `type` | string or null | `COLUMN`, `BEAM`, `BRACE`, `FLOOR`, `PANEL`, `AREA`. null for points |
| `before_id` | string or null | `"<label>@<story>"` of the before object. null when `added` |
| `after_id` | string or null | `"<label>@<story>"` of the after object. null when `removed` |
| `label`, `story` | string | after side, or before side when `removed` |
| `coords` | array of `[x, y, z]` | absolute FT, same side as `label`. Same shape as in the model JSON |
| `section` | string or null | `assigns.SECTION` on the same side, for hover text |
| `offset` | number or null | ft, rounded to 1e-6. Largest vertex distance of the matched pair (0.0 when it didn't move). null when added or removed |
| `changes` | array | field changes, see below. Empty for `unchanged`, `added`, `removed` |

`before_id`/`after_id` are for display and for linking back to the model JSONs. Never match on them.

| Status | Meaning | Viewer color |
|---|---|---|
| `unchanged` | matched, no field differs | gray `#9ca3af`, faded |
| `added` | only in after | green `#16a34a` |
| `removed` | only in before | red `#dc2626` |
| `modified` | matched, at least one field other than `label`/`story` differs | amber `#f59e0b` |
| `relabeled` | matched, only `label` and/or `story` differ | blue `#2563eb` |

A relabeled member that was also resized is `modified`, and its `changes` list still includes the `label` change.

## `changes[]`

```json
{"field": "assigns.SECTION", "before": "W18X35", "after": "W24X55"}
```

`before` is null when the field didn't exist before, `after` is null when it's gone. Field paths:

| Path | Before / after values |
|---|---|
| `label` | the labels (`"C3"` to `"C30"`) |
| `story` | the story names (a story rename, or a coincidental match across stories) |
| `type` | the type strings |
| `assigns.<KEY>` | the assign values |
| `loads.<pattern>` | the full list of load records for that pattern |
| `<KEY>` or `<KEY>.<sub>` (definitions) | record values, nested dicts flattened with dots, e.g. `LOADCASE.SDL`, `ACCEL.U1.SF` |

There's no `coords` change: geometry is what matches objects, and `offset` covers moves inside the tolerance. Lists compare as a whole. Dicts flatten to dotted paths.

## `definitions[]`

Definitions have no geometry, so they match by name.

| Field | Type | Notes |
|---|---|---|
| `category` | string | a model JSON definitions category (`combos`, `frame_sections`, ...) or `stories` |
| `name` | string | definition or story name |
| `status` | `added`, `removed`, `modified` | unchanged definitions are left out |
| `changes` | array | same shape as above. For `added` every field has `before: null`; for `removed` every field has `after: null` |

Story changes use category `stories` with fields `elev` and `height`.

```json
{"category": "combos", "name": "D+L", "status": "modified",
 "changes": [{"field": "LOADCASE.SDL", "before": null, "after": 1.0}]}
```

## `summary`

```json
"summary": {
  "point": {"unchanged": 26, "added": 4, "removed": 2, "modified": 0, "relabeled": 0},
  "frame": {"unchanged": 41, "added": 2, "removed": 2, "modified": 1, "relabeled": 3},
  "area":  {"unchanged": 6,  "added": 0, "removed": 0, "modified": 1, "relabeled": 0},
  "definitions": {"added": 1, "removed": 0, "modified": 1}
}
```

That's the fixture result. Each count equals the number of matching entries in `objects` or `definitions`.

## Python interface

```python
# model_diff/__init__.py
MATCH_TOL = 0.01   # ft

def diff_models(before: dict, after: dict, match_tol: float = MATCH_TOL) -> dict: ...
```

Pure function: no file IO, no printing, doesn't mutate its inputs. The CLI takes `--tol <ft>`.
