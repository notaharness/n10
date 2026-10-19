// Serves public/ on a free local port, which is all the standalone demo
// needs: static files under /desktop-demo.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
};

export function serveStatic(root) {
  const server = createServer((req, res) => {
    const path = normalize(
      decodeURIComponent(new URL(req.url, 'http://x').pathname)
    );
    const file = join(root, path);
    if (
      !file.startsWith(root) ||
      !statSync(file, { throwIfNoEntry: false })?.isFile()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}
