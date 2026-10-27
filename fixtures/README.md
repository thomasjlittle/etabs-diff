# Fixtures

All synthetic, hand-written from the grammar in [docs/e2k-format.md](../docs/e2k-format.md). No real project data lives in this repo.

## The test building

Two bays in X (grids 1, 2, 3 at 0, 25, 50 ft), one bay in Y (grids A, B at 0, 30 ft), three stories above a base: BASE 0, L2 14, L3 26, ROOF 38 ft.

- Columns `C1` to `C6` at every story (W14X90 at L2 and L3, W14X68 at ROOF)
- Beams `B1` to `B4` along X (W18X35), `B5` to `B7` along Y (W21X44), every story
- Infill beams at L2 only, each on its own two points: `B9` in bay 1-2 at y = 10, `B10` in bay 2-3 at y = 20 (W18X35)
- A chevron on grid A: braces `D1` (grid 1 base up to grid 2) and `D2` (grid 3 base up to grid 2), every story, HSS6X6X3/8
- Floors `F1` (bay 1-2) and `F2` (bay 2-3) at every story, 8 in slab, rigid diaphragm `D1`
- Wall `W1` on grid 3 at L2 only, 12 in, pier `P1`
- Fixed supports at the six base points
- Loads: SDL and LIVE on floors, SDL line loads on `B1` (L2, L3) and a trapezoidal one on `B3` (ROOF), a 5 kip point load at point 6 on ROOF
- Load cases DEAD, SDL, LIVE, Modal, RSX. Combos `1.4D`, `1.2D+1.6L`, `D+L`, `ENV`

## Files

| File | What | Units |
|---|---|---|
| `e2k/base.e2k` | the building above | KIP, FT |
| `e2k/revised.e2k` | base plus the known changes below | KIP, FT |
| `e2k/base_lb_in.e2k` | base re-expressed in LB, IN, CRLF line endings, 7 significant digits like ETABS. Its diff against base must be empty | LB, IN |
| `model/base.model.json` | expected parse of `base.e2k` (and of `base_lb_in.e2k`, within tolerance, apart from `source`) | KIP, FT |
| `model/revised.model.json` | expected parse of `revised.e2k` | KIP, FT |
| `diff/base_vs_revised.diff.json` | expected diff of the two models, default `match` tolerance 0.01 ft | KIP, FT |

`.e2k` files are marked `-text` in `.gitattributes`, so git never rewrites their line endings.

## Known changes in `revised.e2k`

Objects match by coordinates within 0.01 ft, never by label.

| # | Change | e2k edit | Expected in the diff |
|---|---|---|---|
| 1 | resized member | `B2` at L3: W18X35 to W24X55 | `B2@L3` modified, `assigns.SECTION`. Also `frame_sections` / `W24X55` added |
| 2 | deleted member | brace `D2` at ROOF: its `LINEASSIGN` line removed | `D2@ROOF` removed |
| 3 | added member | new infill beam `B8` at L3 from new point 7 (12.5, 0) to new point 8 (12.5, 30) | `B8@L3` added, points `7@L3` and `8@L3` added |
| 4 | relabeled member, same location | column `C3` renamed `C30` (all three stories) | three frames relabeled, `before_id` `C3@<story>`, `after_id` `C30@<story>`, one `label` change each |
| 5 | changed load | `F2` at L2, LIVE 0.05 to 0.125 ksf | `F2@L2` modified, `loads.LIVE` |
| 6 | changed combo | `D+L` gains `LOADCASE "SDL" SF 1` | `combos` / `D+L` modified, `LOADCASE.SDL` null to 1.0 |
| 7 | member moved within tolerance | points 9 and 10 (ends of `B9`) moved from y = 10 to y = 10.004 (about 0.05 in) | `B9@L2` unchanged with `offset` 0.004; points `9@L2`, `10@L2` unchanged with `offset` 0.004 |
| 8 | member moved beyond tolerance | points 11 and 12 (ends of `B10`) moved from y = 20 to y = 22 | `B10@L2` removed and `B10@L2` added, same label on both: the label doesn't save it. Points `11@L2`, `12@L2` removed and added |

Totals: points 26 unchanged, 4 added, 2 removed. Frames 41 unchanged, 2 added, 2 removed, 1 modified, 3 relabeled. Areas 6 unchanged, 1 modified. Definitions 1 added, 1 modified.

## Adding fixtures

Keep them small and synthetic. If you add a known change, regenerate the expected JSON, update this table, and get a thumbs up from the other teams at a checkpoint. Never derive a fixture from a real model.
