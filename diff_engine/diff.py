"""Compare two parsed models and build the plain-dict result."""

import math
from collections import Counter, defaultdict

from . import geometry
from .match import match_elements, match_levels
from .parser import parse_file
from .rows import IGNORED_KEYS, ROWS, assign_row, definition_row, tag

DEFAULT_TOLERANCE = 0.01  # m, on plan X, Y and the offset from the tied level
DEFAULT_MOVE_TOLERANCE = 1.0  # m, max end travel for the moved-member pass
REL_TOL = 1e-5  # ETABS prints about 7 significant digits

# (result kind, parser key) for each definition family. Springs keep their family in the name.
DEFINITION_SOURCES = [
    ("material", "materials"),
    ("frame_section", "frame_sections"),
    ("shell_prop", "shell_props"),
    ("spring", "point_springs"),
    ("spring", "line_springs"),
    ("spring", "area_springs"),
    ("load_set", "load_sets"),
    ("load_pattern", "load_patterns"),
]
SECTION_MATERIAL_KEYS = ("MATERIAL", "FILLMATERIAL", "CONCMATERIAL", "DECKMATERIAL")
SPRING_FAMILY = {"point": "point_springs", "frame": "line_springs", "area": "area_springs"}


def diff_files(path_a, path_b, tolerance=DEFAULT_TOLERANCE, move_tolerance=DEFAULT_MOVE_TOLERANCE,
               include_unchanged=False):
    """Diff two .e2k/.$et files. Returns a JSON-ready dict; see diff_engine/README.md for the shape."""
    result = diff_models(parse_file(path_a), parse_file(path_b), tolerance, move_tolerance, include_unchanged)
    result["inputs"]["before"]["path"] = str(path_a)
    result["inputs"]["after"]["path"] = str(path_b)
    return result


def diff_models(model_a, model_b, tolerance=DEFAULT_TOLERANCE, move_tolerance=DEFAULT_MOVE_TOLERANCE,
                include_unchanged=False):
    if tolerance <= 0:
        raise ValueError("tolerance must be positive")
    levels_a, levels_b = geometry.levels(model_a), geometry.levels(model_b)
    b_to_a = match_levels(levels_a, levels_b)
    elev_a = {lv["name"]: lv["elevation"] for lv in levels_a}

    definitions = _diff_definitions(model_a, model_b)
    # Only edited definitions flag their users; reassigning to a new section is already row 3.
    changed = {(d["kind"], d["family"], d["name"]): d for d in definitions if d["status"] == "modified"}
    pairs, removed, added = match_elements(
        geometry.elements(model_a), geometry.elements(model_b), b_to_a, elev_a, tolerance, move_tolerance
    )

    entries = [_element_entry(a, b, how, model_a, model_b, changed) for a, b, how in pairs]
    entries += [_element_entry(a, None, None, model_a, model_b, changed) for a in removed]
    entries += [_element_entry(None, b, None, model_a, model_b, changed) for b in added]
    entries = [e for e in entries if include_unchanged or e["status"] != "unchanged" or e["affected_by"]]
    for n, e in enumerate(entries, 1):
        e["id"] = f"e{n}"
        for ref in e["affected_by"]:
            changed[(ref["kind"], ref["family"], ref["name"])]["used_by"].append(e["id"])

    level_entries = [lv for lv in _diff_levels(levels_a, levels_b, b_to_a)
                     if include_unchanged or lv["status"] != "unchanged"]
    definitions = [d for d in definitions if include_unchanged or d["status"] != "unchanged"]
    return {
        "schema": "etabs-diff/1",
        "units": {"force": "kN", "length": "m", "temperature": "C"},
        "options": {"tolerance": tolerance, "move_tolerance": move_tolerance, "include_unchanged": include_unchanged},
        "inputs": {"before": {"units": model_a["units"]}, "after": {"units": model_b["units"]}},
        "levels": level_entries,
        "definitions": definitions,
        "elements": entries,
        "summary": _summary(entries, definitions, level_entries),
    }


