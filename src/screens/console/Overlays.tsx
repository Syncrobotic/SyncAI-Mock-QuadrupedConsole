"use client";

import { useState } from "react";
import { toast } from "@/lib/notify";
import { Camera, OctagonAlert, RefreshCw, SearchX, Smartphone, Sparkles } from "lucide-react";

import { Modal, Segmented } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { IS_MOCK } from "@/lib/env";
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
      <ConfirmRequest />
      <SnapshotViewer />
    </>
  );
}

/** Rendered inside the map area so it can never cover the E-Stop. */
export function FaultOverlay() {
  const fault = useStore((s) => (s.telemetry?.mode === "FAULT" ? s.telemetry.fault : null));
  const tab = useStore((s) => s.tab);
  const snap = useStore((s) => s.snap);
  // §13: FAULT keeps only the device page and E-Stop. The overlay covers the
  // map; the device tab at 90% sits over it when the guard needs it.
  if (!fault || (tab === "device" && snap === 2)) return null;
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-center overflow-y-auto bg-red-950/95 px-6 text-red-50">
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
      <Button className="mt-5" onClick={() => void retry()}>
        <RefreshCw />
        重新連線
      </Button>
    </div>
  );
}

function Approval() {
  const req = useStore((s) => s.approval);
  const [role, setRole] = useState<"operator" | "viewer">("operator");
  const answer = async (approve: boolean) => {
    if (!req?.ref) return;
    set({ approval: null });
    await rpc("device.approve", { phoneId: req.ref, approve, role });
    await refreshPhones();
    if (approve) toast.success(`已核准為${role === "operator" ? "操作員" : "檢視者"}`);
  };
  return (
    <Modal open={!!req} dismissable={false}>
      <div className="bg-primary/15 text-primary-accent mb-3 grid size-10 place-items-center rounded-xl">
        <Smartphone className="size-5" />
      </div>
      <h2 className="text-[15px] font-semibold">有手機請求加入</h2>
      <p className="text-muted-foreground mt-1">{req?.text}</p>
      <p className="mt-3 mb-1.5 text-[12px] font-medium">給它的角色</p>
      <Segmented
        value={role}
        options={[
          { value: "operator", label: "操作員" },
          { value: "viewer", label: "檢視者" },
        ]}
        onChange={setRole}
      />
      <p className="text-muted-foreground mt-1.5 text-[11px]">
        {role === "operator" ? "可以操控、排任務、通話；不能管理裝置、不能解除 E-Stop。" : "只能看地圖與影像，其他功能鎖定。"}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => void answer(false)}>
          拒絕
        </Button>
        <Button onClick={() => void answer(true)}>核准</Button>
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

/**
 * §4.4 confirm mode: a rule wants to send the dog and asks the phones first.
 * Same push-style dialog as the join request; the countdown and what happens
 * at zero are on the dialog, because "nobody answered" is itself a decision.
 */
function ConfirmRequest() {
  const confirms = useStore((s) => s.telemetry?.confirms);
  const canAnswer = useStore((s) => !!s.session?.scopes.includes("mission.rw"));
  const zones = useStore((s) => s.plan?.zones);
  const now = useNow(250);
  const req = canAnswer ? confirms?.[0] : undefined;
  const left = req ? Math.max(0, Math.ceil((req.expiresAt - now) / 1000)) : 0;
  const rules = useStore((s) => s.rules);
  const total = (req && rules.find((r) => r.id === req.ruleId)?.confirmTimeoutSec) || 30;
  const answer = (approve: boolean) => req && void rpc("rule.confirm", { activationId: req.activationId, approve });

  return (
    <Modal open={!!req} dismissable={false}>
      {req && (
        <>
          <div className="flex items-start gap-3">
            <span className="bg-severity-warning/15 text-severity-warning grid size-10 shrink-0 place-items-center rounded-xl">
              <Sparkles className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">{req.cause}</p>
              <p className="text-muted-foreground text-[12px]">
                規則「{req.ruleName}」要派狗去「{req.missionName}」
              </p>
            </div>
            {/* Countdown ring */}
            <span className="relative grid size-10 shrink-0 place-items-center">
              <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" className="text-muted" />
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={94.2} strokeDashoffset={94.2 * (1 - Math.min(1, left / total))} className="text-severity-warning transition-[stroke-dashoffset] duration-200" />
              </svg>
              <span className="text-[12px] font-bold tabular-nums">{left}</span>
            </span>
          </div>
          <div className="relative mt-3 grid aspect-video place-items-center overflow-hidden rounded-lg" style={{ background: "linear-gradient(135deg,#2a2350,#1b1d2a)" }}>
            <Camera className="size-7 text-white/35" />
            {req.detection && (
              <span className="absolute top-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white">
                {zones?.find((z) => z.id === req.detection!.zoneId)?.name} · 信心 {Math.round(req.detection.confidence * 100)}%
              </span>
            )}
            {IS_MOCK && <span className="absolute right-1.5 bottom-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[11px] text-white/70">MOCK · 偵測快照</span>}
          </div>
          <p className="text-muted-foreground mt-2 text-[12px]">
            {left} 秒內沒人回應會{req.onTimeout === "run" ? "自動派狗前往" : "取消"}。
            {confirms && confirms.length > 1 ? ` 還有 ${confirms.length - 1} 則等待確認。` : ""}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => answer(false)}>
              忽略
            </Button>
            <Button onClick={() => answer(true)}>派狗前往</Button>
          </div>
        </>
      )}
    </Modal>
  );
}
