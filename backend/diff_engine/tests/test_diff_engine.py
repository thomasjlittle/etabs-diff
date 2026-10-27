"""Synthetic e2k checks: match tolerance, relabel invariance, units, moved members, levels, definitions.

Run from backend/: python -m unittest discover -s diff_engine/tests -t .
"""

import unittest
from typing import Any, Dict, List, Optional, Sequence, Tuple, cast

from diff_engine import DiffOutput, diff_models, parse_text
from diff_engine.contract import ElementDiff, TableDiff
from diff_engine.parser import Model

# Two levels, four corner columns, one beam, one floor. Units kN, m.
BASE = """
$ CONTROLS
  UNITS  "KN"  "M"  "C"
$ STORIES - IN SEQUENCE FROM TOP
  STORY "L1"  HEIGHT 4
  STORY "BASE"  ELEV 0
$ MATERIAL PROPERTIES
  MATERIAL  "STEEL"    TYPE "Steel"    WEIGHTPERVOLUME 76.9729
  MATERIAL  "STEEL"    SYMTYPE "Isotropic"  E 2E+08  U 0.3  A 1.17E-05
  MATERIAL  "STEEL"  FY 300000  FU 440000
$ FRAME SECTIONS
  FRAMESECTION  "COL"  MATERIAL "STEEL"  SHAPE "Steel I/Wide Flange"  D 0.3 B 0.3 TF 0.02 TW 0.01
  FRAMESECTION  "BM"  MATERIAL "STEEL"  SHAPE "Steel I/Wide Flange"  D 0.5 B 0.2 TF 0.015 TW 0.01
$ SLAB PROPERTIES
  SHELLPROP  "SLAB"  PROPTYPE  "Slab"  MATERIAL "STEEL"  MODELINGTYPE "Membrane"  SLABTHICKNESS 0.2
$ POINT COORDINATES
  POINT "{p1}"  0 0
  POINT "{p2}"  6 0
  POINT "{p3}"  6 5
  POINT "{p4}"  0 5
$ LINE CONNECTIVITIES
  LINE  "{c1}"  COLUMN  "{p1}"  "{p1}"  1
  LINE  "{c2}"  COLUMN  "{p2}"  "{p2}"  1
  LINE  "{b1}"  BEAM  "{p1}"  "{p2}"  0
$ AREA CONNECTIVITIES
  AREA "{f1}"  FLOOR  4  "{p1}"  "{p2}"  "{p3}"  "{p4}"  0  0  0  0
$ POINT ASSIGNS
  POINTASSIGN  "{p1}"  "BASE"  RESTRAINT "UX UY UZ RX RY RZ"
  POINTASSIGN  "{p2}"  "BASE"  RESTRAINT "UX UY UZ RX RY RZ"
$ LINE ASSIGNS
  LINEASSIGN  "{c1}"  "L1"  SECTION "COL"
  LINEASSIGN  "{c2}"  "L1"  SECTION "COL"
  LINEASSIGN  "{b1}"  "L1"  SECTION "BM"  RELEASE "M3I M3J"
$ AREA ASSIGNS
  AREAASSIGN  "{f1}"  "L1"  SECTION "SLAB"
$ LOAD PATTERNS
  LOADPATTERN "SDL"  TYPE  "Super Dead"  SELFWEIGHT  0
$ FRAME OBJECT LOADS
  LINELOAD  "{b1}"  "L1"  TYPE "UNIFF"  DIR "GRAV"  LC "SDL"  FVAL 2.5
$ SHELL OBJECT LOADS
  AREALOAD  "{f1}"  "L1"  TYPE "UNIFF"  DIR "GRAV"  LC "SDL"  FVAL 1.5
"""
LABELS = dict(p1="1", p2="2", p3="3", p4="4", c1="C1", c2="C2", b1="B1", f1="F1")


def model(labels: Optional[Dict[str, str]] = None, replace: Sequence[Tuple[str, str]] = ()) -> Model:
    """Parse BASE with `labels` filled in, after plain text replacements given as (old, new) pairs."""
    text = BASE.format(**(labels or LABELS))
    for old, new in replace:
        assert old in text, old
        text = text.replace(old, new)
    return parse_text(text)


def statuses(result: DiffOutput, kind: Optional[str] = None) -> List[str]:
    return sorted(e["status"] for e in result["elements"] if kind in (None, e["kind"]))


def not_unchanged(result: DiffOutput) -> List[ElementDiff]:
    return [e for e in result["elements"] if e["status"] != "unchanged"]


