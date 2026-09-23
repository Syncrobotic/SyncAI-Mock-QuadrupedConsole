"use client";

import { Gamepad2, Lock, MapPinned, Phone, Settings2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { TabBoundary } from "@/components/kit";
import { cn } from "@/lib/utils";
import { MapView } from "@/map3d/MapView";
import { NO_SCOPES, SNAP_PCT, set, useStore, type SheetSnap } from "@/store";
import { tabAccess, type Access, type Tab } from "@/store/logic";

import { Banners } from "./Banners";
import { EStopBar } from "./EStopBar";
import { FaultOverlay, Overlays } from "./Overlays";
import { StatusBar } from "./StatusBar";
import { DeviceTab, DeviceSummary } from "./device/DeviceTab";
import { MissionSummary, MissionTab } from "./mission/MissionTab";
import { CallPip } from "./talk/CallPip";
import { TalkSummary, TalkTab } from "./talk/TalkTab";
import { TeleopSummary, TeleopTab } from "./teleop/TeleopTab";

const TABS: { id: Tab; label: string; icon: typeof Gamepad2 }[] = [
  { id: "teleop", label: "操控", icon: Gamepad2 },
  { id: "mission", label: "任務", icon: MapPinned },
  { id: "talk", label: "通話", icon: Phone },
  { id: "device", label: "裝置", icon: Settings2 },
];

export function useAccess(tab: Tab): Access {
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
 * §5 information architecture: one screen. Status strip on top, the map
 * filling the viewport, E-Stop pinned between map and sheet, and the sheet
 * with four tabs at three heights. No nested pages.
 */
export function Console() {
  const tab = useStore((s) => s.tab);
  const snap = useStore((s) => s.snap);
  const body = useRef<HTMLDivElement>(null);
  const [bodyH, setBodyH] = useState(700);

  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBodyH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // §7: the teleop tab is locked at 50% and enters follow view; §6: mission defaults to 2.5D top.
  useEffect(() => {
    if (tab === "teleop") set({ snap: 1, view: "follow" });
    if (tab === "mission") set({ view: "top" });
    if (tab === "talk" || tab === "device") set({ view: "free" });
  }, [tab]);

  const sheetH = Math.round(bodyH * SNAP_PCT[snap]);

  return (
    <div className="relative flex h-full flex-col">
      <StatusBar />
      <div ref={body} className="relative min-h-0 flex-1 overflow-hidden">
        <MapView bottomInset={sheetH + 56} />
        <Banners />
        <CallPip bottomOffset={sheetH + 56} />
        <FaultOverlay bottom={sheetH + 56} />
        <div className="absolute inset-x-0 bottom-0 flex flex-col">
          <EStopBar />
          <Sheet height={sheetH} bodyH={bodyH} />
        </div>
      </div>
      <Overlays />
    </div>
  );
}

function Sheet({ height, bodyH }: { height: number; bodyH: number }) {
  const tab = useStore((s) => s.tab);
  const snap = useStore((s) => s.snap);
  const locked = tab === "teleop";
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);

  const onDown = (e: React.PointerEvent) => {
    if (locked) return;
    drag.current = { y: e.clientY, h: height };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setLive(Math.max(bodyH * 0.15, Math.min(bodyH * 0.92, drag.current.h + drag.current.y - e.clientY)));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const h = live ?? d.h;
    setLive(null);
    if (Math.abs(e.clientY - d.y) < 6) {
      // A tap on the handle steps up; from the top it drops back to the middle.
      set({ snap: snap === 2 ? 1 : ((snap + 1) as SheetSnap) });
      return;
    }
    const pct = h / bodyH;
    const nearest = SNAP_PCT.reduce((best, p, i) => (Math.abs(p - pct) < Math.abs(SNAP_PCT[best] - pct) ? i : best), 0);
    set({ snap: nearest as SheetSnap });
  };

  return (
    <div
      className={cn("bg-surface flex flex-col border-t", live === null && "transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none")}
      style={{ height: live ?? height }}
    >
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className={cn("shrink-0 touch-none", !locked && "cursor-grab active:cursor-grabbing")}>
        <div className="flex justify-center pt-1.5 pb-0.5">
          <span className={cn("h-1 w-9 rounded-full", locked ? "bg-muted-foreground/15" : "bg-muted-foreground/35")} />
        </div>
        <TabBar />
      </div>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <TabBoundary resetKey={tab}>{snap === 0 ? <Summary /> : <TabContent />}</TabBoundary>
      </div>
    </div>
  );
}

function TabBar() {
  const tab = useStore((s) => s.tab);
  return (
    <div role="tablist" className="grid grid-cols-4 px-2">
      {TABS.map((t) => (
        <TabButton key={t.id} id={t.id} label={t.label} icon={t.icon} active={tab === t.id} />
      ))}
    </div>
  );
}

function TabButton({ id, label, icon: Icon, active }: { id: Tab; label: string; icon: typeof Gamepad2; active: boolean }) {
  const access = useAccess(id);
  return (
    <button
      role="tab"
      aria-selected={active}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => set((s) => ({ tab: id, snap: s.snap === 0 ? 1 : s.snap }))}
      className={cn(
        "relative flex h-12 cursor-pointer flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
        active ? "text-primary-accent" : "text-muted-foreground hover:text-foreground",
        access.locked && !active && "opacity-60"
      )}
    >
      <span className="relative">
        <Icon className="size-5" />
        {access.locked && (
          <span className="bg-surface absolute -right-1.5 -bottom-1 grid size-3.5 place-items-center rounded-full">
            <Lock className="size-2.5" />
          </span>
        )}
      </span>
      {label}
      {active && <span className="bg-primary-accent absolute inset-x-5 bottom-0 h-0.5 rounded-full" />}
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
    case "talk":
      return <TalkTab />;
    case "device":
      return <DeviceTab />;
  }
}

/** §5: at 20% only the tab bar and a one-line summary show. */
function Summary() {
  const tab = useStore((s) => s.tab);
  const access = useAccess(tab);
  return (
    <div className="text-muted-foreground px-4 py-1 text-[13px]">
      {access.locked ? (
        <span className="flex items-center gap-1.5">
          <Lock className="size-3.5" />
          {access.reason}
        </span>
      ) : tab === "teleop" ? (
        <TeleopSummary />
      ) : tab === "mission" ? (
        <MissionSummary />
      ) : tab === "talk" ? (
        <TalkSummary />
      ) : (
        <DeviceSummary />
      )}
    </div>
  );
}
