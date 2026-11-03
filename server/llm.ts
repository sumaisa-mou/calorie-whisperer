/**
 * The ONLY file that talks to LLM providers.
 *
 * Requests walk a chain of "candidates" (provider + model) until one answers:
 *   Gemini models (several, each with its own capacity/quota)  →  Groq  →  OpenRouter  →  Mistral
 * Providers without an API key are skipped. Everything is configurable via env vars
 * (see .env.example), because free-tier model names change over time.
 */
import { HttpError } from './auth.js';

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

// Gemini response-schema subset (uppercase type names)
export type Schema = {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN';
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  description?: string;
};

interface Turn {
  role: 'user' | 'assistant';
  parts: Part[];
}

interface Req {
  system: string;
  turns: Turn[];
  schema?: Schema;
  temperature: number;
  maxOutputTokens?: number;
}

// ------------------------------------------------------------------ provider config

interface Candidate {
  provider: 'gemini' | 'groq' | 'openrouter' | 'mistral';
  model: string;
  key: string;
}

const list = (v: string | undefined, fallback: string[]): string[] => {
  const items = (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return items.length ? items : fallback;
};

const GEMINI_DEFAULTS = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

interface OpenAiCompat {
  url: string;
  keyEnv: string;
  modelEnv: string;
  defaults: string[];
  /** send response_format: json_object (not every free model supports it) */
  jsonMode: boolean;
  headers?: Record<string, string>;
}

const COMPAT: Record<'groq' | 'openrouter' | 'mistral', OpenAiCompat> = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    defaults: ['meta-llama/llama-4-scout-17b-16e-instruct'],
    jsonMode: true,
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyEnv: 'OPENROUTER_API_KEY',
    modelEnv: 'OPENROUTER_MODEL',
    defaults: ['google/gemma-3-27b-it:free'],
    jsonMode: false,
    headers: { 'X-Title': 'Fit Tracker' },
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    keyEnv: 'MISTRAL_API_KEY',
    modelEnv: 'MISTRAL_MODEL',
    defaults: ['mistral-small-latest'],
    jsonMode: true,
  },
};

/** Ordered list of everything we can try, based on which API keys are set. */
export function candidates(): Candidate[] {
  const order = list(process.env.AI_PROVIDER_ORDER, ['gemini', 'groq', 'openrouter', 'mistral']);
  const out: Candidate[] = [];
  for (const p of order) {
    if (p === 'gemini') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) continue;
      const models = [
        ...list(process.env.GEMINI_MODEL, [GEMINI_DEFAULTS[0]]),
        ...list(process.env.GEMINI_FALLBACK_MODELS, GEMINI_DEFAULTS.slice(1)),
      ];
      for (const model of new Set(models)) out.push({ provider: 'gemini', model, key });
    } else if (p === 'groq' || p === 'openrouter' || p === 'mistral') {
      const cfg = COMPAT[p];
      const key = process.env[cfg.keyEnv];
      if (!key) continue;
      for (const model of list(process.env[cfg.modelEnv], cfg.defaults)) out.push({ provider: p, model, key });
    }
  }
  return out;
}

// ------------------------------------------------------------------ request builders

function geminiRequest(c: Candidate, r: Req) {
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${c.model}:generateContent`,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': c.key },
    body: {
      systemInstruction: { parts: [{ text: r.system }] },
      contents: r.turns.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: t.parts })),
      generationConfig: {
        temperature: r.temperature,
        ...(r.maxOutputTokens ? { maxOutputTokens: r.maxOutputTokens } : {}),
        ...(r.schema ? { responseMimeType: 'application/json', responseSchema: r.schema } : {}),
      },
    },
  };
}

/** Gemini's uppercase schema → plain JSON Schema (lowercase), used to instruct other models. */
function toJsonSchema(s: Schema): unknown {
  return {
    type: s.type.toLowerCase(),
    ...(s.description ? { description: s.description } : {}),
    ...(s.properties ? { properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)])) } : {}),
    ...(s.items ? { items: toJsonSchema(s.items) } : {}),
    ...(s.required ? { required: s.required } : {}),
  };
}

function compatRequest(c: Candidate, r: Req) {
  const cfg = COMPAT[c.provider as 'groq' | 'openrouter' | 'mistral'];
  const system = r.schema
    ? `${r.system}\n\nRespond with ONLY a single JSON object (no markdown, no commentary) that matches this JSON Schema:\n${JSON.stringify(toJsonSchema(r.schema))}`
    : r.system;
  const messages = [
    { role: 'system', content: system },
    ...r.turns.map((t) => ({
      role: t.role,
      content: t.parts.some((p) => 'inlineData' in p)
        ? t.parts.map((p) =>
            'text' in p
              ? { type: 'text', text: p.text }
              : { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } },
          )
        : t.parts.map((p) => ('text' in p ? p.text : '')).join(''),
    })),
  ];
  return {
    url: cfg.url,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.key}`, ...cfg.headers },
    body: {
      model: c.model,
      messages,
      temperature: r.temperature,
      ...(r.maxOutputTokens ? { max_tokens: r.maxOutputTokens } : {}),
      ...(r.schema && cfg.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    },
  };
}

