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
      await Promise.all([loadAdminOverview(), loadAdminVisitorStats()]);
    } else if (view === 'servers') {
      await loadAdminServers();
    } else if (view === 'orders') {
      await loadAdminRentalOrders();
    } else if (view === 'users') {
      await loadAdminUsers();
    } else if (view === 'admins') {
      await loadAdminAmxAdmins();
    } else if (view === 'visitors') {
      await loadAdminVisitorStats();
    }
  }

  function renderVisitorBlocks(active, daily, weekly, monthly) {
    const block = (title, color, stats) => `
    <div style="background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;padding:0.75rem;">
      <div style="color:${color};font-family:var(--font-title);font-size:0.9rem;margin-bottom:0.5rem;display:flex;justify-content:space-between;">
        <span>${title}</span><span>${(stats.real || 0) + (stats.bot || 0) + (stats.ai || 0)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.7rem;gap:0.5rem;">
        <span style="color:var(--text-dim);">Gerçek: <span style="color:white;">${stats.real || 0}</span></span>
        <span style="color:var(--text-dim);">Bot: <span style="color:white;">${stats.bot || 0}</span></span>
        <span style="color:var(--text-dim);">AI: <span style="color:white;">${stats.ai || 0}</span></span>
      </div>
    </div>`;
    return `
    <div style="display:flex;flex-direction:column;gap:1rem;">
      ${block('CANLI (5 Dk)', 'var(--cs-green)', active)}
      ${block('BUGÜN', 'var(--cs-yellow)', daily)}
      ${block('BU HAFTA', 'var(--cs-yellow)', weekly)}
      ${block('BU AY', 'var(--cs-yellow)', monthly)}
    </div>`;
  }

  async function loadAdminVisitorStats() {
    const statsEl = $('admin-visitor-stats');
    const miniEl = $('admin-visitor-stats-mini');
    if (!adminToken) {
      if (statsEl) statsEl.innerHTML = '<div style="color:var(--cs-red);font-size:0.75rem;">Admin girişi gerekli.</div>';
      return;
    }
    if (statsEl) statsEl.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;">Yükleniyor...</div>';
    try {
      const res = await fetch(`/api/admin/visitor-stats`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API hatası');
      const { active, daily, weekly, monthly } = data;
      const html = renderVisitorBlocks(active, daily, weekly, monthly);
      if (statsEl) statsEl.innerHTML = html;
      if (miniEl) {
        miniEl.innerHTML = `
        <div class="ma-stat"><div class="label">CANLI GERÇEK</div><div class="value">${active.real || 0}</div></div>
        <div class="ma-stat"><div class="label">CANLI BOT</div><div class="value">${active.bot || 0}</div></div>
        <div class="ma-stat"><div class="label">CANLI AI</div><div class="value">${active.ai || 0}</div></div>
        <div class="ma-stat"><div class="label">BUGÜN TOPLAM</div><div class="value">${(daily.real||0)+(daily.bot||0)+(daily.ai||0)}</div></div>`;
      }
    } catch (e) {
      if (statsEl) statsEl.innerHTML = `<div style="color:var(--cs-red);font-size:0.75rem;">Hata: ${maEscape(e.message)}</div>`;
    }
  }

  async function loadAdminOverview() {
    const el = $('ma-overview-stats');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;">Yükleniyor...</div>';
    try {
      const res = await fetch(`${API_URL}/api/admin/overview`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API hatası');
      const o = data.overview || {};
      el.innerHTML = [
        ['AKTİF SUNUCU', o.activeServers],
        ['CONTAINER', o.totalContainers],
        ['OYUNCUDA', o.totalPlayers],
        ['KULLANICI', o.usersCount],
        ['DB SUNUCU', o.dbServersCount],
        ['BEKLEYEN ÖDEME', o.pendingOrders],
        ['SITE ADMIN', o.adminProfiles]
      ].map(([label, val]) => `
      <div class="ma-stat">
        <div class="label">${label}</div>
        <div class="value">${val ?? 0}</div>
      </div>`).join('');
    } catch (e) {
      el.innerHTML = `<div style="color:var(--cs-red);font-size:0.75rem;">Overview hatası: ${maEscape(e.message)}</div>`;
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
      const stateLabel = s.state === 'running' ? 'ÇALIŞIYOR' : (s.state === 'offline' ? 'KAPALI' : (s.state || '?'));
      const expired = s.expires_at && new Date(s.expires_at) < new Date();
      return `<tr>
      <td style="font-weight:bold;color:var(--text-bright);max-width:160px;overflow:hidden;text-overflow:ellipsis;">${maEscape(s.name)}</td>
      <td><span style="background:${s.isOfficial ? 'rgba(33,150,243,0.1)' : 'rgba(255,152,0,0.1)'};color:${s.isOfficial ? '#2196f3' : '#ff9800'};padding:2px 6px;border-radius:3px;font-size:0.65rem;">${s.isOfficial ? 'RESMİ' : 'OYUNCU'}</span></td>
      <td><span style="color:${s.state === 'running' ? 'var(--cs-green)' : 'var(--text-dim)'};">${maEscape(stateLabel)}</span>${s.status && s.status !== s.state ? ` <span style="color:var(--text-dim);">(${maEscape(s.status)})</span>` : ''}</td>
      <td style="color:var(--cs-yellow);">${maEscape(s.map || '?')}</td>
      <td>${s.players ?? 0}/${s.maxplayers ?? '?'}</td>
      <td>${maEscape(s.port || '—')}</td>
      <td title="${maEscape(s.owner_id || '')}">${maEscape(s.owner_username || (s.owner_id ? String(s.owner_id).slice(0, 8) + '…' : '—'))}</td>
      <td style="color:var(--text-dim);">${maFormatDate(s.created_at)}</td>
      <td style="color:${expired ? 'var(--cs-red)' : 'var(--text-dim)'};">${maFormatDate(s.expires_at)}</td>
      <td style="white-space:nowrap;">
        <button class="toolbar-btn" style="border-color:var(--cs-green);color:var(--cs-green);padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="window.openServerSettings('${maEscape(settingsId)}')">AYAR</button>
        <button class="toolbar-btn" style="border-color:var(--cs-yellow);color:var(--cs-yellow);padding:0.25rem 0.45rem;font-size:0.65rem;" onclick="masterAdminAction('restart','${maEscape(actionId)}')">RST</button>
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

  async function loadAdminUsers(q = '') {
    const body = $('ma-users-table-body');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" style="padding:1rem;text-align:center;">Yükleniyor...</td></tr>';
    try {
      const qs = q ? `?q=${encodeURIComponent(q)}` : '';
      const res = await fetch(`${API_URL}/api/admin/users${qs}`, { headers: maAdminHeaders() });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'API hatası');
      const users = data.users || [];
      if (!users.length) {
        body.innerHTML = '<tr><td colspan="7" style="padding:1rem;text-align:center;color:var(--text-dim);">Kullanıcı yok.</td></tr>';
        return;
      }
      body.innerHTML = users.map(u => `
      <tr>
        <td style="color:var(--text-bright);font-weight:bold;">${maEscape(u.username || '—')}<div style="font-size:0.6rem;color:var(--text-dim);font-weight:normal;">${maEscape(u.id)}</div></td>
        <td>
          <select class="ma-input" data-user-role="${maEscape(u.id)}" style="min-width:90px;">
            ${['user', 'vip', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </td>
        <td><input type="checkbox" data-user-premium="${maEscape(u.id)}" ${u.is_premium ? 'checked' : ''}></td>
        <td><input class="ma-input" type="number" data-user-wallet="${maEscape(u.id)}" value="${Number(u.wallet_balance || 0)}" style="width:90px;"></td>
        <td>${u.servers_count || 0}</td>
        <td style="color:var(--text-dim);">${maFormatDate(u.created_at)}</td>
        <td><button class="toolbar-btn" style="border-color:var(--cs-green);color:var(--cs-green);padding:0.25rem 0.5rem;font-size:0.65rem;" onclick="masterAdminSaveUser('${maEscape(u.id)}')">KAYDET</button></td>
      </tr>`).join('');
    } catch (e) {
      body.innerHTML = `<tr><td colspan="7" style="padding:1rem;text-align:center;color:var(--cs-red);">${maEscape(e.message)}</td></tr>`;
    }
  }

  window.masterAdminSaveUser = async function (userId) {
    if (!adminToken) return notify('Yetkisiz!', 'error');
    const role = document.querySelector(`[data-user-role="${userId}"]`)?.value;
    const is_premium = !!document.querySelector(`[data-user-premium="${userId}"]`)?.checked;
    const wallet_balance = Number(document.querySelector(`[data-user-wallet="${userId}"]`)?.value || 0);
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: maAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ role, is_premium, wallet_balance })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Hata');
      notify('Kullanıcı güncellendi', 'success');
    } catch (e) {
      notify('Güncelleme hatası: ' + e.message, 'error');
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
        const token = await getSessionToken();
        const res = await fetch(`${API_URL}/api/servers/${id}/restart`, {
          method: 'POST',
          headers: {
            'x-admin-token': adminToken,
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });
        const data = await res.json();
        if (data.success) {
          notify('Sunucu yeniden başlatılıyor...', 'success');
          setTimeout(() => loadAdminServers(), 2000);
        } else {
          notify('Restart başarısız: ' + data.error, 'error');
        }
      } catch (e) { notify('Restart hatası', 'error'); }
    }
  };

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
  const btnAdminRefreshAmx = $('btn-admin-refresh-amx');
  if (btnAdminRefreshAmx) {
    btnAdminRefreshAmx.addEventListener('click', () => loadAdminAmxAdmins());
  }
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
}
