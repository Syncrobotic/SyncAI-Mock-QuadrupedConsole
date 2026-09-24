"use client";

import {
  Activity,
  CircleCheck,
  CircleSlash,
  Clock,
  Cpu,
  Hourglass,
  Plug,
  Radar,
  Sparkles,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";

import { EVENT_TYPES } from "@/lib/rules";

import type { Rule, RuleOutcome, Zone } from "@/proto/types";

export function RuleIcon({ rule, className }: { rule: Rule; className?: string }) {
  if (rule.trigger.kind === "time")
    return rule.trigger.schedule.type === "interval" ? (
      <Timer className={className} />
    ) : (
      <Clock className={className} />
    );
  const src = EVENT_TYPES[rule.trigger.type].source;
  if (src === "ai") return <Sparkles className={className} />;
  if (src === "system") return <Cpu className={className} />;
  if (src === "sensor") return <Radar className={className} />;
  return <Plug className={className} />;
}

export const OUTCOME: Record<RuleOutcome, { label: string; icon: LucideIcon; tone: string }> = {
  started: { label: "已出動", icon: CircleCheck, tone: "text-status-ok" },
  queued: { label: "排隊", icon: Hourglass, tone: "text-status-busy" },
  awaiting: { label: "等待確認", icon: Hourglass, tone: "text-severity-warning" },
  notified: { label: "已通知", icon: Activity, tone: "text-severity-info" },
  preempted: { label: "被打斷", icon: Activity, tone: "text-severity-warning" },
  skipped: { label: "跳過", icon: CircleSlash, tone: "text-status-error" },
  expired: { label: "過期", icon: CircleSlash, tone: "text-status-error" },
  cancelled: { label: "取消", icon: X, tone: "text-muted-foreground" },
  filtered: { label: "未觸發", icon: CircleSlash, tone: "text-muted-foreground" },
};

/** The zone a point is in — the smallest one when zones overlap (a room inside a hall). */
export function zoneAt(zones: Zone[] | undefined, x: number, y: number): Zone | undefined {
  const inside = (zones ?? []).filter((z) => {
    const [x1, x2] = [Math.min(z.rect.x1, z.rect.x2), Math.max(z.rect.x1, z.rect.x2)];
    const [y1, y2] = [Math.min(z.rect.y1, z.rect.y2), Math.max(z.rect.y1, z.rect.y2)];
    return x >= x1 && x <= x2 && y >= y1 && y <= y2;
  });
  const area = (z: Zone) => Math.abs((z.rect.x2 - z.rect.x1) * (z.rect.y2 - z.rect.y1));
  return inside.sort((a, b) => area(a) - area(b))[0];
}
