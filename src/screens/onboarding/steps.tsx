"use client";

import {
  ArrowRight,
  BadgeCheck,
  Bluetooth,
  Camera,
  Check,
  CircleAlert,
  Hand,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  OctagonX,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, m } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BrandGlyph } from "@/components/brand-mark";
import { KeyInput } from "@/components/KeyInput";
import { MockHint } from "@/components/MockHint";
import { Field, Modal, inputClass } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { ACTIVATION_ERROR, EDITION_LABEL, FEATURE_HINT, FEATURE_LABEL, formatKey, isCompleteKey } from "@/lib/license";
import { Button } from "@/components/ui/button";
import { getDogLink } from "@/link";
import { IS_MOCK } from "@/lib/env";
import { cn, sleep } from "@/lib/utils";
import { ROLE_LABEL, type DogAdvert, type Enrollment, type LicenseActivation, type LicenseInfo, type WifiStatus } from "@/proto/types";
import { useStore } from "@/store";
import { beginOnboarding, finishOnboarding } from "@/store/controller";

import type { StepProps } from "./Onboarding";
import { CheckList, LinkHero, PHASES, Radar, popIn, rise } from "./visuals";

// ── Layout helpers ──────────────────────────────────────────────────────────

function Screen({
  icon: Icon,
  hero,
  center,
  title,
  lead,
  children,
  footer,
}: {
  icon?: LucideIcon;
  /** A large visual in place of the icon — the automatic steps show what is happening. */
  hero?: React.ReactNode;
  /** Centre the column vertically: short, automatic steps, not forms. */
  center?: boolean;
  title: string;
  lead?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-4">
        <div className={cn("flex min-h-full flex-col", center && "justify-center pb-8")}>
          {/* The login page's column: mark, title, one muted line — centred on one axis. */}
          <div className="flex flex-col items-center text-center">
            {hero}
            {!hero && Icon && (
              <span className="bg-primary/10 text-primary-accent dark:bg-primary/20 mb-3 grid size-10 place-items-center rounded-xl ring-1 ring-violet-400/15">
                <Icon className="size-5" />
              </span>
            )}
            <AnimatePresence mode="wait" initial={false}>
              <m.h1
                key={title}
                className="text-[18px] leading-tight font-semibold tracking-tight"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                {title}
              </m.h1>
            </AnimatePresence>
            {lead && <p className="text-muted-foreground mt-1.5 max-w-[320px] text-[13px] leading-relaxed">{lead}</p>}
          </div>
          <div className="mt-5 space-y-3">{children}</div>
        </div>
      </div>
      {footer && <ActionBar>{footer}</ActionBar>}
    </div>
  );
}

/**
 * The step's actions, pinned to the bottom of the phone (above the home
 * indicator, and above the keyboard when one is up). Only the content above
 * scrolls — a primary button that scrolls away is a flow that stalls.
 */
function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div data-actionbar className="bg-background/85 shrink-0 space-y-1.5 border-t px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom),var(--kb,0px))] backdrop-blur">
      {children}
    </div>
  );
}

function Primary(props: React.ComponentProps<typeof Button>) {
  return <Button {...props} className={cn("h-10 w-full rounded-lg text-[14px]", props.className)} />;
}

/** The login page's account row: letter tile, two lines, a badge, an arrow. */
function ChoiceRow({
  tile,
  title,
  sub,
  badge,
  trailing,
  onClick,
  disabled,
}: {
  tile: React.ReactNode;
  title: React.ReactNode;
  sub: React.ReactNode;
  badge?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "border-border bg-card/60 group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
        onClick && "hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-primary/40 cursor-pointer focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
      )}
    >
      <span className="bg-primary/10 text-primary-accent ring-border/50 grid size-9 shrink-0 place-items-center rounded-lg text-xs font-semibold ring-2 [&_svg]:size-4">
        {tile}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="text-muted-foreground block truncate text-[11px]">{sub}</span>
      </span>
      {badge}
      {trailing ?? (onClick && <ArrowRight className="text-muted-foreground/40 group-hover:text-primary-accent size-4 shrink-0 transition-colors" />)}
    </Tag>
  );
}

function Note({ tone = "neutral", icon, children }: { tone?: "neutral" | "warn" | "bad"; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed",
        tone === "bad" ? "border-status-error/30 bg-status-error/10 text-status-error" : tone === "warn" ? "border-severity-warning/30 bg-severity-warning/10" : "bg-surface-sunken text-muted-foreground"
      )}
    >
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}

