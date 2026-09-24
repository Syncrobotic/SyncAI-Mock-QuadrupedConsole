"use client";

import { AnimatePresence, m } from "framer-motion";
import { ArrowRight, BadgeCheck, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleHelp, Hand, KeyRound, Loader2, Lock, OctagonX, Plus, RotateCcw, ScanLine, Wifi, WifiHigh, WifiLow, WifiZero, X } from "lucide-react";
import { isValidElement, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BrandGlyph } from "@/components/brand-mark";
import { KeyInput } from "@/components/KeyInput";
import { MockHint } from "@/components/MockHint";
import { Field, Modal, inputClass } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { getDogLink } from "@/link";
import { ACTIVATION_ERROR, EDITION_LABEL, FEATURE_LABEL, formatKey, isCompleteKey, normaliseKey } from "@/lib/license";
import { cn, sleep } from "@/lib/utils";
import { ROLE_LABEL, type DogAdvert, type Enrollment, type LicenseActivation, type LicenseInfo, type WifiNetwork, type WifiStatus } from "@/proto/types";
import { useStore } from "@/store";
import { beginOnboarding, finishOnboarding } from "@/store/controller";

import { OnboardingContext, type StepProps } from "./Onboarding";
import { CardScan, EASE_OUT, Link, NetLink, Radar, popIn, rise, type ScanState } from "./visuals";

/*
 * Every step is the same skeleton, top to bottom:
 *   a visual in a fixed band · one title · at most one line under it · the step's content
 *   · one primary action pinned to the bottom.
 * The band never moves between steps, so the flow reads as one screen changing state.
 * Anything longer than a line lives behind a tap (a "?" sheet), not on the screen.
 */

// ── Skeleton ────────────────────────────────────────────────────────────────

const PAD = "pr-[calc(1.25rem+var(--safe-right))] pl-[calc(1.25rem+var(--safe-left))]";
const LAYOUT = { duration: 0.45, ease: EASE_OUT } as const;

