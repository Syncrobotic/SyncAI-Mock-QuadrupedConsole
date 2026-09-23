import type { Mission, Trigger, Waypoint } from "@/proto/types";

/**
 * Trigger arithmetic, shared by the mission list ("next run") and the mock
 * scheduler that actually starts runs — one definition, so the list can never
 * promise a time the dog will not keep.
 *
 * All times are dog clock (spec §13). The mock dog's clock is the phone's.
 */

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function atTime(base: number, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function nextTrigger(trigger: Trigger, from: number, lastRunAt?: number): number | null {
  switch (trigger.type) {
    case "once":
      return trigger.at > from ? trigger.at : null;
    case "daily": {
      const today = atTime(from, trigger.time);
      return today > from ? today : today + 86_400_000;
    }
    case "weekly": {
      if (trigger.days.length === 0) return null;
      for (let i = 0; i < 8; i++) {
        const t = atTime(from + i * 86_400_000, trigger.time);
        if (t > from && trigger.days.includes(new Date(t).getDay())) return t;
      }
      return null;
    }
    case "interval": {
      const period = trigger.minutes * 60_000;
      const base = lastRunAt ?? from;
      const next = base + period;
      return next > from ? next : from + period;
    }
    case "event":
      return null;
  }
}

export function describeTrigger(trigger: Trigger): string {
  switch (trigger.type) {
    case "once":
      return `單次 · ${new Date(trigger.at).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`;
    case "daily":
      return `每日 ${trigger.time}`;
    case "weekly":
      return `每週${trigger.days.map((d) => WEEKDAYS[d]).join("、")} ${trigger.time}`;
    case "interval":
      return `每 ${trigger.minutes} 分鐘`;
    case "event":
      return trigger.eventType === "perception" ? "偵測到人員時" : "圍欄越界時";
  }
}

/** The cron string the "advanced" disclosure shows (spec §8: 進階才露 cron 字串). */
export function toCron(trigger: Trigger): string | null {
  const hm = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return `${m} ${h}`;
  };
  switch (trigger.type) {
    case "daily":
      return `${hm(trigger.time)} * * *`;
    case "weekly":
      return `${hm(trigger.time)} * * ${trigger.days.join(",") || "*"}`;
    case "interval":
      return `*/${trigger.minutes} * * * *`;
    default:
      return null;
  }
}

export function formatRelative(at: number, now: number): string {
  const diff = at - now;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const label =
    mins < 1 ? "不到 1 分鐘" : mins < 60 ? `${mins} 分鐘` : mins < 1440 ? `${Math.round(mins / 60)} 小時` : `${Math.round(mins / 1440)} 天`;
  return diff >= 0 ? `${label}後` : `${label}前`;
}

// ── Route estimates ──────────────────────────────────────────────────────────

export const PATROL_SPEED = 0.8;

export function actionSeconds(route: Waypoint[], pluginEstimate: (actionId: string) => number = () => 15) {
  let sec = 0;
  for (const wp of route)
    for (const a of wp.actions) {
      if (a.type === "wait") sec += a.sec;
      else if (a.type === "snapshot") sec += 2;
      else if (a.type === "thermal") sec += 4;
      else if (a.type === "announce") sec += 5;
      else sec += pluginEstimate(a.actionId);
    }
  return sec;
}

export function routeLength(route: Waypoint[], from?: { x: number; y: number }) {
  let len = 0;
  let prev = from ?? route[0];
  for (const wp of route) {
    if (prev) len += Math.hypot(wp.x - prev.x, wp.y - prev.y);
    prev = wp;
  }
  return len;
}

export function estimateMission(mission: Mission, from?: { x: number; y: number }) {
  const meters = routeLength(mission.route, from);
  const sec = meters / PATROL_SPEED + actionSeconds(mission.route);
  // Mock battery model: walking dominates; roughly 0.9% per minute of work.
  const batteryPct = (sec / 60) * 0.9;
  return { meters, sec, batteryPct };
}
