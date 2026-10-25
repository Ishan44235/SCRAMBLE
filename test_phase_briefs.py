import asyncio
import json
import unittest
from unittest.mock import AsyncMock
import server


class PhaseBriefTests(unittest.IsolatedAsyncioTestCase):
    async def test_ends_early_when_all_active_players_ready(self):
        room = server.create_room()
        try:
            sockets = [type('Socket', (), {})() for _ in range(2)]
            for i, sock in enumerate(sockets):
                sock.send_text = AsyncMock()
                room.players[str(i)] = server.Player(
                    pid=str(i), name=f'Player {i}', joined=True,
                    connected=True, ws=sock)
            task = asyncio.create_task(server.phase_brief(room, 'dogfight'))
            await asyncio.sleep(0.03)
            self.assertTrue(room.brief_active)
            phase_msgs = [json.loads(c.args[0]) for c in sockets[0].send_text.call_args_list]
            self.assertEqual(phase_msgs[0]['stage'], 'dogfight')
            room.brief_ready.add('0')
            await asyncio.sleep(0.15)
            self.assertFalse(task.done(), 'Must wait for both players')
            room.brief_ready.add('1')
            await asyncio.wait_for(task, 1.0)
            self.assertFalse(room.brief_active)
            all_msgs = [json.loads(c.args[0]) for c in sockets[0].send_text.call_args_list]
            self.assertTrue(any(m['t'] == 'phase_brief_end' for m in all_msgs))
        finally:
            server.ROOMS.pop(room.code, None)

    async def test_lobby_reset_invalidates_brief(self):
        room = server.create_room()
        try:
            task = asyncio.create_task(server.phase_brief(room, 'quiz'))
            await asyncio.sleep(0.02)
            old_id = room.brief_id
            await server.reset_to_lobby(room)
            self.assertNotEqual(old_id, room.brief_id)
            self.assertFalse(room.brief_active)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        finally:
            server.ROOMS.pop(room.code, None)


if __name__ == '__main__':
    unittest.main()
