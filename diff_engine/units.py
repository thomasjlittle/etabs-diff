"""Unit normalization. Every parsed value is converted to kN, m, and degrees C."""

FORCE_TO_KN = {
    "KN": 1.0,
    "N": 0.001,
    "LB": 0.00444822162,
    "KIP": 4.44822162,
    "KGF": 0.00980665,
    "TONF": 9.80665,  # metric tonne-force, unconfirmed
}
LENGTH_TO_M = {
    "M": 1.0,
    "MM": 0.001,
    "CM": 0.01,
    "IN": 0.0254,
    "FT": 0.3048,
}

# (force exponent, length exponent) per key, per record keyword.
F, L, FL, F_L, F_L2, F_L3, L2 = (1, 0), (0, 1), (1, 1), (1, -1), (1, -2), (1, -3), (0, 2)
_STRESS = dict.fromkeys(["E", "E1", "E2", "E3", "G", "G1", "G2", "G3", "FY", "FU", "FYE", "FUE", "FC"], F_L2)
_SECTION_DIMS = dict.fromkeys(["D", "B", "T", "T2", "T3", "TF", "TW", "TFB", "T2B", "R", "DIS"], L)

DIMENSIONS = {
    "PREFERENCE": {"MERGETOL": L},
    "STORY": {"HEIGHT": L, "ELEV": L},
    # STRESS (user stress-strain points) is left raw: real LB-FT and LB-IN saves of one model write the same numbers.
    "MATERIAL": {"WEIGHTPERVOLUME": F_L3, **_STRESS},
    "FRAMESECTION": {
        **_SECTION_DIMS,
        **dict.fromkeys(["AREA", "AS2", "AS3"], L2),
        **dict.fromkeys(["I22", "I33", "I23", "J"], (0, 4)),
        **dict.fromkeys(["S22", "S33", "Z22", "Z33"], (0, 3)),
        **dict.fromkeys(["R22", "R33"], L),
    },
    "SHELLPROP": {
        **dict.fromkeys(
            [
                "SLABTHICKNESS", "WALLTHICKNESS", "OVERALLDEPTH", "SLABRIBWIDTHTOP", "SLABRIBWIDTHBOTTOM",
                "SLABRIBSPACING", "DECKSLABDEPTH", "DECKRIBDEPTH", "DECKRIBWIDTHTOP", "DECKRIBWIDTHBOTTOM",
                "DECKRIBSPACING", "DECKSHEARTHICKNESS", "SHEARSTUDDIAM", "SHEARSTUDHEIGHT",
            ],
            L,
        ),
        "DECKUNITWEIGHT": F_L2,
        "SHEARSTUDFU": F_L2,
    },
    "POINTSPRING": dict.fromkeys(["UX", "UY", "UZ"], F_L) | dict.fromkeys(["RX", "RY", "RZ"], FL),
    "LINESPRING": dict.fromkeys(["U1", "U2", "U3"], F_L2) | {"R1": F},
    "AREASPRING": dict.fromkeys(["U1", "U2", "U3"], F_L3),
    "LINEASSIGN": dict.fromkeys(
        ["LENOFFI", "LENOFFJ", "MAXSTASPC", "OFFSETXI", "OFFSETYI", "OFFSETZI", "OFFSETXJ", "OFFSETYJ", "OFFSETZJ"], L
    )
    | dict.fromkeys(["LIMITTENSION", "LIMITCOMPRESSION"], F),
    "AREAASSIGN": {"MAXMESHSIZE": L},
    "POINTLOAD": dict.fromkeys(["FX", "FY", "FZ"], F) | dict.fromkeys(["MX", "MY", "MZ"], FL),
    "LINELOAD": dict.fromkeys(["FVAL", "FSTART", "FEND"], F_L) | dict.fromkeys(["DSTART", "DEND", "DIST"], L),
    # Concentrated and moment loads on frames: the value key means something else per TYPE.
    "LINELOAD:POINTF": {"FVAL": F, "DIST": L},
    "LINELOAD:POINTM": {"FVAL": FL, "DIST": L},
    "LINELOAD:UNIFM": dict.fromkeys(["FVAL", "FSTART", "FEND"], F) | dict.fromkeys(["DSTART", "DEND"], L),
    "LINELOAD:TRAPM": dict.fromkeys(["FVAL", "FSTART", "FEND"], F) | dict.fromkeys(["DSTART", "DEND"], L),
    "AREALOAD": {"FVAL": F_L2},
    "SHELLUNIFORMLOADSET": {"VALUE": F_L2},
}

# Thermal coefficients are per degree, so they scale the other way from temperatures.
THERMAL_KEYS = {"A", "A1", "A2", "A3"}


def factors(units):
    """(force factor, length factor, per-degree factor) for a UNITS triple like ('LB', 'IN', 'F')."""
    force, length, temp = (u.upper() for u in units)
    if force not in FORCE_TO_KN or length not in LENGTH_TO_M:
        raise ValueError(f"unsupported units {units}")
    per_degree = 9.0 / 5.0 if temp == "F" else 1.0
    return FORCE_TO_KN[force], LENGTH_TO_M[length], per_degree


def scale(record, key, value, fac):
    """Convert one numeric value of `record`.`key` to kN/m/C. Unknown keys pass through."""
    if not isinstance(value, float):
        return value
    if record == "MATERIAL" and key in THERMAL_KEYS:
        return value * fac[2]
    dims = DIMENSIONS.get(record, {}).get(key)
    if dims is None:
        return value
    return value * fac[0] ** dims[0] * fac[1] ** dims[1]
