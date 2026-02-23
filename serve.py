#!/usr/bin/env python3

import http.server
import os

class GzipHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        if self.path.endswith(".gz"):
            self.send_header("Content-Encoding", "gzip")
            base = self.path[:-3]
            if base.endswith(".json"):
                self.send_header("Content-Type", "application/json")
        super().end_headers()

if __name__ == "__main__":
    os.chdir(os.path.dirname(__file__) or ".")
    http.server.HTTPServer(("", 8000), GzipHandler).serve_forever()
