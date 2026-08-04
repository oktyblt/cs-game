# BrowserCS VIP Weapon Skins (Gold / Kırmızı–Beyaz)

## Kullanım
1. Oyuna gir → F2 ile VIP aktif et
2. Açılan menüden **Altın** veya **Kırmızı–Beyaz** seç
3. Tekrar: `/vipskin` veya F2 → `/vip`

## Teknik (join-safe)
| Katman | Altın | Kırmızı–Beyaz |
|--------|-------|----------------|
| Server model path | `*_vip_*` (precache 93) | aynı `*_vip_*` yolu |
| Client | `cstrike_weapons_vip.pk3` | lazy `cstrike_weapons_viprw.pk3` → VFS’te `*_vip_*` üzerine yazılır |
| Plugin | **1.8.8** `bcs_vipwpnskin gold\|rw` | skin kaydı + refresh |

`viprw` sunucuda precache edilmez (178 model join/WASM OOB kırıyordu).
