"use client";

import { AnimatePresence, m } from "framer-motion";
import {
  BatteryCharging,
  BatteryLow,
  BatteryMedium,
  Check,
  ChevronDown,
  CircleAlert,
  Dog,
  Info,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { IconPlate } from "@/components/kit";
import { getDogLink } from "@/link";
import {
  dismissFlash,
  raiseAlert,
  retractAlert,
  useFlashHost,
  type Flash,
  type FlashTone,
} from "@/lib/notify";
import { cn, formatClock } from "@/lib/utils";
import { ROLE_LABEL } from "@/proto/types";
import { get, set, useStore, type SheetSnap } from "@/store";
import { beginAddDog, switchDog } from "@/store/controller";
import { CONN_LABEL, MODE_LABEL, rawRttLevel } from "@/store/logic";

import { AlertRow, useAlerts, type Alert } from "./Banners";

/**
 * The status island: the one card at the top of the map. It is the dog's identity and live
 * readings — and the Console's notification surface: there is no banner strip and no toast.
 *
 * A notification (lib/notify) opens the island up into it, like the Dynamic Island: the
 * whole message, its detail and its action. It closes back into the status after a few
 * seconds, or when the guard swipes it up. A standing alert that needs the guard (BLE only,
 * unreachable, unstable) opens it the same way when it starts, and stays open until swiped
 * or resolved; after that its one line is the status' second line, and its action is in
 * the details.
 *
 * Colour rule from the dashboard's command strip: a reading is neutral until it is bad.
 */

type Tone = FlashTone | "plain";

const TONE_TEXT: Record<Tone, string> = {
  plain: "text-muted-foreground",
  ok: "text-status-ok font-medium",
  info: "text-foreground font-medium",
  warn: "text-severity-warning font-medium",
  bad: "text-status-error font-semibold",
};
const TONE_BORDER: Record<Tone, string> = {
  plain: "",
  ok: "border-status-ok/40",
  info: "border-primary/40",
  warn: "border-severity-warning/50",
  bad: "border-status-error/50",
};
const TONE_PLATE: Record<FlashTone, string> = {
  ok: "bg-status-ok/15 text-status-ok",
  info: "bg-primary/15 text-primary-accent",
  warn: "bg-severity-warning/15 text-severity-warning",
  bad: "bg-status-error/15 text-status-error",
};
const FLASH_ICON: Record<FlashTone, typeof Check> = {
  ok: Check,
  info: Info,
  warn: TriangleAlert,
  bad: CircleAlert,
};

const alertTone = (a: Alert): FlashTone => (a.tone === "info" ? "info" : a.tone);

/** Opening the details collapses the sheet so they have room (an SE's map is ~150px); closing puts it back. */
let snapBeforeDetails: SheetSnap | null = null;

export function DogHeader({ landscape = false }: { landscape?: boolean }) {
  useFlashHost();
  const open = useStore((s) => s.statusOpen);
  const flash = useStore((s) => s.flash);
  const alerts = useAlerts();

  // A standing alert that asks something of the guard is announced once, when it starts.
  // Connecting / restarting are progress, not news: they stay on the status line.
  const loud = alerts.filter((a) => a.kind === "banner" && (a.action || a.tone !== "info"));
  const loudIds = loud.map((a) => a.id).join(",");
  const announced = useRef<string[]>([]);
  useEffect(() => {
    const now = loud.map((a) => a.id);
    for (const a of loud)
      if (!announced.current.includes(a.id))
        raiseAlert({
          alertId: a.id,
          tone: alertTone(a),
          text: a.text,
          sub: a.sub,
          icon: a.icon,
          action: a.action && { ...a.action, run: () => (a.action!.run(), dismissFlash()) },
        });
    for (const id of announced.current) if (!now.includes(id)) retractAlert(id);
    announced.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loudIds]);

  const toggle = () => {
    const s = get();
    if (!s.statusOpen) {
      snapBeforeDetails = !landscape && s.snap !== 0 ? s.snap : null;
      set({ statusOpen: true, ...(snapBeforeDetails !== null && { snap: 0 as SheetSnap }) });
    } else {
      set({ statusOpen: false, ...(snapBeforeDetails !== null && { snap: snapBeforeDetails }) });
      snapBeforeDetails = null;
    }
  };

  // A standing alert's words can change while it is open (the RTT in 連線不穩): read them live.
  const live = flash?.alertId ? alerts.find((a) => a.id === flash.alertId) : undefined;
  const shown = flash && live ? { ...flash, text: live.text, sub: live.sub } : flash;

  // The card's height is the height of what it shows now — not of the one fading out.
  const face = shown ? `n${shown.id}` : "status";
  const current = useRef<HTMLDivElement>(null);
  const [contentH, setContentH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = current.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [face]);

  return (
    <div className="pointer-events-auto flex min-h-0 flex-col">
      {/* The card's height follows what it shows (measured, not a layout transform: that
          scales the card and leaves the content stuck to one edge). Old and new share one
          grid cell pinned to the top: the old fades out while the card resizes around the new. */}
      <m.div
        initial={false}
        animate={{ height: contentH ?? "auto" }}
        transition={{ type: "spring", bounce: 0.15, duration: 0.38 }}
        className={cn(
          "bg-surface/90 relative overflow-hidden rounded-xl border shadow-sm backdrop-blur transition-[border-color,box-shadow] duration-300",
          shown && cn("shadow-lg", TONE_BORDER[shown.tone])
        )}
      >
        <div className="grid items-start">
          <AnimatePresence initial={false}>
            <m.div
              key={face}
              ref={current}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="col-start-1 row-start-1"
            >
              {shown ? (
                <Notice flash={shown} />
              ) : (
                <StatusRow landscape={landscape} open={open} onToggle={toggle} alerts={alerts} />
              )}
            </m.div>
          </AnimatePresence>
        </div>
      </m.div>
      {/* The notification is announced here; the island's button names the card. */}
      <span className="sr-only" aria-live="polite">
        {shown?.text}
      </span>

      <AnimatePresence>{open && <Details />}</AnimatePresence>
    </div>
  );
}

/** The island opened up into a notification. Swipe up (or 關閉) to put it away. */
function Notice({ flash }: { flash: Flash }) {
  const Icon = FLASH_ICON[flash.tone];
  return (
    <m.div
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.7, bottom: 0.08 }}
      onDragEnd={(_, i) => {
        if (i.offset.y < -24 || i.velocity.y < -300) dismissFlash();
      }}
      className="cursor-grab touch-none active:cursor-grabbing"
    >
      <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-1.5">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4",
            TONE_PLATE[flash.tone]
          )}
        >
          {flash.icon ?? <Icon />}
        </span>
        <div className="min-w-0 flex-1 py-0.5">
          <p className="text-[14px] leading-snug font-semibold">{flash.text}</p>
          {flash.sub && (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[12px] leading-snug">
              {flash.sub}
            </p>
          )}
        </div>
        {flash.action && (
          <button
            onClick={flash.action.run}
            onPointerDownCapture={(e) => e.stopPropagation()}
            className="bg-secondary hover:bg-accent relative mt-0.5 flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-[12px] font-semibold after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
          >
            {flash.action.icon}
            {flash.action.label}
          </button>
        )}
      </div>
      {/* The grabber says "swipe me"; for keyboards and screen readers it is a button. */}
      <button
        onClick={dismissFlash}
        onPointerDownCapture={(e) => e.stopPropagation()}
        aria-label="關閉通知"
        className="group relative flex h-3.5 w-full cursor-pointer items-start justify-center after:absolute after:inset-x-1/3 after:-inset-y-2 after:content-['']"
      >
        <span className="bg-muted-foreground/35 group-hover:bg-muted-foreground/60 h-1 w-9 rounded-full transition-colors" />
      </button>
    </m.div>
  );
}

