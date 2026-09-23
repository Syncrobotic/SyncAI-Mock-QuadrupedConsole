import type { DogMode, LicenseFeature, Scope } from "@/proto/types";

/**
 * The rules the UI is a function of (spec §13: "UI 的每個畫面都是這兩者的函數").
 * Pure, so they are tested directly rather than through a rendered screen.
 */

// ── Connection state machine ─────────────────────────────────────────────────

export type ConnState = "Unpaired" | "Onboarding" | "Paired" | "Connecting" | "Online" | "Degraded" | "BleOnly" | "Unreachable";

const TRANSITIONS: Record<ConnState, readonly ConnState[]> = {
  Unpaired: ["Onboarding"],
  Onboarding: ["Paired", "Unpaired", "BleOnly"],
  Paired: ["Connecting", "Unpaired"],
  Connecting: ["Online", "BleOnly", "Unreachable", "Paired", "Unpaired"],
  Online: ["Degraded", "Unpaired", "Paired", "BleOnly"],
  Degraded: ["Online", "BleOnly", "Paired", "Unpaired"],
  BleOnly: ["Connecting", "Paired", "Unpaired"],
  Unreachable: ["Connecting", "Paired", "Unpaired"],
};

/**
 * Beyond the spec diagram: every state may go to `Paired` (app backgrounded,
 * §13 前景/背景) and to `Unpaired` (local pairing cleared, §10 本機), and
 * `Online → BleOnly` covers a WS that drops with no Degraded phase in between.
 * `Onboarding → BleOnly` is the "skip Wi-Fi" exit (§4).
 */
export function canTransition(from: ConnState, to: ConnState) {
  return from === to || TRANSITIONS[from].includes(to);
}

export const isLive = (c: ConnState) => c === "Online" || c === "Degraded";

// ── RTT bands with hysteresis (§7 RTT 鎖定) ──────────────────────────────────

export type RttLevel = "good" | "fair" | "poor";

export function rawRttLevel(rtt: number): RttLevel {
  return rtt < 150 ? "good" : rtt <= 300 ? "fair" : "poor";
}

export interface RttZone {
  level: RttLevel;
  /** When the raw reading last became `good`, or null while it is not. */
  goodSince: number | null;
}

/**
 * Degrading is immediate; recovering to green needs 2 s of continuous green
 * ("連續 2 秒回到綠才解鎖，避免抖動"). Between fair and poor the band follows
 * the reading directly — only unlocking needs the dwell.
 */
export function nextRttZone(prev: RttZone, rtt: number, now: number): RttZone {
  const raw = rawRttLevel(rtt);
  if (raw !== "good") return { level: raw, goodSince: null };
  const goodSince = prev.goodSince ?? now;
  if (prev.level === "good" || now - goodSince >= 2000) return { level: "good", goodSince };
  return { level: prev.level, goodSince };
}

/** Speed cap the stick may use: user cap, global cap, and the fair-band clamp. */
export function effectiveSpeedCap(userCap: number, globalCap: number, level: RttLevel) {
  const cap = Math.min(userCap, globalCap);
  return level === "fair" ? Math.min(cap, 0.5) : cap;
}

// ── Joystick shaping (§7) ────────────────────────────────────────────────────

export const DEAD_ZONE = 0.08;

/** Dead zone, then an ease-in curve: fine at low speed, coarse at high. */
export function shapeAxis(v: number) {
  const a = Math.abs(v);
  if (a < DEAD_ZONE) return 0;
  const t = (a - DEAD_ZONE) / (1 - DEAD_ZONE);
  return Math.sign(v) * t * t;
}

// ── E-Stop path (§5, §13) ────────────────────────────────────────────────────

export type EstopRoute = "ws" | "ble" | "disabled";

export function estopRoute(conn: ConnState): EstopRoute {
  if (isLive(conn)) return "ws";
  if (conn === "BleOnly" || conn === "Connecting") return "ble";
  return "disabled";
}

// ── Tab access (§2, §5 鎖定態, §13 table) ────────────────────────────────────

