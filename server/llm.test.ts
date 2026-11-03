import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeImage, analyzeText, reconcileWithUsda } from './nutrition.js';
import { HttpError } from './auth.js';
import { extractJson } from './llm.js';

const realFetch = globalThis.fetch;
type Call = { url: string; init: RequestInit };
let calls: Call[] = [];

const geminiReply = (obj: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });

beforeEach(() => {
  calls = [];
  process.env.GEMINI_API_KEY = 'test-key';
  for (const k of ['USDA_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'MISTRAL_API_KEY', 'GEMINI_MODEL', 'GEMINI_FALLBACK_MODELS', 'GROQ_MODEL', 'AI_PROVIDER_ORDER']) delete process.env[k];
  console.warn = () => {}; // silence [ai] fallback logs in test output
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('analyzeImage sends image + schema to Gemini and parses items', async () => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return geminiReply({
      items: [{ name: 'Dal', grams: 200, calories: 210, protein: 12, carbs: 30, fat: 5, confidence: 0.8 }],
      notes: 'Oil may be hidden.',
    });
  }) as typeof fetch;

  const res = await analyzeImage('QUJD', 'image/jpeg', '1 tsp ghee');
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].name, 'Dal');
  assert.equal(res.notes, 'Oil may be hidden.');

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['x-goog-api-key'], 'test-key'); // key in header, never in the URL
  assert.ok(!calls[0].url.includes('test-key'));
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.generationConfig.responseSchema.type, 'OBJECT');
  const parts = body.contents[0].parts;
  assert.deepEqual(parts[0], { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
  assert.match(parts[1].text, /1 tsp ghee/);
});

test('analyzeText works without an image', async () => {
  globalThis.fetch = (async () => geminiReply({ items: [{ name: 'Egg', grams: 50, calories: 78, protein: 6, carbs: 0.6, fat: 5 }], notes: '' })) as typeof fetch;
  const res = await analyzeText('one egg');
  assert.equal(res.items[0].calories, 78);
});

test('missing API key gives a clear 503', async () => {
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(analyzeText('egg'), (e: unknown) => e instanceof HttpError && e.status === 503);
});

test('Gemini 429 maps to a friendly rate-limit error', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })) as typeof fetch;
  await assert.rejects(analyzeText('egg'), (e: unknown) => e instanceof HttpError && e.status === 429);
});

test('malformed JSON from the model is a 502, not a crash', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{nope' }] } }] }), { status: 200 })) as typeof fetch;
  await assert.rejects(analyzeText('egg'), (e: unknown) => e instanceof HttpError && e.status === 502);
});

test('USDA: replaces numbers only when density agrees within 30%', async () => {
  process.env.USDA_API_KEY = 'u';
  const item = { name: 'cooked rice', grams: 200, calories: 260, protein: 5, carbs: 56, fat: 0.4, fiber: 0, sugar: 0, sodium: 0 };
  const usda = (kcal: number) =>
    new Response(JSON.stringify({ foods: [{ foodNutrients: [
      { nutrientId: 1008, value: kcal }, { nutrientId: 1003, value: 2.7 }, { nutrientId: 1005, value: 28 }, { nutrientId: 1004, value: 0.3 },
    ] }] }), { status: 200 });

  globalThis.fetch = (async () => usda(130)) as typeof fetch; // 130/100g == model's 130/100g
  const [ok] = await reconcileWithUsda([item]);
  assert.equal(ok.calories, 260);
  assert.equal(ok.carbs, 56);
  assert.equal(ok.grams, 200);

  globalThis.fetch = (async () => usda(400)) as typeof fetch; // wildly different -> keep the model's numbers
  const [kept] = await reconcileWithUsda([item]);
  assert.deepEqual(kept, item);

  globalThis.fetch = (async () => { throw new Error('network'); }) as typeof fetch; // fail open
  const [open] = await reconcileWithUsda([item]);
  assert.deepEqual(open, item);
});

