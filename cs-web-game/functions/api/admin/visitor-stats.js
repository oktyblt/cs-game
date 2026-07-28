import { buildVisitorStats, json, requireAdmin } from '../_lib/visitors.js';

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestGet(context) {
  try {
    const ok = await requireAdmin(context.request, context.env);
    if (!ok) {
      return json({ success: false, error: 'Yetkisiz erişim' }, 403);
    }
    const data = await buildVisitorStats(context.env);
    return json(data);
  } catch (e) {
    return json({ success: false, error: e.message || 'stats failed' }, 500);
  }
}
