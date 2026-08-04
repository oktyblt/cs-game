/*! BrowserCS — server browser player roster (additive) */
(function () {
  'use strict';
  var API = (typeof window !== 'undefined' && window.__BCS_API_URL) || 'https://backend.browsercs.com';
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmtDur(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) return '—';
    var t = Math.round(sec), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    return m + ':' + String(s).padStart(2,'0');
  }
  function ensureModal() {
    var modal = document.getElementById('server-players-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'server-players-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:5200;background:rgba(0,0,0,0.88);backdrop-filter:blur(6px);align-items:center;justify-content:center;font-family:var(--font-hud),monospace;';
    modal.innerHTML =
      '<style>#server-players-modal.show{display:flex!important}#sp-panel{background:linear-gradient(145deg,rgba(6,10,18,.98),rgba(10,18,30,.97));border:1px solid rgba(255,204,0,.22);border-top:3px solid #ffcc00;border-radius:8px;padding:1.4rem 1.5rem 1.2rem;width:min(440px,92vw);max-height:min(78vh,560px);box-shadow:0 24px 64px rgba(0,0,0,.9);display:flex;flex-direction:column;gap:.7rem}#sp-title{font-size:.95rem;font-weight:700;color:#ffcc00;letter-spacing:.1em;text-align:center;margin:0}#sp-subtitle,#sp-meta{font-size:.65rem;color:rgba(255,255,255,.4);letter-spacing:.05em;text-align:center;margin:0;line-height:1.4}#sp-list-wrap{flex:1;overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:4px;background:rgba(0,0,0,.35);min-height:120px}#sp-table{width:100%;border-collapse:collapse;font-size:.72rem}#sp-table thead th{position:sticky;top:0;background:rgba(12,18,28,.98);color:rgba(255,255,255,.4);font-weight:600;letter-spacing:.08em;text-align:left;padding:.45rem .65rem;border-bottom:1px solid rgba(255,255,255,.1);font-size:.58rem;text-transform:uppercase}#sp-table tbody td{padding:.42rem .65rem;border-bottom:1px solid rgba(255,255,255,.05);color:rgba(255,255,255,.85)}#sp-table .sp-rank{width:2.2rem;color:rgba(255,255,255,.35)}#sp-table .sp-score{text-align:right;color:#4dbb7a;font-weight:700}#sp-table .sp-time{text-align:right;color:rgba(255,255,255,.4);white-space:nowrap}#sp-empty,#sp-loading{padding:1.6rem 1rem;text-align:center;font-size:.72rem;color:rgba(255,255,255,.4)}#sp-error{padding:1.6rem 1rem;text-align:center;font-size:.72rem;color:#e74c3c}#sp-actions{display:flex;gap:.5rem}#sp-refresh,#sp-close{flex:1;padding:.5rem;border-radius:4px;font-family:inherit;font-size:.65rem;font-weight:700;letter-spacing:.1em;cursor:pointer}#sp-refresh{background:rgba(255,204,0,.12);border:1px solid rgba(255,204,0,.35);color:#ffcc00}#sp-close{background:transparent;border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.45)}.sb-players-btn{cursor:pointer!important}.sb-players-btn:hover{color:#fff!important;border-color:#ffcc00!important;background:rgba(255,204,0,.18)!important}</style>' +
      '<div id="sp-panel" role="dialog" aria-modal="true"><h2 id="sp-title">OYUNCULAR</h2><p id="sp-subtitle">—</p><div id="sp-meta"></div><div id="sp-list-wrap"><div id="sp-loading">Oyuncular yükleniyor...</div></div><div id="sp-actions"><button type="button" id="sp-refresh">↻ YENİLE</button><button type="button" id="sp-close">✕ KAPAT</button></div></div>';
    document.body.appendChild(modal);
    return modal;
  }
  function findServerFromCard(el) {
    var card = el.closest('.server-card-box, .map-item');
    if (!card) return null;
    var nameEl = card.querySelector('.server-card-name') || card.querySelector('div[style*="font-weight: bold"]');
    var mapEl = card.querySelector('.server-thumb-map-text');
    var displayName = nameEl ? nameEl.textContent.trim() : '';
    var map = mapEl ? mapEl.textContent.trim() : '';
    var list = window.__loadedServers || [];
    var hit = list.find(function (s) {
      if (!s.port || s.state !== 'running') return false;
      if (map && s.map && s.map !== map) return false;
      var n = s.name || '';
      return !displayName || n.indexOf(displayName) !== -1 || displayName.indexOf(n.replace(/^BROWSERCS\s*\|\s*/i, '')) !== -1;
    });
    if (hit) return hit;
    return list.find(function (s) { return s.state === 'running' && s.map === map; }) || null;
  }
  window.openServerPlayersModal = function (server) {
    if (!server || !server.port) return;
    var modal = ensureModal();
    var subtitle = document.getElementById('sp-subtitle');
    var meta = document.getElementById('sp-meta');
    var listWrap = document.getElementById('sp-list-wrap');
    var btnRefresh = document.getElementById('sp-refresh');
    var btnClose = document.getElementById('sp-close');
    var displayName = server.displayName || server.name || 'Sunucu';
    if (subtitle) subtitle.textContent = displayName + (server.map ? '  ·  ' + server.map : '');
    if (meta) meta.textContent = (server.players != null ? server.players : (server.playersCount != null ? server.playersCount : '?')) + '/' + (server.maxplayers || '?') + ' oyuncu';
    var closed = false, token = 0;
    function close() {
      if (closed) return; closed = true;
      modal.classList.remove('show'); modal.style.display = 'none';
      btnClose && btnClose.removeEventListener('click', close);
      btnRefresh && btnRefresh.removeEventListener('click', refresh);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
    }
    function onBackdrop(e) { if (e.target === modal) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function refresh() { load(true); }
    function render(players, info) {
      if (meta && info) {
        var c = (players && players.length) || 0;
        meta.textContent = c + '/' + (info.maxplayers || '?') + ' oyuncu' + (info.map ? '  ·  ' + info.map : '');
      }
      if (!players || !players.length) { listWrap.innerHTML = '<div id="sp-empty">Sunucuda oyuncu yok.</div>'; return; }
      var rows = players.map(function (p, i) {
        return '<tr><td class="sp-rank">'+(i+1)+'</td><td>'+esc(p.name||('Oyuncu #'+(i+1)))+'</td><td class="sp-score">'+(isFinite(p.score)?p.score:0)+'</td><td class="sp-time">'+fmtDur(p.duration)+'</td></tr>';
      }).join('');
      listWrap.innerHTML = '<table id="sp-table"><thead><tr><th>#</th><th>Oyuncu</th><th style="text-align:right">Skor</th><th style="text-align:right">Süre</th></tr></thead><tbody>'+rows+'</tbody></table>';
    }
    async function load(bust) {
      var my = ++token;
      listWrap.innerHTML = '<div id="sp-loading">Oyuncular yükleniyor...</div>';
      try {
        var qs = bust ? ('?t=' + Date.now()) : '';
        var res = await fetch(API + '/api/servers/' + encodeURIComponent(server.port) + '/players' + qs);
        var data = await res.json();
        if (closed || my !== token) return;
        if (!res.ok || data.success === false) {
          listWrap.innerHTML = '<div id="sp-error">'+esc(data.error||'Oyuncu listesi alınamadı.')+'</div>';
          return;
        }
        render(data.players || [], data);
      } catch (e) {
        if (closed || my !== token) return;
        listWrap.innerHTML = '<div id="sp-error">Bağlantı hatası. Tekrar deneyin.</div>';
      }
    }
    modal.style.display = 'flex'; modal.classList.add('show');
    btnClose && btnClose.addEventListener('click', close);
    btnRefresh && btnRefresh.addEventListener('click', refresh);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    load(false);
  };
  function enhanceCards(root) {
    root = root || document;
    root.querySelectorAll('.server-card-meta span').forEach(function (span) {
      if (span.dataset.bcsPlayersBound) return;
      var t = span.textContent || '';
      if (t.indexOf('Oyuncu') === -1 && t.indexOf('👤') === -1) return;
      if (t.indexOf('Kapalı') !== -1) return;
      span.dataset.bcsPlayersBound = '1';
      span.classList.add('sb-players-btn');
      span.title = 'Oyuncu listesini göster';
      span.style.cursor = 'pointer';
      span.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault();
        var srv = findServerFromCard(span);
        if (srv) window.openServerPlayersModal(srv);
      });
    });
    root.querySelectorAll('.map-item').forEach(function (card) {
      if (card.dataset.bcsPlayersBound) return;
      var badge = null;
      card.querySelectorAll('div').forEach(function (d) {
        var t = d.textContent || '';
        if (t.indexOf('👤') !== -1 && t.indexOf('/') !== -1) badge = d;
      });
      if (!badge) return;
      card.dataset.bcsPlayersBound = '1';
      badge.classList.add('sb-players-btn');
      badge.title = 'Oyuncu listesini göster';
      badge.style.cursor = 'pointer';
      badge.style.zIndex = '6';
      badge.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault();
        var srv = findServerFromCard(badge);
        if (srv) window.openServerPlayersModal(srv);
      });
    });
  }
  function wrapLoadServerList() {
    var orig = window.loadServerList;
    if (typeof orig !== 'function' || orig.__bcsPlayersWrapped) { enhanceCards(document); return typeof orig === 'function'; }
    var wrapped = function () {
      var ret = orig.apply(this, arguments);
      Promise.resolve(ret).then(function () {
        setTimeout(function () { enhanceCards(document); }, 50);
        setTimeout(function () { enhanceCards(document); }, 400);
      });
      return ret;
    };
    wrapped.__bcsPlayersWrapped = true;
    window.loadServerList = wrapped;
    enhanceCards(document);
    return true;
  }
  function boot() {
    if (wrapLoadServerList()) return;
    var n = 0, iv = setInterval(function () { n++; if (wrapLoadServerList() || n > 40) clearInterval(iv); }, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
