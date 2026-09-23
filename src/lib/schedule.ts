import type { Mission, Waypoint } from "@/proto/types";

/**
 * Route estimates (duration, battery) — shared by the editor, the agenda and
 * the mock dog. Trigger arithmetic lives in `lib/rules.ts`.
 */

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
  // A response mission's distance depends on where the event is; budget a
  // typical 20 m approach and back so the agenda and guards have a number.
  if (mission.kind === "response") {
    const sec = (40 / PATROL_SPEED) + actionSeconds([{ id: "r", x: 0, y: 0, toleranceM: 1, actions: mission.response.actions }]);
    return { meters: 40, sec, batteryPct: (sec / 60) * 0.9 };
  }
  const meters = routeLength(mission.route, from);
  const sec = meters / PATROL_SPEED + actionSeconds(mission.route);
  // Mock battery model: walking dominates; roughly 0.9% per minute of work.
  const batteryPct = (sec / 60) * 0.9;
  return { meters, sec, batteryPct };
}
