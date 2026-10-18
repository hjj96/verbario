// ImageSupport — what the golden-image tests need without ImageIO (portable: the same code runs in the
// Linux pre-flight): a PNG reader (8 / 16-bit RGBA or RGB, non-interlaced, all five row filters, zlib with
// stored / fixed / dynamic Huffman blocks — what tools/export/render-goldens.mjs writes), a PNG writer
// (stored deflate blocks: no compression, for side-by-side review files) and the PLAN §5.1 image metrics.
import Foundation

struct RGBAImage: Equatable {
  let width: Int
  let height: Int
  /// 8-bit: 0…255; 16-bit PNGs keep their raw 16-bit samples (e.g. half-float bit patterns). Row 0 = top.
  var samples: [UInt16]
  let bitDepth: Int

  init(width: Int, height: Int, samples: [UInt16], bitDepth: Int) {
    self.width = width
    self.height = height
    self.samples = samples
    self.bitDepth = bitDepth
  }

  init(width: Int, height: Int, rgba8: [UInt8]) {
    self.init(width: width, height: height, samples: rgba8.map { UInt16($0) }, bitDepth: 8)
  }

  var rgba8: [UInt8] { samples.map { UInt8(truncatingIfNeeded: bitDepth == 16 ? $0 >> 8 : $0) } }
}

struct PNGError: Error, CustomStringConvertible {
  let description: String
  init(_ s: String) { description = "PNG: " + s }
}

enum PNG {
  // ---- reading ---------------------------------------------------------------------------------------------
  static func read(_ url: URL) throws -> RGBAImage { try decode([UInt8](Data(contentsOf: url))) }

