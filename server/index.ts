// Servidor de produção: serve o build estático (dist/) e o WebSocket autoritativo em /ws na mesma porta.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachGameServer } from './rooms';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT ?? 3000);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (urlPath === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  let file = normalize(join(root, urlPath));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  if (!existsSync(file)) { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Build não encontrado. Rode "npm run build" antes de "npm start".'); return; }
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(res);
});

attachGameServer(server);
server.listen(PORT, () => {
  console.log(`Ebrashot rodando em http://localhost:${PORT}  (WebSocket: ws://localhost:${PORT}/ws)`);
});
