"""Exports Magnets.json for the app and preview.html that renders magnets the same way
the SwiftUI renderer does (extruded side, face layers, edge, bevel, gloss, shadows)."""
import json, sys, math
from shapely.geometry import Polygon, MultiPolygon, GeometryCollection
from shapely.geometry.polygon import orient
from shapely import affinity
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import magnets as M

EXT = (0.28, 1.0)          # extrusion direction per unit of thickness
STEPS = 10
MATERIALS = {               # bevelHi, bevelLo, gloss, specular
    "glossy":  (0.70, 0.32, 0.60, 0.85),
    "ceramic": (0.50, 0.26, 0.42, 0.50),
    "metal":   (0.90, 0.40, 0.30, 0.90),
    "matte":   (0.30, 0.20, 0.15, 0.00),
}
BEVEL = 4.0                 # bevel stroke width in units
DOOR_UNIT = 0.2             # door width fraction for a 100-unit magnet

def polys(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, (MultiPolygon, GeometryCollection)):
        out = []
        for p in g.geoms:
            out.extend(polys(p))
        return out
    return []

def num(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s

def path(g, tol=0.06):
    parts = []
    for p in polys(g.simplify(tol, preserve_topology=True)):
        p = orient(p, 1.0)
        for ring in [p.exterior] + list(p.interiors):
            cs = list(ring.coords)[:-1]
            if len(cs) < 3:
                continue
            parts.append("M " + num(cs[0][0]) + " " + num(cs[0][1]) + " L " + " ".join(num(x) + " " + num(y) for x, y in cs[1:]) + " Z")
    return " ".join(parts)

def shift_fill(f, dx, dy):
    f = json.loads(json.dumps(f))
    if f["type"] == "linear":
        f["from"] = [f["from"][0] + dx, f["from"][1] + dy]
        f["to"] = [f["to"][0] + dx, f["to"][1] + dy]
    elif f["type"] == "radial":
        f["center"] = [f["center"][0] + dx, f["center"][1] + dy]
    return f

def build(m):
    t = m.thickness
    ext = (EXT[0] * t, EXT[1] * t)
    o = m.outline
    pad = 1.5
    minx, miny, maxx, maxy = o.union(affinity.translate(o, *ext)).bounds
    dx, dy = -minx + pad, -miny + pad
    w, h = maxx - minx + 2 * pad, maxy - miny + 2 * pad
    mv = lambda g: affinity.translate(g, dx, dy)
    sides = m.sides or [(o, "#666666")]
    return {
        "id": m.id, "title": m.title, "set": m.set, "note": m.note, "material": m.material,
        "thickness": t, "w": round(w, 2), "h": round(h, 2),
        "doorWidth": round(w / 100 * DOOR_UNIT * m.size, 4),
        "outline": path(mv(o)),
        "sides": [{"d": path(mv(g)), "color": c} for g, c in sides],
        "layers": [{"d": path(mv(g)), "fill": shift_fill(f, dx, dy)} for g, f in m.layers if not g.is_empty],
        "gloss": [[round(cx + dx, 2), round(cy + dy, 2), rx, ry, r] for cx, cy, rx, ry, r in m.gloss],
    }

# ------------------------------------------------------------------ SVG preview
_gid = [0]
def gid():
    _gid[0] += 1
    return f"g{_gid[0]}"

def stops_svg(stops):
    return "".join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in stops)

def fill_svg(f, defs):
    if f["type"] == "solid":
        o, c, a = f["stops"][0]
        return f'fill="{c}" fill-opacity="{a}"'
    i = gid()
    if f["type"] == "linear":
        (x1, y1), (x2, y2) = f["from"], f["to"]
        defs.append(f'<linearGradient id="{i}" gradientUnits="userSpaceOnUse" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}">{stops_svg(f["stops"])}</linearGradient>')
    else:
        (cx, cy), r = f["center"], f["radius"]
        defs.append(f'<radialGradient id="{i}" gradientUnits="userSpaceOnUse" cx="{cx}" cy="{cy}" r="{r}">{stops_svg(f["stops"])}</radialGradient>')
    return f'fill="url(#{i})"'

