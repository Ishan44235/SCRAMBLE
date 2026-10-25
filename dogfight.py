"""
dogfight.py — the finale.

A server-authoritative top-down dogfight. Phones send steering, throttle and
trigger state; the server flies every jet, moves every bullet, and broadcasts
the world to the host screen. Nothing about hit detection happens on a phone,
so a doctored client can fly badly at worst.

Sabotaged parts fail here: somewhere in the middle of the fight the engine
cuts, the guns jam, or the missiles go dead — and the host screen says so by
name, which is when the table works out who handed them that part.
"""

import math
import random
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

ARENA_W = 1600
ARENA_H = 900

TICK = 1.0 / 30.0
FIGHT_SECONDS = 75
RESPAWN_SECONDS = 4.0

BULLET_SPEED = 620.0
BULLET_LIFE = 1.5
MISSILE_SPEED = 420.0
MISSILE_LIFE = 5.0
MISSILE_COOLDOWN = 1.6

# When a faulty part gives out, as a fraction of the fight.
FAULT_WINDOW = (0.25, 0.70)

FAULT_TEXT = {
    "engine":   "ENGINE FLAMEOUT",
    "guns":     "GUNS JAMMED",
    "missiles": "MISSILE RACK DEAD",
    "wings":    "CONTROL SURFACE TORN",
    "armor":    "ARMOUR PLATE SHEARED",
}


def wrap(v: float, hi: float) -> float:
    if v < 0:
        return v + hi
    if v >= hi:
        return v - hi
    return v


def ang_diff(a: float, b: float) -> float:
    """Smallest signed angle from a to b, in degrees."""
    return (b - a + 180.0) % 360.0 - 180.0


@dataclass
class Bullet:
    x: float
    y: float
    vx: float
    vy: float
    owner: str
    dmg: float
    born: float


@dataclass
class Missile:
    x: float
    y: float
    heading: float
    speed: float
    owner: str
    dmg: float
    track: float
    born: float
    target: Optional[str] = None


@dataclass
class Jet:
    pid: str
    name: str
    avatar: str
    stats: dict
    faulty: List[str] = field(default_factory=list)

    x: float = 0.0
    y: float = 0.0
    heading: float = 0.0
    speed: float = 0.0
    hp: float = 100.0
    max_hp: float = 100.0

    steer: float = 0.0        # -1 .. 1, from the phone's roll
    throttle: float = 0.5     # 0 .. 1, from the phone's pitch
    firing: bool = False

    missiles_left: int = 0
    last_shot: float = 0.0
    last_missile: float = 0.0

    kills: int = 0
    deaths: int = 0
    damage_done: float = 0.0
    alive: bool = True
    respawn_at: float = 0.0

    # which sabotaged parts have already given out, and when they will
    failed: List[str] = field(default_factory=list)
    fail_at: Dict[str, float] = field(default_factory=dict)

    def broken(self, slot: str) -> bool:
        return slot in self.failed

    def public(self) -> dict:
        return {
            "pid": self.pid, "name": self.name, "avatar": self.avatar,
            "x": round(self.x, 1), "y": round(self.y, 1),
            "heading": round(self.heading, 1),
            "speed": round(self.speed, 1),
            "hp": round(max(0.0, self.hp), 1), "maxHp": round(self.max_hp, 1),
            "alive": self.alive,
            "kills": self.kills, "deaths": self.deaths,
            "missiles": self.missiles_left,
            "failed": self.failed,
        }


