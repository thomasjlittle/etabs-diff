# diff_engine

Compares two ETABS text exports (`.e2k`, or the `.$et` ETABS writes on save) and writes one JSON diff in the viewer's output contract, schemaVersion `0.2`. Python 3.9+, stdlib only.

## Usage

```
python -m diff_engine before.e2k after.e2k -o diff.json
python -m diff_engine before.e2k after.e2k --summary
```

| Option | Default | What it does |
|---|---|---|
| `--tolerance` | `PREFERENCE MERGETOL` of the before file (0.1 in if it has none) | Max straight-line distance, in inches, between two nodes over plan X, Y and offset from their level, for them to count as the same node |
| `--move-tolerance` | `36` in | Max travel of either end for linking a removed and an added frame as one move. `0` turns the pass off |
| `--summary` | off | Print only the status counts |

From Python:

```python
from diff_engine import diff_files
result = diff_files("before.e2k", "after.e2k", tolerance=None, move_tolerance=36.0)
```

`parse_text` / `diff_models` do the same from strings, which is what the tests use.

Run the CLI and tests from `backend/` (or set `PYTHONPATH=backend` from the repo root). Tests: `python -m unittest discover -s diff_engine/tests -t .` from `backend/`. Type check: `pyright` from the repo root (strict, see `pyrightconfig.json`); every function and the parsed model are typed, and `just test` runs both.

## How Elements Are Matched

Labels are never used for identity. ETABS relabels on redraw, so labels are carried for display, and a matched element whose label changed gets a `label` change with `kind: "renamed"`.

1. **Levels** match by name. If the leftover unmatched levels on both sides are equal in number, they pair up by order from the base and count as renamed. Anything still unpaired is an added or removed story, and the elements on it come out as added or removed.
2. **Nodes** match on the level they're tied to (exactly) and on plan X, Y and their offset below that level (the `dz` on a `POINT` line), within `tolerance` as a straight-line distance over those three. Absolute Z is never compared, so a story elevation or height change shows up once in `tables.stories` and the elements on it stay `unchanged` unless their own XY, level tie, or offset changed.
3. **Frames** match when both end nodes match, in either order. **Areas** match on their full vertex set. **Points** match on their node. Every joint is matched, but only those with a restraint, spring, mass or load, or whose assigns changed, are listed (a bare joint that gains a diaphragm assign comes out `modified`).
4. **Moved pass.** Leftover removed and added frames of the same type (beam, column, brace) are linked as a move when neither end travelled more than `move_tolerance`, measured against the before model's level elevations. Closest pairs win. Then, whatever the end travel, a frame is linked to one that lies on the same line (both ends within `tolerance` of it), overlaps it by more than `tolerance` (touching at a point doesn't count), and has identical assigns after unit conversion (section, material overwrite, releases, cardinal point, offsets, local axis, modifiers, springs, everything on its `LINEASSIGN`). That covers a beam extended, shortened, or slid along its line. Loads don't have to match. This colinear link is one-to-one only: if a frame lines up that way with two or more on the other side (a beam split in two, or two merged), none of them link, since one moved member can't show a split and picking one piece would read as a shorter beam plus an unexplained new one. The contract has no moved status yet, so a moved frame is still one `removed` plus one `added` entry, linked by `movedTo` / `movedFrom`.

A frame or area at several stories is one element per story, the same way ETABS stores it.

## Output Shape

Follows the viewer's [`contract.ts`](../../frontend/demo_viewer/contract.ts). The same contract lives in [`contract.py`](contract.py) as `TypedDict`s with identical field names, and the engine builds its result through them, so the dict it returns is the JSON. Extra fields beyond the contract are marked *extension*; a viewer can ignore them.

