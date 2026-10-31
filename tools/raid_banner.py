"""Composes the CERT RAID home banner (public/raid/banner.jpg) from the extracted sprites.
usage: python3 tools/raid_banner.py public/raid"""
import json, sys, random
from PIL import Image, ImageDraw

D = sys.argv[1]
man = json.load(open('src/raid/manifest.json'))
W, H = 1200, 460
random.seed(7)
small = Image.new('RGB', (W // 4, H // 4))
d = ImageDraw.Draw(small)
sky = [(26, 14, 52), (78, 26, 70), (168, 67, 58), (242, 166, 80)]
h4 = H // 4
for y in range(h4):
    t = min(.999, y / (h4 * .72)) * len(sky); i = int(t)
    for x in range(W // 4):
        j = min(len(sky) - 1, i + 1) if t - i > .8 and (x + y) % 2 else i
        small.putpixel((x, y), sky[j])
for _ in range(50): small.putpixel((random.randrange(W // 4), random.randrange(int(h4 * .45))), (255, 255, 255))
d.ellipse((215, 18, 245, 48), fill=(255, 210, 122))
for li, col in enumerate([(90, 42, 58), (58, 28, 44), (36, 18, 30)]):
    base = h4 * (.55 + li * .1); y = base
    for x in range(0, W // 4, 2):
        y = max(base - 18, min(base + 4, y + random.uniform(-1.4, 1.4)))
        d.rectangle((x, int(y), x + 1, h4), fill=col)
gy = int(h4 * .8)
d.rectangle((0, gy, W, h4), fill=(107, 74, 46))
for y in range(gy + 3, h4, 5): d.line((0, y, W, y), fill=(78, 52, 32))
bg = small.resize((W, H), Image.NEAREST)

def frame(name, pose, scale):
    m = man[name]; sh = Image.open(f'{D}/{name}.png').convert('RGBA')
    i = m['poses'].index(pose)
    f = sh.crop((i * m['w'], 0, (i + 1) * m['w'], m['h']))
    return f.resize((int(m['w'] * scale), int(m['h'] * scale)), Image.NEAREST)

def put(img, cx, by):
    bg.alpha_composite(img, (int(cx - img.width / 2), int(by - img.height))) if bg.mode == 'RGBA' else bg.paste(img, (int(cx - img.width / 2), int(by - img.height)), img)

put(frame('voraxia', 'idle1', 1.25), 250, 330)
put(frame('skyreaper', 'idle2', 1.25), 950, 300)
put(frame('gatling', 'attack2', 1.75), 600, 345)
put(frame('rex', 'shoot2', 2.4), 500, 470)
put(frame('nova', 'shoot2', 2.4), 700, 470)
bg.save(f'{D}/banner.jpg', quality=86)
print('ok', bg.size)
