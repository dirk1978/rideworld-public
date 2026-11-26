# Elizabeth Tower (Big Ben), Westminster, for RideWorld's London open world (2026-11-17).
#   /snap/bin/blender -b --python tools/kit/london/elizabeth_tower.py -- public/models/london/elizabeth_tower.glb [preview.png]
# 96 m. A 12 m square shaft of honey Anston limestone panelled in Gothic tracery, corner buttresses, the clock stage
# (four 7 m dials: white opal glass in iron tracery, a dark chapter ring with gilt Roman numerals, gilt square
# surrounds), the belfry with tall arched openings, gilt corner pinnacles, then the iron roof stages in blue-grey with
# gilt ribs, the Ayrton light lantern and the gilt finial. Origin = the centre of the base, ground level; faces N/S/E/W.
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lk
import numpy as np

A = lk.args(); OUT = A[0] if A else '/tmp/elizabeth_tower.glb'; PNG = A[1] if len(A) > 1 else None
lk.start()

STONE = np.array((0.80, 0.69, 0.50))
def gothic(size=512, panels=4, tiers=2, base=STONE):
    """one 3 m wide x 6 m tall repeat: tall narrow panels with pointed heads, a transom band per tier"""
    img = lk.ashlar(base, size, rows=6, cols=1, mortar=0.95, jitter=0.02)
    pw, th = size / panels, size / tiers
    for t in range(tiers):
        for p in range(panels):
            x0, x1 = int(p * pw + pw * 0.18), int(p * pw + pw * 0.82); y0, y1 = int(t * th + th * 0.12), int(t * th + th * 0.9)
            r = (x1 - x0) / 2; cx = (x0 + x1) / 2
            for y in range(y0, y1):
                if y < y0 + r * 1.3:  # the pointed head
                    k = (y - y0) / (r * 1.3); half = r * math.sqrt(max(0, 1 - (1 - k) ** 2))
                    xs, xe = int(cx - half), int(cx + half)
                else: xs, xe = x0, x1
                img[y, xs:xe] *= 0.62  # the inset panel, in shadow
                img[y, max(0, xs - 5):xs] *= 1.15; img[y, xe:xe + 5] *= 0.85  # its moulding catching the light
            img[y1:y1 + 10, :] *= 0.75; img[y1 - 4:y1, :] *= 1.15  # the transom
    return img

def ring_strokes(img, cx, cy, r_in, r_out, col):
    """Roman numerals I..XII around a ring, drawn as strokes (letters I, V, X in a unit box)"""
    L = {'I': [((0.5, 0), (0.5, 1))], 'V': [((0.15, 1), (0.5, 0)), ((0.5, 0), (0.85, 1))], 'X': [((0.15, 0), (0.85, 1)), ((0.85, 0), (0.15, 1))]}
    names = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
    h = (r_out - r_in) * 0.8; w = h * 0.45; rr = (r_in + r_out) / 2
    for k, nm in enumerate(names):
        a = math.pi / 2 - 2 * math.pi * k / 12
        ox, oy = cx + rr * math.cos(a), cy - rr * math.sin(a)
        rot = -(2 * math.pi * k / 12)  # numerals stand with their feet towards the centre
        tw = w * len(nm) * 0.8
        for j, ch in enumerate(nm):
            for (x0, y0), (x1, y1) in L[ch]:
                for t in np.linspace(0, 1, 40):
                    lx = (j * w * 0.8 + (x0 + (x1 - x0) * t) * w) - tw / 2; ly = ((y0 + (y1 - y0) * t) - 0.5) * h
                    px = ox + lx * math.cos(rot) - ly * math.sin(rot); py = oy + lx * math.sin(rot) + ly * math.cos(rot)
                    yy, xx = int(py), int(px); img[max(0, yy - 3):yy + 3, max(0, xx - 3):xx + 3] = col

