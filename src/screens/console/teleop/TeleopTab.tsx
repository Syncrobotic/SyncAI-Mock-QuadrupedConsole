"use client";

import { BatteryCharging, Hand, Loader2, PauseCircle, PlayCircle, Smartphone } from "lucide-react";
import { AnimatePresence, m } from "framer-motion";
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
  const pausedByUs = useStore(
    (s) => s.telemetry?.run?.state === "paused" && s.telemetry.run.pausedReason === PREEMPT_REASON
  );
  const running = useStore((s) => s.telemetry?.run?.state === "running");

  return (
    <div className="relative">
      <div
        inert={running}
        className={cn(
          "space-y-3 px-3 pt-1 pb-3 transition-opacity",
          disabled && "pointer-events-none opacity-50"
        )}
        aria-disabled={disabled || undefined}
      >
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
          <Slider
            label="速度上限"
            min={0.2}
            max={1.5}
            step={0.1}
            value={userCap}
            cap={globalCap}
            onChange={(v) => set({ userSpeedCap: v })}
          />
          <span className="w-14 shrink-0 text-right text-[12px] font-semibold tabular-nums">
            {userCap.toFixed(1)} m/s
          </span>
        </div>
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-[12px]">
          <Smartphone className="size-3.5 rotate-90" />
          轉成橫式駕駛
        </p>
      </div>
      <AnimatePresence>{running && <MissionOverlay />}</AnimatePresence>
    </div>
  );
}

/**
 * A mission is running: the controls would fight it, so they are covered by what is going on
 * and the two ways forward — pause it and take over, or go look at it. Gone once it pauses
 * (then 恢復巡邏 is on the panel) or ends.
 */
