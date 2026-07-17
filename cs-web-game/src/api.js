const apiFromEnv = import.meta.env.VITE_API_URL;

if (!apiFromEnv && import.meta.env.PROD) {
  throw new Error(
    '[API] VITE_API_URL production build için zorunlu. cs-web-game/.env dosyasını kullanın.'
  );
}

export const API_URL = apiFromEnv || 'http://localhost:3001';
export const ASSET_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : 'https://browsercs.com';
export function adminHeaders(adminToken, extra = {}) {
  return { 'x-admin-token': adminToken, ...extra };
}
export { getSessionToken } from './auth.js';
