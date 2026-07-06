import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://nobzqygwzuqdlipnuchi.supabase.co'
const supabaseKey = 'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-'

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

export async function buyServer(userId, name, map, max_players) {
  // First get profile to check balance
  const profile = await getProfile(userId)
  if (profile.error) return { error: profile.error }
  
  if (profile.data.wallet_balance < 50) {
    return { error: { message: 'Yetersiz bakiye. Lütfen cüzdanınıza kredi yükleyin.' } }
  }

  // Deduct balance
  const { error: updateError } = await supabase
    .from('profiles')
    .update({ wallet_balance: profile.data.wallet_balance - 50 })
    .eq('id', userId)
    
  if (updateError) return { error: updateError }

  // Create server
  const expires = new Date()
  expires.setMonth(expires.getMonth() + 1) // 1 month

  const { data, error } = await supabase
    .from('purchased_servers')
    .insert([
      { 
        owner_id: userId, 
        name: name, 
        map: map, 
        max_players: max_players, 
        expires_at: expires.toISOString(),
        status: 'pending' // pending until AWS manager boots it up
      }
    ])
    
  return { data, error }
}
