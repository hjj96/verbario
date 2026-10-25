// Russian text helpers vs the web: radio/words.js + mission/text.js (Tests/Vectors/text/ru_words.json,
// export-vectors.mjs), the Intl ru-RU formatting of mission/text.js + ui/common/fmt.js (text/ru_format.json),
// ui/common/typewriter.js (text/typewriter.json) and ui/common/keys.js keyLabel (text/keys.json) — the last
// three from tools/export/export-mission.mjs. Strings byte-exact, numbers bitwise.
import XCTest
@testable import MaydayCore

final class TextTests: XCTestCase {
  private static var catalog: DataCatalog?

  private func load() throws -> (RuWords, RuText, RuFormat) {
    if TextTests.catalog == nil { TextTests.catalog = try VectorLoader.catalog() }
    let c = try XCTUnwrap(TextTests.catalog)
    return (try RuWords(catalog: c), try RuText(catalog: c), try RuFormat(catalog: c))
  }

  /// Rows [input…, expected string]: checks `f(row)` against the last element.
  private func check(_ rows: JSONValue, _ what: String, file: StaticString = #filePath, line: UInt = #line, _ f: ([JSONValue]) -> String) {
    var bad = 0
    for r in rows.array ?? [] {
      guard let a = r.array, let want = a.last?.string else { continue }
      let got = f(a)
      if got != want {
        bad += 1
        if bad <= 3 { XCTFail("\(what)(\(a.dropLast().map { $0.jsonStringify() }.joined(separator: ", "))): «\(got)» ≠ «\(want)»", file: file, line: line) }
      }
    }
    if bad > 3 { XCTFail("\(what): \(bad) mismatches", file: file, line: line) }
    XCTAssertGreaterThan(rows.count, 0, "\(what): no rows", file: file, line: line)
  }

  private func d(_ v: JSONValue) -> Double { v.double ?? .nan }

  func testRadioWords() throws {
    let (W, _, _) = try load()
    let v = try VectorLoader.load("text/ru_words").data["radio"]
    check(v["numberWords"], "numberWords") { W.numberWords(d($0[0])) }
    check(v["numberGenitive"], "numberGenitive") { W.numberGenitive(d($0[0])) }
    check(v["plural"], "plural") { RuWords.plural(d($0[0]), "метр", "метра", "метров") }
    check(v["countWords"], "countWords") { W.countWords(d($0[0])) }
    check(v["peopleWords"], "peopleWords") { W.peopleWords(d($0[0])) }
    check(v["distWords"], "distWords") { W.distWords(d($0[0])) }
    check(v["metresWords"], "metresWords") { W.metresWords(d($0[0])) }
    check(v["metresGenitive"], "metresGenitive") { W.metresGenitive(d($0[0])) }
    check(v["degreesWords"], "degreesWords") { W.degreesWords(d($0[0])) }
    check(v["fromWords"], "fromWords") { W.fromWords(d($0[0])) }
    check(v["toWords"], "toWords") { W.toWords(d($0[0])) }
    check(v["headingWords"], "headingWords") { W.headingWords(d($0[0])) }
    check(v["squareOf"], "squareOf") { W.squareOf(d($0[0]), d($0[1])) }
    check(v["clockWords"], "clockWords") { W.clockWords(d($0[0]), d($0[1]), d($0[2])) }
    check(v["sideWords"], "sideWords") { RuWords.sideWords(d($0[0]), d($0[1]), d($0[2])) }
    check(v["countSeconds"], "countSeconds") { W.countSeconds(d($0[0])) }
    check(v["kmWords"], "kmWords") { W.kmWords(d($0[0])) }
    for r in v["bearingDeg"].array ?? [] {
      assertBitEqual(RuWords.bearingDeg(d(r[0]), d(r[1])), d(r[2]), "bearingDeg(\(d(r[0])), \(d(r[1])))")
    }
    check(v["fill"], "fill") { a in
      var vars = [String: String]()
      for (k, x) in a[1].object?.entries ?? [] { vars[k] = x.jsToString }
      return RuWords.fill(a[0].string ?? "", vars)
    }
  }

  func testMissionText() throws {
    let (_, T, _) = try load()
    let v = try VectorLoader.load("text/ru_words").data["mission"]
    check(v["numberWords"], "numberWords") { T.numberWords(d($0[0])) }
    check(v["plural"], "plural") { RuText.plural(d($0[0]), "человек", "человека", "человек") }
    check(v["peopleCollective"], "peopleCollective") { T.peopleCollective(d($0[0])) }
    check(v["peopleWords"], "peopleWords") { T.peopleWords(d($0[0])) }
    check(v["compass8"], "compass8") { T.compass8(d($0[0])) }
    check(v["fromWords"], "fromWords") { T.fromWords(d($0[0])) }
    check(v["squareOf"], "squareOf") { T.squareOf(d($0[0]), d($0[1])) }
    for r in v["windFromDeg"].array ?? [] { assertBitEqual(RuText.windFromDeg(d(r[0]), d(r[1])), d(r[2]), "windFromDeg") }
    for r in v["clockOf"].array ?? [] { assertBitEqual(RuText.clockOf(d(r[0]), d(r[1]), d(r[2])), d(r[3]), "clockOf") }
    for r in v["seaState"].array ?? [] { assertBitEqual(T.seaState(d(r[0])), d(r[1]), "seaState(\(d(r[0])))") }
    for r in v["beaufort"].array ?? [] { assertBitEqual(T.beaufort(d(r[0])), d(r[1]), "beaufort(\(d(r[0])))") }
    for r in v["clockToDay"].array ?? [] { assertBitEqual(RuText.clockToDay(r[0].string), d(r[1]), "clockToDay(\(r[0].jsonStringify()))") }
  }

