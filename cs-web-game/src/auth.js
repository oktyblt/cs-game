import { supabase, signUp, signIn, signOut, getProfile, getMyServers, buyServer } from './supabase.js';

let currentUser = null;
let currentProfile = null;

export async function initAuth() {
  const authSection = document.getElementById('auth-section');
  const userSection = document.getElementById('user-profile-section');
  const userName = document.getElementById('user-display-name');
  const dashWallet = document.getElementById('dash-wallet');
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

  // Auth state listener
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      currentUser = session.user;
      authSection.style.display = 'none';
      userSection.style.display = 'flex';
      
      const { data: profile } = await getProfile(currentUser.id);
      if (profile) {
        currentProfile = profile;
        userName.textContent = profile.username;
        const nickInput = document.getElementById("user-nickname");
        if (nickInput) nickInput.value = profile.username;
        dashWallet.textContent = profile.wallet_balance;
        if (profile.is_premium) {
          document.getElementById('badge-premium').style.display = 'block';
        }
      }
    } else {
      currentUser = null;
      currentProfile = null;
      authSection.style.display = 'flex';
      userSection.style.display = 'none';
      document.getElementById('badge-premium').style.display = 'none';
    }
  });

  // Login
  document.getElementById('btn-submit-login').onclick = async () => {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;
    const { error } = await signIn(email, pass);
    if (error) alert('Hata: ' + error.message);
    else loginModal.style.display = 'none';
  };

  // Register
  document.getElementById('btn-submit-register').onclick = async () => {
    const user = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-pass').value;
    const { error } = await signUp(email, pass, user);
    if (error) alert('Hata: ' + error.message);
    else {
      alert('Kayıt başarılı! Giriş yapabilirsiniz.');
      registerModal.style.display = 'none';
      loginModal.style.display = 'flex';
    }
  };

  // Logout
  btnLogout.onclick = async () => {
    await signOut();
  };

  // Buy server
  document.getElementById('btn-buy-server').onclick = async () => {
    if (!currentUser) return alert('Lütfen önce giriş yapın.');
    const mapName = prompt('Hangi harita ile başlatılsın?', 'de_dust2');
    if (!mapName) return;
    const srvName = prompt('Sunucu adı ne olsun?', `${currentProfile?.username || 'Oyuncu'} CS Server`);
    if (!srvName) return;
    
    document.getElementById('btn-buy-server').disabled = true;
    document.getElementById('btn-buy-server').textContent = 'İŞLENİYOR...';
    
    const { data, error } = await buyServer(currentUser.id, srvName, mapName, 16);
    
    document.getElementById('btn-buy-server').disabled = false;
    document.getElementById('btn-buy-server').textContent = '50 ₺ - SATIN AL';

    if (error) {
      alert('Satın alma başarısız: ' + error.message);
    } else {
      alert('Sunucu satın alındı! AWS tarafından 1-2 dakika içinde başlatılacaktır.');
      refreshDashboard();
      
      // Update wallet UI manually to avoid full reload
      if (currentProfile) {
         currentProfile.wallet_balance -= 50;
         dashWallet.textContent = currentProfile.wallet_balance;
      }
    }
  };

  // Add balance (Fake for now)
  document.getElementById('btn-add-balance').onclick = async () => {
    if (!currentUser || !currentProfile) return;
    // In a real app this would go to Stripe. We just update the DB directly for test.
    const amt = prompt('Kaç ₺ yüklemek istiyorsunuz?', '100');
    if (!amt) return;
    const amount = parseInt(amt);
    if(isNaN(amount)) return;
    
    const { error } = await supabase.from('profiles').update({ wallet_balance: currentProfile.wallet_balance + amount }).eq('id', currentUser.id);
    if(!error) {
       currentProfile.wallet_balance += amount;
       dashWallet.textContent = currentProfile.wallet_balance;
       alert(amount + ' ₺ başarıyla yüklendi!');
    }
  };
}

