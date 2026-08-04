# BrowserCS VIP Weapon Skins (Gold / Kırmızı–Beyaz)

## Kullanım
1. Oyuna gir → F2 ile VIP aktif et
2. Açılan menüden **Altın** veya **Kırmızı–Beyaz** seç
3. Tekrar: `/vipskin` veya F2 → `/vip`

## Teknik (gold parity)
| Katman | Altın | Kırmızı–Beyaz |
|--------|-------|----------------|
| Client PK3 | `cstrike_weapons_vip.pk3` (`*_vip_*`) | lazy `cstrike_weapons_viprw.pk3` (`*_viprw_*`) |
| Client extract | `ensureVipAssetsLoaded` | `bcs-viprw-weapons.js` v6 (aynı yöntem) |
| FastDL | `/cs-assets/cstrike/models/*_vip_*` | `/cs-assets/.../*_viprw_*` |
| Server precache | `*_vip_*` | `*_viprw_*` (plugin **1.8.7**, toplam 178) |
| Komut | `bcs_vipwpnskin gold` | `bcs_vipwpnskin rw` |

RW boot’ta yüklenmez; menü açılınca / seçince PK3 indirilip VFS’e yazılır. Sunucu precache sayesinde viewmodel yolu gold gibi geçerli model index alır.
