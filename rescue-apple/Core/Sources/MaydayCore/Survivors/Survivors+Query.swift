// Survivors as the helicopter sees it (Heli/SimContext.swift SurvivorQuery): the CONTRACT pickup protocol
// the winch drives (nearestFor → attachToBasket → boardOne, detachFromBasket on a slip or reset), the
// group views for the touch auto-aim and the deck heights under the basket. Groups are addressed by
// GroupID; the views are read fresh on every call, like the web's live objects.

extension Survivors: SurvivorQuery {
  public var groups: [SurvivorView] { list.map { $0.view } }

  public func group(_ id: GroupID) -> SurvivorView? { group(id: id)?.view }

  public func nearestFor(_ x: Double, _ z: Double, _ r: Double) -> SurvivorView? { nearestGroup(x, z, r)?.view }

  public func attachToBasket(_ id: GroupID) {
    if let s = group(id: id) { attach(s) }
  }

  public func detachFromBasket(_ id: GroupID, slip: BasketSlip?) {
    if let s = group(id: id) { detach(s, slip: slip) }
  }

  /// boardOne(s): the record the cabin gets (`!s` → the web's default record, without a person id).
  public func boardOne(_ id: GroupID) -> BoardedPerson? {
    guard let s = group(id: id) else { return BoardedPerson(name: "Пострадавший", age: 30, condition: "стабильное") }
    let r = board(s)
    return BoardedPerson(person: r.id, name: r.name, age: r.age, condition: r.condition)
  }
}
