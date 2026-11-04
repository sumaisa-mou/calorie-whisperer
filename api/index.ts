import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handle } from '../server/router.js';

// Single function for every /api/* request (see the rewrite in vercel.json, which passes the
// original path as ?__path=…). A filename catch-all like api/[...route].ts did not match
// multi-segment paths such as /api/meals/4 on Vercel, so routing is explicit instead.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const forwarded = url.searchParams.get('__path');
  url.searchParams.delete('__path');
  const path = forwarded !== null ? `/${forwarded}` : url.pathname.replace(/^\/api/, '') || '/';
  const out = await handle({
    method: req.method ?? 'GET',
    path,
    query: url.searchParams,
    body: req.body,
    authorization: req.headers.authorization,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
