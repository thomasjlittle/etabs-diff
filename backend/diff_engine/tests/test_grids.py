"""Grid references use source geometry, normalized units and bounded matching; unknown locations stay null."""

import copy
import unittest

from diff_engine import diff_models, parse_text
from diff_engine.tests.test_diff_engine import BASE, LABELS

GRIDS = '''
GRIDSYSTEM "G1" TYPE "CARTESIAN"
GRID "G1" LABEL "A" DIR "X" COORD 0
GRID "G1" LABEL "B" DIR "X" COORD 6
GRID "G1" LABEL "1" DIR "Y" COORD 0
GRID "G1" LABEL "2" DIR "Y" COORD 5
'''


def grid_model():
    return parse_text(BASE.format(**LABELS) + GRIDS)


class GridTest(unittest.TestCase):
    def test_columns_beams_floors_and_joints_get_plan_references(self) -> None:
        result = diff_models(grid_model(), grid_model())
        got = {e["label"]: e.get("grid") for e in result["elements"]}
        self.assertEqual(got, {"C1": "A/1", "C2": "B/1", "B1": "A-B/1", "F1": "A-B/1-2", "1": "A/1", "2": "B/1"})
        self.assertTrue(all("grid" in e for e in result["elements"]))

    def test_grid_coordinates_normalize_from_meters_to_inches(self) -> None:
        model = grid_model()
        self.assertAlmostEqual(model["grids"]["G1"][1]["COORD"], 6 / 0.0254)
        self.assertNotIn("GRID", model["skipped"])

    def test_off_grid_and_absent_grid_return_null(self) -> None:
        model = grid_model()
        model["points"]["2"] = (250.0, 0.0, 0.0)
        beam = next(e for e in diff_models(model, model)["elements"] if e["label"] == "B1")
        self.assertIsNone(beam.get("grid"))
        model["grids"] = {}
        self.assertTrue(all(e.get("grid") is None for e in diff_models(model, model)["elements"]))

    def test_tolerance_is_bounded_and_end_order_does_not_change_reference(self) -> None:
        model = grid_model()
        x, y, z = model["points"]["2"]
        model["points"]["2"] = (x + 0.05, y, z)
        model["lines"]["B1"]["i"], model["lines"]["B1"]["j"] = "2", "1"
        result = diff_models(model, model)
        self.assertEqual(next(e for e in result["elements"] if e["label"] == "B1").get("grid"), "A-B/1")
        result = diff_models(model, model, tolerance=0.01)
        self.assertIsNone(next(e for e in result["elements"] if e["label"] == "B1").get("grid"))

    def test_removed_elements_use_baseline_grid_labels(self) -> None:
        a, b = grid_model(), grid_model()
        del b["line_assigns"][("B1", "L1")]
        b["grids"]["G1"][1]["LABEL"] = "C"
        beam = next(e for e in diff_models(a, b)["elements"] if e["label"] == "B1")
        self.assertEqual((beam["status"], beam.get("grid")), ("removed", "A-B/1"))

    def test_overlapping_lines_and_grid_systems_are_ambiguous(self) -> None:
        model = grid_model()
        model["grids"]["G1"].append({"LABEL": "A2", "DIR": "X", "COORD": 0.0})
        self.assertIsNone(next(e for e in diff_models(model, model)["elements"] if e["label"] == "C1").get("grid"))
        model = grid_model()
        model["grids"]["G2"] = copy.deepcopy(model["grids"]["G1"])
        self.assertTrue(all(e.get("grid") is None for e in diff_models(model, model)["elements"]))

    def test_multiple_disjoint_systems_are_qualified(self) -> None:
        model = grid_model()
        model["grids"]["G2"] = [{"LABEL": "Q", "DIR": "X", "COORD": 10000.0}]
        self.assertEqual(next(e for e in diff_models(model, model)["elements"] if e["label"] == "B1").get("grid"), "G1:A-B/1")

    def test_unsupported_transformed_and_cylindrical_grids_are_not_guessed(self) -> None:
        for system in [{"TYPE": "CYLINDRICAL"}, {"TYPE": "CARTESIAN", "RZ": 90.0}, {"XORIGIN": 12.0}]:
            with self.subTest(system=system):
                model = grid_model()
                model["grid_systems"]["G1"] = system
                self.assertTrue(all(e.get("grid") is None for e in diff_models(model, model)["elements"]))


if __name__ == "__main__":
    unittest.main()
