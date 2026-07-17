/** @module ui/hudBridge — scoreboard, tab, neon admin, text menu (WASM window bridges) */
window._browserCSScoreboardPinned = false;
window._browserCSScoreboardTabHeld = false;
/** Map change sonrası eski TeamScore / frag cache'ini DOM'a yazmayı engeller */
window._browserCSScoreResetUntil = 0;
window.__browserCSTabTrace = [];
let tabReleaseTimer = null;
const TAB_RELEASE_GRACE_MS = 140;

function isBrowserCSScoreResetActive() {
  return Date.now() < (window._browserCSScoreResetUntil || 0);
}

window.beginBrowserCSScoreReset = function (holdMs = 12000) {
  window._browserCSScoreResetUntil = Date.now() + Math.max(2000, holdMs | 0);
  if (typeof window.zeroBrowserCSScoreboard === 'function') {
    window.zeroBrowserCSScoreboard();
  }
};

function traceTab(event, detail = {}) {
  const entry = {
    at: new Date().toISOString(),
    event,
    held: !!window._browserCSScoreboardTabHeld,
    display: document.getElementById('custom-scoreboard')?.style.display || '',
    ...detail
  };
  window.__browserCSTabTrace.push(entry);
  if (window.__browserCSTabTrace.length > 80) {
    window.__browserCSTabTrace.shift();
  }
  // console.debug, Chrome'un Default levels görünümünde gizlenebiliyor.
  // Bu yüzden doğrudan log kullanıyoruz.
  console.log('[TAB_TRACE]', entry);
}

/*
 * HTML skorboard tek sahibi. TAB olayını capture aşamasında yalnızca oyun
 * canvas'ı aktifken tüketiyoruz; motora +showscores gönderilmiyor. Böylece iki
 * skorboard çakışmaz ve diğer tuşlar hiç etkilenmez.
 */
function configureHtmlScoreboardBinding() {
  if (typeof window.executeEngineCommand !== 'function' || !window.engineRunning) return;
  window.executeEngineCommand('unbind "TAB"');
  window.executeEngineCommand('bind "TAB" ""');
}

function isEditableTarget(node) {
  const tag = node?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || node?.isContentEditable;
}

function isGameInputActive() {
  if (!window.engineRunning) return false;
  if (isEditableTarget(document.activeElement)) return false;
  if (document.getElementById('console-panel')?.classList.contains('open')) return false;
  if (document.getElementById('esc-pause-menu')?.classList.contains('show')) return false;
  return true;
}

function showHtmlScoreboard() {
  if (tabReleaseTimer) {
    clearTimeout(tabReleaseTimer);
    tabReleaseTimer = null;
  }
  if (window._browserCSScoreboardTabHeld) {
    return;
  }
  window._browserCSScoreboardTabHeld = true;
  const scoreboard = document.getElementById('custom-scoreboard');
  if (scoreboard) scoreboard.style.display = 'flex';
  /*
   * Client DLL [BROWSERCS_SCOREBOARD] payload'ını +showscores akışında
   * üretiyor. Bunu sadece mantıksal ilk basışta gönderiyoruz; SDL'nin 60 FPS
   * sahte keyup/keydown döngüsünde tekrar çalışmaz.
   */
  try {
    window.executeEngineCommand?.('+showscores');
    window.executeEngineCommand?.('fullupdate');
  } catch (_) { /* ignore */ }
  traceTab('show');
  window.addConsoleLog?.('[Tab] Skorboard açıldı', 'ok');
}

