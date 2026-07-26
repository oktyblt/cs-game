require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function listAll() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, role');
    
  if (error) console.error(error);
  else console.log(data);
}

listAll();
