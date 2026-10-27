"""The property table rows each change is tagged with, and which assign keys belong to which row."""

import re

# Row numbers follow the property table: 1 members added/removed, 2 moved (incl. story elevation),
# 3 section reassigned, 4 section definition, 5 material, 6 property modifiers,
# 7 releases/offsets/insertion/local axis, 8 supports and springs, 9 loads, 10 additional mass.
# None means a change outside the table (meshing, diaphragms, piers, ...).

# Keys that carry no model meaning for the diff.
IGNORED_KEYS = {"USERJOINT", "FILE"}

_MODIFIER = re.compile(r"[A-Z0-9]+MOD")
_ROW7_EXACT = {"ANG", "LENOFFI", "LENOFFJ", "RIGIDZONE", "TRANSFORMSTIFFNESSFOROFFSETS"}
_ROW7_PREFIX = ("RELEASE", "PARTIALFIX", "OFFSET", "LOCALAXIS")


_ROW_AFFECTS = {
    1: ["geometry", "stiffness", "mass"],
    2: ["geometry"],
    3: ["stiffness", "mass"],
    4: ["stiffness", "mass"],
    5: ["stiffness", "mass"],
    6: ["stiffness", "mass"],
    7: ["stiffness"],
    8: ["stiffness"],
    9: ["load"],
    10: ["mass"],
}


def affects(row, key=""):
    """What a change touches, for the contract's `affects` list."""
    if key == "WEIGHTPERVOLUME" or key in ("MMOD", "WMOD"):
        return ["mass"]
    return list(_ROW_AFFECTS.get(row, []))


def assign_row(key):
    """Row for one per-element assign key (LINEASSIGN, AREAASSIGN, POINTASSIGN)."""
    if key in ("SECTION", "MATERIALOVERWRITE"):
        return 3
    if _MODIFIER.fullmatch(key):
        return 6
    if key == "RESTRAINT" or "SPRING" in key:
        return 8
    if "MASS" in key:
        return 10
    if key in _ROW7_EXACT or key.startswith(_ROW7_PREFIX) or "CARDINAL" in key:
        return 7
    return None


def definition_row(kind, key):
    """Row for one key of a definition: modifiers on a section are row 6, the rest row 4."""
    if kind == "material":
        return 5
    if kind in ("frame_section", "shell_prop"):
        return 6 if _MODIFIER.fullmatch(key) else 4
    if kind == "spring":
        return 8
    return 9
