"""Rename identity must survive geometry matching and definition references without duplicate add/remove rows."""

import unittest
from typing import Dict, cast

from diff_engine import diff_models, parse_text
from diff_engine.contract import TableDiff
from diff_engine.report import change_rows
from diff_engine.tests.test_diff_engine import LABELS, model


class RenameTest(unittest.TestCase):
    def test_element_label_change_preserves_key_and_has_no_physical_impacts(self) -> None:
        before = model()
        result = diff_models(before, model(labels={**LABELS, "b1": "B9"}))
        beam = next(e for e in result["elements"] if e["subtype"] == "beam")
        original = next(e for e in diff_models(before, before)["elements"] if e["subtype"] == "beam")
        self.assertEqual(beam["key"], original["key"])
        self.assertEqual(beam["status"], "modified")
        self.assertEqual(beam["changes"], [{"field": "label", "before": "B1", "after": "B9",
                                           "affects": [], "row": None, "kind": "renamed"}])
        self.assertEqual(result["summary"]["added"] + result["summary"]["removed"], 0)
        self.assertEqual([r.get("status") for r in change_rows(result)], ["renamed"])

    def test_label_change_and_property_edit_are_both_kept(self) -> None:
        result = diff_models(model(), model(labels={**LABELS, "b1": "B9"}, replace=[('SECTION "BM"', 'SECTION "COL"')]))
        beam = next(e for e in result["elements"] if e["subtype"] == "beam")
        self.assertEqual([c["field"] for c in beam["changes"]], ["SECTION", "label"])
        self.assertEqual([r.get("status") for r in change_rows(result)], ["modified", "renamed"])

    def test_material_and_section_renames_do_not_look_like_reassignments(self) -> None:
        result = diff_models(model(), model(replace=[('"STEEL"', '"RENAMED STEEL"'), ('"BM"', '"RENAMED BM"')]))
        for table, old, new in [("materials", "STEEL", "RENAMED STEEL"), ("frameSections", "BM", "RENAMED BM")]:
            changes = cast(Dict[str, TableDiff], result["tables"])[table]
            self.assertEqual(changes["added"], [])
            self.assertEqual(changes["removed"], [])
            self.assertEqual(changes["modified"][new][0], {"field": "name", "before": old, "after": new,
                                                        "kind": "renamed", "row": None, "affects": []})
        self.assertFalse(any(c["field"] == "SECTION" for e in result["elements"] for c in e["changes"]))
        self.assertFalse(any(c["field"].endswith(".MATERIAL") for e in result["elements"] for c in e["changes"]))

    def test_patterns_cases_and_combos_pair_names_without_false_term_changes(self) -> None:
        a = parse_text('UNITS "KIP" "IN" "F"\nLOADPATTERN "D" TYPE "Dead"\n'
                       'LOADCASE "LC" TYPE "Linear Static"\nLOADCASE "LC" LOADPAT "D" SF 1\n'
                       'COMBO "C" TYPE "Linear Add"\nCOMBO "C" LOADCASE "LC" SF 1.4\n')
        b = parse_text('UNITS "KIP" "IN" "F"\nLOADPATTERN "Dead" TYPE "Dead"\n'
                       'LOADCASE "Case" TYPE "Linear Static"\nLOADCASE "Case" LOADPAT "Dead" SF 1\n'
                       'COMBO "Combo" TYPE "Linear Add"\nCOMBO "Combo" LOADCASE "Case" SF 1.4\n')
        result = diff_models(a, b)
        rows = [r for r in change_rows(result)]
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r.get("status") == "renamed" and r.get("field") == "name" for r in rows))

    def test_ambiguous_identical_definitions_are_not_guessed(self) -> None:
        a = parse_text('MATERIAL "A" E 29000\nMATERIAL "B" E 29000\n')
        b = parse_text('MATERIAL "C" E 29000\nMATERIAL "D" E 29000\n')
        table = diff_models(a, b)["tables"]["materials"]
        self.assertEqual(table, {"added": ["C", "D"], "removed": ["A", "B"], "modified": {}})

    def test_renamed_definition_with_changed_properties_stays_added_removed(self) -> None:
        result = diff_models(parse_text('MATERIAL "A" E 29000'), parse_text('MATERIAL "B" E 30000'))
        self.assertEqual(result["tables"]["materials"], {"added": ["B"], "removed": ["A"], "modified": {}})


if __name__ == "__main__":
    unittest.main()
