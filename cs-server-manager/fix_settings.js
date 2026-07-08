const fs = require('fs');

let code = fs.readFileSync('index.js', 'utf8');

// The replacement logic
const oldBlock = `
    const container = docker.getContainer(id);
    const info = await container.inspect();
    if (info.Config.Labels.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Bu sunucuyu yönetme yetkiniz yok.' });
    }
    
    const portBindings = info.HostConfig.PortBindings['27015/udp'];
    const portStr = portBindings ? portBindings[0].HostPort : null;
    if (!portStr) {
      return res.status(404).json({ success: false, error: 'Sunucu port bilgisi bulunamadı.' });
    }

    const { createClient } = require('@supabase/supabase-js');
    const userSupabase = createClient(
      'https://nobzqygwzuqdlipnuchi.supabase.co',
      'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-',
      { global: { headers: { Authorization: \`Bearer \${token}\` } } }
    );

    // Port üzerinden Supabase purchased_servers satırını bul (kullanıcının kendi tokeni ile)
    const { data: dbServer, error: fetchErr } = await userSupabase
      .from('purchased_servers')
      .select('*')
      .eq('port', parseInt(portStr))
      .single();

    if (fetchErr || !dbServer) {
      return res.status(404).json({ success: false, error: 'Sunucu veritabanında bulunamadı veya erişim yetkiniz yok (port: ' + portStr + ').' });
    }
`;

const newBlock = `
    const { createClient } = require('@supabase/supabase-js');
    const userSupabase = createClient(
      'https://nobzqygwzuqdlipnuchi.supabase.co',
      'sb_publishable_UCmJqqwDuYcPuxALFv8Z0w_VJrFZ8F-',
      { global: { headers: { Authorization: \`Bearer \${token}\` } } }
    );

    let dbServer = null;
    let containerId = id;

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      const { data, error } = await userSupabase.from('purchased_servers').select('*').eq('id', id).single();
      if (error || !data) {
        return res.status(404).json({ success: false, error: 'Sunucu bulunamadı veya yetkiniz yok.' });
      }
      dbServer = data;
      containerId = data.container_id;
    } else {
      const containerInfo = await docker.getContainer(id).inspect().catch(() => null);
      if (!containerInfo) {
         return res.status(404).json({ success: false, error: 'Sunucu container bilgisi bulunamadı.' });
      }
      const portBindings = containerInfo.HostConfig.PortBindings['27015/udp'];
      const portStr = portBindings ? portBindings[0].HostPort : null;
      if (!portStr) return res.status(404).json({ success: false, error: 'Sunucu port bilgisi bulunamadı.' });
      
      const { data, error } = await userSupabase.from('purchased_servers').select('*').eq('port', parseInt(portStr)).single();
      if (error || !data) return res.status(404).json({ success: false, error: 'Sunucu veritabanında bulunamadı.' });
      dbServer = data;
    }

    if (dbServer.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Bu sunucuyu yönetme yetkiniz yok.' });
    }

    const container = docker.getContainer(containerId);
`;

code = code.replace(oldBlock.trim(), newBlock.trim());
fs.writeFileSync('index.js', code);
