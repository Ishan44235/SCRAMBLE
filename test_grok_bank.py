import asyncio
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
import server
import quiz


def test_question_bank_endpoint_requires_host_token():
    room = server.Room(code='GEM1')
    server.ROOMS['GEM1'] = room
    try:
        with TestClient(server.app) as client:
            denied = client.post('/api/room/GEM1/questions', data={'mode':'trivia','level':'easy','topic':'Space'})
            assert denied.status_code == 403
            allowed = client.post('/api/room/GEM1/questions', headers={'X-Scramble-Host-Token':room.host_token}, data={'mode':'study','level':'hard'})
            assert allowed.status_code == 400
    finally:
        server.ROOMS.pop('GEM1', None)


def test_only_three_question_passes_are_allowed():
    room = server.Room(code='LIM1')
    room.phase = 'round'
    room.quiz = quiz.QuizEngine()
    sender = server.Player(pid='p1', joined=True, alive=True, passes_made=3, name='A')
    victim = server.Player(pid='p2', joined=True, alive=True, name='B')
    room.players = {'p1':sender,'p2':victim}
    with patch.object(server,'send',AsyncMock()) as send:
        asyncio.run(server.handle_pass(room,sender,{'targetPid':'p2'}))
        assert sender.passes_made == 3
        assert victim.passes_taken == 0
        assert any(call.args[1].get('text') == '3 QUESTION PASSES USED' for call in send.await_args_list)


def test_generated_bank_becomes_next_match_deck():
    import sys, types, time
    room = server.Room(code='AI01')
    server.ROOMS['AI01'] = room
    bank = {'title': 'Physics', 'description': 'test',
            'questions': [{'q': f'Question number {i}?',
                           'options': ['A','B','C','D'], 'answer': 0} for i in range(100)]}
    fake = types.SimpleNamespace(generate_bank=lambda *args: bank)
    old = sys.modules.get('grok_questions')
    sys.modules['grok_questions'] = fake
    try:
        with TestClient(server.app) as client:
            response = client.post('/api/room/AI01/questions',
                headers={'X-Scramble-Host-Token':room.host_token},
                data={'mode':'trivia','level':'medium','topic':'Physics'})
            assert response.status_code == 200
            for _ in range(60):
                if not room.generation_busy:
                    break
                time.sleep(.02)
            assert not room.generation_busy
            assert len(room.question_deck['questions']) == 100
            assert room.question_deck['title'] == 'Physics'
            assert len(quiz.QuizEngine(deck=room.question_deck).deck['questions']) == 100
    finally:
        server.ROOMS.pop('AI01', None)
        if old is None:
            sys.modules.pop('grok_questions', None)
        else:
            sys.modules['grok_questions'] = old
