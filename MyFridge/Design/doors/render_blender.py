"""Photographic fridge doors and chrome hardware, path-traced with Blender Cycles.

Everything the app shows of a fridge comes from here:
- `door-<finish>-<format>.jpg`: a retro door (deep rounded "pillow" edges) that exactly fills a
  widget of that format, plus `...-gloss.jpg`, the reflection of the tall softbox on its own, so
  the app can slide it as the phone tilts (screen blend; together they give the full photo).
- `door-<finish>.jpg` (+ `-gloss`): a flat modern panel, cropped edge to edge, for every format.
- `handle-<model>.png`, `badge-thaw.png`: chrome hardware with its shadow, on transparency.

Run with Blender's Python module (pip install bpy numpy pillow OpenEXR):

    python render_blender.py <out-dir> [doors|flat|hardware|test] [finish ...]
"""
import math
import os
import sys

import bpy
import numpy as np
import OpenEXR
from PIL import Image

LONG_SIDE = int(os.environ.get("DOOR_PX", 1080))
SAMPLES = int(os.environ.get("DOOR_SAMPLES", 64))
GLOSS_SCALE = 0.5  # the reflection layer is soft; half the resolution is plenty

# Physical doors (metres). The widget corner radius is ~22 pt on every size, so all doors share
# one physical corner radius, and a magnet is the same size on each.
FORMATS = {
    "tall": (0.60, 0.60 / (338 / 354)),
    "square": (0.28, 0.28),
    "wide": (0.60, 0.60 / 2.14),
}
CORNER = 0.0368
PILLOW = 0.033  # how deep the front edge rolls away

FINISHES = {
    # name: (kind, sRGB base colour)
    "steel": ("metal", (196, 199, 202)),
    "graphite": ("metal", (62, 66, 71)),
    "champagne": ("metal", (204, 190, 170)),
    "cream": ("enamel", (238, 226, 198)),
    "mint": ("enamel", (178, 222, 199)),
    "sky": ("enamel", (158, 198, 230)),
    "cherry": ("enamel", (196, 30, 34)),
    "lemon": ("enamel", (244, 208, 82)),
    "powder": ("enamel", (241, 190, 201)),
    "black": ("enamel", (20, 21, 24)),
}


def srgb_to_linear(c):
    c = np.asarray(c, np.float64) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def shoulder(x, knee=0.8):
    over = np.maximum(x - knee, 0)
    return np.where(x > knee, knee + (1 - knee) * (1 - np.exp(-over / (1 - knee))), x)


# ---------------------------------------------------------------------------------------
# Scene

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.015
    sc.cycles.max_bounces = 5
    sc.cycles.diffuse_bounces = 2
    sc.cycles.glossy_bounces = 3
    sc.cycles.transmission_bounces = 0
    sc.cycles.volume_bounces = 0
    sc.cycles.seed = 7
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = False
    ims = sc.render.image_settings
    ims.media_type = "MULTI_LAYER_IMAGE"
    ims.file_format = "OPEN_EXR_MULTILAYER"
    ims.color_depth = "32"
    world = bpy.data.worlds.new("world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.03, 0.03, 0.032, 1)
    sc.world = world
    return sc


def material(name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    return mat, mat.node_tree.nodes, mat.node_tree.links, mat.node_tree.nodes["Principled BSDF"]


def emission_material(name, strength, colour=(1, 1, 1)):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    em.inputs["Color"].default_value = (*colour, 1)
    links.new(em.outputs[0], out.inputs[0])
    return mat


def diffuse_material(name, colour, roughness=0.8):
    mat, nodes, links, bsdf = material(name)
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def plane(name, size, location, rotation, mat, camera=False):
    bpy.ops.mesh.primitive_plane_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0], size[1], 1)
    obj.data.materials.append(mat)
    obj.visible_camera = camera
    return obj


