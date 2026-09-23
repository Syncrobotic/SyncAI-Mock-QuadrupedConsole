"use client";

import { Bluetooth, Camera, Check, CircleAlert, Hand, KeyRound, Loader2, Mic, OctagonX, QrCode, RotateCcw, ShieldCheck, Signal, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Field, Modal, inputClass } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { getDogLink } from "@/link";
import { cn, sleep } from "@/lib/utils";
import { ROLE_LABEL, type DogAdvert, type Enrollment, type WifiStatus } from "@/proto/types";
import { useStore } from "@/store";
import { beginOnboarding, finishOnboarding } from "@/store/controller";

import type { StepProps } from "./Onboarding";

// ── Layout helpers ──────────────────────────────────────────────────────────

function Screen({ title, lead, children, footer }: { title: string; lead?: React.ReactNode; children?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col px-5 pt-5 pb-5">
      <h1 className="text-[26px] leading-tight font-bold tracking-tight">{title}</h1>
      {lead && <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">{lead}</p>}
      <div className="mt-6 flex-1 space-y-4">{children}</div>
      {footer && <div className="mt-6 space-y-2">{footer}</div>}
    </div>
  );
}

function Primary(props: React.ComponentProps<typeof Button>) {
  return <Button {...props} className={cn("h-12 w-full text-[15px]", props.className)} />;
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

  return (
    <div className="flex min-h-full flex-col">
      {/* The dashboard's dark plate as a hero — the same brand surface. */}
      <div className="bg-plate relative overflow-hidden px-5 pt-12 pb-8 text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-violet-500/60 to-transparent" />
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 90% at 20% -10%, rgba(124,111,208,0.35), transparent 65%)" }} />
          <div className="plate-grid absolute inset-0" style={{ maskImage: "radial-gradient(ellipse 90% 100% at 30% 0%, #000 25%, transparent 80%)" }} />
        </div>
        <p className="relative text-[11px] tracking-[0.2em] text-violet-200/80 uppercase">SyncAI Quadruped Console</p>
        <h1 className="relative mt-3 text-[30px] leading-tight font-bold tracking-tight">在現場，直接帶你的巡邏犬上工。</h1>
        <p className="relative mt-3 text-[15px] leading-relaxed text-white/65">不用帳號。靠近狗、用藍牙配對，這支手機就是它的遙控器。</p>
      </div>

      <div className="flex-1 space-y-4 px-5 pt-6">
        {revoked && (
          <Note tone="bad" icon={<CircleAlert />}>
            這支手機已被 Owner 撤銷，本機憑證已清除。需要的話請重新配對，並請 Owner 核准。
          </Note>
        )}
        <div className="space-y-2">
          <Perm icon={<Bluetooth />} title="藍牙" body="配對與無網路時的緊急停止都靠它" state={denied ? "denied" : "required"} />
          <Perm icon={<Mic />} title="麥克風" body="對現場說話 · 第一次開通話時才詢問" state="later" />
          <Perm icon={<Camera />} title="相機" body="掃狗身上的 QR 快速找到它" state="later" />
        </div>
        {denied && (
          <Note tone="warn" icon={<CircleAlert />}>
            沒有藍牙就無法配對，也無法在斷網時送出緊急停止。請到「設定 → SyncAI → 藍牙」開啟後回來。
          </Note>
        )}
      </div>

      <div className="space-y-2 px-5 pt-6 pb-5">
        <Primary onClick={() => setAsking(true)}>{denied ? "我已開啟，再試一次" : "允許藍牙並開始"}</Primary>
        {denied && (
          <Button variant="ghost" className="h-11 w-full" onClick={() => toast("Mock：這裡會開啟系統設定")}>
            開啟系統設定
          </Button>
        )}
      </div>

      {/* A stand-in for the OS permission sheet, so the deny path is reviewable. */}
      <Modal open={asking} dismissable={false} className="max-w-[300px] p-0 text-center">
        <div className="px-5 pt-5 pb-4">
          <p className="text-[15px] font-semibold">「SyncAI」想要使用藍牙</p>
          <p className="text-muted-foreground mt-1 text-[13px]">用來配對與控制附近的 SyncAI-Dog。</p>
          <p className="text-muted-foreground/70 mt-2 text-[10px]">Mock 系統權限對話框</p>
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

function Perm({ icon, title, body, state }: { icon: React.ReactNode; title: string; body: string; state: "required" | "later" | "denied" }) {
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border px-3.5 py-3">
      <span className="bg-primary/10 text-primary-accent grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">{title}</p>
        <p className="text-muted-foreground text-xs">{body}</p>
      </div>
      <span className={cn("text-[11px] font-medium", state === "denied" ? "text-status-error" : state === "required" ? "text-foreground" : "text-muted-foreground")}>
        {state === "denied" ? "已拒絕" : state === "required" ? "必要" : "稍後"}
      </span>
    </div>
  );
}

// ── 2 掃描 ───────────────────────────────────────────────────────────────────

export function StepScan({ patch, go }: StepProps) {
  const [dogs, setDogs] = useState<DogAdvert[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [qr, setQr] = useState<string | null>(null);

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

  const shown = qr ? dogs.filter((d) => d.serial.endsWith(qr)) : dogs;

  return (
    <Screen title="找到你的狗" lead="列出附近正在廣播的 SyncAI-Dog。認序號最後 4 碼，或掃狗身上的 QR。">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground flex items-center gap-2 text-[13px]">
          <Loader2 className="size-3.5 animate-spin" />
          掃描中 · {elapsed} 秒
        </p>
        {qr ? (
          <Button size="sm" variant="ghost" onClick={() => setQr(null)}>
            清除 QR 過濾
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setQr("7F3A");
              toast("Mock：已掃描狗身 QR · 7F3A");
            }}
          >
            <QrCode />
            掃 QR
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {shown.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              patch({ dog: d });
              go("connect");
            }}
            className="bg-card hover:border-primary/50 flex w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          >
            <span className="bg-primary/10 text-primary-accent grid size-11 shrink-0 place-items-center rounded-xl font-mono text-[13px] font-bold">{d.serial.slice(-4)}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{d.name}</p>
              <p className="text-muted-foreground text-xs">{d.hasOwner ? "已有 Owner · 需要核准" : "尚未配對 · 你會成為 Owner"}</p>
            </div>
            <Rssi rssi={d.rssi} />
          </button>
        ))}
        {shown.length === 0 && elapsed < 30 && <div className="bg-muted/40 h-[72px] animate-pulse rounded-xl" />}
      </div>

      {(elapsed >= 30 && shown.length === 0) || elapsed >= 8 ? (
        <Note tone={shown.length === 0 ? "warn" : "neutral"} icon={<CircleAlert />}>
          {shown.length === 0 ? "30 秒沒有找到狗。" : "沒看到你的狗？"}
          <ul className="mt-1 list-disc pl-4">
            <li>確認狗已開機</li>
            <li>手機與狗距離 5 m 內</li>
            <li>狗在配對模式：背部燈號藍色慢閃</li>
          </ul>
        </Note>
      ) : null}
    </Screen>
  );
}

