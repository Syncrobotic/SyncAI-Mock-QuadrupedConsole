"use client";

import { Bluetooth, OctagonX, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { cn, formatClock } from "@/lib/utils";
import { useStore } from "@/store";
import { estop, releaseEstop } from "@/store/controller";
import { estopRoute } from "@/store/logic";

const HOLD_MS = 2000;

/**
 * §5 E-Stop: full width, 56 pt, red, never covered. One tap, no confirm —
 * a guard's speed matters more than an accidental stop. Rendered OUTSIDE the
 * tab error boundary (§14) so a crashing tab cannot take it down.
 */
export function EStopBar() {
  const conn = useStore((s) => s.conn);
  const mode = useStore((s) => s.telemetry?.mode);
  const estopInfo = useStore((s) => s.telemetry?.estop ?? null);
  const isOwner = useStore((s) => !!s.session?.scopes.includes("admin"));
  const route = estopRoute(conn);
  const [sending, setSending] = useState(false);

  if (mode === "ESTOP" && route === "ws") return <Stopped by={estopInfo?.by} at={estopInfo?.at} canRelease={isOwner} />;

  const disabled = route === "disabled";

  return (
    <button
      disabled={disabled || sending}
      onClick={async () => {
        setSending(true);
        try {
          await estop();
          if (route === "ble") toast.warning("E-Stop 已經由藍牙送出");
        } finally {
          setSending(false);
        }
      }}
      aria-label={route === "ble" ? "緊急停止（經由藍牙）" : "緊急停止"}
      className={cn(
        "relative flex h-14 w-full shrink-0 cursor-pointer items-center justify-center gap-2.5 overflow-hidden rounded-xl text-[17px] font-black tracking-[0.18em] text-white uppercase select-none",
        "from-estop to-estop-pressed bg-linear-to-b shadow-lg ring-1 shadow-red-900/30 ring-white/15 transition-[filter,transform] duration-100 hover:brightness-110 active:scale-[0.99] active:brightness-90",
        "focus-visible:ring-4 focus-visible:ring-white/60 focus-visible:outline-none",
        disabled && "bg-muted text-muted-foreground cursor-not-allowed bg-none shadow-none ring-0"
      )}
    >
      {!disabled && <span aria-hidden className="absolute inset-x-6 top-0 h-px bg-linear-to-r from-transparent via-white/50 to-transparent" />}
      <OctagonX className="size-6" strokeWidth={2.5} />
      E-STOP
      {route === "ble" && (
        <span className="absolute right-3 flex items-center gap-1 rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal normal-case">
          <Bluetooth className="size-3" />
          經藍牙
        </span>
      )}
      {disabled && <span className="absolute right-3 text-[10px] font-semibold tracking-normal normal-case">連不到狗</span>}
    </button>
  );
}

function Stopped({ by, at, canRelease }: { by?: string; at?: number; canRelease: boolean }) {
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
      aria-label={canRelease ? "長按 2 秒解除緊急停止" : "已緊急停止，需由 Owner 解除"}
      className="bg-estop-pressed ring-estop/60 relative flex h-14 w-full shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-xl text-white ring-2 select-none disabled:cursor-default"
    >
      {holding && (
        <span
          aria-hidden
          className="absolute inset-0 origin-left bg-white/25"
          style={{ animation: `hold-fill ${HOLD_MS}ms linear forwards` }}
        />
      )}
      <span className="relative flex flex-col items-center leading-tight">
        <span className="flex items-center gap-1.5 text-[15px] font-bold">
          <OctagonX className="size-4" />
          已緊急停止 · 由 Owner 解除
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