def area_light(name, location, target, size, energy, colour=(1, 1, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "RECTANGLE"
    data.size, data.size_y = size
    data.energy = energy
    data.color = colour
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    direction = np.array(target) - np.array(location)
    obj.rotation_euler = vector_to_euler(direction)
    return obj


def vector_to_euler(direction):
    from mathutils import Vector
    return Vector(direction).to_track_quat("-Z", "Y").to_euler()


def studio(door_w, door_h, strip=True, only_strip=False, metal=False):
    """A small photo studio inside a room. The walls, floor and ceiling are out of frame but
    show in the rolled edges and in chrome; the tall softbox strip is what slides in the app."""
    s = max(door_w, door_h)
    strip_strength = 45.0 if metal else 9.0
    if metal and not only_strip:
        # a white studio all round: even the steepest edge, which looks behind the door,
        # mirrors something light instead of a black void
        bpy.context.scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (6.0, 6.0, 6.0, 1)
    if only_strip:
        bpy.context.scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
        mat = strip_material(door_w, door_h, strip_strength)
        obj = plane("strip", (0.22 * s, 3.0), (-0.2 * door_w, -1.8, 0.0), (math.pi / 2, 0, 0), mat)
        obj.visible_diffuse = False
        obj.visible_shadow = False
        return
    # key: a big softbox high on the left, in front; soft shadows fall down and to the right
    area_light("key", (-1.3, -1.5, 1.0), (0, 0, 0), (1.2, 1.6), 900, (1.0, 0.98, 0.95))
    # a broad soft light from above and a dim fill on the right that never shows as a highlight
    area_light("top", (0.0, -0.7, 1.7), (0, 0, 0), (2.0, 1.0), 380, (1.0, 0.99, 0.97))
    fill = area_light("fill", (1.6, -1.6, -0.1), (0, 0, 0), (1.0, 1.4), 120, (0.95, 0.97, 1.0))
    fill.visible_glossy = False
    if metal:
        # stainless steel is shot in a white studio: its rolled edges mirror bright walls,
        # the right one a little dimmer, the floor a light grey sweep
        room_wall = sweep_material(9.0)
        room_dark = sweep_material(6.0)
        floor = sweep_material(5.0)
    else:
        room_wall = diffuse_material("wall", (0.55, 0.52, 0.47))
        room_dark = diffuse_material("dark", (0.03, 0.03, 0.03))
        floor = diffuse_material("floor", (0.09, 0.06, 0.04), 0.5)
    plane("floor", (8, 8), (0, -2, -0.9), (0, 0, 0), floor)
    plane("ceiling", (8, 8), (0, -2, 2.4), (math.pi, 0, 0), room_wall)
    plane("left", (8, 4), (-2.6, -2, 0.7), (0, math.pi / 2, 0), room_wall)
    plane("right", (8, 4), (2.6, -2, 0.7), (0, -math.pi / 2, 0), room_dark)
    # behind the camera: a dim room for enamel; for metal a white sweep, as stainless steel
    # is always shot, brighter at the top
    sweep = sweep_material(10.0 if metal else 1.2)
    plane("back", (8, 4), (0, -4.2, 0.7), (math.pi / 2, 0, 0), sweep)
    # a window on the left wall: the left rolled edge picks it up
    plane("window", (1.6, 1.4), (-2.55, -1.2, 1.0), (0, math.pi / 2, 0), emission_material("sky", 3.0, (0.92, 0.96, 1.0)))
    if strip:
        # the tall softbox in front of the door, mirrored by its flat front: never seen directly
        mat = strip_material(door_w, door_h, strip_strength)
        obj = plane("strip", (0.22 * s, 3.0), (-0.2 * door_w, -1.8, 0.0), (math.pi / 2, 0, 0), mat)
        obj.visible_diffuse = False
        obj.visible_shadow = False


def sweep_material(strength):
    """An evenly lit backdrop, a little brighter towards the top."""
    mat = bpy.data.materials.new("sweep")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    ramp = nodes.new("ShaderNodeMapRange")
    ramp.inputs["To Min"].default_value = strength * 0.7
    ramp.inputs["To Max"].default_value = strength * 1.15
    links.new(coord.outputs["Generated"], sep.inputs[0])
    links.new(sep.outputs["Y"], ramp.inputs["Value"])
    links.new(ramp.outputs[0], em.inputs["Strength"])
    em.inputs["Color"].default_value = (1.0, 0.99, 0.97, 1)
    links.new(em.outputs[0], out.inputs[0])
    return mat


def strip_material(door_w, door_h, peak=9.0):
    """A softbox face: bright in the middle, soft towards its long edges, fading downwards."""
    mat = bpy.data.materials.new("strip")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    across = nodes.new("ShaderNodeFloatCurve")
    along = nodes.new("ShaderNodeFloatCurve")
    mul = nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    strength = nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = peak
    links.new(coord.outputs["Generated"], sep.inputs[0])
    links.new(sep.outputs["X"], across.inputs["Value"])
    links.new(sep.outputs["Y"], along.inputs["Value"])
    curve = across.mapping.curves[0]
    curve.points[0].location = (0, 0)
    curve.points[1].location = (1, 0)
    for x, y in ((0.12, 0.85), (0.5, 1.0), (0.88, 0.85)):
        curve.points.new(x, y)
    across.mapping.update()
    curve = along.mapping.curves[0]
    curve.points[0].location = (0, 0.35)
    curve.points[1].location = (1, 1.0)
    curve.points.new(0.55, 0.9)
    along.mapping.update()
    links.new(across.outputs[0], mul.inputs[0])
    links.new(along.outputs[0], mul.inputs[1])
    links.new(mul.outputs[0], strength.inputs[0])
    links.new(strength.outputs[0], em.inputs["Strength"])
    em.inputs["Color"].default_value = (1, 1, 1, 1)
    links.new(em.outputs[0], out.inputs[0])
    return mat


def camera(width, height, center=(0, 0)):
    data = bpy.data.cameras.new("cam")
    data.type = "ORTHO"
    data.ortho_scale = max(width, height)
    data.clip_end = 20
    obj = bpy.data.objects.new("cam", data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = (center[0], -6, center[1])
    obj.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.scene.camera = obj
    return obj


# ---------------------------------------------------------------------------------------
# Door

def rounded_rect_sdf(x, z, w, h, r):
    """Signed distance to a rounded rectangle centred at 0 (negative inside)."""
    qx = np.abs(x) - (w / 2 - r)
    qz = np.abs(z) - (h / 2 - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qz, 0)) + np.minimum(np.maximum(qx, qz), 0) - r


def door_object(w, h, pillow, mat, grid=0.0012, crown=0.0015):
    """The visible front of a door as a smooth height field. The edge rolls away over `pillow`
    metres with continuous curvature (no line where the curve starts), the corners roll
    with a rounder contour, and the whole panel bulges by `crown`, like pressed steel."""
    margin = 0.02
    nx = int(round((w + 2 * margin) / grid)) + 1
    nz = int(round((h + 2 * margin) / grid)) + 1
    xs = np.linspace(-w / 2 - margin, w / 2 + margin, nx)
    zs = np.linspace(-h / 2 - margin, h / 2 + margin, nz)
    X, Z = np.meshgrid(xs, zs)
    if pillow > 0:
        # contours inside round off more and more towards the middle: no mitres at corners
        d = -rounded_rect_sdf(X, Z, w, h, max(CORNER, pillow * 1.4))
        t = np.clip(d / pillow, -1.5, 1)
        depth = pillow * 0.55
        Y = np.where(t >= 0, depth * (1 - (1 - t) ** 3), depth * 3 * t)
        Y = Y - depth
    else:
        Y = np.zeros_like(X)
    Y = Y + crown * (1 - (2 * X / w) ** 2) * (1 - (2 * Z / h) ** 2)
    verts = np.stack([X, -Y, Z], -1).reshape(-1, 3)  # front towards -Y (the camera)
    idx = np.arange(nx * nz).reshape(nz, nx)
    faces = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], -1).reshape(-1, 4)
    mesh = bpy.data.meshes.new("door")
    mesh.from_pydata(verts.tolist(), [], faces.tolist())
    mesh.shade_smooth()
    obj = bpy.data.objects.new("door", mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def finish_material(name):
    kind, srgb = FINISHES[name]
    base = tuple(srgb_to_linear(srgb))
    mat, nodes, links, bsdf = material(name)
    coord = nodes.new("ShaderNodeTexCoord")
    if kind == "enamel":
        bsdf.inputs["Base Color"].default_value = (*base, 1)
        bsdf.inputs["Roughness"].default_value = 0.42
        bsdf.inputs["Coat Weight"].default_value = 1.0
        bsdf.inputs["Coat Roughness"].default_value = 0.035
        bsdf.inputs["Coat IOR"].default_value = 1.5
        # orange peel and the gentle waviness of a pressed steel panel, in the clear coat
        peel = nodes.new("ShaderNodeTexNoise")
        peel.inputs["Scale"].default_value = 900
        peel.inputs["Detail"].default_value = 3
        wave = nodes.new("ShaderNodeTexNoise")
        wave.inputs["Scale"].default_value = 3.5
        wave.inputs["Detail"].default_value = 1
        links.new(coord.outputs["Object"], peel.inputs["Vector"])
        links.new(coord.outputs["Object"], wave.inputs["Vector"])
        bump1 = nodes.new("ShaderNodeBump")
        bump1.inputs["Strength"].default_value = 0.035
        bump1.inputs["Distance"].default_value = 0.0004
        bump2 = nodes.new("ShaderNodeBump")
        bump2.inputs["Strength"].default_value = 0.25
        bump2.inputs["Distance"].default_value = 0.0015
        links.new(wave.outputs["Fac"], bump2.inputs["Height"])
        links.new(peel.outputs["Fac"], bump1.inputs["Height"])
        links.new(bump2.outputs["Normal"], bump1.inputs["Normal"])
        links.new(bump1.outputs["Normal"], bsdf.inputs["Coat Normal"])
    else:
        bsdf.inputs["Base Color"].default_value = (*base, 1)
        bsdf.inputs["Metallic"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = 0.2
        # brushing: fine grooves that run top to bottom (local Y of the door curve)
        mapping = nodes.new("ShaderNodeMapping")
        mapping.inputs["Scale"].default_value = (650, 650, 2.5)  # x, depth, height: grooves run top to bottom
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 1.0
        noise.inputs["Detail"].default_value = 6
        rough_noise = nodes.new("ShaderNodeTexNoise")
        rough_noise.inputs["Scale"].default_value = 6
        links.new(coord.outputs["Object"], mapping.inputs["Vector"])
        links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
        links.new(mapping.outputs["Vector"], rough_noise.inputs["Vector"])
        rough_noise.inputs["Scale"].default_value = 0.35
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.28
        bump.inputs["Distance"].default_value = 0.0003
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        rough = nodes.new("ShaderNodeMapRange")
        rough.inputs["To Min"].default_value = 0.14
        rough.inputs["To Max"].default_value = 0.3
        links.new(rough_noise.outputs["Fac"], rough.inputs["Value"])
        links.new(rough.outputs[0], bsdf.inputs["Roughness"])
    return mat


# ---------------------------------------------------------------------------------------
# Render helpers

def render_linear(path, width_px, height_px):
    sc = bpy.context.scene
    sc.render.resolution_x = width_px
    sc.render.resolution_y = height_px
    sc.render.resolution_percentage = 100
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    f = OpenEXR.File(path)
    ch = f.parts[0].channels
    key = [k for k in ch if k.endswith("Combined")][0]
    px = np.asarray(ch[key].pixels, np.float64)
    os.remove(path)
    return px  # H x W x 4, linear


def to_srgb(linear, exposure):
    return linear_to_srgb(shoulder(linear[..., :3] * exposure))


def save_jpeg(rgb, path, size=None):
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8))
    if size:
        img = img.resize(size, Image.LANCZOS)
    img.save(path, quality=90, optimize=True, progressive=True)
    return os.path.getsize(path) // 1024


