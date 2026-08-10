/**
 * Elite-only production env writer.
 * Reads NG_APP_API_URL or ELITE_API_URL from the build environment (Vercel)
 * and writes environment.prod.ts — never defaults to Elegance.
 */
const fs = require('fs');
const path = require('path');

function normalizeApi(raw) {
  let api = String(raw || '').trim().replace(/\/+$/, '');
  if (!api) return '';
  if (!/\/api$/i.test(api)) api = `${api}/api`;
  return api;
}

const apiUrl =
  normalizeApi(process.env.NG_APP_API_URL) ||
  normalizeApi(process.env.ELITE_API_URL) ||
  'https://YOUR-ELITE-RAILWAY-URL.up.railway.app/api';

const socketUrl = apiUrl.replace(/\/api$/i, '');

const out = `export const environment = {
  production: true,
  apiUrl: '${apiUrl}',
  socketUrl: '${socketUrl}',
};
`;

const target = path.join(__dirname, '..', 'src', 'environments', 'environment.prod.ts');
fs.writeFileSync(target, out, 'utf8');
console.log(`[elite] wrote environment.prod.ts → apiUrl=${apiUrl}`);
