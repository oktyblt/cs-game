/**
 * /oyna — aylık Top 10 VIP hediye popup. Kişi başı bir kez (localStorage).
 */
const STORAGE_KEY = 'bcsRankTop10GiftSeen';

function visitorKey() {
  try {
    const uid = window.__bcsUserId || localStorage.getItem('bcs_uid_hint') || '';
    if (uid) return `${STORAGE_KEY}:${uid}`;
  } catch (_) { /* ignore */ }
  return STORAGE_KEY;
}

export function initRankGiftPopup() {
  const overlay = document.getElementById('bcs-rank-gift-overlay');
  if (!overlay) return;

  const close = () => {
    overlay.hidden = true;
    try {
      localStorage.setItem(visitorKey(), '1');
    } catch (_) { /* ignore */ }
  };

  const closeBtn = document.getElementById('bcs-rank-gift-close');
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  const cta = document.getElementById('bcs-rank-gift-cta');
  if (cta) cta.addEventListener('click', close);

  try {
    if (localStorage.getItem(visitorKey()) === '1') return;
    // Eski genel anahtar da say
    if (localStorage.getItem(STORAGE_KEY) === '1') return;
  } catch (_) { /* show anyway */ }

  setTimeout(() => {
    overlay.hidden = false;
  }, 1400);
}
