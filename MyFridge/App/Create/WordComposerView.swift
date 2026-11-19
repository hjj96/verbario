import SwiftUI

/// Magnetic letters: type a short word and it lands on the door letter by letter.
struct WordComposerView: View {
    let onPlaced: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var coloring: WordColoring = .rainbow
    @FocusState private var isFocused: Bool

    private static let maxLength = 16

    private var letters: [String] {
        text.uppercased().map(String.init)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    preview
                    TextField("Например: ДОМ", text: $text)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .focused($isFocused)
                        .padding(16)
                        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.card))
                        .overlay {
                            RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Color.hairline, lineWidth: 1)
                        }
                        .onChange(of: text) { _, newValue in
                            if newValue.count > Self.maxLength {
                                text = String(newValue.prefix(Self.maxLength))
                            }
                        }
                    OptionSection(title: "Цвет букв") {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 10) {
                                ChoiceChip(title: "Радуга", isSelected: coloring == .rainbow) {
                                    coloring = .rainbow
                                }
                                ForEach(LetterColor.allCases) { color in
                                    Button {
                                        coloring = .single(color)
                                    } label: {
                                        Circle()
                                            .fill(LinearGradient(colors: [color.tones[0], color.tones[2]],
                                                                 startPoint: .topLeading, endPoint: .bottomTrailing))
                                            .frame(width: 32, height: 32)
                                            .overlay { Circle().strokeBorder(Color.black.opacity(0.12), lineWidth: 1) }
                                            .padding(3)
                                            .overlay {
                                                Circle().strokeBorder(coloring == .single(color) ? Color.ink : Color.clear, lineWidth: 2)
                                            }
                                    }
                                    .buttonStyle(PressableStyle())
                                }
                            }
                        }
                    }
                    Text("Каждая буква — отдельный магнитик. Их потом можно двигать по одной.")
                        .font(.footnote)
                        .foregroundStyle(Color.inkSoft)
                }
                .padding(20)
            }
            .background(Color.paper)
            .navigationTitle("Магнитные буквы")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Прикрепить") {
                        if let placementID = store.placeWord(text, coloring: coloring) {
                            onPlaced(placementID)
                        }
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 450_000_000)
                    isFocused = true
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var preview: some View {
        let shown = letters.isEmpty ? "ДОМ".map(String.init) : letters
        let letterWidth = min(40, 300 / CGFloat(max(shown.count, 1)))
        return ZStack {
            DoorPanelView(palette: store.design.finish.palette, cornerRadius: 24)
            HStack(spacing: -4) {
                ForEach(Array(shown.enumerated()), id: \.offset) { index, character in
                    if character == " " {
                        Color.clear.frame(width: letterWidth * 0.45, height: 10)
                    } else {
                        LetterMagnetView(letter: LetterMagnet(character: character, color: coloring.color(at: index)))
                            .frame(width: letterWidth, height: letterWidth / ItemMetrics.letterAspect)
                            .rotationEffect(.degrees(Double((index * 37) % 11) - 5))
                            .modifier(ItemShadow(depth: 1.3, unit: 260))
                    }
                }
            }
            .opacity(letters.isEmpty ? 0.5 : 1)
            .padding(.horizontal, 16)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 150)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .animation(.snappy, value: text)
        .animation(.snappy, value: coloring)
    }
}
