"""Cross-model identity. Levels by name (order fallback), elements by level-tied geometry, never labels."""

import math
from collections import Counter, defaultdict
from itertools import product
from typing import Callable, DefaultDict, Dict, List, Literal, Optional, Sequence, Set, Tuple, Union

from .geometry import Element, End, Level
from .parser import XYZ

# A's level name, or ("B", name) for a B level with no A match so it can never share a node with A.
NodeLevel = Union[str, Tuple[str, str]]
Cell = Tuple[NodeLevel, int, int, int]
Pair = Tuple[Element, Element, Literal["exact", "moved"]]
SameAssigns = Callable[[Element, Element], bool]


def match_levels(levels_a: List[Level], levels_b: List[Level]) -> Dict[str, str]:
    """Map level names in B to level names in A.

    Same name first. If the leftover levels on both sides are equal in number, pair them by order
    from the base and treat that as a rename. Anything still unpaired is added or removed.
    """
    names_a = {lv["name"] for lv in levels_a}
    b_to_a = {lv["name"]: lv["name"] for lv in levels_b if lv["name"] in names_a}
    left_a = [lv["name"] for lv in levels_a if lv["name"] not in b_to_a]
    left_b = [lv["name"] for lv in levels_b if lv["name"] not in b_to_a]
    if left_a and len(left_a) == len(left_b):
        b_to_a.update(zip(left_b, left_a))
    return b_to_a


class NodeIndex:
    """Nodes keyed on (level, x, y, dz) with a tolerance on x, y, dz. Levels must match exactly."""

    def __init__(self, tol: float) -> None:
        self.tol = tol
        self.cells: DefaultDict[Cell, List[Tuple[int, XYZ]]] = defaultdict(list)
        self.count = 0

    def _cell(self, level: NodeLevel, p: XYZ) -> Cell:
        x, y, dz = p
        return (level, math.floor(x / self.tol), math.floor(y / self.tol), math.floor(dz / self.tol))

    def find(self, level: NodeLevel, p: XYZ) -> Optional[int]:
        lv, cx, cy, cz = self._cell(level, p)
        best: Optional[int] = None
        best_d = self.tol
        for dx, dy, dzc in product((-1, 0, 1), repeat=3):
            for node_id, q in self.cells[(lv, cx + dx, cy + dy, cz + dzc)]:
                d = math.dist(p, q)
                if d <= best_d:
                    best, best_d = node_id, d
        return best

    def find_or_add(self, level: NodeLevel, p: XYZ) -> int:
        found = self.find(level, p)
        if found is not None:
            return found
        self.count += 1
        self.cells[self._cell(level, p)].append((self.count, p))
        return self.count


def match_elements(
    elems_a: List[Element], elems_b: List[Element], b_to_a: Dict[str, str], elev_a: Dict[str, float], tol: float,
    move_tol: float, same_assigns: SameAssigns,
) -> Tuple[List[Pair], List[Element], List[Element]]:
    """Return (pairs, removed, added). pairs are (a, b, how) with how 'exact' or 'moved'."""
    nodes = NodeIndex(tol)
    for e in elems_a:
        e["nodes"] = [nodes.find_or_add(end["level"], (*end["xyz"][:2], end["dz"])) for end in e["ends"]]
    for e in elems_b:
        e["nodes"] = [
            nodes.find_or_add(b_to_a.get(end["level"], ("B", end["level"])), (*end["xyz"][:2], end["dz"]))
            for end in e["ends"]
        ]

    by_key: DefaultDict[Tuple[str, Tuple[int, ...]], List[Element]] = defaultdict(list)
    for e in elems_a:
        by_key[(e["kind"], tuple(sorted(e["nodes"])))].append(e)
    pairs: List[Pair] = []
    added: List[Element] = []
    for e in elems_b:
        bucket = by_key.get((e["kind"], tuple(sorted(e["nodes"]))))
        if bucket:
            pairs.append((bucket.pop(0), e, "exact"))
        else:
            added.append(e)
    removed = [e for bucket in by_key.values() for e in bucket]

    moved = _moved_pass(removed, added, b_to_a, elev_a, tol, move_tol, same_assigns)
    moved_ids = {id(x) for a, b, _ in moved for x in (a, b)}
    pairs.extend(moved)
    removed = [e for e in removed if id(e) not in moved_ids]
    added = [e for e in added if id(e) not in moved_ids]
    return pairs, removed, added


def _compare_xyz(end: End, b_to_a: Dict[str, str], elev_a: Dict[str, float]) -> XYZ:
    """B end coordinates measured against A's level elevations, so a shifted level adds no distance."""
    x, y, z = end["xyz"]
    a_level = b_to_a.get(end["level"])
    if a_level is not None:
        z = elev_a[a_level] - end["dz"]
    return (x, y, z)


