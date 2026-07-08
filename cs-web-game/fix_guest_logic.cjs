const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

// 1. Remove window.openGuestJoinModal definition
code = code.replace(/window\.openGuestJoinModal = function\(port, mapName\) \{[\s\S]*?\};\n/, '');

// 2. Replace all instances of `window.openGuestJoinModal(...)` with login prompt.
// We have two in `rewrite_grid.cjs`
code = code.replace(/window\.openGuestJoinModal\(server\.port, server\.map\);/g, `const loginModal = document.getElementById('login-modal');
              if (loginModal) loginModal.style.display = 'flex';
              window.customAlert('Oyuna katılmak için lütfen üye girişi yapınız.', 'BİLGİ');`);

// And the one in quickJoin (if it exists):
code = code.replace(/window\.openGuestJoinModal\(target\.port, target\.map\);/g, `const loginModal = document.getElementById('login-modal');
           if (loginModal) loginModal.style.display = 'flex';
           window.customAlert('Oyuna katılmak için lütfen üye girişi yapınız.', 'BİLGİ');`);

// 3. Add btn-random-join and btn-sidebar-buy-server listeners at the very end of DOMContentLoaded
// Wait, is there a DOMContentLoaded listener? Yes.
// Let's just append it to the file.
const listeners = `
document.addEventListener('DOMContentLoaded', () => {
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
          window.customAlert('Şu anda aktif bir oda bulunamadı.', 'BİLGİ');
        } else {
          const target = onlineServers[Math.floor(Math.random() * onlineServers.length)];
          
          if (!getCurrentUser()) {
             const loginModal = document.getElementById('login-modal');
             if (loginModal) loginModal.style.display = 'flex';
             window.customAlert('Oyuna katılmak için lütfen üye girişi yapınız.', 'BİLGİ');
          } else {
             window.connectToServer(target.port, target.map, false);
          }
        }
      } catch (err) {
        console.error(err);
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
        window.customAlert('Sunucu kiralayabilmek için önce üye girişi yapmalısınız.', 'BİLGİ');
      } else {
        const modal = document.getElementById('premium-modal');
        if (modal) modal.style.display = 'flex';
      }
    });
  }
});
`;

code += '\n' + listeners;

fs.writeFileSync('src/main.js', code);
console.log("Guest logic removed and new listeners added to main.js");