def screen_layer(base, full):
    return np.clip(1 - (1 - full) / np.maximum(1 - base, 1e-3), 0, 1)


def measured_exposure(linear, finish):
    """The exposure at which the lit middle of this door shows its own colour."""
    kind, srgb = FINISHES[finish]
    target = srgb_to_linear(srgb).mean()
    h, w = linear.shape[:2]
    patch = linear[int(h * 0.35):int(h * 0.65), int(w * 0.55):int(w * 0.8), :3]
    return float(target / max(np.median(patch.mean(-1)), 1e-6))


_EXPOSURE = {}


def studio_exposure(out):
    """One exposure for the whole studio, like a real shoot: metered on the cream door, so
    dark and metal finishes keep their own brightness and reflections."""
    if "value" in _EXPOSURE:
        return _EXPOSURE["value"]
    cache = os.path.join(out, "_exposure.txt")
    if os.path.exists(cache):
        _EXPOSURE["value"] = float(open(cache).read())
        return _EXPOSURE["value"]
    reset()
    door_object(0.6, 0.6 / (338 / 354), PILLOW, finish_material("cream"))
    camera(0.6, 0.6 / (338 / 354))
    studio(0.6, 0.6 / (338 / 354), strip=False)
    bpy.context.scene.cycles.samples = 16
    value = measured_exposure(render_linear(os.path.join(out, "_tmp.exr"), 320, 335), "cream")
    open(cache, "w").write(str(value))
    _EXPOSURE["value"] = value
    return value


