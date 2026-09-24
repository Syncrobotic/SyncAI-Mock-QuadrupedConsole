"use client";

import { AnimatePresence, m } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FlaskConical,
  Lock,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";

import {
  Field,
  Modal,
  SectionTitle,
  Segmented,
  Select,
  Slider,
  inputClass,
} from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  EVENT_TYPES,
  MODE_LABEL,
  PRIORITY,
  SOURCE_LABEL,
  canSetPriority,
  clock,
  nextSlots,
  plainRule,
} from "@/lib/rules";
import { estimateMission } from "@/lib/schedule";
import { cn, formatDuration } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import { set, useStore } from "@/store";
import { rpc } from "@/store/controller";

import {
  closeRuleEditor,
  patchRule,
  patchTrigger,
  ruleProblems,
  saveRule,
  setTriggerKind,
  testRule,
} from "./rule-state";

import type { EventTrigger, EventType, Priority, Rule, Schedule, TimeTrigger } from "@/proto/types";

/**
 * The rule editor reads as a sentence (design doc §9):
 *   當 [trigger]  就執行 [route]  怎麼做 [mode]  重要程度 [priority]
 * with the whole sentence restated in plain words at the top. Everything that works at its
 * default (jitter, catch-up, preemption, queue, battery, cooldown, AI guards) is one
 * collapsed 進階設定 — the rule schema keeps every knob; the editor stops leading with them.
 */
export function RuleEditor() {
  // While it slides out after closing, the store's editor is already gone: keep showing
  // the last one instead of reading null.
  const live = useStore((s) => s.ruleEditor);
  const [held, setHeld] = useState(live);
  if (live && live !== held) setHeld(live);
  const editor = (live ?? held)!;
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
      {/* The sheet's scroller has 6 pt of top padding: stuck at top-0, content showed through
          above the bar. It sticks 6 pt higher over the padding and pads itself back down. */}
      <div className="bg-surface sticky -top-1.5 z-10 -mt-1.5 flex items-center gap-2 border-b px-2 pt-2.5 pb-1">
        <Button size="icon" variant="ghost" onClick={closeRuleEditor} aria-label="取消編輯">
          <X />
        </Button>
        <p className="flex-1 truncate text-[14px] font-semibold">
          {editor.isNew ? "新規則" : "編輯規則"}
        </p>
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
            <input
              aria-label="規則名稱"
              className="focus-visible:ring-ring/50 -my-3 min-w-0 flex-1 rounded-sm bg-transparent py-3 text-[14px] font-semibold outline-none focus-visible:ring-2"
              value={r.name}
              onChange={(e) => patchRule({ name: e.target.value })}
            />
            <Switch
              aria-label="啟用"
              checked={r.enabled}
              onCheckedChange={(enabled) => patchRule({ enabled })}
            />
          </div>
          <p className="text-muted-foreground text-[12px] leading-relaxed">
            {plainRule(r, mission?.name ?? "（未選路線）", zoneName)}
          </p>
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
              {
                value: "time",
                label: (
                  <span className="flex items-center justify-center gap-1.5">
                    <Clock className="size-3.5" />
                    時間
                  </span>
                ),
              },
              {
                value: "event",
                label: (
                  <span className="flex items-center justify-center gap-1.5">
                    <Zap className="size-3.5" />
                    事件
                  </span>
                ),
              },
            ]}
            onChange={setTriggerKind}
          />
          {r.trigger.kind === "time" ? <TimeEditor t={r.trigger} /> : <EventEditor t={r.trigger} />}
        </section>

        {/* 就 — one list instead of a card per route: the choice is a name. */}
        <section className="space-y-1.5">
          <SectionTitle>就執行</SectionTitle>
          {(() => {
            const fit = missions.filter((m) => {
              if (m.kind === "patrol") return true;
              return (
                r.trigger.kind === "event" && EVENT_TYPES[(r.trigger as EventTrigger).type].located
              );
            });
            const est = mission ? estimateMission(mission) : null;
            return (
              <>
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  路線
                  <Select
                    label="執行哪條路線"
                    className="w-48"
                    value={r.missionId}
                    options={[
                      ...(mission ? [] : [{ value: r.missionId, label: "選擇路線" }]),
                      ...fit.map((m) => ({
                        value: m.id,
                        label: m.kind === "response" ? `${m.name}（前往事件位置）` : m.name,
                      })),
                    ]}
                    onChange={(missionId) => patchRule({ missionId })}
                  />
                </div>
                {mission && est && (
                  <p className="text-muted-foreground text-[11px] tabular-nums">
                    {mission.kind === "response"
                      ? `前往事件位置 · ${mission.response.actions.length} 個動作`
                      : `${mission.route.length} 個航點`}{" "}
                    · 約 {formatDuration(est.sec)} · 耗電約 {est.batteryPct.toFixed(0)}%
                  </p>
                )}
              </>
            );
          })()}
        </section>

        {/* 怎麼做 */}
        <section className="space-y-2.5">
          <SectionTitle description="會對現場造成影響的動作，建議先確認">怎麼做</SectionTitle>
          <Segmented
            value={r.mode}
            options={(["auto", "confirm", "notify"] as const).map((v) => ({
              value: v,
              label: MODE_LABEL[v],
            }))}
            onChange={(mode) => patchRule({ mode })}
          />
          <p className="text-muted-foreground text-[11px]">
            {r.mode === "auto"
              ? "觸發後直接出動。"
              : r.mode === "confirm"
                ? "推送到在線的手機詢問，核准後出動。"
                : "只記錄並通知，狗不會移動。適合調整門檻期間使用。"}
          </p>
          {r.mode === "confirm" && (
            <div className="bg-card space-y-2 rounded-lg border px-3 py-2">
              <div className="flex items-center justify-between text-[13px]">
                等待回應
                <span className="font-semibold tabular-nums">{r.confirmTimeoutSec} 秒</span>
              </div>
              <Slider
                label="等待回應秒數"
                min={10}
                max={120}
                step={5}
                value={r.confirmTimeoutSec}
                onChange={(confirmTimeoutSec) => patchRule({ confirmTimeoutSec })}
              />
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
              <p className="text-muted-foreground text-[11px]">
                沒有雲端：只有連在同一個區網的手機會收到詢問。
              </p>
            </div>
          )}
        </section>

        {/* 重要程度 */}
        <PrioritySection r={r} />

        <AdvancedSection r={r} />

        {/* Dry run: a question you can ask, not a section. The dog does not move. */}
        <div className="space-y-2">
          <button
            className="text-primary-accent flex min-h-9 cursor-pointer items-center gap-1.5 text-[12px] font-medium disabled:opacity-60"
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              await testRule(r);
              setTesting(false);
            }}
          >
            <FlaskConical className="size-3.5" />
            試跑判斷：現在觸發會怎樣？
          </button>
          {editor.verdict && (
            <p className="bg-surface-sunken rounded-lg border px-3 py-2 text-[13px]">
              {editor.verdict}
            </p>
          )}
        </div>

        {!editor.isNew && <DeleteRule id={r.id} name={r.name} />}
      </div>
    </div>
  );
}

