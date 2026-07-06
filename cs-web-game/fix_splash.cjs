const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

// The connectToServer logic was incorrectly inserted inside runSplash.
// We will replace it back to the original map loading logic.
let newSplash = `  // Asset server bağlantısı
  setSplash('Asset server\\'a bağlanılıyor...', 50);
  const serverOk = await loadMapList();

  setSplash('WASM dosyaları kontrol ediliyor...', 75);
  // WASM dosyaları /wasm/ altında — public/ statik olarak serve edilir
  const wasmOk = await checkWasmFiles();

  if (serverOk && wasmOk) {
    setSplash('Her şey hazır!', 100);
    setTimeout(() => {
      splashEl.style.opacity = '0';
      setTimeout(() => splashEl.remove(), 500);
      // boot(); // We will call renderMaps instead if boot doesn't exist
      renderMaps();
    }, 800);
  } else {
    splashStatus.innerHTML = '<span style="color:var(--cs-red);">Hata: Eksik dosyalar veya bağlantı sorunu var!</span>';
  }`;

// Find where window.connectToServer starts inside runSplash
let startIdx = code.indexOf('window.connectToServer = function(port)');
let endIdx = code.indexOf('const serverOk = await loadMapList();', startIdx);
if (endIdx === -1) endIdx = code.indexOf('setSplash(\'WASM dosyaları', startIdx);

if (startIdx !== -1) {
    let before = code.substring(0, startIdx);
    let after = code.substring(endIdx);
    code = before + "\n" + newSplash + "\n}\n" + code.substring(startIdx, endIdx) + "\n\n// --- INIT ---\nrunSplash();\n";
    fs.writeFileSync('src/main.js', code);
    console.log("Fixed main.js");
} else {
    console.log("Could not find window.connectToServer in main.js");
}
