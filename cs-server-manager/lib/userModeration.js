/**
 * Account ban / deactivate helpers for Master Admin.
 */

function isBanActive(profile, now = new Date()) {
  if (!profile || !profile.is_banned) return false;
  if (!profile.banned_until) return true; // permanent while flagged
  const until = new Date(profile.banned_until);
  if (!Number.isFinite(until.getTime())) return true;
  return until.getTime() > now.getTime();
}

function banRejectMessage(profile) {
  const reason = String(profile?.ban_reason || '').trim();
  if (reason) {
    return `Hesabınız yasaklandı: ${reason}`;
  }
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

/** Shared profile columns for admin user list / edit */
const ADMIN_USER_COLS =
  'id, username, role, is_premium, wallet_balance, created_at, ' +
  'vip_tier, vip_expires_at, vip_clan_tag, vip_granted_at, vip_granted_by, vip_notes, ' +
  'is_banned, banned_until, ban_reason, admin_notes';

const ADMIN_USER_COLS_NO_BAN =
  'id, username, role, is_premium, wallet_balance, created_at, ' +
  'vip_tier, vip_expires_at, vip_clan_tag, vip_granted_at, vip_granted_by, vip_notes';

function isMissingColumnError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('column') && msg.includes('is_banned');
}

module.exports = {
  isBanActive,
  banRejectMessage,
  ADMIN_USER_COLS,
  ADMIN_USER_COLS_NO_BAN,
  isMissingColumnError,
};