/** Stacks the old and the new text in one grid cell and cross-fades them. */
function Swap({ k, children, className, as = "p" }: { k: string; children: React.ReactNode; className?: string; as?: "h1" | "p" }) {
  const Tag = as === "h1" ? m.h1 : m.p;
  return (
    <div className="grid">
      <AnimatePresence initial={false}>
        <Tag
          key={k}
          className={cn("[grid-area:1/1]", className)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
        >
          {children}
        </Tag>
      </AnimatePresence>
    </div>
  );
}

function Frame({
  visual,
  title,
  sub,
  children,
  primary,
  above,
  left,
  right,
  live,
  mode = "hero",
}: {
  /**
   * hero — the visual IS the content (pairing, card scan, results, waiting): a large visual,
   *        the group centred.
   * list — a list is the content (dogs, networks): the visual shrinks to an 88 px band that
   *        stays pinned with the title; only the list scrolls. Switching animates (layout).
   */
  mode?: "hero" | "list";
  visual: React.ReactNode;
  title: string;
  sub?: React.ReactNode;
  children?: React.ReactNode;
  /** The one action at the bottom. Always present: automatic steps show it disabled with what is happening. */
  primary: React.ReactNode;
  /** A quiet text link directly above the primary button (e.g. 更換金鑰). The primary stays put. */
  above?: React.ReactNode;
  /** A step's own top-bar action, left of the stepper (cancel / back). */
  left?: React.ReactNode;
  /** A step's own top-bar action, right of the stepper (skip). */
  right?: React.ReactNode;
  /** Automatic steps announce their title changes. */
  live?: boolean;
}) {
  const shell = useContext(OnboardingContext);
  const list = mode === "list";
  // Default top-left action is the shell's back; a step's own left (cancel) wins.
  const leftSlot =
    left ||
    (shell.back && (
      <BarButton label="上一步" onClick={shell.back}>
        <ChevronLeft />
      </BarButton>
    ));
  // A dropped BLE link takes over the one button: waiting, then 重試 after 15 s.
  const action =
    shell.ble === "lost" ? (
      <Primary loading>重新連接中…</Primary>
    ) : shell.ble === "failed" ? (
      <Primary onClick={shell.retryBle}>
        <RotateCcw />
        重試
      </Primary>
    ) : (
      primary
    );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Step actions live in the shell's top bar row (48px, directly above this step); with
          no top bar (the Console's licence gate) they get a row of their own. */}
      {shell.hasTopBar ? (
        <>
          {leftSlot && <div className="absolute -top-12 left-[calc(0.75rem+var(--safe-left))] flex h-12 w-12 items-center justify-start">{leftSlot}</div>}
          {right && <div className="absolute -top-12 right-[calc(0.75rem+var(--safe-right))] flex h-12 w-12 items-center justify-end">{right}</div>}
        </>
      ) : (
        (leftSlot || right) && (
          <div className="flex h-12 shrink-0 items-center justify-between px-3">
            <span>{leftSlot}</span>
            <span>{right}</span>
          </div>
        )
      )}
      <div className="scrollbar-none min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className={cn("flex min-h-full flex-col", !list && "justify-center py-4")}>
          {/* Visual + title: centred in hero, a pinned header in list. One element across the
              switch, so framer's layout animation carries it (the radar shrinks, not jumps). */}
          <m.div
            layout
            transition={LAYOUT}
            className={cn(PAD, "z-10", list && "bg-background/90 sticky top-0 pb-3 backdrop-blur")}
          >
            <m.div
              layout
              transition={LAYOUT}
              className={cn(
                "flex shrink-0 items-center justify-center",
                list
                  ? "h-[88px] pt-1 [--band-h:80px] [--link-w:300px] [--node-sm:40px] [--node:44px] [--plate:3.5rem]"
                  : "h-[clamp(170px,31vh,250px)] [--band-h:clamp(170px,31vh,250px)] [--link-w:400px] [--node-sm:clamp(52px,15vw,66px)] [--node:clamp(64px,19vw,80px)] [--plate:6rem]"
              )}
            >
              {visual}
            </m.div>
            <m.div layout="position" transition={LAYOUT} className={cn("text-center", list ? "mt-2" : "mt-3")} aria-live={live ? "polite" : undefined}>
              {/* Text that changes inside a step cross-fades in place; nothing animates on
                  entry — the step transition already did (one layer, never two). */}
              <Swap k={title} className="text-[20px] leading-tight font-semibold tracking-tight" as="h1">
                {title}
              </Swap>
              {sub && (
                <Swap k={textOf(sub)} className="text-muted-foreground mt-1.5 text-[13px]">
                  {sub}
                </Swap>
              )}
            </m.div>
          </m.div>
          {children && (
            <m.div layout="position" transition={LAYOUT} className={cn(PAD, "pb-4", list ? "mt-1" : "mt-5")}>
              <div className="mx-auto w-full max-w-[360px] space-y-2.5">{children}</div>
            </m.div>
          )}
        </div>
      </div>
      <ActionBar above={shell.ble === "ok" ? above : undefined}>{action}</ActionBar>
    </div>
  );
}

/**
 * The bottom of every step: ONE primary button, nothing else (docs/design-system.md §4).
 * Pinned above the home indicator / gesture bar / button bar and the keyboard, so it sits
 * in exactly the same place on every step. Secondary actions go to the top bar (skip,
 * cancel) or into the content as a text link — never under or beside the primary.
 */
function ActionBar({ children, above }: { children: React.ReactNode; above?: React.ReactNode }) {
  return (
    <div
      data-actionbar
      className="bg-background/85 shrink-0 pt-3 pr-[calc(1.25rem+var(--safe-right))] pb-[max(1rem,calc(var(--safe-bottom)+0.5rem),var(--kb,0px))] pl-[calc(1.25rem+var(--safe-left))] backdrop-blur"
    >
      {/* Grows upward: the primary keeps its distance from the bottom edge. */}
      {above && <div className="-mt-1 mb-1 flex justify-center">{above}</div>}
      {children}
    </div>
  );
}

/** The text of a node — keys the label swap below. */
function textOf(n: React.ReactNode): string {
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (isValidElement(n)) return textOf((n.props as { children?: React.ReactNode }).children);
  return "";
}

/** The step's one button. When its label changes in place (連接中… → 繼續) the label slides. */
function Primary({ children, className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button {...props} className={cn("h-11 w-full overflow-hidden rounded-xl text-[15px]", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <m.span
          key={textOf(children)}
          className="inline-flex items-center gap-2"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: EASE_OUT }}
        >
          {children}
        </m.span>
      </AnimatePresence>
    </Button>
  );
}

/**
 * One choice in a list — a dog, a network. Same card everywhere (docs/design-system.md §5):
 * tile · title (+ badge) · one line · radio; selected = accent border and tint; whatever the
 * choice needs next (a password) opens inside the same card.
 */
function ChoiceCard({
  tile,
  title,
  badge,
  sub,
  subTone,
  on,
  disabled,
  onSelect,
  index,
  children,
}: {
  tile: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  sub: React.ReactNode;
  subTone?: "accent" | "muted";
  on: boolean;
  disabled?: boolean;
  onSelect: () => void;
  index: number;
  children?: React.ReactNode;
}) {
  return (
    <m.div
      className={cn("overflow-hidden rounded-xl border backdrop-blur transition-colors", on ? "border-primary bg-primary/10" : "bg-card/70", disabled && "opacity-50")}
      {...rise(index)}
    >
      <button
        type="button"
        role="radio"
        aria-checked={on}
        disabled={disabled}
        onClick={onSelect}
        className={cn("focus-visible:ring-primary/40 flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed", !on && "hover:bg-accent/40")}
      >
        <span className="bg-primary/12 text-primary-accent grid h-9 w-12 shrink-0 place-items-center rounded-lg font-mono text-[13px] font-semibold [&_svg]:size-5">{tile}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-medium">{title}</span>
            {badge}
          </span>
          <span className={cn("block truncate text-[12px] tabular-nums", subTone === "accent" ? "text-primary-accent" : "text-muted-foreground")}>{sub}</span>
        </span>
        <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors", on ? "border-primary bg-primary" : "border-muted-foreground/40")}>
          {on && <span className="size-2 rounded-full bg-white" />}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {on && children && (
          <m.div
            key="more"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
          >
            <div className="space-y-2 px-3 pb-3">{children}</div>
          </m.div>
        )}
      </AnimatePresence>
    </m.div>
  );
}

/** A secondary action inside the content: quiet, centred, one line. */
function TextLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-primary-accent hover:text-foreground mx-auto flex cursor-pointer items-center gap-1 py-2 text-[13px] font-medium transition-colors [&_svg]:size-3.5">
      {children}
    </button>
  );
}

