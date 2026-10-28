"""Seeded synthetic demo pair: a made-up 7-story steel building, before and after a revision.

Run from the repo root:
    python fixtures/demo/generate.py
    PYTHONPATH=backend python -m diff_engine fixtures/demo/before.e2k fixtures/demo/after.e2k -o fixtures/demo/diff.json --csv fixtures/demo/changes.csv

Writes before.e2k, after.e2k and seeded-changes.json next to this file. Each seeded change lists the
elements the engine should report for it (B's label, A's for removed) and the definition table edits.
`renames` lists the label-only changes (the relabeled grid line and the within-tolerance nudge).
Everything else must come out unchanged. backend/diff_engine/tests/test_demo_pair.py holds the engine to exactly that list.
"""

import copy
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

HERE = Path(__file__).resolve().parent

Demo = Dict[str, Any]  # the synthetic model: parser-shaped tables keyed like the e2k sections
Props = Dict[str, Any]
Key = Tuple[str, str]  # (label, story)

# Units are kip, in. Grid: 4 bays of 30 ft in X, 3 bays of 25 ft in Y.
XS = [0, 360, 720, 1080, 1440]
YS = [0, 300, 600, 900]
STORIES = [("Base", None), ("L2", 180), ("L3", 156), ("L4", 156), ("L5", 156), ("L6", 156), ("L7", 156), ("Roof", 156)]
FLOORS = [name for name, _ in STORIES[1:]]
PSF, PLF, PCF = 1 / 144000, 1 / 12000, 1 / 1728000  # to kip/in2, kip/in, kip/in3
PINNED = "M2I M3I M2J M3J"
MESH = {"MINNUMSTA": 3, "AUTOMESH": "YES", "MESHATINTERSECTIONS": "YES"}

MATERIALS: Dict[str, List[Props]] = {
    "A992Fy50": [
        {"TYPE": "Steel", "WEIGHTPERVOLUME": 490 * PCF},
        {"SYMTYPE": "Isotropic", "E": 29000, "U": 0.3, "A": 6.5e-06},
        {"FY": 50, "FU": 65, "FYE": 55, "FUE": 71.5},
    ],
    "A572Gr50": [
        {"TYPE": "Steel", "WEIGHTPERVOLUME": 490 * PCF},
        {"SYMTYPE": "Isotropic", "E": 29000, "U": 0.3, "A": 6.5e-06},
        {"FY": 50, "FU": 65, "FYE": 55, "FUE": 71.5},
    ],
    "A500GrC": [
        {"TYPE": "Steel", "WEIGHTPERVOLUME": 490 * PCF},
        {"SYMTYPE": "Isotropic", "E": 29000, "U": 0.3, "A": 6.5e-06},
        {"FY": 50, "FU": 62, "FYE": 55, "FUE": 68.2},
    ],
    "4000Psi": [
        {"TYPE": "Concrete", "WEIGHTPERVOLUME": 150 * PCF},
        {"SYMTYPE": "Isotropic", "E": 3604.997, "U": 0.2, "A": 5.5e-06},
        {"FC": 4},
    ],
    "LW3000": [
        {"TYPE": "Concrete", "WEIGHTPERVOLUME": 110 * PCF},
        {"SYMTYPE": "Isotropic", "E": 2155.825, "U": 0.2, "A": 5.5e-06},
        {"FC": 3, "LWCONC": "Yes", "SFACTOR": 0.75},
    ],
}
LIBRARY: Dict[str, str] = {"W14X132": "A992Fy50", "W14X120": "A992Fy50", "W14X90": "A992Fy50", "W14X61": "A992Fy50",
           "W24X55": "A992Fy50", "W18X35": "A992Fy50", "W16X26": "A992Fy50", "W12X26": "A992Fy50",
           "HSS6X6X3/8": "A500GrC"}
