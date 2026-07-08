const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

const regex = /if \(data\.servers && data\.servers\.length > 0\) \{([\s\S]*?)    \} else \{\n      if \(activeServersContainer\)/m;
const match = code.match(regex);

if (!match) {
  console.log("Not found");
  process.exit(1);
}

const replacement = `if (data.servers && data.servers.length > 0) {
      if (activeServersContainer) activeServersContainer.innerHTML = '';
      if (fullServersGrid) fullServersGrid.innerHTML = '';

      const officialServers = [];
      const otherServers = [];

      data.servers.forEach(server => {
        let displayName = server.name;
        let displayHost = server.host || 'Anonim';
        let badgeText = '🟢 CANLI P2P';
        let playersCount = server.players !== undefined ? server.players : '?';
        let isOfficialFinal = false;
        
        if (server.isOfficial === true) {
          displayName = 'BrowserCS';
          displayHost = 'BrowserCS (Resmi)';
          badgeText = '⭐ RESMİ SUNUCU';
          isOfficialFinal = true;
        } else if (server.isOfficial === false) {
          displayHost = 'Oyuncu Sunucusu';
          badgeText = '🚀 DEDICATED';
        } else if (displayName.startsWith('CS Server') && (!server.host || server.host === 'Anonim')) {
          displayName = 'BrowserCS';
          displayHost = 'BrowserCS (Resmi)';
          badgeText = '⭐ RESMİ SUNUCU';
          isOfficialFinal = true;
        }

        const srvObj = { ...server, displayName, displayHost, badgeText, playersCount, isOfficialFinal };
        if (isOfficialFinal) officialServers.push(srvObj);
        else otherServers.push(srvObj);
      });

      const renderGridItem = (server, container, isMini) => {
        const mapImgUrl = \`\${ASSET_URL}/assets/maps/\${server.map}.jpg\`;
        const defaultImgUrl = \`\${ASSET_URL}/cs-assets/cs_bg.png\`;

        if (isMini) {
          const div = document.createElement('div');
          div.className = 'map-item';
          div.style.flexDirection = 'column';
          div.style.alignItems = 'stretch';
          div.style.background = 'var(--bg-card)';
          div.style.border = '1px solid var(--border-bright)';
          div.style.padding = '0.6rem';
          div.style.marginBottom = '0.6rem';
          div.style.boxShadow = '0 2px 8px rgba(0,0,0,0.4)';
          div.innerHTML = \`
            <div style="font-size: 0.75rem; color: var(--cs-yellow); text-align: center; margin-bottom: 6px; font-family: var(--font-hud); letter-spacing: 0.05em;">🗺️ \${server.map}</div>
            <div style="position: relative; width: 100%; height: 80px; overflow: hidden; border-radius: 4px; border: 1px solid var(--border);">
              <img crossorigin="anonymous" src="\${mapImgUrl}" alt="Server" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.8;" onerror="this.onerror=null; this.src='\${defaultImgUrl}';" />
              <div style="position:absolute; bottom:4px; right:4px; background:rgba(0,0,0,0.8); padding:2px 6px; border-radius:4px; font-size:0.75rem; color:#4caf50; font-weight:bold; border: 1px solid #4caf50;">
                👤 \${server.playersCount}/\${server.maxplayers}
              </div>
            </div>
            <div style="font-weight: bold; color: var(--text-bright); text-align: center; margin-top: 8px; font-size: 0.85rem;">\${server.displayName}</div>
          \`;
          div.addEventListener('click', () => {
            if (!getCurrentUser()) {
              window.openGuestJoinModal(server.port, server.map);
            } else {
              window.connectToServer(server.port, server.map, false);
            }
            if (typeof fullServerBrowser !== 'undefined' && fullServerBrowser) fullServerBrowser.classList.remove('active');
          });
          container.appendChild(div);
        } else {
          const card = document.createElement('div');
          card.className = 'server-card-box anim-fade-in';
          card.innerHTML = \`
            <div class="server-card-thumb" style="position: relative;">
              <img crossorigin="anonymous" src="\${mapImgUrl}" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; opacity:0.6; z-index:0;" onerror="this.onerror=null; this.src='\${defaultImgUrl}';" />
              <span class="server-badge-live" style="z-index:2;">\${server.badgeText}</span>
              <span class="server-thumb-map-text" style="z-index:2;">\${server.map}</span>
            </div>
            <div class="server-card-body">
              <div class="server-card-name">\${server.displayName}</div>
              <div class="server-card-meta">
                <span>🗺️ \${server.map}</span>
                <span>👤 \${server.playersCount}/\${server.maxplayers} Oyuncu</span>
              </div>
              <div style="font-size:0.72rem; color:var(--text-dim); margin-top:3px;">👑 Kurucu: <b>\${server.displayHost}</b></div>
              <div style="display:flex; gap:0.4rem; margin-top:0.4rem;">
                <button class="btn-join-room" style="flex:1;">▶ ODAYA KATIL</button>
                \${(server.owner_id && getCurrentUser() && server.owner_id === getCurrentUser().id) ? 
                  \`<button class="btn-join-room" style="background:var(--bg-deep); border:1px solid var(--border-bright); color:var(--text-bright); padding:0 0.8rem; font-size:1rem;" title="Sunucu Ayarları" onclick="openServerSettings('\${server.id}')">⚙️</button>\`
                  : ''}
              </div>
            </div>
          \`;
          card.querySelector('.btn-join-room').addEventListener('click', () => {
            if (!getCurrentUser()) {
              window.openGuestJoinModal(server.port, server.map);
            } else {
              window.connectToServer(server.port, server.map, false);
            }
            if (typeof fullServerBrowser !== 'undefined' && fullServerBrowser) fullServerBrowser.classList.remove('active');
          });
          container.appendChild(card);
        }
      };

      if (activeServersContainer) {
        officialServers.forEach(s => renderGridItem(s, activeServersContainer, true));
        otherServers.forEach(s => renderGridItem(s, activeServersContainer, true));
      }

      if (fullServersGrid) {
        if (officialServers.length > 0) {
          const header = document.createElement('div');
          header.style.gridColumn = '1 / -1';
          header.style.fontFamily = 'var(--font-hud)';
          header.style.fontSize = '1.2rem';
          header.style.color = 'var(--cs-yellow)';
          header.style.borderBottom = '1px solid var(--border)';
          header.style.paddingBottom = '0.5rem';
          header.style.marginTop = '0.5rem';
          header.style.marginBottom = '0.5rem';
          header.textContent = "⭐ BrowserCS'nin Resmi Sunucuları";
          fullServersGrid.appendChild(header);
          officialServers.forEach(s => renderGridItem(s, fullServersGrid, false));
        }

        if (otherServers.length > 0) {
          const header = document.createElement('div');
          header.style.gridColumn = '1 / -1';
          header.style.fontFamily = 'var(--font-hud)';
          header.style.fontSize = '1.2rem';
          header.style.color = 'var(--text-bright)';
          header.style.borderBottom = '1px solid var(--border)';
          header.style.paddingBottom = '0.5rem';
          header.style.marginTop = '1.5rem';
          header.style.marginBottom = '0.5rem';
          header.textContent = "🚀 Diğer Sunucular";
          fullServersGrid.appendChild(header);
          otherServers.forEach(s => renderGridItem(s, fullServersGrid, false));
        }
      }
`;

code = code.replace(match[0], replacement + '\n    } else {\n      if (activeServersContainer)');

fs.writeFileSync('src/main.js', code);
console.log('main.js rewritten');
