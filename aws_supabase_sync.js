const SUPABASE_URL = 'https://nobzqygwzuqdlipnuchi.supabase.co';
const SUPABASE_KEY = 'sb_secret_glE49G76x1n6fiHMsalZqg_fsG-3EiU';

async function fetchPurchasedServers() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/purchased_servers?status=eq.pending`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const servers = await res.json();
    return servers;
  } catch (err) {
    console.error('Supabase fetch error:', err);
    return [];
  }
}

async function updateServerStatus(id, port) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/purchased_servers?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ status: 'running', port: port })
    });
  } catch(err) {
    console.error('Supabase update error:', err);
  }
}

let nextPort = 27500;

async function syncWithSupabase() {
  const pending = await fetchPurchasedServers();
  for (const srv of pending) {
    const port = nextPort++;
    console.log(`[Supabase] Starting purchased server: ${srv.name} on port ${port}`);
    
    const cmd = `sudo docker run -d --name cs15-${port} -p ${port}:27015/udp --label cs-web-game=true --label mapName=${srv.map} --label maxPlayers=${srv.max_players} --label isOfficial=false -e CS_MAP=${srv.map} -e CS_MAXPLAYERS=${srv.max_players} -e CS_HOSTNAME="${srv.name}" lkiesow/hlds-cs15`;
    
    try {
      await execPromise(cmd);
      await updateServerStatus(srv.id, port);
    } catch(err) {
      console.error(`[Supabase] Failed to start server ${srv.name}:`, err);
    }
  }
}

// setInterval(syncWithSupabase, 30000);