FRAME_SECTIONS: Dict[str, List[Props]] = {
    **{name: [{"MATERIAL": mat, "SHAPE": name, "FILE": "AISC16"}] for name, mat in LIBRARY.items()},
    "BOX16": [{"MATERIAL": "A992Fy50", "SHAPE": "Steel Tube", "D": 16, "B": 16, "TF": 0.75, "TW": 0.75}],
    "GIRDER-USER": [{"MATERIAL": "A992Fy50", "SHAPE": "Steel I/Wide Flange", "D": 27, "B": 10, "TF": 1, "TW": 0.5}],
}
FRAME_SECTIONS["W12X26"].append(
    {"AMOD": 1, "A2MOD": 1, "A3MOD": 1, "JMOD": 1, "I2MOD": 1, "I3MOD": 1, "MMOD": 1, "WMOD": 1}
)
SHELL_PROPS: Dict[str, List[Props]] = {
    "Slab6": [{"PROPTYPE": "Slab", "MATERIAL": "4000Psi", "MODELINGTYPE": "Membrane", "SLABTYPE": "Slab",
               "SLABTHICKNESS": 6}],
    "RoofSlab": [{"PROPTYPE": "Slab", "MATERIAL": "LW3000", "MODELINGTYPE": "Membrane", "SLABTYPE": "Slab",
                  "SLABTHICKNESS": 5.25}],
    "Wall12": [{"PROPTYPE": "Wall", "MATERIAL": "4000Psi", "MODELINGTYPE": "ShellThin", "WALLTHICKNESS": 12}],
}
DIAPHRAGMS = {"D1": "RIGID", "D2": "SEMIRIGID"}
POINT_SPRINGS: Dict[str, List[Props]] = {"Pad": [{"STIFFNESSOPTION": "USERDEFINED", "UX": 200, "UY": 200, "UZ": 500}]}
# Auto lateral inputs, written after their LOADPATTERN line.
SEISMIC: Props = {"DIR": "X", "ECC": 0.05, "TOPSTORY": "Roof", "BOTTOMSTORY": "Base", "R": 6, "OMEGA": 2.5, "CD": 5, "I": 1,
           "SS": 1.2, "S1": 0.5, "SITECLASS": "D"}
WIND: Props = {"EXPOSUREFROM": "DIAPHRAGMS", "WINDWARDCP": 0.8, "LEEWARDCP": 0.5, "TOPSTORY": "Roof", "BOTTOMSTORY": "Base",
        "VB": 115}
# User response spectrum (period, Sa/g pairs) and a ramp time history.
FUNCTIONS: Dict[str, List[Props]] = {
    "DemoRS": [{"FUNCTYPE": "SPECTRUM", "DAMPRATIO": 0.05, "SPECTYPE": "USER"},
               {"TIMEVAL": "0  0.4  0.2  1  0.6  1  1  0.6  2  0.3"}],
    "Ramp": [{"FUNCTYPE": "HISTORY", "HISTTYPE": "USER"}, {"TIMEVAL": "0  0  1  1  4  1"}],
}
# Response spectrum cases: direction, function, scale factor (g in inches).
SPECTRUM_CASES: Dict[str, Tuple[str, str, float]] = {"RSX": ("U1", "DemoRS", 386.09)}
# Linear static cases: pattern -> scale factor. Live double counts Lr until the seeded fix.
LOAD_CASES: Dict[str, Dict[str, float]] = {"Dead": {"Dead": 1, "SDL": 1}, "Live": {"Live": 1, "Lr": 1}, "Lr": {"Lr": 1}}
# Combos: (type, [(LOADCASE or LOADCOMBO, name, factor)]). 1.2D+1.6L+0.5Lr is missing its Lr term until seeded.
COMBOS: Dict[str, Tuple[str, List[Tuple[str, str, float]]]] = {
    "1.4D": ("Linear Add", [("LOADCASE", "Dead", 1.4)]),
    "1.2D+1.6L+0.5Lr": ("Linear Add", [("LOADCASE", "Dead", 1.2), ("LOADCASE", "Live", 1.6)]),
    "Gravity": ("Envelope", [("LOADCOMBO", "1.4D", 1), ("LOADCOMBO", "1.2D+1.6L+0.5Lr", 1)]),
}
MASS_SOURCE: Dict[str, float] = {"Dead": 1, "SDL": 1}  # pattern -> factor, for MsSrc1


def pid(i: int, j: int) -> str:
    """Grid point label at XS[i], YS[j]."""
    return str(j * len(XS) + i + 1)


def mid(i: int, j: int) -> str:
    """Infill beam end at the middle of X bay i, on grid YS[j]."""
    return str(21 + j * (len(XS) - 1) + i)


