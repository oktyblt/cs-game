const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://nobzqygwzuqdlipnuchi.supabase.co',
  'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-'
);

async function verify() {
  // 1. profiles tablosunda role kolonu var mı?
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, username, is_premium, role, wallet_balance')
    .order('created_at', { ascending: true });
  
  console.log('=== PROFILES ===');
  if (pErr) console.log('HATA:', pErr.message);
  else {
    profiles.forEach(p => {
      const icon = p.is_premium ? '⭐ VIP' : '👤 Normal';
      console.log(`${icon} | ${p.username.padEnd(15)} | is_premium: ${p.is_premium} | role: ${p.role || '(boş)'}`);
    });
  }

  // 2. purchased_servers container_id kolonu var mı?
  const { data: ps, error: psErr } = await supabase
    .from('purchased_servers')
    .select('id, name, port, status, container_id')
    .limit(5);
  
  console.log('\n=== PURCHASED_SERVERS (container_id testi) ===');
  if (psErr) console.log('HATA:', psErr.message);
  else console.log('container_id kolonu:', psErr ? 'YOK ❌' : 'VAR ✅', '| Kayıt sayısı:', ps?.length || 0);
}
verify();
