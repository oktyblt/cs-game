/**
 * Shared Docker helpers for cs-web-game containers.
 */

function portFromContainer(c) {
  const fromPorts = c?.Ports?.find((p) => p.PrivatePort === 27015)?.PublicPort;
  if (fromPorts) return Number(fromPorts);

  const name = (c?.Names || [])
    .map((n) => String(n).replace(/^\//, ''))
    .find((n) => /^cs15-\d+$/.test(n));
  if (name) {
    const p = parseInt(name.split('-')[1], 10);
    if (Number.isFinite(p) && p > 0) return p;
  }

  const labelPort = parseInt(c?.Labels?.port || c?.Labels?.gamePort, 10);
  return Number.isFinite(labelPort) && labelPort > 0 ? labelPort : 0;
}

/** Public/admin UI state: only "running" is online; everything else is closed. */
function normalizeServerState(dockerState) {
  return dockerState === 'running' ? 'running' : 'stopped';
}

module.exports = {
  portFromContainer,
  normalizeServerState,
};
