"""Compare two parsed models and build the output contract (schemaVersion 0.1) as a plain dict."""

import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import (
    Any, Callable, Counter as CounterT, DefaultDict, Dict, List, Literal, NamedTuple, Optional, Sequence, Tuple, cast,
)

from . import geometry
from .change_units import unit_for, value_units
from .contract import Change, DiffOutput, ElementDiff, Kind, Meta, ModelMeta, Status, Story, Subtype, TableDiff, Tables
from .geometry import Element, End, Level
from .grids import grid_reference
from .match import match_elements, match_levels, overlaps_on_line
from .parser import DefTable, Model, Props, StrPath, parse_file
from .rows import IGNORED_KEYS, affects, assign_row, definition_row

FALLBACK_TOLERANCE = 0.1  # in, used only when model A has no PREFERENCE MERGETOL
DEFAULT_MOVE_TOLERANCE = 36.0  # in, max end travel for the moved-member pass
REL_TOL = 1e-5  # ETABS prints about 7 significant digits
STATUSES: Tuple[Status, ...] = ("unchanged", "added", "removed", "modified", "affected")

# (contract table, parser key, prefix used in `via` and upstream change fields)
TABLES: List[Tuple[str, DefTable, str]] = [
    ("materials", "materials", "material"),
    ("frameSections", "frame_sections", "frameSection"),
    ("shellSections", "shell_props", "shellSection"),
    ("pointSprings", "point_springs", "pointSpring"),
    ("loadPatterns", "load_patterns", "loadPattern"),
    # Beyond the contract's six: same TableDiff shape, safe to ignore.
    ("lineSprings", "line_springs", "lineSpring"),
    ("areaSprings", "area_springs", "areaSpring"),
    ("loadSets", "load_sets", "loadSet"),
    ("loadCases", "load_cases", "loadCase"),
    ("combos", "combos", "combo"),
    ("massSource", "mass_source", "massSource"),
    ("diaphragms", "diaphragms", "diaphragm"),
    ("functions", "functions", "function"),
    ("analysisOptions", "analysis", "analysisOption"),
]
DEF_KIND: Dict[DefTable, str] = {
    "materials": "material", "frame_sections": "frame_section", "shell_props": "shell_prop",
    "point_springs": "spring", "line_springs": "spring", "area_springs": "spring",
    "load_patterns": "load_pattern", "load_sets": "load_set",
    "load_cases": "load_case", "combos": "combo", "mass_source": "mass_source",
    "diaphragms": "diaphragm", "functions": "function", "analysis": "analysis",
}
DEFINITION_RECORD = {
    "materials": "MATERIAL", "frameSections": "FRAMESECTION", "shellSections": "SHELLPROP",
    "pointSprings": "POINTSPRING", "lineSprings": "LINESPRING", "areaSprings": "AREASPRING",
    "loadPatterns": "LOADPATTERN", "loadSets": "SHELLUNIFORMLOADSET", "loadCases": "LOADCASE",
    "combos": "COMBO", "massSource": "MASSSOURCE", "diaphragms": "DIAPHRAGM",
    "functions": "FUNCTION", "analysisOptions": "PDELTA",
}
SECTION_MATERIAL_KEYS = ("MATERIAL", "FILLMATERIAL", "CONCMATERIAL", "DECKMATERIAL")
SPRING_SOURCE: Dict[Kind, DefTable] = {"point": "point_springs", "frame": "line_springs", "area": "area_springs"}
SUBTYPES: Dict[str, Subtype] = {"BEAM": "beam", "COLUMN": "column", "BRACE": "brace", "FLOOR": "floor", "PANEL": "wall", "POINT": "joint"}
# Local axis angles in degrees: absent means 0, and they compare modulo 360.
ANGLE_KEYS = {"ANG"}
ANGLE_TOL = 1e-3
LEVEL_FIELDS: Tuple[Literal["name", "elevation", "height"], ...] = ("name", "elevation", "height")
# Frame load keys that place a load along its member, relative (R...) or in inches from the I end.
LOAD_POSITION_KEYS = {"DIST", "RDIST", "DSTART", "DEND", "RDSTART", "RDEND"}

Hop = Tuple[str, str, str]  # (contract table, via prefix, definition name)
Aliases = Dict[str, Dict[str, str]]  # table -> old name -> revised name


