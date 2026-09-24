"use client";

import { BatteryCharging, Hand, Loader2, PauseCircle, PlayCircle, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LockedPanel, Segmented, Slider } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { getDogLink } from "@/link";
import { cn } from "@/lib/utils";
import { get, set, useStore } from "@/store";
import { rpc } from "@/store/controller";
import { effectiveSpeedCap, lockDetail, shapeAxis, stickLock } from "@/store/logic";

import { useCallSummary } from "../talk/CallLayer";
import { Joystick } from "./Joystick";
import { useAccess } from "../Console";

import type { Gait, Posture } from "@/proto/types";

const PREEMPT_REASON = "被操控搶佔";

/**
 * Acquire and release go through one queue. Rotating the phone unmounts the
 * landscape stick in the same commit the portrait panel mounts (and back): the
 * old one releases, the new one acquires — and with 50–150 ms of RPC jitter the
 * release could land second and silently hand the stick back.
 */
let teleopChain: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const next = teleopChain.then(fn, fn);
  teleopChain = next.catch(() => {});
  return next;
}

/**
 * Portrait is for setting the dog up — posture, gait, speed limit — with the map above it.
 * Driving is landscape: two thumbs, two sticks. So only landscape takes the stick; opening
 * this tab in portrait never takes control away from another phone.
 *
 * When the lock is about the connection (BleOnly, restarting, FAULT …) the status island
 * already says so: the controls just grey out. A lock the island does not explain — the
 * licence, my role — gets its panel.
 */
export function TeleopTab({ landscape = false }: { landscape?: boolean }) {
  const access = useAccess("teleop");
  const explained = access.locked && !/未授權|權限/.test(access.reason);
  if (access.locked && !explained)
    return (
      <div className={landscape ? "grid h-full place-items-center p-4" : "p-4"}>
        <div className={landscape ? "w-full max-w-sm" : ""}>
          <LockedPanel reason={access.reason} detail={lockDetail(access.reason)} />
        </div>
      </div>
    );
  if (!landscape) return <PortraitControls disabled={access.locked} />;
  if (access.locked) return <LandscapeControls held={false} />;
  return <Gate />;
}

// ── Portrait: set up, don't drive ───────────────────────────────────────────

function PortraitControls({ disabled }: { disabled: boolean }) {
  const userCap = useStore((s) => s.userSpeedCap);
  const globalCap = useStore((s) => s.device?.safety.speedLimit ?? 1.5);
  const pausedByUs = useStore((s) => s.telemetry?.run?.state === "paused" && s.telemetry.run.pausedReason === PREEMPT_REASON);

  return (
    <div className={cn("space-y-3 px-3 pt-1 pb-3 transition-opacity", disabled && "pointer-events-none opacity-50")} aria-disabled={disabled || undefined}>
      {pausedByUs && (
        <Button className="w-full" onClick={() => void rpc("mission.resume", undefined)}>
          <PlayCircle />
          恢復巡邏
        </Button>
      )}
      <PostureRow postures={POSTURES} />
      <GaitRow />
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground w-14 shrink-0 text-[12px]">速度上限</span>
        <Slider label="速度上限" min={0.2} max={1.5} step={0.1} value={userCap} cap={globalCap} onChange={(v) => set({ userSpeedCap: v })} />
        <span className="w-14 shrink-0 text-right text-[12px] font-semibold tabular-nums">{userCap.toFixed(1)} m/s</span>
      </div>
      <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-[12px]">
        <Smartphone className="size-3.5 rotate-90" />
        轉成橫式駕駛
      </p>
    </div>
  );
}

// ── Landscape: take the stick ───────────────────────────────────────────────

/**
 * Before the stick is live: the §7 接手與搶佔 rules and the §13 CHARGING
 * prompt. Each is a question the guard must answer, not a toast.
 */
type Phase = "check" | "preempt" | "no_preempt" | "charging" | "other" | "requesting" | "hold";

/** Which question (if any) stands between the guard and the stick, decided once on entry. */
function initialPhase(): Phase {
  const t = get().telemetry;
  if (!t) return "check";
  const mission = get().missions.find((m) => m.id === t.run?.missionId);
  if (t.teleopHolder && !t.teleopHolder.mine) return "other";
  if (t.run?.state === "running") return mission?.policy.allowTeleopPreempt === false ? "no_preempt" : "preempt";
  if (t.mode === "CHARGING") return "charging";
  return "check";
}

