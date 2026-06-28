"""FoodLog PWA icons — blue tile, white fork+knife angled up-to-the-right (rising-line motif)."""
from PIL import Image, ImageDraw

BLUE_TOP = (37, 99, 235)    # #2563eb
BLUE_BOT = (30, 64, 175)    # #1e40af
WHITE = (255, 255, 255, 255)


def rounded_tile(size, radius_frac=0.22, maskable=False):
    s = size * 4
    pad = int(s * 0.10) if maskable else 0
    r = int((s - 2 * pad) * radius_frac)

    # vertical blue gradient
    grad = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(pad, s - pad):
        t = (y - pad) / max(1, (s - 2 * pad))
        col = tuple(int(BLUE_TOP[i] + (BLUE_BOT[i] - BLUE_TOP[i]) * t) for i in range(3))
        gd.line([(pad, y), (s - pad, y)], fill=col + (255,))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, s - pad, s - pad], radius=r, fill=255)
    tile = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    tile.paste(grad, (0, 0), mask)

    # --- utensils drawn pointing UP, centered, then rotated to point up-right ---
    uten = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(uten)
    cx, cy = s // 2, s // 2
    top = int(s * 0.26)
    bot = int(s * 0.74)
    midY = int(top + 0.34 * (bot - top))   # where tines/blade meet the handle
    fw = max(4, int(s * 0.020))            # stroke half-width-ish
    gap = int(s * 0.095)
    fx, kx = cx - gap, cx + gap

    # Fork: handle + 3 tines + bridge
    d.rounded_rectangle([fx - fw, midY, fx + fw, bot], radius=fw, fill=WHITE)
    for off in (-int(s * 0.034), 0, int(s * 0.034)):
        d.rounded_rectangle([fx + off - max(2, fw // 2), top, fx + off + max(2, fw // 2), midY],
                            radius=fw // 2, fill=WHITE)
    d.rounded_rectangle([fx - int(s * 0.05), midY - fw, fx + int(s * 0.05), midY + fw],
                        radius=fw, fill=WHITE)

    # Knife: handle + blade (point up)
    d.rounded_rectangle([kx - fw, midY, kx + fw, bot], radius=fw, fill=WHITE)
    d.polygon([(kx + fw, top), (kx + fw, midY), (kx - int(s * 0.034), midY)], fill=WHITE)
    d.ellipse([kx + fw - 1, top - 1, kx + fw + 1, top + 1], fill=WHITE)  # round the tip

    # rotate clockwise so the utensils face up-to-the-right (rising-line look)
    uten = uten.rotate(-35, resample=Image.BICUBIC, center=(cx, cy))
    tile.alpha_composite(uten)

    return tile.resize((size, size), Image.LANCZOS)


for size, name in [(180, "icon-180.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    rounded_tile(size).save(name)
rounded_tile(512, maskable=True).save("icon-512-maskable.png")
print("icons written: 180, 192, 512, 512-maskable")
