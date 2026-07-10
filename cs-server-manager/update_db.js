require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://nobzqygwzuqdlipnuchi.supabase.co', process.env.SUPABASE_KEY);
async function run() {
  const { data, error } = await supabase.from('purchased_servers').update({ container_id: '53936e5a2b3044fe8b5a4669ea3aee4f809f6049f84199d7d66364ad662d0e89' }).eq('port', 27247);
  console.log('Update result:', data, error);
}
run();