def base_model() -> Demo:
    m: Demo = {
        "stories": list(STORIES),
        "points": {}, "lines": {}, "areas": {},
        "point_assigns": {}, "line_assigns": {}, "area_assigns": {},
        "point_loads": {}, "line_loads": {}, "area_loads": {},
        "materials": copy.deepcopy(MATERIALS),
        "frame_sections": copy.deepcopy(FRAME_SECTIONS),
        "shell_props": copy.deepcopy(SHELL_PROPS),
        "load_cases": copy.deepcopy(LOAD_CASES),
        "combos": copy.deepcopy(COMBOS),
        "mass_source": dict(MASS_SOURCE),
        "diaphragms": dict(DIAPHRAGMS),
        "point_springs": copy.deepcopy(POINT_SPRINGS),
        "functions": copy.deepcopy(FUNCTIONS),
        "seismic": dict(SEISMIC),
        "wind": dict(WIND),
        "spectrum_cases": dict(SPECTRUM_CASES),
        "pdelta": "NONE",
    }
    for j, y in enumerate(YS):
        for i, x in enumerate(XS):
            m["points"][pid(i, j)] = (x, y)
    for j, y in enumerate(YS):
        for i in range(len(XS) - 1):
            m["points"][mid(i, j)] = (XS[i] + 180, y)

    corner = {pid(0, 0), pid(4, 0), pid(0, 3), pid(4, 3)}
    for p in [pid(i, j) for j in range(len(YS)) for i in range(len(XS))]:
        label = f"C{p}"
        m["lines"][label] = ("COLUMN", p, p, 1)
        edge = m["points"][p][0] in (XS[0], XS[-1])
        for s in FLOORS:
            if s in ("L2", "L3"):
                sec = "BOX16" if p in corner else "W14X120"
            else:
                sec = "W14X90" if s in ("L4", "L5") else "W14X61"
            m["line_assigns"][(label, s)] = {"SECTION": sec, **({"ANG": 90} if edge else {}), **MESH}

    n = 0
    for j in range(len(YS)):  # girders along X
        for i in range(len(XS) - 1):
            n += 1
            m["lines"][f"B{n}"] = ("BEAM", pid(i, j), pid(i + 1, j), 0)
            perimeter = j in (0, len(YS) - 1)
            for s in FLOORS:
                sec = "GIRDER-USER" if s == "L2" and j == 0 else "W24X55"
                props = {"SECTION": sec, **({} if perimeter else {"RELEASE": PINNED}), "CARDINALPT": 8, **MESH}
                m["line_assigns"][(f"B{n}", s)] = props
                if perimeter and s != "Roof":
                    m["line_loads"][(f"B{n}", s)] = [cladding()]
    for i in range(len(XS)):  # beams along Y
        for j in range(len(YS) - 1):
            n += 1
            m["lines"][f"B{n}"] = ("BEAM", pid(i, j), pid(i, j + 1), 0)
            for s in FLOORS:
                m["line_assigns"][(f"B{n}", s)] = {"SECTION": "W18X35", "RELEASE": PINNED, "CARDINALPT": 8, **MESH}
                if i in (0, len(XS) - 1) and s != "Roof":
                    m["line_loads"][(f"B{n}", s)] = [cladding()]
    for i in range(len(XS) - 1):  # infill beams along Y, mid bay
        for j in range(len(YS) - 1):
            n += 1
            m["lines"][f"B{n}"] = ("BEAM", mid(i, j), mid(i, j + 1), 0)
            for s in FLOORS:
                sec = "W12X26" if s == "Roof" else "W16X26"
                m["line_assigns"][(f"B{n}", s)] = {"SECTION": sec, "RELEASE": PINNED, "CARDINALPT": 8, **MESH}

    # Zipper braces: two diagonals per braced bay, alternating story to story.
    bays = [(pid(1, 0), pid(2, 0)), (pid(2, 3), pid(3, 3)), (pid(0, 1), pid(0, 2)), (pid(4, 1), pid(4, 2))]
    for k, (p, q) in enumerate(bays):
        m["lines"][f"D{2 * k + 1}"] = ("BRACE", p, q, 1)
        m["lines"][f"D{2 * k + 2}"] = ("BRACE", q, p, 1)
        for f, s in enumerate(FLOORS):
            m["line_assigns"][(f"D{2 * k + 1 + f % 2}", s)] = {"SECTION": "HSS6X6X3/8", "RELEASE": PINNED, **MESH}

    n = 0
    for j in range(len(YS) - 1):
        for i in range(len(XS) - 1):
            n += 1
            m["areas"][f"F{n}"] = ("FLOOR", [pid(i, j), pid(i + 1, j), pid(i + 1, j + 1), pid(i, j + 1)], [0] * 4)
            for s in FLOORS:
                roof = s == "Roof"
                m["area_assigns"][(f"F{n}", s)] = {"SECTION": "RoofSlab" if roof else "Slab6", "DIAPH": "D1",
                                                  "OBJMESHTYPE": "DEFAULT"}
                live = ("Lr", 20) if roof else ("Live", 50)
                m["area_loads"][(f"F{n}", s)] = [area_load("SDL", 15), area_load(*live)]

    for j in range(len(YS)):
        for i in range(len(XS)):
            m["point_assigns"][(pid(i, j), "Base")] = {"RESTRAINT": "UX UY UZ"}
    m["point_assigns"][(pid(2, 0), "Base")] = {"SPRINGPROP": "Pad"}  # on a bearing pad, not pinned
    m["point_loads"][(pid(2, 1), "Roof")] = [rtu(-12)]
    m["point_loads"][(pid(2, 2), "Roof")] = [rtu(-8)]
    return m


def cladding(plf: float = 400) -> Props:
    return {"TYPE": "UNIFF", "DIR": "GRAV", "LC": "SDL", "FVAL": plf * PLF}