# ---------------------------------------------------------------------------------------
# Jobs

def render_door(out, finish, fmt, pillow=True):
    w, h = FORMATS[fmt] if pillow else (0.6, 0.6)
    tmp = os.path.join(out, "_tmp.exr")
    px = (LONG_SIDE, int(round(LONG_SIDE * h / w))) if w >= h else (int(round(LONG_SIDE * w / h)), LONG_SIDE)
    gpx = (max(2, int(px[0] * GLOSS_SCALE)), max(2, int(px[1] * GLOSS_SCALE)))
    exposure = studio_exposure(out)

    def build(only_strip):
        reset()
        door_object(w, h, PILLOW if pillow else 0.0, finish_material(finish))
        camera(w, h)
        studio(w, h, strip=False, only_strip=only_strip, metal=FINISHES[finish][0] == "metal")

    build(False)
    base_lin = render_linear(tmp, *px)
    build(True)
    strip_lin = render_linear(tmp, *gpx)
    # the strip's light, upscaled, added in linear light like a second exposure
    strip_full = np.stack([np.asarray(Image.fromarray(strip_lin[..., c].astype(np.float32)).resize(px, Image.BICUBIC))
                           for c in range(3)], -1)
    base = to_srgb(base_lin, exposure)
    full = to_srgb(base_lin[..., :3] + np.maximum(strip_full, 0), exposure)
    name = f"door-{finish}-{fmt}" if pillow else f"door-{finish}"
    kb = save_jpeg(base, os.path.join(out, f"{name}.jpg"))
    kb2 = save_jpeg(screen_layer(base, full), os.path.join(out, f"{name}-gloss.jpg"), gpx)
    save_jpeg(full, os.path.join(out, f"_full-{name}.jpg"))
    print(f"{name}: surface {kb} KB, gloss {kb2} KB", flush=True)


