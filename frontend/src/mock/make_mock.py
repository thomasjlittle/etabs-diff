"""Write the synthetic Vantage mock file(s). Run from frontend/: python3 -I src/mock/make_mock.py

Geometry (grid, stories, members) is generated. Every change record is written out by hand below so
its numbers can be checked against a sketch of the frame. All data is synthetic. Units: inch, kip.

Frame: 3 grid lines in X (0, 360, 720 in = two 30 ft bays), 2 in Y (0, 360 in), stories every 168 in.
Columns C1..C6 by plan position, beams B01..B07 by plan position; labels repeat per story as in ETABS.

Hand-check list (these are the expected results the tests use):
  C01  Level L5 added at 840 in: 6 columns + 7 beams = 13 members.
  C02  B03 @ L3 j end moved (360,360,504) -> (336,360,504): shift 24.0 in.
  C03  B06 @ L2 removed: 1 member.
  C04  B01 @ L1 renamed B01 -> B01A: label only, same geometry.
  C05  B02 @ L4 end nodes listed in reverse order: same geometry.
  C06  C5 @ L2 section W14X90 -> W14X120: 1 member.
  C07  Material STEEL-COL Fy 50 -> 55 kip/in2: used by the 6 L1 columns.
  Headline: added 1, removed 1, modified 3 (C02, C06, C07), label only 2 (C04, C05).
"""

import json
from pathlib import Path

OUT = Path(__file__).parent
XS = [0, 360, 720]
YS = [0, 360]
STORIES = [("Base", 0), ("L1", 168), ("L2", 336), ("L3", 504), ("L4", 672)]
NEW_LEVEL = ("L5", 840)
GRID = [(x, y) for y in YS for x in XS]  # C1..C6
BEAMS = {
    "B01": ((0, 0), (360, 0)), "B02": ((360, 0), (720, 0)),
    "B03": ((0, 360), (360, 360)), "B04": ((360, 360), (720, 360)),
    "B05": ((0, 0), (0, 360)), "B06": ((360, 0), (360, 360)), "B07": ((720, 0), (720, 360)),
}
MOVED_END = (336, 360, 504)  # new j end of B03 @ L3


def pid(p):
    return "({},{},{})".format(*p)


def node_id(p):
    return "N" + pid(p)


def build_geometry():
    """Return nodes, members and the member ids each change needs."""
    nodes, members, ids = {}, [], {"L5": [], "L1_columns": []}

    def add_node(p, side):
        # a node already present in both files keeps "both"
        if node_id(p) not in nodes:
            nodes[node_id(p)] = {"id": node_id(p), "xyz": list(p), "side": side}

    def add_member(p, q, kind, label, story, side):
        a, b = sorted([p, q])  # canonical end order: by x, then y, then z
        mid = "M" + pid(a) + pid(b)
        members.append({"id": mid, "kind": kind, "end_nodes": [node_id(a), node_id(b)],
                        "label": label, "story": story, "side": side})
        return mid

    levels = STORIES + [NEW_LEVEL]
    for name, z in levels:
        for x, y in GRID:
            add_node((x, y, z), "revised" if name == "L5" else "both")
    add_node(MOVED_END, "revised")

    for (_, z_lo), (name, z_hi) in zip(levels, levels[1:]):
        side = "revised" if name == "L5" else "both"
        for k, (x, y) in enumerate(GRID, 1):
            mid = add_member((x, y, z_lo), (x, y, z_hi), "column", f"C{k}", name, side)
            if name == "L5":
                ids["L5"].append(mid)
            if name == "L1":
                ids["L1_columns"].append(mid)
            if name == "L2" and k == 5:
                ids["C06"] = mid

    for name, z in levels[1:]:
        for label, ((x1, y1), (x2, y2)) in BEAMS.items():
            p, q = (x1, y1, z), (x2, y2, z)
            if (label, name) == ("B03", "L3"):
                ids["C02_before"] = add_member(p, q, "beam", label, name, "baseline")
                ids["C02_after"] = add_member(p, MOVED_END, "beam", label, name, "revised")
            elif (label, name) == ("B06", "L2"):
                ids["C03"] = add_member(p, q, "beam", label, name, "baseline")
            elif (label, name) == ("B01", "L1"):
                ids["C04"] = add_member(p, q, "beam", "B01A", name, "both")  # revised label shown
            else:
                mid = add_member(p, q, "beam", label, name, "revised" if name == "L5" else "both")
                if name == "L5":
                    ids["L5"].append(mid)
                if (label, name) == ("B02", "L4"):
                    ids["C05"] = mid
    return list(nodes.values()), members, ids


def ev(file, first, raw):
    """Evidence block: which file, line range, raw text lines (synthetic .e2k text)."""
    return {"file": file, "lines": [first, first + len(raw) - 1], "raw": raw}


