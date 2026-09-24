import { environment } from '../../../environments/environment';

const ELEGANCE_RAILWAY_API =
  'https://elegance-dental-lab-by-yasser-production-da7c.up.railway.app/api';

/**
 * Single source for REST API base URL (must include `/api` if the backend mounts routes under `/api`).
 * Production Vercel builds have shipped without the Railway URL baked in; resolve it at runtime
 * so convert/retag always hits the live Elegance API.
 */
export function apiBaseUrl(): string {
  const fromEnv = String(environment.apiUrl || '').replace(/\/+$/, '');
  try {
    const host = String(globalThis.location?.hostname || '');
    if (host === 'dental-system-seven.vercel.app' || host.endsWith('.vercel.app')) {
      return ELEGANCE_RAILWAY_API;
    }
  } catch {
    // SSR / tests
  }
  return fromEnv || ELEGANCE_RAILWAY_API;
}
