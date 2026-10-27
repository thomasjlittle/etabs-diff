# Team 2: diff engine

Take two [model JSONs](contracts/model-json.md) and produce the [diff JSON](contracts/diff-json.md).

You own `model_diff/`. You never touch `.e2k` text: your inputs are `fixtures/model/base.model.json` and `fixtures/model/revised.model.json` until Team 1's parser lands, then the parser's output.

## Inputs and outputs

| In | Out |
|---|---|
| two model JSON dicts, before and after | diff JSON dict, valid against [diff.schema.json](contracts/diff.schema.json) |

```python
# model_diff/__init__.py
MATCH_TOL = 0.01   # ft, see "Tolerances"
REL_TOL = 1e-5
ABS_TOL = 1e-9

def diff_models(before: dict, after: dict, match_tol: float = MATCH_TOL) -> dict: ...
```

```bash
python -m model_diff before.model.json after.model.json -o out.diff.json [--tol 0.01]   # -o omitted: stdout
```

Stdlib only. Pure function: no IO inside `diff_models`, inputs not mutated.

## The one rule

**Match objects by coordinates, never by label.** Labels and story names are fields you compare and report, like `SECTION`. A label can change on every object between two saves (renumbering, redrawing) and the diff must still pair them.

## Tolerances

| Constant | Default | Used for |
|---|---|---|
| `MATCH_TOL` | 0.01 ft | pairing objects: largest allowed vertex distance |
| `REL_TOL`, `ABS_TOL` | 1e-5, 1e-9 | comparing numeric field values: `math.isclose(a, b, rel_tol=REL_TOL, abs_tol=ABS_TOL)` |

