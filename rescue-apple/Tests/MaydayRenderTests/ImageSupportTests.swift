// ImageSupportTests — the portable PNG reader / writer and the image metrics the golden-frame tests rely on
// (ImageSupport.swift). Tests/Goldens/png/selftest{8,16}.png are written by render-goldens.mjs from the
// formulas below with every PNG row filter (0–4) in turn.
import XCTest
@testable import MaydayApp

final class ImageSupportTests: XCTestCase {
  private func pattern8(_ x: Int, _ y: Int, _ c: Int) -> UInt16 { UInt16((x * 7 + y * 13 + c * 31 + ((x * y) % 17)) & 0xFF) }
  private func pattern16(_ x: Int, _ y: Int, _ c: Int) -> UInt16 { UInt16((x * 1031 + y * 7919 + c * 13 + x * y) & 0xFFFF) }

  func testReadsTheExporterPNGs() throws {
    for (file, depth) in [("png/selftest8.png", 8), ("png/selftest16.png", 16)] {
      let img = try PNG.read(try Goldens.url(file))
      XCTAssertEqual(img.width, 37)
      XCTAssertEqual(img.height, 23)
      XCTAssertEqual(img.bitDepth, depth)
      var bad = 0
      for y in 0..<23 {
        for x in 0..<37 {
          for c in 0..<4 where img.samples[(y * 37 + x) * 4 + c] != (depth == 8 ? pattern8(x, y, c) : pattern16(x, y, c)) { bad += 1 }
        }
      }
      XCTAssertEqual(bad, 0, "\(file): \(bad) samples differ")
    }
  }

  func testWriterRoundTripAndMetrics() throws {
    var px = [UInt8](repeating: 0, count: 64 * 40 * 4)
    var s: UInt32 = 12345
    for i in 0..<px.count {
      s = s &* 1_664_525 &+ 1_013_904_223
      px[i] = i % 4 == 3 ? 255 : UInt8(truncatingIfNeeded: (s >> 24) / 2 + UInt32((i / 4) % 64))
    }
    let img = RGBAImage(width: 64, height: 40, rgba8: px)
    let back = try PNG.decode(PNG.encode(img))
    XCTAssertEqual(back.rgba8, px)
    let same = ImageMetrics.compare(img, back)
    XCTAssertEqual(same.ssim, 1, accuracy: 1e-12)
    XCTAssertEqual(same.maxAbs, 0)
    XCTAssertEqual(same.psnr, .infinity)
    var shifted = px
    for i in stride(from: 0, to: shifted.count, by: 4) { shifted[i] = UInt8(min(255, Int(shifted[i]) + 3)) }
    let d = ImageMetrics.compare(img, RGBAImage(width: 64, height: 40, rgba8: shifted))
    XCTAssertLessThanOrEqual(d.maxAbs, 3)
    XCTAssertGreaterThan(d.meanAbs, 0.5)
    XCTAssertGreaterThan(d.ssim, 0.9)
    XCTAssertLessThan(d.ssim, 1)
    let flat = RGBAImage(width: 64, height: 40, rgba8: [UInt8](repeating: 128, count: px.count))
    XCTAssertLessThan(ImageMetrics.compare(img, flat).ssim, 0.2)
  }
}
