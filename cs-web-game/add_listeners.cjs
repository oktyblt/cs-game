const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

const listeners = `
  const btnRandomJoin = document.getElementById('btn-random-join');
  if (btnRandomJoin) {
    btnRandomJoin.addEventListener('click', async () => {
      btnRandomJoin.disabled = true;
      const originalText = btnRandomJoin.textContent;
      btnRandomJoin.textContent = '🎲 ARANIYOR...';
      
      try {
        const res = await fetch(\`\${API_URL}/api/servers\`);
        const data = await res.json();
        const servers = data.servers || [];
        const onlineServers = servers.filter(s => s.online);
        
        if (onlineServers.length === 0) {
          notify('Şu anda aktif bir oda bulunamadı.', 'warn');
        } else {
          const target = onlineServers[Math.floor(Math.random() * onlineServers.length)];
          notify(\`"\${target.name}" sunucusuna bağlanıyor...\`, 'success');
          
          if (!getCurrentUser()) {
             window.openGuestJoinModal(target.port, target.map);
          } else {
             window.connectToServer(target.port, target.map, false);
          }
        }
      } catch (err) {
        console.error(err);
        notify('Sunucular alınırken hata oluştu.', 'error');
      }
      
      btnRandomJoin.disabled = false;
      btnRandomJoin.textContent = originalText;
    });
  }

  const btnSidebarBuyServer = document.getElementById('btn-sidebar-buy-server');
  if (btnSidebarBuyServer) {
    btnSidebarBuyServer.addEventListener('click', () => {
      const user = getCurrentUser();
      if (!user) {
        const loginModal = document.getElementById('login-modal');
        if (loginModal) loginModal.style.display = 'flex';
        notify('Sunucu kiralayabilmek için önce üye girişi yapmalısınız.', 'warn');
      } else {
        const modal = document.getElementById('premium-modal');
        if (modal) modal.style.display = 'flex';
      }
    });
  }
`;

// Insert listeners into DOMContentLoaded
code = code.replace(
  `  // Başlangıç Yüklemeleri`,
  `  // Başlangıç Yüklemeleri\n` + listeners
);

fs.writeFileSync('src/main.js', code);
console.log('Listeners added');
