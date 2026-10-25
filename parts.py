"""
parts.py — the jet loadout earned during the quiz.

Five slots. Five rarity tiers. Correct answers award parts, and the hotter the
question the better the drop, so the questions nobody wanted are the ones worth
taking. A better part in a slot you already filled upgrades it; a worse one is
discarded (and the player is told, so an upgrade feels like something).

A sabotaged answer installs a FAULTY part: it looks and scores like the real
thing, and then fails somewhere in the middle of the dogfight.
"""

import random
from typing import Dict, List, Optional

SLOTS = ["engine", "guns", "missiles", "wings", "armor"]

SLOT_LABEL = {
    "engine": "ENGINE",
    "guns": "GUNS",
    "missiles": "MISSILES",
    "wings": "WINGS",
    "armor": "ARMOR",
}

TIERS = ["common", "uncommon", "rare", "epic", "legendary"]

TIER_COLOR = {
    "common":    "#7d879c",
    "uncommon":  "#30a46c",
    "rare":      "#3e8fff",
    "epic":      "#8e4ec6",
    "legendary": "#f5a524",
    "faulty":    "#e5484d",
}

TIER_RANK = {t: i for i, t in enumerate(TIERS)}

# Drop weights by question heat. A fresh question is mostly junk; a question
# that's been shoved around the table three times can pay out legendary.
HEAT_WEIGHTS = {
    0: [58, 30, 10, 2, 0],
    1: [34, 36, 22, 7, 1],
    2: [18, 32, 30, 16, 4],
    3: [8, 22, 32, 27, 11],
    4: [3, 14, 28, 33, 22],
}


def weights_for(heat: int) -> List[int]:
    return HEAT_WEIGHTS[min(4, max(0, heat))]


# ---------------------------------------------------------------------------
# CATALOG
# Each part lists the stats it contributes. Numbers are deliberately readable:
# thrust and turn are the two that decide most fights.
# ---------------------------------------------------------------------------

CATALOG: Dict[str, List[dict]] = {
    "engine": [
        {"name": "EMBER-1",    "tier": "common",    "thrust": 100, "accel": 55,  "mass": 10},
        {"name": "FLINT-3",    "tier": "uncommon",  "thrust": 118, "accel": 66,  "mass": 10},
        {"name": "CORVID",     "tier": "rare",      "thrust": 136, "accel": 78,  "mass": 11},
        {"name": "PYRE-9",     "tier": "epic",      "thrust": 155, "accel": 92,  "mass": 12},
        {"name": "SUNDERER",   "tier": "legendary", "thrust": 178, "accel": 110, "mass": 13},
    ],
    "guns": [
        {"name": "TIN RATTLER", "tier": "common",    "dps": 9,  "rof": 5.0, "dmg": 4,  "spread": 7.0, "mass": 5},
        {"name": "HORNET-2",    "tier": "uncommon",  "dps": 13, "rof": 6.0, "dmg": 5,  "spread": 5.5, "mass": 5},
        {"name": "SHRIKE",      "tier": "rare",      "dps": 18, "rof": 7.5, "dmg": 6,  "spread": 4.0, "mass": 6},
        {"name": "VULTURE",     "tier": "epic",      "dps": 24, "rof": 9.0, "dmg": 7,  "spread": 3.0, "mass": 7},
        {"name": "STORMCALLER", "tier": "legendary", "dps": 32, "rof": 11.0, "dmg": 9, "spread": 2.0, "mass": 8},
    ],
    "missiles": [
        {"name": "STUB RACK",  "tier": "common",    "count": 1, "dmg": 22, "track": 1.4, "mass": 6},
        {"name": "DARTPOD",    "tier": "uncommon",  "count": 2, "dmg": 26, "track": 1.8, "mass": 7},
        {"name": "LANCE-4",    "tier": "rare",      "count": 3, "dmg": 30, "track": 2.3, "mass": 8},
        {"name": "WASPNEST",   "tier": "epic",      "count": 4, "dmg": 34, "track": 2.9, "mass": 9},
        {"name": "JUDGEMENT",  "tier": "legendary", "count": 6, "dmg": 40, "track": 3.6, "mass": 10},
    ],
    "wings": [
        {"name": "PLATE FINS",   "tier": "common",    "turn": 95,  "mass": 8},
        {"name": "CLIPPED DELTA","tier": "uncommon",  "turn": 112, "mass": 8},
        {"name": "GRIDWING",     "tier": "rare",      "turn": 130, "mass": 9},
        {"name": "CANARD-X",     "tier": "epic",      "turn": 150, "mass": 9},
        {"name": "VECTORVANE",   "tier": "legendary", "turn": 175, "mass": 10},
    ],
    "armor": [
        {"name": "FOIL WRAP",   "tier": "common",    "hp": 70,  "mass": 6},
        {"name": "RIVET PLATE", "tier": "uncommon",  "hp": 88,  "mass": 9},
        {"name": "CERAMIC",     "tier": "rare",      "hp": 108, "mass": 12},
        {"name": "CARBON WEAVE","tier": "epic",      "hp": 130, "mass": 14},
        {"name": "AEGIS",       "tier": "legendary", "hp": 158, "mass": 16},
    ],
}

