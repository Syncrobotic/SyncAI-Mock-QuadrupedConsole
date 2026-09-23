import type { EventSource, EventType, LicenseFeature, Priority, Rule, Schedule, TimeWindow, Trigger } from "@/proto/types";

/**
 * Rule vocabulary and arithmetic, shared by the rule editor, the agenda and
 * the mock dog's rule engine — one definition, so the phone can never promise
 * a run the dog will not make (docs/2026-09-23-mission-triggers-design.md).
 */

// ── Catalogue ────────────────────────────────────────────────────────────────

export interface EventTypeInfo {
  label: string;
  source: EventSource;
  /** A detection has a place; a system event does not. */
  located: boolean;
  requires?: LicenseFeature;
  hint: string;
}

export const EVENT_TYPES: Record<EventType, EventTypeInfo> = {
  person: { label: "偵測到人員", source: "ai", located: true, requires: "ai", hint: "任何人員出現在範圍內" },
  intrusion: { label: "限制區入侵", source: "ai", located: true, requires: "ai", hint: "人員進入限制區或圍欄內" },
  fall: { label: "人員倒地", source: "ai", located: true, requires: "ai", hint: "偵測到跌倒或長時間倒臥" },
  smoke: { label: "煙霧 / 火焰", source: "ai", located: true, requires: "ai", hint: "影像偵測到煙霧或明火" },
  abandoned: { label: "遺留物", source: "ai", located: true, requires: "ai", hint: "物品停留超過設定時間" },
  door_open: { label: "門未關", source: "ai", located: true, requires: "ai", hint: "應關閉的門處於開啟" },
  thermal: { label: "熱像異常", source: "ai", located: true, requires: "ai", hint: "溫度超出正常範圍" },
  low_battery: { label: "電量過低", source: "system", located: false, hint: "低於設定門檻" },
  fence_breach: { label: "狗離開圍欄", source: "system", located: true, hint: "狗的位置超出地理圍欄" },
  mission_failed: { label: "任務失敗", source: "system", located: false, hint: "任何任務以失敗結束" },
  gas_high: { label: "氣體超標", source: "sensor", located: true, hint: "氣體偵測 plugin 回報超標" },
};

export const SOURCE_LABEL: Record<EventSource, string> = {
  ai: "AI 感知",
  system: "系統",
  sensor: "感測器",
  external: "外部整合",
};

export const PRIORITY: Record<Priority, { label: string; short: string; hint: string }> = {
  0: { label: "P0 緊急", short: "P0", hint: "可以打斷任何任務" },
  1: { label: "P1 事件回應", short: "P1", hint: "可以打斷例行巡邏與維護" },
  2: { label: "P2 例行巡邏", short: "P2", hint: "不打斷別人，只排隊" },
  3: { label: "P3 維護", short: "P3", hint: "最後才執行" },
};

export const MODE_LABEL: Record<Rule["mode"], string> = { auto: "自動", confirm: "先確認", notify: "只通知" };

/** Operators may create routine and maintenance rules; P0/P1 are the Owner's. */
export function canSetPriority(p: Priority, isOwner: boolean) {
  return isOwner || p >= 2;
}

// ── Time ─────────────────────────────────────────────────────────────────────

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const MIN = 60_000;
const DAY = 86_400_000;

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function atTime(base: number, hhmm: string) {
  const d = new Date(base);
  const m = minutesOf(hhmm);
  d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d.getTime();
}

/** Is `t` inside the window? Windows may wrap midnight (22:00–06:00). */
export function inWindow(w: TimeWindow | null, t: number) {
  if (!w) return true;
  const d = new Date(t);
  const m = d.getHours() * 60 + d.getMinutes();
  const a = minutesOf(w.from);
  const b = minutesOf(w.to);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}

/**
 * The next `count` slots of a schedule after `from` (nominal — before jitter).
 * Interval slots are anchored to the window start (or midnight), so "every 45
 * min from 22:00" lands on 22:00, 22:45, 23:30… and not on whenever you saved.
 */
