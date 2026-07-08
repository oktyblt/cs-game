const fs = require('fs');
let code = fs.readFileSync('src/index.html', 'utf8');

// 1. Remove guest-nickname-modal
code = code.replace(/<!-- GUEST NICKNAME MODAL -->[\s\S]*?<\/div>\s*<\/div>/, '');
// just in case the comment was missing:
code = code.replace(/<div id="guest-nickname-modal"[\s\S]*?<\/div>\s*<\/div>/, '');

// 2. Change btn-sidebar-buy-server name and text centering
code = code.replace(
  `<div class="sidebar-info">
        <div id="map-count-info">📁 Haritalar ve Sunucular</div>
        <button id="btn-sidebar-buy-server" class="toolbar-btn" style="width:100%; margin-top:0.6rem; padding:0.6rem; border-color:var(--cs-yellow); color:#050810; background:var(--cs-yellow); font-weight:bold; font-size:0.75rem;">⭐ SUNUCU KİRALA</button>
        <div style="margin-top:0.6rem;">🎮 CS 1.5</div>
        <div>🌐 browsercs.com</div>
      </div>`,
  `<div class="sidebar-info" style="text-align:center;">
        <button id="btn-sidebar-buy-server" class="toolbar-btn" style="width:100%; padding:0.6rem; border-color:var(--cs-yellow); color:#050810; background:var(--cs-yellow); font-weight:bold; font-size:0.75rem;">SUNUCU KİRALA</button>
        <div style="margin-top:0.6rem;">CS 1.5</div>
        <div>browsercs.com</div>
      </div>`
);

fs.writeFileSync('src/index.html', code);
console.log('index.html updated');
