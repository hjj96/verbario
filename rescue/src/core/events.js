// Tiny synchronous event bus shared by every system via ctx.events.
// Event names and payloads are listed in src/CONTRACT.md.
export class EventBus {
  constructor() {
    this.map = new Map();
  }

  on(name, fn) {
    let list = this.map.get(name);
    if (!list) this.map.set(name, (list = new Set()));
    list.add(fn);
    return () => list.delete(fn);
  }

  once(name, fn) {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit(name, payload) {
    const list = this.map.get(name);
    if (!list) return;
    for (const fn of [...list]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" failed`, err);
      }
    }
  }

  clear() {
    this.map.clear();
  }
}