class _Ctx(NamedTuple):
    a: Model
    b: Model
    tables: Dict[str, TableDiff]
    a_to_b: Dict[str, str]  # level names
    tol: float
    aliases: Aliases


def diff_files(
    path_a: StrPath, path_b: StrPath, tolerance: Optional[float] = None, move_tolerance: float = DEFAULT_MOVE_TOLERANCE
) -> DiffOutput:
    """Diff two .e2k/.$et files. Returns a JSON-ready dict; see diff_engine/README.md for the shape."""
    result = diff_models(parse_file(path_a), parse_file(path_b), tolerance, move_tolerance)
    result["meta"]["a"]["file"] = Path(path_a).name
    result["meta"]["b"]["file"] = Path(path_b).name
    return result


def diff_models(
    model_a: Model, model_b: Model, tolerance: Optional[float] = None, move_tolerance: float = DEFAULT_MOVE_TOLERANCE
) -> DiffOutput:
    """tolerance and move_tolerance are in inches. tolerance defaults to model A's MERGETOL."""
    tol = tolerance if tolerance is not None else (model_a["merge_tol"] or FALLBACK_TOLERANCE)
    if tol <= 0:
        raise ValueError("tolerance must be positive")
    levels_a, levels_b = geometry.levels(model_a), geometry.levels(model_b)
    b_to_a = match_levels(levels_a, levels_b)
    a_to_b = {a: b for b, a in b_to_a.items()}
    elev_a = {lv["name"]: lv["elevation"] for lv in levels_a}

    tables: Dict[str, TableDiff] = {}
    aliases: Aliases = {}
    for name, src, _ in TABLES:
        before = {key: _renamed_refs(props, aliases) for key, props in model_a[src].items()}
        tables[name] = _table_diff(before, model_b[src], DEF_KIND[src], DEFINITION_RECORD[name])
        aliases[name] = {c["before"]: c["after"] for cs in tables[name]["modified"].values()
                         for c in cs if c.get("kind") == "renamed"}
    pairs, removed, added = match_elements(
        geometry.elements(model_a), geometry.elements(model_b), b_to_a, elev_a, tol, move_tolerance,
        lambda a, b: not _assign_changes(a, b, aliases),
    )

    ctx = _Ctx(model_a, model_b, tables, a_to_b, tol, aliases)
    # The contract has no moved status yet: a moved frame is removed plus added, linked by key. The pair's own
    # changes (assigns, loads) ride on the removed half.
    entries: List[ElementDiff] = []
    moves: List[Tuple[ElementDiff, ElementDiff]] = []
    for a, b, how in pairs:
        if how == "moved":
            moves.append((_element(ctx, a, None), _element(ctx, None, b)))
            moved_a, moved_b = _loads_along_line(a, b, tol)
            moves[-1][0]["changes"] = _own_changes(moved_a, moved_b, aliases)
            entries += moves[-1]
        else:
            entries += _listed(_element(ctx, a, b), a, b)
    entries += [e for a in removed for e in _listed(_element(ctx, a, None), a, None)]
    entries += [e for b in added for e in _listed(_element(ctx, None, b), None, b)]
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


def _listed(entry: ElementDiff, a: Optional[Element], b: Optional[Element]) -> List[ElementDiff]:
    """[entry] if it belongs in the output, else []. Frames and areas always do. A node does when it
    carries a support, spring, mass or load, or when anything assigned to it changed; bare joints where
    members meet stay out."""
    if entry["kind"] != "point" or entry["status"] in ("modified", "affected"):
        return [entry]
    sides = [e for e in (a, b) if e is not None]
    if any(_reportable_point(e) for e in sides):
        return [entry]
    one_sided = entry["status"] in ("added", "removed")
    return [entry] if one_sided and any(set(e["props"]) - IGNORED_KEYS for e in sides) else []


def _reportable_point(e: Element) -> bool:
    return bool(e["loads"]) or any(k == "RESTRAINT" or "SPRING" in k or "MASS" in k for k in e["props"])


def _meta(model: Model) -> ModelMeta:
    return ModelMeta(file="", etabsVersion=str(model["program"].get("VERSION", "")), units=" ".join(model["units"] or []))


# Value comparison ---------------------------------------------------------------------------------

