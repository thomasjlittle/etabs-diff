"""Parse an ETABS .e2k / .$et text export into plain dicts, with values in kip, in, F."""

import logging
import os
import re
from collections import defaultdict
from typing import Any, Dict, List, Literal, Optional, Tuple, TypedDict, Union, cast

from .units import Factors, factors, scale

log = logging.getLogger(__name__)

StrPath = Union[str, os.PathLike[str]]
TokenValue = Union[float, str]
Token = Tuple[TokenValue, bool]  # (value, quoted)
# Raw keyword values off one record: floats, strings, True for a lone key, lists for REPEATING keys,
# nested dicts for load case terms. Genuinely untyped, so Any.
Props = Dict[str, Any]
ObjectKey = Tuple[str, str]  # (label, story)
XYZ = Tuple[float, float, float]
AssignTable = Literal["point_assigns", "line_assigns", "area_assigns"]
LoadTable = Literal["point_loads", "line_loads", "area_loads"]
DefTable = Literal[
    "materials", "frame_sections", "shell_props", "point_springs", "line_springs", "area_springs",
    "load_patterns", "mass_source", "load_cases", "combos", "load_sets", "diaphragms", "functions",
    "analysis",
]


class Line(TypedDict):
    type: str
    i: str
    j: str
    n: int  # stories the i end sits below the j end


class Area(TypedDict):
    type: str
    points: List[str]
    offsets: List[int]


class Model(TypedDict):
    units: Optional[List[str]]
    program: Props
    merge_tol: Optional[float]
    stories: List[Props]  # top down, as the file lists them
    grid_systems: Dict[str, Props]
    grids: Dict[str, List[Props]]
    points: Dict[str, XYZ]  # (x, y, dz below the level)
    lines: Dict[str, Line]
    areas: Dict[str, Area]
    point_assigns: Dict[ObjectKey, Props]
    line_assigns: Dict[ObjectKey, Props]
    area_assigns: Dict[ObjectKey, Props]
    point_loads: Dict[ObjectKey, List[Props]]
    line_loads: Dict[ObjectKey, List[Props]]
    area_loads: Dict[ObjectKey, List[Props]]
    materials: Dict[str, Props]
    frame_sections: Dict[str, Props]
    shell_props: Dict[str, Props]
    point_springs: Dict[str, Props]
    line_springs: Dict[str, Props]
    area_springs: Dict[str, Props]
    load_patterns: Dict[str, Props]
    mass_source: Dict[str, Props]
    load_cases: Dict[str, Props]
    combos: Dict[str, Props]
    load_sets: Dict[str, Props]
    diaphragms: Dict[str, Props]
    functions: Dict[str, Props]
    analysis: Dict[str, Props]  # analysis options by record keyword (PDELTA)
    skipped: Dict[str, int]  # record keyword -> lines not compared


# A quoted string (with "" as an escaped quote) or a bare word. Handles `"PINNED"MINNUMSTA 3`.
TOKEN = re.compile(r'"((?:[^"]|"")*)"|(\S+)')

# Keys that may repeat on one record; repeats are kept as a list.
REPEATING = {"MESHAT", "STRAIN", "STRESS", "POINTID"}
# Quoted lists of numbers that may continue over several lines of one definition; kept as one float list.
NUMBER_LISTS = {"TIMEVAL"}
# Auto lateral load records. Each belongs to the load pattern it names, flattened as RECORD:KEY.
AUTO_LATERAL = {"SEISMIC", "WIND", "WINDEXPOSURE"}

# Plan objects and their per-story records.
ASSIGNS: Dict[str, AssignTable] = {
    "POINTASSIGN": "point_assigns", "LINEASSIGN": "line_assigns", "AREAASSIGN": "area_assigns"
}
LOADS: Dict[str, LoadTable] = {"POINTLOAD": "point_loads", "LINELOAD": "line_loads", "AREALOAD": "area_loads"}
# Named definitions that merge across lines.
DEFINITIONS: Dict[str, DefTable] = {
    "MATERIAL": "materials",
    "FRAMESECTION": "frame_sections",
    "SHELLPROP": "shell_props",
    "POINTSPRING": "point_springs",
    "LINESPRING": "line_springs",
    "AREASPRING": "area_springs",
    "LOADPATTERN": "load_patterns",
    "MASSSOURCE": "mass_source",
    "DIAPHRAGM": "diaphragms",
    "FUNCTION": "functions",
}
# Definitions where each repeated line adds one term (a load and its factor) instead of more keys.
# A term line is NAME TERMKEY "target" [SF x ...]; it is stored under "TERMKEY:target".
TERMED: Dict[str, DefTable] = {"LOADCASE": "load_cases", "COMBO": "combos"}
TERM_KEYS = {"LOADPAT", "ACCEL", "LOADCASE", "LOADCOMBO"}


