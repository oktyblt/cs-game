const fs = require('fs');
let code = fs.readFileSync('src/auth.js', 'utf8');

// Insert the logout listener inside initAuth, right before the auth state listener
const logoutCode = `
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.customAlert('Çıkış yapıldı.', 'BAŞARILI');
      
      // Additional cleanup just in case
      authSection.style.display = 'flex';
      userSection.style.display = 'none';
      document.getElementById('badge-premium').style.display = 'none';
      const nickInput = document.getElementById("user-nickname");
      if (nickInput) {
         nickInput.value = '';
         nickInput.readOnly = false;
         nickInput.style.opacity = '1';
      }
    });
  }
`;

code = code.replace(
  `  // Auth state listener`,
  logoutCode + `\n  // Auth state listener`
);

fs.writeFileSync('src/auth.js', code);
console.log('auth.js patched for logout');
