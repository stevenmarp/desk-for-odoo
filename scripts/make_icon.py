from pathlib import Path

from PIL import Image, ImageDraw

S = 1024
BG = (16, 21, 31)
LINE = (42, 52, 70)
GREEN = (34, 197, 94)
AMBER = (245, 183, 76)
MUTED = (154, 166, 184)
WHITE = (230, 235, 243)

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((40, 40, S - 40, S - 40), radius=210, fill=BG)
d.rounded_rectangle((170, 200, S - 170, 700), radius=56, outline=GREEN, width=44)
d.rounded_rectangle((420, 700, S - 420, 800), radius=10, fill=GREEN)
d.rounded_rectangle((330, 790, S - 330, 840), radius=25, fill=GREEN)
rows = [(GREEN, 300), (AMBER, 415), (MUTED, 530)]
for color, y in rows:
    d.ellipse((265, y - 30, 325, y + 30), fill=color)
    d.rounded_rectangle((365, y - 22, S - 275, y + 22), radius=22, fill=WHITE if color == GREEN else LINE)
out = Path(__file__).resolve().parent.parent / "build"
out.mkdir(exist_ok=True)
img.save(out / "icon.png")
img.resize((512, 512), Image.LANCZOS).save(out / "icon-512.png")
img.resize((128, 128), Image.LANCZOS).save(out / "icon-128.png")
print("icon written", out)
