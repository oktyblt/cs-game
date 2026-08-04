export async function onRequest(context) {
  const { request, params } = context;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Content-Type': 'application/json'
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });

  try {
    const id = encodeURIComponent(params.id || '');
    const targetUrl = `http://35.159.95.54:4000/api/servers/${id}/players`;
    const response = await fetch(targetUrl, { method: 'GET' });
    const data = await response.text();
    return new Response(data, { status: response.status, headers });
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message, players: [] }),
      { status: 500, headers }
    );
  }
}
