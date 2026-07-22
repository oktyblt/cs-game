import { adminHeaders } from '../api.js';

export function shouldOpenMasterAdmin() {
  return window.location.search.includes('admin=1') || window.location.hash === '#csadmin';
}

export function initMasterAdmin({ API_URL, $, notify, supabase, getSessionToken }) {
  // ─── MASTER ADMIN LOGIC ────────────────────────────────────────────────────────
  const btnMasterAdmin = $('btn-master-admin');
  const adminLoginModal = $('admin-login-modal');
  const btnAdminLoginCancel = $('btn-admin-login-cancel');
  const btnAdminLoginSubmit = $('btn-admin-login-submit');
  const adminPasswordInput = $('admin-password-input');
  const masterAdminPanel = $('master-admin-panel');
  const btnAdminPanelClose = $('btn-admin-panel-close');
  const masterAdminTableBody = $('master-admin-table-body');

  let adminToken = sessionStorage.getItem('cs_master_admin_token') || null;

  // Master admin paneli — giriş yapmış kullanıcı + admin şifresi gerekir
  async function checkAdminAccess() {
    try {
      if (!supabase) return false;
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      return !sessionError && !!sessionData?.session?.user;
    } catch (e) { return false; }
  }

  async function openAdminIfRequested() {
    if (!shouldOpenMasterAdmin()) return;
    const canAccess = await checkAdminAccess();
    if (!canAccess) {
      sessionStorage.removeItem('cs_master_admin_token');
      adminToken = null;
      notify('Master admin paneli için önce giriş yapmalısınız!', 'error');
      setTimeout(() => { window.location.href = '/oyna'; }, 1500);
      return;
    }
    if (adminToken) {
      openMasterAdminPanel();
    } else if (adminLoginModal) {
      adminLoginModal.style.display = 'flex';
    }
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => { openAdminIfRequested(); });
  } else {
    openAdminIfRequested();
  }

  if (btnAdminLoginCancel) {
    btnAdminLoginCancel.addEventListener('click', () => {
      adminLoginModal.style.display = 'none';
    });
  }

  if (btnAdminLoginSubmit) {
    btnAdminLoginSubmit.addEventListener('click', async () => {
      const password = adminPasswordInput.value;
      if (!password) return notify('Şifre giriniz', 'error');
      try {
        const res = await fetch(`${API_URL}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (data.success && data.token) {
          adminToken = data.token;
          sessionStorage.setItem('cs_master_admin_token', adminToken);
          adminLoginModal.style.display = 'none';
          notify('Admin girişi başarılı!', 'success');
          openMasterAdminPanel();
        } else {
          notify('Hatalı şifre!', 'error');
        }
      } catch (e) {
        notify('Sunucu bağlantı hatası', 'error');
      }
    });
  }

  if (btnAdminPanelClose) {
    btnAdminPanelClose.addEventListener('click', () => {
      masterAdminPanel.style.display = 'none';
    });
  }

  let _maCurrentView = 'dashboard';
  let _maServersCache = [];
  let _maUsersSearchTimer = null;
  let _maUsersCache = [];

  function maEscape(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function maFormatDate(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return '—'; }
  }

  function maAdminHeaders(extra = {}) {
    return adminHeaders(adminToken, extra);
  }

  function setMasterAdminView(view) {
    if (_maCurrentView === 'visitors' && view !== 'visitors') {
      stopVisitorAutoRefresh();
    }
    _maCurrentView = view;
    document.querySelectorAll('#master-admin-panel .ma-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.maView === view);
    });
    document.querySelectorAll('#master-admin-panel .ma-view').forEach(el => {
      el.classList.toggle('active', el.id === `ma-view-${view}`);
    });
    refreshMasterAdminView(view);
  }

  async function refreshMasterAdminView(view = _maCurrentView) {
    if (!adminToken) return;
    if (view === 'dashboard') {
      await loadAdminOverview();
    } else if (view === 'servers') {
      await loadAdminServers();
    } else if (view === 'orders') {
      await loadAdminRentalOrders();
    } else if (view === 'users') {
      await loadAdminUsers();
      await loadAdminVip();
      await loadAdminVipOrders();
    } else if (view === 'admins') {
      await loadAdminAmxAdmins();
    } else if (view === 'visitors') {
      await loadAdminVisitorStats();
    } else if (view === 'site') {
      await loadMaSiteContent();
    } else if (view === 'maps') {
      await loadMaMaps();
    } else if (view === 'system') {
      const openBtn = $('btn-ma-sitemap-open');
      if (openBtn) openBtn.href = `${API_URL}/api/site/sitemap.xml`;
    }
  }

  let _maMapsCache = [];
  let _maPagesCache = [];
  let _maSitemapXml = '';

  function renderMaPagesTable(pages) {
    const tbody = $('ma-pages-table-body');
    if (!tbody) return;
    _maPagesCache = Array.isArray(pages) ? pages.map((p) => ({ ...p })) : [];
    tbody.innerHTML = _maPagesCache.map((p, i) => `
      <tr data-ma-page-idx="${i}" style="border-top:1px solid rgba(255,255,255,0.06);">
        <td style="padding:0.3rem;"><input class="room-input ma-page-path" value="${maEscape(p.path || '')}" style="min-width:7rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-page-title" value="${maEscape(p.title || '')}" style="min-width:7rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-page-freq" value="${maEscape(p.changefreq || 'weekly')}" style="width:5rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-page-prio" value="${maEscape(p.priority || '0.5')}" style="width:3.2rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;text-align:center;"><input type="checkbox" class="ma-page-sitemap" ${p.in_sitemap !== false ? 'checked' : ''} /></td>
        <td style="padding:0.3rem;"><button type="button" class="toolbar-btn danger ma-page-del" data-idx="${i}" style="padding:0.2rem 0.45rem;font-size:0.65rem;">Sil</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('.ma-page-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        _maPagesCache.splice(idx, 1);
        renderMaPagesTable(_maPagesCache);
      });
    });
  }

  function collectMaPagesFromDom() {
    const tbody = $('ma-pages-table-body');
    if (!tbody) return _maPagesCache;
    return Array.from(tbody.querySelectorAll('tr[data-ma-page-idx]')).map((tr) => {
      let path = tr.querySelector('.ma-page-path')?.value?.trim() || '';
      if (path && !path.startsWith('/')) path = `/${path}`;
      return {
        path,
        title: tr.querySelector('.ma-page-title')?.value?.trim() || '',
        changefreq: tr.querySelector('.ma-page-freq')?.value?.trim() || 'weekly',
        priority: tr.querySelector('.ma-page-prio')?.value?.trim() || '0.5',
        in_sitemap: !!tr.querySelector('.ma-page-sitemap')?.checked,
      };
    }).filter((p) => p.path);
  }

  async function loadMaSiteContent() {
    try {
      const res = await fetch(`${API_URL}/api/admin/site-content`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Yüklenemedi');
      const s = data.content?.settings || {};
      const set = (id, val) => { const el = $(id); if (el) el.value = val ?? ''; };
      const setChk = (id, val) => { const el = $(id); if (el) el.checked = !!val; };
      set('ma-site-name', s.siteName);
      set('ma-site-tagline', s.siteTagline);
      set('ma-site-seo-title', s.seoTitle);
      set('ma-site-seo-desc', s.seoDescription);
      set('ma-site-motd-title', s.motdTitle);
      set('ma-site-motd-body', s.motdBody);
      set('ma-site-promo-title', s.promoTitle);
      set('ma-site-promo-sub', s.promoSub);
      set('ma-site-announce', s.announceBanner);
      set('ma-site-discord', s.discordUrl);
      set('ma-site-maintenance-msg', s.maintenanceMessage);
      setChk('ma-site-announce-on', s.announceEnabled);
      setChk('ma-site-maintenance', s.maintenanceMode);
      renderMaPagesTable(data.content?.staticPages || []);
      const upd = $('ma-site-updated');
      if (upd) upd.textContent = data.content?.updatedAt
        ? `Son güncelleme: ${maFormatDate(data.content.updatedAt)}`
        : '';
    } catch (e) {
      notify('Site ayarları yüklenemedi: ' + e.message, 'error');
    }
  }

  async function saveMaSiteContent() {
    if (!adminToken) return;
    try {
      const body = {
        siteName: $('ma-site-name')?.value?.trim() || '',
        siteTagline: $('ma-site-tagline')?.value?.trim() || '',
        seoTitle: $('ma-site-seo-title')?.value?.trim() || '',
        seoDescription: $('ma-site-seo-desc')?.value?.trim() || '',
        motdTitle: $('ma-site-motd-title')?.value?.trim() || '',
        motdBody: $('ma-site-motd-body')?.value?.trim() || '',
        promoTitle: $('ma-site-promo-title')?.value?.trim() || '',
        promoSub: $('ma-site-promo-sub')?.value?.trim() || '',
        announceBanner: $('ma-site-announce')?.value?.trim() || '',
        announceEnabled: !!$('ma-site-announce-on')?.checked,
        discordUrl: $('ma-site-discord')?.value?.trim() || '',
        maintenanceMode: !!$('ma-site-maintenance')?.checked,
        maintenanceMessage: $('ma-site-maintenance-msg')?.value?.trim() || '',
        staticPages: collectMaPagesFromDom(),
      };
      const res = await fetch(`${API_URL}/api/admin/site-settings`, {
        method: 'PUT',
        headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Kayıt başarısız');
      if (Array.isArray(data.staticPages)) renderMaPagesTable(data.staticPages);
      notify('Site ayarları kaydedildi', 'success');
      const upd = $('ma-site-updated');
      if (upd && data.updatedAt) upd.textContent = `Son güncelleme: ${maFormatDate(data.updatedAt)}`;
    } catch (e) {
      notify('Site kaydı hata: ' + e.message, 'error');
    }
  }

  function renderMaMapsTable(maps) {
    const tbody = $('ma-maps-table-body');
    if (!tbody) return;
    _maMapsCache = Array.isArray(maps) ? maps.map((m) => ({ ...m })) : [];
    tbody.innerHTML = _maMapsCache.map((m, i) => `
      <tr data-ma-map-idx="${i}" style="border-top:1px solid rgba(255,255,255,0.06);">
        <td style="padding:0.3rem;"><input class="room-input ma-map-name" value="${maEscape(m.name || '')}" style="min-width:7rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-map-slug" value="${maEscape(m.slug || '')}" style="min-width:7rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-map-desc" value="${maEscape(m.description || '')}" style="min-width:8rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-map-mode" value="${maEscape(m.mode || '')}" style="width:3rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;"><input class="room-input ma-map-seo" value="${maEscape(m.seo_title || '')}" style="min-width:8rem;padding:0.25rem 0.4rem;font-size:0.7rem;" /></td>
        <td style="padding:0.3rem;text-align:center;"><input type="checkbox" class="ma-map-play" ${m.playable !== false ? 'checked' : ''} /></td>
        <td style="padding:0.3rem;text-align:center;"><input type="checkbox" class="ma-map-sitemap" ${m.in_sitemap !== false ? 'checked' : ''} /></td>
        <td style="padding:0.3rem;text-align:center;"><input type="checkbox" class="ma-map-featured" ${m.featured ? 'checked' : ''} /></td>
        <td style="padding:0.3rem;"><button type="button" class="toolbar-btn danger ma-map-del" data-idx="${i}" style="padding:0.2rem 0.45rem;font-size:0.65rem;">Sil</button></td>
      </tr>
    `).join('');
    tbody.querySelectorAll('.ma-map-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        _maMapsCache.splice(idx, 1);
        renderMaMapsTable(_maMapsCache);
      });
    });
  }

  function collectMaMapsFromDom() {
    const tbody = $('ma-maps-table-body');
    if (!tbody) return _maMapsCache;
    return Array.from(tbody.querySelectorAll('tr[data-ma-map-idx]')).map((tr) => {
      const prev = _maMapsCache[parseInt(tr.dataset.maMapIdx, 10)] || {};
      return {
        ...prev,
        name: tr.querySelector('.ma-map-name')?.value?.trim() || '',
        slug: tr.querySelector('.ma-map-slug')?.value?.trim() || '',
        description: tr.querySelector('.ma-map-desc')?.value?.trim() || '',
        mode: tr.querySelector('.ma-map-mode')?.value?.trim() || 'de',
        seo_title: tr.querySelector('.ma-map-seo')?.value?.trim() || '',
        playable: !!tr.querySelector('.ma-map-play')?.checked,
        in_sitemap: !!tr.querySelector('.ma-map-sitemap')?.checked,
        featured: !!tr.querySelector('.ma-map-featured')?.checked,
      };
    }).filter((m) => m.name);
  }

  async function loadMaMaps() {
    try {
      const res = await fetch(`${API_URL}/api/admin/maps`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Yüklenemedi');
      renderMaMapsTable(data.maps || []);
    } catch (e) {
      notify('Harita kataloğu yüklenemedi: ' + e.message, 'error');
    }
  }

  async function saveMaMaps() {
    if (!adminToken) return;
    try {
      const maps = collectMaMapsFromDom();
      const res = await fetch(`${API_URL}/api/admin/maps`, {
        method: 'PUT',
        headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ maps }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Kayıt başarısız');
      renderMaMapsTable(data.maps || []);
      notify(`Harita kataloğu kaydedildi (${(data.maps || []).length})`, 'success');
    } catch (e) {
      notify('Harita kaydı hata: ' + e.message, 'error');
    }
  }

  async function regenerateMaSitemap() {
    if (!adminToken) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/sitemap/regenerate`, {
        method: 'POST',
        headers: maAdminHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Üretilemedi');
      _maSitemapXml = data.xml || '';
      const pre = $('ma-sitemap-preview');
      if (pre) {
        pre.style.display = 'block';
        pre.textContent = _maSitemapXml.slice(0, 4000) + (_maSitemapXml.length > 4000 ? '\n…' : '');
      }
      notify(`Sitemap hazır · ${data.urlCount || 0} URL`, 'success');
    } catch (e) {
      notify('Sitemap hata: ' + e.message, 'error');
    }
  }

  function maFormatTime(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch (_) {
      return '—';
    }
  }

  let _maVisitorCache = null;
  let _maVisitorTimer = null;
  let _maVisitorState = {
    range: 7,
    type: 'all',
    search: '',
    page: '',
    sortKey: 'ts',
    sortDir: 'desc',
    logPage: 0,
    pageSize: 25
  };

  function maVisitorTypeBadge(type) {
    const t = String(type || 'real');
    const label = t === 'ai' ? 'AI' : t === 'bot' ? 'BOT' : 'GERÇEK';
    return `<span class="ma-vis-badge" data-t="${maEscape(t)}">${label}</span>`;
  }

  function maSumStats(stats = {}) {
    return (stats.real || 0) + (stats.bot || 0) + (stats.ai || 0);
  }

  function maVisDeviceLabel(d) {
    const map = { desktop: 'Masaüstü', mobile: 'Mobil', tablet: 'Tablet', bot: 'Bot / Crawler' };
    return map[d] || d || '—';
  }

  function maVisFilterRows(rows, state = _maVisitorState) {
    const q = String(state.search || '').trim().toLowerCase();
    const type = state.type || 'all';
    const page = state.page || '';
    return (rows || []).filter((v) => {
      if (type !== 'all' && v.type !== type) return false;
      if (page && String(v.path || '') !== page) return false;
      if (!q) return true;
      const hay = [v.name, v.path, v.referrer, v.country, v.city, v.ip, v.ua, v.device]
        .map((x) => String(x || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }

  function maVisSortRows(rows, key = 'ts', dir = 'desc') {
    const mul = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av = a?.[key];
      let bv = b?.[key];
      if (key === 'ts') {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
        return (av - bv) * mul;
      }
      av = String(av ?? '').toLowerCase();
      bv = String(bv ?? '').toLowerCase();
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return 0;
    });
  }

  function maVisPickLists(data, range) {
    if (range >= 30) {
      return {
        paths: data.topPathsMonth || data.topPaths || [],
        refs: data.topReferrersMonth || data.topReferrers || [],
        countries: data.topCountriesMonth || data.topCountries || [],
        agents: data.botNamesMonth || data.botNamesWeek || [],
        periodLabel: '30 gün'
      };
    }
    if (range <= 1) {
      return {
        paths: data.topPaths || [],
        refs: data.topReferrers || [],
        countries: data.topCountries || [],
        agents: data.botNamesToday || data.botNamesWeek || [],
        periodLabel: 'bugün / hafta'
      };
    }
    return {
      paths: data.topPaths || [],
      refs: data.topReferrers || [],
      countries: data.topCountries || [],
      agents: data.botNamesWeek || [],
      periodLabel: '7 gün'
    };
  }

  function maVisSeriesForRange(series, range) {
    const list = Array.isArray(series) ? series : [];
    if (range >= 30) return list;
    return list.slice(-Math.max(1, range));
  }

  function renderVisBarChart(series, { height = 160, showTypes = true } = {}) {
    const rows = series || [];
    if (!rows.length) {
      return `<div class="ma-vis-empty">Zaman serisi verisi henüz yok.</div>`;
    }
    const w = 560;
    const h = height;
    const padL = 28;
    const padR = 8;
    const padT = 12;
    const padB = 28;
    const max = Math.max(1, ...rows.map((r) => r.total || ((r.real || 0) + (r.bot || 0) + (r.ai || 0))));
    const gap = 2;
    const innerW = w - padL - padR;
    const barW = Math.max(3, (innerW / rows.length) - gap);
    const chartH = h - padT - padB;

    const bars = rows.map((r, i) => {
      const total = r.total || ((r.real || 0) + (r.bot || 0) + (r.ai || 0));
      const x = padL + i * (barW + gap);
      const realH = showTypes ? (chartH * ((r.real || 0) / max)) : 0;
      const botH = showTypes ? (chartH * ((r.bot || 0) / max)) : 0;
      const aiH = showTypes ? (chartH * ((r.ai || 0) / max)) : 0;
      const totalH = chartH * (total / max);
      const yBase = padT + chartH;
      const label = r.date
        ? String(r.date).slice(5)
        : (r.hour != null ? `${r.hour}:00` : '');
      const title = r.date
        ? `${r.date}: ${total} (G:${r.real || 0} B:${r.bot || 0} AI:${r.ai || 0})`
        : `${r.hour}:00 → ${total}`;
      if (!showTypes) {
        return `<rect x="${x}" y="${yBase - totalH}" width="${barW}" height="${Math.max(totalH, 0)}" fill="rgba(240,160,0,0.75)" rx="1"><title>${maEscape(title)}</title></rect>`;
      }
      let y = yBase;
      const parts = [];
      if (realH > 0) {
        y -= realH;
        parts.push(`<rect x="${x}" y="${y}" width="${barW}" height="${realH}" fill="rgba(57,255,20,0.8)" rx="0"><title>${maEscape(title)}</title></rect>`);
      }
      if (botH > 0) {
        y -= botH;
        parts.push(`<rect x="${x}" y="${y}" width="${barW}" height="${botH}" fill="rgba(245,158,11,0.8)"><title>${maEscape(title)}</title></rect>`);
      }
      if (aiH > 0) {
        y -= aiH;
        parts.push(`<rect x="${x}" y="${y}" width="${barW}" height="${aiH}" fill="rgba(125,211,252,0.85)"><title>${maEscape(title)}</title></rect>`);
      }
      if (i === 0 || i === rows.length - 1 || i % Math.ceil(rows.length / 6) === 0) {
        parts.push(`<text x="${x + barW / 2}" y="${h - 8}" text-anchor="middle" fill="rgba(160,176,192,0.65)" font-size="9" font-family="var(--font-hud)">${maEscape(label)}</text>`);
      }
      return parts.join('');
    }).join('');

    const grid = [0.25, 0.5, 0.75, 1].map((p) => {
      const y = padT + chartH * (1 - p);
      return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="rgba(255,255,255,0.05)" /><text x="${padL - 4}" y="${y + 3}" text-anchor="end" fill="rgba(160,176,192,0.45)" font-size="8">${Math.round(max * p)}</text>`;
    }).join('');

    return `
      <svg class="ma-vis-chart-svg${height < 150 ? ' tall' : ''}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Ziyaretçi grafiği">
        ${grid}
        ${bars}
      </svg>
      <div class="ma-vis-legend">
        <span><i style="background:rgba(57,255,20,0.85)"></i>Gerçek</span>
        <span><i style="background:rgba(245,158,11,0.85)"></i>Bot</span>
        <span><i style="background:rgba(125,211,252,0.85)"></i>AI</span>
      </div>`;
  }

  function renderVisRankList(title, rows, emptyText, hint = '') {
    const max = Math.max(1, ...(rows || []).map((r) => Number(r.count) || 0));
    const body = !(rows || []).length
      ? `<div class="ma-vis-empty">${emptyText}</div>`
      : rows.map((r) => {
        const pct = Math.round(((Number(r.count) || 0) / max) * 100);
        return `
          <div class="ma-vis-rank-row" title="${maEscape(r.name)}">
            <span class="ma-vis-rank-name">${maEscape(r.name)}</span>
            <span class="ma-vis-rank-bar"><span class="ma-vis-rank-fill" style="width:${pct}%"></span></span>
            <span class="ma-vis-rank-count">${r.count}</span>
          </div>`;
      }).join('');
    return `
      <div class="ma-vis-panel">
        <div class="ma-vis-panel-head">
          <h4 class="ma-vis-panel-title">${title}</h4>
          ${hint ? `<span class="ma-vis-panel-hint">${hint}</span>` : ''}
        </div>
        ${body}
      </div>`;
  }

  function renderVisTable(title, rows, { emptyText, sortable = false, pager = null, hint = '' } = {}) {
    const headCols = [
      { key: 'ts', label: 'ZAMAN' },
      { key: 'type', label: 'TÜR' },
      { key: 'name', label: 'AJAN' },
      { key: 'device', label: 'CİHAZ' },
      { key: 'country', label: 'KONUM' },
      { key: 'path', label: 'SAYFA' },
      { key: 'referrer', label: 'KAYNAK' },
      { key: 'ip', label: 'IP' }
    ];
    if (!(rows || []).length) {
      return `
        <div class="ma-vis-table-wrap">
          <div class="ma-vis-panel-head">
            <h4 class="ma-vis-panel-title">${title}</h4>
            ${hint ? `<span class="ma-vis-panel-hint">${hint}</span>` : ''}
          </div>
          <div style="padding:0.85rem;"><div class="ma-vis-empty">${emptyText}</div></div>
        </div>`;
    }
    const th = headCols.map((c) => {
      if (!sortable) return `<th>${c.label}</th>`;
      const active = _maVisitorState.sortKey === c.key;
      const arrow = active ? (_maVisitorState.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      return `<th class="ma-vis-sortable" data-vis-sort="${c.key}">${c.label}${arrow}</th>`;
    }).join('');

    const trs = rows.map((v) => `
      <tr title="${maEscape(v.ua || '')}">
        <td class="ma-vis-mono">${maEscape(maFormatTime(v.ts))}</td>
        <td>${maVisitorTypeBadge(v.type)}</td>
        <td style="color:var(--text-bright);max-width:140px;overflow:hidden;text-overflow:ellipsis;">${maEscape(v.name || '?')}</td>
        <td>${maEscape(maVisDeviceLabel(v.device))}</td>
        <td>${maEscape([v.country, v.city].filter(Boolean).join(' · ') || '??')}</td>
        <td style="color:var(--cs-yellow);">${maEscape(v.path || '/')}</td>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;">${maEscape(v.referrer || '—')}</td>
        <td class="ma-vis-mono">${maEscape(v.ip || '—')}</td>
      </tr>`).join('');

    const pagerHtml = pager ? `
      <div class="ma-vis-pager">
        <span>${pager.label}</span>
        <div class="ma-vis-pager-btns">
          <button type="button" data-vis-page="prev" ${pager.page <= 0 ? 'disabled' : ''}>ÖNCEKİ</button>
          <button type="button" data-vis-page="next" ${pager.page >= pager.pages - 1 ? 'disabled' : ''}>SONRAKİ</button>
        </div>
      </div>` : '';

    return `
      <div class="ma-vis-table-wrap">
        <div class="ma-vis-panel-head">
          <h4 class="ma-vis-panel-title">${title} <span style="color:var(--text-dim);font-size:0.65rem;">(${rows.length}${pager ? ` / ${pager.total}` : ''})</span></h4>
          ${hint ? `<span class="ma-vis-panel-hint">${hint}</span>` : ''}
        </div>
        <div class="ma-vis-table-scroll${sortable ? ' tall' : ''}">
          <table class="ma-table" style="font-size:0.68rem;">
            <thead><tr>${th}</tr></thead>
            <tbody>${trs}</tbody>
          </table>
        </div>
        ${pagerHtml}
      </div>`;
  }

  function renderVisitorDetails(data) {
    const state = _maVisitorState;
    const range = Number(state.range) || 7;
    const active = data.active || {};
    const daily = data.daily || {};
    const weekly = data.weekly || {};
    const monthly = data.monthly || {};
    const totals = data.totals || {};
    const liveTotal = totals.live ?? maSumStats(active);
    const lists = maVisPickLists(data, range);
    const series = maVisSeriesForRange(data.series || [], range);
    const nowLabel = new Date(data.generatedAt || Date.now()).toLocaleString('tr-TR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const periodStats = range <= 1 ? daily : range <= 7 ? weekly : monthly;
    const periodTotal = maSumStats(periodStats);
    const realPct = periodTotal > 0 ? Math.round(((periodStats.real || 0) / periodTotal) * 100) : 0;
    const topCountry = (lists.countries[0] && lists.countries[0].name) || '—';

    const devices = (data.topDevices || []).map((d) => ({
      name: maVisDeviceLabel(d.name),
      count: d.count
    }));
    const browsers = data.topBrowsers || data.topAgentsWeek || [];

    const liveFiltered = maVisFilterRows(data.activeList || [], state);
    const recentFiltered = maVisSortRows(
      maVisFilterRows(data.recent || [], state),
      state.sortKey,
      state.sortDir
    );
    const pageSize = state.pageSize || 25;
    const pages = Math.max(1, Math.ceil(recentFiltered.length / pageSize));
    if (state.logPage >= pages) state.logPage = Math.max(0, pages - 1);
    const pageRows = recentFiltered.slice(state.logPage * pageSize, (state.logPage + 1) * pageSize);

    return `
      <section class="ma-vis-hero">
        <div class="ma-vis-hero-inner">
          <div>
            <p class="ma-vis-kicker">BROWSERCS · TRAFİK ANALİTİĞİ</p>
            <h3 class="ma-vis-h1">ZİYARETÇİ TAKİP KONSOLU</h3>
            <p class="ma-vis-sub">Benzersiz ziyaretçi (IP/gün), canlı oturumlar (5 dk) ve kaynak dağılımı. Son güncelleme: ${maEscape(nowLabel)}</p>
          </div>
          <div class="ma-dash-pulse" title="Son 5 dakikadaki aktif oturum">
            <span class="ma-dash-pulse-dot" aria-hidden="true"></span>
            <div>
              <div class="ma-dash-pulse-label">ŞU AN AKTİF</div>
              <div class="ma-dash-pulse-value">${liveTotal}</div>
            </div>
          </div>
        </div>
      </section>

      <div class="ma-vis-kpi">
        ${metricCard({ label: 'CANLI', value: liveTotal, tone: 'green', foot: `G ${active.real || 0} · B ${active.bot || 0} · AI ${active.ai || 0}` })}
        ${metricCard({ label: 'BUGÜN', value: totals.today ?? maSumStats(daily), tone: 'yellow', foot: `Gerçek ${daily.real || 0}` })}
        ${metricCard({ label: '7 GÜN', value: totals.week ?? maSumStats(weekly), tone: 'blue', foot: `Gerçek ${weekly.real || 0}` })}
        ${metricCard({ label: '30 GÜN', value: totals.month ?? maSumStats(monthly), tone: 'yellow', foot: `Gerçek payı %${totals.realShare ?? realPct}` })}
        ${metricCard({ label: 'GERÇEK ORANI', value: `%${realPct}`, tone: realPct >= 40 ? 'green' : 'muted', foot: `Seçili aralık · ${periodTotal} tekil` })}
        ${metricCard({ label: '1. ÜLKE', value: topCountry, tone: 'muted', foot: lists.periodLabel })}
      </div>

      <div class="ma-vis-charts">
        <div class="ma-vis-panel">
          <div class="ma-vis-panel-head">
            <h4 class="ma-vis-panel-title">GÜNLÜK ZİYARET SERİSİ</h4>
            <span class="ma-vis-panel-hint">Son ${range} gün · benzersiz IP</span>
          </div>
          ${renderVisBarChart(series)}
        </div>
        <div class="ma-vis-panel">
          <div class="ma-vis-panel-head">
            <h4 class="ma-vis-panel-title">SAATLİK AKTİVİTE</h4>
            <span class="ma-vis-panel-hint">Son 24 saat · TR saati</span>
          </div>
          ${renderVisBarChart(data.hourly || [], { height: 140 })}
        </div>
      </div>

      <div class="ma-vis-grid4">
        ${renderVisRankList('SAYFALAR', lists.paths, 'Sayfa kaydı yok.', lists.periodLabel)}
        ${renderVisRankList('KAYNAKLAR', lists.refs, 'Referrer kaydı yok.', lists.periodLabel)}
        ${renderVisRankList('ÜLKELER', lists.countries, 'Ülke kaydı yok.', lists.periodLabel)}
        ${renderVisRankList('AJANLAR / BOTLAR', lists.agents, 'Ajan kaydı yok.', lists.periodLabel)}
        ${renderVisRankList('CİHAZLAR', devices, 'Cihaz verisi birikiyor…', 'KV + canlı')}
        ${renderVisRankList('TARAYICI / AJAN (SON)', browsers, 'Henüz örnek yok.', 'recent')}
      </div>

      <div class="ma-vis-split">
        ${renderVisTable('CANLI OTURUMLAR', liveFiltered, {
          emptyText: 'Şu an aktif ziyaretçi yok. Yeni girişler burada görünür.',
          hint: 'Son 5 dakika'
        })}
        ${renderVisTable('SON AKTİVİTE', (data.recent || []).slice(0, 12), {
          emptyText: 'Henüz detaylı kayıt yok.',
          hint: 'En son 12 olay'
        })}
      </div>

      ${renderVisTable('ZİYARETÇİ GÜNLÜĞÜ', pageRows, {
        emptyText: 'Filtreyle eşleşen kayıt yok.',
        sortable: true,
        hint: 'Sırala · sayfala · filtrele',
        pager: {
          page: state.logPage,
          pages,
          total: recentFiltered.length,
          label: `Sayfa ${state.logPage + 1} / ${pages} · ${recentFiltered.length} kayıt`
        }
      })}
    `;
  }

  function bindVisitorDashboardEvents(root) {
    if (!root) return;
    root.querySelectorAll('[data-vis-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-vis-sort');
        if (!key) return;
        if (_maVisitorState.sortKey === key) {
          _maVisitorState.sortDir = _maVisitorState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          _maVisitorState.sortKey = key;
          _maVisitorState.sortDir = key === 'ts' ? 'desc' : 'asc';
        }
        if (_maVisitorCache) root.innerHTML = renderVisitorDetails(_maVisitorCache);
        bindVisitorDashboardEvents(root);
      });
    });
    root.querySelectorAll('[data-vis-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = btn.getAttribute('data-vis-page');
        if (dir === 'prev') _maVisitorState.logPage = Math.max(0, _maVisitorState.logPage - 1);
        if (dir === 'next') _maVisitorState.logPage += 1;
        if (_maVisitorCache) root.innerHTML = renderVisitorDetails(_maVisitorCache);
        bindVisitorDashboardEvents(root);
      });
    });
  }

  function syncVisitorPageFilterOptions(data) {
    const sel = $('ma-vis-page');
    if (!sel) return;
    const paths = new Set();
    (data.topPathsMonth || data.topPaths || []).forEach((p) => { if (p?.name) paths.add(p.name); });
    (data.recent || []).forEach((r) => { if (r?.path) paths.add(r.path); });
    (data.activeList || []).forEach((r) => { if (r?.path) paths.add(r.path); });
    const current = _maVisitorState.page || sel.value || '';
    const opts = ['<option value="">Tüm sayfalar</option>']
      .concat([...paths].sort().map((p) =>
        `<option value="${maEscape(p)}"${p === current ? ' selected' : ''}>${maEscape(p)}</option>`
      ));
    sel.innerHTML = opts.join('');
  }

  function readVisitorFiltersFromDom() {
    const rangeEl = $('ma-vis-range');
    const typeEl = $('ma-vis-type');
    const searchEl = $('ma-vis-search');
    const pageEl = $('ma-vis-page');
    if (rangeEl) _maVisitorState.range = parseInt(rangeEl.value, 10) || 7;
    if (typeEl) _maVisitorState.type = typeEl.value || 'all';
    if (searchEl) _maVisitorState.search = searchEl.value || '';
    if (pageEl) _maVisitorState.page = pageEl.value || '';
  }

  function rerenderVisitorDetails() {
    const statsEl = $('admin-visitor-stats');
    if (!statsEl || !_maVisitorCache) return;
    readVisitorFiltersFromDom();
    statsEl.innerHTML = renderVisitorDetails(_maVisitorCache);
    bindVisitorDashboardEvents(statsEl);
  }

  function stopVisitorAutoRefresh() {
    if (_maVisitorTimer) {
      clearInterval(_maVisitorTimer);
      _maVisitorTimer = null;
    }
  }

  function startVisitorAutoRefresh() {
    stopVisitorAutoRefresh();
    const box = $('ma-vis-autorefresh');
    if (!box?.checked) return;
    _maVisitorTimer = setInterval(() => {
      if (_maCurrentView === 'visitors' && box.checked) {
        loadAdminVisitorStats({ silent: true });
      }
    }, 30000);
  }

  async function loadAdminVisitorStats({ silent = false } = {}) {
    const statsEl = $('admin-visitor-stats');
    if (!adminToken) {
      if (statsEl) statsEl.innerHTML = '<div class="ma-vis-error">Admin girişi gerekli.</div>';
      return null;
    }
    if (statsEl && _maCurrentView === 'visitors' && !silent) {
      statsEl.innerHTML = '<div class="ma-vis-loading">Trafik analitikleri yükleniyor…</div>';
    }
    try {
      const res = await fetch(`/api/admin/visitor-stats`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API hatası');
      _maVisitorCache = data;
      syncVisitorPageFilterOptions(data);
      if (statsEl && _maCurrentView === 'visitors') {
        readVisitorFiltersFromDom();
        statsEl.innerHTML = renderVisitorDetails(data);
        bindVisitorDashboardEvents(statsEl);
        startVisitorAutoRefresh();
      }
      return data;
    } catch (e) {
      if (statsEl && _maCurrentView === 'visitors') {
        statsEl.innerHTML = `<div class="ma-vis-error">Hata: ${maEscape(e.message)}</div>`;
      }
      return null;
    }
  }

  function metricCard({ label, value, tone = 'yellow', foot = '' }) {
    return `
      <div class="ma-metric" data-tone="${maEscape(tone)}">
        <div class="ma-metric-label">${maEscape(label)}</div>
        <div class="ma-metric-value">${value ?? 0}</div>
        ${foot ? `<div class="ma-metric-foot">${maEscape(foot)}</div>` : ''}
      </div>`;
  }

  function trafficCard(title, stats) {
    const total = (stats.real || 0) + (stats.bot || 0) + (stats.ai || 0);
    return `
      <div class="ma-traffic-card">
        <div class="t-label">${maEscape(title)}</div>
        <div class="t-value">${total}</div>
        <div class="t-split">
          <span>Gerçek <b>${stats.real || 0}</b></span>
          <span>Bot <b>${stats.bot || 0}</b></span>
          <span>AI <b>${stats.ai || 0}</b></span>
        </div>
      </div>`;
  }

  function renderDashboard({ overview = {}, visitors = null, error = '' } = {}) {
    const root = $('ma-dashboard-root');
    if (!root) return;
    if (error) {
      root.innerHTML = `<div class="ma-dash-error">${maEscape(error)}</div>`;
      return;
    }

    const o = overview;
    const offline = Math.max(0, (o.totalContainers || 0) - (o.activeServers || 0));
    const pending = o.pendingOrders || 0;
    const v = visitors || {};
    const active = v.active || { real: 0, bot: 0, ai: 0 };
    const daily = v.daily || { real: 0, bot: 0, ai: 0 };
    const weekly = v.weekly || { real: 0, bot: 0, ai: 0 };
    const monthly = v.monthly || { real: 0, bot: 0, ai: 0 };
    const liveTotal = (active.real || 0) + (active.bot || 0) + (active.ai || 0);
    const nowLabel = new Date().toLocaleString('tr-TR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    root.innerHTML = `
      <section class="ma-dash-hero">
        <div class="ma-dash-hero-inner">
          <div>
            <p class="ma-dash-kicker">BROWSERCS · CSADMIN</p>
            <h2 class="ma-dash-title">GENEL BAKIŞ</h2>
            <p class="ma-dash-sub">Filo, platform ve site trafiği tek ekranda. Son güncelleme: ${maEscape(nowLabel)}</p>
          </div>
          <div class="ma-dash-pulse" title="Son 5 dakikadaki benzersiz ziyaretçi">
            <span class="ma-dash-pulse-dot" aria-hidden="true"></span>
            <div>
              <div class="ma-dash-pulse-label">CANLI TRAFİK</div>
              <div class="ma-dash-pulse-value">${liveTotal}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="ma-dash-section">
        <div class="ma-dash-section-head">
          <h3 class="ma-dash-section-title">FİLO</h3>
          <span class="ma-dash-section-hint">Docker / oyun sunucuları</span>
        </div>
        <div class="ma-dash-grid">
          ${metricCard({ label: 'AKTİF SUNUCU', value: o.activeServers ?? 0, tone: 'green', foot: 'Çalışan container' })}
          ${metricCard({ label: 'GERÇEK OYUNCU', value: o.realPlayers ?? 0, tone: 'green', foot: `Toplam slot: ${o.totalPlayers ?? 0}` })}
          ${metricCard({ label: 'BOT OYUNCU', value: o.botPlayers ?? 0, tone: 'yellow', foot: 'YaPB / ping=Bot' })}
          ${metricCard({ label: 'TOPLAM CONTAINER', value: o.totalContainers ?? 0, tone: 'blue', foot: offline ? `${offline} kapalı / durmuş` : 'Hepsi ayakta' })}
          ${metricCard({ label: 'DB SUNUCU', value: o.dbServersCount ?? 0, tone: 'muted', foot: 'purchased_servers' })}
        </div>
      </section>

      <section class="ma-dash-section">
        <div class="ma-dash-section-head">
          <h3 class="ma-dash-section-title">PLATFORM</h3>
          <span class="ma-dash-section-hint">Hesaplar ve siparişler</span>
        </div>
        <div class="ma-dash-grid">
          ${metricCard({ label: 'KULLANICI', value: o.usersCount ?? 0, tone: 'yellow', foot: 'Kayıtlı profil' })}
          ${metricCard({ label: 'BEKLEYEN ÖDEME', value: pending, tone: pending > 0 ? 'red' : 'muted', foot: pending > 0 ? 'Onay bekliyor' : 'Kuyruk boş' })}
          ${metricCard({ label: 'SİTE ADMİN', value: o.adminProfiles ?? 0, tone: 'blue', foot: 'role = admin' })}
        </div>
      </section>

      <section class="ma-dash-section">
        <div class="ma-dash-section-head">
          <h3 class="ma-dash-section-title">TRAFİK</h3>
          <span class="ma-dash-section-hint">Gerçek · Bot · AI ayrımı</span>
        </div>
        <div class="ma-traffic">
          ${trafficCard('CANLI (5 DK)', active)}
          ${trafficCard('BUGÜN', daily)}
          ${trafficCard('BU HAFTA', weekly)}
          ${trafficCard('BU AY', monthly)}
        </div>
      </section>

      <section class="ma-dash-section">
        <div class="ma-dash-section-head">
          <h3 class="ma-dash-section-title">HIZLI GEÇİŞ</h3>
        </div>
        <div class="ma-dash-actions">
          <button type="button" class="ma-dash-action" data-ma-jump="servers">Sunucular</button>
          <button type="button" class="ma-dash-action" data-ma-jump="orders" ${pending > 0 ? 'data-warn="1"' : ''}>Siparişler${pending > 0 ? ` (${pending})` : ''}</button>
          <button type="button" class="ma-dash-action" data-ma-jump="visitors">Ziyaretçi detayı</button>
          <button type="button" class="ma-dash-action" data-ma-jump="users">Kullanıcılar</button>
        </div>
      </section>
    `;

    root.querySelectorAll('[data-ma-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.getAttribute('data-ma-jump');
        if (view) setMasterAdminView(view);
      });
    });
  }

  async function loadAdminOverview() {
    const root = $('ma-dashboard-root');
    if (root) root.innerHTML = '<div class="ma-dash-loading">Filo ve trafik yükleniyor...</div>';
    try {
      const [overviewRes, visitorData] = await Promise.all([
        fetch(`${API_URL}/api/admin/overview`, { headers: maAdminHeaders() }).then((r) => r.json()),
        loadAdminVisitorStats({ silent: true })
      ]);
      if (!overviewRes.success) throw new Error(overviewRes.error || 'API hatası');
      renderDashboard({
        overview: overviewRes.overview || {},
        visitors: visitorData
      });
    } catch (e) {
      renderDashboard({ error: `Overview hatası: ${e.message}` });
    }
  }

  function renderAdminServersTable(servers) {
    const body = masterAdminTableBody;
    if (!body) return;
    const q = (($('ma-servers-filter')?.value) || '').trim().toLowerCase();
    const filtered = !q ? servers : servers.filter(s =>
      [s.name, s.port, s.owner_username, s.owner_id, s.map, s.status]
        .some(v => String(v || '').toLowerCase().includes(q))
    );
    if (!filtered.length) {
      body.innerHTML = '<tr><td colspan="10" style="padding:1rem;text-align:center;color:var(--text-dim);">Kayıt yok.</td></tr>';
      return;
    }
    body.innerHTML = filtered.map(s => {
      const settingsId = s.serverId || s.id;
      const actionId = s.containerId || s.serverId || s.id;
      const deleteId = s.serverId || s.containerId || s.id;
      const stateLabel = s.state === 'running' ? 'ÇALIŞIYOR' : 'KAPALI';
      const expired = s.expires_at && new Date(s.expires_at) < new Date();
      return `<tr style="${s.state === 'running' ? '' : 'opacity:0.72;'}">
      <td style="font-weight:bold;color:var(--text-bright);max-width:160px;overflow:hidden;text-overflow:ellipsis;">${maEscape(s.name)}</td>
      <td><span style="background:${s.isOfficial ? 'rgba(33,150,243,0.1)' : 'rgba(255,152,0,0.1)'};color:${s.isOfficial ? '#2196f3' : '#ff9800'};padding:2px 6px;border-radius:3px;font-size:0.65rem;">${s.isOfficial ? 'RESMİ' : 'OYUNCU'}</span></td>
      <td><span style="color:${s.state === 'running' ? 'var(--cs-green)' : 'var(--cs-red)'};font-weight:700;">${maEscape(stateLabel)}</span></td>
      <td style="color:var(--cs-yellow);">${maEscape(s.map || '?')}</td>
      <td title="Gerçek: ${s.realPlayers ?? 0} · Bot: ${s.botPlayers ?? 0} · Toplam: ${s.players ?? 0}">
        <span style="color:var(--cs-green);font-weight:700;">${s.realPlayers ?? 0}</span>
        <span style="color:var(--text-dim);">+</span>
        <span style="color:#f59e0b;font-weight:700;">${s.botPlayers ?? 0}</span>
        <span style="color:var(--text-dim);font-size:0.7rem;"> / ${s.maxplayers ?? '?'}</span>
      </td>
      <td>${maEscape(s.port || '—')}</td>
      <td title="${maEscape(s.owner_id || '')}">${maEscape(s.owner_username || (s.owner_id ? String(s.owner_id).slice(0, 8) + '…' : '—'))}</td>
      <td style="color:var(--text-dim);">${maFormatDate(s.created_at)}</td>
      <td style="color:${expired ? 'var(--cs-red)' : 'var(--text-dim)'};">${maFormatDate(s.expires_at)}</td>
      <td style="white-space:nowrap;">
        <button class="toolbar-btn" style="border-color:var(--cs-green);color:var(--cs-green);padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="window.openServerSettings('${maEscape(settingsId)}')">AYAR</button>
        ${s.state === 'running'
          ? `<button class="toolbar-btn" style="border-color:#f87171;color:#f87171;padding:0.25rem 0.45rem;font-size:0.65rem;" title="Sunucuyu kapat" onclick="masterAdminAction('stop','${maEscape(actionId)}')">KAPAT</button>`
          : `<button class="toolbar-btn" style="border-color:#4ade80;color:#4ade80;padding:0.25rem 0.45rem;font-size:0.65rem;" title="Sunucuyu aç" onclick="masterAdminAction('start','${maEscape(actionId)}')">AÇ</button>`}
        <button class="toolbar-btn" style="border-color:#60a5fa;color:#60a5fa;padding:0.25rem 0.4rem;font-size:0.65rem;" title="Bot ekle" onclick="masterAdminBots('${maEscape(actionId)}','add')" ${s.state === 'running' ? '' : 'disabled'}>+BOT</button>
        <button class="toolbar-btn" style="border-color:#f59e0b;color:#f59e0b;padding:0.25rem 0.4rem;font-size:0.65rem;" title="Bot çıkar" onclick="masterAdminBots('${maEscape(actionId)}','remove')" ${s.state === 'running' ? '' : 'disabled'}>-BOT</button>
        <button class="toolbar-btn" style="border-color:var(--cs-yellow);color:var(--cs-yellow);padding:0.25rem 0.45rem;font-size:0.65rem;" title="Sunucuyu yeniden başlat" onclick="masterAdminAction('restart','${maEscape(actionId)}')" ${s.state === 'running' ? '' : 'disabled'}>YENİDEN BAŞLAT</button>
        <button class="toolbar-btn" style="padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="masterAdminExtend('${maEscape(s.serverId || '')}')" ${s.serverId ? '' : 'disabled'}>+30G</button>
        <button class="toolbar-btn danger" style="padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="masterAdminAction('delete','${maEscape(deleteId)}')">SİL</button>
      </td>
    </tr>`;
    }).join('');
  }

  async function loadAdminServers() {
    if (!masterAdminTableBody) return;
    masterAdminTableBody.innerHTML = '<tr><td colspan="10" style="padding:1rem;text-align:center;">Yükleniyor...</td></tr>';
    try {
      let res = await fetch(`${API_URL}/api/admin/servers`, { headers: maAdminHeaders() });
      let data = await res.json();
      if (!data.success) {
        res = await fetch(`${API_URL}/api/servers`);
        data = await res.json();
      }
      if (!data.success) throw new Error(data.error || 'API hatası');
      _maServersCache = data.servers || [];
      renderAdminServersTable(_maServersCache);
    } catch (e) {
      masterAdminTableBody.innerHTML = `<tr><td colspan="10" style="padding:1rem;text-align:center;color:var(--cs-red);">${maEscape(e.message)}</td></tr>`;
    }
  }

  async function loadAdminRentalOrders() {
    const listEl = $('admin-rental-orders-list');
    if (!listEl) return;
    if (!adminToken) {
      listEl.innerHTML = '<div style="color:var(--cs-red);font-size:0.75rem;">Admin girişi gerekli.</div>';
      return;
    }
    listEl.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;">Yükleniyor...</div>';
    try {
      const status = $('ma-orders-status')?.value;
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const res = await fetch(`${API_URL}/api/admin/rental-orders${qs}`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API hatası');
      const orders = data.orders || [];
      if (!orders.length) {
        listEl.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;font-family:var(--font-ui);">Sipariş yok.</div>';
        return;
      }
      listEl.innerHTML = orders.map(o => {
        const canAct = ['pending_payment', 'paid', 'failed'].includes(o.status);
        return `<div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:0.75rem;">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;margin-bottom:0.35rem;">
          <div style="font-family:var(--font-hud);color:var(--cs-yellow);font-size:0.85rem;">${maEscape(o.order_code || o.id)}</div>
          <div style="font-size:0.65rem;color:var(--text-dim);">${maEscape(o.status)}</div>
        </div>
        <div style="font-family:var(--font-ui);font-size:0.7rem;color:var(--text-dim);line-height:1.5;margin-bottom:0.35rem;">
          ${maEscape(o.server_name || '?')} · ${maEscape(o.map || '?')} · ${o.amount_try || 350} ₺ · max ${o.max_players || 16}
        </div>
        <div style="font-family:var(--font-ui);font-size:0.65rem;color:var(--text-dim);margin-bottom:0.35rem;word-break:break-all;">
          Owner: ${maEscape(o.owner_id || '?')} · ${maFormatDate(o.created_at)}
        </div>
        ${o.admin_note ? `<div style="font-size:0.65rem;color:var(--cs-yellow);margin-bottom:0.5rem;">Not: ${maEscape(o.admin_note)}</div>` : ''}
        ${canAct ? `<div style="display:flex;gap:0.4rem;">
          <button class="toolbar-btn" style="flex:1;border-color:var(--cs-green);color:var(--cs-green);padding:0.4rem;font-size:0.7rem;" onclick="adminRentalOrderAction('approve','${maEscape(o.id)}')">ONAYLA</button>
          <button class="toolbar-btn danger" style="flex:1;padding:0.4rem;font-size:0.7rem;" onclick="adminRentalOrderAction('reject','${maEscape(o.id)}')">REDDET</button>
        </div>` : ''}
      </div>`;
      }).join('');
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--cs-red);font-size:0.75rem;">Siparişler yüklenemedi: ${maEscape(e.message)}</div>`;
    }
  }

  window.adminRentalOrderAction = async function (action, id) {
    if (!adminToken) return notify('Yetkisiz işlem!', 'error');
    const label = action === 'approve' ? 'onaylamak' : 'reddetmek';
    if (!await window.customConfirm(`Bu siparişi ${label} istediğine emin misin?`, 'ONAY')) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/rental-orders/${id}/${action}`, {
        method: 'POST',
        headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.success) {
        notify(action === 'approve' ? 'Sipariş onaylandı, sunucu kuruluyor.' : 'Sipariş reddedildi.', 'success');
        loadAdminRentalOrders();
        loadAdminOverview();
        if (window.loadServerList) window.loadServerList();
      } else {
        notify((action === 'approve' ? 'Onay' : 'Red') + ' başarısız: ' + (data.error || '?'), 'error');
      }
    } catch (e) {
      notify('Bağlantı hatası: ' + e.message, 'error');
    }
  };

  function maUserVipCell(u) {
    const tier = String(u.vip_tier || 'none').toLowerCase();
    if (u.vip_active) {
      return `<span class="ma-vip-tier ${maEscape(tier)}">${maEscape(maVipTierLabel(tier))}</span>` +
        (u.vip_days_left != null ? ` <span style="font-size:0.58rem;color:var(--text-dim);">${u.vip_days_left}g</span>` : '');
    }
    if ((u.role || '') === 'vip' && tier === 'none') {
      return `<span class="ma-vip-tier legacy" title="Eski rol=vip, abonelik paketi yok">rol:vip · paket yok</span>`;
    }
    return `<span class="ma-vip-tier none">Yok</span>`;
  }

  async function loadAdminUsers(q = '') {
    const body = $('ma-users-table-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="8" style="padding:1rem;text-align:center;">Yükleniyor...</td></tr>';
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await fetch(`${API_URL}/api/admin/users${qs}`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API hatası');
      const users = data.users || [];
      _maUsersCache = users;
      if (!users.length) {
        body.innerHTML = '<tr><td colspan="8" style="padding:1rem;text-align:center;color:var(--text-dim);">Kullanıcı yok.</td></tr>';
        return;
      }
      body.innerHTML = users.map((u) => {
        const banned = !!u.is_banned;
        return `<tr>
        <td style="color:var(--text-bright);font-weight:bold;">${maEscape(u.username || '—')}<div style="font-size:0.58rem;color:var(--text-dim);font-weight:normal;">${maEscape(u.id)}</div></td>
        <td>${maUserVipCell(u)}</td>
        <td style="color:var(--text-dim);">${u.vip_active ? maFormatDate(u.vip_expires_at) : '—'}</td>
        <td style="color:var(--text-dim);">${maEscape(u.role || 'user')}</td>
        <td>${banned
          ? `<span class="ma-ban-badge" title="${maEscape(u.ban_reason || '')}">YASAKLI</span>`
          : `<span class="ma-ok-badge">aktif</span>`}</td>
        <td>${Number(u.wallet_balance || 0)}</td>
        <td>${u.servers_count || 0}</td>
        <td><div class="ma-user-actions">
          <button class="toolbar-btn" style="padding:0.22rem 0.4rem;font-size:0.62rem;border-color:var(--cs-green);color:var(--cs-green);" onclick="masterAdminEditUser('${maEscape(u.id)}')">DÜZENLE</button>
          <button class="toolbar-btn" style="padding:0.22rem 0.4rem;font-size:0.62rem;border-color:var(--cs-yellow);color:var(--cs-yellow);" onclick="masterAdminToggleBan('${maEscape(u.id)}')">${banned ? 'AÇ' : 'BAN'}</button>
          <button class="toolbar-btn danger" style="padding:0.22rem 0.4rem;font-size:0.62rem;" onclick="masterAdminDeleteUser('${maEscape(u.id)}')">SİL</button>
        </div></td>
      </tr>`;
      }).join('');
    } catch (e) {
      body.innerHTML = `<tr><td colspan="8" style="padding:1rem;text-align:center;color:var(--cs-red);">${maEscape(e.message)}</td></tr>`;
    }
  }

  function maCloseUserEditModal() {
    const modal = $('ma-user-edit-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function maToLocalInput(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (_) { return ''; }
  }

  window.masterAdminEditUser = function (userId) {
    if (!adminToken || !userId) return;
    const u = _maUsersCache.find((x) => x.id === userId);
    if (!u) return notify('Kullanıcı bulunamadı — yenile', 'error');
    const modal = $('ma-user-edit-modal');
    if (!modal) return notify('Düzenleme formu yok', 'error');
    $('ma-edit-user-id').value = u.id;
    $('ma-edit-username').value = u.username || '';
    $('ma-edit-role').value = u.role || 'user';
    $('ma-edit-wallet').value = Number(u.wallet_balance || 0);
    $('ma-edit-premium').checked = !!u.is_premium;
    $('ma-edit-vip-tier').value = u.vip_active ? (u.vip_tier || 'none') : (u.vip_tier === 'none' || !u.vip_tier ? 'none' : u.vip_tier);
    if (!u.vip_active && u.vip_tier && u.vip_tier !== 'none') {
      $('ma-edit-vip-tier').value = u.vip_tier;
    }
    $('ma-edit-vip-days').value = '30';
    $('ma-edit-vip-expires').value = maToLocalInput(u.vip_expires_at);
    $('ma-edit-vip-notes').value = u.vip_notes || '';
    $('ma-edit-admin-notes').value = u.admin_notes || '';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
  };

  async function maSaveUserEdit() {
    if (!adminToken) return notify('Yetkisiz!', 'error');
    const id = $('ma-edit-user-id')?.value;
    if (!id) return;
    const vip_tier = $('ma-edit-vip-tier')?.value || 'none';
    const body = {
      username: ($('ma-edit-username')?.value || '').trim(),
      role: $('ma-edit-role')?.value || 'user',
      wallet_balance: Number($('ma-edit-wallet')?.value || 0),
      is_premium: !!$('ma-edit-premium')?.checked,
      vip_tier,
      vip_notes: ($('ma-edit-vip-notes')?.value || '').trim() || null,
      admin_notes: ($('ma-edit-admin-notes')?.value || '').trim() || null,
    };
    const expiresLocal = $('ma-edit-vip-expires')?.value;
    if (vip_tier !== 'none') {
      if (expiresLocal) {
        body.vip_expires_at = new Date(expiresLocal).toISOString();
      } else {
        body.vip_days = parseInt($('ma-edit-vip-days')?.value, 10) || 30;
      }
    }
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Hata');
      notify(
        vip_tier === 'none'
          ? 'Kullanıcı kaydedildi (VIP yok)'
          : `Kaydedildi → ${maVipTierLabel(vip_tier)}`,
        'success'
      );
      maCloseUserEditModal();
      loadAdminUsers(($('ma-users-search')?.value || '').trim());
      if (_maCurrentView === 'users') loadAdminVip();
    } catch (e) {
      notify('Kayıt hatası: ' + e.message, 'error');
    }
  }

  window.masterAdminToggleBan = async function (userId) {
    if (!adminToken || !userId) return;
    const u = _maUsersCache.find((x) => x.id === userId);
    if (!u) return;
    if (u.is_banned) {
      if (!await window.customConfirm(`${u.username || 'Kullanıcı'} yasağı kaldırılsın mı?`, 'YASAĞI KALDIR')) return;
      try {
        const res = await fetch(`${API_URL}/api/admin/users/${userId}/unban`, {
          method: 'POST',
          headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
          body: '{}',
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Hata');
        notify('Yasak kaldırıldı', 'success');
        loadAdminUsers(($('ma-users-search')?.value || '').trim());
      } catch (e) {
        notify('Unban hatası: ' + e.message, 'error');
      }
      return;
    }
    const daysStr = await window.customPrompt(
      'Kaç gün yasak? (boş = kalıcı)',
      '7',
      'BAN SÜRESİ'
    );
    if (daysStr === null) return;
    const reason = await window.customPrompt('Ban nedeni (kullanıcıya gösterilir)', 'Kurallara aykırı davranış', 'BAN NEDENİ');
    if (reason === null) return;
    const permanent = !String(daysStr || '').trim();
    const days = permanent ? undefined : Math.max(1, parseInt(daysStr, 10) || 7);
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${userId}/ban`, {
        method: 'POST',
        headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ permanent, days, reason: reason || 'Yönetici tarafından yasaklandı' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Hata');
      notify(permanent ? 'Kalıcı ban uygulandı' : `${days} gün ban`, 'success');
      loadAdminUsers(($('ma-users-search')?.value || '').trim());
    } catch (e) {
      notify('Ban hatası: ' + e.message, 'error');
    }
  };

  window.masterAdminDeleteUser = async function (userId) {
    if (!adminToken || !userId) return;
    const u = _maUsersCache.find((x) => x.id === userId);
    const name = u?.username || userId;
    if (!await window.customConfirm(
      `${name} hesabı kapatılsın mı?\n\nVarsayılan: pasifleştir (kalıcı ban + VIP iptal).\nAuth silmek için bir sonraki soruda EVET deyin.`,
      'HESABI KAPAT'
    )) return;
    const hard = await window.customConfirm(
      'Auth kullanıcısını da tamamen silmek istiyor musun? (Geri alınamaz — genelde HAYIR)',
      'KALICI SİL?'
    );
    try {
      const qs = hard ? '?hard=1' : '';
      const res = await fetch(`${API_URL}/api/admin/users/${userId}${qs}`, {
        method: 'DELETE',
        headers: maAdminHeaders(),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Hata');
      notify(hard ? 'Kullanıcı kalıcı silindi' : 'Hesap pasifleştirildi', 'success');
      loadAdminUsers(($('ma-users-search')?.value || '').trim());
    } catch (e) {
      notify('Silme hatası: ' + e.message, 'error');
    }
  };

  function maVipTierLabel(tier) {
    const t = String(tier || '').toLowerCase();
    if (t === 'platinum') return 'Platinum';
    if (t === 'gold') return 'Gold';
    if (t === 'silver') return 'Silver';
    return t || '—';
  }

  /** Sadece KPI + fiyat çipleri — paket ataması artık Kullanıcı DÜZENLE modalından yapılır. */
  async function loadAdminVip() {
    try {
      const res = await fetch(`${API_URL}/api/admin/vip/subscribers`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API hatası');

      const stats = data.stats || {};
      const setKpi = (id, val) => {
        const el = $(id);
        if (el) el.textContent = String(val ?? 0);
      };
      setKpi('ma-vip-kpi-silver', stats.silver);
      setKpi('ma-vip-kpi-gold', stats.gold);
      setKpi('ma-vip-kpi-platinum', stats.platinum);
      setKpi('ma-vip-kpi-soon', stats.expiringSoon);

      const prices = data.prices || {};
      const priceRoot = $('ma-vip-prices');
      if (priceRoot && prices.silver != null) {
        priceRoot.innerHTML = `
          <span class="ma-vip-price-chip silver">Silver <b>${maEscape(prices.silver)}₺</b>/ay</span>
          <span class="ma-vip-price-chip gold">Gold <b>${maEscape(prices.gold)}₺</b>/ay</span>
          <span class="ma-vip-price-chip platinum">Platinum <b>${maEscape(prices.platinum)}₺</b>/ay</span>`;
      }
    } catch (e) {
      notify('VIP istatistik hatası: ' + e.message, 'error');
    }
  }

  /** Bekleyen VIP havale/EFT siparişleri — onayla → 30 gün otomatik paket tanımlanır. */
  async function loadAdminVipOrders() {
    const listEl = $('admin-vip-orders-list');
    if (!listEl) return;
    if (!adminToken) {
      listEl.innerHTML = '<div style="color:var(--cs-red);font-size:0.75rem;">Admin girişi gerekli.</div>';
      return;
    }
    listEl.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;">Yükleniyor...</div>';
    try {
      const res = await fetch(`${API_URL}/api/admin/vip-orders?status=pending_payment`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API hatası');
      const orders = data.orders || [];
      if (!orders.length) {
        listEl.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;font-family:var(--font-ui);">Bekleyen sipariş yok.</div>';
        return;
      }
      listEl.innerHTML = orders.map(o => `<div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:0.75rem;">
        <div style="display:flex;justify-content:space-between;gap:0.5rem;margin-bottom:0.35rem;">
          <div style="font-family:var(--font-hud);color:var(--cs-yellow);font-size:0.85rem;">${maEscape(o.order_code || o.id)}</div>
          <div style="font-size:0.65rem;color:var(--text-dim);">${maEscape(o.status)}</div>
        </div>
        <div style="font-family:var(--font-ui);font-size:0.7rem;color:var(--text-dim);line-height:1.5;margin-bottom:0.35rem;">
          ${maEscape(o.username || o.owner_id || '?')} · <span class="ma-vip-tier ${maEscape(o.tier)}">${maEscape(maVipTierLabel(o.tier))}</span> · ${o.amount_try} ₺ · ${o.days || 30} gün
        </div>
        <div style="font-family:var(--font-ui);font-size:0.65rem;color:var(--text-dim);margin-bottom:0.5rem;">${maFormatDate(o.created_at)}</div>
        <div style="display:flex;gap:0.4rem;">
          <button class="toolbar-btn" style="flex:1;border-color:var(--cs-green);color:var(--cs-green);padding:0.4rem;font-size:0.7rem;" onclick="adminVipOrderAction('approve','${maEscape(o.id)}')">ONAYLA</button>
          <button class="toolbar-btn danger" style="flex:1;padding:0.4rem;font-size:0.7rem;" onclick="adminVipOrderAction('reject','${maEscape(o.id)}')">REDDET</button>
        </div>
      </div>`).join('');
    } catch (e) {
      listEl.innerHTML = `<div style="color:var(--cs-red);font-size:0.75rem;">Siparişler yüklenemedi: ${maEscape(e.message)}</div>`;
    }
  }

  window.adminVipOrderAction = async function (action, id) {
    if (!adminToken) return notify('Yetkisiz işlem!', 'error');
    const label = action === 'approve' ? 'onaylamak' : 'reddetmek';
    if (!await window.customConfirm(`Bu VIP siparişini ${label} istediğine emin misin?`, 'ONAY')) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/vip-orders/${id}/${action}`, {
        method: 'POST',
        headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Hata');
      notify(action === 'approve' ? 'Sipariş onaylandı, VIP tanımlandı.' : 'Sipariş reddedildi.', 'success');
      loadAdminVipOrders();
      loadAdminVip();
      loadAdminUsers(($('ma-users-search')?.value || '').trim());
    } catch (e) {
      notify((action === 'approve' ? 'Onay' : 'Red') + ' başarısız: ' + e.message, 'error');
    }
  };

  async function loadAdminAmxAdmins() {
    const body = $('ma-admins-table-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="8" style="padding:1rem;text-align:center;">Yükleniyor...</td></tr>';
    try {
      const res = await fetch(`${API_URL}/api/admin/server-admins`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API hatası');
      const admins = data.admins || [];
      if (!admins.length) {
        body.innerHTML = '<tr><td colspan="8" style="padding:1rem;text-align:center;color:var(--text-dim);">Admin kaydı yok.</td></tr>';
        return;
      }
      body.innerHTML = admins.map(a => `
      <tr>
        <td>${maEscape(a.server_name || a.server_id || '—')}</td>
        <td>${maEscape(a.port || '—')}</td>
        <td style="color:var(--cs-yellow);">${maEscape(a.game_name || '—')}</td>
        <td>${maEscape(a.username || '—')}</td>
        <td><code>${maEscape(a.flags || '')}</code></td>
        <td><code style="font-size:0.65rem;">${maEscape(a.amx_password || '')}</code></td>
        <td style="color:var(--text-dim);">${maFormatDate(a.created_at)}</td>
        <td>${a.id ? `<button class="toolbar-btn danger" style="padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="masterAdminDeleteAmx('${maEscape(a.id)}')">SİL</button>` : '—'}</td>
      </tr>`).join('');
    } catch (e) {
      body.innerHTML = `<tr><td colspan="8" style="padding:1rem;text-align:center;color:var(--cs-red);">${maEscape(e.message)}</td></tr>`;
    }
  }

  window.masterAdminDeleteAmx = async function (id) {
    if (!adminToken) return;
    if (!await window.customConfirm('Bu AMXX admin kaydını silmek istediğine emin misin?', 'ONAY')) return;
    try {
      const res = await fetch(`${API_URL}/api/admin/server-admins/${id}`, {
        method: 'DELETE',
        headers: maAdminHeaders()
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Hata');
      notify('Admin silindi', 'success');
      loadAdminAmxAdmins();
    } catch (e) {
      notify('Silinemedi: ' + e.message, 'error');
    }
  };

  window.masterAdminExtend = async function (serverId) {
    if (!adminToken || !serverId) return;
    if (!await window.customConfirm('Süre +30 gün uzatılsın mı?', 'ONAY')) return;
    try {
      const current = _maServersCache.find(s => s.serverId === serverId || s.id === serverId);
      const base = current?.expires_at ? new Date(current.expires_at) : new Date();
      if (base < new Date()) base.setTime(Date.now());
      base.setDate(base.getDate() + 30);
      const res = await fetch(`${API_URL}/api/admin/servers/${serverId}`, {
        method: 'PATCH',
        headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expires_at: base.toISOString(), status: 'running' })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Hata');
      notify('Süre 30 gün uzatıldı', 'success');
      loadAdminServers();
    } catch (e) {
      notify('Uzatma hatası: ' + e.message, 'error');
    }
  };

  window.masterAdminBots = async function (serverId, action) {
    if (!adminToken || !serverId) return notify('Yetkisiz!', 'error');
    const label = action === 'add' ? 'Bot eklendi' : (action === 'kickall' ? 'Tüm botlar atıldı' : 'Bot çıkarıldı');
    try {
      const res = await fetch(`${API_URL}/api/admin/servers/${encodeURIComponent(serverId)}/bots`, {
        method: 'POST',
        headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Hata');
      notify(`${label} (port ${data.port || '?'})`, 'success');
      setTimeout(() => loadAdminServers(), 1200);
    } catch (e) {
      notify('Bot işlemi başarısız: ' + e.message, 'error');
    }
  };

  async function openMasterAdminPanel() {
    if (!masterAdminPanel) return;
    masterAdminPanel.style.display = 'flex';
    setMasterAdminView(_maCurrentView || 'dashboard');
  }

  window.masterAdminAction = async function (action, id) {
    if (!adminToken) return notify('Yetkisiz işlem!', 'error');

    if (action === 'delete') {
      if (!await window.customConfirm('Bu sunucuyu tamamen silmek istediğine emin misin? (Docker + DB)', 'ONAY')) return;
      try {
        const res = await fetch(`${API_URL}/api/admin/servers/${id}`, {
          method: 'DELETE',
          headers: maAdminHeaders()
        });
        const data = await res.json();
        if (data.success) {
          notify('Sunucu silindi!', 'success');
          loadAdminServers();
          loadAdminOverview();
        } else {
          notify('Silinemedi: ' + data.error, 'error');
        }
      } catch (e) { notify('Silme hatası', 'error'); }
    } else if (action === 'restart') {
      if (!await window.customConfirm('Bu sunucuyu yeniden başlatmak istediğine emin misin?', 'ONAY')) return;
      try {
        const res = await fetch(`${API_URL}/api/admin/servers/${encodeURIComponent(id)}/restart`, {
          method: 'POST',
          headers: maAdminHeaders()
        });
        const data = await res.json();
        if (data.success) {
          notify(`Sunucu yeniden başlatılıyor${data.port ? ` (port ${data.port})` : ''}...`, 'success');
          setTimeout(() => loadAdminServers(), 2500);
        } else {
          notify('Restart başarısız: ' + (data.error || '?'), 'error');
        }
      } catch (e) { notify('Restart hatası: ' + e.message, 'error'); }
    } else if (action === 'stop') {
      if (!await window.customConfirm('Bu sunucuyu kapatmak istediğine emin misin? Oyuncular düşecek.', 'ONAY')) return;
      try {
        const res = await fetch(`${API_URL}/api/admin/servers/${encodeURIComponent(id)}/stop`, {
          method: 'POST',
          headers: maAdminHeaders()
        });
        const data = await res.json();
        if (data.success) {
          notify(`Sunucu kapatıldı${data.port ? ` (port ${data.port})` : ''}`, 'success');
          setTimeout(() => loadAdminServers(), 1200);
        } else {
          notify('Kapatılamadı: ' + (data.error || '?'), 'error');
        }
      } catch (e) { notify('Kapatma hatası: ' + e.message, 'error'); }
    } else if (action === 'start') {
      if (!await window.customConfirm('Bu sunucuyu açmak istediğine emin misin?', 'ONAY')) return;
      try {
        const res = await fetch(`${API_URL}/api/admin/servers/${encodeURIComponent(id)}/start`, {
          method: 'POST',
          headers: maAdminHeaders()
        });
        const data = await res.json();
        if (data.success) {
          notify(`Sunucu açılıyor${data.port ? ` (port ${data.port})` : ''}...`, 'success');
          setTimeout(() => loadAdminServers(), 2500);
        } else {
          notify('Açılamadı: ' + (data.error || '?'), 'error');
        }
      } catch (e) { notify('Açma hatası: ' + e.message, 'error'); }
    }
  };

  async function masterAdminRestartAllServers() {
    if (!adminToken) return notify('Yetkisiz işlem!', 'error');
    if (!await window.customConfirm('TÜM oyun sunucuları yeniden başlatılacak. Oyuncular düşecek. Emin misin?', 'ONAY')) return;
    if (!await window.customConfirm('Son onay: tüm Docker sunucularını şimdi yeniden başlat?', 'SON ONAY')) return;
    try {
      notify('Tüm sunucular yeniden başlatılıyor...', 'info');
      const res = await fetch(`${API_URL}/api/admin/servers/restart-all`, {
        method: 'POST',
        headers: maAdminHeaders()
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Hata');
      notify(`Yeniden başlatıldı: ${data.restarted}/${data.total}` + (data.failed ? ` · hata: ${data.failed}` : ''), 'success');
      setTimeout(() => {
        loadAdminServers();
        loadAdminOverview();
      }, 3000);
    } catch (e) {
      notify('Toplu restart hatası: ' + e.message, 'error');
    }
  }
  window.masterAdminRestartAllServers = masterAdminRestartAllServers;

  // Master admin menu wiring
  document.querySelectorAll('#master-admin-panel .ma-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => setMasterAdminView(btn.dataset.maView));
  });
  const btnAdminPanelRefresh = $('btn-admin-panel-refresh');
  if (btnAdminPanelRefresh) {
    btnAdminPanelRefresh.addEventListener('click', () => refreshMasterAdminView());
  }
  const maServersFilter = $('ma-servers-filter');
  if (maServersFilter) {
    maServersFilter.addEventListener('input', () => renderAdminServersTable(_maServersCache));
  }
  const maOrdersStatus = $('ma-orders-status');
  if (maOrdersStatus) {
    maOrdersStatus.addEventListener('change', () => loadAdminRentalOrders());
  }
  const maUsersSearch = $('ma-users-search');
  if (maUsersSearch) {
    maUsersSearch.addEventListener('input', () => {
      clearTimeout(_maUsersSearchTimer);
      _maUsersSearchTimer = setTimeout(() => loadAdminUsers(maUsersSearch.value.trim()), 300);
    });
  }
  const btnAdminRefreshUsers = $('btn-admin-refresh-users');
  if (btnAdminRefreshUsers) {
    btnAdminRefreshUsers.addEventListener('click', () => loadAdminUsers(($('ma-users-search')?.value || '').trim()));
  }
  const btnMaEditCancel = $('btn-ma-edit-cancel');
  if (btnMaEditCancel) btnMaEditCancel.addEventListener('click', () => maCloseUserEditModal());
  const btnMaEditSave = $('btn-ma-edit-save');
  if (btnMaEditSave) btnMaEditSave.addEventListener('click', () => maSaveUserEdit());
  const maUserEditModal = $('ma-user-edit-modal');
  if (maUserEditModal) {
    maUserEditModal.addEventListener('click', (e) => {
      if (e.target === maUserEditModal) maCloseUserEditModal();
    });
  }
  const btnAdminRefreshVipOrders = $('btn-admin-refresh-vip-orders');
  if (btnAdminRefreshVipOrders) btnAdminRefreshVipOrders.addEventListener('click', () => loadAdminVipOrders());
  const btnAdminRefreshVisitors = $('btn-admin-refresh-visitors');
  if (btnAdminRefreshVisitors) {
    btnAdminRefreshVisitors.addEventListener('click', () => loadAdminVisitorStats());
  }
  const maVisRange = $('ma-vis-range');
  if (maVisRange) maVisRange.addEventListener('change', () => {
    _maVisitorState.logPage = 0;
    rerenderVisitorDetails();
  });
  const maVisType = $('ma-vis-type');
  if (maVisType) maVisType.addEventListener('change', () => {
    _maVisitorState.logPage = 0;
    rerenderVisitorDetails();
  });
  const maVisPage = $('ma-vis-page');
  if (maVisPage) maVisPage.addEventListener('change', () => {
    _maVisitorState.logPage = 0;
    rerenderVisitorDetails();
  });
  const maVisSearch = $('ma-vis-search');
  if (maVisSearch) {
    let t = null;
    maVisSearch.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        _maVisitorState.logPage = 0;
        rerenderVisitorDetails();
      }, 200);
    });
  }
  const maVisAuto = $('ma-vis-autorefresh');
  if (maVisAuto) {
    maVisAuto.addEventListener('change', () => {
      if (maVisAuto.checked && _maCurrentView === 'visitors') startVisitorAutoRefresh();
      else stopVisitorAutoRefresh();
    });
  }
  const btnAdminRefreshAmx = $('btn-admin-refresh-amx');
  if (btnAdminRefreshAmx) {
    btnAdminRefreshAmx.addEventListener('click', () => loadAdminAmxAdmins());
  }
  const bindRestartAll = (el) => {
    if (el) el.addEventListener('click', () => masterAdminRestartAllServers());
  };
  bindRestartAll($('btn-admin-restart-all-servers'));
  bindRestartAll($('btn-admin-restart-all-servers-system'));

  const btnAdminPurgeRentals = $('btn-admin-purge-rentals');
  if (btnAdminPurgeRentals) {
    btnAdminPurgeRentals.addEventListener('click', async () => {
      if (!adminToken) return;
      if (!await window.customConfirm('TÜM kiralık sunucular ve DB kayıtları silinecek. Emin misin?', 'TEHLİKE')) return;
      if (!await window.customConfirm('Son onay: bu işlem geri alınamaz.', 'SON ONAY')) return;
      try {
        const res = await fetch(`${API_URL}/api/admin/rentals/purge`, {
          method: 'DELETE',
          headers: maAdminHeaders()
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Hata');
        notify(`Temizlendi: ${data.removedContainers || 0} container`, 'success');
        refreshMasterAdminView('servers');
      } catch (e) {
        notify('Purge hatası: ' + e.message, 'error');
      }
    });
  }
  const btnAdminLogout = $('btn-admin-logout');
  if (btnAdminLogout) {
    btnAdminLogout.addEventListener('click', () => {
      sessionStorage.removeItem('cs_master_admin_token');
      adminToken = null;
      if (masterAdminPanel) masterAdminPanel.style.display = 'none';
      notify('Admin oturumu kapatıldı', 'success');
    });
  }

  const btnMaSiteSave = $('btn-ma-site-save');
  if (btnMaSiteSave) btnMaSiteSave.addEventListener('click', () => saveMaSiteContent());

  const btnMaPageAdd = $('btn-ma-page-add');
  if (btnMaPageAdd) {
    btnMaPageAdd.addEventListener('click', () => {
      _maPagesCache = collectMaPagesFromDom();
      _maPagesCache.push({ path: '/', title: 'Yeni sayfa', changefreq: 'weekly', priority: '0.5', in_sitemap: true });
      renderMaPagesTable(_maPagesCache);
    });
  }

  const btnMaMapsSave = $('btn-ma-maps-save');
  if (btnMaMapsSave) btnMaMapsSave.addEventListener('click', () => saveMaMaps());

  const btnMaMapAdd = $('btn-ma-map-add');
  if (btnMaMapAdd) {
    btnMaMapAdd.addEventListener('click', () => {
      _maMapsCache = collectMaMapsFromDom();
      _maMapsCache.push({
        name: 'new_map',
        slug: 'new-map',
        description: '',
        mode: 'de',
        seo_title: '',
        playable: true,
        in_sitemap: true,
        featured: false,
        size: 0,
        priority: '0.75',
      });
      renderMaMapsTable(_maMapsCache);
    });
  }

  const btnMaSitemapRegen = $('btn-ma-sitemap-regen');
  if (btnMaSitemapRegen) btnMaSitemapRegen.addEventListener('click', () => regenerateMaSitemap());

  const btnMaSitemapCopy = $('btn-ma-sitemap-copy');
  if (btnMaSitemapCopy) {
    btnMaSitemapCopy.addEventListener('click', async () => {
      if (!_maSitemapXml) {
        await regenerateMaSitemap();
      }
      if (!_maSitemapXml) return;
      try {
        await navigator.clipboard.writeText(_maSitemapXml);
        notify('Sitemap XML panoya kopyalandı', 'success');
      } catch (_) {
        notify('Kopyalama başarısız — önizlemeyi seçip kopyala', 'error');
      }
    });
  }

  const btnMaSitemapDownload = $('btn-ma-sitemap-download');
  if (btnMaSitemapDownload) {
    btnMaSitemapDownload.addEventListener('click', async () => {
      if (!_maSitemapXml) await regenerateMaSitemap();
      if (!_maSitemapXml) return;
      const blob = new Blob([_maSitemapXml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sitemap.xml';
      a.click();
      URL.revokeObjectURL(url);
      notify('sitemap.xml indirildi — public/ altına koyup deploy et', 'success');
    });
  }
}
