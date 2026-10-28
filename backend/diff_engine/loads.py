"""Applied loads for drawing: each element's loads by pattern, the load definitions, and case/combo expansion.

Everything here describes one model as it is, not a change. diff.py puts it on the output for both sides.
"""

import math
from typing import Any, Dict, List, Optional, Set, cast

from .contract import AppliedLoad, Expansion, LoadCaseDef, LoadComboDef, LoadDefinitions, LoadPatternDef
from .geometry import Element
from .parser import Model, Props

# Case types whose applied loads are their LOADPAT terms times their factors.
STATIC_CASE_TYPES = {"LINEAR STATIC", "NONLINEAR STATIC"}
LINEAR_COMBO_TYPES = {"LINEAR ADD"}
# Relative / absolute position pairs on a frame load, in inches from the I end.
POSITION_PAIRS = (("RDIST", "DIST"), ("RDSTART", "DSTART"), ("RDEND", "DEND"))
POINT_TYPES = {"POINTF", "POINTM"}
SPAN_TYPES = {"UNIFF", "UNIFM", "TRAPF", "TRAPM"}
TERM_HEADS = ("LOADPAT", "LOADCASE", "LOADCOMBO")


def element_loads(model: Model, e: Optional[Element]) -> Dict[str, List[AppliedLoad]]:
    """e's loads grouped by pattern, in kip and in. Frame loads carry both relative and absolute positions;
    a load set on an area becomes one load per pattern in the set. {} when e is None or carries none."""
    out: Dict[str, List[AppliedLoad]] = {}
    if e is None:
        return out
    length = math.dist(e["ends"][0]["xyz"], e["ends"][1]["xyz"]) if e["kind"] == "frame" else 0.0
    for load in e["loads"]:
        body = {k: v for k, v in load.items() if k != "LC"}
        if e["kind"] == "frame":
            body = _placed(body, length)
        sets = model["load_sets"]
        if "SET" in load and load["SET"] in sets:
            for pattern, value in sets[load["SET"]].items():
                out.setdefault(str(pattern), []).append({**body, "FVAL": value})
        else:
            out.setdefault(str(load.get("LC") or f"set:{load.get('SET')}"), []).append(body)
    return out


def _placed(load: Props, length: float) -> Props:
    """A frame load with every position written both ways: R... relative to the length and plain in inches.
    A uniform or trapezoid load without its own extent spans the whole member. Other types pass through."""
    kind = str(load.get("TYPE", "")).upper()
    if kind in POINT_TYPES:
        pairs = POSITION_PAIRS[:1]
    elif kind in SPAN_TYPES:
        pairs = POSITION_PAIRS[1:]
    else:
        return load
    out = dict(load)
    for (rel, absolute), default in zip(pairs, (0.0, 1.0) if kind in SPAN_TYPES else (0.0,)):
        r, a = out.get(rel), out.get(absolute)
        if not isinstance(r, float):
            r = a / length if isinstance(a, float) and length else default
        out[rel] = r
        out[absolute] = a if isinstance(a, float) else r * length
    return out


def definitions(model: Model) -> LoadDefinitions:
    """Every load pattern, case and combo in the model, each case and combo with its effective pattern factors."""
    patterns = {name: LoadPatternDef(type=str(p.get("TYPE", "")), selfWeight=_number(p.get("SELFWEIGHT"), 0.0))
                for name, p in model["load_patterns"].items()}
    cases = {name: LoadCaseDef(type=str(c.get("TYPE", "")), patterns=_terms(c, "LOADPAT"),
                               effective=expand(model, name, "case"))
             for name, c in model["load_cases"].items()}
    combos = {name: LoadComboDef(type=str(c.get("TYPE", "")), cases=_terms(c, "LOADCASE"),
                                 combos=_terms(c, "LOADCOMBO"), effective=expand(model, name, "combo"))
              for name, c in model["combos"].items()}
    return LoadDefinitions(patterns=patterns, cases=cases, combos=combos)


