import SwiftUI

/// The cut-out studio: pick objects in a photo by tapping them (or trace one with a finger)
/// and turn them into stickers, holographic stickers or thick magnets. The whole photo can
/// also become a card or a round / heart-shaped magnet.
struct PhotoStudioView: View {
    let source: UIImage
    let onPlaced: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(MotionLight.self) private var motion
    @Environment(\.dismiss) private var dismiss

    enum Mode: String, CaseIterable, Identifiable {
        case object, lasso, whole

        var id: String { rawValue }

        var title: String {
            switch self {
            case .object: return "Object"
            case .lasso: return "Trace"
            case .whole: return "Whole photo"
            }
        }
    }

    @State private var mode: Mode = .object
    @State private var session: CutoutSession?
    @State private var isAnalyzing = true
    @State private var selection: Set<Int> = []
    @State private var highlight: UIImage?
    @State private var allObjects: UIImage?
    @State private var lassoPoints: [CGPoint] = []
    @State private var isDrawing = false
    @State private var lassoCut: UIImage?

    @State private var finish: PhotoStyle = .sticker
    @State private var wholeStyle: PhotoStyle = .polaroid
    @State private var caption = ""
    @State private var border: StickerBorder = .thin
    @State private var separately = false
    @State private var results: [UIImage] = []
    @State private var shareURLs: [URL] = []
    @State private var card: UIImage?
    @State private var square: UIImage?
    @State private var renderID = 0
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var isCutMode: Bool { mode != .whole }

    private var wholeImage: UIImage? {
        wholeStyle == .card ? card : square
    }

