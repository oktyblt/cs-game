# CS Web Game Geniş Çaplı Güncelleme Planı

Bu plan, talep ettiğiniz menü düzenlemeleri, Stripe entegrasyonu, admin ve bakiye sistemi değişiklikleri ile CSS düzeltmelerini içermektedir.

## User Review Required

> [!IMPORTANT]
> **Stripe Entegrasyonu Hakkında:** Stripe ile ödeme alabilmeniz için `STRIPE_SECRET_KEY` ve webhook ayarlarına ihtiyacımız var. Admin panelinden Stripe anahtarını ayarlayabileceğiniz bir yapı kuracağım. Ancak gerçek ödemelerin çalışabilmesi için Stripe tarafında bir hesap açıp anahtarları sisteme girmeniz gerekecek.
> Ayrıca, sunucuların "1 ay açık kalması" için gerçek bir arka uç (AWS, Vultr vb.) ile mi entegre çalışılacak, yoksa mevcut `worker.js` üzerindeki "Browser Listen Server" mantığıyla mı birleştirilecek? (Mevcut sistemde sunucular tarayıcı üzerinden açıldığı için tarayıcı kapanınca sunucu kapanır. Gerçekten 7/24 açık sunucu verilecekse, AWS/DigitalOcean sunucularına bağlanması gerekir). Bu aşamada Supabase tarafında sunucunun durumunu (1 ay aktif, 3 gün rezerve) yönetecek sistemi kuracağım.

## Proposed Changes

### UI ve Menü Düzenlemeleri (Frontend)
- **Sunucular / Haritalar Sekmeleri:** `index.html` ve `main.js` içinde "Sunucular" ilk sekme yapılacak, varsayılan olarak o açılacak. "Haritalar" sekmesi ikinci sıraya alınacak. Sunucular sekmesindeyken haritalar listesi tamamen gizlenecek.
- **Xash3D WASM Yazıları:** Sitedeki tüm Xash3D WASM ve Xash^D WASM yazıları kaldırılacak/gizlenecek.
- **Master Admin Butonu:** Üst menüdeki ve sekmelerdeki "Admin" butonları kaldırılacak. Bunun yerine tarayıcı URL'sine `/csadmin` yazıldığında Admin giriş ekranı açılacak.
- **CSS İyileştirmeleri:** Sunucular menüsünün küçük ekranlarda üst üste binmesi (`flex-wrap` ve `grid` düzeltmeleri) ve haritalar menüsünün bozulması sorunları çözülecek. Temal yapı korunup daha modern ve stabil bir görünüm eklenecek.

### Ödeme Sistemi ve Bakiye Kaldırma
- **Bakiye Sistemi:** Dashboard ve Auth kısmından "Bakiye" (Wallet) yapısı tamamen silinecek.
- **Stripe Checkout Entegrasyonu:** Sunucu fiyatı 350 TL olarak sabitlenecek. Kullanıcı "Satın Al" dediğinde doğrudan Stripe ödeme sayfasına yönlendirilecek.
- **Admin Paneli Stripe Ayarı:** Admin paneline Stripe Gizli Anahtarı (Secret Key) ve Yayınlanabilir Anahtarı (Publishable Key) girip Supabase veritabanına kaydedilebilmesi için bir ayar bölümü eklenecek.

### Sunucu Yönetimi ve Adminlik
- **Süreli Sunucu Mantığı:** Kullanıcı sunucu aldığında Supabase `purchased_servers` tablosuna `expires_at` (1 ay sonrası) eklenecek. Süresi bitince 3 gün `suspended` (rezerve) durumuna geçecek, ardından sistemden silinecek. 
- **Yönet ve Bağlan Butonları:** Satın alınan sunuculardaki "Başlatılıyor" (Starting) sorunu düzeltilecek. Ödeme onaylandığında durumu `active` olacak.
- **Otomatik Adminlik:** Kullanıcı kendi satın aldığı sunucuya "Bağlan" dediğinde, oyuna `rcon_password` ile giriş yapmış gibi (ya da otomatik admin flag'i ile) tam yetkili olarak bağlanacak. Diğer oyuncular normal girecek.

## Verification Plan

- **Frontend Testi:** `/csadmin` URL'si ile admin panelinin açıldığı, Sunucular sekmesinin ilk geldiği doğrulanacak.
- **Stripe Test Mode:** Stripe'ın Test (Sandbox) kartlarıyla sahte bir ödeme yapılıp, sunucunun profil ekranında `active` duruma geldiği test edilecek.
- **Adminlik Testi:** Satın alınan sunucuya tıklandığında oyun içinde admin komutlarının (örn. amxmodmenu veya rcon) çalıştığı görülecek.

