import { DEFAULT_FENCE, GRID, snapToFree } from "./floor";

import type { DeviceInfo, DogAdvert, Mission, PairedPhone, PluginManifest, RunRecord, Waypoint } from "@/proto/types";

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

export function seedMissions(): Mission[] {
  return [
    {
      id: "m-loop",
      name: "夜間巡邏 · 走廊一圈",
      enabled: true,
      route: [
        wp(-13, -2.75),
        wp(-2, -2.75, [{ type: "snapshot", camera: "front" }]),
        wp(13, -2.75),
        wp(13, 2.75, [{ type: "thermal" }]),
        wp(2, 2.75, [{ type: "snapshot", camera: "front" }]),
        wp(-13, 2.75, [{ type: "wait", sec: 3 }]),
      ],
      trigger: { type: "daily", time: "22:00" },
      policy: { onLowBattery: "return_to_dock", onObstacle: "reroute", waitSec: 10, allowTeleopPreempt: true },
      returnToDock: true,
    },
    {
      id: "m-server",
      name: "機房熱像巡檢",
      enabled: true,
      route: [
        wp(-13, -2.75),
        wp(9, -2.75),
        wp(9, -5.5, [{ type: "thermal" }, { type: "plugin", pluginId: GAS_PLUGIN.id, actionId: "gas.sample", params: { gas: "CO", duration: 15, alarm_ppm: 35, notify: true } }]),
        wp(9, -2.75),
      ],
      trigger: { type: "weekly", days: [1, 4], time: "02:00" },
      policy: { onLowBattery: "pause", onObstacle: "wait", waitSec: 20, allowTeleopPreempt: false },
      returnToDock: true,
    },
    {
      id: "m-lobby",
      name: "大廳定時廣播",
      enabled: false,
      route: [wp(15, 0, [{ type: "announce", clipId: "clip-closing" }])],
      trigger: { type: "interval", minutes: 30 },
      policy: { onLowBattery: "return_to_dock", onObstacle: "abort", waitSec: 10, allowTeleopPreempt: true },
      returnToDock: false,
    },
  ];
}

export function seedHistory(now: number): RunRecord[] {
  const day = 86_400_000;
  return [
    { id: "r1", missionId: "m-loop", startedAt: now - day + 3_600_000, endedAt: now - day + 3_700_000, result: "success", arrivals: [0, 1, 2, 3, 4, 5].map((i) => ({ wp: i, at: now - day + 3_600_000 + i * 15_000 })) },
    { id: "r2", missionId: "m-server", startedAt: now - 2 * day, endedAt: now - 2 * day + 40_000, result: "aborted", reason: "障礙物等待逾時（20 秒）@ 航點 3", arrivals: [0, 1].map((i) => ({ wp: i, at: now - 2 * day + i * 18_000 })) },
    { id: "r3", missionId: "m-loop", startedAt: now - 2 * day + 3_600_000, endedAt: now - 2 * day + 3_690_000, result: "success", arrivals: [0, 1, 2, 3, 4, 5].map((i) => ({ wp: i, at: now - 2 * day + 3_600_000 + i * 15_000 })) },
    { id: "r4", missionId: "m-lobby", startedAt: now - 3 * day, endedAt: now - 3 * day + 20_000, result: "failed", reason: "喇叭無回應（mediad 0x21）", arrivals: [] },
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
