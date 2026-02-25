#!/usr/bin/env python3
import os
import struct
import zlib

OUT_DIR = "icons"


def png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def write_png(path: str, width: int, height: int, pixels: bytearray) -> None:
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", idat) + png_chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def make_icon(size: int) -> bytearray:
    bg = (14, 165, 233, 255)
    panel = (3, 17, 36, 255)
    accent = (224, 242, 254, 255)
    pixels = bytearray([0] * (size * size * 4))

    def set_px(x: int, y: int, color: tuple[int, int, int, int]) -> None:
        if not (0 <= x < size and 0 <= y < size):
            return
        i = (y * size + x) * 4
        pixels[i : i + 4] = bytes(color)

    # Rounded-square background.
    radius = max(2, size // 7)
    for y in range(size):
        for x in range(size):
            cx = radius if x < radius else size - radius - 1 if x >= size - radius else x
            cy = radius if y < radius else size - radius - 1 if y >= size - radius else y
            if (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius:
                set_px(x, y, bg)

    # Inner panel.
    margin = max(2, size // 6)
    for y in range(margin, size - margin):
        for x in range(margin, size - margin):
            set_px(x, y, panel)

    # Bookmark glyph.
    bookmark_w = max(4, size // 4)
    bookmark_h = max(6, size // 2)
    x0 = size // 2 - bookmark_w // 2
    y0 = size // 4
    for y in range(y0, y0 + bookmark_h):
        for x in range(x0, x0 + bookmark_w):
            set_px(x, y, accent)

    notch = max(2, bookmark_w // 2)
    for i in range(notch):
        set_px(x0 + i, y0 + bookmark_h - i - 1, panel)
        set_px(x0 + bookmark_w - i - 1, y0 + bookmark_h - i - 1, panel)

    return pixels


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 48, 128):
        path = os.path.join(OUT_DIR, f"icon{size}.png")
        write_png(path, size, size, make_icon(size))
        print(path)


if __name__ == "__main__":
    main()
