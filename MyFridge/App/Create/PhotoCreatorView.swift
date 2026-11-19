import SwiftUI

/// "Любимая фотография становится предметом": cut the object out, keep the whole card,
/// or put the photo under a round or heart-shaped glossy lens.
struct PhotoCreatorView: View {
    let source: UIImage
    let onPlaced: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(MotionLight.self) private var motion
    @Environment(\.dismiss) private var dismiss

    private enum Phase {
        case preparing
        case ready
        case noSubject
    }

    @State private var phase: Phase = .preparing
    @State private var style: PhotoStyle = .cutout
    @State private var border: StickerBorder = .thin
    @State private var card: UIImage?
    @State private var square: UIImage?
    @State private var cutout: UIImage?
    @State private var sticker: UIImage?
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var previewImage: UIImage? {
        switch style {
        case .cutout: return sticker
        case .card: return card
        case .round, .heart: return square
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    preview
                    stylePicker
                    details
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(Color(hex: 0xC8372D))
                    }
                }
                .padding(20)
            }
            .safeAreaInset(edge: .bottom) {
                Button {
                    save()
                } label: {
                    if isSaving {
                        ProgressView().tint(Color.onInk)
                    } else {
                        Label("Прикрепить на дверцу", systemImage: "plus")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(previewImage == nil || isSaving || phase == .preparing)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                .background(Color.paper)
            }
            .background(Color.paper)
            .navigationTitle("Магнитик из фото")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
        .task { await prepare() }
        .onChange(of: border) { _, _ in
            Task { await renderSticker() }
        }
    }

    // MARK: Parts

    private var preview: some View {
        ZStack {
            DoorPanelView(palette: store.design.finish.palette, cornerRadius: 26)
            GeometryReader { geo in
                if let image = previewImage {
                    let photo = PhotoContent(style: style, file: "", aspect: Double(image.size.width / max(image.size.height, 1)))
                    let content = RenderContent.photo(photo, image)
                    let aspect = ItemMetrics.aspect(of: content)
                    let width = min(geo.size.width * 0.66, geo.size.height * 0.72 * aspect)
                    ItemPreview(content: content,
                                fastener: style == .card ? .redMagnet : nil,
                                rotation: style == .card ? -3 : 0,
                                width: width)
                        .position(x: geo.size.width / 2, y: geo.size.height / 2)
                        .id(style)
                        .transition(.scale(scale: 0.9).combined(with: .opacity))
                }
            }
            if phase == .preparing {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Ищу главный объект…")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color(hex: 0x18262F))
                }
                .padding(18)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.85)))
            }
        }
        .environment(\.magnetLight, motion.light)
        .frame(maxWidth: .infinity)
        .frame(height: 330)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .animation(.spring(response: 0.4, dampingFraction: 0.7), value: style)
        .animation(.snappy, value: phase)
        .onAppear { motion.start() }
        .onDisappear { motion.stop() }
    }

    private var stylePicker: some View {
        OptionSection(title: "Вид магнита") {
            HStack(spacing: 8) {
                ForEach(PhotoStyle.allCases) { option in
                    ChoiceChip(title: option.shortTitle, isSelected: style == option) {
                        style = option
                        Feedback.select()
                    }
                    .disabled(option == .cutout && cutout == nil)
                    .opacity(option == .cutout && cutout == nil ? 0.4 : 1)
                }
            }
        }
    }

    @ViewBuilder
    private var details: some View {
        switch style {
        case .cutout:
            OptionSection(title: "Обводка") {
                HStack(spacing: 8) {
                    ForEach(StickerBorder.allCases) { option in
                        ChoiceChip(title: option.title, isSelected: border == option) {
                            border = option
                        }
                    }
                }
            }
        case .card:
            hint("Карточку держит отдельный магнит. Его можно заменить и передвинуть по краю.")
        case .round, .heart:
            hint("Фото под толстой глянцевой линзой. Кадр выбран по самому интересному месту снимка.")
        }
        if phase == .noSubject {
            hint("Не получилось выделить объект, поэтому вырезка недоступна — выбери карточку или магнит под линзой.")
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(Color.inkSoft)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Work

    private func prepare() async {
        guard card == nil else { return }
        let focus = await PhotoProcessing.focusPoint(of: source)
        card = PhotoProcessing.cardImage(from: source, focus: focus)
        square = PhotoProcessing.crop(source, aspect: 1, focus: focus)
        if let lifted = await PhotoProcessing.liftSubject(from: source) {
            cutout = lifted
            await renderSticker()
            phase = .ready
        } else {
            style = .card
            phase = .noSubject
        }
    }

    private func renderSticker() async {
        guard let cutout else { return }
        let border = self.border
        let result = await Task.detached(priority: .userInitiated) {
            PhotoProcessing.sticker(from: cutout, border: border)
        }.value
        // Ignore a stale result if the edge was changed again meanwhile.
        if border == self.border {
            sticker = result
        }
    }

    private func save() {
        guard let image = previewImage else { return }
        let style = self.style
        isSaving = true
        errorMessage = nil
        Task { @MainActor in
            do {
                let photo = try await Task.detached(priority: .userInitiated) {
                    try PhotoProcessing.store(image, style: style)
                }.value
                if let placementID = store.addPhoto(photo) {
                    onPlaced(placementID)
                }
                dismiss()
            } catch {
                isSaving = false
                errorMessage = "Не получилось сохранить фото. Попробуй ещё раз."
            }
        }
    }
}
