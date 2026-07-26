import { supabase, signUp, signIn, signOut, getProfile, getMyServers, buyServer, getMyRentalOrders } from './supabase.js';
import { validatePublicNickname } from './nick.js';

// API backend URL - env variable'dan al
const API_BACKEND = import.meta.env.VITE_API_URL || 'https://backend.browsercs.com';

function showIbanPaymentModal(order, payment, instruction) {
  const modal = document.getElementById('iban-payment-modal');
  if (!modal) {
    window.customAlert(
      `Sipariş oluşturuldu: ${order?.order_code || '?'}\n` +
      `Banka: ${payment?.bankName || 'ENPARA'}\n` +
      `IBAN: ${payment?.bankIban || ''}\n` +
      `Tutar: ${payment?.amountTry || 350} ₺\n` +
      (instruction || 'Havale açıklamasına sipariş numarasını yazın.')
    );
    return;
  }
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? '';
  };
  setText('iban-order-code', order?.order_code || '—');
  setText('iban-bank-name', payment?.bankName || 'ENPARA');
  setText('iban-bank-holder', payment?.bankHolder || 'OKTAY BULUT');
  setText('iban-bank-iban', payment?.bankIban || 'TRXXXXXXXXXXXXXXXXXXXXXXXX');
  setText('iban-amount', `${payment?.amountTry ?? 350} ₺`);
  setText(
    'iban-instruction',
    instruction ||
      'Havale/EFT açıklamasına mutlaka sipariş numarasını yazın. Ödeme onaylanınca sunucunuz kurulur.'
  );
  modal.style.display = 'flex';
}

window.showIbanPaymentModal = showIbanPaymentModal;

async function promptAndCreateRentalOrder() {
  const sName = await window.customPrompt('Sunucu Adı Girin:', 'CS 1.5 Özel Sunucu', 'SUNUCU ADI');
  if (sName === null) return null;
  const sMap = await window.customPrompt('Harita Seçin (de_dust2, de_inferno vb.):', 'de_dust2', 'HARİTA SEÇ');
  if (sMap === null) return null;

  const { data, error } = await buyServer(
    currentUser?.id,
    sName || 'CS 1.5 Özel Sunucu',
    sMap || 'de_dust2',
    16
  );
  if (error) throw error;
  showIbanPaymentModal(data.order, data.payment, data.instruction);
  return data;
}

window.promptAndCreateRentalOrder = promptAndCreateRentalOrder;

let currentUser = null;
let currentProfile = null;
let currentVip = null;

function isProfileBanned(profile) {
  if (!profile || !profile.is_banned) return false;
  if (!profile.banned_until) return true;
  const until = new Date(profile.banned_until);
  if (!Number.isFinite(until.getTime())) return true;
  return until.getTime() > Date.now();
}

function banMessageTr(profile) {
  const reason = String(profile?.ban_reason || '').trim();
  if (reason) return `Hesabınız yasaklandı: ${reason}`;
  if (profile?.banned_until) {
    try {
      const d = new Date(profile.banned_until);
      if (Number.isFinite(d.getTime())) {
        return `Hesabınız geçici olarak yasaklandı. Bitiş: ${d.toLocaleString('tr-TR')}`;
      }
    } catch (_) { /* ignore */ }
  }
  return 'Hesabınız yasaklandı. Destek ile iletişime geçin.';
}

async function enforceBanOrSignOut(profile) {
  if (!isProfileBanned(profile)) return false;
  const msg = banMessageTr(profile);
  try { await signOut(); } catch (_) { /* ignore */ }
  currentUser = null;
  currentProfile = null;
  applyVipUi(null);
  if (typeof window.customAlert === 'function') window.customAlert(msg, 'HESAP YASAKLI');
  else alert(msg);
  return true;
}

function vipTierLabel(tier) {
  const t = String(tier || '').toLowerCase();
  if (t === 'platinum') return 'Platinum';
  if (t === 'gold') return 'Gold';
  if (t === 'silver') return 'Silver';
  return 'VIP';
}

