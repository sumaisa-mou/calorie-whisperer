import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, 'AUTH_SECRET is not set (min 16 chars).');
  return s;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest();

export function checkPassword(given: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) throw new HttpError(500, 'APP_PASSWORD is not set.');
  // hash both so lengths match, then compare in constant time
  return timingSafeEqual(sha(given), sha(expected));
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function issueToken(now = Date.now()): string {
  const payload = b64(JSON.stringify({ exp: now + TTL_MS }));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
  }
}