function Gate() {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const holder = useStore((s) => s.telemetry?.teleopHolder ?? null);
  const run = useStore((s) => s.telemetry?.run ?? null);
  const missions = useStore((s) => s.missions);

  const acquire = () =>
    queued(() => rpc("teleop.acquire", undefined)).then((r) => setPhase(r?.granted ? "hold" : "other"));

  // Entry with nothing to ask: take the stick straight away. Leaving hands it back — only if
  // it is still mine (another phone may have taken it meanwhile; releasing would drop theirs).
  const [asked] = useState(phase !== "check");
  useEffect(() => {
    if (!asked) void acquire();
    return () => {
      if (get().telemetry?.teleopHolder?.mine) void queued(() => getDogLink().gateway.rpc("teleop.release", undefined)).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Someone else took the stick while I held it: say who, and offer to ask for it back.
  const lost = phase === "hold" && !!holder && !holder.mine;
  const shown: Phase = lost ? "other" : phase;
  const mission = missions.find((m) => m.id === run?.missionId);

  if (shown === "hold") return <LandscapeControls held />;

  return (
    // The landscape control layer is click-through; this card opts back in.
    <div className="bg-background/80 pointer-events-auto absolute top-1/2 left-1/2 w-[360px] -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-2xl border p-4 backdrop-blur">
      {shown === "check" && (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" />
          取得操控權…
        </div>
      )}
      {shown === "preempt" && (
        <Prompt
          icon={<PauseCircle className="size-5" />}
          title="將暫停巡邏任務"
          body={`「${mission?.name ?? "任務"}」正在執行（${(run?.currentWp ?? 0) + 1}/${run?.totalWp ?? 0}）。開始操控會讓任務進入暫停，結束操控後可以恢復。`}
          confirm="暫停任務並操控"
          onConfirm={async () => {
            await rpc("mission.pause", { reason: PREEMPT_REASON });
            await acquire();
          }}
        />
      )}
      {shown === "no_preempt" && (
        <LockedPanel reason="此任務不允許操控搶佔" detail={`「${mission?.name ?? "任務"}」的策略設定為不可被操控打斷。需要時可以中止任務。`}>
          <Button variant="outline" className="mt-1" onClick={async () => { await rpc("mission.abort", undefined); await acquire(); }}>
            中止任務並操控
          </Button>
        </LockedPanel>
      )}
      {shown === "charging" && (
        <Prompt
          icon={<BatteryCharging className="size-5" />}
          title="充電中"
          body="開始操控會讓狗離開充電座並中斷充電。"
          confirm="中斷充電並操控"
          onConfirm={acquire}
        />
      )}
      {(shown === "other" || shown === "requesting") && (
        <Prompt
          icon={<Hand className="size-5" />}
          title={`${holder?.phone ?? "另一支手機"}（${holder?.role === "owner" ? "擁有者" : holder?.role === "viewer" ? "檢視者" : "操作員"}）正在操控`}
          body="同一時間只能有一支手機操控。請求接手後，對方 5 秒內沒有拒絕就會轉移給你。"
          confirm={shown === "requesting" ? "等待對方回應…" : "請求接手"}
          busy={shown === "requesting"}
          onConfirm={async () => {
            setPhase("requesting");
            const r = await rpc("teleop.request", undefined);
            if (r?.granted) await acquire();
            else setPhase("other");
          }}
        />
      )}
    </div>
  );
}

function Prompt({
  icon,
  title,
  body,
  confirm,
  onConfirm,
  busy,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  confirm: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
}) {
  const [pending, setPending] = useState(false);
  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="bg-primary/15 text-primary-accent mb-3 grid size-10 place-items-center rounded-xl">{icon}</div>
      <p className="font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">{body}</p>
      <Button
        className="mt-3 w-full"
        loading={pending || busy}
        onClick={async () => {
          setPending(true);
          try {
            await onConfirm();
          } finally {
            setPending(false);
          }
        }}
      >
        {confirm}
      </Button>
    </div>
  );
}

/**
 * §5 landscape, basic controls only: the two sticks under the thumbs, three posture keys
 * between them. Readings are in the status island (battery, RTT, speed); the speed limit
 * and gait are set in portrait. `held` = the stick is mine; otherwise the sticks are drawn
 * greyed and nothing is sent (the island says why).
 */
function LandscapeControls({ held }: { held: boolean }) {
  const t = useStore((s) => s.telemetry);
  const conn = useStore((s) => s.conn);
  const rtt = useStore((s) => s.rtt.level);
  const sticks = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const lastInput = useRef(0);
  const [idle, setIdle] = useState(false);

  const lock = held
    ? stickLock({ conn, rtt, mode: t?.mode ?? null, posture: t?.posture ?? null, mine: !!t?.teleopHolder?.mine })
    : "—";

  // §7: 50 Hz, every packet, even when the stick is centred — it is the heartbeat.
  useEffect(() => {
    if (!held) return;
    const link = getDogLink();
    const timer = setInterval(() => {
      const s = get();
      const l = stickLock({
        conn: s.conn,
        rtt: s.rtt.level,
        mode: s.telemetry?.mode ?? null,
        posture: s.telemetry?.posture ?? null,
        mine: !!s.telemetry?.teleopHolder?.mine,
      });
      const c = effectiveSpeedCap(s.userSpeedCap, s.device?.safety.speedLimit ?? 1.5, s.rtt.level);
      const k = sticks.current;
      if (l) return link.gateway.control.send({ vx: 0, vy: 0, wz: 0, pitch: 0 });
      link.gateway.control.send({
        vx: shapeAxis(k.ly) * c,
        vy: -shapeAxis(k.lx) * c * 0.6,
        wz: -shapeAxis(k.rx) * 1.4,
        pitch: shapeAxis(k.ry),
      });
    }, 20);
    return () => {
      clearInterval(timer);
      link.gateway.control.send({ vx: 0, vy: 0, wz: 0, pitch: 0 });
    };
  }, [held]);

  // §7 haptics: entering the red band.
  const prevRtt = useRef(rtt);
  useEffect(() => {
    if (rtt === "poor" && prevRtt.current !== "poor") navigator.vibrate?.([30, 30, 30]);
    prevRtt.current = rtt;
  }, [rtt]);

  // §7: after a preemption, 10 s without input asks whether to resume.
  const pausedByUs = t?.run?.state === "paused" && t.run.pausedReason === PREEMPT_REASON;
  useEffect(() => {
    if (!pausedByUs) return;
    lastInput.current = Date.now();
    const timer = setInterval(() => setIdle(Date.now() - lastInput.current > 10_000), 500);
    return () => clearInterval(timer);
  }, [pausedByUs]);

  const touched = (x: number, y: number) => {
    if (!x && !y) return;
    lastInput.current = Date.now();
    setIdle(false);
  };
  const onLeft = (x: number, y: number) => {
    sticks.current.lx = x;
    sticks.current.ly = y;
    touched(x, y);
  };
  const onRight = (x: number, y: number) => {
    sticks.current.rx = x;
    sticks.current.ry = y;
    touched(x, y);
  };

  const rttText = rtt === "good" ? "良好" : rtt === "fair" ? "偏慢 · 限速 0.5" : "訊號不足";

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="pointer-events-auto absolute bottom-3 left-4">
        <Joystick label="移動搖桿：前後左右" hint="前後 · 平移" onChange={onLeft} disabled={!!lock} />
      </div>
      <div className="pointer-events-auto absolute right-4 bottom-3">
        <Joystick label="轉向搖桿：轉向與相機俯仰" hint="轉向 · 俯仰" onChange={onRight} disabled={!!lock} />
      </div>
      <div className="pointer-events-auto absolute bottom-3 left-1/2 w-[260px] -translate-x-1/2 space-y-1.5">
        {pausedByUs && idle && (
          <Button className="w-full" onClick={() => void rpc("mission.resume", undefined)}>
            <PlayCircle />
            恢復巡邏
          </Button>
        )}
        <div className="bg-surface/85 rounded-xl border p-1.5 backdrop-blur">
          <PostureRow postures={POSTURES.filter((p) => p.id !== "lie")} disabled={!held} />
        </div>
      </div>
      {held && lock && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="bg-popover/95 rounded-lg border px-3 py-1.5 text-[13px] font-semibold shadow-lg">{lock}</span>
        </div>
      )}
      <span className="sr-only">連線品質：{rttText}</span>
    </div>
  );
}

