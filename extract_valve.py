import struct
import os
import zipfile

pak_path = "Hlf/valve/pak0.pak"
out_zip = "cs-web-game/public/wasm/valve_models.pk3"

needed_files = {
    "models/w_battery.mdl", "models/w_antidote.mdl", "models/w_security.mdl", "models/w_longjump.mdl", "models/w_9mmclip.mdl",
    "models/shotgunshell.mdl", "models/w_shotbox.mdl", "models/w_weaponbox.mdl", "sprites/zerogxplode.spr", "sprites/WXplo1.spr",
    "sprites/steam1.spr", "sprites/bubble.spr", "sprites/bloodspray.spr", "sprites/blood.spr", "sprites/b-tele1.spr",
    "sprites/c-tele1.spr", "sprites/laserbeam.spr", "sprites/laserdot.spr", "models/grenade.mdl", "sprites/explode1.spr",
    "sprites/smoke.spr", "models/hgibs.mdl", "models/agibs.mdl", "models/mil_crategibs.mdl", "sound/weapons/sshell1.wav",
    "sound/weapons/sshell2.wav", "sound/weapons/sshell3.wav"
}

with open(pak_path, "rb") as f, zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as zf:
    header = f.read(12)
    magic, diroffset, dirsize = struct.unpack("<4sII", header)
    if magic != b'PACK':
        print("Not a valid pak file")
        exit(1)
    
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
        if filename in needed_files:
            f.seek(offset)
            data = f.read(length)
            zf.writestr(filename, data)
            print(f"Extracted {filename}")
            extracted += 1

print(f"Extracted {extracted} files to {out_zip}")
