import { DEFAULT_FENCE, GRID, snapToFree } from "./floor";

import type { Detection, DeviceInfo, DogAdvert, DogEvent, Mission, PairedPhone, PluginManifest, Rule, RunRecord, Waypoint } from "@/proto/types";

export const DOGS: DogAdvert[] = [
  { id: "dog-a", serial: "SD2026-0917-7F3A", name: "SyncAI-Dog 7F3A", rssi: -58, hasOwner: false, pairingMode: true },
  { id: "dog-b", serial: "SD2026-0822-21C8", name: "SyncAI-Dog 21C8", rssi: -74, hasOwner: true, pairingMode: true },
];

export const FIRMWARE = { cerebellum: "cb-3.4.1", gateway: "gw-0.9.2", app: "0.1.0-mock" };

let seq = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

function wp(x: number, y: number, actions: Waypoint["actions"] = []): Waypoint {
  const p = snapToFree(GRID, x, y);
  return { id: uid("wp"), x: p.x, y: p.y, toleranceM: 0.4, actions };
}

export const GAS_PLUGIN: PluginManifest = {
  id: "com.syncai.gas",
  name: "氣體偵測",
  version: "1.2.0",
  enabled: true,
  capabilities: ["sensor.gas"],
  missionActions: [
    {
      id: "gas.sample",
      label: "氣體採樣",
      icon: "flask",
      requires: ["sensor.gas"],
      estimateSec: 15,
      schema: {
        type: "object",
        required: ["gas"],
        properties: {
          gas: { type: "string", title: "氣體種類", enum: ["CO", "CO2", "H2S", "VOC"], default: "CO" },
          duration: { type: "integer", title: "採樣秒數", minimum: 5, maximum: 60, default: 15 },
          alarm_ppm: { type: "number", title: "警報門檻 (ppm)", minimum: 0, maximum: 500, default: 35 },
          notify: { type: "boolean", title: "超標時推播", default: true },
          tags: { type: "array", title: "標籤", items: { type: "string" } },
          // Deliberately outside the renderer's subset — shows the graceful path (§11).
          calibration: { type: "object", title: "校正參數", properties: { offset: { type: "object" } } },
        },
      },
    },
  ],
};

export const THERMAL_PLUGIN: PluginManifest = {
  id: "com.syncai.meter",
  name: "儀表判讀",
  version: "0.4.0",
  enabled: true,
  capabilities: ["camera.zoom"],
  missionActions: [
    {
      id: "meter.read",
      label: "讀取儀表",
      icon: "gauge",
      requires: ["camera.zoom"],
      estimateSec: 8,
      schema: {
        type: "object",
        properties: {
          meter: { type: "string", title: "儀表名稱" },
          expected_min: { type: "number", title: "正常下限" },
          expected_max: { type: "number", title: "正常上限" },
          check_at: { type: "string", title: "只在此時間後判讀", format: "time" },
        },
      },
    },
  ],
};

const POLICY = { onLowBattery: "return_to_dock", onObstacle: "reroute", waitSec: 10, allowTeleopPreempt: true } as const;
const NO_RESPONSE = { approachM: 1.5, actions: [] };

