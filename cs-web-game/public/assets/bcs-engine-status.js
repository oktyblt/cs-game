/**
 * BrowserCS — header motor durumu metni
 * Lobide sürekli "Engine hazırlanıyor..." kalmasın; idle / yükleme / hazır ayrımı.
 */
(function () {
  'use strict';

  var IDLE = 'Hazır — sunucu seç';
  var LOADING = 'Oyun yükleniyor...';
  var READY_MARKERS = [/çalışıyor/i, /WebGL/i, /bağlandı/i, /hazır(?!lan)/i];
  var LOADING_MARKERS = [/hazırlanıyor/i, /indiriliyor/i, /Engine hazır/i, /yükleniyor/i];

  function els() {
    return {
      text: document.getElementById('engine-status-text'),
      dot: document.getElementById('engine-dot')
    };
  }

  function setStatus(msg, color) {
    var e = els();
    if (!e.text) return;
    e.text.textContent = msg;
    if (e.dot) e.dot.className = 'status-dot ' + (color || 'orange');
  }

  function normalizeNode() {
    var e = els();
    if (!e.text) return;
    var raw = (e.text.textContent || '').trim();
    var html = e.text.innerHTML || '';

    // Bundle join sırasında uzun HTML uyarı basıyor — sadeleştir
    if (/Engine hazırlanıyor/i.test(raw) || /Engine hazırlanıyor/i.test(html)) {
      setStatus(LOADING, 'orange');
      return;
    }

    // Lobide varsayılan İngilizce/yanlış idle
    if (!raw || /^Engine hazırlanıyor/i.test(raw) || raw === 'Engine hazırlanıyor...') {
      var running = !!(window.state && window.state.engineRunning) || !!window.engineRunning;
      setStatus(running ? 'Motor çalışıyor' : IDLE, running ? 'green' : 'orange');
      if (e.dot && !running) e.dot.className = 'status-dot orange';
    }
  }

  function boot() {
    normalizeNode();
    var e = els();
    if (!e.text || typeof MutationObserver === 'undefined') return;
    var obs = new MutationObserver(function () {
      normalizeNode();
    });
    obs.observe(e.text, { childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Dışarıdan da kullanılabilsin
  window.__bcsSetEngineStatus = setStatus;
})();
