/** @module net/reconnect */
import { getStoredAmxPassword } from './amxPassword.js';
import { getStoredRankTicket, prefetchRankTicketForPort } from './rankTicket.js';
import { ensureVipTicketForPort, getStoredVipTicket } from './vipTicket.js';
import { state } from '../game/state.js';

export const BrowserCSReconnect = (() => {
  const MAX_ATTEMPTS = 5;
  const MANUAL_RETRY_COOLDOWN_MS = 1200;
  // ensureDcReady içinde kısa WebRTC denemeleri var; burada oyun oturumunu bekle
  /* FastDL / custom resource sync on rented servers can exceed 35s after restarts. */
  const CONNECT_WAIT_MS = 90000;
  const CONNECT_WAIT_TRAFFIC_MS = 120000;
  const WEBRTC_RETRY_TIMEOUT_MS = 45000;
  const RETRY_DELAYS = [
    400,
    800,
    1200,
    2000,
    3000
  ];

  let reconnecting = false;
  let exhausted = false;
  let attempt = 0;
  let retryTimer = null;
  let reconnectGen = 0;
  let reconnectInFlight = false;
  let sessionJoined = false;
  let lastReason = "";
  let lastManualRetryAt = 0;
  let connectMode = "reconnecting"; // connecting | reconnecting

  const overlay =
    document.getElementById("reconnect-overlay");

  const titleEl =
    document.getElementById("reconnect-title");

  const messageEl =
    document.getElementById("reconnect-message");

  const attemptEl =
    document.getElementById("reconnect-attempt");

  const retryNowButton =
    document.getElementById("btn-reconnect-now");

  const reloadButton =
    document.getElementById("btn-reload-game");

  function setText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function setActionButtonsVisible(visible) {
    const display = visible ? "" : "none";
    if (retryNowButton) retryNowButton.style.display = display;
    if (reloadButton) reloadButton.style.display = display;
  }

  function showOverlay(reason, mode = "reconnecting") {
    connectMode = mode;
    lastReason =
      reason || "Sunucu bağlantısı kesildi.";

    document.body.classList.add(
      "browsercs-reconnecting"
    );

    if (overlay) {
      overlay.classList.add("show");
      overlay.classList.toggle("is-connecting", mode === "connecting");
      overlay.classList.toggle("is-exhausted", false);
    }

    setText(
      titleEl,
      mode === "connecting"
        ? "SUNUCUYA BAĞLANILIYOR"
        : "BAĞLANTI KESİLDİ"
    );

    setText(
      messageEl,
      mode === "connecting"
        ? `${lastReason} Lütfen bekleyin...`
        : `${lastReason} Yeniden bağlanılıyor...`
    );

    // İlk girişte "Yeniden dene" butonları korkutuyor — sadece tükenince göster
    setActionButtonsVisible(mode !== "connecting");

    const escMenu =
      document.getElementById("esc-pause-menu");

    if (escMenu) {
      escMenu.classList.remove("show");
    }

    const kickOverlay =
      document.getElementById("kick-overlay");

    if (kickOverlay) {
      kickOverlay.classList.remove("show");
    }

    try {
      document.exitPointerLock();
    } catch {
      // Pointer lock açık değilse hata önemli değil.
    }
  }

  function hideOverlay() {
    document.body.classList.remove(
      "browsercs-reconnecting"
    );

    if (overlay) {
      overlay.classList.remove("show");
    }
  }

  function clearRetryTimer() {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function sanitizeEngineArgument(value) {
    return String(value || "")
      .replace(/["\\;\r\n]/g, "");
  }

  function restorePassword() {
    const port =
      window._browserCSConnectPort || "";

    const storedPassword =
      sessionStorage.getItem(
        `_csLastPw_${port}`
      );

    if (
      storedPassword &&
      typeof window.executeEngineCommand === "function"
    ) {
      const safePassword =
        sanitizeEngineArgument(
          storedPassword
        );

      window.executeEngineCommand(
        `password "${safePassword}"`
      );
    }
  }

  function restoreAmxPassword() {
    const port = window._browserCSConnectPort || "";
    const amxPw = getStoredAmxPassword(port);
    if (!amxPw || typeof window.executeEngineCommand !== "function") {
      return;
    }
    const safe = sanitizeEngineArgument(amxPw);
    window.executeEngineCommand(`setinfo _pw "${safe}"`);
  }

  function restoreRankTicket() {
    const port = window._browserCSConnectPort || "";
    const ticket = getStoredRankTicket(port);
    if (typeof window.executeEngineCommand !== "function") return;
    if (ticket) {
      const safe = sanitizeEngineArgument(ticket);
      window.executeEngineCommand(`setinfo _bcs_rank "${safe}"`);
    } else {
      // Misafir / süresi dolmuş bilet — eski setinfo kalmasın
      window.executeEngineCommand('setinfo _bcs_rank ""');
    }
  }

  function clearVipTicketSetinfo() {
    if (typeof window.executeEngineCommand !== "function") return;
    /* Keep connect userinfo small — inject VIP only after fully in-game. */
    window.executeEngineCommand('setinfo _bcs_vip ""');
  }

  function restoreVipTicket() {
    const port = window._browserCSConnectPort || "";
    const ticket = getStoredVipTicket(port);
    if (typeof window.executeEngineCommand !== "function") return;
    if (ticket) {
      const safe = sanitizeEngineArgument(ticket);
      window.executeEngineCommand(`setinfo _bcs_vip "${safe}"`);
    } else {
      window.executeEngineCommand('setinfo _bcs_vip ""');
    }
  }

  async function refreshRankTicketBeforeConnect() {
    const port = window._browserCSConnectPort || "";
    if (!port) return;
    try {
      await Promise.all([
        prefetchRankTicketForPort(port),
        ensureVipTicketForPort(port),
      ]);
    } catch {
      /* guest / offline */
    }
  }

  let connectCommandSentAt = 0;
  let recvAtConnect = 0;

  async function executeReconnectCommand() {
    if (!state.engineRunning || state.xash?.exited) {
      console.warn('[Reconnect] Engine henüz hazır değil — connect ertelendi');
      return;
    }

    // Menü splash'i bağlanırken görünmesin
    if (typeof window.hideMenuBackground === "function") {
      window.hideMenuBackground();
    }

    window.executeEngineCommand("setinfo _vgui_menus 0");
    // HTML scoreboard only — engine TAB/+showscores titreme yapar
    if (typeof window.assertBrowserCSTabUnbound === "function") {
      window.assertBrowserCSTabUnbound();
    } else {
      window.executeEngineCommand('unbind "TAB"');
      window.executeEngineCommand('unbind TAB');
      window.executeEngineCommand('bind "TAB" ""');
    }
    restorePassword();
    restoreAmxPassword();
    await refreshRankTicketBeforeConnect();
    restoreRankTicket();
    /* Do NOT put _bcs_vip in the connect userinfo — Xash drops VIP clients
     * mid-handshake when userinfo is churned (name/flags) or oversized. */
    clearVipTicketSetinfo();
    /* Önceki oturumdan kalmış vip_* oyuncu modeli team seçiminde yeniden
     * uygulanırsa WASM istemcisi çökebiliyor. Takım modeli bu bağlantıda oyun
     * DLL'i tarafından güvenli şekilde yeniden seçilecek. */
    window.executeEngineCommand('setinfo model ""');

    const port = window._browserCSConnectPort || "";
    const doConnect = () => {
      if (!state.engineRunning || state.xash?.exited) return;
      // connect öncesi sayaç — warm-start paketleri "girdik" sanılmasın
      recvAtConnect = Number(state.xash?.packetCountRecv || 0);
      connectCommandSentAt = Date.now();

      if (port) {
        const cmd = `connect 10.0.0.1:${port}`;
        if (typeof window.addConsoleLog === "function") {
          window.addConsoleLog(`[Ağ] Komut: ${cmd}`, "ok");
        }
        window.executeEngineCommand(cmd);
      } else {
        window.executeEngineCommand("retry");
      }
    };

    // Engine'in menüden çıkması için kısa bekle
    setTimeout(doConnect, 280);

  }

  /** Gerçek oyuna giriş — overlay bundan önce KAPANMASIN */
  function isFullyInGame() {
    if (sessionJoined) return true;

    if (window._browserCSInGameFlag) return true;

    const textMenu = document.getElementById("custom-textmenu");
    if (textMenu && textMenu.style.display === "flex") {
      return true;
    }

    // Scoreboard C++ bridge sadece gerçek oturumda gelir
    if (window._browserCSScoreboardSeen) return true;


    return false;
  }

  /** Classic DC or netBridge SAB path */
  function isXashDcOpen() {
    try {
      if (typeof state.xash?.isDataChannelOpen === "function") {
        return !!state.xash.isDataChannelOpen();
      }
      return !!(
        state.xash?._netBridge?.open ||
        state.xash?.dc?.readyState === "open"
      );
    } catch {
      return false;
    }
  }

  /** WebRTC canlı mı / paket var mı — sadece retry'de kanalı öldürmemek için */
  function hasJoinTraffic() {
    try {
      if (!isXashDcOpen()) return false;
      const recv = Number(state.xash.packetCountRecv || 0);
      // connect komutundan SONRA gelen paketler
      if (connectCommandSentAt && recv - recvAtConnect >= 8) return true;
      return false;
    } catch {
      return false;
    }
  }

  function isGameSessionActive() {
    return isFullyInGame();
  }

  function waitForConnected(timeoutMs) {
    return new Promise((resolve) => {
      if (!reconnecting || sessionJoined || isFullyInGame()) {
        resolve(true);
        return;
      }

      const started = Date.now();
      let deadline = started + timeoutMs;
      const check = () => {
        if (!reconnecting || sessionJoined || isFullyInGame()) {
          resolve(true);
          return;
        }

        /* Resources still flowing — give the join more time before retry. */
        if (hasJoinTraffic() && deadline < started + CONNECT_WAIT_TRAFFIC_MS) {
          deadline = started + CONNECT_WAIT_TRAFFIC_MS;
        }

        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }

        setTimeout(check, 200);
      };

      check();
    });
  }

  async function performReconnect(gen) {
    if (gen !== reconnectGen || !reconnecting) {
      return false;
    }

    // Sadece gerçek in-game — paket heuristiği ile connected() YOK
    if (isFullyInGame()) {
      connected();
      return true;
    }

    const dcAlreadyOpen = isXashDcOpen();

    setText(
      messageEl,
      dcAlreadyOpen
        ? "Kanal açık — sunucuya giriş deneniyor..."
        : "WebRTC ve sunucu bağlantısı kuruluyor..."
    );

    // DC zaten açıksa SIFIRLAMA — connect komutunu gönder.
    if (!dcAlreadyOpen) {
      try {
        if (state.xash?.ensureDcReady) {
          await state.xash.ensureDcReady(WEBRTC_RETRY_TIMEOUT_MS);
        }
      } catch (err) {
        const errMsg = err?.message || String(err || "unknown");
        console.warn("[Reconnect] WebRTC hazır değil:", errMsg);
        if (typeof window.addConsoleLog === "function" && connectMode !== "connecting") {
          window.addConsoleLog(
            "[Ağ] Yeniden bağlantı için WebRTC kurulamadı: " + errMsg,
            "warn"
          );
        }

        if (gen !== reconnectGen || !reconnecting) {
          return false;
        }

        setText(
          messageEl,
          connectMode === "connecting"
            ? "Ağ kanalı kuruluyor, lütfen bekleyin..."
            : "WebRTC bağlantısı kurulamadı. Tekrar denenecek..."
        );
        return false;
      }
    }

    if (gen !== reconnectGen) {
      return false;
    }

    if (isFullyInGame()) {
      connected();
      return true;
    }

    // DC açık olsa bile connect komutunu MUTLAKA gönder
    // (warm-start sadece kanalı açar, oyuna sokmaz)
    reconnecting = true;
    executeReconnectCommand();
    return true;
  }

  function markExhausted(message) {
    reconnectGen += 1;
    reconnectInFlight = false;
    reconnecting = false;
    exhausted = true;
    clearRetryTimer();

    showOverlay(lastReason, "reconnecting");
    if (overlay) overlay.classList.add("is-exhausted");
    setActionButtonsVisible(true);

    setText(
      titleEl,
      "BAĞLANTI KURULAMADI"
    );

    setText(
      messageEl,
      message ||
        "Sunucuya otomatik olarak bağlanılamadı. Tekrar deneyebilir veya sayfayı yenileyebilirsiniz."
    );

    setText(
      attemptEl,
      `${MAX_ATTEMPTS} deneme tamamlandı`
    );
  }

  async function runRetry() {
    if (!reconnecting) {
      return;
    }

    if (
      !state.engineRunning ||
      typeof window.executeEngineCommand !== "function"
    ) {
      markExhausted(
        "Oyun motoru yeniden bağlantı komutuna yanıt vermiyor. Sayfayı yenileyerek tekrar deneyebilirsiniz."
      );
      return;
    }

    if (attempt >= MAX_ATTEMPTS) {
      markExhausted();
      return;
    }

    if (reconnectInFlight) {
      return;
    }

    attempt += 1;
    const gen = reconnectGen;

    setText(
      attemptEl,
      connectMode === "connecting"
        ? `Bağlanıyor... (${attempt}/${MAX_ATTEMPTS})`
        : `Deneme ${attempt}/${MAX_ATTEMPTS}`
    );

    if (connectMode === "connecting") {
      setText(titleEl, "SUNUCUYA BAĞLANILIYOR");
      setText(messageEl, "Ağ kanalı ve sunucu oturumu kuruluyor, lütfen bekleyin...");
      setActionButtonsVisible(false);
    }

    reconnectInFlight = true;
    const webrtcOk = await performReconnect(gen);
    reconnectInFlight = false;

    if (gen !== reconnectGen) {
      return;
    }

    if (webrtcOk) {
      setText(
        messageEl,
        connectMode === "connecting"
          ? "Kanal açıldı — oyuna giriş yapılıyor..."
          : "Kanal açıldı — sunucu oturumu bekleniyor..."
      );
      const gameConnected = await waitForConnected(CONNECT_WAIT_MS);
      if (gen !== reconnectGen) {
        return;
      }

      if (gameConnected) {
        if (reconnecting) {
          connected();
        }
        return;
      }

      if (connectMode === "connecting") {
        setText(titleEl, "SUNUCUYA BAĞLANILIYOR");
        setText(
          messageEl,
          hasJoinTraffic()
            ? "Sunucu yanıt veriyor, giriş tamamlanıyor..."
            : "Sunucu yanıtı gecikiyor, tekrar deneniyor..."
        );
        setActionButtonsVisible(false);
      } else {
        setText(titleEl, "BAĞLANTI KESİLDİ");
        setText(
          messageEl,
          "WebRTC kuruldu ancak sunucuya giriş yapılamadı. Tekrar denenecek..."
        );
      }
    }

    if (gen !== reconnectGen || !reconnecting) {
      return;
    }

    if (attempt >= MAX_ATTEMPTS) {
      markExhausted();
      return;
    }

    const nextDelay =
      RETRY_DELAYS[
        Math.min(
          attempt - 1,
          RETRY_DELAYS.length - 1
        )
      ];

    setText(
      messageEl,
      connectMode === "connecting"
        ? "Bağlantı kuruluyor, lütfen bekleyin..."
        : `${lastReason} Yeniden bağlanılıyor...`
    );

    retryTimer = setTimeout(
      runRetry,
      nextDelay
    );
  }

  function start(reason, opts = {}) {
    /*
     * Aynı kopma WebSocket, engine logu ve C++ eventi
     * tarafından aynı anda bildirilebilir.
     */
    if (window._browserCSLeaving) {
      return;
    }

    if (reconnecting) {
      return;
    }

    if (exhausted) {
      return;
    }

    const forcePipe = !!opts.forcePipe;

    // Oyuna zaten girdiysek sahte kopma sinyallerini yoksay —
    // ama mid-game DC ölümü (forcePipe) mutlaka kurtarılsın.
    if (sessionJoined && isFullyInGame() && !forcePipe) {
      return;
    }

    reconnectGen += 1;
    reconnectInFlight = false;
    reconnecting = true;
    sessionJoined = false;
    attempt = 0;
    lastReason =
      reason || "Sunucu bağlantısı kesildi.";

    showOverlay(lastReason, "reconnecting");
    clearRetryTimer();

    retryTimer = setTimeout(
      runRetry,
      RETRY_DELAYS[0]
    );
  }

  function startInitialConnect(reason) {
    reconnectGen += 1;
    reconnectInFlight = false;
    reconnecting = true;
    exhausted = false;
    sessionJoined = false;
    attempt = 0;
    connectCommandSentAt = 0;
    recvAtConnect = 0;
    window._browserCSInGameFlag = false;
    window._browserCSScoreboardSeen = false;
    window._browserCSDidJoinFullupdate = false;
    window._browserCSScoreDomSig = '';
    lastReason =
      reason || "Sunucuya bağlanılıyor...";

    if (typeof window.hideMenuBackground === "function") {
      window.hideMenuBackground();
    }

    showOverlay(lastReason, "connecting");
    setText(
      attemptEl,
      isXashDcOpen()
        ? "Ağ kanalı hazır — oyuna giriliyor"
        : "Bağlantı hazırlanıyor..."
    );
    clearRetryTimer();

    // Warm-start varsa hemen bağlan (DC çoğu zaman zaten açık)
    retryTimer = setTimeout(
      runRetry,
      20
    );
  }

  function connected() {
    const wasReconnecting = reconnecting ||
      (overlay && overlay.classList.contains("show"));

    sessionJoined = true;
    window._browserCSInGameFlag = true;
    reconnectInFlight = false;
    reconnecting = false;
    exhausted = false;
    attempt = 0;
    if (wasReconnecting) {
      window._browserCSScoreDeadGraceUntil = Date.now() + 20000;
    }

    clearRetryTimer();
    hideOverlay();

    if (typeof window.hideMenuBackground === "function") {
      window.hideMenuBackground();
    }

    /* VIP ticket after handshake — server binds on late setinfo / delayed tasks.
     * Single deferred send only: Xash drops VIP clients when userinfo is
     * churned right after connect (same fragility that keeps _bcs_vip out of
     * the connect userinfo). Repeated immediate resends (0/800/2500ms) were
     * re-triggering that mid-handshake drop while resources were still
     * settling, causing a VIP-only disconnect/reconnect loop. AMXX already
     * re-reads _bcs_vip on its own schedule (0.5s/1.5s/2.0s after
     * putinserver), so one late, settled send is enough.
     *
     * On retry/reconnect (esp. right after a page reload from the WASM
     * crash auto-recovery), the EARLIER prefetch in executeReconnectCommand()
     * can race the Supabase session restore and come back empty — the client
     * then connects as a "guest" even for an active VIP. Geçerli bir bilet
     * varsa tekrar API sorgusu yapmadan onu kullan; yoksa auth oturduktan sonra
     * burada tek kez yenile. */
    try {
      setTimeout(async () => {
        const port = window._browserCSConnectPort || "";
        if (port) {
          try { await ensureVipTicketForPort(port); } catch (_) { /* guest / offline */ }
        }
        restoreVipTicket();
      }, 1800);
    } catch (_) { /* ignore */ }

    try {
      window.dispatchEvent(new CustomEvent("xash3d-ingame"));
    } catch (_) { /* ignore */ }

    if (typeof window.assertBrowserCSTabUnbound === "function") {
      window.assertBrowserCSTabUnbound();
      setTimeout(() => window.assertBrowserCSTabUnbound?.(), 1500);
    }

    // Neon: gerçek bağlantı kurulunca (menüde/connecting iken değil)
    if (typeof window.flushPendingAdminBanner === 'function') {
      setTimeout(() => window.flushPendingAdminBanner?.(), 1200);
      setTimeout(() => window.flushPendingAdminBanner?.(), 4000);
    }

    if (!wasReconnecting) {
      return;
    }

    reconnectGen += 1;

    setText(
      messageEl,
      "Bağlantı kuruldu."
    );

    const canvas =
      document.getElementById("canvas");

    // Pointer lock sadece kullanıcı tıklayınca — otomatik istek SecurityError verir
    if (canvas) {
      canvas.focus();
    }
  }

  function retryNow() {
    const now = Date.now();
    if (now - lastManualRetryAt < MANUAL_RETRY_COOLDOWN_MS) {
      if (typeof notify === "function") {
        notify("Lütfen birkaç saniye bekleyin...", "warn");
      }
      return;
    }
    lastManualRetryAt = now;

    reconnectGen += 1;
    reconnectInFlight = false;
    clearRetryTimer();
    reconnecting = true;
    exhausted = false;
    sessionJoined = false;
    attempt = 0;
    // Eski "ölü" skorboard bayrağını kısa süre yoksay
    window._browserCSScoreDeadGraceUntil = Date.now() + 20000;

    showOverlay("Manuel yeniden bağlanma başlatıldı.", "reconnecting");
    setText(
      attemptEl,
      "Manuel deneme"
    );

    runRetry();
  }

  function prepareConnection() {
    reconnectGen += 1;
    reconnectInFlight = false;
    reconnecting = false;
    exhausted = false;
    sessionJoined = false;
    attempt = 0;
    window._browserCSDidJoinFullupdate = false;
    window._browserCSScoreDomSig = '';
    clearRetryTimer();
    hideOverlay();
  }

  function nonRetryable(reason) {
    reconnectGen += 1;
    reconnectInFlight = false;
    lastReason = reason || lastReason;
    reconnecting = false;
    exhausted = true;
    sessionJoined = false;
    attempt = 0;
    clearRetryTimer();
    hideOverlay();
  }

  if (retryNowButton) {
    retryNowButton.addEventListener(
      "click",
      retryNow
    );
  }

  if (reloadButton) {
    reloadButton.addEventListener(
      "click",
      () => window.location.reload()
    );
  }

  return {
    start,
    startInitialConnect,
    connected,
    retryNow,
    prepareConnection,
    nonRetryable,
    get reconnecting() {
      return reconnecting;
    },
    get sessionJoined() {
      return sessionJoined;
    }
  };
})();

window.BrowserCSReconnect = BrowserCSReconnect;
