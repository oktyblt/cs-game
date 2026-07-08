import { supabase, signUp, signIn, signOut, getProfile, getMyServers, buyServer } from './supabase.js';

// API backend URL - env variable'dan al
const API_BACKEND = import.meta.env.VITE_API_URL || 'https://backend.browsercs.com';

let currentUser = null;
let currentProfile = null;

export async function initAuth() {
  const authSection = document.getElementById('auth-section');
  const userSection = document.getElementById('user-profile-section');
  const userName = document.getElementById('user-display-name');

  const btnLogin = document.getElementById('btn-login');
  const btnRegister = document.getElementById('btn-register');
  const btnLogout = document.getElementById('btn-logout');
  const btnDashboard = document.getElementById('btn-dashboard');
  const loginModal = document.getElementById('login-modal');
  const registerModal = document.getElementById('register-modal');
  const dashModal = document.getElementById('dashboard-modal');
  
  // Modals
  btnLogin.onclick = () => loginModal.style.display = 'flex';
  btnRegister.onclick = () => registerModal.style.display = 'flex';
  btnDashboard.onclick = () => {
    dashModal.style.display = 'flex';
    refreshDashboard();
  };

  // Logout — single handler
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await supabase.auth.signOut();
      authSection.style.display = 'flex';
      userSection.style.display = 'none';
      document.getElementById('badge-premium').style.display = 'none';
      const nickInput = document.getElementById('user-nickname');
      if (nickInput) {
        nickInput.readOnly = false;
        nickInput.style.opacity = '1';
        // Keep any name the guest had typed
      }
      window.customAlert('Çıkış yapıldı.', 'BAŞARILI');
    });
  }

  // Auth state listener
  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
      // Run async logic in background to prevent Supabase deadlock
      (async () => {
        try {
          const { data: profile, error } = await getProfile(session.user.id);
          
          let activeProfile = profile;
          if (error || !profile) {
            console.warn("Profile fetch error or missing profile. Falling back to session data.", error);
            activeProfile = {
              username: session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'Oyuncu',
              is_premium: false
            };
          }

          currentUser = session.user;
          currentProfile = activeProfile;
          
          authSection.style.display = 'none';
          userSection.style.display = 'flex';
          
          const finalUsername = activeProfile.username || session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'Oyuncu';
          activeProfile.username = finalUsername;

          if (userName) userName.textContent = finalUsername;
          const nickInput = document.getElementById('user-nickname');
          if (nickInput) {
            nickInput.value = finalUsername;
            nickInput.readOnly = true;
            nickInput.style.opacity = '0.7';
          }

          const badge = document.getElementById('badge-premium');
          if (badge) {
            badge.style.display = activeProfile.is_premium ? 'block' : 'none';
          }

        } catch (err) {
          console.warn("Auth sync failed:", err);
          currentUser = null;
          currentProfile = null;
          authSection.style.display = 'flex';
          userSection.style.display = 'none';
          const badge = document.getElementById('badge-premium');
          if (badge) badge.style.display = 'none';
          // Force sign out on critical failure
          supabase.auth.signOut().catch(e => console.error(e));
        }
      })();
    } else {
      currentUser = null;
      currentProfile = null;
      authSection.style.display = 'flex';
      userSection.style.display = 'none';
      const badge = document.getElementById('badge-premium');
      if (badge) badge.style.display = 'none';
    }
  });

  // Tab key support for login form
  const loginEmail = document.getElementById('login-email');
  const loginPass  = document.getElementById('login-pass');
  const btnSubmitLogin = document.getElementById('btn-submit-login');
  if (loginEmail) loginEmail.setAttribute('tabindex', '1');
  if (loginPass)  loginPass.setAttribute('tabindex', '2');
  if (btnSubmitLogin) btnSubmitLogin.setAttribute('tabindex', '3');

  // Tab key support for register form
  const regUsername = document.getElementById('reg-username');
  const regEmail    = document.getElementById('reg-email');
  const regPass     = document.getElementById('reg-pass');
  const btnSubmitReg = document.getElementById('btn-submit-register');
  if (regUsername)  regUsername.setAttribute('tabindex', '1');
  if (regEmail)     regEmail.setAttribute('tabindex', '2');
  if (regPass)      regPass.setAttribute('tabindex', '3');
  if (btnSubmitReg) btnSubmitReg.setAttribute('tabindex', '4');

  // Enter key to submit login
  if (loginPass) {
    loginPass.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSubmitLogin?.click();
    });
  }
  if (loginEmail) {
    loginEmail.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') loginPass?.focus();
    });
  }

  // Enter key to submit register
  if (regPass) {
    regPass.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btnSubmitReg?.click();
    });
  }

  // Login
  if (btnSubmitLogin) {
    btnSubmitLogin.onclick = async () => {
      const originalText = btnSubmitLogin.textContent;
      btnSubmitLogin.textContent = 'Giriş Yapılıyor...';
      btnSubmitLogin.disabled = true;
      try {
        const email = loginEmail?.value || '';
        const pass  = loginPass?.value || '';
        if (!email || !pass) { window.customAlert('E-posta ve şifre zorunludur.'); return; }
        const { error } = await signIn(email, pass);
        if (error) window.customAlert('Hata: ' + error.message);
        else loginModal.style.display = 'none';
      } catch(err) {
        window.customAlert('Beklenmeyen bir hata oluştu: ' + err.message);
      } finally {
        btnSubmitLogin.textContent = originalText;
        btnSubmitLogin.disabled = false;
      }
    };
  }

  // Register
  const btnSubmitRegister = document.getElementById('btn-submit-register');
  if (btnSubmitRegister) {
    btnSubmitRegister.onclick = async () => {
      const originalText = btnSubmitRegister.textContent;
      btnSubmitRegister.textContent = 'Kayıt Olunuyor...';
      btnSubmitRegister.disabled = true;
      try {
        const user  = document.getElementById('reg-username')?.value || '';
        const email = document.getElementById('reg-email')?.value || '';
        const pass  = document.getElementById('reg-pass')?.value || '';
        if (!user || !email || !pass) { window.customAlert('Tüm alanlar zorunludur.'); return; }
        // Şifre güç kontrolü
        if (pass.length < 8) { window.customAlert('Şifre en az 8 karakter olmalıdır.'); return; }
        if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) {
          window.customAlert('Şifre en az bir büyük harf ve bir rakam içermelidir.'); return;
        }
        const { error } = await signUp(email, pass, user);
        if (error) window.customAlert('Hata: ' + error.message);
        else {
          window.customAlert('Kayıt başarılı! Giriş yapabilirsiniz.');
          registerModal.style.display = 'none';
          loginModal.style.display = 'flex';
        }
      } catch(err) {
        window.customAlert('Beklenmeyen bir hata oluştu: ' + err.message);
      } finally {
        btnSubmitRegister.textContent = originalText;
        btnSubmitRegister.disabled = false;
      }
    };
  }

  // Buy server in dashboard — NO map/name before payment
  const btnBuyServer = document.getElementById('btn-buy-server');
  if (btnBuyServer) {
    btnBuyServer.onclick = async () => {
      if (!currentUser) return window.customAlert('Lütfen önce giriş yapın.');
      
      btnBuyServer.disabled = true;
      const originalText = btnBuyServer.textContent;
      btnBuyServer.textContent = 'YÖNLENDİRİLİYOR...';
      
      try {
      // VIP Kullanıcı Kontrolü - Supabase profil üzerinden
        if (currentProfile?.is_premium || currentProfile?.role === 'vip' || currentProfile?.role === 'admin') {
          const sName = prompt("Sunucu Adı Girin:", "bymTL Özel Sunucu") || "bymTL Özel Sunucu";
          const sMap = prompt("Harita Seçin (de_dust2, de_inferno vb.):", "de_dust2") || "de_dust2";
          
          btnBuyServer.disabled = true;
          btnBuyServer.textContent = 'OLUŞTURULUYOR...';

          window.customAlert('VIP Üye Tanındı: AWS üzerinde sunucunuz başlatılıyor...', 'BAŞARILI');
          
          const session = await supabase.auth.getSession();
          const token = session.data?.session?.access_token;

          // 1. Start the actual Docker server on AWS Backend
          const res = await fetch(`${API_BACKEND}/api/start-server`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ map: sMap, maxplayers: 16, name: sName, host: 'bymTL' })
          });
          
          const d = await res.json();
          if (d.success && d.port) {
            // 2. Save it to Supabase so it shows up in "Satın Alınan Sunucularım"
            const { createPurchasedServer } = await import('./supabase.js');
            const dbRes = await createPurchasedServer(currentUser.id, sName, sMap, 16, d.port);
            
            if (dbRes.error) {
              window.customAlert('AWS Sunucusu açıldı ancak veritabanı kayıt hatası: ' + dbRes.error.message);
            } else {
              window.customAlert('AWS Sunucunuz başarıyla oluşturuldu ve aktif edildi! Dashboard üzerinden bağlanabilirsiniz.', 'BAŞARILI');
              if (window.refreshDashboard) window.refreshDashboard();
            }
          } else {
            window.customAlert('İşlem başarısız: AWS Sunucusu başlatılamadı. ' + (d.error || ''));
          }
          btnBuyServer.disabled = false;
          btnBuyServer.textContent = originalText;
          return;
        }

        // Use a generic placeholder — server details filled AFTER payment
        const { data, error } = await buyServer(currentUser.id, 'CS 1.5 Sunucu', 'de_dust2', 16);
        
        if (data && data.checkout_url) {
          // Re-enable before redirecting (for BFCache on return)
          btnBuyServer.disabled = false;
          btnBuyServer.textContent = originalText;
          window.location.href = data.checkout_url;
        } else {
          btnBuyServer.disabled = false;
          btnBuyServer.textContent = originalText;
          if (error) {
            window.customAlert('İşlem başarısız: ' + error.message);
          } else {
            window.customAlert('Stripe bağlantısı kurulamadı. Lütfen daha sonra tekrar deneyin.');
          }
        }
      } catch(err) {
        btnBuyServer.disabled = false;
        btnBuyServer.textContent = originalText;
        window.customAlert('Hata: ' + err.message);
      }
    };
  }

  // Handle Stripe return (pageshow covers BFCache)
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      // Browser navigated back from Stripe via BFCache
      const btns = ['btn-buy-server', 'btn-buy-premium'];
      btns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.disabled = false;
          btn.textContent = btn.id === 'btn-buy-premium' ? '💳 Satın Al' : '350 ₺ - SATIN AL';
        }
      });
      // Show cancel notice
      const cancelParam = new URLSearchParams(window.location.search).get('payment');
      if (cancelParam === 'cancel') {
        window.customAlert('Ödeme işlemi iptal edildi. İstediğiniz zaman tekrar deneyebilirsiniz.', 'İPTAL EDİLDİ');
      }
    }
  });

  // Check URL params for payment result
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('payment') === 'success') {
    window.customAlert('Ödeme başarılı! Sunucunuz en kısa sürede aktif edilecektir.', 'ÖDEME BAŞARILI');
  } else if (urlParams.get('payment') === 'cancel') {
    window.customAlert('Ödeme işlemi iptal edildi.', 'İPTAL EDİLDİ');
  }
}

