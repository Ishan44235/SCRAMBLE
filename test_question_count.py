from unittest.mock import patch
import json
import re
import grok_questions


def test_grok_variable_count_one_request():
    calls = []
    def fake_request(key, model, prompt, images=None):
        calls.append(prompt)
        n = int(re.search(r'Write exactly (\d+)', prompt).group(1))
        return json.dumps([{'q': f'Question {i}?', 'options': ['A', 'B', 'C', 'D'], 'answer': i % 4} for i in range(n)])
    with patch.dict('os.environ', {'XAI_API_KEY': 'test-placeholder'}), patch.object(grok_questions, '_request_grok', side_effect=fake_request):
        result = grok_questions.generate_bank('trivia', 'easy', 'Science', count=20)
    assert len(result['questions']) == 20
    assert len(calls) == 1
    assert result['questions'][0]['answer'] == 0


def test_gemini_one_request_and_answer_keys():
    calls = []
    def fake_request(key, model, prompt, images=None):
        calls.append((key, model, prompt, images))
        return json.dumps([{'q': f'Gemini Q{i}?', 'options': ['A', 'B', 'C', 'D'], 'answer': i % 4} for i in range(30)])
    with patch.dict('os.environ', {'GEMINI_API_KEY': 'test-gemini-key'}), patch.object(grok_questions, '_request_gemini', side_effect=fake_request):
        result = grok_questions.generate_bank('trivia', 'medium', 'Astronomy', count=30, provider='gemini')
    assert len(calls) == 1
    assert result['questions'][15]['answer'] == 3
    assert 'Gemini' in result['description']
