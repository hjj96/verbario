import AppIntents
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

/// How a to-do checkbox on a note reacts to a tap.
enum NoteInteraction {
    /// Only drawn (previews, collection).
    case none
    /// The editor toggles the note through the store.
    case app((UUID) -> Void)
    /// The widget toggles the note with an App Intent, right on the Home Screen.
    case widget
}

private struct NoteInteractionKey: EnvironmentKey {
    static let defaultValue: NoteInteraction = .none
}

extension EnvironmentValues {
    var noteInteraction: NoteInteraction {
        get { self[NoteInteractionKey.self] }
        set { self[NoteInteractionKey.self] = newValue }
    }
}

/// A note in any paper shape.
struct NoteView: View {
    let note: NoteContent
    let size: CGSize
    let itemID: UUID

    var body: some View {
        Group {
            switch note.shape {
            case .torn:
                TornNoteView(note: note, size: size, seed: itemID.seed, itemID: itemID)
            case .sticky:
                StickyNoteView(note: note, size: size, itemID: itemID)
            case .card:
                IndexCardNoteView(note: note, size: size, itemID: itemID)
            case .ticket:
                TicketNoteView(note: note, size: size)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if let reminder = note.reminder, !note.isDone, note.shape != .ticket {
                ReminderBadge(date: reminder, height: size.width * 0.075)
                    .padding(.trailing, size.width * 0.07)
                    .padding(.bottom, size.height * 0.07)
            }
        }
    }
}

private let inkColor = Color(hex: 0x2A2521)
private let checkInk = Color(hex: 0x2F55D4)

private struct NoteText: View {
    let text: String
    let font: NoteFont
    let pointSize: CGFloat
    var alignment: TextAlignment = .center
    var isDone = false

    var body: some View {
        Text(text.isEmpty ? " " : text)
            .strikethrough(isDone, color: inkColor.opacity(0.75))
            .font(font.font(size: pointSize * font.sizeFactor))
            .foregroundStyle(inkColor.opacity(isDone ? 0.5 : 0.92))
            .multilineTextAlignment(alignment)
            .lineLimit(4)
            .minimumScaleFactor(0.3)
    }
}

/// Text of a note, with a checkbox in front when the note is a to-do.
private struct NoteBody: View {
    let note: NoteContent
    let itemID: UUID
    let pointSize: CGFloat
    var alignment: TextAlignment = .center

    var body: some View {
        if note.isTask {
            HStack(alignment: .center, spacing: pointSize * 0.35) {
                TaskCheckbox(isDone: note.isDone, itemID: itemID, size: pointSize * 0.9)
                NoteText(text: note.text, font: note.font, pointSize: pointSize, alignment: .leading, isDone: note.isDone)
            }
        } else {
            NoteText(text: note.text, font: note.font, pointSize: pointSize, alignment: alignment)
        }
    }
}

private struct TaskCheckbox: View {
    let isDone: Bool
    let itemID: UUID
    let size: CGFloat

    @Environment(\.noteInteraction) private var interaction

    var body: some View {
        switch interaction {
        case .none:
            box
        case .app(let toggle):
            Button {
                toggle(itemID)
            } label: {
                box
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isDone ? "Сделано" : "Не сделано")
        case .widget:
            Button(intent: ToggleTaskIntent(itemID: itemID)) {
                box
            }
            .buttonStyle(.plain)
        }
    }

    private var box: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                .strokeBorder(inkColor.opacity(0.8), lineWidth: max(1, size * 0.1))
            if isDone {
                CheckMark()
                    .stroke(checkInk, style: StrokeStyle(lineWidth: max(1.2, size * 0.16), lineCap: .round, lineJoin: .round))
                    .frame(width: size * 1.1, height: size * 1.1)
                    .offset(x: size * 0.12, y: -size * 0.12)
            }
        }
        .frame(width: size, height: size)
        .contentShape(Rectangle())
    }
}

/// A quick hand-drawn tick that runs past the box, like a pen would.
private struct CheckMark: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.55))
        path.addQuadCurve(to: CGPoint(x: rect.minX + rect.width * 0.4, y: rect.minY + rect.height * 0.82),
                          control: CGPoint(x: rect.minX + rect.width * 0.28, y: rect.minY + rect.height * 0.66))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - rect.width * 0.02, y: rect.minY + rect.height * 0.08),
                          control: CGPoint(x: rect.minX + rect.width * 0.6, y: rect.minY + rect.height * 0.35))
        return path
    }
}

private struct ReminderBadge: View {
    let date: Date
    let height: CGFloat

    var body: some View {
        let isToday = Calendar.current.isDateInToday(date)
        HStack(spacing: height * 0.2) {
            Image(systemName: "bell.fill")
            Text(date.formatted(date: isToday ? .omitted : .abbreviated, time: .shortened))
        }
        .font(.system(size: height * 0.62, weight: .semibold, design: .rounded))
        .foregroundStyle(inkColor.opacity(0.7))
        .lineLimit(1)
        .fixedSize()
    }
}

// MARK: Torn sheet

private struct TornNoteView: View {
    let note: NoteContent
    let size: CGSize
    let seed: UInt64
    let itemID: UUID

    var body: some View {
        let shape = TornPaperShape(seed: seed)
        ZStack {
            shape.fill(LinearGradient(colors: [note.paper.base, note.paper.shade],
                                      startPoint: .topLeading, endPoint: .bottomTrailing))
            PaperGrain(seed: seed, density: 0.9)
                .clipShape(shape)
            shape.stroke(Color.white.opacity(0.35), lineWidth: max(0.5, size.width * 0.004))
            NoteBody(note: note, itemID: itemID, pointSize: size.width * 0.13)
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
    let itemID: UUID

    var body: some View {
        let curl = size.width * 0.17
        ZStack {
            StickyPaperShape(curl: curl)
                .fill(LinearGradient(colors: [note.paper.base, note.paper.shade],
                                     startPoint: .top, endPoint: .bottom))
            PaperGrain(seed: 31, density: 0.8)
                .clipShape(StickyPaperShape(curl: curl))
            CornerCurlShape(curl: curl)
                .fill(LinearGradient(colors: [Color.white.opacity(0.9), note.paper.shade],
                                     startPoint: .bottomTrailing, endPoint: .topLeading))
                .shadow(color: Color.black.opacity(0.2), radius: curl * 0.12, x: -curl * 0.06, y: -curl * 0.06)
            NoteBody(note: note, itemID: itemID, pointSize: size.width * 0.15)
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
    let itemID: UUID

    var body: some View {
        let paper = note.paper == .cream ? Color(hex: 0xFFFDF7) : note.paper.base
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: size.width * 0.02, style: .continuous)
                .fill(paper)
            PaperGrain(seed: 41, density: 0.6)
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
            NoteBody(note: note, itemID: itemID, pointSize: size.width * 0.12, alignment: .leading)
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