function applyVipUi(vip) {
  currentVip = vip && vip.active ? vip : null;
  const badge = document.getElementById('badge-vip');
  const star = document.getElementById('nick-vip-star');
  const dashStatus = document.getElementById('dash-vip-status');
  const dashLink = document.getElementById('btn-dash-vip-link');
  const dashBuy = document.getElementById('btn-dash-vip-buy');
  const payHint = document.getElementById('dash-vip-pay-hint');

  if (!currentVip) {
    if (badge) {
      badge.style.display = 'none';
      badge.textContent = 'VIP';
      badge.className = 'h-badge badge-vip';
    }
    if (star) star.style.display = 'none';
    if (dashStatus) {
      dashStatus.textContent = 'Aktif VIP aboneliğin yok. Silver 49₺ · Gold 99₺ · Platinum 199₺ / ay.';
    }
    if (dashLink) dashLink.textContent = 'PAKETLER';
    if (dashBuy) {
      dashBuy.style.display = '';
      dashBuy.textContent = 'SATIN AL';
    }
    if (payHint) payHint.style.display = 'none';
    return;
  }

  const tier = String(currentVip.tier || '').toLowerCase();
  const label = currentVip.label || 'VIP';
  const days = currentVip.daysLeft != null
    ? currentVip.daysLeft
    : (currentVip.expiresAt
      ? Math.max(0, Math.ceil((new Date(currentVip.expiresAt).getTime() - Date.now()) / 86400000))
      : 0);

  if (badge) {
    badge.style.display = 'block';
    badge.textContent = tier === 'platinum' ? 'PLATINUM' : tier === 'gold' ? 'GOLD' : 'SILVER';
    badge.className = `h-badge badge-vip badge-vip-${tier}`;
    badge.title = `${label} · ${days} gün kaldı`;
  }
  if (star) {
    star.style.display = 'inline';
    star.title = label;
  }
  if (dashStatus) {
    dashStatus.innerHTML = `<strong style="color:var(--cs-yellow);">${label}</strong><br><span style="color:var(--text-dim);">${days} gün kaldı</span>`;
  }
  if (dashLink) dashLink.textContent = 'PAKETLER';
  if (dashBuy) {
    dashBuy.style.display = '';
    dashBuy.textContent = tier === 'platinum' ? 'YENİLE' : 'YÜKSELT';
  }
  if (payHint) payHint.style.display = 'none';
}

/** Open user dashboard VIP card; show purchase / payment-soon messaging. */
export function openVipPurchasePanel(tier) {
  const want = String(tier || sessionStorage.getItem('bcs_vip_intent') || 'gold').toLowerCase();
  const label = vipTierLabel(want);
  const dashModal = document.getElementById('dashboard-modal');
  const payHint = document.getElementById('dash-vip-pay-hint');
  const dashStatus = document.getElementById('dash-vip-status');
  const dashBuy = document.getElementById('btn-dash-vip-buy');
  const card = document.getElementById('dash-vip-card');

  if (dashModal) dashModal.style.display = 'flex';
  refreshDashboard().catch(() => {});

  if (payHint) {
    payHint.style.display = 'block';
    payHint.textContent =
      `${label} seçildi — Havale/EFT sipariş bilgisi hazırlanıyor. Açıklamaya sipariş numarasını yaz, ödeme onaylanınca paket 30 gün otomatik tanımlanır.`;
  }
  if (dashStatus && !currentVip) {
    dashStatus.textContent =
      `${label} paketi seçildi. Havale/EFT ile öde — onaylanınca otomatik tanımlanır.`;
  }
  if (dashBuy) {
    dashBuy.style.display = '';
    dashBuy.textContent = currentVip ? (String(currentVip.tier).toLowerCase() === 'platinum' ? 'YENİLE' : 'YÜKSELT') : 'SATIN AL';
  }
  if (card) {
    card.style.outline = '1px solid rgba(240,160,0,0.55)';
    setTimeout(() => { card.style.outline = ''; }, 2600);
  }

  try { sessionStorage.removeItem('bcs_vip_intent'); } catch (_) { /* ignore */ }
}

window.openVipPurchasePanel = openVipPurchasePanel;

