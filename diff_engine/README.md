# diff_engine

Compares two ETABS text exports (`.e2k`, or the `.$et` ETABS writes on save) and reports what changed, as a plain JSON-ready dict. Python 3.9+, stdlib only.

## Usage

```
python -m diff_engine before.e2k after.e2k -o diff.json
python -m diff_engine before.e2k after.e2k --summary
```

| Option | Default | What it does |
|---|---|---|
| `--tolerance` | `0.01` m | Max straight-line distance between two nodes, measured over plan X, Y and offset from their level, for them to count as the same node |
| `--move-tolerance` | `1.0` m | Max travel of either end for pairing a removed and an added frame as one moved frame. `0` turns the pass off |
| `--include-unchanged` | off | Also list unchanged elements, definitions and levels |
| `--summary` | off | Print only the summary block |

From Python:

```python
from diff_engine import diff_files
result = diff_files("before.e2k", "after.e2k", tolerance=0.01, move_tolerance=1.0)
```

`parse_text` / `diff_models` do the same from strings, which is what the tests use.

Tests: `python -m unittest discover -s diff_engine/tests -t .` from the repo root.

## How elements are matched

Labels are never used for identity. ETABS relabels on redraw, so labels are carried as info only.

1. **Levels** match by name. If the leftover unmatched levels on both sides are equal in number, they pair up by order from the base and count as renamed. Anything still unpaired is an added or removed level.
2. **Nodes** match on the level they're tied to (exactly) and on plan X, Y and their offset below that level (the `dz` on a `POINT` line), within `tolerance` as a straight-line distance over those three. Absolute Z is never compared, so a level whose elevation or height changed is reported once in `levels`, and the elements on it only show up if their own XY, level tie, or offset changed. Nodes on an added or removed level can't match anything.
3. **Frames** match when both end nodes match, in either order. **Areas** match on their full vertex set. **Points** (only those carrying restraints, springs, mass, other assigns, or loads) match on their node.
4. **Moved pass.** Leftover removed and added frames of the same type (beam, column, brace) pair up as `moved` when neither end travelled more than `move_tolerance`, measured against the before model's level elevations. Closest pairs win. Areas and points don't get this pass, they come out as removed plus added.

A frame or area at several stories is one element per story, the same way ETABS stores it.

## Output shape

```jsonc
{
  "schema": "etabs-diff/1",
  "units": {"force": "kN", "length": "m", "temperature": "C"},
  "options": {"tolerance": 0.01, "move_tolerance": 1.0, "include_unchanged": false},
  "inputs": {"before": {"path": "...", "units": ["LB", "IN", "F"]}, "after": {...}},
  "levels": [
    {"status": "modified", "row": 2, "category": "member_moved",
     "before": {"name": "L2", "elevation": 4.0, "height": 4.0},
     "after":  {"name": "L2", "elevation": 4.5, "height": 4.5},
     "changes": [{"property": "elevation", "before": 4.0, "after": 4.5}]}
  ],
  "definitions": [
    {"kind": "material", "family": "materials", "name": "...", "status": "modified", "rows": [5],
     "changes": [{"row": 5, "category": "material_definition", "property": "E", "before": 2e8, "after": 2.1e8}],
     "used_by": ["e3", "e4"],          // element ids that use it, directly or through a section
     "used_via": ["COL", "BM"]}        // materials only: sections that use this material
  ],
  "elements": [
    {"id": "e3", "kind": "frame", "type": "BEAM", "status": "moved", "rows": [2, 3],
     "before": {"label": "B1", "story": "L1",
                "ends": [{"point": "1", "level": "L1", "dz": 0.0, "xyz": [0, 0, 4]}, ...],
                "props": {...raw assign keys...}, "loads": [...]},
     "after": {...},
     "changes": [
       {"row": 2, "category": "member_moved", "property": "geometry", "before": [...ends], "after": [...ends]},
       {"row": 3, "category": "section_reassigned", "property": "SECTION", "before": "BM", "after": "COL"}
     ],
     "affected_by": [{"kind": "material", "family": "materials", "name": "...", "rows": [5], "via": "COL"}]}
  ],
  "summary": {"elements": {...kind: {status: n}}, "elements_by_row": {...}, "definitions": {...}, "levels": {...}}
}
```

