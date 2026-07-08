const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

code = code.replace(
  `btnQuickJoin.addEventListener('click', async () => {
    if (!currentMap) { notify('Önce bir harita seçin!', 'error'); return; }
    const nickname = (userNicknameInput && userNicknameInput.value.trim()) ? userNicknameInput.value.trim() : '';
    if (!nickname) { notify('Lütfen oyuna girmeden önce bir oyuncu adı yazın!', 'error'); return; }
    
    if (!getCurrentUser()) {
      // Instead of forcing login, ask for guest nickname
      // We need port and map! But here we might not have it yet.
      // Wait, let's just do it dynamically later or let the caller pass it!
      // In btnQuickJoin, we fetch servers then decide.
    }

    btnQuickJoin.disabled = true;
    btnQuickJoin.textContent = 'SUNUCU ARANIYOR...';`,
  `btnQuickJoin.addEventListener('click', async () => {
    if (!currentMap) { notify('Önce bir harita seçin!', 'error'); return; }
    
    btnQuickJoin.disabled = true;
    btnQuickJoin.textContent = 'SUNUCU ARANIYOR...';`
);

// After fetching target in btnQuickJoin
code = code.replace(
  `      if (target) {
        notify(\`"\${target.name}" sunucusuna bağlanıyor...\`, 'success');
        window.connectToServer(target.port, target.map, false);
      } else {
        notify('Şu anda aktif bir oda bulunamadı. Lütfen "Sunucu Kur" ile kendiniz oluşturun.', 'warn');
      }

      btnQuickJoin.disabled = false;
      btnQuickJoin.textContent = '▶ SUNUCUYA KATIL';`,
  `      if (target) {
        notify(\`"\${target.name}" sunucusuna bağlanıyor...\`, 'success');
        if (!getCurrentUser()) {
           window.openGuestJoinModal(target.port, target.map);
        } else {
           window.connectToServer(target.port, target.map, false);
        }
      } else {
        notify('Şu anda aktif bir oda bulunamadı. Lütfen "Sunucu Kur" ile kendiniz oluşturun.', 'warn');
      }

      btnQuickJoin.disabled = false;
      btnQuickJoin.textContent = '▶ SUNUCUYA KATIL';`
);

fs.writeFileSync('src/main.js', code);
console.log('quickjoin fixed');
