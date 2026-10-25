import asyncio
from unittest.mock import patch
import server

class FakeInst:
    def public(self): return {"q": "x"}

class FakeQuiz:
    """Answers come back right or wrong from a script, nothing else matters."""
    def __init__(self, script): self.script = list(script); self.queued = {}; self.last_received = {}
    def resolve(self, pid, choice, now, inst):
        ok = self.script.pop(0)
        return {"correct": ok, "points": 10 if ok else 0, "multiplier": 1, "timedOut": False}
    def issue(self, pid, inst=None): return FakeInst()
    def accuracy(self): return 1.0
    def take(self, pid): return None

def run(script, fire_after=None):
    r = server.Room(code="T"); r.phase = "round"; r.quiz = FakeQuiz(script)
    p = server.Player(pid="p1", ws="W", joined=True, alive=True, name="A")
    q = server.Player(pid="p2", joined=True, alive=True, name="B", is_bot=True)
    r.players = {"p1": p, "p2": q}
    sent = []
    async def fs(ws, m): sent.append(m)
    async def fh(r, m): pass
    async def fend(*a, **k): pass
    async def go():
        for i in range(len(script)):
            await server.resolve_answer(r, p, 0)
            if fire_after is not None and i == fire_after:
                await server.handle_strike(r, p, {})
    with patch.object(server, "send", fs), patch.object(server, "broadcast_hosts", fh), \
         patch.object(server, "end_minigame", fend), patch.object(server.partsmod, "roll_part", lambda h: None):
        asyncio.run(go())
    return p, [m for m in sent if m.get("t") == "strike_ready"]

def test_three_right_not_in_a_row_earns_one():
    p, msgs = run([True, False, True, False, False, True])
    assert p.strikes == 1 and msgs[-1]["earned"]

def test_two_right_is_not_enough():
    p, msgs = run([True, False, True, False])
    assert p.strikes == 0 and msgs[-1]["progress"] == 2

def test_missiles_do_not_stack_while_one_is_loaded():
    p, _ = run([True] * 7)
    assert p.strikes == 1 and p.missile_progress == 0

def test_count_resets_after_firing():
    # 3 right -> loaded; 2 more right while loaded don't count; fire; then
    # it takes 3 fresh right answers, not 1
    p, _ = run([True, True, True, True, True, True, True], fire_after=4)
    assert p.strikes == 0 and p.missile_progress == 2
    p, _ = run([True, True, True, True, True, True, True, True], fire_after=4)
    assert p.strikes == 1
