/**
 * Elite production env writer.
 * If ELITE_API_URL or NG_APP_API_URL is set in Vercel, overwrite environment.prod.ts.
 * If not set, leave the committed file as-is (so previews don't break).
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
  normalizeApi(process.env.ELITE_API_URL) ||
  normalizeApi(process.env.NG_APP_API_URL);

const target = path.join(__dirname, '..', 'src', 'environments', 'environment.prod.ts');

if (!apiUrl) {
  console.log('[elite] No ELITE_API_URL/NG_APP_API_URL — keeping committed environment.prod.ts');
  process.exit(0);
}

const socketUrl = apiUrl.replace(/\/api$/i, '');
const out = `export const environment = {
  production: true,
  apiUrl: '${apiUrl}',
  socketUrl: '${socketUrl}',
};
`;

fs.writeFileSync(target, out, 'utf8');
console.log(`[elite] wrote environment.prod.ts → apiUrl=${apiUrl}`);
