/**
 * BrowserCS clan tag cancel fix
 *
 * Live F3 only sends `say /clantag` and never clears the HTML scoreboard
 * overlay. Empty clanTag was also coerced back to [BCS] for Platinum
 * (`t || "[BCS]"`).
 *
 * Load AFTER the game bundle (oyna-*.js).
 */
(function () {
  'use strict';

  if (window.__bcsClantagFixInstalled) return;
  window.__bcsClantagFixInstalled = true;

  function normalizeVipName(name) {
    return String(name || '')
      .replace(/★|☠|◆|♛/g, '')
      .replace(/\[vip\]|\[bcs\]/gi, '')
      .replace(/_vip_/gi, '')
      .replace(/_bcs_/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function localKey() {
    return normalizeVipName(window._browserCSLocalPlayerName || '');
  }

  function syncTierClanTag(name, clanTag) {
    try {
      const key = normalizeVipName(name) || localKey();
      if (!key) return;
      const map = window._browserCSVipTiers || new Map();
      const prev = map.get(key) || {};
      const tier =
        prev.tier ||
        (window._browserCSLocalVipOverlay && window._browserCSLocalVipOverlay.tier) ||
        'platinum';
      map.set(key, { tier: tier, clanTag: clanTag || '' });
      window._browserCSVipTiers = map;
    } catch (e) { /* ignore */ }
  }

  function isClanTagOn() {
    if (typeof window._browserCSClanTagActive === 'boolean') {
      return window._browserCSClanTagActive;
    }
    try {
      const ov = window._browserCSLocalVipOverlay;
      if (ov && Object.prototype.hasOwnProperty.call(ov, 'clanTag')) {
        return !!ov.clanTag;
      }
      const me = localKey();
      const entry = me && window._browserCSVipTiers && window._browserCSVipTiers.get(me);
      if (entry) return !!entry.clanTag;
      // Platinum VIP defaults to tag ON after F2
      if (window._browserCSVipModeActive && ov &&
          String(ov.tier || '').toLowerCase() === 'platinum') {
        return true;
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  function setLocalClanTag(on) {
    window._browserCSClanTagActive = !!on;
    const tag = on ? '[BCS]' : '';
    const ov = window._browserCSLocalVipOverlay;
    const name = (ov && ov.name) || window._browserCSLocalPlayerName || '';
    const tier = (ov && ov.tier) || 'platinum';

    if (ov) {
      ov.clanTag = tag;
    } else if (window._browserCSVipModeActive) {
      window._browserCSLocalVipOverlay = {
        tier: String(tier).toLowerCase(),
        name: name,
        clanTag: tag
      };
    }

    syncTierClanTag(name, tag);
    return tag;
  }

  function patchSetLocalVipOverlay() {
    const orig = window.setBrowserCSLocalVipOverlay;
    if (typeof orig !== 'function' || orig.__bcsClanPatched) return;
    function patched(tier, name, clanTag) {
      if (arguments.length >= 3) {
        const tag = String(clanTag || '');
        // Original cannot store empty tag for platinum (`t || "[BCS]"`).
        orig.call(this, tier, name, tag || '\u0001');
        if (window._browserCSLocalVipOverlay) {
          window._browserCSLocalVipOverlay.clanTag = tag;
        }
        syncTierClanTag(name || (window._browserCSLocalVipOverlay && window._browserCSLocalVipOverlay.name), tag);
        window._browserCSClanTagActive = !!tag;
        return;
      }
      const ret = orig.apply(this, arguments);
      try {
        const ov = window._browserCSLocalVipOverlay;
        if (ov && String(ov.tier || '').toLowerCase() === 'platinum' &&
            typeof window._browserCSClanTagActive !== 'boolean') {
          window._browserCSClanTagActive = !!ov.clanTag;
        }
      } catch (e) { /* ignore */ }
      return ret;
    }
    patched.__bcsClanPatched = true;
    patched.__bcsOrig = orig;
    window.setBrowserCSLocalVipOverlay = patched;
  }

  function patchGetClanTag() {
    const orig = window.getBrowserCSVipClanTag;
    if (typeof orig !== 'function' || orig.__bcsClanPatched) return;
    function patched(name) {
      try {
        const key = normalizeVipName(name);
        const me = localKey();
        if (key && me && key === me && typeof window._browserCSClanTagActive === 'boolean') {
          return window._browserCSClanTagActive ? '[BCS]' : '';
        }
        const entry = window._browserCSVipTiers && window._browserCSVipTiers.get(key);
        if (entry) return entry.clanTag || '';
      } catch (e) { /* fall through */ }
      return orig.call(this, name);
    }
    patched.__bcsClanPatched = true;
    window.getBrowserCSVipClanTag = patched;
  }

  function patchSetVipTiers() {
    const orig = window.setBrowserCSVipTiers;
    if (typeof orig !== 'function' || orig.__bcsClanPatched) return;
    function patched(list) {
      const ret = orig.apply(this, arguments);
      try {
        const me = localKey();
        const entry = me && window._browserCSVipTiers && window._browserCSVipTiers.get(me);
        if (entry && typeof window._browserCSClanTagActive === 'boolean') {
          if (window._browserCSLocalVipOverlay) {
            window._browserCSLocalVipOverlay.clanTag = window._browserCSClanTagActive ? '[BCS]' : '';
          }
          window._browserCSVipTiers.set(me, {
            tier: entry.tier,
            clanTag: window._browserCSClanTagActive ? '[BCS]' : ''
          });
        } else if (entry) {
          window._browserCSClanTagActive = !!entry.clanTag;
          if (window._browserCSLocalVipOverlay) {
            window._browserCSLocalVipOverlay.clanTag = entry.clanTag || '';
          }
        }
      } catch (e) { /* ignore */ }
      return ret;
    }
    patched.__bcsClanPatched = true;
    window.setBrowserCSVipTiers = patched;
  }

  var _toggleLock = false;
  function toggleLocalFromClantagCommand() {
    // Avoid double-fire if raw bridge also calls executeEngineCommand.
    if (_toggleLock) return;
    _toggleLock = true;
    try {
      const next = !isClanTagOn();
      setLocalClanTag(next);
      if (typeof window.notify === 'function') {
        window.notify(
          next ? 'Clan tag: AÇIK [BCS] (F3)' : 'Clan tag: KAPALI / iptal (F3)',
          next ? 'info' : 'warn'
        );
      }
      try {
        console.log('[bcs-clantag] toggle', { active: next });
      } catch (e) { /* ignore */ }
    } finally {
      _toggleLock = false;
    }
  }

  function isClantagCmd(cmd) {
    const o = String(cmd || '').trim().toLowerCase();
    return o === 'say /clantag' || o === 'say_team /clantag' || o === '/clantag';
  }

  function patchExecuteEngineCommand() {
    const orig = window.executeEngineCommand;
    if (typeof orig !== 'function' || orig.__bcsClanPatched) return false;
    function patched(cmd) {
      try {
        if (isClantagCmd(cmd)) toggleLocalFromClantagCommand();
      } catch (e) { /* ignore */ }
      return orig.apply(this, arguments);
    }
    patched.__bcsClanPatched = true;
    window.executeEngineCommand = patched;
    return true;
  }

  function patchRawBridge() {
    const orig = window.__bcsRunEngineCommandRaw;
    if (typeof orig !== 'function' || orig.__bcsClanPatched) return false;
    function patched(cmd) {
      try {
        if (isClantagCmd(cmd)) toggleLocalFromClantagCommand();
      } catch (e) { /* ignore */ }
      return orig.apply(this, arguments);
    }
    patched.__bcsClanPatched = true;
    window.__bcsRunEngineCommandRaw = patched;
    return true;
  }

  function installPatches() {
    patchSetLocalVipOverlay();
    patchGetClanTag();
    patchSetVipTiers();
    patchExecuteEngineCommand();
    patchRawBridge();
  }

  installPatches();
  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    installPatches();
    if (tries >= 40) clearInterval(timer);
  }, 500);

  try {
    console.log('[bcs-clantag] cancel/toggle patch installed');
  } catch (e) { /* ignore */ }
})();