function MissionOverlay() {
  const run = useStore((s) => s.telemetry!.run!);
  const mission = useStore((s) => s.missions.find((m) => m.id === s.telemetry?.run?.missionId));
  const canPreempt = mission?.policy.allowTeleopPreempt !== false;
  const left = `${Math.floor(run.etaSec / 60)}:${String(Math.round(run.etaSec % 60)).padStart(2, "0")}`;
  return (
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="bg-surface/85 absolute inset-0 grid place-items-center px-3 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm space-y-2.5 text-center">
        <div>
          <p className="text-[14px] font-semibold">
            {mission?.kind === "response" ? "出動中" : "巡邏中"}：{mission?.name ?? "任務"}
          </p>
          <p className="text-muted-foreground text-[12px] tabular-nums">
            航點 {Math.min(run.currentWp + 1, run.totalWp)}/{run.totalWp} · 剩 {left}
          </p>
        </div>
        <div className={cn("grid gap-2", canPreempt ? "grid-cols-2" : "grid-cols-1")}>
          {canPreempt && (
            <Button onClick={() => void rpc("mission.pause", { reason: PREEMPT_REASON })}>
              <PauseCircle />
              暫停並操控
            </Button>
          )}
          <Button variant="secondary" onClick={() => set({ tab: "mission" })}>
            查看任務
          </Button>
        </div>
        {!canPreempt && (
          <p className="text-muted-foreground text-[11px]">這個任務不允許被操控打斷</p>
        )}
      </div>
    </m.div>
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
  if (t.run?.state === "running")
    return mission?.policy.allowTeleopPreempt === false ? "no_preempt" : "preempt";
  if (t.mode === "CHARGING") return "charging";
  return "check";
}

function Gate() {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const holder = useStore((s) => s.telemetry?.teleopHolder ?? null);
  const run = useStore((s) => s.telemetry?.run ?? null);
  const missions = useStore((s) => s.missions);

  const acquire = () =>
    queued(() => rpc("teleop.acquire", undefined)).then((r) =>
      setPhase(r?.granted ? "hold" : "other")
    );

  // Entry with nothing to ask: take the stick straight away. Leaving hands it back — only if
  // it is still mine (another phone may have taken it meanwhile; releasing would drop theirs).
  const [asked] = useState(phase !== "check");
  useEffect(() => {
    if (!asked) void acquire();
    return () => {
      if (get().telemetry?.teleopHolder?.mine)
        void queued(() => getDogLink().gateway.rpc("teleop.release", undefined)).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Someone else took the stick while I held it: say who, and offer to ask for it back.
  const lost = phase === "hold" && !!holder && !holder.mine;
  const shown: Phase = lost ? "other" : phase;
  const mission = missions.find((m) => m.id === run?.missionId);

  if (shown === "hold") return <LandscapeControls held />;

  const holderName = `${holder?.phone ?? "另一支手機"}（${holder?.role === "owner" ? "擁有者" : holder?.role === "viewer" ? "檢視者" : "操作員"}）`;
  const progress = run
    ? ` · 航點 ${Math.min((run.currentWp ?? 0) + 1, run.totalWp)}/${run.totalWp}`
    : "";

  // Landscape is the driving view: the question sits where the posture keys go, one line and
  // one key, and the map stays clear (it used to be a 360 pt card in the middle of it).
  const bar =
    shown === "check" ? (
      <GateBar icon={<Loader2 className="size-4 animate-spin" />} text="取得操控權…" />
    ) : shown === "preempt" ? (
      <GateBar
        icon={<PauseCircle className="size-4" />}
        text={`巡邏中：${mission?.name ?? "任務"}${progress}`}
        action="暫停並操控"
        onAction={async () => {
          await rpc("mission.pause", { reason: PREEMPT_REASON });
          await acquire();
        }}
      />
    ) : shown === "no_preempt" ? (
      <GateBar
        icon={<PauseCircle className="size-4" />}
        text={`「${mission?.name ?? "任務"}」不允許操控打斷`}
        action="中止並操控"
        onAction={async () => {
          await rpc("mission.abort", undefined);
          await acquire();
        }}
      />
    ) : shown === "charging" ? (
      <GateBar
        icon={<BatteryCharging className="size-4" />}
        text="充電中，操控會中斷充電"
        action="中斷並操控"
        onAction={acquire}
      />
    ) : (
      <GateBar
        icon={<Hand className="size-4" />}
        text={`${holderName} 正在操控`}
        action={shown === "requesting" ? "等待回應…" : "請求接手"}
        busy={shown === "requesting"}
        onAction={async () => {
          setPhase("requesting");
          const r = await rpc("teleop.request", undefined);
          if (r?.granted) await acquire();
          else setPhase("other");
        }}
      />
    );

  return <LandscapeControls held={false} bar={bar} />;
}

/** The landscape gate's question: what is in the way, and the one key that moves past it. */
function GateBar({
  icon,
  text,
  action,
  onAction,
  busy,
}: {
  icon: React.ReactNode;
  text: string;
  action?: string;
  onAction?: () => void | Promise<void>;
  busy?: boolean;
}) {
  const [pending, setPending] = useState(false);
  return (
    <div
      role="status"
      className="bg-surface/90 flex min-h-12 items-center gap-2.5 rounded-xl border py-1.5 pr-1.5 pl-3 shadow-lg backdrop-blur"
    >
      <span className="text-primary-accent shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{text}</span>
      {action && onAction && (
        <Button
          size="sm"
          className="shrink-0"
          loading={pending || busy}
          onClick={async () => {
            setPending(true);
            try {
              await onAction();
            } finally {
              setPending(false);
            }
          }}
        >
          {action}
        </Button>
      )}
    </div>
  );
}

/**
 * §5 landscape, basic controls only: the two sticks under the thumbs, three posture keys
 * between them. Readings are in the status island (battery, RTT, speed); the speed limit
 * and gait are set in portrait. `held` = the stick is mine; otherwise the sticks are drawn
 * greyed and nothing is sent (the island says why).
 */
function LandscapeControls({ held, bar }: { held: boolean; bar?: React.ReactNode }) {
  const t = useStore((s) => s.telemetry);
  const conn = useStore((s) => s.conn);
  const rtt = useStore((s) => s.rtt.level);
  const sticks = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const lastInput = useRef(0);
  const [idle, setIdle] = useState(false);

  const lock = held
    ? stickLock({
        conn,
        rtt,
        mode: t?.mode ?? null,
        posture: t?.posture ?? null,
        mine: !!t?.teleopHolder?.mine,
      })
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
        <Joystick
          label="移動搖桿：前後左右"
          hint="前後 · 平移"
          onChange={onLeft}
          disabled={!!lock}
        />
      </div>
      <div className="pointer-events-auto absolute right-4 bottom-3">
        <Joystick
          label="轉向搖桿：轉向與相機俯仰"
          hint="轉向 · 俯仰"
          onChange={onRight}
          disabled={!!lock}
        />
      </div>
      {/* Between the sticks: the posture keys, or the gate's one-line question (wider, still
          clear of the sticks — they take ~150 pt at each side). */}
      <div
        className={cn(
          "pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 space-y-1.5",
          bar ? "w-[min(400px,calc(100%-300px))]" : "w-[260px]"
        )}
      >
        {pausedByUs && idle && (
          <Button className="w-full" onClick={() => void rpc("mission.resume", undefined)}>
            <PlayCircle />
            恢復巡邏
          </Button>
        )}
        {bar ?? (
          <div className="bg-surface/85 rounded-xl border p-1.5 backdrop-blur">
            <PostureRow postures={POSTURES.filter((p) => p.id !== "lie")} disabled={!held} />
          </div>
        )}
      </div>
      {held && lock && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="bg-popover/95 rounded-lg border px-3 py-1.5 text-[13px] font-semibold shadow-lg">
            {lock}
          </span>
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
      <Segmented
        value={gait}
        options={GAITS}
        disabled={moving || blocked}
        onChange={(g) => void rpc("gait.set", { gait: g })}
        className="flex-1"
      />
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
