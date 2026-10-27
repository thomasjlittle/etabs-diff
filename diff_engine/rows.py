"""The property table rows each change is tagged with, and which assign keys belong to which row."""

import re

ROWS = {
    1: "members_added_removed",
    2: "member_moved",
    3: "section_reassigned",
    4: "section_definition",
    5: "material_definition",
    6: "property_modifiers",
    7: "releases_offsets_insertion_axis",
    8: "supports_springs",
    9: "loads",
    10: "additional_mass",
}
OTHER = "other"

# Keys that carry no model meaning for the diff.
IGNORED_KEYS = {"USERJOINT", "FILE"}

_MODIFIER = re.compile(r"[A-Z0-9]+MOD")
_ROW7_EXACT = {"ANG", "LENOFFI", "LENOFFJ", "RIGIDZONE", "TRANSFORMSTIFFNESSFOROFFSETS"}
_ROW7_PREFIX = ("RELEASE", "PARTIALFIX", "OFFSET", "LOCALAXIS")


def tag(row):
    """{'row': n, 'category': slug}, or {'row': None, 'category': 'other'}."""
    return {"row": row, "category": ROWS.get(row, OTHER)}


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