// ── 1 歡迎 / 權限 ────────────────────────────────────────────────────────────

export function StepWelcome({ go }: StepProps) {
  const revoked = useStore((s) => s.revokedNotice);
  const [asking, setAsking] = useState(false);
  const [denied, setDenied] = useState(false);

  const perms = [
    { icon: <Bluetooth />, title: "藍牙", sub: "配對，以及斷網時的緊急停止", need: true },
    { icon: <Mic />, title: "麥克風", sub: "對現場說話 · 第一次開影像通話時才詢問", need: false },
    { icon: <Camera />, title: "相機", sub: "拍照存證 · 第一次使用時才詢問", need: false },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-5 pt-10 pb-4">
        <m.div className="flex flex-col items-center text-center" {...popIn}>
          <span className="relative grid size-16 place-items-center">
            <span className="absolute inset-0 rounded-2xl bg-violet-500/15 blur-xl" />
            <span className="bg-card relative grid size-16 place-items-center rounded-2xl border shadow-lg ring-1 ring-violet-400/20">
              <BrandGlyph className="size-8" />
            </span>
          </span>
          <h1 className="mt-5 text-[20px] font-semibold tracking-tight">連接你的 SyncAI-Dog</h1>
          <p className="text-muted-foreground mt-1.5 max-w-[300px] text-[13px] leading-relaxed">不用帳號。靠近狗、用藍牙配對，這支手機就是它的遙控器。</p>
        </m.div>

        {/* What is about to happen, so the steps are not a surprise. */}
        <m.div className="mt-6" {...rise(1)}>
          <p className="text-muted-foreground mb-2 text-center text-[11px] font-medium tracking-wide">四個步驟 · 約 2 分鐘</p>
          <ol className="flex items-center justify-center gap-1.5">
            {PHASES.map((p, i) => (
              <li key={p} className="flex items-center gap-1.5">
                <span className="bg-card flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px]">
                  <span className="bg-primary/15 text-primary-accent grid size-[18px] place-items-center rounded-full text-[11px] font-bold">{i + 1}</span>
                  {p}
                </span>
                {i < PHASES.length - 1 && <ArrowRight className="text-muted-foreground/50 size-3" />}
              </li>
            ))}
          </ol>
        </m.div>

        <div className="mt-6 space-y-2">
          {revoked && (
            <Note tone="bad" icon={<CircleAlert />}>
              這支手機已被擁有者撤銷，本機憑證已清除。需要的話請重新配對，並請擁有者核准。
            </Note>
          )}
          <m.div className="bg-card/60 overflow-hidden rounded-xl border backdrop-blur" {...rise(2)}>
            <p className="text-muted-foreground border-b px-3.5 py-2 text-[11px] font-medium">需要的權限</p>
            <ul className="divide-y">
              {perms.map((p) => (
                <li key={p.title} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span className="bg-primary/10 text-primary-accent grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4">{p.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{p.title}</span>
                    <span className="text-muted-foreground block truncate text-[11px]">{p.sub}</span>
                  </span>
                  <Badge
                    variant="outline"
                    className={cn("shrink-0 text-[11px]", p.need ? (denied ? "text-status-error border-status-error/40" : "text-primary-accent border-primary/40") : "text-muted-foreground")}
                  >
                    {p.need ? (denied ? "已拒絕" : "必要") : "稍後"}
                  </Badge>
                </li>
              ))}
            </ul>
          </m.div>
          {denied && (
            <Note tone="warn" icon={<CircleAlert />}>
              沒有藍牙就無法配對，也無法在斷網時送出緊急停止。請到「設定 → SyncAI → 藍牙」開啟後回來。
            </Note>
          )}
        </div>
      </div>

      <ActionBar>
        <Primary onClick={() => setAsking(true)}>
          {denied ? "我已開啟，再試一次" : "允許藍牙並開始"}
          <ArrowRight />
        </Primary>
        {denied && (
          <Button variant="outline" className="w-full rounded-lg" onClick={() => toast("MOCK · 真機上這裡會開啟系統設定")}>
            開啟系統設定
          </Button>
        )}
        <p className="text-muted-foreground pt-1 text-center text-[11px]">© 2026 SyncAI · Mock 版本</p>
      </ActionBar>

      {/* A stand-in for the OS permission sheet, so the deny path is reviewable. */}
      <Modal open={asking} dismissable={false} className="max-w-[300px] p-0 text-center">
        <div className="px-5 pt-5 pb-4">
          <p className="text-[15px] font-semibold">「SyncAI」想要使用藍牙</p>
          <p className="text-muted-foreground mt-1 text-[13px]">用來配對與控制附近的 SyncAI-Dog。</p>
          {IS_MOCK && <p className="text-muted-foreground/70 mt-2 text-[11px]">MOCK · 代替系統權限對話框</p>}
        </div>
        <div className="grid grid-cols-2 border-t text-[15px]">
          <button
            className="text-primary-accent h-12 cursor-pointer border-r"
            onClick={() => {
              setAsking(false);
              setDenied(true);
            }}
          >
            不允許
          </button>
          <button
            className="text-primary-accent h-12 cursor-pointer font-semibold"
            onClick={() => {
              setAsking(false);
              beginOnboarding();
              go("scan");
            }}
          >
            好
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ── 2 掃描 ───────────────────────────────────────────────────────────────────

export function StepScan({ patch, go }: StepProps) {
  const [dogs, setDogs] = useState<DogAdvert[]>([]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let alive = true;
    const it = getDogLink().ble.scan()[Symbol.asyncIterator]();
    (async () => {
      while (alive) {
        const r = await it.next();
        if (r.done || !alive) break;
        const d = r.value;
        setDogs((prev) => [...prev.filter((x) => x.id !== d.id), d].sort((a, b) => b.rssi - a.rssi));
      }
    })();
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      alive = false;
      void it.return?.();
      clearInterval(t);
    };
  }, []);

  const pick = (d: DogAdvert) => {
    patch({ dog: d });
    go("connect");
  };

  return (
    <Screen
      hero={
        <div className="mb-4 w-full">
          <Radar dogs={dogs} onPick={pick} />
        </div>
      }
      title={dogs.length ? `附近有 ${dogs.length} 隻狗` : "正在找附近的狗"}
      lead="點雷達上的狗或下方列表。對一下狗身上序號的最後 4 碼。"
    >
      <p className="text-muted-foreground flex items-center justify-center gap-2 text-[12px] tabular-nums" aria-live="polite">
        <span className="bg-primary-accent size-1.5 animate-pulse rounded-full" />
        藍牙掃描中 · {elapsed} 秒
      </p>

      <div className="space-y-2">
        {dogs.map((d, i) => (
          <m.div key={d.id} {...rise(i)} layout>
            <ChoiceRow
              onClick={() => pick(d)}
              tile={<span className="font-mono">{d.serial.slice(-4)}</span>}
              title={d.name}
              sub={d.hasOwner ? "已有擁有者 · 加入需要核准" : "尚未配對 · 你會成為擁有者"}
              badge={
                <span className="flex shrink-0 items-center gap-2">
                  <Rssi rssi={d.rssi} />
                  <Badge variant="outline" className={cn("text-[11px]", !d.hasOwner && "text-primary-accent border-primary/40")}>
                    {d.hasOwner ? "已配對" : "新機"}
                  </Badge>
                </span>
              }
            />
          </m.div>
        ))}
        {dogs.length === 0 && elapsed < 30 && (
          <div className="bg-card/40 flex h-[54px] items-center gap-3 rounded-lg border border-dashed px-3">
            <span className="bg-muted size-9 animate-pulse rounded-lg" />
            <span className="flex-1 space-y-1.5">
              <span className="bg-muted block h-2.5 w-28 animate-pulse rounded" />
              <span className="bg-muted block h-2 w-40 animate-pulse rounded" />
            </span>
          </div>
        )}
      </div>

      <AnimatePresence>
        {((elapsed >= 30 && dogs.length === 0) || elapsed >= 8) && (
          <m.div {...popIn}>
            <Note tone={dogs.length === 0 ? "warn" : "neutral"} icon={<CircleAlert />}>
              {dogs.length === 0 ? "30 秒沒有找到狗。" : "沒看到你的狗？"}
              <ul className="mt-1 list-disc pl-4">
                <li>確認狗已開機</li>
                <li>手機與狗距離 5 m 內</li>
                <li>狗在配對模式：背部燈號藍色慢閃</li>
              </ul>
            </Note>
          </m.div>
        )}
      </AnimatePresence>
    </Screen>
  );
}

function Rssi({ rssi }: { rssi: number }) {
  const bars = rssi > -60 ? 3 : rssi > -75 ? 2 : 1;
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-label={`訊號 ${rssi} dBm`}>
      {[1, 2, 3].map((b) => (
        <span key={b} className={cn("w-[3px] rounded-[1px]", b <= bars ? "bg-foreground/80" : "bg-muted")} style={{ height: b * 4 }} />
      ))}
    </span>
  );
}

