"""Compare two parsed models and build the output contract (schemaVersion 0.1) as a plain dict."""

import math
from collections import Counter, defaultdict
from pathlib import Path

from . import geometry
from .contract import Change, DiffOutput, ElementDiff, Meta, ModelMeta, Story, TableDiff, Tables
from .match import match_elements, match_levels
from .parser import parse_file
from .rows import IGNORED_KEYS, affects, assign_row, definition_row

FALLBACK_TOLERANCE = 0.1  # in, used only when model A has no PREFERENCE MERGETOL
DEFAULT_MOVE_TOLERANCE = 36.0  # in, max end travel for the moved-member pass
REL_TOL = 1e-5  # ETABS prints about 7 significant digits
STATUSES = ("unchanged", "added", "removed", "modified", "affected")

# (contract table, parser key, prefix used in `via` and upstream change fields)
TABLES = [
    ("materials", "materials", "material"),
    ("frameSections", "frame_sections", "frameSection"),
    ("shellSections", "shell_props", "shellSection"),
    ("pointSprings", "point_springs", "pointSpring"),
    ("loadPatterns", "load_patterns", "loadPattern"),
    # Beyond the contract's six: same TableDiff shape, safe to ignore.
    ("lineSprings", "line_springs", "lineSpring"),
    ("areaSprings", "area_springs", "areaSpring"),
    ("loadSets", "load_sets", "loadSet"),
]
DEF_KIND = {
    "materials": "material", "frame_sections": "frame_section", "shell_props": "shell_prop",
    "point_springs": "spring", "line_springs": "spring", "area_springs": "spring",
    "load_patterns": "load_pattern", "load_sets": "load_set",
}
SECTION_MATERIAL_KEYS = ("MATERIAL", "FILLMATERIAL", "CONCMATERIAL", "DECKMATERIAL")
SPRING_SOURCE = {"point": "point_springs", "frame": "line_springs", "area": "area_springs"}
SUBTYPES = {"BEAM": "beam", "COLUMN": "column", "BRACE": "brace", "FLOOR": "floor", "PANEL": "wall", "POINT": "joint"}


def diff_files(path_a, path_b, tolerance=None, move_tolerance=DEFAULT_MOVE_TOLERANCE) -> DiffOutput:
    """Diff two .e2k/.$et files. Returns a JSON-ready dict; see diff_engine/README.md for the shape."""
    result = diff_models(parse_file(path_a), parse_file(path_b), tolerance, move_tolerance)
    result["meta"]["a"]["file"] = Path(path_a).name
    result["meta"]["b"]["file"] = Path(path_b).name
    return result


def diff_models(model_a, model_b, tolerance=None, move_tolerance=DEFAULT_MOVE_TOLERANCE) -> DiffOutput:
    """tolerance and move_tolerance are in inches. tolerance defaults to model A's MERGETOL."""
    tol = tolerance if tolerance is not None else (model_a["merge_tol"] or FALLBACK_TOLERANCE)
    if tol <= 0:
        raise ValueError("tolerance must be positive")
    levels_a, levels_b = geometry.levels(model_a), geometry.levels(model_b)
    b_to_a = match_levels(levels_a, levels_b)
    a_to_b = {a: b for b, a in b_to_a.items()}
    elev_a = {lv["name"]: lv["elevation"] for lv in levels_a}

    tables = {name: _table_diff(model_a[src], model_b[src], DEF_KIND[src]) for name, src, _ in TABLES}
    pairs, removed, added = match_elements(
        geometry.elements(model_a), geometry.elements(model_b), b_to_a, elev_a, tol, move_tolerance
    )

    ctx = {"a": model_a, "b": model_b, "tables": tables, "a_to_b": a_to_b, "tol": tol}
    # The contract has no moved status yet: a moved frame is removed plus added, linked by key.
    entries, moves = [], []
    for a, b, how in pairs:
        if how == "moved":
            moves.append((_element(ctx, a, None), _element(ctx, None, b)))
            entries += moves[-1]
        else:
            entries.append(_element(ctx, a, b))
    entries += [_element(ctx, a, None) for a in removed]
    entries += [_element(ctx, None, b) for b in added]
    _dedupe_keys(entries)
    for gone, new in moves:
        gone["movedTo"], new["movedFrom"] = new["key"], gone["key"]

    stories, story_table = _stories(levels_a, levels_b, b_to_a)
    return DiffOutput(
        schemaVersion="0.1",
        meta=Meta(a=_meta(model_a), b=_meta(model_b), lengthUnit="in", forceUnit="kip", tolerance=tol,
                  moveTolerance=move_tolerance),
        stories=stories,
        elements=entries,
        tables=Tables(stories=story_table, **tables),
        summary={s: sum(e["status"] == s for e in entries) for s in STATUSES},
    )


def _meta(model) -> ModelMeta:
    return ModelMeta(file="", etabsVersion=str(model["program"].get("VERSION", "")), units=" ".join(model["units"] or []))


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


def _change(field, before, after, row, key="") -> Change:
    return Change(field=field, before=before, after=after, affects=affects(row, key), row=row)


# Stories and definition tables ---------------------------------------------------------------------

def _stories(levels_a, levels_b, b_to_a):
    """Bottom-up story list (B's names) and the stories TableDiff."""
    by_a = {lv["name"]: lv for lv in levels_a}
    rows, table = [], TableDiff(added=[], removed=[], modified={})
    for b in levels_b:
        a = by_a.get(b_to_a.get(b["name"]))
        rows.append(Story(name=b["name"], elevA=a["elevation"] if a else None, elevB=b["elevation"]))
        if a is None:
            table["added"].append(b["name"])
            continue
        changes = [_change(k, a[k], b[k], 2) for k in ("name", "elevation", "height") if not same(a[k], b[k])]
        if changes:
            table["modified"][b["name"]] = changes
    for a in levels_a:
        if a["name"] not in b_to_a.values():
            rows.append(Story(name=a["name"], elevA=a["elevation"], elevB=None))
            table["removed"].append(a["name"])
    rows.sort(key=lambda r: r["elevB"] if r["elevB"] is not None else r["elevA"])
    return rows, table


