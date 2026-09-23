"use client";

import { Bot, ChevronDown, Flag, Gamepad2, OctagonX, ScrollText, ShieldAlert, Sparkles, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { EVENT_TYPES, clock, formatRelative } from "@/lib/rules";
import { cn } from "@/lib/utils";
import { set, useStore } from "@/store";
import { rpc } from "@/store/controller";

import { useNow } from "../Banners";

import type { DogEvent } from "@/proto/types";

/**
 * The event log: what the dog saw and did, newest first. The live stream (since this app
 * opened) merged with the dog's own last 200, so it is complete right after a reconnect.
 */

type Group = "all" | "ai" | "mission" | "safety" | "system";

const GROUP_OF: Record<DogEvent["kind"], Exclude<Group, "all">> = {
  perception: "ai",
  mission: "mission",
  missions_changed: "mission",
  confirm_request: "mission",
  estop: "safety",
  fence: "safety",
  teleop: "safety",
  system: "system",
  revoked: "system",
  approval: "system",
};

const GROUPS: { value: Group; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "ai", label: "AI 偵測" },
  { value: "mission", label: "任務" },
  { value: "safety", label: "安全" },
  { value: "system", label: "系統" },
];

const KIND_ICON: Record<DogEvent["kind"], typeof Bot> = {
  perception: Sparkles,
  mission: Flag,
  missions_changed: Flag,
  confirm_request: Flag,
  estop: OctagonX,
  fence: ShieldAlert,
  teleop: Gamepad2,
  system: Bot,
  revoked: UserCheck,
  approval: UserCheck,
};

const LEVEL_TONE: Record<DogEvent["level"], string> = {
  critical: "bg-severity-emergency/15 text-red-700 dark:text-red-300",
  warning: "bg-severity-warning/15 text-severity-warning",
  info: "bg-muted text-muted-foreground",
};

/** Live events merged with the dog's history, de-duplicated, newest first. */
function useEventLog() {
  const live = useStore((s) => s.events);
  const [history, setHistory] = useState<DogEvent[]>([]);
  useEffect(() => {
    let alive = true;
    void rpc("diag.events", undefined).then((r) => alive && r && setHistory(r));
    return () => {
      alive = false;
    };
  }, []);
  const seen = new Set<string>();
  return [...live, ...history].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((a, b) => b.at - a.at);
}

/** Warnings newer than the last visit to the tab — the dot on the tab bar. */
export function useUnreadEvents() {
  return useStore((s) => s.events.filter((e) => e.level !== "info" && e.at > s.eventsSeenAt).length);
}

export function EventsTab() {
  const events = useEventLog();
  const liveCount = useStore((s) => s.events.length);
  const [group, setGroup] = useState<Group>("all");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow(30_000);

  // Reading the tab marks everything up to now as seen, including what arrives while it is open.
  useEffect(() => {
    set({ eventsSeenAt: Date.now() });
  }, [liveCount]);

  const counts = Object.fromEntries(GROUPS.map((g) => [g.value, events.filter((e) => g.value === "all" || GROUP_OF[e.kind] === g.value).length]));
  const shown = events.filter((e) => (group === "all" || GROUP_OF[e.kind] === group) && (!alertsOnly || e.level !== "info"));

  // Day headers: 今天 / 昨天 / m/d.
  const day = (t: number) => {
    const d = new Date(t);
    const today = new Date(now);
    const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
    return diff === 0 ? "今天" : diff === 1 ? "昨天" : `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="space-y-2 px-3 pb-4">
      <div className="scrollbar-none -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5">
        {GROUPS.map((g) => (
          <Chip key={g.value} on={group === g.value} onClick={() => setGroup(g.value)}>
            {g.label}
            <span className={cn("tabular-nums", group === g.value ? "text-primary-foreground/80" : "text-muted-foreground")}>{counts[g.value]}</span>
          </Chip>
        ))}
        <span className="bg-border mx-0.5 w-px shrink-0 self-stretch" aria-hidden />
        <Chip on={alertsOnly} onClick={() => setAlertsOnly((v) => !v)}>
          只看警示
        </Chip>
      </div>

      {shown.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-[13px]">
          <ScrollText className="size-5" />
          {events.length === 0 ? "還沒有事件" : "這個篩選下沒有事件"}
        </div>
      )}

      <ol className="space-y-1.5">
        {shown.map((e, i) => {
          const header = i === 0 || day(shown[i - 1].at) !== day(e.at) ? day(e.at) : null;
          return (
            <li key={e.id}>
              {header && <p className="text-muted-foreground px-1 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide">{header}</p>}
              <EventRow e={e} now={now} open={open === e.id} onToggle={() => setOpen((o) => (o === e.id ? null : e.id))} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function EventRow({ e, now, open, onToggle }: { e: DogEvent; now: number; open: boolean; onToggle: () => void }) {
  const zones = useStore((s) => s.plan?.zones);
  const Icon = KIND_ICON[e.kind];
  const d = e.detection;
  const zone = d && (zones?.find((z) => z.id === d.zoneId)?.name ?? d.zoneId);
  const recent = now - e.at < 3 * 60_000;

  const body = (
    <>
      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", LEVEL_TONE[e.level])}>
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-snug">{e.text}</span>
        <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums">
          {clock(e.at)}
          <span aria-hidden>·</span>
          {formatRelative(e.at, now)}
          {e.level !== "info" && (
            <span className={cn("rounded px-1 font-semibold", LEVEL_TONE[e.level])}>{e.level === "critical" ? "緊急" : "警示"}</span>
          )}
        </span>
      </span>
      {d && <ChevronDown className={cn("text-muted-foreground mt-1 size-4 shrink-0 transition-transform", open && "rotate-180")} />}
    </>
  );

  if (!d) return <div className="bg-card flex items-start gap-2.5 rounded-xl border px-2.5 py-2">{body}</div>;

  return (
    <div className="bg-card rounded-xl border">
      <button onClick={onToggle} aria-expanded={open} className="flex w-full cursor-pointer items-start gap-2.5 px-2.5 py-2 text-left">
        {body}
      </button>
      {open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t px-3 py-2 text-[12px]">
          <dt className="text-muted-foreground">類型</dt>
          <dd>{EVENT_TYPES[d.type].label}</dd>
          <dt className="text-muted-foreground">區域</dt>
          <dd>{zone}</dd>
          <dt className="text-muted-foreground">信心</dt>
          <dd className="tabular-nums">{Math.round(d.confidence * 100)}%</dd>
          <dt className="text-muted-foreground">位置</dt>
          <dd className="tabular-nums">
            ({d.x.toFixed(1)}, {d.y.toFixed(1)}) m{recent && <span className="text-primary-accent"> · 地圖上有標記</span>}
          </dd>
          <dt className="text-muted-foreground">追蹤</dt>
          <dd className="font-mono text-[11px]">{d.trackId}</dd>
        </dl>
      )}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium transition-colors",
        on ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
      )}
    >
      {children}
    </button>
  );
}

export function EventsSummary() {
  const last = useStore((s) => s.events[0]);
  const unread = useUnreadEvents();
  if (!last) return <span>還沒有新事件</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {unread > 0 && <span className="text-severity-warning shrink-0 font-semibold">{unread} 則新警示 ·</span>}
      <span className="truncate">
        {clock(last.at)} {last.text}
      </span>
    </span>
  );
}
