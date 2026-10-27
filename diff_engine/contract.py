"""The viewer's output contract (output-contract.ts, schemaVersion 0.1) as Python types.

TypedDicts are plain dicts at runtime, so the engine's result is the JSON as-is. Field names match the
TypeScript contract exactly. Fields marked extension are additive and a viewer can ignore them.
"""

from typing import Any, Dict, List, Literal, Optional, TypedDict

Vec3 = List[float]  # global X, Y, Z in inches, for drawing only (B's coordinates; A's for removed)
Affect = Literal["geometry", "stiffness", "mass", "load"]
Status = Literal["unchanged", "added", "removed", "modified", "affected"]
Kind = Literal["point", "frame", "area"]
Subtype = Literal["beam", "column", "brace", "floor", "wall", "other", "joint"]


class _Change(TypedDict):
    field: str
    before: Any
    after: Any
    affects: List[Affect]


class Change(_Change, total=False):
    row: Optional[int]  # extension: property table row, None when outside the table


class _ElementDiff(TypedDict):
    key: str  # geometric match key: level-relative (story, x, y, dz), tolerance-rounded; never a label
    kind: Kind  # points: only those with a restraint, spring, mass, or load
    subtype: Subtype
    label: str  # display only (B's label, A's when removed)
    story: str  # story the element is tied to (B's, A's when removed)
    status: Status
    geometry: List[Vec3]  # point: [xyz]; frame: [i, j]; area: corners in drawing order
    changes: List[Change]  # empty when unchanged, added, removed; for affected, the upstream definition changes


class ElementDiff(_ElementDiff, total=False):
    via: List[str]  # e.g. ["frameSection:W14X22", "material:A992Fy50"]
    movedTo: str  # extension: key of the added entry this removed frame moved to
    movedFrom: str  # extension: key of the removed entry this added frame moved from


class TableDiff(TypedDict):
    added: List[str]
    removed: List[str]
    modified: Dict[str, List[Change]]


class ModelMeta(TypedDict):
    file: str
    etabsVersion: str
    units: str


class _Meta(TypedDict):
    a: ModelMeta
    b: ModelMeta
    lengthUnit: Literal["in"]
    tolerance: float  # inches; default from PREFERENCE MERGETOL


class Meta(_Meta, total=False):
    forceUnit: Literal["kip"]  # extension
    moveTolerance: float  # extension, inches


class Story(TypedDict):
    name: str
    elevA: Optional[float]  # inches, None when absent on that side
    elevB: Optional[float]


class _Tables(TypedDict):
    stories: TableDiff
    materials: TableDiff
    frameSections: TableDiff
    shellSections: TableDiff
    pointSprings: TableDiff
    loadPatterns: TableDiff


class Tables(_Tables, total=False):
    lineSprings: TableDiff  # extension
    areaSprings: TableDiff  # extension
    loadSets: TableDiff  # extension


class DiffOutput(TypedDict):
    schemaVersion: Literal["0.1"]
    meta: Meta
    stories: List[Story]  # bottom up
    elements: List[ElementDiff]  # every element in the union of A and B
    tables: Tables
    summary: Dict[Status, int]
