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
  default: { ...base, id: "default", label: "全綠", verifies: "正常流程" },
  weak_signal: {
    ...base,
    id: "weak_signal",
    label: "弱訊號",
    verifies: "連線不穩通知、搖桿鎖定、影像降級",
    // 100–500 ms, slow enough that each band is visible for a few seconds.
    rtt: (t) => 300 + Math.sin(t / 4) * 200 + (Math.random() - 0.5) * 40,
  },
  low_battery: {
    ...base,
    id: "low_battery",
    label: "低電量",
    verifies: "電量警示、充電中、排程耗電提醒",
    battery: 12,
    drain: 3,
  },
  estop_remote: {
    ...base,
    id: "estop_remote",
    label: "遠端 E-Stop",
    verifies: "別支手機按下急停、長按解除",
    timeline: [{ at: 30, do: "estop_remote" }],
  },
  gateway_down: {
    ...base,
    id: "gateway_down",
    label: "Gateway 掛掉",
    verifies: "只剩藍牙、重啟 Gateway",
    timeline: [{ at: 45, do: "gateway_down" }],
  },
  revoked: {
    ...base,
    id: "revoked",
    label: "被撤銷",
    verifies: "被撤銷後回到開始畫面",
    timeline: [{ at: 60, do: "revoked" }],
  },
  no_license: {
    ...base,
    id: "no_license",
    label: "無任務 License",
    verifies: "任務分頁鎖定",
    missionLicense: false,
  },
  viewer: { ...base, id: "viewer", label: "檢視者角色", verifies: "操控與任務分頁鎖定", forceRole: "viewer" },
  fault: {
    ...base,
    id: "fault",
    label: "小腦 FAULT",
    verifies: "故障全螢幕說明",
    timeline: [{ at: 4, do: "fault" }],
  },
  perf: {
    ...base,
    id: "perf",
    label: "效能",
    verifies: "畫面流暢度與記憶體",
    pointBudget: 400_000,
    telemetryHz: 50,
  },
};

export function scenarioFromUrl(): ScenarioId {
  if (typeof window === "undefined") return "default";
  const q = new URLSearchParams(window.location.search).get("scenario");
  return (SCENARIO_IDS as readonly string[]).includes(q ?? "") ? (q as ScenarioId) : "default";
}
