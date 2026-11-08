"""Binding-only HTTP service. Native codecs never execute in a Worker request."""
import json
import re
import shutil
import tempfile
import uuid
import warnings
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from PIL import Image
from media import normalize, inspect, render, end_card
warnings.simplefilter('error', Image.DecompressionBombWarning)
STAGING_ROOT = Path(tempfile.mkdtemp(prefix='holiday-staged-'))


def session_root(session):
    if str(uuid.UUID(session)) != session:
        raise ValueError('Invalid staging session')
    return STAGING_ROOT / session


def stage_file(session, name):
    if not re.fullmatch(r'(clip-[0-3]\.mp4|portrait-[0-5]\.png|music\.wav)', name):
        raise ValueError('Invalid staged file')
    return session_root(session) / name


def read_body(stream, headers, limit):
    """Bound both fixed-length and chunked requests forwarded by a Worker."""
    encoding = headers.get('Transfer-Encoding', '').lower()
    length = headers.get('Content-Length')
    if encoding:
        if encoding != 'chunked' or length is not None:
            raise ValueError('Ambiguous body framing')
        body = bytearray()
        while True:
            line = stream.readline(128)
            token = line.split(b';', 1)[0].strip()
            if not line.endswith(b'\r\n') or not token or any(c not in b'0123456789abcdefABCDEF' for c in token):
                raise ValueError('Invalid chunk size')
            size = int(token, 16)
            if size == 0:
                trailer_bytes = 0
                while True:
                    trailer = stream.readline(8193)
                    trailer_bytes += len(trailer)
                    if trailer_bytes > 8192 or not trailer.endswith(b'\r\n'):
                        raise ValueError('Invalid chunk trailer')
                    if trailer == b'\r\n':
                        break
                break
            if len(body) + size > limit:
                raise ValueError('Request is too large')
            chunk = stream.read(size)
            if len(chunk) != size or stream.read(2) != b'\r\n':
                raise ValueError('Truncated chunk')
            body.extend(chunk)
        if not body:
            raise ValueError('Empty request')
        return bytes(body)
    size = int(length or '0')
    if not 0 < size <= limit:
        raise ValueError('Invalid request size')
    body = stream.read(size)
    if len(body) != size:
        raise ValueError('Truncated request')
    return body

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # never log scoped URLs, request bodies or source data

    def reply(self, data, content_type, status=200, extra=None):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        for key, value in (extra or {}).items():
            self.send_header(key, str(value))
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        self.reply(b'{"ok":true,"inputMode":"r2-stream-v2"}', 'application/json', 200 if self.path == '/health' else 404)

    def do_DELETE(self):
        try:
            parts = self.path.split('/')
            if len(parts) != 3 or parts[1] != 'stage':
                raise ValueError('Invalid cleanup request')
            shutil.rmtree(session_root(parts[2]), ignore_errors=True)
            self.reply(b'{"ok":true}', 'application/json')
        except ValueError:
            self.reply(b'{"error":"Invalid cleanup request"}', 'application/json', 422)

    def do_POST(self):
        try:
            parts = self.path.split('/')
            staging = len(parts) == 4 and parts[1] == 'stage'
            staged = stage_file(parts[2], parts[3]) if staging else None
            inspecting = self.path in ('/inspect/image', '/inspect/video')
            video = self.path == '/inspect/video'
            if self.path == '/normalize' or (inspecting and not video):
                limit = 15*1024*1024
            elif inspecting or staging:
                limit = 60*1024*1024 if video or (staging and parts[3].startswith('clip-')) else 30*1024*1024
            else:
                limit = 64*1024
            data = read_body(self.rfile, self.headers, limit)
            if staged:
                staged.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                staged.write_bytes(data)
                self.reply(b'{"ok":true}', 'application/json'); return
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                if self.path == '/normalize':
                    crop = json.loads(self.headers['X-Crop']) if self.headers.get('X-Crop') else None
                    output, size = normalize(data, crop)
                    self.reply(output, 'image/jpeg', extra={'X-Width':size[0], 'X-Height':size[1]}); return
                if inspecting:
                    file = root / 'input'; file.write_bytes(data)
                    self.reply(json.dumps(inspect(file, video)).encode(), 'application/json'); return
                body = json.loads(data)
                count = body.get('portraitCount')
                if self.path not in ('/render','/poster') or body['version'] != 'ffmpeg-v1' or body.get('inputMode') != 'r2-stream-v2' or type(count) is not int or not 1 <= count <= 6:
                    raise ValueError('Invalid render contract')
                root = session_root(body['session'])
                portraits = [stage_file(body['session'], f'portrait-{i}.png') for i in range(count)]
                if self.path == '/poster':
                    poster = root / 'poster.png'; end_card(portraits,poster)
                    self.reply(poster.read_bytes(),'image/png'); return
                clips = [stage_file(body['session'], f'clip-{i}.mp4') for i in range(4)]
                music = stage_file(body['session'], 'music.wav')
                output = root / 'output.mp4'; render(clips,portraits,music,output,root)
                self.reply(output.read_bytes(),'video/mp4')
        except Exception as error:
            # Categories only: exceptions may contain signed URLs or private paths.
            category = type(error).__name__
            upstream_status = getattr(error, 'code', None)
            reasons = {'Invalid render contract', 'Invalid request size', 'Truncated request',
                       'Invalid chunk size', 'Invalid chunk trailer', 'Truncated chunk',
                       'Empty request', 'Ambiguous body framing', 'Oversize image'}
            diagnostic = {'event': 'native_media_failed', 'operation': self.path,
                          'category': category,
                          'reason': str(error) if str(error) in reasons else None,
                          'input_mode': 'r2-stream-v2',
                          'upstream_status': upstream_status if isinstance(upstream_status, int) else None,
                          'chunked': self.headers.get('Transfer-Encoding', '').lower() == 'chunked',
                          'has_content_length': self.headers.get('Content-Length') is not None}
            print(json.dumps(diagnostic), flush=True)
            self.reply(json.dumps({'error': 'Media validation or rendering failed',
                                   'category': category}).encode(), 'application/json',422)

if __name__ == '__main__':
    HTTPServer(('0.0.0.0',8080),Handler).serve_forever()
