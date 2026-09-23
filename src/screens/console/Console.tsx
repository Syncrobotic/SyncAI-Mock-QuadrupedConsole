"use client";

import { Gamepad2, Lock, MapPinned, ScrollText, Settings2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ActivePlate, EStopZone, TabBoundary } from "@/components/kit";
import { useLandscape } from "@/hooks/use-landscape";
import { cn } from "@/lib/utils";
import { MapView } from "@/map3d/MapView";
import { NO_SCOPES, SNAP_PCT, set, useStore, type SheetSnap } from "@/store";
import { tabAccess, type Access, type Area, type Tab } from "@/store/logic";

import { Banners } from "./Banners";
import { EStopBar } from "./EStopBar";
import { FaultOverlay, Overlays } from "./Overlays";
import { LandscapeConsole } from "./LandscapeConsole";
import { LicenseGate } from "./LicenseGate";
import { DogHeader } from "./StatusBar";
import { DeviceTab, DeviceSummary } from "./device/DeviceTab";
import { EventsSummary, EventsTab, useUnreadEvents } from "./events/EventsTab";
import { MissionSummary, MissionTab } from "./mission/MissionTab";
import { CallLayer } from "./talk/CallLayer";
import { TeleopSummary, TeleopTab } from "./teleop/TeleopTab";

const TABS: { id: Tab; label: string; icon: typeof Gamepad2 }[] = [
  { id: "teleop", label: "操控", icon: Gamepad2 },
  { id: "mission", label: "任務", icon: MapPinned },
  { id: "events", label: "事件", icon: ScrollText },
  { id: "device", label: "裝置", icon: Settings2 },
];

export function useAccess(tab: Area): Access {
  const conn = useStore((s) => s.conn);
  const scopes = useStore((s) => s.session?.scopes ?? NO_SCOPES);
  const license = useStore((s) => s.device?.license);
  const mode = useStore((s) => s.telemetry?.mode ?? null);
  const restarting = useStore((s) => s.restartingUntil !== null);
  return tabAccess(tab, {
    conn,
    scopes,
    license: Object.fromEntries((license ?? []).map((l) => [l.feature, l.granted])),
    mode,
    restarting,
  });
}

/**
 * §5 information architecture: one screen. The map fills the top, E-Stop sits
 * between map and sheet, the sheet has four tabs at three heights. No nested
 * pages.
 *
 * Laid out like the dashboard shell: a sunken ground with `p-2 gap-2`, and
 * each region its own rounded panel on it. The map panel is a flex child, so
 * the canvas is exactly the visible band — its centre is what the guard sees,
 * which is what keeps the dog in frame in follow view.
 */