// ── Time ─────────────────────────────────────────────────────────────────────

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function TimeEditor({ t }: { t: TimeTrigger }) {
  const s = t.schedule;
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
              options={[15, 20, 30, 45, 60, 90, 120, 180].map((m) => ({
                value: String(m),
                label: `${m} 分鐘`,
              }))}
              onChange={(v) => setSchedule({ ...s, minutes: Number(v) })}
            />
          </div>
          <WindowRow
            window={s.window}
            onChange={(window) => setSchedule({ ...s, window })}
            label="只在這個時段內"
          />
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
                    onClick={() =>
                      setSchedule({
                        ...s,
                        days: on ? s.days.filter((x) => x !== d) : [...s.days, d].sort(),
                      })
                    }
                    className={cn(
                      "h-9 cursor-pointer rounded-md border text-[12px] font-medium",
                      on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
                    )}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-between text-[13px]">
            時間（狗的時鐘）
            <input
              className={cn(inputClass, "w-28")}
              type="time"
              value={s.time}
              onChange={(e) => setSchedule({ ...s, time: e.target.value })}
            />
          </div>
        </div>
      )}
      {s.type === "once" && (
        <Field label="執行時間">
          <input
            className={inputClass}
            type="datetime-local"
            value={toLocalInput(s.at)}
            onChange={(e) => setSchedule({ type: "once", at: new Date(e.target.value).getTime() })}
          />
        </Field>
      )}

      {upcoming.length > 0 && (
        <p className="text-muted-foreground text-[12px]">
          接下來：{upcoming.map((x) => clock(x)).join("、")}
          {t.jitterMin ? `（各自 ±${t.jitterMin} 分）` : ""}
        </p>
      )}
    </div>
  );
}

