# Hackathon run plan (6 hours)

Times are from kickoff. Each checkpoint is a 10 minute stand-up where the teams' pieces get joined. If a piece isn't ready, the others keep using the fixtures and nobody waits.

| Time | Team 1 parser | Team 2 diff | Team 3 viewer |
|---|---|---|---|
| 0:00 to 0:20 | read README, your spec, both contracts, e2k-format | same | same |
| 0:20 | branch off `main`, create `e2k_parser/` | create `model_diff/` | create `viewer/`, `requirements.txt` |
| by 1:00 | tokenizer + stories + points + frame coords | coordinate matching (spatial hash), unchanged/added/removed on the fixture models | fixture diff in 3D, one trace per status |
| **1:00 checkpoint 1** | show `C1@L2` and `D1@L3` coordinates | show the summary counts | show the colored model |
| 1:00 to 2:30 | areas, assigns, loads, unit conversion | field changes, relabeled vs modified, definitions | changes table, definitions table, filters |
| **2:30 checkpoint 2: first join** | `base.e2k` and `revised.e2k` parse to the fixture models (tolerance compare passes) | run your CLI on Team 1's output, get the fixture diff | render Team 2's CLI output instead of the fixture |
| 2:30 to 4:00 | definitions, `base_lb_in.e2k` matches `base` | tolerance, end-order, duplicate, and split tests, stories diff | two-file upload mode wired to both packages |
| **4:00 checkpoint 3: end to end** | | | upload `base.e2k` + `revised.e2k` in the app, see the known changes from `fixtures/README.md`. Upload `base.e2k` + `base_lb_in.e2k`, see "No changes" |
| 4:00 to 5:00 | run on a real model locally, fix crashes | same, check runtime on a real pair | same, check render speed on a real pair |
| **5:00 feature freeze** | merge to `main`, bug fixes only after this | | |
| 5:00 to 5:30 | stretch items only if `main` is green | | |
| 5:30 to 6:00 | demo prep: the fixture pair, then a real pair from a laptop (never committed) | | |

## Two-team version

Team A (parser + diff) runs the Team 1 and Team 2 columns with people split inside the team. Team B runs the Team 3 column and owns the 4:00 end-to-end join. Same checkpoints.

## Merging

- Each team merges its own PRs into `main`. PRs touch only your own directory, so conflicts should be rare.
- `fixtures/` and `docs/contracts/` change only by agreement at a checkpoint, in one PR that updates doc, schema, and fixtures together.
- `main` must pass `python -m pytest` after every merge from checkpoint 2 on.

## Demo script

1. Open the app on the fixture pair. Walk the five colors and the known changes, including the beam nudged inside tolerance (still gray) and the one moved past it (red plus green).
2. Show the units file: different units in, "No changes" out.
3. Open a real model pair locally, such as two variants that differ in a diaphragm assignment. Show the change counts and the amber floors.
4. One line on what's next: story-relative matching, split/merge hints, results diff via exported tables.
