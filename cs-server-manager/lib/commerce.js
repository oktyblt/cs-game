/**
 * Commerce resolve layer — bank / rental tiers / VIP packages.
 * Priority: site-content.json CMS → env → hardcoded defaults.
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const siteContent = require('./siteContent');
const {
  VIP_PRICES_TRY,
  VIP_LABELS_TR,
  VIP_FEATURES,
  VIP_TIERS,
  normalizeVipTier,
} = require('./vipConstants');

const DATA_DIR = process.env.SITE_CONTENT_DIR || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = process.env.SITE_UPLOADS_DIR || path.join(DATA_DIR, 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  return UPLOADS_DIR;
}

function defaultBank() {
  return {
    bankName: process.env.BANK_NAME || 'ENPARA',
    bankHolder: process.env.BANK_HOLDER || 'OKTAY BULUT',
    bankIban: process.env.BANK_IBAN || 'TRXXXXXXXXXXXXXXXXXXXXXXXX',
    note: 'Havale/EFT açıklamasına mutlaka sipariş numarasını yazın.',
  };
}

function defaultRental() {
  const base = Number(process.env.BANK_AMOUNT_TRY || 350);
  return {
    defaultMaxPlayers: 16,
    tiers: [
      { maxPlayers: 8, priceTry: Math.max(150, base - 100), label: '8 slot', enabled: true },
      { maxPlayers: 16, priceTry: base, label: '16 slot', enabled: true },
      { maxPlayers: 24, priceTry: base + 100, label: '24 slot', enabled: true },
      { maxPlayers: 32, priceTry: base + 200, label: '32 slot', enabled: true },
    ],
  };
}

function defaultVip() {
  return {
    silver: {
      enabled: true,
      priceTry: VIP_PRICES_TRY.silver,
      label: VIP_LABELS_TR.silver,
      features: [...VIP_FEATURES.silver],
    },
    gold: {
      enabled: true,
      priceTry: VIP_PRICES_TRY.gold,
      label: VIP_LABELS_TR.gold,
      features: [...VIP_FEATURES.gold],
    },
    platinum: {
      enabled: true,
      priceTry: VIP_PRICES_TRY.platinum,
      label: VIP_LABELS_TR.platinum,
      features: [...VIP_FEATURES.platinum],
    },
  };
}

function defaultCommerce() {
  return {
    bank: defaultBank(),
    rental: defaultRental(),
    vip: defaultVip(),
  };
}

function defaultAnnouncements() {
  return [
    {
      id: 'ann-gold-promo',
      enabled: true,
      sort: 10,
      title: '30 Gün Gold VIP Hediye',
      subtitle: "15 Ağustos'a kadar kayıt olana Gold VIP otomatik tanımlı.",
      ribbon: 'Açılış Kampanyası',
      imageUrl: '/assets/vip/vip-golden-weapons-banner.webp',
      ctaLabel: 'Üye Ol →',
      ctaType: 'register',
      ctaUrl: '',
    },
    {
      id: 'ann-rank-vip',
      enabled: true,
      sort: 20,
      title: "Top 10'a 1 Aylık VIP",
      subtitle: '1–3 Platinum · 4–6 Gold · 7–10 Silver — ay sonunda otomatik.',
      ribbon: 'Aylık Rank Ödülü',
      imageUrl: '/assets/vip/vip-classic-models-banner.webp',
      ctaLabel: 'Rank Detay →',
      ctaType: 'rank',
      ctaUrl: '/rank-takip/',
    },
  ];
}

function mergeVipTier(base, patch) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const features = Array.isArray(p.features)
    ? p.features.map((f) => String(f || '').trim()).filter(Boolean)
    : base.features;
  return {
    enabled: p.enabled === undefined ? base.enabled !== false : !!p.enabled,
    priceTry: Number.isFinite(Number(p.priceTry)) ? Number(p.priceTry) : base.priceTry,
    label: String(p.label || base.label || '').slice(0, 64),
    features,
  };
}

function mergeCommerce(raw) {
  const base = defaultCommerce();
  const c = raw && typeof raw === 'object' ? raw : {};
  const bankIn = c.bank && typeof c.bank === 'object' ? c.bank : {};
  const rentalIn = c.rental && typeof c.rental === 'object' ? c.rental : {};
  const vipIn = c.vip && typeof c.vip === 'object' ? c.vip : {};

  let tiers = Array.isArray(rentalIn.tiers) && rentalIn.tiers.length
    ? rentalIn.tiers.map((t) => ({
      maxPlayers: parseInt(t.maxPlayers, 10) || 16,
      priceTry: Number.isFinite(Number(t.priceTry)) ? Number(t.priceTry) : base.rental.tiers[0].priceTry,
      label: String(t.label || `${t.maxPlayers || 16} slot`).slice(0, 48),
      enabled: t.enabled === undefined ? true : !!t.enabled,
    }))
    : base.rental.tiers.map((t) => ({ ...t }));

  // unique by maxPlayers, keep last
  const bySlot = new Map();
  for (const t of tiers) bySlot.set(t.maxPlayers, t);
  tiers = [...bySlot.values()].sort((a, b) => a.maxPlayers - b.maxPlayers);

  return {
    bank: {
      bankName: String(bankIn.bankName || base.bank.bankName).slice(0, 64),
      bankHolder: String(bankIn.bankHolder || base.bank.bankHolder).slice(0, 128),
      bankIban: String(bankIn.bankIban || base.bank.bankIban).replace(/\s+/g, '').slice(0, 64),
      note: String(bankIn.note || base.bank.note || '').slice(0, 300),
    },
    rental: {
      defaultMaxPlayers: parseInt(rentalIn.defaultMaxPlayers, 10) || base.rental.defaultMaxPlayers,
      tiers,
    },
    vip: {
      silver: mergeVipTier(base.vip.silver, vipIn.silver),
      gold: mergeVipTier(base.vip.gold, vipIn.gold),
      platinum: mergeVipTier(base.vip.platinum, vipIn.platinum),
    },
  };
}

function normalizeAnnouncement(input = {}, prev = {}) {
  const ctaType = ['register', 'url', 'rank'].includes(String(input.ctaType || prev.ctaType))
    ? String(input.ctaType || prev.ctaType)
    : 'url';
  return {
    id: String(input.id || prev.id || `ann-${crypto.randomBytes(4).toString('hex')}`),
    enabled: input.enabled === undefined ? (prev.enabled !== false) : !!input.enabled,
    sort: Number.isFinite(Number(input.sort)) ? Number(input.sort) : (Number(prev.sort) || 100),
    title: String(input.title ?? prev.title ?? '').slice(0, 120),
    subtitle: String(input.subtitle ?? prev.subtitle ?? '').slice(0, 300),
    ribbon: String(input.ribbon ?? prev.ribbon ?? '').slice(0, 64),
    imageUrl: String(input.imageUrl ?? prev.imageUrl ?? '').slice(0, 500),
    ctaLabel: String(input.ctaLabel ?? prev.ctaLabel ?? 'Detay →').slice(0, 48),
    ctaType,
    ctaUrl: String(input.ctaUrl ?? prev.ctaUrl ?? '').slice(0, 500),
  };
}

function mergeAnnouncements(raw) {
  if (!Array.isArray(raw) || !raw.length) return defaultAnnouncements();
  return raw.map((a) => normalizeAnnouncement(a)).sort((a, b) => a.sort - b.sort);
}

function getCommerce(content) {
  const c = content || siteContent.readContent();
  return mergeCommerce(c.commerce);
}

function getAnnouncements(content, { enabledOnly = false } = {}) {
  const c = content || siteContent.readContent();
  let list = mergeAnnouncements(c.announcements);
  if (enabledOnly) list = list.filter((a) => a.enabled);
  return list;
}

function getBankInfo(maxPlayers, vipOpts = {}) {
  const commerce = getCommerce();
  const listPrice = priceForRentalSlots(maxPlayers, commerce);
  const priced = applyPlatinumRentalDiscount(listPrice, vipOpts);
  return {
    bankName: commerce.bank.bankName,
    bankHolder: commerce.bank.bankHolder,
    bankIban: commerce.bank.bankIban,
    note: commerce.bank.note,
    amountTry: priced.amountTry,
    listPriceTry: priced.listPriceTry,
    discountPct: priced.discountPct,
    discountTry: priced.discountTry,
    vipDiscount: priced.vipDiscount,
    vipTier: priced.vipTier || null,
    rentalDiscountNote: PLATINUM_RENTAL_DISCOUNT_NOTE,
  };
}

/** Platinum VIP aktifse kiralama tutarına %10 indirim */
const PLATINUM_RENTAL_DISCOUNT_PCT = 10;
const PLATINUM_RENTAL_DISCOUNT_NOTE = 'Aktif Platinum VIP: sunucu kiralama %10 indirimli';

