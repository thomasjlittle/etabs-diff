"""--view server: serves the viewer page and the diff JSON at the printed URL, then shuts down.

Run from the repo root: python -m unittest discover -s diff_engine/tests -t .
"""

import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import urlopen

from diff_engine.serve import make_server


class ServeTest(unittest.TestCase):
    def test_serves_viewer_and_diff_then_stops(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            diff_path = Path(tmp) / "out.json"
            diff_path.write_text(json.dumps({"summary": {"added": 1}}), encoding="utf-8")
            server, url = make_server(diff_path)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                self.assertTrue(url.startswith("http://127.0.0.1:"))
                with urlopen(url, timeout=5) as res:
                    self.assertIn(b"<html", res.read().lower())
                base, query = url.split("?", 1)
                diff_url = base.rsplit("/", 1)[0] + "/" + query.split("=", 1)[1]
                with urlopen(diff_url, timeout=5) as res:
                    self.assertEqual(json.load(res), {"summary": {"added": 1}})
            finally:
                server.shutdown()
                server.server_close()
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
