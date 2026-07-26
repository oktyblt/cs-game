/**
 * Site CMS — settings + map catalog + sitemap XML + commerce/announcements (JSON file on disk).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.SITE_CONTENT_DIR || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'site-content.json');
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://browsercs.com';

// Lazy require to avoid circular init issues with commerce defaults
function commerceLib() {
  return require('./commerce');
}

const DEFAULT_STATIC_PAGES = [
  { path: '/', title: 'Ana Sayfa', changefreq: 'weekly', priority: '1.0', in_sitemap: true },
  { path: '/oyna/', title: 'Oyna', changefreq: 'daily', priority: '0.9', in_sitemap: true },
  { path: '/haritalar/', title: 'Haritalar', changefreq: 'weekly', priority: '0.9', in_sitemap: true },
  { path: '/sunucular/', title: 'Sunucular', changefreq: 'daily', priority: '0.8', in_sitemap: true },
  { path: '/sunucu-kirala/', title: 'Sunucu Kirala', changefreq: 'weekly', priority: '0.8', in_sitemap: true },
  { path: '/nasil-oynanir/', title: 'Nasıl Oynanır', changefreq: 'monthly', priority: '0.85', in_sitemap: true },
  { path: '/rank-takip/', title: 'Rank Takip', changefreq: 'daily', priority: '0.85', in_sitemap: true },
  { path: '/vip/', title: 'VIP Abonelik', changefreq: 'weekly', priority: '0.85', in_sitemap: true },
];

const DEFAULT_MAPS = [
  { name: 'de_dust2', slug: 'de-dust2', description: 'Bomb Defusal', mode: 'de', size: 2057288, featured: true, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_dust', slug: 'de-dust', description: 'Bomb Defusal', mode: 'de', size: 1359684, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_inferno', slug: 'de-inferno', description: 'Bomb Defusal', mode: 'de', size: 3567372, featured: true, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_aztec', slug: 'de-aztec', description: 'Bomb Defusal', mode: 'de', size: 2740604, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_nuke', slug: 'de-nuke', description: 'Bomb Defusal', mode: 'de', size: 2036392, featured: true, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_cbble', slug: 'de-cbble', description: 'Bomb Defusal', mode: 'de', size: 1698648, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_chateau', slug: 'de-chateau', description: 'Bomb Defusal', mode: 'de', size: 4953700, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_piranesi', slug: 'de-piranesi', description: 'Bomb Defusal', mode: 'de', size: 3391792, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_prodigy', slug: 'de-prodigy', description: 'Bomb Defusal', mode: 'de', size: 1929740, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_storm', slug: 'de-storm', description: 'Bomb Defusal', mode: 'de', size: 2955604, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_survivor', slug: 'de-survivor', description: 'Bomb Defusal', mode: 'de', size: 6464260, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_torn', slug: 'de-torn', description: 'Bomb Defusal', mode: 'de', size: 5466396, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_train', slug: 'de-train', description: 'Bomb Defusal', mode: 'de', size: 1145428, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_vegas', slug: 'de-vegas', description: 'Bomb Defusal', mode: 'de', size: 5148716, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'de_vertigo', slug: 'de-vertigo', description: 'Bomb Defusal', mode: 'de', size: 2146792, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'cs_assault', slug: 'cs-assault', description: 'Hostage Rescue', mode: 'cs', size: 1041700, featured: true, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'cs_office', slug: 'cs-office', description: 'Hostage Rescue', mode: 'cs', size: 4679872, featured: true, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'cs_italy', slug: 'cs-italy', description: 'Hostage Rescue', mode: 'cs', size: 2303480, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'cs_747', slug: 'cs-747', description: 'Hostage Rescue', mode: 'cs', size: 1702788, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'cs_backalley', slug: 'cs-backalley', description: 'Hostage Rescue', mode: 'cs', size: 2142344, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'cs_estate', slug: 'cs-estate', description: 'Hostage Rescue', mode: 'cs', size: 4485488, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'cs_havana', slug: 'cs-havana', description: 'Hostage Rescue', mode: 'cs', size: 4988672, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'cs_militia', slug: 'cs-militia', description: 'Hostage Rescue', mode: 'cs', size: 2022676, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'cs_siege', slug: 'cs-siege', description: 'Hostage Rescue', mode: 'cs', size: 3361120, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'as_oilrig', slug: 'as-oilrig', description: 'VIP Assassination', mode: 'as', size: 2056040, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'as_tundra', slug: 'as-tundra', description: 'VIP Assassination', mode: 'as', size: 2335152, featured: false, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'fy_iceworld', slug: 'fy-iceworld', description: 'Fight Yard', mode: 'fy', size: 0, featured: true, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'fy_pool_day', slug: 'fy-pool-day', description: 'Fight Yard', mode: 'fy', size: 853064, featured: true, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
  { name: 'he_glass', slug: 'he-glass', description: 'HE Grenades', mode: 'he', size: 530764, featured: true, playable: true, in_sitemap: true, seo_title: '', seo_description: '', priority: '0.75' },
];

function defaultContent() {
  const c = commerceLib();
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      siteName: 'BrowserCS',
      siteTagline: 'Tarayıcıdan indirmeden CS 1.5',
      seoTitle: 'BrowserCS — Tarayıcıdan İndirmeden CS 1.5 Oyna',
      seoDescription: 'Nostaljik Counter-Strike 1.5 — saniyeler içinde tarayıcıda. Kurulum yok.',
      motdTitle: 'BROWSERCS\'E HOŞ GELDİN',
      motdBody: 'Klasik CS 1.5 deneyimi. İyi oyunlar!',
      promoTitle: 'BROWSERCS 1.5',
      promoSub: 'tarayıcıda classic counter-strike',
      maintenanceMode: false,
      maintenanceMessage: 'Bakımdayız. Kısa süre sonra döneceğiz.',
      contactEmail: '',
      discordUrl: '',
      announceBanner: '',
      announceEnabled: false,
    },
    staticPages: DEFAULT_STATIC_PAGES.map((p) => ({ ...p })),
    maps: DEFAULT_MAPS.map((m) => ({ ...m })),
    announcements: c.defaultAnnouncements(),
    commerce: c.defaultCommerce(),
  };
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readContent() {
  ensureDir();
  const c = commerceLib();
  if (!fs.existsSync(DATA_FILE)) {
    const fresh = defaultContent();
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2));
    return fresh;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const base = defaultContent();
    return {
      ...base,
      ...raw,
      settings: { ...base.settings, ...(raw.settings || {}) },
      staticPages: Array.isArray(raw.staticPages) && raw.staticPages.length
        ? raw.staticPages
        : base.staticPages,
      maps: Array.isArray(raw.maps) && raw.maps.length ? raw.maps : base.maps,
      announcements: c.mergeAnnouncements(raw.announcements),
      commerce: c.mergeCommerce(raw.commerce),
    };
  } catch (_) {
    return defaultContent();
  }
}

function writeContent(content) {
  ensureDir();
  const c = commerceLib();
  const next = {
    ...content,
    announcements: c.mergeAnnouncements(content.announcements),
    commerce: c.mergeCommerce(content.commerce),
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(next, null, 2));
  return next;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildSitemapXml(content = readContent()) {
  const lastmod = todayIso();
  const urls = [];

  for (const page of content.staticPages || []) {
    if (page.in_sitemap === false) continue;
    urls.push({
      loc: `${SITE_ORIGIN}${page.path.startsWith('/') ? page.path : `/${page.path}`}`,
      lastmod,
      changefreq: page.changefreq || 'weekly',
      priority: page.priority || '0.5',
    });
  }

  for (const map of content.maps || []) {
    if (map.in_sitemap === false) continue;
    const slug = map.slug || String(map.name || '').replace(/_/g, '-');
    if (!slug) continue;
    urls.push({
      loc: `${SITE_ORIGIN}/haritalar/${slug}/`,
      lastmod,
      changefreq: 'monthly',
      priority: map.priority || '0.75',
    });
  }

  const body = urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

function normalizeMap(input = {}, prev = {}) {
  const name = String(input.name || prev.name || '').trim().replace(/\s+/g, '_');
  if (!name) throw new Error('Harita adı gerekli');
  const slug = String(input.slug || prev.slug || name.replace(/_/g, '-'))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
  return {
    name,
    slug,
    description: String(input.description ?? prev.description ?? '').slice(0, 200),
    mode: String(input.mode ?? prev.mode ?? 'de').slice(0, 16),
    size: Number.isFinite(Number(input.size)) ? Number(input.size) : (prev.size || 0),
    featured: !!(input.featured ?? prev.featured),
    playable: input.playable === undefined ? (prev.playable !== false) : !!input.playable,
    in_sitemap: input.in_sitemap === undefined ? (prev.in_sitemap !== false) : !!input.in_sitemap,
    seo_title: String(input.seo_title ?? prev.seo_title ?? '').slice(0, 120),
    seo_description: String(input.seo_description ?? prev.seo_description ?? '').slice(0, 300),
    priority: String(input.priority ?? prev.priority ?? '0.75').slice(0, 8),
  };
}

function publicMapsPayload(content = readContent()) {
  const maps = (content.maps || [])
    .filter((m) => m.playable !== false)
    .map((m) => ({
      name: m.name,
      size: m.size || 0,
      description: m.description || '',
      slug: m.slug,
      featured: !!m.featured,
      mode: m.mode || '',
    }));
  return { maps, total: maps.length, updatedAt: content.updatedAt };
}

function publicSettingsPayload(content = readContent()) {
  const s = content.settings || {};
  return {
    siteName: s.siteName,
    siteTagline: s.siteTagline,
    seoTitle: s.seoTitle,
    seoDescription: s.seoDescription,
    motdTitle: s.motdTitle,
    motdBody: s.motdBody,
    promoTitle: s.promoTitle,
    promoSub: s.promoSub,
    maintenanceMode: !!s.maintenanceMode,
    maintenanceMessage: s.maintenanceMessage,
    announceBanner: s.announceBanner,
    announceEnabled: !!s.announceEnabled,
    discordUrl: s.discordUrl || '',
    updatedAt: content.updatedAt,
  };
}

module.exports = {
  DATA_DIR,
  DATA_FILE,
  readContent,
  writeContent,
  defaultContent,
  buildSitemapXml,
  normalizeMap,
  publicMapsPayload,
  publicSettingsPayload,
};