def tokenize(line: str) -> List[Token]:
    """Return (value, quoted) pairs. Unquoted numbers become floats."""
    out: List[Token] = []
    for quoted, bare in TOKEN.findall(line):
        if bare:
            try:
                out.append((float(bare), False))
            except ValueError:
                out.append((bare, False))
        else:
            out.append((quoted.replace('""', '"'), True))
    return out


def key_values(tokens: List[Token], record: str, fac: Factors, into: Optional[Props] = None) -> Props:
    """Read KEY VALUE pairs into a dict, converting units. A trailing lone key is stored as True."""
    into = {} if into is None else into
    i = 0
    while i < len(tokens):
        key = str(tokens[i][0]).upper()
        if i + 1 >= len(tokens):
            into[key] = True
            break
        value = scale(record, key, tokens[i + 1][0], fac)
        if key in NUMBER_LISTS and isinstance(value, str):
            prior = into.get(key)
            into[key] = (prior if isinstance(prior, list) else []) + [float(v) for v in value.split()]
        elif key in REPEATING:
            prior = into.get(key)
            into[key] = (prior if isinstance(prior, list) else []) + [value]
        else:
            into[key] = value
        i += 2
    return into


def parse_file(path: StrPath) -> Model:
    with open(path, encoding="latin-1") as fh:
        return parse_text(fh.read())


def parse_text(text: str) -> Model:
    """Parse e2k text. Unknown records are skipped; nothing here raises on odd input except bad UNITS."""
    # Loads and skipped are defaultdicts while parsing, plain dicts once done.
    model = Model(
        units=None, program={}, merge_tol=None, stories=[], grid_systems={}, grids={}, points={}, lines={}, areas={},
        point_assigns={}, line_assigns={}, area_assigns={},
        point_loads=defaultdict(list), line_loads=defaultdict(list), area_loads=defaultdict(list),
        materials={}, frame_sections={}, shell_props={}, point_springs={}, line_springs={}, area_springs={},
        load_patterns={}, mass_source={}, load_cases={}, combos={}, load_sets={},
        diaphragms={}, functions={}, analysis={},
        skipped=defaultdict(int),
    )
    fac: Factors = (1.0, 1.0, 1.0)
    in_comments = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("$"):
            continue
        tokens = tokenize(line)
        kw = str(tokens[0][0]).upper()
        # Free text typed by users; it can look like any record.
        if kw in ("STARTCOMMENTS", "ENDCOMMENTS"):
            in_comments = kw == "STARTCOMMENTS"
            continue
        if in_comments:
            continue
        rest = tokens[1:]
        try:
            if kw == "UNITS":
                model["units"] = [str(t[0]) for t in rest[:3]]
                fac = factors(model["units"])
            else:
                _record(model, kw, rest, fac)
        except (IndexError, KeyError, TypeError, ValueError, AttributeError, OverflowError) as exc:
            if kw == "UNITS":
                raise
            log.warning("skipping malformed %s line: %s", kw, exc)
            model["skipped"][kw] += 1
    model["skipped"] = dict(model["skipped"])
    for name in LOADS.values():
        model[name] = dict(model[name])
    return model


def _name(token: Token) -> str:
    """Names (labels, stories, definitions) are quoted in every ETABS export, so their tokens are str."""
    return cast(str, token[0])