const POSTURES: { id: Posture; label: string }[] = [
  { id: "stand", label: "站立" },
  { id: "sit", label: "坐下" },
  { id: "lie", label: "趴下" },
  { id: "recover", label: "恢復" },
];

const GAITS: { value: Gait; label: string }[] = [
  { value: "walk", label: "行走" },
  { value: "trot", label: "小跑" },
  { value: "stairs", label: "樓梯" },
];

/** §7: posture is an RPC with a pending state; disabled while moving. */
function PostureRow({ postures, disabled }: { postures: typeof POSTURES; disabled?: boolean }) {
  const posture = useStore((s) => s.telemetry?.posture);
  const moving = useStore((s) => (s.telemetry?.speed ?? 0) > 0.05);
  const blocked = useStore((s) => s.telemetry?.mode === "ESTOP" || s.telemetry?.mode === "FAULT");
  const [pending, setPending] = useState<Posture | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      {postures.map((p) => (
        <Button
          key={p.id}
          variant={posture === p.id ? "secondary" : "outline"}
          size="sm"
          className="h-9 flex-1 px-0"
          disabled={disabled || moving || blocked || pending !== null}
          loading={pending === p.id}
          onClick={async () => {
            setPending(p.id);
            const ok = await rpc("posture.set", { posture: p.id });
            setPending(null);
            if (ok !== null) navigator.vibrate?.(15);
          }}
        >
          {pending === p.id ? "" : p.label}
        </Button>
      ))}
    </div>
  );
}

function GaitRow() {
  const gait = useStore((s) => s.telemetry?.gait ?? "walk");
  const moving = useStore((s) => (s.telemetry?.speed ?? 0) > 0.05);
  const blocked = useStore((s) => s.telemetry?.mode === "ESTOP" || s.telemetry?.mode === "FAULT");
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-14 shrink-0 text-[12px]">步態</span>
      <Segmented value={gait} options={GAITS} disabled={moving || blocked} onChange={(g) => void rpc("gait.set", { gait: g })} className="flex-1" />
    </div>
  );
}

export function TeleopSummary() {
  const t = useStore((s) => s.telemetry);
  const call = useCallSummary();
  return (
    <span className="tabular-nums">
      RTT {t?.rttMs ?? "—"} ms · {(t?.speed ?? 0).toFixed(1)} m/s · {t?.gait ?? "walk"}
      {call}
    </span>
  );
}
