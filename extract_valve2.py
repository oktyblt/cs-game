import struct
import os
import zipfile

pak_path = "Hlf/valve/pak0.pak"
out_zip = "cs-web-game/public/wasm/valve_models.pk3"

# All needed files, lowercased
base_needed_files = [
    "models/w_battery.mdl", "models/w_antidote.mdl", "models/w_security.mdl", "models/w_longjump.mdl", "models/w_9mmclip.mdl",
    "models/shotgunshell.mdl", "models/w_shotbox.mdl", "models/w_weaponbox.mdl", "sprites/zerogxplode.spr", "sprites/wxplo1.spr",
    "sprites/steam1.spr", "sprites/bubble.spr", "sprites/bloodspray.spr", "sprites/blood.spr", "sprites/b-tele1.spr",
    "sprites/c-tele1.spr", "sprites/laserbeam.spr", "sprites/laserdot.spr", "models/grenade.mdl", "sprites/explode1.spr",
    "sprites/smoke.spr", "models/hgibs.mdl", "models/agibs.mdl", "models/mil_crategibs.mdl", "sound/weapons/sshell1.wav",
    "sound/weapons/sshell2.wav", "sound/weapons/sshell3.wav"
]

needed_files_lower = set(base_needed_files)
# add 't.mdl' variants
for f in base_needed_files:
    if f.endswith('.mdl'):
        needed_files_lower.add(f[:-4] + 't.mdl')

with open(pak_path, "rb") as f, zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    header = f.read(12)
    magic, diroffset, dirsize = struct.unpack("<4sII", header)
    
    num_entries = dirsize // 64
    f.seek(diroffset)
    entries = []
    for _ in range(num_entries):
        entry_data = f.read(64)
        filename, offset, length = struct.unpack("<56sII", entry_data)
        filename = filename.split(b'\x00', 1)[0].decode('ascii', errors='ignore').replace('\\', '/')
        entries.append((filename, offset, length))
    
    extracted = 0
    for filename, offset, length in entries:
        lower_name = filename.lower()
        if lower_name in needed_files_lower:
            f.seek(offset)
            data = f.read(length)
            
            # Since CS hardcodes "WXplo1.spr", let's extract it as "WXplo1.spr" in the ZIP so the virtual filesystem finds it exactly.
            if lower_name == "sprites/wxplo1.spr":
                save_name = "sprites/WXplo1.spr"
            else:
                save_name = filename
                
            zf.writestr(save_name, data)
            print(f"Extracted {save_name} (from {filename})")
            extracted += 1

print(f"Extracted {extracted} files to {out_zip}")