def area_load(pattern: str, psf: float) -> Props:
    return {"TYPE": "UNIFF", "DIR": "GRAV", "LC": pattern, "FVAL": psf * PSF}


def rtu(fz: float) -> Props:
    return {"TYPE": "FORCE", "LC": "SDL", "FX": 0, "FY": 0, "FZ": fz, "MX": 0, "MY": 0, "MZ": 0}


def frame_at(m: Demo, kind: str, p: str, q: str) -> str:
    """Line label of the given type joining grid points p and q (either order)."""
    return next(k for k, (t, i, j, _) in m["lines"].items() if t == kind and {i, j} == {p, q})


def area_at(m: Demo, i: int, j: int) -> str:
    return next(k for k, (_, pts, _) in m["areas"].items() if pts[0] == pid(i, j))


def users(m: Demo, table: str, name: str) -> List[Key]:
    """(label, story) of every frame or area assign whose SECTION is `name`."""
    assigns = m["line_assigns"] if table == "frame" else m["area_assigns"]
    return [key for key, props in assigns.items() if props.get("SECTION") == name]


def element(status: str, label: str, story: str, fields: Iterable[str] = (), moved: bool = False) -> Props:
    return {"status": status, "label": label, "story": story, "fields": sorted(fields), "moved": moved}


def reroute(m: Demo, label: str, story: str, new_label: str, dx: float) -> List[Tuple[str, str]]:
    """Move one story's copy of a beam by dx in X onto new points, the way ETABS does: a new line object.

    Returns (old, new) for each end point nothing else at that story uses any more, which the engine
    reports as a point rename."""
    _, i, j, n = m["lines"][label]
    ends: List[str] = []
    for p in (i, j):
        x, y = m["points"][p]
        ends.append(str(max(int(k) for k in m["points"]) + 1))
        m["points"][ends[-1]] = (x + dx, y)
    m["lines"][new_label] = ("BEAM", ends[0], ends[1], n)
    m["line_assigns"][(new_label, story)] = m["line_assigns"].pop((label, story))
    used = {p for (k, s) in m["line_assigns"] if s == story and k != new_label for p in m["lines"][k][1:3]}
    return [(old, new) for old, new in zip((i, j), ends) if old not in used]


