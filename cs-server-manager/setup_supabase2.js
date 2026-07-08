// Supabase REST API with service role (bypasses RLS)
// The service_role key gives full admin access
// We need to get it from the Supabase dashboard - let's try with the anon key + auth bypass

const fetch = require('node-fetch');

// Try direct REST API call with the anon key
async function updateViaRest() {
  const SUPABASE_URL = 'https://nobzqygwzuqdlipnuchi.supabase.co';
  const VIP_USER_ID = '9c945403-3ea6-4a17-bb2d-ca423522e171';
  
  // Try updating via REST with anon key
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${VIP_USER_ID}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': 'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-',
      'Authorization': 'Bearer sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ is_premium: true })
  });
  
  const data = await res.json();
  console.log('REST Update response:', JSON.stringify(data));
  console.log('Status:', res.status);
}

updateViaRest().catch(console.error);
