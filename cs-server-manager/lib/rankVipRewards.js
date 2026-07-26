/**
 * Aylık Rank Top 10 → VIP hediye dağıtımı.
 * Her sunucunun kendi sezonunda:
 *   1–3  → Platinum 30 gün
 *   4–6  → Gold 30 gün
 *   7–10 → Silver 30 gün
 * Aktif VIP varsa süre uzatılır; daha yüksek tier korunur.
 */
const fs = require('fs');
const path = require('path');
const {
  istanbulMonth,
  sortedPlayers,
  listKnownPorts,
  RANK_ROOT,
} = require('./rankings');
const { VIP_TIER_RANK, normalizeVipTier, isActiveVip, VIP_LABELS_TR } = require('./vipConstants');

const REWARD_DAYS = 30;
const REWARD_RULES = Object.freeze([
  { from: 1, to: 3, tier: 'platinum', label: 'Platinum VIP', days: REWARD_DAYS },
  { from: 4, to: 6, tier: 'gold', label: 'Gold VIP', days: REWARD_DAYS },
  { from: 7, to: 10, tier: 'silver', label: 'Silver VIP', days: REWARD_DAYS },
]);

function rewardsInfo() {
  return {
    days: REWARD_DAYS,
    scope: 'per-server',
    rules: REWARD_RULES.map((r) => ({ ...r })),
    summary:
      'Her sunucunun aylık Top 10 sıralamasında 1–3 Platinum, 4–6 Gold, 7–10 Silver VIP (30 gün) kazanır. Zaten VIP ise süre uzatılır; daha yüksek paket korunur.',
  };
}

function tierForPlace(place) {
  const n = Number(place) | 0;
  for (const rule of REWARD_RULES) {
    if (n >= rule.from && n <= rule.to) return rule.tier;
  }
  return null;
}

function previousIstanbulMonth(d = new Date()) {
  const cur = istanbulMonth(d); // YYYY-MM
  const [ys, ms] = cur.split('-').map((x) => parseInt(x, 10));
  let y = ys;
  let m = ms - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function rewardFile(port, month) {
  return path.join(RANK_ROOT, '_vip_rewards', String(port), `${month}.json`);
}

function readRewardRecord(port, month) {
  const file = rewardFile(port, month);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeRewardRecord(record) {
  const file = rewardFile(record.port, record.month);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * Bir sunucu + ay için Top 10'a VIP dağıt.
 * Idempotent: aynı port/month daha önce işlendiyse atlar.
 */
async function distributeMonthRewards(supabaseAdmin, applyVipGrant, port, month, opts = {}) {
  if (!supabaseAdmin || typeof applyVipGrant !== 'function') {
    return { skipped: true, reason: 'no-admin' };
  }
  if (!port || !/^\d{4}-\d{2}$/.test(month || '')) {
    return { skipped: true, reason: 'bad-args' };
  }

  const existing = readRewardRecord(port, month);
  if (existing?.awarded_at && !opts.force) {
    return { skipped: true, reason: 'already-awarded', record: existing };
  }

  const { list } = sortedPlayers(port, month);
  const top10 = list.slice(0, 10);
  if (!top10.length) {
    const empty = {
      port: Number(port),
      month,
      awarded_at: new Date().toISOString(),
      entries: [],
      note: 'Sıralamada hesap yok — ödül dağıtılmadı',
    };
    writeRewardRecord(empty);
    return { skipped: false, empty: true, record: empty };
  }

  const entries = [];
  for (let i = 0; i < top10.length; i++) {
    const place = i + 1;
    const rewardTier = tierForPlace(place);
    if (!rewardTier) continue;
    const player = top10[i];
    const userId = player.user_id;
    if (!userId) continue;

    let grantTier = rewardTier;
    let action = 'extend';
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, username, vip_tier, vip_expires_at')
        .eq('id', userId)
        .maybeSingle();

      if (profile && isActiveVip(profile)) {
        const cur = normalizeVipTier(profile.vip_tier) || 'none';
        const curRank = VIP_TIER_RANK[cur] || 0;
        const rewardRank = VIP_TIER_RANK[rewardTier] || 0;
        // Daha yüksek aktif paket varsa onu koru, sadece süre uzat
        if (curRank > rewardRank) grantTier = cur;
        action = 'extend';
      } else {
        action = 'grant';
      }

      const result = await applyVipGrant(supabaseAdmin, {
        userId,
        tier: grantTier,
        days: REWARD_DAYS,
        action,
        notes: `Rank ödülü ${month} port=${port} #${place} → ${rewardTier} (${REWARD_DAYS}g)`,
        grantedBy: 'rank-monthly-top10',
      });

      entries.push({
        place,
        user_id: userId,
        name: player.name || profile?.username || 'Oyuncu',
        reward_tier: rewardTier,
        granted_tier: grantTier,
        action,
        days: REWARD_DAYS,
        kills: player.kills | 0,
        ok: !result.error,
        error: result.error?.message || null,
      });
    } catch (e) {
      entries.push({
        place,
        user_id: userId,
        name: player.name || 'Oyuncu',
        reward_tier: rewardTier,
        granted_tier: grantTier,
        action,
        days: REWARD_DAYS,
        kills: player.kills | 0,
        ok: false,
        error: e.message,
      });
    }
  }

  const record = {
    port: Number(port),
    month,
    awarded_at: new Date().toISOString(),
    entries,
  };
  writeRewardRecord(record);

  const okCount = entries.filter((e) => e.ok).length;
  console.log(
    `[rank-vip] port=${port} month=${month} awarded ${okCount}/${entries.length} ` +
      `(${entries.map((e) => `#${e.place}:${e.granted_tier}`).join(', ')})`
  );
  return { skipped: false, record };
}

/**
 * Ay döndüğünde bir önceki ayı tüm sunucularda dağıt.
 * Saatlik kontrol + boot'ta bir kez.
 */
async function tickRankVipRewards(supabaseAdmin, applyVipGrant) {
  if (!supabaseAdmin) return;
  const prev = previousIstanbulMonth();
  const cur = istanbulMonth();
  // Ayın ilk saatlerinde bile önceki ayı işle; mevcut aya dokunma
  if (prev === cur) return;

  for (const port of listKnownPorts()) {
    try {
      await distributeMonthRewards(supabaseAdmin, applyVipGrant, port, prev);
    } catch (e) {
      console.warn(`[rank-vip] port=${port} month=${prev}:`, e.message);
    }
  }
}

function startRankVipRewardLoop(supabaseAdmin, applyVipGrant) {
  const run = () => {
    tickRankVipRewards(supabaseAdmin, applyVipGrant).catch((e) => {
      console.warn('[rank-vip] tick:', e.message);
    });
  };
  // Boot'tan 45 sn sonra (rank ingest otursun), sonra saatte bir
  setTimeout(run, 45_000);
  return setInterval(run, 60 * 60 * 1000);
}

module.exports = {
  REWARD_RULES,
  REWARD_DAYS,
  rewardsInfo,
  tierForPlace,
  previousIstanbulMonth,
  distributeMonthRewards,
  tickRankVipRewards,
  startRankVipRewardLoop,
  readRewardRecord,
  VIP_LABELS_TR,
};
