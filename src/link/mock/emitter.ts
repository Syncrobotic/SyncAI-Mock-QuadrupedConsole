import type { Stream } from "../DogLink";

/** Minimal multicast stream. `replay` hands the last value to late subscribers. */
export class Emitter<T> implements Stream<T> {
  private fns = new Set<(v: T) => void>();
  last: T | undefined;

  constructor(private replay = false) {}

  subscribe(fn: (v: T) => void) {
    this.fns.add(fn);
    if (this.replay && this.last !== undefined) fn(this.last);
    return () => {
      this.fns.delete(fn);
    };
  }

  emit(v: T) {
    this.last = v;
    for (const fn of this.fns) fn(v);
  }

  clear() {
    this.last = undefined;
  }
}