async function refreshDashboard() {
  if (!currentUser) return;
  const list = document.getElementById('my-servers-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-dim);">Sunucularınız yükleniyor...</div>';
  
  const { data: servers, error } = await getMyServers(currentUser.id);
  if (error || !servers || servers.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-dim);font-family:var(--font-ui);font-size:0.8rem;">Henüz satın aldığınız bir sunucu bulunmuyor.</div>';
    return;
  }
  
  list.innerHTML = '';
  servers.forEach(srv => {
    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg-panel);border:1px solid var(--border-bright);padding:0.8rem;border-radius:4px;display:flex;justify-content:space-between;align-items:center;';
    
    const isActive  = srv.status === 'active' || srv.status === 'running';
    const isPending = srv.status === 'pending';
    const statusColor = isActive ? 'var(--cs-green)' : (isPending ? 'var(--cs-yellow)' : 'var(--cs-red)');
    const statusText  = isActive ? 'AKTİF 7/24' : (isPending ? 'ÖDEME BEKLENİYOR...' : 'SÜRESİ DOLDU');

    // XSS korunmalı HTML yapısı - kullanıcı verisi textContent ile set edilir
    const infoDiv = document.createElement('div');
    
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-family:var(--font-hud);color:var(--text-bright);font-size:0.9rem;';
    nameEl.textContent = srv.name;  // XSS-safe: textContent
    
    const detailEl = document.createElement('div');
    detailEl.style.cssText = 'font-family:var(--font-ui);color:var(--text-dim);font-size:0.75rem;margin-top:0.3rem;';
    detailEl.textContent = `Harita: ${srv.map} | Slot: ${srv.max_players}`;  // XSS-safe
    
    const statusEl = document.createElement('div');
    statusEl.style.cssText = `font-family:var(--font-hud);color:${statusColor};font-size:0.7rem;margin-top:0.4rem;`;
    statusEl.textContent = statusText;
    
    infoDiv.appendChild(nameEl);
    infoDiv.appendChild(detailEl);
    infoDiv.appendChild(statusEl);
    
    const btnDiv = document.createElement('div');
    btnDiv.style.cssText = 'display:flex;gap:0.5rem;';
    
    const manageBtn = document.createElement('button');
    manageBtn.className = 'toolbar-btn';
    manageBtn.style.cssText = 'padding:0.4rem;font-size:0.7rem;background:var(--bg-hover);';
    manageBtn.textContent = 'YÖNET';
    manageBtn.disabled = !isActive;
    manageBtn.addEventListener('click', () => {
      if (window.openServerSettings) {
        window.openServerSettings(srv.id);
        document.getElementById('dashboard-modal').style.display = 'none';
      } else {
        window.customAlert('Ayarlar menüsü yüklenemedi.');
      }
    });
    
    const joinBtn = document.createElement('button');
    joinBtn.className = 'toolbar-btn';
    joinBtn.style.cssText = 'padding:0.4rem;font-size:0.7rem;border-color:var(--cs-yellow);color:var(--cs-yellow);';
    joinBtn.textContent = 'BAĞLA (ADMİN)';
    joinBtn.disabled = !isActive;
    joinBtn.addEventListener('click', () => {
      joinMyServer(srv.id, srv.map, srv.max_players, srv.port || 0);
    });
    
    btnDiv.appendChild(manageBtn);
    btnDiv.appendChild(joinBtn);
    div.appendChild(infoDiv);
    div.appendChild(btnDiv);
    list.appendChild(div);
  });
}