// ── 3 連線 ───────────────────────────────────────────────────────────────────

export function StepConnect({ flow, patch, go }: StepProps) {
  const [attempt, setAttempt] = useState(1);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 1; i <= 3 && alive; i++) {
        setAttempt(i);
        try {
          const session = await getDogLink().ble.pair(flow.dog!.id);
          if (!alive) return;
          patch({ session });
          setOk(true);
          await sleep(900);
          if (alive) go("enroll");
          return;
        } catch {
          await sleep(600);
        }
      }
      if (!alive) return;
      toast.error("藍牙連線失敗 3 次，請靠近一點再試");
      go("scan");
    })();
    return () => {
      alive = false;
    };
    // Each step runs its side effect once, on entry — re-running on every
    // flow change would re-pair, re-provision or re-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen
      center
      hero={<LinkHero phase={ok ? "linked" : "linking"} className="mb-4" />}
      title={ok ? "藍牙已連上" : "正在連線"}
      lead={ok ? undefined : `透過藍牙建立加密通道到 ${flow.dog?.name}。請把手機留在狗附近。`}
    >
      <p className="text-muted-foreground text-center text-[12px] tabular-nums" aria-live="polite">
        {ok ? "驗證狗的身分…" : attempt > 1 ? `訊號不穩，重試第 ${attempt - 1} 次（最多 2 次）` : "建立安全通道…"}
      </p>
      <AnimatePresence>
        {flow.session && (
          <m.dl className="bg-card/60 mx-auto grid w-full max-w-[280px] grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-[12px] backdrop-blur" {...popIn}>
            <dt className="text-muted-foreground">序號</dt>
            <dd className="text-right font-mono">{flow.session.identity.serial}</dd>
            <dt className="text-muted-foreground">韌體</dt>
            <dd className="text-right font-mono">{flow.session.identity.firmware}</dd>
          </m.dl>
        )}
      </AnimatePresence>
    </Screen>
  );
}

