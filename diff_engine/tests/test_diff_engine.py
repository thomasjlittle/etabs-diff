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


def statuses(result, kind=None):
    return sorted(e["status"] for e in result["elements"] if kind in (None, e["kind"]))


def not_unchanged(result):
    return [e for e in result["elements"] if e["status"] != "unchanged"]


class DiffEngineTest(unittest.TestCase):
    def test_identical_models_list_every_element_unchanged(self):
        result = diff_models(model(), model())
        # 2 columns, 1 beam, 1 floor, 2 supported joints
        self.assertEqual(len(result["elements"]), 6)
        self.assertEqual(result["summary"]["unchanged"], 6)
        self.assertEqual(result["tables"]["stories"], {"added": [], "removed": [], "modified": {}})

    def test_match_tolerance(self):
        # 1 mm is 0.039 in, inside the 0.1 in fallback tolerance but outside 0.01 in.
        nudged = model(replace=[('POINT "2"  6 0', 'POINT "2"  6.001 0')])
        self.assertEqual(not_unchanged(diff_models(model(), nudged)), [])
        self.assertTrue(not_unchanged(diff_models(model(), nudged, tolerance=0.01)))

    def test_relabel_invariance(self):
        relabeled = model(labels=dict(p1="91", p2="92", p3="93", p4="94", c1="X7", c2="X8", b1="Y1", f1="Z1"))
        before, after = diff_models(model(), model()), diff_models(model(), relabeled)
        self.assertEqual(not_unchanged(after), [])
        self.assertEqual(sorted(e["key"] for e in before["elements"]), sorted(e["key"] for e in after["elements"]))

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
        self.assertEqual(not_unchanged(result), [])
        self.assertTrue(all(not t["modified"] for t in result["tables"].values()))
        beam = next(e for e in result["elements"] if e["subtype"] == "beam")
        self.assertAlmostEqual(beam["geometry"][1][0], 6 / m, places=4)  # geometry is in inches

    def test_moved_member_is_removed_plus_added_with_link(self):
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

    def test_moved_pass_is_bounded(self):
        # The beam's J end jumps 5 m to point 4: a removal plus an addition with no link.
        far = diff_models(model(), model(replace=[('BEAM  "1"  "2"  0', 'BEAM  "1"  "4"  0')]))
        beams = [e for e in far["elements"] if e["subtype"] == "beam"]
        self.assertEqual(sorted(e["status"] for e in beams), ["added", "removed"])
        self.assertFalse(any("movedTo" in e or "movedFrom" in e for e in beams))

    def test_parser_quirks_comments_and_frame_point_loads(self):
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

    def test_level_elevation_change_is_one_story_change(self):
        result = diff_models(model(), model(replace=[("HEIGHT 4", "HEIGHT 4.5")]))
        self.assertEqual(not_unchanged(result), [])
        self.assertEqual(list(result["tables"]["stories"]["modified"]), ["L1"])

    def test_material_change_reaches_members_through_sections(self):
        result = diff_models(model(), model(replace=[("E 2E+08", "E 2.1E+08")]))
        self.assertEqual(list(result["tables"]["materials"]["modified"]), ["STEEL"])
        affected = [e for e in result["elements"] if e["status"] == "affected"]
        self.assertEqual(len(affected), 4)  # two columns, one beam, one floor
        self.assertTrue(all("material:STEEL" in e["via"] for e in affected))
        self.assertTrue(all(c["field"] == "material:STEEL.E" for e in affected for c in e["changes"]))

    def test_property_rows(self):
        edited = model(replace=[
            ('SECTION "BM"  RELEASE "M3I M3J"', 'SECTION "COL"'),
            ('RESTRAINT "UX UY UZ RX RY RZ"\n  POINTASSIGN  "2"', 'RESTRAINT "UX UY UZ"\n  POINTASSIGN  "2"'),
            ("FVAL 2.5", "FVAL 3"),
        ])
        result = diff_models(model(), edited)
        rows = {c["row"] for e in result["elements"] for c in e["changes"]}
        self.assertEqual(rows, {3, 7, 8, 9})
        self.assertEqual(statuses(result, "point"), ["modified", "unchanged"])


if __name__ == "__main__":
    unittest.main()
