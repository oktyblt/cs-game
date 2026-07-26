import { API_URL } from '../api.js';

const MONTH_NAMES = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

function monthLabel(month) {
  if (!month || month.length < 7) return month || '';
  const [y, m] = month.split('-');
  const mi = parseInt(m, 10) - 1;
  return `${MONTH_NAMES[mi] || m} ${y}`;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Rank list VIP chip — label always "VIP", color encodes tier. */
function vipBadgeHtml(vip) {
  const tier = String(vip || '').toLowerCase();
  if (tier !== 'silver' && tier !== 'gold' && tier !== 'platinum') return '';
  return `<span class="rank-vip rank-vip-${tier}" title="VIP">VIP</span>`;
}

export async function fetchServers() {
  const res = await fetch(`${API_URL}/api/servers`);
  const data = await res.json();
  return (data.servers || data || []).filter((s) => s.port);
}

export async function fetchRanking(port, month) {
  const q = month ? `?month=${encodeURIComponent(month)}` : '';
  const res = await fetch(`${API_URL}/api/rankings/${port}${q}`);
  if (!res.ok) throw new Error('Rank alınamadı');
  return res.json();
}

export async function fetchRankMonths(port) {
  const res = await fetch(`${API_URL}/api/rankings/${port}/months`);
  if (!res.ok) throw new Error('Geçmiş aylar alınamadı');
  return res.json();
}

export function renderRankTable(container, payload, { emptyText } = {}) {
  if (!container) return;
  const top = payload?.top || [];
  const month = payload?.month || '';
  const isCurrent = payload?.is_current === true;
  if (!top.length) {
    container.innerHTML = `<div class="rank-empty">${escapeHtml(
      emptyText ||
        (isCurrent
          ? 'Bu ay henüz kill kaydı yok. Oynamaya başlayın!'
          : 'Bu ay için kayıtlı sıralama bulunamadı.')
    )}</div>`;
    return;
  }
  const rows = top
    .map(
      (p, i) => `
    <tr class="${i < 3 ? 'rank-top' : ''}">
      <td class="rank-pos">#${i + 1}</td>
      <td class="rank-name">${escapeHtml(p.name)}${vipBadgeHtml(p.vip)}</td>
      <td class="rank-kills">${p.kills}</td>
      <td class="rank-deaths">${p.deaths}</td>
      <td class="rank-kd">${p.kd}</td>
    </tr>`
    )
    .join('');
  const badge = isCurrent ? 'Canlı ay' : 'Geçmiş sezon';
  container.innerHTML = `
    <div class="rank-meta">${escapeHtml(badge)} · ${escapeHtml(monthLabel(month))} · Top ${top.length}</div>
    <table class="rank-table">
      <thead>
        <tr><th>#</th><th>Oyuncu</th><th>Kill</th><th>Ölüm</th><th>K/D</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Wire Rank Takip: server + year + month history.
 * @param {{ selectEl, yearEl, monthEl, tableEl, statusEl?, pollMs? }} opts
 */
export function mountRankTakipPanel({
  selectEl,
  yearEl,
  monthEl,
  tableEl,
  statusEl,
  pollMs = 12000,
}) {
  let timer = null;
  let currentPort = null;
  let currentMonth = null;
  let history = { current: null, years: {}, months: [] };

  function selectedIsLive() {
    return currentMonth && history.current && currentMonth === history.current;
  }

  function fillYearMonthSelects() {
    if (!yearEl || !monthEl) return;
    const years = Object.keys(history.years || {}).sort((a, b) => b.localeCompare(a));
    if (!years.length && history.current) {
      years.push(history.current.slice(0, 4));
      history.years[history.current.slice(0, 4)] = [history.current];
    }
    const preferredYear = (currentMonth || history.current || '').slice(0, 4);
    yearEl.innerHTML = years
      .map(
        (y) =>
          `<option value="${escapeHtml(y)}"${y === preferredYear ? ' selected' : ''}>${escapeHtml(y)}</option>`
      )
      .join('');

    const year = yearEl.value || preferredYear;
    const months = (history.years[year] || []).slice().sort((a, b) => b.localeCompare(a));
    const preferredMonth =
      currentMonth && currentMonth.startsWith(year)
        ? currentMonth
        : months[0] || history.current;
    monthEl.innerHTML = months
      .map((m) => {
        const label =
          monthLabel(m) + (m === history.current ? ' (bu ay)' : '');
        return `<option value="${escapeHtml(m)}"${m === preferredMonth ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('');
    currentMonth = monthEl.value || preferredMonth || history.current;
  }

  async function loadHistoryForPort(port) {
    if (!port) return;
    try {
      history = await fetchRankMonths(port);
      if (!currentMonth || !history.months.includes(currentMonth)) {
        currentMonth = history.current;
      }
      fillYearMonthSelects();
    } catch {
      history = {
        current: null,
        years: {},
        months: [],
      };
      if (yearEl) yearEl.innerHTML = '<option value="">—</option>';
      if (monthEl) monthEl.innerHTML = '<option value="">—</option>';
    }
  }

  async function refresh() {
    if (!currentPort) return;
    try {
      if (statusEl) statusEl.textContent = 'Güncelleniyor…';
      const data = await fetchRanking(currentPort, currentMonth || undefined);
      renderRankTable(tableEl, data);
      if (statusEl) {
        if (selectedIsLive()) {
          const t = data.updated_at
            ? new Date(data.updated_at).toLocaleTimeString('tr-TR')
            : '—';
          statusEl.textContent = `Canlı · son güncelleme ${t}`;
        } else {
          statusEl.textContent = `Arşiv · ${monthLabel(currentMonth)}`;
        }
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Bağlantı hatası';
    }
  }

  async function loadServerOptions() {
    const servers = await fetchServers();
    const official = servers.filter((s) => s.isOfficial);
    const rentals = servers.filter((s) => !s.isOfficial);
    const opts = [];
    for (const s of [...official, ...rentals]) {
      const label = String(s.name || 'Sunucu')
        .replace(/\s*[\(\[]?\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?[\)\]]?/g, '')
        .replace(/\s*[:·]\s*\d{4,5}\b/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || 'Sunucu';
      opts.push(`<option value="${s.port}">${escapeHtml(label)}</option>`);
    }
    selectEl.innerHTML = opts.length
      ? opts.join('')
      : '<option value="">Sunucu yok</option>';
    currentPort = selectEl.value ? parseInt(selectEl.value, 10) : null;
    await loadHistoryForPort(currentPort);
    await refresh();
  }

  selectEl.addEventListener('change', async () => {
    currentPort = parseInt(selectEl.value, 10) || null;
    currentMonth = null;
    await loadHistoryForPort(currentPort);
    await refresh();
  });

  if (yearEl) {
    yearEl.addEventListener('change', () => {
      fillYearMonthSelects();
      refresh();
    });
  }

  if (monthEl) {
    monthEl.addEventListener('change', () => {
      currentMonth = monthEl.value || history.current;
      refresh();
    });
  }

  loadServerOptions().catch(() => {
    if (statusEl) statusEl.textContent = 'Sunucu listesi alınamadı';
  });

  timer = setInterval(() => {
    // Only auto-refresh the live month
    if (selectedIsLive()) refresh();
  }, pollMs);

  return () => {
    if (timer) clearInterval(timer);
  };
}
