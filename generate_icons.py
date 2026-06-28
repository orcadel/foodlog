"""Generate FoodLog PWA icons (rounded green tile with a plate + fork/knife motif)."""
from PIL import Image, ImageDraw

GREEN = (47, 143, 91)
GREEN_DK = (33, 116, 73)
CREAM = (245, 246, 248)
PLATE = (255, 255, 255)

def rounded_tile(size, radius_frac=0.22, maskable=False):
    """Draw at 4x then downsample for crisp anti-aliased edges."""
    s = size * 4
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # background tile
    pad = int(s * 0.10) if maskable else 0   # maskable needs safe padding
    r = int((s - 2 * pad) * radius_frac)
    # vertical gradient green
    for y in range(pad, s - pad):
        t = (y - pad) / max(1, (s - 2 * pad))
        col = tuple(int(GREEN[i] + (GREEN_DK[i] - GREEN[i]) * t) for i in range(3))
        d.line([(pad, y), (s - pad, y)], fill=col + (255,))
    # round the corners by masking
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([pad, pad, s - pad, s - pad], radius=r, fill=255)
    bg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bg.paste(img, (0, 0), mask)

    d = ImageDraw.Draw(bg)
    cx, cy = s // 2, int(s * 0.52)
    inner = s - 2 * pad
    R = int(inner * 0.205)      # plate radius (reduced)
    rr = int(inner * 0.27)      # placement reference so cutlery stays near the edges
    # plate
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=PLATE + (255,))
    d.ellipse([cx - int(R*0.74), cy - int(R*0.74), cx + int(R*0.74), cy + int(R*0.74)],
              outline=(225, 232, 228, 255), width=max(2, s // 220))
    # fork (left) and knife (right), near-black, flanking the plate
    fw = max(3, int(s * 0.012))
    fork_x = cx - int(rr * 1.55)
    knife_x = cx + int(rr * 1.55)
    top = cy - int(rr * 1.15); bot = cy + int(rr * 1.15)
    g = (22, 24, 28, 255)       # near-black cutlery
    # fork stem + tines
    d.rounded_rectangle([fork_x - fw, cy - int(rr*0.1), fork_x + fw, bot], radius=fw, fill=g)
    for off in (-int(s*0.022), 0, int(s*0.022)):
        d.rounded_rectangle([fork_x + off - max(2,fw//2), top, fork_x + off + max(2,fw//2), cy - int(rr*0.1)],
                            radius=fw//2, fill=g)
    d.rounded_rectangle([fork_x - int(s*0.03), cy - int(rr*0.18), fork_x + int(s*0.03), cy - int(rr*0.02)],
                        radius=fw, fill=g)
    # knife
    d.rounded_rectangle([knife_x - fw, top, knife_x + fw, bot], radius=fw, fill=g)
    d.polygon([(knife_x - int(s*0.028), top), (knife_x + fw, top),
               (knife_x + fw, cy - int(rr*0.1)), (knife_x - int(s*0.028), cy - int(rr*0.1))], fill=g)

    return bg.resize((size, size), Image.LANCZOS)

for size, name in [(180, "icon-180.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
    rounded_tile(size).save(name)
rounded_tile(512, maskable=True).save("icon-512-maskable.png")
print("icons written: 180, 192, 512, 512-maskable")
