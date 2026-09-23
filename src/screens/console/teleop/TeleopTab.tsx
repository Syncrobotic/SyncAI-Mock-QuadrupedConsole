"use client";

import { BatteryCharging, Hand, Loader2, OctagonX, PauseCircle, PlayCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LockedPanel, Readouts, Select, Slider } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { getDogLink } from "@/link";
import { cn, formatClock } from "@/lib/utils";
import { get, set, useStore } from "@/store";
import { rpc } from "@/store/controller";
import { effectiveSpeedCap, lockDetail, shapeAxis, stickLock } from "@/store/logic";

import { Joystick } from "./Joystick";
import { useAccess } from "../Console";

import type { Gait, Posture } from "@/proto/types";

const PREEMPT_REASON = "被操控搶佔";

/**
 * Acquire and release go through one queue. Rotating the phone unmounts the
 * portrait stick and mounts the landscape one in the same commit: the old one
 * releases, the new one acquires — and with 50–150 ms of RPC jitter the
 * release could land second and silently hand the stick back.
 */
let teleopChain: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const next = teleopChain.then(fn, fn);
  teleopChain = next.catch(() => {});
  return next;
}

export function TeleopTab({ landscape = false }: { landscape?: boolean }) {
  const access = useAccess("teleop");
  if (access.locked)
    return (
      <div className={landscape ? "grid h-full place-items-center p-4" : "p-4"}>
        <div className={landscape ? "w-full max-w-sm" : ""}>
          <LockedPanel reason={access.reason} detail={lockDetail(access.reason)} />
        </div>
      </div>
    );
  return <Gate landscape={landscape} />;
}

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

