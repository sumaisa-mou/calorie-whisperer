// Generates PWA icons from an inline SVG. Run: npm run icons
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';

const glyph = (size, pad) => {
  const s = size;
  const c = s / 2;
  const r = (s - pad * 2) * 0.28;
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#0d9488"/>
      </linearGradient>
    </defs>
    <rect width="${s}" height="${s}" fill="url(#g)"/>
    <!-- bathroom-scale / dial glyph -->
    <circle cx="${c}" cy="${c}" r="${r * 1.55}" fill="none" stroke="#fff" stroke-width="${s * 0.05}" opacity=".95"/>
    <path d="M ${c - r} ${c + r * 0.15} A ${r} ${r} 0 0 1 ${c + r} ${c + r * 0.15}" fill="none" stroke="#fff" stroke-width="${s * 0.045}" stroke-linecap="round"/>
    <line x1="${c}" y1="${c + r * 0.15}" x2="${c + r * 0.55}" y2="${c - r * 0.45}" stroke="#fff" stroke-width="${s * 0.045}" stroke-linecap="round"/>
    <circle cx="${c}" cy="${c + r * 0.15}" r="${s * 0.04}" fill="#fff"/>
  </svg>`;
};

mkdirSync('public', { recursive: true });
const out = async (name, size, pad = 0) =>
  writeFileSync(`public/${name}`, await sharp(Buffer.from(glyph(size, pad))).png().toBuffer());

await out('pwa-192.png', 192);
await out('pwa-512.png', 512);
// maskable: content must sit inside the central 80% safe zone
await out('pwa-maskable-512.png', 512, 70);
await out('apple-touch-icon.png', 180);
writeFileSync('public/favicon.svg', glyph(64, 0).replace('<rect width="64" height="64"', '<rect rx="14" width="64" height="64"'));
console.log('icons written to public/');
