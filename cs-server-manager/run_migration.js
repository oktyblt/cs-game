// Supabase Management API - SQL migration
// This uses the REST API to execute SQL directly

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://nobzqygwzuqdlipnuchi.supabase.co';
const ANON_KEY = 'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-';

// Try using Supabase's pgmeta API (available in self-hosted but not cloud)
// Alternative: use the raw pg connection via Supabase's REST endpoint with raw SQL

async function runSQL(sql) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Profile': 'public',
      'Prefer': 'tx=commit'
    },
    body: JSON.stringify({ query: sql })
  });
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text.slice(0, 200));
}

// Try to directly update profiles using anon key (bypassing RLS with proper auth)
async function migrateViaUpdate() {
  const supabase = createClient(SUPABASE_URL, ANON_KEY);
  
  // Check if 'role' column exists by querying with it
  const { data: hasRole, error: roleCheckErr } = await supabase
    .from('profiles')
    .select('role')
    .limit(1);
  
  if (roleCheckErr && roleCheckErr.message.includes('does not exist')) {
    console.log('role column does not exist - need service role key to add it');
    console.log('Please run this SQL in Supabase Dashboard > SQL Editor:');
    console.log(`
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE purchased_servers ADD COLUMN IF NOT EXISTS container_id TEXT;
UPDATE profiles SET is_premium = true, role = 'vip' 
WHERE id = '9c945403-3ea6-4a17-bb2d-ca423522e171';
SELECT id, username, is_premium, role FROM profiles;
    `);
  } else {
    console.log('role column exists! Updating...');
    const { data, error } = await supabase
      .from('profiles')
      .update({ is_premium: true, role: 'vip' })
      .eq('id', '9c945403-3ea6-4a17-bb2d-ca423522e171')
      .select();
    console.log('Update result:', error?.message || JSON.stringify(data));
  }
}

migrateViaUpdate();
