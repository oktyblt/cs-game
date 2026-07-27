import { createClient } from '@supabase/supabase-js'
import { API_URL } from './api.js'

/**
 * Client'ta yalnızca publishable (anon) anahtar kullanılır.
 * Bu değer Vite build sırasında VITE_* env ile gömülür — tarayıcıda
 * Network/Sources'ta görünmesi beklenen davranıştır (Supabase modeli).
 * Asıl güvenlik: RLS + service_role'ün yalnızca backend'de olması.
 * Asla service_role / ADMIN_TOKEN / RCON burada olmamalı.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '[Supabase] VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY build ortamında zorunlu. ' +
    'Kaynak koda hardcode edilmez — cs-web-game/.env dosyasını kullanın.'
  )
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
    .select('id, owner_id, name, map, max_players, status, port, expires_at, created_at, container_id, admin_name, start_money, gravity, round_time')
    .eq('owner_id', userId)
  return { data, error }
}

/** ENPARA havale siparişi oluşturur (Stripe yok). Backend üzerinden. */
export async function buyServer(userId, name, map, max_players) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { error: new Error('Oturum gerekli. Lütfen giriş yapın.') };
    }

    const res = await fetch(`${API_URL}/api/rental-orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        userId,
        name: name || 'CS 1.5 Özel Sunucu',
        map: map || 'de_dust2',
        max_players: max_players || 16
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return { error: new Error(data.error || `Sipariş oluşturulamadı (${res.status})`) };
    }
    return { data };
  } catch (e) {
    console.warn('[buyServer] sipariş hatası:', e);
    return { error: e };
  }
}

export async function getMyRentalOrders() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { data: [], error: new Error('Oturum gerekli') };
    const res = await fetch(`${API_URL}/api/rental-orders/mine`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      return { data: [], error: new Error(data.error || 'Siparişler alınamadı') };
    }
    return { data: data.orders || [], error: null };
  } catch (e) {
    return { data: [], error: e };
  }
}
