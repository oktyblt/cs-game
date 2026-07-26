/**
 * Site içi admin-şifre bildirimi (e-posta yedeği).
 * Supabase Storage: private bucket `admin-notices` / `{userId}.json`
 */

const BUCKET = 'admin-notices';

async function ensureBucket(supabaseAdmin) {
  try {
    const { data } = await supabaseAdmin.storage.listBuckets();
    if ((data || []).some((b) => b.name === BUCKET)) return;
    await supabaseAdmin.storage.createBucket(BUCKET, { public: false });
  } catch (e) {
    /* bucket zaten var olabilir */
  }
}

async function readNotices(supabaseAdmin, userId) {
  if (!userId) return [];
  await ensureBucket(supabaseAdmin);
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(`${userId}.json`);
  if (error || !data) return [];
  try {
    const text = await data.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function writeNotices(supabaseAdmin, userId, notices) {
  await ensureBucket(supabaseAdmin);
  const body = JSON.stringify(notices.slice(0, 40), null, 0);
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(`${userId}.json`, body, {
      contentType: 'application/json',
      upsert: true
    });
  if (error) throw error;
}

async function pushAdminPasswordNotice(supabaseAdmin, userId, notice) {
  if (!userId || !notice?.password) return null;
  const list = await readNotices(supabaseAdmin, userId);
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    read: false,
    ...notice
  };
  list.unshift(entry);
  await writeNotices(supabaseAdmin, userId, list);
  return entry;
}

async function listUnreadNotices(supabaseAdmin, userId) {
  const list = await readNotices(supabaseAdmin, userId);
  return list.filter((n) => n && !n.read);
}

async function markNoticesRead(supabaseAdmin, userId, ids) {
  const list = await readNotices(supabaseAdmin, userId);
  const idSet = new Set((ids || []).map(String));
  let changed = false;
  for (const n of list) {
    if (idSet.size === 0 || idSet.has(String(n.id))) {
      if (!n.read) {
        n.read = true;
        changed = true;
      }
    }
  }
  if (changed) await writeNotices(supabaseAdmin, userId, list);
  return list;
}

module.exports = {
  pushAdminPasswordNotice,
  listUnreadNotices,
  markNoticesRead
};
