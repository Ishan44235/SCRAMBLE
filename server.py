"""
SCRAMBLE — server

A retro pixel arcade party game for phones in one room.

  home     -> HOST GAME or JOIN GAME with a 4-letter room code
  quiz     -> answer trivia, earn fighter jet parts, pass what you don't know
  vote     -> the table marks one pilot as THE THREAT
  dogfight -> everyone flies the jet they built

Every room is independent, so several groups can play on one server.
"""

import asyncio
import io
import json
import math
import os
import random
import socket
import string
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import qrcode
import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import quiz as quizmod
import parts as partsmod
import dogfight as dogfightmod

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

PORT = int(os.environ.get("PORT", 8000))

ROUND_SECONDS = 60
ROUNDS = 3
POWERS_PER_ROUND = 3
INTERMISSION_SECONDS = 5
DISCUSSION_SECONDS = 45
VOTE_SECONDS = 30
FIGHT_SECONDS = 75

FIGHT_HZ = 30
PHONE_EVERY = 3

MIN_PLAYERS = 3
SOLO_FILL_TO = 4
BOT_NAMES = ["RIVAL", "GHOST", "NOMAD", "CIPHER", "ECHO", "VAGRANT"]

AVATAR_IDS = ["fox", "cat", "frog", "bear", "panda",
              "owl", "penguin", "bunny", "axolotl", "shiba"]

ROOM_IDLE_SECONDS = 60 * 60      # reap rooms nobody has touched in an hour

# ---------------------------------------------------------------------------
# CARDS
# ---------------------------------------------------------------------------

CARDS = [
    {"id": "mystery", "name": "Mystery Crate", "kind": "power",
     "icon": "crate", "dur": 0,
     "desc": "A sealed crate. You find out what's inside in the hangar."},
    {"id": "fifty", "name": "Fifty-Fifty", "kind": "power",
     "icon": "split", "dur": 0,
     "desc": "Two wrong answers burn away on your current question."},
    {"id": "tailwind", "name": "Tailwind", "kind": "power",
     "icon": "wind", "dur": 0,
     "desc": "Your next correct answer drops as if the question were red hot."},
    {"id": "deflector", "name": "Deflector", "kind": "power",
     "icon": "shield", "dur": 6,
     "desc": "Questions passed to you bounce straight back, hotter."},

    {"id": "rust", "name": "Rust", "kind": "handicap",
     "icon": "rust", "dur": 0,
     "desc": "One part already on your jet corrodes down a tier."},
    {"id": "locked", "name": "Locked Bay", "kind": "handicap",
     "icon": "lock", "dur": 0,
     "desc": "You cannot pass this question. Answer it."},
    {"id": "hothands", "name": "Hot Hands", "kind": "handicap",
     "icon": "fire", "dur": 0, "charges": 2,
     "desc": "You must pass your next 2 questions unanswered."},
    {"id": "blindspot", "name": "Blind Spot", "kind": "handicap",
     "icon": "eye", "dur": 0,
     "desc": "The answers stay hidden for the first 3 seconds."},
]

# ---------------------------------------------------------------------------
# AGENDAS — secret objectives. Nobody is a traitor; everyone has a private
# reason to behave oddly, which is what keeps the table reading each other.
# ---------------------------------------------------------------------------

MAGPIE_BONUS = 250
DUELIST_PER_KILL = 120
SCAVENGER_PER_PART = 80
MECHANIC_BONUS = 150
INSPECTOR_BONUS = 180
QUARTERMASTER_PER_PART = 40
FEATHERWEIGHT_BONUS = 200
FEATHERWEIGHT_MAX_SLOTS = 3
THREAT_BOUNTY = 3

STREAK_FOR_STRIKE = 3    # correct answers in a row earns a missile
STREAK_FOR_RINGS = 3     # wrong answers in a row sends you through the rings
RING_COOLDOWN = 40.0     # ...but no more than one ring run per this often

# Loose parts are live hand grenades. A part that is not an outright upgrade
# lands in your hands ticking; you either CLAIM it as-is or shove it at
# somebody else, which bumps its tier but does not reset the fuse.
HOT_FUSE_SECONDS = 10.0
HOT_PER_PLAYER = 3       # cap on live crates = players * this

AGENDAS = {
    "magpie": {
        "name": "THE MAGPIE", "short": "The Shiny Thief",
        "tagline": "The rarest thing at the table is yours.",
        "goal": (f"Finish holding the single rarest part anyone has, worth "
                 f"{MAGPIE_BONUS}. Chase the hot questions — and accept that "
                 f"everyone can see you doing it."),
        "color": "#f5a524",
    },
    "duelist": {
        "name": "THE DUELIST", "short": "The Dogfight Ace",
        "tagline": "One name. Nothing else matters.",
        "goal": (f"You have one secret rival. Every time you shoot them down "
                 f"you score {DUELIST_PER_KILL}. Kills on anyone else earn you "
                 f"nothing extra."),
        "color": "#e5484d",
    },
    "scavenger": {
        "name": "THE SCAVENGER", "short": "The Scrap Baron",
        "tagline": "Their wreckage is your parts bin.",
        "goal": (f"Shoot someone down and you tear a part off their jet and "
                 f"bolt it onto yours mid-fight. Each one is worth "
                 f"{SCAVENGER_PER_PART}. Hunt the best-equipped pilot."),
        "color": "#30a46c",
    },
    "mechanic": {
        "name": "THE MECHANIC", "short": "The Grease Wizard",
        "tagline": "A fair trade, whether they like it or not.",
        "goal": (f"During the discussion you force a one-for-one part swap with "
                 f"any pilot — you pick both bays, they get no say. Worth "
                 f"{MECHANIC_BONUS} if you end up with the better jet."),
        "color": "#3e8fff",
    },
    "inspector": {
        "name": "THE INSPECTOR", "short": "The Parts Inspector",
        "tagline": "Open the panel. See what's really in there.",
        "goal": (f"Once per game you can strip-inspect any pilot and see their "
                 f"exact loadout. Worth {INSPECTOR_BONUS} if the pilot you "
                 f"inspected is the one the table marks as the Threat."),
        "color": "#8e4ec6",
    },
    "quartermaster": {
        "name": "THE QUARTERMASTER", "short": "The Supply Line",
        "tagline": "Generous, and quietly counting.",
        "goal": (f"You score {QUARTERMASTER_PER_PART} for every part fitted by "
                 f"a pilot you passed a question to. Give away the questions "
                 f"you could have answered."),
        "color": "#2dd4d4",
    },
    "featherweight": {
        "name": "THE FEATHERWEIGHT", "short": "The Bare Airframe",
        "tagline": "Travel light. Turn harder.",
        "goal": (f"Finish with {FEATHERWEIGHT_MAX_SLOTS} parts or fewer and "
                 f"score {FEATHERWEIGHT_BONUS}. A light jet turns hardest — but "
                 f"you must pass questions you could have answered."),
        "color": "#9aa3b8",
    },
}

