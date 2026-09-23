import { estimateMission } from "@/lib/schedule";

import { insidePolygon, isReachable } from "./floor";

import type { ValidationIssue } from "../DogLink";
import type { Fence, Mission } from "@/proto/types";

/**
 * Save-time checks (spec §8 衝突偵測). Runs on the dog in the real system —
 * reachability is a navd RPC — so it lives on the mock gateway side, not in UI.
 */
export function validateMission(
  mission: Mission,
  ctx: { fences: Fence[]; battery: number; from: { x: number; y: number } }
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  mission.route.forEach((wp, i) => {
    if (!isReachable(wp.x, wp.y))
      issues.push({ level: "error", code: "unreachable", waypointId: wp.id, message: `航點 ${i + 1} 不可達（navd 找不到路徑）` });
    for (const fence of ctx.fences)
      if (!insidePolygon(fence.points, wp.x, wp.y))
        issues.push({ level: "error", code: "outside_fence", waypointId: wp.id, message: `航點 ${i + 1} 在圍欄「${fence.name}」外` });
  });

  const est = estimateMission(mission, ctx.from);
  // Battery is judged against the level the dog will have when it starts —
  // the mock assumes it is on the dock in between and uses the current level.
  if (est.batteryPct > ctx.battery - 15)
    issues.push({
      level: "warning",
      code: "battery",
      message: `預估耗電 ${est.batteryPct.toFixed(0)}%，超過目前可用電量（${Math.max(0, ctx.battery - 15).toFixed(0)}%，保留 15%）`,
    });

  if (mission.kind === "patrol" && mission.route.length === 0) issues.push({ level: "error", code: "unreachable", message: "至少需要一個航點" });

  return issues;
}
