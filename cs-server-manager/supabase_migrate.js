// Use Supabase Management API (requires project ref and service key)
// We can use the SQL Editor REST endpoint
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nobzqygwzuqdlipnuchi.supabase.co';
const ANON_KEY = 'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-';

// Try Supabase REST API with SQL via postgres RPC
async function runSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`
    },
    body: JSON.stringify({ query: sql })
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  // Try pg_catalog query
  const check = await runSQL(`SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles'`);
  console.log('SQL test:', check.status, JSON.stringify(check.data).slice(0, 200));
}

main();
