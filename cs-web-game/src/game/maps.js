/** @module game/maps */
import { ASSET_URL } from '../api.js';
import { $ } from '../dom.js';
import { state } from './state.js';

const mapList = $('map-list');
const mapSearch = $('map-search');
const previewPanel = $('preview-panel');
const noMapState = $('no-map-state');
const mapCard = $('map-card');
const cardMapName = $('card-map-name');
const cardMapType = $('card-map-type');
const cardMapDesc = $('card-map-desc');
const btnLaunch = $('btn-launch');
const mapCountInfo = $('map-count-info');

export function getMapType(name) {
  if (name.startsWith('de_')) return { prefix: 'de', label: 'BOMB DEFUSAL' };
  if (name.startsWith('cs_')) return { prefix: 'cs', label: 'HOSTAGE RESCUE' };
  if (name.startsWith('as_')) return { prefix: 'as', label: 'ASSASSINATION' };
  if (name.startsWith('es_')) return { prefix: 'es', label: 'ESCAPE' };
  return { prefix: '?', label: 'UNKNOWN' };
}

export function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// ─── Harita Listesi ───────────────────────────────────────────────────────────

export async function loadMapList() {
  try {
    const res = await fetch(`${ASSET_URL}/api/maps`);
    const data = await res.json();
    state.maps = (data && data.maps && data.maps.length > 0) ? data.maps : [
      { name: 'de_dust2', size: 2686884, description: 'Bomb Defusal' },
      { name: 'de_dust', size: 1986440, description: 'Bomb Defusal' },
      { name: 'cs_assault', size: 2100000, description: 'Hostage Rescue' },
      { name: 'de_inferno', size: 2450000, description: 'Bomb Defusal' },
      { name: 'cs_office', size: 2300000, description: 'Hostage Rescue' },
      { name: 'de_aztec', size: 2800000, description: 'Bomb Defusal' }
    ];

    renderMapList();
    return true;
  } catch (err) {
    console.warn('Map list fetch warning, using defaults:', err);
    state.maps = [
      { name: 'de_dust2', size: 2686884, description: 'Bomb Defusal' },
      { name: 'de_dust', size: 1986440, description: 'Bomb Defusal' },
      { name: 'cs_assault', size: 2100000, description: 'Hostage Rescue' },
      { name: 'de_inferno', size: 2450000, description: 'Bomb Defusal' },
      { name: 'cs_office', size: 2300000, description: 'Hostage Rescue' },
      { name: 'de_aztec', size: 2800000, description: 'Bomb Defusal' }
    ];

    renderMapList();
    return true;
  }
}

export function renderMapList() {
  // RCON harita select'ini de doldur
  const rconMapSel = $('rcon-map-select');
  if (rconMapSel) {
    const cur = rconMapSel.value;
    rconMapSel.innerHTML = state.maps.map(m => `<option value="${m.name}">${m.name}</option>`).join('');
    if (cur && state.maps.find(m => m.name === cur)) rconMapSel.value = cur;
  }

  if (!mapList || !mapSearch) return;
  const query = (mapSearch.value || '').toLowerCase();
  const filter = state.activeFilter;

  const filtered = state.maps.filter(m => {
    const matchSearch = m.name.toLowerCase().includes(query);
    const matchFilter = filter === 'all' || m.name.startsWith(filter + '_');
    return matchSearch && matchFilter;
  });

  if (filtered.length === 0) {
    mapList.innerHTML = `<div style="padding:1rem;font-family:var(--font-hud);font-size:0.7rem;color:var(--text-dim);">Sonuç bulunamadı</div>`;
    return;
  }

  mapList.innerHTML = filtered.map(m => {
    const type = getMapType(m.name);
    const isSelected = m.name === state.currentMap;
    return `
      <div class="map-item ${isSelected ? 'selected' : ''}" data-map="${m.name}">
        <span class="map-badge ${type.prefix}">${type.prefix.toUpperCase()}</span>
        <span class="map-name">${m.name}</span>
        <span class="map-size">${formatSize(m.size)}</span>
      </div>`;
  }).join('');

  mapList.querySelectorAll('.map-item').forEach(el => {
    el.addEventListener('click', () => selectMap(el.dataset.map));
  });
}

export function selectMap(name) {
  state.currentMap = name;
  renderMapList();

  const map = state.maps.find(m => m.name === name);
  const type = getMapType(name);
  const maxPl = parseInt(document.getElementById('max-players-select')?.value || '16');
  const half = Math.floor(maxPl / 2);

  noMapState.style.display = 'none';
  mapCard.style.display = 'block';
  cardMapName.textContent = name;
  if (cardMapType) cardMapType.textContent = `${type.label} — COUNTER-STRIKE 1.5`;
  if (cardMapDesc) cardMapDesc.textContent = map?.description || 'CS 1.5 klasik haritası.';
  btnLaunch.disabled = false;

  // Team capacities
  const ctCap = document.getElementById('ct-team-capacity');
  const tCap = document.getElementById('t-team-capacity');
  const vsBadge = document.getElementById('vs-badge-text');
  if (ctCap) ctCap.textContent = `${half} Oyuncu`;
  if (tCap) tCap.textContent = `${half} Oyuncu`;
  if (vsBadge) vsBadge.textContent = `${half}v${half}`;

  // Thumbnail background
  const thumb = document.getElementById('map-thumb-hero');
  if (thumb) {
    const thumbUrl = `https://browsercs.com/cs-assets/thumbnails/${name}.jpg`;
    thumb.style.backgroundImage = 'none';
    fetch(thumbUrl, { mode: 'cors', cache: 'force-cache' }).then(r => r.blob()).then(blob => {
      thumb.style.backgroundImage = `url('${URL.createObjectURL(blob)}')`;
    }).catch(() => { });
    thumb.style.backgroundSize = 'cover';
    thumb.style.backgroundPosition = 'center';
  }

  // Type badge
  const typeBadge = document.getElementById('map-type-badge');
  if (typeBadge) {
    typeBadge.textContent = type.label;
    typeBadge.className = 'map-thumb-badge';
    if (name.startsWith('de_')) typeBadge.classList.add('bomb');
    else if (name.startsWith('cs_')) typeBadge.classList.add('hostage');
    else typeBadge.classList.add('escape');
  }
}


