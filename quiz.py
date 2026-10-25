"""
quiz.py — the question engine for TRENCHCOAT's quiz mode.

Design rule that drives everything here: the correct answer NEVER leaves the
server until the question is resolved. The client is sent shuffled options and
nothing else, so opening devtools tells you nothing.
"""

import json
import os
import random
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))

BASE_SECONDS = 18          # time to answer a fresh question
HEAT_PENALTY = 3           # seconds knocked off per pass
MIN_SECONDS = 7            # floor, however hot the question gets

BASE_POINTS = 100
SPEED_BONUS = 60           # scaled by how much time was left
WRONG_PENALTY = 40


def load_deck(path: Optional[str] = None) -> dict:
    """Load questions.json, falling back to a tiny built-in deck."""
    path = path or os.path.join(HERE, "questions.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            deck = json.load(f)
        qs = [q for q in deck.get("questions", [])
              if isinstance(q.get("options"), list)
              and len(q["options"]) == 4
              and isinstance(q.get("answer"), int)
              and 0 <= q["answer"] < 4
              and str(q.get("q", "")).strip()]
        if qs:
            return {"title": deck.get("title", "Quiz"),
                    "description": deck.get("description", ""),
                    "questions": qs}
    except Exception:
        pass
    return {
        "title": "Fallback",
        "description": "questions.json was missing or unreadable.",
        "questions": [{
            "q": "How many hearts does an octopus have?",
            "options": ["Three", "One", "Two", "Five"], "answer": 0,
        }],
    }


@dataclass
class Instance:
    """One question in flight, on its way to one player."""
    inst: int
    qid: int
    text: str
    options: List[str]          # already shuffled for this instance
    answer: int                 # index into the shuffled options
    true_answer: int            # what it was before any doctoring
    heat: int = 0
    doctored: bool = False
    from_pid: Optional[str] = None
    from_name: Optional[str] = None
    silent: bool = False
    chain: List[str] = field(default_factory=list)
    deadline: float = 0.0
    issued: float = 0.0

    def seconds(self) -> int:
        return max(MIN_SECONDS, BASE_SECONDS - self.heat * HEAT_PENALTY)

    def public(self) -> dict:
        """What the player is allowed to see. No answer key."""
        return {
            "inst": self.inst,
            "q": self.text,
            "options": self.options,
            "heat": self.heat,
            "from": None if self.silent else self.from_name,
            "seconds": self.seconds(),
            "multiplier": self.heat + 1,
        }


class QuizEngine:
    def __init__(self, deck: Optional[dict] = None):
        self.deck = deck or load_deck()
        self._next_inst = 1
        self.bag: List[int] = []
        self.live: Dict[str, Instance] = {}        # pid -> their open question
        self.queued: Dict[str, List[Instance]] = {}  # pid -> questions waiting
        self.last_received: Dict[str, Instance] = {}
        self.answered = 0
        self.correct = 0

    # ---------------------------------------------------------------- deck
    def _draw_qid(self) -> int:
        if not self.bag:
            self.bag = list(range(len(self.deck["questions"])))
            random.shuffle(self.bag)
        return self.bag.pop()

    def make(self, qid: Optional[int] = None) -> Instance:
        qid = self._draw_qid() if qid is None else qid
        q = self.deck["questions"][qid]

        order = list(range(4))
        random.shuffle(order)
        options = [q["options"][i] for i in order]
        answer = order.index(q["answer"])

        inst = Instance(
            inst=self._next_inst, qid=qid, text=q["q"],
            options=options, answer=answer, true_answer=answer,
        )
        self._next_inst += 1
        return inst

    # ---------------------------------------------------------------- flow
    def issue(self, pid: str, inst: Optional[Instance] = None) -> Instance:
        """Give a player their next question, preferring anything queued."""
        if inst is None and self.queued.get(pid):
            inst = self.queued[pid].pop(0)
        inst = inst or self.make()
        inst.issued = time.time()
        inst.deadline = inst.issued + inst.seconds()
        self.live[pid] = inst
        return inst

    def has_live(self, pid: str) -> bool:
        return pid in self.live

    def enqueue(self, pid: str, inst: Instance) -> None:
        """Park a passed question behind the one they're already working on."""
        self.queued.setdefault(pid, []).append(inst)

    def take(self, pid: str) -> Optional[Instance]:
        """Remove and return a player's open question, for passing it on."""
        return self.live.pop(pid, None)

    def hand_to(self, inst: Instance, target_pid: str,
                from_pid: str, from_name: str,
                silent: bool = False, doctor: bool = False):
        """
        Pass a question along, hotter than before.

        Returns the instance if it went live immediately, or None if the
        target was already working on something and it had to queue. Never
        clobber a live question — that would silently destroy an answer the
        player was partway through.
        """
        inst.heat += 1
        inst.from_pid = from_pid
        inst.from_name = from_name
        inst.silent = silent
        inst.chain.append(from_pid)

        if doctor and not inst.doctored:
            # The Cheat's lie: the answer key is swapped, so answering
            # honestly is now marked wrong.
            wrong = [i for i in range(4) if i != inst.answer]
            inst.answer = random.choice(wrong)
            inst.doctored = True

        self.last_received[target_pid] = inst
        if self.has_live(target_pid):
            self.enqueue(target_pid, inst)
            return None
        return self.issue(target_pid, inst)

    def expired(self, now: float) -> List[tuple]:
        """Questions whose timer has run out, as (pid, instance)."""
        return [(pid, i) for pid, i in list(self.live.items())
                if i.deadline and now >= i.deadline]

    # ------------------------------------------------------------- scoring
    def resolve(self, pid: str, choice: int, now: float,
                inst_id: Optional[int] = None) -> Optional[dict]:
        """
        Score an answer. choice of -1 means the timer ran out.

        inst_id guards against a late answer landing on the wrong question —
        if it doesn't match what's live, the answer is ignored.
        """
        inst = self.live.get(pid)
        if inst is None:
            return None
        if inst_id is not None and inst_id != inst.inst:
            return None
        self.live.pop(pid, None)

        timed_out = choice is None or choice < 0
        correct = (not timed_out) and choice == inst.answer
        mult = inst.heat + 1

        if correct:
            left = max(0.0, inst.deadline - now)
            speed = int(SPEED_BONUS * (left / max(1, inst.seconds())))
            points = (BASE_POINTS + speed) * mult
        elif timed_out:
            points = -WRONG_PENALTY * mult // 2
        else:
            points = -WRONG_PENALTY * mult

        self.answered += 1
        if correct:
            self.correct += 1

        return {
            "inst": inst.inst,
            "correct": correct,
            "timedOut": timed_out,
            "correctIndex": inst.answer,
            "trueIndex": inst.true_answer,
            "doctored": inst.doctored,
            "points": points,
            "multiplier": mult,
            "chain": inst.chain,
        }

    def accuracy(self) -> float:
        return (self.correct / self.answered) if self.answered else 1.0

    def audit(self, pid: str) -> Optional[dict]:
        """Proctor power: inspect the last question handed to this player."""
        inst = self.last_received.get(pid)
        if inst is None:
            return None
        return {
            "q": inst.text,
            "doctored": inst.doctored,
            "from": inst.from_name,
            "heat": inst.heat,
            "hops": len(inst.chain),
        }
