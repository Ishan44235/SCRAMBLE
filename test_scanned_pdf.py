import os
import json
from pathlib import Path
from unittest.mock import patch
import grok_questions as g


def test_scanned_pdf_single_vision_request():
    pdf = Path('/mnt/data/IntroToElec.pdf')
    if not pdf.exists():
        return
    content = pdf.read_bytes()
    assert len(g.extract_pdf_text(content)) < 100
    seen = []
    def fake_request(api_key, model, prompt, images=None):
        assert images and len(images) == 9
        assert all(len(x) > 1000 and not x.startswith('data:') for x in images)
        seen.append(1)
        return json.dumps([{'q': f'Question {i}', 'options': ['Current', 'Voltage', 'Resistance', 'Energy'], 'answer': 0} for i in range(10)])
    with patch.dict(os.environ, {'XAI_API_KEY': 'test-key'}), patch.object(g, '_request_grok', side_effect=fake_request):
        data = g.generate_bank('study', 'easy', pdf_data=content, count=10, on_progress=lambda n, x: None)
    assert len(data['questions']) == 10
    assert len(seen) == 1
