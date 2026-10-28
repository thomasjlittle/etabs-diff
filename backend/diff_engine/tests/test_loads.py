"""Applied loads for drawing (schemaVersion 0.2): per-element loads on both sides, load definitions, and
case/combo expansion into effective pattern factors."""

import unittest
from typing import ClassVar

from diff_engine import DiffOutput, diff_files, diff_models, parse_text
from diff_engine.contract import ElementDiff, ElementLoads
from diff_engine.demo_diffs import MODELS_DIR
from diff_engine.loads import expand

COMBOS = """
UNITS  "KIP"  "IN"  "F"
LOADPATTERN "Dead"  TYPE  "Dead"  SELFWEIGHT  1
LOADPATTERN "Live"  TYPE  "Live"  SELFWEIGHT  0
LOADPATTERN "Lr"  TYPE  "Roof Live"  SELFWEIGHT  0
LOADCASE "DL"  TYPE  "Linear Static"  INITCOND  "PRESET"
LOADCASE "DL"  LOADPAT  "Dead"  SF  1
LOADCASE "LL"  TYPE  "Linear Static"  INITCOND  "PRESET"
LOADCASE "LL"  LOADPAT  "Live"  SF  1
LOADCASE "LR"  TYPE  "Linear Static"  INITCOND  "PRESET"
LOADCASE "LR"  LOADPAT  "Lr"  SF  1
LOADCASE "RS"  TYPE  "Response Spectrum"  MODALCASE  "Modal"
LOADCASE "RS"  ACCEL  "U1"  FUNC  "RS"  SF  386.09
LOADCASE "NL"  TYPE  "Nonlinear Static"  INITCOND  "DL"
LOADCASE "NL"  LOADPAT  "Live"  SF  1
COMBO "1.2D+1.6L"  TYPE "Linear Add"
COMBO "1.2D+1.6L"  LOADCASE "DL"  SF 1.2
COMBO "1.2D+1.6L"  LOADCASE "LL"  SF 1.6
COMBO "Roof"  TYPE "Linear Add"
COMBO "Roof"  LOADCOMBO "1.2D+1.6L"  SF 1
COMBO "Roof"  LOADCASE "LR"  SF 0.5
COMBO "Nested"  TYPE "Linear Add"
COMBO "Nested"  LOADCASE "Roof"  SF 2
COMBO "Env"  TYPE "Envelope"
COMBO "Env"  LOADCOMBO "1.2D+1.6L"  SF 1
COMBO "UsesEnv"  TYPE "Linear Add"
COMBO "UsesEnv"  LOADCOMBO "Env"  SF 1
COMBO "Seismic"  TYPE "Linear Add"
COMBO "Seismic"  LOADCASE "RS"  SF 1
COMBO "Loop"  TYPE "Linear Add"
COMBO "Loop"  LOADCOMBO "Loop"  SF 1
"""


def loads_of(e: ElementDiff) -> ElementLoads:
    assert "loads" in e, e["label"]
    return e["loads"]