function Rssi({ rssi }: { rssi: number }) {
  const bars = rssi > -60 ? 3 : rssi > -75 ? 2 : 1;
  return (
    <span className="text-muted-foreground flex flex-col items-end gap-0.5 text-[10px] tabular-nums">
      <span className="flex h-3 items-end gap-[2px]">
        {[1, 2, 3].map((b) => (
          <span key={b} className={cn("w-[3px] rounded-[1px]", b <= bars ? "bg-foreground" : "bg-muted")} style={{ height: b * 4 }} />
        ))}
      </span>
      {rssi} dBm
      <Signal className="sr-only" />
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
          if (alive) go("code");
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
    <Screen title="連線中" lead={`正在透過藍牙連到 ${flow.dog?.name}。`}>
      <div className="bg-card flex flex-col items-center gap-4 rounded-2xl border py-10">
        <span className={cn("grid size-16 place-items-center rounded-full", ok ? "bg-status-ok/15 text-status-ok" : "bg-primary/10 text-primary-accent")}>
          {ok ? <Check className="size-7" /> : <Bluetooth className="size-7 animate-pulse" />}
        </span>
        <p className="font-medium">{ok ? "已連上" : attempt > 1 ? `重試第 ${attempt - 1} 次…` : "建立安全通道…"}</p>
        {flow.session && (
          <dl className="text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
            <dt>序號</dt>
            <dd className="text-foreground font-mono">{flow.session.identity.serial}</dd>
            <dt>韌體</dt>
            <dd className="text-foreground font-mono">{flow.session.identity.firmware}</dd>
          </dl>
        )}
      </div>
    </Screen>
  );
}