/** Havale/EFT ile VIP siparişi oluşturur — onaylanınca 30 gün otomatik paket tanımlanır. */
async function createVipOrder(tier) {
  const t = String(tier || sessionStorage.getItem('bcs_vip_intent') || (currentVip && currentVip.tier) || 'gold').toLowerCase();
  if (!['silver', 'gold', 'platinum'].includes(t)) {
    window.customAlert('Geçerli bir paket seçin: Silver / Gold / Platinum', 'VIP SATIN AL');
    return;
  }
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      window.customAlert('Lütfen önce giriş yapın.', 'VIP SATIN AL');
      return;
    }
    const res = await fetch(`${API_BACKEND}/api/vip/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tier: t }),
    });
    const data = await res.json();
    if (!data?.success) throw new Error(data?.error || 'Sipariş oluşturulamadı');
    const payment = { ...data.payment, amountTry: data.order?.amount_try };
    showIbanPaymentModal(data.order, payment, data.instruction);
  } catch (e) {
    window.customAlert('Sipariş hatası: ' + e.message, 'VIP SATIN AL');
  }
}

window.createVipOrder = createVipOrder;

async function refreshVipStatus() {
  if (!currentUser) {
    applyVipUi(null);
    return null;
  }
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      applyVipUi(null);
      return null;
    }
    const res = await fetch(`${API_BACKEND}/api/me/vip`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data?.success && data.vip) {
      applyVipUi(data.vip);
      return data.vip;
    }
    applyVipUi(null);
    return null;
  } catch {
    applyVipUi(null);
    return null;
  }
}

/** Açılış kampanyası: yeni hesaba 30 gün Gold'u backend'den talep et. */
async function claimPromoGoldIfEligible(session) {
  try {
    if (sessionStorage.getItem('bcs_promo_gold_v2')) return;
    sessionStorage.setItem('bcs_promo_gold_v2', '1');
    const token = session?.access_token;
    if (!token) return;
    const res = await fetch(`${API_BACKEND}/api/me/vip/promo-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data?.success && data.claimed) {
      const msg = data.upgraded
        ? 'Kampanya güncellendi: VIP’in Silver’dan GOLD’a yükseltildi! VIP ODA, modeller ve altın silahlar aktif.'
        : 'Hoş geldin hediyesi tanımlandı: 30 GÜN GOLD VIP aktif! VIP ODA, klasik modeller, altın silahlar ve rezerve slot hemen kullanılabilir.';
      window.customAlert(msg, 'GOLD VIP HEDİYEN');
    }
  } catch (_) { /* kampanya çağrısı hiçbir akışı bloklamasın */ }
}

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
      // Admin _pw / rank bileti temizle — çıkış sonrası misafir kimlik taşımasın
      if (typeof window.clearAmxPasswordCache === 'function') {
        window.clearAmxPasswordCache();
      }
      if (typeof window.clearRankTicketCache === 'function') {
        window.clearRankTicketCache();
      }
      if (typeof window.clearVipTicketCache === 'function') {
        window.clearVipTicketCache();
      }
      authSection.style.display = 'flex';
      userSection.style.display = 'none';
      document.getElementById('badge-premium').style.display = 'none';
      applyVipUi(null);
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
    if (!session?.user) {
      currentUser = null;
      currentProfile = null;
      if (typeof window.clearAmxPasswordCache === 'function') {
        window.clearAmxPasswordCache();
      }
      if (typeof window.clearRankTicketCache === 'function') {
        window.clearRankTicketCache();
      }
      if (typeof window.clearVipTicketCache === 'function') {
        window.clearVipTicketCache();
      }
      applyVipUi(null);
    }
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

          if (await enforceBanOrSignOut(activeProfile)) {
            authSection.style.display = 'flex';
            userSection.style.display = 'none';
            return;
          }

          currentUser = session.user;
          currentProfile = activeProfile;
          try {
            window.__bcsUserId = session.user.id;
            localStorage.setItem('bcs_uid_hint', session.user.id);
          } catch (_) { /* ignore */ }
          
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

          // Açılış kampanyası: 15 Ağustos'a kadar kayıt olan herkese 30 gün
          // Gold otomatik tanımlanır. Backend idempotent — daha önce VIP
          // tanımlanmış hesaba tekrar vermez; oturum başına 1 kez denenir.
          await claimPromoGoldIfEligible(session);

          await refreshVipStatus();

          // VIP paket sayfasından gelen intent (login sonrası panel)
          try {
            const vipIntent = sessionStorage.getItem('bcs_vip_intent');
            if (vipIntent) {
              setTimeout(() => openVipPurchasePanel(vipIntent), 250);
            }
          } catch (_) { /* ignore */ }

          // Admin şifre bildirimi (mail yedeği)
          if (typeof window.checkAdminPasswordNotices === 'function') {
            setTimeout(() => window.checkAdminPasswordNotices(), 600);
          }

        } catch (err) {
          console.warn("Auth sync failed:", err);
          currentUser = null;
          currentProfile = null;
          authSection.style.display = 'flex';
          userSection.style.display = 'none';
          const badge = document.getElementById('badge-premium');
          if (badge) badge.style.display = 'none';
          applyVipUi(null);
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
      applyVipUi(null);
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
        const { data: signData, error } = await signIn(email, pass);
        if (error) {
          window.customAlert('Hata: ' + error.message);
          return;
        }
        const uid = signData?.user?.id;
        if (uid) {
          const { data: prof } = await getProfile(uid);
          if (await enforceBanOrSignOut(prof)) return;
        }
        loginModal.style.display = 'none';
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
        const nickErr = validatePublicNickname(user);
        if (nickErr) { window.customAlert(nickErr); return; }
        // Şifre güç kontrolü
        if (pass.length < 8) { window.customAlert('Şifre en az 8 karakter olmalıdır.'); return; }
        if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) {
          window.customAlert('Şifre en az bir büyük harf ve bir rakam içermelidir.'); return;
        }
        const { data: signUpData, error } = await signUp(email, pass, user);
        if (error) {
          window.customAlert('Hata: ' + error.message);
          return;
        }
        // Otomatik giriş — session yoksa şifreyle dene
        let session = signUpData?.session || null;
        if (!session) {
          const { data: signInData, error: signInErr } = await signIn(email, pass);
          if (signInErr) {
            window.customAlert('Kayıt oldu; giriş için e-posta onayını kontrol edin veya Giriş Yapın.');
            registerModal.style.display = 'none';
            loginModal.style.display = 'flex';
            return;
          }
          session = signInData?.session || null;
        }
        registerModal.style.display = 'none';
        if (session) {
          await claimPromoGoldIfEligible(session);
        }
        window.customAlert(
          'Kayıt tamam! Otomatik giriş yapıldı. Açılış kampanyası kapsamındaysan Gold VIP hediyen tanımlandı.',
          'HOŞ GELDİN'
        );
      } catch(err) {
        window.customAlert('Beklenmeyen bir hata oluştu: ' + err.message);
      } finally {
        btnSubmitRegister.textContent = originalText;
        btnSubmitRegister.disabled = false;
      }
    };
  }

  // Profil — kullanıcı adı güncelle
  const btnSaveUsername = document.getElementById('btn-dash-save-username');
  if (btnSaveUsername) {
    btnSaveUsername.onclick = async () => {
      const input = document.getElementById('dash-username-input');
      const msg = document.getElementById('dash-username-msg');
      const next = String(input?.value || '').trim();
      const setMsg = (text, ok) => {
        if (!msg) return;
        msg.textContent = text || '';
        msg.style.color = ok ? 'var(--cs-green)' : 'var(--cs-red)';
      };
      const nickErr = validatePublicNickname(next, { userId: currentUser?.id || null });
      if (nickErr) {
        setMsg(nickErr, false);
        return;
      }
      const token = await getSessionToken();
      if (!token) {
        setMsg('Oturum gerekli. Tekrar giriş yapın.', false);
        return;
      }
      const original = btnSaveUsername.textContent;
      btnSaveUsername.textContent = 'KAYDEDİLİYOR…';
      btnSaveUsername.disabled = true;
      try {
        const res = await fetch(`${API_BACKEND}/api/me/profile`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ username: next }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          setMsg(data?.error || 'Güncelleme başarısız.', false);
          return;
        }
        const saved = data.username || next;
        if (currentProfile) currentProfile.username = saved;
        if (userName) userName.textContent = saved;
        const nickInput = document.getElementById('user-nickname');
        if (nickInput) nickInput.value = saved;
        if (input) input.value = saved;
        setMsg(data.unchanged ? 'Değişiklik yok.' : 'Kullanıcı adı güncellendi.', true);
        window.customAlert('Profil güncellendi: ' + saved, 'BAŞARILI');
      } catch (err) {
        setMsg(err.message || 'Bağlantı hatası.', false);
      } finally {
        btnSaveUsername.textContent = original;
        btnSaveUsername.disabled = false;
      }
    };
  }

  // VIP satın al / yükselt — Havale/EFT siparişi oluşturur (bkz. createVipOrder)
  const btnDashVipBuy = document.getElementById('btn-dash-vip-buy');
  if (btnDashVipBuy) {
    btnDashVipBuy.onclick = async () => {
      if (!currentUser) {
        if (loginModal) loginModal.style.display = 'flex';
        return;
      }
      const intent =
        sessionStorage.getItem('bcs_vip_intent') ||
        (currentVip && currentVip.tier) ||
        'gold';
      openVipPurchasePanel(intent);
      const originalText = btnDashVipBuy.textContent;
      btnDashVipBuy.disabled = true;
      btnDashVipBuy.textContent = 'HAZIRLANIYOR...';
      try {
        await createVipOrder(intent);
      } finally {
        btnDashVipBuy.disabled = false;
        btnDashVipBuy.textContent = originalText;
      }
    };
  }

  // Buy server in dashboard — ENPARA havale siparişi
  const btnBuyServer = document.getElementById('btn-buy-server');
  if (btnBuyServer) {
    btnBuyServer.onclick = async () => {
      if (!currentUser) return window.customAlert('Lütfen önce giriş yapın.');
      
      btnBuyServer.disabled = true;
      const originalText = btnBuyServer.textContent;
      btnBuyServer.textContent = 'HAZIRLANIYOR...';
      
      try {
        // Sadece admin ücretsiz kurulum yapabilir — diğer herkes havale siparişi oluşturur
        if (currentProfile?.role === 'admin') {
          const sName = await window.customPrompt('Sunucu Adı Girin:', 'CS 1.5 Özel Sunucu', 'SUNUCU ADI');
          if (sName === null) {
            btnBuyServer.disabled = false;
            btnBuyServer.textContent = originalText;
            return;
          }
          const sMap = await window.customPrompt('Harita Seçin (de_dust2, de_inferno vb.):', 'de_dust2', 'HARİTA SEÇ');
          if (sMap === null) {
            btnBuyServer.disabled = false;
            btnBuyServer.textContent = originalText;
            return;
          }

          btnBuyServer.textContent = 'OLUŞTURULUYOR...';
          window.customAlert('Admin: AWS üzerinde sunucunuz başlatılıyor...', 'BAŞARILI');
          
          const session = await supabase.auth.getSession();
          const token = session.data?.session?.access_token;

          const res = await fetch(`${API_BACKEND}/api/start-server`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ map: sMap || 'de_dust2', maxplayers: 16, name: sName || 'CS 1.5 Özel Sunucu', host: currentProfile?.username || 'owner' })
          });
          
          const d = await res.json();
          if (d.success && d.port) {
            window.customAlert(`AWS Sunucunuz başarıyla oluşturuldu!\nPort: ${d.port}\nDashboard üzerinden bağlanabilirsiniz.`, 'BAŞARILI');
            if (window.refreshDashboard) window.refreshDashboard();
          } else {
            window.customAlert('İşlem başarısız: AWS Sunucusu başlatılamadı. ' + (d.error || ''));
          }
          btnBuyServer.disabled = false;
          btnBuyServer.textContent = originalText;
          return;
        }

        btnBuyServer.textContent = 'SİPARİŞ OLUŞTURULUYOR...';
        await promptAndCreateRentalOrder();
        if (window.refreshDashboard) window.refreshDashboard();
      } catch(err) {
        window.customAlert('Hata: ' + (err?.message || err));
      } finally {
        btnBuyServer.disabled = false;
        btnBuyServer.textContent = originalText;
      }
    };
  }

  const btnCopyIban = document.getElementById('btn-copy-iban');
  if (btnCopyIban) {
    btnCopyIban.onclick = async () => {
      const ibanEl = document.getElementById('iban-bank-iban');
      const text = ibanEl?.textContent?.trim() || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text.replace(/\s/g, ''));
        window.customAlert('IBAN panoya kopyalandı.', 'KOPYALANDI');
      } catch {
        window.customAlert('Kopyalama başarısız. IBAN: ' + text);
      }
    };
  }
}

