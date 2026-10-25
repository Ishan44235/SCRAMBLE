import asyncio
from unittest.mock import patch
import server


def test_random_quiz_missile_targets_a_player():
    r = server.Room(code='TEST')
    p = server.Player(pid='p1', joined=True, alive=True, strikes=1)
    q = server.Player(pid='p2', joined=True, alive=True)
    r.players = {'p1': p, 'p2': q}
    r.phase = 'round'
    events = []

    async def fake_send(ws, payload):
        events.append(payload)

    async def fake_start(room, target, kind, extra=None):
        events.append({'t': 'game', 'target': target.pid, 'kind': kind})

    async def fake_hosts(room, payload):
        events.append(payload)

    with patch.object(server, 'send', fake_send), patch.object(server, 'start_minigame', fake_start), patch.object(server, 'broadcast_hosts', fake_hosts):
        asyncio.run(server.handle_strike(r, p, {}))
    assert p.strikes == 0
    assert any(e.get('t') == 'game' and e['target'] == 'p2' and e['kind'] == 'dodge' for e in events)


def test_no_eligible_target_does_not_spend_missile():
    r = server.Room(code='TEST')
    p = server.Player(pid='p1', joined=True, alive=True, strikes=1)
    r.players = {'p1': p}
    r.phase = 'round'
    async def fake_send(ws, payload):
        pass
    with patch.object(server, 'send', fake_send):
        asyncio.run(server.handle_strike(r, p, {}))
    assert p.strikes == 1
