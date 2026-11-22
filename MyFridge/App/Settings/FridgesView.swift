import SwiftUI

/// All fridges (boards). Each has its own door and its own things; the collection is shared.
struct FridgesView: View {
    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var showsNew = false
    @State private var renaming: Fridge?
    @State private var newName = ""
    @State private var deleting: Fridge?

    private let columns = [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel(text: "Fridges")
                        Text("Your doors")
                            .font(.serif(34))
                            .foregroundStyle(Color.ink)
                        Text("Each fridge has its own look and its own magnets. Your stickers and photos are shared.")
                            .font(.subheadline)
                            .foregroundStyle(Color.inkSoft)
                    }
                    LazyVGrid(columns: columns, spacing: 24) {
                        ForEach(store.state.fridges) { fridge in
                            FridgeCard(fridge: fridge, isCurrent: fridge.id == store.fridge.id) {
                                store.selectFridge(fridge.id)
                                Feedback.select()
                                dismiss()
                            } menu: {
                                Button {
                                    newName = fridge.name
                                    renaming = fridge
                                } label: {
                                    Label("Rename", systemImage: "pencil")
                                }
                                Button {
                                    store.duplicateFridge(fridge.id)
                                } label: {
                                    Label("Duplicate", systemImage: "plus.square.on.square")
                                }
                                if store.state.fridges.count > 1 {
                                    Button(role: .destructive) {
                                        deleting = fridge
                                    } label: {
                                        Label("Delete", systemImage: "trash")
                                    }
                                }
                            }
                        }
                        Button {
                            showsNew = true
                        } label: {
                            VStack(spacing: 10) {
                                Image(systemName: "plus")
                                    .font(.system(size: 26, weight: .medium))
                                    .frame(width: 64, height: 64)
                                    .background(Circle().fill(Color.card))
                                    .overlay { Circle().strokeBorder(Color.hairline, lineWidth: 1) }
                                Text("New fridge")
                                    .font(.subheadline.weight(.semibold))
                            }
                            .foregroundStyle(Color.ink)
                            .frame(maxWidth: .infinity, minHeight: 190)
                            .background(
                                RoundedRectangle(cornerRadius: 22, style: .continuous)
                                    .strokeBorder(Color.hairline, style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
                            )
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(20)
            }
            .background(Color.paper)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .navigationDestination(isPresented: $showsNew) {
                NewFridgeView {
                    dismiss()
                }
            }
            .alert("Fridge name", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
                TextField("For example, Cottage", text: $newName)
                Button("Done") {
                    if let renaming {
                        store.renameFridge(renaming.id, to: newName)
                    }
                    renaming = nil
                }
                Button("Cancel", role: .cancel) {
                    renaming = nil
                }
            }
            .confirmationDialog(deleting.map { "Delete “\($0.name)”?" } ?? "",
                                isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                                titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let deleting {
                        store.deleteFridge(deleting.id)
                    }
                    deleting = nil
                }
                Button("Cancel", role: .cancel) {
                    deleting = nil
                }
            } message: {
                Text("Stickers, photos and notes stay in your collection. You can undo this.")
            }
            .overlay(alignment: .bottom) { ToastHost() }
        }
    }
}

/// A small live preview of one fridge.
private struct FridgeCard<MenuContent: View>: View {
    let fridge: Fridge
    let isCurrent: Bool
    let onOpen: () -> Void
    @ViewBuilder let menu: MenuContent

    @Environment(FridgeStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onOpen) {
                FridgeCompositionView(fridge: fridge) { placement in
                    store.content(for: placement)
                }
                .aspectRatio(fridge.format.aspect, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .shadow(color: Color.black.opacity(0.22), radius: 10, y: 6)
                .frame(maxWidth: .infinity, minHeight: 150, maxHeight: 150, alignment: .bottom)
            }
            .buttonStyle(PressableStyle())
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        if isCurrent {
                            Circle()
                                .fill(Color(hex: 0x3FA66B))
                                .frame(width: 7, height: 7)
                        }
                        Text(fridge.name)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.ink)
                            .lineLimit(1)
                    }
                    Text("\(fridge.design.model.isRetro ? fridge.design.model.title : fridge.format.title) · \(fridge.design.finish.title)")
                        .font(.caption)
                        .foregroundStyle(Color.inkSoft)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Menu {
                    menu
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 20))
                        .foregroundStyle(Color.inkSoft)
                        .frame(width: 32, height: 32)
                }
            }
        }
    }
}

/// Picks the look and size of a new fridge.
struct NewFridgeView: View {
    let onCreated: () -> Void

    @Environment(FridgeStore.self) private var store

