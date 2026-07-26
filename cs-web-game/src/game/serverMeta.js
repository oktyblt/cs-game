/** @module game/serverMeta — shared server list helpers */

export function isDeathmatchServer(server) {
  if (!server) return false;
  return server.mode === 'deathmatch' ||
    server.gameMode === 'deathmatch' ||
    /deathmatch/i.test(server.name || '');
}

export function buildModePill(server, mini = false) {
  const fs = mini ? '0.5rem' : '0.55rem';
  const pad = mini ? '1px 5px' : '2px 7px';
  if (isDeathmatchServer(server)) {
    return `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(255,120,0,0.18);border:1px solid rgba(255,120,0,0.45);color:#ff9800;font-family:var(--font-hud);font-size:${fs};font-weight:700;letter-spacing:0.1em;padding:${pad};border-radius:3px;text-transform:uppercase;">💀 DEATHMATCH</span>`;
  }
  if (server.mode === 'match') {
    return `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(220,30,30,0.18);border:1px solid rgba(220,30,30,0.5);color:#ff6b6b;font-family:var(--font-hud);font-size:${fs};font-weight:700;letter-spacing:0.1em;padding:${pad};border-radius:3px;text-transform:uppercase;">${mini ? '⚔ MAÇ' : '⚔ MAÇ MODU'}</span>`;
  }
  return `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(20,140,60,0.15);border:1px solid rgba(50,200,100,0.35);color:#4dbb7a;font-family:var(--font-hud);font-size:${fs};font-weight:700;letter-spacing:0.1em;padding:${pad};border-radius:3px;text-transform:uppercase;">${mini ? '🟢 NORMAL' : '🟢 NORMAL'}</span>`;
}
