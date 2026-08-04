# BrowserCS VIP Red/White Weapon Pack + Skin Choice

## Bağlantı notu
`cstrike_weapons_viprw.pk3` (~23MB) **otomatik yüklenmez**. Boot’ta sadece mevcut gold VIP paketleri gelir. Kırmızı–beyaz paket yalnızca VIP oyuncu seçince lazy-load edilir (WASM OOB / bağlanamama riski).

## Davranış
- Herkese açık gold stok skinler (`cstrike_models_vipweapons`) aynı kalır.
- Gold/Platinum VIP sticky silahlar varsayılan **Altın** (`*_vip_*`).
- VIP aktif edilince (F2 / `/vip`) ekranda / menüde iki seçenek:
  1. **Altın (Gold)**
  2. **Kırmızı–Beyaz** (ilk seçimde `cstrike_weapons_viprw.pk3` indirilir)
- Tekrar seçim: `/vipskin` veya F2 → VIP menü
- Client komutu: `bcs_vipwpnskin gold|rw`

## Dosyalar
| Path | Role |
|------|------|
| `models/{v,p,w}_vip_*.mdl` | Altın VIP silah |
| `models/{v,p,w}_viprw_*.mdl` | Kırmızı–beyaz VIP silah |
| `/wasm/cstrike_weapons_viprw.pk3` | Client RW paketi |
| `assets/bcs-viprw-weapons.js` | Skin menü + lazy loader |
| `browsercs_vip` v1.8.2 | Server plugin (AMXX 1.8.2) |

## Rebuild RW modelleri
```bash
python3 tools/recolor_vip_to_rw.py /path/to/gold_vip_mdls /path/to/out_viprw
cd /path/to/out && mkdir -p models && cp *.mdl models/
zip -0 -r cstrike_weapons_viprw.pk3 models
```
