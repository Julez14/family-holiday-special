import io
import json
import threading
import tempfile
import uuid
import unittest
from pathlib import Path
from http.client import HTTPConnection
from http.server import HTTPServer
from PIL import Image
from service import Handler, read_body, session_root, stage_file
from media import command, verify_final


class ServiceContractTests(unittest.TestCase):
    def setUp(self):
        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method, path, body=None, chunked=False, headers=None):
        connection = HTTPConnection(*self.server.server_address, timeout=60)
        connection.request(method, path, body=[body[:20], body[20:]] if chunked else body,
                           headers=headers or {}, encode_chunked=chunked)
        response = connection.getresponse()
        data = response.read()
        status = response.status
        connection.close()
        return status, data

    def portrait(self):
        image = io.BytesIO()
        Image.new('RGB', (100, 150), '#173e35').save(image, 'PNG')
        return image.getvalue()

    def test_worker_streams_fixed_and_chunked_media_into_inspection(self):
        for chunked in (False, True):
            status, data = self.request('POST', '/inspect/image', self.portrait(), chunked,
                                        {'Content-Type': 'application/octet-stream'})
            self.assertEqual(status, 200, data)
            result = json.loads(data)
            self.assertEqual((result['width'], result['height']), (100, 150))

    def test_private_staging_render_poster_and_cleanup(self):
        session = str(uuid.uuid4())
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            clip = root / 'clip.mp4'
            music = root / 'music.wav'
            command(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x356b61:s=640x360:r=24',
                     '-t', '5', '-an', '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', str(clip)])
            command(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000', '-t', '1', str(music)])
            files = {f'clip-{i}.mp4': clip.read_bytes() for i in range(4)}
            files.update({'portrait-0.png': self.portrait(), 'music.wav': music.read_bytes()})
            try:
                for name, contents in files.items():
                    status, data = self.request('POST', f'/stage/{session}/{name}', contents, True)
                    self.assertEqual(status, 200, data)
                body = json.dumps({'version': 'ffmpeg-v1', 'inputMode': 'r2-stream-v2', 'session': session, 'portraitCount': 1}).encode()
                status, data = self.request('POST', '/render', body)
                self.assertEqual(status, 200, data[:200])
                final = root / 'final.mp4'; final.write_bytes(data); verify_final(final)
                status, data = self.request('POST', '/poster', body)
                self.assertEqual(status, 200, data[:200])
                self.assertEqual(Image.open(io.BytesIO(data)).size, (1280, 720))
            finally:
                self.request('DELETE', f'/stage/{session}')
            self.assertFalse(session_root(session).exists())

    def test_staging_rejects_foreign_paths_and_url_only_inspection(self):
        for name in ('../secret', 'clip-4.mp4', 'portrait-6.png', '/etc/passwd'):
            with self.assertRaises(ValueError):
                stage_file(str(uuid.uuid4()), name)
        with self.assertRaises(ValueError):
            session_root('../outside')
        status, _ = self.request('POST', '/inspect', b'{"url":"https://outside.test"}')
        self.assertEqual(status, 422)

    def test_chunked_body_limits_and_framing(self):
        for body, headers in [
            (b'100\r\n', {'Transfer-Encoding': 'chunked'}),
            (b'2\r\na\r\n0\r\n\r\n', {'Transfer-Encoding': 'chunked'}),
            (b'1\r\na\r\n0\r\n\r\n', {'Transfer-Encoding': 'chunked', 'Content-Length': '1'}),
        ]:
            with self.assertRaises(ValueError):
                read_body(io.BytesIO(body), headers, 10)


if __name__ == '__main__':
    unittest.main()