def same(a: Any, b: Any) -> bool:
    """Equal within ETABS print precision. Lists of dicts (loads) compare as multisets. Values are raw e2k, so Any."""
    if isinstance(a, float) and isinstance(b, float):
        return math.isclose(a, b, rel_tol=REL_TOL, abs_tol=1e-9)
    if isinstance(a, dict) and isinstance(b, dict):
        da, db = cast(Dict[Any, Any], a), cast(Dict[Any, Any], b)
        return da.keys() == db.keys() and all(same(da[k], db[k]) for k in da)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        sa, sb = cast(Sequence[Any], a), cast(Sequence[Any], b)
        if len(sa) != len(sb):
            return False
        if sa and isinstance(sa[0], dict):
            left = list(sb)
            for x in sa:
                hit = next((i for i, y in enumerate(left) if same(x, y)), None)
                if hit is None:
                    return False
                left.pop(hit)
            return True
        return all(same(x, y) for x, y in zip(sa, sb))
    return a == b


def _change(field: str, before: Any, after: Any, row: Optional[int], key: str = "", record: str = "") -> Change:
    structured = isinstance(before, (list, dict)) or isinstance(after, (list, dict))
    change = Change(field=field, before=before, after=after, affects=affects(row, key), row=row,
                    unit=None if structured else unit_for(record, key or field))
    if structured:
        units = {"before": value_units(record, key or field, before), "after": value_units(record, key or field, after)}
        if any(unit is not None for side in units.values() for unit in side.values()):
            change["valueUnits"] = units
    return change


# Stories and definition tables ---------------------------------------------------------------------

def _stories(
    levels_a: List[Level], levels_b: List[Level], b_to_a: Dict[str, str]
) -> Tuple[List[Story], TableDiff]:
    """Bottom-up story list (B's names) and the stories TableDiff."""
    by_a = {lv["name"]: lv for lv in levels_a}
    rows: List[Story] = []
    table = TableDiff(added=[], removed=[], modified={})
    for b in levels_b:
        a = by_a[b_to_a[b["name"]]] if b["name"] in b_to_a else None
        rows.append(Story(name=b["name"], elevA=a["elevation"] if a else None, elevB=b["elevation"]))
        if a is None:
            table["added"].append(b["name"])
            continue
        changes = [_change(k, a[k], b[k], 1, "ELEV" if k == "elevation" else "HEIGHT" if k == "height" else k,
                           "STORY") for k in LEVEL_FIELDS if not same(a[k], b[k])]
        if changes:
            table["modified"][b["name"]] = changes
    for a in levels_a:
        if a["name"] not in b_to_a.values():
            rows.append(Story(name=a["name"], elevA=a["elevation"], elevB=None))
            table["removed"].append(a["name"])
    rows.sort(key=lambda r: r["elevB"] if r["elevB"] is not None else cast(float, r["elevA"]))  # one side is set
    return rows, table


def _table_diff(defs_a: Dict[str, Props], defs_b: Dict[str, Props], kind: str, record: str) -> TableDiff:
    table = TableDiff(added=sorted(set(defs_b) - set(defs_a)), removed=sorted(set(defs_a) - set(defs_b)), modified={})
    # Pair only unambiguous identical definitions. Multiple identical candidates stay added/removed.
    def meaningful(props: Props) -> Props:
        return {k: v for k, v in props.items() if k not in IGNORED_KEYS}
    candidates = {old: [new for new in table["added"] if same(meaningful(defs_a[old]), meaningful(defs_b[new]))]
                  for old in table["removed"]}
    for old, matches in candidates.items():
        if len(matches) != 1 or sum(matches[0] in names for names in candidates.values()) != 1:
            continue
        new = matches[0]
        table["removed"].remove(old)
        table["added"].remove(new)
        table["modified"][new] = [Change(field="name", before=old, after=new, affects=[], unit=None, row=None, kind="renamed")]
    for name in sorted(set(defs_a) & set(defs_b)):
        a, b = defs_a[name], defs_b[name]
        changes = [
            _change(key, a.get(key), b.get(key), definition_row(kind, key), key, record)
            for key in sorted((set(a) | set(b)) - IGNORED_KEYS)
            if not same(a.get(key), b.get(key))
        ]
        if changes:
            table["modified"][name] = changes
    return table


