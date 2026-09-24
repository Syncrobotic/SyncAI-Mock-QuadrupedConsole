"use client";

import { Gamepad2, Smartphone } from "lucide-react";

import { EStopZone } from "@/components/kit";
import { cn } from "@/lib/utils";
import { MapView } from "@/map3d/MapView";
import { set, useStore } from "@/store";

import { MapChips } from "./Banners";
import { EStopBar } from "./EStopBar";
import { FaultOverlay, Overlays } from "./Overlays";
import { DogHeader } from "./StatusBar";
import { CallLayer } from "./talk/CallLayer";
import { TeleopTab } from "./teleop/TeleopTab";

/**
 * §5: landscape is supported on the teleop tab only — the call lives inside it.
 *
 * Layout: the map (or, in a call with the video swapped in, the video) is the whole screen;
 * the status header top-left, the E-Stop top-centre — still one tap, still never covered.
 * The call's small window sits under the header; tap it to swap map and video. Other tabs
 * ask for portrait instead of squeezing a sheet into 390px of height.
 */
export function LandscapeConsole() {
  const tab = useStore((s) => s.tab);
  const videoMain = useStore((s) => s.call.active && s.call.videoMain);
  const supported = tab === "teleop";

  return (
    // No E-Stop zone for dialogs here: the E-Stop is at the top, dialogs centre
    // below it and never reach it at this height.
    <EStopZone.Provider value={null}>
      {/* The map runs edge to edge, under the cutout and the home bar; every control lives in
          the inset layer, so nothing lands under the notch on either side. */}
      <div className="bg-map-ground relative h-full overflow-hidden">
        {supported && (
          <div
            className={cn(videoMain ? "absolute z-20 aspect-video w-44 overflow-hidden rounded-xl border shadow-2xl ring-1 ring-white/15" : "absolute inset-0")}
            style={videoMain ? { top: "calc(var(--safe-top) + 104px)", left: "calc(var(--safe-left) + 12px)" } : undefined}
          >
            <MapView bare />
            {videoMain && (
              <button onClick={() => set((s) => ({ call: { ...s.call, videoMain: false } }))} className="absolute inset-0 z-10 cursor-pointer" aria-label="放大地圖" />
            )}
          </div>
        )}

        {/* Click-through: each control opts back in (pointer-events is inherited). */}
        <div className="pointer-events-none absolute top-[var(--safe-top)] right-[var(--safe-right)] bottom-[var(--safe-bottom)] left-[var(--safe-left)]">
          {supported && (
            <div className="pointer-events-auto contents">
              <CallLayer landscape />
            </div>
          )}
          {supported && <TeleopTab landscape />}

          <div className="pointer-events-none absolute inset-x-2 top-2 z-30 flex items-start gap-2">
            <div className="flex w-[300px] shrink-0 flex-col gap-1.5">
              <DogHeader landscape />
              <MapChips />
            </div>
            <div className="pointer-events-auto mx-auto w-[240px] shrink-0">
              <EStopBar />
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
