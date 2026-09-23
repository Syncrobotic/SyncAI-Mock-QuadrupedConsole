import { describe, expect, it } from "vitest";

import { ROLE_SCOPES } from "@/proto/types";

import {
  canTransition,
  effectiveSpeedCap,
  estopRoute,
  nextRttZone,
  shapeAxis,
  stickLock,
  tabAccess,
  type AccessContext,
} from "./logic";

const ctx = (patch: Partial<AccessContext> = {}): AccessContext => ({
  conn: "Online",
  scopes: ROLE_SCOPES.owner,
  license: { mission: true, talk: true },
  mode: "IDLE",
  restarting: false,
  ...patch,
});

describe("connection state machine", () => {
  it("follows the spec diagram", () => {
    expect(canTransition("Unpaired", "Onboarding")).toBe(true);
    expect(canTransition("Connecting", "Online")).toBe(true);
    expect(canTransition("Online", "Degraded")).toBe(true);
    expect(canTransition("Degraded", "BleOnly")).toBe(true);
    expect(canTransition("BleOnly", "Connecting")).toBe(true);
    expect(canTransition("Online", "Unpaired")).toBe(true);
  });

  it("refuses shortcuts the diagram does not have", () => {
    expect(canTransition("Unpaired", "Online")).toBe(false);
    expect(canTransition("Unreachable", "Online")).toBe(false);
    expect(canTransition("BleOnly", "Online")).toBe(false);
  });
});

describe("RTT bands", () => {
  it("degrades immediately", () => {
    const z = nextRttZone({ level: "good", goodSince: 0 }, 400, 1000);
    expect(z.level).toBe("poor");
  });

  it("needs two continuous seconds of green to unlock", () => {
    let z = nextRttZone({ level: "poor", goodSince: null }, 60, 0);
    expect(z.level).toBe("poor");
    z = nextRttZone(z, 60, 1500);
    expect(z.level).toBe("poor");
    z = nextRttZone(z, 60, 2000);
    expect(z.level).toBe("good");
  });

  it("a single bad reading restarts the dwell", () => {
    let z = nextRttZone({ level: "poor", goodSince: null }, 60, 0);
    z = nextRttZone(z, 200, 1000);
    z = nextRttZone(z, 60, 1500);
    z = nextRttZone(z, 60, 3000);
    expect(z.level).toBe("fair");
    z = nextRttZone(z, 60, 3500);
    expect(z.level).toBe("good");
  });

  it("clamps the stick to 0.5 m/s in the yellow band", () => {
    expect(effectiveSpeedCap(1.2, 1.5, "fair")).toBe(0.5);
    expect(effectiveSpeedCap(1.2, 0.8, "good")).toBe(0.8);
  });
});

describe("joystick shaping", () => {
  it("has an 8% dead zone and reaches full scale", () => {
    expect(shapeAxis(0.07)).toBe(0);
    expect(shapeAxis(-0.07)).toBe(0);
    expect(shapeAxis(1)).toBeCloseTo(1);
    expect(shapeAxis(-1)).toBeCloseTo(-1);
  });

  it("is finer at low speed than linear", () => {
    expect(shapeAxis(0.5)).toBeLessThan(0.5);
  });
});

describe("E-Stop route", () => {
  it("goes over BLE when the WS is down and is disabled when nothing reaches the dog", () => {
    expect(estopRoute("Online")).toBe("ws");
    expect(estopRoute("Degraded")).toBe("ws");
    expect(estopRoute("BleOnly")).toBe("ble");
    expect(estopRoute("Unreachable")).toBe("disabled");
  });
});

describe("tab access", () => {
  it("the device tab is never locked", () => {
    expect(tabAccess("device", ctx({ conn: "Unreachable", mode: "FAULT" })).locked).toBe(false);
  });

  it("viewer sees teleop, mission and talk locked with a reason", () => {
    for (const tab of ["teleop", "mission", "talk"] as const) {
      const a = tabAccess(tab, ctx({ scopes: ROLE_SCOPES.viewer }));
      expect(a).toEqual({ locked: true, reason: "需要 Operator 權限" });
    }
  });

  it("an unlicensed feature is locked for the owner too, naming the licence", () => {
    expect(tabAccess("mission", ctx({ license: { mission: false } }))).toEqual({ locked: true, reason: "任務排程未授權" });
  });

  it("degraded keeps every tab open but disables the stick", () => {
    for (const tab of ["teleop", "mission", "talk"] as const) expect(tabAccess(tab, ctx({ conn: "Degraded" })).locked).toBe(false);
    const stick = { conn: "Online" as const, rtt: "good" as const, mode: "TELEOP" as const, posture: "stand", mine: true };
    expect(stickLock(stick)).toBeNull();
    expect(stickLock({ ...stick, conn: "Degraded" })).toBe("訊號不足");
    expect(stickLock({ ...stick, rtt: "poor" })).toBe("訊號不足");
    expect(stickLock({ ...stick, mode: "ESTOP" })).toBe("已緊急停止");
    expect(stickLock({ ...stick, posture: "sit" })).toBe("請先站立");
  });

  it("BleOnly, FAULT and a gateway restart lock everything but the device tab", () => {
    for (const patch of [{ conn: "BleOnly" as const }, { mode: "FAULT" as const }, { restarting: true }])
      for (const tab of ["teleop", "mission", "talk"] as const) expect(tabAccess(tab, ctx(patch)).locked).toBe(true);
  });
});
