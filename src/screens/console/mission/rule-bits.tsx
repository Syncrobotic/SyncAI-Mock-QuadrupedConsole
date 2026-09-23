"use client";

import { Activity, CircleCheck, CircleSlash, Clock, Cpu, Hourglass, Plug, Radar, Sparkles, Timer, X, type LucideIcon } from "lucide-react";

import { EVENT_TYPES, PRIORITY } from "@/lib/rules";
import { cn } from "@/lib/utils";

import type { Priority, Rule, RuleOutcome } from "@/proto/types";

/**
 * Priority colour follows the dashboard's severity ramp — it IS a severity:
 * P0 reads as emergency, P1 as warning, routine and maintenance stay quiet.
 */
const P_TONE: Record<Priority, string> = {
  0: "bg-severity-emergency/15 text-red-700 dark:text-red-300 border-severity-emergency/40",
  1: "bg-severity-warning/15 text-severity-warning border-severity-warning/35",
  2: "bg-muted text-muted-foreground border-border",
  3: "bg-muted text-muted-foreground border-border border-dashed",
};

export function PriorityPill({ p, long, className }: { p: Priority; long?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-[11px] font-bold tabular-nums", P_TONE[p], className)}>
      {long ? PRIORITY[p].label : PRIORITY[p].short}
    </span>
  );
}

export function RuleIcon({ rule, className }: { rule: Rule; className?: string }) {
  if (rule.trigger.kind === "time") return rule.trigger.schedule.type === "interval" ? <Timer className={className} /> : <Clock className={className} />;
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