Why 0.01 ft is in [contracts/diff-json.md](contracts/diff-json.md#how-objects-are-matched): just above ETABS's own 0.1 in joint merge tolerance, well above unit-conversion rounding, well below real moves. Copy all three into the output's `tolerances`.

## Matching algorithm

Run per kind (`point`, `frame`, `area`). O(n) with a spatial hash:

1. **Hash the after side.** For each after-object compute its centroid (mean of its `coords`) and put it in a dict keyed by grid cell `tuple(floor(v / match_tol) for v in centroid)`.
2. **For each before-object, in `id` order**, look up the 27 cells around its own centroid's cell. If every vertex moves less than `match_tol`, the centroid does too, so a true match is always in those cells.
3. **Test each candidate** that isn't claimed yet:
   - point: distance between the two positions
   - frame: `min` over the two end orders of `max(dist(before end, after end))`
   - area: same vertex count, then the largest distance from any vertex to the nearest vertex on the other side, checked both ways
   
   A candidate passes when that number is `<= match_tol`. The number is the `offset`.
4. **Pick the best** passing candidate by `(label differs, offset, after id)`, so an exact-label match wins a tie, then the closest, then a stable order. Claim it.
5. **Classify** the pair from its field changes (below): none is `unchanged`, only `label`/`story` is `relabeled`, anything else is `modified`.
6. No candidate: `removed`. After the loop, every unclaimed after-object is `added`.

Greedy one-to-one is enough here: within one model ETABS merges joints closer than its merge tolerance, so real competition for a match only happens with duplicate objects.

### Field comparison for a matched pair

| Field | Compared as | Change path |
|---|---|---|
| `label`, `story`, `type` | strings | `label`, `story`, `type` |
| `assigns` | each key, numbers with `REL_TOL`/`ABS_TOL` | `assigns.<KEY>` |
| `loads` | each pattern's list as a whole, elementwise with tolerance | `loads.<pattern>` |

Don't compare `nodes` (it holds point labels) or `coords` (they matched already).

### Definitions

Definitions have no geometry, so they match by name. For each category in either model, for each name on either side:

- only after: `added`, changes list every field with `before: null`
- only before: `removed`, every field with `after: null`
- both: flatten nested dicts to dotted paths (`LOADCASE.SDL`, `ACCEL.U1.SF`), compare each path with tolerance, emit `modified` if any differ
- skip the `FILE` key everywhere (ETABS writes it only on the first section from a library)

Stories go through the same code: category `stories`, record `{elev, height}` keyed by story name.

## Acceptance checks

Put these in `model_diff/tests/`.

1. `diff_models(base, revised)` on the two fixture models equals `fixtures/diff/base_vs_revised.diff.json`, float tolerance on numbers.
2. Specifically, the known changes from [fixtures/README.md](../fixtures/README.md): `B2@L3` modified (`assigns.SECTION`), `D2@ROOF` removed, `B8@L3` added, `C3` to `C30` relabeled at all three stories, `F2@L2` modified (`loads.LIVE`), combo `D+L` modified (`LOADCASE.SDL` null to 1.0), `B9@L2` unchanged with `offset` 0.004, `B10@L2` both removed and added. Also `W24X55` added under `frame_sections`.
3. `diff_models(base, base)` has every object `unchanged` with `offset` 0.0, and no definitions.
4. **Labels don't matter**: copy `revised`, rename every frame label to `X<n>` (and its `id`). The diff against base has the same `added`/`removed`/`modified` set as test 1; everything else that matched is `relabeled`.
5. **Tolerance edges**: move one beam end in a copy of base by 0.009 ft: matched, `offset` 0.009. By 0.011 ft: removed plus added. With `match_tol=0.02`, the 0.011 move matches.
6. **End order**: swap a frame's two `coords` in a copy of base: still `unchanged`.
7. **Duplicates**: add a second copy of `B1@L2` (new label `B1DUP`, same coords) to the after side: the original pairs with `B1@L2` (same label wins the tie) and `B1DUP@L2` is `added`.
8. **Split**: replace `B1@L2` with two beams from (0,0,14) to (12.5,0,14) and (12.5,0,14) to (25,0,14): one removed, two added.
9. **Units**: multiply every `FVAL` by `(1 + 1e-7)` in a copy of base: all `unchanged`. Multiply one by 1.01: exactly one `modified`.
10. Output validates against `docs/contracts/diff.schema.json`. Summary counts match the `objects` and `definitions` lists. Inputs are unchanged after the call (deep-copy and compare).
11. Once the parser lands: `parse_file(base.e2k)` vs `parse_file(base_lb_in.e2k)` gives an empty diff.

## Edge cases

| Case | Handling |
|---|---|
| member moved beyond `match_tol` | removed plus added. Expected, it's what the tolerance means |
| member split or merged | removed plus added. Stretch item 2 links them |
| overlapping duplicates in one model | paired one-to-one by the ranking; the leftover is added/removed. Stretch: warn about duplicates within one model |
| a column matched to an object on another story | can't happen for frames (z differs by a story height). Points at the same position on different stories can't exist in one model either |
| story renamed | every object on it is `relabeled` with a `story` change. Honest, if noisy |
| story height or base elevation changed | everything above it moves, so it shows removed plus added. A real two-year pair we tested did exactly this. Stretch item 1 fixes it |
| area with vertices in a different start order or direction | the vertex-set test doesn't care about order |
| a definition renamed (section `W18X35` to `B-18`) | removed plus added. Stretch item 3 |
| `assigns` key only on one side | change with `before` or `after` null |
| load lists in a different order but same content | counts as a change. ETABS writes in a stable order, so accept it |
| real models with about 3,000 frames | spatial hash keeps it O(n). Should run in a second or two |

## Stretch, in order

1. **Story-relative matching** behind a flag (`relative_z=True`, CLI `--relative-z`): measure each vertex's z from its node's own story elevation (`z - elev(node story)`, node stories come from `nodes`) before hashing and testing. Then a story height change shows once under `stories` instead of turning every member above it into removed plus added.
2. **Split and merge hints**: for removed frames, look for added frames that are collinear and together cover the same two ends. Add `"split_into": [after_ids]` / `"merged_from": [before_ids]` (needs a small contract change).
3. Definition rename detection: same record, different name.
4. Per-change impact: list the frames that use a changed section so the viewer can highlight them.
5. Results diff (needs a contract change and Team 1's results stretch).
