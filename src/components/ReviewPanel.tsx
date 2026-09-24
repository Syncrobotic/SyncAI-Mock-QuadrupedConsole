"use client";
// Reads the mock world's mutable fields directly (dev tooling), which the
// compiler would memoize into stale values.
"use no memo";

import { FlaskConical, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useState } from "react";

import { mockWorld } from "@/link";
import { SCENARIOS, SCENARIO_IDS } from "@/link/mock/scenarios";
import { EVENT_TYPES } from "@/lib/rules";
import { cn } from "@/lib/utils";

import type { EventType } from "@/proto/types";
import { useStore, type DeviceId } from "@/store";

/** Devices the desktop frame can imitate — cutout, bars and safe areas. */
const DEVICES: [DeviceId, string][] = [
  ["iphone16pro", "iPhone 16 Pro"],
  ["iphonese", "iPhone SE"],
  ["pixel9", "Pixel 9"],
  ["galaxys24", "Galaxy S24"],
  ["none", "無"],
];
import { changeScenario, clearLocalPairing, refreshDevice, refreshPhones, rpc } from "@/store/controller";
import { CONN_LABEL, MODE_LABEL } from "@/store/logic";

/**
 * Design-review panel — desktop only, outside the phone. Not part of the
 * product: on a device the same switches live in the device tab's hidden dev
 * menu (§12 Mock 注入). Styled as the dashboard's command strip so it reads
 * as tooling, not as app UI.
 */
