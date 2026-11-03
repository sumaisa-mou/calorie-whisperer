# Fit Tracker

A personal weight-loss tracker you install on your iPhone as a PWA (no App Store, no expiry).

- **Weight** — daily log in kg, weekly & monthly averages, trend chart, change vs last week/month
- **BMI & ideal weight** — BMI, healthy range for your height, distance to range and to your goal
- **Calories** — BMR/TDEE (Mifflin-St Jeor), daily target from your weekly-loss goal, eaten vs target chart, projected weight change
- **Meals** — log by **photo** (AI estimate), text description, Open Food Facts search, or manually; editable before saving; stored per date/time; daily totals feed the calorie views. **Photos are never stored.**
- **Coach chat** — LLM that knows your profile, weight trend and recent meals

**Stack:** Vite + React + TypeScript + Recharts (PWA) · Vercel serverless function (`api/[...route].ts`) · Turso/libSQL (SQLite) · Gemini / Groq / OpenRouter / Mistral (automatic fallback).

```
api/[...route].ts   Vercel entry (one function for the whole API)
server/             router, db, auth, llm (the ONLY file that talks to Gemini), nutrition
shared/             pure logic used by both sides: calc.ts (BMI/TDEE/averages…), dates.ts
src/                React app
```

## Run locally

```bash
npm install
cp .env.example .env.local     # set APP_PASSWORD, AUTH_SECRET, GEMINI_API_KEY
npm run dev                    # API on :3001, web on :5173 (next free port if taken)
```

With `TURSO_DATABASE_URL` empty, a local SQLite file is used at `./data/local.db`.
Open the printed URL, sign in, fill **Settings**, log your weight.

If port 3001 is busy: `API_PORT=3099 npm run dev` (both processes read it).

Other scripts: `npm test` (unit tests), `npm run typecheck`, `npm run build`, `npm run icons` (regenerate PWA icons).

## Deploy to Vercel (free)

1. **Database** — create a free [Turso](https://turso.tech) DB:
   ```bash
   turso db create fit-tracker
   turso db show fit-tracker --url        # -> TURSO_DATABASE_URL
   turso db tokens create fit-tracker     # -> TURSO_AUTH_TOKEN
   ```
   Tables are created automatically on first request.
2. **AI keys** — Gemini is free at <https://aistudio.google.com/apikey>. Add a Groq key (<https://console.groq.com/keys>) and/or OpenRouter key too: when Gemini is overloaded the app automatically falls back to the next provider.
3. **Vercel** — push this folder to GitHub and import it at vercel.com (framework is auto-detected from `vercel.json`), or run `npx vercel`.
4. **Environment variables** (Project → Settings → Environment Variables):
   `APP_PASSWORD`, `AUTH_SECRET` (`openssl rand -base64 32`), `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `GEMINI_API_KEY`, optionally `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `USDA_API_KEY` (see `.env.example` for model overrides).
   Redeploy after setting them.
5. **Install on iPhone** — open your Vercel URL in **Safari** → Share → **Add to Home Screen**.

## Notes

- **Accuracy:** photo calories are estimates (often ±20–30%; hidden oil/sauces are the main miss). Use the note field ("cooked in 1 tbsp oil"), fix grams on the review screen, and trust the *weekly weight average* over any single day.
- **Safety:** targets never go below 1200 kcal (female) / 1500 kcal (male); the loss rate is capped by that floor. Not medical advice.
- **Privacy:** photos/text go to Google's Gemini API for the request. On the free tier Google may use prompts to improve models — avoid faces/documents in photos. All provider logic lives in `server/llm.ts`. Free-tier model names change; if a fallback model stops existing it is skipped (check the Vercel function logs for `[ai]` lines) — fix by setting `*_MODEL` env vars.
- **Auth:** single shared password → signed 30-day token (stored in the browser). Use a long password; login attempts are slowed but not rate-limited.
- **Data:** meals store the local date + `HH:MM` you ate in your profile timezone. Export everything from Settings → *Export all data*.
- **Offline:** the app shell and last-loaded data are cached; saving/AI need a connection.
- **iOS caveat:** Safari can clear a home-screen PWA's *local* storage if unused for weeks. Only the login token and chat history live there — your data is in Turso.
