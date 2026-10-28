"""Units describe normalized numeric values, including heterogeneous structured load records."""

import unittest
from typing import Dict, cast

from diff_engine import diff_models, parse_text
from diff_engine.contract import TableDiff
from diff_engine.tests.test_diff_engine import model


class ChangeUnitsTest(unittest.TestCase):
    def test_material_section_story_angle_and_modifier_units(self) -> None:
        result = diff_models(model(), model(replace=[
            ('E 2E+08', 'E 2.1E+08'), ('D 0.5', 'D 0.6'), ('HEIGHT 4', 'HEIGHT 4.1'),
            ('SECTION "BM"  RELEASE', 'SECTION "BM" ANG 30 PROPMODI33 0.7 RELEASE'),
        ]))
        self.assertEqual(result["tables"]["materials"]["modified"]["STEEL"][0]["unit"], "ksi")
        self.assertEqual(result["tables"]["frameSections"]["modified"]["BM"][0]["unit"], "in")
        self.assertTrue(all(c["unit"] == "in" for c in result["tables"]["stories"]["modified"]["L1"]))
        beam = next(e for e in result["elements"] if e["subtype"] == "beam")
        own = {c["field"]: c for c in beam["changes"]}
        self.assertEqual(own["ANG"]["unit"], "deg")
        self.assertIsNone(own["PROPMODI33"]["unit"])
        self.assertIsNone(own["PROPMODI33"]["before"])

    def test_section_names_and_renames_are_unitless(self) -> None:
        result = diff_models(model(), model(replace=[('"BM"', '"RENAMED"')]))
        self.assertIsNone(result["tables"]["frameSections"]["modified"]["RENAMED"][0]["unit"])

    def test_spring_translational_rotational_and_spectrum_scale_units(self) -> None:
        before = 'POINTSPRING "S" UX 10 RX 20\nLOADCASE "R" ACCEL "U1" SF 386.4\n'
        after = 'POINTSPRING "S" UX 11 RX 21\nLOADCASE "R" ACCEL "U1" SF 400\n'
        result = diff_models(parse_text(before), parse_text(after))
        spring = {c["field"]: c["unit"] for c in result["tables"]["pointSprings"]["modified"]["S"]}
        self.assertEqual(spring, {"RX": "kip-in", "UX": "kip/in"})
        self.assertEqual(cast(Dict[str, TableDiff], result["tables"])["loadCases"]["modified"]["R"][0]["unit"], "in/s^2")

    def test_load_records_get_units_per_leaf_without_changing_values(self) -> None:
        result = diff_models(model(), model(replace=[('FVAL 2.5', 'FVAL 3')]))
        beam = next(e for e in result["elements"] if e["subtype"] == "beam")
        change = next(c for c in beam["changes"] if c["field"] == "loads:SDL")
        self.assertIsNone(change["unit"])
        units = change.get("valueUnits")
        assert units is not None
        self.assertEqual(units["after"]["0.FVAL"], "kip/in")
        self.assertIsNone(units["after"]["0.TYPE"])
        self.assertAlmostEqual(change["after"][0]["FVAL"], 3 * 0.0254 / 4.44822162)

    def test_point_force_on_frame_has_force_and_distance_units(self) -> None:
        a, b = model(), model()
        a["line_loads"][("B1", "L1")] = [{"TYPE": "POINTF", "LC": "SDL", "FVAL": 10.0, "DIST": 20.0}]
        b["line_loads"][("B1", "L1")] = [{"TYPE": "POINTF", "LC": "SDL", "FVAL": 12.0, "DIST": 30.0}]
        beam = next(e for e in diff_models(a, b)["elements"] if e["subtype"] == "beam")
        units = beam["changes"][0].get("valueUnits")
        assert units is not None
        self.assertEqual((units["after"]["0.FVAL"], units["after"]["0.DIST"]), ("kip", "in"))

    def test_every_change_has_unit_including_inherited_changes_and_unknown_fields(self) -> None:
        a, b = model(), model(replace=[('E 2E+08', 'E 2.1E+08')])
        b["line_assigns"][("B1", "L1")]["UNKNOWNNUMERIC"] = 12.0
        result = diff_models(a, b)
        changes = [c for e in result["elements"] for c in e["changes"]]
        changes += [c for t in cast(Dict[str, TableDiff], result["tables"]).values() for cs in t["modified"].values() for c in cs]
        self.assertTrue(changes)
        self.assertTrue(all("unit" in c for c in changes))
        unknown = next(c for c in changes if c["field"] == "UNKNOWNNUMERIC")
        self.assertIsNone(unknown["unit"])


if __name__ == "__main__":
    unittest.main()
