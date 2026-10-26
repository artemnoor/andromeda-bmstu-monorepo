"""Export browser/search icons from the existing Andromeda artwork."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

APP = Path(__file__).resolve().parents[1]
PUBLIC = APP / "public"
source = Image.open(PUBLIC / "assets/andromeda-symbol.png").convert("RGBA")
source = source.crop(source.getchannel("A").getbbox())
mark = Image.new("RGBA", source.size, "#ffffff")
mark.putalpha(source.getchannel("A"))


def icon(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), "#111111")
    symbol = mark.copy()
    symbol.thumbnail((round(size * .88), round(size * .88)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(symbol, ((size - symbol.width) // 2, (size - symbol.height) // 2))
    return canvas


for size, name in [
    (96, "favicon-96x96.png"),
    (120, "favicon-120x120.png"),
    (180, "apple-touch-icon.png"),
    (192, "android-chrome-192x192.png"),
    (512, "android-chrome-512x512.png"),
]:
    icon(size).save(PUBLIC / name, optimize=True)
icon(256).save(PUBLIC / "favicon.ico", sizes=[(s, s) for s in (16, 32, 48, 64, 96, 120, 128, 256)])

font_path = next(path for path in [
    Path("C:/Windows/Fonts/arial.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
] if path.exists())
preview = Image.new("RGBA", (1200, 630), "#111111")
draw = ImageDraw.Draw(preview)
draw.rounded_rectangle((42, 42, 1158, 588), radius=30, outline="#363636", width=2)
draw.text((80, 115), "Андромеда", font=ImageFont.truetype(str(font_path), 86), fill="#ffffff")
draw.text((84, 265), "Выбор направления", font=ImageFont.truetype(str(font_path), 36), fill="#dddddd")
draw.text((84, 315), "в МГТУ им. Н. Э. Баумана", font=ImageFont.truetype(str(font_path), 36), fill="#dddddd")
draw.text((84, 487), "Проф-тест · Каталог · Сравнение программ", font=ImageFont.truetype(str(font_path), 26), fill="#8dedf9")
symbol = mark.copy()
symbol.thumbnail((310, 310), Image.Resampling.LANCZOS)
preview.alpha_composite(symbol, (820, (630 - symbol.height) // 2 - 10))
preview.convert("RGB").save(PUBLIC / "social-preview.png", optimize=True)
print("Exported favicon.ico, five PNG icons and social-preview.png")