// ── 4 確認碼 ─────────────────────────────────────────────────────────────────

export function StepCode({ flow, patch, go }: StepProps) {
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async (value: string) => {
    if (!flow.session) return;
    setChecking(true);
    const r = await getDogLink().ble.confirm(flow.session, value);
    setChecking(false);
    if (r.ok) {
      patch({ enrollment: r.enrollment });
      go("enroll");
      return;
    }
    if (r.attemptsLeft <= 0) {
      toast.error("錯誤 3 次，狗端已中止這次配對");
      go("scan");
      return;
    }
    setError(`確認碼不對，還可以再試 ${r.attemptsLeft} 次`);
    setCode("");
    input.current?.focus();
  };

  return (
    <Screen title="輸入確認碼" lead="看狗背面的燈號面板，會顯示 6 位數字。這一步確認你連到的是眼前這隻狗。">
      {/* The dog's back, simplified: a body outline with a lit 6-digit panel. */}
      <div className="bg-plate relative mx-auto flex h-36 w-full max-w-[300px] items-center justify-center overflow-hidden rounded-[2rem] border border-white/10">
        <div className="absolute inset-x-8 top-6 h-4 rounded-full bg-white/5" />
        <div className="rounded-lg border border-cyan-300/30 bg-black/60 px-4 py-2 font-mono text-2xl tracking-[0.3em] text-cyan-200 shadow-[0_0_24px_rgba(103,232,249,0.25)]">
          ••• •••
        </div>
        <span className="absolute bottom-3 text-[11px] text-white/40">狗背部 · 燈號面板</span>
      </div>

      <label className="relative block" onClick={() => input.current?.focus()}>
        <span className="sr-only">6 位確認碼</span>
        <input
          ref={input}
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          disabled={checking}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            setError(null);
            if (v.length === 6) void submit(v);
          }}
          className="absolute inset-0 opacity-0"
        />
        <div className="grid grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "grid h-14 place-items-center rounded-xl border-2 text-2xl font-bold tabular-nums",
                error ? "border-status-error/60" : i === code.length ? "border-primary" : "border-border",
                "bg-card"
              )}
            >
              {code[i] ?? ""}
            </div>
          ))}
        </div>
      </label>
      {checking && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          驗證中…
        </p>
      )}
      {error && <p className="text-status-error text-sm">{error}</p>}
      <p className="text-muted-foreground text-xs">Mock：確認碼是 123456</p>
    </Screen>
  );
}