export function nextSlots(schedule: Schedule, from: number, count = 5): number[] {
  const out: number[] = [];
  switch (schedule.type) {
    case "once":
      if (schedule.at > from) out.push(schedule.at);
      return out;
    case "daily":
      for (let i = 0; out.length < count && i < count + 2; i++) {
        const t = atTime(from + i * DAY, schedule.time);
        if (t > from) out.push(t);
      }
      return out;
    case "weekly":
      if (!schedule.days.length) return out;
      for (let i = 0; out.length < count && i < 7 * count + 8; i++) {
        const t = atTime(from + i * DAY, schedule.time);
        if (t > from && schedule.days.includes(new Date(t).getDay())) out.push(t);
      }
      return out;
    case "interval": {
      // Day by day: from the window start, every `minutes`, until the window
      // ends (the window may wrap past midnight). No window = the whole day.
      const step = Math.max(5, schedule.minutes) * MIN;
      const w = schedule.window;
      const span = w ? (((minutesOf(w.to) - minutesOf(w.from)) % 1440) + 1440) % 1440 || 1440 : 1440;
      for (let d = -1; d < 9 && out.length < count; d++) {
        const anchor = atTime(from + d * DAY, w?.from ?? "00:00");
        for (let t = anchor; t < anchor + span * MIN && out.length < count; t += step) if (t > from) out.push(t);
      }
      return out;
    }
  }
}

export function describeSchedule(s: Schedule): string {
  switch (s.type) {
    case "once":
      return `單次 · ${new Date(s.at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`;
    case "daily":
      return `每日 ${s.time}`;
    case "weekly":
      return `每週${s.days.map((d) => WEEKDAYS[d]).join("、")} ${s.time}`;
    case "interval":
      return `${s.window ? `${s.window.from}–${s.window.to} ` : ""}每 ${s.minutes} 分鐘`;
  }
}

/** RFC 5545 RRULE for storage/interop (shown under "進階"). */
export function toRRule(s: Schedule): string {
  const hm = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return `BYHOUR=${h};BYMINUTE=${m}`;
  };
  const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  switch (s.type) {
    case "once":
      return `DTSTART=${new Date(s.at).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z;COUNT=1`;
    case "daily":
      return `FREQ=DAILY;${hm(s.time)}`;
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${s.days.map((d) => BYDAY[d]).join(",")};${hm(s.time)}`;
    case "interval":
      return `FREQ=MINUTELY;INTERVAL=${s.minutes}${s.window ? ` · 時段 ${s.window.from}–${s.window.to}` : ""}`;
  }
}

/** Deterministic ±jitter for a (rule, slot): the agenda and the dog agree on it. */
export function jitterFor(ruleId: string, slot: number, jitterMin: number) {
  if (!jitterMin) return 0;
  let h = 2166136261;
  for (const c of `${ruleId}:${slot}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const u = ((h >>> 0) % 10_000) / 10_000;
  return Math.round((u * 2 - 1) * jitterMin * 60_000);
}

// ── Natural-language summary (the editor's live headline) ───────────────────

export function describeTrigger(t: Trigger, zoneName: (id: string) => string = (id) => id): string {
  if (t.kind === "time") {
    const jitter = t.jitterMin ? ` · 隨機 ±${t.jitterMin} 分` : "";
    return `${describeSchedule(t.schedule)}${jitter}`;
  }
  const info = EVENT_TYPES[t.type];
  const where = t.zones.length ? ` @ ${t.zones.map(zoneName).join("、")}` : "";
  const filters = [
    info.source === "ai" && t.minConfidence > 0 ? `信心 ≥ ${Math.round(t.minConfidence * 100)}%` : null,
    t.persistSec ? `持續 ${t.persistSec} 秒` : null,
    t.countWithin ? `${t.countWithin.sec} 秒內 ${t.countWithin.n} 次` : null,
    t.activeWindow ? `${t.activeWindow.from}–${t.activeWindow.to}` : null,
  ].filter(Boolean);
  return `${info.label}${where}${filters.length ? `（${filters.join("、")}）` : ""}`;
}

export function ruleSentence(r: Rule, missionName: string, zoneName?: (id: string) => string): string {
  const when = r.trigger.kind === "time" ? describeTrigger(r.trigger) : `當${describeTrigger(r.trigger, zoneName)}`;
  const how = r.mode === "notify" ? "只通知" : r.mode === "confirm" ? `先詢問，${r.confirmTimeoutSec} 秒沒回應就${r.onTimeout === "run" ? "執行" : "取消"}` : "自動";
  return `${when} → ${missionName}（${how}）`;
}

/** Nominal next run of a time rule, or null for event rules / nothing ahead. */
export function nextRun(r: Rule, from: number): number | null {
  if (r.trigger.kind !== "time" || !r.enabled) return null;
  return nextSlots(r.trigger.schedule, from, 1)[0] ?? null;
}

export function formatRelative(at: number, now: number): string {
  const diff = at - now;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const label =
    mins < 1 ? "不到 1 分鐘" : mins < 60 ? `${mins} 分鐘` : mins < 1440 ? `${Math.round(mins / 60)} 小時` : `${Math.round(mins / 1440)} 天`;
  return diff >= 0 ? `${label}後` : `${label}前`;
}

export function clock(t: number) {
  return new Date(t).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
}
