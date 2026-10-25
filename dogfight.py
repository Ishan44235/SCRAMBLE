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

# Hitboxes, in arena units. A jet is drawn about 40 units across on the big
# screen, so a bullet has to land inside roughly that to count. The old 24
# was smaller than the sprite, and shots visibly passed through planes.
BULLET_HIT_RADIUS = 38.0
MISSILE_HIT_RADIUS = 44.0

# Gun aim assist: a target this close and this near the nose pulls the burst
# onto it. Phones steer by tilt, which is coarse, so this is what makes
# gunnery feel fair rather than lucky.
AIM_ASSIST_RANGE = 380.0
AIM_ASSIST_CONE = 24.0

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


def wrapped_dist(ax: float, ay: float, bx: float, by: float) -> float:
    """
    Distance across the arena's wrapping edges.

    The arena is a torus — fly off the right and you come in on the left — so
    a bullet just past the edge and a jet just inside the other edge are
    neighbours. Plain hypot would call them a whole arena apart.
    """
    dx = abs(ax - bx)
    dy = abs(ay - by)
    dx = min(dx, ARENA_W - dx)
    dy = min(dy, ARENA_H - dy)
    return math.hypot(dx, dy)


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
    bounty_kills: int = 0
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
    def __init__(self, seconds: int = FIGHT_SECONDS, threat: str = "",
                 bounty: int = 3):
        self.threat = threat        # pid the table marked; kills on them pay more
        self.bounty = bounty
        self.on_kill = None         # set by the server for Scavenger
        self.jets: Dict[str, Jet] = {}
        self.bullets: List[Bullet] = []
        self.missiles: List[Missile] = []
        self.events: List[dict] = []
        self.kill_log: List[dict] = []   # every kill, for agenda scoring
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
        return False  # missiles are quiz-only
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

        aim = j.heading
        best_d = None
        for t in self.jets.values():
            if t.pid == j.pid or not t.alive:
                continue
            dx = t.x - j.x
            dy = t.y - j.y
            dist = math.hypot(dx, dy)
            if dist > AIM_ASSIST_RANGE:
                continue
            bearing = math.degrees(math.atan2(dy, dx))
            diff = ang_diff(j.heading, bearing)
            if abs(diff) > AIM_ASSIST_CONE:
                continue
            if best_d is None or dist < best_d:
                best_d = dist
                aim = j.heading + diff * 0.75

        shot_spread = spread * (0.6 if best_d is not None else 1.0)
        a = math.radians(aim + random.uniform(-shot_spread, shot_spread))
        nose = math.radians(aim)
        self.bullets.append(Bullet(
            x=j.x + math.cos(nose) * 18,
            y=j.y + math.sin(nose) * 18,
            vx=math.cos(a) * BULLET_SPEED,
            vy=math.sin(a) * BULLET_SPEED,
            owner=j.pid, dmg=j.stats["bulletDmg"], born=now,
        ))

    def _move_bullets(self, now: float):
        alive = []
        for b in self.bullets:
            if now - b.born > BULLET_LIFE:
                continue
            # Step in two halves so a fast bullet cannot skip clean over a
            # jet between frames now that it covers ~20 units per tick.
            hit = False
            for _ in range(2):
                b.x = wrap(b.x + b.vx * TICK / 2, ARENA_W)
                b.y = wrap(b.y + b.vy * TICK / 2, ARENA_H)
                if self._impact(b.x, b.y, BULLET_HIT_RADIUS, b.owner, b.dmg,
                                now, "guns"):
                    hit = True
                    break
            if not hit:
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
            if not self._impact(m.x, m.y, MISSILE_HIT_RADIUS, m.owner, m.dmg,
                                now, "missile"):
                alive.append(m)
        self.missiles = alive

    def _impact(self, x: float, y: float, radius: float, owner: str,
                dmg: float, now: float, weapon: str) -> bool:
        for j in self.jets.values():
            if j.pid == owner or not j.alive:
                continue
            if wrapped_dist(j.x, j.y, x, y) <= radius:
                j.hp -= dmg
                shooter = self.jets.get(owner)
                if shooter:
                    shooter.damage_done += dmg
                self.events.append({
                    "kind": "hit", "x": round(x), "y": round(y),
                    "weapon": weapon, "pid": j.pid, "shooterPid": owner,
                })
                if j.hp <= 0:
                    self._down(j, shooter, now, weapon)
                return True
        return False

    def _down(self, victim: Jet, shooter: Optional[Jet], now: float, weapon: str):
        victim.alive = False
        victim.deaths += 1
        victim.respawn_at = now + RESPAWN_SECONDS
        on_threat = bool(self.threat) and victim.pid == self.threat
        self.kill_log.append({
            "killer": shooter.pid if shooter else None,
            "victim": victim.pid, "bounty": on_threat, "t": now,
        })
        if shooter:
            shooter.kills += 1
            if on_threat:
                shooter.bounty_kills += 1
        self.events.append({
            "kind": "kill", "x": round(victim.x), "y": round(victim.y),
            "victim": victim.name, "victimPid": victim.pid,
            "killer": shooter.name if shooter else None,
            "killerPid": shooter.pid if shooter else None,
            "weapon": weapon, "bounty": on_threat,
        })
        # the server hooks this to run Scavenger and Duelist
        if shooter and self.on_kill:
            try:
                self.on_kill(shooter, victim, self)
            except Exception:
                pass

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
        rows = []
        for j in self.jets.values():
            # a bounty kill pays `bounty` times a normal one
            extra = j.bounty_kills * 100 * (self.bounty - 1)
            rows.append({
                "pid": j.pid, "name": j.name, "avatar": j.avatar,
                "kills": j.kills, "bountyKills": j.bounty_kills,
                "deaths": j.deaths,
                "damage": round(j.damage_done),
                "score": (j.kills * 100 + extra - j.deaths * 25
                          + int(j.damage_done * 0.2)),
                "failed": j.failed,
                "wasThreat": j.pid == self.threat,
            })
        rows.sort(key=lambda r: -r["score"])
        return rows
