# BrowserCS Proje Kuralları

## WASM Derleme Kuralları
- WASM derlerken DAİMA `wasm_build/webxash3d-fwgs/packages/cs16-client/` kullan (NOT local cs16-client)
- Docker image: `emscripten/emsdk:4.0.17` — asla farklı sürüm kullanma
- Yeni WASM sürümü her zaman bir öncekinden +1 versiyon olmalı (v35 → v36)
- Mevcut WASM versiyonları: **client=v32, menu=v32, server=v32** — kullanıcının onayı olmadan ASLA değiştirme

## Güncel Çalışan Durum
- client_emscripten_wasm32_v30.wasm ✅
- menu_emscripten_wasm32_v28.wasm ✅
- cs_emscripten_wasm32_v21.wasm ✅
- Bu sürümler kullanıcı tarafından onaylanmıştır

## JS/HTML Değişiklik Kuralları
- `src/main.js` ve `src/index.html` değiştirilirken MEVCUT dosyalar baz alınır
- Eski commit'ten checkout yapıldığında, mevcut iyileştirmeler (Tab scoreboard, updateBrowserCSScoreboard, vb.) KORUNMALIDIR
- "21:00 kodlarına al" gibi isteklerde sadece belirtilen kısım güncellenir, tüm dosya değil

## Scoreboard Entegrasyonu
- `window.updateBrowserCSScoreboard(playersJson, serverName, localPlayerId)` fonksiyonu main.js'de tanımlı — silme
- Tab tuşu: `stopPropagation()` + `preventDefault()` → sadece HTML scoreboard açılır
- `#custom-scoreboard` overlay background `rgba(0,0,0,0.97)` — opak kalmalı
- `[BROWSERCS_SCOREBOARD]` sinyali wasm_build scoreboard.cpp'de `Con_Printf` ile emit ediliyor

## Genel Kurallar  
- Kullanıcıdan onay almadan WASM sürümü değiştirme
- Her deploy öncesi mevcut main.js/index.html içeriğini kontrol et
- "Mevcut sürüm üzerinden geliştir" demek: git checkout eski sürüm YAPMA, mevcut dosyayı düzenle

## INFRA — ASLA kullanıcıya AWS/CF bilgisi sorma
Bilgiler zaten repoda. Önce şunları oku:
- `.agents/fps-stabilization/LIVE_APPLY_STATUS.txt`
- `recovery/RECOVERY.md`
- `recovery/CLOUDFLARE_LIVE.md`

### AWS (backend) — hazır
- Host: `ubuntu@35.159.95.54`
- Path: `/home/ubuntu/cs-server-manager`
- Process: PM2 `cs-manager` → `index.js`
- SSH key: git history `ddcb9c3^:cs-server-manager/cs-key.pem` (gitignore `*.pem` — commit etme)
- Canlı `index.js` repo `main`'den **daha yeni/modular** (~107KB). Wholesale overwrite YASAK; additif patch.
- Public API: `https://backend.browsercs.com` → EC2 `:4000`

```bash
mkdir -p /tmp/cs-ssh
git show 'ddcb9c3^:cs-server-manager/cs-key.pem' > /tmp/cs-ssh/cs-key.pem
chmod 600 /tmp/cs-ssh/cs-key.pem
ssh -i /tmp/cs-ssh/cs-key.pem -o StrictHostKeyChecking=no ubuntu@35.159.95.54 '...'
# iş bitince: rm -f /tmp/cs-ssh/cs-key.pem
```

### Cloudflare (frontend) — hazır kurallar
- Her CF deploy paketinde **`_headers` ZORUNLU** (`/oyna` COOP `same-origin` + COEP `credentialless`). Yoksa SharedArrayBuffer / crossOriginIsolated düşer.
- Pages proje: `cs-web-game` → https://browsercs.com
- GitHub↔CF otomatik bağ yok; manuel `wrangler pages deploy`
- **ASLA** GitHub `main` vite `dist` ile production üzerine basma
- CF deploy = **live-snapshot + additive patch only** (`bcs-*.js`, Pages Functions)
- Functions için cwd kritik: `cd /tmp/cf-restore-live && npx wrangler pages deploy . --project-name=cs-web-game --branch=main`
- Canonical snapshot notları: `recovery/CLOUDFLARE_LIVE.md`

## Cloudflare Deployment Rule
- GitHub repo ile Cloudflare arasında otomatik bağlantı yoktur.
- Yeni bir değişiklik yapıldığında mutlaka manuel olarak `npm run build && wrangler pages deploy` komutu ile Cloudflare Pages üzerine gönder (deploy et).
- Yukarıdaki live-snapshot + additive kuralına uy; aksi production’ı ezer.

## WASM Sürüm Güncelleme (main.js) Kuralı
- main.js içerisinde WASM versiyonları güncellenirken (örneğin v33 -> v34) **asla tüm dosyada toplu (sed vb.) değiştir-değiştir yapma**.
- `filesMap` objesindeki sol taraftaki sanal dosya yolları (örn: `cl_dlls/client_emscripten_wasm32.wasm`) ve `em.FS.writeFile` komutlarındaki sanal yollar **ASLA versiyon eki (_vXX) içermemelidir**.
- Sadece sağ taraftaki gerçek URL yollarında (örn: `/wasm/cl_dlls/client_emscripten_wasm32_v34.wasm`) versiyon eki bulunmalıdır. Sanal yolları bozarsan oyun motoru dosyaları bulamaz!
