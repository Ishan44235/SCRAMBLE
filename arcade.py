"""
arcade.py — ARCADE mode: the round is mini-games instead of trivia.

Five games, one control (tilt), five seconds each. They cycle, and every
clear bumps that pilot's level, which tightens the next one:

  RING RUN      steer THROUGH   fly the gates before they pass you
  MISSILE DODGE steer AWAY      survive the volley
  CANYON RUN    steer BETWEEN   stay inside a winding canyon
  LOCK-ON       steer ONTO      hold a jinking bogey in the reticle
  SUPPLY DROP   steer UNDER     catch the falling crates, dodge the bombs

Clearing level N rolls a part at heat N-1, so the ladder pays better the
further up it goes. A part that isn't an upgrade lands as a crate with a
fuse — claim it, or shove it at a neighbour for a tier bump. In arcade the
fuse is harmless: it scraps the crate rather than tearing a fitted part off
the jet, because losing progress you earned in a dexterity game reads as the
game cheating rather than as a risk you took.

The server owns level and reward. The client owns the frames.
"""

import random

# ---------------------------------------------------------------------------
# THE LADDER
# ---------------------------------------------------------------------------

GAMES = ["rings", "dodge", "canyon", "lockon", "supply"]

TARGET_SECONDS = 5.0     # every game resolves in about this long, at every level
MAX_LEVEL = 12           # past here the spec stops tightening, so it stays fair
BEAT_SECONDS = 1.6       # pause between one game resolving and the next arriving

GAME_TITLE = {
    "rings": "RING RUN",
    "dodge": "MISSILE DODGE",
    "canyon": "CANYON RUN",
    "lockon": "LOCK-ON",
    "supply": "SUPPLY DROP",
}

GAME_HINT = {
    "rings": "TILT TO FLY THROUGH THE GATES",
    "dodge": "TILT TO SLIP THE MISSILES",
    "canyon": "TILT TO STAY OFF THE WALLS",
    "lockon": "TILT TO HOLD HIM IN THE RETICLE",
    "supply": "TILT TO CATCH CRATES — DODGE THE BOMBS",
}


def game_for(level: int) -> str:
    """Cycle the games so nobody gets the same one twice running."""
    return GAMES[(max(1, level) - 1) % len(GAMES)]


def heat_for(level: int) -> int:
    """
    Drop quality, on the same 0-4 scale the quiz uses for question heat.

    Level 1 pays like a cold question; level 5 and up can pay legendary.
    """
    return max(0, min(4, level - 1))


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * max(0.0, min(1.0, t))


def spec_for(level: int) -> dict:
    """
    The numbers the phone needs to run one game at this level.

    Every game is tuned to resolve in about TARGET_SECONDS whatever the
    level — the ladder makes a game harder, never longer. A five-second
    game that becomes a nine-second game stops being an interruption and
    starts being a chore.
    """
    level = max(1, int(level))
    t = min(1.0, (level - 1) / float(MAX_LEVEL - 1))
    kind = game_for(level)

    spec = {
        "kind": kind,
        "level": level,
        "seconds": TARGET_SECONDS,
        "title": GAME_TITLE[kind],
        "hint": GAME_HINT[kind],
    }

    if kind == "rings":
        # More gates in the same five seconds, offset further from centre,
        # and a tighter hoop to put the nose through.
        count = int(round(lerp(3, 6, t)))
        spec["count"] = count
        spec["spread"] = round(lerp(0.42, 0.86, t), 3)
        spec["radius"] = round(lerp(1.0, 0.62, t), 3)
        spec["needed"] = max(1, int(round(count * lerp(0.5, 0.8, t))))

    elif kind == "dodge":
        # A real barrage: several rockets from the start, more and faster as
        # the ladder climbs, some fired in pairs. A shield soaks one hit so a
        # dense volley is a test of nerve rather than a coin toss.
        spec["count"] = int(round(lerp(4, 10, t)))
        spec["track"] = round(lerp(0.35, 0.95, t), 3)
        spec["blast"] = round(lerp(28, 36, t), 1)
        spec["stagger"] = round(lerp(0.85, 0.36, t), 3)
        spec["pairs"] = round(lerp(0.0, 0.5, t), 2)
        spec["shield"] = 1

    elif kind == "canyon":
        # Narrower gap, tighter bends, faster scroll.
        spec["gap"] = round(lerp(0.58, 0.34, t), 3)
        spec["wiggle"] = round(lerp(0.7, 1.6, t), 3)
        spec["amp"] = round(lerp(0.22, 0.34, t), 3)
        spec["speed"] = round(lerp(1.0, 1.7, t), 3)

    elif kind == "supply":
        # More crates to catch, falling faster, with bombs mixed in.
        count = int(round(lerp(5, 9, t)))
        spec["count"] = count
        spec["needed"] = max(2, int(round(count * lerp(0.55, 0.78, t))))
        spec["fall"] = round(lerp(1.35, 0.8, t), 3)
        spec["bombs"] = int(round(lerp(0, 4, t)))

    else:
        # Hold him in the reticle. The bogey jinks harder and the cone
        # narrows, but the hold itself never grows past about half the game.
        spec["hold"] = round(lerp(1.0, 2.4, t), 2)
        spec["jink"] = round(lerp(0.55, 1.9, t), 3)
        spec["cone"] = round(lerp(1.0, 0.55, t), 3)

    return spec


def brief_lines(level: int) -> list:
    """Three short lines for the phase brief, naming what is coming."""
    kind = game_for(level)
    return [
        GAME_TITLE[kind] + " — LEVEL " + str(level),
        GAME_HINT[kind],
        "CLEAR IT TO EARN A PART — THEY GET BETTER AS YOU CLIMB",
    ]


def next_level(level: int, success: bool) -> int:
    """
    Climb on a clear, slip one rung on a miss.

    A miss costs the rung rather than the run, so a pilot who stalls at
    level 6 keeps playing level 5 and 6 instead of being parked at the top
    of a ladder they cannot climb.
    """
    if success:
        return min(MAX_LEVEL, max(1, level) + 1)
    return max(1, max(1, level) - 1)


def board_row(player, level: int) -> dict:
    """One pilot's line on the host's arcade standings board."""
    loadout = player.loadout
    return {
        "pid": player.pid,
        "name": player.name,
        "avatar": player.avatar,
        "level": level,
        "game": GAME_TITLE[game_for(level)],
        "cleared": player.arcade_cleared,
        "rating": loadout.rating() if loadout else 0,
        "bot": player.is_bot,
    }


def bot_result(level: int) -> bool:
    """
    How a stand-in pilot does, so solo testing has traffic on the board.

    They get worse as the ladder steepens, which keeps a human's climb
    looking like an achievement rather than the default.
    """
    odds = lerp(0.82, 0.34, (max(1, level) - 1) / float(MAX_LEVEL - 1))
    return random.random() < odds