/** A top-bar action (skip / cancel): text or an icon, never a filled button. */
function BarButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="text-muted-foreground hover:text-foreground hover:bg-accent grid h-8 min-w-8 cursor-pointer place-items-center rounded-lg px-1.5 text-[14px] font-medium transition-colors [&_svg]:size-5"
    >
      {children}
    </button>
  );
}

/** A large icon on a lit plate — the visual for steps that have no motion of their own. */
function Plate({ children, tone = "brand" }: { children: React.ReactNode; tone?: "brand" | "ok" | "muted" }) {
  return (
    <m.span className="relative grid size-[var(--plate,5rem)] place-items-center" {...popIn}>
      {tone !== "muted" && <span className={cn("absolute inset-0 rounded-3xl blur-2xl", tone === "ok" ? "bg-emerald-500/20" : "bg-violet-500/20")} />}
      <span
        className={cn(
          "bg-card relative grid size-full place-items-center rounded-3xl border shadow-lg [&_svg]:size-[45%]",
          tone === "brand" && "text-primary-accent ring-1 ring-violet-400/20",
          tone === "ok" && "text-status-ok ring-1 ring-emerald-400/25",
          tone === "muted" && "text-muted-foreground"
        )}
      >
        {children}
      </span>
    </m.span>
  );
}

// ── 0 Splash ────────────────────────────────────────────────────────────────

export function StepSplash({ go }: StepProps) {
  const revoked = useStore((s) => s.revokedNotice);
  const [asking, setAsking] = useState(false);
  const [denied, setDenied] = useState(false);
  const [opening, setOpening] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <m.span className="relative grid size-24 place-items-center" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease: EASE_OUT }}>
          <span className="absolute inset-0 rounded-[28px] bg-violet-500/25 blur-2xl" />
          <span className="bg-card relative grid size-24 place-items-center rounded-[28px] border shadow-xl ring-1 ring-violet-400/25">
            <BrandGlyph className="size-11" />
          </span>
        </m.span>
        <m.h1 className="mt-7 text-[26px] font-semibold tracking-tight" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12, ease: EASE_OUT }}>
          SyncAI Console
        </m.h1>
        <m.p className="text-muted-foreground mt-2 text-[14px]" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2, ease: EASE_OUT }}>
          機器狗的現場遙控器
        </m.p>
        <AnimatePresence>
          {(revoked || denied) && (
            <m.div key={denied ? "denied" : "revoked"} className="mt-6 flex flex-col items-center" {...popIn}>
              <p role="alert" className="text-status-error flex items-center gap-1.5 text-[13px]">
                <CircleAlert className="size-4 shrink-0" />
                {denied ? "需要藍牙才能配對" : "這支手機已被撤銷，請重新配對"}
              </p>

            </m.div>
          )}
        </AnimatePresence>
      </div>

      <ActionBar>
        {/* After a refusal the OS will not ask again — "retry" would do nothing. The one button
            goes to the app's page in Settings instead. */}
        {denied ? (
          <Primary
            loading={opening}
            onClick={async () => {
              setOpening(true);
              const ok = await getDogLink().phone.openSettings("bluetooth");
              setOpening(false);
              if (!ok) return;
              beginOnboarding();
              go("scan");
            }}
          >
            開啟設定
          </Primary>
        ) : (
          <Primary onClick={() => setAsking(true)}>
            開始配對
            <ArrowRight />
          </Primary>
        )}
      </ActionBar>

      {/* A stand-in for the OS permission sheet, so the deny path is reviewable. */}
      <Modal open={asking} dismissable={false} className="max-w-[280px] p-0 text-center">
        <div className="px-5 pt-5 pb-4">
          <p className="text-[15px] font-semibold">「SyncAI」想要使用藍牙</p>
          <p className="text-muted-foreground mt-1 text-[13px]">用來配對與控制附近的狗。</p>
        </div>
        <div className="grid grid-cols-2 border-t text-[15px]">
          <button
            className="text-primary-accent h-11 cursor-pointer border-r"
            onClick={() => {
              setAsking(false);
              setDenied(true);
            }}
          >
            不允許
          </button>
          <button
            className="text-primary-accent h-11 cursor-pointer font-semibold"
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

// ── 1 Scan ──────────────────────────────────────────────────────────────────

