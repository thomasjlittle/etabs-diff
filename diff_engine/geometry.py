"""Turn a parsed model into levels and story-placed elements with level-tied geometry."""

import logging
from typing import Dict, List, Optional, TypedDict

from .contract import Kind
from .parser import XYZ, Model, ObjectKey, Props

log = logging.getLogger(__name__)


class Level(TypedDict):
    name: str
    elevation: float  # inches
    height: Optional[float]


class End(TypedDict):
    point: str
    level: str  # level the end is tied to
    dz: float  # offset below that level
    xyz: XYZ  # global, for drawing and the moved pass


class Element(TypedDict):
    kind: Kind
    type: str  # ETABS object type: BEAM, COLUMN, FLOOR, POINT, ...
    label: str
    story: str
    ends: List[End]
    props: Props
    loads: List[Props]
    nodes: List[int]  # node ids, filled in by match.match_elements
    cmp: List[XYZ]  # B ends against A's level elevations, filled in by the moved pass for added frames


def levels(model: Model) -> List[Level]:
    """Levels bottom to top: [{name, elevation, height}]. The file lists them top down, base last."""
    rows = list(reversed(model["stories"]))
    out: List[Level] = []
    for i, story in enumerate(rows):
        if i == 0:
            elev = story.get("ELEV", 0.0)
        else:
            elev = out[-1]["elevation"] + story.get("HEIGHT", 0.0)
        out.append(Level(name=story["name"], elevation=elev, height=story.get("HEIGHT")))
    return out


def elements(model: Model) -> List[Element]:
    """Every frame, area, and point object placed at a story. Labels are carried as info only."""
    lv = levels(model)
    index = {level["name"]: i for i, level in enumerate(lv)}

    def end(point: str, story: str, below: int = 0) -> End:
        i = index[story] - below
        if i < 0:
            raise ValueError(f"object runs below the base level from {story}")
        x, y, dz = model["points"][point]
        level = lv[i]
        return End(point=point, level=level["name"], dz=dz, xyz=(x, y, level["elevation"] - dz))

    out: List[Element] = []
    for (label, story), props in model["line_assigns"].items():
        line = model["lines"].get(label)
        if line is None or story not in index:
            log.warning("line assign without a line or story: %s @ %s", label, story)
            continue
        try:
            ends = [end(line["i"], story, line["n"]), end(line["j"], story)]
        except (KeyError, ValueError) as exc:
            log.warning("skipping line %s @ %s: %s", label, story, exc)
            continue
        out.append(_element("frame", line["type"], label, story, ends, props, model["line_loads"]))

    for (label, story), props in model["area_assigns"].items():
        area = model["areas"].get(label)
        if area is None or story not in index:
            log.warning("area assign without an area or story: %s @ %s", label, story)
            continue
        try:
            ends = [end(p, story, o) for p, o in zip(area["points"], area["offsets"])]
        except (KeyError, ValueError) as exc:
            log.warning("skipping area %s @ %s: %s", label, story, exc)
            continue
        out.append(_element("area", area["type"], label, story, ends, props, model["area_loads"]))

    # Every joint, bare ones included, so a joint that gains or loses an assign still matches its
    # other side. diff.py decides which of them are listed.
    assigned = set(model["point_assigns"]) | set(model["point_loads"])
    joints = {(end_["point"], end_["level"]) for e in out for end_ in e["ends"]}
    for label, story in sorted(assigned | joints):
        if label not in model["points"] or story not in index:
            log.warning("point assign without a point or story: %s @ %s", label, story)
            continue
        props = model["point_assigns"].get((label, story), {})
        out.append(_element("point", "POINT", label, story, [end(label, story)], props, model["point_loads"]))
    return out


def _element(
    kind: Kind, etype: str, label: str, story: str, ends: List[End], props: Props, loads: Dict[ObjectKey, List[Props]]
) -> Element:
    return Element(
        kind=kind, type=etype, label=label, story=story, ends=ends, props=props,
        loads=loads.get((label, story), []), nodes=[], cmp=[],
    )