def dial(size=1024):
    img = np.ones((size, size, 3), np.float32) * np.array((0.78, 0.62, 0.26))  # gilt, outside the circle
    yy, xx = np.mgrid[0:size, 0:size]; c = size / 2; d = np.hypot(xx - c, yy - c) / c; ang = np.arctan2(yy - c, xx - c)
    glass = d < 0.78
    img[glass] = (0.94, 0.93, 0.86)
    # iron tracery in the glass: rings and radial bars, and a rosette at the middle
    for rr in (0.2, 0.76): img[np.abs(d - rr) < 0.008] = (0.12, 0.12, 0.14)
    bars = (np.abs(((ang + math.pi) / (2 * math.pi) * 60) % 1 - 0.5) > 0.485) & glass & (d > 0.2)
    img[bars] = (0.15, 0.15, 0.17)
    img[(np.abs(((ang + math.pi) / (2 * math.pi) * 24) % 1 - 0.5) > 0.42) & (d < 0.2)] = (0.2, 0.2, 0.22)
    ring = (d >= 0.78) & (d < 0.98)
    img[ring] = (0.07, 0.08, 0.14)  # the dark chapter ring
    img[(d >= 0.97) & (d < 1.0)] = (0.85, 0.7, 0.3)
    img[np.abs(d - 0.78) < 0.006] = (0.85, 0.7, 0.3)
    for k in range(60):  # minute marks
        a = 2 * math.pi * k / 60
        for t in np.linspace(0.935, 0.965, 6):
            x, y = int(c + c * t * math.cos(a)), int(c + c * t * math.sin(a)); img[y - 3:y + 3, x - 3:x + 3] = (0.9, 0.75, 0.32)
    ring_strokes(img, c, c, c * 0.8, c * 0.93, (0.92, 0.78, 0.34))
    # hands at about ten past ten (the classic clock-face time)
    for a, L, wdt in ((math.radians(-60), 0.5, 10), (math.radians(-150), 0.74, 6)):
        for t in np.linspace(0, L, 200):
            x, y = int(c + c * t * math.cos(a)), int(c + c * t * math.sin(a)); img[y - wdt:y + wdt, x - wdt:x + wdt] = (0.08, 0.08, 0.1)
    img[int(c) - 14:int(c) + 14, int(c) - 14:int(c) + 14] = (0.85, 0.7, 0.3)
    return img