class DiffEngineTest(unittest.TestCase):
    def test_identical_models_list_every_element_unchanged(self) -> None:
        result = diff_models(model(), model())
        # 2 columns, 1 beam, 1 floor, 2 supported joints
        self.assertEqual(len(result["elements"]), 6)
        self.assertEqual(result["summary"]["unchanged"], 6)
        self.assertEqual(result["tables"]["stories"], {"added": [], "removed": [], "modified": {}})

    def test_match_tolerance(self) -> None:
        # 1 mm is 0.039 in, inside the 0.1 in fallback tolerance but outside 0.01 in.
        nudged = model(replace=[('POINT "2"  6 0', 'POINT "2"  6.001 0')])
        self.assertEqual(not_unchanged(diff_models(model(), nudged)), [])
        self.assertTrue(not_unchanged(diff_models(model(), nudged, tolerance=0.01)))

    def test_relabel_invariance(self) -> None:
        relabeled = model(labels=dict(p1="91", p2="92", p3="93", p4="94", c1="X7", c2="X8", b1="Y1", f1="Z1"))
        before, after = diff_models(model(), model()), diff_models(model(), relabeled)
        self.assertEqual(not_unchanged(after), [])
        self.assertEqual(sorted(e["key"] for e in before["elements"]), sorted(e["key"] for e in after["elements"]))

    def test_units_normalization(self) -> None:
        # Same model written in LB-IN: lengths / 0.0254, forces / 0.00444822162.
        kn, m = 0.00444822162, 0.0254
        imperial = model(replace=[
            ('UNITS  "KN"  "M"  "C"', 'UNITS  "LB"  "IN"  "F"'),
            ("HEIGHT 4", f"HEIGHT {4 / m}"),
            ('POINT "2"  6 0', f'POINT "2"  {6 / m} 0'),
            ('POINT "3"  6 5', f'POINT "3"  {6 / m} {5 / m}'),
            ('POINT "4"  0 5', f'POINT "4"  0 {5 / m}'),
            ("FVAL 2.5", f"FVAL {2.5 * m / kn}"),
            ("FVAL 1.5", f"FVAL {1.5 * m * m / kn}"),
            ("E 2E+08", f"E {2e8 * m * m / kn}"),
            ("WEIGHTPERVOLUME 76.9729", f"WEIGHTPERVOLUME {76.9729 * m ** 3 / kn}"),
            ("FY 300000  FU 440000", f"FY {3e5 * m * m / kn}  FU {4.4e5 * m * m / kn}"),
            ("A 1.17E-05", f"A {1.17e-5 / 1.8}"),
            ("D 0.3 B 0.3 TF 0.02 TW 0.01", f"D {0.3 / m} B {0.3 / m} TF {0.02 / m} TW {0.01 / m}"),
            ("D 0.5 B 0.2 TF 0.015 TW 0.01", f"D {0.5 / m} B {0.2 / m} TF {0.015 / m} TW {0.01 / m}"),
            ("SLABTHICKNESS 0.2", f"SLABTHICKNESS {0.2 / m}"),
        ])
        result = diff_models(model(), imperial)
        self.assertEqual(not_unchanged(result), [])
        self.assertTrue(all(not t["modified"] for t in cast(Dict[str, TableDiff], result["tables"]).values()))
        beam = next(e for e in result["elements"] if e["subtype"] == "beam")
        self.assertAlmostEqual(beam["geometry"][1][0], 6 / m, places=4)  # geometry is in inches

    def test_moved_member_is_removed_plus_added_with_link(self) -> None:
        # Point 2 moves 0.3 m (11.8 in) in plan: the column on it and the beam's J end move.
        moved = diff_models(model(), model(replace=[('POINT "2"  6 0', 'POINT "2"  6.3 0')]))
        frames = [e for e in moved["elements"] if e["kind"] == "frame" and e["status"] != "unchanged"]
        self.assertEqual(sorted(e["status"] for e in frames), ["added", "added", "removed", "removed"])
        keys = {e["key"]: e for e in frames}
        for e in frames:
            link = e.get("movedTo") or e.get("movedFrom")
            self.assertIn(link, keys)
        no_pass = diff_models(model(), model(replace=[('POINT "2"  6 0', 'POINT "2"  6.3 0')]), move_tolerance=0)
        self.assertFalse(any("movedTo" in e for e in no_pass["elements"]))

    def test_moved_pass_is_bounded(self) -> None:
        # The beam's J end jumps 5 m to point 4: a removal plus an addition with no link.
        far = diff_models(model(), model(replace=[('BEAM  "1"  "2"  0', 'BEAM  "1"  "4"  0')]))
        beams = [e for e in far["elements"] if e["subtype"] == "beam"]
        self.assertEqual(sorted(e["status"] for e in beams), ["added", "removed"])
        self.assertFalse(any("movedTo" in e or "movedFrom" in e for e in beams))

    def test_parser_quirks_comments_and_frame_point_loads(self) -> None:
        text = BASE.format(**LABELS)
        text += '  STARTCOMMENTS\n  UNITS changed by hand\n  STORY heights revised\n  ENDCOMMENTS\n'
        text += '  LINELOAD  "B1"  "L1"  TYPE "POINTF"  DIR "GRAV"  LC "SDL"  FVAL 10 RDIST 0.5\n'
        # Real-file quirks: CRLF, a doubled quote inside a name, a value running into the next key.
        text = text.replace('RELEASE "M3I M3J"', 'RELEASE "PINNED"CARDINALPT 8')
        text = text.replace('SHELLPROP  "SLAB"', 'SHELLPROP  "Slab 8"" Thick"').replace("\n", "\r\n")
        parsed = parse_text(text)
        self.assertEqual([s["name"] for s in parsed["stories"]], ["L1", "BASE"])
        self.assertEqual(parsed["line_assigns"][("B1", "L1")]["CARDINALPT"], 8.0)
        self.assertIn('Slab 8" Thick', parsed["shell_props"])
        point_load = parsed["line_loads"][("B1", "L1")][-1]
        self.assertAlmostEqual(point_load["FVAL"], 10 / 4.44822162)  # kN to kip, not kN/m to kip/in

    def test_level_elevation_change_is_one_story_change(self) -> None:
        result = diff_models(model(), model(replace=[("HEIGHT 4", "HEIGHT 4.5")]))
        self.assertEqual(not_unchanged(result), [])
        self.assertEqual(list(result["tables"]["stories"]["modified"]), ["L1"])

    def test_material_change_reaches_members_through_sections(self) -> None:
        result = diff_models(model(), model(replace=[("E 2E+08", "E 2.1E+08")]))
        self.assertEqual(list(result["tables"]["materials"]["modified"]), ["STEEL"])
        affected = [e for e in result["elements"] if e["status"] == "affected"]
        self.assertEqual(len(affected), 4)  # two columns, one beam, one floor
        self.assertTrue(all("material:STEEL" in e.get("via", []) for e in affected))
        self.assertTrue(all(c["field"] == "material:STEEL.E" for e in affected for c in e["changes"]))

    def test_property_rows(self) -> None:
        edited = model(replace=[
            ('SECTION "BM"  RELEASE "M3I M3J"', 'SECTION "COL"'),
            ('RESTRAINT "UX UY UZ RX RY RZ"\n  POINTASSIGN  "2"', 'RESTRAINT "UX UY UZ"\n  POINTASSIGN  "2"'),
            ("FVAL 2.5", "FVAL 3"),
        ])
        result = diff_models(model(), edited)
        rows = {c.get("row") for e in result["elements"] for c in e["changes"]}
        self.assertEqual(rows, {2, 6, 8, 9})
        self.assertEqual(statuses(result, "point"), ["modified", "unchanged"])

    def test_cases_combos_and_mass_source_compare_by_term(self) -> None:
        analysis = """
$ LOAD CASES
  LOADCASE "G"  TYPE  "Linear Static"  INITCOND  "PRESET"
  LOADCASE "G"  LOADPAT  "SDL"  SF  1
  LOADCASE "G"  LOADPAT  "DL"  SF  1
  LOADCASE "RS"  TYPE  "Response Spectrum"  MODALCASE  "Modal"
  LOADCASE "RS"  ACCEL  "U1"  FUNC  "Spec"  SF  9.80665
  LOADCASE "PO"  LOADCONTROL "Displ"  DOF "U1"  JOINT "7" "L1"
$ LOAD COMBINATIONS
  COMBO "ULS"  TYPE "Linear Add"
  COMBO "ULS"  LOADCASE "G"  SF 1.2
  COMBO "ULS"  LOADCASE "Q"  SF 1.5
$ MASS SOURCE
  MASSSOURCE  "MsSrc1"    INCLUDELOADS "Yes"    ISDEFAULT "Yes"
  MASSSOURCELOAD  "MsSrc1"  "SDL"  1
  MASSSOURCELOAD  "MsSrc1"  "Q"  0.3
"""
        text = BASE.format(**LABELS) + analysis
        parsed = parse_text(text)
        self.assertEqual(parsed["load_cases"]["G"]["LOADPAT:DL"], 1.0)  # repeated LOADPAT lines both kept
        self.assertAlmostEqual(parsed["load_cases"]["RS"]["ACCEL:U1"]["SF"], 9.80665 / 0.0254)  # g in in/s2
        self.assertEqual(parsed["load_cases"]["PO"]["JOINT"], "7@L1")
        self.assertEqual(parsed["combos"]["ULS"], {"TYPE": "Linear Add", "LOADCASE:G": 1.2, "LOADCASE:Q": 1.5})
        edited = text.replace('SF 1.5', 'SF 1.6').replace('"Q"  0.3', '"Q"  0.25')
        tables = diff_models(parsed, parse_text(edited))["tables"]
        assert "combos" in tables and "massSource" in tables
        self.assertEqual([c["field"] for c in tables["combos"]["modified"]["ULS"]], ["LOADCASE:Q"])
        mass = tables["massSource"]["modified"]["MsSrc1"]
        self.assertEqual([(c["field"], c["affects"], c.get("row")) for c in mass], [("LOADPAT:Q", ["mass"], 11)])

    def column_angle_changes(self, before: str, after: str) -> List[Tuple[str, str, str, Any, Any, Optional[int]]]:
        """Changes on column C1 when its L1 assign gains `before` and then `after` (e.g. ' ANG 30')."""
        assign = 'LINEASSIGN  "C1"  "L1"  SECTION "COL"'
        a = model(replace=[(assign, assign + before)])
        b = model(replace=[(assign, assign + after)])
        result = diff_models(a, b)
        return [(e["subtype"], e["label"], c["field"], c["before"], c["after"], c.get("row"))
                for e in result["elements"] for c in e["changes"]]

    def test_column_rotated_by_a_non_90_angle(self) -> None:
        self.assertEqual(self.column_angle_changes("", " ANG 30"), [("column", "C1", "ANG", 0.0, 30.0, 6)])
        self.assertEqual(self.column_angle_changes(" ANG 45", " ANG -30"), [("column", "C1", "ANG", 45.0, -30.0, 6)])

    def test_column_angle_compares_modulo_360(self) -> None:
        self.assertEqual(self.column_angle_changes(" ANG 0", " ANG 360"), [])
        self.assertEqual(self.column_angle_changes("", " ANG 360"), [])
        self.assertEqual(self.column_angle_changes(" ANG 270", " ANG -90"), [])
        self.assertEqual(self.column_angle_changes(" ANG 90", " ANG 90.0004"), [])

    def test_member_modifiers_and_length_offsets(self) -> None:
        assign = 'LINEASSIGN  "C1"  "L1"  SECTION "COL"'
        edited = model(replace=[(assign, assign + " PROPMODI33 0.7 PROPMODM 0.9 LENGTHOFFI 0.1")])
        changes = {c["field"]: c for e in diff_models(model(), edited)["elements"] for c in e["changes"]}
        self.assertEqual({k: (c.get("row"), c["affects"]) for k, c in changes.items()}, {
            "PROPMODI33": (5, ["stiffness", "mass"]), "PROPMODM": (5, ["mass"]), "LENGTHOFFI": (6, ["stiffness"])})
        self.assertAlmostEqual(changes["LENGTHOFFI"]["after"], 0.1 / 0.0254)  # m to in

    def test_node_listed_when_its_assign_changes_and_bare_joints_stay_out(self) -> None:
        # Point 3 at L1 is a bare floor corner. A diaphragm assign on it lists it as a modified node.
        edited = model(replace=[("$ LINE ASSIGNS", '  POINTASSIGN  "3"  "L1"  DIAPH "D1"\n$ LINE ASSIGNS')])
        result = diff_models(model(), edited)
        self.assertEqual([(e["kind"], e["label"], e["status"], [c["field"] for c in e["changes"]], e["changes"][0].get("row"))
                          for e in not_unchanged(result)], [("point", "3", "modified", ["DIAPH"], 16)])
        self.assertEqual(len(result["elements"]), 7)  # the 6 from the identical case plus that node
        # A support taken off a joint leaves it bare: a modified node, not a removed one.
        unpinned = model(replace=[('POINTASSIGN  "2"  "BASE"  RESTRAINT "UX UY UZ RX RY RZ"', "")])
        node = not_unchanged(diff_models(model(), unpinned))
        self.assertEqual([(e["label"], e["status"], e["changes"][0]["after"]) for e in node], [("2", "modified", None)])

    def test_diaphragm_definition_reaches_its_users(self) -> None:
        text = BASE.format(**LABELS).replace('SECTION "SLAB"', 'SECTION "SLAB"  DIAPH "D1"')
        text += '$ DIAPHRAGM NAMES\n  DIAPHRAGM "D1"    TYPE RIGID\n'
        result = diff_models(parse_text(text), parse_text(text.replace("TYPE RIGID", "TYPE SEMIRIGID")))
        assert "diaphragms" in result["tables"]
        self.assertEqual([(c["field"], c.get("row")) for c in result["tables"]["diaphragms"]["modified"]["D1"]], [("TYPE", 16)])
        affected = [(e["label"], e.get("via")) for e in result["elements"] if e["status"] == "affected"]
        self.assertEqual(affected, [("F1", ["diaphragm:D1"])])

    def test_auto_lateral_inputs_compare_field_by_field(self) -> None:
        patterns = """
$ LOAD PATTERNS
  LOADPATTERN "EQX"  TYPE  "Seismic"  SELFWEIGHT  0
  SEISMIC "EQX"  "ASCE 7-16"    DIR "X"  ECC 0.05  TOPSTORY "L1"    BOTTOMSTORY "BASE"  R 8  SS 1.2
  SEISMIC "EQX"  ECCOVERWRITE "L1"  "D1"  0.5
  LOADPATTERN "WX"  TYPE  "Wind"  SELFWEIGHT  0
  WIND "WX"  "EUROCODE1 2005"  EXPOSUREFROM "DIAPHRAGMS"    WINDWARDCP 0.8  LEEWARDCP 0.5  VB 35
  WINDEXPOSURE "WX"  "SET"  "1"  ANGLE 0
"""
        text = BASE.format(**LABELS) + patterns
        parsed = parse_text(text)
        eqx, wx = parsed["load_patterns"]["EQX"], parsed["load_patterns"]["WX"]
        # The ECCOVERWRITE line must not replace the main seismic line (it used to).
        self.assertEqual((eqx["SEISMIC:CODE"], eqx["SEISMIC:R"]), ("ASCE 7-16", 8.0))
        self.assertAlmostEqual(eqx["SEISMIC:ECCOVERWRITE:L1:D1"], 0.5 / 0.0254)
        self.assertEqual((wx["WIND:VB"], wx["WINDEXPOSURE:SET:1:ANGLE"]), (35.0, 0.0))
        edited = text.replace("R 8", "R 6").replace("VB 35", "VB 40").replace('"D1"  0.5', '"D1"  0.6')
        tables = diff_models(parsed, parse_text(edited))["tables"]["loadPatterns"]["modified"]
        self.assertEqual({k: sorted((c["field"], c.get("row")) for c in v) for k, v in tables.items()}, {
            "EQX": [("SEISMIC:ECCOVERWRITE:L1:D1", 12), ("SEISMIC:R", 12)], "WX": [("WIND:VB", 12)]})

    def test_functions_and_p_delta(self) -> None:
        extra = """
$ FUNCTIONS
  FUNCTION "RS"  FUNCTYPE "SPECTRUM"  DAMPRATIO 0.05  SPECTYPE "USER"
  FUNCTION "RS"  TIMEVAL "0  0.4  1  1"
  FUNCTION "RS"  TIMEVAL "2  0.5"
$ ANALYSIS OPTIONS
  PDELTA  METHOD "NONE"
"""
        text = BASE.format(**LABELS) + extra
        parsed = parse_text(text)
        self.assertEqual(parsed["functions"]["RS"]["TIMEVAL"], [0.0, 0.4, 1.0, 1.0, 2.0, 0.5])  # lines join
        edited = text.replace('"2  0.5"', '"2  0.6"').replace('"NONE"', '"OTHER"')
        tables = diff_models(parsed, parse_text(edited))["tables"]
        assert "functions" in tables and "analysisOptions" in tables
        self.assertEqual([(c["field"], c.get("row")) for c in tables["functions"]["modified"]["RS"]], [("TIMEVAL", 17)])
        self.assertEqual([(c["field"], c.get("row")) for c in tables["analysisOptions"]["modified"]["PDELTA"]],
                         [("METHOD", 13)])


if __name__ == "__main__":
    unittest.main()
