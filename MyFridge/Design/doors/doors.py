"""Prototype of the fridge door renderer. Mirrors the SwiftUI layer stack 1:1."""
import random, json, sys

FINISHES = {
    # metals: panel TL->BR, rim
    "steel":     dict(kind="metal", panel=["#DFE2E5", "#C4C8CD", "#A3A8AE"], rim=["#F4F5F6", "#C5C9CD", "#80858B"], brush=0.9),
    "graphite":  dict(kind="metal", panel=["#7A8188", "#555B61", "#34393E"], rim=["#A9AFB5", "#5E646A", "#2C3034"], brush=0.55),
    "champagne": dict(kind="metal", panel=["#E3DACF", "#C6BBAF", "#A2978B"], rim=["#F2ECE5", "#C6BCB1", "#857A6F"], brush=0.8),
    # enamel: light, base, shade, edge
    "cream":  dict(kind="enamel", paint=["#FBF4E4", "#EEE1C4", "#D6C59F", "#B9A57C"]),
    "mint":   dict(kind="enamel", paint=["#E3F5EA", "#BDE2CC", "#93C6A9", "#6FA387"]),
    "sky":    dict(kind="enamel", paint=["#DCEDF9", "#A8CDEA", "#7FAED4", "#5D8DB7"]),
    "cherry": dict(kind="enamel", paint=["#F47E73", "#D63C35", "#A9241F", "#7E1714"]),
    "lemon":  dict(kind="enamel", paint=["#FCF0B0", "#F3D667", "#D8B43D", "#AD8B22"]),
    "powder": dict(kind="enamel", paint=["#FCE6EA", "#F1C3CB", "#D89FA9", "#B97A86"]),
    "black":  dict(kind="enamel", paint=["#53585E", "#2B2E32", "#18191C", "#0C0D0E"]),
}

def brushed(W, H, seed=7, opacity=0.9):
    r = random.Random(seed); out = []
    for _ in range(int(H * 1.6)):
        y = r.uniform(0, H); x = r.uniform(-W * .1, W); l = r.uniform(W * .1, W * .8)
        light = r.random() < .5; a = (r.uniform(.05, .16) if light else r.uniform(.03, .09)) * opacity
        out.append(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x+l:.1f}" y2="{y:.1f}" stroke="{"#fff" if light else "#000"}" stroke-opacity="{a:.3f}" stroke-width="{r.uniform(.35,.9):.2f}"/>')
    return "".join(out)

