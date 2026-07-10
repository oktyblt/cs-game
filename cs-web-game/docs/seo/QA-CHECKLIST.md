# Canlıya Alma Öncesi QA (Kalite Güvence) Kontrol Listesi

## 1. Teknik SEO ve Tarama
- [ ] `robots.txt` dosyası yayında mı ve doğru dizinleri engelliyor mu? (`/admin`, `/rcon` vb. kapalı, `/` açık)
- [ ] `sitemap.xml` yayında mı ve indekslenebilir URL'leri (200 OK) içeriyor mu?
- [ ] Yeni URL'lerin tümü doğrudan açıldığında (ör. `https://browsercs.com/sunucular`) 404 vermeden HTTP 200 dönüyor mu?
- [ ] Her sayfanın `head` etiketleri içerisinde benzersiz `title`, `meta description` ve `canonical` URL bulunuyor mu?

## 2. Structured Data (Schema.org)
- [ ] Google Rich Results Test aracı ile ana sayfa sınandı mı?
- [ ] `VideoGame` veya `Organization` Schema kodlarında herhangi bir ayrıştırma hatası veya Valve/Steam ihlali var mı?

## 3. Performans ve Core Web Vitals (Lighthouse)
- [ ] Ana SEO sayfalarının (oyun dışı) LCP süresi mobil cihazlarda < 2.5 saniye altında mı?
- [ ] `main.js` yüklenmeden HTML içindeki SEO metinleri ve butonları DOM üzerinde okunabiliyor mu?
- [ ] Oyun WebAssembly ve `.pk3` assetleri ana sayfaya ilk girişte (Play butonuna basılmadan) yükleniyor mu? (Cevap HAYIR olmalı!)

## 4. Kullanıcı Deneyimi ve Yönlendirmeler
- [ ] Ana sayfadaki "Hemen Oyna" butonuna basıldığında `/oyna` URL'ine yönlendirilip oyun sorunsuz başlıyor mu?
- [ ] Dil seçimi (hreflang) için kullanılan butonlar bir bot tarafından tıklanabilir standart `<a>` etiketi kullanıyor mu?
- [ ] Cloudflare üzerinde "Trailing Slash" ve "www / non-www" yönlendirme kuralları tekil bir domaine yönlendiriyor mu?

## 5. Güvenlik
- [ ] HTML Source kodunda herhangi bir `VITE_SUPABASE_URL` dışındaki kritik Secret Key yer alıyor mu? (Kontrol et)
- [ ] Oyun içi debug veya bağlantı hatası panelleri arama motoru tarafından indexlenmeyecek şekilde `data-nosnippet` veya JS koşullu DOM render yöntemiyle korunuyor mu?
