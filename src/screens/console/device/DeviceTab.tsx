"use client";

import { Bluetooth, Download, FlaskConical, KeyRound, Pencil, Power, RefreshCw, Smartphone, Upload, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { KeyInput } from "@/components/KeyInput";
import { Card, Field, Modal, Pill, Row, SectionTitle, Select, Slider, inputClass, type Tone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getDogLink } from "@/link";
import { SCENARIOS, SCENARIO_IDS } from "@/link/mock/scenarios";
import { ACTIVATION_ERROR, EDITION_LABEL, FEATURE_LABEL, isCompleteKey } from "@/lib/license";
import { cn, formatClock } from "@/lib/utils";
import { ROLE_LABEL, type GatewayHealthState, type Role, type WifiStatus } from "@/proto/types";
import { set, useStore } from "@/store";
import { adoptNewEndpoint, changeScenario, clearLocalPairing, refreshDevice, refreshPhones, restartGateway, rpc } from "@/store/controller";
import { isLive } from "@/store/logic";

import { useNow } from "../Banners";

const HEALTH_TONE: Record<GatewayHealthState, Tone> = { up: "ok", degraded: "warn", down: "bad" };

/**
 * §10: the one tab with content even when the WS is down, because its core
 * data can come over BLE. Owner sees everything; others read only.
 * Which sections show is §13's table: Online → all; BleOnly → health /
 * network / restart; Unreachable → local only.
 */
export function DeviceTab() {
  const conn = useStore((s) => s.conn);
  const isOwner = useStore((s) => !!s.session?.scopes.includes("admin") || (s.conn === "BleOnly" && s.credential?.role === "owner"));
  const live = isLive(conn);
  const ble = conn === "BleOnly";

  useEffect(() => {
    if (live) void refreshDevice();
  }, [live]);

  return (
    <div className="space-y-6 px-4 pt-2 pb-8">
      {!live && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Bluetooth className="size-3.5" />
          {ble ? "WS 未連線，以下資料來自藍牙" : "連不到狗，只剩本機設定"}
        </p>
      )}
      {(live || ble) && <ThisDog owner={isOwner} live={live} />}
      {(live || ble) && <Health owner={isOwner} />}
      {live && <Phones owner={isOwner} />}
      {(live || ble) && <Network owner={isOwner} />}
      {live && <Safety owner={isOwner} />}
      {live && <License owner={isOwner} />}
      {live && <Plugins owner={isOwner} />}
      {live && <Clips owner={isOwner} />}
      {live && <Diagnostics />}
      <Local />
    </div>
  );
}