def magnet_svg(d, px, tilt=(0.0, 0.0), shadow=True):
    w, h, t = d["w"], d["h"], d["thickness"]
    hi, lo, gl, sp = MATERIALS[d["material"]]
    ex, ey = (EXT[0] + 0.6 * tilt[0]) * t, (EXT[1] + 0.5 * tilt[1]) * t
    defs, body = [], []
    clip = gid()
    defs.append(f'<clipPath id="{clip}"><path d="{d["outline"]}"/></clipPath>')
    for s in d["sides"]:
        for k in range(1, STEPS + 1):
            body.append(f'<path d="{s["d"]}" fill="{s["color"]}" transform="translate({ex * k / STEPS:.3f} {ey * k / STEPS:.3f})"/>')
    for l in d["layers"]:
        body.append(f'<path d="{l["d"]}" {fill_svg(l["fill"], defs)}/>')
    body.append(f'<path d="{d["outline"]}" fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="0.7"/>')
    bev = gid()
    defs.append(f'<linearGradient id="{bev}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{w}" y2="{h}">'
                f'<stop offset="0" stop-color="#fff" stop-opacity="{hi}"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/>'
                f'<stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="{lo}"/></linearGradient>')
    body.append(f'<path d="{d["outline"]}" fill="none" stroke="url(#{bev})" stroke-width="{BEVEL}" clip-path="url(#{clip})"/>')
    gloss = []
    for cx, cy, rx, ry, r in d["gloss"]:
        cx += tilt[0] * 6; cy += tilt[1] * 6
        g1, g2 = gid(), gid()
        defs.append(f'<radialGradient id="{g1}"><stop offset="0" stop-color="#fff" stop-opacity="{gl}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>')
        defs.append(f'<radialGradient id="{g2}"><stop offset="0" stop-color="#fff" stop-opacity="{sp}"/><stop offset="0.7" stop-color="#fff" stop-opacity="{sp * 0.6}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>')
        gloss.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#{g1})" transform="rotate({r} {cx} {cy})"/>')
        if sp > 0:
            sx, sy = cx - rx * 0.25, cy - ry * 0.25
            gloss.append(f'<ellipse cx="{sx}" cy="{sy}" rx="{rx * 0.42}" ry="{ry * 0.3}" fill="url(#{g2})" transform="rotate({r} {sx} {sy})"/>')
    body.append(f'<g clip-path="url(#{clip})">{"".join(gloss)}</g>')
    f = gid()
    unit = 1.0
    defs.append(f'<filter id="{f}" x="-30%" y="-30%" width="170%" height="170%">'
                f'<feDropShadow dx="{0.5 * unit}" dy="{1.4 * unit}" stdDeviation="{0.9 * unit}" flood-color="#000" flood-opacity="0.32"/>'
                f'<feDropShadow dx="{2.5 * unit}" dy="{6 * unit}" stdDeviation="{4.5 * unit}" flood-color="#000" flood-opacity="0.22"/></filter>')
    filt = f' filter="url(#{f})"' if shadow else ""
    ph = px * h / w
    return (f'<svg width="{px:.0f}" height="{ph:.0f}" viewBox="0 0 {w} {h}" style="overflow:visible">'
            f'<defs>{"".join(defs)}</defs><g{filt}>{"".join(body)}</g></svg>')

def main(out_json, out_html):
    data = {"version": 1,
            "render": {"extrusion": EXT, "steps": STEPS, "bevel": BEVEL,
                       "materials": {k: dict(zip(["bevelHi", "bevelLo", "gloss", "specular"], v)) for k, v in MATERIALS.items()}},
            "sets": [{"id": i, "title": t, "caption": c} for i, t, c in M.SETS],
            "magnets": [build(m) for m in M.MAGNETS]}
    with open(out_json, "w") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    cards = []
    for s_id, s_title, s_cap in M.SETS:
        items = [m for m in data["magnets"] if m["set"] == s_id]
        tiles = "".join(f'<div class="tile"><div class="mag">{magnet_svg(m, 150 * m["w"] / 100)}</div><div class="name">{m["title"]}</div></div>' for m in items)
        cards.append(f'<section><div class="label">{s_title.upper()}</div><div class="cap">{s_cap}</div><div class="row">{tiles}</div></section>')
    html = f'''<!doctype html><html><head><meta charset="utf-8"><style>
body{{margin:0;background:#F3F0E8;font-family:-apple-system,Helvetica,sans-serif;color:#18262F}}
.wrap{{padding:28px 32px}}
section{{margin-bottom:22px;padding:18px 20px 8px;border-radius:22px;
background:linear-gradient(135deg,#DDE0E4,#BCC1C7 60%,#A6ACB3);box-shadow:inset 0 1px 0 rgba(255,255,255,.7)}}
.label{{font-size:12px;letter-spacing:2px;font-weight:700;color:#3b4650}}
.cap{{font-family:Georgia,serif;font-size:18px;margin:2px 0 10px}}
.row{{display:flex;gap:26px;align-items:flex-end;flex-wrap:wrap}}
.tile{{display:flex;flex-direction:column;align-items:center;gap:8px;padding-bottom:10px}}
.mag{{display:flex;align-items:flex-end;justify-content:center;min-height:120px}}
.name{{font-size:13px;color:#2a3540}}
</style></head><body><div class="wrap">{"".join(cards)}</div></body></html>'''
    with open(out_html, "w") as fh:
        fh.write(html)
    print("magnets:", len(data["magnets"]), "json bytes:", len(json.dumps(data, ensure_ascii=False, separators=(",", ":"))))

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
