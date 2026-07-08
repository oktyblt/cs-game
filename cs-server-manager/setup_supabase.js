const { createClient } = require('@supabase/supabase-js');

// Use service_role key for admin operations - anon key doesn't allow DDL
// We'll use anon key but with direct REST calls to Management API
// First, let's use the anon key to update what we can

const supabase = createClient(
  'https://nobzqygwzuqdlipnuchi.supabase.co',
  'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-'
);

async function main() {
  // 1. VIP kullanıcısını (bymTL) is_premium = true yap
  const VIP_USER_ID = '9c945403-3ea6-4a17-bb2d-ca423522e171'; // bymTL
  
  const { data: updated, error: updateErr } = await supabase
    .from('profiles')
    .update({ is_premium: true })
    .eq('id', VIP_USER_ID)
    .select();
    
  console.log('=== bymTL Premium Update ===');
  if (updateErr) console.log('Error:', updateErr.message);
  else console.log('Updated:', JSON.stringify(updated));

  // 2. Verify
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', VIP_USER_ID).single();
  console.log('\n=== bymTL Profile After Update ===');
  console.log(JSON.stringify(profile, null, 2));
  
  // 3. Check purchased_servers table structure
  const { data: ps_test, error: ps_err } = await supabase
    .from('purchased_servers')
    .select('id, owner_id, name, map, port, status, created_at')
    .limit(5);
  console.log('\n=== Purchased Servers ===');
  if (ps_err) console.log('Error:', ps_err.message);
  else console.log(JSON.stringify(ps_test, null, 2));
}
main();