// ------------------------------------------------------------------ response readers

interface ErrorBody { error?: { message?: string } | string }
const errMessage = (j: unknown, status: number): string => {
  const e = (j as ErrorBody | null)?.error;
  return (typeof e === 'string' ? e : e?.message) ?? `HTTP ${status}`;
};

class Blocked extends Error {}

function readGemini(j: unknown): string {
  const o = j as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (o.promptFeedback?.blockReason) throw new Blocked(o.promptFeedback.blockReason);
  return o.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

function readCompat(j: unknown): string {
  const o = j as { choices?: { message?: { content?: unknown } }[] };
  const c = o.choices?.[0]?.message?.content;
  return typeof c === 'string' ? c : '';
}

// ------------------------------------------------------------------ the fallback loop

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TOTAL_BUDGET_MS = 50_000; // stay inside the 60 s Vercel function limit
const PER_CALL_MS = 22_000;
const ATTEMPTS_PER_CANDIDATE = 2; // one quick retry for a blip, then move on
const RETRY_DELAY_MS = 900;

async function run(req: Req): Promise<string> {
  const chain = candidates();
  if (chain.length === 0) {
    throw new HttpError(
      503,
      'No AI provider is configured on the server. Set GEMINI_API_KEY (and optionally GROQ_API_KEY / OPENROUTER_API_KEY / MISTRAL_API_KEY).',
    );
  }

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let sawBusy = false;
  let sawRateLimit = false;
  let lastMessage = '';

  for (const c of chain) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_CANDIDATE; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 3000) break;
      const label = `${c.provider}/${c.model}`;
      const built = c.provider === 'gemini' ? geminiRequest(c, req) : compatRequest(c, req);

      let res: Response;
      try {
        res = await fetch(built.url, {
          method: 'POST',
          headers: built.headers,
          body: JSON.stringify(built.body),
          signal: AbortSignal.timeout(Math.min(PER_CALL_MS, remaining)),
        });
      } catch {
        sawBusy = true;
        lastMessage = `${label}: timed out`;
        console.warn(`[ai] ${lastMessage}`);
        continue; // network error / timeout → treat as transient
      }
      const json = await res.json().catch(() => ({}));

      if (res.ok) {
        let text = '';
        try {
          text = c.provider === 'gemini' ? readGemini(json) : readCompat(json);
        } catch (e) {
          if (e instanceof Blocked) throw new HttpError(422, `The AI declined this input (${e.message}).`);
          throw e;
        }
        if (text.trim()) return text;
        lastMessage = `${label}: empty response`;
        console.warn(`[ai] ${lastMessage}`);
        sawBusy = true;
        continue;
      }

      lastMessage = `${label}: ${errMessage(json, res.status)}`;
      console.warn(`[ai] ${res.status} ${lastMessage}`);

      if (res.status === 429) {
        sawRateLimit = true; // this model's quota is used up — retrying won't help
        break;
      }
      if (res.status >= 500) {
        sawBusy = true;
        if (attempt + 1 < ATTEMPTS_PER_CANDIDATE && deadline - Date.now() > RETRY_DELAY_MS + 3000) await sleep(RETRY_DELAY_MS);
        continue;
      }
      break; // 400/401/403/404: bad key, unknown model, unsupported input → try the next candidate
    }
  }

  if (sawBusy) {
    throw new HttpError(503, 'The AI services are all busy right now (high demand on their side). Please try again in a minute.');
  }
  if (sawRateLimit) throw new HttpError(429, 'AI rate limit reached — try again in a minute.');
  throw new HttpError(502, `AI request failed: ${lastMessage}`);
}

/** Models sometimes wrap JSON in ```fences``` or add a sentence around it. */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('no json');
  }
}

/** Ask for JSON that matches `schema`; returns the parsed (still unvalidated) value. */
export async function generateJSON(opts: {
  system: string;
  parts: Part[];
  schema: Schema;
}): Promise<unknown> {
  const text = await run({
    system: opts.system,
    turns: [{ role: 'user', parts: opts.parts }],
    schema: opts.schema,
    temperature: 0.2,
  });
  try {
    return extractJson(text);
  } catch {
    throw new HttpError(502, 'The AI returned malformed JSON — please retry.');
  }
}

export async function chatText(opts: {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}): Promise<string> {
  return run({
    system: opts.system,
    turns: opts.messages.map((m) => ({ role: m.role, parts: [{ text: m.content }] })),
    temperature: 0.6,
    maxOutputTokens: 1024,
  });
}
