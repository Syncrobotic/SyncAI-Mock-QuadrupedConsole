"use client";

import { Gamepad2, Lock, MapPinned, ScrollText, Settings2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { EStopZone, TabBoundary } from "@/components/kit";
import { useLandscape } from "@/hooks/use-landscape";
import { cn } from "@/lib/utils";
import { MapView } from "@/map3d/MapView";
import { NO_SCOPES, SNAP_PCT, set, useStore, type SheetSnap } from "@/store";
import { tabAccess, type Access, type Area, type Tab } from "@/store/logic";

import { MapChips } from "./Banners";
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
const COLLAPSED_HEADER = 64;
/** The E-Stop's row at the bottom of the map panel: 44px key + 8px inset + 8px air. */
const ESTOP_ROW = 60;

/**
 * Swapped (video main), the map's window takes the corner the video's window had — the small
 * window never jumps sides. Bottom corners sit above the call controls (which sit above the E-Stop).
 */
const MAP_WINDOW = { tl: "top-[72px] left-2", tr: "top-[72px] right-2", bl: "bottom-[112px] left-2", br: "right-2 bottom-[112px]" } as const;

export function Console() {
  const tab = useStore((s) => s.tab);
  const snap = useStore((s) => s.snap);
  const statusOpen = useStore((s) => s.statusOpen);
  const unlicensed = useStore((s) => s.device?.licenseEdition === "none");
  const videoMain = useStore((s) => s.call.active && s.call.videoMain && s.tab === "teleop");
  const pipCorner = useStore((s) => s.call.corner);
  const landscape = useLandscape();
  const root = useRef<HTMLDivElement>(null);
  const estop = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ h: 760, pad: 16 });
  const [zone, setZone] = useState<{ top: number; bottom: number; height: number } | null>(null);
  const mapPanel = useRef<HTMLDivElement>(null);
  const mapLayer = useRef<HTMLDivElement>(null);
  // Three thresholds of the map panel's height. The panel resizes every frame while the
  // sheet moves; React only hears about it when one of these flips.
  const [collapsed, setCollapsed] = useState(false);
  const [roomy, setRoomy] = useState(true);
  const [shortMap, setShortMap] = useState(false);

  useLayoutEffect(() => {
    const el = mapPanel.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      // The map fades in with the room it gets, so its corner controls never pop in
      // squeezed against the header. Written straight to the style: no render per frame.
      if (mapLayer.current) mapLayer.current.style.opacity = String(Math.min(1, Math.max(0, (h - COLLAPSED_HEADER - ESTOP_ROW) / 140)));
      setCollapsed(h < COLLAPSED_HEADER + ESTOP_ROW + 40);
      // Banners wait until there is room below the header.
      setRoomy(h >= COLLAPSED_HEADER + 96);
      setShortMap(h < 260);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [unlicensed, landscape]);

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
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The E-Stop rides the bottom of the map panel: it moves whenever the panel resizes.
    if (mapPanel.current) ro.observe(mapPanel.current);
    measure();
    return () => ro.disconnect();
  }, [unlicensed, landscape]);

  // §7: the teleop tab is locked at 50% and enters follow view; §6: mission defaults to 2.5D top.
  useEffect(() => {
    if (tab === "teleop") set({ snap: 1, view: "follow" });
    if (tab === "mission" || tab === "events") set({ view: "top" });
    if (tab === "device") set({ view: "free" });
  }, [tab]);

  const usable = box.h - box.pad;
  const GAP = 8;
  // Collapsed is "tab bar + one summary line", sized to that — not 20% of the
  // screen, which left 40–70px of blank sheet the map could have had.
  const COLLAPSED_SHEET = 96;
  // Teleop in portrait is posture, gait and the speed limit — no sticks (they are landscape's) —
  // so its open height is its content, and the map gets the rest.
  const teleopOpen = 252;
  const heights: [number, number, number] = [
    COLLAPSED_SHEET,
    tab === "teleop" ? teleopOpen : Math.round(usable * SNAP_PCT[1]),
    // At 90% the map keeps its header and the E-Stop: the E-Stop is never collapsed away.
    usable - COLLAPSED_HEADER - ESTOP_ROW - GAP,
  ];
  let sheetH = heights[snap];

  // At 90% the map is left with exactly its header's height (heights[2]). The panel is
  // always flex-1, so it follows the sheet frame by frame — while dragging and during the
  // snap animation — and "collapsed" is what its measured height says, not the snap.
  if (snap === 2 && tab === "teleop") sheetH = heights[1];
  // The canvas is never resized while the panel moves (a WebGL resize per frame is what
  // made it stutter): it is drawn at the tallest the map gets and centred in the panel,
  // which clips it. Centred, so follow view keeps the dog in the middle of what is seen.
  const mapStage = usable - COLLAPSED_SHEET - GAP;

  // Safe areas: notch / Dynamic Island on top, home indicator at the bottom.
  // The background runs under the cutout and the home bar; the panels start inside the safe area.
  const shell =
    "bg-surface-sunken relative flex h-full flex-col gap-2 pt-[max(0.5rem,var(--safe-top))] pr-[calc(0.5rem+var(--safe-right))] pb-[max(0.5rem,var(--safe-bottom))] pl-[calc(0.5rem+var(--safe-left))]";

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
          ref={mapPanel}
          data-island-bounds
          style={{ "--map-stage": `${mapStage}px` } as React.CSSProperties}
          className={cn(
            "relative min-h-[124px] flex-1 overflow-hidden rounded-xl border transition-colors duration-300",
            collapsed ? "bg-surface" : "bg-map-ground"
          )}
        >
          {/* In a call with the video as the main view, the map shrinks to a window at the right —
              smaller on a short panel so it stays clear of the status header. */}
          <div
            ref={mapLayer}
            aria-hidden={collapsed || undefined}
            className={cn(
              "transition-opacity duration-100 motion-reduce:transition-none",
              collapsed && "pointer-events-none",
              videoMain
                ? cn("absolute z-20 aspect-video overflow-hidden rounded-xl border shadow-2xl ring-1 ring-white/15", MAP_WINDOW[pipCorner], shortMap ? "w-24" : "w-32")
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
            {!statusOpen && roomy && <MapChips />}
          </div>
          {!collapsed && (videoMain || !statusOpen) && <CallLayer />}
          {!collapsed && <FaultOverlay />}
          {/* §5 E-Stop, inside the map: bottom centre, always there — the collapsed map keeps
              it too. z-[60] lifts it over any dialog's backdrop; dialogs sit clear of it. */}
          <div ref={estop} className="absolute bottom-2 left-1/2 z-[60] -translate-x-1/2">
            <EStopBar compact />
          </div>
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

/**
 * Selected = a light tint and the accent colour. It used to be the dashboard rail's solid
 * violet plate with a white label — the heaviest thing on the screen after the E-Stop.
 */
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
        active ? "bg-primary/12 text-primary-accent dark:bg-primary/20 font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-violet-500/8"
      )}
    >
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
