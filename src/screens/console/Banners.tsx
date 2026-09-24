"use client";

import { Bluetooth, Loader2, RefreshCw, ShieldAlert, TriangleAlert, WifiOff } from "lucide-react";
import { useNow } from "@/hooks/use-now";

import { cn } from "@/lib/utils";
import { set, useStore } from "@/store";
import { retry } from "@/store/controller";

/**
 * The alerts of §13's error ladder, and the chips that float on the map.
 *
 * Alerts no longer get a strip of their own on the map: the highest-priority
 * `banner` alert is the status island's second line (with its action), and
 * the full list — advisories included — is in the island's details. The map
 * keeps only what is about the map itself (loading, the editor hint).
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

/** What is about the map itself: loading progress and the mission editor's hint. */
export function MapChips() {
  const mapLoaded = useStore((s) => s.mapLoaded);
  const mapTotal = useStore((s) => s.mapTotal);
  const cloud = useStore((s) => s.layers.cloud);
  const tab = useStore((s) => s.tab);
  const editor = useStore((s) => !!s.editor);
  const conn = useStore((s) => s.conn);
  const live = conn === "Online" || conn === "Degraded";
  const pct = mapTotal ? Math.round((mapLoaded / mapTotal) * 100) : 0;

  return (
    <div className="flex flex-wrap gap-1.5">
      {live && cloud && mapTotal > 0 && pct < 100 && (
        <Chip>
          <span className="bg-primary-accent size-1.5 animate-pulse rounded-full" />
          點雲載入 {pct}%
        </Chip>
      )}
      {live && mapTotal === 0 && <Chip>地圖載入中…</Chip>}
      {tab === "mission" && editor && <Chip>長按地圖放航點 · 拖曳航點移動</Chip>}
    </div>
  );
}

const TONES = {
  info: "",
  warn: "[&>span:first-child]:text-severity-warning border-severity-warning/40",
  bad: "[&>span:first-child]:text-status-error border-status-error/40",
};

/** One alert as a row in the island's details. */
export function AlertRow({ alert }: { alert: Alert }) {
  return (
    <div role="status" className={cn("bg-background/60 flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] font-medium", TONES[alert.tone])}>
      <span className="shrink-0">{alert.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{alert.text}</span>
        {alert.sub && <span className="text-muted-foreground line-clamp-2 block text-[11px] font-normal">{alert.sub}</span>}
      </span>
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

export { useNow };