export function ReviewPanel() {
  const conn = useStore((s) => s.conn);
  const mode = useStore((s) => s.telemetry?.mode);
  const role = useStore((s) => s.session?.role ?? s.credential?.role);
  const [, force] = useState(0);
  const scenario = useStore((s) => s.scenario);
  const landscape = useStore((s) => s.forceLandscape);
  const device = useStore((s) => s.phoneModel);
  const mockHints = useStore((s) => s.mockHints);
  const world = mockWorld();
  const { theme, setTheme } = useTheme();

  const act = (fn: () => void) => () => {
    fn();
    force((n) => n + 1);
  };

  return (
    <aside className="bg-plate relative hidden max-h-[844px] w-[300px] shrink-0 flex-col overflow-hidden rounded-xl border border-white/8 text-white shadow-lg lg:flex">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-violet-500/60 to-transparent" />
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FlaskConical className="size-4 text-violet-300" />
          Mock 審查面板
        </p>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="grid size-8 cursor-pointer place-items-center rounded-md text-white/60 hover:bg-white/8 hover:text-white"
          aria-label="切換深淺色"
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>

      <div className="scrollbar-none flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-3 gap-2">
          <Readout label="連線" value={CONN_LABEL[conn]} sub={conn} />
          <Readout label="狗" value={mode ? MODE_LABEL[mode] : "—"} sub={mode ?? "no telemetry"} />
          <Readout label="角色" value={role ?? "—"} sub="scopes" />
        </div>

        <Group title="預覽">
          <div className="mb-2 grid grid-cols-5 gap-1">
            {DEVICES.map(([id, label]) => (
              <button
                key={id}
                onClick={() => useStore.setState({ phoneModel: id })}
                aria-pressed={device === id}
                className={cn(
                  "h-9 cursor-pointer rounded-md px-1 text-[11px] leading-tight transition-colors",
                  device === id ? "bg-violet-500/25 text-white ring-1 ring-violet-400/50" : "bg-white/5 text-white/60 hover:bg-white/10"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Toggle label="橫式" on={landscape} onChange={() => useStore.setState({ forceLandscape: !landscape })} />
          <Toggle label="手機上顯示 MOCK 提示" on={mockHints} onChange={() => useStore.setState({ mockHints: !mockHints })} />
        </Group>

        <Group title="場景 ?scenario=">
          <div className="space-y-1">
            {SCENARIO_IDS.map((id) => (
              <button
                key={id}
                onClick={act(() => changeScenario(id))}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                  scenario === id ? "bg-violet-500/20 ring-1 ring-violet-400/40" : "hover:bg-white/6"
                )}
              >
                <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", scenario === id ? "bg-violet-300" : "bg-white/25")} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">
                    {SCENARIOS[id].label} <span className="font-mono text-[11px] text-white/40">{id}</span>
                  </span>
                  <span className="block text-[11px] text-white/45">{SCENARIOS[id].verifies}</span>
                </span>
              </button>
            ))}
          </div>
        </Group>

        {world && (
          <Group title="觸發">
            <div className="grid grid-cols-2 gap-1.5">
              <Action onClick={act(() => world.fire("estop_remote"))}>遠端 E-Stop</Action>
              <Action onClick={act(() => world.fire("gateway_down"))}>Gateway 掛掉</Action>
              <Action onClick={act(() => world.fire("fault"))}>FAULT 0x42</Action>
              <Action onClick={act(() => world.fire("revoked"))}>撤銷本機</Action>
              <Action onClick={act(() => world.otherPhoneTakesTeleop())}>他機搶操控</Action>
              <Action
                onClick={act(() => {
                  world.grantAllFeatures();
                  void refreshDevice();
                })}
              >
                全功能 License
              </Action>
              <Action
                onClick={act(() => {
                  world.resetAsNewDog();
                  void refreshDevice();
                })}
              >
                清除 License
              </Action>
              <Action
                onClick={act(() => {
                  world.simulateJoinRequest();
                  void refreshPhones();
                })}
              >
                新手機請求加入
              </Action>
            </div>
          </Group>
        )}

        {world && <DetectPanel />}

        {world && (
          <Group title="配對模擬">
            <Toggle label="擁有者手機在線（第二隻狗核准）" on={world.dev.ownerOnline} onChange={act(() => (world.dev.ownerOnline = !world.dev.ownerOnline))} />
            <Toggle label="BLE 不穩（前兩次連線失敗）" on={world.dev.bleFlaky} onChange={act(() => (world.dev.bleFlaky = !world.dev.bleFlaky))} />
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Action onClick={act(() => world.dropBle(10_000))}>藍牙斷線 10 秒</Action>
              <Action onClick={act(() => world.dropBle())}>藍牙斷線（不恢復）</Action>
              <Action onClick={act(() => world.restoreBle())}>恢復藍牙</Action>
              <Action onClick={act(() => (world.dev.locationPermission = "ask"))}>重設位置權限</Action>
              <Action onClick={act(() => (world.dev.locationPermission = "denied"))}>拒絕位置權限</Action>
            </div>
            <Action onClick={act(() => clearLocalPairing())} className="mt-2 w-full">
              清除本機配對 → 重走 Onboarding
            </Action>
          </Group>
        )}

        <Group title="提示">
          <ul className="space-y-1 text-[11px] leading-relaxed text-white/55">
            <li>
              連線不需確認碼；新狗由第一支手機成為擁有者
            </li>
            <li>
              Wi-Fi：<code className="font-mono text-white/80">Lab-fail</code> → 密碼錯；
              <code className="font-mono text-white/80">Warehouse-slow</code> → 25 秒才連上；
              「其他網路」輸入含 <code className="font-mono text-white/80">none</code> → 找不到
            </li>
            <li>
              License 金鑰：<code className="font-mono text-white/80">SYNC-…</code> 專業版、
              <code className="font-mono text-white/80">BASE-…</code> 標準版（無 AI）、
              <code className="font-mono text-white/80">CTRL-…</code> 操控版（只有操控＋地圖）、含
              <code className="font-mono text-white/80">0000</code> 已綁定、
              <code className="font-mono text-white/80">EXPD-…</code> 過期；
              預填的是全功能金鑰，試操控版用 <code className="font-mono text-white/80">CTRL-01AB-2026-DEMO</code>
            </li>
            <li>任務 tab 開編輯器時，在地圖上長按 0.5 秒放航點</li>
            <li>點地圖任一點顯示與狗的直線距離</li>
          </ul>
        </Group>
      </div>
    </aside>
  );
}

function Readout({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-white/4 px-2.5 py-2">
      <p className="text-[11px] tracking-wide text-white/45 uppercase">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-semibold">{value}</p>
      <p className="truncate font-mono text-[11px] text-white/35">{sub}</p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] tracking-wider text-white/40 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Action({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "cursor-pointer rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400/50 focus-visible:outline-none",
        className
      )}
      {...props}
    />
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className="flex w-full cursor-pointer items-center justify-between gap-2 py-1 text-left text-[12px] text-white/75">
      {label}
      <span className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors", on ? "bg-violet-500" : "bg-white/15")}>
        <span className={cn("absolute top-0.5 size-3 rounded-full bg-white transition-[left]", on ? "left-3.5" : "left-0.5")} />
      </span>
    </button>
  );
}

const AI_TYPES: EventType[] = ["person", "intrusion", "fall", "smoke", "abandoned", "door_open", "thermal"];

/** Put a detection into the world as if perceptiond saw it — drives the rule engine end to end. */
function DetectPanel() {
  const zones = useStore((s) => s.plan?.zones) ?? [];
  const [type, setType] = useState<EventType>("person");
  const [zone, setZone] = useState("corr-s");
  const [conf, setConf] = useState(0.9);
  const [dur, setDur] = useState(5);
  const sel = "h-8 w-full rounded-md border border-white/10 bg-white/5 px-1.5 text-[12px] text-white";
  return (
    <Group title="模擬 AI 偵測">
      <div className="grid grid-cols-2 gap-1.5">
        <select className={sel} value={type} onChange={(e) => setType(e.target.value as EventType)} aria-label="偵測類型">
          {AI_TYPES.map((t) => (
            <option key={t} value={t}>
              {EVENT_TYPES[t].label}
            </option>
          ))}
        </select>
        <select className={sel} value={zone} onChange={(e) => setZone(e.target.value)} aria-label="區域">
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
        <select className={sel} value={conf} onChange={(e) => setConf(Number(e.target.value))} aria-label="信心">
          {[0.6, 0.75, 0.85, 0.95].map((c) => (
            <option key={c} value={c}>
              信心 {Math.round(c * 100)}%
            </option>
          ))}
        </select>
        <select className={sel} value={dur} onChange={(e) => setDur(Number(e.target.value))} aria-label="持續秒數">
          {[1, 3, 5, 10].map((d) => (
            <option key={d} value={d}>
              持續 {d} 秒
            </option>
          ))}
        </select>
      </div>
      <Action className="mt-1.5 w-full" onClick={() => void rpc("dev.detect", { type, zoneId: zone, confidence: conf, durationSec: dur })}>
        送出偵測
      </Action>
      <p className="mt-1 text-[11px] leading-relaxed text-white/40">範例：「走廊人員查看」要南/北走廊、東側大廳，信心 ≥ 80%、持續 3 秒，會先詢問；「限制區入侵」選資料室或核心區會直接出動（P0）。</p>
    </Group>
  );
}
