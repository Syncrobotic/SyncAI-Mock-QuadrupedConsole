"use client";

import { AnimatePresence, animate, m, useMotionValue } from "framer-motion";
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
import { cn } from "@/lib/utils";
import { ROLE_LABEL } from "@/proto/types";
import { get, set, useStore, type SheetSnap } from "@/store";
import { beginAddDog, refreshDevice, switchDog } from "@/store/controller";
import { CONN_LABEL, MODE_LABEL, rawRttLevel } from "@/store/logic";

import { AlertRow, useAlerts, type Alert } from "./Banners";

/**
 * The status island: the one card at the top of the map. It is the dog's identity and live
 * readings — and the Console's notification surface: there is no banner strip and no toast.
 *
 * A notification (lib/notify) takes the island's row for a few seconds — icon, message,
 * detail, action — in the same size and style as the status, and gives it back on a timer
 * or when swiped up. A standing alert that needs the guard (BLE only, unreachable, unstable)
 * is announced the same way when it starts and stays until swiped or resolved; after that
 * its one line is the status' second line, and its action is in the details.
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

function openDetails(landscape: boolean) {
  const s = get();
  if (s.statusOpen) return;
  snapBeforeDetails = !landscape && s.snap !== 0 ? s.snap : null;
  set({ statusOpen: true, ...(snapBeforeDetails !== null && { snap: 0 as SheetSnap }) });
}

/**
 * Close the details. `restore` puts the sheet back where it was before they opened — only
 * when the guard closed them from the island. When the sheet itself moved (dragged, a tab
 * tapped), the sheet's new height wins: restoring would yank it back.
 */
export function closeDetails({ restore = true }: { restore?: boolean } = {}) {
  if (!get().statusOpen) return;
  set({
    statusOpen: false,
    ...(restore && snapBeforeDetails !== null && { snap: snapBeforeDetails }),
  });
  snapBeforeDetails = null;
}

const SPRING = { type: "spring", bounce: 0.15, duration: 0.42 } as const;