// ── 4 註冊 ───────────────────────────────────────────────────────────────────

export function StepEnroll({ flow, patch, go }: StepProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const abort = useRef<AbortController | null>(null);

  const waitApproval = async () => {
    abort.current = new AbortController();
    try {
      const r = await getDogLink().ble.awaitApproval(flow.dog!.id, abort.current.signal);
      setEnrollment(r);
      if (r.kind === "granted") patch({ role: r.role });
    } catch {
      /* cancelled */
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      // Idempotent: StrictMode runs this effect twice in dev.
      const add = (l: string) => alive && setLines((x) => (x.includes(l) ? x : [...x, l]));
      add("在安全晶片產生 Ed25519 金鑰");
      await sleep(600);
      add("送出公鑰與角色請求");
      await sleep(600);
      const e: Enrollment = flow.session ? await getDogLink().ble.enroll(flow.session) : { kind: "rejected", reason: "no session" };
      if (!alive) return;
      setEnrollment(e);
      if (e.kind === "granted") patch({ role: e.role });
      if (e.kind === "needs_approval" && e.ownerOnline) await waitApproval();
    })();
    return () => {
      alive = false;
      abort.current?.abort();
    };
    // Each step runs its side effect once, on entry — re-running on every
    // flow change would re-pair, re-provision or re-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const asViewer = async () => {
    abort.current?.abort();
    const r = await getDogLink().ble.requestViewer(flow.dog!.id);
    setEnrollment(r);
    if (r.kind === "granted") patch({ role: r.role });
  };

  const granted = enrollment?.kind === "granted" ? enrollment : null;
  const approval = enrollment?.kind === "needs_approval" && !granted;
  const doneCount = granted ? 3 : enrollment ? 2 : Math.max(0, lines.length - 1);
  const steps = ["在安全晶片產生 Ed25519 金鑰", "送出公鑰與角色請求", approval ? "等待擁有者核准" : "狗確認你的角色"].map((label, i) => ({
    label,
    state: (i < doneCount ? "done" : i === doneCount ? "doing" : "todo") as "done" | "doing" | "todo",
  }));

  return (
    <Screen
      center
      hero={<LinkHero phase={granted ? "linked" : approval ? "approval" : "key"} className="mb-4" />}
      title={granted ? "配對完成" : approval ? "需要擁有者核准" : "登記這支手機"}
      lead={
        granted
          ? undefined
          : approval
            ? "這隻狗已經有擁有者。擁有者的手機會跳出「有手機請求加入」，核准後你就能以操作員身分使用。"
            : "金鑰只存在這支手機的安全晶片，不會離開手機。"
      }
      footer={
        granted ? (
          <Primary onClick={() => go("license")}>
            繼續
            <ArrowRight />
          </Primary>
        ) : approval ? (
          <>
            <Button variant="outline" className="w-full" onClick={() => void asViewer()}>
              先以檢視者身分加入（唯讀）
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                abort.current?.abort();
                go("scan");
              }}
            >
              取消
            </Button>
          </>
        ) : undefined
      }
    >
      {!granted && <CheckList items={steps} />}

      {granted && (
        <m.div className="bg-card/70 relative overflow-hidden rounded-2xl border px-5 py-6 text-center backdrop-blur" {...popIn} transition={{ ...popIn.transition, delay: 0.25 }}>
          <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-violet-400/60 to-transparent" />
          <p className="text-muted-foreground text-[12px]">你在這隻狗上的角色</p>
          <p className="mt-1 text-2xl font-bold tracking-tight">{ROLE_LABEL[granted.role]}</p>
          <p className="text-muted-foreground mx-auto mt-2 max-w-[260px] text-[12px] leading-relaxed">
            {granted.role === "owner"
              ? "第一支配對的手機。可以核准其他手機、解除 E-Stop、管理裝置。"
              : granted.role === "operator"
                ? "可以操控、排任務、通話。裝置管理與解除 E-Stop 需要擁有者。"
                : "可以看地圖與影像，其他功能鎖定。"}
          </p>
        </m.div>
      )}

      {enrollment?.kind === "needs_approval" && !enrollment.ownerOnline && (
        <Note icon={<UserCheck />}>
          擁有者的手機目前不在線。請聯絡擁有者打開 App（裝置頁 → 已配對手機 → 核准），或先以檢視者身分加入。這個畫面會一直等，直到你取消。
        </Note>
      )}
    </Screen>
  );
}