AGENDA_LADDER = ["magpie", "duelist", "scavenger", "mechanic",
                 "inspector", "quartermaster", "featherweight"]


def agendas_for(n: int) -> List[str]:
    if n <= len(AGENDA_LADDER):
        return AGENDA_LADDER[:n]
    out = list(AGENDA_LADDER)
    extra = ["quartermaster", "featherweight", "magpie", "scavenger"]
    i = 0
    while len(out) < n:
        out.append(extra[i % len(extra)])
        i += 1
    return out


# ---------------------------------------------------------------------------
# SETTINGS
# ---------------------------------------------------------------------------

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


def resolve_settings(raw: Optional[dict]) -> Dict[str, int]:
    raw = raw or {}
    out, base = {}, _defaults()
    for key, (lo, hi) in SETTING_LIMITS.items():
        try:
            v = int(raw[key])
        except (KeyError, TypeError, ValueError):
            v = base[key]
        out[key] = max(lo, min(hi, v))
    return out


# ---------------------------------------------------------------------------
# STATE
# ---------------------------------------------------------------------------

@dataclass
class Player:
    pid: str
    ws: Optional[WebSocket] = None
    name: str = ""
    avatar: str = "fox"
    joined: bool = False
    answered: bool = False
    connected: bool = True
    alive: bool = True
    is_bot: bool = False
    lobby_only: bool = False

    agenda: str = ""
    rival: str = ""
    stolen: List[dict] = field(default_factory=list)
    traded_with: str = ""
    inspected: str = ""
    gave_to: Dict[str, int] = field(default_factory=dict)

    correct: int = 0
    score: int = 0
    streak_ok: int = 0          # correct answers in a row
    streak_bad: int = 0         # wrong answers in a row
    strikes: int = 0            # missile strikes earned, unspent
    minigame: str = ""          # "dodge" | "rings" while one is running
    last_rings: float = 0.0     # so the ring run cannot spam a cold player
    passes_made: int = 0
    public_passes: int = 0
    passes_taken: int = 0

    heading: float = 0.0
    seat: int = 0

    active_power: Optional[dict] = None
    power_expires: float = 0.0
    loadout: Optional["partsmod.Loadout"] = None
    crates: List[dict] = field(default_factory=list)
    tailwind: bool = False

    def public(self) -> dict:
        return {
            "pid": self.pid, "name": self.name, "avatar": self.avatar,
            "correct": self.correct, "score": self.score,
            "alive": self.alive, "seat": self.seat,
            "connected": self.connected, "answered": self.answered,
            "bot": self.is_bot,
        }


@dataclass
class Room:
    code: str
    phase: str = "lobby"
    round_no: int = 0
    players: Dict[str, Player] = field(default_factory=dict)
    hosts: List[WebSocket] = field(default_factory=list)
    phase_ends: float = 0.0
    votes: Dict[str, str] = field(default_factory=dict)
    settings: Dict[str, int] = field(default_factory=dict)
    quiz: Optional["quizmod.QuizEngine"] = None
    fight: Optional["dogfightmod.Dogfight"] = None
    fight_standings: List[dict] = field(default_factory=list)
    threat: str = ""
    reveal: dict = field(default_factory=dict)
    hot: Dict[int, dict] = field(default_factory=dict)   # live ticking crates
    next_hot: int = 1
    task: Optional[asyncio.Task] = None
    touched: float = field(default_factory=time.time)

    def s(self, key: str) -> int:
        return self.settings.get(key, _defaults()[key])

    def roster(self) -> List[dict]:
        return [p.public() for p in self.players.values() if p.joined]

    def humans(self) -> List[Player]:
        return [p for p in self.players.values() if p.joined and not p.is_bot and not p.lobby_only]

    def alive_players(self) -> List[Player]:
        return [p for p in self.players.values() if p.joined and p.alive and not p.lobby_only]


ROOMS: Dict[str, Room] = {}
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def new_code() -> str:
    while True:
        code = "".join(random.choices(CODE_ALPHABET, k=4))
        if code not in ROOMS:
            return code


def create_room() -> Room:
    reap_rooms()
    r = Room(code=new_code())
    ROOMS[r.code] = r
    return r


def reap_rooms():
    now = time.time()
    for code in [c for c, r in ROOMS.items()
                 if now - r.touched > ROOM_IDLE_SECONDS and not r.hosts]:
        room = ROOMS.pop(code, None)
        if room and room.task and not room.task.done():
            room.task.cancel()


# ---------------------------------------------------------------------------
# NETWORKING
# ---------------------------------------------------------------------------

async def send(ws: Optional[WebSocket], payload: dict):
    if ws is None:
        return
    try:
        await ws.send_text(json.dumps(payload))
    except Exception:
        pass


async def broadcast(r: Room, payload: dict, hosts: bool = True):
    targets = [p.ws for p in r.players.values() if p.ws]
    if hosts:
        targets += r.hosts
    await asyncio.gather(*(send(ws, payload) for ws in targets),
                         return_exceptions=True)


async def broadcast_hosts(r: Room, payload: dict):
    await asyncio.gather(*(send(ws, payload) for ws in r.hosts),
                         return_exceptions=True)


async def push_state(r: Room):
    await broadcast(r, {
        "t": "state",
        "phase": r.phase,
        "round": r.round_no,
        "rounds": r.s("rounds"),
        "code": r.code,
        "players": r.roster(),
        "ring": seating(r),
        "endsIn": max(0, round(r.phase_ends - time.time())) if r.phase_ends else 0,
        "settings": r.settings or _defaults(),
        "accuracy": round(r.quiz.accuracy(), 3) if r.quiz else None,
        "threat": r.threat,
        "reveal": r.reveal,
        "fightStandings": r.fight_standings,
    })


# ---------------------------------------------------------------------------
# LOBBY
# ---------------------------------------------------------------------------

def clear_bots(r: Room):
    for pid in [p.pid for p in r.players.values() if p.is_bot]:
        r.players.pop(pid, None)


def add_bots(r: Room, target: int):
    existing = len([p for p in r.players.values() if p.joined])
    pool = [n for n in BOT_NAMES
            if not any(p.name == n for p in r.players.values())]
    for _ in range(max(0, target - existing)):
        if not pool:
            break
        name = pool.pop(0)
        taken = {p.avatar for p in r.players.values() if p.joined}
        free = [a for a in AVATAR_IDS if a not in taken] or AVATAR_IDS
        r.players[f"bot_{name.lower()}"] = Player(
            pid=f"bot_{name.lower()}", name=name, joined=True, answered=True,
            connected=True, is_bot=True, avatar=random.choice(free))


