import { trackFromRequest, json } from './_lib/visitors.js';

export async function onRequestOptions() {
  return json({ ok: true });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const result = await trackFromRequest(context.request, context.env, body || {});
    return json(result, result.success ? 200 : 400);
  } catch (e) {
    return json({ success: false, error: e.message || 'track failed' }, 500);
  }
}
