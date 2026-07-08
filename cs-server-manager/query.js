const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://nobzqygwzuqdlipnuchi.supabase.co', process.env.SUPABASE_KEY);
async function test() {
  const { data, error } = await supabase.from('purchased_servers').select('*').eq('port', 27247);
  console.log(data, error);
}
test();
