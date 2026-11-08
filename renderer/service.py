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
    with build_opener(NoRedirect()).open(Request(url), timeout=30) as response, destination.open('wb') as file:
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
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= limit:
                raise ValueError('Invalid request size')
            data = self.rfile.read(length)
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
        except Exception:
            self.reply(b'{"error":"Media validation or rendering failed"}', 'application/json',422)

if __name__ == '__main__':
    HTTPServer(('0.0.0.0',8080),Handler).serve_forever()