async def reset_to_lobby(r: Room):
    if r.task and not r.task.done():
        r.task.cancel()
    r.task = None
    if r.fight:
        r.fight.running = False
        r.fight.bullets.clear()
        r.fight.missiles.clear()
    clear_bots(r)
    r.phase = "lobby"
    r.round_no = 0
    r.phase_ends = 0
    r.votes.clear()
    r.threat = ""
    r.reveal = {}
    r.fight = None
    r.fight_standings = []
    r.quiz = None
    r.hot = {}
    r.next_hot = 1

    for p in r.players.values():
        p.lobby_only = False
        p.minigame = ""
        p.streak_ok = p.streak_bad = p.strikes = 0
        p.agenda = ""
        p.rival = ""
        p.answered = False
        p.alive = True
        p.correct = p.score = 0
        p.passes_made = p.public_passes = p.passes_taken = 0
        p.stolen = []
        p.traded_with = ""
        p.inspected = ""
        p.gave_to = {}
        p.active_power = None
        p.loadout = None
        p.crates = []

    for pid in [p.pid for p in r.players.values()
                if not p.connected and not p.is_bot]:
        r.players.pop(pid, None)

    await push_state(r)
    await broadcast(r, {"t": "to_lobby"})


async def start_game(r: Room, fill: bool = False,
                     settings: Optional[dict] = None):
    if r.phase not in ("lobby", "results"):
        return
    r.settings = resolve_settings(settings)
    clear_bots(r)
    if fill:
        add_bots(r, SOLO_FILL_TO)

    joined = [p for p in r.players.values() if p.joined]
    if len(joined) < (1 if fill else MIN_PLAYERS):
        return

    ag = agendas_for(len(joined))
    random.shuffle(ag)
    for i, (p, a) in enumerate(zip(joined, ag)):
        p.lobby_only = False
        p.minigame = ""
        p.agenda = a
        p.rival = ""
        p.answered = p.is_bot
        p.alive = True
        p.correct = p.score = 0
        p.passes_made = p.public_passes = p.passes_taken = 0
        p.stolen = []
        p.traded_with = ""
        p.inspected = ""
        p.gave_to = {}
        p.loadout = partsmod.Loadout()
        p.crates = []
        p.seat = i

    duel = next((p for p in joined if p.agenda == "duelist"), None)
    if duel:
        others = [q for q in joined if q.pid != duel.pid]
        if others:
            duel.rival = random.choice(others).pid

    r.quiz = quizmod.QuizEngine()
    r.hot = {}
    r.next_hot = 1
    r.phase = "calling"
    r.round_no = 0
    r.votes.clear()
    r.threat = ""
    r.reveal = {}
    r.fight_standings = []
    r.touched = time.time()
    await push_state(r)

    for p in joined:
        await send(p.ws, {"t": "call", "caller": "FLIGHT CONTROL"})

    r.task = asyncio.create_task(run_match(r))


async def deliver_agenda(r: Room, p: Player):
    if not p.agenda:
        return
    a = AGENDAS[p.agenda]
    payload = {
        "t": "role", "agenda": p.agenda, "role": p.agenda,
        "name": a["name"], "short": a["short"], "tagline": a["tagline"],
        "goal": a["goal"], "color": a["color"],
    }
    if p.agenda == "duelist" and p.rival:
        tgt = r.players.get(p.rival)
        if tgt:
            payload["knows"] = {"name": tgt.name, "label": "YOUR RIVAL"}
    await send(p.ws, payload)


# ---------------------------------------------------------------------------
# MATCH
# ---------------------------------------------------------------------------

async def run_match(r: Room):
    try:
        deadline = time.time() + 25
        while time.time() < deadline:
            if all(p.answered for p in r.players.values() if p.joined):
                break
            await asyncio.sleep(0.3)

        r.phase = "roles"
        r.phase_ends = time.time() + 8
        await push_state(r)
        await asyncio.sleep(8)

        for rd in range(1, r.s("rounds") + 1):
            r.round_no = rd
            r.phase = "round"
            r.phase_ends = time.time() + r.s("round_seconds")
            for p in r.players.values():
                p.alive = True
            await push_state(r)
            await broadcast(r, {"t": "round_start", "round": rd})

            for p in r.alive_players():
                if not p.is_bot:
                    inst = r.quiz.issue(p.pid)
                    await send(p.ws, {"t": "question", **inst.public()})

            t_end = r.phase_ends
            t_start = time.time()
            n_cards = r.s("powers_per_round")
            gap = (r.s("round_seconds") / n_cards) if n_cards else 0
            schedule = [t_start + gap * (i + 0.5) for i in range(n_cards)]
            drawn = 0
            next_bot = time.time() + random.uniform(4, 7)

            if schedule:
                await broadcast(r, {"t": "power_timer",
                                    "next": round(schedule[0] - t_start, 1),
                                    "gap": round(gap, 1)})

            while time.time() < t_end:
                now = time.time()
                if drawn < len(schedule) and now >= schedule[drawn]:
                    await deal_cards(r)
                    drawn += 1
                    nxt = (schedule[drawn] - now) if drawn < len(schedule) else (t_end - now)
                    await broadcast(r, {"t": "power_timer",
                                        "next": round(max(0, nxt), 1),
                                        "gap": round(gap, 1),
                                        "remaining": len(schedule) - drawn})
                await tick_hot(r)
                for pid, _ in r.quiz.expired(now):
                    p = r.players.get(pid)
                    if p:
                        await resolve_answer(r, p, -1)
                if now >= next_bot:
                    await bot_turn(r)
                    next_bot = now + random.uniform(4, 8)
                await asyncio.sleep(0.25)

            await broadcast(r, {"t": "round_end", "round": rd})

            r.phase = "intermission"
            r.phase_ends = time.time() + INTERMISSION_SECONDS
            standings = sorted(
                ({"name": p.name, "avatar": p.avatar, "bot": p.is_bot,
                  "correct": p.correct,
                  "rating": (p.loadout or partsmod.Loadout()).rating()}
                 for p in r.players.values() if p.joined),
                key=lambda x: -x["rating"])
            await push_state(r)
            await broadcast(r, {"t": "intermission", "round": rd,
                                "last": rd >= r.s("rounds"),
                                "standings": standings})
            await asyncio.sleep(INTERMISSION_SECONDS)

        r.phase = "discussion"
        r.phase_ends = time.time() + r.s("discussion_seconds")
        await push_state(r)
        await asyncio.sleep(r.s("discussion_seconds"))

        r.phase = "vote"
        r.phase_ends = time.time() + r.s("vote_seconds")
        r.votes.clear()
        await push_state(r)
        await broadcast(r, {"t": "vote_start", "kind": "threat",
                            "players": [p.public() for p in r.alive_players()]})
        await bot_votes(r)

        v_end = r.phase_ends
        while time.time() < v_end:
            if len(r.votes) >= len(r.alive_players()):
                break
            await asyncio.sleep(0.3)

        await resolve_threat_vote(r)
        await run_dogfight(r)

        r.phase = "results"
        r.phase_ends = 0
        await push_state(r)

    except asyncio.CancelledError:
        pass
    except Exception:
        import traceback
        print("!! match loop crashed:")
        traceback.print_exc()


