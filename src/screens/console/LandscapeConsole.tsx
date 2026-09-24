"use client";

import { Gamepad2, Smartphone } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { EStopZone } from "@/components/kit";
import { cn } from "@/lib/utils";
import { MapView } from "@/map3d/MapView";
import { set, useStore } from "@/store";

import { MapChips } from "./Banners";
import { EStopBar } from "./EStopBar";
import { FaultOverlay, Overlays } from "./Overlays";
import { DogHeader } from "./StatusBar";
import { CallButton, CallLayer } from "./talk/CallLayer";
import { TeleopTab } from "./teleop/TeleopTab";
import { TOOL, TOOL_ON } from "./MapToolbar";

/**
 * §5: landscape is supported on the teleop tab only — the call lives inside it.
 *
 * Layout: the map (or, in a call with the video swapped in, the video) is the whole screen;
 * the status island top-left; 影像 and the E-Stop (one tap, never covered) top-right.
 * The call's small window sits under the header; tap it to swap map and video. Other tabs
 * ask for portrait instead of squeezing a sheet into 390px of height.
 */
export function LandscapeConsole() {
  const tab = useStore((s) => s.tab);
  const videoMain = useStore((s) => s.call.active && s.call.videoMain);
  const statusOpen = useStore((s) => s.statusOpen);
  const supported = tab === "teleop";

  // Dialogs place themselves clear of the E-Stop (EStopZone), measured like the portrait one.
  const root = useRef<HTMLDivElement>(null);
  const estop = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<{ top: number; bottom: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const e = estop.current?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (e) setZone({ top: e.top - r.top, bottom: e.bottom - r.top, height: r.height });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  return (
    <EStopZone.Provider value={zone}>
      {/* The map runs edge to edge, under the cutout and the home bar; every control lives in
          the inset layer, so nothing lands under the notch on either side. */}
      <div ref={root} className="bg-map-ground relative h-full overflow-hidden">
        {supported && (
          <div
            className={cn(videoMain ? "absolute z-20 aspect-video w-36 overflow-hidden rounded-xl border shadow-2xl ring-1 ring-white/15" : "absolute inset-0")}
            // Just under the island, small enough to stay clear of the left stick on a short phone.
            style={videoMain ? { top: "calc(var(--safe-top) + 60px)", left: "calc(var(--safe-left) + 8px)" } : undefined}
          >
            <MapView bare />
            {videoMain && (
              <button onClick={() => set((s) => ({ call: { ...s.call, videoMain: false } }))} className="absolute inset-0 z-10 cursor-pointer" aria-label="放大地圖" />
            )}
          </div>
        )}

        {/* Click-through: each control opts back in (pointer-events is inherited). */}
        <div data-island-bounds className="pointer-events-none absolute top-[var(--safe-top)] right-[var(--safe-right)] bottom-[var(--safe-bottom)] left-[var(--safe-left)]">
          {supported && (
            <div className="pointer-events-auto contents">
              <CallLayer landscape />
            </div>
          )}
          {supported && <TeleopTab landscape />}

          {/* Island left, 影像 and the E-Stop top-right. Both thumbs are on the sticks in
              landscape: the top-right corner is a short reach up for the right thumb, and it
              leaves the island the width for name, speed, battery and signal (an SE on its side
              squeezed the name to 巡邏犬… when the E-Stop sat in the middle). No z-index on the
              row itself: that would trap the E-Stop's z-[60] under a dialog's backdrop (z-50). */}
          <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start gap-2">
            {/* A fixed 340 pt, open or closed: in landscape the island never takes the map. */}
            <div className="relative z-30 flex min-w-0 flex-[0_1_340px] flex-col gap-1.5">
              <DogHeader landscape />
              {!statusOpen && <MapChips />}
            </div>
            <div className="flex-1" />
            {supported && (
              <div className="pointer-events-auto relative z-30 mt-0.5">
                <CallButton className={cn(TOOL, videoMain && TOOL_ON)} />
              </div>
            )}
            <div ref={estop} className="pointer-events-auto relative z-[60] w-[152px] shrink-0">
              <EStopBar compact />
            </div>
          </div>
        </div>

        {!supported && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="bg-surface/90 max-w-sm rounded-2xl border p-5 text-center backdrop-blur">
              <Smartphone className="text-primary-accent mx-auto mb-2 size-6" />
              <p className="font-semibold">這個分頁只支援直式</p>
              <p className="text-muted-foreground mt-1 text-sm">把手機轉回直向，或切到操控。E-Stop 在上方隨時可用。</p>
              <button
                onClick={() => set({ tab: "teleop" })}
                className="bg-primary text-primary-foreground mt-3 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium"
              >
                <Gamepad2 className="size-4" />
                切到操控
              </button>
            </div>
          </div>
        )}

        <FaultOverlay />
        <Overlays />
      </div>
    </EStopZone.Provider>
  );
}
