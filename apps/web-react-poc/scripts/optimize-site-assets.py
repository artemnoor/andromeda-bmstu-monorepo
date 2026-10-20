"""Encode existing artwork for the React site; leave Vanilla assets untouched."""
from pathlib import Path

from PIL import Image

app = Path(__file__).resolve().parents[1]
source = app.parent / "web" / "assets"
target = app / "public" / "assets"
target.mkdir(parents=True, exist_ok=True)
for name in ("bmstu-glass-campus-clouds", "andromeda-symbol"):
    with Image.open(source / f"{name}.png") as artwork:
        if name == "andromeda-symbol":
            artwork.thumbnail((384, 256), Image.Resampling.LANCZOS)
            artwork.save(target / f"{name}.webp", lossless=True, method=6)
        else:
            artwork.save(target / f"{name}.webp", quality=85, method=6)
    print(f"{name}: {(source / f'{name}.png').stat().st_size} -> {(target / f'{name}.webp').stat().st_size} bytes")
