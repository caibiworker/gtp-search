"""生成安装包图标：白底 + 六条横线（六线谱）+ 第三线上一个点。"""
from PIL import Image, ImageDraw

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 背景：近白方块，四角留一点圆
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.16), fill=(242, 240, 234, 255))

# 六条线
line_w = int(S * 0.022)
x0, x1 = int(S * 0.16), int(S * 0.84)
top, gap = int(S * 0.34), int(S * 0.062)
for i in range(6):
    y = top + i * gap
    color = (28, 26, 23, 255) if i != 2 else (163, 52, 39, 255)
    d.rectangle([x0, y, x1, y + line_w], fill=color)

# 第三线上的点，代表一个音
cy = top + 2 * gap + line_w // 2
r = int(S * 0.036)
cx = int(S * 0.44)
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(163, 52, 39, 255))

img.save("build/icon.png")
sizes = [16, 24, 32, 48, 64, 128, 256]
frames = [img.resize((s, s), Image.LANCZOS) for s in sizes]
frames[-1].save("build/icon.ico", format="ICO", sizes=[(s, s) for s in sizes])
print("ok")
