export async function onRequest(context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Content-Type': 'application/json'
  };
  if (context.request.method === 'OPTIONS') return new Response(null, { headers });
  const maps = [
    { name: 'de_dust2', size: 2057288, description: 'Bomb Defusal' },
    { name: 'de_dust', size: 1359684, description: 'Bomb Defusal' },
    { name: 'de_inferno', size: 3567372, description: 'Bomb Defusal' },
    { name: 'cs_assault', size: 1041700, description: 'Hostage Rescue' },
    { name: 'cs_office', size: 4679872, description: 'Hostage Rescue' },
    { name: 'de_aztec', size: 2740604, description: 'Bomb Defusal' },
    { name: 'de_nuke', size: 2036392, description: 'Bomb Defusal' },
    { name: 'cs_italy', size: 2303480, description: 'Hostage Rescue' },
    { name: 'as_oilrig', size: 2056040, description: 'VIP Assassination' },
    { name: 'as_tundra', size: 2335152, description: 'VIP Assassination' },
    { name: 'cs_747', size: 1702788, description: 'Hostage Rescue' },
    { name: 'cs_backalley', size: 2142344, description: 'Hostage Rescue' },
    { name: 'cs_estate', size: 4485488, description: 'Hostage Rescue' },
    { name: 'cs_havana', size: 4988672, description: 'Hostage Rescue' },
    { name: 'cs_militia', size: 2022676, description: 'Hostage Rescue' },
    { name: 'cs_siege', size: 3361120, description: 'Hostage Rescue' },
    { name: 'de_cbble', size: 1698648, description: 'Bomb Defusal' },
    { name: 'de_chateau', size: 4953700, description: 'Bomb Defusal' },
    { name: 'de_piranesi', size: 3391792, description: 'Bomb Defusal' },
    { name: 'de_prodigy', size: 1929740, description: 'Bomb Defusal' },
    { name: 'de_storm', size: 2955604, description: 'Bomb Defusal' },
    { name: 'de_survivor', size: 6464260, description: 'Bomb Defusal' },
    { name: 'de_torn', size: 5466396, description: 'Bomb Defusal' },
    { name: 'de_train', size: 1145428, description: 'Bomb Defusal' },
    { name: 'de_vegas', size: 5148716, description: 'Bomb Defusal' },
    { name: 'de_vertigo', size: 2146792, description: 'Bomb Defusal' }
  ];
  return new Response(JSON.stringify({ maps, total: maps.length }), { headers });
}