/**
 * One shape, three faces — like the Dynamic Island:
 *   status  — the resting pill: name, mode, battery, signal;
 *   notice  — a notification in the status row's place, same size; swipe it up to put it away;
 *   details — tapping the status opens it into the details, with a bar at the bottom:
 *             pull the bar up (the island shrinks with the finger) or tap it to close.
 * A notification that arrives while the details are open appears at their top; the bar
 * still closes the island.
 */
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

  // A standing alert's words can change while it is open (the RTT in 連線不穩): read them live.
  const live = flash?.alertId ? alerts.find((a) => a.id === flash.alertId) : undefined;
  const shown = flash && live ? { ...flash, text: live.text, sub: live.sub } : flash;

  // How tall the open island may grow: down to the bottom of the map (the panel marked
  // data-island-bounds) but not over the E-Stop's row at its bottom — and in landscape, not
  // over the posture keys.
  const root = useRef<HTMLDivElement>(null);
  const [cap, setCap] = useState(480);
  useLayoutEffect(() => {
    const el = root.current;
    const bounds = el?.closest("[data-island-bounds]");
    if (!el || !bounds) return;
    const measure = () =>
      setCap(
        Math.max(
          120,
          Math.round(
            bounds.getBoundingClientRect().bottom -
              el.getBoundingClientRect().top -
              (landscape ? 76 : 60)
          )
        )
      );
    const ro = new ResizeObserver(measure);
    ro.observe(bounds);
    measure();
    return () => ro.disconnect();
  }, [landscape]);

  // The island's height is the height of the face it shows now — not of the one fading out.
  // Measured and sprung (a layout transform would scale the content), and a motion value so
  // the details' bar can pull it shorter under the finger.
  const face = open ? "details" : shown ? `n${shown.id}` : "status";
  const current = useRef<HTMLDivElement>(null);
  const target = useRef(0);
  // True while the details' bar is held (see onPull).
  const pulling = useRef(false);
  const h = useMotionValue(0);
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => {
    // A new face ends any pull: a pull that never saw its release (the details closed some
    // other way mid-gesture) would otherwise leave the island deaf to its content.
    pulling.current = false;
    const el = current.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // While the bar is held the finger sets the height, not the content.
      if (pulling.current) return;
      const v = el.offsetHeight;
      const first = target.current === 0;
      target.current = v;
      if (first) {
        h.set(v);
        setMeasured(true);
      } else animate(h, v, SPRING);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [face, h]);

  // Pulling the bar: the island's height follows the finger, and the details inside are held
  // to that height (their list shrinks and scrolls) so the bar stays on the island's edge.
  const pulled = useRef(false);
  const [held, setHeld] = useState(false);
  const onPull = (dy: number) => {
    if (Math.abs(dy) > 4) pulled.current = true;
    if (!pulling.current) {
      pulling.current = true;
      setHeld(true);
    }
    // Never shorter than what stays put: the status row, a notification if any, the bar.
    const floor = 44 + (shown ? 45 : 0) + 24 + 2;
    h.set(Math.max(floor, target.current + Math.min(0, dy)));
  };
  const onRelease = (dy: number, vy: number) => {
    const done = () => {
      pulling.current = false;
      setHeld(false);
    };
    if (dy < -40 || vy < -300) {
      done();
      closeDetails();
    } else void animate(h, target.current, SPRING).then(done);
  };

  return (
    <div ref={root} className="pointer-events-auto flex min-h-0 flex-col">
      <m.div
        style={measured ? { height: h } : undefined}
        // One look in every face: a notification changes what the island says, never its
        // colour, border, shadow or height. Only opening the details makes it bigger.
        className="bg-surface/95 @container relative overflow-hidden rounded-xl border shadow-sm backdrop-blur"
      >
        {/* One column no wider than the card: an auto column grows to its content and clips it. */}
        <div className="grid grid-cols-1 items-start">
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
              {open ? (
                <m.div
                  className="flex flex-col"
                  style={{ maxHeight: cap, height: held ? h : undefined }}
                >
                  {shown && (
                    <div className="shrink-0 border-b">
                      <Notice flash={shown} landscape={landscape} />
                    </div>
                  )}
                  <StatusRow landscape={landscape} open onToggle={closeDetails} alerts={alerts} />
                  <Details />
                  <m.button
                    aria-label="收起狀態"
                    onPan={(_, i) => onPull(i.offset.y)}
                    onPanEnd={(_, i) => onRelease(i.offset.y, i.velocity.y)}
                    onClick={() => {
                      if (pulled.current) pulled.current = false;
                      else closeDetails();
                    }}
                    className="group flex h-6 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
                  >
                    <span className="bg-muted-foreground/40 group-hover:bg-muted-foreground/70 h-1.5 w-10 rounded-full transition-colors" />
                  </m.button>
                </m.div>
              ) : shown ? (
                <Notice flash={shown} landscape={landscape} />
              ) : (
                <StatusRow
                  landscape={landscape}
                  open={false}
                  onToggle={() => {
                    // A fresh open starts with no pull in hand.
                    pulling.current = false;
                    setHeld(false);
                    openDetails(landscape);
                  }}
                  alerts={alerts}
                />
              )}
            </m.div>
          </AnimatePresence>
        </div>
      </m.div>
      {/* The notification is announced here; the island's button names the card. */}
      <span className="sr-only" aria-live="polite">
        {shown?.text}
      </span>
    </div>
  );
}

/**
 * A notification in the island: the status row's exact shape — plate, two lines, one action
 * — so the island does not change height or style when one arrives. Swipe it up to put it away.
 */
