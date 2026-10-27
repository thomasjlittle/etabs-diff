"""Shared schema. Source of truth for Model and Diff.

frontend/src/types.ts mirrors this file. Change both together, and only with the diff engine owner.
Units: kip and inch throughout.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

Vec3 = tuple[float, float, float]
Props = dict[str, str | int | float]  # raw keyword/value pairs
Affects = Literal["geometry", "stiffness", "mass", "load"]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Meta(Strict):
    file: str
    etabsVersion: str
    sourceUnits: str


class Story(Strict):
    name: str
    elev: float  # in


class Node(Strict):
    id: str  # f"{label}@{story}"
    label: str
    story: str
    xyz: Vec3  # global, in
    props: Props  # restraints, springs, added mass


class Frame(Strict):
    id: str  # f"{label}@{story}", e.g. "B23@L4"
    label: str
    story: str
    kind: Literal["beam", "column", "brace"]
    nodes: tuple[str, str]  # Node ids, i then j
    i: Vec3
    j: Vec3
    section: str
    props: Props  # releases, modifiers, offsets, local axis, added mass


class Area(Strict):
    id: str
    label: str
    story: str
    kind: Literal["wall", "slab"]
    nodes: list[str]
    corners: list[Vec3]
    section: str
    props: Props  # modifiers, diaphragm, pier / spandrel


class Load(Strict):
    id: str  # f"{on}|{pattern}|{type}|{dir}"
    on: str  # Node, Frame or Area id
    pattern: str
    type: str
    dir: str
    values: list[float]  # kip, in


class Combo(Strict):
    type: str
    factors: dict[str, float]


class Model(Strict):
    meta: Meta
    stories: list[Story]  # top down as in file
    nodes: list[Node]  # 2nd pass
    frames: list[Frame]
    areas: list[Area]  # stretch, but 1D shell modifiers need it
    loads: list[Load]  # 2nd pass
    materials: dict[str, Props]
    frameSections: dict[str, Props]  # props["material"] always set
    shellSections: dict[str, Props]  # props["material"] always set
    loadPatterns: dict[str, Props]
    loadCases: dict[str, Props]
    combos: dict[str, Combo]
    massSource: dict[str, Props]  # 3rd pass
    unparsed: list[str]  # section headers we skipped


class Change(Strict):
    field: str
    before: Any
    after: Any
    affects: list[Affects]


class SetDiff(Strict):
    added: list[str]
    removed: list[str]
    modified: dict[str, list[Change]]


class FrameDiff(SetDiff):
    matchedBy: dict[str, Literal["label", "geometry"]]


class Diff(Strict):
    frames: FrameDiff
    tables: dict[str, SetDiff]  # keyed by Model field: stories, nodes, areas, loads, materials, ...
