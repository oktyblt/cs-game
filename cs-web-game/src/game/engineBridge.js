/**
 * @module game/engineBridge
 * WASM/C++ → JS window bridges. Do not rename without native client updates.
 */
export const ENGINE_BRIDGE_GLOBALS = [
  'updateBrowserCSScoreboard',
  'zeroBrowserCSScoreboard',
  'pinBrowserCSScoreboard',
  'beginBrowserCSScoreReset',
  '_openTextMenu',
  '_closeTextMenu',
  'executeEngineCommand',
  'ensureMapBspInVfs',
  'connectToServer',
  'leaveBrowserCSServer',
  'toggleConsole',
  'showWelcomeMOTD',
  'openServerSettings',
  'BrowserCSReconnect',
];

export function assertEngineBridges() {
  for (const name of ENGINE_BRIDGE_GLOBALS) {
    if (typeof window[name] === 'undefined') {
      console.warn('[engineBridge] missing window.' + name);
    }
  }
}