# Value comparison ---------------------------------------------------------------------------------

def same(a, b):
    """Equal within ETABS print precision. Lists of dicts (loads) compare as multisets."""
    if isinstance(a, float) and isinstance(b, float):
        return math.isclose(a, b, rel_tol=REL_TOL, abs_tol=1e-9)
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        if len(a) != len(b):
            return False
        if a and isinstance(a[0], dict):
            left = list(b)
            for x in a:
                hit = next((i for i, y in enumerate(left) if same(x, y)), None)
                if hit is None:
                    return False
                left.pop(hit)
            return True
        return all(same(x, y) for x, y in zip(a, b))
    return a == b


# Levels and definitions ---------------------------------------------------------------------------

def _diff_levels(levels_a, levels_b, b_to_a):
    a_to_b = {a: b for b, a in b_to_a.items()}
    out = []
    for lv in levels_a:
        b = next((x for x in levels_b if x["name"] == a_to_b.get(lv["name"])), None)
        out.append(_level_entry(lv, b))
    out += [_level_entry(None, lv) for lv in levels_b if lv["name"] not in b_to_a]
    out.sort(key=lambda e: (e["after"] or e["before"])["elevation"])
    return out


def _level_entry(a, b):
    changes = []
    if a and b:
        changes = [{"property": k, "before": a[k], "after": b[k]} for k in ("name", "elevation", "height")
                   if not same(a[k], b[k])]
    status = "added" if a is None else "removed" if b is None else "modified" if changes else "unchanged"
    return {"status": status, **tag(2), "before": a, "after": b, "changes": changes}


def _diff_definitions(model_a, model_b):
    out = []
    for kind, source in DEFINITION_SOURCES:
        defs_a, defs_b = model_a[source], model_b[source]
        for name in sorted(set(defs_a) | set(defs_b)):
            a, b = defs_a.get(name), defs_b.get(name)
            changes = []
            if a is not None and b is not None:
                for key in sorted((set(a) | set(b)) - IGNORED_KEYS):
                    if not same(a.get(key), b.get(key)):
                        changes.append({**tag(definition_row(kind, key)), "property": key,
                                        "before": a.get(key), "after": b.get(key)})
            status = "added" if a is None else "removed" if b is None else "modified" if changes else "unchanged"
            rows = sorted({c["row"] for c in changes}) or [definition_row(kind, "")]
            out.append({"kind": kind, "family": source, "name": name, "status": status, "rows": rows,
                        "changes": changes, "used_by": [], "used_via": []})
    _cascade_materials(out, model_a, model_b)
    return out


def _cascade_materials(defs, model_a, model_b):
    """A section whose material changed is affected too; record that on the material as used_via."""
    changed_materials = {d["name"]: d for d in defs if d["kind"] == "material" and d["status"] == "modified"}
    for source in ("frame_sections", "shell_props"):
        for name, sec in (model_a[source] | model_b[source]).items():
            for key in SECTION_MATERIAL_KEYS:
                mat = changed_materials.get(sec.get(key))
                if mat and name not in mat["used_via"]:
                    mat["used_via"].append(name)


# Elements -----------------------------------------------------------------------------------------