  static func decode(_ bytes: [UInt8]) throws -> RGBAImage {
    guard bytes.count > 8, Array(bytes[0..<8]) == [137, 80, 78, 71, 13, 10, 26, 10] else { throw PNGError("bad signature") }
    var pos = 8
    var width = 0, height = 0, depth = 0, colorType = 0
    var idat: [UInt8] = []
    func be32(_ p: Int) -> Int { Int(bytes[p]) << 24 | Int(bytes[p + 1]) << 16 | Int(bytes[p + 2]) << 8 | Int(bytes[p + 3]) }
    while pos + 8 <= bytes.count {
      let len = be32(pos)
      let type = String(bytes: bytes[(pos + 4)..<(pos + 8)], encoding: .ascii) ?? ""
      let data = pos + 8
      guard data + len + 4 <= bytes.count else { throw PNGError("truncated \(type)") }
      switch type {
      case "IHDR":
        width = be32(data); height = be32(data + 4); depth = Int(bytes[data + 8]); colorType = Int(bytes[data + 9])
        guard bytes[data + 12] == 0 else { throw PNGError("interlaced images are not supported") }
      case "IDAT": idat += bytes[data..<(data + len)]
      case "IEND": pos = bytes.count
      default: break
      }
      pos = data + len + 4
    }
    guard width > 0, height > 0, depth == 8 || depth == 16, colorType == 6 || colorType == 2 else {
      throw PNGError("unsupported \(width)×\(height) depth \(depth) colour type \(colorType)")
    }
    let channels = colorType == 6 ? 4 : 3
    let bpp = channels * depth / 8
    let stride = width * bpp
    let raw = try Inflate.zlib(idat)
    guard raw.count >= height * (stride + 1) else { throw PNGError("short image data") }
    var cur = [UInt8](repeating: 0, count: stride)
    var prev = [UInt8](repeating: 0, count: stride)
    var out = [UInt16](repeating: 0, count: width * height * 4)
    for y in 0..<height {
      let o = y * (stride + 1)
      let filter = raw[o]
      for i in 0..<stride {
        let x = raw[o + 1 + i]
        let a = i >= bpp ? Int(cur[i - bpp]) : 0
        let b = Int(prev[i])
        let c = i >= bpp ? Int(prev[i - bpp]) : 0
        var v: Int
        switch filter {
        case 0: v = 0
        case 1: v = a
        case 2: v = b
        case 3: v = (a + b) >> 1
        case 4:
          let p = a + b - c, pa = abs(p - a), pb = abs(p - b), pc = abs(p - c)
          v = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c)
        default: throw PNGError("bad filter \(filter)")
        }
        cur[i] = UInt8(truncatingIfNeeded: Int(x) + v)
      }
      for xpx in 0..<width {
        for ch in 0..<4 {
          let v: UInt16
          if ch == 3 && channels == 3 {
            v = depth == 16 ? 0xFFFF : 0xFF
          } else if depth == 16 {
            let i = xpx * bpp + ch * 2
            v = UInt16(cur[i]) << 8 | UInt16(cur[i + 1])
          } else {
            v = UInt16(cur[xpx * bpp + ch])
          }
          out[(y * width + xpx) * 4 + ch] = v
        }
      }
      swap(&cur, &prev)
    }
    return RGBAImage(width: width, height: height, samples: out, bitDepth: depth)
  }

  // ---- writing (RGBA8, stored deflate blocks) ------------------------------------------------------------------
  static func encode(_ img: RGBAImage) -> [UInt8] {
    let rgba = img.rgba8
    var raw: [UInt8] = []
    raw.reserveCapacity(img.height * (img.width * 4 + 1))
    for y in 0..<img.height {
      raw.append(0)
      raw += rgba[(y * img.width * 4)..<((y + 1) * img.width * 4)]
    }
    var z: [UInt8] = [0x78, 0x01]
    var p = 0
    repeat {
      let n = min(65535, raw.count - p)
      z.append(p + n == raw.count ? 1 : 0)
      z += [UInt8(n & 0xFF), UInt8(n >> 8), UInt8(~n & 0xFF), UInt8((~n >> 8) & 0xFF)]
      z += raw[p..<(p + n)]
      p += n
    } while p < raw.count
    var s1: UInt32 = 1, s2: UInt32 = 0
    for b in raw { s1 = (s1 + UInt32(b)) % 65521; s2 = (s2 + s1) % 65521 }
    z += be(s2 << 16 | s1)
    var ihdr = be(UInt32(img.width)) + be(UInt32(img.height))
    ihdr += [8, 6, 0, 0, 0]
    return [137, 80, 78, 71, 13, 10, 26, 10] + chunk("IHDR", ihdr) + chunk("IDAT", z) + chunk("IEND", [])
  }

  static func write(_ img: RGBAImage, to url: URL) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(encode(img)).write(to: url)
  }

  private static func be(_ v: UInt32) -> [UInt8] { [UInt8(v >> 24), UInt8((v >> 16) & 0xFF), UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)] }

  private static let crcTable: [UInt32] = (0..<256).map { n -> UInt32 in
    var c = UInt32(n)
    for _ in 0..<8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    return c
  }

  private static func chunk(_ type: String, _ data: [UInt8]) -> [UInt8] {
    let td = Array(type.utf8) + data
    var c: UInt32 = 0xFFFF_FFFF
    for b in td { c = crcTable[Int((c ^ UInt32(b)) & 0xFF)] ^ (c >> 8) }
    return be(UInt32(data.count)) + td + be(c ^ 0xFFFF_FFFF)
  }
}

/// RFC 1950 / 1951 decoder (stored, fixed and dynamic Huffman blocks).
enum Inflate {
  private struct Bits {
    let d: [UInt8]
    var pos = 0      // byte
    var bit = 0      // bit within the byte
    init(_ d: [UInt8], start: Int) { self.d = d; pos = start }
    mutating func read(_ n: Int) throws -> Int {
      var v = 0
      for i in 0..<n {
        guard pos < d.count else { throw PNGError("inflate: out of data") }
        v |= Int((d[pos] >> UInt8(bit)) & 1) << i
        bit += 1
        if bit == 8 { bit = 0; pos += 1 }
      }
      return v
    }
    mutating func align() { if bit != 0 { bit = 0; pos += 1 } }
  }

