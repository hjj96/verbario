import SwiftUI

extension PaperColor {
    var base: Color {
        switch self {
        case .cream: return Color(hex: 0xF4EBD6)
        case .butter: return Color(hex: 0xF8E68E)
        case .blush: return Color(hex: 0xF6CDD2)
        case .sky: return Color(hex: 0xD3E5F4)
        case .mint: return Color(hex: 0xD6ECD6)
        case .kraft: return Color(hex: 0xDCC29C)
        }
    }

    var shade: Color {
        switch self {
        case .cream: return Color(hex: 0xE4D6B8)
        case .butter: return Color(hex: 0xEBD266)
        case .blush: return Color(hex: 0xE9B3BB)
        case .sky: return Color(hex: 0xB9D1E8)
        case .mint: return Color(hex: 0xBCDBBD)
        case .kraft: return Color(hex: 0xC8AA7F)
        }
    }
}

extension NoteFont {
    func font(size: CGFloat) -> Font {
        switch self {
        case .caveat:
            return .custom("Caveat-Regular", fixedSize: size).weight(.medium)
        case .marck:
            return .custom("MarckScript-Regular", fixedSize: size)
        case .serif:
            return .system(size: size, weight: .semibold, design: .serif)
        }
    }

    /// Handwriting fonts are drawn smaller than they look, so they get a slightly bigger size.
    var sizeFactor: CGFloat {
        switch self {
        case .caveat: return 1.2
        case .marck: return 1.0
        case .serif: return 0.8
        }
    }
}

/// A note in any paper shape.
struct NoteView: View {
    let note: NoteContent
    let size: CGSize
    let seed: UInt64

    var body: some View {
        switch note.shape {
        case .torn:
            TornNoteView(note: note, size: size, seed: seed)
        case .sticky:
            StickyNoteView(note: note, size: size)
        case .card:
            IndexCardNoteView(note: note, size: size)
        case .ticket:
            TicketNoteView(note: note, size: size)
        }
    }
}

private let inkColor = Color(hex: 0x2A2521)

private struct NoteText: View {
    let text: String
    let font: NoteFont
    let pointSize: CGFloat
    var alignment: TextAlignment = .center

    var body: some View {
        Text(text.isEmpty ? " " : text)
            .font(font.font(size: pointSize * font.sizeFactor))
            .foregroundStyle(inkColor.opacity(0.92))
            .multilineTextAlignment(alignment)
            .lineLimit(4)
            .minimumScaleFactor(0.3)
    }
}

// MARK: Torn sheet

private struct TornNoteView: View {
    let note: NoteContent
    let size: CGSize
    let seed: UInt64

    var body: some View {
        let shape = TornPaperShape(seed: seed)
        ZStack {
            shape.fill(LinearGradient(colors: [note.paper.base, note.paper.shade],
                                      startPoint: .topLeading, endPoint: .bottomTrailing))
            shape.stroke(Color.white.opacity(0.35), lineWidth: max(0.5, size.width * 0.004))
            NoteText(text: note.text, font: note.font, pointSize: size.width * 0.13)
                .padding(.horizontal, size.width * 0.1)
                .padding(.vertical, size.height * 0.14)
                .rotationEffect(.degrees(-3))
        }
        .frame(width: size.width, height: size.height)
    }
}

/// A sheet with ragged top and bottom edges and slightly uneven sides.
struct TornPaperShape: Shape {
    var seed: UInt64

    func path(in rect: CGRect) -> Path {
        var random = SeededRandom(seed: seed)
        let amplitude = rect.width * 0.014
        let step = rect.width * 0.035
        let inset = amplitude
        var points: [CGPoint] = []

        var x = rect.minX + inset
        while x < rect.maxX - inset {
            points.append(CGPoint(x: x, y: rect.minY + inset + random.range(-1...1) * amplitude))
            x += step * random.range(0.6...1.4)
        }
        var y = rect.minY + inset
        while y < rect.maxY - inset {
            points.append(CGPoint(x: rect.maxX - inset + random.range(-0.4...0.4) * amplitude, y: y))
            y += step * random.range(1.0...2.0)
        }
        x = rect.maxX - inset
        while x > rect.minX + inset {
            points.append(CGPoint(x: x, y: rect.maxY - inset + random.range(-1...1) * amplitude))
            x -= step * random.range(0.6...1.4)
        }
        y = rect.maxY - inset
        while y > rect.minY + inset {
            points.append(CGPoint(x: rect.minX + inset + random.range(-0.4...0.4) * amplitude, y: y))
            y -= step * random.range(1.0...2.0)
        }

        var path = Path()
        path.addLines(points)
        path.closeSubpath()
        return path
    }
}

// MARK: Sticky note

private struct StickyNoteView: View {
    let note: NoteContent
    let size: CGSize