// ── 6 License ────────────────────────────────────────────────────────────────

/**
 * The licence key decides which features this dog runs. It is bound over BLE
 * before Wi-Fi, because the dog may have no network yet. Only the Owner binds
 * one; a phone joining an already-licensed dog just sees what it has.
 */
export function StepLicense({ flow, go }: StepProps) {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [changing, setChanging] = useState(false);
  const owner = flow.role === "owner";

  useEffect(() => {
    let alive = true;
    void getDogLink()
      .ble.readLicense()
      .then((l) => alive && setLicense(l));
    return () => {
      alive = false;
    };
  }, []);

  if (!license)
    return (
      <Screen icon={KeyRound} title="讀取 License…">
        <div className="text-muted-foreground flex justify-center">
          <Loader2 className="size-5 animate-spin" />
        </div>
      </Screen>
    );

  const active = license.edition !== "none";

  // A licence is required. A non-Owner cannot bind one, so an unlicensed dog
  // is a dead end for them — say so and send them back, rather than letting
  // them into a Console where every feature is locked.
  if (!active && !owner)
    return (
      <Screen
        icon={Lock}
        title="這隻狗還沒啟用 License"
        lead="License 決定狗能使用哪些功能，必須由擁有者在自己的手機上輸入金鑰後，其他手機才能使用。"
        footer={
          <Primary variant="outline" onClick={() => go("scan")}>
            回到掃描
          </Primary>
        }
      />
    );

  if (!active || changing)
    return (
      <LicenseEntry
        changing={changing}
        onCancel={() => setChanging(false)}
        onActivated={(l) => {
          setLicense(l);
          setChanging(false);
        }}
      />
    );

  return (
    <Screen
      hero={<EditionPlate license={license} />}
      title="License 已啟用"
      lead={owner ? "這隻狗會啟用下列功能。" : "這隻狗的 License 由擁有者管理，以下是你能用的功能。"}
      footer={
        <>
          <Primary onClick={() => go("wifi")}>
            繼續
            <ArrowRight />
          </Primary>
          {owner && (
            <Button variant="ghost" className="w-full" onClick={() => setChanging(true)}>
              更換金鑰
            </Button>
          )}
        </>
      }
    >
      <LicenseCard license={license} />
    </Screen>
  );
}

