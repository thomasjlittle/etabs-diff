"""Display units follow the parser's normalization rules, never the input file's unit labels."""

from typing import Any, Dict, List, Optional, cast

from .units import DIMENSIONS, THERMAL_KEYS, Dims

UNIT_LABELS: Dict[Dims, str] = {
    (1, 0): "kip", (0, 1): "in", (1, 1): "kip-in", (1, -1): "kip/in",
    (1, -2): "ksi", (1, -3): "kip/in^3", (0, 2): "in^2", (0, 3): "in^3", (0, 4): "in^4",
}


def unit_for(record: str, key: str) -> Optional[str]:
    if record == "LOADPATTERN" and key.startswith("SEISMIC:"):
        return unit_for("SEISMIC", key.split(":")[1])
    if record == "MATERIAL" and key in THERMAL_KEYS:
        return "1/degF"
    if key in ("ANG", "ANGLE", "LOCALAXIS"):
        return "deg"
    if (record == "LOADCASE" and key.startswith("ACCEL:")) or (record == "LOADCASE:ACCEL" and key == "SF"):
        return "in/s^2"
    dims = DIMENSIONS.get(record, {}).get(key)
    return UNIT_LABELS.get(dims) if dims is not None else None


def value_units(record: str, key: str, value: Any, path: str = "") -> Dict[str, Optional[str]]:
    """Units keyed by dot-separated leaf paths for values containing several physical dimensions."""
    if isinstance(value, list):
        out: Dict[str, Optional[str]] = {}
        for index, item in enumerate(cast(List[Any], value)):
            out.update(value_units(record, key, item, f"{path}.{index}".lstrip(".")))
        return out
    if isinstance(value, dict):
        out = {}
        fields = cast(Dict[str, Any], value)
        # The parser has special normalization for concentrated forces/moments and distributed moments.
        load_type = fields.get("TYPE")
        nested_record = f"{record}:{load_type}" if f"{record}:{load_type}" in DIMENSIONS else record
        if record == "LOADCASE" and key.startswith("ACCEL:"):
            nested_record = "LOADCASE:ACCEL"
        for field, item in fields.items():
            out.update(value_units(nested_record, field, item, f"{path}.{field}".lstrip(".")))
        return out
    return {path: unit_for(record, key) if isinstance(value, (int, float)) else None}