export function Console() {
  const tab = useStore((s) => s.tab);
  const snap = useStore((s) => s.snap);
  const statusOpen = useStore((s) => s.statusOpen);
  const unlicensed = useStore((s) => s.device?.licenseEdition === "none");
  const videoMain = useStore((s) => s.call.active && s.call.videoMain && s.tab === "teleop");
  const landscape = useLandscape();
  const root = useRef<HTMLDivElement>(null);
  const estop = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ h: 760, pad: 16 });
  const [zone, setZone] = useState<{ top: number; bottom: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      setBox({ h: el.clientHeight, pad: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) });
      const e = estop.current?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (e) {
        setZone({ top: e.top - r.top, bottom: e.bottom - r.top, height: r.height });
        set({ toastBottom: Math.round(r.bottom - e.top + 8) });
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (estop.current?.previousElementSibling) ro.observe(estop.current.previousElementSibling);
    measure();
    return () => {
      ro.disconnect();
      set({ toastBottom: null });
    };
  }, [unlicensed, landscape]);

  // §7: the teleop tab is locked at 50% and enters follow view; §6: mission defaults to 2.5D top.
  useEffect(() => {
    if (tab === "teleop") set({ snap: 1, view: "follow" });
    if (tab === "mission" || tab === "events") set({ view: "top" });
    if (tab === "device") set({ view: "free" });
  }, [tab]);

  const usable = box.h - box.pad;
  const GAP = 8;
  const ESTOP = 56;
  const COLLAPSED_HEADER = 64;
  // Collapsed is "tab bar + one summary line", sized to that — not 20% of the
  // screen, which left 40–70px of blank sheet the map could have had.
  const COLLAPSED_SHEET = 96;
  const teleopOpen = Math.round(Math.max(usable * 0.5, Math.min(usable * 0.62, 380)));
  const heights: [number, number, number] = [
    COLLAPSED_SHEET,
    tab === "teleop" ? teleopOpen : Math.round(usable * SNAP_PCT[1]),
    usable - ESTOP - COLLAPSED_HEADER - 2 * GAP,
  ];
  let sheetH = heights[snap];
  // Teleop's open height: on a short phone 50% cannot hold the sticks AND the
  // posture keys (measured: 266px for 360px of content on an SE), and
  // "recover" is the key you need right after an E-Stop. It takes up to 62%.

  // At 90% the map would be a 57–73px sliver entirely covered by its own
  // header. Collapse it to the header instead, and give the rest to the sheet.
  const collapsed = snap === 2 && tab !== "teleop";
  if (snap === 2 && !collapsed) sheetH = heights[1];
  // In a call with the video as the main view, the map shrinks to a window at the right —
  // smaller on a short panel so it stays clear of the status header.
  const mapH = usable - ESTOP - sheetH - 2 * GAP;

  // Safe areas: notch / Dynamic Island on top, home indicator at the bottom.
  const shell = "bg-surface-sunken relative flex h-full flex-col gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]";

  if (landscape && !unlicensed) return <LandscapeConsole />;

  if (unlicensed)
    return (
      <div ref={root} className={shell}>
        <div className="bg-surface relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
          <LicenseGate />
        </div>
        <div ref={estop}>
          <EStopBar />
        </div>
      </div>
    );

  return (
    <EStopZone.Provider value={zone}>
      <div ref={root} className={shell}>
        <div
          className={cn(
            "relative overflow-hidden rounded-xl border",
            collapsed ? "bg-surface h-16 shrink-0" : "bg-map-ground min-h-0 flex-1"
          )}
        >
          <div
            className={cn(
              collapsed && "hidden",
              videoMain
                ? cn("absolute right-2 bottom-[60px] z-20 aspect-video overflow-hidden rounded-xl border shadow-2xl ring-1 ring-white/15", mapH < 260 ? "w-24" : "w-36")
                : "absolute inset-0"
            )}
          >
            <MapView bare={videoMain} />
            {videoMain && (
              <button
                onClick={() => set((s) => ({ call: { ...s.call, videoMain: false } }))}
                className="absolute inset-0 z-10 cursor-pointer"
                aria-label="放大地圖"
              />
            )}
          </div>
          {/* Full-height, click-through column: the status details can grow into
              it and scroll, instead of being clipped by the panel (they were,
              at 337px inside a 253–332px panel). */}
          <div className={cn("pointer-events-none absolute inset-0 z-20 flex flex-col gap-1.5", collapsed ? "p-1.5" : "p-2")}>
            <DogHeader />
            {!statusOpen && !collapsed && <Banners />}
          </div>
          {!collapsed && (videoMain || !statusOpen) && <CallLayer />}
          {!collapsed && <FaultOverlay />}
        </div>
        <div ref={estop}>
          <EStopBar />
        </div>
        <Sheet height={sheetH} heights={heights} />
        <Overlays />
      </div>
    </EStopZone.Provider>
  );
}