def stops(*s):
    return "".join(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>' for o, c, a in s)

CHROME = [(0, "#4F5459", 1), (0.16, "#D9DDE1", 1), (0.3, "#FFFFFF", 1), (0.48, "#9CA2A8", 1), (0.6, "#3F4449", 1), (0.82, "#CDD2D7", 1), (1, "#6B7076", 1)]
CREAM = [(0, "#A8946C", 1), (0.2, "#EADFC4", 1), (0.34, "#FFFBF0", 1), (0.55, "#E2D4B4", 1), (0.75, "#B9A47C", 1), (1, "#8F7B57", 1)]

def door_svg(finish, fmt, handle, W, nameplate="", uid="d"):
    H = {"tall": W / 0.955, "square": W, "wide": W / 2.14}[fmt]
    f = FINISHES[finish]
    m = min(W, H)
    R = {"tall": 0.062 * W, "square": 0.13 * W, "wide": 0.13 * H}[fmt]
    e = 0.022 * m if f["kind"] == "metal" else 0.03 * m
    rf = max(R - e * 0.9, 3)
    fx, fy, fw, fh = e, e, W - 2 * e, H - 2 * e
    d = []  # defs
    b = []  # body
    g = lambda n: f"{uid}{n}"
    # clip for whole door + face
    d.append(f'<clipPath id="{g("door")}"><rect width="{W}" height="{H}" rx="{R}"/></clipPath>')
    d.append(f'<clipPath id="{g("face")}"><rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" rx="{rf}"/></clipPath>')
    if f["kind"] == "metal":
        rim = f["rim"]; panel = f["panel"]
        d.append(f'<linearGradient id="{g("rim")}" x1="0" y1="0" x2="0" y2="1">{stops((0, rim[0], 1), (.5, rim[1], 1), (1, rim[2], 1))}</linearGradient>')
        d.append(f'<linearGradient id="{g("pan")}" x1="0" y1="0" x2="1" y2="1">{stops((0, panel[0], 1), (.5, panel[1], 1), (1, panel[2], 1))}</linearGradient>')
        b.append(f'<rect width="{W}" height="{H}" fill="url(#{g("rim")})"/>')
        face = [f'<rect width="{W}" height="{H}" fill="url(#{g("pan")})"/>', brushed(W, H, opacity=f["brush"])]
        # anisotropic highlight: vertical soft bands (perpendicular to the brushing)
        d.append(f'<linearGradient id="{g("aniso")}" x1="0" y1="0" x2="1" y2="0">{stops((0,"#fff",0),(.22,"#fff",.0),(.32,"#fff",.30),(.42,"#fff",0),(.6,"#fff",.0),(.68,"#fff",.14),(.76,"#fff",0),(1,"#fff",0))}</linearGradient>')
        face.append(f'<rect width="{W}" height="{H}" fill="url(#{g("aniso")})"/>')
        d.append(f'<linearGradient id="{g("cyl")}" x1="0" y1="0" x2="1" y2="0">{stops((0,"#000",.16),(.1,"#000",0),(.88,"#000",0),(1,"#000",.2))}</linearGradient>')
        face.append(f'<rect width="{W}" height="{H}" fill="url(#{g("cyl")})"/>')
    else:
        p = f["paint"]
        d.append(f'<linearGradient id="{g("rim")}" x1="0" y1="0" x2="0" y2="1">{stops((0, p[2], 1), (1, p[3], 1))}</linearGradient>')
        d.append(f'<linearGradient id="{g("pan")}" x1="0" y1="0" x2="0" y2="1">{stops((0, p[0], 1), (.35, p[1], 1), (1, p[2], 1))}</linearGradient>')
        b.append(f'<rect width="{W}" height="{H}" fill="url(#{g("rim")})"/>')
        face = [f'<rect width="{W}" height="{H}" fill="url(#{g("pan")})"/>']
        # convex door: darker edges, lighter left-centre
        d.append(f'<linearGradient id="{g("cyl")}" x1="0" y1="0" x2="1" y2="0">{stops((0,"#000",.14),(.1,"#000",0),(.3,"#fff",.12),(.55,"#fff",0),(.86,"#000",0),(1,"#000",.18))}</linearGradient>')
        face.append(f'<rect width="{W}" height="{H}" fill="url(#{g("cyl")})"/>')
        # window reflections
        d.append(f'<linearGradient id="{g("win")}" x1="0" y1="0" x2="0" y2="1">{stops((0,"#fff",.55),(.45,"#fff",.22),(1,"#fff",0))}</linearGradient>')
        d.append(f'<filter id="{g("soft")}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="{0.012*m:.2f}"/></filter>')
        wy = H * (0.05 if fmt != "wide" else 0.12)
        wh = H * (0.82 if fmt != "wide" else 0.7)
        face.append(f'<g filter="url(#{g("soft")})"><rect x="{W*.11}" y="{wy}" width="{W*.085}" height="{wh}" rx="{W*.02}" fill="url(#{g("win")})"/>'
                    f'<rect x="{W*.215}" y="{wy}" width="{W*.025}" height="{wh*.9}" rx="{W*.01}" fill="url(#{g("win")})"/></g>')
        # sky from the top
        d.append(f'<linearGradient id="{g("sky")}" x1="0" y1="0" x2="0" y2="1">{stops((0,"#fff",.35),(.22,"#fff",0),(.8,"#000",0),(1,"#000",.12))}</linearGradient>')
        face.append(f'<rect width="{W}" height="{H}" fill="url(#{g("sky")})"/>')
    # top cap seam (metal) or chrome trim (enamel), not on wide
    if fmt != "wide":
        sy = fy + fh * 0.12
        if f["kind"] == "metal":
            d.append(f'<linearGradient id="{g("cap")}" x1="0" y1="0" x2="0" y2="1">{stops((0,"#fff",.42),(1,"#fff",.04))}</linearGradient>')
            face.append(f'<rect width="{W}" height="{sy}" fill="url(#{g("cap")})"/>')
            face.append(f'<rect y="{sy}" width="{W}" height="1.2" fill="#000" fill-opacity=".32"/><rect y="{sy+1.2}" width="{W}" height="1" fill="#fff" fill-opacity=".6"/>')
            d.append(f'<linearGradient id="{g("capsh")}" x1="0" y1="0" x2="0" y2="1">{stops((0,"#000",.1),(1,"#000",0))}</linearGradient>')
            face.append(f'<rect y="{sy+2.2}" width="{W}" height="{H*.03}" fill="url(#{g("capsh")})"/>')
        else:
            th = max(3, H * 0.014)
            d.append(f'<linearGradient id="{g("trim")}" x1="0" y1="0" x2="0" y2="1">{stops((0,"#FFFFFF",1),(.35,"#C3C8CD",1),(.6,"#6E747B",1),(1,"#E6E9EC",1))}</linearGradient>')
            d.append(f'<linearGradient id="{g("trimsh")}" x1="0" y1="0" x2="0" y2="1">{stops((0,"#000",.22),(1,"#000",0))}</linearGradient>')
            face.append(f'<rect y="{sy+th}" width="{W}" height="{th*1.6}" fill="url(#{g("trimsh")})"/>')
            face.append(f'<rect y="{sy}" width="{W}" height="{th}" fill="url(#{g("trim")})"/>')
    b.append(f'<g clip-path="url(#{g("face")})">{"".join(face)}</g>')
    # inner roll-off shadow + edge highlight
    d.append(f'<filter id="{g("ish")}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="{0.01*m:.2f}"/></filter>')
    b.append(f'<g clip-path="url(#{g("face")})"><rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" rx="{rf}" fill="none" stroke="#000" stroke-opacity="{.28 if f["kind"]=="enamel" else .2}" stroke-width="{0.018*m:.2f}" filter="url(#{g("ish")})"/></g>')
    d.append(f'<linearGradient id="{g("lip")}" x1="0" y1="0" x2="0" y2="1">{stops((0,"#fff",.9),(.5,"#fff",.15),(1,"#000",.3))}</linearGradient>')
    b.append(f'<rect x="{fx+.5}" y="{fy+.5}" width="{fw-1}" height="{fh-1}" rx="{rf}" fill="none" stroke="url(#{g("lip")})" stroke-width="1.2"/>')
    # gasket line on the rim
    b.append(f'<rect x="{e*.45}" y="{e*.45}" width="{W-e*.9}" height="{H-e*.9}" rx="{R-e*.4}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="0.8"/>')
    # nameplate
    if nameplate and fmt != "wide":
        fs = fh * 0.12 * 0.55
        d.append(f'<linearGradient id="{g("np")}" x1="0" y1="0" x2="0" y2="1">{stops((0,"#FFFFFF",1),(.45,"#B9BEC4",1),(.7,"#6E747B",1),(1,"#E6E9EC",1))}</linearGradient>')
        b.append(f'<text x="{W*.08}" y="{fy+fh*.09}" font-family="Marck" font-size="{fs:.1f}" fill="#000" fill-opacity=".35" transform="translate(1 1.5)">{nameplate}</text>')
        b.append(f'<text x="{W*.08}" y="{fy+fh*.09}" font-family="Marck" font-size="{fs:.1f}" fill="url(#{g("np")})">{nameplate}</text>')
    # handle
    hb = []
    chrome = CREAM if handle == "cream" else CHROME
    if fmt == "wide":
        x0, x1, y = W * 0.32, W * 0.68, H * 0.16
        bh = max(5, H * 0.075)
        d.append(f'<linearGradient id="{g("bar")}" x1="0" y1="0" x2="0" y2="1">{stops(*chrome)}</linearGradient>')
        d.append(f'<filter id="{g("hs")}" x="-20%" y="-50%" width="140%" height="300%"><feGaussianBlur stdDeviation="{bh*.35:.2f}"/></filter>')
        hb.append(f'<rect x="{x0+bh*.4}" y="{y+bh*.9}" width="{x1-x0}" height="{bh}" rx="{bh/2}" fill="#000" fill-opacity=".35" filter="url(#{g("hs")})"/>')
        for x in (x0 + bh * .6, x1 - bh * .6):
            hb.append(f'<rect x="{x-bh*.55}" y="{y-bh*.2}" width="{bh*1.1}" height="{bh*1.6}" rx="{bh*.35}" fill="url(#{g("bar")})" stroke="#000" stroke-opacity=".25" stroke-width=".6"/>')
        hb.append(f'<rect x="{x0}" y="{y}" width="{x1-x0}" height="{bh}" rx="{bh/2}" fill="url(#{g("bar")})"/>')
    else:
        x = W * 0.9
        top, bottom = H * (0.3 if handle != "bow" else 0.3), H * (0.7 if handle != "bow" else 0.72)
        bw = W * (0.042 if handle == "bow" else 0.046)
        d.append(f'<linearGradient id="{g("bar")}" x1="0" y1="0" x2="1" y2="0">{stops(*chrome)}</linearGradient>')
        d.append(f'<linearGradient id="{g("mount")}" x1="0" y1="0" x2="0" y2="1">{stops((0,"#F7F8F9",1),(.5,"#B3B8BE",1),(1,"#737980",1))}</linearGradient>')
        d.append(f'<filter id="{g("hs")}" x="-100%" y="-20%" width="300%" height="140%"><feGaussianBlur stdDeviation="{bw*.35:.2f}"/></filter>')
        if handle == "bow":
            bow = W * 0.036
            path = f"M {x} {top} C {x+bow} {top+(bottom-top)*.12}, {x+bow} {bottom-(bottom-top)*.12}, {x} {bottom}"
            hb.append(f'<path d="{path}" stroke="#000" stroke-opacity=".3" stroke-width="{bw}" fill="none" stroke-linecap="round" filter="url(#{g("hs")})" transform="translate({W*.016} {W*.024})"/>')
            for yy in (top, bottom):
                hb.append(f'<rect x="{x-W*.035}" y="{yy-W*.0475}" width="{W*.07}" height="{W*.095}" rx="{W*.032}" fill="url(#{g("mount")})" stroke="#000" stroke-opacity=".25" stroke-width=".6"/>')
            hb.append(f'<path d="{path}" stroke="#5F656C" stroke-width="{bw}" fill="none" stroke-linecap="round"/>')
            hb.append(f'<path d="{path}" stroke="#D9DDE1" stroke-width="{bw*.62}" fill="none" stroke-linecap="round" transform="translate({-bw*.1} 0)"/>')
            hb.append(f'<path d="{path}" stroke="#fff" stroke-width="{bw*.2}" fill="none" stroke-linecap="round" transform="translate({-bw*.2} 0)" opacity=".9"/>')
        else:
            # straight bar on stand-offs
            hb.append(f'<rect x="{x-bw/2+W*.022}" y="{top+W*.03}" width="{bw}" height="{bottom-top}" rx="{bw/2}" fill="#000" fill-opacity=".34" filter="url(#{g("hs")})"/>')
            for yy in (top + bw * .7, bottom - bw * .7):
                ms = bw * 1.25
                hb.append(f'<rect x="{x-ms/2}" y="{yy-ms*.65}" width="{ms}" height="{ms*1.3}" rx="{ms*.3}" fill="url(#{g("mount")})" stroke="#000" stroke-opacity=".25" stroke-width=".6"/>')
            hb.append(f'<rect x="{x-bw/2}" y="{top}" width="{bw}" height="{bottom-top}" rx="{bw/2}" fill="url(#{g("bar")})"/>')
            hb.append(f'<rect x="{x-bw/2}" y="{top}" width="{bw}" height="{bottom-top}" rx="{bw/2}" fill="none" stroke="#000" stroke-opacity=".18" stroke-width=".6"/>')
    b.append("".join(hb))
    return (f'<svg width="{W:.0f}" height="{H:.0f}" viewBox="0 0 {W} {H}"><defs>{"".join(d)}</defs>'
            f'<g clip-path="url(#{g("door")})">{"".join(b)}</g></svg>')

if __name__ == "__main__":
    cards = []
    i = 0
    rows = [
        [("steel", "tall", "bow", ""), ("graphite", "tall", "bar", ""), ("champagne", "tall", "cream", "")],
        [("cream", "tall", "bar", "Дом"), ("mint", "tall", "bar", ""), ("cherry", "tall", "bar", "Лето")],
        [("sky", "square", "bar", ""), ("lemon", "square", "bar", ""), ("powder", "square", "bar", ""), ("black", "square", "bar", "")],
        [("steel", "wide", "bar", ""), ("mint", "wide", "bar", ""), ("cherry", "wide", "bar", "")],
    ]
    html = []
    for row in rows:
        cells = []
        for fin, fmt, h, np_ in row:
            i += 1
            W = {"tall": 250, "square": 200, "wide": 330}[fmt]
            cells.append(f'<div class="c"><div class="door">{door_svg(fin, fmt, h, W, np_, uid=f"u{i}")}</div><div class="n">{fin} · {fmt}</div></div>')
        html.append(f'<div class="row">{"".join(cells)}</div>')
    page = f'''<html><head><meta charset="utf-8"><style>
@font-face{{font-family:Marck;src:url(MarckScript.ttf)}}
body{{margin:0;background:#F3F0E8;font-family:Helvetica;padding:24px}}
.row{{display:flex;gap:34px;align-items:flex-end;margin-bottom:34px}}
.door{{filter:drop-shadow(0 14px 16px rgba(0,0,0,.28)) drop-shadow(0 2px 3px rgba(0,0,0,.2))}}
.n{{font-size:12px;color:#556;margin-top:10px;text-align:center}}
</style></head><body>{"".join(html)}</body></html>'''
    open(sys.argv[1], "w").write(page)
