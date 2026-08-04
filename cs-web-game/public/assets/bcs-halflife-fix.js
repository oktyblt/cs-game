/**
 * BrowserCS — halflife.wad + inferno join fix (additive, live-safe)
 *
 * Live oyna bundle tries to fetch /cs-assets/valve/halflife.wad which is missing
 * on CF Pages (37MB > file limit). Split parts halflife1.wad + halfife2.wad exist;
 * this patch concatenates them on fetch so maps like de_inferno get textures and
 * can finish loading / stay connected.
 */
(function () {
  'use strict';

  const HL_RE = /\/cs-assets\/valve\/halflife\.wad(?:\?|$)/i;
  const PART1 = '/cs-assets/valve/halflife1.wad';
  const PART2 = '/cs-assets/valve/halflife2.wad';
  const CACHE = 'cs-assets-v2';

  function isWad3(buf) {
    return !!(buf && buf.byteLength > 12 &&
      buf[0] === 87 && buf[1] === 65 && buf[2] === 68 && buf[3] === 51);
  }

  let building = null;

  async function buildHalflifeResponse() {
    if (building) return building;
    building = (async () => {
      const [r1, r2] = await Promise.all([
        fetch(PART1, { cache: 'force-cache' }),
        fetch(PART2, { cache: 'force-cache' })
      ]);
      if (!r1.ok || !r2.ok) {
        throw new Error('halflife1/2 indirilemedi');
      }
      const b1 = new Uint8Array(await r1.arrayBuffer());
      const b2 = new Uint8Array(await r2.arrayBuffer());
      const out = new Uint8Array(b1.length + b2.length);
      out.set(b1, 0);
      out.set(b2, b1.length);
      if (!isWad3(out) || out.length < 4e6) {
        throw new Error('birleşik halflife.wad geçersiz');
      }
      try {
        console.log('[bcs-halflife-fix] ✓ halflife.wad', (out.length / 1048576).toFixed(1) + 'MB');
      } catch (_) {}
      return new Response(out, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'cache-control': 'public, max-age=31536000, immutable'
        }
      });
    })();
    try {
      return await building;
    } finally {
      building = null;
    }
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string'
      ? input
      : (input && typeof input.url === 'string' ? input.url : '');
    if (url && HL_RE.test(url)) {
      return buildHalflifeResponse().catch(() => origFetch(input, init));
    }
    return origFetch(input, init);
  };

  // Drop stale/bad cache entries that can block de_inferno join
  const purge = [
    '/cs-assets/valve/halflife.wad',
    '/cs-assets/valve/halflife.wad?v=full-hl-20260718',
    '/cs-assets/valve/basehalflife_required.wad',
    '/cs-assets/cstrike/maps/de_inferno.bsp',
    '/cs-assets/cstrike/de_inferno.wad',
    'https://browsercs.com/cs-assets/valve/halflife.wad',
    'https://browsercs.com/cs-assets/valve/halflife.wad?v=full-hl-20260718',
    'https://browsercs.com/cs-assets/cstrike/maps/de_inferno.bsp',
    'https://browsercs.com/cs-assets/cstrike/de_inferno.wad'
  ];
  if (typeof caches !== 'undefined' && caches.open) {
    caches.open(CACHE).then((c) => {
      purge.forEach((u) => {
        try { c.delete(u); } catch (_) {}
        try { c.delete(new Request(u)); } catch (_) {}
      });
    }).catch(() => {});
  }
})();