function StatusRow({
  landscape,
  open,
  onToggle,
  alerts,
}: {
  landscape: boolean;
  open: boolean;
  onToggle: () => void;
  alerts: Alert[];
}) {
  const t = useStore((s) => s.telemetry);
  const conn = useStore((s) => s.conn);
  const role = useStore((s) => s.session?.role ?? s.credential?.role ?? null);
  const name = useStore((s) => s.device?.name ?? s.credential?.dogName ?? "SyncAI-Dog");
  const rttLevel = useStore((s) => s.rtt.level);
  const live = conn === "Online" || conn === "Degraded";

  const mode = live ? (t?.mode ?? null) : null;
  const subtitle = [mode ? MODE_LABEL[mode] : CONN_LABEL[conn], role ? ROLE_LABEL[role] : null]
    .filter(Boolean)
    .join(" · ");
  const banner = alerts.find((a) => a.kind === "banner");
  const more = alerts.length - (banner ? 1 : 0);
  // The second line is status: a standing alert's one line while it lasts, else mode · role.
  const line: { key: string; tone: Tone; text: string } = banner
    ? { key: banner.id, tone: alertTone(banner), text: banner.text }
    : {
        key: "sub",
        tone: mode === "ESTOP" || mode === "FAULT" ? "bad" : mode === "PAUSED" ? "warn" : "plain",
        text: subtitle,
      };

  const battery = t?.battery ?? null;
  const BatteryIcon = t?.charging
    ? BatteryCharging
    : battery !== null && battery < 20
      ? BatteryLow
      : BatteryMedium;
  const batteryTone =
    battery === null
      ? "text-muted-foreground"
      : battery < 20
        ? "text-status-error"
        : battery < 35
          ? "text-severity-warning"
          : "text-foreground";

  const rtt = t?.rttMs;
  const bars =
    rtt === undefined ? 0 : rawRttLevel(rtt) === "good" ? 3 : rawRttLevel(rtt) === "fair" ? 2 : 1;
  const rttTone =
    rttLevel === "poor"
      ? "text-status-error"
      : rttLevel === "fair"
        ? "text-severity-warning"
        : "text-foreground";
  const barTone =
    rttLevel === "poor"
      ? "bg-status-error"
      : rttLevel === "fair"
        ? "bg-severity-warning"
        : "bg-status-ok";

  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      aria-label="狗的狀態與連線"
      className="hover:bg-surface/60 focus-visible:ring-primary/40 flex w-full min-w-0 cursor-pointer items-center gap-2 py-1.5 pr-2.5 pl-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <IconPlate icon={Dog} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-tight font-semibold">{name}</span>
        {/* Fixed height: the line swaps without the card changing size. */}
        <span className="relative block h-4 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <m.span
              key={line.key}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.14 }}
              className={cn("block truncate text-[11px] leading-4", TONE_TEXT[line.tone])}
            >
              {line.text}
            </m.span>
          </AnimatePresence>
        </span>
      </span>

      <span aria-hidden className="bg-border h-6 w-px shrink-0" />

      {landscape && live && (
        <span className="shrink-0 text-[12px] font-semibold tabular-nums">
          {(t?.speed ?? 0).toFixed(1)}
          <span className="text-muted-foreground ml-0.5 text-[11px] font-normal">m/s</span>
        </span>
      )}
      <span
        className={cn(
          "flex shrink-0 items-center gap-1 text-[12px] font-semibold tabular-nums",
          batteryTone
        )}
      >
        <BatteryIcon className="size-4" />
        {battery !== null ? `${Math.round(battery)}%` : "—"}
      </span>
      {/* RTT only while there is one: off the WS, the second line already says why. */}
      {live && (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-[12px] font-semibold tabular-nums",
            rttTone
          )}
        >
          <span aria-hidden className="flex h-3 items-end gap-[2px]">
            {[1, 2, 3].map((b) => (
              <span
                key={b}
                className={cn(
                  "w-[3px] rounded-[1px]",
                  b <= bars ? barTone : "bg-muted-foreground/25"
                )}
                style={{ height: b * 4 }}
              />
            ))}
          </span>
          {rtt ?? "—"}
        </span>
      )}
      <span className="relative shrink-0">
        <ChevronDown
          className={cn("text-muted-foreground size-4 transition-transform", open && "rotate-180")}
        />
        {more > 0 && !open && (
          <span
            aria-label={`另有 ${more} 則提醒`}
            className="bg-severity-warning ring-surface absolute -top-1 -right-1 size-2 rounded-full ring-2"
          />
        )}
      </span>
    </button>
  );
}