def expand(model: Model, name: str, kind: str = "combo", _seen: Optional[Set[str]] = None) -> Expansion:
    """Effective load pattern factors of a case or combo: {pattern: factor} such that the applied load is the
    sum of each pattern's loads times its factor.

    A static case starting from zero (INITCOND PRESET) is its LOADPAT terms. A Linear Add combo is the sum of its terms' expansions times their
    factors, so combos of combos work. Anything else (envelope, SRSS, absolute or range add, response spectrum,
    modal, a case continuing from another, a missing or circular reference) is not expandable, with the reason, instead of a guess.
    kind is "case" or "combo"; a combo's LOADCASE term may name a case or a combo, a LOADCOMBO term a combo.
    """
    seen = (_seen or set()) | {f"{kind}:{name}"}
    defs = model["load_cases"] if kind == "case" else model["combos"]
    if name not in defs:
        return _no(f"no {kind} named {name}")
    props = defs[name]
    ctype = str(props.get("TYPE", "")).upper()
    if kind == "case":
        if ctype not in STATIC_CASE_TYPES:
            return _no(f"case {name} is {props.get('TYPE', 'untyped')}, not a static case")
        if str(props.get("INITCOND", "PRESET")).upper() != "PRESET":
            return _no(f"case {name} continues from case {props['INITCOND']}")
        if any(":" in k and not k.startswith("LOADPAT:") for k in props):
            return _no(f"case {name} has terms other than load patterns")
        terms = [("pattern", p, f) for p, f in _terms(props, "LOADPAT").items()]
    else:
        if ctype not in LINEAR_COMBO_TYPES:
            return _no(f"combo {name} is {props.get('TYPE', 'untyped')}, only Linear Add expands")
        terms = [(_resolve(model, head, n), n, f) for head in ("LOADCASE", "LOADCOMBO") for n, f in _terms(props, head).items()]
    if any(_factor(v) is None for k, v in props.items() if k.partition(":")[0] in TERM_HEADS):
        return _no(f"{kind} {name} has a term without a plain scale factor")
    total: Dict[str, float] = {}
    for sub_kind, sub, factor in terms:
        if sub_kind == "pattern":
            total[sub] = total.get(sub, 0.0) + factor
            continue
        if f"{sub_kind}:{sub}" in seen:
            return _no(f"{kind} {name} refers back to itself through {sub}")
        inner = expand(model, sub, sub_kind, seen)
        if not inner["expandable"]:
            return _no(f"{kind} {name} uses {sub}: {inner['reason']}")
        for pattern, f in inner["patterns"].items():
            total[pattern] = total.get(pattern, 0.0) + factor * f
    return Expansion(expandable=True, patterns=total, reason=None)


def _resolve(model: Model, term: str, name: str) -> str:
    """Whether a combo term names a case or a combo. LOADCASE prefers a case, LOADCOMBO a combo."""
    if term == "LOADCASE":
        return "case" if name in model["load_cases"] or name not in model["combos"] else "combo"
    return "combo" if name in model["combos"] or name not in model["load_cases"] else "case"


def _terms(props: Props, term: str) -> Dict[str, float]:
    """{target: scale factor} for one term key (LOADPAT, LOADCASE, LOADCOMBO). Terms without a factor are left out."""
    out: Dict[str, float] = {}
    for key, value in props.items():
        head, _, target = key.partition(":")
        factor = _factor(value)
        if head == term and target and factor is not None:
            out[target] = factor
    return out


def _factor(value: Any) -> Optional[float]:
    """A term's scale factor: the parser stores a bare SF as the number, a term with more keys as a dict."""
    if isinstance(value, dict):
        value = cast(Dict[str, Any], value).get("SF")
    return value if isinstance(value, float) else None


def _number(value: Any, default: float) -> float:
    return value if isinstance(value, float) else default


def _no(reason: str) -> Expansion:
    return Expansion(expandable=False, patterns={}, reason=reason)
