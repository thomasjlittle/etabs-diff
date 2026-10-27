# diff_engine

Compares two ETABS text exports (`.e2k`, or the `.$et` ETABS writes on save) and writes one JSON diff in the viewer's output contract, schemaVersion `0.1`. Python 3.9+, stdlib only.

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

Tests: `python -m unittest discover -s diff_engine/tests -t .` from the repo root. Type check: `pyright` from the repo root (strict, see `pyrightconfig.json`); every function and the parsed model are typed, and `just test` runs both.

## How Elements Are Matched

Labels are never used for identity. ETABS relabels on redraw, so labels are carried for display only.

1. **Levels** match by name. If the leftover unmatched levels on both sides are equal in number, they pair up by order from the base and count as renamed. Anything still unpaired is an added or removed story, and the elements on it come out as added or removed.
2. **Nodes** match on the level they're tied to (exactly) and on plan X, Y and their offset below that level (the `dz` on a `POINT` line), within `tolerance` as a straight-line distance over those three. Absolute Z is never compared, so a story elevation or height change shows up once in `tables.stories` and the elements on it stay `unchanged` unless their own XY, level tie, or offset changed.
3. **Frames** match when both end nodes match, in either order. **Areas** match on their full vertex set. **Points** (only those with a restraint, spring, mass, or load) match on their node.
4. **Moved pass.** Leftover removed and added frames of the same type (beam, column, brace) are linked as a move when neither end travelled more than `move_tolerance`, measured against the before model's level elevations. Closest pairs win. The contract has no moved status yet, so a moved frame is still one `removed` plus one `added` entry, linked by `movedTo` / `movedFrom`.

A frame or area at several stories is one element per story, the same way ETABS stores it.

## Output Shape

Follows the viewer's `output-contract.ts`. The same contract lives in [`contract.py`](contract.py) as `TypedDict`s with identical field names, and the engine builds its result through them, so the dict it returns is the JSON. Extra fields beyond the contract are marked *extension*; a viewer can ignore them.

```jsonc
{
  "schemaVersion": "0.1",
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
      "via": ["frameSection:COL", "material:STEEL"]
    }
  ],
  "tables": {
    "stories": {"added": [], "removed": [], "modified": {"L2": [{"field": "elevation", ...}]}},
    "materials": {...}, "frameSections": {...}, "shellSections": {...},
    "pointSprings": {...}, "loadPatterns": {...},
    "lineSprings": {...}, "areaSprings": {...}, "loadSets": {...},    // extensions, same shape
    "loadCases": {...}, "combos": {...}, "massSource": {...}           // extensions, same shape
  },
  "summary": {"unchanged": 937, "added": 0, "removed": 26, "modified": 56, "affected": 344}
}
```

- **Every element** in the union of A and B is listed, unchanged ones included, so the viewer can draw the whole model from this file.
- **`modified`**: the element's own assigns or loads changed. `changes` holds them, with `field` set to the e2k keyword (`SECTION`, `RELEASE`, `RESTRAINT`, ...) or `loads:<pattern>` (`loads:set:<name>` for a uniform load set).
- **`affected`**: nothing on the element changed, but a definition it uses was edited. `via` is the path to that definition (`frameSection:X`, then `material:Y` when the material was reached through the section, honoring `MATERIALOVERWRITE`). `changes` repeats the definition's changes with `field` as `<via entry>.<KEY>`. A `modified` element that also uses an edited definition gets both its own and the upstream changes, plus `via`.
- **`added` / `removed`**: `changes` is empty. Loads and assigns on a removed member go with it. Moved frames carry `movedTo` (on the removed entry) or `movedFrom` (on the added one), set to the other entry's `key` (extension).
- Only definitions that exist in both files and were edited make members `affected`. Moving a member onto a new section is a `SECTION` change on the member.
- **Tables** diff definitions by name: `added` and `removed` are name lists, `modified` maps a name to its changes. `SEISMIC` auto-lateral parameters are folded into their load pattern as a `SEISMIC` field.
- **`loadCases`, `combos`, `massSource`** are records spread over several lines, one per load term, so each term is its own field: `LOADPAT:<pattern>` for a case's or the mass source's patterns, `ACCEL:<dir>` for a response spectrum direction (`{FUNC, SF}`), and `LOADCASE:<case>` / `LOADCOMBO:<combo>` for a combo's terms. The value is the scale factor, so a dropped term is `before: 1, after: null`. Every other key (`TYPE`, `INITCOND`, `INCLUDELOADS`, ...) compares as usual.
- A changed story height moves every story above it, so each of those gets an `elevation` change in `tables.stories` (and no `height` change). The elements on them stay `unchanged`.
- **`key`** is `story|x|y|dz` per node, each rounded to the tolerance, and `subtype|` plus the sorted node keys joined with `~` for frames and areas. It uses B's story names (and B's coordinates; A's for removed elements). Matching itself is a nearest-node search, not a key lookup, so the key is just a stable id. Duplicates get `#2`, `#3`.

