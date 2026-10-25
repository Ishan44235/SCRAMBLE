import asyncio
import unittest
from unittest.mock import AsyncMock
import server

class LobbyMechanics(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.room = server.create_room()
        for i in range(3):
            self.room.players[f'p{i}'] = server.Player(pid=f'p{i}', name=f'P{i}', joined=True, connected=True, ws=None)

    async def asyncTearDown(self):
        if self.room.task and not self.room.task.done():
            self.room.task.cancel()
            await asyncio.sleep(0)
        server.ROOMS.pop(self.room.code, None)

    async def test_reset_cancels_match_and_preserves_humans(self):
        await server.start_game(self.room)
        self.assertEqual(self.room.phase, 'calling')
        self.assertIsNotNone(self.room.task)
        self.room.fight = server.dogfightmod.Dogfight()
        self.room.fight.running = True
        await server.reset_to_lobby(self.room)
        self.assertEqual(self.room.phase, 'lobby')
        self.assertFalse(self.room.fight if self.room.fight else False)
        self.assertEqual(len(self.room.players), 3)
        self.assertIsNone(self.room.task)

    async def test_no_duplicate_start_while_active(self):
        await server.start_game(self.room)
        existing = self.room.task
        await server.start_game(self.room)
        self.assertIs(self.room.task, existing)

    async def test_lobby_only_players_excluded_from_active_roster(self):
        p = self.room.players['p0']
        p.lobby_only = True
        self.assertNotIn(p, self.room.alive_players())
        self.assertNotIn(p, self.room.humans())
        await server.reset_to_lobby(self.room)
        self.assertFalse(p.lobby_only)

if __name__ == '__main__': unittest.main()
