# E2K format reference

Written from real ETABS 20.3 `.e2k` and ETABS 21.0 `.$et` files. There is no ETABS install to test against, so anything inferred rather than seen is marked **Unconfirmed**. Implement the stated assumption and move on.

All examples here are synthetic, taken from [`fixtures/e2k/base.e2k`](../fixtures/e2k/base.e2k).

## File basics

- Plain text. Real files are CRLF and ANSI. Read with `encoding="latin-1"` (never fails) and strip `\r`.
- A `.$et` file is the text copy ETABS writes on save. Same format, same parser.
- A line starting with `$ ` is a section header: `$ POINT COORDINATES`. Some headers carry trailing spaces (`$ PIER/SPANDREL NAMES `), so strip them.
- The first line, `$ File C:\...\name.e2k saved <date>`, is a header, not a section. Ignore it.
- Record lines are indented two spaces. The first token is the record keyword (`POINT`, `LINEASSIGN`, ...). Key the parser on the record keyword, not the section header.
- The file ends with `  END` then `$ END OF MODEL FILE`.
- Any section can be missing or empty. Collect everything first, resolve geometry at the end, and you don't depend on section order.
- **Skip and never copy**: `$ LOG` (free text with user names and machine paths), `$ PROJECT INFORMATION` (company and model names), and `TITLE1`/`TITLE2` in `$ CONTROLS`.
- Also skip: `$ DIMENSION LINES`, `$ DEVELOPED ELEVATIONS`, `$ TABLE SETS`, `$ GENERALIZED DISPLACEMENTS`.

## Tokenizing

Use this regex, not `shlex`:

```python
TOKEN = re.compile(r'"((?:[^"]|"")*)"|(\S+)')
```

Real files break `shlex` in two ways:

| Quirk | Real-file pattern | Right tokens |
|---|---|---|
| A literal `"` inside a quoted string is doubled | `SHELLPROP  "Slab 8"" Thick"` | `SHELLPROP`, `Slab 8" Thick` |
| No space after a closing quote | `RELEASE "PINNED"MINNUMSTA 3` | `RELEASE`, `PINNED`, `MINNUMSTA`, `3` |

Value typing:

- Quoted token: string, after replacing `""` with `"`. Stays a string even if it looks numeric (point labels are `"1"`, `"2"`).
- Unquoted token that parses with `float()`: number. Seen forms: `14`, `-5`, `0.6666667`, `4.176E+09`, `1E-09`.
- Any other unquoted token: string. Seen: `SITECLASS D`, `TYPE RIGID`.
- Spacing between tokens varies from 1 to 4 spaces. Never split on columns.

## The key-value rule

After the record keyword, the name, and any positional fields listed below, the rest of a line is `KEY VALUE` pairs, one value per key.

```
LINEASSIGN  "B1"  "L2"  SECTION "W18X35"  MAXSTASPC 2 AUTOMESH "YES"  MESHATINTERSECTIONS "YES"
^keyword    ^label ^story  KEY   VALUE     KEY    VAL  KEY     VALUE   KEY                  VALUE
```

- A definition can span several lines with the same name (a `MATERIAL` has 3 to 6). Merge them into one record.
- A key that repeats inside one merged record becomes a list in file order (`MESHAT "BEAMS"  MESHAT "WALLS"`, material `STRAIN`/`STRESS` curve points).
- Keys are upper case except `Ss` on `SEISMIC` lines. Upper-case every key.

Exceptions to one-value-per-key:

