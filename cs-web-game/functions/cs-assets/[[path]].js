/** Prevent SPA index.html fallback for FastDL — HTML-as-MDL causes WASM OOB. */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  let res;
  if (env && env.ASSETS) {
    res = await env.ASSETS.fetch(request);
  } else {
    // Same-origin static fetch (Pages provides asset at this URL when present)
    res = await fetch(request);
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const status = res.status;
  // SPA fallback often returns 200 text/html for missing paths
  if (status === 404 || ct.includes('text/html')) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'no-store',
      },
    });
  }

  // Peek first bytes if mdl/bsp/spr look like HTML
  const path = url.pathname.toLowerCase();
  if (/\.(mdl|bsp|spr|wav|tga|bmp)$/.test(path)) {
    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const head = String.fromCharCode(...u8.slice(0, 15));
    if (head.startsWith('<!DOCTYPE') || head.startsWith('<html') || head.startsWith('<!doctype')) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin',
          'Cache-Control': 'no-store',
        },
      });
    }
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    if (path.endsWith('.mdl')) headers.set('Content-Type', 'application/octet-stream');
    if (path.endsWith('.bsp')) headers.set('Content-Type', 'application/octet-stream');
    return new Response(buf, { status: res.status, headers });
  }

  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(res.body, { status: res.status, headers });
}
