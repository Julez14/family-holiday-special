"""Binding-only HTTP service. Native codecs never execute in a Worker request."""
import io
import ipaddress
import json
import tempfile
import warnings
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from PIL import Image
from media import normalize, inspect, render, end_card
warnings.simplefilter('error', Image.DecompressionBombWarning)


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

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Redirects are not allowed')


def fetch(url, destination, origin=None, maximum=60*1024*1024):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password or not parsed.path.startswith('/api/inference/'):
        raise ValueError('Only scoped app references are allowed')
    if origin and f'{parsed.scheme}://{parsed.netloc}' != origin:
        raise ValueError('Foreign reference origin')
    if parsed.hostname in ('localhost','metadata.google.internal'):
        raise ValueError('Local host is not allowed')
    try:
        if not ipaddress.ip_address(parsed.hostname).is_global:
            raise ValueError('Private addresses are not allowed')
    except ValueError as error:
        if str(error) == 'Private addresses are not allowed':
            raise
    # Identify this first-party renderer explicitly. Generic Python-urllib requests
    # to the hosted Worker can be rejected before reaching its signed asset route.
    request = Request(url, headers={'User-Agent': 'FamilyHolidayRenderer/1.0'})
    with build_opener(NoRedirect()).open(request, timeout=30) as response, destination.open('wb') as file:
        size = 0
        while chunk := response.read(128*1024):
            size += len(chunk)
            if size > maximum:
                raise ValueError('Reference is too large')
            file.write(chunk)

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
        self.reply(b'{"ok":true}', 'application/json', 200 if self.path == '/health' else 404)

    def do_POST(self):
        try:
            limit = 15*1024*1024 if self.path == '/normalize' else 64*1024
            data = read_body(self.rfile, self.headers, limit)
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                if self.path == '/normalize':
                    crop = json.loads(self.headers['X-Crop']) if self.headers.get('X-Crop') else None
                    output, size = normalize(data, crop)
                    self.reply(output, 'image/jpeg', extra={'X-Width':size[0], 'X-Height':size[1]}); return
                body = json.loads(data)
                if self.path == '/inspect':
                    file = root / 'input'; fetch(body['url'], file)
                    self.reply(json.dumps(inspect(file, body['video'])).encode(), 'application/json'); return
                if self.path not in ('/render','/poster') or body['version'] != 'ffmpeg-v1' or not 1 <= len(body['portraits']) <= 6 or len(body['clips']) != 4:
                    raise ValueError('Invalid render contract')
                portraits = []
                for i, url in enumerate(body['portraits']):
                    path = root / f'portrait-{i}.png'; fetch(url,path,body['origin'],15*1024*1024); portraits.append(path)
                if self.path == '/poster':
                    poster = root / 'poster.png'; end_card(portraits,poster)
                    self.reply(poster.read_bytes(),'image/png'); return
                clips = []
                for i, url in enumerate(body['clips']):
                    path = root / f'clip-{i}.mp4'; fetch(url,path,body['origin']); clips.append(path)
                music = root / 'music.wav'; fetch(body['music'],music,body['origin'],30*1024*1024)
                output = root / 'output.mp4'; render(clips,portraits,music,output,root)
                self.reply(output.read_bytes(),'video/mp4')
        except Exception as error:
            # Categories only: exceptions may contain signed URLs or private paths.
            category = type(error).__name__
            upstream_status = getattr(error, 'code', None)
            diagnostic = {'event': 'native_media_failed', 'operation': self.path,
                          'category': category,
                          'upstream_status': upstream_status if isinstance(upstream_status, int) else None,
                          'chunked': self.headers.get('Transfer-Encoding', '').lower() == 'chunked',
                          'has_content_length': self.headers.get('Content-Length') is not None}
            print(json.dumps(diagnostic), flush=True)
            self.reply(json.dumps({'error': 'Media validation or rendering failed',
                                   'category': category}).encode(), 'application/json',422)

if __name__ == '__main__':
    HTTPServer(('0.0.0.0',8080),Handler).serve_forever()
