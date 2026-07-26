/**
 * Transactional email via Resend (HTTPS, no SDK).
 * Env: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO (optional)
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM =
  process.env.MAIL_FROM || 'BrowserCS <noreply@browsercs.com>';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || 'support@browsercs.com';

function isMailConfigured() {
  return Boolean(RESEND_API_KEY);
}

async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!RESEND_API_KEY) {
    return { ok: false, skipped: true, error: 'RESEND_API_KEY tanımlı değil' };
  }
  if (!to) {
    return { ok: false, error: 'Alıcı e-posta yok' };
  }

  const payload = {
    from: MAIL_FROM,
    to: [to],
    subject,
    html,
    text: text || html.replace(/<[^>]+>/g, ' ')
  };
  const reply = replyTo || MAIL_REPLY_TO;
  if (reply) payload.reply_to = reply;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'browsercs-server-manager/1.0'
    },
    body: JSON.stringify(payload)
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: body?.message || body?.error || `HTTP ${res.status}`
    };
  }
  return { ok: true, id: body.id };
}

function buildAdminPasswordEmail({ username, gameName, password, serverName, port }) {
  const subject = `BrowserCS admin şifren — ${serverName || 'sunucu'}`;
  const text = [
    `Merhaba ${username || gameName},`,
    '',
    `Bir sunucuya admin olarak eklendin.`,
    serverName ? `Sunucu: ${serverName}` : null,
    port ? `Port: ${port}` : null,
    `Oyun adı (users.ini): ${gameName}`,
    `Admin şifren (_pw): ${password}`,
    '',
    'Siteye giriş yapınca şifre otomatik yüklenir.',
    'Nick değiştirirsen veya otomatik yüklenmezse konsolda:',
    `  setinfo _pw ${password}`,
    '  retry',
    '',
    '— BrowserCS'
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;line-height:1.5;color:#111">
      <h2 style="margin:0 0 12px">BrowserCS admin şifren</h2>
      <p>Merhaba <strong>${escapeHtml(username || gameName)}</strong>,</p>
      <p>Bir sunucuya <strong>admin</strong> olarak eklendin.</p>
      <table style="border-collapse:collapse;margin:16px 0;width:100%">
        ${serverName ? row('Sunucu', serverName) : ''}
        ${port ? row('Port', String(port)) : ''}
        ${row('Oyun adı', gameName)}
        ${row('Admin şifre (_pw)', `<code style="font-size:16px">${escapeHtml(password)}</code>`)}
      </table>
      <p style="margin:16px 0 8px"><strong>Nasıl kullanılır?</strong></p>
      <ol style="padding-left:18px;margin:0">
        <li>Siteye üye girişi yap — şifre çoğu zaman otomatik gelir.</li>
        <li>Nick değiştirdiysen veya admin olmazsa oyun konsolunda:</li>
      </ol>
      <pre style="background:#0f172a;color:#e2e8f0;padding:12px 14px;border-radius:8px;margin:12px 0;font-size:13px">setinfo _pw ${escapeHtml(password)}
retry</pre>
      <p style="color:#64748b;font-size:13px;margin-top:20px">— BrowserCS</p>
    </div>
  `;

  return { subject, html, text };
}

function row(label, value) {
  return `<tr>
    <td style="padding:6px 10px 6px 0;color:#64748b;vertical-align:top">${escapeHtml(label)}</td>
    <td style="padding:6px 0;font-weight:600">${value}</td>
  </tr>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  isMailConfigured,
  sendEmail,
  buildAdminPasswordEmail
};