async function refreshDashboard() {
  if (!currentUser) return;
  refreshVipStatus().catch(() => {});

  const dashUserInput = document.getElementById('dash-username-input');
  if (dashUserInput) {
    const uname =
      currentProfile?.username ||
      currentUser.user_metadata?.username ||
      currentUser.email?.split('@')[0] ||
      '';
    dashUserInput.value = uname;
  }

  const list = document.getElementById('my-servers-list');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-dim);">Sunucularınız yükleniyor...</div>';

  let liveByPort = new Map();
  try {
    const apiRes = await fetch(`${API_BACKEND}/api/servers`);
    const apiData = await apiRes.json();
    (apiData.servers || []).forEach(s => {
      if (s.port) liveByPort.set(s.port, s);
    });
  } catch (e) { /* sessiz */ }

  const { data: servers } = await getMyServers(currentUser.id);
  const { data: orders } = await getMyRentalOrders();
  const pendingOrders = (orders || []).filter(o =>
    ['pending_payment', 'paid', 'provisioning'].includes(o.status)
  );

  list.innerHTML = '';

  if (pendingOrders.length === 0 && (!servers || servers.length === 0)) {
    list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-dim);font-family:var(--font-ui);font-size:0.8rem;">Henüz satın aldığınız bir sunucu bulunmuyor.</div>';
    return;
  }

  pendingOrders.forEach(order => {
    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg-panel);border:1px solid var(--cs-yellow);padding:0.8rem;border-radius:4px;display:flex;justify-content:space-between;align-items:center;';
    const infoDiv = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-family:var(--font-hud);color:var(--text-bright);font-size:0.9rem;';
    nameEl.textContent = order.server_name || 'Sipariş';
    const detailEl = document.createElement('div');
    detailEl.style.cssText = 'font-family:var(--font-ui);color:var(--text-dim);font-size:0.75rem;margin-top:0.3rem;';
    detailEl.textContent = `Harita: ${order.map} | Slot: ${order.max_players} | Sipariş: ${order.order_code}`;
    const statusEl = document.createElement('div');
    statusEl.style.cssText = 'font-family:var(--font-hud);color:var(--cs-yellow);font-size:0.7rem;margin-top:0.4rem;';
    statusEl.textContent = order.status === 'provisioning'
      ? 'KURULUM YAPILIYOR...'
      : `ÖDEME BEKLENİYOR… ${order.order_code}`;
    infoDiv.appendChild(nameEl);
    infoDiv.appendChild(detailEl);
    infoDiv.appendChild(statusEl);
    const showBtn = document.createElement('button');
    showBtn.className = 'toolbar-btn';
    showBtn.style.cssText = 'padding:0.4rem;font-size:0.7rem;border-color:var(--cs-yellow);color:var(--cs-yellow);';
    showBtn.textContent = 'HAVALE BİLGİSİ';
    showBtn.addEventListener('click', async () => {
      try {
        const res = await fetch(`${API_BACKEND}/api/payment-info`);
        const d = await res.json();
        showIbanPaymentModal(order, d.success ? d : null, null);
      } catch {
        showIbanPaymentModal(order, null, null);
      }
    });
    div.appendChild(infoDiv);
    div.appendChild(showBtn);
    list.appendChild(div);
  });

  (servers || []).forEach(srv => {
    const live = srv.port ? liveByPort.get(srv.port) : null;
    const isRunning = live ? live.state === 'running' : (srv.status === 'active' || srv.status === 'running');
    const isPending = srv.status === 'pending' && !isRunning;
    const statusColor = isRunning ? 'var(--cs-green)' : (isPending ? 'var(--cs-yellow)' : 'var(--cs-red)');
    const statusText = isRunning ? 'AKTİF 7/24' : (isPending ? 'ÖDEME BEKLENİYOR...' : 'KAPALI / BEKLEMEDE');
    const div = document.createElement('div');
    div.style.cssText = 'background:var(--bg-panel);border:1px solid var(--border-bright);padding:0.8rem;border-radius:4px;display:flex;justify-content:space-between;align-items:center;';

    const infoDiv = document.createElement('div');
    
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-family:var(--font-hud);color:var(--text-bright);font-size:0.9rem;';
    nameEl.textContent = srv.name;  // XSS-safe: textContent
    
    const detailEl = document.createElement('div');
    detailEl.style.cssText = 'font-family:var(--font-ui);color:var(--text-dim);font-size:0.75rem;margin-top:0.3rem;';
    detailEl.textContent = `Harita: ${srv.map} | Slot: ${srv.max_players}${srv.port ? ' | Port: ' + srv.port : ''}`;
    
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
    manageBtn.disabled = false;
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
    joinBtn.textContent = isRunning ? 'BAĞLA (ADMİN)' : 'BAŞLAT';
    joinBtn.addEventListener('click', async () => {
      if (isRunning) {
        joinMyServer(srv.id, srv.map, srv.max_players, srv.port || 0);
        return;
      }
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return window.customAlert('Oturum gerekli.');
        joinBtn.disabled = true;
        joinBtn.textContent = 'BAŞLATILIYOR...';
        const res = await fetch(`${API_BACKEND}/api/start-server`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ map: srv.map || 'de_dust2', name: srv.name, maxplayers: srv.max_players || 16 })
        });
        const d = await res.json();
        joinBtn.disabled = false;
        joinBtn.textContent = 'BAŞLAT';
        if (d.success) {
          window.customAlert(`Sunucu başlatıldı! Port: ${d.port}`, 'BAŞARILI');
          refreshDashboard();
          if (window.loadServerList) window.loadServerList();
        } else {
          window.customAlert('Başlatma hatası: ' + (d.error || ''));
        }
      } catch (e) {
        joinBtn.disabled = false;
        joinBtn.textContent = 'BAŞLAT';
        window.customAlert('Bağlantı hatası!');
      }
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
  sessionStorage.setItem('cs_owner_room_token', 'premium_owner_' + roomId);
  
  if (port && port > 0) {
     window.customAlert('Dedicated AWS Sunucusuna bağlanılıyor...');
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
    const closeManagedBtn = document.getElementById('close-manage-btn');
    if (closeManagedBtn) closeManagedBtn.onclick = () => manageModal.style.display = 'none';
    
    const API_BACKEND_LOCAL = import.meta.env.VITE_API_URL || 'https://backend.browsercs.com';

    const btnSaveRcon = document.getElementById('btn-save-rcon');
    if (btnSaveRcon) btnSaveRcon.onclick = async () => {
      const id   = document.getElementById('manage-server-id').value;
      const pass = document.getElementById('rcon-password-input').value;
      if (!pass) return window.customAlert('Lütfen bir şifre girin.');
      btnSaveRcon.textContent = 'Kaydediliyor...';
      try {
        const res  = await fetch(`${API_BACKEND_LOCAL}/api/servers/${id}/rcon`, {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ rconPassword: pass })
        });
        const data = await res.json();
        if (data.success) window.customAlert('RCON Şifresi başarıyla ayarlandı!');
        else window.customAlert('Hata: ' + data.error);
      } catch(e) { window.customAlert('Bağlantı hatası!'); }
      btnSaveRcon.textContent = 'Kaydet';
    };

    const btnRestartServer = document.getElementById('btn-restart-server');
    if (btnRestartServer) btnRestartServer.onclick = async () => {
      const id = document.getElementById('manage-server-id').value;
      const confirmed = await window.customConfirm('Sunucuyu yeniden başlatmak istediğinize emin misiniz? İçerideki oyuncular düşer.');
      if (!confirmed) return;
      btnRestartServer.textContent = 'Yeniden Başlatılıyor...';
      try {
        const res  = await fetch(`${API_BACKEND_LOCAL}/api/servers/${id}/restart`, { method: 'POST' });
        const data = await res.json();
        if (data.success) window.customAlert('Sunucu yeniden başlatıldı!');
        else window.customAlert('Hata: ' + data.error);
      } catch(e) { window.customAlert('Bağlantı hatası!'); }
      btnRestartServer.textContent = 'Sunucuyu Yeniden Başlat';
    };
  }
});

export function getCurrentUsername() {
  return currentProfile ? currentProfile.username : null;
}

export function getCurrentUser() {
  return currentUser;
}

export function getCurrentProfile() {
  return currentProfile;
}

/** Banned account check for join / UI (Turkish message). */
export function getBanBlockMessage() {
  if (!isProfileBanned(currentProfile)) return null;
  return banMessageTr(currentProfile);
}

export function isUserPremium() {
  // VIP/admin kontrolü Supabase profilü üzerinden yapılır (hardcoded email yok)
  // Not: is_premium = sunucu kiralama; subscription VIP ayrı (getVipStatus)
  if (currentProfile?.role === 'admin' || currentProfile?.role === 'vip') return true;
  return currentProfile ? currentProfile.is_premium : false;
}

export function isUserAdmin() {
  return currentProfile?.role === 'admin';
}

/** Active Silver/Gold/Platinum subscription (not rental premium). */
export function getVipStatus() {
  return currentVip;
}

export function isUserVipSubscriber() {
  return !!(currentVip && currentVip.active);
}

export async function getSessionToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

window.refreshDashboard = refreshDashboard;