export function StepScan({ patch, go }: StepProps) {
  const [dogs, setDogs] = useState<DogAdvert[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  // The help link is not noise on arrival. It appears after 8 s when no dog has shown up at
  // all (that is when help is needed), or after 15 s without input when dogs are listed.
  const [idle, setIdle] = useState(false);
  const [poke, setPoke] = useState(0);
  const none = dogs.length === 0;
  useEffect(() => {
    const t = setTimeout(() => setIdle(true), none ? 8_000 : 15_000);
    return () => clearTimeout(t);
  }, [poke, none]);
  const touched = () => {
    setIdle(false);
    setPoke((p) => p + 1);
  };

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
    return () => {
      alive = false;
      void it.return?.();
    };
  }, []);

  const picked = dogs.find((d) => d.id === sel) ?? null;

  return (
    <Frame
      mode={dogs.length ? "list" : "hero"}
      visual={<Radar dogs={dogs} />}
      title={dogs.length ? "選擇你的狗" : "正在找附近的狗"}
      sub="序號末四碼印在狗的背上"
      live
      primary={
        <Primary
          disabled={!picked}
          onClick={() => {
            patch({ dog: picked });
            go("pair");
          }}
        >
          {picked ? `連接 ${picked.serial.slice(-4)}` : "選擇一隻狗"}
          {picked && <ArrowRight />}
        </Primary>
      }
    >
      <div role="radiogroup" aria-label="附近的狗" className="space-y-2" onPointerDown={touched} onKeyDown={touched}>
        {dogs.map((d, i) => (
          <ChoiceCard
            key={d.id}
            index={i}
            on={d.id === sel}
            onSelect={() => setSel(d.id)}
            tile={d.serial.slice(-4)}
            title={d.name}
            sub={d.hasOwner ? "需要擁有者核准" : "新機"}
            subTone={d.hasOwner ? "muted" : "accent"}
          />
        ))}
        {dogs.length === 0 && <div className="bg-card/40 h-[60px] animate-pulse rounded-xl border border-dashed" />}
      </div>
      <AnimatePresence>
        {idle && (
          <m.div key="help" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
            <TextLink onClick={() => setHelp(true)}>
              <CircleHelp />
              找不到你的狗嗎？
            </TextLink>
          </m.div>
        )}
      </AnimatePresence>

      <Modal open={help} onClose={() => setHelp(false)}>
        <p className="mb-2 text-[15px] font-semibold">找不到你的狗嗎？</p>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-[13px]">
          <li>確認狗已開機</li>
          <li>手機距離狗 5 公尺內</li>
          <li>狗背部燈號藍色慢閃（配對模式）</li>
        </ul>
        <Button className="mt-4 w-full" variant="outline" onClick={() => setHelp(false)}>
          知道了
        </Button>
      </Modal>
    </Frame>
  );
}

// ── 2 Pair: BLE connect + enrolment, one screen ─────────────────────────────

type PairPhase = "linking" | "key" | "granted" | "approval";

export function StepPair({ flow, patch, go }: StepProps) {
  const [phase, setPhase] = useState<PairPhase>("linking");
  const [retry, setRetry] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const abort = useRef<AbortController | null>(null);

  const settle = (e: Enrollment) => {
    setEnrollment(e);
    if (e.kind === "granted") {
      patch({ role: e.role });
      setPhase("granted");
      navigator.vibrate?.(20);
    } else if (e.kind === "needs_approval") setPhase("approval");
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const ble = getDogLink().ble;
      let session = null;
      for (let i = 1; i <= 3 && alive && !session; i++) {
        if (i > 1) setRetry(true);
        try {
          session = await ble.pair(flow.dog!.id);
        } catch {
          await sleep(600);
        }
      }
      if (!alive) return;
      if (!session) {
        toast.error("連接不上，請靠近狗再試一次");
        go("scan");
        return;
      }
      patch({ session });
      setPhase("key");
      await sleep(1100);
      const e = await ble.enroll(session);
      if (!alive) return;
      if (e.kind === "rejected") {
        toast.error("狗拒絕了這次配對");
        go("scan");
        return;
      }
      settle(e);
      if (e.kind === "needs_approval" && e.ownerOnline) {
        abort.current = new AbortController();
        try {
          const r = await ble.awaitApproval(flow.dog!.id, abort.current.signal);
          if (alive) settle(r);
        } catch {
          /* cancelled */
        }
      }
    })();
    return () => {
      alive = false;
      abort.current?.abort();
    };
    // Runs once, on entry — re-running on every flow change would re-pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const asViewer = async () => {
    abort.current?.abort();
    settle(await getDogLink().ble.requestViewer(flow.dog!.id));
  };

  const ownerOffline = enrollment?.kind === "needs_approval" && !enrollment.ownerOnline;
  const role = enrollment?.kind === "granted" ? enrollment.role : null;

  const title = { linking: "正在連接", key: "登記這支手機", granted: "配對完成", approval: "等待擁有者核准" }[phase];
  const sub =
    phase === "granted" && role
      ? `你是這隻狗的${ROLE_LABEL[role]}`
      : phase === "approval"
        ? ownerOffline
          ? "擁有者目前不在線"
          : "擁有者的手機會收到請求"
        : retry && phase === "linking"
          ? "訊號不穩，重試中…"
          : flow.dog?.name;

  return (
    <Frame
      visual={<Link phase={phase === "granted" ? "linked" : phase} />}
      title={title}
      sub={sub}
      live
      primary={
        phase === "granted" ? (
          <Primary onClick={() => go("license")}>
            繼續
            <ArrowRight />
          </Primary>
        ) : phase === "approval" ? (
          <Primary onClick={() => void asViewer()}>先以檢視者加入</Primary>
        ) : (
          <Primary loading>{phase === "key" ? "登記中…" : "連接中…"}</Primary>
        )
      }
      left={
        <BarButton
          label="取消配對"
          onClick={() => {
            abort.current?.abort();
            go("scan");
          }}
        >
          <X />
        </BarButton>
      }
    />
  );
}