- `status` on elements: `added`, `removed`, `moved`, `modified`, or `unchanged`. An element is listed as `unchanged` when its own assigns didn't change but a definition it uses did (`affected_by` says which), so the viewer can highlight every member using a changed section or material.
- `before` / `after` is `null` on the side where the element doesn't exist. `xyz` is absolute, in m, from each file's own level elevations.
- `property` is the e2k keyword (`SECTION`, `RELEASE`, `RESTRAINT`, ...), or `geometry`, or `loads:<pattern>` (`loads:set:<name>` for a shell uniform load set).
- `rows` on an element is every table row it touches, for filtering. `"other"` means a change outside the table (meshing, diaphragm, pier labels, ...).
- `summary` counts only what's listed, so `unchanged` there means unchanged-but-affected unless `--include-unchanged` is on.
- A changed story height moves every level above it, so each of those levels gets its own entry with an `elevation` change and no `height` change. Elements on them are untouched.
- `affected_by` and `used_by` only point at definitions that exist in both files and were edited. Moving a member onto a new section is a row 3 change on the member.

### Row tags

| row | category | Comes from |
|---|---|---|
| 1 | `members_added_removed` | frame or area added/removed |
| 2 | `member_moved` | moved pass, and level elevation/height changes |
| 3 | `section_reassigned` | `SECTION`, `MATERIALOVERWRITE` on an assign |
| 4 | `section_definition` | `FRAMESECTION` / `SHELLPROP` keys other than modifiers |
| 5 | `material_definition` | `MATERIAL` keys |
| 6 | `property_modifiers` | any `*MOD` key, on a section or on an assign |
| 7 | `releases_offsets_insertion_axis` | `RELEASE*`, `PARTIALFIX*`, `*CARDINAL*`, `ANG`, `LENOFFI/J`, `RIGIDZONE`, `OFFSET*`, `LOCALAXIS*`, `TRANSFORMSTIFFNESSFOROFFSETS` |
| 8 | `supports_springs` | `RESTRAINT`, any key containing `SPRING`, spring definitions |
| 9 | `loads` | `POINTLOAD`, `LINELOAD`, `AREALOAD`, `SHELLUNIFORMLOADSET`, `LOADPATTERN` |
| 10 | `additional_mass` | any assign key containing `MASS` |

## Assumptions

- **Units.** Every value is converted to kN, m, and degrees C on parse, from the file's `UNITS` line. Frame loads pick their dimension from `TYPE` (`POINTF` is a force, `UNIFF`/`TRAPF` force per length). Material `STRESS` curve points are left raw, because LB-FT and LB-IN saves of one real model wrote the same numbers. The table of which keys carry which dimension is in `units.py`. Keys not in it pass through unconverted. Values compare with a relative tolerance of 1e-5, since ETABS prints about 7 significant digits.
- **Level elevations.** Stories are listed top down, the last one has `ELEV`, and each one above adds its `HEIGHT`.
- **Geometry.** A point is `(x, y, level elevation - dz)`. A `LINE` with `n` puts its I end `n` levels below the assigned story and its J end at it. An `AREA` vertex sits as many levels below as its offset. Cardinal points, insertion offsets and rigid zones are compared as properties but don't shift the geometry.
- **Not seen in any real export we had, so matched by keyword family and unconfirmed:** spring assignments (springs are defined but never assigned in the samples), additional mass assigns, frame end length offsets and insertion offsets, and per-member property modifiers on assigns. If ETABS writes these with different keywords they land in `"other"` rather than being dropped.
- **Library sections** (`SHAPE "W14X90"` with no dimensions) only carry the shape name, so a change to the library's values can't be seen. A change of shape name or material can.
- **Not compared:** load cases, combinations, mass source, rebar (`CONCRETESECTION`), groups, links, design preferences, grids. The parser skips them.
- **One-to-one.** Duplicate frames on the same two nodes pair in file order. A frame split in two comes out as removed plus two added, unless one piece's far end is within `move_tolerance` of the old one.
- **Comments.** Lines between `STARTCOMMENTS` and `ENDCOMMENTS` are user text and are skipped. Malformed record lines are skipped with a warning.
