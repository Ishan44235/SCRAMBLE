from pathlib import Path

def test_question_builder_stays_in_lobby():
    html = (Path(__file__).parent / 'static' / 'host.html').read_text(encoding='utf-8')
    assert "$('viewResults').appendChild(panel)" not in html
    assert "AI_BANK.editable = (m.phase === 'lobby');" in html
    assert "$('aiBankDock').after(panel)" in html
    assert 'Create a new question bank in the lobby before your next game.' in html
