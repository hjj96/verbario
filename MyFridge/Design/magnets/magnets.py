"""The magnet collection: every magnet is a flat 3D object made of a silhouette (extruded
into a side), face layers, a bevel and gloss spots."""
import math
from geo import *

def solid(c, a=1.0):
    return {"type": "solid", "stops": [[0, c, a]]}

def lin(x1, y1, x2, y2, *stops):
    return {"type": "linear", "from": [x1, y1], "to": [x2, y2], "stops": [list(s) if len(s) == 3 else [s[0], s[1], 1.0] for s in stops]}

def rad(cx, cy, r, *stops):
    return {"type": "radial", "center": [cx, cy], "radius": r, "stops": [list(s) if len(s) == 3 else [s[0], s[1], 1.0] for s in stops]}

SETS = [
    ("garden", "Сад", "Ягоды и фрукты из летнего сада"),
    ("flowers", "Цветы", "Букет, который не вянет"),
    ("sea", "Море", "Привезено с побережья"),
    ("sky", "Небо", "Солнце, облака и звёзды"),
    ("home", "Дом", "Маленькие вещи, которые греют"),
    ("sweets", "Сладкое", "Десерт без сахара"),
    ("travel", "Поездки", "Сувениры из дорог"),
]

MAGNETS = []

class Magnet:
    def __init__(self, id, title, set, material, thickness=6.0, size=1.0, note=""):
        self.id, self.title, self.set, self.material = id, title, set, material
        self.thickness, self.size, self.note = thickness, size, note
        self.layers, self.sides, self.gloss = [], [], []
        self.outline = None
        MAGNETS.append(self)

    def layer(self, g, fill):
        self.layers.append((g, fill)); return self

    def side(self, g, color):
        self.sides.append((g, color)); return self

    def spot(self, cx, cy, rx, ry, rot=-30):
        self.gloss.append((cx, cy, rx, ry, rot)); return self


# ---------------------------------------------------------------- Сад
def strawberry():
    m = Magnet("strawberry", "Клубника", "garden", "glossy", 6, note="Глазурованная керамика")
    berry = S([(50, 33), (70, 31), (84, 40), (85, 56), (76, 74), (62, 89), (50, 94), (38, 89), (24, 74), (15, 56), (16, 40), (30, 31)])
    sep = []
    for ang, ln in [(-66, 19), (-33, 17), (0, 14), (33, 17), (66, 19)]:
        a = math.radians(90 + ang)
        tip = (50 + ln * math.cos(a) * 1.25, 31 + ln * math.sin(a))
        sep.append(leaf((50, 29), tip, 10))
    sepals = U(sep, C(50, 30, 6))
    stem = L([(50, 30), (51, 22), (55, 15)], 4.2, smooth=True)
    green = U(sepals, stem)
    m.outline = U(berry, green)
    m.side(berry, "#8C1328").side(green, "#2F5E1E")
    m.layer(berry, rad(38, 44, 58, (0, "#FF7A7F"), (0.5, "#E8293F"), (1, "#A3122A")))
    pts = []
    for row in range(7):
        y = 44 + row * 7.2
        off = 3.6 if row % 2 else 0
        for x in range(12, 92, 9):
            pts.append((x + off, y))
    seeds_pts = [p for p in pts if berry.buffer(-3).contains(Point(p))]
    dimples = U([E(x + 0.4, y + 0.8, 2.1, 2.8, (x - 50) * 0.5) for x, y in seeds_pts])
    seeds = U([E(x, y, 1.25, 2.0, (x - 50) * 0.5) for x, y in seeds_pts])
    m.layer(dimples, solid("#9E1027", 0.55)).layer(seeds, lin(40, 40, 60, 90, (0, "#FFF2C2"), (1, "#F2C766")))
    m.layer(green, lin(40, 14, 60, 46, (0, "#A6DB72"), (1, "#3F8F2F")))
    m.layer(U([L([(50, 30), polar(50, 31, 9, 90 + a)], 0.9) for a in (-62, -30, 0, 30, 62)]), solid("#2F6E22", 0.45))
    m.spot(34, 48, 13, 8).spot(56, 24, 5, 2.5)

def lemon():
    m = Magnet("lemon", "Долька лимона", "garden", "glossy", 5, note="Эмаль")
    cx, cy = 50, 50
    rind = C(cx, cy, 42)
    m.outline = rind
    m.side(rind, "#C48C00")
    m.layer(rind, lin(14, 10, 86, 92, (0, "#FFE76A"), (1, "#F0B400")))
    m.layer(C(cx, cy, 38.2), lin(20, 20, 80, 80, (0, "#FFFBE6"), (1, "#FBEFC0")))
    segs = []
    for i in range(9):
        a0 = i * 40 + 3.2; a1 = (i + 1) * 40 - 3.2
        segs.append(rounded(ring_sector(cx, cy, 5.5, 34.5, a0, a1), 1.6))
    segs = U(segs)
    m.layer(segs, rad(cx, cy, 36, (0, "#FFF6B8"), (0.6, "#FFE04A"), (1, "#F7C51E")))
    pts, _ = scatter(segs, 60, 0.9, 7, min_dist=3.2)
    m.layer(U([E(x, y, 0.7, 1.6, math.degrees(math.atan2(y - cy, x - cx)) + 90) for x, y in pts]), solid("#FFFDE8", 0.75))
    m.layer(C(cx, cy, 3.2), solid("#FFF9DA"))
    m.spot(32, 28, 16, 8)

