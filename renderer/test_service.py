import io
import json
import threading
import tempfile
import unittest
from pathlib import Path
from http.client import HTTPConnection
from http.server import HTTPServer
from unittest.mock import patch
from PIL import Image
from service import Handler, read_body, fetch


class ServiceContractTests(unittest.TestCase):
    def test_native_download_identifies_the_application(self):
        with tempfile.TemporaryDirectory() as folder, patch('service.build_opener') as opener:
            response = opener.return_value.open.return_value.__enter__.return_value
            response.read.side_effect = [b'private media', b'']
            destination = Path(folder) / 'media'
            fetch('https://studio.test/api/inference/p/a', destination)
            request = opener.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header('User-agent'), 'FamilyHolidayRenderer/1.0')
            self.assertEqual(destination.read_bytes(), b'private media')

    def test_worker_chunked_json_reaches_native_inspection(self):
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def fixture(_url, destination, *_args, **_kwargs):
            Image.new('RGB', (100, 150), '#173e35').save(destination, 'PNG')

        try:
            with patch('service.fetch', fixture):
                for chunked in (False, True):
                    body = json.dumps({'url': 'https://app.test/api/inference/p/a', 'video': False}).encode()
                    connection = HTTPConnection(*server.server_address, timeout=5)
                    connection.request('POST', '/inspect', body=[body[:20], body[20:]] if chunked else body,
                                       headers={'Content-Type': 'application/json'}, encode_chunked=chunked)
                    response = connection.getresponse()
                    result = json.loads(response.read())
                    self.assertEqual(response.status, 200, result)
                    self.assertEqual((result['width'], result['height']), (100, 150))
                    connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

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