def seed(before: Demo) -> Tuple[Demo, List[Props], List[str], List[Props]]:
    """Apply the seeded changes. Returns (after, changes, no-change controls, renames).

    Each change carries `row`, the line of the change list (1 to 17) it demonstrates. Row 10 (additional
    mass) has no seed: no ETABS export we could find writes a mass assign, so its keyword is unknown.
    """
    m = copy.deepcopy(before)
    changes: List[Props] = []
    controls: List[str] = []

    def add(row: int, what: str, elements: Iterable[Props] = (), tables: Optional[Props] = None) -> None:
        changes.append({"row": row, "what": what, "elements": list(elements), "tables": tables or {}})

    # 1: geometry
    b = frame_at(m, "BEAM", pid(2, 1), pid(2, 2))
    del m["line_assigns"][(b, "L5")]
    add(1, f"Interior beam {b} removed at L5", [element("removed", b, "L5")])

    m["lines"]["D9"] = ("BRACE", pid(3, 0), pid(4, 0), 1)
    m["line_assigns"][("D9", "L2")] = {"SECTION": "HSS6X6X3/8", "RELEASE": PINNED, **MESH}
    add(1, "Brace D9 added at L2 in a new bay on grid Y=0", [element("added", "D9", "L2")])

    b = frame_at(m, "BEAM", mid(1, 1), mid(1, 2))
    reroute(m, b, "L4", "B44", 24)
    add(1, f"Infill beam {b} at L4 moved 24 in along X (redrawn as B44)",
        [element("removed", b, "L4", moved=True), element("added", "B44", "L4", moved=True)])

    names = [name for name, _ in m["stories"]]
    m["stories"][names.index("L4")] = ("L4", 168)
    above = names[names.index("L4") + 1:]
    add(1, "L4 story height 156 in to 168 in. Shows once per story in the stories table, no element changes",
        tables={"stories": {"L4": ["elevation", "height"], **{s: ["elevation"] for s in above}}})

    # 2 (1A): section reassigned
    c = f"C{pid(1, 1)}"
    m["line_assigns"][(c, "L3")]["SECTION"] = "W14X132"
    add(2, f"Column {c} at L3 reassigned W14X120 to W14X132", [element("modified", c, "L3", ["SECTION"])])

    # 3 (1B): section definition
    m["frame_sections"]["BOX16"][0].update(TF=1.0, TW=1.0)
    fields = ["frameSection:BOX16.TF", "frameSection:BOX16.TW"]
    add(3, "User section BOX16 walls 0.75 in to 1 in (corner columns L2, L3)",
        [element("affected", lb, s, fields) for lb, s in users(m, "frame", "BOX16")],
        {"frameSections": {"BOX16": ["TF", "TW"]}})

    m["frame_sections"]["GIRDER-USER"][0]["MATERIAL"] = "A572Gr50"
    add(3, "User section GIRDER-USER material A992Fy50 to A572Gr50 (L2 girders on grid Y=0)",
        [element("affected", lb, s, ["frameSection:GIRDER-USER.MATERIAL"]) for lb, s in users(m, "frame", "GIRDER-USER")],
        {"frameSections": {"GIRDER-USER": ["MATERIAL"]}})

    # 4 (1C): material
    m["materials"]["LW3000"][0]["WEIGHTPERVOLUME"] = 115 * PCF
    m["materials"]["LW3000"][2]["FC"] = 4
    fields = ["material:LW3000.FC", "material:LW3000.WEIGHTPERVOLUME"]
    add(4, "Material LW3000 f'c 3 to 4 ksi and unit weight 110 to 115 pcf (roof slab)",
        [element("affected", lb, s, fields) for lb, s in users(m, "area", "RoofSlab")],
        {"materials": {"LW3000": ["FC", "WEIGHTPERVOLUME"]}})

    # 5 (1D): property modifiers, on a section and on one member
    m["frame_sections"]["W12X26"][1]["I3MOD"] = 1.4
    add(5, "Section W12X26 I3 modifier 1 to 1.4 (roof infill beams)",
        [element("affected", lb, s, ["frameSection:W12X26.I3MOD"]) for lb, s in users(m, "frame", "W12X26")],
        {"frameSections": {"W12X26": ["I3MOD"]}})

    c = f"C{pid(2, 1)}"
    m["line_assigns"][(c, "L2")].update(PROPMODI22=0.7, PROPMODI33=0.7)
    add(5, f"Column {c} at L2 gets member modifiers I22 and I33 of 0.7 (cracked section)",
        [element("modified", c, "L2", ["PROPMODI22", "PROPMODI33"])])

    # 6 (1E): releases, insertion point, local axis
    b = frame_at(m, "BEAM", pid(3, 1), pid(3, 2))
    del m["line_assigns"][(b, "L6")]["RELEASE"]
    add(6, f"Beam {b} at L6 end releases removed (now a moment connection)",
        [element("modified", b, "L6", ["RELEASE"])])

    b = frame_at(m, "BEAM", pid(1, 1), pid(2, 1))
    m["line_assigns"][(b, "L3")]["CARDINALPT"] = 2
    add(6, f"Girder {b} at L3 insertion point 8 (top center) to 2 (bottom center)",
        [element("modified", b, "L3", ["CARDINALPT"])])

    c = f"C{pid(2, 2)}"
    m["line_assigns"][(c, "L6")] = {"SECTION": "W14X61", "ANG": 90, **MESH}
    add(6, f"Column {c} at L6 rotated 90 degrees (local axis, 0 to 90)", [element("modified", c, "L6", ["ANG"])])

    c = f"C{pid(1, 1)}"
    m["line_assigns"][(c, "L7")]["ANG"] = 360
    controls.append(f"Column {c} at L7 local axis written as 360 degrees, same as no angle")

    # 7 (nodes): a bare joint gets a node-level assign, so it is listed only because that changed
    p = mid(0, 1)
    m["point_assigns"][(p, "L3")] = {"DIAPH": "D1"}
    add(7, f"Bare joint {p} at L3 (infill beam end) assigned to diaphragm D1",
        [element("modified", p, "L3", ["DIAPH"])])

    # 8 (2A): supports and springs
    p = pid(4, 3)
    m["point_assigns"][(p, "Base")]["RESTRAINT"] = "UX UY UZ RX RY RZ"
    add(8, f"Base support at point {p} pinned to fixed", [element("modified", p, "Base", ["RESTRAINT"])])

    m["point_springs"]["Pad"][0]["UZ"] = 650
    add(8, "Point spring Pad vertical stiffness 500 to 650 kip/in (bearing pad under point 3)",
        [element("affected", pid(2, 0), "Base", ["pointSpring:Pad.UZ"])], {"pointSprings": {"Pad": ["UZ"]}})

    # 9 (2B): applied loads
    p = pid(2, 1)
    m["point_loads"][(p, "Roof")] = [rtu(-18)]
    add(9, f"Roof unit load at point {p} 12 to 18 kip", [element("modified", p, "Roof", ["loads:SDL"])])

    b = frame_at(m, "BEAM", pid(1, 0), pid(2, 0))
    m["line_loads"][(b, "L5")] = [cladding(600)]
    add(9, f"Cladding line load on {b} at L5 400 to 600 plf", [element("modified", b, "L5", ["loads:SDL"])])

    f = area_at(m, 1, 1)
    m["area_loads"][(f, "L3")] = [area_load("SDL", 15), area_load("Live", 125)]
    add(9, f"Floor {f} at L3 live load 50 to 125 psf (storage)", [element("modified", f, "L3", ["loads:Live"])])

    # 11: mass source
    m["mass_source"]["Live"] = 0.25
    add(11, "Mass source MsSrc1 adds 25% of Live", tables={"massSource": {"MsSrc1": ["LOADPAT:Live"]}})

    # 12: load patterns, auto seismic and wind inputs
    m["seismic"]["R"] = 8
    add(12, "Seismic pattern EQX response modification R 6 to 8", tables={"loadPatterns": {"EQX": ["SEISMIC:R"]}})

    m["wind"]["VB"] = 120
    add(12, "Wind pattern WX basic wind speed 115 to 120", tables={"loadPatterns": {"WX": ["WIND:VB"]}})

    # 13: load cases
    del m["load_cases"]["Live"]["Lr"]
    add(13, "Load case Live no longer double counts roof live Lr (it has its own case)",
        tables={"loadCases": {"Live": ["LOADPAT:Lr"]}})

    m["spectrum_cases"]["RSX"] = ("U1", "DemoRS", 386.09 * 1.1)
    add(13, "Response spectrum case RSX scale factor up 10% (base shear scaling)",
        tables={"loadCases": {"RSX": ["ACCEL:U1"]}})

    # 14: combos
    m["combos"]["1.2D+1.6L+0.5Lr"][1].append(("LOADCASE", "Lr", 0.5))
    add(14, "Combo 1.2D+1.6L+0.5Lr gets its missing 0.5 Lr term", tables={"combos": {"1.2D+1.6L+0.5Lr": ["LOADCASE:Lr"]}})

    # 15: walls and slabs added / removed
    p, q = pid(4, 0), pid(4, 1)
    m["areas"]["W1"] = ("PANEL", [p, q, q, p], [0, 0, 1, 1])
    m["area_assigns"][("W1", "L2")] = {"SECTION": "Wall12", "OBJMESHTYPE": "DEFAULT"}
    add(15, "Concrete wall W1 added at L2 on grid X=1440 between Y=0 and Y=300", [element("added", "W1", "L2")])

    f = area_at(m, 3, 1)
    del m["area_assigns"][(f, "L7")]
    del m["area_loads"][(f, "L7")]
    add(15, f"Floor slab {f} removed at L7 (new stair opening)", [element("removed", f, "L7")])

    # 16: diaphragms
    f = area_at(m, 2, 0)
    m["area_assigns"][(f, "L2")]["DIAPH"] = "D2"
    add(16, f"Floor {f} at L2 moved from rigid diaphragm D1 to semi-rigid D2", [element("modified", f, "L2", ["DIAPH"])])

    # 17: functions
    m["functions"]["DemoRS"][1]["TIMEVAL"] = "0  0.4  0.2  1  0.6  1  1  0.65  2  0.325"
    add(17, "Response spectrum function DemoRS long-period ordinates up (site class revision)",
        tables={"functions": {"DemoRS": ["TIMEVAL"]}})

    b = frame_at(m, "BEAM", mid(2, 0), mid(2, 1))
    orphaned = reroute(m, b, "L6", "B45", 0.05)
    controls.append(f"Infill beam {b} at L6 redrawn 0.05 in along X, inside merge tolerance: only the {b} to B45 "
                    "rename is reported")

    # Relabel grid line X=0: its points, columns, Y beams and floors. Applied last; the
    # expected labels above are B's, so map them through the same renames.
    renames: Dict[str, str] = {}
    for j in range(len(YS)):
        renames[pid(0, j)] = str(101 + j)
        renames[f"C{pid(0, j)}"] = f"C{101 + j}"
    for j in range(len(YS) - 1):
        renames[frame_at(m, "BEAM", pid(0, j), pid(0, j + 1))] = f"B{101 + j}"
        renames[area_at(m, 0, j)] = f"F{101 + j}"
    m = relabel(m, renames)
    for c in changes:
        for e in c["elements"]:
            if e["status"] != "removed":
                e["label"] = renames.get(e["label"], e["label"])
    moved = [{"before": old, "after": new, "story": "L6", "kind": "point"} for old, new in orphaned]
    return m, changes, controls, rename_records(m, {**renames, b: "B45"}) + moved