test('503 "high demand": retries, then falls back to the next model and succeeds', async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const model = /models\/([^:]+):/.exec(String(url))![1];
    seen.push(model);
    if (model === 'gemini-flash-latest') {
      return new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 503 });
    }
    return geminiReply({ items: [{ name: 'Egg', grams: 50, calories: 78, protein: 6, carbs: 0.6, fat: 5 }], notes: '' });
  }) as typeof fetch;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_FALLBACK_MODELS;
  const res = await analyzeText('egg');
  assert.equal(res.items[0].name, 'Egg');
  assert.deepEqual(seen, ['gemini-flash-latest', 'gemini-flash-latest', 'gemini-flash-lite-latest']);
});

test('503 on every model ends in a friendly 503 (not a raw Google message)', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 })) as typeof fetch;
  await assert.rejects(analyzeText('egg'), (e: unknown) => e instanceof HttpError && e.status === 503 && /busy/.test(e.message));
});

test('a transient blip on the first attempt recovers on retry (same model)', async () => {
  let n = 0;
  globalThis.fetch = (async () =>
    ++n === 1 ? new Response('{}', { status: 500 }) : geminiReply({ items: [{ name: 'Egg', grams: 50, calories: 78, protein: 6, carbs: 0.6, fat: 5 }], notes: '' })) as typeof fetch;
  const res = await analyzeText('egg');
  assert.equal(res.items.length, 1);
  assert.equal(n, 2);
});

const compatReply = (obj: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }), { status: 200 });
const EGG = { items: [{ name: 'Egg', grams: 50, calories: 78, protein: 6, carbs: 0.6, fat: 5 }], notes: '' };

test('every Gemini model overloaded -> falls through to Groq with an OpenAI-style image request', async () => {
  process.env.GROQ_API_KEY = 'groq-key';
  const calls2: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls2.push({ url: String(url), init });
    if (String(url).includes('googleapis')) return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 });
    return compatReply(EGG);
  }) as typeof fetch;

  const res = await analyzeImage('QUJD', 'image/jpeg', '');
  assert.equal(res.items[0].name, 'Egg');

  const geminiModels = new Set(calls2.filter((c) => c.url.includes('googleapis')).map((c) => /models\/([^:]+):/.exec(c.url)![1]));
  assert.equal(geminiModels.size, 4); // all four Gemini models were tried first

  const groq = calls2.at(-1)!;
  assert.equal(groq.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal((groq.init.headers as Record<string, string>).authorization, 'Bearer groq-key');
  const body = JSON.parse(String(groq.init.body));
  assert.equal(body.response_format.type, 'json_object');
  assert.match(body.messages[0].content, /JSON Schema/); // schema is described in the prompt
  const userContent = body.messages[1].content;
  const img = userContent.find((p: { type: string }) => p.type === 'image_url');
  assert.equal(img.image_url.url, 'data:image/jpeg;base64,QUJD');
  assert.ok(userContent.some((p: { type: string }) => p.type === 'text'));
});

test('a wrong/unknown model (404) is skipped, not fatal', async () => {
  process.env.GEMINI_MODEL = 'no-such-model';
  globalThis.fetch = (async (url: string) =>
    String(url).includes('no-such-model')
      ? new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 })
      : geminiReply(EGG)) as typeof fetch;
  const res = await analyzeText('egg');
  assert.equal(res.items.length, 1);
});

test('bad key everywhere -> 502 with the provider message', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })) as typeof fetch;
  await assert.rejects(analyzeText('egg'), (e: unknown) => e instanceof HttpError && e.status === 502 && /API key not valid/.test(e.message));
});

test('provider order can put a non-Gemini provider first', async () => {
  process.env.GROQ_API_KEY = 'g';
  process.env.AI_PROVIDER_ORDER = 'groq,gemini';
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => { urls.push(String(url)); return compatReply(EGG); }) as typeof fetch;
  await analyzeText('egg');
  assert.deepEqual(urls, ['https://api.groq.com/openai/v1/chat/completions']);
});

test('extractJson tolerates fences and chatter', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! Here you go: {"a":{"b":2}} hope it helps'), { a: { b: 2 } });
  assert.throws(() => extractJson('no json here'));
});