/** Key entry. Shared by onboarding and the Console's licence gate. */
export function LicenseEntry({
  changing,
  onCancel,
  onActivated,
  activate = (key) => getDogLink().ble.activateLicense(key),
}: {
  changing?: boolean;
  onCancel?: () => void;
  onActivated: (l: LicenseInfo) => void;
  activate?: (key: string) => Promise<LicenseActivation | null>;
}) {
  // Mock builds start with the full-feature key filled in so every flow can be reviewed.
  const [key, setKey] = useState(IS_MOCK ? "SYNCPRO12026DEMO" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await activate(key);
    setBusy(false);
    if (!r) return;
    if (r.ok) {
      navigator.vibrate?.(20);
      onActivated(r.license);
    } else setError(ACTIVATION_ERROR[r.reason]);
  };

  return (
    <Screen
      icon={KeyRound}
      title={changing ? "更換 License 金鑰" : "輸入 License 金鑰"}
      lead="金鑰決定這隻狗能開啟哪些功能，例如只開操控、不含 AI。必須啟用才能使用。金鑰印在隨機附的授權卡上。"
      footer={
        <>
          <Primary disabled={!isCompleteKey(key)} loading={busy} onClick={() => void submit()}>
            啟用
          </Primary>
          {changing && (
            <Button variant="ghost" className="w-full" onClick={onCancel}>
              取消
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-2">
        <KeyInput
          value={key}
          onChange={(v) => {
            setKey(v);
            setError(null);
          }}
          invalid={!!error}
          disabled={busy}
          autoFocus
        />
        {error ? (
          <p role="alert" className="text-status-error text-[13px]">{error}</p>
        ) : (
          <p className="text-muted-foreground text-xs">4 組、每組 4 個英數字，可以整串貼上。經藍牙送到狗上驗證。</p>
        )}
      </div>
      <MockHint>
        <code className="font-mono">SYNC-…</code> 專業版 · <code className="font-mono">BASE-…</code> 標準版（無 AI）· <code className="font-mono">CTRL-…</code> 操控版 · 含{" "}
        <code className="font-mono">0000</code> 已綁定 · <code className="font-mono">EXPD-…</code> 過期。預填的是全功能金鑰；試操控版用{" "}
        <button className="cursor-pointer font-mono underline underline-offset-2" onClick={() => setKey("CTRL01AB2026DEMO")}>
          {formatKey("CTRL01AB2026DEMO")}
        </button>
      </MockHint>
    </Screen>
  );
}

/** The edition, as a plate: what was just unlocked, at a glance. */
function EditionPlate({ license }: { license: LicenseInfo }) {
  const granted = license.features.filter((f) => f.granted).length;
  return (
    <m.div className="relative mb-4 w-full max-w-[300px] overflow-hidden rounded-2xl border p-4 text-left shadow-lg" {...popIn}>
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--primary) 38%, var(--card)), var(--card) 70%)" }} />
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-violet-300/70 to-transparent" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-violet-200/80">SyncAI License</p>
          <p className="mt-0.5 text-[20px] font-bold tracking-tight">{EDITION_LABEL[license.edition]}</p>
        </div>
        <m.span
          className="bg-status-ok grid size-8 place-items-center rounded-full text-white shadow"
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.2 }}
        >
          <BadgeCheck className="size-4.5" />
        </m.span>
      </div>
      <p className="relative mt-4 font-mono text-[12px] tracking-wide whitespace-nowrap text-white/85">{license.keyMasked ?? "未輸入金鑰"}</p>
      <p className="text-muted-foreground relative mt-0.5 text-[11px]">
        {granted}/{license.features.length} 項功能{license.expiresAt ? ` · 到期 ${new Date(license.expiresAt).toLocaleDateString("zh-TW")}` : ""}
      </p>
    </m.div>
  );
}

export function LicenseCard({ license }: { license: LicenseInfo }) {
  return (
    <ul className="bg-card/60 divide-y overflow-hidden rounded-xl border backdrop-blur">
      {license.features.map((f, i) => (
        <m.li key={f.feature} className="flex h-10 items-center justify-between gap-2 px-3.5 text-[13px]" {...rise(i + 2)}>
          <span className={cn("min-w-0 truncate", !f.granted && "text-muted-foreground")}>
            {FEATURE_LABEL[f.feature]}
            <span className="text-muted-foreground ml-2 text-[11px]">{FEATURE_HINT[f.feature]}</span>
          </span>
          {f.granted ? (
            <span className="text-status-ok flex shrink-0 items-center gap-1 text-xs font-medium">
              <Check className="size-3.5" />
              已開啟
            </span>
          ) : (
            <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
              <Lock className="size-3" />
              未授權
            </span>
          )}
        </m.li>
      ))}
    </ul>
  );
}

// ── 7 Wi-Fi ──────────────────────────────────────────────────────────────────