def _element_entry(a, b, how, model_a, model_b, changed):
    changes = []
    if a and b:
        if how == "moved":
            changes.append({**tag(2), "property": "geometry", "before": _side(a)["ends"], "after": _side(b)["ends"]})
        for key in sorted((set(a["props"]) | set(b["props"])) - IGNORED_KEYS):
            va, vb = a["props"].get(key), b["props"].get(key)
            if not same(va, vb):
                changes.append({**tag(assign_row(key)), "property": key, "before": va, "after": vb})
        la, lb = _loads_by_pattern(a["loads"]), _loads_by_pattern(b["loads"])
        for pattern in sorted(set(la) | set(lb)):
            if not same(la.get(pattern, []), lb.get(pattern, [])):
                changes.append({**tag(9), "property": f"loads:{pattern}",
                                "before": la.get(pattern, []), "after": lb.get(pattern, [])})
        status = "moved" if how == "moved" else "modified" if changes else "unchanged"
    else:
        status = "removed" if b is None else "added"

    affected = _affected_by(a, model_a, changed) + _affected_by(b, model_b, changed)
    affected = [r for i, r in enumerate(affected) if r not in affected[:i]]
    some = a or b
    entry = {
        "id": None,
        "kind": some["kind"],
        "type": some["type"],
        "status": status,
        "rows": [],
        "before": _side(a),
        "after": _side(b),
        "changes": changes,
        "affected_by": affected,
    }
    entry["rows"] = _rows(entry, some)
    return entry


def _side(e):
    if e is None:
        return None
    ends = [{"point": x["point"], "level": x["level"], "dz": x["dz"], "xyz": list(x["xyz"])} for x in e["ends"]]
    return {"label": e["label"], "story": e["story"], "ends": ends, "props": e["props"], "loads": e["loads"]}


def _loads_by_pattern(loads):
    out = defaultdict(list)
    for load in loads:
        pattern = load.get("LC") or f"set:{load.get('SET')}"
        out[pattern].append({k: v for k, v in load.items() if k != "LC"})
    return out


def _affected_by(e, model, changed):
    """Changed definitions this element uses, including materials reached through its section."""
    if e is None:
        return []
    refs = []
    props = e["props"]
    section_source = {"frame": "frame_sections", "area": "shell_props"}.get(e["kind"])
    if section_source and isinstance(props.get("SECTION"), str):
        sec_kind = "frame_section" if e["kind"] == "frame" else "shell_prop"
        refs.append((sec_kind, section_source, props["SECTION"], None))
        section = model[section_source].get(props["SECTION"], {})
        refs += [("material", "materials", section.get(k), props["SECTION"]) for k in SECTION_MATERIAL_KEYS]
    if isinstance(props.get("MATERIALOVERWRITE"), str):
        refs.append(("material", "materials", props["MATERIALOVERWRITE"], None))
    for key, value in props.items():
        if "SPRING" in key and isinstance(value, str):
            refs.append(("spring", SPRING_FAMILY[e["kind"]], value, None))
    refs += [("load_set", "load_sets", ld["SET"], None) for ld in e["loads"] if "SET" in ld]

    out = []
    for kind, family, name, via in refs:
        d = changed.get((kind, family, name))
        if d:
            ref = {"kind": kind, "family": family, "name": name, "rows": d["rows"]}
            if via:
                ref["via"] = via
            out.append(ref)
    return out


def _rows(entry, some):
    rows = {c["row"] for c in entry["changes"]}
    rows |= {r for ref in entry["affected_by"] for r in ref["rows"]}
    if entry["status"] in ("added", "removed"):
        if some["kind"] in ("frame", "area"):
            rows.add(1)
        else:
            rows |= {assign_row(k) for k in set(some["props"]) - IGNORED_KEYS}
        if some["loads"]:
            rows.add(9)
    return sorted(r for r in rows if r is not None) + (["other"] if None in rows else [])


def _summary(entries, definitions, level_entries):
    by_kind = defaultdict(Counter)
    by_row = Counter()
    for e in entries:
        by_kind[e["kind"]][e["status"]] += 1
        for r in e["rows"]:
            by_row[ROWS.get(r, r)] += 1
    defs = defaultdict(Counter)
    for d in definitions:
        defs[d["kind"]][d["status"]] += 1
    levels = Counter(e["status"] for e in level_entries)
    return {
        "elements": {k: dict(v) for k, v in by_kind.items()},
        "elements_by_row": dict(by_row),
        "definitions": {k: dict(v) for k, v in defs.items()},
        "levels": dict(levels),
    }