# ---------------------------------------------------------------------------------------
# Chrome hardware

def chrome_material():
    mat, nodes, links, bsdf = material("chrome")
    bsdf.inputs["Base Color"].default_value = (0.93, 0.94, 0.95, 1)
    bsdf.inputs["Metallic"].default_value = 1.0
    bsdf.inputs["Roughness"].default_value = 0.035
    return mat


def dark_material():
    mat, nodes, links, bsdf = material("slot")
    bsdf.inputs["Base Color"].default_value = (0.01, 0.01, 0.012, 1)
    bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def enamel_red():
    mat, nodes, links, bsdf = material("badge-enamel")
    bsdf.inputs["Base Color"].default_value = (0.42, 0.012, 0.018, 1)
    bsdf.inputs["Roughness"].default_value = 0.4
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.03
    return mat


def smooth(obj, bevel=0.0, subdiv=2):
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 4
        mod.limit_method = "ANGLE"
    if subdiv:
        mod = obj.modifiers.new("subsurf", "SUBSURF")
        mod.levels = subdiv
        mod.render_levels = subdiv
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def box(center, size, mat, bevel):
    """A rounded block: size = (width x, depth y, height z)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    return smooth(obj, bevel)


def rod(center, radius, length, axis, mat, caps=True):
    """A cylinder along 'x', 'y' or 'z', with round ends."""
    rot = {"x": (0, math.pi / 2, 0), "y": (math.pi / 2, 0, 0), "z": (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=length, location=center, rotation=rot)
    obj = bpy.context.object
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    objs = [obj]
    if caps:
        d = np.array({"x": (1, 0, 0), "y": (0, 1, 0), "z": (0, 0, 1)}[axis]) * length / 2
        for sign in (-1, 1):
            objs.append(ball(tuple(np.array(center) + sign * d), (radius, radius, radius), mat))
    return objs


def ball(center, radii, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1, location=center)
    obj = bpy.context.object
    obj.scale = radii
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def disc(center, radius, depth, mat):
    """A short cylinder facing the camera, with a soft edge."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=depth, location=center,
                                        rotation=(math.pi / 2, 0, 0))
    obj = bpy.context.object
    obj.data.materials.append(mat)
    return smooth(obj, depth * 0.3, 1)


