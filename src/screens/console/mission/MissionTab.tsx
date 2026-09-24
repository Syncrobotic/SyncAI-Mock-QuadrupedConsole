"use client";

import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Hourglass,
  MapPinned,
  Pause,
  Pencil,
  Play,
  Plus,
  Route,
  Square,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { useState } from "react";

import {
  Card,
  LockedPanel,
  Modal,
  Pill,
  SectionTitle,
  Segmented,
  type Tone,
} from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  EVENT_TYPES,
  MODE_LABEL,
  PRIORITY,
  clock,
  describeTrigger,
  formatRelative,
  inWindow,
  jitterFor,
  nextSlots,
  shortSchedule,
  dayClock,
} from "@/lib/rules";
import { estimateMission } from "@/lib/schedule";
import { cn, formatDuration } from "@/lib/utils";
import { NO_SCOPES, set, useStore } from "@/store";
import { rpc } from "@/store/controller";
import { lockDetail } from "@/store/logic";

import { useNow } from "../Banners";
import { useAccess } from "../Console";
import { MissionEditor } from "./MissionEditor";
import { RuleEditor } from "./RuleEditor";
import { openEditor } from "./editor";
import { OUTCOME, PriorityPill, RuleIcon } from "./rule-bits";
import { openRuleEditor, testRule } from "./rule-state";

import type { Mission, Rule, RunRecord, RunResult } from "@/proto/types";

const RESULT: Record<RunResult, { label: string; tone: Tone }> = {
  success: { label: "成功", tone: "ok" },
  aborted: { label: "中止", tone: "warn" },
  failed: { label: "失敗", tone: "bad" },
};

/**
 * Mission tab — the same model as ever (rules decide WHEN, missions are WHAT), shown as a
 * guard thinks about it:
 *   the card on top  what the dog is doing now, or when it goes next
 *   排程              time rules, with the next 24 h as one strip instead of 17 rows
 *   事件              event rules
 *   路線              mission templates (patrol routes and event responses)
 * Rows are two lines — name, then when/what — and each list is one card.
 */