  /// Canonical Huffman table: (count per length, symbols sorted by code).
  private struct Huffman {
    var counts = [Int](repeating: 0, count: 16)
    var symbols: [Int] = []
    init(lengths: [Int]) {
      for l in lengths { counts[l] += 1 }
      counts[0] = 0
      var offs = [Int](repeating: 0, count: 16)
      for i in 1..<16 { offs[i] = offs[i - 1] + counts[i - 1] }
      symbols = [Int](repeating: 0, count: lengths.count)
      for (s, l) in lengths.enumerated() where l != 0 {
        symbols[offs[l]] = s
        offs[l] += 1
      }
    }
    func decode(_ b: inout Bits) throws -> Int {
      var code = 0, first = 0, index = 0
      for len in 1..<16 {
        code |= try b.read(1)
        let count = counts[len]
        if code - count < first { return symbols[index + (code - first)] }
        index += count
        first += count
        first <<= 1
        code <<= 1
      }
      throw PNGError("inflate: bad code")
    }
  }

  private static let lenBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
  private static let lenExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
  private static let distBase = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
                                 4097, 6145, 8193, 12289, 16385, 24577]
  private static let distExtra = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

  static func zlib(_ data: [UInt8]) throws -> [UInt8] {
    guard data.count >= 2, (Int(data[0]) << 8 | Int(data[1])) % 31 == 0, data[0] & 0x0F == 8 else { throw PNGError("inflate: bad zlib header") }
    var b = Bits(data, start: 2)
    var out: [UInt8] = []
    var final = 0
    repeat {
      final = try b.read(1)
      let type = try b.read(2)
      switch type {
      case 0:
        b.align()
        guard b.pos + 4 <= data.count else { throw PNGError("inflate: truncated stored block") }
        let len = Int(data[b.pos]) | Int(data[b.pos + 1]) << 8
        b.pos += 4
        guard b.pos + len <= data.count else { throw PNGError("inflate: truncated stored block") }
        out += data[b.pos..<(b.pos + len)]
        b.pos += len
      case 1:
        var l = [Int](repeating: 8, count: 288)
        for i in 144..<256 { l[i] = 9 }
        for i in 256..<280 { l[i] = 7 }
        try codes(&b, &out, Huffman(lengths: l), Huffman(lengths: [Int](repeating: 5, count: 30)))
      case 2:
        let hlit = try b.read(5) + 257, hdist = try b.read(5) + 1, hclen = try b.read(4) + 4
        let order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
        var cl = [Int](repeating: 0, count: 19)
        for i in 0..<hclen { cl[order[i]] = try b.read(3) }
        let clh = Huffman(lengths: cl)
        var lengths: [Int] = []
        while lengths.count < hlit + hdist {
          let sym = try clh.decode(&b)
          switch sym {
          case 0..<16: lengths.append(sym)
          case 16:
            guard let last = lengths.last else { throw PNGError("inflate: repeat without length") }
            lengths += [Int](repeating: last, count: 3 + (try b.read(2)))
          case 17: lengths += [Int](repeating: 0, count: 3 + (try b.read(3)))
          default: lengths += [Int](repeating: 0, count: 11 + (try b.read(7)))
          }
        }
        try codes(&b, &out, Huffman(lengths: Array(lengths[0..<hlit])), Huffman(lengths: Array(lengths[hlit..<(hlit + hdist)])))
      default:
        throw PNGError("inflate: bad block type")
      }
    } while final == 0
    return out
  }

  private static func codes(_ b: inout Bits, _ out: inout [UInt8], _ lit: Huffman, _ dist: Huffman) throws {
    while true {
      let sym = try lit.decode(&b)
      if sym < 256 { out.append(UInt8(sym)); continue }
      if sym == 256 { return }
      let li = sym - 257
      guard li < lenBase.count else { throw PNGError("inflate: bad length symbol") }
      let len = lenBase[li] + (try b.read(lenExtra[li]))
      let di = try dist.decode(&b)
      guard di < distBase.count else { throw PNGError("inflate: bad distance symbol") }
      let d = distBase[di] + (try b.read(distExtra[di]))
      guard d <= out.count else { throw PNGError("inflate: distance too far") }
      let start = out.count - d
      for k in 0..<len { out.append(out[start + k]) }
    }
  }
}

