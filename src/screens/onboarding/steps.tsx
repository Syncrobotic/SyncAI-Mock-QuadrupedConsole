"use client";

import { m } from "framer-motion";
import { ArrowRight, BadgeCheck, CircleAlert, CircleHelp, Hand, KeyRound, Loader2, Lock, OctagonX, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BrandGlyph } from "@/components/brand-mark";
import { KeyInput } from "@/components/KeyInput";
import { MockHint } from "@/components/MockHint";
import { Field, Modal, inputClass } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { getDogLink } from "@/link";
import { IS_MOCK } from "@/lib/env";
import { ACTIVATION_ERROR, EDITION_LABEL, FEATURE_LABEL, formatKey, isCompleteKey } from "@/lib/license";
import { cn, sleep } from "@/lib/utils";
import { ROLE_LABEL, type DogAdvert, type Enrollment, type LicenseActivation, type LicenseInfo, type WifiStatus } from "@/proto/types";
import { useStore } from "@/store";
import { beginOnboarding, finishOnboarding } from "@/store/controller";

import type { StepProps } from "./Onboarding";
import { EASE_OUT, Link, Radar, popIn, rise } from "./visuals";

/*
 * Every step is the same skeleton, top to bottom:
 *   a visual in a fixed band · one title · at most one line under it · the step's content
 *   · one primary action pinned to the bottom.
 * The band never moves between steps, so the flow reads as one screen changing state.
 * Anything longer than a line lives behind a tap (a "?" sheet), not on the screen.
 */

// ── Skeleton ────────────────────────────────────────────────────────────────

function Frame({
  visual,
  title,
  sub,
  children,
  footer,
  live,
}: {
  visual: React.ReactNode;
  title: string;
  sub?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Automatic steps announce their title changes. */
  live?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-none min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-4">
        <div className="flex h-[clamp(150px,28vh,210px)] items-center justify-center py-3">{visual}</div>
        <div className="text-center" aria-live={live ? "polite" : undefined}>
          <h1 className="text-[20px] leading-tight font-semibold tracking-tight">{title}</h1>
          {sub && <p className="text-muted-foreground mt-1.5 text-[13px]">{sub}</p>}
        </div>
        {children && <div className="mx-auto mt-5 w-full max-w-[360px] space-y-2.5">{children}</div>}
      </div>
      {footer && <ActionBar>{footer}</ActionBar>}
    </div>
  );
}

/**
 * The step's actions, pinned to the bottom of the phone (above the home indicator, and
 * above the keyboard when one is up). Only the content above scrolls.
 */
function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div data-actionbar className="bg-background/85 shrink-0 space-y-1 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom),var(--kb,0px))] backdrop-blur">
      {children}
    </div>
  );
}

function Primary(props: React.ComponentProps<typeof Button>) {
  return <Button {...props} className={cn("h-11 w-full rounded-xl text-[15px]", props.className)} />;
}

function Secondary(props: React.ComponentProps<typeof Button>) {
  return <Button variant="ghost" {...props} className={cn("text-muted-foreground w-full", props.className)} />;
}