def _renamed_refs(props: Props, aliases: Aliases, section_table: str = "") -> Props:
    """Compare references by definition identity, without flagging a renamed section/material as a reassignment."""
    out: Props = {}
    for key, value in props.items():
        table = ("materials" if key in (*SECTION_MATERIAL_KEYS, "MATERIALOVERWRITE") else
                 section_table if key == "SECTION" else "loadPatterns" if key == "LC" else
                 "loadSets" if key == "SET" else "diaphragms" if key == "DIAPH" else "")
        if isinstance(value, str) and table:
            value = aliases.get(table, {}).get(value, value)
        term, separator, name = key.partition(":")
        term_table = {"LOADPAT": "loadPatterns", "LOADCASE": "loadCases", "LOADCOMBO": "combos"}.get(term, "")
        if separator and term_table:
            key = f"{term}:{aliases.get(term_table, {}).get(name, name)}"
        out[key] = value
    return out


# Elements -----------------------------------------------------------------------------------------

def _element(ctx: _Ctx, a: Optional[Element], b: Optional[Element]) -> ElementDiff:
    """One contract ElementDiff. a or b is None for removed / added, never both."""
    some = cast(Element, b or a)
    own = _own_changes(a, b, ctx.aliases) if a and b else []
    if a and b and a["label"] != b["label"]:
        own.append(Change(field="label", before=a["label"], after=b["label"], affects=[], unit=None, row=None, kind="renamed"))
    via, upstream = _upstream(ctx, a, b)
    status: Status
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
        grid=grid_reference(ctx.a if b is None else ctx.b, some, ctx.tol),
    )
    if via and status in ("modified", "affected"):
        entry["via"] = via
    return entry


def _own_changes(a: Element, b: Element, aliases: Optional[Aliases] = None) -> List[Change]:
    out = _assign_changes(a, b, aliases)
    la = _loads_by_pattern([_renamed_refs(load, aliases or {}) for load in a["loads"]])
    lb = _loads_by_pattern(b["loads"])
    for pattern in sorted(set(la) | set(lb)):
        if not same(la.get(pattern, []), lb.get(pattern, [])):
            record = {"frame": "LINELOAD", "point": "POINTLOAD", "area": "AREALOAD"}[b["kind"]]
            out.append(_change(f"loads:{pattern}", la.get(pattern, []), lb.get(pattern, []), 9, record=record))
    return out


def _assign_changes(a: Element, b: Element, aliases: Optional[Aliases] = None) -> List[Change]:
    out: List[Change] = []
    before = _renamed_refs(a["props"], aliases or {}, "frameSections" if a["kind"] == "frame" else "shellSections")
    record = {"frame": "LINEASSIGN", "point": "POINTASSIGN", "area": "AREAASSIGN"}[b["kind"]]
    for key in sorted((set(a["props"]) | set(b["props"])) - IGNORED_KEYS):
        va, vb = before.get(key), b["props"].get(key)
        if key in ANGLE_KEYS:
            va, vb = _angle(va), _angle(vb)
            if not _same_angle(va, vb):
                out.append(_change(key, va, vb, assign_row(key), key, record))
        elif not same(va, vb):
            out.append(_change(key, va, vb, assign_row(key), key, record))
    return out


def _loads_along_line(a: Element, b: Element, tol: float) -> Tuple[Element, Element]:
    """For a moved frame that stays on its line (extended, shortened, slid), copies of a and b whose loads are
    placed in inches from a's I end along that line, so a load that didn't move compares equal even though its
    relative distance did. A uniform load becomes a trapezoid over the whole member. Other moves: a and b as is.
    """
    pa, pb = [end["xyz"] for end in a["ends"]], b["cmp"]
    if not overlaps_on_line(pa, pb, tol):
        return a, b
    u = [(q - p) / math.dist(pa[0], pa[1]) for p, q in zip(pa[0], pa[1])]
    out: List[Element] = []
    for e, (p0, p1) in ((a, pa), (b, pb)):
        start = sum((c - o) * k for c, o, k in zip(p0, pa[0], u))
        sign = 1.0 if sum((q - p) * k for p, q, k in zip(p0, p1, u)) > 0 else -1.0
        copy = e.copy()
        copy["loads"] = [_load_on_line(load, start, sign, math.dist(p0, p1), tol) for load in e["loads"]]
        out.append(copy)
    return out[0], out[1]