def orange():
    m = Magnet("orange", "Апельсин", "garden", "ceramic", 6, note="Расписная керамика")
    fruit = C(50, 57, 35)
    lf = leaf((54, 22), (86, 10), 14, bend=-0.08)
    stem = R(47.5, 17, 5, 9, 2)
    green = U(lf, stem)
    m.outline = U(fruit, green)
    m.side(fruit, "#B0500C").side(green, "#2F5E1E")
    m.layer(fruit, rad(40, 44, 52, (0, "#FFCB73"), (0.55, "#FF8F1F"), (1, "#D45F0A")))
    pts, _ = scatter(fruit, 70, 0.7, 11, min_dist=4)
    m.layer(U([C(x, y, 0.65) for x, y in pts]), solid("#FFD9A0", 0.45))
    m.layer(star(50, 24, 3.2, 1.4, 5), solid("#8A5A12", 0.6))
    m.layer(lf, lin(56, 24, 86, 8, (0, "#4F9A35"), (1, "#9CD46E")))
    m.layer(L([(55, 21.5), (70, 15.5), (84, 10.5)], 1.1, smooth=True), solid("#2F6E22", 0.55))
    m.layer(stem, solid("#6B8E23"))
    m.spot(36, 44, 14, 9)

def cherries():
    m = Magnet("cherries", "Вишня", "garden", "glossy", 6, note="Эмаль")
    c1, c2 = C(33, 72, 17), C(66, 74, 17)
    s1 = L(bez((35, 56), (37, 40), (47, 26), (58, 15)), 3.2)
    s2 = L(bez((64, 58), (64, 42), (61, 28), (58, 15)), 3.2)
    lf = leaf((58, 15), (88, 9), 12, bend=0.1)
    knot = C(58, 15, 3)
    green = U(s1, s2, lf, knot)
    m.outline = U(c1, c2, green)
    m.side(green, "#2F5E1E").side(U(c1, c2), "#6A0815")
    m.layer(U(s1, s2, knot), lin(50, 10, 60, 60, (0, "#8DB255"), (1, "#4E7A23")))
    m.layer(lf, lin(58, 15, 88, 8, (0, "#4F9A35"), (1, "#A2D873")))
    m.layer(L([(59, 14.5), (74, 12.5), (86, 9.5)], 1.0, smooth=True), solid("#2F6E22", 0.5))
    m.layer(c1, rad(27, 65, 22, (0, "#FF6B78"), (0.55, "#D3142F"), (1, "#7E0A1C")))
    m.layer(c2, rad(60, 67, 22, (0, "#FF6B78"), (0.55, "#D3142F"), (1, "#7E0A1C")))
    m.layer(U(E(35, 57, 2.2, 1.2), E(65, 59, 2.2, 1.2)), solid("#5A0612", 0.6))
    m.spot(26, 65, 6.5, 4).spot(59, 67, 6.5, 4)

def watermelon():
    m = Magnet("watermelon", "Арбуз", "garden", "glossy", 5, size=1.1, note="Эмаль")
    cx, cy = 50, 28
    def half(r):
        return rounded(ring_sector(cx, cy, 0, r, 0, 180, 80), 1.2)
    rind = half(46)
    m.outline = rind
    m.side(rind, "#2C6626")
    m.layer(rind, lin(10, 30, 90, 75, (0, "#7CC95A"), (1, "#2E7D32")))
    m.layer(half(42), solid("#F4F8E4"))
    flesh = half(38.5)
    m.layer(flesh, rad(50, 28, 42, (0, "#FF8A95"), (0.7, "#F0445A"), (1, "#D92E47")))
    seeds = []
    for r, angs in [(16, (55, 90, 125)), (27, (30, 60, 90, 120, 150))]:
        for a in angs:
            x, y = polar(cx, cy, r, a)
            seeds.append(E(x, y, 1.6, 3.0, a - 90 + 90))
    m.layer(U(seeds), solid("#2A1A16"))
    m.layer(U([E(x - 0.5, y - 1, 0.5, 1, 0) for x, y in [polar(cx, cy, r, a) for r, angs in [(16, (55, 90, 125)), (27, (30, 60, 90, 120, 150))] for a in angs]]), solid("#FFFFFF", 0.7))
    m.layer(R(6, 28, 88, 2.2), solid("#FFFFFF", 0.35))
    m.spot(34, 40, 16, 6, -10)

# ---------------------------------------------------------------- Цветы
def daisy():
    m = Magnet("daisy", "Ромашка", "flowers", "ceramic", 5, note="Фарфор")
    petals = [E(*polar(50, 50, 25, a), 7.2, 17, a + 90) for a in range(0, 360, 30)]
    pet = U(petals)
    center = C(50, 50, 13.5)
    m.outline = U(pet, center)
    m.side(pet, "#C8BFAE").side(center, "#A15F00")
    m.layer(pet, lin(15, 10, 85, 90, (0, "#FFFFFF"), (1, "#E7E1D5")))
    m.layer(U([L([polar(50, 50, 16, a), polar(50, 50, 36, a)], 0.8) for a in range(0, 360, 30)]), solid("#CFC6B5", 0.55))
    m.layer(center, rad(45, 45, 16, (0, "#FFE27A"), (0.6, "#F7B500"), (1, "#C77800")))
    pts = []
    for k in range(1, 60):
        r = 1.65 * math.sqrt(k); a = k * 137.5
        if r < 11.5:
            pts.append(polar(50, 50, r, a))
    m.layer(U([C(x, y, 0.75) for x, y in pts]), solid("#A35F00", 0.45))
    m.spot(40, 40, 7, 4).spot(30, 24, 6, 3)

def tulip():
    m = Magnet("tulip", "Тюльпан", "flowers", "glossy", 5, note="Эмаль")
    head = S([(30, 16), (40, 30), (50, 10), (60, 30), (70, 16), (73, 38), (65, 55), (50, 60), (35, 55), (27, 38)], 16)
    stem = L([(50, 56), (50.5, 75), (50, 95)], 4.4, smooth=True)
    l1 = leaf((49, 93), (26, 60), 13, bend=0.06)
    l2 = leaf((51, 93), (70, 70), 10, bend=-0.06)
    green = U(stem, l1, l2)
    m.outline = U(head, green)
    m.side(green, "#2F5E1E").side(head, "#9A1535")
    m.layer(green, lin(30, 60, 70, 95, (0, "#9CD46E"), (1, "#3F8A2B")))
    m.layer(U(L([(48, 92), (38, 77), (29, 63)], 1.0, smooth=True), L([(52, 92), (61, 81), (68, 72)], 0.9, smooth=True)), solid("#2F6E22", 0.45))
    m.layer(head, lin(50, 10, 50, 60, (0, "#FF9AB5"), (0.6, "#F04470"), (1, "#C91F4B")))
    m.layer(U(L([(40, 30), (42, 42), (45, 54)], 1.2, smooth=True), L([(60, 30), (58, 42), (55, 54)], 1.2, smooth=True)), solid("#A3173E", 0.5))
    m.spot(37, 30, 7, 10, -20)