```jsonc
{
  "schemaVersion": "0.2",
  "meta": {
    "a": {"file": "before.e2k", "etabsVersion": "17.0.1", "units": "KN M C"},
    "b": {"file": "after.e2k",  "etabsVersion": "17.0.1", "units": "KN M C"},
    "lengthUnit": "in",
    "forceUnit": "kip",            // extension
    "tolerance": 0.03937,          // in
    "moveTolerance": 36.0          // extension, in
  },
  "stories": [{"name": "L2", "elevA": 168.0, "elevB": 174.0}],   // bottom up, null where absent
  "elements": [
    {
      "key": "column|L1|0|0|0~L2|0|0|0",   // level-relative geometric key, never a label
      "kind": "frame",                      // point | frame | area
      "subtype": "column",                  // beam | column | brace | floor | wall | other | joint
      "label": "C1", "story": "L2",         // display only; B's, or A's when removed
      "status": "affected",                 // unchanged | added | removed | modified | affected
      "geometry": [[0, 0, 0], [0, 0, 168]], // inches; B's coordinates, A's when removed
      "changes": [
        {"field": "material:STEEL.E", "before": 29000, "after": 30450,
         "affects": ["stiffness", "mass"], "row": 5}            // row: extension
      ],
      "via": ["frameSection:COL", "material:STEEL"],
      "loads": {                            // 0.2, only on elements loaded in A or B
        "a": {"Live": [{"TYPE": "POINTF", "DIR": "GRAV", "FVAL": 5, "RDIST": 0.4, "DIST": 67.2}]},
        "b": {"Live": [{"TYPE": "POINTF", "DIR": "GRAV", "FVAL": 5, "RDIST": 0.4, "DIST": 69.6}]}
      }
    }
  ],
  "tables": {
    "stories": {"added": [], "removed": [], "modified": {"L2": [{"field": "elevation", ...}]}},
    "materials": {...}, "frameSections": {...}, "shellSections": {...},
    "pointSprings": {...}, "loadPatterns": {...},
    "lineSprings": {...}, "areaSprings": {...}, "loadSets": {...},    // extensions, same shape
    "loadCases": {...}, "combos": {...}, "massSource": {...},          // extensions, same shape
    "diaphragms": {...}, "functions": {...}, "analysisOptions": {...}  // extensions, same shape
  },
  "summary": {"unchanged": 937, "added": 0, "removed": 26, "modified": 56, "affected": 344},
  "loadDefinitions": {                       // 0.2: the whole of each model's load definitions
    "a": {
      "patterns": {"Dead": {"type": "Dead", "selfWeight": 1}, "Live": {"type": "Live", "selfWeight": 0}},
      "cases": {"DL": {"type": "Linear Static", "patterns": {"Dead": 1},
                       "effective": {"expandable": true, "patterns": {"Dead": 1}, "reason": null}}},
      "combos": {"1.2D+1.6L": {"type": "Linear Add", "cases": {"DL": 1.2, "LL": 1.6}, "combos": {},
                               "effective": {"expandable": true, "patterns": {"Dead": 1.2, "Live": 1.6}, "reason": null}}}
    },
    "b": {...}
  }
}
```

