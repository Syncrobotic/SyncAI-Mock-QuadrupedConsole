/**
 * Mock scenarios (spec §15). Selected by `?scenario=` or the dev menu; a switch
 * rebuilds the whole mock link so every channel sees the same world.
 */

export const SCENARIO_IDS = [
  "default",
  "weak_signal",
  "low_battery",
  "estop_remote",
  "gateway_down",
  "revoked",
  "no_license",
  "viewer",
  "fault",
  "perf",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export interface Scenario {
  id: ScenarioId;
  label: string;
  verifies: string;
  battery: number;
  /** % per minute. Spec default is 0.5. */
  drain: number;
  rtt: (tSec: number) => number;
  pointBudget: number;
  telemetryHz: number;
  missionLicense: boolean;
  forceRole?: "viewer";
  /** Seconds after connect → what happens. */
  timeline: { at: number; do: "estop_remote" | "gateway_down" | "revoked" | "fault" }[];
}

const base: Omit<Scenario, "id" | "label" | "verifies"> = {
  battery: 78,
  drain: 0.5,
  rtt: (t) => 38 + Math.sin(t / 3) * 6 + Math.random() * 6,
  pointBudget: 200_000,
  telemetryHz: 20,
  missionLicense: true,
  timeline: [],
};

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  default: { ...base, id: "default", label: "全綠", verifies: "主流程" },
  weak_signal: {
    ...base,
    id: "weak_signal",
    label: "弱訊號",
    verifies: "操控鎖定、Degraded banner、影像降級",
    // 100–500 ms, slow enough that each band is visible for a few seconds.
    rtt: (t) => 300 + Math.sin(t / 4) * 200 + (Math.random() - 0.5) * 40,
  },
  low_battery: {
    ...base,
    id: "low_battery",
    label: "低電量",
    verifies: "任務衝突警告、充電狀態",
    battery: 12,
    drain: 3,
  },
  estop_remote: {
    ...base,
    id: "estop_remote",
    label: "遠端 E-Stop",
    verifies: "ESTOP 鏡射、解除流程",
    timeline: [{ at: 30, do: "estop_remote" }],
  },
  gateway_down: {
    ...base,
    id: "gateway_down",
    label: "Gateway 掛掉",
    verifies: "BleOnly、重啟 Gateway 流程",
    timeline: [{ at: 45, do: "gateway_down" }],
  },
  revoked: {
    ...base,
    id: "revoked",
    label: "被撤銷",
    verifies: "退回 Unpaired",
    timeline: [{ at: 60, do: "revoked" }],
  },
  no_license: {
    ...base,
    id: "no_license",
    label: "無任務 License",
    verifies: "鎖定態",
    missionLicense: false,
  },
  viewer: { ...base, id: "viewer", label: "檢視者角色", verifies: "scope 鎖定", forceRole: "viewer" },
  fault: {
    ...base,
    id: "fault",
    label: "小腦 FAULT",
    verifies: "全螢幕錯誤",
    timeline: [{ at: 4, do: "fault" }],
  },
  perf: {
    ...base,
    id: "perf",
    label: "效能",
    verifies: "fps 與記憶體",
    pointBudget: 400_000,
    telemetryHz: 50,
  },
};

export function scenarioFromUrl(): ScenarioId {
  if (typeof window === "undefined") return "default";
  const q = new URLSearchParams(window.location.search).get("scenario");
  return (SCENARIO_IDS as readonly string[]).includes(q ?? "") ? (q as ScenarioId) : "default";
}