/** WHAT the dog does — reusable templates. WHEN lives in `seedRules`. */
export function seedMissions(): Mission[] {
  return [
    {
      id: "m-loop",
      name: "走廊巡邏一圈",
      kind: "patrol",
      route: [
        wp(-13, -2.75),
        wp(-2, -2.75, [{ type: "snapshot", camera: "front" }]),
        wp(13, -2.75),
        wp(13, 2.75, [{ type: "thermal" }]),
        wp(2, 2.75, [{ type: "snapshot", camera: "front" }]),
        wp(-13, 2.75, [{ type: "wait", sec: 3 }]),
      ],
      response: NO_RESPONSE,
      policy: POLICY,
      returnToDock: true,
    },
    {
      id: "m-server",
      name: "機房熱像巡檢",
      kind: "patrol",
      route: [
        wp(-13, -2.75),
        wp(9, -2.75),
        wp(9, -5.5, [{ type: "thermal" }, { type: "plugin", pluginId: GAS_PLUGIN.id, actionId: "gas.sample", params: { gas: "CO", duration: 15, alarm_ppm: 35, notify: true } }]),
        wp(9, -2.75),
      ],
      response: NO_RESPONSE,
      policy: { ...POLICY, onLowBattery: "pause", onObstacle: "wait", waitSec: 20, allowTeleopPreempt: false },
      returnToDock: true,
    },
    {
      id: "m-lobby",
      name: "大廳閉館廣播",
      kind: "patrol",
      route: [wp(15, 0, [{ type: "announce", clipId: "clip-closing" }])],
      response: NO_RESPONSE,
      policy: { ...POLICY, onObstacle: "abort" },
      returnToDock: false,
    },
    {
      id: "m-investigate",
      name: "前往查看",
      kind: "response",
      route: [],
      response: { approachM: 1.5, actions: [{ type: "snapshot", camera: "front" }, { type: "thermal" }] },
      policy: POLICY,
      returnToDock: true,
    },
    {
      id: "m-deter",
      name: "驅離廣播",
      kind: "response",
      route: [],
      response: { approachM: 3, actions: [{ type: "snapshot", camera: "front" }, { type: "announce", clipId: "clip-restricted" }] },
      policy: POLICY,
      returnToDock: true,
    },
  ];
}

const RULE_BASE = {
  enabled: true,
  mode: "auto",
  confirmTimeoutSec: 30,
  onTimeout: "run",
  minBattery: 25,
  cooldownSec: 300,
  maxPerHour: 6,
  onPreempted: "resume",
  queueTtlSec: 300,
} as const;

/** WHEN and WHY — see docs/2026-09-23-mission-triggers-design.md. */
export function seedRules(): Rule[] {
  return [
    {
      ...RULE_BASE,
      id: "r-day",
      name: "日間例行巡邏",
      trigger: { kind: "time", schedule: { type: "interval", minutes: 120, window: { from: "08:00", to: "20:00" } }, jitterMin: 10, missed: "catch_up", graceMin: 15 },
      missionId: "m-loop",
      priority: 2,
      queueTtlSec: 1800,
    },
    {
      ...RULE_BASE,
      id: "r-night",
      name: "夜間巡邏",
      trigger: { kind: "time", schedule: { type: "interval", minutes: 45, window: { from: "22:00", to: "06:00" } }, jitterMin: 10, missed: "catch_up", graceMin: 15 },
      missionId: "m-loop",
      priority: 2,
      queueTtlSec: 1800,
    },
    {
      ...RULE_BASE,
      id: "r-server",
      name: "機房巡檢",
      trigger: { kind: "time", schedule: { type: "weekly", days: [1, 4], time: "02:00" }, jitterMin: 0, missed: "skip", graceMin: 0 },
      missionId: "m-server",
      priority: 2,
      minBattery: 40,
    },
    {
      ...RULE_BASE,
      id: "r-lobby",
      name: "閉館廣播",
      enabled: false,
      trigger: { kind: "time", schedule: { type: "daily", time: "21:30" }, jitterMin: 0, missed: "skip", graceMin: 0 },
      missionId: "m-lobby",
      priority: 3,
    },
    {
      ...RULE_BASE,
      id: "r-person",
      name: "走廊人員查看",
      trigger: { kind: "event", source: "ai", type: "person", zones: ["corr-n", "corr-s", "lobby-e"], minConfidence: 0.8, persistSec: 3, countWithin: null, activeWindow: null },
      missionId: "m-investigate",
      priority: 1,
      mode: "confirm",
      confirmTimeoutSec: 30,
      onTimeout: "run",
    },
    {
      ...RULE_BASE,
      id: "r-intrusion",
      name: "限制區入侵",
      trigger: { kind: "event", source: "ai", type: "intrusion", zones: ["s3", "core"], minConfidence: 0.75, persistSec: 2, countWithin: null, activeWindow: null },
      missionId: "m-deter",
      priority: 0,
      cooldownSec: 120,
      minBattery: 15,
    },
    {
      ...RULE_BASE,
      id: "r-fall",
      name: "人員倒地",
      trigger: { kind: "event", source: "ai", type: "fall", zones: [], minConfidence: 0.7, persistSec: 5, countWithin: null, activeWindow: null },
      missionId: "m-investigate",
      priority: 0,
      minBattery: 10,
    },
    {
      ...RULE_BASE,
      id: "r-door",
      name: "門未關提醒",
      trigger: { kind: "event", source: "ai", type: "door_open", zones: [], minConfidence: 0.7, persistSec: 10, countWithin: null, activeWindow: { from: "20:00", to: "07:00" } },
      missionId: "m-investigate",
      priority: 1,
      mode: "notify",
    },
  ];
}

