# BrowserCS VIP Red/White Weapon Pack

Gold stock weapon skins (`cstrike_models_vipweapons.pk3` → stock `v_*.mdl`) stay for everyone.

Gold/Platinum VIP sticky weapons now use a separate **red/white** pack:

| Path | Role |
|------|------|
| `models/v_viprw_*.mdl` | 1st-person view |
| `models/p_viprw_*.mdl` | 3rd-person |
| `models/w_viprw_*.mdl` | world / weaponbox |
| `cstrike_weapons_viprw.pk3` | client CDN pack |
| `bcs-viprw-weapons.js` | additive VFS loader |

Existing `cstrike_weapons_vip.pk3` (gold `*_vip_*`) is left on CDN for rollback.

## Rebuild models

```bash
python3 tools/recolor_vip_to_rw.py /path/to/gold_vip_mdls /path/to/out_viprw
cd /path/to/out_viprw && mkdir -p models && mv *.mdl models/  # or zip from models/
zip -0 -r cstrike_weapons_viprw.pk3 models
```

## Server

1. Copy `*_viprw_*.mdl` into `cstrike/models/`
2. Compile/deploy `browsercs_vip.sma` (uses `VIP_WPN_TAG "viprw"`)
3. Map change / plugin reload on official containers
