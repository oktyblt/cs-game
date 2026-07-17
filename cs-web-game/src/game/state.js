/** @module game/state — shared engine/UI mutable state */
export const state = {
  xash: null,
  currentMap: null,
  engineRunning: false,
  maps: [],
  activeFilter: 'all',
  consoleOpen: false,
  selectedMap: null,
};

/**
 * ES modules do not resolve bare `xash` / `engineRunning` to window globals.
 * Keep window.* mirrors for HTML onclick + legacy checks; modules should prefer `state.*`.
 */
if (!Object.getOwnPropertyDescriptor(window, 'engineRunning')) {
  Object.defineProperty(window, 'engineRunning', {
    get() { return state.engineRunning; },
    set(v) { state.engineRunning = !!v; },
    configurable: true
  });
}

if (!Object.getOwnPropertyDescriptor(window, 'xash')) {
  Object.defineProperty(window, 'xash', {
    get() { return state.xash; },
    set(v) { state.xash = v; },
    configurable: true
  });
}
