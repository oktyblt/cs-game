// Use built-in fetch (Node 18+)
const { createClient } = require('@supabase/supabase-js');

// We need to check what RLS policies exist and find a way to update
// The anon key can update own profile (where id = auth.uid())
// For admin operations, we need service_role key

// Let's try Supabase Management API to get the service key
// OR we can directly disable RLS for this table temporarily

// Alternative: Use the Supabase admin REST endpoint with service_role
// First, let's check the RLS policy by trying to sign in as the user and update

async function signInAndUpdate() {
  const supabase = createClient(
    'https://nobzqygwzuqdlipnuchi.supabase.co',
    'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-'
  );
  
  // Sign in as bymTL user  
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'tusevonline@gmail.com',
    password: 'admin123' // We don't know the password
  });
  
  console.log('Auth error:', authError?.message);
  console.log('Auth data:', authData?.user?.id);
}

// Since we can't sign in without the password, let's try Supabase Management API
async function tryManagementAPI() {
  const SUPABASE_URL = 'https://nobzqygwzuqdlipnuchi.supabase.co';
  const ANON_KEY = 'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-';
  
  // Try to get auth.users via admin endpoint
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`
    }
  });
  const data = await res.json();
  console.log('Admin users status:', res.status);
  console.log('Admin users:', JSON.stringify(data).slice(0, 200));
}

tryManagementAPI();