    var body: some View {
        let curl = size.width * 0.17
        ZStack {
            StickyPaperShape(curl: curl)
                .fill(LinearGradient(colors: [note.paper.base, note.paper.shade],
                                     startPoint: .top, endPoint: .bottom))
            CornerCurlShape(curl: curl)
                .fill(LinearGradient(colors: [Color.white.opacity(0.9), note.paper.shade],
                                     startPoint: .bottomTrailing, endPoint: .topLeading))
                .shadow(color: Color.black.opacity(0.2), radius: curl * 0.12, x: -curl * 0.06, y: -curl * 0.06)
            NoteText(text: note.text, font: note.font, pointSize: size.width * 0.15)
                .padding(size.width * 0.12)
                .padding(.bottom, curl * 0.3)
        }
        .frame(width: size.width, height: size.height)
    }
}

private struct StickyPaperShape: Shape {
    var curl: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - curl))
        path.addLine(to: CGPoint(x: rect.maxX - curl, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

/// The folded-up bottom right corner of a sticky note.
private struct CornerCurlShape: Shape {
    var curl: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.maxX, y: rect.maxY - curl))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - curl * 0.95, y: rect.maxY - curl * 0.95),
                          control: CGPoint(x: rect.maxX - curl * 0.35, y: rect.maxY - curl * 1.05))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - curl, y: rect.maxY),
                          control: CGPoint(x: rect.maxX - curl * 1.05, y: rect.maxY - curl * 0.35))
        path.closeSubpath()
        return path
    }
}

// MARK: Index card

private struct IndexCardNoteView: View {
    let note: NoteContent
    let size: CGSize

    var body: some View {
        let paper = note.paper == .cream ? Color(hex: 0xFFFDF7) : note.paper.base
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: size.width * 0.02, style: .continuous)
                .fill(paper)
            Canvas { context, canvasSize in
                let lineWidth = max(0.5, canvasSize.width * 0.004)
                var y = canvasSize.height * 0.36
                let gap = canvasSize.height * 0.16
                while y < canvasSize.height - gap * 0.4 {
                    var line = Path()
                    line.move(to: CGPoint(x: 0, y: y))
                    line.addLine(to: CGPoint(x: canvasSize.width, y: y))
                    context.stroke(line, with: .color(Color(hex: 0x7FA7D9).opacity(0.45)), lineWidth: lineWidth)
                    y += gap
                }
                var header = Path()
                header.move(to: CGPoint(x: 0, y: canvasSize.height * 0.2))
                header.addLine(to: CGPoint(x: canvasSize.width, y: canvasSize.height * 0.2))
                context.stroke(header, with: .color(Color(hex: 0xD9534F).opacity(0.55)), lineWidth: lineWidth * 1.3)
            }
            NoteText(text: note.text, font: note.font, pointSize: size.width * 0.12, alignment: .leading)
                .padding(.leading, size.width * 0.08)
                .padding(.trailing, size.width * 0.06)
                .padding(.top, size.height * 0.23)
                .padding(.bottom, size.height * 0.06)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(width: size.width, height: size.height)
    }
}

// MARK: Ticket

private struct TicketNoteView: View {
    let note: NoteContent
    let size: CGSize

    var body: some View {
        let red = Color(hex: 0xB8432F)
        let line = max(0.6, size.width * 0.007)
        ZStack {
            TicketShape(notchRadius: size.height * 0.055, notches: 5)
                .fill(LinearGradient(colors: [note.paper.base, note.paper.shade],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
            Rectangle()
                .strokeBorder(red.opacity(0.75), lineWidth: line)
                .padding(.horizontal, size.width * 0.065)
                .padding(.vertical, size.height * 0.11)
            Rectangle()
                .strokeBorder(red.opacity(0.5), lineWidth: line * 0.6)
                .padding(.horizontal, size.width * 0.08)
                .padding(.vertical, size.height * 0.16)
            Text((note.text.isEmpty ? " " : note.text).uppercased())
                .font(.system(size: size.height * 0.27, weight: .heavy, design: .serif))
                .foregroundStyle(red)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.3)
                .padding(.horizontal, size.width * 0.12)
                .padding(.vertical, size.height * 0.2)
        }
        .frame(width: size.width, height: size.height)
    }
}

/// Paper ticket with perforated, scalloped left and right edges.
private struct TicketShape: Shape {
    var notchRadius: CGFloat
    var notches: Int

    func path(in rect: CGRect) -> Path {
        let r = notchRadius
        let k: CGFloat = 1.33
        let gap = rect.height / CGFloat(notches)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        for index in 0..<notches {
            let cy = rect.minY + gap * (CGFloat(index) + 0.5)
            path.addLine(to: CGPoint(x: rect.maxX, y: cy - r))
            path.addCurve(to: CGPoint(x: rect.maxX, y: cy + r),
                          control1: CGPoint(x: rect.maxX - k * r, y: cy - r),
                          control2: CGPoint(x: rect.maxX - k * r, y: cy + r))
        }
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        for index in (0..<notches).reversed() {
            let cy = rect.minY + gap * (CGFloat(index) + 0.5)
            path.addLine(to: CGPoint(x: rect.minX, y: cy + r))
            path.addCurve(to: CGPoint(x: rect.minX, y: cy - r),
                          control1: CGPoint(x: rect.minX + k * r, y: cy + r),
                          control2: CGPoint(x: rect.minX + k * r, y: cy - r))
        }
        path.closeSubpath()
        return path
    }
}