function ThisDog({ owner, live }: { owner: boolean; live: boolean }) {
  const device = useStore((s) => s.device);
  const cred = useStore((s) => s.credential);
  const now = useNow(60_000);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");

  const uptime = device ? Math.round((now - device.bootAt) / 60_000) : null;
  return (
    <section className="space-y-2">
      <SectionTitle description="名稱、序號與版本">這隻狗</SectionTitle>
      <Card className="divide-y py-1">
        <Row label="名稱">
          {editing ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={async (e) => {
                e.preventDefault();
                await rpc("device.rename", { name });
                await refreshDevice();
                setEditing(false);
              }}
            >
              <input autoFocus className={cn(inputClass, "h-9 w-36")} value={name} onChange={(e) => setName(e.target.value)} />
              <Button size="sm" type="submit">
                儲存
              </Button>
            </form>
          ) : (
            <>
              {device?.name ?? cred?.dogName ?? "—"}
              {owner && live && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="改名"
                  onClick={() => {
                    setName(device?.name ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil />
                </Button>
              )}
            </>
          )}
        </Row>
        <Row label="序號">
          <span className="font-mono text-[12px]">{device?.serial ?? cred?.serial ?? "—"}</span>
        </Row>
        <Row label="版本" sub={device ? `小腦 ${device.versions.cerebellum} · Gateway ${device.versions.gateway}` : "藍牙 Identity 只帶韌體版本"}>
          App {device?.versions.app ?? "0.1.0-mock"}
        </Row>
        {uptime !== null && <Row label="運行時間">{`${Math.floor(uptime / 60)} 小時 ${uptime % 60} 分`}</Row>}
      </Card>
    </section>
  );
}

function Health({ owner }: { owner: boolean }) {
  const device = useStore((s) => s.device);
  const health = useStore((s) => s.gatewayHealth);
  const restartingUntil = useStore((s) => s.restartingUntil);
  const live = useStore((s) => isLive(s.conn));
  const now = useNow(500);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    setHolding(true);
    timer.current = setTimeout(() => {
      setHolding(false);
      navigator.vibrate?.(40);
      void restartGateway();
    }, 2000);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <section className="space-y-2">
      <SectionTitle description="Gateway 與各服務">健康</SectionTitle>
      <Card className="divide-y py-1">
        <Row label="Gateway" sub={health.lastError}>
          <Pill tone={HEALTH_TONE[health.state]}>{health.state}</Pill>
        </Row>
        {live &&
          device?.services.map((s) => (
            <Row key={s.name} label={<span className="font-mono text-[13px]">{s.name}</span>}>
              <Pill tone={HEALTH_TONE[s.state]}>{s.state}</Pill>
            </Row>
          ))}
        {live && device && (
          <Row label="CPU · 溫度 · 儲存">
            {device.cpu}% · {device.tempC}°C · {device.storagePct}%
          </Row>
        )}
      </Card>
      {owner && (
        <>
          <button
            disabled={!!restartingUntil}
            onPointerDown={start}
            onPointerUp={cancel}
            onPointerLeave={cancel}
            onContextMenu={(e) => e.preventDefault()}
            className="bg-card relative flex h-12 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl border text-[14px] font-medium select-none disabled:cursor-default"
          >
            {holding && <span aria-hidden className="bg-status-error/20 absolute inset-0 origin-left" style={{ animation: "hold-fill 2000ms linear forwards" }} />}
            <span className="relative flex items-center gap-2">
              {restartingUntil ? <RefreshCw className="size-4 animate-spin" /> : <Power className="size-4" />}
              {restartingUntil
                ? `重啟中 · ${Math.max(0, Math.ceil((restartingUntil - now) / 1000))} 秒`
                : holding
                  ? "繼續按住…"
                  : "長按 2 秒重啟 Gateway"}
            </span>
          </button>
          <p className="text-muted-foreground text-xs">重啟指令一律經藍牙送出並由本機 Owner 金鑰簽名，連線正常時也一樣。</p>
        </>
      )}
    </section>
  );
}

