// BootstrapCamera — the "documentary escort drone" framing (follow + attract modes).
// port: rescue/src/systems/camera.js CameraRig.update() — targets, springs and placement:
//   follow : H = clamp(110 + alt + 1.2·speed, 105, 230) + 15·intensity, winch 95 m; zoom ×1/×0.8/×1.25 (Z);
//            tilt 14° calm → 18° storm, 10° winch; focus spring ω 4 with look-ahead v·0.7 s ≤ 25 m;
//            heli held at NDC y = +0.1 (≈55 % screen height); tilt spring ω 2.6 ζ 0.75 (1/60 substeps);
//            height spring critical ω 2.2; never shows the horizon (tilt + FOV/2 ≤ 55° − 2°).
//   attract: 300 m, tilt 16°, slow drift (title screen).
// Placement: camera at (f.x, H, f.z + H·tan T) looking at (f.x, 0, f.z), up +Y, FOV 40°, near 2, far 1200.
//
// BOOTSTRAP: MaydayCore/Camera/CameraRig.swift is the parity port (shake layers, reveal, slow-mo,
// FOV punches, letterbox moments, photo free-cam). Constants from camera.json / game.json.
import Foundation

final class BootstrapCamera {
  enum Mode { case follow, attract }

  let baseFov: Double
  let zooms: [Double]
  let heliScreenY: Double
  let near: Double
  let far: Double
  var mode: Mode = .follow
  var zoomIndex = 0
  var zoom = 1.0
  var height = 150.0
  var tilt = 14.0 * Double.pi / 180
  var tiltV = 0.0
  var hv = 0.0
  var focus = SIMD2<Double>(0, 0)      // focus point (x, z)
  var fv = SIMD2<Double>(0, 0)
  var snap = true
  var t = 0.0
  var fov: Double
  var letterbox = 0.0
  var attractLetterbox: Double

  /// camera: camera.json data["camera"]; game: game.json data["derived"]["camera"].
  init(camera c: BootJSON, game g: BootJSON) {
    baseFov = c["BASE_FOV"].double(or: g["fovDeg"].double(or: 40))
    let z = c["ZOOMS"].doubles
    zooms = z.isEmpty ? [1] : z
    heliScreenY = c["HELI_SCREEN_Y"].double(or: 0.1)
    attractLetterbox = c["ATTRACT_LB"].double(or: 0.47)
    near = g["near"].double(or: 2)
    far = g["far"].double(or: 1200)
    fov = baseFov
  }

  /// camera.js crit(): exact critically damped spring step.
  private static func crit(_ x: Double, _ v: Double, _ target: Double, _ omega: Double, _ dt: Double) -> (x: Double, v: Double) {
    let y = x - target
    let e = exp(-omega * dt)
    let k = v + omega * y
    return (target + (y + k * dt) * e, (v - omega * k * dt) * e)
  }

  func cycleZoom() {
    zoomIndex = (zoomIndex + 1) % zooms.count
  }

  /// heli: position (y = altitude), velocity; storm: weather intensity 0..1.
  func update(dt rawDt: Double, heli hp: SIMD3<Double>, velocity hvel: SIMD3<Double>, storm: Double) -> CameraPose {
    let dt = rawDt > 0 ? rawDt : 0
    let deg = Double.pi / 180
    t += dt
    zoom += (zooms[zoomIndex] - zoom) * (1 - exp(-dt * 3))

    var Ht: Double
    var tiltT: Double
    var wFocus = 4.0
    var wH = 2.2
    var lb = 0.0
    var tgt = SIMD2<Double>(hp.x, hp.z)
    switch mode {
    case .attract:
      Ht = 300
      tiltT = 16
      wFocus = 0.7
      wH = 1.6
      lb = attractLetterbox
      tgt.x += 40 * sin(t * 0.047) + 14 * sin(t * 0.11)
      tgt.y += 28 * sin(t * 0.033 + 1.3) - 15
    case .follow:
      let alt = max(0, hp.y)
      let speed = (hvel.x * hvel.x + hvel.z * hvel.z).squareRoot()
      Ht = min(max(110 + alt + 1.2 * speed, 105), 230) + 15 * storm
      Ht *= zoom
      tiltT = 14 + 4 * storm
      // look-ahead (velocity × 0.7 s, ≤ 25 m)
      var lx = hvel.x * 0.7
      var lz = hvel.z * 0.7
      let l = (lx * lx + lz * lz).squareRoot()
      if l > 25 {
        lx *= 25 / l
        lz *= 25 / l
      }
      tgt.x += lx
      tgt.y += lz
    }
    let step = dt / 0.8
    letterbox += min(max(lb - letterbox, -step), step)
    // never show the horizon: tilt + FOV/2 ≤ 55° (with margin)
    tiltT = min(tiltT, 55 - fov / 2 - 2)

    if snap {
      tilt = tiltT * deg
      tiltV = 0
      height = Ht
      hv = 0
    } else {
      let w = 2.6
      let z = 0.75
      var rem = dt
      while rem > 0 {
        let s = min(rem, 1.0 / 60.0)
        tiltV += (w * w * (tiltT * deg - tilt) - 2 * z * w * tiltV) * s
        tilt += tiltV * s
        rem -= s
      }
      let r = BootstrapCamera.crit(height, hv, Ht, wH, dt)
      height = r.x
      hv = r.v
    }
    let T = tilt
    let H = max(20, height)

    // keep the heli at ~55 % screen height: shift the focus so its projection lands at NDC y = +0.1
    if mode == .follow {
      let delta = atan(heliScreenY * tan((fov / 2) * deg))
      let hy = min(max(hp.y, 0), H - 10)
      tgt.y += (H - hy) * tan(T + delta) - H * tan(T)
    }

    let dx = tgt.x - focus.x
    let dz = tgt.y - focus.y
    if snap || (dx * dx + dz * dz).squareRoot() > 450 {
      focus = tgt
      fv = SIMD2<Double>(0, 0)
      snap = false
    } else {
      let rx = BootstrapCamera.crit(focus.x, fv.x, tgt.x, wFocus, dt)
      focus.x = rx.x
      fv.x = rx.v
      let rz = BootstrapCamera.crit(focus.y, fv.y, tgt.y, wFocus, dt)
      focus.y = rz.x
      fv.y = rz.v
    }
    fov = baseFov
    height = H
    let pos = SIMD3<Double>(focus.x, H, focus.y + H * tan(T))
    let target = SIMD3<Double>(focus.x, 0, focus.y)
    return CameraPose(position: pos, target: target, fovDeg: fov, near: near, far: far,
                      heightM: H, tiltDeg: T / deg, letterbox: letterbox)
  }
}

struct CameraPose {
  var position: SIMD3<Double>
  var target: SIMD3<Double>
  var fovDeg: Double
  var near: Double
  var far: Double
  var heightM: Double
  var tiltDeg: Double
  var letterbox: Double
}
