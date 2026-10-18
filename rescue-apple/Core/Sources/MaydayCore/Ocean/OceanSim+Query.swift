// OceanSim as the heli / camera see it (Heli/SimContext.swift OceanQuery): `ctx.ocean.heightAt / normalAt`,
// the splash / downwash / searchlight writers and the lamp glints (heli/lights.js). heightAt, normalAt,
// splash and setDownwash are OceanSim's own methods; the two below adapt the argument shapes.

extension OceanSim: OceanQuery {
  /// setSearchlight(pos, dir, cosOuter, intensity) with every argument given.
  public func setSearchlight(origin: V3, dir: V3, cosOuter: Double, level: Double) {
    setSearchlight(origin, dir, cosOuter, level)
  }

  /// addGlint with a three Color (linear working-space components).
  public func addGlint(_ x: Double, _ z: Double, _ radius: Double, _ intensity: Double, _ color: Color3) {
    addGlint(x, z, radius, intensity, PaletteColor(color.r, color.g, color.b))
  }

  public var acceptsGlints: Bool { true }
}
