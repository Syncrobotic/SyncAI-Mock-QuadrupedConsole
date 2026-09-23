import { describe, expect, it } from "vitest";

import { DEFAULT_FENCE, DOCK, GRID, insidePolygon, isFree, isReachable, snapToFree } from "./floor";

describe("mock floor", () => {
  it("the dock is free and reachable", () => {
    expect(isFree(GRID, DOCK.x, DOCK.y)).toBe(true);
    expect(isReachable(DOCK.x, DOCK.y)).toBe(true);
  });

  it("the whole ring corridor is reachable", () => {
    for (const [x, y] of [
      [-13, -2.75],
      [13, -2.75],
      [13, 2.75],
      [-13, 2.75],
      [0, 2.75],
      [0, -2.75],
    ])
      expect(isReachable(x, y), `${x},${y}`).toBe(true);
  });

  it("rooms are reachable through their doors", () => {
    for (const [x, y] of [
      [-14, 5],
      [9, -5],
      [15, 5],
    ]) {
      const p = snapToFree(GRID, x, y);
      expect(isReachable(p.x, p.y), `${x},${y}`).toBe(true);
    }
  });

  it("the sealed core is free space nothing can reach", () => {
    const p = snapToFree(GRID, 0, 0);
    expect(isFree(GRID, p.x, p.y)).toBe(true);
    expect(isReachable(p.x, p.y)).toBe(false);
  });

  it("the default fence excludes the north rooms", () => {
    expect(insidePolygon(DEFAULT_FENCE.points, 0, -8)).toBe(true);
    expect(insidePolygon(DEFAULT_FENCE.points, 0, 8)).toBe(false);
  });
});
