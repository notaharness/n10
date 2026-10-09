#!/usr/bin/env python3
"""Build the Electron and Linux package icons from the website's SVG mark.

Requires Inkscape on PATH. Run from any directory: python3 apps/desktop/scripts/icons.py
The PNG payloads in ICO and ICNS are assembled with the Python standard library.
"""

from pathlib import Path
import shutil
import struct
import subprocess


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "apps/website/public/brand/n10-mark.svg"
BUILD = ROOT / "apps/desktop/build"
RENDERER = ROOT / "apps/desktop/src/renderer/assets/n10-mark.svg"
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024)
WEBSITE_VIEWBOX = 'viewBox="0 0 250 250"'
# The wide wordmark has large vertical margins in the site's square avatar.
# Native icons need an optical variant: about 1px of side padding and 2px
# above/below at 16px, with a taller letterform for legibility.
ICON_VIEWBOX = 'viewBox="25 57.5 200 135" preserveAspectRatio="none"'


def chunk(kind: bytes, payload: bytes) -> bytes:
    return kind + struct.pack(">I", len(payload) + 8) + payload


def main() -> None:
    if not shutil.which("inkscape"):
        raise SystemExit("Inkscape is required to render desktop icons")

    BUILD.mkdir(parents=True, exist_ok=True)
    icons = BUILD / "icons"
    icons.mkdir(exist_ok=True)
    source = SOURCE.read_text(encoding="utf-8")
    if source.count(WEBSITE_VIEWBOX) != 1:
        raise SystemExit("Website mark viewBox changed; inspect the icon crop")
    icon_source = source.replace(WEBSITE_VIEWBOX, ICON_VIEWBOX, 1).replace(
        "Sized for a square avatar; safe under a circular crop.",
        "Optically enlarged for small app icons.",
        1,
    )
    icon_svg = BUILD / "icon.svg"
    icon_svg.write_bytes(icon_source.encode("utf-8"))
    shutil.copyfile(SOURCE, RENDERER)

    pngs = {}
    for size in SIZES:
        path = icons / f"{size}x{size}.png"
        subprocess.run(
            ["inkscape", str(icon_svg), "--export-type=png", f"--export-width={size}",
             f"--export-height={size}", f"--export-filename={path}"],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        pngs[size] = path.read_bytes()
    (BUILD / "icon.png").write_bytes(pngs[1024])

    ico_sizes = (16, 20, 24, 32, 40, 48, 64, 128, 256)
    offset = 6 + 16 * len(ico_sizes)
    entries = []
    for size in ico_sizes:
        data = pngs[size]
        entries.append(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0,
                                   1, 32, len(data), offset))
        offset += len(data)
    (BUILD / "icon.ico").write_bytes(
        struct.pack("<HHH", 0, 1, len(ico_sizes))
        + b"".join(entries)
        + b"".join(pngs[size] for size in ico_sizes)
    )

    icns_types = {
        b"icp4": 16, b"icp5": 32, b"icp6": 64, b"ic07": 128,
        b"ic08": 256, b"ic09": 512, b"ic10": 1024,
        b"ic11": 32, b"ic12": 64, b"ic13": 256, b"ic14": 512,
    }
    body = b"".join(chunk(kind, pngs[size]) for kind, size in icns_types.items())
    (BUILD / "icon.icns").write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


if __name__ == "__main__":
    main()
