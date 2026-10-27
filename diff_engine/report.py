"""CSV change report: one row per change in a diff result, for sorting and filtering outside the viewer.

Element rows come first in the diff's own order, then table rows by table and name. Unchanged elements
are left out. A moved frame (a removed entry linked to an added one) is one "moved" row with the old
position under `before` and the new one under `after`.
"""

import csv
import json

from .rows import affects

COLUMNS = ["table", "key", "kind", "subtype", "label", "story", "status",
           "field", "before", "after", "affects", "row", "via"]


def _value(v):
    """Plain cell text: blank for missing, numbers as-is, anything nested as compact JSON."""
    if v is None:
        return ""
    if isinstance(v, (list, dict)):
        return json.dumps(v, sort_keys=True, separators=(",", ":"))
    return v


def _position(geometry):
    return " ".join("(" + ", ".join(f"{c:g}" for c in point) + ")" for point in geometry)


def _element_rows(elements):
    by_key = {e["key"]: e for e in elements}
    for e in elements:
        if e["status"] == "unchanged" or "movedFrom" in e:
            continue  # the added half of a move is reported on its removed half
        base = {"table": "elements", "key": e["key"], "kind": e["kind"], "subtype": e["subtype"],
                "label": e["label"], "story": e["story"], "status": e["status"],
                "via": ";".join(e.get("via", []))}
        if "movedTo" in e:
            to = by_key[e["movedTo"]]
            yield {**base, "key": to["key"], "label": f"{e['label']} -> {to['label']}", "story": to["story"],
                   "status": "moved", "before": _position(e["geometry"]), "after": _position(to["geometry"]),
                   "affects": " ".join(affects(2)), "row": 2}
        elif e["status"] in ("added", "removed"):
            side = "after" if e["status"] == "added" else "before"
            yield {**base, side: _position(e["geometry"]), "affects": " ".join(affects(1)), "row": 1}
        for c in e["changes"]:
            yield {**base, "field": c["field"], "before": _value(c["before"]), "after": _value(c["after"]),
                   "affects": " ".join(c["affects"]), "row": _value(c["row"])}


def _table_rows(tables):
    for name, table in tables.items():
        # ponytail: added/removed definitions carry no row or affects in the JSON, so those cells stay blank
        for status in ("added", "removed"):
            for entry in sorted(table[status]):
                yield {"table": name, "key": entry, "label": entry, "status": status}
        for entry in sorted(table["modified"]):
            for c in table["modified"][entry]:
                yield {"table": name, "key": entry, "label": entry, "status": "modified", "field": c["field"],
                       "before": _value(c["before"]), "after": _value(c["after"]),
                       "affects": " ".join(c["affects"]), "row": _value(c["row"])}


def change_rows(result):
    """Every change in a diff result as a flat dict keyed by COLUMNS (missing cells are blank)."""
    yield from _element_rows(result["elements"])
    yield from _table_rows(result["tables"])


def write_csv(result, path):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, COLUMNS, restval="", lineterminator="\n")
        writer.writeheader()
        writer.writerows(change_rows(result))
