"""Conservative plan references on unrotated global Cartesian grids."""

from typing import List, Optional, Tuple

from .geometry import Element
from .parser import Model, Props


def _global_cartesian(props: Props) -> bool:
    if str(props.get("TYPE", "CARTESIAN")).upper() != "CARTESIAN":
        return False
    # Do not guess references on transformed systems. Styling fields do not affect coordinates.
    return not any(value not in (0, 0.0, "0", "0.0") for key, value in props.items()
                   if "ORIGIN" in key or "ANG" in key or key in ("RZ", "ROTATION"))


def grid_reference(model: Model, element: Element, tolerance: float) -> Optional[str]:
    """Every vertex must sit on one X and one Y line within the normalized match tolerance.

    Ambiguous intersections, off-grid vertices, and unsupported coordinate systems return None.
    Multiple systems are qualified by name so their labels cannot be confused.
    """
    matches: List[str] = []
    for system, lines in model["grids"].items():
        if not _global_cartesian(model["grid_systems"].get(system, {})):
            continue
        axes: List[str] = []
        for axis, coordinate in (("X", 0), ("Y", 1)):
            hits: List[Tuple[float, str]] = []
            for end in element["ends"]:
                candidates = {(float(line["COORD"]), str(line["LABEL"])) for line in lines
                              if str(line.get("DIR", "")).upper() == axis
                              and isinstance(line.get("COORD"), (float, int)) and "LABEL" in line
                              and abs(float(line["COORD"]) - end["xyz"][coordinate]) <= tolerance}
                if len(candidates) != 1:
                    break
                hits.append(next(iter(candidates)))
            else:
                axes.append("-".join(label for _, label in sorted(set(hits))))
        if len(axes) == 2:
            reference = "/".join(axes)
            matches.append(f"{system}:{reference}" if len(model["grids"]) > 1 else reference)
    return matches[0] if len(matches) == 1 else None
