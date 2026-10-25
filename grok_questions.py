"""Compact, one-request quiz generation with xAI Grok or Google Gemini."""
import base64
import io
import json
import os
import re
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

COUNTS = (10, 20, 30, 50, 75, 100)

# Study mode asks how comfortable the class is with the material rather than
# for a difficulty. The API still takes easy/medium/hard; these say what each
# level means to the model, so a shaky class gets questions it can build
# confidence on and a confident one gets pushed.
STUDY_COMFORT = {
    'easy': ('Shaky',
             'The students are SHAKY on this material. Write straightforward recall '
             'and recognition questions on the main ideas, key terms and definitions '
             'stated directly in the source. One concept per question, plain wording, '
             'no trick phrasing; wrong choices should be clearly wrong to someone who '
             'has read the notes once.'),
    'medium': ('Steady',
               'The students are STEADY: they know the basics. Mix recall with '
               'understanding: why and how questions, comparing related concepts, '
               'picking the right idea for a situation, and applying a stated rule or '
               'formula to a simple case. Wrong choices should be plausible.'),
    'hard': ('Confident',
             'The students are CONFIDENT with this material. Write challenging '
             'application and analysis questions: multi-step reasoning, applying '
             'concepts to new scenarios, edge cases, combining two ideas, and worked '
             'calculations where the source supports it. Wrong choices should be the '
             'common misconceptions and near-misses a confident student could fall for.'),
}


def extract_pdf_text(pdf_data):
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(pdf_data))
        if reader.is_encrypted:
            raise ValueError('Password-protected PDFs are not supported.')
        text = '\n'.join(p.extract_text() or '' for p in reader.pages).strip()
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('Could not read the lecture PDF.') from exc
    # Source excerpt cap avoids feeding entire textbooks into each quiz request.
    return text[:65_000]


def slide_images(pdf_data, on_progress=None):
    try:
        import fitz
        doc = fitz.open(stream=pdf_data, filetype='pdf')
        if doc.needs_pass:
            raise ValueError('Password-protected PDFs are not supported.')
        if not doc.page_count or doc.page_count > 35:
            raise ValueError('Scanned PDFs must contain 1–35 pages.')
        images = []
        for i, page in enumerate(doc):
            if on_progress and (i == 0 or i == doc.page_count - 1):
                on_progress(0, f'Preparing lecture slide {i+1}/{doc.page_count}')
            # Moderate resolution and JPEG quality minimize vision-token and upload costs.
            pix = page.get_pixmap(matrix=fitz.Matrix(1.35, 1.35), alpha=False)
            images.append(base64.b64encode(pix.tobytes('jpeg', jpg_quality=72)).decode('ascii'))
        doc.close()
        return images
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError('Unable to render scanned lecture slides.') from exc


def _request_grok(api_key, model, prompt, images=None):
    if images:
        content = [{'type': 'input_text', 'text': prompt}]
        content.extend({'type': 'input_image', 'image_url': 'data:image/jpeg;base64,' + img, 'detail': 'high'} for img in images)
        inputs = [{'role': 'user', 'content': content}]
    else:
        inputs = prompt
    payload = {'model': model, 'input': inputs, 'store': False}
    req = Request('https://api.x.ai/v1/responses', json.dumps(payload).encode(),
                  headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}, method='POST')
    try:
        with urlopen(req, timeout=240) as resp:
            data = json.load(resp)
    except HTTPError as exc:
        detail = exc.read(700).decode('utf-8', 'replace')
        raise RuntimeError(f'Grok API error {exc.code}: {detail}') from exc
    except URLError as exc:
        raise RuntimeError(f'Grok connection failed: {exc.reason}') from exc
    return ''.join(x['text'] for block in data.get('output', [])
                   for x in block.get('content', []) if x.get('type') == 'output_text') or data.get('output_text', '')


