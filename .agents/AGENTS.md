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

## Cloudflare Deployment Rule
- GitHub repo ile Cloudflare arasında otomatik bağlantı yoktur.
- Yeni bir değişiklik yapıldığında mutlaka manuel olarak `npm run build && wrangler pages deploy` komutu ile Cloudflare Pages üzerine gönder (deploy et).

## WASM Sürüm Güncelleme (main.js) Kuralı
- main.js içerisinde WASM versiyonları güncellenirken (örneğin v33 -> v34) **asla tüm dosyada toplu (sed vb.) değiştir-değiştir yapma**.
- `filesMap` objesindeki sol taraftaki sanal dosya yolları (örn: `cl_dlls/client_emscripten_wasm32.wasm`) ve `em.FS.writeFile` komutlarındaki sanal yollar **ASLA versiyon eki (_vXX) içermemelidir**.
- Sadece sağ taraftaki gerçek URL yollarında (örn: `/wasm/cl_dlls/client_emscripten_wasm32_v34.wasm`) versiyon eki bulunmalıdır. Sanal yolları bozarsan oyun motoru dosyaları bulamaz!