### Row Tags

Each `Change` carries `row`, the line of the property table it belongs to, so the viewer can filter. `null` means a change outside the table (meshing, diaphragms, pier labels, ...).

| row | Change | Comes from |
|---|---|---|
| 1 | Frames added / removed | `added` / `removed` status |
| 2 | Member moved, story elevation | `movedTo` / `movedFrom` links, `tables.stories` |
| 3 | Section reassigned | `SECTION`, `MATERIALOVERWRITE` on an assign |
| 4 | Section definition edited | `frameSections` / `shellSections` keys other than modifiers |
| 5 | Material edited | `materials` keys |
| 6 | Property modifiers | any `*MOD` key, on a section or on an assign |
| 7 | Releases, offsets, insertion point, local axis | `RELEASE*`, `PARTIALFIX*`, `*CARDINAL*`, `ANG`, `LENOFFI/J`, `RIGIDZONE`, `OFFSET*`, `LOCALAXIS*`, `TRANSFORMSTIFFNESSFOROFFSETS` |
| 8 | Supports and springs | `RESTRAINT`, any key containing `SPRING`, spring tables |
| 9 | Loads | `loads:*` fields, `loadPatterns`, `loadSets`, `loadCases`, `combos` |
| 10 | Additional mass | any assign key containing `MASS`, `massSource` |

`affects` follows the row (`stiffness`/`mass` for rows 3 to 6, `stiffness` for 7 and 8, `load` for 9, `mass` for 10, `geometry` for stories), except `WEIGHTPERVOLUME`, `MMOD` and `WMOD`, which are `mass` only.

## Assumptions

- **Units.** Every value is converted to kip, inch, and degrees F on parse, from the file's `UNITS` line. The table of which keys carry which dimension is in `units.py`. Keys not in it pass through unconverted. Values compare with a relative tolerance of 1e-5, since ETABS prints about 7 significant digits. Frame loads pick their dimension from `TYPE` (`POINTF` is a force, `UNIFF`/`TRAPF` force per length). Material `STRESS` curve points are left raw, because LB-FT and LB-IN saves of one real model wrote the same numbers.
- **Level elevations.** Stories are listed top down, the last one has `ELEV`, and each one above adds its `HEIGHT`.
- **Geometry.** A point is `(x, y, level elevation - dz)`. A `LINE` with `n` puts its I end `n` levels below the assigned story and its J end at it. An `AREA` vertex sits as many levels below as its offset. Cardinal points, insertion offsets and rigid zones are compared as properties but don't shift the drawn geometry.
- **Not seen in any real export we had, so matched by keyword family and unconfirmed:** spring assignments (springs are defined but never assigned in the samples), additional mass assigns, frame end length offsets and insertion offsets, and per-member property modifiers on assigns. If ETABS writes these with different keywords they come through with `row: null` rather than being dropped.
- **Library sections** (`SHAPE "W14X90"` with no dimensions) only carry the shape name, so a change to the library's values can't be seen. A change of shape name or material can.
- **Ignored:** `USERJOINT` flags and the library `FILE` key. Joints with nothing on them aren't listed.
- **Load cases.** A response spectrum `ACCEL ... SF` is g in the file's length units, so it is scaled like a length (9.80665 m becomes 386.09 in). A pushover `JOINT "label" "story"` is stored as `label@story`.
- **Not compared:** rebar (`CONCRETESECTION`), groups, links, design preferences, grids. The parser skips them.
- **One-to-one.** Duplicate frames on the same two nodes pair in file order. A frame split in two comes out as removed plus two added, linked as a move only if one piece's far end is within `move_tolerance` of the old one.
- **Comments.** Lines between `STARTCOMMENTS` and `ENDCOMMENTS` are user text and are skipped. Malformed record lines are skipped with a warning.