function isPlatinumVipEligible(opts = {}) {
  if (!opts) return false;
  if (opts.vipDiscount === false) return false;
  if (opts.forcePlatinum === true) return true;
  const { isActiveVip, normalizeVipTier } = require('./vipConstants');
  if (opts.profile) {
    return isActiveVip(opts.profile) && normalizeVipTier(opts.profile.vip_tier) === 'platinum';
  }
  const tier = normalizeVipTier(opts.vipTier || opts.tier);
  if (tier !== 'platinum') return false;
  if (opts.vipActive === false) return false;
  if (opts.vipExpiresAt) {
    return isActiveVip({ vip_tier: 'platinum', vip_expires_at: opts.vipExpiresAt });
  }
  return opts.vipActive === true || opts.active === true;
}

function applyPlatinumRentalDiscount(amountTry, opts = {}) {
  const listPriceTry = Math.max(0, Math.round(Number(amountTry) || 0));
  if (!isPlatinumVipEligible(opts)) {
    return {
      amountTry: listPriceTry,
      listPriceTry,
      discountPct: 0,
      discountTry: 0,
      vipDiscount: false,
      vipTier: null,
    };
  }
  const amountTryFinal = Math.max(0, Math.round(listPriceTry * (1 - PLATINUM_RENTAL_DISCOUNT_PCT / 100)));
  return {
    amountTry: amountTryFinal,
    listPriceTry,
    discountPct: PLATINUM_RENTAL_DISCOUNT_PCT,
    discountTry: listPriceTry - amountTryFinal,
    vipDiscount: true,
    vipTier: 'platinum',
  };
}

