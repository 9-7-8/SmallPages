# Stands in for both a CORS relay and YouTube behind it, so the whole fetch
# path can be walked without either one being reachable.
import json, re
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

PLAYER = {
    "captions": {"playerCaptionsTracklistRenderer": {"captionTracks": [
        {"baseUrl": "https://www.youtube.com/api/timedtext?v=TEST&lang=fr",
         "languageCode": "fr", "kind": "asr"},
        {"baseUrl": "https://www.youtube.com/api/timedtext?v=TEST&lang=en",
         "languageCode": "en", "kind": "asr"},
    ]}},
    "videoDetails": {"title": "A Test Video"},
}
WATCH = ('<!DOCTYPE html><html><body><script>var ytInitialPlayerResponse = '
         + json.dumps(PLAYER) + ';</script></body></html>')
STRIPPED = ('<!DOCTYPE html><html><body><script>var ytInitialPlayerResponse = '
            + json.dumps({"videoDetails": {"title": "No captions here"}}) + ';</script></body></html>')
TRACK = json.dumps({"events": [
    {"tStartMs": 0,    "dDurationMs": 2000, "segs": [{"utf8": "fetched over the wire"}]},
    {"tStartMs": 2000, "dDurationMs": 2000, "segs": [{"utf8": "fetched over the wire and then some"}]},
]})

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, body, ctype="text/html"):
        raw = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def do_GET(self):
        p = urlparse(self.path)
        q = parse_qs(p.query)
        target = unquote(q.get("url", [""])[0])
        if p.path == "/relay":
            if "timedtext" in target: return self.send(TRACK, "application/json")
            return self.send(WATCH)
        if p.path == "/stripped":
            return self.send(STRIPPED)
        if p.path == "/slow":
            import time; time.sleep(10)
            raw = WATCH.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if p.path == "/nocors":
            raw = WATCH.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if p.path == "/teapot":
            self.send_response(418); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers(); return
        self.send_response(404); self.end_headers()

ThreadingHTTPServer(("127.0.0.1", 8098), H).serve_forever()