window.joinMyServer = (roomId, mapName, maxplayers, port) => {
  if (!roomId) return window.customAlert('Sunucu geçersiz.');
  document.getElementById('dashboard-modal').style.display = 'none';
  // Admin token sadece oturum boyunca sessionStorage'da saklanır
  sessionStorage.setItem('cs_admin_token', 'premium_owner_' + roomId);
  
  if (port && port > 0) {
     const adminPw = prompt("Lütfen YÖNET panelinde belirlediğiniz Admin Şifrenizi giriniz (Henüz belirlemediyseniz boş bırakın):");
     if (adminPw) {
       localStorage.setItem('cs_amx_pw', adminPw);
     } else {
       localStorage.removeItem('cs_amx_pw');
     }
     window.customAlert('Admin yetkisi onaylandı. Dedicated AWS Sunucusuna bağlanılıyor...');
     if (window.connectToServer) {
       window.connectToServer(port, mapName, false);
     }
  } else {
     if (window.connectToServer) {
       if (window.joinRoomAsAdmin) {
          window.joinRoomAsAdmin(roomId, mapName, maxplayers);
       } else {
          window.customAlert('Admin yetkisi onaylandı. Sunucuya bağlanılıyor...');
          window.location.hash = '#room=' + roomId + '&role=host';
          window.location.reload();
       }
     }
  }
};