def _request_gemini(api_key, model, prompt, images=None):
    parts = [{'text': prompt}]
    parts.extend({'inline_data': {'mime_type': 'image/jpeg', 'data': img}} for img in (images or []))
    payload = {'contents': [{'role': 'user', 'parts': parts}],
               'generationConfig': {'responseMimeType': 'application/json', 'temperature': 0.45}}
    from urllib.parse import quote
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe="")}:generateContent'
    req = Request(url, json.dumps(payload).encode(),
                  headers={'x-goog-api-key': api_key, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urlopen(req, timeout=240) as resp:
            data = json.load(resp)
    except HTTPError as exc:
        detail = exc.read(700).decode('utf-8', 'replace')
        raise RuntimeError(f'Gemini API error {exc.code}: {detail}') from exc
    except URLError as exc:
        raise RuntimeError(f'Gemini connection failed: {exc.reason}') from exc
    return ''.join(part.get('text', '') for candidate in data.get('candidates', [])[:1]
                   for part in candidate.get('content', {}).get('parts', []))


def generate_bank(mode, level, topic=None, pdf_data=None, on_progress=None, count=100, provider='grok'):
    if provider not in ('grok', 'gemini'):
        raise ValueError('Choose Grok or Gemini.')
    if mode not in ('trivia', 'study') or level not in ('easy', 'medium', 'hard'):
        raise ValueError('Invalid mode or difficulty.')
    if type(count) is not int or count not in COUNTS:
        raise ValueError('Choose 10, 20, 30, 50, 75 or 100 questions.')
    if mode == 'trivia' and not (topic or '').strip():
        raise ValueError('Enter a trivia topic.')
    if mode == 'study' and not pdf_data:
        raise ValueError('Upload a lecture PDF.')
    envkey = 'XAI_API_KEY' if provider == 'grok' else 'GEMINI_API_KEY'
    api_key = os.getenv(envkey, '').strip()
    if not api_key or api_key.startswith('PASTE_'):
        raise ValueError(f'{envkey} is missing from .env.')
    model = os.getenv('XAI_MODEL', 'grok-4.7') if provider == 'grok' else os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
    if on_progress:
        on_progress(0, 'Preparing ' + ('slides' if mode == 'study' else 'topic'))
    images = []
    if mode == 'study':
        notes = extract_pdf_text(pdf_data)
        if len(notes) < 100:
            # No intermediate OCR/notes-generation request: slides go directly to the model.
            images = slide_images(pdf_data, on_progress)
            source = 'Use ONLY the attached lecture slides as source.'
        else:
            source = 'Use ONLY the lecture notes below:\n' + notes
    else:
        source = 'Topic: ' + topic.strip()[:180]

    # Study describes the class's comfort with the material; trivia keeps the
    # plain difficulty word. Lower comfort -> easier questions.
    if mode == 'study':
        comfort_label, comfort_brief = STUDY_COMFORT[level]
        lead = (f'Write exactly {count} distinct multiple-choice questions. '
                f'{comfort_brief} ')
    else:
        comfort_label = level.capitalize()
        lead = f'Write exactly {count} distinct {level} multiple-choice questions. '

    # Short keys keep generated response token usage lower without losing correctness.
    prompt = (lead +
              'Use the source only for Study mode. Cover different source concepts; no repeats. '
              'Each must have 4 plausible choices and exactly one correct answer. '
              'Vary the answer position. Return ONLY a compact JSON array; schema: '
              '[{"q":"Question?","options":["A","B","C","D"],"answer":0}]. '
              '"answer" is the zero-based index (0-3) of the correct choice. '
              'No explanations, markdown, or extra fields.\n' + source)
    if on_progress:
        on_progress(0, f'{provider.title()} generating all {count} questions in one request')
    call = _request_grok if provider == 'grok' else _request_gemini
    text = (call(api_key, model, prompt, images=images or None) or '').strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.I).strip()
    try:
        raw = json.loads(text)
    except (ValueError, TypeError) as exc:
        raise RuntimeError(f'{provider.title()} returned unreadable JSON. Previous bank preserved.') from exc
    if isinstance(raw, dict):
        raw = raw.get('questions')
    if not isinstance(raw, list) or len(raw) != count:
        raise RuntimeError(f'{provider.title()} returned {len(raw) if isinstance(raw, list) else 0}/{count} questions. Previous bank preserved.')
    questions = []
    for q in raw:
        if (not isinstance(q, dict) or not isinstance(q.get('q'), str)
                or not isinstance(q.get('options'), list) or len(q['options']) != 4
                or not all(isinstance(o, str) and o.strip() for o in q['options'])
                or type(q.get('answer')) is not int or q['answer'] not in range(4)):
            raise RuntimeError('Generated question lacks four choices or a correct answer. Previous bank preserved.')
        questions.append({'q': q['q'].strip(), 'options': [o.strip() for o in q['options']], 'answer': q['answer']})
    if on_progress:
        on_progress(count, f'{count} questions ready')
    return {'title': (topic.strip() if mode == 'trivia' else 'Study: Lecture Notes')[:100],
            'description': f'{mode.capitalize()} · {comfort_label} · {provider.title()}', 'questions': questions}