def changes(ids):
    return [
        {"id": "C01", "type": "added", "group": "G1", "member_ids": ids["L5"],
         "extent": {"members": 13, "distance": 0},
         "before": None, "after": {"story": "L5", "elevation": 840},
         "units": {"elevation": "length"},
         "evidence": [ev("revised", 18, ['STORY "L5"  HEIGHT 168  MASTERSTORY "Yes"'])]},
        {"id": "C02", "type": "modified", "group": "G1",
         "member_ids": [ids["C02_before"], ids["C02_after"]],
         "extent": {"members": 1, "distance": 24.0},
         "before": {"end_j": [360, 360, 504]}, "after": {"end_j": [336, 360, 504]},
         "units": {"end_j": "length"},
         "evidence": [ev("baseline", 142, ['POINT "5"  360 360']),
                      ev("revised", 149, ['POINT "38"  336 360'])]},
        {"id": "C03", "type": "removed", "group": "G1", "member_ids": [ids["C03"]],
         "extent": {"members": 1, "distance": 0},
         "before": {"section": "W18X35"}, "after": None,
         "evidence": [ev("baseline", 231, ['LINE  "B06"  BEAM  "2"  "5"  0',
                                           'LINEASSIGN  "B06"  "L2"  SECTION "W18X35"'])]},
        {"id": "C04", "type": "label_only", "group": "LO", "member_ids": [ids["C04"]],
         "extent": {"members": 0, "distance": 0},
         "before": {"label": "B01"}, "after": {"label": "B01A"},
         "evidence": [ev("baseline", 210, ['LINE  "B01"  BEAM  "1"  "2"  0']),
                      ev("revised", 214, ['LINE  "B01A"  BEAM  "1"  "2"  0'])]},
        {"id": "C05", "type": "label_only", "group": "LO", "member_ids": [ids["C05"]],
         "extent": {"members": 0, "distance": 0},
         "before": {"end_order": "i (360,0,672), j (720,0,672)"},
         "after": {"end_order": "i (720,0,672), j (360,0,672)"},
         "evidence": [ev("baseline", 215, ['LINE  "B02"  BEAM  "2"  "3"  0']),
                      ev("revised", 219, ['LINE  "B02"  BEAM  "3"  "2"  0'])]},
        {"id": "C06", "type": "modified", "group": "1A", "member_ids": [ids["C06"]],
         "extent": {"members": 1, "distance": 0},
         "before": {"section": "W14X90"}, "after": {"section": "W14X120"},
         "evidence": [ev("baseline", 268, ['LINEASSIGN  "C5"  "L2"  SECTION "W14X90"']),
                      ev("revised", 272, ['LINEASSIGN  "C5"  "L2"  SECTION "W14X120"'])]},
        {"id": "C07", "type": "modified", "group": "1C", "member_ids": ids["L1_columns"],
         "subject": "Material STEEL-COL",
         "extent": {"members": 6, "distance": 0},
         "before": {"Fy": 50}, "after": {"Fy": 55},
         "units": {"Fy": "kip/in²"},
         "evidence": [ev("baseline", 44, ['MATERIAL  "STEEL-COL"  FY 50  FU 65']),
                      ev("revised", 44, ['MATERIAL  "STEEL-COL"  FY 55  FU 65'])]},
    ]


# Groups from the team planning board, in board order.
GROUPS = [
    ("G1", "Geometry / level changes"),
    ("1A", "Section reassigned"),
    ("1B", "Section definition edited"),
    ("1C", "Material edited"),
    ("1D", "Property modifiers"),
    ("1E", "End releases / end offsets / insertion point / local axis"),
    ("2A", "Supports and springs"),
    ("2B", "Applied loads"),
    ("T3", "Tables only: mass, load patterns, load cases, combos"),
    ("ST", "Walls/slabs, diaphragm assigns, spectrum/time history"),
    ("LO", "Label-only / not physical"),
]

# Record types the (pretend) engine saw. status: compared | seen_not_compared
COVERAGE = [
    ("G1", "Stories", "compared"), ("G1", "Frame members", "compared"), ("G1", "Nodes", "compared"),
    ("1A", "Frame section assignments", "compared"), ("1B", "Frame section definitions", "compared"),
    ("1C", "Materials", "compared"), ("1D", "Property modifiers", "compared"),
    ("1E", "End releases and offsets", "compared"), ("2A", "Point restraints and springs", "compared"),
    ("2B", "Applied loads", "seen_not_compared"),
    ("T3", "Mass source", "seen_not_compared"), ("T3", "Load patterns", "seen_not_compared"),
    ("T3", "Load cases", "seen_not_compared"), ("T3", "Load combinations", "seen_not_compared"),
    ("ST", "Shell objects (walls, slabs)", "seen_not_compared"),
    ("ST", "Diaphragm assigns", "seen_not_compared"),
]


def result():
    nodes, members, ids = build_geometry()
    chg = changes(ids)
    stories = [{"name": n, "elevation": z, "side": "both"} for n, z in STORIES]
    stories.append({"name": NEW_LEVEL[0], "elevation": NEW_LEVEL[1], "side": "revised"})
    return {
        "mock": True,
        "meta": {
            "schema_version": "vantage-0.1",
            "source": {"baseline": "synthetic-frame-rev-A.e2k", "revised": "synthetic-frame-rev-B.e2k"},
            "units": {"length": "in", "force": "kip"},
            "coordinate_system": {"axes": "X east, Y north, Z up", "aligned": True, "offset": [0, 0, 0]},
            "match_tolerance": 0.5,
            "mock": True,
        },
        "stories": stories,
        "nodes": nodes,
        "members": members,
        "changes": chg,
        "groups": [{"id": g, "title": t, "change_ids": [c["id"] for c in chg if c["group"] == g]}
                   for g, t in GROUPS],
        "warnings": {
            "coverage": [{"group": g, "record": r, "status": s} for g, r, s in COVERAGE],
            "ambiguous": [],
            "error": None,
        },
    }


if __name__ == "__main__":
    data = result()
    (OUT / "mock-result.json").write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
    print(f"mock-result.json: {len(data['nodes'])} nodes, {len(data['members'])} members, "
          f"{len(data['changes'])} changes")