function Gate({ landscape }: { landscape: boolean }) {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const holder = useStore((s) => s.telemetry?.teleopHolder ?? null);
  const run = useStore((s) => s.telemetry?.run ?? null);
  const missions = useStore((s) => s.missions);
  const holding = useRef(false);

  const acquire = () =>
    queued(() => rpc("teleop.acquire", undefined)).then((r) => {
      if (r?.granted) {
        holding.current = true;
        setPhase("hold");
      } else setPhase("other");
    });

  // Entry with nothing to ask: take the stick straight away. Leaving always hands it back.
  const [asked] = useState(phase !== "check");
  useEffect(() => {
    if (!asked) void acquire();
    return () => {
      if (holding.current) void queued(() => getDogLink().gateway.rpc("teleop.release", undefined)).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mission = missions.find((m) => m.id === run?.missionId);

  if (phase === "hold") return <Controls landscape={landscape} />;

  return (
    <div className={cn("space-y-3 p-4", landscape && "bg-background/80 absolute top-1/2 left-1/2 w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border backdrop-blur")}>
      {phase === "check" && (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
          <Loader2 className="size-4 animate-spin" />
          取得操控權…
        </div>
      )}
      {phase === "preempt" && (
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
      {phase === "no_preempt" && (
        <LockedPanel reason="此任務不允許操控搶佔" detail={`「${mission?.name ?? "任務"}」的策略設定為不可被操控打斷。需要時可以中止任務。`}>
          <Button variant="outline" className="mt-1" onClick={async () => { await rpc("mission.abort", undefined); await acquire(); }}>
            中止任務並操控
          </Button>
        </LockedPanel>
      )}
      {phase === "charging" && (
        <Prompt
          icon={<BatteryCharging className="size-5" />}
          title="充電中"
          body="開始操控會讓狗離開充電座並中斷充電。"
          confirm="中斷充電並操控"
          onConfirm={acquire}
        />
      )}
      {(phase === "other" || phase === "requesting") && (
        <Prompt
          icon={<Hand className="size-5" />}
          title={`${holder?.phone ?? "另一支手機"}（${holder?.role ?? "操作員"}）正在操控`}
          body="同一時間只能有一支手機操控。請求接手後，對方 5 秒內沒有拒絕就會轉移給你。"
          confirm={phase === "requesting" ? "等待對方回應…" : "請求接手"}
          busy={phase === "requesting"}
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

// ── The live stick ──────────────────────────────────────────────────────────

function Controls({ landscape }: { landscape: boolean }) {
  const t = useStore((s) => s.telemetry);
  const conn = useStore((s) => s.conn);
  const rtt = useStore((s) => s.rtt.level);
  const userCap = useStore((s) => s.userSpeedCap);
  const globalCap = useStore((s) => s.device?.safety.speedLimit ?? 1.5);
  const sticks = useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const lastInput = useRef(0);
  const [idle, setIdle] = useState(false);

  const lock = stickLock({
    conn,
    rtt,
    mode: t?.mode ?? null,
    posture: t?.posture ?? null,
    mine: !!t?.teleopHolder?.mine,
  });
  const cap = effectiveSpeedCap(userCap, globalCap, rtt);

  // §7: 50 Hz, every packet, even when the stick is centred — it is the heartbeat.
  useEffect(() => {
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
  }, []);

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

  const readouts = (
    <Readouts
      items={[
        { label: "延遲", value: t?.rttMs ?? "—", unit: "ms", tone: rtt === "poor" ? "bad" : rtt === "fair" ? "warn" : "neutral" },
        { label: "速度", value: (t?.speed ?? 0).toFixed(1), unit: "m/s" },
        { label: "上限", value: cap.toFixed(1), unit: "m/s", tone: rtt === "fair" ? "warn" : "neutral" },
        { label: "電量", value: Math.round(t?.battery ?? 0), unit: "%", tone: (t?.battery ?? 100) < 20 ? "bad" : (t?.battery ?? 100) < 35 ? "warn" : "neutral" },
      ]}
    />
  );
  const lockBadge = lock && (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="bg-popover/95 rounded-lg border px-3 py-1.5 text-[13px] font-semibold shadow-lg">{lock}</span>
    </div>
  );

  // §5 landscape: the map is the whole screen; sticks sit under the thumbs at
  // the two bottom corners, readouts and speed top-right, posture between the
  // sticks. Everything floats; the map stays tappable between them.
  if (landscape)
    return (
      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute top-[68px] right-2 w-[300px] space-y-1.5">
          {readouts}
          <div className="bg-surface/85 flex items-center gap-2 rounded-xl border px-3 backdrop-blur">
            <span className="text-muted-foreground shrink-0 text-[11px]">上限</span>
            <Slider label="速度上限" min={0.2} max={1.5} step={0.1} value={userCap} cap={globalCap} onChange={(v) => set({ userSpeedCap: v })} />
          </div>
        </div>
        <div className="pointer-events-auto absolute bottom-3 left-4">
          <Joystick label="移動搖桿：前後左右" hint="前後 · 平移" onChange={onLeft} disabled={!!lock} />
        </div>
        <div className="pointer-events-auto absolute right-4 bottom-3">
          <Joystick label="轉向搖桿：轉向與相機俯仰" hint="轉向 · 俯仰" onChange={onRight} disabled={!!lock} />
        </div>
        <div className="pointer-events-auto absolute bottom-3 left-1/2 w-[330px] -translate-x-1/2 space-y-1.5">
          {pausedByUs && idle && (
            <Button className="w-full" onClick={() => void rpc("mission.resume", undefined)}>
              <PlayCircle />
              10 秒沒有操控 · 恢復巡邏
            </Button>
          )}
          <div className="bg-surface/85 rounded-xl border p-1.5 backdrop-blur">
            <PostureRow />
          </div>
        </div>
        {lockBadge}
        <span className="sr-only">連線品質：{rttText}</span>
      </div>
    );

  return (
    <div className="space-y-2 px-3 pt-0.5 pb-2">
      {t?.mode === "ESTOP" && t.estop && (
        <div className="bg-status-error/10 border-status-error/30 text-status-error flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]">
          <OctagonX className="size-4 shrink-0" />
          緊急停止：{t.estop.by} · {formatClock(t.estop.at)}
        </div>
      )}
      {pausedByUs && idle && (
        <div className="bg-card flex items-center gap-3 rounded-lg border px-3 py-2">
          <p className="flex-1 text-[13px]">10 秒沒有操控，要恢復巡邏嗎？</p>
          <Button size="sm" onClick={() => void rpc("mission.resume", undefined)}>
            <PlayCircle />
            恢復任務
          </Button>
        </div>
      )}

      {readouts}
      <span className="sr-only">連線品質：{rttText}</span>

      {/* Posture before the sticks: "recover" is the key needed right after an
          E-Stop, so it must never be the part that scrolls out of view. The
          sticks go last — the bottom of the screen is where thumbs rest. */}
      <PostureRow />

      <div className="flex items-center gap-3">
        <span className="text-muted-foreground shrink-0 text-[12px]">速度上限</span>
        <Slider label="速度上限" min={0.2} max={1.5} step={0.1} value={userCap} cap={globalCap} onChange={(v) => set({ userSpeedCap: v })} />
        <span className="w-14 shrink-0 text-right text-[12px] font-semibold tabular-nums">{userCap.toFixed(1)} m/s</span>
      </div>

      <div className="relative flex items-start justify-around">
        <Joystick label="移動搖桿：前後左右" hint="前後 · 平移" onChange={onLeft} disabled={!!lock} />
        <Joystick label="轉向搖桿：轉向與相機俯仰" hint="轉向 · 俯仰" onChange={onRight} disabled={!!lock} />
        {lockBadge}
      </div>
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
  { value: "walk", label: "步態 walk" },
  { value: "trot", label: "步態 trot" },
  { value: "stairs", label: "步態 stairs" },
];

/** §7: posture is an RPC with a pending state; disabled while moving. */
function PostureRow() {
  const posture = useStore((s) => s.telemetry?.posture);
  const gait = useStore((s) => s.telemetry?.gait ?? "walk");
  const moving = useStore((s) => (s.telemetry?.speed ?? 0) > 0.05);
  const blocked = useStore((s) => s.telemetry?.mode === "ESTOP" || s.telemetry?.mode === "FAULT");
  const [pending, setPending] = useState<Posture | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      {POSTURES.map((p) => (
        <Button
          key={p.id}
          variant={posture === p.id ? "secondary" : "outline"}
          size="sm"
          className="h-9 flex-1 px-0"
          disabled={moving || blocked || pending !== null}
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
      <Select
        label="步態"
        value={gait}
        options={GAITS}
        disabled={moving || blocked}
        onChange={(g) => void rpc("gait.set", { gait: g })}
        className="w-[100px] shrink-0 text-[12px]"
      />
    </div>
  );
}

export function TeleopSummary() {
  const t = useStore((s) => s.telemetry);
  return (
    <span className="tabular-nums">
      RTT {t?.rttMs ?? "—"} ms · {(t?.speed ?? 0).toFixed(1)} m/s · {t?.gait ?? "walk"}
    </span>
  );
}