# What a slot contributes when it is empty — you can still fly, badly.
EMPTY = {
    "engine":   {"thrust": 62,  "accel": 34, "mass": 0},
    "guns":     {"dps": 5, "rof": 3.0, "dmg": 3, "spread": 11.0, "mass": 0},
    "missiles": {"count": 0, "dmg": 0, "track": 0.0, "mass": 0},
    "wings":    {"turn": 70, "mass": 0},
    "armor":    {"hp": 55, "mass": 0},
}


def roll_part(heat: int, slot: Optional[str] = None) -> dict:
    """Draw one part, tier weighted by how hot the question was."""
    slot = slot or random.choice(SLOTS)
    tier = random.choices(TIERS, weights=weights_for(heat), k=1)[0]
    base = next(p for p in CATALOG[slot] if p["tier"] == tier)
    part = dict(base)
    part["slot"] = slot
    part["faulty"] = False
    return part


def make_faulty(slot: Optional[str] = None, heat: int = 0) -> dict:
    """
    A sabotaged part. It presents as a real part of its tier — the player sees
    a normal drop — but it is flagged to fail partway through the dogfight.
    """
    part = roll_part(max(1, heat), slot)
    part["faulty"] = True
    return part


def better(new: dict, old: Optional[dict]) -> bool:
    """A higher tier wins the slot. A faulty part never displaces a clean one."""
    if old is None:
        return True
    if old.get("faulty") and not new.get("faulty"):
        return True
    if new.get("faulty") and not old.get("faulty"):
        return False
    return TIER_RANK[new["tier"]] > TIER_RANK[old["tier"]]


def public_part(part: Optional[dict], slot: str) -> Optional[dict]:
    """What a player is shown. Faulty parts look completely normal."""
    if part is None:
        return None
    return {
        "slot": slot,
        "name": part["name"],
        "tier": part["tier"],
        "color": TIER_COLOR[part["tier"]],
    }


class Loadout:
    """One player's jet, assembled over the course of the quiz."""

    def __init__(self):
        self.parts: Dict[str, Optional[dict]] = {s: None for s in SLOTS}

    def award(self, part: dict) -> dict:
        """
        Fit a part. Returns what happened so the UI can celebrate properly:
        a first fit, an upgrade, or a part that wasn't good enough.
        """
        slot = part["slot"]
        old = self.parts[slot]
        if better(part, old):
            self.parts[slot] = part
            return {
                "fitted": True,
                "upgrade": old is not None,
                "slot": slot,
                "part": public_part(part, slot),
                "replaced": public_part(old, slot),
            }
        return {
            "fitted": False, "upgrade": False, "slot": slot,
            "part": public_part(part, slot),
            "kept": public_part(old, slot),
        }

    def stat(self, slot: str, key: str):
        p = self.parts[slot]
        if p is None or key not in p:
            return EMPTY[slot].get(key, 0)
        return p[key]

    def mass(self) -> float:
        return 22 + sum((p["mass"] if p else 0) for p in self.parts.values())

    def faulty_slots(self) -> List[str]:
        return [s for s, p in self.parts.items() if p and p.get("faulty")]

    def filled(self) -> int:
        return sum(1 for p in self.parts.values() if p)

    def rating(self) -> int:
        """A single number for the build, so the lobby can rank jets."""
        score = 0
        for p in self.parts.values():
            if p:
                score += (TIER_RANK[p["tier"]] + 1) * 20
        return score

    def flight_stats(self) -> dict:
        """Turn the loadout into the numbers the dogfight actually flies on."""
        m = self.mass()
        thrust = self.stat("engine", "thrust")
        accel = self.stat("engine", "accel")
        turn = self.stat("wings", "turn")

        # Heavier jets are slower and lazier in the turn, but gently — a fully
        # kitted jet must beat a bare one outright, or upgrades feel like a
        # punishment and nobody chases the rare drops.
        mass_factor = (45.0 / m) ** 0.45
        return {
            "maxSpeed": thrust * mass_factor * 1.55,
            "accel": accel * mass_factor * 1.6,
            "turnRate": turn * (0.55 + 0.45 * mass_factor),
            "hp": self.stat("armor", "hp"),
            "rof": self.stat("guns", "rof"),
            "bulletDmg": self.stat("guns", "dmg"),
            "spread": self.stat("guns", "spread"),
            "missiles": self.stat("missiles", "count"),
            "missileDmg": self.stat("missiles", "dmg"),
            "missileTrack": self.stat("missiles", "track"),
            "mass": m,
        }

    def public(self) -> dict:
        return {
            "parts": {s: public_part(self.parts[s], s) for s in SLOTS},
            "rating": self.rating(),
            "filled": self.filled(),
        }
