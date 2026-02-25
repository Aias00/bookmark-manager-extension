#!/usr/bin/env python3
import argparse
import glob
import os
import struct
import sys


def png_size(path: str):
    with open(path, "rb") as f:
        sig = f.read(8)
        if sig != b"\x89PNG\r\n\x1a\n":
            return None
        length = struct.unpack(">I", f.read(4))[0]
        if f.read(4) != b"IHDR":
            return None
        data = f.read(length)
        width, height = struct.unpack(">II", data[:8])
        return width, height


def jpeg_size(path: str):
    with open(path, "rb") as f:
        if f.read(2) != b"\xff\xd8":
            return None
        while True:
            marker_start = f.read(1)
            if not marker_start:
                return None
            if marker_start != b"\xff":
                continue
            marker = f.read(1)
            while marker == b"\xff":
                marker = f.read(1)
            if marker in {b"\xd8", b"\xd9"}:
                continue
            seg_len_bytes = f.read(2)
            if len(seg_len_bytes) != 2:
                return None
            seg_len = struct.unpack(">H", seg_len_bytes)[0]
            if marker in {b"\xc0", b"\xc1", b"\xc2", b"\xc3", b"\xc5", b"\xc6", b"\xc7", b"\xc9", b"\xca", b"\xcb", b"\xcd", b"\xce", b"\xcf"}:
                _precision = f.read(1)
                height, width = struct.unpack(">HH", f.read(4))
                return width, height
            f.seek(seg_len - 2, 1)


def image_size(path: str):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".png":
        return png_size(path)
    if ext in {".jpg", ".jpeg"}:
        return jpeg_size(path)
    return None


def check(path: str, expected, required=True):
    exists = os.path.isfile(path)
    if not exists:
        return f"FAIL: {os.path.basename(path)} missing" if required else f"WARN: {os.path.basename(path)} missing (optional)"
    size = image_size(path)
    if size is None:
        return f"FAIL: {os.path.basename(path)} unsupported format"
    if size != expected:
        return f"FAIL: {os.path.basename(path)} is {size[0]}x{size[1]}, expected {expected[0]}x{expected[1]}"
    return f"PASS: {os.path.basename(path)} ({size[0]}x{size[1]})"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="release/store-assets")
    args = parser.parse_args()
    root = args.root

    checks = []
    checks.append(check(os.path.join(root, "store-icon-128.png"), (128, 128), required=True))
    checks.append(check(os.path.join(root, "small-promo-440x280.png"), (440, 280), required=True))
    checks.append(check(os.path.join(root, "marquee-promo-1400x560.png"), (1400, 560), required=False))

    screenshot_paths = []
    for ext in ("png", "jpg", "jpeg"):
        screenshot_paths.extend(glob.glob(os.path.join(root, f"screenshot-*.{ext}")))

    if not screenshot_paths:
        checks.append("FAIL: no screenshot-* asset found (need at least one)")
    else:
        ok_count = 0
        for path in sorted(screenshot_paths):
            size = image_size(path)
            if size in {(1280, 800), (640, 400)}:
                checks.append(f"PASS: {os.path.basename(path)} ({size[0]}x{size[1]})")
                ok_count += 1
            elif size is None:
                checks.append(f"FAIL: {os.path.basename(path)} unsupported format")
            else:
                checks.append(
                    f"FAIL: {os.path.basename(path)} is {size[0]}x{size[1]}, expected 1280x800 or 640x400"
                )
        if ok_count == 0:
            checks.append("FAIL: screenshots exist but none match required dimensions")

    print("\n".join(checks))
    failed = [line for line in checks if line.startswith("FAIL")]
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
