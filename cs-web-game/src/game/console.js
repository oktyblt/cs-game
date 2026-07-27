/** @module game/console */
import { $, notify } from '../dom.js';
import { state } from './state.js';

const consolePanel = $('console-panel');
const consoleLog = $('console-log');
const consoleInput = $('console-input');
const btnConsole = $('btn-console');
const btnCopyConsole = $('btn-copy-console');
const btnDownloadQConsole = $('btn-download-qconsole');

// ─── Konsol ───────────────────────────────────────────────────────────────────

const CONSOLE_TERMS = [
  'amx_banmenu', 'amx_cfg', 'amx_help', 'amx_kickmenu', 'amx_mapmenu', 'amx_modules',
  'amx_plugins', 'amx_slapmenu', 'amx_teammenu', 'amx_votemap', 'amx_who', 'amxmodmenu',
  'alias', 'bind', 'changelevel', 'clear', 'cl_crosshair_color', 'cl_crosshair_size',
  'cl_cmdrate', 'cl_dynamiccrosshair', 'cl_interp', 'cl_lw', 'cl_updaterate', 'cmdlist',
  'connect', 'con_color', 'crosshair', 'cvarlist', 'developer', 'disconnect', 'echo',
  'exec', 'exit', 'find', 'fps_max', 'fov', 'gl_fog', 'gl_max_size', 'gl_vsync',
  'help', 'hisound', 'host_framerate', 'host_limitlocal', 'hud_centerid', 'hud_draw',
  'hud_fastswitch', 'kill', 'lookstrafe', 'map', 'motd', 'm_filter', 'm_forward',
  'm_pitch', 'm_side', 'm_yaw', 'name', 'net_graph', 'net_graphpos', 'net_graphwidth',
  'pause', 'play', 'quit', 'rate', 'rcon', 'rcon_password', 'reload', 'restart',
  'retry', 'say', 'say_team', 'sensitivity', 'set', 'seta', 'setinfo', 'spk',
  'status', 'stopsound', 'stop', 'sv_accelerate', 'sv_airaccelerate', 'sv_alltalk',
  'sv_allowdownload', 'sv_allowupload', 'sv_cheats', 'sv_friction', 'sv_gravity',
  'sv_maxrate', 'sv_maxspeed', 'sv_maxupdaterate', 'sv_minrate', 'sv_proxies',
  'sv_restart', 'sv_restartround', 'sv_stopspeed', 'sv_voiceenable', 'timeleft',
  'topcolor', 'bottomcolor', 'unbind', 'unbindall', 'unpause', 'volume', 'votemap',
  'wait', 'writecfg', 'zoom_sensitivity_ratio',
  'mp_autokick', 'mp_autoteambalance', 'mp_buytime', 'mp_c4timer', 'mp_chattime',
  'mp_flashlight', 'mp_footsteps', 'mp_forcecamera', 'mp_forcechasecam', 'mp_friendlyfire',
  'mp_freezetime', 'mp_limitteams', 'mp_logdetail', 'mp_logmessages', 'mp_maxrounds',
  'mp_roundtime', 'mp_startmoney', 'mp_timelimit', 'mp_winlimit',
  'password', 'model'
];

const consoleCmdHistory = [];
let consoleHistoryBrowseIndex = -1;
let consoleHistoryDraft = '';
let consoleTabCycle = { token: '', matchesKey: '', index: -1 };

export function consoleCommonPrefix(strings) {
  if (!strings.length) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    while (
      prefix &&
      !strings[i].toLowerCase().startsWith(prefix.toLowerCase())
    ) {
      prefix = prefix.slice(0, -1);
    }
  }
  return prefix;
}

export function getConsoleCompletionPool() {
  return [...new Set([...CONSOLE_TERMS, ...consoleCmdHistory])].sort();
}

export function pushConsoleHistory(cmd) {
  const trimmed = String(cmd || '').trim();
  if (!trimmed) return;
  if (consoleCmdHistory[0] !== trimmed) {
    consoleCmdHistory.unshift(trimmed);
    if (consoleCmdHistory.length > 50) {
      consoleCmdHistory.pop();
    }
  }
  consoleHistoryBrowseIndex = -1;
  consoleHistoryDraft = '';
}

export function handleConsoleHistoryNav(input, direction) {
  if (!consoleCmdHistory.length) return;

  if (consoleHistoryBrowseIndex === -1) {
    consoleHistoryDraft = input.value;
  }

  const nextIndex = consoleHistoryBrowseIndex + direction;
  if (nextIndex < -1 || nextIndex >= consoleCmdHistory.length) {
    return;
  }

  consoleHistoryBrowseIndex = nextIndex;
  input.value =
    consoleHistoryBrowseIndex === -1
      ? consoleHistoryDraft
      : consoleCmdHistory[consoleHistoryBrowseIndex];

  const pos = input.value.length;
  input.setSelectionRange(pos, pos);
  consoleTabCycle = { token: '', matchesKey: '', index: -1 };
}

