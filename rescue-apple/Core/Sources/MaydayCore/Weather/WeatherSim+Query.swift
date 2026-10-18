// WeatherSim as the heli / camera see it (Heli/SimContext.swift WeatherQuery): `ctx.weather.windAt(x, z)`
// and the weather.state fields they read. The real weather always defines every field, so the readout is
// never nil (the stubs' `{}` case) and the palette entries are always present.

extension WeatherSim: WeatherQuery {
  public var readout: WeatherReadout? {
    let st = state
    let p = st.palette
    return WeatherReadout(
      turbulence: st.turbulence, rain: st.rain, fog: st.fog, intensity: st.intensity, night: st.night, flash: st.flash,
      stElmo: st.stElmo, sunDir: st.sunDir, sunDirShadow: st.sunDirShadow,
      palette: HeliPaletteReadout(ambient: Color3(p.ambient.r, p.ambient.g, p.ambient.b), sun: Color3(p.sun.r, p.sun.g, p.sun.b),
                                  sky: Color3(p.sky.r, p.sky.g, p.sky.b), sunIntensity: p.sunIntensity,
                                  ambientIntensity: p.ambientIntensity))
  }
}
