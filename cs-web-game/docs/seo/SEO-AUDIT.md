# BrowserCS Kapsamlı SEO Denetimi (Audit)

## 1. Frontend Mimarisi ve Rendering
- **Kullanılan Yapı:** Vite ile derlenen Vanilla JavaScript ve tek sayfalık HTML (SPA).
- **Rendering:** Uygulama tamamen Client-Side Rendering (CSR) mantığıyla çalışmaktadır. Oyun HTML canvas elemanı üzerinde Xash3D WebAssembly ile renderlanmaktadır.
- **Prerender/SSG/SSR Desteği:** Şu anda yok. Googlebot ana sayfaya geldiğinde boş bir kabuk veya doğrudan "BrowserCS - Oyun Yükleniyor..." gibi ekranlarla karşılaşıyor.
- **SEO Etkisi (P0):** Farklı arama niyetleri için ayrı sayfalar bulunmamakta. Arama motoru tüm arama trafiğini tek bir sayfaya (`/`) çekmeye çalışıyor ve içeriği tam olarak ayrıştıramıyor.

## 2. Meta Veriler ve Yönlendirmeler
- **Sayfa Title Yapısı:** Sabit ve tek bir title ("Counter-Strike 1.5 - Xash3D WebAssembly Browser Game").
- **Meta Description:** Eksik veya dinamik olarak oluşturulmamış.
- **Canonical:** Belirtilmemiş.
- **Hreflang / HTML Lang:** Sadece Türkçe veya İngilizce için optimize edilmemiş.
- **Robots.txt & Sitemap.xml:** Eksik.

## 3. İçerik ve Heading Hiyerarşisi (H1, H2)
- **Heading Yapısı:** Oyun arayüzü DOM üzerinde modallar ile şekillendiği için mantıklı bir heading hiyerarşisi bulunmuyor.
- **İç Linkleme (Internal Linking):** SPA olduğu için iç link yok.
- **Breadcrumb:** Yok.

## 4. Teknik ve Performans Sorunları (Core Web Vitals)
- **WASM ve Yükleme Zamanı (P0):** Oyun dosyaları (`.pk3`, `.wasm`) kullanıcı oyuna girmeden ana sayfa arka planında yüklenmeye çalışılırsa (lazy load yapılmazsa), LCP (Largest Contentful Paint) çok geç gerçekleşir ve Core Web Vitals sınırları dışına çıkılır.
- **Render-Blocking Kaynaklar:** Stil dosyaları ve bazı JS dosyaları oyun motorundan ayrı bir şekilde hızlı yüklenmeli. SEO sayfaları (MPA) oluşturulduğunda bu sorun izole edilecek.

## 5. Güvenlik ve Gizli İçerikler (P0)
Mevcut DOM yapısı içerisinde (örneğin Master Admin Paneli, RCON paneli, banlama modalı, teknik debug logları) taranıp indekslenmemesi gereken şifre, RCON komutu veya özel anahtar içerikleri olabilir.
- **Çözüm:** Bu modalların `index.html`'in dışına alınması veya SEO botlarından gizlenmesi (`data-nosnippet` veya DOM'a sadece tıklandığında ekleme).

## Bulgular Tablosu

| Öncelik | Sorun | Kanıt | Etkilenen URL/Dosya | SEO Etkisi | Çözüm | Efor |
|---------|-------|-------|---------------------|------------|-------|------|
| **P0** | SPA mimarisi (Tek URL) | URL değişmeden farklı modallar açılması | `/` (Tümü) | Botlar alt arama niyetlerini (haritalar, sunucular) anlayamıyor. | MPA yapısına (Vite Multi-page) geçilmesi. | Yüksek |
| **P0** | Eksik Sitemap & Robots | Ana dizinde `sitemap.xml` ve `robots.txt` yok | Tüm site | Tarama bütçesi (crawl budget) israfı ve keşfedilebilirlik sorunu. | Statik dosyaların eklenmesi. | Düşük |
| **P1** | Hiyerarşik olmayan HTML ve Meta Tag eksikliği | `<h1>` ve `meta description` etiketi yok / zayıf | `/` | Organik sıralamada geri düşme. | Her sayfa için özgün metadata girilmesi. | Orta |
| **P1** | Asset'lerin (WASM) SEO sayfasını bloke etmesi | LCP ve TTI metrikleri yüksek çıkabilir | `/` | Core Web Vitals hataları nedeniyle trafik kaybı. | Oyun motorunun yalnızca `/oyna` sayfasında lazy load edilmesi. | Orta |
| **P2** | Breadcrumb ve Schema (JSON-LD) Eksikliği | Kaynak kodda structured data bulunmaması | Tüm site | Zengin sonuç (Rich Snippet) fırsatlarının kaçırılması. | Gerekli scriptlerin başlığa eklenmesi. | Orta |

---
*Not: Bu denetim mevcut kaynak kodu incelenerek hazırlanmıştır.*
