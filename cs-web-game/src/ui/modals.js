// CUSTOM MODALS — CS Temalı (Alert / Confirm / Prompt)
function csModalShow(el) { if (el) { el.style.display = 'flex'; } }
function csModalHide(el) { if (el) { el.style.display = 'none'; } }

window.customAlert = function (msg, title = 'BİLGİ') {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-alert-modal');
    const titleEl = document.getElementById('custom-alert-title');
    const msgEl = document.getElementById('custom-alert-message');
    const btnOk = document.getElementById('btn-custom-alert-ok');
    if (!modal || !btnOk) {
      // Fallback: native alert yok, sadece console
      console.warn('[customAlert]', msg);
      resolve();
      return;
    }
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.innerHTML = msg.replace(/\n/g, '<br/>');
    csModalShow(modal);

    const onOk = () => {
      csModalHide(modal);
      btnOk.removeEventListener('click', onOk);
      document.removeEventListener('keydown', onKey);
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Enter' || e.key === 'Escape') onOk(); };
    btnOk.addEventListener('click', onOk);
    document.addEventListener('keydown', onKey);
  });
};

window.customPrompt = function (msg, defaultVal = '', title = 'GİRDİ BEKLENİYOR') {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-prompt-modal');
    const titleEl = document.getElementById('custom-prompt-title');
    const msgEl = document.getElementById('custom-prompt-message');
    const inputEl = document.getElementById('custom-prompt-input');
    const btnOk = document.getElementById('btn-custom-prompt-ok');
    const btnCan = document.getElementById('btn-custom-prompt-cancel');
    if (!modal || !btnOk || !inputEl) {
      console.warn('[customPrompt]', msg);
      resolve(defaultVal || null);
      return;
    }
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg;
    inputEl.value = defaultVal;
    inputEl.type = (msg.toLowerCase().includes('şifre') || msg.toLowerCase().includes('password')) ? 'password' : 'text';
    csModalShow(modal);
    setTimeout(() => inputEl.focus(), 80);

    const cleanup = () => {
      csModalHide(modal);
      btnOk.removeEventListener('click', onOk);
      if (btnCan) btnCan.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    };
    const onOk = () => { cleanup(); resolve(inputEl.value); };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    btnOk.addEventListener('click', onOk);
    if (btnCan) btnCan.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
};

window.customConfirm = function (msg, title = 'ONAY') {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-confirm-modal');
    const titleEl = document.getElementById('custom-confirm-title');
    const msgEl = document.getElementById('custom-confirm-message');
    const btnOk = document.getElementById('btn-custom-confirm-ok');
    const btnCan = document.getElementById('btn-custom-confirm-cancel');
    if (!modal || !btnOk) {
      console.warn('[customConfirm]', msg);
      resolve(false);
      return;
    }
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = msg;
    csModalShow(modal);

    const cleanup = () => {
      csModalHide(modal);
      btnOk.removeEventListener('click', onOk);
      if (btnCan) btnCan.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    };
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); onOk(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    btnOk.addEventListener('click', onOk);
    if (btnCan) btnCan.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
};

// Native alert'i override et (sync kullanımları yakala)
window.alert = (msg) => { window.customAlert(String(msg)); };

window.openGuestNameModal = function (port, mapName) {
  return new Promise(resolve => {
    // Misafir akışı: önceki üye oturumundan kalan admin şifresini sil
    if (typeof window.clearAmxPasswordCache === 'function') window.clearAmxPasswordCache();
    const modal = document.getElementById('guest-name-modal');
    const input = document.getElementById('guest-name-input');
    const btnSubmit = document.getElementById('btn-guest-name-submit');
    if (!modal || !input || !btnSubmit) {
      // fallback: just connect with stored or default name
      resolve(localStorage.getItem('cs_nickname') || 'Player');
      return;
    }
    // Pre-fill with previously stored name
    input.value = localStorage.getItem('cs_nickname') || '';
    modal.style.display = 'flex';
    input.focus();

    const doConnect = () => {
      const nick = input.value.trim();
      if (!nick) { input.style.border = '1px solid var(--cs-red)'; return; }
      input.style.border = '';
      if (typeof window.clearAmxPasswordCache === 'function') window.clearAmxPasswordCache();
      // Persist for next time
      localStorage.setItem('cs_nickname', nick);
      // Also set the main nickname input
      const globalNick = document.getElementById('user-nickname');
      if (globalNick && !globalNick.readOnly) globalNick.value = nick;
      modal.style.display = 'none';
      cleanup();
      resolve(nick);
    };

    const onCancel = () => {
      modal.style.display = 'none';
      cleanup();
      resolve(null);
    };

    const cleanup = () => {
      const cloneBtn = btnSubmit.cloneNode(true);
      btnSubmit.parentNode.replaceChild(cloneBtn, btnSubmit);
      input.removeEventListener('keydown', onEnter);
      const cancelBtn = document.querySelector('#guest-name-modal button:last-child');
      if (cancelBtn) cancelBtn.onclick = null;
    };

    const onEnter = (e) => { if (e.key === 'Enter') doConnect(); };
    input.addEventListener('keydown', onEnter);
    btnSubmit.addEventListener('click', doConnect);

    const cancelBtn = modal.querySelector('button:last-child');
    if (cancelBtn) cancelBtn.onclick = onCancel;
  });
};
// Override native alert and prompt safely
window.alert = (msg) => { window.customAlert(msg); };
// Cannot cleanly override prompt as it is synchronous, but we can replace its usages in code.