async def deal_cards(r: Room):
    for p in r.players.values():
        if not p.joined or not p.answered or p.is_bot:
            continue
        card = dict(random.choice(CARDS))
        p.active_power = card
        p.power_expires = time.time() + card["dur"] if card["dur"] else 0
        await send(p.ws, {"t": "power", "card": card})

        if p.loadout is None:
            p.loadout = partsmod.Loadout()

        if card["id"] == "fifty" and r.quiz:
            inst = r.quiz.live.get(p.pid)
            if inst:
                wrong = [i for i in range(4) if i != inst.answer]
                random.shuffle(wrong)
                await send(p.ws, {"t": "burn", "indices": sorted(wrong[:2])})

        elif card["id"] == "mystery":
            p.crates.append(partsmod.roll_mystery())
            await send(p.ws, {"t": "crates", "n": len(p.crates)})

        elif card["id"] == "rust":
            lost = p.loadout.corrode()
            if lost:
                await send(p.ws, {"t": "rusted", **lost,
                                  "loadout": p.loadout.public()})
            else:
                await send(p.ws, {"t": "toast", "kind": "good",
                                  "text": "RUST — NOTHING TO CORRODE YET"})
    await broadcast_hosts(r, {"t": "power_round"})


async def bot_turn(r: Room):
    """A stand-in pilot dumps a question on somebody, so solo testing has traffic."""
    bots = [p for p in r.players.values() if p.is_bot and p.alive]
    if not bots or not r.quiz:
        return
    sender = random.choice(bots)
    target = neighbour(r, sender, random.choice(["left", "right"]))
    if target is None or target.pid == sender.pid:
        return

    inst = r.quiz.live.get(sender.pid) or r.quiz.issue(sender.pid)
    r.quiz.take(sender.pid)
    sender.passes_made += 1
    sender.public_passes += 1
    target.passes_taken += 1

    landed = r.quiz.hand_to(inst, target.pid, sender.pid, sender.name)
    if landed is not None:
        await send(target.ws, {"t": "question", **landed.public(), "passed": True})
    await broadcast_hosts(r, {"t": "pass_fx", "fromPid": sender.pid,
                              "toPid": target.pid, "from": sender.name,
                              "to": target.name, "heat": inst.heat,
                              "kind": "question"})


async def bot_votes(r: Room):
    for b in r.players.values():
        if not b.is_bot or not b.alive:
            continue
        others = [p for p in r.alive_players() if p.pid != b.pid]
        if others:
            r.votes[b.pid] = random.choice(others).pid


# ---------------------------------------------------------------------------
# QUIZ
# ---------------------------------------------------------------------------

async def resolve_answer(r: Room, p: Player, choice: int,
                         inst_id: Optional[int] = None):
    if r.quiz is None:
        return
    res = r.quiz.resolve(p.pid, choice, time.time(), inst_id)
    if res is None:
        return

    p.score += res["points"]
    if res["correct"]:
        p.correct += 1
        p.streak_ok += 1
        p.streak_bad = 0
    else:
        p.streak_bad += 1
        p.streak_ok = 0

    if p.loadout is None:
        p.loadout = partsmod.Loadout()
    heat = res.get("multiplier", 1) - 1

    if p.active_power and p.active_power.get("id") == "tailwind":
        p.tailwind = True
    if res["correct"] and p.tailwind:
        heat = max(heat, 4)
        p.tailwind = False
        if p.active_power and p.active_power.get("id") == "tailwind":
            p.active_power = None

    award = p.loadout.award(partsmod.roll_part(heat)) if res["correct"] else None

    await send(p.ws, {"t": "answer_result", **res})
    if award:
        if award.get("fitted"):
            await send(p.ws, {"t": "part", **award, "loadout": p.loadout.public()})
            await broadcast_hosts(r, {
                "t": "earn_fx", "pid": p.pid, "name": p.name,
                "part": award["part"]["name"], "tier": award["part"]["tier"],
                "slot": award["part"]["slot"], "upgrade": award.get("upgrade", False)})
        else:
            # not an upgrade — it lands in your hands, ticking
            await spawn_hot(r, p, partsmod.hot_from_public(award["part"]))
        if award.get("fitted"):
            last = r.quiz.last_received.get(p.pid)
            if last and last.from_pid and last.from_pid != p.pid:
                giver = r.players.get(last.from_pid)
                if giver:
                    giver.gave_to[p.pid] = giver.gave_to.get(p.pid, 0) + 1

    await broadcast_hosts(r, {
        "t": "quiz_fx", "name": p.name, "avatar": p.avatar,
        "correct": res["correct"], "timedOut": res["timedOut"],
        "points": res["points"], "multiplier": res["multiplier"],
        "accuracy": round(r.quiz.accuracy(), 3),
    })

    # A hot streak earns a missile; a cold one puts you in the rings.
    if r.phase == "round" and not p.minigame:
        if p.streak_bad >= STREAK_FOR_RINGS:
            p.streak_bad = 0
            # A bad run shouldn't mean a ring course every ten seconds —
            # that stops being a penalty and starts being the whole game.
            if time.time() - p.last_rings >= RING_COOLDOWN:
                p.last_rings = time.time()
                await start_minigame(r, p, "rings")
                return
        if p.streak_ok >= STREAK_FOR_STRIKE:
            p.streak_ok = 0
            p.strikes += 1
            await send(p.ws, {"t": "strike_ready", "n": p.strikes})

    if r.phase == "round" and p.alive and not p.minigame:
        was_queued = bool(r.quiz.queued.get(p.pid))
        inst = r.quiz.issue(p.pid)
        await send(p.ws, {"t": "question", **inst.public(), "passed": was_queued})


# ---------------------------------------------------------------------------
# HOT CRATES — the ticking part economy
# ---------------------------------------------------------------------------

def hot_public(c: dict, now: float) -> dict:
    return {
        "cid": c["cid"], "slot": c["slot"], "tier": c["tier"],
        "name": c["name"], "passes": c["passes"],
        "left": round(max(0.0, c["deadline"] - now), 1),
        "from": c.get("from_name"),
    }


async def push_hot(r: Room, p: Player):
    now = time.time()
    mine = [hot_public(c, now) for c in r.hot.values() if c["holder"] == p.pid]
    mine.sort(key=lambda c: c["left"])
    await send(p.ws, {"t": "hot", "crates": mine})


async def spawn_hot(r: Room, p: Player, part: dict):
    """A part that wasn't an upgrade arrives live, with the fuse already lit."""
    now = time.time()

    # Cap the clutter. Over the cap, the oldest crate in the room is defused
    # and quietly discarded — better than three screens of ticking boxes.
    cap = max(3, len([q for q in r.players.values() if q.joined]) * HOT_PER_PLAYER)
    while len(r.hot) >= cap:
        oldest = min(r.hot.values(), key=lambda c: c["born"])
        r.hot.pop(oldest["cid"], None)
        holder = r.players.get(oldest["holder"])
        if holder:
            await send(holder.ws, {"t": "toast", "kind": "warn",
                                   "text": "SCRAPYARD FULL — OLDEST CRATE BINNED"})
            await push_hot(r, holder)

    cid = r.next_hot
    r.next_hot += 1
    r.hot[cid] = {
        "cid": cid, "slot": part["slot"], "tier": part["tier"],
        "name": part["name"], "holder": p.pid, "passes": 0,
        "born": now, "deadline": now + HOT_FUSE_SECONDS, "from_name": None,
    }
    await push_hot(r, p)


