#!/usr/bin/env node
/**
 * commerce-cms.selftest.js — CMS commerce / announcements smoke tests.
 * Runs against an isolated temp SITE_CONTENT_DIR (does not touch live data).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bcs-commerce-'));
process.env.SITE_CONTENT_DIR = tmp;
process.env.SITE_UPLOADS_DIR = path.join(tmp, 'uploads');
delete require.cache[require.resolve('../lib/siteContent')];
delete require.cache[require.resolve('../lib/commerce')];

const siteContent = require('../lib/siteContent');
const commerce = require('../lib/commerce');

let failed = 0;
function ok(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('commerce-cms selftest');
console.log(`  tmp: ${tmp}`);

// --- defaults merge ---
{
  const c = commerce.getCommerce();
  ok('default bank name', !!c.bank.bankName);
  ok('default rental tiers 4', c.rental.tiers.length === 4);
  ok('default VIP silver/gold/platinum', !!(c.vip.silver && c.vip.gold && c.vip.platinum));
  ok('default VIP prices 49/99/199',
    c.vip.silver.priceTry === 49 && c.vip.gold.priceTry === 99 && c.vip.platinum.priceTry === 199);
  const anns = commerce.getAnnouncements();
  ok('default announcements >= 2', anns.length >= 2);
}

// --- priceForRentalSlots ---
{
  ok('16 → 350', commerce.priceForRentalSlots(16) === 350);
  ok('32 → 550', commerce.priceForRentalSlots(32) === 550);
  ok('8 → 250', commerce.priceForRentalSlots(8) === 250);
  ok('24 → 450', commerce.priceForRentalSlots(24) === 450);
}

// --- Platinum rental %10 ---
{
  const noDisc = commerce.applyPlatinumRentalDiscount(350, { vipTier: 'gold', vipActive: true });
  ok('gold no rental discount', noDisc.amountTry === 350 && !noDisc.vipDiscount);
  const plat = commerce.applyPlatinumRentalDiscount(350, { vipTier: 'platinum', vipActive: true });
  ok('platinum 350 → 315', plat.amountTry === 315 && plat.discountTry === 35 && plat.vipDiscount);
  const resolved = commerce.resolveRentalTier(16, { vipTier: 'platinum', vipActive: true });
  ok('resolveRentalTier platinum 16', resolved.ok && resolved.amountTry === 315);
  const bank = commerce.getBankInfo(32, { vipTier: 'platinum', vipActive: true });
  ok('bank info 32 platinum 495', bank.amountTry === 495 && bank.listPriceTry === 550);
}

// --- resolveRentalTier reject disabled ---
{
  const saved = commerce.saveCommerce({
    rental: {
      defaultMaxPlayers: 16,
      tiers: [
        { maxPlayers: 8, priceTry: 250, label: '8', enabled: true },
        { maxPlayers: 16, priceTry: 350, label: '16', enabled: true },
        { maxPlayers: 24, priceTry: 450, label: '24', enabled: false },
        { maxPlayers: 32, priceTry: 550, label: '32', enabled: true },
      ],
    },
  });
  ok('saveCommerce returned tiers', saved.rental.tiers.length === 4);
  const bad = commerce.resolveRentalTier(24);
  ok('disabled tier rejected', bad.ok === false && /satışta değil|değil/i.test(bad.error || ''));
  const good = commerce.resolveRentalTier(16);
  ok('enabled tier ok amount 350', good.ok === true && good.amountTry === 350);
  const missing = commerce.resolveRentalTier(99);
  ok('missing tier rejected', missing.ok === false);
}

// --- VIP resolve ---
{
  commerce.saveCommerce({
    vip: {
      gold: { priceTry: 123, label: 'Altın Test', enabled: true, features: ['A', 'B'] },
    },
  });
  const pack = commerce.getVipPackage('gold');
  ok('VIP gold price override', pack && pack.priceTry === 123);
  ok('VIP gold features', pack.features.length === 2 && pack.features[0] === 'A');
  ok('VIP prices map', commerce.getVipPricesMap().gold === 123);
}

// --- announcements filter/sort ---
{
  commerce.saveAnnouncements([
    { id: 'b', enabled: true, sort: 20, title: 'B', ctaType: 'url', ctaUrl: 'https://x.test' },
    { id: 'a', enabled: true, sort: 10, title: 'A', ctaType: 'register' },
    { id: 'c', enabled: false, sort: 5, title: 'C', ctaType: 'rank' },
  ]);
  const all = commerce.getAnnouncements();
  ok('announcements sorted', all[0].id === 'c' && all[1].id === 'a' && all[2].id === 'b');
  const pub = commerce.getAnnouncements(null, { enabledOnly: true });
  ok('enabledOnly filters', pub.length === 2 && pub[0].id === 'a' && pub[1].id === 'b');
  const payload = commerce.publicAnnouncementsPayload();
  ok('public payload enabled only', payload.announcements.length === 2);
}

// --- upload path sanitize ---
{
  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = commerce.saveUploadFromDataUrl(tinyPng);
  ok('upload url /media/', /^\/media\/ann-\d+-[a-f0-9]+\.png$/.test(up.url));
  ok('upload file exists', fs.existsSync(path.join(commerce.UPLOADS_DIR, up.filename)));
  let threw = false;
  try {
    commerce.saveUploadFromDataUrl('data:text/plain;base64,YQ==');
  } catch {
    threw = true;
  }
  ok('reject non-image mime', threw);
}

// --- bank info ---
{
  commerce.saveCommerce({
    bank: { bankName: 'TESTBANK', bankHolder: 'HOLDER', bankIban: 'TR00TEST', note: 'note' },
    rental: {
      defaultMaxPlayers: 16,
      tiers: [
        { maxPlayers: 16, priceTry: 350, label: '16', enabled: true },
        { maxPlayers: 32, priceTry: 550, label: '32', enabled: true },
      ],
    },
  });
  const info16 = commerce.getBankInfo(16);
  ok('bank info 16 amount', info16.amountTry === 350 && info16.bankName === 'TESTBANK');
  const info32 = commerce.getBankInfo(32);
  ok('bank info 32 amount', info32.amountTry === 550);
}

// --- siteContent merge keeps commerce ---
{
  const raw = siteContent.readContent();
  ok('siteContent has commerce', !!raw.commerce);
  ok('siteContent has announcements', Array.isArray(raw.announcements));
  siteContent.writeContent({
    ...raw,
    settings: { ...raw.settings, siteName: 'Selftest' },
  });
  const again = siteContent.readContent();
  ok('write preserves commerce bank', again.commerce?.bank?.bankName === 'TESTBANK');
  ok('write preserves announcements', again.announcements?.length >= 1);
}

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (_) { /* ignore */ }

if (failed) {
  console.error(`\nFAILED: ${failed} assertion(s)`);
  process.exit(1);
}
console.log('\nAll assertions passed.');
process.exit(0);
