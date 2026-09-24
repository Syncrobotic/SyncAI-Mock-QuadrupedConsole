"use client";

import { BatteryFull, ChevronLeft, Circle, Menu, Signal, Wifi } from "lucide-react";

import { IS_MOCK } from "@/lib/env";
import { cn } from "@/lib/utils";
import { useStore, type DeviceId } from "@/store";

import { ReviewPanel } from "./ReviewPanel";

/**
 * Same wrapper the dashboard's resident app uses (`resident-shell.tsx`): on a
 * phone it is the whole screen; on a desktop it becomes a phone so a design
 * review sees the real proportions, with the review panel beside it.
 *
 * The desktop frame imitates a real device (review panel → 裝置): its size, its
 * cutout, its status bar and its home indicator / navigation bar, and — through
 * the `--safe-*` variables in globals.css — the safe areas the app lays out by.
 * Without this every review saw a phone with no notch, and layouts that ran
 * under the Dynamic Island passed.
 *
 * 🔴 `transform-gpu` is load-bearing: a transformed element is the containing
 * block for `position: fixed` descendants, so every overlay, toast and sheet
 * in the app is clipped to the phone instead of the browser window.
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  const landscape = useStore((s) => s.forceLandscape);
  const device = useStore((s) => s.phoneModel);
  return (
    <div className={cn("bg-surface-sunken flex min-h-dvh items-center justify-center gap-10 sm:p-6", landscape && "flex-col gap-6")}>
      <div
        data-phone
        data-device={device}
        data-orient={landscape ? "land" : "port"}
        className="bg-background relative flex h-dvh w-full shrink-0 transform-gpu flex-col overflow-hidden sm:border-[10px] sm:border-neutral-800 sm:shadow-2xl"
      >
        {children}
        {device !== "none" && <DeviceChrome device={device} landscape={landscape} />}
      </div>
      {IS_MOCK && <ReviewPanel />}
    </div>
  );
}

/** The parts of the phone the app draws under but never on: cutout, status bar, home / nav bar. Desktop only. */
function DeviceChrome({ device, landscape }: { device: Exclude<DeviceId, "none">; landscape: boolean }) {
  const ios = device === "iphone16pro" || device === "iphonese";
  // iOS hides the status bar in landscape; Android keeps a thin one.
  const showStatus = !(ios && landscape);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[200] hidden text-white sm:block">
      {showStatus && (
        <div
          className={cn(
            "absolute inset-x-0 top-0 flex items-center justify-between font-semibold tabular-nums",
            device === "iphone16pro" && "h-[54px] px-9 pt-1 text-[15px]",
            device === "iphonese" && "h-5 px-2 text-[12px]",
            device === "pixel9" && (landscape ? "h-6 pr-4 pl-16 text-[12px]" : "h-12 px-6 text-[13px]"),
            device === "galaxys24" && (landscape ? "h-6 pr-16 pl-12 text-[11px]" : "h-9 px-5 text-[12px]")
          )}
        >
          {device === "iphonese" ? (
            <>
              <span className="flex items-center gap-1 [&_svg]:size-3">
                <Signal />
                <Wifi />
              </span>
              <span className="absolute left-1/2 -translate-x-1/2">9:41</span>
              <BatteryFull className="size-4" />
            </>
          ) : (
            <>
              <span>9:41</span>
              <span className="flex items-center gap-1 [&_svg]:size-3.5">
                <Signal />
                <Wifi />
                <BatteryFull className={cn(ios && "!size-5")} />
              </span>
            </>
          )}
        </div>
      )}

      {/* Cutouts */}
      {device === "iphone16pro" &&
        (landscape ? (
          <span className="absolute top-1/2 left-[11px] h-[125px] w-[37px] -translate-y-1/2 rounded-full bg-black" />
        ) : (
          <span className="absolute top-[11px] left-1/2 h-[37px] w-[125px] -translate-x-1/2 rounded-full bg-black" />
        ))}
      {device === "pixel9" &&
        (landscape ? (
          <span className="absolute top-1/2 left-[14px] size-[22px] -translate-y-1/2 rounded-full bg-black ring-1 ring-white/10" />
        ) : (
          <span className="absolute top-[14px] left-1/2 size-[22px] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10" />
        ))}
      {device === "galaxys24" &&
        (landscape ? (
          <span className="absolute top-1/2 left-[10px] size-[18px] -translate-y-1/2 rounded-full bg-black ring-1 ring-white/10" />
        ) : (
          <span className="absolute top-[10px] left-1/2 size-[18px] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10" />
        ))}

      {/* Home indicator / gesture pill / three-button bar */}
      {device === "iphone16pro" && <span className="absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-white/90" />}
      {device === "pixel9" && <span className="absolute bottom-[10px] left-1/2 h-1 w-[108px] -translate-x-1/2 rounded-full bg-white/80" />}
      {device === "galaxys24" && (
        <div
          className={cn(
            "absolute flex items-center justify-around bg-black/90 text-white/80 [&_svg]:size-4",
            landscape ? "inset-y-0 right-0 w-12 flex-col-reverse" : "inset-x-0 bottom-0 h-12"
          )}
        >
          <Menu className="rotate-90" />
          <Circle />
          <ChevronLeft />
        </div>
      )}
    </div>
  );
}
