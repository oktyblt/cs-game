// Supabase Admin Operations via service_role key
// We'll use the anon key with a trick: sign in as the owner of the record

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nobzqygwzuqdlipnuchi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  // Check if 'role' column exists by trying to select it
  const { data: testRole, error: roleErr } = await supabase
    .from('profiles')
    .select('id, username, is_premium, role')
    .limit(1);
    
  console.log('role column exists:', !roleErr);
  if (roleErr) console.log('Role error:', roleErr.message);
  else console.log('Sample profile:', JSON.stringify(testRole));
  
  // Check purchased_servers columns
  const { data: psData, error: psErr } = await supabase
    .from('purchased_servers')
    .select('id, owner_id, name, map, port, status, container_id, rcon_password, start_money, gravity, round_time, admin_name, admin_password, expires_at')
    .limit(1);
    
  console.log('\npurchased_servers columns test:', psErr ? psErr.message : 'OK');
  console.log('Sample row:', JSON.stringify(psData));
}

main();
