// Local dev API server: runs the exact same handler as the Vercel function.
import { createServer } from 'node:http';
import { handle } from './router.js';

const PORT = Number(process.env.API_PORT || 3001);

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  let body: unknown = undefined;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"Invalid JSON"}');
      return;
    }
  }
  const out = await handle({
    method: req.method ?? 'GET',
    path: url.pathname.replace(/^\/api/, '') || '/',
    query: url.searchParams,
    body,
    authorization: req.headers.authorization,
  });
  res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body));
}).listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