| Record | Pattern on the line | Store as |
|---|---|---|
| `LOADCASE` | `LOADPAT "<pattern>" SF <n>` (one per line) | `LOADPAT: {pattern: n}` |
| `LOADCASE` | `ACCEL "<dir>" FUNC "<function>" SF <n>` | `ACCEL: {dir: {FUNC, SF}}`, and SF carries length units |
| `LOADCASE` | `JOINT "<point>" "<story>"` | `JOINT: [point, story]` |
| `COMBO` | `LOADCASE "<case>" SF <n>` or `LOADCOMBO "<combo>" SF <n>` | `LOADCASE: {case: n}`, `LOADCOMBO: {combo: n}` |
| `SHELLUNIFORMLOADSET` | `LOADPAT "<pattern>" VALUE <n>` | `LOADPAT: {pattern: n}` |
| `AREALOAD` | `TYPE "UNIFLOADSET" "<set>"` | `TYPE: "UNIFLOADSET", SET: "<set>"` |
| `SEISMIC` | `SEISMIC "<pattern>" "<code>" KEY VALUE...` | positional code goes to `CODE` |
| `MASSSOURCELOAD` | `MASSSOURCELOAD "<source>" "<pattern>" <factor>` | `mass_sources[source].LOADS[pattern] = factor` |
| Unnamed records | `ACTIVEDOF "UX UY UZ RX RY RZ"`, `PDELTA  METHOD "NONE"`, `STEELPREFERENCE  CODE "AISC 360-16" ...` | name = the keyword. Odd token count after it means the first token is `VALUE`, then pairs |

## Records, by section

