"""
TRENCHCOAT — hidden-role Tetris for phones.

Run:  python server.py
Then open the printed URL on your laptop (host display) and have players
scan the QR code with their phones.
"""

import asyncio
import io
import json
import math
import os
import random
import socket
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import qrcode
import uvicorn

import quiz as quizmod
import parts as partsmod
import dogfight as dogfightmod
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

# ----------------------------------------------------------------------------
# CONFIG — tune the whole game from here
# ----------------------------------------------------------------------------

PORT = 8000

ROUND_SECONDS = 60          # length of each Tetris round
ROUNDS = 3                  # rounds before the final vote
POWERS_PER_ROUND = 3        # card draws spread evenly through each round
DISCUSSION_SECONDS = 45     # talking time before the vote
VOTE_SECONDS = 30           # time to lock in an accusation

INTERMISSION_SECONDS = 5    # break between rounds showing the pass tally

GAME_MODE = "tetris"        # "tetris" or "quiz"
CHEAT_TARGET = 0.60         # Cheat wins on objective if accuracy falls below this

FIGHT_SECONDS = 75          # length of the closing dogfight
FIGHT_HZ = 30               # simulation rate
PHONE_EVERY = 3             # send phones every Nth frame; hosts get all of them

MIN_PLAYERS = 3             # real phones needed for a normal game
SOLO_FILL_TO = 4            # solo test mode pads the table to this many
BOT_NAMES = ["RIVAL", "GHOST", "NOMAD", "CIPHER", "ECHO", "VAGRANT"]

# must match the ids in static/js/avatars.js
AVATAR_IDS = ["fox", "cat", "frog", "bear", "panda",
              "owl", "penguin", "bunny", "axolotl", "shiba"]

IMPOSTER_QUOTA = 12         # passes the Imposter must make to win on objective
DETECTIVE_TRACES = 2        # how many times the Detective can trace a pass
MULE_ABSORBS = 3            # silent absorbs per round

# Powers and handicaps. `dur` of 0 means "until consumed" rather than timed.
POWERS = [
    {"id": "forge",  "name": "Piece Forge",   "kind": "power",
     "icon": "forge", "dur": 0,
     "desc": "Shake to cycle pieces, tilt to lock the one you want."},
    {"id": "mirror", "name": "Mirror Shield", "kind": "power",
     "icon": "shield", "dur": 5,
     "desc": "Incoming passes bounce back with +1 heat."},
    {"id": "freepass", "name": "Free Pass",   "kind": "power",
     "icon": "ghost", "dur": 0,
     "desc": "One pass with no heat and no arrival animation."},
    {"id": "stuck",  "name": "Stuck With It", "kind": "handicap",
     "icon": "lock", "dur": 0,
     "desc": "Your next piece cannot be passed. Live with it."},
    {"id": "hothands", "name": "Hot Hands",   "kind": "handicap",
     "icon": "fire", "dur": 0, "charges": 2,
     "desc": "You must pass your next 2 pieces. No placing."},
    {"id": "drunk",  "name": "Drunk Tilt",    "kind": "handicap",
     "icon": "swirl", "dur": 5,
     "desc": "Your tilt controls are inverted."},
]

# Quiz-mode names for the same six cards.
QUIZ_POWER_COPY = {
    "forge":    {"name": "Fifty-Fifty",
                 "desc": "Two wrong answers burn away. Pick from what's left."},
    "mirror":   {"name": "Mirror Shield",
                 "desc": "Questions passed to you bounce back, hotter."},
    "freepass": {"name": "Free Pass",
                 "desc": "Pass one question with your name hidden."},
    "stuck":    {"name": "Stuck With It",
                 "desc": "You cannot pass this one. Answer it."},
    "hothands": {"name": "Hot Hands",
                 "desc": "You must pass your next 2 questions unanswered."},
    "drunk":    {"name": "Drunk Tilt",
                 "desc": "Your aiming axes are inverted."},
}

ROLE_LIB = {
    "imposter": {
        "name": "THE IMPOSTER",
        "team": "imposter",
        "tagline": "Dump the garbage. Don't get caught.",
        "goal": (
            f"Pass {IMPOSTER_QUOTA} pieces before the final vote without being "
            "identified. You have Clean Passes that arrive with no animation — "
            "spend them when it matters."
        ),
        "color": "#e5484d",
    },
    "mule": {
        "name": "THE MULE",
        "team": "imposter",
        "tagline": "You know who they are. They don't know you.",
        "goal": (
            "You win if the Imposter wins. You can silently absorb incoming "
            f"passes {MULE_ABSORBS} times a round so they can dump on you safely. "
            "Nobody knows you exist."
        ),
        "color": "#f5a524",
    },
    "detective": {
        "name": "THE DETECTIVE",
        "team": "crew",
        "tagline": "Follow the pieces. Find the hand.",
        "goal": (
            f"Name the Imposter at the vote. Shake hard to TRACE the true origin "
            f"of the last piece you received — you only get {DETECTIVE_TRACES}."
        ),
        "color": "#3e8fff",
    },
    "builder": {
        "name": "THE BUILDER",
        "team": "crew",
        "tagline": "Clear lines. Trust nobody.",
        "goal": (
            "Survive and clear lines. You have no special powers and no secret "
            "knowledge — but your vote counts exactly as much as anyone's."
        ),
        "color": "#30a46c",
    },
    "analyst": {
        "name": "THE ANALYST",
        "team": "crew",
        "tagline": "The numbers almost tell you something.",
        "goal": (
            "At the vote you see every player's pass count — but each number is "
            "off by up to 3. Enough to argue with, not enough to prove."
        ),
        "color": "#8e4ec6",
    },
}


