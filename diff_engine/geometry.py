"""Turn a parsed model into levels and story-placed elements with level-tied geometry."""

import logging

log = logging.getLogger(__name__)

# Point assign keys that alone do not make a point worth reporting.
BORING_POINT_KEYS = {"USERJOINT"}


def levels(model):
    """Levels bottom to top: [{name, elevation, height}]. The file lists them top down, base last."""
    rows = list(reversed(model["stories"]))
    out = []
    for i, story in enumerate(rows):
        if i == 0:
            elev = story.get("ELEV", 0.0)
        else:
            elev = out[-1]["elevation"] + story.get("HEIGHT", 0.0)
        out.append({"name": story["name"], "elevation": elev, "height": story.get("HEIGHT")})
    return out


def elements(model):
    """Every frame, area, and point object placed at a story. Labels are carried as info only."""
    lv = levels(model)
    index = {level["name"]: i for i, level in enumerate(lv)}

    def end(point, story, below=0):
        i = index[story] - below
        if i < 0:
            raise ValueError(f"object runs below the base level from {story}")
        x, y, dz = model["points"][point]
        level = lv[i]
        return {"point": point, "level": level["name"], "dz": dz, "xyz": (x, y, level["elevation"] - dz)}

    out = []
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

    keys = sorted(set(model["point_assigns"]) | set(model["point_loads"]))
    for label, story in keys:
        props = model["point_assigns"].get((label, story), {})
        if not (set(props) - BORING_POINT_KEYS) and (label, story) not in model["point_loads"]:
            continue
        if label not in model["points"] or story not in index:
            log.warning("point assign without a point or story: %s @ %s", label, story)
            continue
        ends = [end(label, story)]
        out.append(_element("point", "POINT", label, story, ends, props, model["point_loads"]))
    return out


def _element(kind, etype, label, story, ends, props, loads):
    return {
        "kind": kind,
        "type": etype,
        "label": label,
        "story": story,
        "ends": ends,
        "props": props,
        "loads": loads.get((label, story), []),
    }
