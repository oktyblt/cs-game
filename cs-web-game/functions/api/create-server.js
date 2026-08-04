export async function onRequest(context) {
  const { request } = context;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Content-Type': 'application/json'
  };
  
  if (request.method === 'OPTIONS') return new Response(null, { headers });

  try {
    const url = new URL(request.url);
    const targetUrl = `https://backend.browsercs.com${url.pathname}`;
    
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: { 'Content-Type': request.headers.get('Content-Type') || 'application/json' },
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.text() : undefined
    });
    
    const data = await response.text();
    return new Response(data, { status: response.status, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, success: false }), { status: 500, headers });
  }
}
