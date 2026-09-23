"use client";

import { AnimatePresence, m } from "framer-motion";
import { Battery, BatteryCharging, BatteryLow, BatteryMedium, Bluetooth, ChevronDown, Radio } from "lucide-react";

import { cn, formatClock } from "@/lib/utils";
import { ROLE_LABEL } from "@/proto/types";
import { useStore } from "@/store";
import { CONN_LABEL, MODE_LABEL, rawRttLevel } from "@/store/logic";

/**
 * The status strip (§5). Built on the dashboard's dark plate — the same
 * surface as its command strip, for the same reason: it is read at a glance,
 * and colour appears only when a reading is bad. "78%" stays white; 18% goes
 * red. RTT is the one exception the spec asks for (three bands, with text so
 * colour is never the only carrier — §14 可存取性).
 */
export function StatusBar() {
  const t = useStore((s) => s.telemetry);
  const conn = useStore((s) => s.conn);
  const role = useStore((s) => s.session?.role ?? s.credential?.role ?? null);
  const open = useStore((s) => s.statusOpen);
  const rttLevel = useStore((s) => s.rtt.level);
  const live = conn === "Online" || conn === "Degraded";

  const battery = t?.battery ?? null;
  const BatteryIcon = t?.charging ? BatteryCharging : battery === null ? Battery : battery < 20 ? BatteryLow : BatteryMedium;
  const batteryTone = battery === null ? "text-white/50" : battery < 20 ? "text-red-400" : battery < 35 ? "text-amber-300" : "text-white";

  const rtt = t?.rttMs;
  const level = rtt !== undefined ? rawRttLevel(rtt) : null;
  const rttTone = !live ? "text-white/50" : rttLevel === "poor" ? "text-red-400" : rttLevel === "fair" ? "text-amber-300" : "text-white";
  const bars = level === "good" ? 3 : level === "fair" ? 2 : 1;

  const mode = t?.mode ?? null;
  const modeTone =
    mode === "ESTOP" || mode === "FAULT"
      ? "bg-red-500/20 text-red-300 ring-red-400/40"
      : mode === "PAUSED"
        ? "bg-amber-400/15 text-amber-200 ring-amber-300/30"
        : "bg-white/8 text-white/85 ring-white/10";

  return (
    <div className="bg-plate relative z-30 shrink-0 text-white">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-violet-500/50 to-transparent" />
      <button
        onClick={() => useStore.setState({ statusOpen: !open })}
        aria-expanded={open}
        className="flex h-12 w-full cursor-pointer items-center gap-3 px-3.5 text-left focus-visible:ring-2 focus-visible:ring-violet-400/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        <span className={cn("flex items-center gap-1 text-[13px] font-semibold tabular-nums", batteryTone)}>
          <BatteryIcon className="size-4" />
          {battery !== null ? `${Math.round(battery)}%` : "—"}
        </span>

        <span className={cn("flex items-center gap-1.5 text-[13px] font-semibold tabular-nums", rttTone)}>
          {live ? (
            <span aria-hidden className="flex h-3 items-end gap-[2px]">
              {[1, 2, 3].map((b) => (
                <span
                  key={b}
                  className={cn(
                    "w-[3px] rounded-[1px]",
                    b <= bars ? (level === "good" ? "bg-emerald-400" : level === "fair" ? "bg-amber-300" : "bg-red-400") : "bg-white/20"
                  )}
                  style={{ height: `${b * 4}px` }}
                />
              ))}
            </span>
          ) : conn === "BleOnly" ? (
            <Bluetooth className="size-3.5" />
          ) : (
            <Radio className="size-3.5" />
          )}
          {live && rtt !== undefined ? `${rtt}ms` : CONN_LABEL[conn]}
        </span>

        <span className="ml-auto flex items-center gap-2">
          {mode && live && <span className={cn("rounded-md px-2 py-0.5 text-[12px] font-semibold ring-1", modeTone)}>{MODE_LABEL[mode]}</span>}
          {role && (
            <span className="flex items-center gap-1 text-[12px] text-white/70">
              <span className="size-1.5 rounded-full bg-violet-300" />
              {ROLE_LABEL[role]}
            </span>
          )}
          <ChevronDown className={cn("size-4 text-white/40 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      <AnimatePresence>{open && <Details />}</AnimatePresence>
    </div>
  );
}

function Details() {
  const t = useStore((s) => s.telemetry);
  const conn = useStore((s) => s.conn);
  const session = useStore((s) => s.session);
  const cred = useStore((s) => s.credential);
  const device = useStore((s) => s.device);
  const events = useStore((s) => s.events);
  const lastError = useStore((s) => s.lastError);
  const channel = conn === "Online" || conn === "Degraded" ? "WS（TLS pinned）" : conn === "BleOnly" ? "BLE" : "—";

  return (
    <m.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className="bg-plate absolute inset-x-0 top-12 border-t border-white/6 px-3.5 pt-2 pb-3.5 shadow-2xl"
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
        <Item k="通道" v={channel} />
        <Item k="狀態" v={`${CONN_LABEL[conn]} · ${conn}`} />
        <Item k="端點" v={cred?.endpoint ? `${cred.endpoint.ip}:${cred.endpoint.port}` : "—"} />
        <Item k="JWT 到期" v={session ? formatClock(session.jwtExpiresAt) : "—"} />
        <Item k="小腦" v={device?.versions.cerebellum ?? "—"} />
        <Item k="Gateway" v={device?.versions.gateway ?? "—"} />
        <Item k="電量預估" v={t ? `約 ${t.batteryMinutes} 分鐘` : "—"} />
        <Item k="最近錯誤" v={lastError ?? "—"} />
      </dl>
      <p className="mt-3 mb-1.5 text-[10px] tracking-wider text-white/40 uppercase">最近 5 條系統事件</p>
      <ul className="space-y-1">
        {events.slice(0, 5).map((e) => (
          <li key={e.id} className="flex gap-2 text-[12px]">
            <span className="shrink-0 text-white/40 tabular-nums">{formatClock(e.at)}</span>
            <span className={cn("truncate", e.level === "critical" ? "text-red-300" : e.level === "warning" ? "text-amber-200" : "text-white/80")}>{e.text}</span>
          </li>
        ))}
        {events.length === 0 && <li className="text-[12px] text-white/40">還沒有事件</li>}
      </ul>
    </m.div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] tracking-wide text-white/40 uppercase">{k}</dt>
      <dd className="truncate text-white/90 tabular-nums">{v}</dd>
    </div>
  );
}
