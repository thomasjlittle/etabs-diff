"""Serve viewer/ plus one diff JSON on 127.0.0.1 so the viewer opens straight to that diff."""

import functools
import sys
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Tuple

from .parser import StrPath

VIEWER_DIR = Path(__file__).resolve().parent.parent / "viewer"
DIFF_ROUTE = "/diff.json"


class _Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, diff_path: Path, **kwargs: Any) -> None:
        self.diff_path = diff_path
        super().__init__(*args, directory=str(VIEWER_DIR), **kwargs)

    def translate_path(self, path: str) -> str:
        # the diff lives outside viewer/ (temp file or the user's -o path), so real model output never lands in the repo
        if path.split("?", 1)[0] == DIFF_ROUTE:
            return str(self.diff_path)
        return super().translate_path(path)

    def log_message(self, format: str, *args: Any) -> None:
        pass


def make_server(diff_path: StrPath, port: int = 0) -> Tuple[ThreadingHTTPServer, str]:
    """Bind 127.0.0.1 on a free port. Returns (server, url); call server.serve_forever()."""
    handler = functools.partial(_Handler, diff_path=Path(diff_path).resolve())
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html?diff={DIFF_ROUTE.lstrip('/')}"
    return server, url


def run(diff_path: StrPath) -> None:
    """Serve until Ctrl+C. Prints the URL since webbrowser may open nothing (WSL, headless)."""
    server, url = make_server(diff_path)
    print(f"viewer: {url}\nCtrl+C to stop", flush=True)
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    # python -m diff_engine.serve some-diff.json
    if len(sys.argv) != 2:
        sys.exit("usage: python -m diff_engine.serve <diff.json>")
    run(sys.argv[1])