function Phones({ owner }: { owner: boolean }) {
  const phones = useStore((s) => s.phones);
  const [revoking, setRevoking] = useState<string | null>(null);
  const target = phones.find((p) => p.id === revoking);

  return (
    <section className="space-y-2">
      <SectionTitle description="信任單位是手機的公鑰，不是帳號">已配對手機 · {phones.length}</SectionTitle>
      <Card className="divide-y py-1">
        {phones.map((p) => (
          <div key={p.id} className="flex min-h-14 items-center gap-3 py-2">
            <span className="bg-muted relative grid size-9 shrink-0 place-items-center rounded-full">
              <Smartphone className="size-4" />
              {p.online && <span className="bg-status-ok ring-card absolute right-0 bottom-0 size-2.5 rounded-full ring-2" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px]">{p.nickname}</p>
              <p className="text-muted-foreground text-xs">
                {p.pending ? "等待核准" : p.online ? "在線" : `最後連線 ${formatClock(p.lastSeen)}`}
              </p>
            </div>
            {p.pending && owner ? (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={async () => { await rpc("device.approve", { phoneId: p.id, approve: false }); await refreshPhones(); }}>
                  拒絕
                </Button>
                <Button size="sm" onClick={async () => { await rpc("device.approve", { phoneId: p.id, approve: true }); await refreshPhones(); }}>
                  核准
                </Button>
              </div>
            ) : owner && !p.mine && p.role !== "owner" ? (
              <div className="flex items-center gap-1">
                <Select<Role>
                  label="角色"
                  className="h-9 w-28 text-[13px]"
                  value={p.role}
                  options={[
                    { value: "operator", label: "Operator" },
                    { value: "viewer", label: "Viewer" },
                  ]}
                  onChange={async (role) => {
                    await rpc("device.setRole", { phoneId: p.id, role });
                    await refreshPhones();
                  }}
                />
                <Button size="sm" variant="ghost" className="text-status-error" onClick={() => setRevoking(p.id)}>
                  撤銷
                </Button>
              </div>
            ) : (
              <Pill tone={p.mine ? "busy" : "neutral"}>{ROLE_LABEL[p.role]}{p.mine ? " · 本機" : ""}</Pill>
            )}
          </div>
        ))}
      </Card>
      <Modal open={!!target} onClose={() => setRevoking(null)}>
        <p className="text-lg font-semibold">撤銷「{target?.nickname}」？</p>
        <p className="text-muted-foreground mt-1 text-sm">立即生效。對方的連線會被關閉並清除本機憑證，要再使用必須重新配對。</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" onClick={() => setRevoking(null)}>
            取消
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            onClick={async () => {
              const id = revoking!;
              setRevoking(null);
              await rpc("device.revoke", { phoneId: id });
              await refreshPhones();
              toast.success("已撤銷");
            }}
          >
            撤銷
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function Network({ owner }: { owner: boolean }) {
  const device = useStore((s) => s.device);
  const cred = useStore((s) => s.credential);
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2">
      <SectionTitle description="狗目前連的 Wi-Fi">網路</SectionTitle>
      <Card className="divide-y py-1">
        <Row label="Wi-Fi" sub={device?.network.ip ?? cred?.endpoint?.ip ?? "尚未設定"}>
          {device?.network.ssid ?? (cred?.endpoint ? "—" : "未設定")}
        </Row>
        {device && <Row label="訊號">{device.network.signal} dBm</Row>}
        <Row label="SoftAP 備援" sub="v1 只留入口">
          <Switch disabled checked={false} />
        </Row>
      </Card>
      {owner && (
        <Button variant="outline" className="h-11 w-full" onClick={() => setOpen(true)}>
          <Wifi />
          換 Wi-Fi（經藍牙）
        </Button>
      )}
      <WifiModal open={open} onClose={() => setOpen(false)} />
    </section>
  );
}

function WifiModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [ssid, setSsid] = useState("SyncAI-Office");
  const [psk, setPsk] = useState("");
  const [status, setStatus] = useState<WifiStatus | null>(null);

  const submit = async () => {
    const link = getDogLink();
    for await (const s of link.ble.provisionWifi(ssid, psk)) {
      setStatus(s);
      if (s === "connected") await adoptNewEndpoint();
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <p className="mb-4 text-lg font-semibold">換 Wi-Fi</p>
      <div className="space-y-3">
        <Field label="SSID">
          <input className={inputClass} value={ssid} onChange={(e) => setSsid(e.target.value)} />
        </Field>
        <Field label="密碼" error={status === "auth_failed" ? "密碼錯誤" : status === "not_found" ? "找不到這個網路" : undefined}>
          <input className={inputClass} type="password" value={psk} onChange={(e) => setPsk(e.target.value)} />
        </Field>
        {status === "connecting" && <p className="text-muted-foreground text-sm">狗正在連線…</p>}
        {status === "connected" && <p className="text-status-ok text-sm">已連上。WS 會自動改用新的端點。</p>}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" onClick={onClose}>
          {status === "connected" ? "完成" : "取消"}
        </Button>
        <Button className="h-11" loading={status === "connecting"} disabled={status === "connected"} onClick={() => void submit()}>
          送出
        </Button>
      </div>
    </Modal>
  );
}

function Safety({ owner }: { owner: boolean }) {
  const safety = useStore((s) => s.device?.safety);
  if (!safety) return null;
  const patch = async (p: Partial<typeof safety>) => {
    await rpc("device.setSafety", p);
    await refreshDevice();
  };
  return (
    <section className="space-y-2">
      <SectionTitle description="Operator 只能在這些限制內操作">安全</SectionTitle>
      <Card className="divide-y py-1">
        <div className="py-2">
          <div className="flex items-center justify-between text-[14px]">
            全域速度上限
            <span className="font-semibold tabular-nums">{safety.speedLimit.toFixed(1)} m/s</span>
          </div>
          {owner && <Slider label="全域速度上限" min={0.2} max={1.5} step={0.1} value={safety.speedLimit} onChange={(v) => void patch({ speedLimit: v })} />}
          <p className="text-muted-foreground text-xs">Operator 只能在這個上限內調整操控速度。</p>
        </div>
        <Row label="圍欄外行為">
          {owner ? (
            <Select
              label="圍欄外行為"
              className="h-9 w-32 text-[13px]"
              value={safety.outsideFence}
              options={[
                { value: "stop", label: "原地停止" },
                { value: "return", label: "退回圍欄內" },
                { value: "alert", label: "只發警報" },
              ]}
              onChange={(outsideFence) => void patch({ outsideFence })}
            />
          ) : (
            { stop: "原地停止", return: "退回圍欄內", alert: "只發警報" }[safety.outsideFence]
          )}
        </Row>
        <Row label="E-Stop 後自動趴下">
          {owner ? (
            <Select
              label="E-Stop 後自動趴下秒數"
              className="h-9 w-24 text-[13px]"
              value={String(safety.estopLieSec)}
              options={["0", "3", "5", "10"].map((v) => ({ value: v, label: `${v} 秒` }))}
              onChange={(v) => void patch({ estopLieSec: Number(v) })}
            />
          ) : (
            `${safety.estopLieSec} 秒`
          )}
        </Row>
      </Card>
    </section>
  );
}

function License({ owner }: { owner: boolean }) {
  const device = useStore((s) => s.device);
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!device) return null;
  const days = Math.ceil((device.licenseExpiresAt - now) / 86_400_000);
  const none = device.licenseEdition === "none";

  const activate = async () => {
    setBusy(true);
    const r = await rpc("license.activate", { key });
    setBusy(false);
    if (!r) return;
    if (!r.ok) return setError(ACTIVATION_ERROR[r.reason]);
    await refreshDevice();
    setOpen(false);
    setKey("");
    toast.success(`License 已啟用 · ${EDITION_LABEL[r.license.edition]}`);
  };

  return (
    <section className="space-y-2">
      <SectionTitle description="決定這隻狗開啟哪些功能">License</SectionTitle>
      <Card className="divide-y py-1">
        <Row label="版本" sub={device.licenseKeyMasked ?? "尚未輸入金鑰"}>
          <Pill tone={none ? "warn" : "ok"}>{EDITION_LABEL[device.licenseEdition]}</Pill>
        </Row>
        {device.license.map((l) => (
          <Row key={l.feature} label={FEATURE_LABEL[l.feature]}>
            <Pill tone={l.granted ? "ok" : "neutral"}>{l.granted ? "已授權" : "未授權"}</Pill>
          </Row>
        ))}
        {!none && (
          <Row label="到期日" sub={days <= 7 ? `${days} 天後到期` : undefined}>
            <span className={cn(days <= 7 && "text-severity-warning font-semibold")}>{new Date(device.licenseExpiresAt).toLocaleDateString("zh-TW")}</span>
          </Row>
        )}
      </Card>
      {owner && (
        <Button variant={none ? "default" : "outline"} className="h-11 w-full" onClick={() => setOpen(true)}>
          <KeyRound />
          {none ? "輸入 License 金鑰" : "更換金鑰"}
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)}>
        <p className="text-lg font-semibold">{none ? "輸入 License 金鑰" : "更換 License 金鑰"}</p>
        <p className="text-muted-foreground mt-1 mb-4 text-sm">4 組、每組 4 個英數字，可以整串貼上。</p>
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
        {error && <p className="text-status-error mt-2 text-[13px]">{error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button className="h-11" disabled={!isCompleteKey(key)} loading={busy} onClick={() => void activate()}>
            啟用
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function Plugins({ owner }: { owner: boolean }) {
  const plugins = useStore((s) => s.device?.plugins);
  return (
    <section className="space-y-2">
      <SectionTitle description="已安裝的擴充功能">Plugins</SectionTitle>
      <Card className="divide-y py-1">
        {(plugins ?? []).map((p) => (
          <div key={p.id} className="flex min-h-14 items-center gap-3 py-2">
            <span className="bg-primary/10 text-primary-accent grid size-9 shrink-0 place-items-center rounded-lg">
              <FlaskConical className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px]">
                {p.name} <span className="text-muted-foreground text-xs">v{p.version}</span>
              </p>
              <p className="text-muted-foreground truncate font-mono text-[11px]">{p.capabilities.join(" · ")}</p>
            </div>
            <Switch
              aria-label={`啟用 ${p.name}`}
              checked={p.enabled}
              disabled={!owner}
              onCheckedChange={async (enabled) => {
                await rpc("device.setPlugin", { id: p.id, enabled });
                await refreshDevice();
              }}
            />
          </div>
        ))}
      </Card>
      {owner && (
        <Button variant="outline" className="h-11 w-full" disabled>
          <Upload />
          上傳 plugin（驗簽在狗端）
        </Button>
      )}
    </section>
  );
}

function Clips({ owner }: { owner: boolean }) {
  const clips = useStore((s) => s.device?.clips);
  return (
    <section className="space-y-2">
      <SectionTitle description="從狗喇叭播放的預錄音檔">廣播音檔</SectionTitle>
      <Card className="divide-y py-1">
        {(clips ?? []).map((c) => (
          <Row key={c.id} label={c.name}>
            <span className="text-muted-foreground text-xs">{c.sec}s</span>
          </Row>
        ))}
      </Card>
      {owner && (
        <Button variant="outline" className="h-11 w-full" disabled>
          <Upload />
          上傳音檔（格式待定）
        </Button>
      )}
    </section>
  );
}

function Diagnostics() {
  const [events, setEvents] = useState<Awaited<ReturnType<typeof loadEvents>>>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setEvents(await loadEvents());
    setOpen(true);
  };

  return (
    <section className="space-y-2">
      <SectionTitle description="系統事件與日誌匯出">診斷</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-11" onClick={() => void load()}>
          最近 200 條事件
        </Button>
        <Button
          variant="outline"
          className="h-11"
          onClick={async () => {
            const e = await loadEvents();
            const blob = new Blob([JSON.stringify(e, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `syncai-diag-${Date.now()}.json`;
            a.click();
          }}
        >
          <Download />
          匯出日誌
        </Button>
      </div>
      {open && (
        <Card className="max-h-72 space-y-1 overflow-y-auto">
          {events.length === 0 && <p className="text-muted-foreground text-sm">沒有事件</p>}
          {events.map((e) => (
            <p key={e.id} className="flex gap-2 text-[12px]">
              <span className="text-muted-foreground shrink-0 tabular-nums">{formatClock(e.at)}</span>
              <span className={cn(e.level === "critical" ? "text-status-error" : e.level === "warning" ? "text-severity-warning" : "")}>{e.text}</span>
            </p>
          ))}
        </Card>
      )}
    </section>
  );
}

async function loadEvents() {
  return (await rpc("diag.events", undefined)) ?? [];
}

/** §10 本機 — plus the hidden dev menu: tap the version five times. */
function Local() {
  const [confirm, setConfirm] = useState(false);
  const [taps, setTaps] = useState(0);
  const scenario = useStore((s) => s.scenario);
  const dev = taps >= 5;
  return (
    <section className="space-y-2">
      <SectionTitle description="這支手機上的配對資料">本機</SectionTitle>
      <Card className="divide-y py-1">
        <button className="w-full cursor-default text-left" onClick={() => setTaps((t) => t + 1)}>
          <Row label="App 版本">0.1.0-mock</Row>
        </button>
      </Card>
      <Button variant="outline" className="text-status-error h-11 w-full" onClick={() => setConfirm(true)}>
        清除本機配對資料
      </Button>
      {dev && (
        <Card className="space-y-2">
          <p className="text-[13px] font-semibold">開發選單 · 場景</p>
          <div className="grid grid-cols-2 gap-1.5">
            {SCENARIO_IDS.map((id) => (
              <Button key={id} size="sm" variant={scenario === id ? "default" : "outline"} onClick={() => changeScenario(id)}>
                {SCENARIOS[id].label}
              </Button>
            ))}
          </div>
        </Card>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)}>
        <p className="text-lg font-semibold">清除本機配對資料？</p>
        <p className="text-muted-foreground mt-1 text-sm">這支手機會忘記這隻狗並退回 Onboarding。狗上的配對紀錄要由 Owner 撤銷。</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" onClick={() => setConfirm(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            className="h-11"
            onClick={() => {
              setConfirm(false);
              set({ tab: "teleop" });
              clearLocalPairing();
            }}
          >
            清除
          </Button>
        </div>
      </Modal>
    </section>
  );
}

export function DeviceSummary() {
  const device = useStore((s) => s.device);
  const health = useStore((s) => s.gatewayHealth.state);
  return (
    <span>
      {device?.name ?? "這隻狗"} · Gateway {health}
    </span>
  );
}
