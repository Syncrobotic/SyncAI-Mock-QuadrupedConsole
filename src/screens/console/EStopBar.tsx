"use client";

import { Bluetooth, Loader2, OctagonX, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "@/lib/notify";

import { cn, formatClock } from "@/lib/utils";
import { useStore } from "@/store";
import { estop, releaseEstop } from "@/store/controller";
import { estopRoute } from "@/store/logic";

const HOLD_MS = 2000;

/**
 * §5 E-Stop: red, never covered. `compact` is the Console's: a 44 pt key floating at the
 * bottom centre of the map (and at the top centre in landscape) instead of a full-width bar
 * between map and sheet. The full bar stays where there is no map (the licence gate). One tap, no confirm —
 * a guard's speed matters more than an accidental stop. Rendered OUTSIDE the
 * tab error boundary (§14) so a crashing tab cannot take it down.
 */
type Phase = "idle" | "sending" | "ble_ack" | "unconfirmed";

export function EStopBar({ compact = false }: { compact?: boolean }) {
  const conn = useStore((s) => s.conn);
  const mode = useStore((s) => s.telemetry?.mode);
  const estopInfo = useStore((s) => s.telemetry?.estop ?? null);
  const isOwner = useStore((s) => !!s.session?.scopes.includes("admin"));
  const route = estopRoute(conn);
  const [phase, setPhase] = useState<Phase>("idle");

  // Leaving BLE-only (WS back) clears the BLE acknowledgement: from then on
  // the dog's own ESTOP mode is the source of truth.
  const [lastRoute, setLastRoute] = useState(route);
  if (lastRoute !== route) {
    setLastRoute(route);
    if (phase === "ble_ack" && route === "ws") setPhase("idle");
  }

  if (mode === "ESTOP" && route === "ws") return <Stopped by={estopInfo?.by} at={estopInfo?.at} canRelease={isOwner} compact={compact} />;

  const disabled = route === "disabled";

  /**
   * Feedback in steps, because "I pressed it" is not "it stopped":
   *   sending     — the press registered, the frame is on its way
   *   (ESTOP)     — over WS, the dog's telemetry says ESTOP → the bar flips
   *   unconfirmed — no ESTOP within 1.5 s → say so, and keep the key live
   *   ble_ack     — over BLE there is no telemetry; a write-with-response
   *                 from bootstrapd is the acknowledgement we can get
   */
  const press = async () => {
    setPhase("sending");
    try {
      await estop();
    } catch {
      setPhase("unconfirmed");
      return;
    }
    if (route === "ble") {
      setPhase("ble_ack");
      toast.warning("E-Stop 已經由藍牙送達");
      return;
    }
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      if (useStore.getState().telemetry?.mode === "ESTOP") {
        setPhase("idle");
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    setPhase("unconfirmed");
  };

  const label =
    phase === "sending" ? "送出中…" : phase === "unconfirmed" ? "未確認 · 再按一次" : phase === "ble_ack" ? "已經由藍牙送達" : "E-STOP";

  return (
    <button
      disabled={disabled || phase === "sending"}
      onClick={() => void press()}
      aria-label={route === "ble" ? "緊急停止（經由藍牙）" : "緊急停止"}
      aria-live="assertive"
      className={cn(
        "relative z-[60] flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl text-white select-none",
        compact ? "h-11 min-w-[136px] gap-2 px-4 whitespace-nowrap" : "h-12 w-full gap-2.5",
        phase === "idle"
          ? cn("font-black tracking-[0.18em] uppercase", compact ? "text-[14px]" : "text-[16px]")
          : cn("font-bold tracking-normal", compact ? "text-[13px]" : "text-[15px]"),
        "from-estop to-estop-pressed bg-linear-to-b shadow-lg ring-1 shadow-red-900/30 ring-white/15 transition-[filter,transform] duration-100 hover:brightness-110 active:scale-[0.99] active:brightness-90",
        "focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:outline-none",
        phase === "unconfirmed" && "animate-pulse ring-4 ring-white/70",
        phase === "ble_ack" && "bg-estop-pressed bg-none",
        disabled && "bg-muted text-muted-foreground cursor-not-allowed bg-none shadow-none ring-0"
      )}
    >
      {!disabled && phase === "idle" && <span aria-hidden className="absolute inset-x-6 top-0 h-px bg-linear-to-r from-transparent via-white/50 to-transparent" />}
      {phase === "sending" ? <Loader2 className="size-5 animate-spin" /> : <OctagonX className="size-5" strokeWidth={2.5} />}
      {label}
      {/* Compact: the route is an icon (the status island says the rest). */}
      {route === "ble" && compact && <Bluetooth aria-hidden className="size-3.5 opacity-80" />}
      {route === "ble" && !compact && (
        <span className="absolute right-3 flex items-center gap-1 rounded-md bg-black/25 px-1.5 py-0.5 text-[11px] font-semibold tracking-normal normal-case">
          <Bluetooth className="size-3" />
          經藍牙
        </span>
      )}
      {disabled && !compact && <span className="absolute right-3 text-[11px] font-semibold tracking-normal normal-case">連不到狗</span>}
    </button>
  );
}

function Stopped({ by, at, canRelease, compact }: { by?: string; at?: number; canRelease: boolean; compact: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    if (!canRelease) return;
    setHolding(true);
    timer.current = setTimeout(async () => {
      setHolding(false);
      navigator.vibrate?.(40);
      await releaseEstop();
    }, HOLD_MS);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <button
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      disabled={!canRelease}
      aria-label={canRelease ? "長按 2 秒解除緊急停止" : "已緊急停止，需由擁有者解除"}
      className={cn(
        "bg-estop-pressed ring-estop/60 relative z-[60] flex shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl text-white ring-2 select-none disabled:cursor-default",
        compact ? "h-11 min-w-[136px] px-4 whitespace-nowrap" : "h-12 w-full"
      )}
    >
      {holding && (
        <span
          aria-hidden
          className="absolute inset-0 origin-left bg-white/25"
          style={{ animation: `hold-fill ${HOLD_MS}ms linear forwards` }}
        />
      )}
      <span className="relative flex flex-col items-center leading-tight">
        <span className={cn("flex items-center gap-1.5 font-bold", compact ? "text-[13px]" : "text-[15px]")}>
          <OctagonX className="size-4" />
          {/* Compact: who stopped it is on the status island. */}
          {compact ? "已緊急停止" : "已緊急停止 · 由擁有者解除"}
        </span>
        <span className="text-[11px] text-white/75">
          {canRelease ? (
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3" />
              {holding ? "繼續按住…" : "長按 2 秒解除"}
            </span>
          ) : (
            `${by ?? "未知"} · ${at ? formatClock(at) : ""}`
          )}
        </span>
      </span>
    </button>
  );
}
