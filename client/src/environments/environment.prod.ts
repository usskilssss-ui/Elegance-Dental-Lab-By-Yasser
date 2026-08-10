/**
 * Elite Dental Lab production API.
 * At build time, `scripts/write-prod-env.js` overwrites this from
 * NG_APP_API_URL or ELITE_API_URL (Vercel env). Never point this at Elegance.
 */
export const environment = {
  production: true,
  apiUrl: 'https://YOUR-ELITE-RAILWAY-URL.up.railway.app/api',
  socketUrl: 'https://YOUR-ELITE-RAILWAY-URL.up.railway.app',
};