function WindowRow({
  window,
  onChange,
  label,
}: {
  window: { from: string; to: string } | null;
  onChange: (w: { from: string; to: string } | null) => void;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center justify-between text-[13px]">
        {label}
        <Switch
          checked={!!window}
          onCheckedChange={(on) => onChange(on ? { from: "22:00", to: "06:00" } : null)}
        />
      </label>
      {window && (
        <div className="flex items-center gap-2">
          {/* The label's 2px padding makes the tap area 44 without a taller field. */}
          <label className="-my-0.5 min-w-0 flex-1 py-0.5">
            <input
              aria-label="開始"
              className={inputClass}
              type="time"
              value={window.from}
              onChange={(e) => onChange({ ...window, from: e.target.value })}
            />
          </label>
          <span className="text-muted-foreground">–</span>
          <label className="-my-0.5 min-w-0 flex-1 py-0.5">
            <input
              aria-label="結束"
              className={inputClass}
              type="time"
              value={window.to}
              onChange={(e) => onChange({ ...window, to: e.target.value })}
            />
          </label>
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

/**
 * What happened, where, and when it counts. The source row and the tile grid of types are one
 * list now; the fifteen zone chips are one line that opens a checklist; the AI false-positive
 * guards are in 進階設定 (their defaults are right for almost every rule).
 */
function EventEditor({ t }: { t: EventTrigger }) {
  const zones = useStore((s) => s.plan?.zones) ?? [];
  const aiLicensed = useStore(
    (s) => s.device?.license.find((l) => l.feature === "ai")?.granted ?? false
  );
  const [picking, setPicking] = useState(false);
  const info = EVENT_TYPES[t.type];
  const usable = (Object.keys(EVENT_TYPES) as EventType[]).filter((k) => {
    const src = EVENT_TYPES[k].source;
    return src !== "external" && (src !== "ai" || aiLicensed);
  });
  const where =
    t.zones.length === 0
      ? "全部區域"
      : t.zones.length <= 2
        ? t.zones.map((id) => zones.find((z) => z.id === id)?.name ?? id).join("、")
        : `${t.zones.length} 個區域`;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3 text-[13px]">
          發生什麼事
          <Select
            label="事件類型"
            className="w-44"
            value={t.type}
            options={usable.map((k) => ({
              value: k,
              label: `${EVENT_TYPES[k].label}（${SOURCE_LABEL[EVENT_TYPES[k].source]}）`,
            }))}
            onChange={(k) => {
              const src = EVENT_TYPES[k].source;
              patchTrigger({ source: src, type: k, zones: EVENT_TYPES[k].located ? t.zones : [] });
            }}
          />
        </div>
        <p className="text-muted-foreground text-[11px]">{info.hint}</p>
      </div>

      {info.located && (
        <button
          onClick={() => setPicking(true)}
          className="bg-card hover:bg-accent flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg border px-3 text-left text-[13px] transition-colors"
        >
          在哪裡
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-right">{where}</span>
          <ChevronRight className="text-muted-foreground size-4 shrink-0" />
        </button>
      )}

      <div className="bg-card rounded-lg border px-3 py-2">
        <WindowRow
          window={t.activeWindow}
          onChange={(activeWindow) => patchTrigger({ activeWindow })}
          label="只在特定時段生效"
        />
      </div>

      <Modal open={picking} onClose={() => setPicking(false)}>
        <p className="mb-2 text-[15px] font-semibold">在哪裡</p>
        <div className="-mx-1 max-h-[50vh] space-y-0.5 overflow-y-auto">
          <ZoneOption
            on={t.zones.length === 0}
            label="全部區域"
            onClick={() => patchTrigger({ zones: [] })}
          />
          {zones.map((z) => (
            <ZoneOption
              key={z.id}
              on={t.zones.includes(z.id)}
              label={z.name}
              onClick={() =>
                patchTrigger({
                  zones: t.zones.includes(z.id)
                    ? t.zones.filter((x) => x !== z.id)
                    : [...t.zones, z.id],
                })
              }
            />
          ))}
        </div>
        <Button className="mt-3 w-full" onClick={() => setPicking(false)}>
          完成
        </Button>
      </Modal>
    </div>
  );
}

function ZoneOption({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="hover:bg-accent flex min-h-11 w-full cursor-pointer items-center justify-between rounded-md px-2 text-left text-[13px]"
    >
      {label}
      <span
        className={cn(
          "grid size-5 place-items-center rounded-md border",
          on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
        )}
      >
        {on && <Check className="size-3.5" />}
      </span>
    </button>
  );
}

// ── Priority & conflicts ─────────────────────────────────────────────────────

/** Which wins when two things want the dog at once — the one choice here that is not advanced. */
function PrioritySection({ r }: { r: Rule }) {
  const owner = useStore((s) => !!s.session?.scopes.includes("admin"));
  return (
    <section className="space-y-2.5">
      <SectionTitle description="一隻狗同時只做一件事，撞在一起時重要的先做">重要程度</SectionTitle>
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
                "flex h-10 cursor-pointer items-center justify-center gap-1 rounded-lg border text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-45",
                r.priority === p
                  ? "border-primary bg-primary/10 text-primary-accent"
                  : "bg-card hover:bg-accent"
              )}
            >
              {!allowed && <Lock className="size-3" />}
              {PRIORITY[p].label}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground text-[11px]">
        {PRIORITY[r.priority].hint}。{!owner && "「緊急」和「事件回應」只有擁有者能設定。"}
        手動操控永遠優先。
      </p>
    </section>
  );
}

/**
 * Everything a rule works fine with at its default, behind one line that says what the
 * defaults are. The rule schema keeps every knob; the editor stops leading with them.
 */
function AdvancedSection({ r }: { r: Rule }) {
  const [open, setOpen] = useState(false);
  const t = r.trigger.kind === "time" ? r.trigger : null;
  const ev =
    r.trigger.kind === "event" && EVENT_TYPES[r.trigger.type].source === "ai" ? r.trigger : null;
  const PRE = { resume: "從中斷處繼續", restart: "重新開始", drop: "放棄" } as const;
  const summary = [
    t && t.schedule.type !== "once" ? (t.jitterMin ? `隨機 ±${t.jitterMin} 分` : "準時") : null,
    t ? (t.missed === "catch_up" ? `錯過時補跑（${t.graceMin} 分內）` : "錯過就跳過") : null,
    ev ? `信心 ≥ ${Math.round(ev.minConfidence * 100)}%` : null,
    ev?.persistSec ? `持續 ${ev.persistSec} 秒` : null,
    `被打斷時${PRE[r.onPreempted]}`,
    `電量 ≥ ${r.minBattery}%`,
    r.cooldownSec ? `冷卻 ${r.cooldownSec / 60} 分` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="rounded-xl border">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-12 w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold">進階設定</span>
          {!open && (
            <span className="text-muted-foreground block truncate text-[11px]">{summary}</span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "text-muted-foreground size-4 shrink-0 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="divide-y border-t px-3">
              {/* §4.2 false-positive guards — AI will misjudge; all of these must hold. */}
              {ev && (
                <div className="space-y-2.5 py-2">
                  <p className="text-muted-foreground text-[11px]">
                    防誤報：AI 一定會誤判，以下條件都成立才觸發
                  </p>
                  <div>
                    <div className="flex items-center justify-between text-[13px]">
                      信心至少
                      <span className="font-semibold tabular-nums">
                        {Math.round(ev.minConfidence * 100)}%
                      </span>
                    </div>
                    <Slider
                      label="信心門檻"
                      min={0.5}
                      max={0.99}
                      step={0.01}
                      value={ev.minConfidence}
                      onChange={(minConfidence) => patchTrigger({ minConfidence })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[13px]">
                    持續出現
                    <Select
                      label="持續秒數"
                      className="w-28"
                      value={String(ev.persistSec)}
                      options={[0, 1, 2, 3, 5, 10, 30].map((v) => ({
                        value: String(v),
                        label: v ? `${v} 秒` : "不限",
                      }))}
                      onChange={(v) => patchTrigger({ persistSec: Number(v) })}
                    />
                  </div>
                  <label className="flex items-center justify-between text-[13px]">
                    <span>
                      多次出現
                      {ev.countWithin && (
                        <span className="text-muted-foreground ml-1.5 text-[11px]">
                          {ev.countWithin.sec} 秒內 {ev.countWithin.n} 次
                        </span>
                      )}
                    </span>
                    <Switch
                      checked={!!ev.countWithin}
                      onCheckedChange={(on) =>
                        patchTrigger({ countWithin: on ? { n: 3, sec: 60 } : null })
                      }
                    />
                  </label>
                </div>
              )}
              {t && t.schedule.type !== "once" && (
                <div className="py-2">
                  <div className="flex items-center justify-between text-[13px]">
                    <span>
                      隨機偏移
                      <span className="text-muted-foreground ml-1.5 text-[11px]">
                        讓巡邏時間不可預測
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">
                      {t.jitterMin ? `±${t.jitterMin} 分` : "關"}
                    </span>
                  </div>
                  <Slider
                    label="隨機偏移"
                    min={0}
                    max={30}
                    step={1}
                    value={t.jitterMin}
                    onChange={(jitterMin) => patchTrigger({ jitterMin })}
                  />
                </div>
              )}
              {t && (
                <div className="space-y-2 py-2">
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
                      <Select
                        label="補跑寬限"
                        className="w-28"
                        value={String(t.graceMin)}
                        options={[5, 15, 30, 60].map((m) => ({
                          value: String(m),
                          label: `${m} 分鐘`,
                        }))}
                        onChange={(v) => patchTrigger({ graceMin: Number(v) })}
                      />
                    </div>
                  )}
                </div>
              )}
              <div className="flex min-h-11 items-center justify-between gap-3 text-[13px]">
                被更重要的事打斷時
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
              <div className="flex min-h-11 items-center justify-between gap-3 text-[13px]">
                <span>
                  排隊最多等
                  <span className="text-muted-foreground ml-1.5 text-[11px]">太晚到就沒意義</span>
                </span>
                <Select
                  label="排隊逾時"
                  className="w-24"
                  value={String(r.queueTtlSec)}
                  options={[60, 300, 900, 1800, 3600].map((v) => ({
                    value: String(v),
                    label: v < 3600 ? `${v / 60} 分鐘` : "1 小時",
                  }))}
                  onChange={(v) => patchRule({ queueTtlSec: Number(v) })}
                />
              </div>
              <div className="py-2">
                <div className="flex items-center justify-between text-[13px]">
                  電量至少
                  <span className="font-semibold tabular-nums">{r.minBattery}%</span>
                </div>
                <Slider
                  label="最低電量"
                  min={5}
                  max={80}
                  step={5}
                  value={r.minBattery}
                  onChange={(minBattery) => patchRule({ minBattery })}
                />
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3 text-[13px]">
                <span>
                  冷卻時間
                  <span className="text-muted-foreground ml-1.5 text-[11px]">
                    觸發後多久內不再觸發
                  </span>
                </span>
                <Select
                  label="冷卻時間"
                  className="w-24"
                  value={String(r.cooldownSec)}
                  options={[0, 60, 120, 300, 600, 1800].map((v) => ({
                    value: String(v),
                    label: v ? `${v / 60} 分鐘` : "無",
                  }))}
                  onChange={(v) => patchRule({ cooldownSec: Number(v) })}
                />
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3 text-[13px]">
                每小時最多
                <Select
                  label="每小時上限"
                  className="w-24"
                  value={String(r.maxPerHour)}
                  options={[1, 2, 4, 6, 10, 20].map((v) => ({
                    value: String(v),
                    label: `${v} 次`,
                  }))}
                  onChange={(v) => patchRule({ maxPerHour: Number(v) })}
                />
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Deleting sits at the end of the editor, away from the everyday keys. */
function DeleteRule({ id, name }: { id: string; name: string }) {
  const owner = useStore((s) => !!s.session?.scopes.includes("admin"));
  const priority = useStore((s) => s.rules.find((x) => x.id === id)?.priority ?? 3);
  const [confirm, setConfirm] = useState(false);
  if (priority <= 1 && !owner) return null;
  return (
    <>
      <Button variant="ghost" className="text-status-error w-full" onClick={() => setConfirm(true)}>
        <Trash2 />
        刪除這條規則
      </Button>
      <Modal open={confirm} onClose={() => setConfirm(false)}>
        <p className="text-[15px] font-semibold">刪除規則「{name}」？</p>
        <p className="text-muted-foreground mt-1">路線會保留，只是不再由這條規則啟動。</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              setConfirm(false);
              await rpc("rule.delete", { id });
              closeRuleEditor();
              set({ detailRuleId: null });
            }}
          >
            刪除
          </Button>
        </div>
      </Modal>
    </>
  );
}