def hot_part(c: dict) -> dict:
    """Rebuild a real part from a crate's current slot and tier."""
    base = next(x for x in partsmod.CATALOG[c["slot"]] if x["tier"] == c["tier"])
    return dict(base, slot=c["slot"], faulty=False)


async def claim_hot(r: Room, p: Player, cid: int):
    """Take the part as it stands. Defuses the crate."""
    c = r.hot.get(cid)
    if not c or c["holder"] != p.pid:
        return
    r.hot.pop(cid, None)
    p.loadout = p.loadout or partsmod.Loadout()
    award = p.loadout.award(hot_part(c))
    await send(p.ws, {"t": "part", **award, "loadout": p.loadout.public()})
    await push_hot(r, p)


async def pass_hot(r: Room, p: Player, cid: int, target_pid: str,
                   direction: str = ""):
    """
    Shove it at someone else. The crate gains a tier on the way — but the
    fuse keeps burning, so the better it gets the more dangerous it is.
    """
    c = r.hot.get(cid)
    if not c or c["holder"] != p.pid:
        return
    target = neighbour(r, p, direction) if direction else r.players.get(target_pid)
    if not target or target.pid == p.pid or not target.joined or not target.alive:
        return

    rank = partsmod.TIER_RANK[c["tier"]]
    if rank < len(partsmod.TIERS) - 1:
        c["tier"] = partsmod.TIERS[rank + 1]
    c["name"] = next(x for x in partsmod.CATALOG[c["slot"]]
                     if x["tier"] == c["tier"])["name"]
    c["holder"] = target.pid
    c["passes"] += 1
    c["from_name"] = p.name

    p.passes_made += 1
    p.public_passes += 1
    target.passes_taken += 1

    await push_hot(r, p)
    await push_hot(r, target)
    await send(target.ws, {"t": "toast", "kind": "bad",
                           "text": "LIVE CRATE FROM " + p.name})
    await broadcast_hosts(r, {"t": "pass_fx", "fromPid": p.pid,
                              "toPid": target.pid, "from": p.name,
                              "to": target.name, "kind": "crate",
                              "tier": c["tier"], "passes": c["passes"]})


async def tick_hot(r: Room):
    """Blow up anything whose fuse has run out."""
    now = time.time()
    for c in [x for x in r.hot.values() if now >= x["deadline"]]:
        r.hot.pop(c["cid"], None)
        holder = r.players.get(c["holder"])
        if not holder:
            continue
        lost = holder.loadout.strip_random() if holder.loadout else None
        await send(holder.ws, {
            "t": "hot_blew", "crate": hot_public(c, now),
            "lost": partsmod.public_part(lost, lost["slot"]) if lost else None,
            "loadout": (holder.loadout or partsmod.Loadout()).public(),
        })
        await push_hot(r, holder)
        await broadcast_hosts(r, {
            "t": "wreck_fx", "name": holder.name,
            "part": lost["name"] if lost else "nothing",
            "tier": lost["tier"] if lost else "common", "kind": "crate"})


async def start_minigame(r: Room, p: Player, kind: str, extra: Optional[dict] = None):
    """
    Interrupt this player's quiz for a real-time dodge or ring run.

    Their live question is taken off the clock first, otherwise it would
    expire while they are busy flying and they would be punished twice.
    """
    if r.quiz:
        r.quiz.take(p.pid)
    p.minigame = kind
    await send(p.ws, {"t": "minigame", "kind": kind, **(extra or {})})


async def end_minigame(r: Room, p: Player, success: bool, kind: str):
    """Apply the stakes, then put them back into the quiz."""
    p.minigame = ""
    lost = None
    if not success and p.loadout:
        lost = p.loadout.strip_best() if kind == "dodge" else p.loadout.strip_random()

    await send(p.ws, {
        "t": "minigame_over", "kind": kind, "success": success,
        "lost": partsmod.public_part(lost, lost["slot"]) if lost else None,
        "loadout": (p.loadout or partsmod.Loadout()).public(),
    })
    if lost:
        await broadcast_hosts(r, {
            "t": "wreck_fx", "name": p.name, "part": lost["name"],
            "tier": lost["tier"], "kind": kind})

    if r.phase == "round" and p.alive and r.quiz:
        inst = r.quiz.issue(p.pid)
        await send(p.ws, {"t": "question", **inst.public()})


async def handle_strike(r: Room, p: Player, msg: dict):
    """Spend an earned missile on somebody. They get a chance to dodge."""
    if p.strikes <= 0 or r.phase != "round":
        return
    target = r.players.get(msg.get("targetPid", ""))
    if not target or target.pid == p.pid or not target.joined:
        return
    if target.minigame:
        await send(p.ws, {"t": "toast", "kind": "bad",
                          "text": target.name + " IS ALREADY BUSY"})
        return
    p.strikes -= 1
    await send(p.ws, {"t": "strike_ready", "n": p.strikes})
    await send(p.ws, {"t": "toast", "kind": "good",
                      "text": "MISSILE AWAY → " + target.name})
    if target.is_bot:
        # bots dodge about half the time, so firing at one is still a gamble
        await asyncio.sleep(1.2)
        await end_minigame(r, target, random.random() < 0.5, "dodge")
        return
    await start_minigame(r, target, "dodge", {"from": p.name})
    await broadcast_hosts(r, {"t": "strike_fx", "from": p.name, "to": target.name})


def ring(r: Room) -> List[Player]:
    """Everyone still in the game, in seating order around the circle."""
    seated = [p for p in r.players.values() if p.joined and p.alive]
    seated.sort(key=lambda p: p.seat)
    return seated


def neighbour(r: Room, p: Player, direction: str) -> Optional[Player]:
    """
    Who is to your left or right. Walks past anyone knocked out, so the
    circle never has a dead seat you can throw things into.
    """
    seats = ring(r)
    if len(seats) < 2 or p not in seats:
        return None
    i = seats.index(p)
    step = -1 if direction == "left" else 1
    return seats[(i + step) % len(seats)]


def seating(r: Room) -> List[dict]:
    seats = ring(r)
    out = []
    for i, p in enumerate(seats):
        out.append({
            "pid": p.pid, "name": p.name, "avatar": p.avatar, "seat": i,
            "left": seats[(i - 1) % len(seats)].pid if len(seats) > 1 else None,
            "right": seats[(i + 1) % len(seats)].pid if len(seats) > 1 else None,
            "rating": (p.loadout or partsmod.Loadout()).rating(),
            "filled": (p.loadout or partsmod.Loadout()).filled(),
            "correct": p.correct,
            "parts": (p.loadout or partsmod.Loadout()).public()["parts"],
        })
    return out


