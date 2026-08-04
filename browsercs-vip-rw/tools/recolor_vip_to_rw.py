#!/usr/bin/env python3
"""Recolor GoldSrc VIP gold weapon MDLs → red/white (viprw) palette remap."""
from __future__ import annotations

import argparse
import struct
from pathlib import Path

HAND_HINTS = (b"hand", b"glove", b"arm", b"finger")


def clamp(x: float) -> int:
    return 0 if x < 0 else 255 if x > 255 else int(x)


def recolor_rgb(r: int, g: int, b: int) -> tuple[int, int, int]:
    mx = max(r, g, b)
    mn = min(r, g, b)
    if mx < 8:
        return r, g, b
    sat = (mx - mn) / mx if mx else 0.0
    L = 0.299 * r + 0.587 * g + 0.114 * b

    is_metal_gold = (
        (r >= g - 10 and g > b + 8 and L > 35)
        or (r > 90 and g > 70 and (r + g) > b * 2.2 and sat > 0.12)
        or (abs(r - g) < 40 and r > b + 25 and L > 50)
    )
    is_bright_highlight = L > 200 and sat < 0.35
    is_dark_metal = L < 55 and sat < 0.35

    if is_bright_highlight:
        return (
            clamp(245 + (L - 200) * 0.15),
            clamp(232 + (L - 200) * 0.2),
            clamp(228 + (L - 200) * 0.2),
        )

    if is_dark_metal and not is_metal_gold:
        return clamp(L * 0.55 + 8), clamp(L * 0.28 + 4), clamp(L * 0.32 + 6)

    if is_metal_gold or (L > 40 and sat > 0.08 and r + g > b * 1.5):
        t = L / 255.0
        if t < 0.28:
            nr = 18 + t / 0.28 * 120
            ng = 4 + t / 0.28 * 18
            nb = 10 + t / 0.28 * 28
        elif t < 0.55:
            u = (t - 0.28) / 0.27
            nr = 138 + u * 70
            ng = 22 + u * 28
            nb = 38 + u * 35
        elif t < 0.78:
            u = (t - 0.55) / 0.23
            nr = 208 + u * 35
            ng = 50 + u * 120
            nb = 73 + u * 110
        else:
            u = (t - 0.78) / 0.22
            nr = 243 + u * 12
            ng = 170 + u * 70
            nb = 183 + u * 60
        return clamp(nr), clamp(ng), clamp(nb)

    if g > r + 15 and g > b:
        return clamp(L * 0.7 + 20), clamp(L * 0.35 + 8), clamp(L * 0.4 + 12)

    return r, g, b


def parse_textures(data: bytes | bytearray):
    if data[:4] != b"IDST":
        return []
    numtex = struct.unpack_from("<i", data, 180)[0]
    texidx = struct.unpack_from("<i", data, 184)[0]
    if numtex <= 0 or numtex > 64 or texidx <= 0 or texidx >= len(data):
        return []
    out = []
    for i in range(numtex):
        off = texidx + i * 80
        if off + 80 > len(data):
            break
        name = data[off : off + 64].split(b"\0")[0]
        flags, w, h, idx = struct.unpack_from("<iiii", data, off + 64)
        if w <= 0 or h <= 0 or idx <= 0:
            continue
        if idx + w * h + 768 > len(data):
            continue
        out.append((name, w, h, idx, flags))
    return out


def recolor_mdl(src: Path, dst: Path) -> int:
    data = bytearray(src.read_bytes())
    changed = 0
    for name, w, h, idx, _flags in parse_textures(data):
        lname = name.lower()
        if any(h in lname for h in HAND_HINTS):
            continue
        pal_off = idx + w * h
        for pi in range(256):
            o = pal_off + pi * 3
            r, g, b = data[o], data[o + 1], data[o + 2]
            nr, ng, nb = recolor_rgb(r, g, b)
            if (nr, ng, nb) != (r, g, b):
                data[o], data[o + 1], data[o + 2] = nr, ng, nb
                changed += 1
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(data)
    return changed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src_dir", type=Path)
    ap.add_argument("dst_dir", type=Path)
    args = ap.parse_args()
    n = 0
    for src in sorted(args.src_dir.glob("*.mdl")):
        if "_vip_" not in src.name:
            continue
        dst = args.dst_dir / src.name.replace("_vip_", "_viprw_", 1)
        ch = recolor_mdl(src, dst)
        n += 1
        print(f"{src.name} -> {dst.name} ({ch} palette entries)")
    print(f"done: {n} models")


if __name__ == "__main__":
    main()
