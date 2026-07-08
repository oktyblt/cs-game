const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

// 1. btnQuickJoin click handler: add login check
code = code.replace(
  "btnQuickJoin.disabled = true;\n    btnQuickJoin.textContent = 'SUNUCU ARANIYORY...';",
  `if (!getCurrentUser()) {
      const loginModal = document.getElementById('login-modal');
      if (loginModal) loginModal.style.display = 'flex';
      notify('Oyuna katılmak için önce üye girişi yapmalısınız!', 'error');
      return;
    }
    btnQuickJoin.disabled = true;
    btnQuickJoin.textContent = 'SUNUCU ARANIYOR...';`
);

// 2. loadServerList - defaultImgUrl for mini list
code = code.replace(
  "const defaultImgUrl = `${ASSET_URL}/cs-assets/cs_bg.png`;\n          const div = document.createElement('div');",
  `const mapImgUrl = \`\${ASSET_URL}/assets/maps/\${server.map}.jpg\`;
          const defaultImgUrl = \`\${ASSET_URL}/cs-assets/cs_bg.png\`;
          const div = document.createElement('div');`
);

// mini list img src
code = code.replace(
  `<img crossorigin="anonymous" src="\${defaultImgUrl}" alt="Server" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.8;" onerror="this.style.display='none'" />`,
  `<img crossorigin="anonymous" src="\${mapImgUrl}" alt="Server" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.8;" onerror="this.onerror=null; this.src='\${defaultImgUrl}';" />`
);

// mini list click handler check
code = code.replace(
  `div.addEventListener('click', () => {
            window.connectToServer(server.port, server.map, false);`,
  `div.addEventListener('click', () => {
            if (!getCurrentUser()) {
              const loginModal = document.getElementById('login-modal');
              if (loginModal) loginModal.style.display = 'flex';
              notify('Oyuna katılmak için önce üye girişi yapmalısınız!', 'error');
              return;
            }
            window.connectToServer(server.port, server.map, false);`
);

// 3. loadServerList - defaultImgUrl for full grid
code = code.replace(
  "const defaultImgUrl = `${ASSET_URL}/cs-assets/cs_bg.png`;\n          const card = document.createElement('div');",
  `const mapImgUrl = \`\${ASSET_URL}/assets/maps/\${server.map}.jpg\`;
          const defaultImgUrl = \`\${ASSET_URL}/cs-assets/cs_bg.png\`;
          const card = document.createElement('div');`
);

// full grid img src
code = code.replace(
  `<img crossorigin="anonymous" src="\${defaultImgUrl}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0.6; z-index:0;" onerror="this.style.display='none'" />`,
  `<img crossorigin="anonymous" src="\${mapImgUrl}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0.6; z-index:0;" onerror="this.onerror=null; this.src='\${defaultImgUrl}';" />`
);

// full grid click handler check
code = code.replace(
  `card.querySelector('.btn-join-room').addEventListener('click', () => {
            window.connectToServer(server.port, server.map, false);`,
  `card.querySelector('.btn-join-room').addEventListener('click', () => {
            if (!getCurrentUser()) {
              const loginModal = document.getElementById('login-modal');
              if (loginModal) loginModal.style.display = 'flex';
              notify('Oyuna katılmak için önce üye girişi yapmalısınız!', 'error');
              return;
            }
            window.connectToServer(server.port, server.map, false);`
);


// 4. connectToServer - add loading warning text
code = code.replace(
  `if (gameWrapper) gameWrapper.classList.add('active'); // .hidden değil, .active kullanılmalı!

  // initEngine'i çağır`,
  `if (gameWrapper) gameWrapper.classList.add('active'); // .hidden değil, .active kullanılmalı!

  const engineText = document.getElementById('engine-status-text');
  if (engineText) {
    engineText.innerHTML = \`Engine hazırlanıyor... <br/><span style="color:var(--cs-yellow); font-size: 0.75rem; letter-spacing:0.05em; margin-top:5px; display:inline-block;">⚠️ İlk yükleme (harita ve modeller) internet hızınıza bağlı olarak uzun sürebilir. Lütfen bekleyin.</span>\`;
  }

  // initEngine'i çağır`
);


fs.writeFileSync('src/main.js', code);
console.log('main.js patched');