# Bounds for host-editable settings: (minimum, maximum, default-source key)
SETTING_LIMITS = {
    "round_seconds":      (15, 600),
    "rounds":             (1, 10),
    "discussion_seconds": (5, 600),
    "vote_seconds":       (5, 300),
    "powers_per_round":   (0, 20),
    "fight_seconds":      (15, 300),
}


def _defaults() -> Dict[str, int]:
    return {
        "round_seconds": ROUND_SECONDS,
        "rounds": ROUNDS,
        "discussion_seconds": DISCUSSION_SECONDS,
        "vote_seconds": VOTE_SECONDS,
        "powers_per_round": POWERS_PER_ROUND,
        "fight_seconds": FIGHT_SECONDS,
    }


class _DefaultsProxy(dict):
    """Reads module constants live, so tests can patch them."""
    def __missing__(self, key):
        return _defaults()[key]

    def get(self, key, default=None):
        return _defaults().get(key, default)


DEFAULTS = _DefaultsProxy()


def resolve_settings(raw: Optional[dict]) -> Dict[str, int]:
    """Clamp whatever the host sent into sane bounds."""
    raw = raw or {}
    out = {}
    base = _defaults()
    for key, (lo, hi) in SETTING_LIMITS.items():
        try:
            v = int(raw[key])
        except (KeyError, TypeError, ValueError):
            v = base[key]
        out[key] = max(lo, min(hi, v))
    return out


# Quiz mode reskins the same five roles — the mechanics are identical, but the
# Imposter's lie becomes a doctored answer key rather than a dumped piece.
QUIZ_ROLES = {
    "imposter": {
        "name": "THE CHEAT",
        "tagline": "Poison the answers. Smile about it.",
        "goal": (
            f"Drag the group's accuracy below {int(CHEAT_TARGET * 100)}% without "
            "being identified. When you pass a question you can DOCTOR it — the "
            "answer key is swapped, so whoever receives it is marked wrong for "
            "answering honestly. You have 3 doctors."
        ),
    },
    "mule": {
        "name": "THE MULE",
        "tagline": "You know who they are. They don't know you.",
        "goal": (
            "You win if the Cheat wins. You can miss deliberately without it "
            "looking suspicious, and you absorb doctored questions quietly. "
            "Nobody knows you exist."
        ),
    },
    "detective": {
        "name": "THE PROCTOR",
        "tagline": "Someone is tampering. Prove it.",
        "goal": (
            "Name the Cheat at the vote. Shake hard to AUDIT the last question "
            "passed to you — it reveals whether the answer key was tampered with "
            "and who handed it over. You only get 2."
        ),
    },
    "builder": {
        "name": "THE STUDENT",
        "tagline": "Answer well. Trust nobody.",
        "goal": (
            "Answer correctly, pass what you don't know, and work out who is "
            "poisoning the questions. No powers, no secret knowledge — but your "
            "vote counts as much as anyone's."
        ),
    },
    "analyst": {
        "name": "THE ANALYST",
        "tagline": "The numbers almost tell you something.",
        "goal": (
            "At the vote you see everyone's accuracy — but each figure is off by "
            "up to 3 points. Enough to argue with, not enough to prove."
        ),
    },
}


def role_info(role: str) -> dict:
    """Role copy for the current mode."""
    base = dict(ROLE_LIB[role])
    if GAME.mode == "quiz" and role in QUIZ_ROLES:
        base.update(QUIZ_ROLES[role])
    return base


def roles_for(n: int) -> List[str]:
    """
    Role distribution by player count. Roles are added in priority order as
    the table grows, so a small table simply loses the extra roles:

        1  imposter
        2  imposter, detective
        3  imposter, detective, builder
        4  imposter, detective, builder, mule
        5  + builder
        6  + analyst
        7+ + builders

    The Mule is the first role dropped below 4, because with 3 players an
    accomplice means the crew is outnumbered. The Analyst needs 6 before its
    noisy pass counts mean anything.
    """
    ladder = ["imposter", "detective", "builder", "mule", "builder", "analyst"]
    if n <= len(ladder):
        return ladder[:n]
    return ladder + ["builder"] * (n - len(ladder))


# ----------------------------------------------------------------------------
# STATE
# ----------------------------------------------------------------------------

@dataclass
class Player:
    pid: str
    ws: Optional[WebSocket] = None
    name: str = ""
    avatar: str = "fox"
    role: str = ""
    joined: bool = False
    answered: bool = False          # answered the incoming call
    connected: bool = True
    alive: bool = True
    is_bot: bool = False

    lines: int = 0
    score: int = 0
    passes_made: int = 0        # every pass, silent ones included
    public_passes: int = 0      # only passes the table actually saw
    passes_taken: int = 0
    traces_left: int = DETECTIVE_TRACES
    absorbs_left: int = MULE_ABSORBS
    clean_passes: int = 3

    heading: float = 0.0            # compass heading, for flick targeting
    seat: int = 0

    active_power: Optional[dict] = None
    power_expires: float = 0.0
    loadout: Optional["partsmod.Loadout"] = None

    def public(self) -> dict:
        return {
            "pid": self.pid, "name": self.name, "lines": self.lines,
            "score": self.score, "alive": self.alive, "seat": self.seat,
            "connected": self.connected, "answered": self.answered,
            "bot": self.is_bot, "avatar": self.avatar,
            # pass counts are deliberately NOT public — only the Detective
            # gets them, and only through the intermission ledger
        }