export function StepWifi({ flow, patch, go }: StepProps) {
  const [skipAsk, setSkipAsk] = useState(false);
  const role = flow.role;

  return (
    <Screen
      icon={Wifi}
      title="現場 Wi-Fi"
      lead="狗要連上現場的 Wi-Fi，手機才能看 3D 地圖、操控與通話。手機不會切換網路。"
      footer={
        <>
          {/* Submits the form above (the action bar sits outside it), so Enter / Go works too. */}
          <Primary type="submit" form="wifi-form" disabled={!flow.ssid}>
            讓狗連線
            <ArrowRight />
          </Primary>
          <Button variant="ghost" className="w-full" onClick={() => setSkipAsk(true)}>
            略過，之後再設
          </Button>
        </>
      }
    >
      {/* A real form: the keyboard's Go key submits, and password managers recognise it. */}
      <form
        id="wifi-form"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!flow.ssid) return;
          patch({ wifiError: null });
          go("wait");
        }}
      >
        <Field label="網路名稱（預填手機目前的 Wi-Fi）">
          <input className={inputClass} name="ssid" autoComplete="off" enterKeyHint="next" value={flow.ssid} onChange={(e) => patch({ ssid: e.target.value })} />
        </Field>
        <Field label="密碼" error={flow.wifiError ?? undefined}>
          <input
            className={inputClass}
            type="password"
            name="psk"
            autoComplete="current-password"
            enterKeyHint="go"
            value={flow.psk}
            aria-invalid={!!flow.wifiError}
            onChange={(e) => patch({ psk: e.target.value })}
            placeholder="手動輸入"
          />
        </Field>
      </form>
      {flow.wifiFailures >= 2 && (
        <Note tone="warn" icon={<CircleAlert />}>
          已經失敗 {flow.wifiFailures} 次。可以先略過，進 Console 後在裝置頁再設。
        </Note>
      )}
      <Note icon={<Bluetooth />}>
        <b className="text-foreground font-medium">略過的話：</b>只剩藍牙，Console 只有裝置頁與 E-Stop 能用。
      </Note>
      <MockHint>網路名稱含 fail → 密碼錯；none → 找不到；slow → 25 秒才連上</MockHint>

      <Modal open={skipAsk} onClose={() => setSkipAsk(false)}>
        <p className="text-[15px] font-semibold">先不設 Wi-Fi？</p>
        <p className="text-muted-foreground mt-1 text-sm">只剩藍牙：看不到地圖、不能操控、不能通話。E-Stop 與裝置頁可用，之後可以在裝置頁設定 Wi-Fi。</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setSkipAsk(false)}>
            回去設定
          </Button>
          <Button
            onClick={() => {
              setSkipAsk(false);
              patch({ endpoint: null });
              if (role) go("safety");
            }}
          >
            略過
          </Button>
        </div>
      </Modal>
    </Screen>
  );
}

// ── 8 等待 ───────────────────────────────────────────────────────────────────

const WIFI_TEXT: Record<WifiStatus, string> = {
  connecting: "狗正在連線 Wi-Fi…",
  connected: "已連上",
  auth_failed: "密碼錯誤",
  not_found: "找不到這個網路",
};

