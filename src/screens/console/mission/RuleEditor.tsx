"use client";

import { Clock, FlaskConical, Lock, MapPinned, Route, Sparkles, X, Zap } from "lucide-react";
import { useState } from "react";

import { Field, SectionTitle, Segmented, Select, Slider, inputClass } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EVENT_TYPES, MODE_LABEL, PRIORITY, SOURCE_LABEL, canSetPriority, clock, describeTrigger, nextSlots, ruleSentence, toRRule } from "@/lib/rules";
import { estimateMission } from "@/lib/schedule";
import { cn, formatDuration } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import { useStore } from "@/store";

import { PriorityPill } from "./rule-bits";
import { closeRuleEditor, patchRule, patchTrigger, ruleProblems, saveRule, setTriggerKind, testRule } from "./rule-state";

import type { EventSource, EventTrigger, EventType, Priority, Rule, Schedule, TimeTrigger } from "@/proto/types";

/**
 * The rule editor reads as a sentence (design doc §9):
 *   當 [trigger]  就 [mission]  怎麼做 [mode]  優先與衝突 [priority, preemption, throttle]
 * with the whole sentence restated live at the top, so what you are building
 * is always one line you can read back.
 */
export function RuleEditor() {
  const editor = useStore((s) => s.ruleEditor)!;
  const missions = useStore((s) => s.missions);
  const zones = useStore((s) => s.plan?.zones);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const r = editor.draft;
  const mission = missions.find((m) => m.id === r.missionId);
  const zoneName = (id: string) => zones?.find((z) => z.id === id)?.name ?? id;
  const problems = ruleProblems(r);

  return (
    <div className="flex min-h-full flex-col">
      <div className="bg-surface sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-1">
        <Button size="icon" variant="ghost" onClick={closeRuleEditor} aria-label="取消編輯">
          <X />
        </Button>
        <p className="flex-1 truncate text-[14px] font-semibold">{editor.isNew ? "新規則" : "編輯規則"}</p>
        <Button
          loading={saving}
          disabled={problems.length > 0}
          onClick={async () => {
            setSaving(true);
            await saveRule();
            setSaving(false);
          }}
        >
          儲存
        </Button>
      </div>

      <div className="space-y-5 px-3 pt-3 pb-8">
        {/* The sentence, live. */}
        <div className="bg-primary/8 border-primary/25 space-y-1.5 rounded-xl border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <PriorityPill p={r.priority} />
            <input
              aria-label="規則名稱"
              className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none"
              value={r.name}
              onChange={(e) => patchRule({ name: e.target.value })}
            />
            <Switch aria-label="啟用" checked={r.enabled} onCheckedChange={(enabled) => patchRule({ enabled })} />
          </div>
          <p className="text-muted-foreground text-[12px] leading-relaxed">{ruleSentence(r, mission?.name ?? "（未選任務）", zoneName)}</p>
          {problems.map((p) => (
            <p key={p} className="text-status-error text-[12px]">
              {p}
            </p>
          ))}
        </div>

        {/* 當 */}
        <section className="space-y-3">
          <SectionTitle description="時間到了，或發生某件事">當</SectionTitle>
          <Segmented
            value={r.trigger.kind}
            options={[
              { value: "time", label: <span className="flex items-center justify-center gap-1.5"><Clock className="size-3.5" />時間</span> },
              { value: "event", label: <span className="flex items-center justify-center gap-1.5"><Zap className="size-3.5" />事件</span> },
            ]}
            onChange={setTriggerKind}
          />
          {r.trigger.kind === "time" ? <TimeEditor t={r.trigger} ruleId={r.id} /> : <EventEditor t={r.trigger} />}
        </section>

        {/* 就 */}
        <section className="space-y-2">
          <SectionTitle description={r.trigger.kind === "event" ? "事件回應會前往事件發生的位置" : "巡邏路線任務"}>就執行</SectionTitle>
          <div className="space-y-1.5">
            {missions
              .filter((m) => r.trigger.kind === "event" || m.kind === "patrol")
              .sort((a, b) => (r.trigger.kind === "event" ? (a.kind === "response" ? -1 : 1) - (b.kind === "response" ? -1 : 1) : 0))
              .map((m) => {
                const est = estimateMission(m);
                const on = m.id === r.missionId;
                const unfit = m.kind === "response" && (r.trigger.kind === "time" || !EVENT_TYPES[(r.trigger as EventTrigger).type].located);
                return (
                  <button
                    key={m.id}
                    disabled={unfit}
                    onClick={() => patchRule({ missionId: m.id })}
                    aria-pressed={on}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                      on ? "border-primary bg-primary/10" : "bg-card hover:bg-accent"
                    )}
                  >
                    {m.kind === "response" ? <MapPinned className="text-primary-accent size-4 shrink-0" /> : <Route className="text-muted-foreground size-4 shrink-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{m.name}</span>
                      <span className="text-muted-foreground block text-[11px]">
                        {m.kind === "response" ? `前往事件位置 · ${m.response.actions.length} 個動作` : `${m.route.length} 個航點`} · 約 {formatDuration(est.sec)} · 耗電 {est.batteryPct.toFixed(0)}%
                      </span>
                    </span>
                    <span className={cn("size-4 shrink-0 rounded-full border-2", on ? "border-primary bg-primary shadow-[inset_0_0_0_2px_var(--card)]" : "border-muted-foreground/40")} />
                  </button>
                );
              })}
          </div>
        </section>

        {/* 怎麼做 */}
        <section className="space-y-2.5">
          <SectionTitle description="會對現場造成影響的動作，建議先確認">怎麼做</SectionTitle>
          <Segmented
            value={r.mode}
            options={(["auto", "confirm", "notify"] as const).map((v) => ({ value: v, label: MODE_LABEL[v] }))}
            onChange={(mode) => patchRule({ mode })}
          />
          <p className="text-muted-foreground text-[11px]">
            {r.mode === "auto" ? "觸發後直接出動。" : r.mode === "confirm" ? "推送到在線的手機詢問，核准後出動。" : "只記錄並通知，狗不會移動。適合調整門檻期間使用。"}
          </p>
          {r.mode === "confirm" && (
            <div className="bg-card space-y-2 rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between text-[13px]">
                等待回應
                <span className="font-semibold tabular-nums">{r.confirmTimeoutSec} 秒</span>
              </div>
              <Slider label="等待回應秒數" min={10} max={120} step={5} value={r.confirmTimeoutSec} onChange={(confirmTimeoutSec) => patchRule({ confirmTimeoutSec })} />
              <div className="flex items-center justify-between gap-3 text-[13px]">
                沒人回應時
                <Segmented
                  className="w-40"
                  value={r.onTimeout}
                  options={[
                    { value: "run", label: "執行" },
                    { value: "cancel", label: "取消" },
                  ]}
                  onChange={(onTimeout) => patchRule({ onTimeout })}
                />
              </div>
              <p className="text-muted-foreground text-[11px]">沒有雲端：只有連在同一個區網的手機會收到詢問。</p>
            </div>
          )}
        </section>

        {/* 優先與衝突 */}
        <PrioritySection r={r} />

        {/* Dry run */}
        <section className="space-y-2">
          <SectionTitle description="用狗現在的狀態走一遍決策，狗不會移動">模擬觸發</SectionTitle>
          <Button
            variant="outline"
            className="w-full"
            loading={testing}
            onClick={async () => {
              setTesting(true);
              await testRule(r);
              setTesting(false);
            }}
          >
            <FlaskConical />
            現在觸發會怎樣？
          </Button>
          {editor.verdict && <p className="bg-surface-sunken rounded-lg border px-3 py-2 text-[13px]">{editor.verdict}</p>}
        </section>
      </div>
    </div>
  );
}

