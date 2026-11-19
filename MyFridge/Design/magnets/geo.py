"""Geometry helpers for designing magnets in a 100-unit design space (y points down)."""
import math, random
from shapely.geometry import Point, Polygon, LineString, box, MultiPolygon
from shapely.ops import unary_union
from shapely import affinity
from shapely.geometry.polygon import orient

def C(cx, cy, r):
    return Point(cx, cy).buffer(r, quad_segs=32)

def E(cx, cy, rx, ry, rot=0):
    g = affinity.scale(Point(cx, cy).buffer(1, quad_segs=32), rx, ry, origin=(cx, cy))
    return affinity.rotate(g, rot, origin=(cx, cy)) if rot else g

def R(x, y, w, h, r=0):
    if r <= 0:
        return box(x, y, x + w, y + h)
    r = min(r, w / 2 - 0.01, h / 2 - 0.01)
    return box(x + r, y + r, x + w - r, y + h - r).buffer(r, quad_segs=12)

def P(pts):
    return Polygon(pts).buffer(0)

def catmull(pts, n=14, closed=True):
    out = []
    m = len(pts)
    rng = range(m) if closed else range(m - 1)
    for i in rng:
        p0 = pts[(i - 1) % m] if closed else pts[max(i - 1, 0)]
        p1 = pts[i]
        p2 = pts[(i + 1) % m] if closed else pts[i + 1]
        p3 = pts[(i + 2) % m] if closed else pts[min(i + 2, m - 1)]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t
                                    + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in range(2)))
    if not closed:
        out.append(pts[-1])
    return out

def S(pts, n=14):
    """Closed smooth shape through points."""
    return Polygon(catmull(pts, n)).buffer(0)

def bez(p0, p1, p2, p3, n=32):
    pts = []
    for k in range(n + 1):
        t = k / n
        a = (1 - t) ** 3; b = 3 * (1 - t) ** 2 * t; c = 3 * (1 - t) * t * t; d = t ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts

def L(pts, w, smooth=False):
    """Stroke a polyline (or smooth open spline) with round caps."""
    if smooth:
        pts = catmull(pts, 10, closed=False)
    return LineString(pts).buffer(w / 2, cap_style='round', join_style='round', quad_segs=10)

def U(*gs):
    flat = []
    for g in gs:
        if isinstance(g, (list, tuple)):
            flat.extend(g)
        else:
            flat.append(g)
    return unary_union(flat)

def D(a, *bs):
    for b in bs:
        a = a.difference(b)
    return a

def I(a, b):
    return a.intersection(b)

def rounded(g, r):
    """Rounds convex corners."""
    return g.buffer(-r, quad_segs=10).buffer(r, quad_segs=10)

def soft(g, r):
    """Fills concave corners (smooth joins between unioned parts)."""
    return g.buffer(r, quad_segs=10).buffer(-r, quad_segs=10)

def rot(g, deg, origin=(50, 50)):
    return affinity.rotate(g, deg, origin=origin)

def move(g, dx, dy):
    return affinity.translate(g, dx, dy)

def scale(g, sx, sy=None, origin=(50, 50)):
    return affinity.scale(g, sx, sy if sy is not None else sx, origin=origin)

def leaf(base, tip, width, bend=0.0):
    """Pointed leaf from base to tip; bend pushes the middle sideways (fraction of length)."""
    bx, by = base; tx, ty = tip
    dx, dy = tx - bx, ty - by
    ln = math.hypot(dx, dy)
    nx, ny = -dy / ln, dx / ln
    mx, my = bx + dx * 0.45 + nx * bend * ln, by + dy * 0.45 + ny * bend * ln
    w = width / 2
    pts = [base, (mx + nx * w, my + ny * w), tip, (mx - nx * w, my - ny * w)]
    return Polygon(catmull(pts, 16)).buffer(0)

def star(cx, cy, R_, r_, n=5, start=-90):
    pts = []
    for i in range(n * 2):
        a = math.radians(start + i * 180 / n)
        rr = R_ if i % 2 == 0 else r_
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    return Polygon(pts)

def ring_sector(cx, cy, r0, r1, a0, a1, n=64):
    """Annular sector between radii r0..r1 and angles a0..a1 (degrees, y down)."""
    outer = [(cx + r1 * math.cos(math.radians(a0 + (a1 - a0) * k / n)), cy + r1 * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]
    inner = [(cx + r0 * math.cos(math.radians(a1 - (a1 - a0) * k / n)), cy + r0 * math.sin(math.radians(a1 - (a1 - a0) * k / n))) for k in range(n + 1)]
    if r0 <= 0:
        inner = [(cx, cy)]
    return Polygon(outer + inner).buffer(0)

def polar(cx, cy, r, deg):
    a = math.radians(deg)
    return (cx + r * math.cos(a), cy + r * math.sin(a))

def scatter(region, count, radius, seed, min_dist=None, shape=None):
    """Seeded points inside region with a minimum distance."""
    rnd = random.Random(seed)
    minx, miny, maxx, maxy = region.bounds
    pts = []
    md = min_dist if min_dist is not None else radius * 2.2
    tries = 0
    while len(pts) < count and tries < count * 400:
        tries += 1
        p = (rnd.uniform(minx, maxx), rnd.uniform(miny, maxy))
        if not region.buffer(-radius).contains(Point(p)):
            continue
        if all(math.hypot(p[0] - q[0], p[1] - q[1]) >= md for q in pts):
            pts.append(p)
    return pts, rnd
