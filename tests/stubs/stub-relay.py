# Stands in for "a relay of your own" on 8787, so test-caps-relay can prove the
# page actually reaches one and gets a real answer back rather than finding
# nothing there. It is a stub, not a relay: it fetches nothing and runs
# nothing. What it has to be faithful about is the shape of the exchange --
# the key, the CORS headers a page needs to read a reply from loopback, and a
# status the page can report.
#
#     python3 tests/stubs/stub-relay.py          (run.mjs starts it for you)
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("STUB_RELAY_PORT", "8787"))
KEY = os.environ.get("STUB_RELAY_KEY", "testkey123")


class Stub(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        # Without this Chrome refuses a public page's call to loopback outright,
        # and the test would be measuring the browser rather than the page.
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def say(self, code, body, ctype="text/plain; charset=utf-8"):
        raw = body.encode()
        self.send_response(code)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        bits = urlparse(self.path)
        query = parse_qs(bits.query)
        if (query.get("key") or [""])[0] != KEY:
            return self.say(403, "wrong key")
        where = bits.path.rstrip("/")
        if where == "/subs":
            # The real relay would run yt-dlp here. Answering "no captions"
            # keeps this route first in the trail, which is what is asserted,
            # without pretending to have produced a caption file.
            return self.say(404, "stub relay: no captions for that")
        if where in ("/fetch", ""):
            # A real status the page can report, which is the whole point of
            # the check: reached, answered, not unreachable.
            return self.say(403, "stub relay: this host is not on the list")
        return self.say(404, "stub relay: nothing here but /fetch and /subs")


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Stub)
    server.daemon_threads = True
    print(f"stub relay on 127.0.0.1:{PORT}, key {KEY}")
    server.serve_forever()
