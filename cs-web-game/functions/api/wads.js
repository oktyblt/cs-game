export async function onRequest(context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Content-Type': 'application/json'
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers });
  const wads = ['ajawad.wad','as_tundra.wad','cached.wad','chateau.wad','cs_747.wad','cs_bdog.wad','cs_cbble.wad','cs_dust.wad','cs_havana.wad','cs_office.wad','cstrike.wad','de_aztec.wad','de_piranesi.wad','de_storm.wad','de_vegas.wad','decals.wad','itsItaly.wad','jos.wad','n0th1ng.wad','pldecal.wad','prodigy.wad','torntextures.wad'];
  return new Response(JSON.stringify({ wads }), { headers });
}
