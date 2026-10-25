import json, re
from unittest.mock import patch
import grok_questions as G

def run(mode, level):
    seen = {}
    def fake(key, model, prompt, images=None):
        seen['prompt'] = prompt
        n = int(re.search(r'Write exactly (\d+)', prompt).group(1))
        return json.dumps([{'q': f'Q{i}?', 'options': ['A', 'B', 'C', 'D'], 'answer': i % 4} for i in range(n)])
    with patch.dict('os.environ', {'XAI_API_KEY': 'test'}), \
         patch.object(G, '_request_grok', side_effect=fake), \
         patch.object(G, 'extract_pdf_text', return_value='Lecture notes. ' * 50):
        bank = G.generate_bank(mode, level, topic='Space', pdf_data=b'%PDF-x', count=10)
    return seen['prompt'], bank

def test_shaky_asks_for_easier_recall_questions():
    prompt, bank = run('study', 'easy')
    assert 'SHAKY' in prompt and 'recall' in prompt
    assert bank['description'] == 'Study · Shaky · Grok'

def test_steady_is_the_middle():
    prompt, bank = run('study', 'medium')
    assert 'STEADY' in prompt and bank['description'] == 'Study · Steady · Grok'

def test_confident_asks_for_harder_application_questions():
    prompt, bank = run('study', 'hard')
    assert 'CONFIDENT' in prompt and 'multi-step' in prompt
    assert bank['description'] == 'Study · Confident · Grok'

def test_trivia_still_uses_plain_difficulty():
    prompt, bank = run('trivia', 'hard')
    assert 'distinct hard multiple-choice' in prompt and 'CONFIDENT' not in prompt
    assert bank['description'] == 'Trivia · Hard · Grok'
