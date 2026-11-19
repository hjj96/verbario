import SwiftUI

/// The starter set of ready-made magnets.
struct MagnetPickerView: View {
    let onPlaced: (UUID) -> Void

    @Environment(FridgeStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private let columns = [GridItem(.adaptive(minimum: 92), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(MagnetCatalog.all) { magnet in
                        Button {
                            if let placementID = store.placeMagnet(magnet.id) {
                                onPlaced(placementID)
                                dismiss()
                            }
                        } label: {
                            MagnetCell(magnet: magnet)
                        }
                        .buttonStyle(PressableStyle())
                    }
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Магнитики")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

struct MagnetCell: View {
    let magnet: MagnetDefinition

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                SteelTile(cornerRadius: 16)
                MagnetArtView(magnet: magnet, size: CGSize(width: 50, height: 50))
                    .modifier(ItemShadow(depth: 1.5, unit: 320))
            }
            .frame(height: 84)
            Text(magnet.title)
                .font(.caption.weight(.medium))
                .foregroundStyle(Color.primary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}
