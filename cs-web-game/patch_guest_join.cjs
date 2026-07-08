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
      if (!nick) { notify('Lütfen geçerli bir isim girin!', 'error'); return; }
      
      // close modal
      modal.style.display = 'none';
      btnSubmit.removeEventListener('click', onSubmit);
      
      // set the global nickname input if it exists
      const globalNickInput = document.getElementById('user-nickname');
      if (globalNickInput) {
        globalNickInput.value = nick;
      }
      
      window.connectToServer(port, mapName, false);
      if (typeof fullServerBrowser !== 'undefined' && fullServerBrowser) fullServerBrowser.classList.remove('active');
    };
    
    // reset listener
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
code = code.replace(
  `    if (!getCurrentUser()) {
      const loginModal = document.getElementById('login-modal');
      if (loginModal) loginModal.style.display = 'flex';
      notify('Oyuna katılmak için önce üye girişi yapmalısınız!', 'error');
      return;
    }`,
  `    if (!getCurrentUser()) {
      btnQuickJoin.disabled = false;
      btnQuickJoin.textContent = '▶ SUNUCUYA KATIL';
      window.openGuestJoinModal(target.port, target.map);
      return;
    }`
);

// We need to fix the "target" variable in btnQuickJoin since we need it for openGuestJoinModal.
// Wait, the check was AT THE START of btnQuickJoin.addEventListener, before fetching servers!
// If I moved the check there, `target` is not defined yet.
