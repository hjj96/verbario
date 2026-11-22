import SwiftUI

/// The interactive door: drag things, pinch and twist with two fingers, or use the corner
/// knob of the selected thing to resize and rotate it with one finger. Things from the tray
/// can be dropped right where they should hang.
struct DoorCanvas: View {
    static let space = "door"

    @Environment(FridgeStore.self) private var store
    @Binding var selection: UUID?

    @State private var move: Move?
    @State private var transform: Transform?
    @State private var fastenerMove: FastenerMove?
    @State private var isDropTargeted = false

    private struct Move: Equatable {
        var id: UUID
        var translation: CGSize
        /// Degrees of swing from the hand's speed.
        var sway: Double
    }

    private struct Transform: Equatable {
        var id: UUID
        var scale: CGFloat
        var rotation: Double
    }

    private struct FastenerMove: Equatable {
        var id: UUID
        var position: CGPoint
    }

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let design = store.design
            let format = store.format
            let radius = DoorGeometry.cornerRadius(format: format, size: size)
            let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
            ZStack {
                ZStack {
                    DoorBackgroundView(design: design, format: format)
                        .contentShape(Rectangle())
                        .onTapGesture { selection = nil }
                    ForEach(store.placements) { placement in
                        item(placement, doorSize: size)
                    }
                    DoorHandleView(design: design, format: format)
                }
                .clipShape(shape)
                .background {
                    shape
                        .fill(Color.black.opacity(0.3))
                        .blur(radius: 18)
                        .offset(y: 14)
                }
                .overlay {
                    shape
                        .strokeBorder(Color(hex: 0x2F55D4).opacity(isDropTargeted ? 0.85 : 0), lineWidth: 3)
                        .shadow(color: Color(hex: 0x2F55D4).opacity(isDropTargeted ? 0.6 : 0), radius: 10)
                        .allowsHitTesting(false)
                }
                .dropDestination(for: String.self) { tokens, location in
                    drop(tokens, at: location, doorSize: size)
                } isTargeted: { targeted in
                    withAnimation(.easeOut(duration: 0.2)) { isDropTargeted = targeted }
                }

                selectionOverlay(doorSize: size)
            }
            .coordinateSpace(.named(Self.space))
            .simultaneousGesture(pinchAndRotate)
        }
        .environment(\.noteInteraction, .app({ itemID in store.toggleTask(itemID: itemID) }))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Дверца холодильника")
    }

    // MARK: Items

    @ViewBuilder
    private func item(_ placement: Placement, doorSize: CGSize) -> some View {
        if let content = store.content(for: placement) {
            let shown = effective(placement, doorSize: doorSize)
            let isMoving = move?.id == placement.id
            PlacedItemView(content: content,
                           placement: shown,
                           doorSize: doorSize,
                           lifted: isMoving,
                           showsFastener: selection != placement.id,
                           sway: isMoving ? (move?.sway ?? 0) : 0)
                .contentShape(Rectangle())
                .onTapGesture {
                    if selection != placement.id {
                        Feedback.select()
                    }
                    selection = placement.id
                }
                .gesture(moveGesture(placement, doorSize: doorSize))
                .position(x: shown.x * doorSize.width, y: shown.y * doorSize.height)
                .zIndex(isMoving ? 1 : 0)
                .accessibilityLabel(content.title)
                .accessibilityAddTraits(.isButton)
        }
    }

    /// The stored placement with the gesture that is in progress applied on top.
    private func effective(_ placement: Placement, doorSize: CGSize) -> Placement {
        var result = placement
        if let move, move.id == placement.id {
            result.x += move.translation.width / max(doorSize.width, 1)
            result.y += move.translation.height / max(doorSize.height, 1)
        }
        if let transform, transform.id == placement.id {
            result.width = (result.width * transform.scale).clamped(to: ItemMetrics.minWidth...ItemMetrics.maxWidth)
            result.rotation += transform.rotation
        }
        if let fastenerMove, fastenerMove.id == placement.id {
            result.fastener?.x = fastenerMove.position.x
            result.fastener?.y = fastenerMove.position.y
        }
        return result
    }

    private func drop(_ tokens: [String], at location: CGPoint, doorSize: CGSize) -> Bool {
        guard let token = tokens.first, let payload = TrayPayload(token: token) else { return false }
        let point = CGPoint(x: location.x / max(doorSize.width, 1), y: location.y / max(doorSize.height, 1))
        guard let placementID = store.place(payload, at: point) else { return false }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) {
            selection = placementID
        }
        Feedback.attach()
        return true
    }

    // MARK: Gestures

    private func moveGesture(_ placement: Placement, doorSize: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 4, coordinateSpace: .named(Self.space))
            .onChanged { value in
                let target = Double((value.velocity.width / 70).clamped(to: -11...11))
                if let current = move, current.id == placement.id {
                    move = Move(id: placement.id, translation: value.translation,
                                sway: current.sway * 0.78 + target * 0.22)
                } else {
                    Feedback.lift()
                    selection = placement.id
                    withAnimation(.spring(response: 0.22, dampingFraction: 0.7)) {
                        move = Move(id: placement.id, translation: value.translation, sway: 0)
                    }
                }
            }
            .onEnded { value in
                let dx = value.translation.width / max(doorSize.width, 1)
                let dy = value.translation.height / max(doorSize.height, 1)
                withAnimation(.spring(response: 0.42, dampingFraction: 0.42)) {
                    store.updatePlacement(placement.id) { stored in
                        stored.x = (stored.x + dx).clamped(to: 0.03...0.97)
                        stored.y = (stored.y + dy).clamped(to: 0.03...0.97)
                    }
                    move = nil
                }
                Feedback.attach()
            }
    }

    private var pinchAndRotate: some Gesture {
        MagnifyGesture()
            .simultaneously(with: RotateGesture())
            .onChanged { value in
                guard let id = selection else { return }
                let scale = value.first?.magnification ?? 1
                let rotation = value.second?.rotation.degrees ?? 0
                transform = Transform(id: id, scale: scale, rotation: rotation)
            }
            .onEnded { _ in
                commitTransform()
            }
    }

    private func resizeGesture(_ placement: Placement, doorSize: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(Self.space))
            .onChanged { value in
                let center = CGPoint(x: placement.x * doorSize.width, y: placement.y * doorSize.height)
                let start = CGVector(dx: value.startLocation.x - center.x, dy: value.startLocation.y - center.y)
                let now = CGVector(dx: value.location.x - center.x, dy: value.location.y - center.y)
                let startLength = max(hypot(start.dx, start.dy), 1)
                let scale = hypot(now.dx, now.dy) / startLength
                let turn = (atan2(now.dy, now.dx) - atan2(start.dy, start.dx)) * 180 / .pi
                transform = Transform(id: placement.id, scale: scale, rotation: Double(turn))
            }
            .onEnded { _ in
                commitTransform()
            }
    }

    private func fastenerGesture(_ placement: Placement, itemSize: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 1, coordinateSpace: .named(Self.space))
            .onChanged { value in
                guard let fastener = placement.fastener else { return }
                let delta = CGPoint(x: value.translation.width, y: value.translation.height)
                    .rotated(by: .degrees(-placement.rotation))
                let x = (fastener.x + delta.x / max(itemSize.width, 1)).clamped(to: -0.05...1.05)
                let y = (fastener.y + delta.y / max(itemSize.height, 1)).clamped(to: -0.05...1.05)
                fastenerMove = FastenerMove(id: placement.id, position: CGPoint(x: x, y: y))
            }
            .onEnded { _ in
                guard let moved = fastenerMove else { return }
                store.updatePlacement(moved.id) { stored in
                    stored.fastener?.x = moved.position.x
                    stored.fastener?.y = moved.position.y
                }
                fastenerMove = nil
                Feedback.attach()
            }
    }

    private func commitTransform() {
        guard let finished = transform else { return }
        store.updatePlacement(finished.id) { stored in
            stored.width = (stored.width * finished.scale).clamped(to: ItemMetrics.minWidth...ItemMetrics.maxWidth)
            var rotation = (stored.rotation + finished.rotation).truncatingRemainder(dividingBy: 360)
            if rotation > 180 { rotation -= 360 }
            if rotation < -180 { rotation += 360 }
            // A gentle snap makes "straight" easy to hit.
            stored.rotation = abs(rotation) < 2 ? 0 : rotation
        }
        transform = nil
        Feedback.attach()
    }

    // MARK: Selection

    @ViewBuilder
    private func selectionOverlay(doorSize: CGSize) -> some View {
        if let id = selection,
           let stored = store.placement(id),
           let content = store.content(for: stored) {
            let shown = effective(stored, doorSize: doorSize)
            let itemSize = ItemMetrics.size(of: content, width: shown.width, in: doorSize)
            let center = CGPoint(x: shown.x * doorSize.width, y: shown.y * doorSize.height)
            let angle = Angle.degrees(shown.rotation + (move?.id == id ? (move?.sway ?? 0) : 0))
            let pad: CGFloat = 7
            let isMoving = move?.id == id
            let corner = CGPoint(x: itemSize.width / 2 + pad, y: itemSize.height / 2 + pad).rotated(by: angle)

            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(Color.white.opacity(0.95), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                .shadow(color: Color.black.opacity(0.35), radius: 1.5)
                .frame(width: itemSize.width + pad * 2, height: itemSize.height + pad * 2)
                .rotationEffect(angle)
                .scaleEffect(isMoving ? 1.06 : 1)
                .position(center)
                .allowsHitTesting(false)

            if content.acceptsFastener, let fastener = shown.fastener {
                fastenerHandle(fastener, stored: stored, itemSize: itemSize, center: center, angle: angle, doorSize: doorSize)
            }

            if !isMoving {
                ResizeKnob()
                    .position(x: center.x + corner.x, y: center.y + corner.y)
                    .gesture(resizeGesture(stored, doorSize: doorSize))
                    .accessibilityLabel("Размер и поворот")
            }
        }
    }

    private func fastenerHandle(_ fastener: Fastener, stored: Placement, itemSize: CGSize,
                                center: CGPoint, angle: Angle, doorSize: CGSize) -> some View {
        let size = ItemMetrics.fastenerSize(in: doorSize)
        let offset = CGPoint(x: (fastener.x - 0.5) * itemSize.width,
                             y: (fastener.y - 0.5) * itemSize.height).rotated(by: angle)
        let touchSize = max(size * 1.3, 44)
        return FastenerView(kind: fastener.kind, size: size)
            .rotationEffect(.degrees(angle.degrees + fastener.rotation))
            .frame(width: touchSize, height: touchSize)
            .contentShape(Circle())
            .position(x: center.x + offset.x, y: center.y + offset.y)
            .gesture(fastenerGesture(stored, itemSize: itemSize))
            .accessibilityLabel(fastener.kind.title)
    }
}

private struct ResizeKnob: View {
    var body: some View {
        Circle()
            .fill(Color.white)
            .frame(width: 28, height: 28)
            .overlay {
                Image(systemName: "arrow.up.left.and.arrow.down.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color(hex: 0x18262F))
            }
            .shadow(color: Color.black.opacity(0.3), radius: 3, y: 1)
            .frame(width: 44, height: 44)
            .contentShape(Circle())
    }
}