export function MissionTab() {
  const access = useAccess("mission");
  const editor = useStore((s) => s.editor);
  const ruleEditor = useStore((s) => s.ruleEditor);
  const detail = useStore((s) => s.detailMissionId);
  const detailRule = useStore((s) => s.detailRuleId);
  const missions = useStore((s) => s.missions);
  const rules = useStore((s) => s.rules);
  const view = useStore((s) => s.missionView);
  const scopes = useStore((s) => s.session?.scopes ?? NO_SCOPES);
  const run = useStore((s) => s.telemetry?.run ?? null);
  const queue = useStore((s) => s.telemetry?.queue);

  if (access.locked) {
    return (
      <div className="space-y-3 p-3">
        <LockedPanel reason={access.reason} detail={lockDetail(access.reason)} />
        {rules.length > 0 && scopes.includes("view") && (
          <div className="space-y-1.5">
            <ListHeader title="快取的規則（唯讀）" />
            <ul className={LIST}>
              {rules.map((r) => (
                <RuleRow key={r.id} rule={r} readOnly />
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (ruleEditor) return <RuleEditor />;
  if (editor) return <MissionEditor />;
  const rule = rules.find((r) => r.id === detailRule);
  if (rule) return <RuleDetail rule={rule} />;
  const mission = missions.find((m) => m.id === detail);
  if (mission) return <MissionDetail mission={mission} />;

  return (
    <div className="space-y-3 px-3 pt-1 pb-4">
      {run ? <RunCard /> : queue && queue.length > 0 ? <QueueCard /> : <NextCard />}
      <Segmented
        value={view}
        options={[
          {
            value: "time",
            label: (
              <span className="flex items-center justify-center gap-1.5">
                <CalendarClock className="size-3.5" />
                排程
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
          {
            value: "routes",
            label: (
              <span className="flex items-center justify-center gap-1.5">
                <Route className="size-3.5" />
                路線
              </span>
            ),
          },
        ]}
        onChange={(missionView) => set({ missionView })}
      />
      {view === "time" && <TimeView />}
      {view === "event" && <EventView />}
      {view === "routes" && <RoutesView />}
    </div>
  );
}

/** One card per list, hairlines between rows (same as the event log). */
const LIST = "bg-card divide-y overflow-hidden rounded-xl border";

function ListHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className="flex min-h-8 items-center justify-between px-1">
      <h4 className="text-muted-foreground text-[12px] font-semibold">{title}</h4>
      {action && (
        <Button
          size="sm"
          variant="ghost"
          className="text-primary-accent -mr-2"
          onClick={action.run}
        >
          <Plus />
          {action.label}
        </Button>
      )}
    </div>
  );
}

// ── Time slots (the agenda's model: one dog, a slot that starts before the last ends queues)

interface Slot {
  at: number;
  rule: Rule;
  mission: Mission | undefined;
  durSec: number;
  conflict?: string;
}

function useSlots(now: number) {
  const rules = useStore((s) => s.rules);
  const missions = useStore((s) => s.missions);
  const horizon = now + 24 * 3_600_000;
  const slots: Slot[] = [];
  for (const r of rules) {
    if (!r.enabled || r.trigger.kind !== "time") continue;
    const t = r.trigger;
    for (const s of nextSlots(t.schedule, now, 40)) {
      if (s > horizon) break;
      const at = s + jitterFor(r.id, s, t.jitterMin);
      if (at <= now) continue;
      const mission = missions.find((m) => m.id === r.missionId);
      slots.push({ at, rule: r, mission, durSec: mission ? estimateMission(mission).sec : 0 });
    }
  }
  slots.sort((a, b) => a.at - b.at);
  let busyUntil = 0;
  let busyName = "";
  for (const s of slots) {
    if (s.at < busyUntil)
      s.conflict = `與「${busyName}」重疊，會排隊約 ${Math.ceil((busyUntil - s.at) / 60_000)} 分`;
    const end = Math.max(busyUntil, s.at) + s.durSec * 1000;
    if (end > busyUntil) {
      busyUntil = end;
      busyName = s.rule.name;
    }
  }
  const battery = slots.reduce(
    (sum, s) => sum + (s.mission ? estimateMission(s.mission).batteryPct : 0),
    0
  );
  return { slots, battery };
}

/** Nothing running: when the dog goes next, and a way to go now. */
function NextCard() {
  const now = useNow(30_000);
  const { slots } = useSlots(now);
  const next = slots[0];
  if (!next) return null;
  const patrol = next.mission?.kind === "patrol";
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-[11px]">
          下一次巡邏 · {formatRelative(next.at, now)}
        </p>
        <p className="truncate text-[14px] font-semibold">
          <span className="tabular-nums">{clock(next.at)}</span> {next.rule.name}
        </p>
      </div>
      {patrol && (
        <Button size="sm" onClick={() => void rpc("mission.start", { id: next.mission!.id })}>
          <Play />
          現在跑
        </Button>
      )}
    </div>
  );
}

// ── Running / queue ─────────────────────────────────────────────────────────

function RunCard() {
  const run = useStore((s) => s.telemetry!.run!);
  const queue = useStore((s) => s.telemetry?.queue);
  const mission = useStore((s) => s.missions.find((m) => m.id === s.telemetry?.run?.missionId));
  const [confirmAbort, setConfirmAbort] = useState(false);
  const paused = run.state === "paused";
  const progress = run.totalWp
    ? (Math.min(run.completedWp.length, run.totalWp) / run.totalWp) * 100
    : 0;

  return (
    <Card className={cn("space-y-2", paused && "border-severity-warning/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium">
            <PriorityPill p={run.priority} />
            {paused ? "暫停中" : "進行中"}
          </p>
          <p className="mt-0.5 truncate text-[14px] font-semibold">
            {mission?.name ?? run.missionId}
          </p>
          {/* Why it is running — the cause travels with the run (§7.1). */}
          <p className="text-muted-foreground truncate text-[11px]">
            {run.cause.text}
            {run.cause.confirmedBy ? ` · 確認：${run.cause.confirmedBy}` : ""}
          </p>
        </div>
        <Pill tone={paused ? "warn" : "busy"}>
          {Math.min(run.currentWp + 1, run.totalWp)}/{run.totalWp}
        </Pill>
      </div>
      <div className="bg-muted h-1 overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            paused ? "bg-severity-warning" : "bg-primary"
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-muted-foreground flex justify-between text-[11px] tabular-nums">
        <span>
          {mission?.kind === "response" ? "前往事件位置" : `目前航點 ${run.currentWp + 1}`}
        </span>
        <span>預估剩餘 {formatDuration(run.etaSec)}</span>
      </div>
      {paused && run.pausedReason && (
        <p className="text-severity-warning text-[12px]">暫停原因：{run.pausedReason}</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {paused ? (
          <Button onClick={() => void rpc("mission.resume", undefined)}>
            <Play />
            恢復
          </Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => void rpc("mission.pause", { reason: "使用者暫停" })}
          >
            <Pause />
            暫停
          </Button>
        )}
        <Button variant="outline" onClick={() => setConfirmAbort(true)}>
          <Square />
          中止
        </Button>
      </div>
      {queue && queue.length > 0 && <QueueList />}
      <Modal open={confirmAbort} onClose={() => setConfirmAbort(false)}>
        <p className="text-[15px] font-semibold">中止任務？</p>
        <p className="text-muted-foreground mt-1">
          狗會停在原地，這次執行會記為「中止」。排隊中的任務會接著執行。
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setConfirmAbort(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setConfirmAbort(false);
              void rpc("mission.abort", undefined);
            }}
          >
            中止
          </Button>
        </div>
      </Modal>
    </Card>
  );
}

function QueueCard() {
  return (
    <Card className="space-y-1.5">
      <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium">
        <Hourglass className="size-3.5" />
        排隊中 · 狗目前無法出動
      </p>
      <QueueList />
    </Card>
  );
}

function QueueList() {
  const queue = useStore((s) => s.telemetry?.queue) ?? [];
  const missions = useStore((s) => s.missions);
  const now = useNow(1000);
  return (
    <ul className="border-t pt-1.5">
      {queue.map((q) => (
        <li key={q.activationId} className="flex items-center gap-2 py-0.5 text-[12px]">
          <PriorityPill p={q.priority} />
          <span className="min-w-0 flex-1 truncate">
            {missions.find((m) => m.id === q.missionId)?.name}
            <span className="text-muted-foreground"> · {q.resumed ? "待續" : q.cause}</span>
          </span>
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {Math.max(0, Math.ceil((q.expiresAt - now) / 60_000))} 分後過期
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Lists ────────────────────────────────────────────────────────────────────

function TimeView() {
  const rules = useStore((s) => s.rules).filter((r) => r.trigger.kind === "time");
  const battery = useStore((s) => s.telemetry?.battery ?? 100);
  const now = useNow(30_000);
  const { slots, battery: need } = useSlots(now);
  const conflicts = slots.filter((s) => s.conflict).length;
  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border px-3 pt-2.5 pb-2">
        <p className="text-muted-foreground text-[12px]">
          未來 24 小時{" "}
          <span className="text-foreground font-semibold tabular-nums">{slots.length}</span> 次 ·
          耗電約{" "}
          <span
            className={cn(
              "font-semibold tabular-nums",
              need > battery ? "text-severity-warning" : "text-foreground"
            )}
          >
            {Math.round(need)}%
          </span>
        </p>
        <DayStrip slots={slots} now={now} />
        {(conflicts > 0 || need > battery) && (
          <p className="text-severity-warning flex items-start gap-1.5 text-[12px]">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {conflicts > 0 ? `${conflicts} 次時間重疊，會排隊` : "總耗電超過目前電量，中途需要回充"}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <ListHeader
          title="排程"
          action={{ label: "新排程", run: () => openRuleEditor(undefined, "time") }}
        />
        <ul className={LIST}>
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The next 24 hours as one strip: a tick per run (amber when it will have to queue), hour
 * marks every 6 hours. Seventeen near-identical rows said less than this.
 */
function DayStrip({ slots, now }: { slots: Slot[]; now: number }) {
  const SPAN = 24 * 3_600_000;
  const at = (t: number) => `${((t - now) / SPAN) * 100}%`;
  const firstMark = Math.ceil(now / (6 * 3_600_000)) * 6 * 3_600_000;
  const marks = [0, 1, 2, 3]
    .map((k) => firstMark + k * 6 * 3_600_000)
    .filter((t) => (t - now) / SPAN > 0.1 && (t - now) / SPAN < 0.95);
  return (
    <div aria-label={`未來 24 小時 ${slots.length} 次巡邏`} role="img">
      <div className="bg-muted/70 relative h-7 overflow-hidden rounded-md">
        {marks.map((t) => (
          <span
            key={t}
            aria-hidden
            className="bg-border absolute inset-y-0 w-px"
            style={{ left: at(t) }}
          />
        ))}
        {slots.map((s) => (
          <span
            key={`${s.rule.id}-${s.at}`}
            aria-hidden
            className={cn(
              "absolute inset-y-1.5 w-[3px] -translate-x-1/2 rounded-full",
              s.conflict ? "bg-severity-warning" : "bg-primary-accent"
            )}
            style={{ left: at(s.at) }}
          />
        ))}
      </div>
      <div aria-hidden className="text-muted-foreground relative mt-1 h-4 text-[11px] tabular-nums">
        <span className="absolute left-0">現在</span>
        {marks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2" style={{ left: at(t) }}>
            {clock(t)}
          </span>
        ))}
      </div>
    </div>
  );
}

function EventView() {
  const rules = useStore((s) => s.rules).filter((r) => r.trigger.kind === "event");
  return (
    <div className="space-y-1">
      <ListHeader
        title="事件發生時"
        action={{ label: "新規則", run: () => openRuleEditor(undefined, "event") }}
      />
      <ul className={LIST}>
        {rules.map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
      </ul>
    </div>
  );
}

/** Only the ones that matter get a mark: 緊急 red, 重要 amber; routine and maintenance stay quiet. */
function PriorityDot({ p }: { p: Rule["priority"] }) {
  if (p > 1) return null;
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        p === 0 ? "bg-status-error" : "bg-severity-warning"
      )}
    >
      <span className="sr-only">{PRIORITY[p].label}</span>
    </span>
  );
}

/** Outcomes worth a word in the list: the rule should have run and did not. */
const BAD_OUTCOME = new Set(["skipped", "expired"]);

function RuleRow({ rule, readOnly }: { rule: Rule; readOnly?: boolean }) {
  const zones = useStore((s) => s.plan?.zones);
  const log = useStore((s) => s.ruleLog);
  const owner = useStore((s) => !!s.session?.scopes.includes("admin"));
  const now = useNow(15_000);
  const last = log.find((l) => l.ruleId === rule.id);
  const locked = rule.priority <= 1 && !owner;
  const armed =
    rule.enabled && (rule.trigger.kind === "time" || inWindow(rule.trigger.activeWindow, now));

  let line: string;
  if (rule.trigger.kind === "time") {
    const t = rule.trigger;
    const slot = rule.enabled
      ? nextSlots(t.schedule, now, 3)
          .map((x) => x + jitterFor(rule.id, x, t.jitterMin))
          .find((x) => x > now)
      : undefined;
    // The next time carries the time of day, so the schedule does not repeat it.
    line = [
      rule.enabled ? (slot ? `下次 ${dayClock(slot, now)}` : "沒有下一次") : "已停用",
      shortSchedule(t.schedule, !rule.enabled || !slot),
    ].join(" · ");
  } else {
    const t = rule.trigger;
    const where =
      t.zones.length === 0
        ? "任何地方"
        : t.zones.length === 1
          ? (zones?.find((z) => z.id === t.zones[0])?.name ?? t.zones[0])
          : `${t.zones.length} 個區域`;
    line = [
      EVENT_TYPES[t.type].label,
      where,
      rule.mode !== "auto" ? MODE_LABEL[rule.mode] : null,
      !rule.enabled ? "已停用" : !armed ? "時段外" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const bad = last && BAD_OUTCOME.has(last.outcome) ? `上次${OUTCOME[last.outcome].label}` : null;

  return (
    <li className="flex min-h-12 items-center gap-2.5 py-2 pr-2.5 pl-3">
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg",
          armed ? "bg-primary/12 text-primary-accent" : "bg-muted text-muted-foreground"
        )}
      >
        <RuleIcon rule={rule} className="size-3.5" />
      </span>
      <button
        disabled={readOnly}
        onClick={() => set({ detailRuleId: rule.id, snap: 2 })}
        className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
      >
        <span
          className={cn(
            "flex items-center gap-1.5 text-[13px] font-medium",
            !rule.enabled && "text-muted-foreground"
          )}
        >
          <PriorityDot p={rule.priority} />
          <span className="truncate">{rule.name}</span>
        </span>
        <span className="text-muted-foreground block truncate text-[11px] tabular-nums">
          {line}
          {bad && <span className="text-status-error"> · {bad}</span>}
        </span>
      </button>
      <Switch
        aria-label={`啟用 ${rule.name}`}
        checked={rule.enabled}
        disabled={readOnly || locked}
        onCheckedChange={(v) => void rpc("rule.setEnabled", { id: rule.id, enabled: v })}
      />
    </li>
  );
}

function RuleDetail({ rule }: { rule: Rule }) {
  const missions = useStore((s) => s.missions);
  const zones = useStore((s) => s.plan?.zones);
  const log = useStore((s) => s.ruleLog);
  const history = useStore((s) => s.history);
  const owner = useStore((s) => !!s.session?.scopes.includes("admin"));
  const [verdict, setVerdict] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mission = missions.find((m) => m.id === rule.missionId);
  const entries = log.filter((l) => l.ruleId === rule.id).slice(0, 20);
  const runs = history.filter((h) => h.cause?.ruleId === rule.id).slice(0, 10);
  const zoneName = (id: string) => zones?.find((z) => z.id === id)?.name ?? id;
  const locked = rule.priority <= 1 && !owner;

  return (
    <div className="space-y-3 px-3 pt-0.5 pb-5">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => set({ detailRuleId: null, snap: 1 })}
          aria-label="返回規則列表"
        >
          <ChevronLeft />
        </Button>
        <span className="bg-primary/12 text-primary-accent grid size-8 shrink-0 place-items-center rounded-lg">
          <RuleIcon rule={rule} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold">
            <PriorityPill p={rule.priority} long />
            <span className="truncate">{rule.name}</span>
          </p>
          <p className="text-muted-foreground truncate text-[11px]">
            {rule.enabled ? "啟用中" : "已停用"} · {MODE_LABEL[rule.mode]}
          </p>
        </div>
      </div>

      <Card className="space-y-1 text-[12px]">
        <p>
          <span className="text-muted-foreground">當 </span>
          {describeTrigger(rule.trigger, zoneName)}
        </p>
        <p>
          <span className="text-muted-foreground">就 </span>
          {mission?.name}
          {mission && (
            <span className="text-muted-foreground">
              {" "}
              · 約 {formatDuration(estimateMission(mission).sec)}
            </span>
          )}
        </p>
        <p className="text-muted-foreground">
          {PRIORITY[rule.priority].hint} · 冷卻{" "}
          {rule.cooldownSec ? `${rule.cooldownSec / 60} 分` : "無"} · 每小時最多 {rule.maxPerHour}{" "}
          次 · 電量 ≥ {rule.minBattery}%
        </p>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" disabled={locked} onClick={() => openRuleEditor(rule)}>
          <Pencil />
          編輯
        </Button>
        <Button variant="outline" onClick={async () => setVerdict(await testRule(rule))}>
          <FlaskConical />
          模擬
        </Button>
        <Button variant="outline" disabled={locked} onClick={() => setConfirmDelete(true)}>
          <Trash2 />
          刪除
        </Button>
      </div>
      {locked && (
        <p className="text-muted-foreground text-[11px]">P0 / P1 規則只有擁有者能修改。</p>
      )}
      {verdict && (
        <p className="bg-surface-sunken rounded-lg border px-3 py-2 text-[12px]">{verdict}</p>
      )}

      {/* §7.2: "why didn't it run?" is the question — every decision is here. */}
      <div className="space-y-1.5">
        <SectionTitle description="包含沒有出動的原因">最近的決策</SectionTitle>
        {entries.length === 0 && <p className="text-muted-foreground text-[12px]">還沒有觸發過</p>}
        <ul className="bg-card divide-y rounded-xl border">
          {entries.map((e) => {
            const o = OUTCOME[e.outcome];
            return (
              <li key={e.id} className="flex items-start gap-2 px-3 py-1.5 text-[12px]">
                <o.icon className={cn("mt-0.5 size-3.5 shrink-0", o.tone)} />
                <span className="min-w-0 flex-1">
                  <span className={cn("font-medium", o.tone)}>{o.label}</span>
                  <span className="text-muted-foreground"> · {e.reason}</span>
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">{clock(e.at)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {runs.length > 0 && (
        <div className="space-y-1.5">
          <SectionTitle>最近的執行</SectionTitle>
          {runs.map((r) => (
            <RunRow key={r.id} run={r} />
          ))}
        </div>
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <p className="text-[15px] font-semibold">刪除規則「{rule.name}」？</p>
        <p className="text-muted-foreground mt-1">任務範本會保留，只是不再由這條規則啟動。</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              setConfirmDelete(false);
              await rpc("rule.delete", { id: rule.id });
              set({ detailRuleId: null, snap: 1 });
            }}
          >
            刪除
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ── Mission templates ────────────────────────────────────────────────────────

function RoutesView() {
  const missions = useStore((s) => s.missions);
  const patrols = missions.filter((m) => m.kind === "patrol");
  const responses = missions.filter((m) => m.kind === "response");
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <ListHeader title="巡邏路線" action={{ label: "新路線", run: () => openEditor() }} />
        <ul className={LIST}>
          {patrols.map((m) => (
            <RouteRow key={m.id} mission={m} />
          ))}
        </ul>
      </div>
      {responses.length > 0 && (
        <div className="space-y-1">
          <ListHeader title="事件回應" />
          <ul className={LIST}>
            {responses.map((m) => (
              <RouteRow key={m.id} mission={m} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RouteRow({ mission: m }: { mission: Mission }) {
  const est = estimateMission(m);
  return (
    <li>
      <button
        onClick={() => set({ detailMissionId: m.id, snap: 2 })}
        className="hover:bg-accent/50 flex min-h-12 w-full cursor-pointer items-center gap-2.5 py-2 pr-2.5 pl-3 text-left transition-colors"
      >
        <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-lg">
          {m.kind === "response" ? (
            <MapPinned className="size-3.5" />
          ) : (
            <Route className="size-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{m.name}</span>
          <span className="text-muted-foreground block truncate text-[11px] tabular-nums">
            {m.kind === "response"
              ? `前往事件位置 · ${m.response.actions.length} 個動作`
              : `${m.route.length} 個航點 · 約 ${formatDuration(est.sec)}`}
          </span>
        </span>
        <ChevronRight className="text-muted-foreground size-4 shrink-0" />
      </button>
    </li>
  );
}

function MissionDetail({ mission }: { mission: Mission }) {
  const allHistory = useStore((s) => s.history);
  const rules = useStore((s) => s.rules);
  const history = allHistory.filter((h) => h.missionId === mission.id).slice(0, 20);
  const running = useStore((s) => s.telemetry?.run?.missionId === mission.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const usedBy = rules.filter((r) => r.missionId === mission.id);

  return (
    <div className="space-y-3 px-3 pt-0.5 pb-5">
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => set({ detailMissionId: null, snap: 1 })}
          aria-label="返回任務列表"
        >
          <ChevronLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{mission.name}</p>
          <p className="text-muted-foreground text-[11px]">
            {mission.kind === "response"
              ? "事件回應 · 前往事件位置"
              : `巡邏路線 · ${mission.route.length} 個航點`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          disabled={running || mission.kind === "response"}
          onClick={() => void rpc("mission.start", { id: mission.id })}
        >
          <Play />
          立即執行
        </Button>
        <Button variant="secondary" onClick={() => openEditor(mission)}>
          <Pencil />
          編輯
        </Button>
        <Button variant="outline" onClick={() => setConfirmDelete(true)}>
          <Trash2 />
          刪除
        </Button>
      </div>
      {mission.kind === "response" && (
        <p className="text-muted-foreground text-[11px]">
          事件回應任務需要事件的位置，只能由事件規則啟動。
        </p>
      )}

      <div className="space-y-1.5">
        <SectionTitle>使用這個任務的規則</SectionTitle>
        {usedBy.length === 0 && (
          <p className="text-muted-foreground text-[12px]">沒有規則使用，只能手動執行</p>
        )}
        {usedBy.length > 0 && (
          <ul className={LIST}>
            {usedBy.map((r) => (
              <RuleRow key={r.id} rule={r} />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <SectionTitle>最近 {history.length} 次執行</SectionTitle>
        {history.length === 0 && (
          <p className="text-muted-foreground text-[12px]">還沒有執行紀錄</p>
        )}
        {history.map((r) => (
          <RunRow key={r.id} run={r} mission={mission} />
        ))}
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <p className="text-[15px] font-semibold">刪除「{mission.name}」？</p>
        <p className="text-muted-foreground mt-1">
          {usedBy.length
            ? `還有 ${usedBy.length} 條規則使用它，需要先修改那些規則。`
            : "任務範本會從狗上移除，執行紀錄保留。"}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={usedBy.length > 0}
            onClick={async () => {
              setConfirmDelete(false);
              await rpc("mission.delete", { id: mission.id });
              set({ detailMissionId: null, snap: 1 });
            }}
          >
            刪除
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function RunRow({ run, mission }: { run: RunRecord; mission?: Mission }) {
  const missions = useStore((s) => s.missions);
  const m = mission ?? missions.find((x) => x.id === run.missionId);
  return (
    <Card className="flex items-center gap-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium tabular-nums">
          {new Date(run.startedAt).toLocaleString("zh-TW", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
          {!mission && m && <span className="text-muted-foreground font-normal"> · {m.name}</span>}
        </p>
        <p className="text-muted-foreground truncate text-[11px]">
          {run.cause?.text ?? "—"}
          {run.cause?.confirmedBy ? ` · ${run.cause.confirmedBy}` : ""}
          {run.reason ? ` · ${run.reason}` : ""}
        </p>
      </div>
      <Pill tone={RESULT[run.result].tone}>{RESULT[run.result].label}</Pill>
    </Card>
  );
}

export function MissionSummary() {
  const run = useStore((s) => s.telemetry?.run ?? null);
  const name = useStore((s) => s.missions.find((m) => m.id === s.telemetry?.run?.missionId)?.name);
  const count = useStore((s) => s.rules.filter((r) => r.enabled).length);
  const queued = useStore((s) => s.telemetry?.queue.length ?? 0);
  if (run)
    return (
      <span>
        {PRIORITY[run.priority].short} {run.state === "paused" ? "暫停" : "進行中"}：{name} ·{" "}
        {run.currentWp + 1}/{run.totalWp}
        {queued ? ` · ${queued} 個排隊` : ""}
      </span>
    );
  return <span>{count} 條規則啟用中 · 沒有進行中的任務</span>;
}
