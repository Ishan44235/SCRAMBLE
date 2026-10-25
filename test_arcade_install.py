import asyncio, time
from unittest.mock import patch
import server, arcade

def setup():
    r = server.Room(code="A"); r.question_mode = "arcade"; r.phase = "round"
    p = server.Player(pid="p1", ws="W", joined=True, alive=True, name="A")
    p.loadout = server.partsmod.Loadout()
    r.players = {"p1": p}
    sent = []
    async def fs(ws, m): sent.append(m)
    async def fh(r, m): pass
    return r, p, sent, fs, fh

def test_upgrade_waits_for_rotation_then_next_level_is_dealt():
    r, p, sent, fs, fh = setup()
    async def go():
        await server.deal_arcade_game(r, p)
        tok = p.arcade_token
        await server.end_arcade_game(r, p, True, tok)      # empty jet: always an upgrade
        assert p.pending_part is not None
        assert any(m["t"] == "part_pending" for m in sent)
        assert all(x is None for x in p.loadout.parts.values()), "not fitted until rotated"
        assert p.arcade_next_at == 0.0, "next level must wait for the install"
        await server.install_pending_part(r, p, p.pending_token)
        assert p.pending_part is None and p.loadout.filled() == 1
        assert p.arcade_next_at > time.time(), "next level scheduled after fitting"
    with patch.object(server, "send", fs), patch.object(server, "broadcast_hosts", fh):
        asyncio.run(go())

def test_part_won_at_the_buzzer_is_fitted_not_lost():
    r, p, sent, fs, fh = setup()
    r.settings = {"round_seconds": 1}
    async def go():
        arcade.BEAT_SECONDS = 0.01
        task = asyncio.create_task(server.run_arcade_round(r, 1))
        await asyncio.sleep(0.1)
        await server.end_arcade_game(r, p, True, p.arcade_token)
        assert p.pending_part is not None
        await asyncio.sleep(1.3)                         # clock runs out
        assert p.pending_part is None and p.loadout.filled() == 1
        task.cancel()
    with patch.object(server, "send", fs), patch.object(server, "broadcast_hosts", fh), \
         patch.object(server, "broadcast", lambda *a, **k: asyncio.sleep(0)), \
         patch.object(server, "push_state", lambda r: asyncio.sleep(0)):
        asyncio.run(go())

def test_quiz_install_unchanged():
    # mirrors test_new_gestures.test_pending_part_installs_once
    r = server.Room(code="T"); r.phase = "round"
    p = server.Player(pid="p", joined=True); r.players[p.pid] = p
    p.loadout = server.partsmod.Loadout(); p.pending_part = server.partsmod.roll_part(1); p.pending_token = 5
    async def nop(*a, **k): pass
    async def go():
        await server.install_pending_part(r, p, 4); assert p.pending_part is not None
        await server.install_pending_part(r, p, 5); assert p.pending_part is None
        await server.install_pending_part(r, p, 5)
        assert sum(x is not None for x in p.loadout.parts.values()) == 1
    with patch.object(server, "send", nop), patch.object(server, "broadcast_hosts", nop):
        asyncio.run(go())
