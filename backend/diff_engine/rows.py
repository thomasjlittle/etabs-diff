"""The change list rows each change is tagged with, and which assign keys belong to which row."""

import re
from typing import Dict, List, Optional

from .contract import Affect

# Row numbers follow the change list (1 to 17): 1 geometry (members, nodes, shells added / removed /
# moved, story elevation), 2 section reassigned, 3 section definition, 4 material, 5 property modifiers,
# 6 releases / offsets / insertion point / local axis, 7 nodes modified, 8 supports and springs,
# 9 applied loads, 10 additional mass, 11 mass source, 12 load patterns, 13 load cases, 14 combos,
# 15 walls and slabs added / removed, 16 diaphragms, 17 spectrum and time history functions.
# None means a change outside the list (meshing, piers, ...).

# Keys that carry no model meaning for the diff.
IGNORED_KEYS = {"USERJOINT", "FILE"}

# Section-level modifiers end in MOD (I3MOD); member-level ones start with PROPMOD (PROPMODI33).
_MODIFIER = re.compile(r"[A-Z0-9]+MOD|PROPMOD[A-Z0-9]+")
_MASS_MODIFIERS = {"MMOD", "WMOD", "PROPMODM", "PROPMODW"}
_ROW6_EXACT = {"ANG", "LENOFFI", "LENOFFJ", "LENGTHOFFI", "LENGTHOFFJ", "RIGIDZONE", "TRANSFORMSTIFFNESSFOROFFSETS"}
_ROW6_PREFIX = ("RELEASE", "PARTIALFIX", "OFFSET", "LOCALAXIS")

_ROW_AFFECTS: Dict[int, List[Affect]] = {
    1: ["geometry", "stiffness", "mass"],
    2: ["stiffness", "mass"],
    3: ["stiffness", "mass"],
    4: ["stiffness", "mass"],
    5: ["stiffness", "mass"],
    6: ["stiffness"],
    8: ["stiffness"],
    9: ["load"],
    10: ["mass"],
    11: ["mass"],
    12: ["load"],
    13: ["load"],
    14: ["load"],
    15: ["geometry", "stiffness", "mass"],
    16: ["stiffness", "mass"],
    17: ["load"],
}

# Definition table kind -> row, for every key that isn't a modifier.
_DEFINITION_ROW = {
    "frame_section": 3, "shell_prop": 3, "material": 4, "spring": 8, "load_set": 9, "mass_source": 11,
    "load_pattern": 12, "load_case": 13, "analysis": 13, "combo": 14, "diaphragm": 16, "function": 17,
}


def affects(row: Optional[int], key: str = "") -> List[Affect]:
    """What a change touches, for the contract's `affects` list."""
    if key == "WEIGHTPERVOLUME" or key in _MASS_MODIFIERS:
        return ["mass"]
    return list(_ROW_AFFECTS.get(row, [])) if row is not None else []


def assign_row(key: str) -> Optional[int]:
    """Row for one per-element assign key (LINEASSIGN, AREAASSIGN, POINTASSIGN)."""
    if key in ("SECTION", "MATERIALOVERWRITE"):
        return 2
    if _MODIFIER.fullmatch(key):
        return 5
    if key == "RESTRAINT" or "SPRING" in key:
        return 8
    if key == "DIAPH":
        return 16
    if "MASS" in key:
        return 10
    if key in _ROW6_EXACT or key.startswith(_ROW6_PREFIX) or "CARDINAL" in key:
        return 6
    return None


def definition_row(kind: str, key: str) -> Optional[int]:
    """Row for one key of a definition: modifiers on a section are row 5, the rest by table."""
    if kind in ("frame_section", "shell_prop") and _MODIFIER.fullmatch(key):
        return 5
    return _DEFINITION_ROW.get(kind)
