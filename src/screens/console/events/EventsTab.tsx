"use client";

import { AnimatePresence, m } from "framer-motion";
import {
  Bot,
  ChevronDown,
  Flag,
  Gamepad2,
  OctagonX,
  ScrollText,
  ShieldAlert,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

import { EVENT_TYPES, clock } from "@/lib/rules";
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
  { value: "ai", label: "AI" },
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

/** The icon's plate carries the level — no separate 緊急 / 警示 badge. */
const LEVEL_TONE: Record<DogEvent["level"], string> = {
  critical: "bg-status-error/15 text-status-error",
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
  return [...live, ...history]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => b.at - a.at);
}

/** Warnings newer than the last visit to the tab — the dot on the tab bar. */
export function useUnreadEvents() {
  return useStore(
    (s) => s.events.filter((e) => e.level !== "info" && e.at > s.eventsSeenAt).length
  );
}

/**
 * One line per event: level-coloured icon, what happened, when. Grouped by day, each day one
 * card with hairlines. An AI detection opens to where and how sure — nothing else (track ids
 * and coordinates are for the dashboard). New events slide in at the top; a filter change
 * lets the rows that stay glide into place.
 */
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

  const shown = events.filter(
    (e) => (group === "all" || GROUP_OF[e.kind] === group) && (!alertsOnly || e.level !== "info")
  );

  // Day groups: 今天 / 昨天 / m/d.
  const day = (t: number) => {
    const d = new Date(t);
    const today = new Date(now);
    const diff = Math.round(
      (new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000
    );
    return diff === 0 ? "今天" : diff === 1 ? "昨天" : `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const days: { label: string; items: DogEvent[] }[] = [];
  for (const e of shown) {
    const label = day(e.at);
    if (days[days.length - 1]?.label !== label) days.push({ label, items: [] });
    days[days.length - 1].items.push(e);
  }

  return (
    <div className="space-y-2.5 px-3 pb-4">
      <div
        role="toolbar"
        aria-label="篩選事件"
        className="-mx-3 flex scrollbar-none items-center gap-1 overflow-x-auto px-3"
      >
        {GROUPS.map((g) => (
          <Chip key={g.value} on={group === g.value} onClick={() => setGroup(g.value)}>
            {g.label}
          </Chip>
        ))}
        <span className="bg-border mx-1 h-4 w-px shrink-0" aria-hidden />
        <Chip on={alertsOnly} onClick={() => setAlertsOnly((v) => !v)}>
          警示
        </Chip>
      </div>

      {shown.length === 0 && (
        <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-[13px]">
          <ScrollText className="size-5" />
          {events.length === 0 ? "還沒有事件" : "沒有符合的事件"}
        </div>
      )}

      {/* A filter swaps the list at once with one short fade — letting the old rows fade out
          while the new ones fade in left an empty card for a few frames. Inside, only events
          that arrive while it is on screen slide in (AnimatePresence initial={false}). */}
      <m.div
        key={`${group}-${alertsOnly}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="space-y-2.5"
      >
        {days.map((d) => (
          <section key={d.label}>
            <h4 className="text-muted-foreground px-1 pb-1 text-[11px] font-semibold">{d.label}</h4>
            <m.ol layout="position" className="bg-card divide-y overflow-hidden rounded-xl border">
              <AnimatePresence initial={false}>
                {d.items.map((e) => (
                  <m.li
                    key={e.id}
                    layout="position"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                  >
                    <EventRow
                      e={e}
                      now={now}
                      open={open === e.id}
                      onToggle={() => setOpen((o) => (o === e.id ? null : e.id))}
                    />
                  </m.li>
                ))}
              </AnimatePresence>
            </m.ol>
          </section>
        ))}
      </m.div>
    </div>
  );
}

/** Within the hour: how long ago (that is what "is this still going on?" needs); after: the time. */
function when(at: number, now: number) {
  const mins = Math.round((now - at) / 60_000);
  return mins < 1 ? "剛剛" : mins < 60 ? `${mins} 分前` : clock(at);
}

function EventRow({
  e,
  now,
  open,
  onToggle,
}: {
  e: DogEvent;
  now: number;
  open: boolean;
  onToggle: () => void;
}) {
  const zones = useStore((s) => s.plan?.zones);
  const Icon = KIND_ICON[e.kind];
  const d = e.detection;
  const zone = d && (zones?.find((z) => z.id === d.zoneId)?.name ?? d.zoneId);
  const recent = now - e.at < 3 * 60_000;

  const row = (
    <>
      <span
        className={cn("grid size-7 shrink-0 place-items-center rounded-lg", LEVEL_TONE[e.level])}
      >
        <Icon className="size-3.5" />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 text-[13px] leading-snug",
          e.level === "critical" && "font-medium"
        )}
      >
        {e.text}
      </span>
      <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
        {when(e.at, now)}
      </span>
      {d && (
        <ChevronDown
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      )}
    </>
  );

  if (!d) return <div className="flex min-h-11 items-center gap-2.5 px-3 py-2">{row}</div>;

  return (
    <>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="hover:bg-accent/50 flex min-h-11 w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors"
      >
        {row}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <p className="text-muted-foreground pr-3 pb-2.5 pl-[50px] text-[12px]">
              {EVENT_TYPES[d.type].label} · {zone} · 信心 {Math.round(d.confidence * 100)}%
              {recent && <span className="text-primary-accent"> · 地圖上有標記</span>}
            </p>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex h-7 shrink-0 cursor-pointer items-center rounded-full border px-2.5 text-[11px] font-medium transition-colors",
        on
          ? "bg-primary/12 text-primary-accent border-primary/40 dark:bg-primary/20"
          : "text-muted-foreground hover:text-foreground hover:bg-accent"
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
      {unread > 0 && (
        <span className="text-severity-warning shrink-0 font-semibold">{unread} 則新警示 ·</span>
      )}
      <span className="truncate">
        {clock(last.at)} {last.text}
      </span>
    </span>
  );
}
