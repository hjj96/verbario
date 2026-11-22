"""The rounded "pillow" of a retro fridge door, as two light layers per door format.

A retro door is not flat: its edges roll away from you like a cushion, so the top edge
catches the ceiling light, the left edge reflects the softbox, and the bottom and right
edges turn towards the darker room. The rest of the door stays exactly as the surface
texture paints it.

For each format this writes two greyscale images that match the widget's corner radius:
`volume-<format>-shade.jpg` (multiply: white changes nothing) and
`volume-<format>-light.jpg` (screen: black changes nothing).

    python volume.py <out-dir> [--preview]
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

# Door formats: width / height and the corner radius as a share of the shorter side,
# the same numbers as FridgeFormat.aspect and DoorGeometry.cornerRadius in the app.
FORMATS = {
    "tall": (338 / 354, 0.062),
    "square": (1.0, 0.13),
    "wide": (2.14, 0.13),
}
LONG_SIDE = 900


def rounded_rect_distance(w, h, radius):
    """Distance inside a rounded rectangle to its outline, in pixels (0 outside)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    px = np.abs(xx + 0.5 - w / 2) - (w / 2 - radius)
    py = np.abs(yy + 0.5 - h / 2) - (h / 2 - radius)
    outside = np.hypot(np.maximum(px, 0), np.maximum(py, 0))
    inside = np.minimum(np.maximum(px, py), 0)
    sdf = outside + inside - radius  # negative inside
    return np.maximum(-sdf, 0)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def environment(r):
    """Brightness seen along reflection direction r (x right, y down, z to the viewer)."""
    rx, ry, rz = r[..., 0], r[..., 1], r[..., 2]
    up = -ry
    # ceiling and lamp above, a darker room below the horizon, a tall softbox on the left
    sky = 0.55 + 0.9 * smoothstep(0.05, 0.6, up)
    floor = 0.32 - 0.12 * smoothstep(0.0, 0.6, -up)
    # a soft horizon: any hard step here would draw a line around the flat middle
    env = floor + (sky - floor) * smoothstep(-0.1, 0.18, up)
    softbox = smoothstep(-0.25, -0.45, rx) * smoothstep(-0.55, -0.15, ry) * smoothstep(0.35, 0.15, ry)
    env = env + 1.3 * softbox
    # the right side of the room is in shadow
    env = env * (1 - 0.35 * smoothstep(0.2, 0.6, rx))
    # straight ahead is the photographer's room: what the flat door already shows
    return env


def volume(aspect, radius_share, roll_share=0.16, lift=0.27):
    if aspect >= 1:
        w, h = LONG_SIDE, int(round(LONG_SIDE / aspect))
    else:
        h, w = LONG_SIDE, int(round(LONG_SIDE * aspect))
    short = min(w, h)
    dist = rounded_rect_distance(w, h, radius_share * short)
    inside = dist > 0
    # The cushion: a blurred outline gives a smooth roll with round contours at the corners
    # (no mitre creases). Padding keeps the blur from fading at the image border.
    roll = roll_share * short
    pad = int(roll * 2)
    mask = np.pad(inside.astype(np.float32), pad)
    soft = ndimage.gaussian_filter(mask, roll / 2.6)[pad:-pad, pad:-pad]
    # flat in the middle, rolling off all the way into the corners
    height = lift * roll * 2 * (1 - (1 - soft) ** 2)
    gy, gx = np.gradient(height)
    n = np.stack([-gx, -gy, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    view = np.array([0, 0, 1], np.float32)
    r = 2 * n[..., 2:3] * n - view
    flat = environment(np.broadcast_to(view, r.shape))
    env = environment(r)
    spec = (env - flat) * 0.13
    # diffuse light from the upper left, mostly from the front
    light = np.array([-0.3, -0.5, 0.81], np.float32)
    light /= np.linalg.norm(light)
    diffuse = np.clip((n * light).sum(-1), 0, 1) / light[2]
    shade = np.clip(0.62 + 0.38 * diffuse, 0, 1) * np.clip(1 + np.minimum(spec, 0) * 1.3, 0, 1)
    glow = np.clip(np.maximum(spec, 0), 0, 1)
    shade[~inside] = 1
    glow[~inside] = 0
    return shade, glow


def save(arr, path):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "L").save(path, quality=92, optimize=True)
    return os.path.getsize(path) // 1024


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--preview"]
    out = args[0]
    os.makedirs(out, exist_ok=True)
    for name, (aspect, share) in FORMATS.items():
        shade, glow = volume(aspect, share)
        a = save(shade, os.path.join(out, f"volume-{name}-shade.jpg"))
        b = save(glow, os.path.join(out, f"volume-{name}-light.jpg"))
        print(f"{name}: {shade.shape[1]}x{shade.shape[0]}, shade {a} KB, light {b} KB")