function Sheet({ height, heights }: { height: number; heights: [number, number, number] }) {
  const tab = useStore((s) => s.tab);
  const snap = useStore((s) => s.snap);
  // Teleop can be dragged too (it used to be locked at 50% per §7 — reviewers
  // could not find the handle doing anything). It moves between the 20% summary
  // and its own height only: 90% would collapse the map while driving.
  const maxSnap: SheetSnap = tab === "teleop" ? 1 : 2;
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);

  const onDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: height };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const top = heights[maxSnap];
    setLive(Math.max(heights[0], Math.min(Math.max(top, drag.current.h), drag.current.h + drag.current.y - e.clientY)));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const h = live ?? d.h;
    setLive(null);
    if (Math.abs(e.clientY - d.y) < 6) {
      // A tap on the handle steps up; from the top it drops back down.
      set({ snap: snap >= maxSnap ? (maxSnap === 1 ? 0 : 1) : ((snap + 1) as SheetSnap) });
      return;
    }
    const nearest = heights.reduce((best, p, i) => (Math.abs(p - h) < Math.abs(heights[best] - h) ? i : best), 0);
    set({ snap: Math.min(nearest, maxSnap) as SheetSnap });
  };

  return (
    <div
      className={cn(
        "bg-surface flex shrink-0 flex-col overflow-hidden rounded-2xl border shadow-sm",
        live === null && "transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
      )}
      style={{ height: live ?? height }}
    >
      {/* The whole strip is the grab area — the bar and the gaps around the
          tabs, not just a 4px pill. */}
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className="shrink-0 cursor-grab touch-none pb-1 active:cursor-grabbing" aria-label="拖曳調整面板高度">
        <div className="flex h-4 items-center justify-center">
          <span className="bg-muted-foreground/40 h-1 w-10 rounded-full" />
        </div>
        <TabBar />
      </div>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain pt-1.5 pb-[var(--kb,0px)]">
        <TabBoundary resetKey={tab}>{snap === 0 ? <Summary /> : <TabContent />}</TabBoundary>
      </div>
    </div>
  );
}

function TabBar() {
  const tab = useStore((s) => s.tab);
  return (
    <div role="tablist" className="grid grid-cols-4 gap-1 px-2">
      {TABS.map((t) => (
        <TabButton key={t.id} id={t.id} label={t.label} icon={t.icon} active={tab === t.id} />
      ))}
    </div>
  );
}

/** The dashboard rail's selected row, turned sideways: violet plate, white label. */
function TabButton({ id, label, icon: Icon, active }: { id: Tab; label: string; icon: typeof Gamepad2; active: boolean }) {
  const access = useAccess(id);
  const unread = useUnreadEvents();
  const dot = id === "events" && unread > 0 && !active;
  return (
    <button
      role="tab"
      aria-selected={active}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => set((s) => ({ tab: id, snap: s.snap === 0 ? 1 : s.snap }))}
      className={cn(
        "group relative flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-[12px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
        active ? "font-semibold text-white" : "text-muted-foreground hover:text-foreground hover:bg-violet-500/8"
      )}
    >
      {active && <ActivePlate className="rounded-lg" />}
      <span className="relative flex items-center gap-1.5">
        {access.locked ? <Lock className="size-3.5 opacity-70" /> : <Icon className="size-3.5" />}
        {label}
        {dot && <span className="bg-severity-emergency absolute -top-0.5 -right-2 size-1.5 rounded-full" aria-label={`${unread} 則新警示`} />}
      </span>
    </button>
  );
}

function TabContent() {
  const tab = useStore((s) => s.tab);
  switch (tab) {
    case "teleop":
      return <TeleopTab />;
    case "mission":
      return <MissionTab />;
    case "events":
      return <EventsTab />;
    case "device":
      return <DeviceTab />;
  }
}

/** §5: at 20% only the tab bar and a one-line summary show. */
function Summary() {
  const tab = useStore((s) => s.tab);
  const access = useAccess(tab);
  return (
    <div className="text-muted-foreground px-4 pb-2 text-[13px]">
      {access.locked ? (
        <span className="flex items-center gap-1.5">
          <Lock className="size-3.5" />
          {access.reason}
        </span>
      ) : tab === "teleop" ? (
        <TeleopSummary />
      ) : tab === "mission" ? (
        <MissionSummary />
      ) : tab === "events" ? (
        <EventsSummary />
      ) : (
        <DeviceSummary />
      )}
    </div>
  );
}