function Details() {
  const t = useStore((s) => s.telemetry);
  const conn = useStore((s) => s.conn);
  const session = useStore((s) => s.session);
  const cred = useStore((s) => s.credential);
  const device = useStore((s) => s.device);
  const lastError = useStore((s) => s.lastError);
  const alerts = useAlerts();
  const channel =
    conn === "Online" || conn === "Degraded" ? "WS · TLS pinned" : conn === "BleOnly" ? "BLE" : "—";

  return (
    <m.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="bg-popover/95 mt-1.5 min-h-0 space-y-3 overflow-y-auto overscroll-contain rounded-xl border p-3 shadow-xl backdrop-blur"
    >
      <Dogs />
      {alerts.length > 0 && (
        <div className="space-y-1.5 border-t pt-3">
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t pt-3 text-[12px]">
        <Item k="通道" v={channel} />
        <Item k="狀態" v={`${CONN_LABEL[conn]} · ${conn}`} />
        <Item k="端點" v={cred?.endpoint ? `${cred.endpoint.ip}:${cred.endpoint.port}` : "—"} />
        <Item k="JWT 到期" v={session ? formatClock(session.jwtExpiresAt) : "—"} />
        <Item k="小腦" v={device?.versions.cerebellum ?? "—"} />
        <Item k="Gateway" v={device?.versions.gateway ?? "—"} />
        <Item k="電量預估" v={t ? `約 ${t.batteryMinutes} 分鐘` : "—"} />
        <Item k="最近錯誤" v={lastError ?? "—"} />
      </dl>
    </m.div>
  );
}

/** The dogs this phone is paired with: the current one, the others to switch to, and pairing one more. */
function Dogs() {
  const current = useStore((s) => s.credential?.dogId);
  const currentName = useStore((s) => s.device?.name);
  // Read on open: the keystore only changes through pairing, which unmounts the Console.
  const dogs = getDogLink().keystore.list();

  return (
    <ul className="-mx-1 space-y-0.5">
      {dogs.map((d) => {
        const here = d.dogId === current;
        return (
          <li key={d.dogId}>
            <button
              disabled={here}
              onClick={() => switchDog(d.dogId)}
              className="hover:bg-accent flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-1 text-left transition-colors disabled:cursor-default disabled:hover:bg-transparent"
            >
              <IconPlate icon={Dog} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {here ? (currentName ?? d.dogName) : d.dogName}
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {ROLE_LABEL[d.role]}
                </span>
              </span>
              {here ? (
                <Check className="text-primary-accent mr-1 size-4 shrink-0" aria-label="目前連線" />
              ) : (
                <span className="text-primary-accent mr-1 shrink-0 text-[12px] font-semibold">
                  切換
                </span>
              )}
            </button>
          </li>
        );
      })}
      <li>
        <button
          onClick={beginAddDog}
          className="hover:bg-accent text-primary-accent flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-1 text-left text-[13px] font-medium transition-colors"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-dashed">
            <Plus className="size-3.5" />
          </span>
          連接其他機器狗
        </button>
      </li>
    </ul>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-[11px]">{k}</dt>
      <dd className="truncate font-medium tabular-nums">{v}</dd>
    </div>
  );
}
