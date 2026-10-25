/* A static server over the checkout, on whatever port is going.

   The pages have to be served rather than opened off the filesystem: three of
   them start a worker, which a browser refuses from a `file://` folder, and
   several fetch something out of `vendor/`. Serving all of them the same way
   means the command line has one code path rather than one per page.

   Nothing here is reachable from off the machine — it binds to loopback, and
   it is shut down when the tool exits. */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
};

const type = (file) => TYPES[path.extname(file).toLowerCase()]
  || "application/octet-stream";

/* `port` 0 is whatever is going. A fixed one is asked for by `drive` when it
   wants the same origin every time — storage is kept per origin, and a port
   is part of one — and if that port is taken this says so by throwing
   EADDRINUSE rather than quietly moving. */
export async function serve(root, { port: wanted = 0 } = {}) {
  const server = http.createServer((req, res) => {
    let asked;
    try {
      asked = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400).end("bad path");
      return;
    }
    /* Resolve first, then check the answer is still inside the checkout, so
       `..` and a URL-encoded one cannot walk out of it. */
    let file = path.resolve(root, "." + asked);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end("outside the checkout");
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, "index.html");
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end("no such file");
      return;
    }
    /* Plain headers on purpose. Cross-origin isolation would buy the pages
       that run a worker nothing they ask for, and would block the handful
       that still reach a CDN for a decoder or a model. */
    res.writeHead(200, {
      "Content-Type": type(file),
      "Content-Length": fs.statSync(file).size,
    });
    fs.createReadStream(file).pipe(res);
  });

  await new Promise((up, down) => {
    server.once("error", down);
    server.listen(wanted, "127.0.0.1", up);
  });

  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => {
      server.closeAllConnections?.();
      server.close(done);
    }),
  };
}
