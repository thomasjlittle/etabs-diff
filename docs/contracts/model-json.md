# Model JSON contract (v1)

Produced by Team 1 (`e2k_parser`), consumed by Team 2 (`model_diff`).

- Schema: [model.schema.json](model.schema.json)
- Complete example: [`fixtures/model/base.model.json`](../../fixtures/model/base.model.json), the exact expected parse of [`fixtures/e2k/base.e2k`](../../fixtures/e2k/base.e2k)
- Second example: [`fixtures/model/revised.model.json`](../../fixtures/model/revised.model.json), the parse of `revised.e2k`

## Rules

- Every value is in **KIP, FT, F**, whatever the file used. Angles stay in degrees. Unitless values stay unitless. The per-key unit table is in [../e2k-format.md](../e2k-format.md#units).
- Unquoted numbers become JSON numbers (floats, so `MINNUMSTA 3` is `3.0`). Quoted tokens stay strings. Labels and story names are always strings.
- Keys inside `assigns`, load records, and `definitions` records are the e2k keywords, upper case, exactly as the file spells them (`SECTION`, `FVAL`, `WEIGHTPERVOLUME`). No renaming, so a key the parser has never seen still flows through to the diff.
- `points`, `frames`, `areas` are sorted by `id`. Key order inside objects doesn't matter.
- Never include the `LOG` section, `PROJECT INFORMATION`, or `TITLE1`/`TITLE2`.

## Top level

| Field | Type | Notes |
|---|---|---|
| `schema_version` | `1` | |
| `source` | object | `file` (basename only, no path), `program` (`"ETABS"`), `program_version` (`"20.3.0"` or null), `file_units` (`{force, length, temperature}` as written in the file) |
| `units` | object | always `{"force": "KIP", "length": "FT", "temperature": "F"}` |
| `stories` | array | bottom to top, see below |
| `grids` | array | `{system, label, dir, coord}`, display only |
| `points` | array | point objects |
| `frames` | array | frame objects |
| `areas` | array | area objects |
| `definitions` | object | category -> name -> record |
| `warnings` | array of strings | unknown records, unresolved references. Empty for the fixtures |

## `stories`

Bottom to top. The first entry is the base level from the `ELEV` line.

```json
{"name": "BASE", "elev": 0.0, "height": null},
{"name": "L2",   "elev": 14.0, "height": 14.0}
```

## Spatial objects

Common fields for `points`, `frames`, `areas`:

| Field | Type | Notes |
|---|---|---|
| `id` | string | `"<label>@<story>"`, unique within one model. For display and lookups inside one model. The diff never matches on it |
| `label` | string | plan label from the file. A plain attribute: the diff matches on `coords` and reports a label change like any other field |
| `story` | string | story the object is assigned at |
| `coords` | array of `[x, y, z]` | resolved absolute 3D coordinates in FT. This is what the diff matches on. Points: 1 entry. Frames: 2 (I end, J end). Areas: one per corner, in file order |
| `assigns` | object | every key-value from the `POINTASSIGN` / `LINEASSIGN` / `AREAASSIGN` lines for this `(label, story)`. `{}` when there are none |
| `loads` | object | load pattern -> list of load records, see below. `{}` when none |

Frames and areas add:

| Field | Type | Notes |
|---|---|---|
| `type` | string | frames: `COLUMN`, `BEAM`, `BRACE`. Areas: `FLOOR`, `PANEL`, `AREA` |
| `nodes` | array of `{point, story}` | the point label and story each coordinate came from, same order as `coords` |

Frame example (from the fixture):

```json
{
  "id": "B1@L2", "label": "B1", "story": "L2", "type": "BEAM",
  "nodes": [{"point": "1", "story": "L2"}, {"point": "2", "story": "L2"}],
  "coords": [[0.0, 0.0, 14.0], [25.0, 0.0, 14.0]],
  "assigns": {"SECTION": "W18X35", "MAXSTASPC": 2.0, "AUTOMESH": "YES", "MESHATINTERSECTIONS": "YES"},
  "loads": {"SDL": [{"TYPE": "UNIFF", "DIR": "GRAV", "FVAL": 0.3}]}
}
```

Wall example: the two bottom corners sit on the story below.

```json
{
  "id": "W1@L2", "label": "W1", "story": "L2", "type": "PANEL",
  "nodes": [{"point": "3", "story": "BASE"}, {"point": "6", "story": "BASE"},
            {"point": "6", "story": "L2"}, {"point": "3", "story": "L2"}],
  "coords": [[50.0, 0.0, 0.0], [50.0, 30.0, 0.0], [50.0, 30.0, 14.0], [50.0, 0.0, 14.0]],
  "assigns": {"SECTION": "WALL12", "PIER": "P1", "CARDINALPOINT": "MIDDLE"},
  "loads": {}
}
```

Point example: points have no `type` or `nodes`.

```json
{"id": "1@BASE", "label": "1", "story": "BASE", "coords": [[0.0, 0.0, 0.0]],
 "assigns": {"RESTRAINT": "UX UY UZ RX RY RZ"}, "loads": {}}
```

## `loads`

Keyed by the `LC` value. Each load line becomes one record holding its keys except the label, story, and `LC`, in file order:

```json
"loads": {
  "SDL":  [{"TYPE": "TRAPF", "DIR": "GRAV", "FSTART": 0.2, "FEND": 0.4, "RDSTART": 0.0, "RDEND": 1.0}],
  "LIVE": [{"TYPE": "UNIFF", "DIR": "GRAV", "FVAL": 0.05}]
}
```

A uniform load set assignment has no `LC`. Key it as `"UNIFLOADSET:<set name>"`, record `{"TYPE": "UNIFLOADSET", "SET": "<set name>"}`.

## `definitions`

`definitions[category][name]` is one record: every key-value from every line with that record keyword and name, merged, then unit-converted. The special cases (load case terms, combo terms, doubled values) are in [../e2k-format.md](../e2k-format.md#the-key-value-rule).

| Category | Record keyword | Required for the hackathon |
|---|---|---|
| `materials` | `MATERIAL` | yes |
| `frame_sections` | `FRAMESECTION` | yes |
| `shell_props` | `SHELLPROP` (slab, deck, wall) | yes |
| `diaphragms` | `DIAPHRAGM` | yes |
| `load_patterns` | `LOADPATTERN` | yes |
| `load_cases` | `LOADCASE` | yes |
| `combos` | `COMBO` | yes |
| `rebar` | `REBARDEFINITION` | free with the generic rule |
| `concrete_sections` | `CONCRETESECTION` | free |
| `tendon_sections` | `TENDONSECTION` | free |
| `link_props` | `LINKPROP` | free |
| `panel_zones` | `PANELZONE` | free |
| `point_springs` | `POINTSPRING` | free |
| `piers` / `spandrels` | `PIERNAME` / `SPANDRELNAME` | free (record is `{}`) |
| `auto_seismic` | `SEISMIC` | free |
| `shell_load_sets` | `SHELLUNIFORMLOADSET` | free |
| `mass_sources` | `MASSSOURCE`, `MASSSOURCELOAD` | free |
| `functions` | `FUNCTION` | free |
| `analysis_options` | `ACTIVEDOF`, `MODELHINGESINLINKS`, `PDELTA`, `AUTOMESHOPTIONS` | free, name = keyword |
| `design_preferences` | any `*PREFERENCE` | free, name = keyword |
| `groups` | `GROUP` | stretch, see the parser spec |

"Free" means the generic key-value rule covers it with no special code. Include it if your generic parser does; the diff handles any category.

Examples from the fixture:

```json
"frame_sections": {
  "CB16X24": {"MATERIAL": "4000Psi", "SHAPE": "Concrete Rectangular", "D": 2.0, "B": 1.333333,
              "JMOD": 0.1, "I2MOD": 0.35, "I3MOD": 0.35},
  "W14X90":  {"MATERIAL": "A992Fy50", "SHAPE": "W14X90", "FILE": "AISC14"}
},
"load_cases": {
  "DEAD": {"TYPE": "Linear Static", "INITCOND": "PRESET", "LOADPAT": {"DEAD": 1.0}},
  "RSX":  {"TYPE": "Response Spectrum", "MODALCASE": "Modal",
           "ACCEL": {"U1": {"FUNC": "RS1", "SF": 32.17405}}, "MODALDAMPTYPE": "Constant", "CONSTDAMP": 0.05}
},
"combos": {
  "D+L": {"TYPE": "Linear Add", "NOTES": "Service check", "LOADCASE": {"DEAD": 1.0, "LIVE": 1.0}},
  "ENV": {"TYPE": "Envelope", "LOADCOMBO": {"1.4D": 1.0, "1.2D+1.6L": 1.0}}
}
```

## Python interface

```python
# e2k_parser/__init__.py
def parse_file(path: str | os.PathLike) -> dict: ...                 # reads the file, returns model JSON as a dict
def parse_text(text: str, source_name: str = "<text>") -> dict: ...  # same, for Streamlit uploads
```

Both raise `ValueError` with a line number for a file they can't make sense of (no `UNITS` line, a frame pointing at a missing point). Anything merely unknown goes in `warnings` instead.