def _record(model: Model, kw: str, rest: List[Token], fac: Factors) -> None:
    if kw == "PROGRAM":
        model["program"] = {"name": rest[0][0], **key_values(rest[1:], kw, fac)}
    elif kw == "PREFERENCE":
        model["merge_tol"] = key_values(rest, kw, fac).get("MERGETOL", model["merge_tol"])
    elif kw in AUTO_LATERAL:
        _auto_lateral(model["load_patterns"].setdefault(_name(rest[0]), {}), kw, rest[1:], fac)
    elif kw == "PDELTA":
        model["analysis"]["PDELTA"] = key_values(rest, kw, fac)
    elif kw == "STORY":
        model["stories"].append({"name": rest[0][0], **key_values(rest[1:], kw, fac)})
    elif kw == "GRIDSYSTEM":
        model["grid_systems"].setdefault(_name(rest[0]), {}).update(key_values(rest[1:], kw, fac))
    elif kw == "GRID":
        model["grids"].setdefault(_name(rest[0]), []).append(key_values(rest[1:], kw, fac))
    elif kw == "POINT":
        x, y =float(rest[1][0]) * fac[1], float(rest[2][0]) * fac[1]
        dz = float(rest[3][0]) * fac[1] if len(rest) > 3 and not rest[3][1] else 0.0
        model["points"][_name(rest[0])] = (x, y, dz)
    elif kw == "LINE":
        model["lines"][_name(rest[0])] = Line(type=_name(rest[1]), i=_name(rest[2]), j=_name(rest[3]), n=int(rest[4][0]))
    elif kw == "AREA":
        k = int(rest[2][0])
        pts = [_name(t) for t in rest[3 : 3 + k]]
        offs = [int(t[0]) for t in rest[3 + k : 3 + 2 * k]]
        if len(pts) != k or len(offs) not in (0, k):
            raise ValueError(f"area {rest[0][0]} lists {k} vertices but not their offsets")
        model["areas"][_name(rest[0])] = Area(type=_name(rest[1]), points=pts, offsets=offs or [0] * k)
    elif kw in ASSIGNS:
        target = model[ASSIGNS[kw]].setdefault((_name(rest[0]), _name(rest[1])), {})
        key_values(rest[2:], kw, fac, target)
    elif kw in LOADS:
        body = rest[2:]
        load: Props = {}
        if kw == "AREALOAD" and len(body) >= 3 and str(body[1][0]).upper() == "UNIFLOADSET":
            load = {"TYPE": "UNIFLOADSET", "SET": body[2][0]}
            body = body[3:]
        types = [str(body[i + 1][0]).upper() for i in range(len(body) - 1) if str(body[i][0]).upper() == "TYPE"]
        record = f"LINELOAD:{types[0]}" if kw == "LINELOAD" and types and types[0] in ("POINTF", "POINTM", "UNIFM", "TRAPM") else kw
        key_values(body, record, fac, load)
        model[LOADS[kw]][(_name(rest[0]), _name(rest[1]))].append(load)
    elif kw in DEFINITIONS:
        target = model[DEFINITIONS[kw]].setdefault(_name(rest[0]), {})
        key_values(rest[1:], kw, fac, target)
    elif kw in TERMED:
        target = model[TERMED[kw]].setdefault(_name(rest[0]), {})
        first = str(rest[1][0]).upper()
        if first in TERM_KEYS:
            kv = key_values(rest[3:], f"{kw}:{first}", fac)
            target[f"{first}:{rest[2][0]}"] = kv["SF"] if kv.keys() == {"SF"} else kv
        else:
            key_values(_joint_ref(rest[1:]), kw, fac, target)
    elif kw == "MASSSOURCELOAD":
        # Positional: MASSSOURCELOAD "source" "pattern" factor
        model["mass_source"].setdefault(_name(rest[0]), {})[f"LOADPAT:{rest[1][0]}"] = rest[2][0]
    elif kw == "SHELLUNIFORMLOADSET":
        kv = key_values(rest[1:], kw, fac)
        model["load_sets"].setdefault(_name(rest[0]), {})[kv["LOADPAT"]] = kv["VALUE"]
    else:
        model["skipped"][kw] += 1


def _auto_lateral(pattern: Props, kw: str, rest: List[Token], fac: Factors) -> None:
    """Fold one auto lateral line into its load pattern as flat RECORD:KEY fields.

    SEISMIC "EQX" "ASCE 7-16" DIR "X" R 6       -> SEISMIC:CODE, SEISMIC:DIR, SEISMIC:R
    SEISMIC "EQX" ECCOVERWRITE "L2" "D1" 6.58   -> SEISMIC:ECCOVERWRITE:L2:D1
    WIND "WX" "ASCE 7-16" VB 115                -> WIND:CODE, WIND:VB
    WINDEXPOSURE "WX" "SET" "1" ANGLE 0         -> WINDEXPOSURE:SET:1:ANGLE
    """
    if kw in ("SEISMIC", "WIND") and rest[0][1]:
        pattern[f"{kw}:CODE"] = rest[0][0]
        fields = key_values(rest[1:], kw, fac)
    elif kw == "SEISMIC":
        # Positional: SEISMIC "pattern" KEY "story" "diaphragm" value
        key = str(rest[0][0]).upper()
        fields = {":".join([key, *(str(t[0]) for t in rest[1:-1])]): scale(kw, key, rest[-1][0], fac)}
    else:
        # Positional path of quoted words, then KEY VALUE pairs.
        n = next((i for i, t in enumerate(rest) if not t[1]), len(rest))
        fields = {":".join([*(str(t[0]) for t in rest[:n]), k]): v for k, v in key_values(rest[n:], kw, fac).items()}
    for key, value in fields.items():
        pattern[f"{kw}:{key}"] = value


def _joint_ref(tokens: List[Token]) -> List[Token]:
    """Pushover cases write JOINT "label" "story"; fold the pair into one "label@story" value."""
    for i, (value, quoted) in enumerate(tokens[:-2]):
        if value == "JOINT" and not quoted:
            return tokens[: i + 1] + [(f"{tokens[i + 1][0]}@{tokens[i + 2][0]}", True)] + tokens[i + 3 :]
    return tokens