def handle_parts(model, L):
    """Handles of length L (metres), centred at x = 0, z = 0, mounted on the door at y = 0."""
    chrome = chrome_material()
    u = lambda v: v * L
    if model == "fifties":
        box((0, u(-0.014), u(0.33)), (u(0.2), u(0.028), u(0.27)), chrome, u(0.035))
        disc((0, u(-0.04), u(0.37)), u(0.058), u(0.028), chrome)
        disc((0, u(-0.056), u(0.37)), u(0.03), u(0.03), chrome)
        rod((0, u(-0.05), u(0.24)), u(0.04), u(0.05), "y", chrome, caps=False)
        rod((0, u(-0.08), u(-0.08)), u(0.048), u(0.64), "z", chrome)
        rod((0, u(-0.045), u(-0.4)), u(0.04), u(0.07), "y", chrome, caps=False)
        ball((0, u(-0.012), u(-0.4)), (u(0.075), u(0.028), u(0.062)), chrome)
    elif model == "riviera":
        for z in (0.39, -0.39):
            ball((0, u(-0.02), u(z)), (u(0.12), u(0.04), u(0.095)), chrome)
            rod((0, u(-0.07), u(z)), u(0.065), u(0.1), "y", chrome, caps=False)
        rod((0, u(-0.12), 0), u(0.085), u(0.72), "z", chrome)
    elif model == "thaw":
        box((0, u(-0.014), u(0.33)), (u(0.26), u(0.028), u(0.31)), chrome, u(0.03))
        disc((0, u(-0.045), u(0.39)), u(0.062), u(0.04), chrome)
        box((0, u(-0.068), u(0.39)), (u(0.02), u(0.01), u(0.07)), dark_material(), u(0.004))
        rod((0, u(-0.05), u(0.25)), u(0.045), u(0.05), "y", chrome, caps=False)
        rod((0, u(-0.075), u(-0.05)), u(0.054), u(0.6), "z", chrome)
        ball((0, u(-0.075), u(-0.37)), (u(0.072), u(0.072), u(0.072)), chrome)