// ── 3 License ───────────────────────────────────────────────────────────────

/**
 * The licence key decides which features this dog runs. It is bound over BLE before
 * Wi-Fi, because the dog may have no network yet. Only the Owner binds one.
 */
export function StepLicense({ flow, go }: StepProps) {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [changing, setChanging] = useState(false);
  const [features, setFeatures] = useState(false);
  const [asked, setAsked] = useState<"no" | "sending" | "sent">("no");
  // Once the Owner has been asked, watch for the licence and move on by itself.
  useEffect(() => {
    if (asked !== "sent") return;
    const t = setInterval(() => {
      void getDogLink()
        .ble.readLicense()
        .then((l) => l.edition !== "none" && setLicense(l));
    }, 4000);
    return () => clearInterval(t);
  }, [asked]);
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
      <Frame
        visual={
          <Plate>
            <Loader2 className="animate-spin" />
          </Plate>
        }
        title="讀取 License…"
        primary={<Primary loading>讀取中…</Primary>}
      />
    );

  const active = license.edition !== "none";

  // A non-Owner cannot bind a key, so an unlicensed dog is a dead end for them.
  if (!active && !owner)
    return (
      <Frame
        visual={
          <Plate tone="muted">
            <Lock />
          </Plate>
        }
        title="這隻狗還沒啟用"
        sub="請擁有者先輸入 License 金鑰"
        primary={
          // The one thing a non-Owner can do: ask the Owner. Back (‹) leaves.
          asked === "sent" ? (
            <Primary disabled>
              <Check />
              已通知擁有者
            </Primary>
          ) : (
            <Primary
              loading={asked === "sending"}
              onClick={async () => {
                setAsked("sending");
                await getDogLink().ble.requestLicense(flow.dog!.id);
                setAsked("sent");
              }}
            >
              通知擁有者
            </Primary>
          )
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

  const on = license.features.filter((f) => f.granted);
  const off = license.features.filter((f) => !f.granted);

  return (
    <Frame
      visual={
        <Plate tone="ok">
          <BadgeCheck />
        </Plate>
      }
      title={`${EDITION_LABEL[license.edition]}已啟用`}
      above={owner && <TextLink onClick={() => setChanging(true)}>更換金鑰</TextLink>}
      primary={
        <Primary onClick={() => go("wifi")}>
          繼續
          <ArrowRight />
        </Primary>
      }
    >
      <TextLink onClick={() => setFeatures(true)}>
        {off.length ? `${on.length} 項功能開啟 · ${off.length} 項未含` : `${on.length} 項功能全部開啟`}
        <ChevronRight />
      </TextLink>

      <Modal open={features} onClose={() => setFeatures(false)}>
        <p className="text-[15px] font-semibold">{EDITION_LABEL[license.edition]}</p>
        <p className="text-muted-foreground mt-0.5 font-mono text-[12px]">{license.keyMasked}</p>
        <ul className="mt-3 divide-y rounded-xl border">
          {license.features.map((f) => (
            <li key={f.feature} className="flex h-10 items-center justify-between px-3 text-[13px]">
              <span className={cn(!f.granted && "text-muted-foreground")}>{FEATURE_LABEL[f.feature]}</span>
              {f.granted ? (
                <span className="text-status-ok flex items-center gap-1 text-[12px] font-medium">
                  <Check className="size-3.5" />
                  開啟
                </span>
              ) : (
                <span className="text-muted-foreground flex items-center gap-1 text-[12px]">
                  <Lock className="size-3" />
                  未含
                </span>
              )}
            </li>
          ))}
        </ul>
        {license.expiresAt && <p className="text-muted-foreground mt-2 text-[12px]">到期 {new Date(license.expiresAt).toLocaleDateString("zh-TW")}</p>}
        <Button className="mt-4 w-full" variant="outline" onClick={() => setFeatures(false)}>
          關閉
        </Button>
      </Modal>
    </Frame>
  );
}

/**
 * Licence activation. Shared by onboarding and the Console's licence gate.
 *
 * Scan first: the step opens on the camera — the card's QR code holds the key, and a read
 * activates straight away (no second tap). Typing the 16 characters is the fallback, a text
 * link above the button; the scan icon (top right) comes back. No camera (refused, none) →
 * manual, silently.
 */
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
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  // Camera refused: asking again does nothing, so the scan icon leads to Settings.
  const [camBlocked, setCamBlocked] = useState(false);
  const [askSettings, setAskSettings] = useState(false);
  const [scan, setScan] = useState<ScanState | "asking">("asking");
  const [scanTick, setScanTick] = useState(0);
  // Manual entry starts empty (a mock review can prefill from the review panel's card key).
  const [key, setKey] = useState("");
  const [error, setError] = useState<{ text: string; boxes: number[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (k: string) => {
    setBusy(true);
    setError(null);
    const r = await activate(k);
    setBusy(false);
    if (!r) return false;
    if (r.ok) {
      navigator.vibrate?.(20);
      onActivated(r.license);
      return true;
    }
    // Point at the box that is wrong, not the whole key: the edition prefix (box 1) for an
    // unknown or expired key, a 0000 block for one bound elsewhere.
    const parts = k.includes("-") ? k.split("-") : (normaliseKey(k).match(/.{1,4}/g) ?? []);
    const boxes =
      r.reason === "bound" ? parts.flatMap((p, i) => (p === "0000" ? [i] : [])) : r.reason === "format" ? [0, 1, 2, 3] : [0];
    setError({ text: ACTIVATION_ERROR[r.reason], boxes });
    return false;
  };

  // Scan mode: ask for the camera (first time), then read one card.
  useEffect(() => {
    if (mode !== "scan") return;
    const ctl = new AbortController();
    (async () => {
      const phone = getDogLink().phone;
      if (!(await phone.camera())) {
        if (ctl.signal.aborted) return;
        setCamBlocked(true);
        setMode("manual");
        return;
      }
      if (ctl.signal.aborted) return;
      setScan("scanning");
      const k = await phone.scanLicenseCard(ctl.signal);
      if (!k || ctl.signal.aborted) return;
      navigator.vibrate?.(15);
      setScan("found");
      setKey(k);
      await sleep(500);
      if (ctl.signal.aborted) return;
      const ok = await submit(k);
      if (!ok && !ctl.signal.aborted) setScan("failed");
    })();
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, scanTick]);

  const cancel = changing && (
    <BarButton label="取消更換" onClick={() => onCancel?.()}>
      <X />
    </BarButton>
  );

  const errorLine = (
    <AnimatePresence initial={false}>
      {error && (
        <m.p
          key={error.text}
          role="alert"
          className="text-status-error text-center text-[13px]"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: EASE_OUT }}
        >
          {error.text}
        </m.p>
      )}
    </AnimatePresence>
  );

  if (mode === "scan")
    return (
      <Frame
        visual={<CardScan state={scan === "asking" ? "scanning" : scan} />}
        title={changing ? "更換 License" : "掃描授權卡"}
        live
        left={cancel}
        above={
          <TextLink
            onClick={() => {
              setError(null);
              setMode("manual");
            }}
          >
            手動輸入金鑰
          </TextLink>
        }
        primary={
          scan === "failed" ? (
            <Primary
              onClick={() => {
                setError(null);
                setScan("scanning");
                setScanTick((t) => t + 1);
              }}
            >
              <RotateCcw />
              重新掃描
            </Primary>
          ) : (
            <Primary loading>{scan === "found" || busy ? "啟用中…" : "掃描中…"}</Primary>
          )
        }
      >
        {errorLine}
      </Frame>
    );

  return (
    <Frame
      visual={
        <Plate>
          <KeyRound />
        </Plate>
      }
      title={changing ? "更換 License 金鑰" : "輸入 License 金鑰"}
      sub="印在授權卡上"
      primary={
        <Primary disabled={!isCompleteKey(key)} loading={busy} onClick={() => void submit(key)}>
          啟用
        </Primary>
      }
      left={cancel}
      right={
        <BarButton
          label="掃描授權卡"
          onClick={() => {
            if (camBlocked) return setAskSettings(true);
            setError(null);
            setScan("asking");
            setMode("scan");
          }}
        >
          <ScanLine />
        </BarButton>
      }
    >
      <KeyInput
        value={key}
        onChange={(v) => {
          setKey(v);
          setError(null);
        }}
        invalid={error?.boxes}
        disabled={busy}
        autoFocus
      />
      {errorLine}

      <Modal open={askSettings} onClose={() => setAskSettings(false)}>
        <p className="text-[15px] font-semibold">相機權限已關閉</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setAskSettings(false)}>
            取消
          </Button>
          <Button
            onClick={async () => {
              setAskSettings(false);
              if (!(await getDogLink().phone.openSettings("camera"))) return;
              setCamBlocked(false);
              setError(null);
              setScan("asking");
              setMode("scan");
            }}
          >
            開啟設定
          </Button>
        </div>
      </Modal>
      <MockHint>
        <code className="font-mono">SYNC</code> 專業 · <code className="font-mono">BASE</code> 無 AI · <code className="font-mono">CTRL</code> 只操控 · 試{" "}
        <button className="cursor-pointer font-mono underline underline-offset-2" onClick={() => setKey("CTRL01AB2026DEMO")}>
          {formatKey("CTRL01AB2026DEMO")}
        </button>
      </MockHint>
    </Frame>
  );
}

