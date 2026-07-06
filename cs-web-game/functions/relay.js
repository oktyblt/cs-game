export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Upgrade',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp'
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers });

  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426, headers });
  }

  const roomId = url.searchParams.get('room') || 'default';
  const role = url.searchParams.get('role') || 'client';

  const pair = new WebSocketPair();
  const [clientWs, serverWs] = pair;
  serverWs.accept();

  serverWs.addEventListener('message', function(event) {
    try { clientWs.send(event.data); } catch(e) {}
  });
  serverWs.addEventListener('close', function() {
    try { clientWs.close(); } catch(e) {}
  });

  return new Response(null, { status: 101, webSocket: clientWs, headers });
}
