"""Synthetic e2k checks: match tolerance, relabel invariance, units, moved members, levels, definitions.

Run from the repo root: python -m unittest discover -s diff_engine/tests -t .
"""

import unittest

from diff_engine import diff_models, parse_text

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


def model(**edits):
    """Parse BASE after plain text replacements given as old=new pairs in `edits['replace']`."""
    text = BASE.format(**(edits.get("labels") or LABELS))
    for old, new in edits.get("replace", []):
        assert old in text, old
        text = text.replace(old, new)
    return parse_text(text)


def changed(result):
    return [e for e in result["elements"] if e["status"] != "unchanged"]


class DiffEngineTest(unittest.TestCase):
    def test_identical_models_have_no_changes(self):
        result = diff_models(model(), model())
        self.assertEqual(result["elements"], [])
        self.assertEqual(result["levels"], [])

    def test_match_tolerance(self):
        nudged = model(replace=[('POINT "2"  6 0', 'POINT "2"  6.004 0')])
        self.assertEqual(changed(diff_models(model(), nudged)), [])
        strict = diff_models(model(), nudged, tolerance=0.001)
        self.assertTrue(changed(strict))

    def test_relabel_invariance(self):
        relabeled = model(labels=dict(p1="91", p2="92", p3="93", p4="94", c1="X7", c2="X8", b1="Y1", f1="Z1"))
        self.assertEqual(diff_models(model(), relabeled)["elements"], [])

    def test_units_normalization(self):
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
        self.assertEqual(result["elements"], [])
        self.assertEqual(result["definitions"], [])

    def test_moved_member(self):
        # Point 2 moves 0.3 m in plan: the column on it and the beam's J end move, nothing is added.
        moved = model(replace=[('POINT "2"  6 0', 'POINT "2"  6.3 0')])
        result = diff_models(model(), moved)
        frames = [e for e in result["elements"] if e["kind"] == "frame"]
        self.assertEqual(sorted(e["status"] for e in frames), ["moved", "moved"])
        self.assertTrue(all(2 in e["rows"] for e in frames))
        no_pass = diff_models(model(), moved, move_tolerance=0)
        self.assertIn("added", {e["status"] for e in no_pass["elements"]})

    def test_moved_pass_is_bounded(self):
        # The beam's J end jumps 4 m to point 4: that is a removal plus an addition, not a move.
        far = model(replace=[('BEAM  "1"  "2"  0', 'BEAM  "1"  "4"  0')])
        beams = [e["status"] for e in diff_models(model(), far)["elements"] if e["type"] == "BEAM"]
        self.assertEqual(sorted(beams), ["added", "removed"])

    def test_parser_skips_comments_and_scales_frame_point_loads(self):
        text = BASE.format(**LABELS).replace('UNITS  "KN"  "M"  "C"', 'UNITS  "KIP"  "IN"  "F"')
        text += '  STARTCOMMENTS\n  UNITS changed by hand\n  STORY heights revised\n  ENDCOMMENTS\n'
        text += '  LINELOAD  "B1"  "L1"  TYPE "POINTF"  DIR "GRAV"  LC "SDL"  FVAL 10 RDIST 0.5\n'
        parsed = parse_text(text)
        self.assertEqual([s["name"] for s in parsed["stories"]], ["L1", "BASE"])
        point_load = parsed["line_loads"][("B1", "L1")][-1]
        self.assertAlmostEqual(point_load["FVAL"], 44.4822162)

    def test_level_elevation_change_is_one_level_change(self):
        taller = model(replace=[("HEIGHT 4", "HEIGHT 4.5")])
        result = diff_models(model(), taller)
        self.assertEqual(result["elements"], [])
        self.assertEqual([lv["after"]["name"] for lv in result["levels"]], ["L1"])

    def test_material_change_reaches_members_through_sections(self):
        stiffer = model(replace=[("E 2E+08", "E 2.1E+08")])
        result = diff_models(model(), stiffer)
        material = next(d for d in result["definitions"] if d["kind"] == "material")
        self.assertEqual(material["rows"], [5])
        self.assertEqual(sorted(material["used_via"]), ["BM", "COL", "SLAB"])
        self.assertEqual(len(material["used_by"]), 4)  # two columns, one beam, one floor

    def test_property_rows(self):
        edited = model(replace=[
            ('SECTION "BM"  RELEASE "M3I M3J"', 'SECTION "COL"'),
            ('RESTRAINT "UX UY UZ RX RY RZ"\n  POINTASSIGN  "2"', 'RESTRAINT "UX UY UZ"\n  POINTASSIGN  "2"'),
            ("FVAL 2.5", "FVAL 3"),
        ])
        rows = {r for e in diff_models(model(), edited)["elements"] for r in e["rows"]}
        self.assertEqual(rows, {3, 7, 8, 9})


if __name__ == "__main__":
    unittest.main()