def target_by_heading(r: Room, sender: Player, heading: float) -> Optional[Player]:
    others = [p for p in r.alive_players() if p.pid != sender.pid]
    if not others:
        return None
    n = len(others) + 1
    best, best_d = None, 999.0
    for p in others:
        seat_angle = (360.0 / n) * ((p.seat - sender.seat) % n)
        d = abs((heading - seat_angle + 180) % 360 - 180)
        if d < best_d:
            best, best_d = p, d
    return best


async def handle_pass(r: Room, sender: Player, msg: dict):
    if r.quiz is None:
        return
    if sender.active_power and sender.active_power["id"] == "locked":
        await send(sender.ws, {"t": "toast", "kind": "bad",
                               "text": "LOCKED BAY — CAN'T PASS"})
        return

    direction = msg.get("dir")
    target = neighbour(r, sender, direction) if direction else \
        r.players.get(msg.get("targetPid", ""))
    if target is None or not target.alive or target.pid == sender.pid:
        return

    inst = r.quiz.take(sender.pid)
    if inst is None:
        return

    silent = False
    if sender.active_power and sender.active_power["id"] == "deflector":
        silent = True
        sender.active_power = None

    sender.passes_made += 1
    target.passes_taken += 1
    if not silent:
        sender.public_passes += 1

    landed = r.quiz.hand_to(inst, target.pid, sender.pid, sender.name,
                            silent=silent)
    if landed is not None:
        await send(target.ws, {"t": "question", **landed.public(), "passed": True})
    else:
        await send(target.ws, {"t": "toast", "kind": "bad",
                               "text": "A QUESTION IS QUEUED FOR YOU"})

    nxt = r.quiz.issue(sender.pid)
    await send(sender.ws, {"t": "question", **nxt.public()})

    if not silent:
        await broadcast_hosts(r, {"t": "pass_fx", "fromPid": sender.pid,
                                  "toPid": target.pid, "from": sender.name,
                                  "to": target.name, "heat": inst.heat,
                                  "kind": "question"})


async def handle_trade(r: Room, p: Player, msg: dict):
    if p.agenda != "mechanic" or r.phase != "discussion":
        return
    if p.traded_with:
        await send(p.ws, {"t": "toast", "kind": "bad", "text": "ALREADY TRADED"})
        return

    other = r.players.get(msg.get("targetPid", ""))
    mine_slot, their_slot = msg.get("mySlot"), msg.get("theirSlot")
    if not other or other.pid == p.pid:
        return
    if mine_slot not in partsmod.SLOTS or their_slot not in partsmod.SLOTS:
        return

    p.loadout = p.loadout or partsmod.Loadout()
    other.loadout = other.loadout or partsmod.Loadout()

    mine = p.loadout.parts.get(mine_slot)
    theirs = other.loadout.parts.get(their_slot)
    if mine is None and theirs is None:
        await send(p.ws, {"t": "toast", "kind": "bad", "text": "NOTHING TO SWAP"})
        return

    p.loadout.parts[mine_slot] = None
    other.loadout.parts[their_slot] = None
    if theirs:
        theirs = dict(theirs, slot=mine_slot)
        p.loadout.parts[mine_slot] = theirs
    if mine:
        mine = dict(mine, slot=their_slot)
        other.loadout.parts[their_slot] = mine

    p.traded_with = other.pid
    await send(p.ws, {"t": "traded", "with": other.name,
                      "got": partsmod.public_part(theirs, mine_slot) if theirs else None,
                      "gave": partsmod.public_part(mine, their_slot) if mine else None,
                      "loadout": p.loadout.public()})
    await send(other.ws, {"t": "traded", "with": p.name, "forced": True,
                          "got": partsmod.public_part(mine, their_slot) if mine else None,
                          "gave": partsmod.public_part(theirs, mine_slot) if theirs else None,
                          "loadout": other.loadout.public()})
    await broadcast_hosts(r, {"t": "trade_fx", "from": p.name, "to": other.name})


async def handle_inspect(r: Room, p: Player, msg: dict):
    if p.agenda != "inspector" or p.inspected:
        return
    other = r.players.get(msg.get("targetPid", ""))
    if not other or other.pid == p.pid:
        return
    p.inspected = other.pid
    lo = other.loadout or partsmod.Loadout()
    await send(p.ws, {"t": "inspection", "name": other.name,
                      "avatar": other.avatar, "loadout": lo.public()})


# ---------------------------------------------------------------------------
# THREAT VOTE + DOGFIGHT
# ---------------------------------------------------------------------------

async def resolve_threat_vote(r: Room):
    tally: Dict[str, int] = {}
    for target in r.votes.values():
        tally[target] = tally.get(target, 0) + 1

    marked = None
    if tally:
        top = max(tally.values())
        leaders = [pid for pid, c in tally.items() if c == top]
        marked = leaders[0] if len(leaders) == 1 else random.choice(leaders)

    threat = r.players.get(marked) if marked else None
    r.threat = threat.pid if threat else ""
    r.reveal = {
        "threat": threat.name if threat else None,
        "tally": [{"name": r.players[pid].name, "votes": c}
                  for pid, c in sorted(tally.items(), key=lambda x: -x[1])
                  if pid in r.players],
    }
    if threat:
        await send(threat.ws, {
            "t": "marked", "bounty": THREAT_BOUNTY,
            "text": f"The table marked you. Kills on you pay {THREAT_BOUNTY}x — "
                    f"but you fly with an afterburner.",
        })
    await broadcast(r, {
        "t": "threat",
        "name": threat.name if threat else None,
        "avatar": threat.avatar if threat else None,
        "bounty": THREAT_BOUNTY, "tally": r.reveal["tally"],
    })
    await asyncio.sleep(3)


