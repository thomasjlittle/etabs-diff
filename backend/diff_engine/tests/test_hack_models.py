"""The hackathon models in frontend/demo_viewer/models and the viewer's precomputed diffs of them.

Hack_v01a to Hack_v02 changes member properties on Story1 and nothing else. Ground truth from the model author:
one column changes section size, one concrete material changes within an existing section property, and one
column rotates 90 degrees. Hack_v02a is Hack_v02 exported in lb and ft, so it must diff clean against Hack_v02.
"""

import unittest
from typing import Any, ClassVar, Dict, cast

from diff_engine import DiffOutput, diff_files
from diff_engine.contract import TableDiff
from diff_engine.demo_diffs import DIFFS_DIR, MODELS_DIR, build

HACK = MODELS_DIR


class HackPairTest(unittest.TestCase):
    result: ClassVar[DiffOutput]

    @classmethod
    def setUpClass(cls) -> None:
        cls.result = diff_files(HACK / "Hack_v01a.e2k", HACK / "Hack_v02.e2k")

    def test_elements_are_exactly_the_known_changes(self) -> None:
        got = sorted(
            (e["status"], e["label"], e["story"], [(c["field"], c["before"], c["after"]) for c in e["changes"]])
            for e in self.result["elements"]
            if e["status"] != "unchanged"
        )
        self.assertEqual(got, [
            ("affected", "B2", "Story1", [("frameSection:Conc16x10.MATERIAL", "4Ksi", "6Ksi")]),
            ("modified", "C1", "Story1", [("ANG", 0.0, 90.0)]),
            ("modified", "C3", "Story1", [("SECTION", "W10X60", "W16X36")]),
        ])

    def test_tables_only_change_the_concrete_material(self) -> None:
        for name, table in cast(Dict[str, TableDiff], self.result["tables"]).items():
            with self.subTest(table=name):
                self.assertEqual((table["added"], table["removed"]), ([], []))
                got: Dict[str, Any] = {k: [(c["field"], c["before"], c["after"]) for c in v]
                                       for k, v in table["modified"].items()}
                expected = {"Conc16x10": [("MATERIAL", "4Ksi", "6Ksi")]} if name == "frameSections" else {}
                self.assertEqual(got, expected)

    def test_summary_and_stories(self) -> None:
        self.assertEqual(self.result["summary"],
                         {"unchanged": 10, "added": 0, "removed": 0, "modified": 2, "affected": 1})
        self.assertTrue(all(s["elevA"] == s["elevB"] for s in self.result["stories"]))


class UnitsOnlyTest(unittest.TestCase):
    def test_lb_ft_export_diffs_clean(self) -> None:
        result = diff_files(HACK / "Hack_v02.e2k", HACK / "Hack_v02a.e2k")
        self.assertEqual(result["summary"],
                         {"unchanged": 13, "added": 0, "removed": 0, "modified": 0, "affected": 0})
        for name, table in cast(Dict[str, TableDiff], result["tables"]).items():
            with self.subTest(table=name):
                self.assertEqual(table, {"added": [], "removed": [], "modified": {}})
        self.assertTrue(all(s["elevA"] == s["elevB"] for s in result["stories"]))


class BundledDiffsTest(unittest.TestCase):
    def test_committed_diffs_match_a_fresh_run(self) -> None:
        committed = {p.name: p.read_text(encoding="utf-8") for p in DIFFS_DIR.glob("*.json")}
        self.assertEqual(committed, build(), "stale viewer diffs, run: just demo-diffs")


if __name__ == "__main__":
    unittest.main()