def _table_diff(defs_a, defs_b, kind) -> TableDiff:
    table = TableDiff(added=sorted(set(defs_b) - set(defs_a)), removed=sorted(set(defs_a) - set(defs_b)), modified={})
    for name in sorted(set(defs_a) & set(defs_b)):
        a, b = defs_a[name], defs_b[name]
        changes = [
            _change(key, a.get(key), b.get(key), definition_row(kind, key), key)
            for key in sorted((set(a) | set(b)) - IGNORED_KEYS)
            if not same(a.get(key), b.get(key))
        ]
        if changes:
            table["modified"][name] = changes
    return table


# Elements -----------------------------------------------------------------------------------------

def _element(ctx, a, b) -> ElementDiff:
    """One contract ElementDiff. a or b is None for removed / added."""
    some = b or a
    own = _own_changes(a, b) if a and b else []
    via, upstream = _upstream(ctx, a, b)
    if a is None or b is None:
        status = "added" if a is None else "removed"
    else:
        status = "modified" if own else "affected" if via else "unchanged"
    entry = ElementDiff(
        key=_key(ctx, some, from_a=b is None),
        kind=some["kind"],
        subtype=SUBTYPES.get(some["type"].upper(), "other"),
        label=some["label"],
        story=some["story"],
        status=status,
        geometry=[list(end["xyz"]) for end in some["ends"]],
        changes=own + upstream if status in ("modified", "affected") else [],
    )
    if via and status in ("modified", "affected"):
        entry["via"] = via
    return entry


def _own_changes(a, b):
    out = []
    for key in sorted((set(a["props"]) | set(b["props"])) - IGNORED_KEYS):
        va, vb = a["props"].get(key), b["props"].get(key)
        if not same(va, vb):
            out.append(_change(key, va, vb, assign_row(key), key))
    la, lb = _loads_by_pattern(a["loads"]), _loads_by_pattern(b["loads"])
    for pattern in sorted(set(la) | set(lb)):
        if not same(la.get(pattern, []), lb.get(pattern, [])):
            out.append(_change(f"loads:{pattern}", la.get(pattern, []), lb.get(pattern, []), 9))
    return out


def _loads_by_pattern(loads):
    out = defaultdict(list)
    for load in loads:
        pattern = load.get("LC") or f"set:{load.get('SET')}"
        out[pattern].append({k: v for k, v in load.items() if k != "LC"})
    return out


def _upstream(ctx, a, b):
    """Edited definitions this element uses, on either side: (via list, their changes)."""
    via, changes = [], []
    for side, e in (("a", a), ("b", b)):
        if e is None:
            continue
        for path in _definition_paths(ctx[side], e):
            table, prefix, name = path[-1]
            diffs = ctx["tables"][table]["modified"].get(name)
            if not diffs:
                continue
            for hop in path:
                ref = f"{hop[1]}:{hop[2]}"
                if ref not in via:
                    via.append(ref)
            for c in diffs:
                field = f"{prefix}:{name}.{c['field']}"
                if all(x["field"] != field for x in changes):
                    changes.append(Change(c, field=field))
    return via, changes


def _definition_paths(model, e):
    """Chains of (table, via prefix, name) from the element to each definition it uses."""
    props, paths = e["props"], []
    prefix = {name: p for name, _, p in TABLES}
    if e["kind"] in ("frame", "area") and isinstance(props.get("SECTION"), str):
        table, src = ("frameSections", "frame_sections") if e["kind"] == "frame" else ("shellSections", "shell_props")
        sec = (table, prefix[table], props["SECTION"])
        paths.append([sec])
        section = model[src].get(props["SECTION"], {})
        override = props.get("MATERIALOVERWRITE")
        for key in SECTION_MATERIAL_KEYS:
            mat = override if key == "MATERIAL" and isinstance(override, str) else section.get(key)
            if isinstance(mat, str):
                paths.append([sec, ("materials", "material", mat)])
    for key, value in props.items():
        if "SPRING" in key and isinstance(value, str):
            table = {"point_springs": "pointSprings", "line_springs": "lineSprings", "area_springs": "areaSprings"}[
                SPRING_SOURCE[e["kind"]]
            ]
            paths.append([(table, prefix[table], value)])
    for load in e["loads"]:
        if "SET" in load:
            paths.append([("loadSets", "loadSet", load["SET"])])
        if isinstance(load.get("LC"), str):
            paths.append([("loadPatterns", "loadPattern", load["LC"])])
    return paths


def _key(ctx, e, from_a):
    """Level-relative geometric key, rounded to the tolerance. Story names are B's where the level matched."""
    q = lambda v: round(v / ctx["tol"])  # noqa: E731
    def point_key(end):
        level = ctx["a_to_b"].get(end["level"], end["level"]) if from_a else end["level"]
        x, y, _ = end["xyz"]
        return f"{level}|{q(x)}|{q(y)}|{q(end['dz'])}"
    keys = [point_key(end) for end in e["ends"]]
    if e["kind"] == "point":
        return keys[0]
    return f"{SUBTYPES.get(e['type'].upper(), 'other')}|" + "~".join(sorted(keys))


def _dedupe_keys(entries):
    seen = Counter()
    for e in entries:
        seen[e["key"]] += 1
        if seen[e["key"]] > 1:
            e["key"] = f"{e['key']}#{seen[e['key']]}"