// ── Time ─────────────────────────────────────────────────────────────────────

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function TimeEditor({ t, ruleId }: { t: TimeTrigger; ruleId: string }) {
  const s = t.schedule;
  const [advanced, setAdvanced] = useState(false);
  const setSchedule = (schedule: Schedule) => patchTrigger({ schedule });
  const time = s.type === "daily" || s.type === "weekly" ? s.time : "22:00";
  const now = useNow(30_000);
  const upcoming = nextSlots(s, now, 3);

  return (
    <div className="space-y-3">
      <Segmented
        value={s.type}
        options={[
          { value: "interval", label: "時段間隔" },
          { value: "daily", label: "每日" },
          { value: "weekly", label: "每週" },
          { value: "once", label: "單次" },
        ]}
        onChange={(type) =>
          setSchedule(
            type === "interval"
              ? { type, minutes: 60, window: { from: "22:00", to: "06:00" } }
              : type === "daily"
                ? { type, time }
                : type === "weekly"
                  ? { type, days: [1, 2, 3, 4, 5], time }
                  : { type, at: Date.now() + 3_600_000 }
          )
        }
      />

      {s.type === "interval" && (
        <div className="bg-card space-y-2 rounded-lg border px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            每隔
            <Select
              label="間隔"
              className="w-28"
              value={String(s.minutes)}
              options={[15, 20, 30, 45, 60, 90, 120, 180].map((m) => ({ value: String(m), label: `${m} 分鐘` }))}
              onChange={(v) => setSchedule({ ...s, minutes: Number(v) })}
            />
          </div>
          <WindowRow window={s.window} onChange={(window) => setSchedule({ ...s, window })} label="只在這個時段內" />
        </div>
      )}
      {(s.type === "daily" || s.type === "weekly") && (
        <div className="bg-card space-y-2 rounded-lg border px-3 py-2">
          {s.type === "weekly" && (
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, d) => {
                const on = s.days.includes(d);
                return (
                  <button
                    key={d}
                    aria-pressed={on}
                    onClick={() => setSchedule({ ...s, days: on ? s.days.filter((x) => x !== d) : [...s.days, d].sort() })}
                    className={cn("h-9 cursor-pointer rounded-md border text-[12px] font-medium", on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent")}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between text-[13px]">
            時間（狗的時鐘）
            <input className={cn(inputClass, "h-9 w-28")} type="time" value={s.time} onChange={(e) => setSchedule({ ...s, time: e.target.value })} />
          </div>
        </div>
      )}
      {s.type === "once" && (
        <Field label="執行時間">
          <input className={inputClass} type="datetime-local" value={toLocalInput(s.at)} onChange={(e) => setSchedule({ type: "once", at: new Date(e.target.value).getTime() })} />
        </Field>
      )}

      {s.type !== "once" && (
        <div className="bg-card space-y-1 rounded-lg border px-3 py-2">
          <div className="flex items-center justify-between text-[13px]">
            <span>
              隨機偏移
              <span className="text-muted-foreground ml-1.5 text-[11px]">讓巡邏時間不可預測</span>
            </span>
            <span className="font-semibold tabular-nums">{t.jitterMin ? `±${t.jitterMin} 分` : "關"}</span>
          </div>
          <Slider label="隨機偏移" min={0} max={30} step={1} value={t.jitterMin} onChange={(jitterMin) => patchTrigger({ jitterMin })} />
        </div>
      )}

      <div className="bg-card space-y-2 rounded-lg border px-3 py-2">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          時間到時狗無法執行
          <Segmented
            className="w-40"
            value={t.missed}
            options={[
              { value: "catch_up", label: "稍後補跑" },
              { value: "skip", label: "跳過" },
            ]}
            onChange={(missed) => patchTrigger({ missed })}
          />
        </div>
        {t.missed === "catch_up" && (
          <div className="flex items-center justify-between gap-3 text-[13px]">
            最多延後
            <Select label="補跑寬限" className="w-28" value={String(t.graceMin)} options={[5, 15, 30, 60].map((m) => ({ value: String(m), label: `${m} 分鐘` }))} onChange={(v) => patchTrigger({ graceMin: Number(v) })} />
          </div>
        )}
      </div>

      {upcoming.length > 0 && (
        <p className="text-muted-foreground text-[12px]">
          接下來：{upcoming.map((x) => clock(x)).join("、")}
          {t.jitterMin ? `（各自 ±${t.jitterMin} 分）` : ""}
        </p>
      )}
      <button onClick={() => setAdvanced((a) => !a)} className="text-muted-foreground cursor-pointer text-[11px] underline-offset-2 hover:underline">
        {advanced ? "隱藏進階" : "進階"}
      </button>
      {advanced && (
        <code className="bg-muted block rounded-md px-3 py-2 font-mono text-[11px] break-all">
          {toRRule(s)} · rule={ruleId}
        </code>
      )}
    </div>
  );
}

function WindowRow({ window, onChange, label }: { window: { from: string; to: string } | null; onChange: (w: { from: string; to: string } | null) => void; label: string }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center justify-between text-[13px]">
        {label}
        <Switch checked={!!window} onCheckedChange={(on) => onChange(on ? { from: "22:00", to: "06:00" } : null)} />
      </label>
      {window && (
        <div className="flex items-center gap-2">
          <input aria-label="開始" className={cn(inputClass, "h-9")} type="time" value={window.from} onChange={(e) => onChange({ ...window, from: e.target.value })} />
          <span className="text-muted-foreground">–</span>
          <input aria-label="結束" className={cn(inputClass, "h-9")} type="time" value={window.to} onChange={(e) => onChange({ ...window, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Event ────────────────────────────────────────────────────────────────────

function EventEditor({ t }: { t: EventTrigger }) {
  const zones = useStore((s) => s.plan?.zones) ?? [];
  const aiLicensed = useStore((s) => s.device?.license.find((l) => l.feature === "ai")?.granted ?? false);
  const info = EVENT_TYPES[t.type];
  const types = (Object.keys(EVENT_TYPES) as EventType[]).filter((k) => EVENT_TYPES[k].source === t.source);

  return (
    <div className="space-y-3">
      {/* Source */}
      <div className="grid grid-cols-4 gap-1.5">
        {(["ai", "system", "sensor", "external"] as EventSource[]).map((src) => {
          const locked = src === "external" || (src === "ai" && !aiLicensed);
          const on = t.source === src;
          return (
            <button
              key={src}
              disabled={locked}
              onClick={() => {
                const first = (Object.keys(EVENT_TYPES) as EventType[]).find((k) => EVENT_TYPES[k].source === src)!;
                patchTrigger({ source: src, type: first, zones: [] });
              }}
              className={cn(
                "relative flex h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-45",
                on ? "border-primary bg-primary/10 text-primary-accent" : "bg-card hover:bg-accent"
              )}
            >
              {src === "ai" && <Sparkles className="size-4" />}
              {src !== "ai" && <Zap className="size-4" />}
              {SOURCE_LABEL[src]}
              {locked && (
                <span className="text-muted-foreground flex items-center gap-0.5 text-[9px]">
                  <Lock className="size-2.5" />
                  {src === "external" ? "第二期" : "未授權"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Type */}
      <div className="grid grid-cols-2 gap-1.5">
        {types.map((k) => (
          <button
            key={k}
            onClick={() => patchTrigger({ type: k })}
            aria-pressed={t.type === k}
            className={cn("cursor-pointer rounded-lg border px-2.5 py-1.5 text-left", t.type === k ? "border-primary bg-primary/10" : "bg-card hover:bg-accent")}
          >
            <span className="block text-[13px] font-medium">{EVENT_TYPES[k].label}</span>
            <span className="text-muted-foreground block text-[10px] leading-tight">{EVENT_TYPES[k].hint}</span>
          </button>
        ))}
      </div>

      {/* Where */}
      {info.located && (
        <div className="space-y-1.5">
          <p className="text-[13px]">
            在哪裡
            <span className="text-muted-foreground ml-1.5 text-[11px]">{t.zones.length ? `${t.zones.length} 個區域` : "全部區域"}</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Chip on={t.zones.length === 0} onClick={() => patchTrigger({ zones: [] })}>
              全部
            </Chip>
            {zones.map((z) => (
              <Chip key={z.id} on={t.zones.includes(z.id)} onClick={() => patchTrigger({ zones: t.zones.includes(z.id) ? t.zones.filter((x) => x !== z.id) : [...t.zones, z.id] })}>
                {z.name}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {/* §4.2 false-positive guards — on by default for AI */}
      {info.source === "ai" && (
        <div className="bg-card space-y-2.5 rounded-lg border px-3 py-2">
          <p className="text-muted-foreground text-[11px]">防誤報：AI 一定會誤判，以下條件都成立才觸發</p>
          <div>
            <div className="flex items-center justify-between text-[13px]">
              信心至少
              <span className="font-semibold tabular-nums">{Math.round(t.minConfidence * 100)}%</span>
            </div>
            <Slider label="信心門檻" min={0.5} max={0.99} step={0.01} value={t.minConfidence} onChange={(minConfidence) => patchTrigger({ minConfidence })} />
          </div>
          <div className="flex items-center justify-between gap-3 text-[13px]">
            持續出現
            <Select label="持續秒數" className="w-28" value={String(t.persistSec)} options={[0, 1, 2, 3, 5, 10, 30].map((v) => ({ value: String(v), label: v ? `${v} 秒` : "不限" }))} onChange={(v) => patchTrigger({ persistSec: Number(v) })} />
          </div>
          <label className="flex items-center justify-between text-[13px]">
            <span>
              多次出現
              {t.countWithin && <span className="text-muted-foreground ml-1.5 text-[11px]">{t.countWithin.sec} 秒內 {t.countWithin.n} 次</span>}
            </span>
            <Switch checked={!!t.countWithin} onCheckedChange={(on) => patchTrigger({ countWithin: on ? { n: 3, sec: 60 } : null })} />
          </label>
        </div>
      )}

      <div className="bg-card rounded-lg border px-3 py-2">
        <WindowRow window={t.activeWindow} onChange={(activeWindow) => patchTrigger({ activeWindow })} label="只在特定時段生效" />
      </div>
      <p className="text-muted-foreground text-[12px]">{describeTrigger(t, (id) => zones.find((z) => z.id === id)?.name ?? id)}</p>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn("relative h-7 cursor-pointer rounded-full border px-2.5 text-[12px] after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-['']", on ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent")}
    >
      {children}
    </button>
  );
}

// ── Priority & conflicts ─────────────────────────────────────────────────────

function PrioritySection({ r }: { r: Rule }) {
  const owner = useStore((s) => !!s.session?.scopes.includes("admin"));
  return (
    <section className="space-y-2.5">
      <SectionTitle description="一隻狗同時只做一件事：撞在一起時照這裡決定">優先與衝突</SectionTitle>
      <div className="grid grid-cols-4 gap-1.5">
        {([0, 1, 2, 3] as Priority[]).map((p) => {
          const allowed = canSetPriority(p, owner);
          return (
            <button
              key={p}
              disabled={!allowed}
              onClick={() => patchRule({ priority: p })}
              aria-pressed={r.priority === p}
              className={cn(
                "flex h-12 cursor-pointer flex-col items-center justify-center rounded-lg border text-[11px] disabled:cursor-not-allowed disabled:opacity-45",
                r.priority === p ? "border-primary bg-primary/10" : "bg-card hover:bg-accent"
              )}
            >
              <span className="font-bold">{PRIORITY[p].short}</span>
              <span className="text-muted-foreground flex items-center gap-0.5 text-[10px]">
                {!allowed && <Lock className="size-2.5" />}
                {PRIORITY[p].label.split(" ")[1]}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-[11px]">
        {PRIORITY[r.priority].hint}。{!owner && "P0、P1 只有擁有者能建立。"}手動操控永遠優先，規則不會搶走操控權。
      </p>

      <div className="bg-card divide-y rounded-lg border px-3">
        <div className="flex min-h-10 items-center justify-between gap-3 text-[13px]">
          被更高優先級打斷時
          <Select
            label="被打斷時"
            className="w-32"
            value={r.onPreempted}
            options={[
              { value: "resume", label: "從中斷處繼續" },
              { value: "restart", label: "重新開始" },
              { value: "drop", label: "放棄" },
            ]}
            onChange={(onPreempted) => patchRule({ onPreempted })}
          />
        </div>
        <div className="flex min-h-10 items-center justify-between gap-3 text-[13px]">
          <span>
            排隊最多等
            <span className="text-muted-foreground ml-1.5 text-[11px]">太晚到就沒意義</span>
          </span>
          <Select
            label="排隊逾時"
            className="w-24"
            value={String(r.queueTtlSec)}
            options={[60, 300, 900, 1800, 3600].map((v) => ({ value: String(v), label: v < 3600 ? `${v / 60} 分鐘` : "1 小時" }))}
            onChange={(v) => patchRule({ queueTtlSec: Number(v) })}
          />
        </div>
        <div className="py-2">
          <div className="flex items-center justify-between text-[13px]">
            電量至少
            <span className="font-semibold tabular-nums">{r.minBattery}%</span>
          </div>
          <Slider label="最低電量" min={5} max={80} step={5} value={r.minBattery} onChange={(minBattery) => patchRule({ minBattery })} />
        </div>
        <div className="flex min-h-10 items-center justify-between gap-3 text-[13px]">
          <span>
            冷卻時間
            <span className="text-muted-foreground ml-1.5 text-[11px]">觸發後多久內不再觸發</span>
          </span>
          <Select
            label="冷卻時間"
            className="w-24"
            value={String(r.cooldownSec)}
            options={[0, 60, 120, 300, 600, 1800].map((v) => ({ value: String(v), label: v ? `${v / 60} 分鐘` : "無" }))}
            onChange={(v) => patchRule({ cooldownSec: Number(v) })}
          />
        </div>
        <div className="flex min-h-10 items-center justify-between gap-3 text-[13px]">
          每小時最多
          <Select label="每小時上限" className="w-24" value={String(r.maxPerHour)} options={[1, 2, 4, 6, 10, 20].map((v) => ({ value: String(v), label: `${v} 次` }))} onChange={(v) => patchRule({ maxPerHour: Number(v) })} />
        </div>
      </div>
    </section>
  );
}