/** A large icon on a lit plate — the visual for steps that have no motion of their own. */
function Plate({ children, tone = "brand" }: { children: React.ReactNode; tone?: "brand" | "muted" }) {
  return (
    <m.span className="relative grid size-20 place-items-center" {...popIn}>
      {tone === "brand" && <span className="absolute inset-0 rounded-3xl bg-violet-500/20 blur-2xl" />}
      <span
        className={cn(
          "bg-card relative grid size-20 place-items-center rounded-3xl border shadow-lg [&_svg]:size-9",
          tone === "brand" ? "text-primary-accent ring-1 ring-violet-400/20" : "text-muted-foreground"
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
        {(revoked || denied) && (
          <p role="alert" className="text-status-error mt-6 flex items-center gap-1.5 text-[13px]">
            <CircleAlert className="size-4 shrink-0" />
            {denied ? "需要藍牙才能配對" : "這支手機已被撤銷，請重新配對"}
          </p>
        )}
      </div>

      <ActionBar>
        <Primary onClick={() => setAsking(true)}>
          {denied ? "再試一次" : "開始配對"}
          <ArrowRight />
        </Primary>
        {denied ? (
          <Secondary onClick={() => toast("MOCK · 真機上這裡會開啟系統設定")}>開啟系統設定</Secondary>
        ) : (
          <p className="text-muted-foreground pt-2 text-center text-[11px]">© 2026 SyncAI{IS_MOCK ? " · Mock" : ""}</p>
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
  const [help, setHelp] = useState(false);

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

  return (
    <Frame visual={<Radar dogs={dogs} />} title={dogs.length ? "選擇你的狗" : "正在找附近的狗"} sub="序號末四碼印在狗的背上" live>
      {dogs.map((d, i) => (
        <m.button
          key={d.id}
          onClick={() => {
            patch({ dog: d });
            go("pair");
          }}
          className="bg-card/70 hover:border-primary/50 focus-visible:ring-primary/40 group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left backdrop-blur transition-colors focus-visible:ring-2 focus-visible:outline-none"
          {...rise(i)}
        >
          <span className="bg-primary/12 text-primary-accent grid h-9 w-12 shrink-0 place-items-center rounded-lg font-mono text-[13px] font-semibold">{d.serial.slice(-4)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{d.name}</span>
            <span className={cn("block text-[12px]", d.hasOwner ? "text-muted-foreground" : "text-primary-accent")}>{d.hasOwner ? "需要擁有者核准" : "新機"}</span>
          </span>
          <ArrowRight className="text-muted-foreground group-hover:text-primary-accent size-4 shrink-0 transition-colors" />
        </m.button>
      ))}
      {dogs.length === 0 && <div className="bg-card/40 h-[60px] animate-pulse rounded-xl border border-dashed" />}
      <button onClick={() => setHelp(true)} className="text-muted-foreground hover:text-foreground mx-auto flex cursor-pointer items-center gap-1 py-2 text-[12px]">
        <CircleHelp className="size-3.5" />
        找不到狗？
      </button>

      <Modal open={help} onClose={() => setHelp(false)}>
        <p className="mb-2 text-[15px] font-semibold">找不到狗？</p>
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
        toast.error("連不上，請靠近狗再試一次");
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

  const title = { linking: "正在連線", key: "登記這支手機", granted: "配對完成", approval: "等待擁有者核准" }[phase];
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
      footer={
        phase === "granted" ? (
          <Primary onClick={() => go("license")}>
            繼續
            <ArrowRight />
          </Primary>
        ) : phase === "approval" ? (
          <>
            <Primary variant="outline" onClick={() => void asViewer()}>
              先以檢視者加入
            </Primary>
            <Secondary
              onClick={() => {
                abort.current?.abort();
                go("scan");
              }}
            >
              取消
            </Secondary>
          </>
        ) : undefined
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

  const on = license.features.filter((f) => f.granted);
  const off = license.features.filter((f) => !f.granted);

  return (
    <Frame
      visual={<EditionPlate license={license} />}
      title="License 已啟用"
      sub={off.length ? `未含：${off.map((f) => FEATURE_LABEL[f.feature]).join("、")}` : `${on.length} 項功能全部開啟`}
      footer={
        <>
          <Primary onClick={() => go("wifi")}>
            繼續
            <ArrowRight />
          </Primary>
          {owner && <Secondary onClick={() => setChanging(true)}>更換金鑰</Secondary>}
        </>
      }
    />
  );
}

/** The edition as a card — what was just unlocked, at a glance. */
function EditionPlate({ license }: { license: LicenseInfo }) {
  return (
    <m.div className="relative w-full max-w-[280px] overflow-hidden rounded-2xl border p-4 text-left shadow-xl" {...popIn}>
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--primary) 40%, var(--card)), var(--card) 72%)" }} />
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-violet-300/70 to-transparent" />
      <div className="relative flex items-center justify-between">
        <p className="text-[22px] font-bold tracking-tight">{EDITION_LABEL[license.edition]}</p>
        <m.span
          className="bg-status-ok grid size-8 place-items-center rounded-full text-white shadow"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.2 }}
        >
          <BadgeCheck className="size-4.5" />
        </m.span>
      </div>
      <p className="relative mt-5 font-mono text-[12px] tracking-wide whitespace-nowrap text-white/80">{license.keyMasked}</p>
      {license.expiresAt && <p className="text-muted-foreground relative mt-0.5 text-[11px]">到期 {new Date(license.expiresAt).toLocaleDateString("zh-TW")}</p>}
    </m.div>
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
    <Frame
      visual={
        <Plate>
          <KeyRound />
        </Plate>
      }
      title={changing ? "更換 License 金鑰" : "輸入 License 金鑰"}
      sub="印在隨機附的授權卡上"
      footer={
        <>
          <Primary disabled={!isCompleteKey(key)} loading={busy} onClick={() => void submit()}>
            啟用
          </Primary>
          {changing && <Secondary onClick={onCancel}>取消</Secondary>}
        </>
      }
    >
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
      {error && (
        <p role="alert" className="text-status-error text-center text-[13px]">
          {error}
        </p>
      )}
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

export function StepWifi({ flow, patch, go }: StepProps) {
  const [skipAsk, setSkipAsk] = useState(false);

  return (
    <Frame
      visual={<Link phase="router" />}
      title="連上現場 Wi-Fi"
      sub="手機不用切換網路"
      footer={
        <>
          {/* Submits the form (the action bar sits outside it), so Enter / Go works too. */}
          <Primary type="submit" form="wifi-form" disabled={!flow.ssid}>
            讓狗連線
            <ArrowRight />
          </Primary>
          <Secondary onClick={() => setSkipAsk(true)}>略過</Secondary>
        </>
      }
    >
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
        <Field label="網路名稱">
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
          />
        </Field>
      </form>
      {flow.wifiFailures >= 2 && <p className="text-muted-foreground text-center text-[12px]">一直連不上？可以先略過，之後在裝置頁設定。</p>}
      <MockHint>名稱含 fail → 密碼錯 · none → 找不到 · slow → 25 秒</MockHint>

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
      visual={<Link phase={online ? "online" : stuck ? "failed" : "wifi"} progress={elapsed / 30} />}
      title={online ? "狗已上線" : stuck ? "還沒連上" : "狗正在連上 Wi-Fi"}
      sub={online ? (flow.endpoint?.ip ?? "讀取位址…") : stuck ? "訊號太弱，或網路需要網頁登入" : `${flow.ssid} · ${elapsed} 秒`}
      live
      footer={
        stuck ? (
          <Primary onClick={() => go("wifi")}>
            <RotateCcw />
            換一個網路
          </Primary>
        ) : undefined
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
          className="from-estop to-estop-pressed flex h-14 w-full max-w-[280px] items-center justify-center gap-2 rounded-2xl bg-linear-to-b text-[15px] font-black tracking-[0.2em] text-white shadow-[0_8px_30px_-6px_var(--estop)] ring-1 ring-white/15"
          {...popIn}
          aria-hidden
        >
          <OctagonX className="size-5" />
          E-STOP
        </m.div>
      }
      title="開始之前"
      footer={
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
