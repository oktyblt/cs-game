/**
 * Ana sayfa VIP hediye popup — kayıt formu + otomatik giriş + Gold + /oyna
 */
import { signUp, signIn } from './supabase.js';
import { validatePublicNickname } from './nick.js';
import { API_URL } from './api.js';

const DEADLINE = Date.parse('2026-08-15T23:59:59+03:00');
const SEEN_KEY = 'bcsPromoAug15GoldSeenAt';
const DAY = 24 * 60 * 60 * 1000;

async function claimPromo(session) {
  const token = session?.access_token;
  if (!token) return false;
  try {
    const res = await fetch(`${API_URL}/api/me/vip/promo-claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return !!(data?.success && data.claimed);
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch (_) { /* ignore */ }
}

function initPromoSignup() {
  const overlay = document.getElementById('bcs-promo-overlay');
  if (!overlay) return;

  const formPanel = document.getElementById('bcs-promo-form-panel');
  const infoPanel = document.getElementById('bcs-promo-info-panel');
  const openFormBtn = document.getElementById('bcs-promo-open-form');
  const backBtn = document.getElementById('bcs-promo-form-back');
  const submitBtn = document.getElementById('bcs-promo-submit');
  const errEl = document.getElementById('bcs-promo-form-error');

  window.bcsClosePromo = function () {
    overlay.hidden = true;
    markSeen();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) window.bcsClosePromo();
  });

  const showForm = () => {
    if (infoPanel) infoPanel.hidden = true;
    if (formPanel) formPanel.hidden = false;
    document.getElementById('bcs-promo-username')?.focus();
  };
  const showInfo = () => {
    if (formPanel) formPanel.hidden = true;
    if (infoPanel) infoPanel.hidden = false;
  };

  /** Hero / menü "Kayıt Ol" — formu doğrudan aç */
  window.bcsOpenRegister = function () {
    overlay.hidden = false;
    showForm();
  };

  const openRegisterBtns = document.querySelectorAll('#bcs-hero-register, #bcs-home-vip-register');
  openRegisterBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.bcsOpenRegister();
    });
  });

  if (openFormBtn) openFormBtn.addEventListener('click', (e) => {
    e.preventDefault();
    showForm();
  });
  if (backBtn) backBtn.addEventListener('click', (e) => {
    e.preventDefault();
    showInfo();
  });

  if (submitBtn) {
    submitBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const user = document.getElementById('bcs-promo-username')?.value?.trim() || '';
      const email = document.getElementById('bcs-promo-email')?.value?.trim() || '';
      const pass = document.getElementById('bcs-promo-pass')?.value || '';
      if (errEl) errEl.textContent = '';

      if (!user || !email || !pass) {
        if (errEl) errEl.textContent = 'Tüm alanlar zorunludur.';
        return;
      }
      const nickErr = validatePublicNickname(user);
      if (nickErr) {
        if (errEl) errEl.textContent = nickErr;
        return;
      }
      if (pass.length < 8) {
        if (errEl) errEl.textContent = 'Şifre en az 8 karakter olmalı.';
        return;
      }
      if (!/[A-Z]/.test(pass) || !/[0-9]/.test(pass)) {
        if (errEl) errEl.textContent = 'Şifrede en az bir büyük harf ve bir rakam olmalı.';
        return;
      }

      const original = submitBtn.textContent;
      submitBtn.textContent = 'Kayıt yapılıyor…';
      submitBtn.disabled = true;
      try {
        const { data: upData, error: upErr } = await signUp(email, pass, user);
        if (upErr) throw new Error(upErr.message);

        let session = upData?.session || null;
        if (!session) {
          const { data: inData, error: inErr } = await signIn(email, pass);
          if (inErr) {
            throw new Error(
              'Kayıt oldu. Giriş için e-posta onayını kontrol edin, sonra /oyna üzerinden giriş yapın.'
            );
          }
          session = inData?.session || null;
        }

        await claimPromo(session);
        markSeen();
        window.location.href = '/oyna/';
      } catch (err) {
        if (errEl) errEl.textContent = err.message || 'Kayıt başarısız.';
        submitBtn.textContent = original;
        submitBtn.disabled = false;
      }
    });
  }

  if (Date.now() > DEADLINE) return;
  try {
    const seen = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
    if (seen && Date.now() - seen < DAY) return;
  } catch (_) { /* show */ }

  setTimeout(() => {
    overlay.hidden = false;
  }, 1100);
}

initPromoSignup();
