import { describe, expect, it } from "vitest";

import { RuleEngine, jitterFor, type EngineCtx } from "./engine";

import type { Detection, Mission, Rule } from "@/proto/types";

const T0 = new Date(2026, 8, 23, 23, 0).getTime(); // inside a 22:00–06:00 window

const mission = (id: string): Mission => ({
  id,
  name: id,
  kind: "patrol",
  route: [],
  response: { approachM: 1.5, actions: [] },
  policy: { onLowBattery: "pause", onObstacle: "reroute", waitSec: 10, allowTeleopPreempt: true },
  returnToDock: false,
});

const base: Omit<Rule, "id" | "trigger"> = {
  name: "r",
  enabled: true,
  missionId: "m",
  priority: 1,
  mode: "auto",
  confirmTimeoutSec: 30,
  onTimeout: "run",
  minBattery: 20,
  cooldownSec: 300,
  maxPerHour: 10,
  onPreempted: "resume",
  queueTtlSec: 300,
};

const personRule: Rule = {
  ...base,
  id: "person",
  trigger: { kind: "event", source: "ai", type: "person", zones: ["corr-s"], minConfidence: 0.8, persistSec: 3, countWithin: null, activeWindow: null },
};

const ctx = (patch: Partial<EngineCtx> = {}): EngineCtx => ({
  now: T0,
  rules: [personRule],
  missions: [mission("m")],
  running: null,
  blocked: null,
  battery: 80,
  licensed: () => true,
  zoneName: () => "南走廊",
  ...patch,
});

const det = (patch: Partial<Detection> = {}): Detection => ({ type: "person", zoneId: "corr-s", confidence: 0.9, x: 0, y: -3, trackId: "t1", ...patch });

describe("rule engine — events", () => {
  it("needs the persistence before it fires, then starts the mission", () => {
    const e = new RuleEngine(T0);
    e.onDetection(ctx(), det());
    e.onDetection(ctx({ now: T0 + 1000 }), det());
    expect(e.queue).toHaveLength(0);
    e.onDetection(ctx({ now: T0 + 3000 }), det());
    expect(e.tickQueue(ctx({ now: T0 + 3000 }))[0]?.do).toBe("start");
  });

  it("filters low confidence, wrong zone, and logs why", () => {
    const e = new RuleEngine(T0);
    e.onDetection(ctx(), det({ confidence: 0.6, trackId: "low" }));
    e.onDetection(ctx(), det({ zoneId: "lobby-w", trackId: "elsewhere" }));
    expect(e.queue).toHaveLength(0);
    expect(e.log[0].reason).toMatch(/信心 60%/);
  });

  it("fires once per track and then honours the cooldown", () => {
    const e = new RuleEngine(T0);
    for (let s = 0; s <= 10; s++) e.onDetection(ctx({ now: T0 + s * 1000 }), det());
    expect(e.queue).toHaveLength(1);
    for (let s = 0; s <= 4; s++) e.onDetection(ctx({ now: T0 + 60_000 + s * 1000 }), det({ trackId: "t2" }));
    expect(e.queue).toHaveLength(1);
    expect(e.log[0].reason).toMatch(/冷卻中/);
  });

  it("confirm mode waits for a phone, and runs on timeout when told to", () => {
    const e = new RuleEngine(T0);
    const c = ctx({ rules: [{ ...personRule, mode: "confirm" }] });
    for (let s = 0; s <= 3; s++) e.onDetection({ ...c, now: T0 + s * 1000 }, det());
    expect(e.confirms.size).toBe(1);
    expect(e.tickQueue({ ...c, now: T0 + 10_000 })).toHaveLength(0);
    const d = e.tickQueue({ ...c, now: T0 + 40_000 });
    expect(d[0]?.do).toBe("start");
    expect(d[0].act.cause.confirmedBy).toBe("逾時自動");
  });
});

describe("rule engine — arbitration", () => {
  it("P1 preempts a running P2; P2 only queues behind P1", () => {
    const e = new RuleEngine(T0);
    for (let s = 0; s <= 3; s++) e.onDetection(ctx({ now: T0 + s * 1000 }), det());
    expect(e.tickQueue(ctx({ now: T0 + 3000, running: { priority: 2 } }))[0]?.do).toBe("preempt");

    const e2 = new RuleEngine(T0);
    const p2 = { ...personRule, priority: 2 as const };
    for (let s = 0; s <= 3; s++) e2.onDetection(ctx({ rules: [p2], now: T0 + s * 1000 }), det());
    expect(e2.tickQueue(ctx({ rules: [p2], now: T0 + 3000, running: { priority: 1 } }))).toHaveLength(0);
    expect(e2.log[0].reason).toMatch(/排隊中/);
  });

  it("never takes the stick from an operator, and drops stale activations", () => {
    const e = new RuleEngine(T0);
    for (let s = 0; s <= 3; s++) e.onDetection(ctx({ now: T0 + s * 1000 }), det());
    expect(e.tickQueue(ctx({ now: T0 + 3000, blocked: "teleop" }))).toHaveLength(0);
    expect(e.log[0].reason).toMatch(/手動操控/);
    expect(e.tickQueue(ctx({ now: T0 + 400_000, blocked: "teleop" }))).toHaveLength(0);
    expect(e.queue).toHaveLength(0);
    expect(e.log[0].outcome).toBe("expired");
  });
});

describe("rule engine — time", () => {
  it("fires an interval slot once, jittered deterministically", () => {
    const rule: Rule = {
      ...base,
      id: "night",
      priority: 2,
      trigger: { kind: "time", schedule: { type: "interval", minutes: 30, window: { from: "22:00", to: "06:00" } }, jitterMin: 5, missed: "skip", graceMin: 0 },
    };
    const e = new RuleEngine(T0 - 60_000);
    const c = ctx({ rules: [rule] });
    const j = jitterFor("night", T0, 5);
    expect(Math.abs(j)).toBeLessThanOrEqual(5 * 60_000);
    let starts = 0;
    for (let m = -1; m <= 10; m++) {
      e.tickTime({ ...c, now: T0 + m * 60_000 });
      starts += e.tickQueue({ ...c, now: T0 + m * 60_000 }).filter((d) => d.do === "start").length;
    }
    // The 23:00 slot (±5 min) fires exactly once within [22:59, 23:10] if its jitter lands there.
    expect(starts).toBe(j > 10 * 60_000 || j < -60_000 ? 0 : 1);
  });
});