def rename_records(m: Demo, renames: Dict[str, str]) -> List[Props]:
    """The label changes the engine should report, in the order it lists them: frames then areas by
    story from the top, then points. Point labels have no story of their own; the relabeled grid points
    carry a column through every story."""
    before = {new: old for old, new in renames.items()}

    def records(kind: str, table: str) -> List[Props]:
        return [{"before": before[label], "after": label, "story": story, "kind": kind}
                for (label, story), _ in by_story(m, table) if label in before]

    stories = [name for name, _ in m["stories"]]
    points = [{"before": old, "after": new, "story": s, "kind": "point"}
              for old, new in renames.items() if old.isdigit() for s in stories]
    return records("frame", "line_assigns") + records("area", "area_assigns") + points


def relabel(m: Demo, renames: Dict[str, str]) -> Demo:
    def r(label: str) -> str:
        return renames.get(label, label)

    out = dict(m)
    out["points"] = {r(k): v for k, v in m["points"].items()}
    out["lines"] = {r(k): (t, r(i), r(j), n) for k, (t, i, j, n) in m["lines"].items()}
    out["areas"] = {r(k): (t, [r(p) for p in pts], offs) for k, (t, pts, offs) in m["areas"].items()}
    for name in ("point_assigns", "line_assigns", "area_assigns", "point_loads", "line_loads", "area_loads"):
        out[name] = {(r(label), story): v for (label, story), v in m[name].items()}
    return out


