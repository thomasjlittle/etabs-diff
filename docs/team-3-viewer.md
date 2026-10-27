# Team 3: viewer

Render the [diff JSON](contracts/diff-json.md) as a 3D model plus change tables, in Streamlit.

You own `viewer/` and the root `requirements.txt`. Build against `fixtures/diff/base_vs_revised.diff.json` from minute one; you never wait on Teams 1 and 2.

## Inputs and outputs

| In | Out |
|---|---|
| a diff JSON file (default: the fixture), later two uploaded `.e2k`/`.$et` files | Streamlit page: summary, 3D view, change tables, definitions table |

```bash
streamlit run viewer/app.py
```

Dependencies: `streamlit`, `plotly`, `pandas`. Write `requirements.txt` in your first PR with exactly the list in [README.md](README.md#stack-and-how-to-run).

Keep data shaping out of `app.py` so it's testable without Streamlit:

```python
# viewer/figures.py
def build_figure(diff: dict, statuses: set[str], stories: set[str]) -> plotly.graph_objects.Figure: ...
def objects_table(diff: dict) -> pandas.DataFrame: ...       # one row per changed field
def definitions_table(diff: dict) -> pandas.DataFrame: ...
```

## The page

1. **Header**: before and after file names, program versions, and units (`KIP, FT` normalized, plus each file's own units, e.g. "LB-FT -> LB-IN").
2. **Summary**: counts from `summary` as metrics: added, removed, modified, relabeled, definitions changed.
3. **Sidebar filters**: status checkboxes (unchanged off by default is fine), kind (frames, areas, points), story multiselect (from `stories.after`, plus any before-only stories).
4. **3D view**, see below.
5. **Changes table**: one row per object change: kind, before id, after id, status, field, before, after, offset. Added/removed objects get one row with field blank. Filterable by the same sidebar.
6. **Definitions table**: category, name, status, field, before, after.

## 3D view rules

These keep it fast on a real model (thousands of members):

- **One trace per status per kind, never one per member.** Frames: one `go.Scatter3d(mode="lines")` per status, all members concatenated with `None` between segments. Areas: one `go.Mesh3d` per status, polygons fan-triangulated (corner 0 to each pair `i, i+1`). Points: one `Scatter3d(mode="markers")` per status, only for non-unchanged points.
- Colors: unchanged `#9ca3af` (opacity about 0.25 for areas, thin lines), added `#16a34a`, removed `#dc2626`, modified `#f59e0b`, relabeled `#2563eb`.
- Hover text per vertex: `after_id` (or `before_id` when removed), `section`, status, and the first change (`assigns.SECTION: W18X35 -> W24X55`, or `label: C3 -> C30`). Add `moved 0.05 in` when `offset` is above zero.
- `scene.aspectmode = "data"` so the building isn't squashed. Z up.
- Removed objects draw at their before coordinates; that's what `coords` already holds.

Fan triangulation is right for convex floors and walls and slightly wrong for L-shaped floors. Accept it for the hackathon.

## Two-file mode (after checkpoint 2)

Add a second input mode: two file uploaders. On upload, call `e2k_parser.parse_text` on each, then `model_diff.diff_models`, and render the result. Import both lazily inside that code path so the app still runs before those packages exist:

```python
try:
    from e2k_parser import parse_text
    from model_diff import diff_models
except ImportError:
    st.info("Parser or diff engine not merged yet, showing the fixture diff")
```

Show `warnings` from either parse in an expander. Cache with `st.cache_data` keyed on file bytes.

## Acceptance checks

Put these in `viewer/tests/` (pytest, no browser needed):

1. `build_figure(fixture, all statuses, all stories)` returns a figure with at most 15 traces (5 statuses x 3 kinds) and no trace per member.
2. Trace colors match the table above.
3. `objects_table(fixture)` has a row for `B2@L3` with field `assigns.SECTION`, before `W18X35`, after `W24X55`, a row for after id `C30@L2` with field `label`, `C3` to `C30`, and two `B10@L2` rows (one removed, one added).
4. `definitions_table(fixture)` has the `D+L` combo row (`LOADCASE.SDL`, null to 1.0) and the `W24X55` section rows.
5. Story filter `{"L3"}` leaves only L3 objects in the figure.
6. Manual: `streamlit run viewer/app.py` opens on the fixture. The deleted roof brace is red, the new L3 infill beam is green, the resized L3 beam is amber, the grid 3 / A column stack is blue, the L2 floor bay with the bigger live load is amber, the moved L2 infill beam in bay 2-3 shows red at y = 20 and green at y = 22, and the nudged L2 infill beam in bay 1-2 stays gray.

## Edge cases

| Case | Handling |
|---|---|
| a diff with zero changes (the units fixture) | show "No changes" prominently, still draw the model in gray |
| 3,000+ frames | the trace-per-status rule keeps it to 15 traces; don't loop `add_trace` per member |
| values that are lists or dicts (`loads.LIVE`) | render as compact JSON strings in tables |
| `before` or `after` null | show an empty cell, not the string `None` |
| very long `before`/`after` (full `coords` arrays) | truncate in the table, full value in an expander or tooltip |
| areas with 3 corners or 16 corners | fan triangulation handles any count of 3 or more |

## Stretch, in order

1. Click a row in the changes table to highlight that object (an extra trace with thicker lines).
2. "Before / after" toggle that draws the before geometry for modified objects as a dashed ghost.
3. Story-by-story plan view (2D, one story at a time) for dense models.
4. Download buttons for the diff JSON and a CSV of the changes table.
5. Section-change impact: color all members using a changed section.
