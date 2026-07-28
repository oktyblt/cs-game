(function () {
  var API = '/api/track';
  var VISITOR_KEY = 'cs_visitor_id';
  var SESSION_KEY = 'cs_play_session_id';

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function getVisitorId() {
    try {
      var id = localStorage.getItem(VISITOR_KEY);
      if (!id) {
        id = uuid();
        localStorage.setItem(VISITOR_KEY, id);
      }
      return id;
    } catch (e) {
      return uuid();
    }
  }

  function getPlaySession() {
    try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }
  function setPlaySession(id) {
    try {
      if (id) sessionStorage.setItem(SESSION_KEY, id);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  function track(type, extra) {
    extra = extra || {};
    var payload = {
      type: type,
      visitorId: getVisitorId(),
      path: location.pathname + (location.search || ''),
      referrer: document.referrer || '',
      userId: extra.userId || undefined,
      username: extra.username || undefined,
      nickname: extra.nickname || undefined,
      port: extra.port,
      map: extra.map,
      sessionId: extra.sessionId || getPlaySession() || undefined
    };
    try {
      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: type === 'play_end' || type === 'visit'
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.visitorId) {
          try { localStorage.setItem(VISITOR_KEY, d.visitorId); } catch (e) {}
        }
        if (d && d.sessionId && (type === 'play_start' || type === 'heartbeat')) setPlaySession(d.sessionId);
        if (type === 'play_end') setPlaySession(null);
      }).catch(function () {});
    } catch (e) {}
  }

  // page visit once per tab
  try {
    if (!sessionStorage.getItem('cs_cf_visit_sent')) {
      sessionStorage.setItem('cs_cf_visit_sent', '1');
      track('visit');
    }
  } catch (e) {
    track('visit');
  }

  // Hook guest nick submit
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t) return;
    if (t.id === 'btn-guest-name-submit' || (t.closest && t.closest('#btn-guest-name-submit'))) {
      var input = document.getElementById('guest-name-input');
      var nick = input && input.value ? input.value.trim() : '';
      if (nick) track('guest_join', { nickname: nick });
    }
  }, true);

  // Expose for game connect hooks
  window.bcsTrack = track;
  window.bcsTrackPlayStart = function (info) {
    info = info || {};
    setPlaySession(uuid());
    track('play_start', {
      userId: info.userId,
      username: info.username,
      nickname: info.nickname,
      port: info.port,
      map: info.map,
      sessionId: getPlaySession()
    });
    if (window.__bcsHb) clearInterval(window.__bcsHb);
    window.__bcsHb = setInterval(function () {
      track('heartbeat', {
        userId: info.userId,
        username: info.username,
        nickname: info.nickname,
        port: info.port,
        map: info.map,
        sessionId: getPlaySession()
      });
    }, 45000);
  };
  window.bcsTrackPlayEnd = function () {
    if (window.__bcsHb) { clearInterval(window.__bcsHb); window.__bcsHb = null; }
    track('play_end', { sessionId: getPlaySession() });
  };

  window.addEventListener('pagehide', function () {
    if (!getPlaySession()) return;
    try {
      var body = JSON.stringify({
        type: 'play_end',
        visitorId: getVisitorId(),
        sessionId: getPlaySession(),
        path: location.pathname
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API, new Blob([body], { type: 'application/json' }));
      }
    } catch (e) {}
  });

  // Watch for connectToServer calls
  function wrapConnect() {
    if (typeof window.connectToServer !== 'function') return false;
    if (window.connectToServer.__bcsWrapped) return true;
    var orig = window.connectToServer;
    window.connectToServer = function (port, mapName, isHost) {
      try {
        var nick = (window.localStorage && localStorage.getItem('cs_nickname')) || 'Player';
        var userId = null;
        var username = null;
        try {
          if (typeof window.getCurrentUser === 'function') {
            var u = window.getCurrentUser();
            if (u && u.id) { userId = u.id; username = (u.user_metadata && u.user_metadata.username) || nick; }
          }
        } catch (e) {}
        window.bcsTrackPlayStart({
          userId: userId,
          username: username,
          nickname: nick,
          port: port,
          map: mapName || 'de_dust2'
        });
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    window.connectToServer.__bcsWrapped = true;
    return true;
  }
  if (!wrapConnect()) {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (wrapConnect() || tries > 40) clearInterval(timer);
    }, 500);
  }

  // Player stats cards under visitors panel
  function renderPlayerStats(players) {
    if (!players || !players.today) return '';
    var t = players.today;
    var w = players.week || {};
    function card(label, value, foot) {
      return '<div class="ma-metric" data-tone="yellow"><div class="ma-metric-label">' + label +
        '</div><div class="ma-metric-value">' + (value ?? 0) + '</div>' +
        (foot ? '<div class="ma-metric-foot">' + foot + '</div>' : '') + '</div>';
    }
    var recent = (players.recent || []).slice(0, 12).map(function (e) {
      var kind = e.isRegistered ? 'KAYITLI' : 'MİSAFİR';
      var when = e.ts ? new Date(e.ts).toLocaleString('tr-TR') : '';
      return '<div style="display:flex;justify-content:space-between;gap:0.5rem;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.06);font-family:var(--font-hud);font-size:0.7rem;">' +
        '<span><b>' + (e.name || '—') + '</b> · ' + kind + ' · ' + (e.event || '') + '</span><span style="opacity:.65">' + when + '</span></div>';
    }).join('');

    return '<section class="ma-vis-panel" style="margin-top:1rem;">' +
      '<div class="ma-vis-panel-head"><h4 class="ma-vis-panel-title">OYUNCU GİRİŞ / OYUN İSTATİSTİKLERİ</h4>' +
      '<span class="ma-vis-panel-hint">Kayıtlı + kayıtsız</span></div>' +
      '<div class="ma-vis-kpi">' +
      card('BUGÜN GİRİŞ', t.uniqueLogins, (t.logins || 0) + ' oturum · ' + (t.registers || 0) + ' kayıt') +
      card('BUGÜN MİSAFİR', t.uniqueGuests, (t.guestJoins || 0) + ' katılım') +
      card('BUGÜN OYNAYAN', t.uniquePlayers, (t.playSessions || 0) + ' oturum') +
      card('KAYITLI OYUNCU', t.registeredPlayers, 'bugün') +
      card('KAYITSIZ OYUNCU', t.guestPlayers, 'bugün') +
      card('7 GÜN OYUNCU', w.uniquePlayers, (w.playSessions || 0) + ' oturum') +
      '</div>' +
      '<div style="margin-top:0.75rem;">' + (recent || '<div class="ma-vis-empty">Henüz oyuncu hareketi yok.</div>') + '</div>' +
      '</section>';
  }

  function enhanceVisitorStats() {
    var root = document.getElementById('admin-visitor-stats');
    if (!root || root.dataset.bcsPlayersHooked) return;
    var obs = new MutationObserver(function () {
      if (root.querySelector('[data-bcs-players]')) return;
      // After masterAdmin renders, fetch again is wasteful; parse from last response via interception
    });
    // Intercept visitor-stats fetch
    if (!window.__bcsFetchPatched) {
      window.__bcsFetchPatched = true;
      var ofetch = window.fetch;
      window.fetch = function () {
        var args = arguments;
        return ofetch.apply(this, args).then(function (res) {
          try {
            var url = String(args[0] || '');
            if (url.indexOf('/api/admin/visitor-stats') !== -1) {
              res.clone().json().then(function (data) {
                if (!data || !data.players) return;
                var el = document.getElementById('admin-visitor-stats');
                if (!el) return;
                setTimeout(function () {
                  if (el.querySelector('[data-bcs-players]')) {
                    el.querySelector('[data-bcs-players]').outerHTML = '<div data-bcs-players="1">' + renderPlayerStats(data.players) + '</div>';
                  } else {
                    var wrap = document.createElement('div');
                    wrap.setAttribute('data-bcs-players', '1');
                    wrap.innerHTML = renderPlayerStats(data.players);
                    el.appendChild(wrap);
                  }
                }, 50);
              }).catch(function () {});
            }
          } catch (e) {}
          return res;
        });
      };
    }
    obs.observe(root, { childList: true, subtree: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceVisitorStats);
  } else {
    enhanceVisitorStats();
  }
})();
