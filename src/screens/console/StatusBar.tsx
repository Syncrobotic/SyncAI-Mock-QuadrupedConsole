"use client";

import { AnimatePresence, m } from "framer-motion";
import { BatteryCharging, BatteryLow, BatteryMedium, Bluetooth, ChevronDown, Dog, Radio } from "lucide-react";

import { IconPlate } from "@/components/kit";
import { cn, formatClock } from "@/lib/utils";
import { ROLE_LABEL } from "@/proto/types";
import { useStore } from "@/store";
import { CONN_LABEL, MODE_LABEL, rawRttLevel } from "@/store/logic";

import { AlertRow, useAlerts } from "./Banners";

/**
 * The status strip of §5, drawn as the dashboard's `/map` corner header: the
 * avatar / title / subtitle triple on a blurred surface card, floating on the
 * canvas rather than taking a band from it.
 *
 * Colour rule from the dashboard's command strip: a reading is neutral until
 * it is bad. 78% battery is plain text; 18% is red. RTT keeps its three bars
 * because §7 asks for bands — with the number beside them, so colour is never
 * the only carrier (§14).
 */
export function DogHeader() {
  const t = useStore((s) => s.telemetry);
  const conn = useStore((s) => s.conn);
  const role = useStore((s) => s.session?.role ?? s.credential?.role ?? null);
  const name = useStore((s) => s.device?.name ?? s.credential?.dogName ?? "SyncAI-Dog");
  const open = useStore((s) => s.statusOpen);
  const rttLevel = useStore((s) => s.rtt.level);
  const live = conn === "Online" || conn === "Degraded";

  const mode = live ? (t?.mode ?? null) : null;
  const modeBad = mode === "ESTOP" || mode === "FAULT";
  const subtitle = [mode ? MODE_LABEL[mode] : CONN_LABEL[conn], role ? ROLE_LABEL[role] : null].filter(Boolean).join(" · ");

  const battery = t?.battery ?? null;
  const BatteryIcon = t?.charging ? BatteryCharging : battery !== null && battery < 20 ? BatteryLow : BatteryMedium;
  const batteryTone = battery === null ? "text-muted-foreground" : battery < 20 ? "text-status-error" : battery < 35 ? "text-severity-warning" : "text-foreground";

  const rtt = t?.rttMs;
  const bars = rtt === undefined ? 0 : rawRttLevel(rtt) === "good" ? 3 : rawRttLevel(rtt) === "fair" ? 2 : 1;
  const rttTone = !live ? "text-muted-foreground" : rttLevel === "poor" ? "text-status-error" : rttLevel === "fair" ? "text-severity-warning" : "text-foreground";
  const barTone = rttLevel === "poor" ? "bg-status-error" : rttLevel === "fair" ? "bg-severity-warning" : "bg-status-ok";

  const snap = useStore((s) => s.snap);
  const notices = useAlerts().filter((a) => a.kind === "notice").length;
  // With the sheet at 90% the map is collapsed to this header; details need
  // room, so opening them brings the sheet down to 50% first.
  const toggle = () => useStore.setState(snap === 2 && !open ? { statusOpen: true, snap: 1 } : { statusOpen: !open });

  return (
    <div className="pointer-events-auto flex min-h-0 flex-col">
      <div className="flex items-stretch gap-1.5">
        <button
          onClick={toggle}
          aria-expanded={open}
          className="bg-surface/85 hover:bg-surface flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl border px-2 py-1.5 text-left shadow-sm backdrop-blur transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        >
          <IconPlate icon={Dog} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-tight font-semibold">{name}</span>
            <span className={cn("block truncate text-[11px] leading-tight", modeBad ? "text-status-error font-semibold" : mode === "PAUSED" ? "text-severity-warning" : "text-muted-foreground")}>
              {subtitle}
            </span>
          </span>
          <span className="relative shrink-0">
            <ChevronDown className={cn("text-muted-foreground size-4 transition-transform", open && "rotate-180")} />
            {notices > 0 && !open && <span aria-label={`${notices} 則提醒`} className="bg-severity-warning ring-surface absolute -top-1 -right-1 size-2 rounded-full ring-2" />}
          </span>
        </button>

        <button
          onClick={toggle}
          className="bg-surface/85 hover:bg-surface flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 shadow-sm backdrop-blur transition-colors"
          aria-label="電量與連線"
        >
          <span className={cn("flex items-center gap-1 text-[12px] font-semibold tabular-nums", batteryTone)}>
            <BatteryIcon className="size-4" />
            {battery !== null ? `${Math.round(battery)}%` : "—"}
          </span>
          <span className={cn("flex items-center gap-1.5 text-[12px] font-semibold tabular-nums", rttTone)}>
            {live ? (
              <span aria-hidden className="flex h-3 items-end gap-[2px]">
                {[1, 2, 3].map((b) => (
                  <span key={b} className={cn("w-[3px] rounded-[1px]", b <= bars ? barTone : "bg-muted-foreground/25")} style={{ height: b * 4 }} />
                ))}
              </span>
            ) : conn === "BleOnly" ? (
              <Bluetooth className="size-3.5" />
            ) : (
              <Radio className="size-3.5" />
            )}
            {live && rtt !== undefined ? rtt : "—"}
          </span>
        </button>
      </div>

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
  const alerts = useAlerts();
  const channel = conn === "Online" || conn === "Degraded" ? "WS · TLS pinned" : conn === "BleOnly" ? "BLE" : "—";

  return (
    <m.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="bg-popover/95 mt-1.5 min-h-0 overflow-y-auto overscroll-contain rounded-xl border p-3 shadow-xl backdrop-blur"
    >
      {alerts.length > 0 && (
        <div className="mb-3 space-y-1.5 border-b pb-3">
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} flat />
          ))}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
        <Item k="通道" v={channel} />
        <Item k="狀態" v={`${CONN_LABEL[conn]} · ${conn}`} />
        <Item k="端點" v={cred?.endpoint ? `${cred.endpoint.ip}:${cred.endpoint.port}` : "—"} />
        <Item k="JWT 到期" v={session ? formatClock(session.jwtExpiresAt) : "—"} />
        <Item k="小腦" v={device?.versions.cerebellum ?? "—"} />
        <Item k="Gateway" v={device?.versions.gateway ?? "—"} />
        <Item k="電量預估" v={t ? `約 ${t.batteryMinutes} 分鐘` : "—"} />
        <Item k="最近錯誤" v={lastError ?? "—"} />
      </dl>
      <div className="mt-3 border-t pt-2.5">
        <p className="text-muted-foreground mb-1.5 text-[11px] font-medium">最近 5 條系統事件</p>
        <ul className="space-y-1">
          {events.slice(0, 5).map((e) => (
            <li key={e.id} className="flex gap-2 text-[12px]">
              <span className="text-muted-foreground shrink-0 tabular-nums">{formatClock(e.at)}</span>
              <span className={cn("truncate", e.level === "critical" ? "text-status-error" : e.level === "warning" ? "text-severity-warning" : "")}>{e.text}</span>
            </li>
          ))}
          {events.length === 0 && <li className="text-muted-foreground text-[12px]">還沒有事件</li>}
        </ul>
      </div>
    </m.div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-[11px]">{k}</dt>
      <dd className="truncate font-medium tabular-nums">{v}</dd>
    </div>
  );
}
