# BrowserCS VIP Weapon Skins (Gold / Kırmızı–Beyaz)

## Kullanım
1. Oyuna gir → F2 ile VIP aktif et
2. Açılan menüden **Altın** veya **Kırmızı–Beyaz** seç
3. Tekrar: `/vipskin` veya F2 → `/vip`

## Teknik
| Katman | Altın | Kırmızı–Beyaz |
|--------|-------|----------------|
| Client boot PK3 | `cstrike_weapons_vip.pk3` (`*_vip_*`) | lazy `cstrike_weapons_viprw.pk3` |
| FastDL | `/cs-assets/cstrike/models/*_vip_*` | `/cs-assets/.../*_viprw_*` |
| Plugin | v1.8.4 `bcs_vipwpnskin gold\|rw` | aynı |

RW paketi boot’ta yüklenmez (WASM bellek). VIP seçince indirilir; diğer oyuncular FastDL’den alır.