// ── 4 Wi-Fi ─────────────────────────────────────────────────────────────────

const SECURITY_LABEL: Record<WifiNetwork["security"], string> = { open: "開放", wpa2: "WPA2", wpa3: "WPA3", enterprise: "企業 802.1X" };

function WifiBars({ rssi, className }: { rssi: number; className?: string }) {
  const Icon = rssi > -55 ? Wifi : rssi > -67 ? WifiHigh : rssi > -75 ? WifiLow : WifiZero;
  return <Icon className={className} aria-label={`訊號 ${rssi} dBm`} />;
}

/**
 * The networks the dog hears (scanned by the dog, over BLE — its signal, not the phone's),
 * as a list: pick one, the password opens in place. 其他網路 covers hidden SSIDs.
 */
export function StepWifi({ flow, patch, go }: StepProps) {
  const [skipAsk, setSkipAsk] = useState(false);
  const [nets, setNets] = useState<WifiNetwork[] | null>(null);
  const [manual, setManual] = useState(false);
  const [scanTick, setScanTick] = useState(0);
  // The phone's own SSID — undefined until read, null when the OS won't tell us (location
  // permission refused / unavailable). Null simply means: no badge, no mismatch warning.
  const [phoneSsid, setPhoneSsid] = useState<string | null | undefined>(undefined);
  // The password takes focus only after a tap — never on entry, where the keyboard would
  // cover the list before the guard has seen it.
  const [userPicked, setUserPicked] = useState(false);

  useEffect(() => {
    let alive = true;
    void getDogLink()
      .phone.wifiSsid()
      .then((s) => alive && setPhoneSsid(s));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void getDogLink()
      .ble.scanWifi()
      .then((n) => alive && setNets(n));
    return () => {
      alive = false;
    };
  }, [scanTick]);

  const isPhone = (n: WifiNetwork) => phoneSsid != null && n.ssid === phoneSsid;
  const sameOf = (ssid: string) => (phoneSsid == null ? null : ssid === phoneSsid);

  // Preselect the phone's network once both lists are in, unless the guard already chose.
  useEffect(() => {
    if (!nets || phoneSsid === undefined || userPicked || manual) return;
    if (flow.ssid && nets.some((x) => x.ssid === flow.ssid)) return;
    const mine = nets.find(isPhone);
    if (mine) patch({ ssid: mine.ssid, sameNet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nets, phoneSsid]);

  // The strongest four (and whatever is chosen); the rest — weaker, unsupported, and 其他網路 —
  // behind one 更多網路 row.
  const [more, setMore] = useState(false);
  const LIMIT = 4;
  const ordered = nets && [...nets].sort((a, b) => Number(a.security === "enterprise") - Number(b.security === "enterprise") || b.rssi - a.rssi);
  const shown = ordered && (more || ordered.length <= LIMIT ? ordered : ordered.filter((n, i) => i < LIMIT || n.ssid === flow.ssid));
  const hidden = ordered && shown ? ordered.length - shown.length : 0;

  const sel = manual ? null : (nets?.find((n) => n.ssid === flow.ssid) ?? null);
  const needsPsk = manual || (sel ? sel.security !== "open" : false);
  const ready = !!flow.ssid && (!needsPsk || flow.psk.length >= 8) && sel?.security !== "enterprise";

  const pick = (n: WifiNetwork) => {
    setManual(false);
    setUserPicked(true);
    if (n.ssid !== flow.ssid) patch({ ssid: n.ssid, psk: "", wifiError: null, sameNet: sameOf(n.ssid) });
  };
  const sameNet = manual ? (flow.ssid ? sameOf(flow.ssid) : null) : sel ? sameOf(sel.ssid) : null;

  const password = (
    <Field label="密碼" error={flow.wifiError ?? undefined}>
      <input
        className={inputClass}
        type="password"
        name="psk"
        autoComplete="current-password"
        enterKeyHint="go"
        autoFocus={userPicked || !!flow.wifiError}
        onFocus={(e) => flow.wifiError && e.currentTarget.select()}
        value={flow.psk}
        aria-invalid={!!flow.wifiError}
        onChange={(e) => patch({ psk: e.target.value, wifiError: null })}
      />
    </Field>
  );

  return (
    <Frame
      mode="list"
      visual={<NetLink phase="pick" sameNet={sameNet} />}
      title="選擇 Wi-Fi"
      sub={sameNet === false ? "手機不在這個網路，之後手機也要連過去" : "狗收得到的網路，訊號以狗的位置為準"}
      right={<BarButton onClick={() => setSkipAsk(true)}>略過</BarButton>}
      primary={
        // Submits the form (the action bar sits outside it), so Enter / Go works too.
        <Primary type="submit" form="wifi-form" disabled={!ready}>
          讓狗連線
          <ArrowRight />
        </Primary>
      }
    >
      <form
        id="wifi-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          patch({ wifiError: null });
          go("wait");
        }}
      >
        <div role="radiogroup" aria-label="Wi-Fi 網路" className="space-y-2">
          {!nets && [0, 1, 2].map((i) => <div key={i} className="bg-card/40 h-[60px] animate-pulse rounded-xl border border-dashed" />)}
          {shown?.map((n, i) => {
            const unsupported = n.security === "enterprise";
            return (
              <ChoiceCard
                key={n.ssid}
                index={i}
                on={sel?.ssid === n.ssid}
                disabled={unsupported}
                onSelect={() => pick(n)}
                tile={<WifiBars rssi={n.rssi} />}
                title={n.ssid}
                badge={isPhone(n) && <span className="text-primary-accent bg-primary/10 shrink-0 rounded px-1 text-[11px] font-medium">手機所在</span>}
                sub={
                  <span className="flex items-center gap-1">
                    {n.security !== "open" && <Lock className="size-3 shrink-0" />}
                    {n.band} GHz · {SECURITY_LABEL[n.security]} · {n.rssi} dBm{unsupported ? " · 暫不支援" : ""}
                  </span>
                }
              >
                {n.rssi <= -70 && (
                  <p className="text-severity-warning flex items-center gap-1.5 text-[12px]">
                    <CircleAlert className="size-3.5 shrink-0" />
                    訊號偏弱，狗走遠可能斷線
                  </p>
                )}
                {n.security !== "open" && password}
              </ChoiceCard>
            );
          })}
          {hidden > 0 && (
            <m.button
              type="button"
              onClick={() => setMore(true)}
              className="text-muted-foreground hover:text-foreground hover:border-primary/40 flex h-12 w-full cursor-pointer items-center justify-center gap-1 rounded-xl border border-dashed text-[13px] font-medium transition-colors"
              {...rise(LIMIT)}
            >
              更多網路 ({hidden})
              <ChevronDown className="size-4" />
            </m.button>
          )}
          {nets && hidden === 0 && (
            <ChoiceCard
              index={shown?.length ?? 0}
              on={manual}
              onSelect={() => {
                setManual(true);
                setUserPicked(true);
                patch({ ssid: "", psk: "", wifiError: null, sameNet: null });
              }}
              tile={<Plus />}
              title="其他網路…"
              sub="隱藏的網路，手動輸入名稱"
            >
              <Field label="網路名稱（SSID）">
                <input className={inputClass} name="ssid" autoComplete="off" autoFocus enterKeyHint="next" value={flow.ssid} onChange={(e) => patch({ ssid: e.target.value })} />
              </Field>
              {password}
            </ChoiceCard>
          )}
        </div>
      </form>
      {nets && (
        <TextLink onClick={() => { setNets(null); setScanTick((t) => t + 1); }}>
          <RotateCcw />
          重新掃描
        </TextLink>
      )}
      {flow.wifiFailures >= 2 && (
        <m.p className="text-muted-foreground text-center text-[12px]" {...popIn}>
          一直連不上？可以先略過，之後在裝置頁設定。
        </m.p>
      )}
      <MockHint>Lab-fail → 密碼錯 · Warehouse-slow → 25 秒 · 其他網路輸入含 none → 找不到</MockHint>

      <Modal open={skipAsk} onClose={() => setSkipAsk(false)}>
        <p className="text-[15px] font-semibold">先不設 Wi-Fi？</p>
        <p className="text-muted-foreground mt-1 text-[13px]">只能用 E-Stop 與裝置頁，之後可以再設定。</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setSkipAsk(false)}>
            回去設定
          </Button>
          <Button
            onClick={() => {
              setSkipAsk(false);
              patch({ endpoint: null });
              if (flow.role) go("safety");
            }}
          >
            略過
          </Button>
        </div>
      </Modal>
    </Frame>
  );
}

