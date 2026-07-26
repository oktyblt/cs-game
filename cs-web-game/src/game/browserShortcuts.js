/**
 * Block dangerous browser shortcuts while in-game (esp. Windows Chrome Ctrl+W).
 * Capture-phase preventDefault; also warn on accidental tab close via beforeunload.
 */
import { state } from './state.js';

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return !!el.isContentEditable;
}

function isInGame() {
  return !!state.engineRunning;
}

function isPointerLockedOnGame() {
  const canvas = document.getElementById('canvas');
  return !!(canvas && document.pointerLockElement === canvas);
}

/** Keys that close/reload/open tabs — must never reach the browser during play. */
function isDangerousBrowserChord(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return false;
  const code = e.code || '';
  const key = (e.key || '').toLowerCase();
  // Close tab / window
  if (code === 'KeyW' || key === 'w') return true;
  // New tab / window
  if (code === 'KeyT' || key === 't') return true;
  if (code === 'KeyN' || key === 'n') return true;
  // Reload
  if (code === 'KeyR' || key === 'r') return true;
  // Close window (Ctrl+Shift+W)
  if (e.shiftKey && (code === 'KeyW' || key === 'w')) return true;
  return false;
}

function onKeyDown(e) {
  if (!isInGame()) return;
  if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;

  // Always block close/reload chords in-game (even if console/menu open without an input focus).
  if (isDangerousBrowserChord(e)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  // When pointer-locked: swallow browser defaults (focus rings, macOS accent menu, etc.)
  // so gameplay keys don't leak to Chrome/Edge.
  if (isPointerLockedOnGame()) {
    e.preventDefault();
  }
}

function onBeforeUnload(e) {
  if (!isInGame()) return;
  // Triggers the native “Leave site?” dialog if something still tries to close the tab.
  e.preventDefault();
  e.returnValue = '';
}

export function initBrowserShortcuts() {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('beforeunload', onBeforeUnload);
}
