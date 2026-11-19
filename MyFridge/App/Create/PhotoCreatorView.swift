import SwiftUI

/// "Любимая фотография становится предметом": cut the object out or keep the whole card,
/// choose the edge and hang it on the door.
struct PhotoCreatorView: View {
    let source: UIImage
    let onPlaced: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private enum Phase {
        case lifting
        case ready
        case noSubject
    }

    @State private var phase: Phase = .lifting
    @State private var style: PhotoStyle = .cutout
    @State private var border: StickerBorder = .thin
    @State private var card: UIImage?
    @State private var cutout: UIImage?
    @State private var sticker: UIImage?
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var previewImage: UIImage? {
        style == .cutout ? sticker : card
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                preview
                controls
                Spacer(minLength: 0)
                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(Color.red)
                }
                Button {
                    save()
                } label: {
                    if isSaving {
                        ProgressView().tint(Color.white)
                    } else {
                        Label("Прикрепить на дверцу", systemImage: "plus")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(previewImage == nil || isSaving || phase == .lifting)
            }
            .padding(20)
            .background(Color(.systemGroupedBackground))
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
            DoorPanelView(palette: store.state.door.style.palette, cornerRadius: 24)
            GeometryReader { geo in
                if let image = previewImage {
                    let content = RenderContent.photo(PhotoContent(style: style, file: "", aspect: Double(image.size.width / max(image.size.height, 1))), image)
                    let aspect = ItemMetrics.aspect(of: content)
                    let box = CGSize(width: geo.size.width * 0.66, height: geo.size.height * 0.74)
                    let width = min(box.width, box.height * aspect)
                    ItemPreview(content: content,
                                fastener: style == .card ? .redMagnet : nil,
                                rotation: style == .card ? -3 : 0,
                                width: width)
                        .position(x: geo.size.width / 2, y: geo.size.height / 2)
                        .transition(.opacity.combined(with: .scale(scale: 0.96)))
                }
            }
            if phase == .lifting {
                VStack(spacing: 10) {
                    ProgressView()
                    Text("Ищу главный объект…")
                        .font(.subheadline.weight(.medium))
                }
                .padding(18)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.regularMaterial))
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 330)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .animation(.snappy, value: style)
        .animation(.snappy, value: phase)
    }

    @ViewBuilder
    private var controls: some View {
        Picker("Вид", selection: $style) {
            Text("Вырезать объект").tag(PhotoStyle.cutout)
            Text("Фотокарточка").tag(PhotoStyle.card)
        }
        .pickerStyle(.segmented)
        .disabled(cutout == nil)

        if phase == .noSubject {
            Label("Не получилось выделить объект, поэтому оставим фотографию целиком — обычной карточкой.",
                  systemImage: "info.circle")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if style == .cutout {
            OptionSection(title: "Обводка") {
                Picker("Обводка", selection: $border) {
                    ForEach(StickerBorder.allCases) { option in
                        Text(option.title).tag(option)
                    }
                }
                .pickerStyle(.segmented)
            }
        } else {
            Text("Карточку держит отдельный магнит. Его можно заменить и передвинуть на дверце.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Work

    private func prepare() async {
        guard card == nil else { return }
        card = PhotoProcessing.cardImage(from: source)
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
