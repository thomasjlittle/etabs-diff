# Team 1: parser + units

Turn an `.e2k` or `.$et` file into the [model JSON](contracts/model-json.md), with every value converted to KIP, FT, F.

You own `e2k_parser/`. Read [e2k-format.md](e2k-format.md) first; it has the grammar, the tokenizer regex, the geometry rules, and the unit table.

## Inputs and outputs

| In | Out |
|---|---|
| a path, or the text of an upload | model JSON dict, valid against [model.schema.json](contracts/model.schema.json) |

```python
# e2k_parser/__init__.py
def parse_file(path: str | os.PathLike) -> dict: ...
def parse_text(text: str, source_name: str = "<text>") -> dict: ...
```

CLI, so Team 2 and 3 can run you without importing:

```bash
python -m e2k_parser fixtures/e2k/base.e2k -o out.model.json     # -o omitted: print to stdout
```

Stdlib only. Suggested shape, not a requirement: one pass that tokenizes each line and files it by record keyword into plain dicts, then a `build()` step that resolves stories, points, and geometry.

## Build order

1. **Tokenizer** with the regex from the format doc. Unit-test the two quirks (doubled quotes, no space after a closing quote) before anything else.
2. **Stories, points, frames, areas** with coordinates. This alone gets Team 3 a real 3D view.
3. **Unit conversion** from the `UNITS` line and the unit table. Do it at parse time, per key, so nothing downstream ever sees file units.
4. **Assigns and object loads.**
5. **Definitions** with the generic key-value rule plus the listed exceptions (load case and combo terms first, they're what users check).
6. **CLI** and warnings.

## Acceptance checks

Put these in `e2k_parser/tests/`. Compare floats with `math.isclose(rel_tol=1e-5, abs_tol=1e-9)`, not `==`.

1. `parse_file("fixtures/e2k/base.e2k")` equals `fixtures/model/base.model.json` (deep compare with float tolerance).
2. Same for `revised.e2k` against `fixtures/model/revised.model.json`.
3. `parse_file("fixtures/e2k/base_lb_in.e2k")` equals `base.model.json` except `source.file` and `source.file_units`. This is the unit test that matters: that file is the base model in LB-IN with CRLF line endings.
4. All three outputs validate against `docs/contracts/model.schema.json` with `jsonschema`.
5. Geometry spot checks on base: `C1@L2` runs (0,0,0) to (0,0,14). `D1@L3` runs (0,0,14) to (25,0,26). `W1@L2` has corners at z = 0, 0, 14, 14. `ROOF` elev is 38.
6. Tokenizer: `RELEASE "PINNED"MINNUMSTA 3` gives four tokens, `"Slab 8"" Thick"` gives `Slab 8" Thick`.
7. Output contains nothing from `LOG`, `PROJECT INFORMATION`, `TITLE1`, `TITLE2` (grep the JSON for `Synthetic Test Co`).
8. A real model parses locally without an exception and with a short `warnings` list. Do this outside the repo and never commit the file or its output.

## Edge cases

| Case | Handling |
|---|---|
| CRLF line endings | strip `\r`; `base_lb_in.e2k` is CRLF on purpose |
| trailing spaces, 1 to 4 spaces between tokens | regex tokenizer handles it |
| quoted values that look numeric (`"1"`) | stay strings |
| unquoted words as values (`SITECLASS D`, `TYPE RIGID`) | strings |
| definitions spread over several lines | merge by name; repeated keys become lists |
| `POINT` line with a fourth number | it's `dz`, subtract from the story elevation (**Unconfirmed**, see format doc) |
| a frame or area offset that runs below the base story | raise `ValueError` naming the object |
| `*ASSIGN` for a label with no `LINE`/`AREA` line | warning, skip the object |
| unknown record keyword or section | warning, skip, keep going |
| unknown key on a known record | keep it raw, no unit conversion |
| sections missing entirely (`GROUPS`, `FUNCTIONS`) | normal, produce empty categories |
| file has no `UNITS` line | `ValueError`; guessing units would make every diff wrong |
| `latin-1` bytes in names | read as `latin-1`, never crash on decode |
| big models (3,000 frames, 12,000 lines) | one pass, dict lookups; should parse in well under a second |

## Out of scope

The ETABS API, `.EDB` binary files, analysis results, and anything in `LOG`.

## Stretch, in order

1. `groups`: `GROUP "<name>"` header lines, then member lines `GROUP "<name>"  LINE "<label>"  "<story>"` (also `POINT` and `AREA`). Store `groups[name] = {"members": [[kind, label, story], ...]}`.
2. Point `SPRINGPROP` and other point assign keys from real models.
3. A `--pretty` CLI flag and a one-line summary on stderr (counts per object kind).
4. Results stretch, coordinated with Team 2: parse an ETABS exported table (CSV or Excel export of, say, story drifts) into a `results` block. Needs a contract change first.