class HackLoadsTest(unittest.TestCase):
    result: ClassVar[DiffOutput]

    @classmethod
    def setUpClass(cls) -> None:
        cls.result = diff_files(MODELS_DIR / "Hack_v05.e2k", MODELS_DIR / "Hack_v06.e2k")

    def test_b7_loads_have_absolute_positions_and_values_on_both_sides(self) -> None:
        b7 = next(e for e in self.result["elements"] if (e["label"], e["story"]) == ("B7", "Story1"))
        self.assertEqual(b7["geometry"], [[0.0, 0.0, 144.0], [300.0, 0.0, 144.0]])  # 300 in long
        for side in ("a", "b"):
            loads = loads_of(b7)[side]
            self.assertEqual(sorted(loads), ["Dead", "Live"])
            (live,) = loads["Live"]
            self.assertEqual((live["TYPE"], live["DIR"], live["FVAL"], live["RDIST"]), ("POINTF", "GRAV", 5.0, 0.4))
            self.assertAlmostEqual(live["DIST"], 120.0)
            (dead,) = loads["Dead"]
            self.assertEqual((dead["TYPE"], dead["RDSTART"], dead["RDEND"]), ("TRAPF", 0.0, 0.8))
            self.assertAlmostEqual(dead["DSTART"], 0.0)
            self.assertAlmostEqual(dead["DEND"], 240.0)
            self.assertAlmostEqual(dead["FSTART"], 1 / 12, places=6)  # 1 kip/ft
            self.assertAlmostEqual(dead["FEND"], 1 / 12, places=6)

    def test_uniform_load_spans_the_whole_member(self) -> None:
        b2 = next(e for e in self.result["elements"] if (e["label"], e["story"]) == ("B2", "Story1"))
        (dead,) = loads_of(b2)["b"]["Dead"]
        self.assertEqual((dead["TYPE"], dead["RDSTART"], dead["RDEND"], dead["DSTART"]), ("UNIFF", 0.0, 1.0, 0.0))
        self.assertAlmostEqual(dead["DEND"], 240.0)

    def test_unloaded_elements_carry_no_loads(self) -> None:
        loaded = sorted((e["label"], e["story"]) for e in self.result["elements"] if "loads" in e)
        self.assertEqual(loaded, [("B2", "Story1"), ("B2", "Story2"), ("B7", "Story1"), ("B7", "Story2")])

    def test_definitions_and_1_2d_1_6l_expansion(self) -> None:
        defs = self.result["loadDefinitions"]["b"]
        self.assertEqual(defs["patterns"]["SW"], {"type": "Dead", "selfWeight": 1.0})
        self.assertEqual(defs["cases"]["DL"]["patterns"], {"Dead": 1.0, "SW": 1.0})
        combo = defs["combos"]["1.2D+1.6L"]
        self.assertEqual((combo["type"], combo["cases"], combo["combos"]), ("Linear Add", {"DL": 1.2, "LL": 1.6}, {}))
        self.assertEqual(combo["effective"], {"expandable": True, "patterns": {"Dead": 1.2, "SW": 1.2, "Live": 1.6},
                                              "reason": None})
        self.assertFalse(defs["cases"]["Modal"]["effective"]["expandable"])


class ExpandTest(unittest.TestCase):
    model = parse_text(COMBOS)

    def factors(self, name: str) -> dict[str, float]:
        got = expand(self.model, name)
        self.assertTrue(got["expandable"], got["reason"])
        return {k: round(v, 9) for k, v in got["patterns"].items()}

    def test_combo_of_combos(self) -> None:
        self.assertEqual(self.factors("Roof"), {"Dead": 1.2, "Live": 1.6, "Lr": 0.5})
        # A LOADCASE term naming a combo resolves to that combo.
        self.assertEqual(self.factors("Nested"), {"Dead": 2.4, "Live": 3.2, "Lr": 1.0})

    def test_unsupported_types_are_flagged_not_guessed(self) -> None:
        for name, reason in [
            ("Env", "combo Env is Envelope, only Linear Add expands"),
            ("UsesEnv", "combo UsesEnv uses Env: combo Env is Envelope, only Linear Add expands"),
            ("Seismic", "combo Seismic uses RS: case RS is Response Spectrum, not a static case"),
            ("Loop", "combo Loop refers back to itself through Loop"),
            ("Missing", "no combo named Missing"),
            ("NL", "case NL continues from case DL"),
        ]:
            with self.subTest(combo=name):
                kind = "case" if name in self.model["load_cases"] else "combo"
                self.assertEqual(expand(self.model, name, kind), {"expandable": False, "patterns": {}, "reason": reason})


class LoadSetTest(unittest.TestCase):
    def test_area_load_set_resolves_to_its_patterns(self) -> None:
        text = """
UNITS  "KIP"  "FT"  "F"
STORY "L1"  HEIGHT 10
STORY "Base"  ELEV 0
POINT "1"  0  0
POINT "2"  10  0
POINT "3"  10  10
AREA "F1"  FLOOR  4  "1"  "2"  "3"  "1"  0  0  0  0
AREAASSIGN "F1"  "L1"  SECTION "Slab"
SHELLUNIFORMLOADSET "Office"  LOADPAT "SDL"  VALUE 0.015
SHELLUNIFORMLOADSET "Office"  LOADPAT "Live"  VALUE 0.05
AREALOAD "F1"  "L1"  TYPE "UNIFLOADSET"  "Office"
AREALOAD "F1"  "L1"  TYPE "UNIFLOADSET"  "Unknown"
"""
        m = parse_text(text)
        (floor,) = [e for e in diff_models(m, m)["elements"] if e["kind"] == "area"]
        loads = loads_of(floor)["b"]
        self.assertEqual(sorted(loads), ["Live", "SDL", "set:Unknown"])
        (live,) = loads["Live"]
        self.assertEqual((live["TYPE"], live["SET"]), ("UNIFLOADSET", "Office"))
        self.assertAlmostEqual(live["FVAL"], 0.05 / 144)  # ksf to kip/in2
        self.assertNotIn("FVAL", loads["set:Unknown"][0])


if __name__ == "__main__":
    unittest.main()