def surround(size=512):
    """the square gilt frame round a dial: gilt with darker diaper-work in the corners"""
    img = np.ones((size, size, 3), np.float32) * np.array((0.8, 0.64, 0.27))
    yy, xx = np.mgrid[0:size, 0:size]
    diaper = ((xx + yy) // 24 % 2 == 0) ^ ((xx - yy) // 24 % 2 == 0)
    img[diaper] *= 0.82
    img[:14] = img[-14:] = (0.6, 0.47, 0.2); img[:, :14] = img[:, -14:] = (0.6, 0.47, 0.2)
    return img * (1 + lk.noise(size, size, 0.03))

def roof_iron(size=512):
    """blue-grey iron roofing in scale-shaped plates with gilt ribs at the edges of a repeat"""
    img = np.ones((size, size, 3), np.float32) * np.array((0.2, 0.24, 0.3))
    for r in range(16):
        y = r * size // 16; off = 16 if r % 2 else 0
        for c in range(-1, 17):
            x = c * 32 + off; img[y:y + 2, max(0, x):min(size, x + 32)] *= 0.7
            img[y:y + size // 16, max(0, x):max(0, x) + 2] *= 0.8
    img[:, :10] = img[:, -10:] = (0.78, 0.62, 0.26)
    return img * (1 + lk.noise(size, size, 0.04))

def belfry_face(size=512):
    """one belfry face: three tall pointed openings, dark inside with louvres, framed in stone"""
    img = lk.ashlar(STONE, size, rows=10, cols=2, mortar=0.9, jitter=0.03)
    for k in range(3):
        x0, x1 = int(size * (0.1 + k * 0.29)), int(size * (0.1 + k * 0.29 + 0.22)); y0, y1 = int(size * 0.12), int(size * 0.92)
        r = (x1 - x0) / 2; cx = (x0 + x1) / 2
        for y in range(y0, y1):
            if y < y0 + r * 1.4: k2 = (y - y0) / (r * 1.4); half = r * math.sqrt(max(0, 1 - (1 - k2) ** 2)); xs, xe = int(cx - half), int(cx + half)
            else: xs, xe = x0, x1
            img[y, xs:xe] = (0.1, 0.09, 0.08) if (y // 10) % 2 else (0.2, 0.17, 0.14)  # louvres
            img[y, max(0, xs - 6):xs] = STONE * 1.1; img[y, xe:xe + 6] = STONE * 1.1
    return img

STONEM = lk.mat('Stone', img=lk.image('gothic', gothic()), rough=0.85, glow=0.25)
PLAIN = lk.mat('StonePlain', img=lk.image('ashlar', lk.ashlar(STONE * 0.96, rows=8)), rough=0.85, glow=0.25)
GILT = lk.mat('Gilt', (0.83, 0.66, 0.26), rough=0.35, metal=0.7, glow=0.35)
DIAL = lk.mat('Dial', img=lk.image('dial', dial()), rough=0.4, glow=0.45)
SURR = lk.mat('Surround', img=lk.image('surround', surround()), rough=0.4, metal=0.5, glow=0.35)
IRON = lk.mat('IronRoof', img=lk.image('iron', roof_iron()), rough=0.5, metal=0.4, glow=0.25)
BELF = lk.mat('Belfry', img=lk.image('belfry', belfry_face()), rough=0.85, glow=0.25)
DARK = lk.mat('Dark', (0.08, 0.08, 0.09), glow=0.05)

S = 12.0
# plinth and shaft
lk.box('Plinth', 0, 0, 0, S + 1.0, S + 1.0, 3.0, PLAIN, uv=3)
lk.box('Shaft', 0, 0, 3.0, S, S, 48.0, STONEM, uv=3, uvz=6)
for sx in (-1, 1):
    for sy in (-1, 1):  # corner buttresses, stepping in near the top
        lk.box('Buttress', sx * (S / 2 - 0.3), sy * (S / 2 - 0.3), 0, 1.5, 1.5, 50.0, PLAIN, uv=1.5)
        lk.box('ButtressCap', sx * (S / 2 - 0.3), sy * (S / 2 - 0.3), 50.0, 1.2, 1.2, 2.0, PLAIN, uv=1.5)
lk.box('Cornice1', 0, 0, 51.0, S + 0.8, S + 0.8, 0.9, PLAIN, uv=1.5)
# the clock stage: slightly wider, a dial in a gilt square on each face
C = 13.4
lk.box('ClockStage', 0, 0, 51.9, C, C, 10.6, PLAIN, uv=3)
ZC = 57.2
for nx, ny in ((0, 1), (0, -1), (1, 0), (-1, 0)):
    off = C / 2 + 0.06
    cx, cy = nx * off, ny * off
    # the gilt square: a quad in the face plane
    h = 4.3; tx, ty = -ny, nx  # along the face
    pts = [(cx - tx * h, cy - ty * h, ZC - h), (cx + tx * h, cy + ty * h, ZC - h), (cx + tx * h, cy + ty * h, ZC + h), (cx - tx * h, cy - ty * h, ZC + h)]
    lk.quad('Surround', pts, SURR)
    lk.disc('Dial', (nx * (off + 0.05), ny * (off + 0.05), ZC), (nx, ny, 0), 3.95, DIAL)
lk.box('Cornice2', 0, 0, 62.5, C + 0.9, C + 0.9, 0.8, PLAIN, uv=1.5)
# gabled parapet: a small gable over each dial
for k in range(4):
    a = k * math.pi / 2; nx, ny = round(math.cos(a)), round(math.sin(a))
    o = lk.taper('Gable', [(nx * (C / 2) + ny * 3.2, ny * (C / 2) - nx * 3.2), (nx * (C / 2) - ny * 3.2, ny * (C / 2) + nx * 3.2), (nx * (C / 2 - 1) - ny * 3.2, ny * (C / 2 - 1) + nx * 3.2), (nx * (C / 2 - 1) + ny * 3.2, ny * (C / 2 - 1) - nx * 3.2)], 63.3,
                 [(nx * (C / 2 - 0.5), ny * (C / 2 - 0.5))], 66.3, PLAIN, uv=1.5, cap=False)
# corner pinnacles on the clock stage, gilt tipped
for sx in (-1, 1):
    for sy in (-1, 1):
        x, y = sx * (C / 2 - 0.4), sy * (C / 2 - 0.4)
        lk.box('Pinnacle', x, y, 63.3, 1.1, 1.1, 3.2, PLAIN, uv=1)
        lk.taper('PinnacleSpire', lk.rect(x, y, 1.1, 1.1), 66.5, [(x, y)], 70.5, GILT, uv=1, cap=False)
# the belfry: tall arched openings on every face
B = 11.0
for k in range(4):
    a = k * math.pi / 2; nx, ny = round(math.cos(a)), round(math.sin(a)); tx, ty = -ny, nx
    cx, cy = nx * B / 2, ny * B / 2
    lk.quad('BelfryFace', [(cx - tx * B / 2, cy - ty * B / 2, 63.3), (cx + tx * B / 2, cy + ty * B / 2, 63.3), (cx + tx * B / 2, cy + ty * B / 2, 72.0), (cx - tx * B / 2, cy - ty * B / 2, 72.0)], BELF)
lk.box('BelfryCore', 0, 0, 63.3, B - 0.1, B - 0.1, 8.7, DARK)
lk.box('Cornice3', 0, 0, 72.0, B + 1.0, B + 1.0, 0.8, PLAIN, uv=1.5)
# iron roof stages: a steep hipped roof, the Ayrton light lantern, the spire and the finial
lk.taper('Roof1', lk.rect(0, 0, B + 0.6, B + 0.6), 72.8, lk.rect(0, 0, 6.4, 6.4), 79.5, IRON, uv=3)
for sx in (-1, 1):
    for sy in (-1, 1):
        x, y = sx * (B / 2 + 0.1), sy * (B / 2 + 0.1)
        lk.taper('RoofPinnacle', lk.rect(x, y, 0.8, 0.8), 72.8, [(x, y)], 77.5, GILT, uv=1, cap=False)
lk.box('Lantern', 0, 0, 79.5, 6.0, 6.0, 3.4, lk.mat('Lantern', img=lk.image('lantern', lk.windows((0.2, 0.24, 0.3), glass=(0.95, 0.85, 0.55), nx=3, ny=1, w=0.55, h=0.75, arched=True)), glow=0.5), uv=6, uvz=3.4)
lk.box('LanternCornice', 0, 0, 82.9, 6.8, 6.8, 0.5, GILT, uv=1)
lk.taper('Spire', lk.rect(0, 0, 6.2, 6.2), 83.4, lk.rect(0, 0, 1.6, 1.6), 92.0, IRON, uv=3)
lk.cyl('Finial', 0, 0, 92.0, 0.5, 2.6, GILT, seg=12, r2=0.15)
lk.cyl('Orb', 0, 0, 94.6, 0.35, 0.6, GILT, seg=12)
lk.cyl('Cross', 0, 0, 95.2, 0.08, 0.9, GILT, seg=6)

lk.export(OUT, 'ElizabethTower')
if PNG: lk.preview(PNG, (55, -70, 40), (0, 0, 55), lens=40)