// ── 5 註冊 ───────────────────────────────────────────────────────────────────

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
      const e: Enrollment = flow.enrollment ?? { kind: "rejected", reason: "no session" };
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

  return (
    <Screen
      title={granted ? "配對完成" : enrollment?.kind === "needs_approval" ? "需要 Owner 核准" : "註冊中"}
      lead={
        granted
          ? undefined
          : enrollment?.kind === "needs_approval"
            ? "這隻狗已經有 Owner。Owner 的手機會跳出「有手機請求加入」，核准後你就能以 Operator 身分使用。"
            : "正在把這支手機登記到狗上。"
      }
      footer={
        granted ? (
          <Primary onClick={() => go("wifi")}>繼續</Primary>
        ) : enrollment?.kind === "needs_approval" ? (
          <>
            <Button variant="outline" className="h-12 w-full" onClick={() => void asViewer()}>
              先以 Viewer 身分加入（唯讀）
            </Button>
            <Button
              variant="ghost"
              className="h-11 w-full"
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
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l} className="flex items-center gap-2 text-[14px]">
            <Check className="text-status-ok size-4" />
            {l}
          </li>
        ))}
      </ul>

      {granted && (
        <div className="bg-card flex flex-col items-center gap-2 rounded-2xl border py-8">
          <span className="bg-primary/15 text-primary-accent grid size-14 place-items-center rounded-2xl">
            <KeyRound className="size-6" />
          </span>
          <p className="text-muted-foreground text-sm">你在這隻狗上的角色</p>
          <p className="text-3xl font-bold tracking-tight">{ROLE_LABEL[granted.role]}</p>
          <p className="text-muted-foreground max-w-[260px] text-center text-xs">
            {granted.role === "owner"
              ? "第一支配對的手機。可以核准其他手機、解除 E-Stop、管理裝置。"
              : granted.role === "operator"
                ? "可以操控、排任務、通話。裝置管理與解除 E-Stop 需要 Owner。"
                : "可以看地圖與影像，其他功能鎖定。"}
          </p>
        </div>
      )}

      {enrollment?.kind === "needs_approval" && !granted && (
        <Note icon={<Loader2 className="animate-spin" />}>
          {enrollment.ownerOnline ? (
            "等待 Owner 在手機上核准…"
          ) : (
            <>
              Owner 的手機目前不在線。請聯絡 Owner 打開 App（裝置頁 → 已配對手機 → 核准），或先以 Viewer 身分加入。
              <br />
              這個畫面會一直等，直到你取消。
            </>
          )}
        </Note>
      )}
    </Screen>
  );
}

// ── 6 Wi-Fi ──────────────────────────────────────────────────────────────────