Grammar uses `<L>` for a length, `<F>` for a force, and so on. The full unit table is in [Units](#units).

### Header and controls

```
PROGRAM  "ETABS"  VERSION "20.3.0"
UNITS  "KIP"  "FT"  "F"                       force, length, temperature for every value in the file
PREFERENCE  MERGETOL 0.001                    <L>
```

### Stories

```
$ STORIES - IN SEQUENCE FROM TOP
  STORY "ROOF"  HEIGHT 12                     height to the story below, <L>
  STORY "L3"  HEIGHT 12
  STORY "L2"  HEIGHT 14
  STORY "BASE"  ELEV 0                        last line: the base, absolute elevation <L>
```

Listed top to bottom. Elevations: start at the base `ELEV` and add `HEIGHT`s going up. Here BASE 0, L2 14, L3 26, ROOF 38. Other story keywords (master story, similar to) were not seen. **Unconfirmed**; ignore unknown keys.

### Grids

```
GRIDSYSTEM "G1"  TYPE "CARTESIAN"  BUBBLESIZE 5 TOPSTORY "ROOF"  BOTTOMSTORY "BASE"
GRID "G1"  LABEL "2"  DIR "X"  COORD 25 VISIBLE "Yes"  BUBBLELOC "End"
```

`DIR "X"` means `COORD` is an X value (the line runs parallel to Y). Several grid systems per file is normal. Grids are display only; points carry their own coordinates.

### Definitions

| Record | Grammar |
|---|---|
| `DIAPHRAGM` | `DIAPHRAGM "D1"  TYPE RIGID` (or `SEMIRIGID`, unquoted) |
| `MATERIAL` | `MATERIAL "<m>" TYPE "Steel" GRADE "<g>" WEIGHTPERVOLUME <F/L3>`, then `SYMTYPE "Isotropic" E <F/L2> U <n> A <1/T>`, then `FY FU FYE FUE <F/L2>` or `FC <F/L2>`, then optional `HYSTYPE ...` and `STRAIN <n> STRESS <n>` lines |
| `REBARDEFINITION` | `REBARDEFINITION "#4"  AREA <L2> DIA <L>` |
| `FRAMESECTION` | `FRAMESECTION "<s>" MATERIAL "<m>" SHAPE "<shape>" [FILE "<lib>"] [D <L> B <L>]`, plus optional modifier lines `AMOD A2MOD A3MOD JMOD I2MOD I3MOD MMOD WMOD` |
| `CONCRETESECTION` | rebar layout for a frame section of the same name; covers are `<L>`, bar areas `<L2>` |
| `TENDONSECTION` | `TENDONSECTION "<t>" MATERIAL "<m>" STRANDAREA <L2>` |
| `SHELLPROP` | slabs, decks, and walls all use it. `PROPTYPE "Slab"` with `SLABTHICKNESS <L>`, `PROPTYPE "Wall"` with `WALLTHICKNESS <L>`, `PROPTYPE "Deck"` with deck dimensions. Optional modifier line `F11MOD ... V23MOD` |
| `LINKPROP`, `PANELZONE`, `POINTSPRING` | generic key-value |
| `PIERNAME`, `SPANDRELNAME` | name only |
| `LOADPATTERN` | `LOADPATTERN "DEAD"  TYPE "Dead"  SELFWEIGHT 1` |
| `SEISMIC` | auto lateral load parameters for a pattern, all unitless |
| `MASSSOURCE`, `MASSSOURCELOAD` | mass source flags, then one line per pattern |
| `FUNCTION` | response spectrum or time history; `FILE` points at an external file we don't read |
| `LOADCASE` | first line `TYPE "Linear Static"` etc., then term lines |
| `COMBO` | first line `TYPE "Linear Add"` or `"Envelope"` and optional `NOTES`, then one term per line |
| `*PREFERENCE` | design preferences, unnamed records, generic key-value |

`FILE "<lib>"` appears only on the first section imported from a library, so it's not a real property. The diff ignores it.

### Plan objects (no story)

```
POINT "2"  25 0                              <x> <y> [<dz>], all <L>
LINE  "C1"  COLUMN  "1"  "1"  1              <label> <type> <point i> <point j> <n>
LINE  "B1"  BEAM  "1"  "2"  0
LINE  "D1"  BRACE  "1"  "2"  1
AREA "F1"  FLOOR  4  "1"  "2"  "5"  "4"  0  0  0  0     <label> <type> <k> <k points> <k offsets>
AREA "W1"  PANEL  4  "3"  "6"  "6"  "3"  1  1  0  0
```

Line types seen: `COLUMN`, `BEAM`, `BRACE`. Area types seen: `FLOOR`, `PANEL` (walls), `AREA` (openings and null areas, marked `OPENING "Yes"` in their assign). Floors up to 16 corners were seen.

### Story instances

```
POINTASSIGN  "1"  "BASE"  RESTRAINT "UX UY UZ RX RY RZ"
LINEASSIGN  "B1"  "L2"  SECTION "W18X35"  MAXSTASPC 2 AUTOMESH "YES"  MESHATINTERSECTIONS "YES"
AREAASSIGN  "F1"  "L2"  SECTION "SLAB8"  DIAPH  "D1"  CARDINALPOINT "MIDDLE"
```

Each `*ASSIGN` line places one plan object at one story. Keys seen:

| Record | Keys |
|---|---|
| `POINTASSIGN` | `RESTRAINT` (space-separated DOFs), `DIAPH`, `USERJOINT`, `SPRINGPROP` (not seen, **Unconfirmed**) |
| `LINEASSIGN` | `SECTION`, `ANG` (degrees), `RELEASE`, `CARDINALPT`, `MATERIALOVERWRITE`, `MAXSTASPC <L>`, `MINNUMSTA`, `LIMITTENSION <F>`, `AUTOMESH`, `MESHATINTERSECTIONS` |
| `AREAASSIGN` | `SECTION`, `DIAPH`, `PIER`, `OPENING`, `ANG`, `OBJMESHTYPE`, `MESHAT` (repeats), `MAXMESHSIZE <L>`, `ADDRESTRAINT`, `CARDINALPOINT`, `TRANSFORMSTIFFNESSFOROFFSETS` |

### Object loads

```
POINTLOAD  "6"  "ROOF"  TYPE "FORCE"  LC "SDL"    FZ -5
LINELOAD  "B1"  "L2"  TYPE "UNIFF"  DIR "GRAV"  LC "SDL"  FVAL 0.3
LINELOAD  "B3"  "ROOF"  TYPE "TRAPF"  DIR "GRAV"  LC "SDL"  FSTART 0.2  FEND 0.4  RDSTART 0  RDEND 1
AREALOAD  "F1"  "L2"  TYPE "UNIFF"  DIR "GRAV"  LC "LIVE"  FVAL 0.05
AREALOAD  "F1"  "L2"  TYPE "UNIFLOADSET"  "Office"
```

- `LC` is the load pattern. Several lines per (object, story, pattern) are allowed.
- `DIR` values seen: `GRAV`, `X`, `Y`. Positive `GRAV` reads as downward (typical loads are positive). **Unconfirmed**, but the diff doesn't care about sign meaning.
- `POINTLOAD` only had `TYPE "FORCE"` with `FZ` in real files. `FX FY` and `MX MY MZ` are assumed. **Unconfirmed**.
- `LINELOAD` types seen: `UNIFF`, `TRAPF`. `RDSTART`/`RDEND` are relative distances, unitless. Other types (moments, point loads on frames) not seen. **Unconfirmed**; keep unknown keys as-is.

## Identity

Points, lines, and areas are plan objects: their labels carry no story. An object exists at a story only where an `*ASSIGN` line puts it, so inside one file a frame or area is addressed by `(label, story)`, and that is how the parser wires assigns and loads to objects. One label usually appears at several stories (`C1` at L2, L3, ROOF).

Between two files, labels are not identity. ETABS renumbers and relabels on redraw, so the diff matches objects by their resolved 3D coordinates and treats `label` as an ordinary field. See [contracts/diff-json.md](contracts/diff-json.md#how-objects-are-matched).

Points: a point object `(label, story)` exists for every `POINTASSIGN` line, plus every node a frame or area references. Frame, area, and point labels are separate namespaces.

## Geometry

Stories in elevation order, bottom to top: `BASE, L2, L3, ROOF`. "n stories below S" means n steps down that list.

| Object | From | Coordinates |
|---|---|---|
| Point `(p, S)` | `POINT p x y [dz]` | `(x, y, elev(S) - dz)`, dz defaults to 0 |
| Frame `(L, S)` | `LINE L type pi pj n` | I end = point `pi` at n stories below S. J end = point `pj` at S |
| Area `(L, S)` | `AREA L type k p1..pk o1..ok` | corner m = point `pm` at `om` stories below S |

What that means per type, with the fixture:

| Type | Offsets seen | Shape | Fixture example at L2 |
|---|---|---|---|
| COLUMN | n = 1, `pi == pj` | vertical, story below to S | `C1`: (0,0,0) to (0,0,14) |
| BEAM | n = 0 | horizontal at S | `B1`: (0,0,14) to (25,0,14) |
| BRACE | n = 1 | diagonal, I end one story down | `D1`: (0,0,0) to (25,0,14) |
| FLOOR | all 0 | horizontal polygon at S | `F1`: z = 14 at all four corners |
| PANEL | `1 1 0 0` | wall from story below up to S | `W1`: (50,0,0) (50,30,0) (50,30,14) (50,0,14) |
| AREA | all 0 | horizontal polygon at S | none in the fixture |

**Unconfirmed**:

- `n > 1` (members spanning several stories) and braces with `n = 0` were not seen. Treat `n` as "stories below for the I end" in general. Error with a warning if it runs off the bottom.
- The fourth number on a `POINT` line (`dz`) is a length that scales with the units, and in one real model a stack of wall panels only lines up if it's measured downward from the story. Treat it as an offset below the story.
- Cardinal points, insertion offsets, and rigid end zones shift the drawn member in ETABS. We draw centerlines and ignore them.
- Point coordinates are global. No grid system in the files had an origin or rotation, but points don't reference grids anyway.

## Units

The `UNITS` line sets force, length, and temperature for every value in the file. The parser converts everything to **KIP, FT, F**.

| Force | to KIP | Length | to FT |
|---|---|---|---|
| `LB` | 0.001 | `IN` | 1/12 |
| `KIP` | 1 | `FT` | 1 |
| `N` | 0.000224808943 | `MM` | 1/304.8 |
| `KN` | 0.224808943 | `CM` | 1/30.48 |
| `KGF` | 0.00220462262 | `M` | 1/0.3048 |
| `TONF` | 2.20462262 (metric tonne-force, **Unconfirmed**) | | |

Temperature: `F` or `C`. It only affects the thermal coefficient `A` (and `A1..A3`) on `MATERIAL`: per degree C times 5/9 gives per degree F.

A value with dimension `F^a L^b` converts by `force_factor**a * length_factor**b`.

| Record | Keys | Dimension |
|---|---|---|
| `PREFERENCE` | `MERGETOL` | L |
| `STORY` | `HEIGHT`, `ELEV` | L |
| `GRIDSYSTEM`, `GRID` | `BUBBLESIZE`, `COORD` | L |
| `POINT` | x, y, dz (positional) | L |
| `MATERIAL` | `WEIGHTPERVOLUME` | F/L3 |
| `MATERIAL` | `E E1 E2 E3 G G1 G2 G3 FY FU FYE FUE FC` | F/L2 |
| `REBARDEFINITION` | `AREA` / `DIA` | L2 / L |
| `FRAMESECTION` | `D B` (also `T3 T2 TF TW TFB T2B`, **Unconfirmed**, not seen) | L |
| `CONCRETESECTION` | `COVER COVERTOP COVERBOTTOM CONFINEBARSPACING` | L |
| `CONCRETESECTION` | `LONGBARAREA CONFINEBARAREA ATI ABI ATJ ABJ` | L2 |
| `TENDONSECTION` | `STRANDAREA` | L2 |
| `SHELLPROP` | `SLABTHICKNESS WALLTHICKNESS DECKSLABDEPTH DECKRIBDEPTH DECKRIBWIDTHTOP DECKRIBWIDTHBOTTOM DECKRIBSPACING DECKSHEARTHICKNESS SHEARSTUDDIAM SHEARSTUDHEIGHT` | L |
| `SHELLPROP` | `DECKUNITWEIGHT SHEARSTUDFU` | F/L2 |
| `LINKPROP` | `U1STIFF U2STIFF U3STIFF` | F/L |
| `POINTSPRING` | `UX UY UZ` | F/L |
| `LINEASSIGN` | `MAXSTASPC` / `LIMITTENSION LIMITCOMPRESSION` | L / F |
| `AREAASSIGN` | `MAXMESHSIZE` | L |
| `AUTOMESHOPTIONS` | `FLOORMESHMAXSIZE WALLMESHMAXSIZE` | L |
| `POINTLOAD` | `FX FY FZ` / `MX MY MZ` | F / F·L |
| `LINELOAD` | `FVAL FSTART FEND` | F/L |
| `AREALOAD` | `FVAL` | F/L2 |
| `SHELLUNIFORMLOADSET` | `VALUE` | F/L2 |
| `LOADCASE` | `SF` on an `ACCEL` term / `DISPLMAG` | L / L |

Everything else is unitless: modifiers (`*MOD`), `U`, `ANG`, `RDSTART RDEND`, `LOADPAT` and `COMBO` scale factors, `SELFWEIGHT`, damping, seismic coefficients.

Confirmed by comparing one real model saved in LB-FT and again in LB-IN: every L, F/L, F/L2, F/L3, L2 key above that appeared in both files scaled by the expected factor, and forces (`FZ`, `LIMITTENSION`) did not change. Traps that showed up:

- Response spectrum scale factors carry length. `ACCEL "U1" ... SF 32.17405` in FT is `SF 386.0886` in IN.
- `DECKUNITWEIGHT` is force per area, not per volume.
- Material `STRESS` points only had placeholder values (-1, 0, 1) that didn't scale. **Unconfirmed**; left unitless.
- ETABS prints about 7 significant digits, so converted values are not exact. 0.05 ksf saved in LB-IN is `0.3472222` psi, which converts back to 0.04999999680 ksf. Compare with tolerance, never `==`.

## Version differences seen

- ETABS 20.3 `.e2k` and ETABS 21.0 `.$et` share the same section list and grammar.
- The newer save of the same model changed units, `MERGETOL` (0.1 in both times, written as 0.008333334 ft and then 0.1 in), the base `ELEV`, and several story heights. Every member moved in absolute z, so coordinate matching shows that pair as almost all removed plus added. Story-relative matching is Team 2's first stretch item for exactly this case (see [team-2-diff.md](team-2-diff.md#stretch-in-order)).
- Expect records and keys we haven't seen. Skip unknown records with a warning, keep unknown keys as raw values, never crash.

## Why not a text diff

Two real variants that differ only in one diaphragm assignment give a 15 line raw diff and 15 modified area objects, so text diff is fine there. The same model saved two years apart in a newer ETABS with units changed gives a raw diff on nearly every point and load line, almost all of it noise. Unit normalization removes that noise. What remains is a real restack of the stories, which coordinate matching reports as moved members.
