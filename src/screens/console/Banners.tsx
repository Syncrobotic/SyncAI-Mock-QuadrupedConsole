"use client";

import { Bluetooth, Loader2, RefreshCw, ShieldAlert, TriangleAlert, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { set, useStore } from "@/store";
import { retry } from "@/store/controller";

/**
 * The banner tier of §13's error ladder.
 *
 * 🔴 ONE banner at a time. They used to stack: on an SE in BleOnly the header
 * plus banners were 176px of a 253px map — 70% of the map gone, and the view
 * buttons underneath one. Now the highest-priority alert is the banner, the
 * rest are a "+N" pill that opens the status card, and advisories that do not
 * change what you can do right now (licence expiring) never take the map at
 * all — they are a dot on the header and a line in the status card.
 */

export interface Alert {
  id: string;
  tone: "info" | "warn" | "bad";
  /** `notice` = advisory: listed in the status card, never a banner. */
  kind: "banner" | "notice";
  icon: React.ReactNode;
  text: string;
  sub?: string;
  action?: { label: string; icon?: React.ReactNode; run: () => void };
}

export function useAlerts(): Alert[] {
  const conn = useStore((s) => s.conn);
  const rtt = useStore((s) => s.telemetry?.rttMs);
  const lastError = useStore((s) => s.lastError);
  const hasEndpoint = useStore((s) => !!s.credential?.endpoint);
  const restartingUntil = useStore((s) => s.restartingUntil);
  const licenseExpiresAt = useStore((s) => s.device?.licenseExpiresAt);
  const gatewayHealth = useStore((s) => s.gatewayHealth);
  const now = useNow(1000);

  const live = conn === "Online" || conn === "Degraded";
  const licenseDays = licenseExpiresAt ? Math.ceil((licenseExpiresAt - now) / 86_400_000) : null;
  const out: Alert[] = [];

  if (restartingUntil)
    out.push({
      id: "restart",
      tone: "info",
      kind: "banner",
      icon: <Loader2 className="size-4 animate-spin" />,
      text: `Gateway 重啟中 · 約 ${Math.max(0, Math.ceil((restartingUntil - now) / 1000))} 秒`,
      sub: "其他分頁暫時鎖定",
    });
  if (conn === "Unreachable")
    out.push({ id: "unreachable", tone: "bad", kind: "banner", icon: <WifiOff className="size-4" />, text: "找不到狗", sub: "藍牙與區網皆無回應", action: { label: "重試", icon: <RefreshCw className="size-3.5" />, run: () => void retry() } });
  if (conn === "BleOnly" && !restartingUntil)
    out.push({
      id: "ble",
      tone: "info",
      kind: "banner",
      icon: <Bluetooth className="size-4" />,
      text: hasEndpoint ? "未連上 Gateway · 只剩藍牙" : "尚未設定 Wi-Fi · 只剩藍牙",
      sub: gatewayHealth.state === "down" ? (gatewayHealth.lastError ?? "Gateway down") : (lastError ?? "裝置頁與 E-Stop 仍可用"),
      action: hasEndpoint
        ? { label: "重試", icon: <RefreshCw className="size-3.5" />, run: () => void retry() }
        : { label: "設定 Wi-Fi", run: () => set({ tab: "device", snap: 1 }) },
    });
  if (conn === "Degraded")
    out.push({ id: "degraded", tone: "warn", kind: "banner", icon: <TriangleAlert className="size-4" />, text: `連線不穩 · RTT ${rtt ?? "—"} ms`, sub: "操控已鎖定，恢復 2 秒後解鎖" });
  if (conn === "Connecting") out.push({ id: "connecting", tone: "info", kind: "banner", icon: <Loader2 className="size-4 animate-spin" />, text: "連線中…" });
  if (live && licenseDays !== null && licenseDays <= 7)
    out.push({
      id: "license",
      tone: "warn",
      kind: "notice",
      icon: <ShieldAlert className="size-4" />,
      text: `License 將於 ${licenseDays} 天後到期`,
      sub: "到期後相關功能會鎖定",
      action: { label: "查看", run: () => set({ tab: "device", snap: 1, statusOpen: false }) },
    });
  return out;
}

export function Banners() {
  const alerts = useAlerts();
  const mapLoaded = useStore((s) => s.mapLoaded);
  const mapTotal = useStore((s) => s.mapTotal);
  const cloud = useStore((s) => s.layers.cloud);
  const tab = useStore((s) => s.tab);
  const editor = useStore((s) => !!s.editor);
  const conn = useStore((s) => s.conn);
  const live = conn === "Online" || conn === "Degraded";
  const pct = mapTotal ? Math.round((mapLoaded / mapTotal) * 100) : 0;

  const banners = alerts.filter((a) => a.kind === "banner");
  const top = banners[0];
  const more = alerts.length - (top ? 1 : 0);

  return (
    <>
      {top && <AlertRow alert={top} more={more} />}
      <div className="flex flex-wrap gap-1.5">
        {!top && more > 0 && (
          <button onClick={() => set({ statusOpen: true })} className="pointer-events-auto relative cursor-pointer after:absolute after:-inset-2 after:content-['']">
            <Chip>
              <span className="bg-severity-warning size-1.5 rounded-full" />
              {more} 則提醒
            </Chip>
          </button>
        )}
        {live && cloud && mapTotal > 0 && pct < 100 && (
          <Chip>
            <span className="bg-primary-accent size-1.5 animate-pulse rounded-full" />
            點雲載入 {pct}%
          </Chip>
        )}
        {live && mapTotal === 0 && <Chip>地圖載入中…</Chip>}
        {tab === "mission" && editor && <Chip>長按地圖放航點 · 拖曳航點移動</Chip>}
      </div>
    </>
  );
}

const TONES = {
  info: "",
  warn: "[&>span:first-child]:text-severity-warning border-severity-warning/40",
  bad: "[&>span:first-child]:text-status-error border-status-error/40",
};

export function AlertRow({ alert, more = 0, flat }: { alert: Alert; more?: number; flat?: boolean }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] font-medium",
        flat ? "bg-background/60" : "bg-surface/90 pointer-events-auto shadow-lg backdrop-blur",
        TONES[alert.tone]
      )}
    >
      <span className="shrink-0">{alert.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{alert.text}</span>
        {/* One line on the map (height is what the map cannot spare); the
            status card shows it in full. */}
        {alert.sub && <span className={cn("text-muted-foreground block text-[11px] font-normal", flat ? "line-clamp-2" : "truncate")}>{alert.sub}</span>}
      </span>
      {more > 0 && !flat && (
        <button onClick={() => set({ statusOpen: true })} className="bg-secondary relative h-7 shrink-0 cursor-pointer rounded-md border px-2 text-[11px] font-semibold after:absolute after:-inset-2 after:content-['']">
          +{more}
        </button>
      )}
      {alert.action && (
        <button
          onClick={alert.action.run}
          className="bg-secondary hover:bg-accent relative flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-[12px] font-semibold after:absolute after:-inset-y-2 after:-inset-x-1 after:content-['']"
        >
          {alert.action.icon}
          {alert.action.label}
        </button>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-surface/85 text-foreground flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium shadow-sm backdrop-blur">
      {children}
    </span>
  );
}

export function useNow(interval: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}
