/**
 * Elite Dental Lab production API.
 * Prefer ELITE_API_URL / NG_APP_API_URL at build time (see scripts/write-prod-env.js).
 * Fallback keeps the site usable until Elite Railway is wired in Vercel.
 */
export const environment = {
  production: true,
  apiUrl: 'https://elegance-dental-lab-by-yasser-production-0d4f.up.railway.app/api',
  socketUrl: 'https://elegance-dental-lab-by-yasser-production-0d4f.up.railway.app',
};