    @State private var name = ""
    @State private var format: FridgeFormat = .tall
    @State private var design = DoorDesign(finish: .mint, model: .fifties)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                FridgeCompositionView(design: previewDesign, format: format, placements: []) { _ in nil }
                    .aspectRatio(format.aspect, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: Color.black.opacity(0.25), radius: 16, y: 10)
                    .frame(maxWidth: format == .wide ? CGFloat.infinity : 240)
                    .frame(maxWidth: .infinity)
                    .animation(.spring(response: 0.4, dampingFraction: 0.8), value: format)

                OptionSection(title: "Name") {
                    TextField(placeholder, text: $name)
                        .font(.serif(22))
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.card))
                        .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1) }
                }
                ModelPicker(design: $design)
                FinishPicker(design: $design, format: format)
                FormatPicker(format: $format)
            }
            .padding(20)
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                var look = design
                if look.model.isRetro {
                    // a retro fridge wears its name in chrome
                    let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
                    look.nameplate = String((title.isEmpty ? placeholder : title).prefix(16))
                }
                store.addFridge(name: name, format: format, design: look)
                Feedback.attach()
                onCreated()
            } label: {
                Label("Create fridge", systemImage: "plus")
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(Color.paper)
        }
        .background(Color.paper)
        .navigationTitle("New fridge")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var placeholder: String {
        FridgePreset.suggestedName(for: design)
    }

    /// The new fridge as it will look, its name already in chrome.
    private var previewDesign: DoorDesign {
        var look = design
        if look.model.isRetro {
            let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
            look.nameplate = String((title.isEmpty ? placeholder : title).prefix(16))
        }
        return look
    }
}

// MARK: - Shared pickers

/// The kind of fridge, shown as small live doors in the current colour.
struct ModelPicker: View {
    @Binding var design: DoorDesign

    var body: some View {
        OptionSection(title: "Model") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(DoorModel.allCases) { model in
                        Button {
                            withAnimation(.snappy) {
                                design.model = model
                                design.showsHandle = true
                            }
                            Feedback.select()
                        } label: {
                            VStack(spacing: 6) {
                                FridgeCompositionView(design: sample(model), format: .tall, placements: []) { _ in nil }
                                    .frame(width: 84, height: 88)
                                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                                    .shadow(color: Color.black.opacity(0.2), radius: 5, y: 3)
                                    .padding(3)
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                                            .strokeBorder(design.model == model ? Color.ink : Color.clear, lineWidth: 2)
                                    }
                                Text(model.title)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Color.ink)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel(model.title)
                        .accessibilityHint(model.subtitle)
                        .accessibilityAddTraits(design.model == model ? .isSelected : [])
                    }
                }
                .padding(.vertical, 2)
            }
            Text(design.model.subtitle)
                .font(.footnote)
                .foregroundStyle(Color.inkSoft)
        }
    }

    /// The model in the current colour, with a sample name so its emblem shows.
    private func sample(_ model: DoorModel) -> DoorDesign {
        var sample = design
        sample.model = model
        sample.showsHandle = true
        if sample.nameplate.isEmpty {
            sample.nameplate = "Kitchen"
        }
        return sample
    }
}

struct FormatPicker: View {
    @Binding var format: FridgeFormat

    var body: some View {
        OptionSection(title: "Size") {
            HStack(spacing: 8) {
                ForEach(FridgeFormat.allCases) { option in
                    ChoiceChip(title: option.title, isSelected: format == option) {
                        withAnimation(.snappy) { format = option }
                        Feedback.select()
                    }
                }
            }
            Text("A door \(format.widgetHint). It also fits neatly into a widget of another size.")
                .font(.footnote)
                .foregroundStyle(Color.inkSoft)
        }
    }
}

struct FinishPicker: View {
    @Binding var design: DoorDesign
    let format: FridgeFormat

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            row(title: "Metal", finishes: DoorFinish.metals)
            row(title: "Glossy enamel", finishes: DoorFinish.enamels)
        }
    }

    private func row(title: String, finishes: [DoorFinish]) -> some View {
        OptionSection(title: title) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(finishes) { finish in
                        Button {
                            withAnimation(.snappy) {
                                design.finish = finish
                            }
                            Feedback.select()
                        } label: {
                            VStack(spacing: 6) {
                                DoorSurfaceView(finish: finish)
                                    .frame(width: 58, height: 58)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .shadow(color: Color.black.opacity(0.18), radius: 4, y: 2)
                                .padding(3)
                                .overlay {
                                    RoundedRectangle(cornerRadius: 15, style: .continuous)
                                        .strokeBorder(design.finish == finish ? Color.ink : Color.clear, lineWidth: 2)
                                }
                                Text(finish.title)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(Color.ink)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.center)
                                    .frame(width: 70)
                            }
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel(finish.title)
                        .accessibilityAddTraits(design.finish == finish ? .isSelected : [])
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }
}
