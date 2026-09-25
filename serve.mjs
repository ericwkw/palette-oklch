/* The smallest static server that will do, so checking the tool needs nothing
 * installed beyond Node itself.
 *
 *   node serve.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 8829);
const TYPES = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
                '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
                '.json':'application/json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml' };

export function serve(p = port){
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = decodeURIComponent(url.pathname);
    if (file === '/' || file.endsWith('/')) file += 'index.html';
    /* stay inside the folder, whatever the request says */
    const path = join(root, normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(root)) { res.writeHead(403).end('no'); return; }
    try {
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream',
                           'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not here'); }
  });
  return new Promise(done => server.listen(p, () => done(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  serve(port).then(() => console.log(`serving ${root} on http://localhost:${port}`));
}
