import sys, time, types
from fastapi.testclient import TestClient
import server

BANK = {'title': 'Orbital Mechanics', 'description': 'Study · Steady · Grok',
        'questions': [{'q': f'Question {i}?', 'options': ['A', 'B', 'C', 'D'], 'answer': i % 4} for i in range(20)]}

def new_room(client):
    d = client.post('/api/room').json()
    return d['code'], d['hostToken']

def test_generated_bank_is_handed_to_the_host_then_reused_in_a_new_room():
    old = sys.modules.get('grok_questions')
    sys.modules['grok_questions'] = types.SimpleNamespace(generate_bank=lambda *a: BANK)
    try:
        with TestClient(server.app) as c:
            code, tok = new_room(c)
            with c.websocket_connect('/ws') as host:
                host.send_json({'t': 'host_watch', 'code': code, 'hostToken': tok})
                r = c.post(f'/api/room/{code}/questions', headers={'X-Scramble-Host-Token': tok},
                           data={'mode': 'study', 'level': 'medium', 'count': '20'},
                           files={'pdf': ('notes.pdf', b'%PDF-1.4 test', 'application/pdf')})
                assert r.status_code == 200, r.text
                saved = None
                for _ in range(40):
                    m = host.receive_json()
                    if m.get('t') == 'bank_saved':
                        saved = m['bank']; break
                assert saved and saved['mode'] == 'study' and saved['level'] == 'medium'
                assert len(saved['questions']) == 20 and saved['id']
                assert saved['title'] == 'Study: notes', saved['title']
            # a brand-new room, loaded from the saved copy — no generator involved
            sys.modules['grok_questions'] = types.SimpleNamespace(generate_bank=lambda *a: 1 / 0)
            code2, tok2 = new_room(c)
            r = c.post(f'/api/room/{code2}/bank', headers={'X-Scramble-Host-Token': tok2}, json=saved)
            assert r.status_code == 200, r.text
            room = server.ROOMS[code2]
            assert room.question_mode == 'study' and room.question_bank_id == saved['id']
            assert len(room.question_deck['questions']) == 20
            assert server.bank_public(room)['id'] == saved['id']
            # switching that room back to the built-in deck clears it
            r = c.post(f'/api/room/{code2}/mode', headers={'X-Scramble-Host-Token': tok2}, data={'mode': 'default'})
            assert r.status_code == 200 and room.question_deck is None and server.bank_public(room)['id'] == ''
    finally:
        if old is None: sys.modules.pop('grok_questions', None)
        else: sys.modules['grok_questions'] = old

def test_saved_bank_needs_the_host_token_and_valid_questions():
    with TestClient(server.app) as c:
        code, tok = new_room(c)
        good = dict(BANK, id='abc', mode='trivia', level='easy')
        assert c.post(f'/api/room/{code}/bank', json=good).status_code == 403
        bad = dict(good, questions=[{'q': 'x?', 'options': ['A', 'B'], 'answer': 0}])
        assert c.post(f'/api/room/{code}/bank', headers={'X-Scramble-Host-Token': tok}, json=bad).status_code == 400
        bad2 = dict(good, questions=[{'q': 'x?', 'options': ['A', 'B', 'C', 'D'], 'answer': 7}])
        assert c.post(f'/api/room/{code}/bank', headers={'X-Scramble-Host-Token': tok}, json=bad2).status_code == 400
        assert c.post(f'/api/room/{code}/bank', headers={'X-Scramble-Host-Token': tok}, json=dict(good, mode='arcade')).status_code == 400
        assert c.post(f'/api/room/{code}/bank', headers={'X-Scramble-Host-Token': tok}, json=good).status_code == 200