def sakura():
    m = Magnet("sakura", "Сакура", "flowers", "glossy", 5, note="Эмаль")
    ps = []
    for i in range(5):
        a = -90 + i * 72
        px, py = polar(50, 50, 21, a)
        p = E(px, py, 14, 18, a + 90)
        nx, ny = polar(50, 50, 40, a)
        notch = rot(P([(0, -5), (6, 0), (0, 5), (-6, 0)]), 0, (0, 0))
        notch = move(rot(notch, a, (0, 0)), nx, ny)
        ps.append(D(p, notch))
    pet = U(ps)
    m.outline = pet
    m.side(pet, "#B45478")
    m.layer(pet, rad(50, 50, 44, (0, "#FFFFFF"), (0.35, "#FFE0EA"), (1, "#F48FB1")))
    m.layer(U([L([polar(50, 50, 4, -90 + i * 72 + 36), polar(50, 50, 30, -90 + i * 72 + 36)], 0.7) for i in range(5)]), solid("#E77FA3", 0.4))
    stam = U([L([polar(50, 50, 3, a), polar(50, 50, 13, a)], 0.9) for a in range(0, 360, 36)])
    m.layer(C(50, 50, 6), solid("#F06292")).layer(stam, solid("#C2185B", 0.8))
    m.layer(U([C(*polar(50, 50, 13.5, a), 1.6) for a in range(0, 360, 36)]), solid("#FFD54F"))
    m.spot(36, 30, 9, 5).spot(26, 52, 5, 3)

