import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handle } from '../server/router.js';

// Single catch-all function: keeps us far below Vercel's function-count limit
// and shares one warm DB connection across all endpoints.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const out = await handle({
    method: req.method ?? 'GET',
    path: url.pathname.replace(/^\/api/, '') || '/',
    query: url.searchParams,
    body: req.body,
    authorization: req.headers.authorization,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(out.status).json(out.body);
}
