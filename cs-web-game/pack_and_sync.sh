#!/bin/bash
set -e

SRC="/Users/oktaybulut/Desktop/2/Hlf"
WEB="/Users/oktaybulut/Desktop/Hlf/cs-web-game"
ASSETS="$WEB/public/cs-assets"
WASM="$WEB/public/wasm"

echo "Syncing cstrike and valve maps & wads to cs-assets..."
mkdir -p "$ASSETS/cstrike" "$ASSETS/valve"

rsync -av "$SRC/cstrike/maps/" "$ASSETS/cstrike/maps/"
rsync -av "$SRC/cstrike/"*.wad "$ASSETS/cstrike/"
rsync -av "$SRC/valve/"*.wad "$ASSETS/valve/"

echo "Packing PK3 files for WASM..."
rm -f "$WASM/"*.pk3

cd "$SRC/cstrike"
zip -r -0 "$WASM/cstrike_models_player.pk3" models/player -q
zip -r -0 "$WASM/cstrike_models_shield.pk3" models/shield -q
zip -r -0 "$WASM/cstrike_models_other.pk3" models -x "models/player/*" -x "models/shield/*" -q
zip -r -0 "$WASM/cstrike_gfx_env.pk3" gfx/env -q
zip -r -0 "$WASM/cstrike_gfx_other.pk3" gfx -x "gfx/env/*" -q
zip -r -0 "$WASM/cstrike_sound.pk3" sound -q
zip -r -0 "$WASM/cstrike_sprites.pk3" sprites -q
zip -r -0 "$WASM/cstrike_essential.pk3" classes events resource overviews liblist.gam -q 2>/dev/null || true

cd "$SRC/valve"
zip -r -0 "$WASM/valve_models.pk3" models -q 2>/dev/null || true
zip -r -0 "$WASM/valve_sound.pk3" sound -q 2>/dev/null || true
zip -r -0 "$WASM/valve_sprites.pk3" sprites -q 2>/dev/null || true
zip -r -0 "$WASM/valve_gfx.pk3" gfx -q 2>/dev/null || true
zip -r -0 "$WASM/valve_essential.pk3" classes events resource overviews liblist.gam -q 2>/dev/null || true

echo "PK3 sizes:"
ls -lh "$WASM/"*.pk3

echo "Splitting halflife.wad..."
python3 -c "
import os
wad = '$ASSETS/valve/halflife.wad'
if os.path.exists(wad):
    data = open(wad, 'rb').read()
    mid = len(data) // 2
    open(wad.replace('halflife.wad', 'halflife1.wad'), 'wb').write(data[:mid])
    open(wad.replace('halflife.wad', 'halflife2.wad'), 'wb').write(data[mid:])
    os.remove(wad)
    print('Split halflife.wad successfully')
"