async def run_dogfight(r: Room):
    secs = r.s("fight_seconds")
    fight = dogfightmod.Dogfight(seconds=secs, threat=r.threat,
                                 bounty=THREAT_BOUNTY)
    r.fight = fight

    for p in r.players.values():
        if not p.joined:
            continue
        lo = p.loadout or partsmod.Loadout()
        st = lo.flight_stats()
        if p.pid == r.threat:
            st["maxSpeed"] *= 1.18
            st["accel"] *= 1.25
            st["hp"] *= 1.1
        fight.add(p.pid, p.name, p.avatar, st, [])

    def on_kill(shooter_jet, victim_jet, f):
        killer = r.players.get(shooter_jet.pid)
        victim = r.players.get(victim_jet.pid)
        if not killer or not victim or killer.agenda != "scavenger":
            return
        if not victim.loadout:
            return
        taken = victim.loadout.strip_best()
        if not taken:
            return
        killer.loadout = killer.loadout or partsmod.Loadout()
        killer.loadout.award(taken)
        killer.stolen.append(partsmod.public_part(taken, taken["slot"]))
        shooter_jet.stats = killer.loadout.flight_stats()
        victim_jet.stats = victim.loadout.flight_stats()
        f.events.append({"kind": "steal", "pid": killer.pid,
                         "name": killer.name, "from": victim.name,
                         "part": taken["name"], "tier": taken["tier"]})

    fight.on_kill = on_kill

    r.phase = "fight"
    r.phase_ends = time.time() + secs + 6
    await push_state(r)

    for p in r.players.values():
        if not p.joined or not p.crates:
            continue
        p.loadout = p.loadout or partsmod.Loadout()
        opened = [p.loadout.award(c) for c in p.crates]
        p.crates = []
        await send(p.ws, {"t": "crate_open", "opened": opened,
                          "loadout": p.loadout.public()})
        # the crate may have changed the jet they're about to fly
        if p.pid in fight.jets:
            fight.jets[p.pid].stats = p.loadout.flight_stats()
            fight.jets[p.pid].max_hp = fight.jets[p.pid].hp = \
                p.loadout.flight_stats()["hp"]
    await asyncio.sleep(2.2)

    await broadcast(r, {
        "t": "fight_start", "seconds": secs,
        "arena": [dogfightmod.ARENA_W, dogfightmod.ARENA_H],
        "threat": r.threat,
        "jets": [{"pid": p.pid, "name": p.name, "avatar": p.avatar,
                  "loadout": (p.loadout or partsmod.Loadout()).public()}
                 for p in r.players.values() if p.joined],
    })
    await asyncio.sleep(4)

    fight.start(time.time())
    frame = 0
    dt = 1.0 / FIGHT_HZ

    while fight.running:
        now = time.time()
        snap = fight.step(now)
        for b in r.players.values():
            if b.is_bot:
                bot_fly(fight, b.pid, now)
        await broadcast_hosts(r, snap)

        frame += 1
        if frame % PHONE_EVERY == 0:
            for p in r.players.values():
                if p.is_bot or not p.ws:
                    continue
                me = next((j for j in snap["jets"] if j["pid"] == p.pid), None)
                if me:
                    # a coarse blip list for the phone minimap — positions
                    # rounded hard, since it only drives a 90px radar
                    blips = [{"p": j["pid"], "x": round(j["x"] / 16),
                              "y": round(j["y"] / 16),
                              "h": round(j["heading"] / 15),
                              "a": 1 if j["alive"] else 0}
                             for j in snap["jets"]]
                    await send(p.ws, {"t": "fight_me", "me": me,
                                      "left": snap["left"],
                                      "blips": blips,
                                      "arena": snap["arena"],
                                      "events": [e for e in snap["events"]
                                                 if e.get("pid") == p.pid
                                                 or e.get("victimPid") == p.pid]})
        await asyncio.sleep(dt)

    standings = score_agendas(r, fight, fight.standings())
    r.fight_standings = standings
    await broadcast(r, {"t": "fight_over", "standings": standings})
    await asyncio.sleep(5)


def bot_fly(fight, pid: str, now: float):
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


def score_agendas(r: Room, fight, standings: List[dict]) -> List[dict]:
    joined = [p for p in r.players.values() if p.joined]
    best_rank = max((p.loadout.best_tier_rank() if p.loadout else -1)
                    for p in joined) if joined else -1
    by_pid = {row["pid"]: row for row in standings}

    for p in joined:
        row = by_pid.get(p.pid)
        if row is None:
            continue
        lo = p.loadout or partsmod.Loadout()
        bonus, note = 0, ""

        if p.agenda == "magpie":
            if lo.best_tier_rank() >= 0 and lo.best_tier_rank() == best_rank:
                bonus, note = MAGPIE_BONUS, "held the rarest part at the table"
            else:
                note = "was out-collected"

        elif p.agenda == "duelist":
            rival = r.players.get(p.rival)
            n = sum(1 for e in fight.kill_log
                    if e["killer"] == p.pid and rival and e["victim"] == rival.pid)
            bonus = n * DUELIST_PER_KILL
            note = (f"downed {rival.name} {n}x" if rival and n
                    else f"never caught {rival.name}" if rival else "had no rival")

        elif p.agenda == "scavenger":
            bonus = len(p.stolen) * SCAVENGER_PER_PART
            note = (f"stripped {len(p.stolen)} part(s) off wrecks"
                    if p.stolen else "never scavenged a thing")

        elif p.agenda == "mechanic":
            other = r.players.get(p.traded_with)
            if other:
                mine = lo.rating()
                theirs = (other.loadout or partsmod.Loadout()).rating()
                if mine > theirs:
                    bonus, note = MECHANIC_BONUS, f"out-traded {other.name}"
                else:
                    note = f"traded with {other.name} and lost out"
            else:
                note = "never forced a trade"

        elif p.agenda == "inspector":
            target = r.players.get(p.inspected)
            if target and target.pid == r.threat:
                bonus = INSPECTOR_BONUS
                note = f"inspected {target.name} — the table agreed"
            elif target:
                note = f"inspected {target.name}, who nobody feared"
            else:
                note = "never opened a panel"

        elif p.agenda == "quartermaster":
            n = sum(p.gave_to.values())
            bonus = n * QUARTERMASTER_PER_PART
            note = f"fed {n} part(s) to other pilots"

        elif p.agenda == "featherweight":
            if lo.filled() <= FEATHERWEIGHT_MAX_SLOTS:
                bonus = FEATHERWEIGHT_BONUS
                note = f"flew light — {lo.filled()} bays"
            else:
                note = f"got greedy — {lo.filled()} bays"

        a = AGENDAS.get(p.agenda, {})
        row["agenda"] = p.agenda
        row["agendaName"] = a.get("name", "")
        row["agendaColor"] = a.get("color", "")
        row["agendaNote"] = note
        row["bonus"] = bonus
        row["final"] = row["score"] + bonus
        row["rating"] = lo.rating()
        row["stolen"] = p.stolen
        row["loadout"] = lo.public()

    standings.sort(key=lambda x: -x.get("final", x["score"]))
    return standings


# ---------------------------------------------------------------------------
# APP
# ---------------------------------------------------------------------------

app = FastAPI(title="SCRAMBLE")


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


PUBLIC_URL = {
    "url": (os.environ.get("PUBLIC_URL", "")
            or os.environ.get("RENDER_EXTERNAL_URL", "")).rstrip("/")
           or f"http://{lan_ip()}:{PORT}"
}


def base_url(request) -> str:
    """
    The address a phone should use to reach us.

    PUBLIC_URL wins when set. Otherwise we read it off the incoming request,
    honouring the proxy headers Render and Cloudflare set, so QR codes point
    at the real hostname without anything to configure.
    """
    if os.environ.get("PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL"):
        return PUBLIC_URL["url"]
    try:
        host = request.headers.get("x-forwarded-host") or \
            request.headers.get("host")
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        if host:
            return f"{proto}://{host}"
    except Exception:
        pass
    return PUBLIC_URL["url"]


