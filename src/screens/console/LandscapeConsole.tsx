"use client";

import { Gamepad2, Phone, Smartphone } from "lucide-react";
import { useState } from "react";

import { ActivePlate, EStopZone } from "@/components/kit";
import { cn } from "@/lib/utils";
import { MapView } from "@/map3d/MapView";
import { set, useStore } from "@/store";

import { Banners } from "./Banners";
import { EStopBar } from "./EStopBar";
import { FaultOverlay, Overlays } from "./Overlays";
import { DogHeader } from "./StatusBar";
import { CallPip } from "./talk/CallPip";
import { TalkTab } from "./talk/TalkTab";
import { TeleopTab } from "./teleop/TeleopTab";

/**
 * §5: landscape is supported on the teleop and call tabs only, and the call
 * tab in landscape is one of the two full-screen exceptions.
 *
 * Layout: the map (or, in a call, the video) is the whole screen; the status
 * header top-left, the E-Stop top-centre — still one tap, still never covered
 * — and a two-way switch for the two tabs that exist here top-right. Other
 * tabs ask for portrait instead of squeezing a sheet into 390px of height.
 */
export function LandscapeConsole() {
  const tab = useStore((s) => s.tab);
  const [videoMain, setVideoMain] = useState(true);
  const supported = tab === "teleop" || tab === "talk";
  const mapMain = tab === "teleop" || !videoMain;

  return (
    // No E-Stop zone for dialogs here: the E-Stop is at the top, dialogs centre
    // below it and never reach it at this height.
    <EStopZone.Provider value={null}>
      <div className="bg-map-ground relative h-full overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        {supported && (
          <div
            onClick={mapMain ? undefined : () => setVideoMain(true)}
            className={cn(
              mapMain ? "absolute inset-0" : "absolute right-3 bottom-3 z-20 aspect-video w-52 cursor-pointer overflow-hidden rounded-xl border shadow-2xl ring-1 ring-white/15"
            )}
          >
            <MapView bare={!mapMain || tab === "teleop"} />
          </div>
        )}

        {supported && tab === "teleop" && <TeleopTab landscape />}
        {supported && tab === "talk" && <TalkTab landscape videoMain={videoMain} onSwap={() => setVideoMain(false)} />}
        {tab === "teleop" && <CallPip landscape />}

        <div className="pointer-events-none absolute inset-x-2 top-2 z-30 flex items-start gap-2">
          <div className="flex w-[320px] shrink-0 flex-col gap-1.5">
            <DogHeader />
            <Banners />
          </div>
          <div className="pointer-events-auto mx-auto w-[260px] shrink-0">
            <EStopBar />
          </div>
          <div className="bg-surface/85 pointer-events-auto flex shrink-0 gap-1 rounded-xl border p-1 backdrop-blur">
            {(
              [
                ["teleop", "操控", Gamepad2],
                ["talk", "通話", Phone],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => set({ tab: id })}
                aria-pressed={tab === id}
                className={cn("relative flex h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium", tab === id ? "text-white" : "text-muted-foreground hover:text-foreground")}
              >
                {tab === id && <ActivePlate className="rounded-lg" />}
                <span className="relative flex items-center gap-1.5">
                  <Icon className="size-4" />
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {!supported && (
          <div className="absolute inset-0 grid place-items-center">
            <div className="bg-surface/90 max-w-sm rounded-2xl border p-5 text-center backdrop-blur">
              <Smartphone className="text-primary-accent mx-auto mb-2 size-6" />
              <p className="font-semibold">這個分頁只支援直式</p>
              <p className="text-muted-foreground mt-1 text-sm">把手機轉回直向，或切到操控、通話。E-Stop 在上方隨時可用。</p>
            </div>
          </div>
        )}

        <FaultOverlay />
        <Overlays />
      </div>
    </EStopZone.Provider>
  );
}