export function StepWait({ flow, patch, go }: StepProps) {
  const [status, setStatus] = useState<WifiStatus>("connecting");
  const [elapsed, setElapsed] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    const timeout = setTimeout(() => alive && setTimedOut(true), 30_000);
    (async () => {
      for await (const s of getDogLink().ble.provisionWifi(flow.ssid, flow.psk)) {
        if (!alive) return;
        setStatus(s);
        if (s === "auth_failed" || s === "not_found") {
          patch({ wifiError: WIFI_TEXT[s], wifiFailures: flow.wifiFailures + 1 });
          go("wifi");
          return;
        }
        if (s === "connected") {
          const endpoint = await getDogLink().ble.readEndpoint();
          if (!alive) return;
          patch({ endpoint });
          await sleep(700);
          if (alive) go("safety");
        }
      }
    })();
    return () => {
      alive = false;
      clearInterval(t);
      clearTimeout(timeout);
    };
    // Each step runs its side effect once, on entry — re-running on every
    // flow change would re-pair, re-provision or re-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const online = status === "connected";
  const stuck = timedOut && !online;
  const items = [
    { label: "把 Wi-Fi 設定經藍牙送到狗上", state: "done" as const },
    { label: `狗連上 ${flow.ssid}`, state: online ? ("done" as const) : ("doing" as const) },
    { label: "回報區網位址", state: flow.endpoint ? ("done" as const) : online ? ("doing" as const) : ("todo" as const) },
  ];

  return (
    <Screen
      center
      hero={<LinkHero phase={online ? "online" : stuck ? "failed" : "wifi"} progress={elapsed / 30} className="mb-4" />}
      title={online ? "狗已上線" : stuck ? "超過 30 秒還沒連上" : "狗正在連上 Wi-Fi"}
      lead={stuck ? "可能是訊號太弱，或網路需要網頁登入（狗不支援）。回去換一個網路試試。" : "手機不需要切換網路，狗連上後會自動找到它。"}
      footer={
        stuck ? (
          <>
            <Primary onClick={() => go("wifi")}>
              <RotateCcw />
              回去重新設定
            </Primary>
            <Button variant="ghost" disabled className="w-full">
              改用 SoftAP 備援（v1 未開放）
            </Button>
          </>
        ) : undefined
      }
    >
      <CheckList items={items} />
      <p className="text-muted-foreground text-center text-[11px] tabular-nums" aria-live="polite">
        {online ? (flow.endpoint ? `${flow.endpoint.ip}:${flow.endpoint.port}` : "讀取位址…") : `${elapsed} 秒 · 通常 10 秒內完成`}
      </p>
    </Screen>
  );
}

// ── 9 安全須知 ───────────────────────────────────────────────────────────────

export function StepSafety({ flow }: StepProps) {
  const [ack, setAck] = useState([false, false, false]);
  const cards = [
    {
      icon: <OctagonX />,
      title: "E-Stop 永遠在畫面中間",
      body: "地圖和下方面板之間那條紅色長鍵。按一下就停，不會再問。任何人都能按，只有擁有者能解除。",
      visual: (
        <div className="from-estop to-estop-pressed flex h-10 items-center justify-center gap-1.5 rounded-lg bg-linear-to-b text-[12px] font-black tracking-[0.18em] text-white shadow-md ring-1 ring-white/15">
          <OctagonX className="size-4" />
          E-STOP
        </div>
      ),
    },
    {
      icon: <Hand />,
      title: "放手即停",
      body: "操控時手指一離開搖桿，狗就停。訊號太差時搖桿會自動鎖住。沒有「鎖定前進」。",
    },
    {
      icon: <ShieldCheck />,
      title: "擁有者手機遺失怎麼辦",
      body: "唯一的方法：在狗身上長按實體鍵 10 秒，燈號紅色快閃 3 秒後會清空所有配對，再重新走一次這個流程。",
    },
  ];

  const left = ack.filter((v) => !v).length;

  return (
    <Screen
      icon={ShieldCheck}
      title="開始之前"
      lead="三件和安全有關的事，點一下表示你了解。"
      footer={
        <Primary
          disabled={left > 0}
          onClick={() =>
            finishOnboarding({
              dogId: flow.dog!.id,
              dogName: flow.dog!.name,
              serial: flow.dog!.serial,
              role: flow.role ?? "viewer",
              endpoint: flow.endpoint,
              pairedAt: Date.now(),
            })
          }
        >
          {left > 0 ? `還有 ${left} 項要確認` : "進入 Console"}
          {left === 0 && <ArrowRight />}
        </Primary>
      }
    >
      {cards.map((c, i) => (
        <m.button
          key={c.title}
          type="button"
          role="checkbox"
          aria-checked={ack[i]}
          onClick={() => {
            navigator.vibrate?.(10);
            setAck((a) => a.map((v, j) => (j === i ? !v : v)));
          }}
          className={cn(
            "bg-card/70 block w-full cursor-pointer space-y-2.5 rounded-2xl border p-3.5 text-left backdrop-blur transition-colors duration-200",
            ack[i] ? "border-primary/60 bg-primary/8" : "hover:border-primary/30"
          )}
          {...rise(i)}
        >
          <div className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary-accent grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4">{c.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">{c.title}</p>
              <p className="text-muted-foreground mt-0.5 text-[12px] leading-relaxed">{c.body}</p>
            </div>
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors duration-200",
                ack[i] ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
              )}
              aria-hidden
            >
              <AnimatePresence>
                {ack[i] && (
                  <m.span key="c" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 520, damping: 22 }}>
                    <Check className="size-3.5" strokeWidth={3} />
                  </m.span>
                )}
              </AnimatePresence>
            </span>
          </div>
          {c.visual}
        </m.button>
      ))}
    </Screen>
  );
}
