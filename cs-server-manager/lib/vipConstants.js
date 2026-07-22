/**
 * Classic CS 1.5 VIP package constants (TRY / month).
 * No P2W weapons / spawn kits / modern cosmetics.
 */

const VIP_TIERS = Object.freeze(['none', 'silver', 'gold', 'platinum']);

const VIP_TIER_RANK = Object.freeze({
  none: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
});

/** Approved monthly prices (TRY) */
const VIP_PRICES_TRY = Object.freeze({
  silver: 49,
  gold: 99,
  platinum: 199,
});

const VIP_LABELS_TR = Object.freeze({
  none: 'Yok',
  silver: 'Silver VIP',
  gold: 'Gold VIP',
  platinum: 'Platinum VIP',
});

/** Oyun içi rozet herkes için sadece "VIP" yazar (renkle ayrılır).
 * Clan tag ise Platinum'a özel, SABİT değer — kullanıcı özelleştiremez. */
const VIP_INGAME_BADGE = 'VIP';
const VIP_CLAN_TAG_FIXED = '[BCS]';

/** Marketing / comparison copy (classic CS tone) */
const VIP_FEATURES = Object.freeze({
  silver: [
    'Scoreboard’da VIP rozeti (gümüş renk)',
    'Dolu sunucuda rezerve slot hakkı',
    'Votekick ile atılamazsın',
    'Rank listesinde VIP rozeti',
  ],
  gold: [
    'Silver’daki tüm ayrıcalıklar',
    'VIP ODA’ya giriş (sadece Gold/Platinum)',
    'Klasik VIP oyuncu modelleri (/vipmodel)',
    'Round başı ekstra para + ücretsiz kevlar',
    'Altın silah görünümü',
    '/vip durum menüsü',
  ],
  platinum: [
    'Gold’daki tüm ayrıcalıklar',
    'Öncelikli rezerve slot',
    'Sabit [BCS] clan tag (/clantag ile aç/kapa)',
    'Daha yüksek round parası veya CT defuse kiti',
    'Voteban / mute koruması',
    'Ayda 4 kez votemap’e harita önerisi (oylamaya girer)',
    'Sunucu kiralama indirimi',
  ],
});

function normalizeVipTier(tier) {
  const t = String(tier || 'none').toLowerCase().trim();
  return VIP_TIERS.includes(t) ? t : null;
}

function isActiveVip(row, now = new Date()) {
  if (!row) return false;
  const tier = normalizeVipTier(row.vip_tier);
  if (!tier || tier === 'none') return false;
  if (!row.vip_expires_at) return false;
  const exp = new Date(row.vip_expires_at);
  return Number.isFinite(exp.getTime()) && exp.getTime() > now.getTime();
}

function sanitizeClanTag(tag) {
  return String(tag || '')
    .replace(/[^\w\-\[\]]/g, '')
    .slice(0, 8);
}

function daysLeft(expiresAt, now = new Date()) {
  if (!expiresAt) return 0;
  const exp = new Date(expiresAt);
  if (!Number.isFinite(exp.getTime())) return 0;
  const ms = exp.getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

module.exports = {
  VIP_TIERS,
  VIP_TIER_RANK,
  VIP_PRICES_TRY,
  VIP_LABELS_TR,
  VIP_FEATURES,
  VIP_INGAME_BADGE,
  VIP_CLAN_TAG_FIXED,
  normalizeVipTier,
  isActiveVip,
  sanitizeClanTag,
  daysLeft,
};
