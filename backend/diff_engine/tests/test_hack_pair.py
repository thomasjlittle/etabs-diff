"""The hackathon pair in fixtures/hack: Hack_v01a to Hack_v02 changes member properties on Story1 and nothing else.

Ground truth from the model author: one column changes section size, one concrete material changes within an
existing section property, and one column rotates 90 degrees.
"""

import unittest
from pathlib import Path
from typing import Any, ClassVar, Dict, cast

from diff_engine import DiffOutput, diff_files
from diff_engine.contract import TableDiff

HACK = Path(__file__).resolve().parents[3] / "fixtures" / "hack"


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


if __name__ == "__main__":
    unittest.main()