class Dogfight:
    def __init__(self, seconds: int = FIGHT_SECONDS):
        self.jets: Dict[str, Jet] = {}
        self.bullets: List[Bullet] = []
        self.missiles: List[Missile] = []
        self.events: List[dict] = []
        self.started = 0.0
        self.seconds = seconds
        self.running = False

    # ------------------------------------------------------------ setup
    def add(self, pid: str, name: str, avatar: str,
            stats: dict, faulty: List[str]):
        j = Jet(pid=pid, name=name, avatar=avatar, stats=stats,
                faulty=list(faulty))
        j.max_hp = j.hp = stats["hp"]
        j.missiles_left = int(stats["missiles"])
        self.jets[pid] = j

    def start(self, now: Optional[float] = None):
        now = now or time.time()
        self.started = now
        self.running = True
        n = max(1, len(self.jets))
        for i, j in enumerate(self.jets.values()):
            # ring formation, all facing the middle
            a = (360.0 / n) * i
            r = min(ARENA_W, ARENA_H) * 0.33
            j.x = ARENA_W / 2 + r * math.cos(math.radians(a))
            j.y = ARENA_H / 2 + r * math.sin(math.radians(a))
            j.heading = (a + 180.0) % 360.0
            j.speed = j.stats["maxSpeed"] * 0.55
            # schedule each sabotaged part to give out mid-fight
            for slot in j.faulty:
                frac = random.uniform(*FAULT_WINDOW)
                j.fail_at[slot] = now + self.seconds * frac

    def elapsed(self, now: float) -> float:
        return now - self.started

    def time_left(self, now: float) -> float:
        return max(0.0, self.seconds - self.elapsed(now))

    # ------------------------------------------------------------ input
    def control(self, pid: str, steer: float, throttle: float, firing: bool):
        j = self.jets.get(pid)
        if not j:
            return
        j.steer = max(-1.0, min(1.0, float(steer)))
        j.throttle = max(0.0, min(1.0, float(throttle)))
        j.firing = bool(firing)

    def fire_missile(self, pid: str, now: float) -> bool:
        j = self.jets.get(pid)
        if not j or not j.alive or j.missiles_left <= 0:
            return False
        if j.broken("missiles"):
            return False
        if now - j.last_missile < MISSILE_COOLDOWN:
            return False
        j.last_missile = now
        j.missiles_left -= 1
        self.missiles.append(Missile(
            x=j.x, y=j.y, heading=j.heading, speed=MISSILE_SPEED,
            owner=pid, dmg=j.stats["missileDmg"],
            track=j.stats["missileTrack"], born=now,
            target=self._lock(j),
        ))
        return True

    def _lock(self, shooter: Jet) -> Optional[str]:
        """Nearest living enemy roughly ahead of the nose."""
        best, best_d = None, 1e9
        for o in self.jets.values():
            if o.pid == shooter.pid or not o.alive:
                continue
            dx, dy = o.x - shooter.x, o.y - shooter.y
            d = math.hypot(dx, dy)
            bearing = math.degrees(math.atan2(dy, dx))
            if abs(ang_diff(shooter.heading, bearing)) < 75 and d < best_d:
                best, best_d = o.pid, d
        return best

    # ------------------------------------------------------------- step
    def step(self, now: float) -> dict:
        if not self.running:
            return self.snapshot(now)
        self.events = []

        self._apply_faults(now)
        for j in self.jets.values():
            self._fly(j, now)
            if j.alive and j.firing:
                self._shoot(j, now)
        self._move_bullets(now)
        self._move_missiles(now)
        self._respawns(now)

        if self.time_left(now) <= 0:
            self.running = False
        return self.snapshot(now)

    def _apply_faults(self, now: float):
        for j in self.jets.values():
            for slot, when in list(j.fail_at.items()):
                if now >= when and slot not in j.failed:
                    j.failed.append(slot)
                    self.events.append({
                        "kind": "fault", "pid": j.pid, "name": j.name,
                        "slot": slot, "text": FAULT_TEXT.get(slot, "PART FAILED"),
                    })

    def _fly(self, j: Jet, now: float):
        if not j.alive:
            return
        s = j.stats

        turn = s["turnRate"]
        if j.broken("wings"):
            turn *= 0.35
        j.heading = (j.heading + j.steer * turn * TICK) % 360.0

        target_speed = s["maxSpeed"] * (0.28 + 0.72 * j.throttle)
        if j.broken("engine"):
            target_speed *= 0.4
        rate = s["accel"] * TICK
        j.speed += max(-rate, min(rate, target_speed - j.speed))

        rad = math.radians(j.heading)
        j.x = wrap(j.x + math.cos(rad) * j.speed * TICK, ARENA_W)
        j.y = wrap(j.y + math.sin(rad) * j.speed * TICK, ARENA_H)

    def _shoot(self, j: Jet, now: float):
        if j.broken("guns"):
            return
        gap = 1.0 / max(0.5, j.stats["rof"])
        if now - j.last_shot < gap:
            return
        j.last_shot = now
        spread = j.stats["spread"]
        a = math.radians(j.heading + random.uniform(-spread, spread))
        self.bullets.append(Bullet(
            x=j.x + math.cos(math.radians(j.heading)) * 18,
            y=j.y + math.sin(math.radians(j.heading)) * 18,
            vx=math.cos(a) * BULLET_SPEED,
            vy=math.sin(a) * BULLET_SPEED,
            owner=j.pid, dmg=j.stats["bulletDmg"], born=now,
        ))

    def _move_bullets(self, now: float):
        alive = []
        for b in self.bullets:
            if now - b.born > BULLET_LIFE:
                continue
            b.x = wrap(b.x + b.vx * TICK, ARENA_W)
            b.y = wrap(b.y + b.vy * TICK, ARENA_H)
            if not self._impact(b.x, b.y, 15, b.owner, b.dmg, now, "guns"):
                alive.append(b)
        self.bullets = alive

    def _move_missiles(self, now: float):
        alive = []
        for m in self.missiles:
            if now - m.born > MISSILE_LIFE:
                continue
            tgt = self.jets.get(m.target) if m.target else None
            if tgt and tgt.alive:
                bearing = math.degrees(math.atan2(tgt.y - m.y, tgt.x - m.x))
                d = ang_diff(m.heading, bearing)
                m.heading += max(-m.track * 60 * TICK,
                                 min(m.track * 60 * TICK, d))
            rad = math.radians(m.heading)
            m.x = wrap(m.x + math.cos(rad) * m.speed * TICK, ARENA_W)
            m.y = wrap(m.y + math.sin(rad) * m.speed * TICK, ARENA_H)
            if not self._impact(m.x, m.y, 26, m.owner, m.dmg, now, "missile"):
                alive.append(m)
        self.missiles = alive

    def _impact(self, x: float, y: float, radius: float, owner: str,
                dmg: float, now: float, weapon: str) -> bool:
        for j in self.jets.values():
            if j.pid == owner or not j.alive:
                continue
            if math.hypot(j.x - x, j.y - y) <= radius:
                j.hp -= dmg
                shooter = self.jets.get(owner)
                if shooter:
                    shooter.damage_done += dmg
                self.events.append({
                    "kind": "hit", "x": round(x), "y": round(y),
                    "weapon": weapon, "pid": j.pid,
                })
                if j.hp <= 0:
                    self._down(j, shooter, now, weapon)
                return True
        return False

    def _down(self, victim: Jet, shooter: Optional[Jet], now: float, weapon: str):
        victim.alive = False
        victim.deaths += 1
        victim.respawn_at = now + RESPAWN_SECONDS
        if shooter:
            shooter.kills += 1
        self.events.append({
            "kind": "kill", "x": round(victim.x), "y": round(victim.y),
            "victim": victim.name, "victimPid": victim.pid,
            "killer": shooter.name if shooter else None,
            "weapon": weapon,
        })

    def _respawns(self, now: float):
        for j in self.jets.values():
            if j.alive or now < j.respawn_at:
                continue
            j.alive = True
            j.hp = j.max_hp
            j.x = random.uniform(120, ARENA_W - 120)
            j.y = random.uniform(120, ARENA_H - 120)
            j.heading = random.uniform(0, 360)
            j.speed = j.stats["maxSpeed"] * 0.5
            # a respawn tops up one missile so late game isn't dry
            if j.missiles_left < 1 and j.stats["missiles"] > 0:
                j.missiles_left = 1
            self.events.append({"kind": "respawn", "pid": j.pid, "name": j.name})

    # --------------------------------------------------------- reporting
    def snapshot(self, now: float) -> dict:
        return {
            "t": "fight",
            "left": round(self.time_left(now), 1),
            "running": self.running,
            "jets": [j.public() for j in self.jets.values()],
            "bullets": [{"x": round(b.x), "y": round(b.y)} for b in self.bullets],
            "missiles": [{"x": round(m.x), "y": round(m.y),
                          "h": round(m.heading)} for m in self.missiles],
            "events": self.events,
            "arena": [ARENA_W, ARENA_H],
        }

    def standings(self) -> List[dict]:
        rows = [{
            "pid": j.pid, "name": j.name, "avatar": j.avatar,
            "kills": j.kills, "deaths": j.deaths,
            "damage": round(j.damage_done),
            "score": j.kills * 100 - j.deaths * 25 + int(j.damage_done * 0.2),
            "failed": j.failed,
        } for j in self.jets.values()]
        rows.sort(key=lambda r: -r["score"])
        return rows