function hideHtmlScoreboard() {
  if (tabReleaseTimer) {
    clearTimeout(tabReleaseTimer);
    tabReleaseTimer = null;
  }
  if (!window._browserCSScoreboardTabHeld) {
    traceTab('hide-skipped-not-held');
    return;
  }
  window._browserCSScoreboardTabHeld = false;
  if (window._browserCSScoreboardPinned) {
    traceTab('hide-skipped-pinned');
    return;
  }
  const scoreboard = document.getElementById('custom-scoreboard');
  if (scoreboard) scoreboard.style.display = 'none';
  try { window.executeEngineCommand?.('-showscores'); } catch (_) { /* ignore */ }
  traceTab('hide');
  window.addConsoleLog?.('[Tab] Skorboard kapandı', 'ok');
}

function scheduleHtmlScoreboardHide() {
  if (!window._browserCSScoreboardTabHeld || tabReleaseTimer) return;

  /*
   * Xash/SDL key state köprüsü TAB basılıyken 60 FPS civarında sahte
   * keyup → keydown çiftleri yayıyor. Fiziksel bırakış ancak yeni keydown
   * gelmediğinde anlaşılabilir. Yeni keydown bu zamanlayıcıyı iptal eder.
   */
  tabReleaseTimer = setTimeout(() => {
    tabReleaseTimer = null;
    hideHtmlScoreboard();
  }, TAB_RELEASE_GRACE_MS);
}

function interceptScoreboardTab(event) {
  if (event.key !== 'Tab' && event.code !== 'Tab' && event.keyCode !== 9) return;
  // TAB basılı kalmışsa, key repeat event'lerini her durumda yut. Aksi halde
  // browser/motor event'i tekrar alıp skorboard'u yeniden açmaya çalışır.
  const tabIsHeld = window._browserCSScoreboardTabHeld;
  if (!tabIsHeld && !isGameInputActive()) return;

  // Event canvas'a ulaşmaz; bu yüzden native +showscores tetiklenmez.
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.type === 'keydown') {
    // event.repeat tarayıcı/SDL katmanında güvenilir değil; kendi durumumuz
    // tek kaynak. İlk basış açar, basılı kalma hiçbir şey yapmaz.
    if (!tabIsHeld) showHtmlScoreboard();
    else if (tabReleaseTimer) {
      // SDL'nin sahte keyup'ından sonra gelen frame keydown'u.
      clearTimeout(tabReleaseTimer);
      tabReleaseTimer = null;
    }
  } else {
    scheduleHtmlScoreboardHide();
  }
}

window.addEventListener('keydown', interceptScoreboardTab, true);
window.addEventListener('keyup', interceptScoreboardTab, true);
window.addEventListener('blur', hideHtmlScoreboard);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hideHtmlScoreboard();
});

window.configureHtmlScoreboardBinding = configureHtmlScoreboardBinding;
// Eski çağrı noktalarıyla uyumluluk.
window.assertBrowserCSTabUnbound = configureHtmlScoreboardBinding;
window.restoreNativeScoreboardBinding = configureHtmlScoreboardBinding;
window.lockBrowserCSGameFocusTrap = () => {};

