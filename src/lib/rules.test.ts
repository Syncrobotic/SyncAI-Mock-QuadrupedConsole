import { describe, expect, it } from "vitest";

import { canSetPriority, describeTrigger, inWindow, nextSlots, toRRule } from "./rules";

const at = (h: number, m = 0, day = 23) => new Date(2026, 8, day, h, m).getTime();

describe("time windows", () => {
  it("handles windows that wrap midnight", () => {
    const w = { from: "22:00", to: "06:00" };
    expect(inWindow(w, at(23))).toBe(true);
    expect(inWindow(w, at(3))).toBe(true);
    expect(inWindow(w, at(12))).toBe(false);
    expect(inWindow(w, at(6))).toBe(false);
  });
});

describe("schedule slots", () => {
  it("interval slots anchor to the window start and stay inside it", () => {
    const slots = nextSlots({ type: "interval", minutes: 45, window: { from: "22:00", to: "06:00" } }, at(12), 4);
    expect(slots.map((t) => new Date(t).toTimeString().slice(0, 5))).toEqual(["22:00", "22:45", "23:30", "00:15"]);
  });

  it("weekly picks the next matching weekday", () => {
    // 2026-09-23 is a Wednesday; Mon/Thu → Thursday the 24th first
    const [first] = nextSlots({ type: "weekly", days: [1, 4], time: "02:00" }, at(12), 1);
    expect(new Date(first).getDate()).toBe(24);
  });

  it("daily after today's time rolls to tomorrow", () => {
    const [first] = nextSlots({ type: "daily", time: "08:00" }, at(12), 1);
    expect(new Date(first).getDate()).toBe(24);
  });

  it("renders RRULE", () => {
    expect(toRRule({ type: "weekly", days: [1, 4], time: "02:00" })).toBe("FREQ=WEEKLY;BYDAY=MO,TH;BYHOUR=2;BYMINUTE=0");
  });
});

describe("rule vocabulary", () => {
  it("summarises an AI trigger with its filters", () => {
    const s = describeTrigger(
      { kind: "event", source: "ai", type: "person", zones: ["corr-s"], minConfidence: 0.8, persistSec: 3, countWithin: null, activeWindow: { from: "22:00", to: "06:00" } },
      () => "南走廊"
    );
    expect(s).toBe("偵測到人員 @ 南走廊（信心 ≥ 80%、持續 3 秒、22:00–06:00）");
  });

  it("operators cannot create P0/P1 rules", () => {
    expect(canSetPriority(1, false)).toBe(false);
    expect(canSetPriority(2, false)).toBe(true);
    expect(canSetPriority(0, true)).toBe(true);
  });
});
