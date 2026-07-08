const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

const modalsCode = `
// CUSTOM MODALS
window.customAlert = function(msg, title = 'BİLGİ') {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-alert-modal');
    const titleEl = document.getElementById('custom-alert-title');
    const msgEl = document.getElementById('custom-alert-message');
    const btnOk = document.getElementById('btn-custom-alert-ok');
    if (!modal) { alert(msg); resolve(); return; }
    
    titleEl.textContent = title;
    msgEl.innerHTML = msg.replace(/\\n/g, '<br/>');
    modal.style.display = 'flex';
    
    const onClick = () => {
      modal.style.display = 'none';
      btnOk.removeEventListener('click', onClick);
      resolve();
    };
    btnOk.addEventListener('click', onClick);
  });
};

window.customPrompt = function(msg, defaultVal = '', title = 'GİRDİ BEKLENİYOR') {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-prompt-modal');
    const titleEl = document.getElementById('custom-prompt-title');
    const msgEl = document.getElementById('custom-prompt-message');
    const inputEl = document.getElementById('custom-prompt-input');
    const btnOk = document.getElementById('btn-custom-prompt-ok');
    const btnCancel = document.getElementById('btn-custom-prompt-cancel');
    
    if (!modal) { resolve(prompt(msg, defaultVal)); return; }
    
    titleEl.textContent = title;
    msgEl.textContent = msg;
    inputEl.value = defaultVal;
    inputEl.type = msg.toLowerCase().includes('şifre') ? 'password' : 'text';
    modal.style.display = 'flex';
    inputEl.focus();
    
    const cleanup = () => {
      modal.style.display = 'none';
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
    };
    
    const onOk = () => { cleanup(); resolve(inputEl.value); };
    const onCancel = () => { cleanup(); resolve(null); };
    
    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
};

// Override native alert and prompt safely
window.alert = (msg) => { window.customAlert(msg); };
// Cannot cleanly override prompt as it is synchronous, but we can replace its usages in code.
`;

code = modalsCode + '\n' + code;

fs.writeFileSync('src/main.js', code);
console.log('Modals injected to main.js');