function Notice({ flash, landscape }: { flash: Flash; landscape: boolean }) {
  const Icon = FLASH_ICON[flash.tone];
  // A tap opens the event log, where the notification's event is (portrait: the event tab
  // does not exist in landscape).
  const openEvents = () => {
    if (landscape) return;
    dismissFlash();
    closeDetails();
    set((s) => ({ tab: "events", snap: s.snap === 0 ? 1 : s.snap }));
  };
  return (
    <m.div
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.7, bottom: 0.08 }}
      onDragEnd={(_, i) => {
        if (i.offset.y < -16 || i.velocity.y < -300) dismissFlash();
      }}
      onTap={openEvents}
      className="flex h-11 cursor-grab touch-none items-center gap-2 pr-1.5 pl-2 active:cursor-grabbing"
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5",
          TONE_PLATE[flash.tone]
        )}
      >
        {flash.icon ?? <Icon />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-tight font-semibold">{flash.text}</span>
        {flash.sub && (
          <span className="text-muted-foreground block truncate text-[11px] leading-4">
            {flash.sub}
          </span>
        )}
      </span>
      {flash.action && (
        <button
          onClick={flash.action.run}
          onPointerDownCapture={(e) => e.stopPropagation()}
          className="bg-secondary hover:bg-accent relative flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2.5 text-[12px] font-semibold after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        >
          {flash.action.icon}
          {flash.action.label}
        </button>
      )}
      {/* Swiping is the gesture; keyboards and screen readers get a button. */}
      <button onClick={dismissFlash} className="sr-only focus:not-sr-only">
        關閉通知
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
      className="hover:bg-surface/60 focus-visible:ring-primary/40 flex h-11 w-full min-w-0 cursor-pointer items-center gap-2 pr-2.5 pl-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
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

      {/* Speed only where the name still fits beside it (an SE on its side is ~240 pt). */}
      {landscape && live && (
        <span className="hidden shrink-0 text-[12px] font-semibold tabular-nums @[300px]:inline-block">
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
  const alerts = useAlerts();

  return (
    <div className="min-h-0 flex-1 scrollbar-none space-y-3 overflow-y-auto overscroll-contain border-t px-3 pt-3 pb-1">
      <Gauges />
      {alerts.length > 0 && (
        <div className="space-y-1.5 border-t pt-3">
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </div>
      )}
      <div className="border-t pt-2">
        <Dogs />
      </div>
    </div>
  );
}

/**
 * The dog's load at a glance: four rings. Neutral until it is bad (the command strip's rule):
 * CPU / MEM / DISK turn amber at 75% and red at 90%; the battery turns amber under 35% and
 * red under 20%, and says minutes left rather than a percentage. While the details are open
 * the device info is re-read every 3 s.
 */
function Gauges() {
  // Off the WS nothing here is current: the last reading would pass for a live one. Show —.
  const live = useStore((s) => s.conn === "Online" || s.conn === "Degraded");
  const device = useStore((s) => (live ? s.device : null));
  const battery = useStore((s) => (live ? (s.telemetry?.battery ?? null) : null));
  const minutes = useStore((s) => (live ? (s.telemetry?.batteryMinutes ?? null) : null));
  useEffect(() => {
    const t = setInterval(() => void refreshDevice(), 3000);
    return () => clearInterval(t);
  }, []);
  const load = (v: number | undefined) =>
    v === undefined ? "none" : v >= 90 ? "bad" : v >= 75 ? "warn" : "ok";
  const charge = battery === null ? "none" : battery < 20 ? "bad" : battery < 35 ? "warn" : "ok";
  return (
    <div className="grid grid-cols-4 gap-1">
      <Ring label="CPU" value={device?.cpu} tone={load(device?.cpu)} />
      <Ring label="MEM" value={device?.memPct} tone={load(device?.memPct)} />
      <Ring label="DISK" value={device?.storagePct} tone={load(device?.storagePct)} />
      <Ring
        label="電量"
        value={battery ?? undefined}
        tone={charge}
        centre={
          minutes !== null
            ? { value: String(minutes), unit: "分", spoken: `約 ${minutes} 分鐘` }
            : undefined
        }
      />
    </div>
  );
}

const RING_TONE = {
  ok: "stroke-primary-accent",
  warn: "stroke-severity-warning",
  bad: "stroke-status-error",
  none: "stroke-transparent",
} as const;

/**
 * One ring: the arc is the percentage; the centre is the percentage too, or — for the
 * battery — what the guard actually plans with, the minutes left.
 */
function Ring({
  label,
  value,
  tone,
  centre,
}: {
  label: string;
  value: number | undefined;
  tone: keyof typeof RING_TONE;
  centre?: { value: string; unit: string; spoken: string };
}) {
  const R = 25;
  const C = 2 * Math.PI * R;
  const pct = value === undefined ? 0 : Math.max(0, Math.min(100, value));
  const text =
    value === undefined
      ? null
      : (centre ?? { value: String(Math.round(pct)), unit: "%", spoken: `${Math.round(pct)}%` });
  return (
    <figure
      className="flex flex-col items-center gap-1"
      aria-label={`${label} ${text ? text.spoken : "未知"}`}
    >
      {/* Fluid up to 60 pt: four fit a landscape island (~240 pt) as well as a portrait one. */}
      <div className="@container relative aspect-square w-full max-w-[60px]">
        <svg viewBox="0 0 60 60" className="size-full -rotate-90" aria-hidden>
          <circle cx="30" cy="30" r={R} fill="none" strokeWidth="4" className="stroke-muted" />
          {value !== undefined && (
            <circle
              cx="30"
              cy="30"
              r={R}
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - pct / 100)}
              className={cn(
                "transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none",
                RING_TONE[tone]
              )}
            />
          )}
        </svg>
        {/* Number and unit on one baseline, centred as one. */}
        <span aria-hidden className="absolute inset-0 grid place-items-center">
          <span className="flex items-baseline">
            {/* A ring under 56 pt (landscape SE) takes 12 pt digits so "156分" stays inside it. */}
            <span className="text-[12px] font-semibold tracking-tight tabular-nums @[56px]:text-[13px]">
              {text ? text.value : "—"}
            </span>
            {text && <span className="text-muted-foreground text-[11px]">{text.unit}</span>}
          </span>
        </span>
      </div>
      <figcaption
        aria-hidden
        className="text-muted-foreground text-[11px] leading-tight font-medium"
      >
        {label}
      </figcaption>
    </figure>
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
