const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

const regex = /if \(data\.servers && data\.servers\.length > 0\) \{([\s\S]*?)\}\s*\} catch \(err\) \{/m;
const match = code.match(regex);
if (!match) {
  console.log("Could not find server rendering block");
  process.exit(1);
}

const replacement = `if (data.servers && data.servers.length > 0) {
      if (activeServersContainer) activeServersContainer.innerHTML = '';
      if (fullServersGrid) fullServersGrid.innerHTML = '';

      const processServer = (server) => {
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

        return { ...server, displayName, displayHost, badgeText, playersCount, isOfficialFinal };
      };

      const processedServers = data.servers.map(processServer);
      const officialServers = processedServers.filter(s => s.isOfficialFinal);
      const otherServers = processedServers.filter(s => !s.isOfficialFinal);

      const renderServerToGrid = (server, container, isFullGrid) => {
        const mapImgUrl = \`\${ASSET_URL}/assets/maps/\${server.map}.jpg\`;
        const defaultImgUrl = \`\${ASSET_URL}/cs-assets/cs_bg.png\`;
        
        if (!isFullGrid) {
          // Mini Liste
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
            <div style="margin-top:0.6rem; text-align:center;">
              <div style="font-size:0.8rem; font-family:var(--font-title); color:var(--text-bright); margin-bottom:2px;">\${server.displayName}</div>
              <div style="font-size:0.65rem; color:var(--cs-yellow-dim);">\${server.badgeText}</div>
            </div>
          \`;
          div.addEventListener('click', () => {
            if (!getCurrentUser()) {
              window.openGuestJoinModal(server.port, server.map);
            } else {
              window.connectToServer(server.port, server.map, false);
            }
          });
          container.appendChild(div);
        } else {
          // Full Grid
          const card = document.createElement('div');
          card.className = 'server-card';
          card.innerHTML = \`
            <div class="server-card-header">
              <div class="server-card-badge">\${server.badgeText}</div>
              <div class="server-card-status"></div>
            </div>
            <div style="position:relative; width:100%; height:120px; overflow:hidden; border-bottom:1px solid var(--border);">
              <img crossorigin="anonymous" src="\${mapImgUrl}" style="width:100%; height:100%; object-fit:cover; opacity:0.6;" onerror="this.onerror=null; this.src='\${defaultImgUrl}';" />
              <div style="position:absolute; bottom:0; left:0; right:0; background:linear-gradient(transparent, rgba(0,0,0,0.9)); padding:1rem;">
                <div style="color:var(--text-bright); font-family:var(--font-title); font-size:1.1rem; margin-bottom:0.2rem;">\${server.displayName}</div>
                <div style="color:var(--text-dim); font-size:0.75rem;">\${server.displayHost}</div>
              </div>
            </div>
            <div class="server-card-body">
              <div class="server-stat"><span>🗺️ Harita</span><span style="color:var(--cs-yellow);">\${server.map}</span></div>
              <div class="server-stat"><span>👤 Oyuncu</span><span style="color:#4caf50;">\${server.playersCount} / \${server.maxplayers}</span></div>
            </div>
            <div class="server-card-footer">
              <button class="toolbar-btn btn-join-room" style="width:100%; border-color:var(--cs-yellow); color:var(--cs-yellow);">▶ ODAYA KATIL</button>
            </div>
          \`;
          card.querySelector('.btn-join-room').addEventListener('click', () => {
            if (!getCurrentUser()) {
              window.openGuestJoinModal(server.port, server.map);
            } else {
              window.connectToServer(server.port, server.map, false);
            }
          });
          container.appendChild(card);
        }
      };

      if (activeServersContainer) {
        officialServers.forEach(s => renderServerToGrid(s, activeServersContainer, false));
        otherServers.forEach(s => renderServerToGrid(s, activeServersContainer, false));
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
          header.style.marginTop = '1rem';
          header.style.marginBottom = '0.5rem';
          header.textContent = "⭐ BrowserCS'nin Resmi Sunucuları";
          fullServersGrid.appendChild(header);
          officialServers.forEach(s => renderServerToGrid(s, fullServersGrid, true));
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
          otherServers.forEach(s => renderServerToGrid(s, fullServersGrid, true));
        }
      }
    }`;

code = code.replace(match[0], replacement + '\n  } catch (err) {');
fs.writeFileSync('src/main.js', code);
console.log('Server grid logic patched successfully');
