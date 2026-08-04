/*! BrowserCS — server browser player roster (additive) v5
 * Player-count button → modal with separate T / CT lists.
 */
(function () {
  'use strict';

  var API = (typeof window !== 'undefined' && window.__BCS_API_URL) || 'https://backend.browsercs.com';
  var STYLE_ID = 'bcs-players-style';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureStyle() {
    var css = [
      '#server-players-modal.show{display:flex!important}',
      '#sp-panel{background:linear-gradient(145deg,rgba(6,10,18,.98),rgba(10,18,30,.97));border:1px solid rgba(255,204,0,.22);border-top:3px solid var(--cs-yellow,#ffcc00);border-radius:8px;padding:1.2rem 1.25rem 1.1rem;width:min(560px,94vw);max-height:min(80vh,620px);box-shadow:0 24px 64px rgba(0,0,0,.9);display:flex;flex-direction:column;gap:.65rem;font-family:var(--font-hud),monospace}',
      '#sp-title{font-size:.95rem;font-weight:700;color:var(--cs-yellow,#ffcc00);letter-spacing:.1em;text-align:center;margin:0}',
      '#sp-subtitle,#sp-meta{font-size:.65rem;color:rgba(255,255,255,.4);letter-spacing:.05em;text-align:center;margin:0;line-height:1.4}',
      '#sp-list-wrap{flex:1;overflow:auto;min-height:140px}',
      '#sp-teams{display:grid;grid-template-columns:1fr 1fr;gap:.55rem;align-items:start}',
      '@media(max-width:520px){#sp-teams{grid-template-columns:1fr}}',
      '.sp-col{border:1px solid rgba(255,255,255,.08);border-radius:4px;background:rgba(0,0,0,.35);overflow:hidden}',
      '.sp-col-h{padding:.4rem .55rem;font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.08)}',
      '.sp-col-h.t{color:#e57373;background:rgba(180,40,40,.18)}',
      '.sp-col-h.ct{color:#64b5f6;background:rgba(30,90,180,.18)}',
      '.sp-col-h.spec{color:rgba(255,255,255,.45);background:rgba(255,255,255,.04)}',
      '.sp-col table{width:100%;border-collapse:collapse;font-size:.7rem}',
      '.sp-col td{padding:.35rem .55rem;border-bottom:1px solid rgba(255,255,255,.05);color:rgba(255,255,255,.88)}',
      '.sp-col .sp-score{text-align:right;color:#4dbb7a;font-weight:700;width:2.6rem}',
      '.sp-col .sp-bot{opacity:.55;font-size:.55rem;margin-left:.25rem;letter-spacing:.04em}',
      '#sp-empty,#sp-loading{padding:1.6rem 1rem;text-align:center;font-size:.72rem;color:rgba(255,255,255,.4)}',
      '#sp-error{padding:1.6rem 1rem;text-align:center;font-size:.72rem;color:#e74c3c}',
      '#sp-actions{display:flex;gap:.5rem}',
      '#sp-refresh,#sp-close{flex:1;padding:.5rem;border-radius:4px;font-family:inherit;font-size:.65rem;font-weight:700;letter-spacing:.1em;cursor:pointer}',
      '#sp-refresh{background:rgba(255,204,0,.12);border:1px solid rgba(255,204,0,.35);color:var(--cs-yellow,#ffcc00)}',
      '#sp-close{background:transparent;border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.45)}',
      '.server-card-meta .sb-players-hit{display:inline-flex;align-items:center;gap:4px;font-family:var(--font-hud),monospace;font-size:.58rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4dbb7a!important;background:rgba(20,140,60,.16);border:1px solid rgba(50,200,100,.4);border-radius:3px;padding:3px 8px;cursor:pointer!important;text-decoration:none!important;transition:background .15s,border-color .15s,color .15s,box-shadow .15s;line-height:1.2;user-select:none}',
      '.server-card-meta .sb-players-hit:hover{color:#fff!important;background:rgba(50,200,100,.28);border-color:#4caf50;box-shadow:0 0 0 1px rgba(76,175,80,.25)}',
      '.server-card-meta .sb-players-hit:active{transform:translateY(1px)}',
      '.server-card-meta .sb-players-hit::after{content:"▾";opacity:.7;font-size:.55rem;margin-left:1px}',
      '.map-item .sb-players-hit{cursor:pointer!important;font-family:var(--font-hud),monospace!important;letter-spacing:.04em;transition:background .15s,border-color .15s,color .15s,transform .1s}',
      '.map-item .sb-players-hit:hover{background:rgba(0,0,0,.92)!important;border-color:#81c784!important;color:#b9f6ca!important;transform:translateY(-1px)}'
    ].join('');

    var st = document.getElementById(STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = STYLE_ID;
      document.head.appendChild(st);
    }
    st.textContent = css;
  }

  function ensureModal() {
    ensureStyle();
    var modal = document.getElementById('server-players-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'server-players-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:5200;background:rgba(0,0,0,0.88);backdrop-filter:blur(6px);align-items:center;justify-content:center;';
    modal.innerHTML =
      '<div id="sp-panel" role="dialog" aria-modal="true">' +
      '<h2 id="sp-title">OYUNCULAR</h2>' +
      '<p id="sp-subtitle">—</p>' +
      '<div id="sp-meta"></div>' +
      '<div id="sp-list-wrap"><div id="sp-loading">Oyuncular yükleniyor...</div></div>' +
      '<div id="sp-actions">' +
      '<button type="button" id="sp-refresh">↻ YENİLE</button>' +
      '<button type="button" id="sp-close">✕ KAPAT</button>' +
      '</div></div>';
    document.body.appendChild(modal);
    return modal;
  }

  function resolveServer(port, map, displayName) {
    var list = window.__loadedServers || [];
    var p = Number(port);
    if (p) {
      var byPort = list.find(function (s) { return Number(s.port) === p; });
      if (byPort) return byPort;
    }
    return list.find(function (s) {
      if (!s.port || s.state !== 'running') return false;
      if (map && s.map && s.map !== map) return false;
      var n = String(s.name || '');
      var dn = String(displayName || '');
      if (!dn) return !!map;
      return n.indexOf(dn) !== -1 || dn.indexOf(n.replace(/^BROWSERCS\s*\|\s*/i, '')) !== -1;
    }) || null;
  }

  function cardMeta(card) {
    var nameEl = card.querySelector('.server-card-name') || card.querySelector('div[style*="font-weight: bold"]');
    var mapEl = card.querySelector('.server-thumb-map-text');
    return {
      displayName: nameEl ? nameEl.textContent.trim() : '',
      map: mapEl ? mapEl.textContent.trim() : ''
    };
  }

  function isPlayerCountText(t) {
    t = String(t || '');
    if (/Kapalı|KAPALI/.test(t)) return false;
    return (t.indexOf('Oyuncu') !== -1 || t.indexOf('👤') !== -1) && t.indexOf('/') !== -1;
  }

  function teamBucket(data) {
    var teams = (data && data.teams) || {};
    var T = Array.isArray(teams.T) ? teams.T.slice() : [];
    var CT = Array.isArray(teams.CT) ? teams.CT.slice() : [];
    var SPEC = Array.isArray(teams.SPEC) ? teams.SPEC.slice() : [];
    if ((!T.length && !CT.length) && Array.isArray(data.players)) {
      data.players.forEach(function (p) {
        if (p.team === 'T') T.push(p);
        else if (p.team === 'CT') CT.push(p);
        else SPEC.push(p);
      });
    }
    return { T: T, CT: CT, SPEC: SPEC };
  }

  function colHtml(title, cls, rows) {
    var body;
    if (!rows.length) {
      body = '<tr><td colspan="2" style="color:rgba(255,255,255,.3);text-align:center;padding:.7rem .5rem">—</td></tr>';
    } else {
      body = rows.map(function (p) {
        return '<tr><td>' + esc(p.name || 'Oyuncu') +
          (p.bot ? '<span class="sp-bot">BOT</span>' : '') +
          '</td><td class="sp-score">' + (isFinite(p.score) ? p.score : 0) + '</td></tr>';
      }).join('');
    }
    return '<div class="sp-col"><div class="sp-col-h ' + cls + '">' + title + ' · ' + rows.length +
      '</div><table><tbody>' + body + '</tbody></table></div>';
  }

  window.openServerPlayersModal = function (serverOrPort) {
    var server = serverOrPort;
    if (typeof serverOrPort === 'number' || (typeof serverOrPort === 'string' && /^\d+$/.test(serverOrPort))) {
      server = resolveServer(serverOrPort) || { port: Number(serverOrPort), name: 'Sunucu' };
    }
    if (!server || !server.port) return;

    var modal = ensureModal();
    var subtitle = document.getElementById('sp-subtitle');
    var meta = document.getElementById('sp-meta');
    var listWrap = document.getElementById('sp-list-wrap');
    var btnRefresh = document.getElementById('sp-refresh');
    var btnClose = document.getElementById('sp-close');
    var displayName = server.displayName || server.name || 'Sunucu';
    if (subtitle) subtitle.textContent = displayName + (server.map ? '  ·  ' + server.map : '');
    if (meta) {
      meta.textContent =
        (server.players != null ? server.players : (server.playersCount != null ? server.playersCount : '?')) +
        '/' + (server.maxplayers || '?') + ' oyuncu';
    }

    var closed = false;
    var token = 0;

    function close() {
      if (closed) return;
      closed = true;
      modal.classList.remove('show');
      modal.style.display = 'none';
      btnClose && btnClose.removeEventListener('click', close);
      btnRefresh && btnRefresh.removeEventListener('click', refresh);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
    }
    function onBackdrop(e) { if (e.target === modal) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function refresh() { load(true); }

    function render(data) {
      var bucket = teamBucket(data || {});
      var total = bucket.T.length + bucket.CT.length + bucket.SPEC.length;
      if (meta) {
        meta.textContent =
          total + '/' + ((data && data.maxplayers) || '?') + ' oyuncu' +
          (data && data.map ? '  ·  ' + data.map : '') +
          '  ·  T ' + bucket.T.length + ' / CT ' + bucket.CT.length;
      }
      if (!total) {
        listWrap.innerHTML = '<div id="sp-empty">Sunucuda oyuncu yok.</div>';
        return;
      }
      var html = '<div id="sp-teams">' +
        colHtml('Terrorists', 't', bucket.T) +
        colHtml('Counter-Terrorists', 'ct', bucket.CT) +
        '</div>';
      if (bucket.SPEC.length) {
        html += '<div style="margin-top:.55rem">' + colHtml('Spectators / Diğer', 'spec', bucket.SPEC) + '</div>';
      }
      listWrap.innerHTML = html;
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
          listWrap.innerHTML = '<div id="sp-error">' + esc(data.error || 'Oyuncu listesi alınamadı.') + '</div>';
          return;
        }
        render(data);
      } catch (e) {
        if (closed || my !== token) return;
        listWrap.innerHTML = '<div id="sp-error">Bağlantı hatası. Tekrar deneyin.</div>';
      }
    }

    modal.style.display = 'flex';
    modal.classList.add('show');
    btnClose && btnClose.addEventListener('click', close);
    btnRefresh && btnRefresh.addEventListener('click', refresh);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    load(false);
  };

  function styleAsButton(el, isMini) {
    el.classList.add('sb-players-hit');
    el.title = 'Oyuncu listesini göster (T / CT)';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    if (!isMini) {
      var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      var m = t.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) el.textContent = '👤 ' + m[1] + '/' + m[2] + ' OYUNCU';
    }
  }

  function bindHit(el, card) {
    if (!el || el.dataset.bcsPlayersBound === '1') return;
    var meta = cardMeta(card);
    var srv = resolveServer(card.dataset.port, meta.map, meta.displayName);
    if (!srv || !srv.port) return;
    if (srv.state && srv.state !== 'running') return;

    el.dataset.bcsPlayersBound = '1';
    card.dataset.port = String(srv.port);
    styleAsButton(el, card.classList.contains('map-item'));

    function open(e) {
      e.preventDefault();
      e.stopPropagation();
      var s = resolveServer(card.dataset.port, meta.map, meta.displayName) || srv;
      window.openServerPlayersModal(s);
    }
    el.addEventListener('click', open);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  }

  function enhanceCard(card) {
    if (!card) return;
    card.querySelectorAll('.btn-bcs-players').forEach(function (b) { b.remove(); });
    card.querySelectorAll('.server-card-meta span').forEach(function (span) {
      if (isPlayerCountText(span.textContent)) bindHit(span, card);
    });
    if (card.classList.contains('map-item')) {
      card.querySelectorAll('div').forEach(function (d) {
        if (isPlayerCountText(d.textContent) && d.children.length === 0) bindHit(d, card);
      });
    }
  }

  function enhanceAll() {
    ensureStyle();
    document.querySelectorAll('.server-card-box, .map-item').forEach(enhanceCard);
  }

  function wrapLoadServerList() {
    var orig = window.loadServerList;
    if (typeof orig !== 'function') return false;
    if (orig.__bcsPlayersWrapped) {
      enhanceAll();
      return true;
    }
    var wrapped = function () {
      var ret = orig.apply(this, arguments);
      Promise.resolve(ret).finally(function () {
        setTimeout(enhanceAll, 30);
        setTimeout(enhanceAll, 250);
        setTimeout(enhanceAll, 800);
      });
      return ret;
    };
    wrapped.__bcsPlayersWrapped = true;
    window.loadServerList = wrapped;
    enhanceAll();
    return true;
  }

  function observeGrid() {
    var grid = document.getElementById('full-active-servers-grid') || document.getElementById('server-list');
    if (!grid || grid.__bcsPlayersObserved) return;
    grid.__bcsPlayersObserved = true;
    var t = null;
    var mo = new MutationObserver(function () {
      clearTimeout(t);
      t = setTimeout(enhanceAll, 40);
    });
    mo.observe(grid, { childList: true, subtree: true });
  }

  function boot() {
    wrapLoadServerList();
    observeGrid();
    enhanceAll();
    var n = 0;
    var iv = setInterval(function () {
      n++;
      wrapLoadServerList();
      observeGrid();
      enhanceAll();
      if (n > 60) clearInterval(iv);
    }, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