@app.get("/")
async def home():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/rules")
async def rules_page():
    return FileResponse(os.path.join(STATIC_DIR, "rules.html"))


@app.get("/host")
async def host_page():
    return FileResponse(os.path.join(STATIC_DIR, "host.html"))


@app.get("/play")
async def player_page():
    return FileResponse(os.path.join(STATIC_DIR, "player.html"))


@app.post("/api/room")
async def api_room(request: Request):
    r = create_room()
    return JSONResponse({"code": r.code,
                         "join": base_url(request) + "/play?code=" + r.code})


@app.get("/api/health")
async def api_health():
    """Render pings this to decide whether the service is up."""
    return JSONResponse({"ok": True, "rooms": len(ROOMS)})


@app.get("/api/room/{code}")
async def api_room_check(code: str):
    r = ROOMS.get(code.upper())
    if not r:
        return JSONResponse({"ok": False, "reason": "no such room"}, status_code=404)
    return JSONResponse({"ok": True, "code": r.code, "phase": r.phase,
                         "players": len(r.roster())})


@app.get("/qr.png")
async def qr_png(request: Request, code: str = ""):
    url = base_url(request) + "/play" + (f"?code={code}" if code else "")
    img = qrcode.make(url, box_size=11, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    me: Optional[Player] = None
    room: Optional[Room] = None
    is_host = False

    try:
        while True:
            msg = json.loads(await ws.receive_text())
            t = msg.get("t")

            # ---- joining a room --------------------------------------
            if t == "host_watch":
                code = str(msg.get("code", "")).upper()
                room = ROOMS.get(code)
                if not room:
                    await send(ws, {"t": "join_error", "reason": "ROOM CLOSED"})
                    continue
                is_host = True
                room.hosts.append(ws)
                room.touched = time.time()
                await push_state(room)
                continue

            if t == "join":
                code = str(msg.get("code", "")).upper()
                room = ROOMS.get(code)
                if not room:
                    await send(ws, {"t": "join_error", "reason": "NO SUCH ROOM"})
                    continue
                if room.phase not in ("lobby", "results") and \
                        not msg.get("pid") in room.players:
                    await send(ws, {"t": "join_error",
                                    "reason": "GAME ALREADY IN PROGRESS"})
                    continue
                pid = msg.get("pid") or \
                    f"p{int(time.time()*1000)%100000}{random.randint(10,99)}"
                me = room.players.get(pid) or Player(pid=pid)
                me.ws = ws
                me.connected = True
                me.name = (msg.get("name") or "PILOT")[:14].upper()
                av = str(msg.get("avatar") or "fox")[:16]
                me.avatar = av if av in AVATAR_IDS else "fox"
                me.joined = True
                if room.phase == "lobby":
                    me.lobby_only = False
                room.players[pid] = me
                room.touched = time.time()
                await send(ws, {"t": "joined", "pid": pid, "name": me.name,
                                "code": room.code})
                await push_state(room)
                continue

            if room is None:
                continue
            room.touched = time.time()

            # ---- host controls ---------------------------------------
            if t == "start":
                if is_host and ws in room.hosts and room.phase in ("lobby", "results"):
                    await start_game(room, fill=bool(msg.get("fill")),
                                     settings=msg.get("settings"))
                continue

            if t == "reset":
                if is_host and ws in room.hosts:
                    await reset_to_lobby(room)
                continue

            if t == "return_lobby":
                if me and me.ws is ws:
                    me.lobby_only = True
                    me.minigame = ""
                    me.strikes = 0
                    if room.quiz:
                        room.quiz.live.pop(me.pid, None)
                        room.quiz.queued.pop(me.pid, None)
                    for cid, crate in list(room.hot.items()):
                        if crate["holder"] == me.pid:
                            room.hot.pop(cid, None)
                    if room.fight and me.pid in room.fight.jets:
                        jet = room.fight.jets[me.pid]
                        jet.alive = False
                        jet.firing = False
                    await send(ws, {"t": "player_lobby", "code": room.code,
                                    "players": room.roster()})
                    await push_state(room)
                continue

            if me is None or me.ws is not ws or me.lobby_only:
                continue

            # ---- player messages -------------------------------------
            if t == "answer":
                me.answered = True
                await deliver_agenda(room, me)
                await push_state(room)

            elif t == "heading":
                me.heading = float(msg.get("h", 0))

            elif t == "pass":
                if room.phase == "round":
                    await handle_pass(room, me, msg)

            elif t == "quiz_answer":
                if room.phase == "round":
                    iid = msg.get("inst")
                    await resolve_answer(room, me, int(msg.get("choice", -1)),
                                         int(iid) if iid is not None else None)

            elif t == "claim_hot":
                if room.phase == "round":
                    await claim_hot(room, me, int(msg.get("cid", 0)))

            elif t == "pass_hot":
                if room.phase == "round":
                    await pass_hot(room, me, int(msg.get("cid", 0)),
                                   msg.get("targetPid", ""),
                                   msg.get("dir", ""))

            elif t == "strike":
                if room.phase == "round":
                    await handle_strike(room, me, msg)

            elif t == "minigame_result":
                if me.minigame:
                    await end_minigame(room, me, bool(msg.get("success")),
                                       me.minigame)

            elif t == "trade":
                await handle_trade(room, me, msg)

            elif t == "inspect":
                await handle_inspect(room, me, msg)

            elif t == "vote":
                if room.phase == "vote" and msg.get("target"):
                    room.votes[me.pid] = msg["target"]
                    await broadcast_hosts(room, {
                        "t": "vote_cast", "n": len(room.votes),
                        "of": len(room.alive_players())})

            elif t == "ctl":
                if room.fight and room.fight.running:
                    room.fight.control(me.pid, float(msg.get("steer", 0.0)),
                                       float(msg.get("throttle", 0.5)),
                                       bool(msg.get("fire", False)))

            elif t == "missile":
                if room.fight and room.fight.running:
                    if room.fight.fire_missile(me.pid, time.time()):
                        await send(ws, {"t": "missile_away"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if room:
            if is_host and ws in room.hosts:
                room.hosts.remove(ws)
            if me:
                if me.ws is ws:
                    me.connected = False
                    me.ws = None
                try:
                    await push_state(room)
                except Exception:
                    pass


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


if __name__ == "__main__":
    ip = lan_ip()
    print("\n" + "=" * 60)
    print("  S C R A M B L E")
    print("=" * 60)
    print(f"  OPEN THIS   ->  {PUBLIC_URL['url']}")
    print(f"  ON THIS PC  ->  http://{ip}:{PORT}")
    print("=" * 60)
    if PUBLIC_URL["url"].startswith("https://"):
        print("  HTTPS active — motion controls will work on iPhones.")
    else:
        print("  Phones must be on the SAME Wi-Fi.")
        print("  iPhones need HTTPS for motion — set PUBLIC_URL to an")
        print("  https:// tunnel address. See README.md")
    print("=" * 60 + "\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