def sunflower():
    m = Magnet("sunflower", "Подсолнух", "flowers", "ceramic", 5, note="Керамика")
    pet = U([leaf(polar(50, 50, 14, a), polar(50, 50, 46, a), 12) for a in range(0, 360, 360 // 16)])
    pet2 = U([leaf(polar(50, 50, 14, a), polar(50, 50, 40, a), 11) for a in range(11, 371, 360 // 16)])
    center = C(50, 50, 20)
    m.outline = U(pet, pet2, center)
    m.side(U(pet, pet2), "#B97300").side(center, "#2A1A0E")
    m.layer(pet2, lin(10, 10, 90, 90, (0, "#F5B700"), (1, "#E08A00")))
    m.layer(pet, lin(10, 10, 90, 90, (0, "#FFE066"), (1, "#F5A300")))
    m.layer(center, rad(45, 45, 22, (0, "#8B5E34"), (0.6, "#5A3A1E"), (1, "#3A2412")))
    pts = []
    for k in range(1, 140):
        r = 1.55 * math.sqrt(k); a = k * 137.5
        if r < 17.5:
            pts.append(polar(50, 50, r, a))
    m.layer(U([C(x, y, 0.8) for x, y in pts]), solid("#C08A4E", 0.6))
    m.spot(38, 36, 8, 5).spot(24, 22, 6, 3)

# ---------------------------------------------------------------- Море
def shell():
    m = Magnet("shell", "Ракушка", "sea", "ceramic", 5, note="Перламутровая керамика")
    hx, hy = 50, 84
    fan = ring_sector(hx, hy, 0, 38, 200, 340, 64)
    bumps = [C(*polar(hx, hy, 37, a), 6.2) for a in range(203, 340, 14)]
    ears = R(32, 76, 36, 12, 4)
    body = soft(U(fan, bumps, ears), 1.5)
    m.outline = body
    m.side(body, "#B0634A")
    m.layer(body, rad(50, 66, 50, (0, "#FFF0E3"), (0.5, "#FFC6A3"), (1, "#EE8D6C")))
    ribs = U([I(L([(hx, hy), polar(hx, hy, 46, a)], 2.4), body.buffer(-1.5)) for a in range(210, 336, 14)])
    m.layer(ribs, solid("#E07F60", 0.45))
    m.layer(U([I(L([(hx, hy - 1), polar(hx, hy - 1, 46, a)], 0.9), body.buffer(-2)) for a in range(210, 336, 14)]), solid("#FFF6EE", 0.7))
    m.layer(ears, lin(30, 76, 70, 90, (0, "#FFC2A1"), (1, "#E8876A")))
    m.spot(38, 40, 13, 7)

def fish():
    m = Magnet("fish", "Рыбка", "sea", "glossy", 6, note="Эмаль")
    body = S([(24, 50), (34, 36), (54, 30), (74, 37), (87, 50), (74, 63), (54, 70), (34, 64)], 16)
    tail = S([(30, 50), (10, 32), (15, 50), (10, 68)], 12)
    fin = S([(44, 33), (56, 18), (66, 34)], 10)
    shape = soft(U(body, tail, fin), 1.2)
    m.outline = shape
    m.side(shape, "#14478C")
    m.layer(U(tail, fin), lin(10, 20, 40, 70, (0, "#5FB4FF"), (1, "#1D5FC4")))
    m.layer(body, lin(50, 30, 50, 70, (0, "#7CCBFF"), (0.55, "#2F86E8"), (1, "#1B5DC0")))
    m.layer(I(body, E(56, 66, 30, 9)), solid("#CDEBFF", 0.75))
    bands = U(I(body, L([(46, 30), (42, 50), (46, 70)], 5.5, smooth=True)), I(body, L([(64, 32), (61, 50), (64, 68)], 4.5, smooth=True)))
    m.layer(bands, solid("#FFFFFF", 0.92))
    m.layer(C(74, 46, 4.6), solid("#FFFFFF")).layer(C(75, 46, 2.5), solid("#1B2A55"))
    m.layer(L([(81, 54), (84, 53)], 1.2), solid("#123E7A", 0.8))
    m.spot(50, 38, 14, 5, -8)

def starfish():
    m = Magnet("starfish", "Морская звезда", "sea", "ceramic", 6, note="Керамика")
    st = star(50, 52, 47, 21, 5).buffer(-5).buffer(7.5)
    m.outline = st
    m.side(st, "#A5440E")
    m.layer(st, lin(10, 8, 90, 96, (0, "#FFC07A"), (0.6, "#F57E2C"), (1, "#D85A14")))
    arms = U([L([(50, 52), polar(50, 52, 36, -90 + i * 72)], 1.3) for i in range(5)])
    m.layer(arms, solid("#C9530F", 0.35))
    dots = []
    for i in range(5):
        a = -90 + i * 72
        for d in (11, 18, 25, 31):
            for side in (-1, 1):
                x, y = polar(50, 52, d, a)
                ox, oy = polar(0, 0, 3.2 * (1 - d / 48), a + 90 * side)
                dots.append(C(x + ox, y + oy, 1.35 * (1 - d / 60)))
    m.layer(U(dots), solid("#FFE3C4", 0.9))
    m.layer(C(50, 52, 2.2), solid("#FFE3C4", 0.9))
    m.spot(40, 32, 7, 4).spot(24, 46, 6, 3)

def sailboat():
    m = Magnet("sailboat", "Кораблик", "sea", "glossy", 5, note="Эмаль")
    hull = rounded(P([(16, 64), (84, 64), (72, 82), (28, 82)]), 2)
    mast = R(48.6, 9, 2.8, 58, 1.4)
    main = rounded(P([(50.5, 13), (50.5, 61), (82, 61)]), 1.2)
    jib = rounded(P([(49.5, 20), (49.5, 61), (22, 61)]), 1.2)
    flag = rounded(P([(49.5, 9), (63, 12.5), (49.5, 16)]), 0.6)
    wave = S([(10, 84), (22, 79), (36, 84), (50, 79), (64, 84), (78, 79), (90, 84), (90, 92), (10, 92)], 10)
    shape = U(hull, mast, main, jib, flag, wave)
    m.outline = shape
    m.side(U(main, jib), "#A9B4C2").side(U(hull, mast), "#121C38").side(flag, "#9E1F2B").side(wave, "#174F9C")
    m.layer(mast, solid("#7A5A3C"))
    m.layer(main, lin(53, 15, 82, 60, (0, "#FFFFFF"), (1, "#DCE4EE"))).layer(jib, lin(22, 22, 47, 60, (0, "#FFFFFF"), (1, "#DCE4EE")))
    m.layer(U(I(main, L([(53, 38), (70, 50)], 0.8)), I(jib, L([(47, 42), (34, 52)], 0.8))), solid("#B9C6D6", 0.8))
    m.layer(flag, solid("#E63946"))
    m.layer(hull, lin(50, 64, 50, 80, (0, "#3C5596"), (1, "#1B2A55")))
    m.layer(I(hull, R(0, 67, 100, 3.4)), solid("#E63946"))
    m.layer(wave, lin(50, 79, 50, 92, (0, "#7CCBFF"), (1, "#2A7DE1")))
    m.layer(L([(12, 84.5), (22, 80), (36, 84.5), (50, 80), (64, 84.5), (78, 80), (88, 84.5)], 1.4, smooth=True), solid("#FFFFFF", 0.85))
    m.spot(62, 30, 6, 10, -20).spot(32, 44, 4, 7, -30)

# ---------------------------------------------------------------- Небо
def sun():
    m = Magnet("sun", "Солнышко", "sky", "glossy", 6, note="Эмаль")
    rays = rounded(star(50, 50, 47, 31, 12, -90), 1.8)
    core = C(50, 50, 27)
    m.outline = U(rays, core)
    m.side(m.outline, "#B76A00")
    m.layer(rays, lin(10, 10, 90, 90, (0, "#FFD34D"), (1, "#F59000")))
    m.layer(core, rad(42, 40, 32, (0, "#FFF7C2"), (0.5, "#FFD84A"), (1, "#F5A800")))
    m.layer(U(L(bez((38, 46), (40, 42), (44, 42), (46, 46)), 1.8), L(bez((54, 46), (56, 42), (60, 42), (62, 46)), 1.8)), solid("#8A4B08"))
    m.layer(L(bez((41, 56), (45, 62), (55, 62), (59, 56)), 2.0), solid("#8A4B08"))
    m.layer(U(E(35, 54, 4.2, 2.6), E(65, 54, 4.2, 2.6)), solid("#FF7F5C", 0.45))
    m.spot(40, 34, 11, 6)

def moon():
    m = Magnet("moon", "Месяц", "sky", "ceramic", 6, note="Керамика")
    cres = rounded(D(C(46, 52, 38), C(64, 40, 31)), 1.2)
    m.outline = cres
    m.side(cres, "#B08A1E")
    m.layer(cres, rad(30, 46, 50, (0, "#FFF9D2"), (0.55, "#F9DE75"), (1, "#E3B23C")))
    cr = [(24, 56, 4.5), (36, 74, 3.2), (20, 40, 2.5), (48, 84, 2.4)]
    m.layer(U([C(x, y, r) for x, y, r in cr]), solid("#E2B848", 0.55))
    m.layer(U([D(C(x, y, r), C(x + 0.9, y + 0.9, r)) for x, y, r in cr]), solid("#B88F22", 0.35))
    m.layer(L(bez((30, 60), (33, 63), (37, 63), (40, 60)), 1.4), solid("#9A7414", 0.7))
    m.spot(26, 34, 6, 10, -10)

def cloud():
    m = Magnet("cloud", "Облако", "sky", "ceramic", 6, size=1.05, note="Матовая керамика")
    cl = soft(U(C(28, 58, 14), C(46, 44, 19), C(66, 46, 16), C(80, 58, 11), R(16, 52, 72, 18, 9)), 3)
    m.outline = cl
    m.side(cl, "#9AAAC0")
    m.layer(cl, lin(50, 25, 50, 72, (0, "#FFFFFF"), (1, "#E1E9F3")))
    m.layer(I(cl, E(52, 74, 46, 9)), solid("#C7D4E5", 0.6))
    m.layer(U(C(40, 56, 1.8), C(58, 56, 1.8)), solid("#4A5A75"))
    m.layer(L(bez((45, 60), (47, 63), (51, 63), (53, 60)), 1.4), solid("#4A5A75"))
    m.layer(U(E(35, 61, 3.4, 2), E(63, 61, 3.4, 2)), solid("#FF9AA2", 0.5))
    m.spot(40, 34, 12, 5, -8)

def rainbow():
    m = Magnet("rainbow", "Радуга", "sky", "glossy", 5, size=1.15, note="Эмаль")
    cx, cy = 50, 72
    cols = [("#FF6B6B", "#C9353A"), ("#FFA94D", "#C96A12"), ("#FFD43B", "#C29A00"), ("#69DB7C", "#2F8F43"), ("#4DABF7", "#1B6CB0")]
    bands = []
    for i, (c, s) in enumerate(cols):
        r1 = 44 - i * 6; r0 = r1 - 6
        bands.append((ring_sector(cx, cy, r0, r1, 180, 360, 80), c, s))
    clouds = [soft(U(C(x - 7, 72, 7), C(x + 1, 68, 9), C(x + 9, 73, 6.5), R(x - 13, 70, 26, 9, 4.5)), 2) for x in (13, 87)]
    cl = U(clouds)
    m.outline = soft(U([b for b, _, _ in bands] + [cl]), 0.6)
    for b, c, s in bands:
        m.side(b, s)
    m.side(cl, "#9AAAC0")
    for b, c, s in bands:
        m.layer(b, solid(c))
    m.layer(cl, lin(50, 60, 50, 82, (0, "#FFFFFF"), (1, "#E1E9F3")))
    m.spot(30, 34, 9, 4, -45).spot(52, 28, 9, 3, -5)

def metal_star():
    m = Magnet("star", "Звёздочка", "sky", "metal", 4, size=0.75, note="Полированная сталь")
    cx, cy, Rr, rr = 50, 53, 46, 20
    st = rounded(star(cx, cy, Rr, rr, 5), 1.5)
    m.outline = st
    m.side(st, "#5D6269")
    tips = [polar(cx, cy, Rr, -90 + i * 72) for i in range(5)]
    vals = [polar(cx, cy, rr, -54 + i * 72) for i in range(5)]
    light = math.radians(-135)
    for i in range(5):
        for j, v in enumerate([vals[(i + 4) % 5], vals[i]]):
            t = tips[i]
            mx, my = (t[0] + v[0]) / 2 - cx, (t[1] + v[1]) / 2 - cy
            sh = 0.5 + 0.5 * math.cos(math.atan2(my, mx) - light)
            tone = max(0, min(1, 0.36 + 0.56 * sh + (0.05 if j == 0 else -0.05)))
            g = int(tone * 255)
            m.layer(I(P([(cx, cy), t, v]), st.buffer(0.01)), solid("#%02X%02X%02X" % (g, g, min(255, g + 6))))
    m.spot(36, 34, 7, 3, -35)

# ---------------------------------------------------------------- Дом
def heart():
    m = Magnet("heart", "Сердце", "home", "glossy", 7, note="Глазурованная керамика")
    pts = []
    for k in range(240):
        t = 2 * math.pi * k / 240
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((50 + x * 2.6, 46 - y * 2.6))
    h = P(pts)
    m.outline = h
    m.side(h, "#8C0E27")
    m.layer(h, rad(34, 30, 72, (0, "#FF8796"), (0.5, "#E8304F"), (1, "#A1122E")))
    m.spot(32, 28, 12, 7, -35).spot(66, 22, 6, 3, 20)

def house():
    m = Magnet("house", "Домик", "home", "ceramic", 6, note="Расписная керамика")
    body = R(24, 46, 52, 44, 3)
    roof = rounded(P([(13, 50), (50, 15), (87, 50)]), 2.4)
    chim = R(64, 18, 9, 20, 1.5)
    m.outline = soft(U(body, roof, chim), 0.8)
    m.side(body, "#C6AD85").side(U(roof, chim), "#8A2D1D")
    m.layer(chim, lin(64, 18, 73, 38, (0, "#D9694D"), (1, "#A83F2A")))
    m.layer(body, lin(24, 46, 76, 90, (0, "#FFF8E8"), (1, "#EFDDBA")))
    m.layer(roof, lin(30, 15, 70, 50, (0, "#F57A5C"), (1, "#C8452E")))
    m.layer(U([I(roof.buffer(-1.2), R(0, y, 100, 1.1)) for y in (30, 38, 45)]), solid("#9C3522", 0.5))
    m.layer(I(body, R(0, 87, 100, 3)), solid("#D9C39C", 0.6))
    door = U(R(43.5, 67, 13, 23, 1), C(50, 67, 6.5))
    m.layer(door, lin(44, 60, 56, 90, (0, "#5B7CFA"), (1, "#2F55D4")))
    m.layer(C(53.5, 78, 1.2), solid("#FFD43B"))
    for x in (29, 61):
        w = R(x, 56, 10.5, 10.5, 1.5)
        m.layer(w, solid("#FFFFFF")).layer(R(x + 1.3, 57.3, 7.9, 7.9, 1), lin(x, 56, x + 10, 66, (0, "#D7EEFF"), (1, "#8CC3F2")))
        m.layer(U(R(x + 4.6, 56, 1.3, 10.5), R(x, 60.6, 10.5, 1.3)), solid("#FFFFFF"))
    m.spot(36, 30, 8, 4, -40).spot(34, 52, 6, 3)

def cup():
    m = Magnet("cup", "Чашка кофе", "home", "ceramic", 5, note="Фарфор")
    body = rounded(P([(20, 38), (72, 38), (66, 76), (26, 76)]), 3)
    body = U(body, I(E(46, 74, 21, 6), R(0, 70, 100, 30)), R(30, 74, 32, 9, 3))
    handle = I(D(E(74, 54, 12, 12.5), E(74, 54, 6.2, 7)), R(66, 30, 40, 50))
    saucer = E(46, 82, 36, 6.5)
    steam = U(L([(40, 39), (36, 29), (42, 20), (38, 10)], 3.6, smooth=True), L([(54, 39), (50, 28), (56, 19), (52, 11)], 3.0, smooth=True))
    m.outline = U(body, handle, saucer, steam)
    m.side(steam, "#C9CDD3").side(saucer, "#A89F8D").side(U(body, handle), "#B6AC99")
    m.layer(steam, lin(40, 10, 50, 36, (0, "#FFFFFF", 0.95), (1, "#F2F2F2")))
    m.layer(saucer, lin(10, 76, 82, 88, (0, "#FBF8F2"), (1, "#D9D1C2")))
    m.layer(D(E(46, 82, 36, 6.5), E(46, 81.5, 33, 5)), solid("#2F55D4", 0.85))
    m.layer(U(body, handle), lin(20, 38, 76, 76, (0, "#FFFFFF"), (1, "#E3DCCF")))
    m.layer(I(body, R(0, 52, 100, 7)), solid("#2F55D4"))
    m.layer(U([C(x, 55.5, 1.1) for x in range(27, 70, 6)]), solid("#FFFFFF", 0.9))
    m.layer(E(46, 38.5, 26, 4.6), solid("#F6F1E8"))
    m.layer(E(46, 39.2, 23, 3.4), rad(42, 38, 20, (0, "#9A6A42"), (1, "#5A3418")))
    m.layer(E(41, 38.4, 6, 1.1), solid("#C89A6E", 0.7))
    m.spot(30, 46, 6, 9, -10)

def cactus():
    m = Magnet("cactus", "Кактус", "home", "ceramic", 6, note="Керамика")
    pot = U(rounded(P([(31, 68), (69, 68), (64, 95), (36, 95)]), 2), R(27, 63, 46, 9, 3))
    col = R(41, 20, 18, 50, 9)
    la = U(R(27, 36, 9.5, 22, 4.75), R(27, 49, 18, 9, 4.5))
    ra = U(R(64, 28, 9.5, 24, 4.75), R(55, 43, 18, 9, 4.5))
    plant = soft(U(col, la, ra), 1.5)
    flower = U([C(*polar(50, 19, 3.6, a), 3) for a in range(0, 360, 72)])
    m.outline = soft(U(pot, plant, flower), 0.6)
    m.side(pot, "#8A361C").side(plant, "#285A30").side(flower, "#B5577A")
    m.layer(plant, lin(30, 20, 70, 70, (0, "#8FD47E"), (1, "#3B8A48")))
    ribs = U([I(L([(x, 20), (x, 70)], 1.0), col.buffer(-2)) for x in (46, 50, 54)] + [I(L([(31.7, 34), (31.7, 56)], 0.9), la.buffer(-1.5)), I(L([(68.7, 26), (68.7, 50)], 0.9), ra.buffer(-1.5))])
    m.layer(ribs, solid("#2F6E3B", 0.45))
    pts, _ = scatter(plant, 26, 0.8, 5, min_dist=5)
    m.layer(U([U(R(x - 0.3, y - 1.4, 0.6, 2.8), R(x - 1.4, y - 0.3, 2.8, 0.6)) for x, y in pts]), solid("#FFFFFF", 0.8))
    m.layer(flower, solid("#FF8FAB")).layer(C(50, 19, 2), solid("#FFD43B"))
    m.layer(pot, lin(30, 63, 70, 95, (0, "#F08A5D"), (1, "#C4532E")))
    m.layer(R(27, 63, 46, 9, 3), lin(27, 63, 73, 72, (0, "#F6A07A"), (1, "#D9653C")))
    zig = L([(36, 81), (40, 77), (44, 81), (48, 77), (52, 81), (56, 77), (60, 81), (64, 77)], 1.4)
    m.layer(I(zig, pot), solid("#FFF2E6", 0.85))
    m.spot(46, 32, 4, 9, -5).spot(36, 66, 7, 2, 0)

# ---------------------------------------------------------------- Сладкое
def donut():
    m = Magnet("donut", "Пончик", "sweets", "glossy", 7, note="Глазурованная керамика")
    dough = D(C(50, 50, 42), C(50, 50, 12.5))
    gl = []
    for k in range(360):
        t = math.radians(k)
        r = 35 + 2.6 * math.sin(5 * t + 0.4) + 1.6 * math.sin(9 * t + 1.3) + 1.2 * math.sin(14 * t)
        gl.append((50 + r * math.cos(t), 50 + r * math.sin(t)))
    glaze = D(P(gl), C(50, 50, 15.5))
    m.outline = dough
    m.side(dough, "#8E5726")
    m.layer(dough, rad(50, 50, 44, (0.3, "#F5CF9C"), (0.75, "#D99A5B"), (1, "#B5733A")))
    m.layer(glaze, lin(20, 15, 80, 85, (0, "#FFC2D7"), (0.6, "#F7709E"), (1, "#E0457F")))
    m.layer(D(C(50, 50, 16.5), C(50, 50, 15.5)), solid("#C77C9B", 0.35))
    cols = ["#FFFFFF", "#FFD43B", "#4DABF7", "#69DB7C", "#B197FC", "#FF6B6B"]
    pts, rnd = scatter(glaze.buffer(-2), 34, 1.5, 21, min_dist=5.6)
    groups = {c: [] for c in cols}
    for i, (x, y) in enumerate(pts):
        a = rnd.uniform(0, 180)
        groups[cols[i % len(cols)]].append(rot(R(x - 2.2, y - 0.75, 4.4, 1.5, 0.75), a, (x, y)))
    for c in cols:
        m.layer(U(groups[c]), solid(c))
    m.spot(30, 26, 12, 6, -35).spot(64, 60, 6, 3, -35)

def icecream():
    m = Magnet("icecream", "Мороженое", "sweets", "glossy", 6, note="Эмаль")
    cone = rounded(P([(31, 54), (69, 54), (50, 96)]), 2)
    scoop = S([(26, 54), (23, 42), (30, 29), (44, 21), (59, 22), (71, 31), (77, 44), (75, 55), (67, 60), (60, 57), (54, 64), (47, 57), (39, 61), (31, 59)], 16)
    cherry = C(57, 15, 6.2)
    stem = L(bez((58, 10), (60, 6), (64, 4), (68, 3)), 1.8)
    m.outline = U(cone, scoop, cherry, stem)
    m.side(cone, "#A0661F").side(scoop, "#B94F78").side(U(cherry, stem), "#6E0816")
    m.layer(cone, lin(31, 54, 69, 96, (0, "#F5C982"), (1, "#D48F3B")))
    waffle = U([L([(x, 50), (x + 30, 100)], 1.1) for x in range(0, 80, 7)] + [L([(x, 50), (x - 30, 100)], 1.1) for x in range(20, 110, 7)])
    m.layer(I(waffle, cone.buffer(-0.5)), solid("#B9772F", 0.55))
    m.layer(scoop, lin(30, 20, 70, 62, (0, "#FFE6F0"), (0.6, "#FF9EC4"), (1, "#F27AAA")))
    pts, rnd = scatter(scoop.buffer(-3), 10, 1.2, 4, min_dist=7)
    m.layer(U([rot(R(x - 1.9, y - 0.65, 3.8, 1.3, 0.65), rnd.uniform(0, 180), (x, y)) for x, y in pts]), solid("#FFFFFF", 0.95))
    m.layer(stem, solid("#4E7A23"))
    m.layer(cherry, rad(54, 12, 8, (0, "#FF6B78"), (0.6, "#D3142F"), (1, "#7E0A1C")))
    m.spot(36, 32, 9, 5, -35).spot(55, 12, 2.4, 1.4)

def lollipop():
    m = Magnet("lollipop", "Леденец", "sweets", "glossy", 6, note="Карамель")
    disc = C(50, 40, 32)
    stick = R(47, 66, 6, 30, 3)
    m.outline = U(disc, stick)
    m.side(stick, "#A49C8E").side(disc, "#A82B45")
    m.layer(stick, lin(47, 66, 53, 66, (0, "#FFFFFF"), (1, "#D5CCBC")))
    m.layer(disc, rad(42, 32, 36, (0, "#FFFFFF"), (1, "#FFD7E2")))
    spiral = []
    for k in range(0, 961):
        t = math.radians(k * 1.5)
        r = 1.5 + 28.5 * (k / 960)
        spiral.append((50 + r * math.cos(t), 40 + r * math.sin(t)))
    sp = I(LineString(spiral).buffer(2.4, cap_style='round', quad_segs=8), disc.buffer(-0.5))
    m.layer(sp, lin(20, 10, 80, 72, (0, "#FF7A93"), (1, "#D61F45")))
    m.spot(36, 26, 10, 6, -35)

def macaron():
    m = Magnet("macaron", "Макарон", "sweets", "ceramic", 6, size=0.95, note="Керамика")
    top = rounded(I(E(50, 48, 38, 21), R(10, 10, 80, 37.5)), 3)
    bot = rounded(I(E(50, 52, 38, 19), R(10, 54.5, 80, 30)), 3)
    fill = R(17, 45, 66, 11, 5.5)
    m.outline = U(top, bot, fill)
    m.side(U(top, bot), "#3E9C6E").side(fill, "#C9B99E")
    m.layer(fill, lin(19, 44, 19, 57, (0, "#FFFCF2"), (1, "#EDE2CC")))
    for sh, y0 in ((top, 22), (bot, 54)):
        m.layer(sh, lin(16, y0, 84, y0 + 26, (0, "#C6F5DD"), (1, "#6CCB9C")))
    feet = []
    for y, sh in ((46.5, top), (55, bot)):
        for x in range(14, 86, 3):
            feet.append(I(C(x + 1.5, y, 1.7), sh.buffer(0.8)))
    m.layer(U(feet), solid("#58B886", 0.55))
    m.spot(36, 33, 12, 4, -8).spot(36, 60, 9, 2.5, -4)

# ---------------------------------------------------------------- Поездки
def airplane():
    m = Magnet("airplane", "Самолётик", "travel", "glossy", 5, note="Эмаль")
    fus = R(44, 8, 12, 84, 6)
    wings = rounded(P([(50, 38), (93, 56), (93, 63), (50, 55), (7, 63), (7, 56)]), 2)
    tail = rounded(P([(50, 78), (69, 88), (69, 93), (50, 89), (31, 93), (31, 88)]), 1.5)
    eng = U(R(26, 52, 6, 11, 3), R(68, 52, 6, 11, 3))
    shape = rot(U(fus, wings, tail, eng), 35)
    m.outline = shape
    m.side(shape, "#7D8A9B")
    m.layer(rot(U(wings, tail), 35), lin(10, 30, 90, 80, (0, "#F7F9FC"), (1, "#C6D0DC")))
    m.layer(rot(eng, 35), solid("#9AA5B1"))
    m.layer(rot(fus, 35), lin(40, 10, 60, 90, (0, "#FFFFFF"), (1, "#DCE3EB")))
    m.layer(rot(I(fus, R(0, 22, 100, 54)).intersection(R(48.4, 0, 3.2, 100)), 35), solid("#E63946"))
    m.layer(rot(I(fus, R(0, 8, 100, 7)), 35), solid("#E63946"))
    m.layer(rot(U([C(50, y, 1.1) for y in range(24, 74, 6)]), 35), solid("#2C3E73"))
    m.layer(rot(E(50, 16.5, 3.4, 2.2), 35), solid("#2C3E73"))
    m.spot(*polar(50, 50, 0, 0), 5, 18, 35)

def suitcase():
    m = Magnet("suitcase", "Чемодан", "travel", "ceramic", 6, note="Расписная керамика")
    body = R(14, 32, 72, 54, 8)
    handle = I(D(R(36, 18, 28, 20, 7), R(41.5, 23, 17, 12, 3.5)), R(0, 0, 100, 34))
    m.outline = U(body, handle)
    m.side(body, "#145F55").side(handle, "#3A2414")
    m.layer(handle, lin(36, 18, 64, 34, (0, "#7A5236"), (1, "#4A2E1A")))
    m.layer(body, lin(14, 32, 86, 86, (0, "#4CC5B5"), (1, "#1F8A7C")))
    m.layer(I(body, R(0, 38, 100, 1.2)), solid("#FFFFFF", 0.35))
    for x in (28, 66):
        m.layer(R(x, 32, 6, 54), lin(x, 32, x + 6, 86, (0, "#A26B42"), (1, "#7A4A28")))
        m.layer(R(x - 1, 74, 8, 6, 1.5), lin(x, 74, x + 6, 80, (0, "#F5F7F9"), (1, "#9AA3AD")))
    m.layer(C(47, 50, 7.5), solid("#FFD43B")).layer(star(47, 50.5, 4.6, 2, 5), solid("#E8A500"))
    m.layer(rot(R(43, 60, 17, 10, 2), -8, (51, 65)), solid("#E63946")).layer(rot(R(45, 63.5, 13, 1.4), -8, (51, 65)), solid("#FFFFFF", 0.85))
    m.layer(C(54, 77, 4.8), solid("#4DABF7")).layer(C(54, 77, 2.2), solid("#FFFFFF", 0.9))
    for x, y in ((18, 36), (82, 36), (18, 82), (82, 82)):
        m.layer(C(x, y, 2.4), lin(x - 2, y - 2, x + 2, y + 2, (0, "#F5F7F9"), (1, "#8C96A2")))
    m.spot(26, 42, 9, 4, -15)

def camera():
    m = Magnet("camera", "Фотоаппарат", "travel", "glossy", 6, note="Металл и эмаль")
    body = R(12, 34, 76, 50, 8)
    vf = R(22, 25, 18, 13, 3)
    flash = R(62, 27, 16, 10, 2)
    m.outline = U(body, vf, flash)
    m.side(m.outline, "#15181B")
    m.layer(U(vf, flash), lin(20, 25, 80, 38, (0, "#F2F4F6"), (1, "#A9B0B8")))
    m.layer(R(64, 28.5, 12, 7, 1.5), lin(64, 28, 76, 35, (0, "#FFFFFF"), (1, "#CFE3F7")))
    m.layer(body, lin(12, 34, 88, 84, (0, "#454C55"), (1, "#1E2227")))
    m.layer(I(body, R(0, 34, 100, 14)), lin(12, 34, 88, 48, (0, "#F4F6F8"), (1, "#AEB5BD")))
    m.layer(C(50, 60, 19.5), lin(32, 42, 68, 78, (0, "#F4F6F8"), (1, "#7C858F")))
    m.layer(C(50, 60, 15), solid("#15181B"))
    m.layer(C(50, 60, 11.5), rad(46, 55, 14, (0, "#6E93C9"), (0.5, "#2B4675"), (1, "#0F1A2E")))
    m.layer(C(50, 60, 5), solid("#0B111D"))
    m.layer(E(45, 55, 3.4, 2, -35), solid("#FFFFFF", 0.75))
    m.layer(C(78, 42, 3.4), solid("#E63946"))
    m.layer(R(18, 41, 8, 3.2, 1.6), solid("#2C3E73"))
    m.spot(26, 40, 10, 3, -6)

def balloon():
    m = Magnet("balloon", "Воздушный шар", "travel", "glossy", 6, note="Эмаль")
    env = S([(50, 6), (72, 13), (83, 32), (78, 52), (63, 67), (56, 74), (44, 74), (37, 67), (22, 52), (17, 32), (28, 13)], 16)
    basket = R(42, 83, 16, 12, 2)
    ropes = U(L([(44.5, 73), (45, 84)], 1.3), L([(55.5, 73), (55, 84)], 1.3))
    m.outline = U(env, basket, ropes)
    m.side(env, "#8E1F2E").side(U(basket, ropes), "#5A3A22")
    m.layer(ropes, solid("#6B4A2F"))
    m.layer(basket, lin(42, 83, 58, 95, (0, "#D9A066"), (1, "#8B5A33")))
    m.layer(U([I(R(42, y, 16, 0.9), basket) for y in (86, 89, 92)] + [I(R(x, 83, 0.9, 12), basket) for x in (46, 50, 54)]), solid("#6B4423", 0.6))
    m.layer(env, lin(20, 10, 80, 72, (0, "#FF8A8A"), (1, "#D6334A")))
    m.layer(I(env, E(50, 40, 22, 44)), lin(30, 10, 70, 72, (0, "#FFE066"), (1, "#F5A700")))
    m.layer(I(env, E(50, 40, 9.5, 44)), lin(40, 10, 60, 72, (0, "#74C0FC"), (1, "#1C7ED6")))
    m.layer(I(env, R(0, 66, 100, 10)), solid("#E8590C", 0.9))
    m.spot(33, 26, 8, 13, -15)

for fn in [strawberry, lemon, orange, cherries, watermelon,
           daisy, tulip, sakura, sunflower,
           shell, fish, starfish, sailboat,
           sun, moon, cloud, rainbow, metal_star,
           heart, house, cup, cactus,
           donut, icecream, lollipop, macaron,
           airplane, suitcase, camera, balloon]:
    fn()
