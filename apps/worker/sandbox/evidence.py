"""Read bounded source evidence. Requests are JSON data; no question is shell code."""
import hashlib
import json
from pathlib import Path
import sys
from html.parser import HTMLParser
sys.path.insert(0, '/opt/research-tools')
import pymupdf

class SourceHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.main, self.body = [], [], []
        self.main_size = self.body_size = 0
    def handle_starttag(self, tag, attrs):
        if tag not in ['br', 'img', 'meta', 'link', 'input', 'hr', 'source', 'wbr']:
            self.stack.append(tag)
    def handle_endtag(self, tag):
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack) - 1 - self.stack[::-1].index(tag)]
    def handle_data(self, data):
        if any(tag in self.stack for tag in ['script', 'style', 'head', 'nav', 'header', 'footer', 'aside']):
            return
        data = data.strip()
        if self.body_size < 60000:
            self.body.append(data); self.body_size += len(data)
        if any(tag in self.stack for tag in ['main', 'article']) and self.main_size < 60000:
            self.main.append(data); self.main_size += len(data)

root = Path('/workspace/data').resolve()
request = json.loads(Path('/workspace/request.json').read_text())
results = []
remaining = 240000
for item in request['sources'][:4]:
    source = (root / item['path']).resolve()
    if root not in source.parents or source.is_symlink() or source.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('Source path or size rejected')
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != item['hash']:
        raise ValueError('Artifact hash mismatch')
    mime = item['mime']
    pages = []
    if data.startswith(b'%PDF-'):
        with pymupdf.open(stream=data, filetype='pdf') as document:
            for number in range(min(document.page_count, 200)):
                text = document[number].get_text('text')[:min(60000, remaining)]
                pages.append({'locator': 'PDF page ' + str(number + 1), 'text': text})
                remaining -= len(text)
                if remaining <= 0 or sum(len(p['text']) for p in pages) >= 60000:
                    break
            if item.get('visualPage'):
                number = item['visualPage']
                if not isinstance(number, int) or not 1 <= number <= min(document.page_count, 200):
                    raise ValueError('PDF page unavailable')
                page = document[number - 1]
                scale = min(1.5, 1800 / max(page.rect.width, page.rect.height))
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
                if pixmap.width * pixmap.height > 4000000:
                    raise ValueError('Image exceeds pixel limit')
                Path('/workspace/visual.png').write_bytes(pixmap.tobytes('png'))
    elif mime.startswith('image/'):
        if item.get('visualPage'):
            if type(item['visualPage']) is not int or item['visualPage'] != 1:
                raise ValueError('Images have only page 1')
            with pymupdf.open(stream=data) as document:
                page = document[0]
                scale = min(1, 1800 / max(page.rect.width, page.rect.height))
                Path('/workspace/visual.png').write_bytes(page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False).tobytes('png'))
    elif mime.startswith('text/') or mime == 'application/json':
        text = data.decode('utf8', errors='replace')
        if 'html' in mime:
            parser = SourceHTML(); parser.feed(text)
            text = '\n'.join(parser.main or parser.body)
        text = text[:min(60000, remaining)]
        pages.append({'locator': 'Stored HTML text' if 'html' in mime else 'Stored ' + mime, 'text': text})
        remaining -= len(text)
    results.append({'sourceId': item['sourceId'], 'hash': item['hash'], 'pages': pages})
Path('/workspace/evidence.json').write_text(json.dumps(results))
print(json.dumps({'processedSources': len(results)}))