  func testIntlRuRU() throws {
    let v = try VectorLoader.load("text/ru_format").data
    var n = 0
    for r in v["intl"].array ?? [] {
      let x = d(r[0])
      XCTAssertEqual(RuFormat.nf0(x), r[1].string, "NF0(\(x))")
      XCTAssertEqual(RuFormat.nf1o(x), r[2].string, "NF(0…1)(\(x))")
      XCTAssertEqual(RuFormat.nf1(x), r[3].string, "NF(1…1)(\(x))")
      n += 1
    }
    XCTAssertGreaterThan(n, 200)
  }

  func testFmt() throws {
    let (_, _, F) = try load()
    let v = try VectorLoader.load("text/ru_format").data["fmt"]
    check(v["num0"], "num0") { RuFormat.num0(d($0[0])) }
    check(v["num1"], "num1") { RuFormat.num1(d($0[0])) }
    check(v["num1o"], "num1o") { RuFormat.num1o(d($0[0])) }
    check(v["mmss"], "mmss") { RuFormat.mmss(d($0[0])) }
    check(v["mss"], "mss") { RuFormat.mss(d($0[0])) }
    check(v["timecode"], "timecode") { RuFormat.timecode(d($0[0])) }
    check(v["clockOf"], "clockOf") { RuFormat.clockOfDay(d($0[0])) }
    check(v["distU"], "distU") { RuFormat.distU(d($0[0])) }
    check(v["distL"], "distL") { RuFormat.distL(d($0[0])) }
    check(v["visU"], "visU") { RuFormat.visU(d($0[0])) }
    check(v["deg3"], "deg3") { RuFormat.deg3(d($0[0])) }
    check(v["compass8"], "compass8") { F.compass8(d($0[0])) }
    check(v["ballsU"], "ballsU") { RuFormat.ballsU(d($0[0])) }
    check(v["guillemets"], "guillemets") { RuFormat.guillemets($0[0].string ?? "") }
    for r in v["beaufortOf"].array ?? [] { assertBitEqual(F.beaufortOf(d(r[0])), d(r[1]), "beaufortOf") }
    for r in v["douglasOf"].array ?? [] { assertBitEqual(F.douglasOf(d(r[0])), d(r[1]), "douglasOf") }
  }

  func testMissionFormat() throws {
    let (_, T, _) = try load()
    let v = try VectorLoader.load("text/ru_format").data["mission"]
    for r in v["fmtNum"].array ?? [] {
      XCTAssertEqual(RuText.fmtNum(d(r[0])), r[1].string, "fmtNum(\(d(r[0])))")
      XCTAssertEqual(RuText.fmtNum(d(r[0]), 1), r[2].string, "fmtNum(\(d(r[0])), 1)")
    }
    check(v["fmtTime"], "fmtTime") { RuText.fmtTime(d($0[0])) }
    check(v["fmtPar"], "fmtPar") { RuText.fmtPar(d($0[0])) }
    check(v["fmtPct"], "fmtPct") { RuText.fmtPct(d($0[0])) }
    check(v["fmtKm"], "fmtKm") { RuText.fmtKm(d($0[0])) }
    check(v["peopleCollective"], "peopleCollective") { T.peopleCollective(d($0[0])) }
    check(v["windLine"], "windLine") { T.windLine(d($0[0]), d($0[1])) }
    check(v["conditionsLine"], "conditionsLine") { T.conditionsLine($0[0].string, d($0[1])) }
    check(v["clockWords"], "clockWords") { T.clockWords(d($0[0])) }
    let pad = { (p: JSONValue) -> RuText.PadNaming? in p.isNull ? nil : RuText.PadNaming(type: p["type"].string, name: p["name"].string) }
    check(v["padGenitive"], "padGenitive") { RuText.padGenitive(pad($0[0])) }
    check(v["padName"], "padName") { RuText.padName(pad($0[0])) }
    for r in v["groupWords"].array ?? [] {
      let g = T.groupWordsFor(r[0].string)
      XCTAssertEqual([g.nom, g.acc, g.short], [r[1]["nom"].string ?? "", r[1]["acc"].string ?? "", r[1]["short"].string ?? ""], "groupWords(\(r[0]))")
    }
  }

  func testTypewriter() throws {
    let v = try VectorLoader.load("text/typewriter").data
    for s in v["scripts"].array ?? [] {
      var tw = Typewriter(msPerChar: s["msPerChar"].double ?? 0)
      tw.start(s["text"].string ?? "", delay: d(s["delay"]))
      let rows = s["rows"].array ?? []
      XCTAssertEqual(tw.shown, rows.first?[1].int)
      for r in rows.dropFirst() {
        var typed = [[JSONValue]]()
        if r[0].string == "finish" {
          tw.finish()
        } else {
          let step = tw.update(d(r[0]))
          for i in step.typed { typed.append([.number(Double(i)), .string(tw.unit(at: i))]) }
        }
        let label = "«\(s["text"].string ?? "")» step \(r[0].jsonStringify())"
        XCTAssertEqual(tw.shown, r[1].int, label)
        XCTAssertEqual(tw.done, r[2].bool, label)
        XCTAssertEqual(tw.visible, r[3].string, label)
        XCTAssertEqual(JSONValue.array(typed.map { .array($0) }), r[4], label)
      }
    }
  }

  func testKeyLabels() throws {
    let c = try VectorLoader.catalog()
    let K = try KeyLabels(catalog: c)
    let v = try VectorLoader.load("text/keys").data
    check(v["labels"], "keyLabel") { K.label($0[0].string) }
  }
}