def badge_parts(width):
    """The Soviet badge: chrome rim, red enamel field, three chrome wings each side.
    `width` is the whole piece; its height is width / 3.6 (as in the app)."""
    h = width / 3.6
    chrome = chrome_material()
    box((0, -0.004, 0), (h * 1.24, 0.008, h * 0.72), chrome, h * 0.08)
    box((0, -0.008, 0), (h * 1.06, 0.006, h * 0.54), enamel_red(), h * 0.05)
    for side in (-1, 1):
        for z, length in ((0.2, 1.05), (0.0, 1.15), (-0.2, 1.05)):
            x0 = side * (h * 0.6 + h * length / 2)
            rod((x0, -0.004, z * h), h * 0.035, h * length, "x", chrome)


def hardware_bounds():
    bpy.context.view_layer.update()  # new objects get their transforms only now
    xs, zs = [], []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith(("catcher", "floor", "ceiling", "back", "left", "right", "window", "strip")):
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ __import__("mathutils").Vector(corner)
            xs.append(world.x)
            zs.append(world.z)
    return min(xs), max(xs), min(zs), max(zs)


def render_hardware(out, name, build, piece_height_px, margins):
    """Renders hardware over a shadow-catching door and prints its frame for the app."""
    reset()
    sc = bpy.context.scene
    sc.render.film_transparent = True
    sc.cycles.samples = 128
    build()
    x0, x1, z0, z1 = hardware_bounds()
    ml, mt, mr, mb = margins
    pw, ph = x1 - x0, z1 - z0
    fx0, fx1 = x0 - ml * ph, x1 + mr * ph
    fz0, fz1 = z0 - mb * ph, z1 + mt * ph
    fw, fh = fx1 - fx0, fz1 - fz0
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0.0005, 0), rotation=(math.pi / 2, 0, 0))
    catcher = bpy.context.object
    catcher.name = "catcher"
    catcher.is_shadow_catcher = True
    catcher.data.materials.append(diffuse_material("door", (0.5, 0.5, 0.5)))
    studio(fw, fh, strip=True)
    camera(fw, fh, center=((fx0 + fx1) / 2, (fz0 + fz1) / 2))
    scale = piece_height_px / ph
    px = (int(round(fw * scale)), int(round(fh * scale)))
    lin = render_linear(os.path.join(out, "_tmp.exr"), *px)
    alpha = np.clip(lin[..., 3], 0, 1)
    rgb = np.where(alpha[..., None] > 1e-4, lin[..., :3] / np.maximum(alpha[..., None], 1e-4), 0)
    rgb = to_srgb(rgb, studio_exposure(out))
    img = np.concatenate([rgb, alpha[..., None]], -1)
    Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(out, f"{name}.png"), optimize=True)
    frame = ((x0 - fx0) / fw, (fz1 - z1) / fh, pw / fw, ph / fh)
    print(f"{name}: {px[0]}x{px[1]}  frame: CGRect(x: {frame[0]:.4f}, y: {frame[1]:.4f}, width: {frame[2]:.4f}, "
          f"height: {frame[3]:.4f}), imageAspect: {px[0]}.0 / {px[1]}.0, pixelHeight: {px[1]}", flush=True)


def render_all_hardware(out):
    L = 0.264  # a handle on the large door: 42 % of its 63 cm
    for model in ("fifties", "riviera", "thaw"):
        render_hardware(out, f"handle-{model}", lambda m=model: handle_parts(m, L), 640, (0.06, 0.05, 0.28, 0.34))
    render_hardware(out, "badge-thaw", lambda: badge_parts(0.37), 200, (0.04, 0.12, 0.12, 0.5))


if __name__ == "__main__":
    out = os.path.abspath(sys.argv[1])
    job = sys.argv[2] if len(sys.argv) > 2 else "test"
    names = sys.argv[3:] or list(FINISHES)
    os.makedirs(out, exist_ok=True)
    if job == "test":
        for finish in names:
            render_door(out, finish, "tall")
    elif job == "doors":
        for finish in names:
            for fmt in FORMATS:
                render_door(out, finish, fmt)
    elif job == "flat":
        for finish in names:
            render_door(out, finish, "square", pillow=False)
    elif job == "hardware":
        render_all_hardware(out)