async function refreshDashboard() {
  if (!currentUser) return;
  const list = document.getElementById('my-servers-list');
  list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-dim);">Sunucularınız yükleniyor...</div>';
  
  const { data: servers, error } = await getMyServers(currentUser.id);
  if (error || !servers || servers.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-dim);font-family:var(--font-ui);font-size:0.8rem;">Henüz satın aldığınız bir sunucu bulunmuyor.</div>';
    return;
  }
  
  list.innerHTML = '';
  servers.forEach(srv => {
    const div = document.createElement('div');
    div.style.background = 'var(--bg-panel)';
    div.style.border = '1px solid var(--border-bright)';
    div.style.padding = '0.8rem';
    div.style.borderRadius = '4px';
    div.style.display = 'flex';
    div.style.justifyContent = 'space-between';
    div.style.alignItems = 'center';
    
    const statusColor = srv.status === 'running' ? 'var(--cs-green)' : (srv.status === 'pending' ? 'var(--cs-yellow)' : 'var(--text-dim)');
    const statusText = srv.status === 'running' ? 'AKTİF (PORT: ' + srv.port + ')' : (srv.status === 'pending' ? 'BAŞLATILIYOR...' : 'KAPALI');

    div.innerHTML = `
      <div>
        <div style="font-family:var(--font-hud);color:var(--text-bright);font-size:0.9rem;">${srv.name}</div>
        <div style="font-family:var(--font-ui);color:var(--text-dim);font-size:0.75rem;margin-top:0.3rem;">Harita: ${srv.map} | Slot: ${srv.max_players}</div>
        <div style="font-family:var(--font-hud);color:${statusColor};font-size:0.7rem;margin-top:0.4rem;">${statusText}</div>
      </div>
      <div style="display:flex; gap:0.5rem;">
        <button class="toolbar-btn" style="padding:0.4rem;font-size:0.7rem; background: var(--bg-hover);" onclick="window.openManageModal('${srv.container_id}')">YÖNET</button>
        <button class="toolbar-btn" style="padding:0.4rem;font-size:0.7rem;" onclick="joinMyServer(${srv.port})">BAĞLAN</button>
      </div>
    `;
    list.appendChild(div);
  });
}

window.joinMyServer = (port) => {
  if (!port) return alert('Sunucu henüz tam olarak başlamadı, lütfen biraz bekleyin.');
  document.getElementById('dashboard-modal').style.display = 'none';
  // Use existing global connectToServer if it exists
  if (window.connectToServer) {
    window.connectToServer(port, '', false);
  } else {
    alert('Sunucuya bağlanılamadı, sistem hazır değil.');
  }
}

// === Server Management Logic ===
window.openManageModal = (containerId) => {
  if (!containerId || containerId === 'undefined') return alert('Bu sunucu henüz yönetilebilir durumda değil. Lütfen AWS tarafından başlatılmasını bekleyin.');
  document.getElementById('manage-server-id').value = containerId;
  document.getElementById('server-manage-modal').style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', () => {
  const manageModal = document.getElementById('server-manage-modal');
  if(manageModal) {
    document.getElementById('close-manage-btn').onclick = () => manageModal.style.display = 'none';
    
    // RCON
    document.getElementById('btn-save-rcon').onclick = async () => {
      const id = document.getElementById('manage-server-id').value;
      const pass = document.getElementById('rcon-password-input').value;
      if(!pass) return alert('Lütfen bir şifre girin.');
      document.getElementById('btn-save-rcon').textContent = 'Kaydediliyor...';
      try {
        const res = await fetch(`http://35.159.95.54:4000/api/servers/${id}/rcon`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ rconPassword: pass })
        });
        const data = await res.json();
        if(data.success) {
          alert('RCON Şifresi başarıyla ayarlandı ve sunucu yeniden başlatıldı!');
        } else {
          alert('Hata: ' + data.error);
        }
      } catch(e) {
        alert('Bağlantı hatası!');
      }
      document.getElementById('btn-save-rcon').textContent = 'Kaydet';
    };

    // Admin
    document.getElementById('btn-save-admin').onclick = async () => {
      const id = document.getElementById('manage-server-id').value;
      const name = document.getElementById('admin-name-input').value;
      const pass = document.getElementById('admin-password-input').value;
      if(!name) return alert('Lütfen oyuncu adınızı girin.');
      document.getElementById('btn-save-admin').textContent = 'Ekleniyor...';
      try {
        const res = await fetch(`http://35.159.95.54:4000/api/servers/${id}/admin`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ adminName: name, adminPassword: pass })
        });
        const data = await res.json();
        if(data.success) {
          alert('Admin başarıyla eklendi! Etkin olması için sunucuyu yeniden başlatabilirsiniz.');
        } else {
          alert('Hata: ' + data.error);
        }
      } catch(e) {
        alert('Bağlantı hatası!');
      }
      document.getElementById('btn-save-admin').textContent = 'Ekle';
    };

    // Restart
    document.getElementById('btn-restart-server').onclick = async () => {
      const id = document.getElementById('manage-server-id').value;
      if(!confirm('Sunucuyu yeniden başlatmak istediğinize emin misiniz? (İçerideki oyuncular düşer)')) return;
      document.getElementById('btn-restart-server').textContent = 'Yeniden Başlatılıyor...';
      try {
        const res = await fetch(`http://35.159.95.54:4000/api/servers/${id}/restart`, { method: 'POST' });
        const data = await res.json();
        if(data.success) alert('Sunucu yeniden başlatıldı!');
        else alert('Hata: ' + data.error);
      } catch(e) {
        alert('Bağlantı hatası!');
      }
      document.getElementById('btn-restart-server').textContent = 'Sunucuyu Yeniden Başlat';
    };
  }
});

export function getCurrentUsername() {
  return currentProfile ? currentProfile.username : null;
}
