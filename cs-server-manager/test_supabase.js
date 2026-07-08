const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://nobzqygwzuqdlipnuchi.supabase.co',
  'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-'
);

async function main() {
  // 1. profiles tablosu
  const { data: profiles, error: pErr } = await supabase.from('profiles').select('*').limit(10);
  console.log('=== PROFILES ===');
  if (pErr) console.log('Error:', pErr.message);
  else console.log(JSON.stringify(profiles, null, 2));

  // 2. purchased_servers
  const { data: servers, error: sErr } = await supabase.from('purchased_servers').select('*').limit(10);
  console.log('\n=== PURCHASED_SERVERS ===');
  if (sErr) console.log('Error:', sErr.message);
  else console.log(JSON.stringify(servers, null, 2));
}
main();

async function checkColumns() {
  // Check if role column exists
  const { data, error } = await supabase.rpc('exec_sql', { sql: "SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles'" }).limit(1);
  console.log('\n=== RPC test ===', error?.message || JSON.stringify(data));
}
checkColumns();