export function seedHistory(now: number): RunRecord[] {
  const day = 86_400_000;
  const time = (text: string, ruleId: string) => ({ kind: "time" as const, ruleId, text });
  return [
    { id: "r1", missionId: "m-loop", startedAt: now - day + 3_600_000, endedAt: now - day + 3_700_000, result: "success", arrivals: [0, 1, 2, 3, 4, 5].map((i) => ({ wp: i, at: now - day + 3_600_000 + i * 15_000 })), cause: time("排程 22:45", "r-night"), priority: 2 },
    { id: "r5", missionId: "m-investigate", startedAt: now - day + 3_750_000, endedAt: now - day + 3_800_000, result: "success", arrivals: [{ wp: 0, at: now - day + 3_780_000 }], cause: { kind: "event", ruleId: "r-person", text: "偵測到人員 @ 南走廊（88%）", confirmedBy: "夜班 · Pixel 8" }, priority: 1 },
    { id: "r2", missionId: "m-server", startedAt: now - 2 * day, endedAt: now - 2 * day + 40_000, result: "aborted", reason: "障礙物等待逾時（20 秒）@ 航點 3", arrivals: [0, 1].map((i) => ({ wp: i, at: now - 2 * day + i * 18_000 })), cause: time("排程 02:00", "r-server"), priority: 2 },
    { id: "r3", missionId: "m-loop", startedAt: now - 2 * day + 3_600_000, endedAt: now - 2 * day + 3_690_000, result: "success", arrivals: [0, 1, 2, 3, 4, 5].map((i) => ({ wp: i, at: now - 2 * day + 3_600_000 + i * 15_000 })), cause: time("排程 23:30", "r-night"), priority: 2 },
    { id: "r4", missionId: "m-lobby", startedAt: now - 3 * day, endedAt: now - 3 * day + 20_000, result: "failed", reason: "喇叭無回應（mediad 0x21）", arrivals: [], cause: time("排程 21:30", "r-lobby"), priority: 3 },
  ];
}

export function seedPhones(myRole: PairedPhone["role"], now: number): PairedPhone[] {
  const me: PairedPhone = { id: "phone-me", nickname: "本機 · iPhone 15", role: myRole, lastSeen: now, online: true, mine: true };
  const others: PairedPhone[] = [
    { id: "phone-guard2", nickname: "夜班 · Pixel 8", role: "operator", lastSeen: now - 3 * 3_600_000, online: false, mine: false },
    { id: "phone-lobby", nickname: "櫃台 · iPad", role: "viewer", lastSeen: now - 120_000, online: true, mine: false },
  ];
  if (myRole === "owner") return [me, ...others];
  return [{ id: "phone-owner", nickname: "主管 · iPhone 14", role: "owner", lastSeen: now - 60_000, online: true, mine: false }, me, ...others];
}