export function StepWifi({ flow, patch, go }: StepProps) {
  const [skipAsk, setSkipAsk] = useState(false);
  const role = flow.role;

  return (
    <Screen
      title="現場 Wi-Fi"
      lead="狗要連上現場的 Wi-Fi，手機才能看 3D 地圖、操控與通話。手機不會切換網路。"
      footer={
        <>
          <Primary
            disabled={!flow.ssid}
            onClick={() => {
              patch({ wifiError: null });
              go("wait");
            }}
          >
            <Wifi />
            讓狗連線
          </Primary>
          <Button variant="ghost" className="h-11 w-full" onClick={() => setSkipAsk(true)}>
            略過，之後再設
          </Button>
        </>
      }
    >
      <Field label="網路名稱（預填手機目前的 Wi-Fi）">
        <input className={inputClass} value={flow.ssid} onChange={(e) => patch({ ssid: e.target.value })} />
      </Field>
      <Field label="密碼" error={flow.wifiError ?? undefined}>
        <input className={inputClass} type="password" value={flow.psk} aria-invalid={!!flow.wifiError} onChange={(e) => patch({ psk: e.target.value })} placeholder="手動輸入" />
      </Field>
      {flow.wifiFailures >= 2 && (
        <Note tone="warn" icon={<CircleAlert />}>
          已經失敗 {flow.wifiFailures} 次。可以先略過，進 Console 後在裝置頁再設。
        </Note>
      )}
      <Note icon={<Bluetooth />}>
        <b className="text-foreground font-medium">略過的話：</b>只剩藍牙，Console 只有裝置頁與 E-Stop 能用。
      </Note>
      <p className="text-muted-foreground text-xs">Mock：名稱含 fail → 密碼錯；none → 找不到；slow → 25 秒才連上</p>

      <Modal open={skipAsk} onClose={() => setSkipAsk(false)}>
        <p className="text-lg font-semibold">先不設 Wi-Fi？</p>
        <p className="text-muted-foreground mt-1 text-sm">只剩藍牙：看不到地圖、不能操控、不能通話。E-Stop 與裝置頁可用，之後可以在裝置頁設定 Wi-Fi。</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" onClick={() => setSkipAsk(false)}>
            回去設定
          </Button>
          <Button
            className="h-11"
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

// ── 7 等待 ───────────────────────────────────────────────────────────────────

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

  return (
    <Screen
      title="等狗上線"
      lead={`狗正在連 ${flow.ssid}，完成後會回報它的區網位址。`}
      footer={
        timedOut ? (
          <>
            <Primary onClick={() => go("wifi")}>
              <RotateCcw />
              回去重新設定
            </Primary>
            <Button variant="ghost" disabled className="h-11 w-full">
              改用 SoftAP 備援（v1 未開放）
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="bg-card space-y-4 rounded-2xl border p-5">
        <div className="flex items-center gap-3">
          {status === "connected" ? <Check className="text-status-ok size-5" /> : <Loader2 className="text-primary-accent size-5 animate-spin" />}
          <p className="font-medium">{timedOut && status !== "connected" ? "超過 30 秒還沒連上" : WIFI_TEXT[status]}</p>
        </div>
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div className={cn("h-full rounded-full transition-[width] duration-1000 ease-linear", status === "connected" ? "bg-status-ok" : "bg-primary")} style={{ width: `${status === "connected" ? 100 : Math.min(100, (elapsed / 30) * 100)}%` }} />
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">{elapsed} / 30 秒 · 狗端即時回報</p>
      </div>
    </Screen>
  );
}

// ── 8 安全須知 ───────────────────────────────────────────────────────────────

export function StepSafety({ flow }: StepProps) {
  const [ack, setAck] = useState([false, false, false]);
  const cards = [
    {
      icon: <OctagonX />,
      title: "E-Stop 永遠在畫面中間",
      body: "地圖和下方面板之間那條紅色長鍵。按一下就停，不會再問。任何人都能按，只有 Owner 能解除。",
      visual: (
        <div className="bg-estop estop-stripes flex h-9 items-center justify-center rounded-md text-[12px] font-black tracking-[0.2em] text-white">E-STOP</div>
      ),
    },
    {
      icon: <Hand />,
      title: "放手即停",
      body: "操控時手指一離開搖桿，狗就停。訊號太差時搖桿會自動鎖住。沒有「鎖定前進」。",
    },
    {
      icon: <ShieldCheck />,
      title: "Owner 手機遺失怎麼辦",
      body: "唯一的方法：在狗身上長按實體鍵 10 秒，燈號紅色快閃 3 秒後會清空所有配對，再重新走一次這個流程。",
    },
  ];

  return (
    <Screen
      title="開始之前"
      lead="三件事，每一件都請確認。"
      footer={
        <Primary
          disabled={!ack.every(Boolean)}
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
          進入 Console
        </Primary>
      }
    >
      {cards.map((c, i) => (
        <label
          key={c.title}
          className={cn("bg-card block cursor-pointer space-y-2.5 rounded-2xl border p-4 transition-colors", ack[i] && "border-primary/50")}
        >
          <div className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary-accent grid size-9 shrink-0 place-items-center rounded-lg [&_svg]:size-4">{c.icon}</span>
            <div className="flex-1">
              <p className="font-semibold">{c.title}</p>
              <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">{c.body}</p>
            </div>
          </div>
          {c.visual}
          <span className="flex items-center gap-2 pt-1 text-[13px] font-medium">
            <input
              type="checkbox"
              className="accent-[var(--primary)] size-5"
              checked={ack[i]}
              onChange={(e) => setAck((a) => a.map((v, j) => (j === i ? e.target.checked : v)))}
            />
            我了解
          </span>
        </label>
      ))}
    </Screen>
  );
}
