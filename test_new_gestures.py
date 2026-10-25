import asyncio
import unittest
from unittest.mock import patch
import server
import quiz
import parts

class GestureMechanics(unittest.IsolatedAsyncioTestCase):
    async def test_reroll_replaces_question_and_is_limited(self):
        r = server.Room(code='TEST')
        r.phase = 'round'
        r.quiz = quiz.QuizEngine()
        p = server.Player(pid='p', joined=True)
        r.players[p.pid] = p
        old = r.quiz.issue(p.pid)
        with patch.object(server, 'send', new=self.record_send):
            await server.reroll_question(r,p,old.inst)
            self.assertEqual(p.rerolls_left,1)
            self.assertNotEqual(r.quiz.live[p.pid].qid, old.qid)
            newer = r.quiz.live[p.pid]
            await server.reroll_question(r,p,old.inst)
            self.assertEqual(p.rerolls_left,1)
            await server.reroll_question(r,p,newer.inst)
            self.assertEqual(p.rerolls_left,0)
            last = r.quiz.live[p.pid]
            await server.reroll_question(r,p,last.inst)
            self.assertEqual(last.inst,r.quiz.live[p.pid].inst)

    async def test_pending_part_installs_once(self):
        r = server.Room(code='TEST')
        r.phase='round'
        p=server.Player(pid='p',joined=True)
        r.players[p.pid]=p
        p.loadout=parts.Loadout()
        p.pending_part=parts.roll_part(1)
        p.pending_token=5
        with patch.object(server,'send',new=self.record_send), patch.object(server,'broadcast_hosts',new=self.record_send):
            await server.install_pending_part(r,p,4)
            self.assertIsNotNone(p.pending_part)
            await server.install_pending_part(r,p,5)
            self.assertIsNone(p.pending_part)
            self.assertTrue(any(x is not None for x in p.loadout.parts.values()))
            await server.install_pending_part(r,p,5)
            self.assertEqual(sum(x is not None for x in p.loadout.parts.values()),1)

    async def record_send(self,*args,**kwargs):
        pass

if __name__ == '__main__':
    unittest.main()
