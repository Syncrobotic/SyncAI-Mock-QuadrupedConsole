"use client";

import { Bluetooth, Loader2, RefreshCw, ShieldAlert, TriangleAlert, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { set, useStore } from "@/store";
import { retry } from "@/store/controller";

/**
 * The banner tier of §13's error ladder — stays until the state changes —
 * plus the map's own status chips, stacked in one column so they never
 * overlap each other.
 */
export function Banners() {
  const conn = useStore((s) => s.conn);
  const rtt = useStore((s) => s.telemetry?.rttMs);
  const lastError = useStore((s) => s.lastError);
  const hasEndpoint = useStore((s) => !!s.credential?.endpoint);
  const restartingUntil = useStore((s) => s.restartingUntil);
  const licenseExpiresAt = useStore((s) => s.device?.licenseExpiresAt);
  const gatewayHealth = useStore((s) => s.gatewayHealth);
  const mapLoaded = useStore((s) => s.mapLoaded);
  const mapTotal = useStore((s) => s.mapTotal);
  const tab = useStore((s) => s.tab);
  const editor = useStore((s) => !!s.editor);
  const now = useNow(1000);

  const live = conn === "Online" || conn === "Degraded";
  const licenseDays = licenseExpiresAt ? Math.ceil((licenseExpiresAt - now) / 86_400_000) : null;
  const pct = mapTotal ? Math.round((mapLoaded / mapTotal) * 100) : 0;

  return (
    <>
      {restartingUntil && (
        <Banner tone="info" icon={<Loader2 className="size-4 animate-spin" />}>
          Gateway 重啟中 · 約 {Math.max(0, Math.ceil((restartingUntil - now) / 1000))} 秒 · 其他分頁暫時鎖定
        </Banner>
      )}
      {conn === "Degraded" && (
        <Banner tone="warn" icon={<TriangleAlert className="size-4" />}>
          連線不穩 · RTT {rtt ?? "—"} ms · 操控已鎖定
        </Banner>
      )}
      {conn === "Connecting" && (
        <Banner tone="info" icon={<Loader2 className="size-4 animate-spin" />}>
          連線中…
        </Banner>
      )}
      {conn === "BleOnly" && !restartingUntil && (
        <Banner
          tone="info"
          icon={<Bluetooth className="size-4" />}
          action={
            hasEndpoint ? (
              <button onClick={() => void retry()} className="pointer-events-auto bg-secondary hover:bg-accent flex h-8 cursor-pointer items-center gap-1 rounded-md border px-2 text-[12px] font-semibold">
                <RefreshCw className="size-3.5" />
                重試
              </button>
            ) : (
              <button onClick={() => set({ tab: "device", snap: 2 })} className="pointer-events-auto bg-secondary hover:bg-accent h-8 cursor-pointer rounded-md border px-2 text-[12px] font-semibold">
                設定 Wi-Fi
              </button>
            )
          }
        >
          <span className="block">{hasEndpoint ? "未連上 Gateway · 只剩藍牙" : "尚未設定 Wi-Fi · 只剩藍牙"}</span>
          <span className="block text-[11px] opacity-75">
            {gatewayHealth.state === "down" ? `Gateway ${gatewayHealth.state} · ${gatewayHealth.lastError ?? ""}` : (lastError ?? "裝置頁與 E-Stop 仍可用")}
          </span>
        </Banner>
      )}
      {conn === "Unreachable" && (
        <Banner tone="bad" icon={<WifiOff className="size-4" />}>
          找不到狗 · 藍牙與區網皆無回應
        </Banner>
      )}
      {live && licenseDays !== null && licenseDays <= 7 && (
        <Banner tone="warn" icon={<ShieldAlert className="size-4" />}>
          License 將於 {licenseDays} 天後到期
        </Banner>
      )}

      {/* Map status chips */}
      <div className="flex flex-wrap gap-1.5">
        {!live && mapTotal > 0 && <Chip>離線 · 顯示最後快取</Chip>}
        {live && mapTotal > 0 && pct < 100 && (
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
  info: "bg-surface/90 text-foreground",
  warn: "bg-surface/90 text-foreground [&>span:first-child]:text-severity-warning border-severity-warning/40",
  bad: "bg-surface/90 text-foreground [&>span:first-child]:text-status-error border-status-error/40",
};

function Banner({ tone, icon, action, children }: { tone: keyof typeof TONES; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="status" className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] font-medium shadow-lg backdrop-blur", TONES[tone])}>
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
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