- **Every element** in the union of A and B is listed, unchanged ones included, so the viewer can draw the whole model from this file.
- **`modified`**: the element's own assigns, loads or label changed. `changes` holds them, with `field` set to the e2k keyword (`SECTION`, `RELEASE`, `RESTRAINT`, ...) or `loads:<pattern>` (`loads:set:<name>` for a uniform load set).
- **`affected`**: nothing on the element changed, but a definition it uses was edited. `via` is the path to that definition (`frameSection:X`, then `material:Y` when the material was reached through the section, honoring `MATERIALOVERWRITE`). `changes` repeats the definition's changes with `field` as `<via entry>.<KEY>`. A `modified` element that also uses an edited definition gets both its own and the upstream changes, plus `via`.
- **`added` / `removed`**: `changes` is empty. Loads and assigns on a removed member go with it. Moved frames carry `movedTo` (on the removed entry) or `movedFrom` (on the added one), set to the other entry's `key` (extension). A moved pair's own changes (assigns, loads) go on its removed entry. When the pair stays on one line, frame loads compare by position along that line in inches from the old member's I end, so a load that didn't move isn't flagged just because its relative distance (`RDIST`, `RDSTART`, `RDEND`) changed with the length; a uniform load counts as a trapezoid over the whole member. A changed load shows that way too, as `DIST` or `DSTART` / `DEND` from the old I end.
- Only definitions that exist in both files and were edited make members `affected`. Moving a member onto a new section is a `SECTION` change on the member.
- **Tables** diff definitions by name: `added` and `removed` are name lists, `modified` maps a name to its changes. A removed and an added definition with identical properties, when that pairing is unambiguous, are one rename instead: a `name` change with `kind: "renamed"` under the new name, and references to it compare by identity so the rename alone doesn't flag members. Auto lateral inputs are folded into their load pattern as one field each: `SEISMIC:<KEY>` and `WIND:<KEY>` (the code name is `SEISMIC:CODE` / `WIND:CODE`), `SEISMIC:ECCOVERWRITE:<story>:<diaphragm>` for a user eccentricity and `WINDEXPOSURE:<path>:<KEY>` for a wind exposure line. `functions` keeps `TIMEVAL` as one list of numbers across all of a function's lines. `analysisOptions` holds the global `PDELTA` record.
- **`loadCases`, `combos`, `massSource`** are records spread over several lines, one per load term, so each term is its own field: `LOADPAT:<pattern>` for a case's or the mass source's patterns, `ACCEL:<dir>` for a response spectrum direction (`{FUNC, SF}`), and `LOADCASE:<case>` / `LOADCOMBO:<combo>` for a combo's terms. The value is the scale factor, so a dropped term is `before: 1, after: null`. Every other key (`TYPE`, `INITCOND`, `INCLUDELOADS`, ...) compares as usual.
- **`loads`** (0.2) is on every element that carries an applied load in A or B, whatever its status, and absent otherwise. `a` and `b` map a load pattern to that side's loads on the element (`{}` when the element is missing or unloaded on that side). Each load is the e2k record minus `LC`, in kip and inches: `TYPE`, `DIR` as written (`GRAV`, `X`, `Y`, `Z`, `1`, `2`, `3`, ...), and the value keys for its type (`FVAL`; `FSTART` / `FEND` for a trapezoid; `FX` .. `MZ` for a joint). Frame loads carry each position both ways, relative and in inches from the I end along the drawn member: `RDIST` / `DIST` for `POINTF` / `POINTM`, `RDSTART` / `DSTART` and `RDEND` / `DEND` for `UNIFF` / `UNIFM` / `TRAPF` / `TRAPM` (a uniform load without its own extent spans 0 to 1). An area load set (`TYPE UNIFLOADSET`) becomes one load per pattern in the set, with `SET` and that pattern's `FVAL`; a set the file doesn't define stays under `set:<name>` with no value. Self-weight is not drawn as a load; it is the pattern's `selfWeight` multiplier.
- **`loadDefinitions`** (0.2) lists every load pattern (`type`, `selfWeight`), case (`type`, `patterns`: its `LOADPAT` scale factors) and combo (`type`, `cases` and `combos`: its `LOADCASE` and `LOADCOMBO` scale factors) in each model, changed or not. Each case and combo has `effective`, from `loads.expand`: the pattern factors that give its applied load, so the load on an element for a case or combo is the sum over `effective.patterns` of that pattern's loads times the factor. A `Linear Static` or `Nonlinear Static` case that starts from zero (`INITCOND PRESET`) is its `LOADPAT` terms. A `Linear Add` combo sums its terms' expansions times their factors, combos of combos included (a `LOADCASE` term may name a combo). Everything else (envelope, SRSS, absolute or range add combos, response spectrum or modal cases, a case that continues from another, a missing or circular reference, or any combo that uses one of those) is `expandable: false` with a `reason` and empty `patterns`, never a guess.
- A changed story height moves every story above it, so each of those gets an `elevation` change in `tables.stories` (and no `height` change). The elements on them stay `unchanged`.
- **`key`** is `story|x|y|dz` per node, each rounded to the tolerance, and `subtype|` plus the sorted node keys joined with `~` for frames and areas. It uses B's story names (and B's coordinates; A's for removed elements). Matching itself is a nearest-node search, not a key lookup, so the key is just a stable id. Duplicates get `#2`, `#3`.

### Row Tags

Each `Change` carries `row`, the line of the change list (1 to 17) it belongs to, so the viewer can filter. `null` means a change outside the list (meshing, pier labels, ...). Added and removed elements carry no changes; the CSV report tags them row 1 (row 15 for areas) and moves row 1.

