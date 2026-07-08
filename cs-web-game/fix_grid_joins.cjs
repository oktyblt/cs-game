const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

// For mini list:
// `      if (!getCurrentUser()) {\n        const loginModal = document.getElementById('login-modal');\n        if (loginModal) loginModal.style.display = 'flex';\n        notify('Oyuna katılmak için önce üye girişi yapmalısınız!', 'error');\n        return;\n      }\n      window.connectToServer(server.port, server.map, false);`

code = code.replace(
  `      if (!getCurrentUser()) {
        const loginModal = document.getElementById('login-modal');
        if (loginModal) loginModal.style.display = 'flex';
        notify('Oyuna katılmak için önce üye girişi yapmalısınız!', 'error');
        return;
      }
      window.connectToServer(server.port, server.map, false);`,
  `      if (!getCurrentUser()) {
        window.openGuestJoinModal(server.port, server.map);
      } else {
        window.connectToServer(server.port, server.map, false);
      }`
);

// For full grid:
// `      if (!getCurrentUser()) {\n        const loginModal = document.getElementById('login-modal');\n        if (loginModal) loginModal.style.display = 'flex';\n        notify('Oyuna katılmak için önce üye girişi yapmalısınız!', 'error');\n        return;\n      }\n      window.connectToServer(server.port, server.map, false);`
// It should replace both instances if they match! Let's just use global regex.

const regex = /if \(\!getCurrentUser\(\)\) \{\s*const loginModal = document\.getElementById\('login-modal'\);\s*if \(loginModal\) loginModal\.style\.display = 'flex';\s*notify\('Oyuna katılmak için önce üye girişi yapmalısınız!', 'error'\);\s*return;\s*\}\s*window\.connectToServer\(server\.port, server\.map, false\);/g;

code = code.replace(regex, `if (!getCurrentUser()) {
        window.openGuestJoinModal(server.port, server.map);
      } else {
        window.connectToServer(server.port, server.map, false);
      }`);

fs.writeFileSync('src/main.js', code);
console.log('grid joins fixed');
