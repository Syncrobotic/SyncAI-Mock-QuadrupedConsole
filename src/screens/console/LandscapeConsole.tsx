"use client";

import { Gamepad2, Smartphone } from "lucide-react";

import { EStopZone } from "@/components/kit";
import { cn } from "@/lib/utils";
import { MapView } from "@/map3d/MapView";
import { set, useStore } from "@/store";

import { Banners } from "./Banners";
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
      <div className="bg-map-ground relative h-full overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        {supported && (
          <div
            className={cn(
              videoMain ? "absolute top-[104px] left-3 z-20 aspect-video w-44 overflow-hidden rounded-xl border shadow-2xl ring-1 ring-white/15" : "absolute inset-0"
            )}
          >
            <MapView bare />
            {videoMain && (
              <button onClick={() => set((s) => ({ call: { ...s.call, videoMain: false } }))} className="absolute inset-0 z-10 cursor-pointer" aria-label="放大地圖" />
            )}
          </div>
        )}

        {supported && <CallLayer landscape />}
        {supported && <TeleopTab landscape />}

        <div className="pointer-events-none absolute inset-x-2 top-2 z-30 flex items-start gap-2">
          <div className="flex w-[320px] shrink-0 flex-col gap-1.5">
            <DogHeader />
            <Banners />
          </div>
          <div className="pointer-events-auto mx-auto w-[260px] shrink-0">
            <EStopBar />
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
                className="bg-primary text-primary-foreground mt-3 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium"
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