@dataclass
class Game:
    code: str = ""
    phase: str = "lobby"   # lobby|calling|roles|round|discussion|vote|results
    round_no: int = 0
    players: Dict[str, Player] = field(default_factory=dict)
    phase_ends: float = 0.0
    votes: Dict[str, str] = field(default_factory=dict)   # voter pid -> target pid
    pass_log: List[dict] = field(default_factory=list)
    hosts: List[WebSocket] = field(default_factory=list)
    task: Optional[asyncio.Task] = None
    winner: str = ""
    reveal: dict = field(default_factory=dict)
    settings: Dict[str, int] = field(default_factory=dict)
    mode: str = GAME_MODE
    quiz: Optional["quizmod.QuizEngine"] = None
    fight: Optional["dogfightmod.Dogfight"] = None
    fight_standings: List[dict] = field(default_factory=list)

    def s(self, key: str) -> int:
        """Match setting, falling back to the module default."""
        return self.settings.get(key, DEFAULTS[key])

    def roster(self) -> List[dict]:
        return [p.public() for p in self.players.values() if p.joined]

    def alive_players(self) -> List[Player]:
        return [p for p in self.players.values() if p.joined and p.alive]


GAME = Game(code="".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", k=4)))


# ----------------------------------------------------------------------------
# NETWORKING HELPERS
# ----------------------------------------------------------------------------

async def send(ws: Optional[WebSocket], payload: dict):
    if ws is None:
        return
    try:
        await ws.send_text(json.dumps(payload))
    except Exception:
        pass


async def broadcast(payload: dict, include_hosts: bool = True):
    targets = [p.ws for p in GAME.players.values() if p.ws]
    if include_hosts:
        targets += GAME.hosts
    await asyncio.gather(*(send(ws, payload) for ws in targets),
                         return_exceptions=True)


async def broadcast_hosts(payload: dict):
    await asyncio.gather(*(send(ws, payload) for ws in GAME.hosts),
                         return_exceptions=True)


async def push_state():
    """Everyone gets the shared view of the world."""
    payload = {
        "t": "state",
        "phase": GAME.phase,
        "round": GAME.round_no,
        "rounds": GAME.s("rounds"),
        "settings": GAME.settings or _defaults(),
        "mode": GAME.mode,
        "accuracy": round(GAME.quiz.accuracy(), 3) if GAME.quiz else None,
        "fightStandings": GAME.fight_standings,
        "code": GAME.code,
        "players": GAME.roster(),
        "endsIn": max(0, round(GAME.phase_ends - time.time())) if GAME.phase_ends else 0,
        "winner": GAME.winner,
        "reveal": GAME.reveal,
    }
    await broadcast(payload)


# ----------------------------------------------------------------------------
# GAME FLOW
# ----------------------------------------------------------------------------

def clear_bots():
    for pid in [p.pid for p in GAME.players.values() if p.is_bot]:
        GAME.players.pop(pid, None)


def add_bots(target: int):
    """Pad the table with stand-in players so one person can test alone."""
    existing = len([p for p in GAME.players.values() if p.joined])
    pool = [n for n in BOT_NAMES if not any(p.name == n for p in GAME.players.values())]
    for i in range(max(0, target - existing)):
        if not pool:
            break
        name = pool.pop(0)
        pid = f"bot_{name.lower()}"
        taken = {p.avatar for p in GAME.players.values() if p.joined}
        free = [a for a in AVATAR_IDS if a not in taken] or AVATAR_IDS
        b = Player(pid=pid, name=name, joined=True, answered=True,
                   connected=True, is_bot=True, avatar=random.choice(free))
        GAME.players[pid] = b


async def reset_to_lobby():
    """Back to the join screen so new people can come in between games."""
    if GAME.task and not GAME.task.done():
        GAME.task.cancel()
    GAME.task = None
    clear_bots()

    GAME.phase = "lobby"
    GAME.round_no = 0
    GAME.phase_ends = 0
    GAME.votes.clear()
    GAME.pass_log.clear()
    GAME.winner = ""
    GAME.reveal = {}

    for p in GAME.players.values():
        p.role = ""
        p.answered = False
        p.alive = True
        p.lines = p.score = 0
        p.passes_made = p.public_passes = p.passes_taken = 0
        p.active_power = None
        p.power_expires = 0

    # drop anyone whose phone is gone, so the roster reflects the room
    for pid in [p.pid for p in GAME.players.values()
                if not p.connected and not p.is_bot]:
        GAME.players.pop(pid, None)

    await push_state()
    await broadcast({"t": "to_lobby"})


async def start_game(fill: bool = False, settings: Optional[dict] = None):
    GAME.settings = resolve_settings(settings)
    mode = (settings or {}).get("mode", GAME_MODE)
    GAME.mode = mode if mode in ("tetris", "quiz") else GAME_MODE
    GAME.quiz = quizmod.QuizEngine() if GAME.mode == "quiz" else None
    clear_bots()
    if fill:
        add_bots(SOLO_FILL_TO)

    joined = [p for p in GAME.players.values() if p.joined]
    if len(joined) < (1 if fill else MIN_PLAYERS):
        return

    assignment = roles_for(len(joined))
    random.shuffle(assignment)
    for p, r in zip(joined, assignment):
        p.role = r
        p.answered = p.is_bot      # bots never pick up; treat them as answered
        p.alive = True
        p.lines = p.score = p.passes_made = p.passes_taken = 0
        p.public_passes = 0
        p.traces_left = DETECTIVE_TRACES
        p.absorbs_left = MULE_ABSORBS
        p.clean_passes = 3

    for i, p in enumerate(joined):
        p.seat = i

    GAME.phase = "calling"
    GAME.round_no = 0
    GAME.votes.clear()
    GAME.pass_log.clear()
    GAME.winner = ""
    GAME.reveal = {}
    await push_state()

    # Ring every phone. The role is only delivered once they answer.
    for p in joined:
        await send(p.ws, {"t": "call", "caller": "UNKNOWN NUMBER"})

    GAME.task = asyncio.create_task(run_match())


async def deliver_role(p: Player):
    role = role_info(p.role)
    payload = {
        "t": "role",
        "role": p.role,
        "mode": GAME.mode,
        "name": role["name"],
        "tagline": role["tagline"],
        "goal": role["goal"],
        "color": role["color"],
        "team": role["team"],
    }
    if p.role == "mule":
        imp = next((q for q in GAME.players.values() if q.role == "imposter"), None)
        if imp:
            payload["knows"] = {"name": imp.name, "label": "YOUR IMPOSTER"}
    await send(p.ws, payload)


async def run_match():
    try:
        # Wait for everyone to pick up (or 25s, whichever comes first)
        deadline = time.time() + 25
        while time.time() < deadline:
            if all(p.answered for p in GAME.players.values() if p.joined):
                break
            await asyncio.sleep(0.3)

        GAME.phase = "roles"
        GAME.phase_ends = time.time() + 8
        await push_state()
        await asyncio.sleep(8)

        for r in range(1, GAME.s("rounds") + 1):
            GAME.round_no = r
            GAME.phase = "round"
            GAME.phase_ends = time.time() + GAME.s("round_seconds")
            for p in GAME.players.values():
                p.absorbs_left = MULE_ABSORBS
                p.alive = True
            await push_state()
            await broadcast({"t": "round_start", "round": r, "mode": GAME.mode})

            if GAME.mode == "quiz":
                for p in GAME.alive_players():
                    if not p.is_bot:
                        inst = GAME.quiz.issue(p.pid)
                        await send(p.ws, {"t": "question", **inst.public()})

            t_end = GAME.phase_ends
            t_start = time.time()
            # Evenly spaced draws: for 60s and 3 cards that's 10s, 30s, 50s —
            # so no card lands right as the round ends.
            n_cards = GAME.s("powers_per_round")
            gap = (GAME.s("round_seconds") / n_cards) if n_cards else 0
            schedule = [t_start + gap * (i + 0.5) for i in range(n_cards)]
            drawn = 0
            next_bot = time.time() + random.uniform(4, 7)

            # tell clients how long the first card has to run
            if schedule:
                await broadcast({"t": "power_timer",
                                 "next": round(schedule[0] - t_start, 1),
                                 "gap": round(gap, 1)})

            while time.time() < t_end:
                now = time.time()
                if drawn < len(schedule) and now >= schedule[drawn]:
                    await deal_powers()
                    drawn += 1
                    nxt = (schedule[drawn] - now) if drawn < len(schedule) else (t_end - now)
                    await broadcast({"t": "power_timer",
                                     "next": round(max(0, nxt), 1),
                                     "gap": round(gap, 1),
                                     "remaining": len(schedule) - drawn})
                if GAME.mode == "quiz":
                    for pid, inst in GAME.quiz.expired(now):
                        p = GAME.players.get(pid)
                        if p:
                            await resolve_answer(p, -1)
                if now >= next_bot:
                    await bot_turn()
                    next_bot = now + random.uniform(4, 8)
                await asyncio.sleep(0.25)

            await broadcast({"t": "round_end", "round": r})

            # Between-round break: show what the table saw each player pass.
            GAME.phase = "intermission"
            GAME.phase_ends = time.time() + INTERMISSION_SECONDS
            standings = sorted(
                ({"name": p.name, "avatar": p.avatar, "bot": p.is_bot,
                  "passes": p.public_passes, "taken": p.passes_taken,
                  "lines": p.lines}
                 for p in GAME.players.values() if p.joined),
                key=lambda x: -x["passes"])
            await push_state()

            # Only the Detective sees the pass ledger. Everyone else gets the
            # break with line counts instead — otherwise the tally hands the
            # Imposter over and there is nothing left to deduce.
            blind = sorted(
                ({"name": p.name, "avatar": p.avatar, "bot": p.is_bot,
                  "lines": p.lines}
                 for p in GAME.players.values() if p.joined),
                key=lambda x: -x["lines"])
            for p in GAME.players.values():
                if not p.joined or p.is_bot:
                    continue
                is_det = p.role == "detective"
                await send(p.ws, {
                    "t": "intermission", "round": r,
                    "last": r >= GAME.s("rounds"),
                    "ledger": is_det,
                    "standings": standings if is_det else blind,
                })
            await broadcast_hosts({"t": "intermission", "round": r,
                                   "ledger": False, "standings": blind})
            await asyncio.sleep(INTERMISSION_SECONDS)

        # Discussion
        GAME.phase = "discussion"
        GAME.phase_ends = time.time() + GAME.s("discussion_seconds")
        await push_state()
        await send_analyst_data()
        await asyncio.sleep(GAME.s("discussion_seconds"))

        # Vote
        GAME.phase = "vote"
        GAME.phase_ends = time.time() + GAME.s("vote_seconds")
        GAME.votes.clear()
        await push_state()
        await broadcast({"t": "vote_start",
                         "players": [p.public() for p in GAME.alive_players()]})
        await bot_votes()

        v_end = GAME.phase_ends
        while time.time() < v_end:
            if len(GAME.votes) >= len(GAME.alive_players()):
                break
            await asyncio.sleep(0.3)

        await resolve_vote()

        # The dogfight is the finale, so it runs after the accusation but
        # before the reveal: you fly knowing who the table blamed, not who
        # the Cheat actually was.
        if GAME.mode == "quiz":
            await run_dogfight()
            GAME.phase = "results"
            GAME.phase_ends = 0
            await push_state()

    except asyncio.CancelledError:
        pass
    except Exception:
        import traceback
        print("!! match loop crashed:")
        traceback.print_exc()


async def bot_turn():
    """A stand-in player dumps a piece on somebody, so solo testing has traffic."""
    bots = [p for p in GAME.players.values() if p.is_bot and p.alive]
    if not bots:
        return
    sender = random.choice(bots)
    targets = [p for p in GAME.alive_players() if p.pid != sender.pid]
    if not targets:
        return
    # favour real phones so the tester actually receives pieces
    humans = [p for p in targets if not p.is_bot]
    target = random.choice(humans) if humans and random.random() < 0.75 \
        else random.choice(targets)
    await handle_pass(sender, {
        "targetPid": target.pid,
        "piece": random.choice(["I", "J", "L", "O", "S", "T", "Z"]),
        "heat": random.choice([0, 0, 1, 2]),
    })
    # bots also clear the odd line so the scoreboard moves
    sender.lines += random.choice([0, 0, 1])
    sender.score += random.choice([0, 100, 300])


async def bot_votes():
    for b in GAME.players.values():
        if not b.is_bot or not b.alive:
            continue
        others = [p for p in GAME.alive_players() if p.pid != b.pid]
        if others:
            GAME.votes[b.pid] = random.choice(others).pid


async def deal_powers():
    """One card per player, POWERS_PER_ROUND times per round."""
    for p in GAME.players.values():
        if not p.joined or not p.answered or p.is_bot:
            continue   # bots skip cards so they reliably keep passing
        card = dict(random.choice(POWERS))
        if GAME.mode == "quiz":
            card.update(QUIZ_POWER_COPY.get(card["id"], {}))
        p.active_power = card
        p.power_expires = time.time() + card["dur"] if card["dur"] else 0
        await send(p.ws, {"t": "power", "card": card})

        # 50/50 has to be resolved server-side: the client does not know the
        # answer, so it cannot work out which two options to burn.
        if GAME.mode == "quiz" and card["id"] == "forge" and GAME.quiz:
            inst = GAME.quiz.live.get(p.pid)
            if inst:
                wrong = [i for i in range(4) if i != inst.answer]
                random.shuffle(wrong)
                await send(p.ws, {"t": "burn", "indices": sorted(wrong[:2])})
    await broadcast_hosts({"t": "power_round"})


async def send_analyst_data():
    counts = {p.pid: p.passes_made for p in GAME.players.values() if p.joined}
    for p in GAME.players.values():
        if p.role == "analyst":
            noisy = [
                {"name": GAME.players[pid].name,
                 "count": max(0, c + random.randint(-3, 3))}
                for pid, c in counts.items()
            ]
            noisy.sort(key=lambda x: -x["count"])
            await send(p.ws, {"t": "analyst", "rows": noisy})


async def run_dogfight():
    """Everyone flies the jet they built. Server-authoritative, 30 Hz."""
    secs = GAME.s("fight_seconds")
    fight = dogfightmod.Dogfight(seconds=secs)
    GAME.fight = fight

    for p in GAME.players.values():
        if not p.joined:
            continue
        lo = p.loadout or partsmod.Loadout()
        fight.add(p.pid, p.name, p.avatar, lo.flight_stats(), lo.faulty_slots())

    GAME.phase = "fight"
    GAME.phase_ends = time.time() + secs + 6
    await push_state()

    # a beat on the launch pad so people can get their hands right
    await broadcast({
        "t": "fight_start",
        "seconds": secs,
        "arena": [dogfightmod.ARENA_W, dogfightmod.ARENA_H],
        "jets": [{"pid": p.pid, "name": p.name, "avatar": p.avatar,
                  "loadout": (p.loadout or partsmod.Loadout()).public()}
                 for p in GAME.players.values() if p.joined],
    })
    await asyncio.sleep(4)

    fight.start(time.time())
    frame = 0
    dt = 1.0 / FIGHT_HZ

    while fight.running:
        now = time.time()
        snap = fight.step(now)

        # bots fly themselves so solo testing still has a fight
        for b in GAME.players.values():
            if b.is_bot:
                bot_fly(fight, b.pid, now)

        await broadcast_hosts(snap)

        frame += 1
        if frame % PHONE_EVERY == 0:
            for p in GAME.players.values():
                if p.is_bot or not p.ws:
                    continue
                me = next((j for j in snap["jets"] if j["pid"] == p.pid), None)
                if me:
                    await send(p.ws, {"t": "fight_me", "me": me,
                                      "left": snap["left"],
                                      "events": [e for e in snap["events"]
                                                 if e.get("pid") == p.pid
                                                 or e.get("victimPid") == p.pid]})
        await asyncio.sleep(dt)

    standings = fight.standings()
    GAME.fight_standings = standings
    await broadcast({"t": "fight_over", "standings": standings})
    await asyncio.sleep(5)


def bot_fly(fight, pid: str, now: float):
    """Simple pursuit AI so bots are not sitting ducks."""
    j = fight.jets.get(pid)
    if not j or not j.alive:
        return
    tgt, best = None, 1e9
    for o in fight.jets.values():
        if o.pid == pid or not o.alive:
            continue
        d = math.hypot(o.x - j.x, o.y - j.y)
        if d < best:
            tgt, best = o, d
    if not tgt:
        fight.control(pid, 0.0, 0.7, False)
        return
    bearing = math.degrees(math.atan2(tgt.y - j.y, tgt.x - j.x))
    diff = dogfightmod.ang_diff(j.heading, bearing)
    fight.control(pid, max(-1.0, min(1.0, diff / 45.0)), 0.9,
                  abs(diff) < 13 and best < 420)
    if abs(diff) < 18 and best < 520:
        fight.fire_missile(pid, now)


async def resolve_vote():
    tally: Dict[str, int] = {}
    for target in GAME.votes.values():
        tally[target] = tally.get(target, 0) + 1

    accused = None
    if tally:
        top = max(tally.values())
        leaders = [pid for pid, c in tally.items() if c == top]
        accused = leaders[0] if len(leaders) == 1 else None  # tie = nobody out

    imposter = next((p for p in GAME.players.values() if p.role == "imposter"), None)

    if GAME.mode == "quiz":
        acc = GAME.quiz.accuracy() if GAME.quiz else 1.0
        caught = bool(accused and imposter and accused == imposter.pid)
        if caught:
            winner = "crew"
            reason = (f"The Cheat was caught. The group finished on "
                      f"{acc * 100:.0f}% accuracy.")
        elif acc < CHEAT_TARGET:
            winner = "imposter"
            reason = (f"Accuracy collapsed to {acc * 100:.0f}% and the Cheat "
                      f"walked away clean.")
        else:
            winner = "imposter"
            reason = (f"The Cheat was never identified, though the group held "
                      f"{acc * 100:.0f}% accuracy.")
    else:
        quota_met = bool(imposter and imposter.passes_made >= IMPOSTER_QUOTA)
        if accused and imposter and accused == imposter.pid:
            winner = "crew"
            reason = "The Imposter was caught."
        elif quota_met:
            winner = "imposter"
            reason = f"The Imposter dumped {imposter.passes_made} pieces and walked."
        else:
            winner = "imposter"
            reason = "The Imposter was never identified."

    GAME.winner = winner
    GAME.reveal = {
        "accused": GAME.players[accused].name if accused else None,
        "reason": reason,
        "tally": [{"name": GAME.players[pid].name, "votes": c}
                  for pid, c in sorted(tally.items(), key=lambda x: -x[1])],
        "roles": [
            # No pass counts here: the reveal is about who people were, not a
            # post-hoc audit trail.
            {"name": p.name, "avatar": p.avatar, "role": role_info(p.role)["name"],
             "color": role_info(p.role)["color"],
             "team": role_info(p.role)["team"],
             "lines": p.lines}
            for p in GAME.players.values() if p.joined
        ],
    }
    # In quiz mode the dogfight comes between the accusation and the reveal,
    # so hold the results back until the flying is done.
    if GAME.mode == "quiz":
        return
    GAME.phase = "results"
    GAME.phase_ends = 0
    await push_state()


# ----------------------------------------------------------------------------
# PASS ROUTING — the heart of the deduction layer
# ----------------------------------------------------------------------------

def target_by_heading(sender: Player, heading: float) -> Optional[Player]:
    """Pick whoever the sender's phone is pointing at."""
    others = [p for p in GAME.alive_players() if p.pid != sender.pid]
    if not others:
        return None
    n = len(others) + 1
    best, best_d = None, 999.0
    for i, p in enumerate(others):
        seat_angle = (360.0 / n) * ((p.seat - sender.seat) % n)
        d = abs((heading - seat_angle + 180) % 360 - 180)
        if d < best_d:
            best, best_d = p, d
    return best


async def handle_pass(sender: Player, msg: dict):
    if sender.active_power and sender.active_power["id"] == "stuck":
        await send(sender.ws, {"t": "toast", "text": "STUCK WITH IT — can't pass",
                               "kind": "bad"})
        return

    target = None
    if msg.get("targetPid"):
        target = GAME.players.get(msg["targetPid"])
    if target is None:
        target = target_by_heading(sender, float(msg.get("heading", 0)))
    if target is None or not target.alive:
        return

    heat = int(msg.get("heat", 0)) + 1
    piece = msg.get("piece", "T")
    silent = False

    # Free Pass / Clean Pass hide the arrival animation
    if sender.active_power and sender.active_power["id"] == "freepass":
        silent = True
        sender.active_power = None
    elif sender.role == "imposter" and msg.get("clean") and sender.clean_passes > 0:
        silent = True
        sender.clean_passes -= 1
        await send(sender.ws, {"t": "clean_left", "n": sender.clean_passes})

    # Mirror Shield bounces it straight back
    if (target.active_power and target.active_power["id"] == "mirror"
            and time.time() < target.power_expires):
        await send(target.ws, {"t": "toast", "text": "MIRROR SHIELD — bounced",
                               "kind": "good"})
        target, sender_was = sender, target
        heat += 1
        silent = False
        await send(target.ws, {"t": "incoming", "piece": piece, "heat": heat,
                               "from": sender_was.name, "silent": False,
                               "bounced": True})
        return

    # Mule absorbs silently
    if target.role == "mule" and target.absorbs_left > 0 and silent:
        target.absorbs_left -= 1
        sender.passes_made += 1
        await send(target.ws, {"t": "absorbed", "left": target.absorbs_left})
        return

    sender.passes_made += 1
    target.passes_taken += 1
    if not silent:
        # Silent passes deliberately never reach the public tally — that is
        # what Clean Pass and Free Pass are buying.
        sender.public_passes += 1
    GAME.pass_log.append({
        "from": sender.pid, "to": target.pid, "piece": piece,
        "heat": heat, "silent": silent, "t": time.time(),
    })

    await send(target.ws, {
        "t": "incoming", "piece": piece, "heat": heat,
        "from": None if silent else sender.name,
        "fromPid": None if silent else sender.pid,
        "fromAvatar": None if silent else sender.avatar,
        "silent": silent,
    })
    if not silent:
        await broadcast_hosts({"t": "pass_fx", "from": sender.name,
                               "to": target.name, "heat": heat})


async def resolve_answer(p: Player, choice: int, inst_id: Optional[int] = None):
    """Score one answer and hand the player their next question."""
    if GAME.quiz is None:
        return
    res = GAME.quiz.resolve(p.pid, choice, time.time(), inst_id)
    if res is None:
        return

    p.score += res["points"]
    if res["correct"]:
        p.lines += 1          # reuse `lines` as the correct-answer counter

    # --- the payoff: a correct answer earns a jet part ---------------------
    award = None
    if p.loadout is None:
        p.loadout = partsmod.Loadout()
    heat = res.get("multiplier", 1) - 1

    if res["correct"]:
        award = p.loadout.award(partsmod.roll_part(heat))
    elif res["doctored"]:
        # Sabotaged: they answered honestly and were marked wrong, so they are
        # handed a part that looks fine and will fail mid-dogfight. They are
        # told they earned it — that is the whole trick.
        award = p.loadout.award(partsmod.make_faulty(heat=heat))

    await send(p.ws, {"t": "answer_result", **res})
    if award:
        await send(p.ws, {"t": "part", **award,
                          "loadout": p.loadout.public()})
    await broadcast_hosts({
        "t": "quiz_fx", "name": p.name, "avatar": p.avatar,
        "correct": res["correct"], "timedOut": res["timedOut"],
        "points": res["points"], "multiplier": res["multiplier"],
        "accuracy": round(GAME.quiz.accuracy(), 3),
    })

    if GAME.phase == "round" and p.alive:
        # issue() prefers anything that queued up while they were busy
        was_queued = bool(GAME.quiz.queued.get(p.pid))
        inst = GAME.quiz.issue(p.pid)
        await send(p.ws, {"t": "question", **inst.public(),
                          "passed": was_queued})


async def handle_quiz_pass(sender: Player, msg: dict):
    """Flick a question you don't know at somebody who might."""
    if GAME.quiz is None:
        return
    if sender.active_power and sender.active_power["id"] == "stuck":
        await send(sender.ws, {"t": "toast", "text": "STUCK WITH IT — can't pass",
                               "kind": "bad"})
        return

    target = None
    if msg.get("targetPid"):
        target = GAME.players.get(msg["targetPid"])
    if target is None:
        target = target_by_heading(sender, float(msg.get("heading", 0)))
    if target is None or not target.alive or target.pid == sender.pid:
        return

    inst = GAME.quiz.take(sender.pid)
    if inst is None:
        return

    silent = False
    if sender.active_power and sender.active_power["id"] == "freepass":
        silent = True
        sender.active_power = None

    doctor = bool(msg.get("doctor")) and sender.role == "imposter" \
        and sender.clean_passes > 0
    if doctor:
        sender.clean_passes -= 1
        await send(sender.ws, {"t": "clean_left", "n": sender.clean_passes})

    sender.passes_made += 1
    target.passes_taken += 1
    if not silent:
        sender.public_passes += 1

    GAME.pass_log.append({
        "from": sender.pid, "to": target.pid, "piece": "Q",
        "heat": inst.heat + 1, "silent": silent, "t": time.time(),
    })

    landed = GAME.quiz.hand_to(inst, target.pid, sender.pid, sender.name,
                               silent=silent, doctor=doctor)
    if landed is not None:
        # went straight onto their screen
        await send(target.ws, {"t": "question", **landed.public(), "passed": True})
    else:
        # they were mid-question, so it waits its turn
        await send(target.ws, {"t": "toast", "kind": "bad",
                               "text": "A QUESTION IS QUEUED FOR YOU"})

    # sender immediately gets a fresh one
    nxt = GAME.quiz.issue(sender.pid)
    await send(sender.ws, {"t": "question", **nxt.public()})

    if not silent:
        await broadcast_hosts({"t": "pass_fx", "from": sender.name,
                               "to": target.name, "heat": inst.heat})


async def handle_audit(p: Player):
    """Proctor power: was the last question handed to me tampered with?"""
    if GAME.quiz is None or p.role != "detective" or p.traces_left <= 0:
        return
    p.traces_left -= 1
    info = GAME.quiz.audit(p.pid)
    await send(p.ws, {"t": "audit", "info": info, "left": p.traces_left})


async def handle_trace(p: Player):
    if p.role != "detective" or p.traces_left <= 0:
        return
    p.traces_left -= 1
    last = next((e for e in reversed(GAME.pass_log) if e["to"] == p.pid), None)
    if last:
        origin = GAME.players[last["from"]].name
        await send(p.ws, {"t": "trace", "origin": origin,
                          "piece": last["piece"], "left": p.traces_left})
    else:
        await send(p.ws, {"t": "trace", "origin": None, "left": p.traces_left})


# ----------------------------------------------------------------------------
# APP
# ----------------------------------------------------------------------------

app = FastAPI(title="Trenchcoat")


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


# Set TRENCHCOAT_PUBLIC_URL to your https:// tunnel address (cloudflared/ngrok)
# so the QR code points there. iOS refuses motion sensors over plain HTTP.
PUBLIC_URL = {
    "url": os.environ.get("TRENCHCOAT_PUBLIC_URL", "").rstrip("/")
           or f"http://{lan_ip()}:{PORT}"
}


@app.get("/")
async def host_page():
    return FileResponse("static/host.html")


@app.get("/play")
async def player_page():
    return FileResponse("static/player.html")


@app.get("/join-url")
async def join_url():
    return {"url": PUBLIC_URL["url"] + "/play", "code": GAME.code}


@app.get("/qr.png")
async def qr_png():
    img = qrcode.make(PUBLIC_URL["url"] + "/play", box_size=12, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    role_kind = None
    me: Optional[Player] = None
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            t = msg.get("t")

            if t == "hello_host":
                role_kind = "host"
                GAME.hosts.append(ws)
                await push_state()
                continue

            if t == "join":
                pid = msg.get("pid") or f"p{int(time.time()*1000)%100000}{random.randint(10,99)}"
                me = GAME.players.get(pid) or Player(pid=pid)
                me.ws = ws
                me.connected = True
                me.name = (msg.get("name") or "PLAYER")[:14].upper()
                av = str(msg.get("avatar") or "fox")[:16]
                me.avatar = av if av in AVATAR_IDS else "fox"
                me.joined = True
                GAME.players[pid] = me
                role_kind = "player"
                await send(ws, {"t": "joined", "pid": pid, "name": me.name})
                await push_state()
                continue

            # Host-level commands: these arrive on a connection that has no
            # Player attached, so they must be handled before the guard below.
            if t == "start":
                if GAME.phase in ("lobby", "results"):
                    await start_game(fill=bool(msg.get("fill")),
                                     settings=msg.get("settings"))
                continue

            if t == "reset":
                await reset_to_lobby()
                continue

            if me is None:
                continue

            if t == "answer":
                me.answered = True
                await deliver_role(me)
                await push_state()

            elif t == "heading":
                me.heading = float(msg.get("h", 0))

            elif t == "pass":
                if GAME.phase == "round":
                    if GAME.mode == "quiz":
                        await handle_quiz_pass(me, msg)
                    else:
                        await handle_pass(me, msg)

            # NB: deliberately not "answer" — that one answers the phone call.
            elif t == "ctl":
                if GAME.fight and GAME.fight.running:
                    GAME.fight.control(me.pid,
                                       float(msg.get("steer", 0.0)),
                                       float(msg.get("throttle", 0.5)),
                                       bool(msg.get("fire", False)))

            elif t == "missile":
                if GAME.fight and GAME.fight.running:
                    if GAME.fight.fire_missile(me.pid, time.time()):
                        await send(me.ws, {"t": "missile_away"})

            elif t == "quiz_answer":
                if GAME.phase == "round" and GAME.mode == "quiz":
                    iid = msg.get("inst")
                    await resolve_answer(me, int(msg.get("choice", -1)),
                                         int(iid) if iid is not None else None)

            elif t == "placed":
                me.lines += int(msg.get("lines", 0))
                me.score += int(msg.get("score", 0))

            elif t == "topout":
                me.alive = False
                await push_state()

            elif t == "revive":
                me.alive = True

            elif t == "trace":
                if GAME.mode == "quiz":
                    await handle_audit(me)
                else:
                    await handle_trace(me)

            elif t == "vote":
                if GAME.phase == "vote" and msg.get("target"):
                    GAME.votes[me.pid] = msg["target"]
                    await broadcast_hosts({"t": "vote_cast", "n": len(GAME.votes),
                                           "of": len(GAME.alive_players())})

            elif t == "score_sync":
                me.score = int(msg.get("score", me.score))
                me.lines = int(msg.get("lines", me.lines))
                await broadcast_hosts({"t": "scores", "players": GAME.roster()})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if role_kind == "host" and ws in GAME.hosts:
            GAME.hosts.remove(ws)
        if me:
            me.connected = False
            me.ws = None
            try:
                await push_state()
            except Exception:
                pass


app.mount("/static", StaticFiles(directory="static"), name="static")


if __name__ == "__main__":
    ip = lan_ip()
    print("\n" + "=" * 58)
    print("  TRENCHCOAT — hidden-role Tetris")
    print("=" * 58)
    print(f"  HOST DISPLAY  ->  http://{ip}:{PORT}")
    print(f"  PHONES JOIN   ->  {PUBLIC_URL['url']}/play")
    print(f"  ROOM CODE     ->  {GAME.code}")
    print("=" * 58)
    if PUBLIC_URL["url"].startswith("https://"):
        print("  HTTPS tunnel active — motion sensors will work on iPhones.")
    else:
        print("  Phones must be on the SAME WI-FI.")
        print("  iPhones need HTTPS for motion — set TRENCHCOAT_PUBLIC_URL")
        print("  to a cloudflared/ngrok https URL. See README.md")
    print("=" * 58 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
