import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://nobzqygwzuqdlipnuchi.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-'

if (!import.meta.env.VITE_SUPABASE_URL) {
  console.warn('[Supabase] VITE_SUPABASE_URL env değişkeni ayarlanmamış, varsayılan kullanılıyor.')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

// Export useful auth functions
export async function signUp(email, password, username) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username
      }
    }
  })
  return { data, error }
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  return { data, error }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return { data, error }
}

export async function getMyServers(userId) {
  const { data, error } = await supabase
    .from('purchased_servers')
    .select('*')
    .eq('owner_id', userId)
  return { data, error }
}

export async function createPurchasedServer(userId, name, map, max_players, port, rconPassword) {
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 10); // 10 years VIP duration
  
  const { data, error } = await supabase
    .from('purchased_servers')
    .insert([{ 
      owner_id: userId, 
      name: name, 
      map: map, 
      max_players: max_players, 
      status: 'running',
      port: port,
      expires_at: expiresAt.toISOString(),
      rcon_password: rconPassword || 'admin'
    }])
    .select()
  return { data, error }
}

export async function buyServer(userId, name, map, max_players) {
  try {
    // Kredi kartı ödeme altyapısı için worker'a istek atılır
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, name, map, max_players })
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.url) return { data: { checkout_url: data.url } };
      return { error: new Error("Stripe checkout session URL could not be generated.") };
    } else {
      return { error: new Error(`API Error: ${res.statusText}`) };
    }
  } catch (e) {
    console.warn("Stripe api hatası...", e);
    return { error: e };
  }
}
