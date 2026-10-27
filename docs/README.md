# etabs-diff specs

Start here. Read this page, your team spec, and the two contracts. That's about 20 minutes, then build.

## What we're building

Point the tool at two ETABS exports of the same model (`.e2k`, or the `.$et` text copy ETABS writes on save) and it shows what changed:

- a 3D view of the building with every frame and area colored by status: unchanged gray, added green, removed red, modified amber, relabeled blue
- tables of the changes, per object and per field (`SECTION: W18X35 -> W24X55`)
- a table of non-spatial changes: materials, sections, load patterns, load cases, combos, stories

Objects in the two models are matched by their 3D coordinates within a tolerance (default 0.01 ft), never by label, because labels change between saves. A relabeled member in the same spot is a match with a `label` change.

No ETABS API. The `.e2k` holds the whole model definition, so we parse text. It holds no analysis or design results, so a results diff is a stretch item only.

## Pipeline

```
 .e2k / .$et  --[Team 1: e2k_parser]-->  model JSON  --[Team 2: model_diff]-->  diff JSON  --[Team 3: viewer]-->  3D view + tables
 (any units)                             (KIP, FT, F)                            (statuses + field changes)
```

The two JSON files are the contracts. They are frozen at kickoff so all three teams can work at once:

| Contract | Doc | Schema | Example |
|---|---|---|---|
| Model JSON | [contracts/model-json.md](contracts/model-json.md) | [contracts/model.schema.json](contracts/model.schema.json) | [`fixtures/model/base.model.json`](../fixtures/model/base.model.json) |
| Diff JSON | [contracts/diff-json.md](contracts/diff-json.md) | [contracts/diff.schema.json](contracts/diff.schema.json) | [`fixtures/diff/base_vs_revised.diff.json`](../fixtures/diff/base_vs_revised.diff.json) |

Every team starts from the fixtures, not from another team's code. Team 2 diffs `fixtures/model/*.model.json` from minute one. Team 3 renders `fixtures/diff/base_vs_revised.diff.json` from minute one.

## Docs

| Doc | For |
|---|---|
| [team-1-parser.md](team-1-parser.md) | Team 1: e2k text in, model JSON out, units normalized |
| [team-2-diff.md](team-2-diff.md) | Team 2: two model JSONs in, diff JSON out |
| [team-3-viewer.md](team-3-viewer.md) | Team 3: diff JSON in, Streamlit app out |
| [run-plan.md](run-plan.md) | Everyone: hour-by-hour milestones and integration checkpoints |
| [e2k-format.md](e2k-format.md) | Team 1 mostly, everyone for reference: the file format, written from real ETABS files |
| [../fixtures/README.md](../fixtures/README.md) | Everyone: the synthetic test models and their known changes |

## Repo layout

Each team owns one top-level directory, so PRs don't collide.

```
e2k_parser/          Team 1   package + tests (e2k_parser/tests/)
model_diff/          Team 2   package + tests (model_diff/tests/)
viewer/              Team 3   Streamlit app + tests (viewer/tests/)
fixtures/            shared   e2k/ model/ diff/  (change only with a contract change)
docs/                shared   specs and contracts
requirements.txt     Team 3 creates it in their first PR (contents below); others ask before adding a dep
```

Package names are deliberate: `parser` collides with an old stdlib module and `diff` is too generic.

## Stack and how to run

Python 3.11+. Dependencies (this is the whole `requirements.txt`):

```
streamlit
plotly
pandas
pytest
jsonschema
```

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python -m e2k_parser fixtures/e2k/base.e2k -o /tmp/base.model.json          # Team 1 CLI
python -m model_diff fixtures/model/base.model.json fixtures/model/revised.model.json -o /tmp/d.json   # Team 2 CLI
streamlit run viewer/app.py                                                  # Team 3 app
python -m pytest                                                             # all tests
```

The parser and diff engine use only the stdlib (plus `pytest` and `jsonschema` in tests). Plain line parsing, no parser generators.

## Team splits

**Three teams** (recommended, 2 to 3 people each):

| Team | Owns | First deliverable |
|---|---|---|
| 1 Parser | `e2k_parser/` | `parse_file("fixtures/e2k/base.e2k")` equals `fixtures/model/base.model.json` |
| 2 Diff | `model_diff/` | `diff_models(base, revised)` on the fixture models equals `fixtures/diff/base_vs_revised.diff.json` |
| 3 Viewer | `viewer/`, `requirements.txt` | the fixture diff rendered in 3D with the five colors |

**Two teams:**

| Team | Owns |
|---|---|
| A Parser + diff | `e2k_parser/` and `model_diff/`. Split people inside the team along the same line; the fixture model JSONs let the diff person start before the parser works. |
| B Viewer | `viewer/`, `requirements.txt`, and the end-to-end glue |

Checkpoints in [run-plan.md](run-plan.md) are the same either way.

## Ground rules

- Never commit a real project model, a parse of one, or a screenshot of one. Test on real files locally, outside the repo, and check `git status` before you commit.
- Contracts change only with all teams agreeing in the channel, and the change updates the doc, the schema, and the example fixture in one PR.
- Match objects by coordinates, never by label. Compare values by tolerance, never by float equality. See [contracts/diff-json.md](contracts/diff-json.md).
- If something in the format is marked **Unconfirmed**, implement the stated assumption and move on.