// ── 5 Wait for the dog on Wi-Fi ─────────────────────────────────────────────

const WIFI_TEXT: Record<WifiStatus, string> = {
  connecting: "狗正在連上 Wi-Fi…",
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
          await sleep(900);
          if (alive) go("safety");
        }
      }
    })();
    return () => {
      alive = false;
      clearInterval(t);
      clearTimeout(timeout);
    };
    // Runs once, on entry — re-running on every flow change would re-provision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const online = status === "connected";
  const stuck = timedOut && !online;

  return (
    <Frame
      visual={<NetLink phase={online ? "online" : stuck ? "failed" : "joining"} sameNet={flow.sameNet} progress={elapsed / 30} />}
      left={
        !online && (
          <BarButton label="取消連線" onClick={() => go("wifi")}>
            <X />
          </BarButton>
        )
      }
      title={online ? "狗已上線" : stuck ? "還沒連上" : "狗正在連上 Wi-Fi"}
      sub={online ? flow.ssid : stuck ? "訊號太弱，或網路需要網頁登入" : `${flow.ssid} · ${elapsed} 秒`}
      live
      primary={
        stuck ? (
          <Primary onClick={() => go("wifi")}>
            <RotateCcw />
            換一個網路
          </Primary>
        ) : online ? (
          <Primary disabled>
            <Check />
            已上線
          </Primary>
        ) : (
          <Primary loading>連線中…</Primary>
        )
      }
    />
  );
}