export type Tab = "teleop" | "mission" | "events" | "device";
/** What access is asked about: a tab, or the call — which lives inside the teleop tab. */
export type Area = Tab | "talk";

export interface AccessContext {
  conn: ConnState;
  scopes: readonly Scope[];
  license: Partial<Record<LicenseFeature, boolean>>;
  mode: DogMode | null;
  restarting: boolean;
}

export type Access = { locked: false } | { locked: true; reason: string };

const OPEN: Access = { locked: false };
const lock = (reason: string): Access => ({ locked: true, reason });

const TAB_SCOPE: Record<Exclude<Area, "device" | "events">, Scope> = {
  teleop: "teleop",
  mission: "mission.rw",
  talk: "media.talk",
};

export function tabAccess(tab: Area, ctx: AccessContext): Access {
  // The device page always has content (§10); the event log shows what is cached even offline.
  if (tab === "device" || tab === "events") return OPEN;

  if (ctx.restarting) return lock("Gateway 重啟中");
  if (ctx.conn === "BleOnly") return lock("未連上 Gateway，只剩藍牙");
  if (ctx.conn === "Unreachable") return lock("找不到狗");
  if (ctx.conn === "Connecting" || ctx.conn === "Paired") return lock("連線中…");
  if (ctx.mode === "FAULT") return lock("FAULT 中，只保留裝置頁與 E-Stop");

  // License is shown to every role, before scope (§2: 不隱藏，註明原因).
  if (tab === "teleop" && ctx.license.teleop === false) return lock("手動操控未授權");
  if (tab === "mission" && ctx.license.mission === false) return lock("任務排程未授權");
  if (tab === "talk" && ctx.license.talk === false) return lock("通話功能未授權");

  if (!ctx.scopes.includes(TAB_SCOPE[tab])) return lock("需要操作員權限");

  // Degraded does NOT lock the teleop tab: the stick is disabled inside it
  // (see `stickLock`) so the operator can watch the RTT come back (§7).
  return OPEN;
}

/** One line under a locked tab's reason: what to do about it. */
export function lockDetail(reason: string): string | undefined {
  if (reason.includes("未授權")) return "這隻狗的 License 不含此功能。擁有者可以在裝置頁更換 License 金鑰。";
  if (reason.includes("權限")) return "你的角色沒有這個功能。需要時請擁有者在裝置頁調整角色。";
  if (reason.includes("藍牙")) return "WS 斷線時只剩藍牙：可以用 E-Stop 與裝置頁。恢復連線後自動解鎖。";
  if (reason.includes("找不到")) return "藍牙與區網都沒有回應。靠近狗、確認開機後重試。";
  if (reason.includes("FAULT")) return "狗回報故障。請依裝置頁的建議處理。";
  if (reason.includes("重啟")) return "Gateway 重啟完成後會自動解鎖。";
  return undefined;
}

/**
 * Why the joysticks are disabled right now, or null if they are live.
 * The §13 table's "Degraded: 操控鎖" is implemented here, at the stick.
 */
export function stickLock(s: {
  conn: ConnState;
  rtt: RttLevel;
  mode: DogMode | null;
  posture: string | null;
  mine: boolean;
}): string | null {
  if (s.mode === "ESTOP") return "已緊急停止";
  if (s.mode === "FAULT") return "故障中";
  if (!s.mine) return "尚未取得操控權";
  if (s.conn === "Degraded" || s.rtt === "poor") return "訊號不足";
  if (s.posture && s.posture !== "stand") return "請先站立";
  return null;
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const MODE_LABEL: Record<DogMode, string> = {
  BOOT: "開機中",
  IDLE: "待命",
  TELEOP: "手動操控",
  MISSION: "巡邏中",
  PAUSED: "任務暫停",
  CHARGING: "充電中",
  ESTOP: "緊急停止",
  FAULT: "故障",
};

export const CONN_LABEL: Record<ConnState, string> = {
  Unpaired: "未配對",
  Onboarding: "配對中",
  Paired: "已配對",
  Connecting: "連線中",
  Online: "已連線",
  Degraded: "連線不穩",
  BleOnly: "僅藍牙",
  Unreachable: "找不到狗",
};
