"use client";

import { Camera, OctagonAlert, RefreshCw, SearchX, Smartphone } from "lucide-react";

import { Modal } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/utils";
import { set, useStore } from "@/store";
import { refreshPhones, retry, rpc } from "@/store/controller";

import { useNow } from "./Banners";

/**
 * The full-screen tier of §13 (FAULT, Unreachable > 30 s) and the one push-
 * style dialog in the product (§4 第二支手機加入: the Owner's approval prompt).
 * `revoked` is handled by the onboarding welcome screen, which it returns to.
 */
export function Overlays() {
  return (
    <>
      <Unreachable />
      <Approval />
      <SnapshotViewer />
    </>
  );
}

/** Rendered inside the map area so it can never cover the E-Stop. */
export function FaultOverlay({ bottom }: { bottom: number }) {
  const fault = useStore((s) => (s.telemetry?.mode === "FAULT" ? s.telemetry.fault : null));
  const tab = useStore((s) => s.tab);
  const snap = useStore((s) => s.snap);
  // §13: FAULT keeps only the device page and E-Stop. The overlay covers the
  // map; the device tab at 90% sits over it when the guard needs it.
  if (!fault || (tab === "device" && snap === 2)) return null;
  return (
    <div className="absolute inset-x-0 top-0 z-30 flex flex-col justify-center overflow-y-auto bg-red-950/95 px-6 text-red-50" style={{ bottom }}>
      <OctagonAlert className="mb-3 size-10 text-red-300" />
      <p className="font-mono text-sm text-red-300">FAULT {fault.code}</p>
      <h2 className="mt-1 text-2xl font-bold">{fault.message}</h2>
      <p className="mt-3 text-[14px] leading-relaxed text-red-100/85">{fault.advice}</p>
      <div className="mt-6 flex gap-2">
        <Button variant="secondary" onClick={() => set({ tab: "device", snap: 2 })}>
          查看裝置頁
        </Button>
      </div>
      <p className="mt-4 text-xs text-red-200/60">E-Stop 仍然可用。</p>
    </div>
  );
}

function Unreachable() {
  const conn = useStore((s) => s.conn);
  const since = useStore((s) => s.connSince);
  const now = useNow(1000);
  if (conn !== "Unreachable" || now - since < 30_000) return null;
  return (
    <div className="bg-background absolute inset-0 z-40 flex flex-col justify-center px-6">
      <SearchX className="text-muted-foreground mb-4 size-10" />
      <h2 className="text-2xl font-bold">找不到狗</h2>
      <p className="text-muted-foreground mt-2 text-[14px]">已超過 30 秒，藍牙與區網都沒有回應。</p>
      <ul className="text-muted-foreground mt-4 list-disc space-y-1 pl-5 text-[14px]">
        <li>狗是否開機、燈號是否正常</li>
        <li>手機與狗距離 5 m 內（藍牙）</li>
        <li>手機是否連在同一個 Wi-Fi</li>
      </ul>
      <Button className="mt-6 h-12" onClick={() => void retry()}>
        <RefreshCw />
        重新連線
      </Button>
    </div>
  );
}

function Approval() {
  const req = useStore((s) => s.approval);
  const answer = async (approve: boolean) => {
    if (!req?.ref) return;
    set({ approval: null });
    await rpc("device.approve", { phoneId: req.ref, approve });
    await refreshPhones();
  };
  return (
    <Modal open={!!req} dismissable={false}>
      <div className="bg-primary/15 text-primary-accent mb-3 grid size-11 place-items-center rounded-xl">
        <Smartphone className="size-5" />
      </div>
      <h2 className="text-lg font-semibold">有手機請求加入</h2>
      <p className="text-muted-foreground mt-1 text-[14px]">{req?.text}。核准後它可以操控、排任務與通話，但不能管理裝置。</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" onClick={() => void answer(false)}>
          拒絕
        </Button>
        <Button className="h-11" onClick={() => void answer(true)}>
          核准為 Operator
        </Button>
      </div>
    </Modal>
  );
}

function SnapshotViewer() {
  const snap = useStore((s) => s.snapshotViewer);
  return (
    <Modal open={!!snap} onClose={() => set({ snapshotViewer: null })} className="p-0">
      {snap && (
        <div>
          <div className="relative grid aspect-video place-items-center rounded-t-2xl" style={{ background: "linear-gradient(135deg,#2a2350,#1b1d2a)" }}>
            <Camera className="size-10 text-white/40" />
            <span className="absolute bottom-2 left-2 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-white">MOCK SNAPSHOT</span>
          </div>
          <div className="p-4">
            <p className="font-semibold">航點 {snap.wp + 1} 快照</p>
            <p className="text-muted-foreground text-sm">{formatClock(snap.at)} · 已存至狗端 artifacts</p>
          </div>
        </div>
      )}
    </Modal>
  );
}
