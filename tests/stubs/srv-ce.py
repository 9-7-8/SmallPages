# -*- coding: utf-8 -*-
# Serves the repo but declares the gzip transfer header on .gz files, which is
# the host behaviour that breaks pre-compressed assets.
import http.server, socketserver
ROOT = "/home/user/SmallPages"
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        if self.path.endswith(".gz"):
            self.send_header("Content-" + "Encoding", "gzip")
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", 8096), H) as s:
    s.serve_forever()