| row | Change | Comes from |
|---|---|---|
| 1 | Geometry: members, nodes, shells added / removed / moved, story elevation | `added` / `removed` status, `movedTo` / `movedFrom` links, `tables.stories` |
| 2 | Section reassigned (1A) | `SECTION`, `MATERIALOVERWRITE` on an assign |
| 3 | Section definition edited (1B) | `frameSections` / `shellSections` keys other than modifiers |
| 4 | Material edited (1C) | `materials` keys |
| 5 | Property modifiers (1D) | section `*MOD` keys, member `PROPMOD*` keys |
| 6 | Releases, offsets, insertion point, local axis (1E) | `RELEASE*`, `PARTIALFIX*`, `*CARDINAL*`, `ANG`, `LENOFFI/J`, `LENGTHOFFI/J`, `RIGIDZONE`, `OFFSET*`, `LOCALAXIS*`, `TRANSFORMSTIFFNESSFOROFFSETS` |
| 7 | Nodes modified | a node is listed when any of its assigns changed; its changes carry the row of the key (8, 9, 10, 16) |
| 8 | Supports and springs (2A) | `RESTRAINT`, any key containing `SPRING`, spring tables |
| 9 | Applied loads (2B) | `loads:*` fields, `loadSets` |
| 10 | Additional mass | any assign key containing `MASS` |
| 11 | Mass source | `massSource` |
| 12 | Load patterns, auto seismic and wind inputs | `loadPatterns` |
| 13 | Load cases, P-delta | `loadCases`, `analysisOptions` (`PDELTA`) |
| 14 | Combos | `combos` |
| 15 | Walls and slabs added / removed | `added` / `removed` areas |
| 16 | Diaphragms | `DIAPH` on point and area assigns, `diaphragms` |
| 17 | Response spectrum and time history functions | `functions` |

`affects` follows the row (`geometry`/`stiffness`/`mass` for 1 and 15, `stiffness`/`mass` for 2 to 5 and 16, `stiffness` for 6 and 8, `mass` for 10 and 11, `load` for 9 and 12 to 17), except `WEIGHTPERVOLUME`, `MMOD`, `WMOD`, `PROPMODM` and `PROPMODW`, which are `mass` only.

## Assumptions

- **Units.** Every value is converted to kip, inch, and degrees F on parse, from the file's `UNITS` line. The table of which keys carry which dimension is in `units.py`. Keys not in it pass through unconverted. Values compare with a relative tolerance of 1e-5, since ETABS prints about 7 significant digits. Frame loads pick their dimension from `TYPE` (`POINTF` is a force, `UNIFF`/`TRAPF` force per length). Material `STRESS` curve points are left raw, because LB-FT and LB-IN saves of one real model wrote the same numbers.
- **Level elevations.** Stories are listed top down, the last one has `ELEV`, and each one above adds its `HEIGHT`.
- **Geometry.** A point is `(x, y, level elevation - dz)`. A `LINE` with `n` puts its I end `n` levels below the assigned story and its J end at it. An `AREA` vertex sits as many levels below as its offset. Cardinal points, insertion offsets and rigid zones are compared as properties but don't shift the drawn geometry.
- **Keywords confirmed only from public ETABS samples, not our own exports:** member modifiers (`PROPMOD*`), point spring assigns (`SPRINGPROP`), auto wind (`WIND`, `WINDEXPOSURE`). Seen only in files from a third-party tool that may not be ETABS-written: line and area spring assigns, end length offsets (`LENGTHOFFI/J`, `RIGIDZONE`). **Not seen anywhere:** additional mass assigns (matched by any key containing `MASS`) and insertion point offsets. If ETABS writes any of these with other keywords they come through with `row: null` rather than being dropped.
- **Local axis angles** (`ANG`) compare in degrees modulo 360 within 0.001, and a missing angle is 0, so `0` vs `360` vs no angle is no change. A change shows the before and after angle.
- **Functions read from a file** (`FILE "..."`) only carry the file name, which is ignored like the library `FILE`, so a changed spectrum file is not seen. Inline values (`TIMEVAL`) are.
- **Library sections** (`SHAPE "W14X90"` with no dimensions) only carry the shape name, so a change to the library's values can't be seen. A change of shape name or material can.
- **Ignored:** `USERJOINT` flags and `FILE` keys (section libraries, function files). Joints with nothing on them aren't listed.
- **Load cases.** A response spectrum `ACCEL ... SF` is g in the file's length units, so it is scaled like a length (9.80665 m becomes 386.09 in). A pushover `JOINT "label" "story"` is stored as `label@story`.
- **Not compared:** rebar (`CONCRETESECTION`), groups, links, design preferences, grids. The parser skips them.
- **One-to-one.** Duplicate frames on the same two nodes pair in file order. A frame split in two comes out as removed plus two added, linked as a move only if one piece's far end is within `move_tolerance` of the old one (the colinear link skips splits and merges).
- **Loads on a reversed colinear move** compare by position, but a load in a local direction (`DIR 1`, `2`, `3`) is not flipped to match the reversed member axes.
- **Comments.** Lines between `STARTCOMMENTS` and `ENDCOMMENTS` are user text and are skipped. Malformed record lines are skipped with a warning.