    private var canSave: Bool {
        isCutMode ? !results.isEmpty : wholeImage != nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    modePicker
                    canvas
                    if isCutMode {
                        cutOptions
                        resultShelf
                    } else {
                        wholeOptions
                    }
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(Color(hex: 0xC8372D))
                    }
                }
                .padding(20)
            }
            .scrollDisabled(isDrawing)
            .safeAreaInset(edge: .bottom) { bottomBar }
            .background(Color.paper)
            .navigationTitle("Cut out from photo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .environment(\.magnetLight, motion.light)
        .interactiveDismissDisabled(isSaving || isDrawing)
        .task { await prepare() }
        .onChange(of: border) { _, _ in rebuildResults() }
        .onChange(of: separately) { _, _ in rebuildResults() }
        .onChange(of: mode) { _, _ in rebuildResults() }
        .onAppear { motion.start() }
        .onDisappear { motion.stop() }
    }

    // MARK: Top

    private var modePicker: some View {
        HStack(spacing: 8) {
            ForEach(Mode.allCases) { item in
                ChoiceChip(title: item.title, isSelected: mode == item) {
                    withAnimation(.snappy) { mode = item }
                    Feedback.select()
                }
                .disabled(item == .object && session == nil && !isAnalyzing)
                .opacity(item == .object && session == nil && !isAnalyzing ? 0.4 : 1)
            }
        }
    }

    private var canvas: some View {
        GeometryReader { geo in
            let rect = Self.fittedRect(source.size, in: geo.size)
            ZStack(alignment: .topLeading) {
                Color.clear
                switch mode {
                case .object:
                    objectCanvas(rect: rect)
                case .lasso:
                    lassoCanvas(rect: rect)
                case .whole:
                    wholePreview
                        .frame(width: geo.size.width, height: geo.size.height)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .frame(height: 360)
        .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(Color(hex: 0x182229)))
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .overlay(alignment: .bottom) { canvasHint }
    }

    @ViewBuilder
    private func objectCanvas(rect: CGRect) -> some View {
        let photo = Image(uiImage: source).resizable()
        photo
            .frame(width: rect.width, height: rect.height)
            .position(x: rect.midX, y: rect.midY)
        Color.black.opacity(isAnalyzing ? 0.25 : 0.55)
            .frame(width: rect.width, height: rect.height)
            .position(x: rect.midX, y: rect.midY)
        if let allObjects {
            Image(uiImage: allObjects)
                .resizable()
                .frame(width: rect.width, height: rect.height)
                .position(x: rect.midX, y: rect.midY)
                .opacity(0.45)
        }
        if let highlight {
            Image(uiImage: highlight)
                .resizable()
                .frame(width: rect.width, height: rect.height)
                .shadow(color: Color.white.opacity(0.95), radius: 3)
                .shadow(color: Color.white.opacity(0.7), radius: 12)
                .position(x: rect.midX, y: rect.midY)
                .transition(.opacity)
        }
        if isAnalyzing {
            ProgressView()
                .tint(Color.white)
                .controlSize(.large)
                .position(x: rect.midX, y: rect.midY)
        }
        Color.clear
            .contentShape(Rectangle())
            .gesture(SpatialTapGesture().onEnded { value in
                toggleObject(at: value.location, in: rect)
            })
    }

    @ViewBuilder
    private func lassoCanvas(rect: CGRect) -> some View {
        Image(uiImage: source)
            .resizable()
            .frame(width: rect.width, height: rect.height)
            .position(x: rect.midX, y: rect.midY)
        if lassoCut != nil && !isDrawing {
            Rectangle()
                .fill(Color.black.opacity(0.55))
                .frame(width: rect.width, height: rect.height)
                .position(x: rect.midX, y: rect.midY)
                .mask {
                    ZStack {
                        Rectangle()
                        LassoShape(points: lassoPoints, closed: true)
                            .frame(width: rect.width, height: rect.height)
                            .position(x: rect.midX, y: rect.midY)
                            .blendMode(.destinationOut)
                    }
                    .compositingGroup()
                }
        }
        LassoShape(points: lassoPoints, closed: !isDrawing)
            .stroke(Color.white, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round, dash: isDrawing ? [] : [7, 5]))
            .shadow(color: Color.black.opacity(0.5), radius: 2)
            .frame(width: rect.width, height: rect.height)
            .position(x: rect.midX, y: rect.midY)
            .allowsHitTesting(false)
        Color.clear
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        if !isDrawing {
                            isDrawing = true
                            lassoPoints = []
                            lassoCut = nil
                            results = []
                        }
                        let point = CGPoint(x: ((value.location.x - rect.minX) / max(rect.width, 1)).clamped(to: 0...1),
                                            y: ((value.location.y - rect.minY) / max(rect.height, 1)).clamped(to: 0...1))
                        if let last = lassoPoints.last, hypot(last.x - point.x, last.y - point.y) < 0.006 { return }
                        lassoPoints.append(point)
                    }
                    .onEnded { _ in
                        isDrawing = false
                        finishLasso()
                    }
            )
    }

    private var wholePreview: some View {
        ZStack {
            DoorPanelView(finish: store.design.finish, cornerRadius: 26)
            GeometryReader { geo in
                if let image = wholeImage {
                    let photo = PhotoContent(style: wholeStyle, file: "", aspect: Double(image.size.width / max(image.size.height, 1)),
                                             caption: wholeStyle == .polaroid ? caption : "")
                    let content = RenderContent.photo(photo, image)
                    let aspect = ItemMetrics.aspect(of: content)
                    let width = min(geo.size.width * 0.62, geo.size.height * 0.72 * aspect)
                    ItemPreview(content: content,
                                fastener: wholeStyle == .card ? .redMagnet : (wholeStyle == .polaroid ? .whiteMagnet : nil),
                                rotation: wholeStyle == .card || wholeStyle == .polaroid ? -3 : 0,
                                width: width)
                        .position(x: geo.size.width / 2, y: geo.size.height / 2)
                        .id(wholeStyle)
                        .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: wholeStyle)
    }

    @ViewBuilder
    private var canvasHint: some View {
        let text: String? = {
            switch mode {
            case .object:
                if isAnalyzing { return "Looking for objects…" }
                if session == nil { return nil }
                return selection.isEmpty ? "Tap an object to select it" : "Tap more to add or remove"
            case .lasso:
                return lassoPoints.isEmpty || isDrawing ? "Trace around an object" : "Not quite? Trace again"
            case .whole:
                return nil
            }
        }()
        if let text {
            Text(text)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Capsule().fill(Color.black.opacity(0.55)))
                .padding(.bottom, 12)
                .allowsHitTesting(false)
        }
    }

    // MARK: Options

    private var cutOptions: some View {
        VStack(alignment: .leading, spacing: 20) {
            if mode == .object, session != nil {
                HStack(spacing: 8) {
                    ChoiceChip(title: "Select all", isSelected: false) {
                        if let session {
                            selection = Set(session.instances)
                            refreshHighlight()
                        }
                    }
                    if selection.count > 1 {
                        ChoiceChip(title: separately ? "Each separately" : "As one sticker", isSelected: separately) {
                            separately.toggle()
                        }
                    }
                }
            }
            OptionSection(title: "Make") {
                HStack(spacing: 8) {
                    ForEach(PhotoStyle.cutoutFinishes) { style in
                        ChoiceChip(title: style.title, isSelected: finish == style) {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.65)) { finish = style }
                            Feedback.select()
                        }
                    }
                }
            }
            OptionSection(title: "White edge") {
                HStack(spacing: 8) {
                    ForEach(StickerBorder.allCases) { option in
                        ChoiceChip(title: option.title, isSelected: border == option) {
                            border = option
                        }
                    }
                }
            }
        }
    }

    private var resultShelf: some View {
        ZStack {
            DoorPanelView(finish: store.design.finish, cornerRadius: 24)
            if results.isEmpty {
                Text(mode == .lasso ? "Your cut-out will appear here" : "Pick an object in the photo")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color(hex: 0x3B4650))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 22) {
                        ForEach(Array(results.enumerated()), id: \.offset) { index, image in
                            let photo = PhotoContent(style: finish, file: "", aspect: Double(image.size.width / max(image.size.height, 1)))
                            ItemThumb(content: .photo(photo, image), box: results.count == 1 ? 170 : 130)
                                .rotationEffect(.degrees(results.count == 1 ? -3 : Double((index * 23) % 9) - 4))
                        }
                    }
                    .padding(.horizontal, 24)
                    .frame(minWidth: 300)
                }
            }
        }
        .frame(height: 210)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: finish)
    }

    private var wholeOptions: some View {
        OptionSection(title: "Style") {
            HStack(spacing: 8) {
                ForEach(PhotoStyle.wholeFinishes) { style in
                    ChoiceChip(title: style.shortTitle, isSelected: wholeStyle == style) {
                        wholeStyle = style
                        Feedback.select()
                    }
                }
            }
            if wholeStyle == .polaroid {
                TextField("Handwritten caption, like “Summer 2026”", text: $caption)
                    .font(NoteFont.caveat.font(size: 24))
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.card))
                    .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1) }
                    .onChange(of: caption) { _, newValue in
                        if newValue.count > 40 {
                            caption = String(newValue.prefix(40))
                        }
                    }
            }
            Text(wholeHint)
                .font(.footnote)
                .foregroundStyle(Color.inkSoft)
        }
    }

    private var wholeHint: String {
        switch wholeStyle {
        case .polaroid: return "A square frame with a wide bottom margin for a caption. You can change the caption later."
        case .card: return "A separate magnet holds the card. You can swap it and slide it along the edge."
        default: return "The photo under a thick glossy dome, framed on the most interesting part of the shot."
        }
    }

    private var bottomBar: some View {
        VStack(spacing: 8) {
            HStack(spacing: 10) {
                Button {
                    save(hang: true)
                } label: {
                    if isSaving {
                        ProgressView().tint(Color.onInk)
                    } else if isCutMode && results.count > 1 {
                        Label("Put on the door: \(results.count)", systemImage: "plus")
                    } else {
                        Label("Put on “\(store.fridge.name)”", systemImage: "plus")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSave || isSaving)

                if isCutMode && !shareURLs.isEmpty {
                    ShareLink(items: shareURLs) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 19, weight: .semibold))
                            .foregroundStyle(Color.ink)
                            .frame(width: 52, height: 52)
                            .background(Circle().fill(Color.card))
                            .overlay { Circle().strokeBorder(Color.hairline, lineWidth: 1) }
                    }
                    .accessibilityLabel("Share sticker")
                }
            }
            Button {
                save(hang: false)
            } label: {
                Text("Just save to collection")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.ink)
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
            }
            .buttonStyle(.plain)
            .disabled(!canSave || isSaving)
            .opacity(canSave ? 1 : 0.4)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .background(Color.paper)
    }

    // MARK: Work

    private func prepare() async {
        guard card == nil else { return }
        let focus = await PhotoProcessing.focusPoint(of: source)
        card = PhotoProcessing.cardImage(from: source, focus: focus)
        square = PhotoProcessing.crop(source, aspect: 1, focus: focus)
        let found = await CutoutSession.analyze(source)
        isAnalyzing = false
        guard let found else {
            withAnimation(.snappy) { mode = .lasso }
            errorMessage = "No objects found automatically. Trace the one you want, or use the whole photo."
            return
        }
        session = found
        selection = found.defaultSelection()
        let everything = Set(found.instances)
        allObjects = await Task.detached(priority: .userInitiated) {
            found.cutout(of: everything, cropped: false)
        }.value
        refreshHighlight()
    }

    private func toggleObject(at location: CGPoint, in rect: CGRect) {
        guard let session, rect.contains(location) else { return }
        let point = CGPoint(x: (location.x - rect.minX) / rect.width, y: (location.y - rect.minY) / rect.height)
        guard let instance = session.instance(at: point) else {
            Feedback.select()
            return
        }
        if selection.contains(instance) {
            selection.remove(instance)
        } else {
            selection.insert(instance)
        }
        Feedback.lift()
        refreshHighlight()
    }

    private func refreshHighlight() {
        guard let session else { return }
        let chosen = selection
        Task { @MainActor in
            let image = await Task.detached(priority: .userInitiated) {
                session.cutout(of: chosen, cropped: false)
            }.value
            guard chosen == selection else { return }
            withAnimation(.easeOut(duration: 0.2)) { highlight = image }
            rebuildResults()
        }
    }

    private func finishLasso() {
        let points = lassoPoints
        let image = source
        Task { @MainActor in
            let cut = await Task.detached(priority: .userInitiated) {
                CutoutSession.lassoCut(image, points: points)
            }.value
            guard points == lassoPoints else { return }
            lassoCut = cut
            if cut == nil {
                Feedback.select()
            } else {
                Feedback.attach()
            }
            rebuildResults()
        }
    }

    /// Cuts the chosen objects (or the traced area), adds the white edge and prepares PNGs to share.
    private func rebuildResults() {
        guard isCutMode else { return }
        renderID += 1
        let id = renderID
        let border = self.border
        let mode = self.mode
        let session = self.session
        let chosen = selection
        let separately = self.separately && chosen.count > 1
        let lasso = lassoCut
        Task { @MainActor in
            let images = await Task.detached(priority: .userInitiated) { () -> [UIImage] in
                var raw: [UIImage] = []
                switch mode {
                case .object:
                    guard let session, !chosen.isEmpty else { return [] }
                    if separately {
                        raw = chosen.sorted().compactMap { session.cutout(of: [$0], cropped: true) }
                    } else if let image = session.cutout(of: chosen, cropped: true) {
                        raw = [image]
                    }
                case .lasso:
                    if let lasso { raw = [lasso] }
                case .whole:
                    return []
                }
                return raw.map { PhotoProcessing.sticker(from: $0, border: border) }
            }.value
            guard id == renderID else { return }
            withAnimation(.spring(response: 0.4, dampingFraction: 0.7)) { results = images }
            shareURLs = await Task.detached(priority: .utility) {
                Self.writeShareFiles(images)
            }.value
        }
    }

    private nonisolated static func writeShareFiles(_ images: [UIImage]) -> [URL] {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Stickers", isDirectory: true)
        try? FileManager.default.removeItem(at: folder)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var urls: [URL] = []
        for (index, image) in images.enumerated() {
            guard let data = image.pngData() else { continue }
            let url = folder.appendingPathComponent(images.count == 1 ? "Sticker.png" : "Sticker \(index + 1).png")
            if (try? data.write(to: url, options: [.atomic])) != nil {
                urls.append(url)
            }
        }
        return urls
    }

    private func save(hang: Bool) {
        let style = isCutMode ? finish : wholeStyle
        let caption = style == .polaroid ? self.caption : ""
        let images: [UIImage]
        if isCutMode {
            images = results
        } else if let image = wholeImage {
            images = [image]
        } else {
            images = []
        }
        guard !images.isEmpty else { return }
        isSaving = true
        errorMessage = nil
        Task { @MainActor in
            do {
                let photos = try await Task.detached(priority: .userInitiated) {
                    try images.map { try PhotoProcessing.store($0, style: style, caption: caption) }
                }.value
                if let placementID = store.addPhotos(photos, hang: hang) {
                    onPlaced(placementID)
                }
                dismiss()
            } catch {
                isSaving = false
                errorMessage = "Couldn’t save. Please try again."
            }
        }
    }

    // MARK: Geometry

    static func fittedRect(_ imageSize: CGSize, in container: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else { return CGRect(origin: .zero, size: container) }
        let scale = min(container.width / imageSize.width, container.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(x: (container.width - size.width) / 2, y: (container.height - size.height) / 2,
                      width: size.width, height: size.height)
    }
}

/// A freehand outline in 0...1 coordinates, smoothed through the midpoints.
private struct LassoShape: Shape {
    let points: [CGPoint]
    var closed = true

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard points.count > 1 else { return path }
        let scaled = points.map { CGPoint(x: rect.minX + $0.x * rect.width, y: rect.minY + $0.y * rect.height) }
        path.move(to: scaled[0])
        for index in 1..<scaled.count {
            let previous = scaled[index - 1]
            let point = scaled[index]
            path.addQuadCurve(to: CGPoint(x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2), control: previous)
        }
        path.addLine(to: scaled[scaled.count - 1])
        if closed {
            path.closeSubpath()
        }
        return path
    }
}