// Konsol yalnızca iki hotkey ile yönetilir; WASD/Tab ve diğer oyun tuşları
// bu listener tarafından asla tutulmaz.
window.addEventListener('keydown', (event) => {
  const isConsoleKey =
    event.key === 'F1' ||
    event.key === '`' ||
    event.key === '~' ||
    event.key === '<' ||
    event.code === 'Backquote';
  if (!isConsoleKey) return;
  if (!window.engineRunning || typeof window.toggleConsole !== 'function') return;

  // Konsol açıkken input focus'u doğal olarak consoleInput'tadır. Bu durum
  // hotkey'i devre dışı bırakmamalı; aynı tuş tekrar basıldığında kapatır.
  const consoleIsOpen = document.getElementById('console-panel')?.classList.contains('open');
  if (!consoleIsOpen && isEditableTarget(document.activeElement)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  window.toggleConsole();
}, true);

window.zeroBrowserCSScoreboard = function () {
  const sbCT = document.getElementById('sb-ct-list');
  const sbT = document.getElementById('sb-t-list');
  const ctScoreEl = document.getElementById('sb-ct-score');
  const tScoreEl = document.getElementById('sb-t-score');
  const sbSpecContainer = document.getElementById('sb-spec-container');
  if (ctScoreEl) ctScoreEl.textContent = '0';
  if (tScoreEl) tScoreEl.textContent = '0';
  if (sbCT) sbCT.innerHTML = '<tr><td colspan="4" style="padding:8px 10px; color:#555; text-align:center; font-size:0.75rem;">—</td></tr>';
  if (sbT) sbT.innerHTML = '<tr><td colspan="4" style="padding:8px 10px; color:#555; text-align:center; font-size:0.75rem;">—</td></tr>';
  if (sbSpecContainer) sbSpecContainer.style.display = 'none';
};

window.pinBrowserCSScoreboard = function (active, message) {
  window._browserCSScoreboardPinned = !!active;
  const sb = document.getElementById('custom-scoreboard');
  const banner = document.getElementById('sb-mapchange-banner');
  if (active) {
    window.beginBrowserCSScoreReset(15000);
    if (sb) sb.style.display = 'flex';
  } else {
    // Unpin sonrası motor hâlâ eski TeamScore gönderebilir — kısa süre daha sıfır tut
    window.beginBrowserCSScoreReset(8000);
  }
  if (banner) {
    banner.style.display = active ? 'block' : 'none';
    if (message) banner.textContent = message;
  }
  if (!active && sb && !window._browserCSScoreboardTabHeld) sb.style.display = 'none';
};

window._browserCSAdminNames = new Set();
let _adminJoinBannerTimer = null;

function normalizeAdminName(name) {
  return String(name || '')
    .replace(/★|☠|◆/g, '')
    .replace(/\[ADMIN\]/gi, '')
    .replace(/\bADMIN\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

window.setBrowserCSAdminNames = function (names) {
  window._browserCSAdminNames = new Set((names || []).map(normalizeAdminName).filter(Boolean));
};

window.isBrowserCSAdminName = function (name) {
  const n = normalizeAdminName(name);
  if (!n || !window._browserCSAdminNames) return false;
  return window._browserCSAdminNames.has(n);
};

let _browserCSPromoBannerTimer = null;
let _browserCSPromoLoopTimer = null;
let _lastAdminBannerAt = 0;
let _lastAdminBannerKey = '';
window._browserCSPendingAdminBanner = null;
window._browserCSPrevScoreNames = null;
window._browserCSNeonPort = null;

function isNeonReady() {
  const gw = document.getElementById('game-wrapper');
  if (!gw || !gw.classList.contains('active')) return false;
  const loading = document.getElementById('loading-overlay');
  if (loading && loading.classList.contains('active')) return false;
  return !!(window.BrowserCSReconnect?.sessionJoined || window._browserCSPrevScoreNames);
}

function mountNeonBanner(el) {
  if (!el) return null;
  if (el.parentElement !== document.body) document.body.appendChild(el);
  el.style.position = 'fixed';
  el.style.left = '0';
  el.style.right = '0';
  el.style.top = '0';
  el.style.bottom = 'auto';
  el.style.height = '28%';
  el.style.zIndex = '50000';
  el.style.pointerEvents = 'none';
  el.style.alignItems = 'flex-start';
  el.style.justifyContent = 'center';
  el.style.paddingTop = '3.2rem';
  el.style.background = 'transparent';
  return el;
}

function showNeonBanner(id) {
  if (!isNeonReady()) return null;
  const el = mountNeonBanner(document.getElementById(id));
  if (!el) return null;
  el.classList.remove('hiding');
  el.classList.add('show');
  el.style.display = 'flex';
  el.setAttribute('aria-hidden', 'false');
  return el;
}

function hideNeonBanner(el) {
  if (!el) return;
  el.classList.add('hiding');
  el.classList.remove('show');
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
  setTimeout(() => el.classList.remove('hiding'), 200);
}

window.showAdminJoinBanner = function (rawName) {
  const name = String(rawName || 'Admin').trim().replace(/^\[BROWSERCS_ADMIN_JOIN\]/i, '') || 'Admin';
  const key = normalizeAdminName(name);
  const now = Date.now();
  if (key && key === _lastAdminBannerKey && now - _lastAdminBannerAt < 12000) return;
  if (!isNeonReady()) {
    window._browserCSPendingAdminBanner = name;
    return;
  }
  const banner = document.getElementById('admin-join-banner');
  const nameEl = document.getElementById('admin-join-name');
  if (!banner || !nameEl) {
    window._browserCSPendingAdminBanner = name;
    return;
  }
  _lastAdminBannerKey = key;
  _lastAdminBannerAt = now;
  window._browserCSPendingAdminBanner = null;
  hideNeonBanner(document.getElementById('browsercs-promo-banner'));
  nameEl.textContent = name;
  if (!window._browserCSAdminNames) window._browserCSAdminNames = new Set();
  window._browserCSAdminNames.add(key);
  if (!showNeonBanner('admin-join-banner')) {
    window._browserCSPendingAdminBanner = name;
    return;
  }
  if (_adminJoinBannerTimer) clearTimeout(_adminJoinBannerTimer);
  _adminJoinBannerTimer = setTimeout(() => hideNeonBanner(banner), 3500);
};

window.flushPendingAdminBanner = function () {
  const pending = window._browserCSPendingAdminBanner;
  if (pending && isNeonReady()) {
    setTimeout(() => {
      if (typeof window.showAdminJoinBanner === 'function') window.showAdminJoinBanner(pending);
    }, 400);
  }
};

window.showBrowserCSPromoBanner = function (title) {
  if (!isNeonReady()) return;
  const admin = document.getElementById('admin-join-banner');
  if (admin && admin.classList.contains('show')) return;
  const el = document.getElementById('browsercs-promo-banner');
  const titleEl = document.getElementById('browsercs-promo-title');
  if (!el || !titleEl) return;
  if (el.classList.contains('show') && el.style.display !== 'none') return;
  titleEl.textContent = String(title || 'BROWSERCS 1.5').trim() || 'BROWSERCS 1.5';
  if (!showNeonBanner('browsercs-promo-banner')) return;
  if (_browserCSPromoBannerTimer) clearTimeout(_browserCSPromoBannerTimer);
  _browserCSPromoBannerTimer = setTimeout(() => hideNeonBanner(el), 3200);
};

window.startBrowserCSPromoLoop = function (port) {
  window._browserCSNeonPort = port || window._browserCSNeonPort;
  if (_browserCSPromoLoopTimer) clearInterval(_browserCSPromoLoopTimer);
  setTimeout(() => {
    if (isNeonReady()) window.showBrowserCSPromoBanner('BROWSERCS 1.5');
  }, 25000);
  _browserCSPromoLoopTimer = setInterval(() => {
    if (isNeonReady()) window.showBrowserCSPromoBanner('BROWSERCS 1.5');
  }, 300000);
};

window.stopBrowserCSPromoLoop = function () {
  if (_browserCSPromoLoopTimer) { clearInterval(_browserCSPromoLoopTimer); _browserCSPromoLoopTimer = null; }
  if (_browserCSPromoBannerTimer) { clearTimeout(_browserCSPromoBannerTimer); _browserCSPromoBannerTimer = null; }
  if (_adminJoinBannerTimer) { clearTimeout(_adminJoinBannerTimer); _adminJoinBannerTimer = null; }
  hideNeonBanner(document.getElementById('admin-join-banner'));
  hideNeonBanner(document.getElementById('browsercs-promo-banner'));
  window._browserCSPrevScoreNames = null;
};

function detectAdminJoinFromScoreboard(players) {
  if (!Array.isArray(players)) return;
  const names = new Set(players.map((p) => normalizeAdminName(p.name)).filter(Boolean));
  const prev = window._browserCSPrevScoreNames;
  if (prev) {
    for (const p of players) {
      const n = normalizeAdminName(p.name);
      if (!n || !window.isBrowserCSAdminName(p.name)) continue;
      if (!prev.has(n)) {
        window.showAdminJoinBanner(p.name);
        break;
      }
    }
  } else if (window._browserCSPendingAdminBanner) {
    window.flushPendingAdminBanner();
  }
  window._browserCSPrevScoreNames = names;
}

export function isBrowserCSProtocolLog(log) {
  if (typeof log !== 'string') return false;
  return /\[BROWSERCS_(ADMINS|ADMIN_JOIN|PROMO|SCOREBOARD|HIDE_SCOREBOARD|TEXTMENU|TEXTMENU_CLOSE)\]/i.test(log);
}

function extractBrowserCSMarkerPayload(log, marker) {
  if (typeof log !== 'string') return null;
  const token = `[${marker}]`;
  let idx = log.indexOf(token);
  if (idx >= 0) {
    return log.slice(idx + token.length).replace(/^"+|"+$/g, '').trim().split(/[\r\n]/)[0].replace(/^"+|"+$/g, '').trim();
  }
  const pipe = log.match(new RegExp(`${marker}\\|(.+)$`, 'i'));
  if (pipe) return pipe[1].replace(/^"+|"+$/g, '').trim();
  const colon = log.match(new RegExp(`${marker}[:\\s]+(.+)$`, 'i'));
  return colon ? colon[1].replace(/^"+|"+$/g, '').trim() : null;
}

export function handleBrowserCSAdminLog(log) {
  if (typeof log !== 'string') return false;
  if (/BROWSERCS_ADMIN_JOIN/i.test(log)) {
    const payload = extractBrowserCSMarkerPayload(log, 'BROWSERCS_ADMIN_JOIN');
    if (payload) window.showAdminJoinBanner(payload);
    return true;
  }
  const joinMatch = log.match(/\*\s*(.+?)\s+admin\s+giri[sş]\s+yapt[iı]/i);
  if (joinMatch && joinMatch[1]) {
    const name = joinMatch[1].trim();
    if (name && !/BROWSERCS/i.test(name)) {
      window.showAdminJoinBanner(name);
      return false;
    }
  }
  if (/BROWSERCS_PROMO/i.test(log)) {
    const title = extractBrowserCSMarkerPayload(log, 'BROWSERCS_PROMO');
    window.showBrowserCSPromoBanner(title || 'BROWSERCS 1.5');
    return true;
  }
  if (/BROWSERCS_ADMINS/i.test(log)) {
    const raw = extractBrowserCSMarkerPayload(log, 'BROWSERCS_ADMINS') || '';
    const names = raw ? raw.split(',').map((s) => s.trim().replace(/^"+|"+$/g, '')).filter(Boolean) : [];
    window.setBrowserCSAdminNames(names);
    return true;
  }
  return false;
}

window.updateBrowserCSScoreboard = function (playersJson, serverName, localPlayerId, teamsJson) {
  try {
    window._browserCSScoreboardSeen = true;
    window._browserCSInGameFlag = true;
    // Bu bridge sunucudan sık sık çağrılır. Her çağrıda connected() çalıştırmak
    // TAB bind'ini tekrar yazıp input döngüsünü bozuyordu.
    if (window.BrowserCSReconnect?.reconnecting) {
      window.BrowserCSReconnect.connected();
    }
    const rawPlayers = JSON.parse(playersJson).filter((p) => {
      const name = String(p.name || '').trim();
      const lower = name.toLowerCase();
      return !(!name || lower === 'unnamed' || lower === 'unnamed player');
    });
    let teams = [];
    if (teamsJson) {
      try { teams = JSON.parse(teamsJson); } catch (_) {}
    }

    const forceReset =
      isBrowserCSScoreResetActive() || !!window._browserCSScoreboardPinned;
    const players = forceReset
      ? rawPlayers.map((p) => ({ ...p, frags: 0, deaths: 0 }))
      : rawPlayers;

    const ctScoreEl = document.getElementById('sb-ct-score');
    const tScoreEl = document.getElementById('sb-t-score');

    // Map transition: skorboard kapalı olsa bile CT/T skorunu 0'da tut
    // (eski fix erken return yüzünden DOM'da eski skor kalıyordu)
    if (forceReset) {
      if (ctScoreEl) ctScoreEl.textContent = '0';
      if (tScoreEl) tScoreEl.textContent = '0';
    }

    const sbContainer = document.getElementById('custom-scoreboard');
    const sbVisible = !!(
      sbContainer &&
      (window._browserCSScoreboardPinned ||
        window._browserCSScoreboardTabHeld ||
        sbContainer.style.display === 'flex')
    );
    // Skorboard kapalıyken pahalı DOM/admin işi yapma (sık gelen bridge çağrıları)
    if (!sbVisible) {
      try { detectAdminJoinFromScoreboard(rawPlayers); } catch (_) {}
      return;
    }
    try { detectAdminJoinFromScoreboard(rawPlayers); } catch (_) {}
    if (typeof window.flushPendingAdminBanner === 'function') window.flushPendingAdminBanner();

    const sbServerName = document.getElementById('sb-server-name');
    const sbCT = document.getElementById('sb-ct-list');
    const sbT = document.getElementById('sb-t-list');
    const sbSpec = document.getElementById('sb-spec-list');
    const sbSpecContainer = document.getElementById('sb-spec-container');
    if (!sbCT || !sbT) return;
    if (sbServerName) sbServerName.textContent = serverName || 'BrowserCS';

    const makeRow = (p) => {
      const isLocal = p.id === localPlayerId || p.local;
      const isDead = p.dead === 1;
      const isAdmin = window.isBrowserCSAdminName(p.name);
      let name = p.name;
      if (isAdmin) name = `◆ ${name}`;
      if (isLocal) name = `★ ${name}`;
      if (isDead) name = `☠ ${name}`;
      return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04); ${isAdmin ? 'background:rgba(57,255,20,0.10);' : (isLocal ? 'background:rgba(255,200,0,0.08);' : '')} ${isDead ? 'opacity: 0.5;' : 'opacity: 1;'}">
        <td style="padding:6px 10px; font-weight:${isLocal || isAdmin ? '700' : '400'}; color:${isDead ? '#aaa' : (isAdmin ? '#39ff14' : (isLocal ? '#ffd700' : '#eee'))};">${name}${isAdmin ? '<span style="margin-left:6px;font-size:0.62rem;letter-spacing:0.12em;color:#39ff14;text-shadow:0 0 8px rgba(57,255,20,0.7);font-weight:700;">ADMIN</span>' : ''}</td>
        <td style="padding:6px 10px; text-align:center; color:#4caf50;">${p.frags ?? 0}</td>
        <td style="padding:6px 10px; text-align:center; color:#ef5350;">${p.deaths ?? 0}</td>
        <td style="padding:6px 10px; text-align:center; color:#90caf9;">${p.ping ?? 0}</td>
      </tr>`;
    };

    const byFrag = (a, b) => ((b.frags ?? 0) !== (a.frags ?? 0) ? (b.frags ?? 0) - (a.frags ?? 0) : (a.deaths ?? 0) - (b.deaths ?? 0));
    const ct = players.filter((p) => {
      const team = (p.team || '').toLowerCase();
      return team === 'ct' || team === 'counter-terrorist' || team === 'counterterrorist';
    }).sort(byFrag);
    const t = players.filter((p) => {
      const team = (p.team || '').toLowerCase();
      return team === 'terrorist' || team === 't';
    }).sort(byFrag);
    const spec = players.filter((p) => !ct.includes(p) && !t.includes(p)).sort(byFrag);

    sbCT.innerHTML = ct.length ? ct.map(makeRow).join('') : '<tr><td colspan="4" style="padding:8px 10px; color:#555; text-align:center; font-size:0.75rem;">—</td></tr>';
    sbT.innerHTML = t.length ? t.map(makeRow).join('') : '<tr><td colspan="4" style="padding:8px 10px; color:#555; text-align:center; font-size:0.75rem;">—</td></tr>';

    const ctCount = document.getElementById('sb-ct-count');
    const tCount = document.getElementById('sb-t-count');
    if (ctCount) ctCount.textContent = `(${ct.length} Oyuncu)`;
    if (tCount) tCount.textContent = `(${t.length} Oyuncu)`;

    if (forceReset) {
      if (ctScoreEl) ctScoreEl.textContent = '0';
      if (tScoreEl) tScoreEl.textContent = '0';
    } else {
      const activity = rawPlayers.reduce(
        (sum, p) => sum + Math.abs(p.frags || 0) + Math.abs(p.deaths || 0),
        0
      );
      if (rawPlayers.length > 0 && activity === 0) {
        if (ctScoreEl) ctScoreEl.textContent = '0';
        if (tScoreEl) tScoreEl.textContent = '0';
      } else if (teams && teams.length > 0) {
        const ctTeam = teams.find((x) => x.name && x.name.toUpperCase() === 'CT');
        const tTeam = teams.find((x) => x.name && x.name.toUpperCase() === 'TERRORIST');
        if (ctScoreEl && ctTeam) ctScoreEl.textContent = ctTeam.score;
        if (tScoreEl && tTeam) tScoreEl.textContent = tTeam.score;
      }
    }

    if (spec.length > 0) {
      sbSpecContainer.style.display = 'block';
      sbSpec.innerHTML = spec.map((p) =>
        window.isBrowserCSAdminName(p.name)
          ? `<span style="color:#39ff14;text-shadow:0 0 6px rgba(57,255,20,0.5);">◆ ${p.name} <small>ADMIN</small></span>`
          : p.name
      ).join(', ');
    } else if (sbSpecContainer) {
      sbSpecContainer.style.display = 'none';
    }
  } catch (err) {
    console.error('[Scoreboard] Parse error:', err);
  }
};

window._browserCSIsAppearanceMenu = function (title) {
  return /tip(inizi|i)|model|appearance|terorist tipi|ct tipi|terrorist_select|ct_select/i.test(title);
};

window._browserCSAppearanceTeam = function (title, itemLines) {
  const blob = `${title}\n${(itemLines || []).join('\n')}`.toLowerCase();
  if (/seal team|gsg-9|gsg9|sas|gign|devgru|alman|ingiliz|fransiz|ct_select/.test(blob)) return 'CT';
  /phoenix|l337|arctic|guerilla|gorilla|terrorist_select|terorist/.test(blob);
  return 'T';
};

window._browserCSModelFromSlot = function (team, slot) {
  const tModels = ['terror', 'leet', 'arctic', 'guerilla'];
  const ctModels = ['urban', 'gsg9', 'sas', 'gign'];
  if (slot < 1 || slot > 4) return null;
  return team === 'CT' ? ctModels[slot - 1] : tModels[slot - 1];
};

window._browserCSIsAutoSelectItem = function (slotNum, slotText) {
  if (slotNum !== 5 && slotNum !== 6) return false;
  const t = slotText.toLowerCase();
  return t.includes('otomatik') || t.includes('auto');
};

window._browserCSSelectAppearance = function (slotNum, team) {
  const model = window._browserCSModelFromSlot(team, slotNum);
  if (model) {
    window._browserCSPreferredModel = model;
    try { sessionStorage.setItem('browsercs_player_model', model); } catch (_) {}
  }
  if (typeof window.executeEngineCommand === 'function') {
    window.executeEngineCommand(`menuselect ${slotNum}`);
  }
};

window._browserCSRenderTextMenuItem = function ({ tm, titleStr, itemLines, slotNum, slotText, bitCheck }) {
  const isAppearance = window._browserCSIsAppearanceMenu(titleStr);
  if (isAppearance && window._browserCSIsAutoSelectItem(slotNum, slotText)) {
    const bit = slotNum === 0 ? 512 : (1 << (slotNum - 1));
    window.textMenuSlots &= ~bit;
    return null;
  }
  const el = document.createElement('div');
  el.className = 'textmenu-item';
  el.innerHTML = `<span class="textmenu-key">${slotNum === 0 ? '0' : slotNum}</span> <span>${slotText}</span>`;
  if (window.textMenuSlots & bitCheck) {
    el.onclick = () => {
      if (isAppearance && slotNum >= 1 && slotNum <= 4) {
        const team = window._browserCSAppearanceTeam(titleStr, itemLines);
        window._browserCSSelectAppearance(slotNum, team);
      } else if (window.executeEngineCommand) {
        window.executeEngineCommand(`menuselect ${slotNum}`);
      }
      if (tm) tm.style.display = 'none';
    };
  } else {
    el.style.opacity = '0.4';
    el.style.cursor = 'not-allowed';
  }
  return el;
};

window._openTextMenu = function (slots, raw) {
  try {
    window.textMenuSlots = slots;
    const tm = document.getElementById('custom-textmenu');
    const titleEl = document.getElementById('textmenu-title');
    const itemsEl = document.getElementById('textmenu-items');
    if (!tm || !titleEl || !itemsEl) return;
    itemsEl.innerHTML = '';
    const lines = raw.replace(/\\n/g, '\n').split('\n');
    let titleStr = lines[0] || 'MENU';
    titleStr = titleStr.replace(/\\[ywrdb]/g, '').trim();
    titleEl.innerText = titleStr;
    const itemLines = lines.slice(1);
    for (let i = 1; i < lines.length; i++) {
      let line = lines[i].trim();
      if (!line) continue;
      line = line.replace(/\\[ywrdb]/g, '').trim();
      const match = line.match(/^(\d+)\.\s*(.*)/);
      if (match) {
        const slotNum = parseInt(match[1], 10);
        const slotText = match[2];
        const lower = slotText.toLowerCase();
        if (lower.includes('famas') || lower.includes('galil') || lower.includes('clarion') || lower.includes('defender') || lower.includes('shield')) {
          const bit = slotNum === 0 ? 512 : (1 << (slotNum - 1));
          window.textMenuSlots &= ~bit;
          continue;
        }
        const bitCheck = slotNum === 0 ? 512 : (1 << (slotNum - 1));
        const btn = window._browserCSRenderTextMenuItem({
          tm, titleStr, itemLines, slotNum, slotText, bitCheck
        });
        if (btn) itemsEl.appendChild(btn);
      } else {
        const div = document.createElement('div');
        div.className = 'menu-item';
        div.style.color = 'var(--text-dim)';
        div.style.fontSize = '0.7rem';
        div.style.padding = '0.2rem 0';
        div.innerText = line;
        itemsEl.appendChild(div);
      }
    }
    if (typeof window.__bcsDebugLog === 'function') window.__bcsDebugLog('[DEBUG] Opening HTML Text Menu:', titleStr);
    tm.style.display = 'flex';
    if (window.BrowserCSReconnect) window.BrowserCSReconnect.connected();
    if (typeof window.flushPendingAdminBanner === 'function') window.flushPendingAdminBanner();
  } catch (err) {
    console.error('Textmenu parse error', err);
  }
};

window._closeTextMenu = function () {
  const tm = document.getElementById('custom-textmenu');
  if (tm) tm.style.display = 'none';
  window.textMenuSlots = 0;
};