// ---- metrics (PLAN §5.1) -----------------------------------------------------------------------------------------
struct ImageDiff: CustomStringConvertible {
  var ssim: Double          // mean SSIM of the luma (8×8 windows, stride 4)
  var psnr: Double          // over RGB, dB
  var maxAbs: Int           // max |Δ| over RGB samples (0…255)
  var meanAbs: Double       // mean |Δ| over RGB samples
  var description: String {
    String(format: "SSIM %.4f, PSNR %.2f dB, max |Δ| %d/255, mean |Δ| %.3f/255", ssim, psnr, maxAbs, meanAbs)
  }
}

enum ImageMetrics {
  static func luma(_ img: RGBAImage) -> [Double] {
    let p = img.rgba8
    return (0..<(img.width * img.height)).map { i in
      0.2126 * Double(p[i * 4]) + 0.7152 * Double(p[i * 4 + 1]) + 0.0722 * Double(p[i * 4 + 2])
    }
  }

  static func compare(_ a: RGBAImage, _ b: RGBAImage) -> ImageDiff {
    precondition(a.width == b.width && a.height == b.height, "image sizes differ")
    let pa = a.rgba8, pb = b.rgba8
    var maxAbs = 0, sum = 0.0, sq = 0.0
    for i in 0..<(a.width * a.height) {
      for c in 0..<3 {
        let d = abs(Int(pa[i * 4 + c]) - Int(pb[i * 4 + c]))
        maxAbs = max(maxAbs, d)
        sum += Double(d)
        sq += Double(d * d)
      }
    }
    let n = Double(a.width * a.height * 3)
    let mse = sq / n
    let psnr = mse == 0 ? Double.infinity : 10 * log10(255 * 255 / mse)
    return ImageDiff(ssim: ssim(luma(a), luma(b), width: a.width, height: a.height), psnr: psnr, maxAbs: maxAbs, meanAbs: sum / n)
  }

  /// Mean SSIM (Wang et al. 2004) over 8×8 windows with stride 4, C1 = (0.01·255)², C2 = (0.03·255)².
  static func ssim(_ x: [Double], _ y: [Double], width w: Int, height h: Int) -> Double {
    let c1 = (0.01 * 255) * (0.01 * 255), c2 = (0.03 * 255) * (0.03 * 255)
    var total = 0.0, count = 0
    var wy = 0
    while wy + 8 <= h {
      var wx = 0
      while wx + 8 <= w {
        var mx = 0.0, my = 0.0
        for j in 0..<8 { for i in 0..<8 { let k = (wy + j) * w + wx + i; mx += x[k]; my += y[k] } }
        mx /= 64; my /= 64
        var vx = 0.0, vy = 0.0, cxy = 0.0
        for j in 0..<8 {
          for i in 0..<8 {
            let k = (wy + j) * w + wx + i
            let dx = x[k] - mx, dy = y[k] - my
            vx += dx * dx; vy += dy * dy; cxy += dx * dy
          }
        }
        vx /= 63; vy /= 63; cxy /= 63
        total += ((2 * mx * my + c1) * (2 * cxy + c2)) / ((mx * mx + my * my + c1) * (vx + vy + c2))
        count += 1
        wx += 4
      }
      wy += 4
    }
    return count > 0 ? total / Double(count) : 1
  }
}