// ── 6 Safety ────────────────────────────────────────────────────────────────

const SAFETY = [
  { icon: OctagonX, text: "紅色 E-Stop，按一下就停" },
  { icon: Hand, text: "放開搖桿，狗就停" },
  { icon: RotateCcw, text: "手機遺失：長按狗身上的鍵 10 秒重置" },
];

export function StepSafety({ flow }: StepProps) {
  return (
    <Frame
      visual={
        <m.div
          className="from-estop to-estop-pressed flex h-16 w-full max-w-[300px] items-center justify-center gap-2 rounded-2xl bg-linear-to-b text-[15px] font-black tracking-[0.2em] text-white shadow-[0_8px_30px_-6px_var(--estop)] ring-1 ring-white/15"
          {...popIn}
          aria-hidden
        >
          <OctagonX className="size-5" />
          E-STOP
        </m.div>
      }
      title="開始之前"
      primary={
        <Primary
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
          我了解，開始使用
        </Primary>
      }
    >
      <ul className="bg-card/60 divide-y rounded-xl border backdrop-blur">
        {SAFETY.map(({ icon: Icon, text }, i) => (
          <m.li key={text} className="flex items-center gap-3 px-3.5 py-3 text-[14px]" {...rise(i + 1)}>
            <Icon className="text-primary-accent size-4 shrink-0" />
            {text}
          </m.li>
        ))}
      </ul>
    </Frame>
  );
}
