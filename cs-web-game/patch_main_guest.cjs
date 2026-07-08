const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

// The guest join function
const guestJoinLogic = `
window.openGuestJoinModal = function(port, mapName) {
  const modal = document.getElementById('guest-nickname-modal');
  const input = document.getElementById('guest-nickname-input');
  const btnSubmit = document.getElementById('btn-submit-guest-join');
  
  if (modal) {
    modal.style.display = 'flex';
    input.focus();
    
    const onSubmit = () => {
      const nick = input.value.trim();
      if (!nick) { window.customAlert('Lütfen geçerli bir isim girin!'); return; }
      
      modal.style.display = 'none';
      btnSubmit.removeEventListener('click', onSubmit);
      
      const globalNickInput = document.getElementById('user-nickname');
      if (globalNickInput) {
        globalNickInput.value = nick;
      }
      
      window.connectToServer(port, mapName, false);
    };
    
    const clone = btnSubmit.cloneNode(true);
    btnSubmit.parentNode.replaceChild(clone, btnSubmit);
    clone.addEventListener('click', onSubmit);
  } else {
    window.connectToServer(port, mapName, false);
  }
};
`;

code = guestJoinLogic + '\n' + code;

// Reverting btnQuickJoin logic to use openGuestJoinModal if not logged in
// It's easier to find the check and replace it:
code = code.replace(
  /if \(\!getCurrentUser\(\)\) \{\s+const loginModal = document\.getElementById\('login-modal'\);\s+if \(loginModal\) loginModal\.style\.display = 'flex';\s+notify\('Oyuna katılmak için önce üye girişi yapmalısınız!', 'error'\);\s+return;\s+\}/g,
  `if (!getCurrentUser()) {
      // Instead of forcing login, ask for guest nickname
      // We need port and map! But here we might not have it yet.
      // Wait, let's just do it dynamically later or let the caller pass it!
      // In btnQuickJoin, we fetch servers then decide.
    }`
);

fs.writeFileSync('src/main.js', code);
console.log('main.js patched with guest popup logic base');