function priceForRentalSlots(maxPlayers, commerceIn) {
  const commerce = commerceIn || getCommerce();
  const slots = parseInt(maxPlayers, 10) || commerce.rental.defaultMaxPlayers || 16;
  const enabled = commerce.rental.tiers.filter((t) => t.enabled !== false);
  const exact = enabled.find((t) => t.maxPlayers === slots);
  if (exact) return Number(exact.priceTry);

  // nearest enabled tier by slot count
  if (!enabled.length) return Number(process.env.BANK_AMOUNT_TRY || 350);
  let best = enabled[0];
  let bestDist = Math.abs(best.maxPlayers - slots);
  for (const t of enabled) {
    const d = Math.abs(t.maxPlayers - slots);
    if (d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return Number(best.priceTry);
}

function resolveRentalTier(maxPlayers, vipOpts = {}) {
  const commerce = getCommerce();
  const slots = parseInt(maxPlayers, 10) || commerce.rental.defaultMaxPlayers || 16;
  const tier = commerce.rental.tiers.find((t) => t.maxPlayers === slots);
  if (!tier) {
    return { ok: false, error: `Bu kapasite (${slots}) için fiyat tanımlı değil` };
  }
  if (tier.enabled === false) {
    return { ok: false, error: `${slots} slot paketi şu an satışta değil` };
  }
  const priced = applyPlatinumRentalDiscount(Number(tier.priceTry), vipOpts);
  return {
    ok: true,
    tier,
    maxPlayers: slots,
    amountTry: priced.amountTry,
    listPriceTry: priced.listPriceTry,
    discountPct: priced.discountPct,
    discountTry: priced.discountTry,
    vipDiscount: priced.vipDiscount,
    vipTier: priced.vipTier,
  };
}

function getVipPackage(tier) {
  const t = normalizeVipTier(tier);
  if (!t || t === 'none') return null;
  const commerce = getCommerce();
  return commerce.vip[t] || null;
}

function getVipPricesMap() {
  const commerce = getCommerce();
  return {
    silver: commerce.vip.silver.priceTry,
    gold: commerce.vip.gold.priceTry,
    platinum: commerce.vip.platinum.priceTry,
  };
}

function getVipLabelsMap() {
  const commerce = getCommerce();
  return {
    none: 'Yok',
    silver: commerce.vip.silver.label,
    gold: commerce.vip.gold.label,
    platinum: commerce.vip.platinum.label,
  };
}

function getVipFeaturesMap() {
  const commerce = getCommerce();
  return {
    silver: commerce.vip.silver.features,
    gold: commerce.vip.gold.features,
    platinum: commerce.vip.platinum.features,
  };
}

function publicCommercePayload() {
  const commerce = getCommerce();
  return {
    bank: { ...commerce.bank },
    rental: {
      defaultMaxPlayers: commerce.rental.defaultMaxPlayers,
      tiers: commerce.rental.tiers.filter((t) => t.enabled !== false),
      allTiers: commerce.rental.tiers,
      platinumDiscountPct: PLATINUM_RENTAL_DISCOUNT_PCT,
      platinumDiscountNote: PLATINUM_RENTAL_DISCOUNT_NOTE,
    },
    vip: {
      silver: { ...commerce.vip.silver },
      gold: { ...commerce.vip.gold },
      platinum: { ...commerce.vip.platinum },
    },
    updatedAt: siteContent.readContent().updatedAt,
  };
}

function publicAnnouncementsPayload() {
  return {
    announcements: getAnnouncements(null, { enabledOnly: true }),
    updatedAt: siteContent.readContent().updatedAt,
  };
}

function saveCommerce(patch) {
  const content = siteContent.readContent();
  const current = getCommerce(content);
  const nextRaw = {
    bank: patch.bank ? { ...current.bank, ...patch.bank } : current.bank,
    rental: patch.rental
      ? {
          defaultMaxPlayers: patch.rental.defaultMaxPlayers ?? current.rental.defaultMaxPlayers,
          tiers: Array.isArray(patch.rental.tiers) ? patch.rental.tiers : current.rental.tiers,
        }
      : current.rental,
    vip: patch.vip
      ? {
          silver: { ...current.vip.silver, ...(patch.vip.silver || {}) },
          gold: { ...current.vip.gold, ...(patch.vip.gold || {}) },
          platinum: { ...current.vip.platinum, ...(patch.vip.platinum || {}) },
        }
      : current.vip,
  };
  content.commerce = mergeCommerce(nextRaw);
  const saved = siteContent.writeContent(content);
  return mergeCommerce(saved.commerce);
}

function saveAnnouncements(list) {
  const content = siteContent.readContent();
  content.announcements = mergeAnnouncements(list);
  const saved = siteContent.writeContent(content);
  return mergeAnnouncements(saved.announcements);
}

function upsertAnnouncement(input) {
  const content = siteContent.readContent();
  const list = mergeAnnouncements(content.announcements);
  const id = input.id || null;
  const idx = id ? list.findIndex((a) => a.id === id) : -1;
  const next = normalizeAnnouncement(input, idx >= 0 ? list[idx] : {});
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  content.announcements = list.sort((a, b) => a.sort - b.sort);
  siteContent.writeContent(content);
  return next;
}

function deleteAnnouncement(id) {
  const content = siteContent.readContent();
  const before = mergeAnnouncements(content.announcements);
  const next = before.filter((a) => a.id !== id);
  if (next.length === before.length) return null;
  content.announcements = next;
  siteContent.writeContent(content);
  return next;
}

const ALLOWED_UPLOAD_MIME = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function saveUploadFromDataUrl(dataUrl) {
  ensureUploadsDir();
  const m = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) throw new Error('Geçersiz görsel (data URL bekleniyor)');
  const mime = m[1].toLowerCase();
  const ext = ALLOWED_UPLOAD_MIME[mime];
  if (!ext) throw new Error('Sadece jpg/png/webp/gif');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) throw new Error('Görsel en fazla 5 MB olabilir');
  const name = `ann-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const full = path.join(UPLOADS_DIR, name);
  fs.writeFileSync(full, buf);
  return { filename: name, url: `/media/${name}`, bytes: buf.length };
}

function saveUploadBuffer(buf, mime) {
  ensureUploadsDir();
  const ext = ALLOWED_UPLOAD_MIME[String(mime || '').toLowerCase()];
  if (!ext) throw new Error('Sadece jpg/png/webp/gif');
  if (!buf || buf.length > 5 * 1024 * 1024) throw new Error('Görsel en fazla 5 MB olabilir');
  const name = `ann-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
  return { filename: name, url: `/media/${name}`, bytes: buf.length };
}

module.exports = {
  UPLOADS_DIR,
  ensureUploadsDir,
  defaultCommerce,
  defaultAnnouncements,
  mergeCommerce,
  mergeAnnouncements,
  normalizeAnnouncement,
  getCommerce,
  getAnnouncements,
  getBankInfo,
  priceForRentalSlots,
  resolveRentalTier,
  applyPlatinumRentalDiscount,
  isPlatinumVipEligible,
  PLATINUM_RENTAL_DISCOUNT_PCT,
  PLATINUM_RENTAL_DISCOUNT_NOTE,
  getVipPackage,
  getVipPricesMap,
  getVipLabelsMap,
  getVipFeaturesMap,
  publicCommercePayload,
  publicAnnouncementsPayload,
  saveCommerce,
  saveAnnouncements,
  upsertAnnouncement,
  deleteAnnouncement,
  saveUploadFromDataUrl,
  saveUploadBuffer,
  VIP_TIERS,
};