# Rendering ---------------------------------------------------------------------------------------

def fmt(v: Any) -> str:
    if isinstance(v, str):
        return f'"{v}"'
    return f"{v:.10G}"


def kv(props: Props) -> str:
    return "  ".join(f"{k} {fmt(v)}" for k, v in props.items())


def render(m: Demo, saved: str) -> str:
    out = [
        f"$ File C:\\Users\\demo\\Documents\\ETABS\\Demo Midrise.e2k saved {saved}",
        "",
        "$ PROGRAM INFORMATION",
        '  PROGRAM  "ETABS"  VERSION "21.0.1"',
        "",
        "$ CONTROLS",
        '  UNITS  "KIP"  "IN"  "F"',
        '  TITLE2  "Demo Midrise (synthetic)"',
        "  PREFERENCE  MERGETOL 0.1",
        '  RLLF  METHOD "ASCE7-16"  USEDEFAULTMIN "Yes"',
        "",
        "$ STORIES - IN SEQUENCE FROM TOP",
    ]
    for name, height in reversed(m["stories"]):
        out.append(f'  STORY "{name}"  ELEV 0' if height is None else f'  STORY "{name}"  HEIGHT {fmt(height)}')
    out += ["", "$ GRIDS", '  GRIDSYSTEM "G1"  TYPE "CARTESIAN"  BUBBLESIZE 60']
    for axis, coords, names in (("X", XS, "ABCDE"), ("Y", YS, "1234")):
        for c, name in zip(coords, names):
            out.append(f'  GRID "G1"  LABEL "{name}"  DIR "{axis}"  COORD {fmt(c)}  VISIBLE "Yes"  BUBBLELOC "End"')
    out += ["", "$ DIAPHRAGM NAMES"]
    out += [f'  DIAPHRAGM "{name}"    TYPE {kind}' for name, kind in m["diaphragms"].items()]
    out += ["", "$ MATERIAL PROPERTIES"]
    out += definitions("MATERIAL", m["materials"])
    out += ["", "$ FRAME SECTIONS"]
    out += definitions("FRAMESECTION", m["frame_sections"])
    out += ["", "$ SLAB PROPERTIES"]
    out += definitions("SHELLPROP", {k: v for k, v in m["shell_props"].items() if v[0]["PROPTYPE"] == "Slab"})
    out += ["", "$ WALL PROPERTIES"]
    out += definitions("SHELLPROP", {k: v for k, v in m["shell_props"].items() if v[0]["PROPTYPE"] == "Wall"})
    out += ["", "$ POINT SPRING PROPERTIES"]
    out += definitions("POINTSPRING", m["point_springs"])
    out += ["", "$ POINT COORDINATES"]
    out += [f'  POINT "{k}"  {fmt(x)} {fmt(y)}' for k, (x, y) in m["points"].items()]
    out += ["", "$ LINE CONNECTIVITIES"]
    out += [f'  LINE  "{k}"  {t}  "{i}"  "{j}"  {n}' for k, (t, i, j, n) in m["lines"].items()]
    out += ["", "$ AREA CONNECTIVITIES"]
    for k, (t, pts, offs) in m["areas"].items():
        out.append(f'  AREA "{k}"  {t}  {len(pts)}  ' + "  ".join(f'"{p}"' for p in pts) + "".join(f"  {o}" for o in offs))
    for title, kw, name in (("POINT ASSIGNS", "POINTASSIGN", "point_assigns"),
                            ("LINE ASSIGNS", "LINEASSIGN", "line_assigns"),
                            ("AREA ASSIGNS", "AREAASSIGN", "area_assigns")):
        out += ["", f"$ {title}"]
        out += [f'  {kw}  "{label}"  "{story}"  {kv(props)}' for (label, story), props in by_story(m, name)]
    out += [
        "", "$ LOAD PATTERNS",
        '  LOADPATTERN "Dead"  TYPE  "Dead"  SELFWEIGHT  1',
        '  LOADPATTERN "SDL"  TYPE  "Super Dead"  SELFWEIGHT  0',
        '  LOADPATTERN "Live"  TYPE  "Live"  SELFWEIGHT  0',
        '  LOADPATTERN "Lr"  TYPE  "Roof Live"  SELFWEIGHT  0',
        '  LOADPATTERN "EQX"  TYPE  "Seismic"  SELFWEIGHT  0',
        f'  SEISMIC "EQX"  "ASCE 7-16"  {kv(m["seismic"])}',
        '  LOADPATTERN "WX"  TYPE  "Wind"  SELFWEIGHT  0',
        f'  WIND "WX"  "ASCE 7-16"  {kv(m["wind"])}',
    ]
    for title, kw, name in (("POINT OBJECT LOADS", "POINTLOAD", "point_loads"),
                            ("FRAME OBJECT LOADS", "LINELOAD", "line_loads"),
                            ("SHELL OBJECT LOADS", "AREALOAD", "area_loads")):
        out += ["", f"$ {title}"]
        out += [f'  {kw}  "{label}"  "{story}"  {kv(load)}' for (label, story), loads in by_story(m, name)
                for load in loads]
    out += ["", "$ FUNCTIONS"]
    out += definitions("FUNCTION", m["functions"])
    out += ["", "$ ANALYSIS OPTIONS", f'  PDELTA  METHOD "{m["pdelta"]}"']
    out += ["", "$ LOAD CASES", '  LOADCASE "Modal"  TYPE  "Modal - Eigen"  INITCOND  "PRESET"',
            '  LOADCASE "Modal"  MAXMODES  12 MINMODES  1']
    for name, (direction, func, sf) in m["spectrum_cases"].items():
        out.append(f'  LOADCASE "{name}"  TYPE  "Response Spectrum"  MODALCASE  "Modal"')
        out.append(f'  LOADCASE "{name}"  ACCEL  "{direction}"  FUNC  "{func}"  SF  {fmt(sf)}')
    for name, pats in m["load_cases"].items():
        out.append(f'  LOADCASE "{name}"  TYPE  "Linear Static"  INITCOND  "PRESET"')
        out += [f'  LOADCASE "{name}"  LOADPAT  "{p}"  SF  {fmt(sf)}' for p, sf in pats.items()]
    out += ["", "$ LOAD COMBINATIONS"]
    for name, (kind, terms) in m["combos"].items():
        out.append(f'  COMBO "{name}"  TYPE "{kind}"')
        out += [f'  COMBO "{name}"  {key} "{target}"  SF {fmt(sf)}' for key, target, sf in terms]
    out += [
        "", "$ MASS SOURCE",
        '  MASSSOURCE  "MsSrc1"    INCLUDEELEMENTS "Yes"    INCLUDEADDEDMASS "Yes"    INCLUDELOADS "Yes"    '
        'INCLUDEMOVE "No"    INCLUDELATERALMASS "Yes"    INCLUDEVERTICALMASS "No"    LUMPATSTORIES "Yes"    '
        'ISDEFAULT "Yes"',
    ]
    out += [f'  MASSSOURCELOAD  "MsSrc1"  "{p}"  {fmt(f)}' for p, f in m["mass_source"].items()]
    out += ["", "  END OF MODEL FILE", ""]
    return "\r\n".join(out)


def definitions(kw: str, defs: Dict[str, List[Props]]) -> List[str]:
    return [f'  {kw}  "{name}"  {kv(line)}' for name, lines in defs.items() for line in lines]


def by_story(m: Demo, name: str) -> List[Tuple[Key, Any]]:
    """Records grouped by story from the top, the way ETABS lists assigns."""
    order = {s: i for i, (s, _) in enumerate(reversed(m["stories"]))}
    return sorted(m[name].items(), key=lambda kv_: order[kv_[0][1]])


def main() -> None:
    before = base_model()
    after, changes, controls, renames = seed(before)
    for name, model, saved in (("before.e2k", before, "10/6/2026 4:12:51 PM"), ("after.e2k", after, "10/20/2026 9:47:03 AM")):
        with open(HERE / name, "w", encoding="latin-1", newline="") as fh:  # CRLF as ETABS writes it
            fh.write(render(model, saved))
    seeded = {"before": "before.e2k", "after": "after.e2k", "changes": changes, "unchanged": controls, "renames": renames}
    (HERE / "seeded-changes.json").write_text(json.dumps(seeded, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