def _moved_pass(
    removed: List[Element], added: List[Element], b_to_a: Dict[str, str], elev_a: Dict[str, float], tol: float,
    move_tol: float, same_assigns: SameAssigns,
) -> List[Pair]:
    """Pair leftover frames of the same type as moved when neither end travelled more than move_tol.
    Frames sharing an end node are always candidates; closest pairs win. Areas and points are not paired here.

    Then, whatever the end travel, a frame that lies on the same line as exactly one other leftover frame of the
    same type, overlaps it by more than tol, and has identical assigns (same_assigns) is paired as moved too.
    Only one-to-one: a beam split in two, or two merged into one, stays removed plus added, because a single
    moved member can't show it and picking one piece would read as a shortened beam plus an unexplained new one.
    """
    rem = [e for e in removed if e["kind"] == "frame"]
    add = [e for e in added if e["kind"] == "frame"]
    if not rem or not add or move_tol <= 0:
        return []
    by_node: DefaultDict[int, List[int]] = defaultdict(list)
    by_cell: DefaultDict[Tuple[int, ...], List[int]] = defaultdict(list)
    for j, b in enumerate(add):
        b["cmp"] = [_compare_xyz(end, b_to_a, elev_a) for end in b["ends"]]
        for n in b["nodes"]:
            by_node[n].append(j)
        by_cell[_mid_cell(b["cmp"], move_tol)].append(j)

    candidates: List[Tuple[bool, float, int, int]] = []  # (colinear rule, travel, i, j): end-travel pairs first
    for i, a in enumerate(rem):
        pa = [end["xyz"] for end in a["ends"]]
        cx, cy, cz = _mid_cell(pa, move_tol)
        near = {j for n in a["nodes"] for j in by_node[n]}
        for d in product((-1, 0, 1), repeat=3):
            near.update(by_cell[(cx + d[0], cy + d[1], cz + d[2])])
        for j in near:
            b = add[j]
            if b["type"] != a["type"]:
                continue
            disp = _travel(pa, b["cmp"])
            if max(disp) <= move_tol:
                candidates.append((False, sum(disp), i, j))

    # ponytail: all leftover pairs, O(removed x added); bucket by line direction if big renumberings get slow
    colinear = [
        (i, j) for i, a in enumerate(rem) for j, b in enumerate(add)
        if b["type"] == a["type"] and overlaps_on_line([end["xyz"] for end in a["ends"]], b["cmp"], tol)
        and same_assigns(a, b)
    ]
    per_a = Counter(i for i, _ in colinear)
    per_b = Counter(j for _, j in colinear)
    for i, j in colinear:
        if per_a[i] == 1 and per_b[j] == 1:
            candidates.append((True, sum(_travel([end["xyz"] for end in rem[i]["ends"]], add[j]["cmp"])), i, j))

    candidates.sort()
    used_a: Set[int] = set()
    used_b: Set[int] = set()
    out: List[Pair] = []
    for _, _, i, j in candidates:
        if i not in used_a and j not in used_b:
            used_a.add(i)
            used_b.add(j)
            out.append((rem[i], add[j], "moved"))
    return out


def _travel(pa: Sequence[XYZ], pb: Sequence[XYZ]) -> Tuple[float, float]:
    """Distance each end moved, taking whichever end pairing (straight or flipped) is shorter in total."""
    straight = (math.dist(pa[0], pb[0]), math.dist(pa[1], pb[1]))
    flipped = (math.dist(pa[0], pb[1]), math.dist(pa[1], pb[0]))
    return min(straight, flipped, key=sum)


def overlaps_on_line(pa: Sequence[XYZ], pb: Sequence[XYZ], tol: float) -> bool:
    """Both of b's ends sit within tol of a's line, and the two share more than tol of its length."""
    length = math.dist(pa[0], pa[1])
    if length <= tol:
        return False
    u = [(q - p) / length for p, q in zip(pa[0], pa[1])]
    ts: List[float] = []
    for p in pb:
        v = [c - o for c, o in zip(p, pa[0])]
        t = sum(x * y for x, y in zip(v, u))
        if math.dist(v, [t * c for c in u]) > tol:
            return False
        ts.append(t)
    return min(length, max(ts)) - max(0.0, min(ts)) > tol


def _mid_cell(pts: Sequence[XYZ], size: float) -> Tuple[int, ...]:
    return tuple(math.floor((p + q) / 2 / size) for p, q in zip(*pts))
