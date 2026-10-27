"""The seeded demo pair in fixtures/demo: the engine must report every seeded change and nothing else.

Regenerate with python fixtures/demo/generate.py (see its docstring for the diff.json command).
"""

import json
import unittest
from pathlib import Path
from typing import Any, ClassVar, Dict, cast

from diff_engine import DiffOutput, diff_files
from diff_engine.contract import TableDiff

DEMO = Path(__file__).resolve().parents[2] / "fixtures" / "demo"


class DemoPairTest(unittest.TestCase):
    result: ClassVar[DiffOutput]
    seeded: ClassVar[Any]  # hand-written JSON

    @classmethod
    def setUpClass(cls) -> None:
        cls.result = diff_files(DEMO / "before.e2k", DEMO / "after.e2k")
        cls.seeded = json.loads((DEMO / "seeded-changes.json").read_text(encoding="utf-8"))

    def test_elements_are_exactly_the_seeded_ones(self) -> None:
        expected = sorted(
            (e["status"], e["label"], e["story"], tuple(e["fields"]), e["moved"])
            for change in self.seeded["changes"]
            for e in change["elements"]
        )
        got = sorted(
            (e["status"], e["label"], e["story"], tuple(sorted(c["field"] for c in e["changes"])),
             "movedTo" in e or "movedFrom" in e)
            for e in self.result["elements"]
            if e["status"] != "unchanged"
        )
        self.assertEqual(got, expected)

    def test_every_list_row_is_seeded(self) -> None:
        # Rows 1 to 17 of the change list. Row 10 (additional mass) has no confirmed e2k keyword yet.
        self.assertEqual({c["row"] for c in self.seeded["changes"]}, set(range(1, 18)) - {10})

    def test_tables_are_exactly_the_seeded_ones(self) -> None:
        expected: Dict[str, Dict[str, Any]] = {}
        for change in self.seeded["changes"]:
            for table, defs in change["tables"].items():
                expected.setdefault(table, {}).update(defs)
        for name, table in cast(Dict[str, TableDiff], self.result["tables"]).items():
            with self.subTest(table=name):
                self.assertEqual((table["added"], table["removed"]), ([], []))
                got = {k: sorted(c["field"] for c in v) for k, v in table["modified"].items()}
                self.assertEqual(got, expected.get(name, {}))

    def test_move_links_point_at_each_other(self) -> None:
        by_key = {e["key"]: e for e in self.result["elements"]}
        moved = [(e["key"], e["movedTo"]) for e in self.result["elements"] if "movedTo" in e]
        self.assertEqual(len(moved), 1)
        self.assertEqual(by_key[moved[0][1]].get("movedFrom"), moved[0][0])

    def test_committed_diff_json_is_current(self) -> None:
        committed = json.loads((DEMO / "diff.json").read_text(encoding="utf-8"))
        self.assertEqual(committed, json.loads(json.dumps(self.result)))


if __name__ == "__main__":
    unittest.main()
