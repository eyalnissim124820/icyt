// Local development server: serves the static game and runs api/*.js the
// way Vercel does. Usage: npm run dev  (then open http://localhost:3000)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 3000;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const name = url.pathname.slice(5).replace(/[^\w-]/g, '');
    try {
      const mod = await import(join(root, 'api', name + '.js'));
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (v) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(v)); };
      await mod.default(req, res);
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  const file = join(root, path);
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    res.setHeader('content-type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}).listen(port, () => console.log(`Icy Tower running at http://localhost:${port}`));