export function seedDevice(now: number, missionLicense: boolean): DeviceInfo {
  return {
    name: "巡邏犬 7F3A",
    serial: DOGS[0].serial,
    versions: { ...FIRMWARE },
    bootAt: now - 5 * 3_600_000 - 12 * 60_000,
    services: [
      { name: "navd", state: "up" },
      { name: "mediad", state: "up" },
      { name: "perceptiond", state: "up" },
    ],
    cpu: 34,
    memPct: 58,
    tempC: 51,
    storagePct: 41,
    network: { ssid: "SyncAI-Office", ip: "192.168.50.23", signal: -61 },
    safety: { speedLimit: 1.2, outsideFence: "stop", estopLieSec: 3 },
    license: [
      { feature: "teleop", granted: true },
      { feature: "map", granted: true },
      { feature: "mission", granted: missionLicense },
      { feature: "talk", granted: true },
      { feature: "ai", granted: true },
    ],
    licenseExpiresAt: now + 5 * 86_400_000,
    licenseEdition: "pro",
    licenseKeyMasked: null,
    plugins: [GAS_PLUGIN, THERMAL_PLUGIN],
    clips: [
      { id: "clip-restricted", name: "此區域禁止進入", sec: 4 },
      { id: "clip-closing", name: "大樓即將關閉，請盡速離開", sec: 6 },
      { id: "clip-identify", name: "請出示識別證", sec: 3 },
    ],
  };
}

export { DEFAULT_FENCE };

/** The dog's own event log on first connect: a day of what the event tab should show. */
export function seedEvents(now: number): DogEvent[] {
  const min = 60_000;
  const hr = 60 * min;
  const det = (type: Detection["type"], zoneId: string, confidence: number, x: number, y: number, n: number): Detection => ({ type, zoneId, confidence, x, y, trackId: `trk-${n}` });
  const rows: [number, DogEvent["kind"], DogEvent["level"], string, Detection?][] = [
    [6 * min, "mission", "info", "「日間例行巡邏」完成 · 6/6 航點"],
    [14 * min, "perception", "info", "偵測到人員 @ 北走廊（信心 72%）· 未達門檻，未觸發", det("person", "corr-n", 0.72, -3.2, 2.6, 118)],
    [38 * min, "system", "warning", "電量 30%，已提前返回充電"],
    [52 * min, "perception", "warning", "門未關 @ 資料室 · 已通知", det("door_open", "s3", 0.84, 6.8, -5.1, 117)],
    [1 * hr + 10 * min, "fence", "warning", "接近地理圍欄邊界 · 已減速"],
    [2 * hr + 5 * min, "teleop", "info", "夜班 · Pixel 8 取得操控權"],
    [2 * hr + 7 * min, "estop", "critical", "緊急停止 · 由 夜班 · Pixel 8 觸發"],
    [2 * hr + 9 * min, "estop", "info", "緊急停止已解除"],
    [3 * hr, "mission", "info", "「機房巡檢」完成 · 熱像無異常"],
    [9 * hr + 20 * min, "perception", "critical", "限制區入侵 @ 核心區（信心 91%）· 已出動", det("intrusion", "core", 0.91, 1.4, 0.2, 116)],
    [9 * hr + 21 * min, "mission", "warning", "「限制區應變」打斷「夜間巡邏」· 完成後從航點 4 繼續"],
    [9 * hr + 30 * min, "perception", "warning", "偵測到人員 @ 南走廊（信心 88%）· 夜班 · Pixel 8 確認出動", det("person", "corr-s", 0.88, -1.8, -2.9, 115)],
    [11 * hr, "missions_changed", "info", "規則「閉館廣播」已停用"],
    [15 * hr, "approval", "info", "iPhone 15（操作員）已加入"],
    [20 * hr, "system", "info", "Gateway 更新到 gw-0.9.2"],
    [23 * hr, "perception", "warning", "遺留物 @ 西側大廳（信心 80%）· 已通知", det("abandoned", "lobby-w", 0.8, -13.5, 0.9, 114)],
  ];
  return rows.map(([ago, kind, level, text, detection], i) => ({ id: `ev-seed-${i}`, at: now - ago, kind, level, text, detection }));
}
