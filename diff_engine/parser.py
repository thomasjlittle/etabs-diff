"""Parse an ETABS .e2k / .$et text export into plain dicts, with values in kip, in, F."""

import logging
import re
from collections import defaultdict

from .units import factors, scale

log = logging.getLogger(__name__)

# A quoted string (with "" as an escaped quote) or a bare word. Handles `"PINNED"MINNUMSTA 3`.
TOKEN = re.compile(r'"((?:[^"]|"")*)"|(\S+)')

# Keys that may repeat on one record; repeats are kept as a list.
REPEATING = {"MESHAT", "STRAIN", "STRESS", "POINTID"}

# Plan objects and their per-story records.
ASSIGNS = {"POINTASSIGN": "point_assigns", "LINEASSIGN": "line_assigns", "AREAASSIGN": "area_assigns"}
LOADS = {"POINTLOAD": "point_loads", "LINELOAD": "line_loads", "AREALOAD": "area_loads"}
# Named definitions that merge across lines.
DEFINITIONS = {
    "MATERIAL": "materials",
    "FRAMESECTION": "frame_sections",
    "SHELLPROP": "shell_props",
    "POINTSPRING": "point_springs",
    "LINESPRING": "line_springs",
    "AREASPRING": "area_springs",
    "LOADPATTERN": "load_patterns",
    "MASSSOURCE": "mass_source",
}
# Definitions where each repeated line adds one term (a load and its factor) instead of more keys.
# A term line is NAME TERMKEY "target" [SF x ...]; it is stored under "TERMKEY:target".
TERMED = {"LOADCASE": "load_cases", "COMBO": "combos"}
TERM_KEYS = {"LOADPAT", "ACCEL", "LOADCASE", "LOADCOMBO"}


def tokenize(line):
    """Return (value, quoted) pairs. Unquoted numbers become floats."""
    out = []
    for quoted, bare in TOKEN.findall(line):
        if bare:
            try:
                out.append((float(bare), False))
            except ValueError:
                out.append((bare, False))
        else:
            out.append((quoted.replace('""', '"'), True))
    return out


def key_values(tokens, record, fac, into=None):
    """Read KEY VALUE pairs into a dict, converting units. A trailing lone key is stored as True."""
    into = {} if into is None else into
    i = 0
    while i < len(tokens):
        key = str(tokens[i][0]).upper()
        if i + 1 >= len(tokens):
            into[key] = True
            break
        value = scale(record, key, tokens[i + 1][0], fac)
        if key in REPEATING:
            prior = into.get(key)
            into[key] = (prior if isinstance(prior, list) else []) + [value]
        else:
            into[key] = value
        i += 2
    return into


def parse_file(path):
    with open(path, encoding="latin-1") as fh:
        return parse_text(fh.read())


def parse_text(text):
    """Parse e2k text. Unknown records are skipped; nothing here raises on odd input except bad UNITS."""
    model = {
        "units": None,
        "program": {},
        "merge_tol": None,
        "stories": [],
        "points": {},
        "lines": {},
        "areas": {},
        **{name: {} for name in ASSIGNS.values()},
        **{name: defaultdict(list) for name in LOADS.values()},
        **{name: {} for name in DEFINITIONS.values()},
        **{name: {} for name in TERMED.values()},
        "load_sets": {},
        "skipped": defaultdict(int),
    }
    fac = (1.0, 1.0, 1.0)
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


def _record(model, kw, rest, fac):
    if kw == "PROGRAM":
        model["program"] = {"name": rest[0][0], **key_values(rest[1:], kw, fac)}
    elif kw == "PREFERENCE":
        model["merge_tol"] = key_values(rest, kw, fac).get("MERGETOL", model["merge_tol"])
    elif kw == "SEISMIC":
        # Auto lateral load parameters belong to the load pattern they name.
        pattern = model["load_patterns"].setdefault(rest[0][0], {})
        pattern["SEISMIC"] = {"CODE": rest[1][0], **key_values(rest[2:], kw, fac)}
    elif kw == "STORY":
        model["stories"].append({"name": rest[0][0], **key_values(rest[1:], kw, fac)})
    elif kw == "POINT":
        x, y =float(rest[1][0]) * fac[1], float(rest[2][0]) * fac[1]
        dz = float(rest[3][0]) * fac[1] if len(rest) > 3 and not rest[3][1] else 0.0
        model["points"][rest[0][0]] = (x, y, dz)
    elif kw == "LINE":
        model["lines"][rest[0][0]] = {"type": rest[1][0], "i": rest[2][0], "j": rest[3][0], "n": int(rest[4][0])}
    elif kw == "AREA":
        k = int(rest[2][0])
        pts = [t[0] for t in rest[3 : 3 + k]]
        offs = [int(t[0]) for t in rest[3 + k : 3 + 2 * k]]
        if len(pts) != k or len(offs) not in (0, k):
            raise ValueError(f"area {rest[0][0]} lists {k} vertices but not their offsets")
        model["areas"][rest[0][0]] = {"type": rest[1][0], "points": pts, "offsets": offs or [0] * k}
    elif kw in ASSIGNS:
        target = model[ASSIGNS[kw]].setdefault((rest[0][0], rest[1][0]), {})
        key_values(rest[2:], kw, fac, target)
    elif kw in LOADS:
        body = rest[2:]
        load = {}
        if kw == "AREALOAD" and len(body) >= 3 and str(body[1][0]).upper() == "UNIFLOADSET":
            load = {"TYPE": "UNIFLOADSET", "SET": body[2][0]}
            body = body[3:]
        types = [str(body[i + 1][0]).upper() for i in range(len(body) - 1) if str(body[i][0]).upper() == "TYPE"]
        record = f"LINELOAD:{types[0]}" if kw == "LINELOAD" and types and types[0] in ("POINTF", "POINTM", "UNIFM", "TRAPM") else kw
        key_values(body, record, fac, load)
        model[LOADS[kw]][(rest[0][0], rest[1][0])].append(load)
    elif kw in DEFINITIONS:
        target = model[DEFINITIONS[kw]].setdefault(rest[0][0], {})
        key_values(rest[1:], kw, fac, target)
    elif kw in TERMED:
        target = model[TERMED[kw]].setdefault(rest[0][0], {})
        first = str(rest[1][0]).upper()
        if first in TERM_KEYS:
            kv = key_values(rest[3:], f"{kw}:{first}", fac)
            target[f"{first}:{rest[2][0]}"] = kv["SF"] if kv.keys() == {"SF"} else kv
        else:
            key_values(_joint_ref(rest[1:]), kw, fac, target)
    elif kw == "MASSSOURCELOAD":
        # Positional: MASSSOURCELOAD "source" "pattern" factor
        model["mass_source"].setdefault(rest[0][0], {})[f"LOADPAT:{rest[1][0]}"] = rest[2][0]
    elif kw == "SHELLUNIFORMLOADSET":
        kv = key_values(rest[1:], kw, fac)
        model["load_sets"].setdefault(rest[0][0], {})[kv["LOADPAT"]] = kv["VALUE"]
    else:
        model["skipped"][kw] += 1


def _joint_ref(tokens):
    """Pushover cases write JOINT "label" "story"; fold the pair into one "label@story" value."""
    for i, (value, quoted) in enumerate(tokens[:-2]):
        if value == "JOINT" and not quoted:
            return tokens[: i + 1] + [(f"{tokens[i + 1][0]}@{tokens[i + 2][0]}", True)] + tokens[i + 3 :]
    return tokens