export function handleConsoleTabComplete(input, reverse) {
  const pos = input.selectionStart ?? input.value.length;
  const value = input.value;
  const before = value.slice(0, pos);
  const tokenStart = before.lastIndexOf(' ') + 1;
  const token = before.slice(tokenStart);
  const after = value.slice(pos);
  const matches = getConsoleCompletionPool().filter((term) =>
    term.toLowerCase().startsWith(token.toLowerCase())
  );

  if (!matches.length) {
    return;
  }

  const matchesKey = matches.join('\0');
  if (
    consoleTabCycle.token !== token ||
    consoleTabCycle.matchesKey !== matchesKey
  ) {
    consoleTabCycle = { token, matchesKey, index: -1 };
  }

  consoleTabCycle.index =
    (consoleTabCycle.index + (reverse ? -1 : 1) + matches.length) %
    matches.length;

  let replacement = matches[consoleTabCycle.index];
  if (matches.length > 1 && token.length > 0) {
    const prefix = consoleCommonPrefix(matches);
    if (prefix.length > token.length && consoleTabCycle.index === 0) {
      replacement = prefix;
    }
  }

  const isFirstToken = tokenStart === 0;
  const addSpace =
    isFirstToken &&
    replacement.length > token.length &&
    !after.startsWith(' ');

  const newBefore =
    value.slice(0, tokenStart) + replacement + (addSpace ? ' ' : '');
  input.value = newBefore + after;

  const newPos = newBefore.length;
  input.setSelectionRange(newPos, newPos);
}

export function toggleConsole(forceOpen) {
  if (typeof forceOpen === 'boolean') {
    state.consoleOpen = forceOpen;
  } else {
    state.consoleOpen = !state.consoleOpen;
  }
  if (!consolePanel) return;
  consolePanel.classList.toggle('open', state.consoleOpen);
  const escMenu = document.getElementById('esc-pause-menu');
  if (state.consoleOpen) {
    try { document.exitPointerLock(); } catch (e) { /* ignore */ }
    if (escMenu) escMenu.classList.remove('show');
    if (consoleInput) {
      setTimeout(() => {
        consoleInput.focus();
        consoleInput.select();
      }, 50);
    }
  } else {
    if (consoleInput) consoleInput.blur();
    if (state.engineRunning) {
      const canvas = document.getElementById('canvas');
      if (canvas) canvas.focus();
    }
  }
}

window.toggleConsole = toggleConsole;
window.openConsolePanel = () => toggleConsole(true);
window.closeConsolePanel = () => toggleConsole(false);

if (consoleInput) {
  consoleInput.addEventListener('keydown', (e) => {
    e.stopPropagation();

    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = consoleInput.value.trim();
      if (cmd && state.xash) {
        pushConsoleHistory(cmd);
        if (typeof window.addConsoleLog === 'function') {
          window.addConsoleLog(`] ${cmd}`, 'ok');
        }
        if (typeof window.executeEngineCommand === 'function') {
          window.executeEngineCommand(cmd);
        }
        consoleInput.value = '';
        consoleTabCycle = { token: '', matchesKey: '', index: -1 };
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleConsoleTabComplete(consoleInput, e.shiftKey);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleConsoleHistoryNav(consoleInput, 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleConsoleHistoryNav(consoleInput, -1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      toggleConsole(false);
    } else {
      consoleTabCycle = { token: '', matchesKey: '', index: -1 };
    }
  });
}

if (consolePanel) {
  consolePanel.addEventListener('mousedown', (e) => {
    if (e.target === consoleInput) return;
    if (consoleInput && state.consoleOpen) consoleInput.focus();
  });
}

if (btnConsole) {
  btnConsole.addEventListener('click', () => {
    toggleConsole();
  });
}

btnCopyConsole.addEventListener('click', () => {
  const lines = Array.from(consoleLog.querySelectorAll('.log-line'))
    .map(el => el.textContent)
    .join('\n');
  navigator.clipboard.writeText(lines)
    .then(() => notify('Konsol logları panoya kopyalandı!', 'success'))
    .catch(() => notify('Loglar kopyalanamadı!', 'error'));
});

btnDownloadQConsole.addEventListener('click', () => {
  if (!state.xash || !state.xash.em) {
    notify('Oyun henüz başlatılmadı!', 'error');
    return;
  }
  try {
    const em = state.xash.em;
    let logContent = null;
    const pathsToTry = [
      '/cstrike/qconsole.log',
      '/rwdir/cstrike/qconsole.log',
      '/qconsole.log',
      '/valve/qconsole.log',
      '/rwdir/valve/qconsole.log'
    ];
    for (const p of pathsToTry) {
      try {
        logContent = em.FS.readFile(p, { encoding: 'utf8' });
        if (logContent) {
          console.log(`[Console Log] Found qconsole.log at ${p}`);
          break;
        }
      } catch (e) { }
    }
    if (!logContent) {
      const FS = em.FS || (em.Module && em.Module.FS);
      if (FS) {
        for (const p of pathsToTry) {
          try {
            logContent = FS.readFile(p, { encoding: 'utf8' });
            if (logContent) break;
          } catch (e) { }
        }
      }
    }
    if (!logContent) {
      notify('qconsole.log bulunamadı veya henüz yazılmadı!', 'error');
      return;
    }

    const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'qconsole.log';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify('qconsole.log başarıyla indirildi!', 'success');
  } catch (e) {
    console.error(e);
    notify('Log indirme hatası: ' + e.message, 'error');
  }
});