// === Server Management Logic ===
window.openManageModal = (containerId) => {
  if (!containerId || containerId === 'undefined') return window.customAlert('Bu sunucu henüz yönetilebilir durumda değil. Lütfen AWS tarafından başlatılmasını bekleyin.');
  document.getElementById('manage-server-id').value = containerId;
  document.getElementById('server-manage-modal').style.display = 'flex';
};

document.addEventListener('DOMContentLoaded', () => {
  const manageModal = document.getElementById('server-manage-modal');
  if (manageModal) {
    document.getElementById('close-manage-btn').onclick = () => manageModal.style.display = 'none';
    
    const API_BACKEND_LOCAL = import.meta.env.VITE_API_URL || 'https://backend.browsercs.com';

    document.getElementById('btn-save-rcon').onclick = async () => {
      const id   = document.getElementById('manage-server-id').value;
      const pass = document.getElementById('rcon-password-input').value;
      if (!pass) return window.customAlert('Lütfen bir şifre girin.');
      document.getElementById('btn-save-rcon').textContent = 'Kaydediliyor...';
      try {
        const res  = await fetch(`${API_BACKEND_LOCAL}/api/servers/${id}/rcon`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ rconPassword: pass })
        });
        const data = await res.json();
        if (data.success) window.customAlert('RCON Şifresi başarıyla ayarlandı!');
        else window.customAlert('Hata: ' + data.error);
      } catch(e) { window.customAlert('Bağlantı hatası!'); }
      document.getElementById('btn-save-rcon').textContent = 'Kaydet';
    };

    document.getElementById('btn-save-admin').onclick = async () => {
      const id   = document.getElementById('manage-server-id').value;
      const name = document.getElementById('admin-name-input').value;
      const pass = document.getElementById('admin-password-input').value;
      if (!name) return window.customAlert('Lütfen oyuncu adınızı girin.');
      document.getElementById('btn-save-admin').textContent = 'Ekleniyor...';
      try {
        const res  = await fetch(`${API_BACKEND_LOCAL}/api/servers/${id}/admin`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ adminName: name, adminPassword: pass })
        });
        const data = await res.json();
        if (data.success) window.customAlert('Admin başarıyla eklendi!');
        else window.customAlert('Hata: ' + data.error);
      } catch(e) { window.customAlert('Bağlantı hatası!'); }
      document.getElementById('btn-save-admin').textContent = 'Ekle';
    };

    document.getElementById('btn-restart-server').onclick = async () => {
      const id = document.getElementById('manage-server-id').value;
      const confirmed = await window.customConfirm('Sunucuyu yeniden başlatmak istediğinize emin misiniz? İçerideki oyuncular düşer.');
      if (!confirmed) return;
      document.getElementById('btn-restart-server').textContent = 'Yeniden Başlatılıyor...';
      try {
        const res  = await fetch(`${API_BACKEND_LOCAL}/api/servers/${id}/restart`, { method: 'POST' });
        const data = await res.json();
        if (data.success) window.customAlert('Sunucu yeniden başlatıldı!');
        else window.customAlert('Hata: ' + data.error);
      } catch(e) { window.customAlert('Bağlantı hatası!'); }
      document.getElementById('btn-restart-server').textContent = 'Sunucuyu Yeniden Başlat';
    };
  }
});

export function getCurrentUsername() {
  return currentProfile ? currentProfile.username : null;
}

export function getCurrentUser() {
  return currentUser;
}

export function isUserPremium() {
  // VIP/admin kontrolü Supabase profilü üzerinden yapılır (hardcoded email yok)
  if (currentProfile?.role === 'admin' || currentProfile?.role === 'vip') return true;
  return currentProfile ? currentProfile.is_premium : false;
}

export async function getSessionToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}
