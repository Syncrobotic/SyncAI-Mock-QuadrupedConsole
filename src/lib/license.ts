import type { LicenseActivation, LicenseFeature, LicenseInfo } from "@/proto/types";

/**
 * Licence keys: four groups of four, A–Z and 0–9 — `SYNC-PRO1-2026-DEMO`.
 *
 * Format handling is shared by the key input (which normalises as you type or
 * paste) and the mock dog (which decides what a key unlocks). On the real dog
 * the decision is a signature check against the licence server's public key;
 * the phone only ever sends the string.
 */

export const KEY_GROUPS = 4;
export const GROUP_LEN = 4;

/** Upper-cases, drops anything that is not A–Z/0–9, and caps at 16 chars. */
export function normaliseKey(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, KEY_GROUPS * GROUP_LEN);
}

export function formatKey(compact: string): string {
  return normaliseKey(compact).match(/.{1,4}/g)?.join("-") ?? "";
}

export function isCompleteKey(raw: string): boolean {
  return normaliseKey(raw).length === KEY_GROUPS * GROUP_LEN;
}

export function maskKey(raw: string): string {
  const g = formatKey(raw).split("-");
  return g.length === 4 ? `${g[0]}-••••-••••-${g[3]}` : "";
}

export const ALL_FEATURES: readonly LicenseFeature[] = ["teleop", "map", "mission", "talk", "ai"];

export const FEATURE_LABEL: Record<LicenseFeature, string> = {
  teleop: "手動操控",
  map: "3D 地圖",
  mission: "任務排程",
  talk: "雙向通話",
  ai: "AI 辨識",
};

export const FEATURE_HINT: Record<LicenseFeature, string> = {
  teleop: "搖桿、姿態與步態",
  map: "點雲、平面圖、軌跡",
  mission: "巡邏路線與排程",
  talk: "影像與雙向語音",
  ai: "人員偵測、異常事件",
};

/**
 * What each edition turns on. The map comes with every edition — without it
 * nothing else can be operated safely — so a licence is really choosing
 * which *capabilities* sit on top: a control-only dog is a real product.
 */
const EDITIONS = {
  pro: ["teleop", "map", "mission", "talk", "ai"],
  basic: ["teleop", "map", "mission", "talk"],
  control: ["teleop", "map"],
  none: [],
} as const satisfies Record<LicenseInfo["edition"], readonly LicenseFeature[]>;

export const EDITION_LABEL: Record<LicenseInfo["edition"], string> = {
  pro: "專業版",
  basic: "標準版",
  control: "操控版",
  none: "未啟用",
};

export function licenseFor(edition: LicenseInfo["edition"], key: string | null, now: number): LicenseInfo {
  const granted = EDITIONS[edition] as readonly LicenseFeature[];
  return {
    edition,
    keyMasked: key ? maskKey(key) : null,
    features: ALL_FEATURES.map((feature) => ({ feature, granted: granted.includes(feature) })),
    expiresAt: edition === "none" ? null : now + (edition === "pro" ? 5 : 365) * 86_400_000,
  };
}

/**
 * The mock licence server. Demo keys:
 *   SYNC-…            → 專業版 (everything)
 *   BASE-…            → 標準版 (everything but AI)
 *   CTRL-…            → 操控版 (teleop + map only)
 *   any group "0000"  → already bound to another dog
 *   EXPD-…            → expired
 *   anything else     → invalid
 */
export function mockActivate(raw: string, now: number): LicenseActivation {
  if (!isCompleteKey(raw)) return { ok: false, reason: "format" };
  const key = formatKey(raw);
  if (key.split("-").includes("0000")) return { ok: false, reason: "bound" };
  if (key.startsWith("EXPD")) return { ok: false, reason: "expired" };
  if (key.startsWith("SYNC")) return { ok: true, license: licenseFor("pro", key, now) };
  if (key.startsWith("BASE")) return { ok: true, license: licenseFor("basic", key, now) };
  if (key.startsWith("CTRL")) return { ok: true, license: licenseFor("control", key, now) };
  return { ok: false, reason: "invalid" };
}

export const ACTIVATION_ERROR: Record<Exclude<LicenseActivation, { ok: true }>["reason"], string> = {
  format: "金鑰是 4 組、每組 4 個英數字",
  invalid: "這組金鑰無效，請確認沒有打錯",
  bound: "這組金鑰已綁定在另一隻狗上",
  expired: "這組金鑰已過期",
};
