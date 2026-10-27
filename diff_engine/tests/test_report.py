"""CSV change report on the seeded demo pair: every seeded change is a row, no unchanged element is.

Run from the repo root: python -m unittest discover -s diff_engine/tests -t .
"""

import csv
import io
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any, ClassVar, Dict, List

from diff_engine import DiffOutput, diff_files
from diff_engine.__main__ import main
from diff_engine.report import COLUMNS

DEMO = Path(__file__).resolve().parents[2] / "fixtures" / "demo"


class ReportTest(unittest.TestCase):
    result: ClassVar[DiffOutput]
    seeded: ClassVar[Any]  # hand-written JSON
    text: ClassVar[str]
    json_written: ClassVar[bool]
    rows: ClassVar[List[Dict[str, str]]]

    @classmethod
    def setUpClass(cls) -> None:
        cls.result = diff_files(DEMO / "before.e2k", DEMO / "after.e2k")
        cls.seeded = json.loads((DEMO / "seeded-changes.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "changes.csv"
            json_out = Path(tmp) / "diff.json"
            assert main([str(DEMO / "before.e2k"), str(DEMO / "after.e2k"), "-o", str(json_out), "--csv", str(out)]) == 0
            cls.text = out.read_text(encoding="utf-8")
            cls.json_written = json_out.exists()
        cls.rows = list(csv.DictReader(io.StringIO(cls.text, newline="")))

    def test_header_and_json_output_still_written(self) -> None:
        self.assertEqual(self.text.splitlines()[0].split(","), COLUMNS)
        self.assertTrue(self.json_written)

    def test_every_seeded_element_change_is_a_row(self) -> None:
        for change in self.seeded["changes"]:
            for e in change["elements"]:
                with self.subTest(what=change["what"], label=e["label"]):
                    if e["moved"]:
                        rows = [r for r in self.rows if r["status"] == "moved" and e["label"] in r["label"].split(" -> ")]
                        self.assertEqual(len(rows), 1)
                        self.assertTrue(rows[0]["before"] and rows[0]["after"])
                        continue
                    rows = [r for r in self.rows if (r["table"], r["label"], r["story"], r["status"])
                            == ("elements", e["label"], e["story"], e["status"])]
                    self.assertTrue(rows)
                    self.assertEqual(sorted(r["field"] for r in rows if r["field"]), sorted(e["fields"]))

    def test_every_seeded_table_change_is_a_row(self) -> None:
        for change in self.seeded["changes"]:
            for table, defs in change["tables"].items():
                for name, fields in defs.items():
                    with self.subTest(table=table, name=name):
                        got = sorted(r["field"] for r in self.rows if (r["table"], r["key"]) == (table, name))
                        self.assertEqual(got, sorted(fields))

    def test_no_unchanged_element_and_moves_collapse(self) -> None:
        unchanged = {e["key"] for e in self.result["elements"] if e["status"] == "unchanged"}
        keys = {r["key"] for r in self.rows if r["table"] == "elements"}
        self.assertFalse(keys & unchanged)
        changed = {e["key"] for e in self.result["elements"] if e["status"] != "unchanged" and "movedTo" not in e}
        self.assertEqual(keys, changed)

    def test_committed_demo_csv_is_current(self) -> None:
        self.assertEqual((DEMO / "changes.csv").read_text(encoding="utf-8"), self.text)


if __name__ == "__main__":
    unittest.main()
