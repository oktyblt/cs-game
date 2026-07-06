import struct
import sys

pak_path = "Hlf/valve/pak0.pak"
with open(pak_path, "rb") as f:
    header = f.read(12)
    magic, diroffset, dirsize = struct.unpack("<4sII", header)
    num_entries = dirsize // 64
    f.seek(diroffset)
    for _ in range(num_entries):
        entry_data = f.read(64)
        filename, offset, length = struct.unpack("<56sII", entry_data)
        filename = filename.split(b'\x00', 1)[0].decode('ascii', errors='ignore')
        if 'battery' in filename.lower() or 'wxplo' in filename.lower():
            print(filename)
