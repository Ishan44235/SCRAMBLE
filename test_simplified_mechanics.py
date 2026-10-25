import unittest
from unittest.mock import AsyncMock, patch
import server
import quiz


class SimplifiedMechanics(unittest.IsolatedAsyncioTestCase):
    async def test_three_total_correct_earns_missile(self):
        room = server.Room(code="TEST")
        room.phase = "round"
        room.quiz = quiz.QuizEngine()
        player = server.Player(pid="p1", joined=True)
        room.players[player.pid] = player
        mock_send = AsyncMock()
        mock_broadcast = AsyncMock()
        with patch.object(server, "send", mock_send), patch.object(server, "broadcast_hosts", mock_broadcast), patch.object(server.partsmod, "roll_part", return_value=None):
            for is_correct in (True, False, True, True):
                result = {"points": 100 if is_correct else -40, "correct": is_correct,
                          "timedOut": False, "multiplier": 1}
                room.quiz.resolve = lambda *args, result=result: result
                room.quiz.issue = lambda pid: type("Q", (), {"public": lambda self: {"inst": 5}})()
                await server.resolve_answer(room, player, 0, 5)
            self.assertEqual(player.correct, 3)
            self.assertEqual(player.round_correct, 3)
            self.assertEqual(player.strikes, 1)
            self.assertTrue(any(c.args[1].get("t") == "strike_ready" and c.args[1].get("n") == 1 for c in mock_send.await_args_list))

    async def test_quiz_missile_targets_player_and_starts_dodge(self):
        room = server.Room(code="TEST")
        room.phase = "round"
        shooter = server.Player(pid="a", joined=True, strikes=1, name="Shooter")
        victim = server.Player(pid="b", joined=True, name="Victim")
        room.players = {"a": shooter, "b": victim}
        with patch.object(server, "send", AsyncMock()) as sent, patch.object(server, "broadcast_hosts", AsyncMock()):
            await server.handle_strike(room, shooter, {"targetPid": "b"})
            self.assertEqual(shooter.strikes, 0)
            self.assertEqual(victim.minigame, "dodge")
            self.assertTrue(any(c.args[1].get("t") == "minigame" and c.args[1].get("kind") == "dodge" for c in sent.await_args_list))
            await server.handle_strike(room, shooter, {"targetPid": "b"})
            self.assertEqual(shooter.strikes, 0)

    def test_cards_cannot_be_reenabled(self):
        self.assertEqual(server.resolve_settings({"powers_per_round": 10})["powers_per_round"], 0)