def _load_on_line(load: Props, start: float, sign: float, length: float, tol: float) -> Props:
    """One frame load with its position(s) as DIST / DSTART..DEND measured on the shared line, rounded to tol.
    Unknown load types pass through untouched."""
    kind = str(load.get("TYPE", "")).upper()

    def at(rel: str, absolute: str, default: float) -> float:
        s = load.get(absolute)
        if not isinstance(s, float):
            r = load.get(rel)
            s = r * length if isinstance(r, float) else default
        return round((start + sign * s) / tol) * tol

    out = {k: v for k, v in load.items() if k not in LOAD_POSITION_KEYS}
    if kind in ("POINTF", "POINTM"):
        out["DIST"] = at("RDIST", "DIST", 0.0)
    elif kind in ("UNIFF", "UNIFM", "TRAPF", "TRAPM"):
        lo, hi = at("RDSTART", "DSTART", 0.0), at("RDEND", "DEND", length)
        f0, f1 = load.get("FSTART", load.get("FVAL")), load.get("FEND", load.get("FVAL"))
        if lo > hi:
            lo, hi, f0, f1 = hi, lo, f1, f0
        out.pop("FVAL", None)
        out.update(TYPE="TRAP" + kind[-1], DSTART=lo, DEND=hi, FSTART=f0, FEND=f1)
    else:
        return load
    return out


def _angle(value: Any) -> Any:
    """An absent angle is 0 degrees. Anything that isn't a number is left for a plain compare."""
    return 0.0 if value is None else value


def _same_angle(a: Any, b: Any) -> bool:
    if not (isinstance(a, float) and isinstance(b, float)):
        return a == b
    d = (a - b) % 360.0
    return min(d, 360.0 - d) <= ANGLE_TOL


def _loads_by_pattern(loads: List[Props]) -> DefaultDict[str, List[Props]]:
    out: DefaultDict[str, List[Props]] = defaultdict(list)
    for load in loads:
        pattern = load.get("LC") or f"set:{load.get('SET')}"
        out[pattern].append({k: v for k, v in load.items() if k != "LC"})
    return out


def _upstream(ctx: _Ctx, a: Optional[Element], b: Optional[Element]) -> Tuple[List[str], List[Change]]:
    """Edited definitions this element uses, on either side: (via list, their changes)."""
    via: List[str] = []
    changes: List[Change] = []
    for model, e in ((ctx.a, a), (ctx.b, b)):
        if e is None:
            continue
        for path in _definition_paths(model, e):
            if model is ctx.a:
                path = [(table, prefix, ctx.aliases.get(table, {}).get(name, name)) for table, prefix, name in path]
            table, prefix, name = path[-1]
            diffs = ctx.tables[table]["modified"].get(name)
            if not diffs:
                continue
            for hop in path:
                ref = f"{hop[1]}:{hop[2]}"
                if ref not in via:
                    via.append(ref)
            for c in diffs:
                field = f"{prefix}:{name}.{c['field']}"
                if all(x["field"] != field for x in changes):
                    changes.append({**c, "field": field})
    return via, changes


def _definition_paths(model: Model, e: Element) -> List[List[Hop]]:
    """Chains of (table, via prefix, name) from the element to each definition it uses."""
    props = e["props"]
    paths: List[List[Hop]] = []
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
    if isinstance(props.get("DIAPH"), str):
        paths.append([("diaphragms", prefix["diaphragms"], props["DIAPH"])])
    for load in e["loads"]:
        if "SET" in load:
            paths.append([("loadSets", "loadSet", load["SET"])])
        if isinstance(load.get("LC"), str):
            paths.append([("loadPatterns", "loadPattern", load["LC"])])
    return paths


def _key(ctx: _Ctx, e: Element, from_a: bool) -> str:
    """Level-relative geometric key, rounded to the tolerance. Story names are B's where the level matched."""
    q: Callable[[float], int] = lambda v: round(v / ctx.tol)  # noqa: E731
    def point_key(end: End) -> str:
        level = ctx.a_to_b.get(end["level"], end["level"]) if from_a else end["level"]
        x, y, _ = end["xyz"]
        return f"{level}|{q(x)}|{q(y)}|{q(end['dz'])}"
    keys = [point_key(end) for end in e["ends"]]
    if e["kind"] == "point":
        return keys[0]
    return f"{SUBTYPES.get(e['type'].upper(), 'other')}|" + "~".join(sorted(keys))


def _dedupe_keys(entries: List[ElementDiff]) -> None:
    seen: CounterT[str] = Counter()
    for e in entries:
        seen[e["key"]] += 1
        if seen[e["key"]] > 1:
            e["key"] = f"{e['key']}#{seen[e['key']]}"
