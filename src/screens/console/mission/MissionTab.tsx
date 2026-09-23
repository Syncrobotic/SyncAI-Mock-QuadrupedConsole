"use client";

import { CalendarClock, ChevronLeft, ChevronRight, FlaskConical, Hourglass, ListChecks, MapPinned, Pause, Pencil, Play, Plus, Route, Square, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Card, LockedPanel, Modal, Pill, SectionTitle, Segmented, type Tone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EVENT_TYPES, MODE_LABEL, PRIORITY, clock, describeTrigger, formatRelative, inWindow, jitterFor, nextRun, nextSlots } from "@/lib/rules";
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
 * Mission tab = three views over one model (design doc §9):
 *   規則  when and why things run — the part people tune
 *   任務  what the dog does — reusable templates
 *   行程  what will actually happen in the next 24 h
 * The running card sits above all three, because "what is it doing now"
 * is the first question whichever view you are in.
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
          <div className="space-y-1.5 opacity-70">
            <SectionTitle>快取的規則（唯讀）</SectionTitle>
            {rules.map((r) => (
              <RuleRow key={r.id} rule={r} readOnly />
            ))}
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
      {run && <RunCard />}
      {!run && queue && queue.length > 0 && <QueueCard />}
      <Segmented
        value={view}
        options={[
          { value: "rules", label: <span className="flex items-center justify-center gap-1.5"><ListChecks className="size-3.5" />規則</span> },
          { value: "missions", label: <span className="flex items-center justify-center gap-1.5"><Route className="size-3.5" />任務</span> },
          { value: "agenda", label: <span className="flex items-center justify-center gap-1.5"><CalendarClock className="size-3.5" />行程</span> },
        ]}
        onChange={(missionView) => set({ missionView })}
      />
      {view === "rules" && <RulesList />}
      {view === "missions" && <MissionsList />}
      {view === "agenda" && <Agenda />}
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
  const progress = run.totalWp ? (Math.min(run.completedWp.length, run.totalWp) / run.totalWp) * 100 : 0;

  return (
    <Card className={cn("space-y-2", paused && "border-severity-warning/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium">
            <PriorityPill p={run.priority} />
            {paused ? "暫停中" : "進行中"}
          </p>
          <p className="mt-0.5 truncate text-[14px] font-semibold">{mission?.name ?? run.missionId}</p>
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
        <div className={cn("h-full rounded-full transition-[width] duration-500", paused ? "bg-severity-warning" : "bg-primary")} style={{ width: `${progress}%` }} />
      </div>
      <div className="text-muted-foreground flex justify-between text-[11px] tabular-nums">
        <span>{mission?.kind === "response" ? "前往事件位置" : `目前航點 ${run.currentWp + 1}`}</span>
        <span>預估剩餘 {formatDuration(run.etaSec)}</span>
      </div>
      {paused && run.pausedReason && <p className="text-severity-warning text-[12px]">暫停原因：{run.pausedReason}</p>}
      <div className="grid grid-cols-2 gap-2">
        {paused ? (
          <Button onClick={() => void rpc("mission.resume", undefined)}>
            <Play />
            恢復
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => void rpc("mission.pause", { reason: "使用者暫停" })}>
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
        <p className="text-[16px] font-semibold">中止任務？</p>
        <p className="text-muted-foreground mt-1">狗會停在原地，這次執行會記為「中止」。排隊中的任務會接著執行。</p>
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
          <span className="text-muted-foreground shrink-0 tabular-nums">{Math.max(0, Math.ceil((q.expiresAt - now) / 60_000))} 分後過期</span>
        </li>
      ))}
    </ul>
  );
}

// ── Rules ────────────────────────────────────────────────────────────────────

function RulesList() {
  const rules = useStore((s) => s.rules);
  const time = rules.filter((r) => r.trigger.kind === "time");
  const event = rules.filter((r) => r.trigger.kind === "event");
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <SectionTitle
          description="依時間啟動巡邏"
          action={
            <Button size="sm" variant="ghost" className="text-primary-accent -mr-2" onClick={() => openRuleEditor(undefined, "time")}>
              <Plus />
              排程
            </Button>
          }
        >
          時間排程
        </SectionTitle>
        {time.map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
      </div>
      <div className="space-y-1.5">
        <SectionTitle
          description="AI 偵測、系統事件發生時出動"
          action={
            <Button size="sm" variant="ghost" className="text-primary-accent -mr-2" onClick={() => openRuleEditor(undefined, "event")}>
              <Plus />
              事件規則
            </Button>
          }
        >
          事件觸發
        </SectionTitle>
        {event.map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
      </div>
    </div>
  );
}

function RuleRow({ rule, readOnly }: { rule: Rule; readOnly?: boolean }) {
  const missions = useStore((s) => s.missions);
  const zones = useStore((s) => s.plan?.zones);
  const log = useStore((s) => s.ruleLog);
  const owner = useStore((s) => !!s.session?.scopes.includes("admin"));
  const now = useNow(15_000);
  const mission = missions.find((m) => m.id === rule.missionId);
  const last = log.find((l) => l.ruleId === rule.id);
  const next = nextRun(rule, now);
  const zoneName = (id: string) => zones?.find((z) => z.id === id)?.name ?? id;
  const locked = rule.priority <= 1 && !owner;
  const armed = rule.enabled && (rule.trigger.kind === "time" || inWindow(rule.trigger.activeWindow, now));

  return (
    <div className={cn("bg-card flex items-center gap-2.5 rounded-xl border py-1.5 pr-2 pl-2.5", !rule.enabled && "opacity-65")}>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", armed ? "bg-primary/12 text-primary-accent" : "bg-muted text-muted-foreground")}>
        <RuleIcon rule={rule} className="size-4" />
      </span>
      <button disabled={readOnly} onClick={() => set({ detailRuleId: rule.id, snap: 2 })} className="min-h-10 min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default">
        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium">
          <PriorityPill p={rule.priority} />
          <span className="truncate">{rule.name}</span>
        </p>
        <p className="text-muted-foreground truncate text-[11px]">
          {describeTrigger(rule.trigger, zoneName)} → {mission?.name ?? "—"}
        </p>
        <p className="text-muted-foreground truncate text-[10px]">
          {rule.mode !== "auto" && `${MODE_LABEL[rule.mode]} · `}
          {next ? `下次 ${clock(next)}（${formatRelative(next, now)}）` : rule.trigger.kind === "event" ? (armed ? "待命中" : "不在生效時段") : "沒有下一次"}
          {last && (
            <span className={OUTCOME[last.outcome].tone}>
              {" "}
              · {OUTCOME[last.outcome].label}：{last.reason}
            </span>
          )}
        </p>
      </button>
      <Switch
        aria-label={`啟用 ${rule.name}`}
        checked={rule.enabled}
        disabled={readOnly || locked}
        onCheckedChange={(v) => void rpc("rule.setEnabled", { id: rule.id, enabled: v })}
      />
    </div>
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
        <Button size="icon" variant="ghost" onClick={() => set({ detailRuleId: null, snap: 1 })} aria-label="返回規則列表">
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
          <p className="text-muted-foreground truncate text-[11px]">{rule.enabled ? "啟用中" : "已停用"} · {MODE_LABEL[rule.mode]}</p>
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
          {mission && <span className="text-muted-foreground"> · 約 {formatDuration(estimateMission(mission).sec)}</span>}
        </p>
        <p className="text-muted-foreground">
          {PRIORITY[rule.priority].hint} · 冷卻 {rule.cooldownSec ? `${rule.cooldownSec / 60} 分` : "無"} · 每小時最多 {rule.maxPerHour} 次 · 電量 ≥ {rule.minBattery}%
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
      {locked && <p className="text-muted-foreground text-[11px]">P0 / P1 規則只有擁有者能修改。</p>}
      {verdict && <p className="bg-surface-sunken rounded-lg border px-3 py-2 text-[12px]">{verdict}</p>}

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
        <p className="text-[16px] font-semibold">刪除規則「{rule.name}」？</p>
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

function MissionsList() {
  const missions = useStore((s) => s.missions);
  const rules = useStore((s) => s.rules);
  return (
    <div className="space-y-1.5">
      <SectionTitle
        description="做什麼：巡邏路線與事件回應範本"
        action={
          <Button size="sm" variant="ghost" className="text-primary-accent -mr-2" onClick={() => openEditor()}>
            <Plus />
            新任務
          </Button>
        }
      >
        任務範本 · {missions.length}
      </SectionTitle>
      {missions.map((m) => {
        const used = rules.filter((r) => r.missionId === m.id).length;
        const est = estimateMission(m);
        return (
          <button
            key={m.id}
            onClick={() => set({ detailMissionId: m.id, snap: 2 })}
            className="bg-card hover:bg-accent/40 flex w-full cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left"
          >
            <span className="bg-muted grid size-8 shrink-0 place-items-center rounded-lg">
              {m.kind === "response" ? <MapPinned className="text-primary-accent size-4" /> : <Route className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{m.name}</span>
              <span className="text-muted-foreground block truncate text-[11px]">
                {m.kind === "response" ? "事件回應 · 前往事件位置" : `巡邏 · ${m.route.length} 個航點`} · 約 {formatDuration(est.sec)} · {used ? `${used} 條規則使用` : "沒有規則使用"}
              </span>
            </span>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
          </button>
        );
      })}
    </div>
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
        <Button size="icon" variant="ghost" onClick={() => set({ detailMissionId: null, snap: 1 })} aria-label="返回任務列表">
          <ChevronLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{mission.name}</p>
          <p className="text-muted-foreground text-[11px]">{mission.kind === "response" ? "事件回應 · 前往事件位置" : `巡邏路線 · ${mission.route.length} 個航點`}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button disabled={running || mission.kind === "response"} onClick={() => void rpc("mission.start", { id: mission.id })}>
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
      {mission.kind === "response" && <p className="text-muted-foreground text-[11px]">事件回應任務需要事件的位置，只能由事件規則啟動。</p>}

      <div className="space-y-1.5">
        <SectionTitle>使用這個任務的規則</SectionTitle>
        {usedBy.length === 0 && <p className="text-muted-foreground text-[12px]">沒有規則使用，只能手動執行</p>}
        {usedBy.map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
      </div>

      <div className="space-y-1.5">
        <SectionTitle>最近 {history.length} 次執行</SectionTitle>
        {history.length === 0 && <p className="text-muted-foreground text-[12px]">還沒有執行紀錄</p>}
        {history.map((r) => (
          <RunRow key={r.id} run={r} mission={mission} />
        ))}
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <p className="text-[16px] font-semibold">刪除「{mission.name}」？</p>
        <p className="text-muted-foreground mt-1">{usedBy.length ? `還有 ${usedBy.length} 條規則使用它，需要先修改那些規則。` : "任務範本會從狗上移除，執行紀錄保留。"}</p>
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
          {new Date(run.startedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
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

// ── Agenda (§7.3) ────────────────────────────────────────────────────────────

interface Slot {
  at: number;
  rule: Rule;
  mission: Mission | undefined;
  durSec: number;
  conflict?: string;
}

function Agenda() {
  const rules = useStore((s) => s.rules);
  const missions = useStore((s) => s.missions);
  const battery = useStore((s) => s.telemetry?.battery ?? 100);
  const now = useNow(30_000);
  const horizon = now + 24 * 3_600_000;

  const slots: Slot[] = [];
  for (const r of rules) {
    if (!r.enabled || r.trigger.kind !== "time") continue;
    const t = r.trigger;
    for (const s of nextSlots(t.schedule, now, 40)) {
      if (s > horizon) break;
      const mission = missions.find((m) => m.id === r.missionId);
      slots.push({ at: s + jitterFor(r.id, s, t.jitterMin), rule: r, mission, durSec: mission ? estimateMission(mission).sec : 0 });
    }
  }
  slots.sort((a, b) => a.at - b.at);
  // One dog: a slot starting before the previous one ends will queue.
  let busyUntil = 0;
  let busyName = "";
  for (const s of slots) {
    if (s.at < busyUntil) s.conflict = `與「${busyName}」重疊，會排隊約 ${Math.ceil((busyUntil - s.at) / 60_000)} 分`;
    const end = Math.max(busyUntil, s.at) + s.durSec * 1000;
    if (end > busyUntil) {
      busyUntil = end;
      busyName = s.rule.name;
    }
  }
  const totalBattery = slots.reduce((sum, s) => sum + (s.mission ? estimateMission(s.mission).batteryPct : 0), 0);
  const events = rules.filter((r) => r.enabled && r.trigger.kind === "event");
  const conflicts = slots.filter((s) => s.conflict).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="未來 24 小時" value={`${slots.length} 次`} />
        <Stat label="重疊" value={`${conflicts} 次`} tone={conflicts ? "warn" : undefined} />
        <Stat label="預估耗電" value={`${Math.round(totalBattery)}%`} tone={totalBattery > battery ? "warn" : undefined} />
      </div>
      {totalBattery > battery && (
        <p className="text-severity-warning flex items-start gap-1.5 text-[12px]">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          排程的總耗電超過目前電量，需要中途回充；電量不足的排程會依規則跳過或延後。
        </p>
      )}

      <div className="space-y-1.5">
        <SectionTitle description="時間已含隨機偏移">排程</SectionTitle>
        {slots.length === 0 && <p className="text-muted-foreground text-[12px]">未來 24 小時沒有排程</p>}
        <ol className="relative space-y-1 border-l pl-3">
          {slots.map((s, i) => {
            const newDay = i === 0 || new Date(s.at).getDate() !== new Date(slots[i - 1].at).getDate();
            return (
              <li key={`${s.rule.id}-${s.at}`}>
                {newDay && <p className="text-muted-foreground -ml-3 pt-1 pb-0.5 text-[10px] font-semibold">{new Date(s.at).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric", weekday: "short" })}</p>}
                <button
                  onClick={() => set({ detailRuleId: s.rule.id, snap: 2 })}
                  className={cn("bg-card hover:bg-accent/40 relative flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1 text-left", s.conflict && "border-severity-warning/40")}
                >
                  <span aria-hidden className="bg-primary absolute top-1/2 -left-[17px] size-2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface)]" />
                  <span className="w-11 shrink-0 text-[12px] font-semibold tabular-nums">{clock(s.at)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">
                      {s.rule.name}
                      <span className="text-muted-foreground"> · {s.mission?.name}</span>
                    </span>
                    <span className={cn("block truncate text-[10px]", s.conflict ? "text-severity-warning" : "text-muted-foreground")}>
                      {s.conflict ?? `約 ${formatDuration(s.durSec)}${s.rule.trigger.kind === "time" && s.rule.trigger.jitterMin ? ` · ±${s.rule.trigger.jitterMin} 分` : ""}`}
                    </span>
                  </span>
                  <PriorityPill p={s.rule.priority} />
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="space-y-1.5">
        <SectionTitle description="隨時可能打斷上面的排程">事件規則待命</SectionTitle>
        {events.map((r) => {
          const armed = r.trigger.kind === "event" && inWindow(r.trigger.activeWindow, now);
          return (
            <div key={r.id} className="flex items-center gap-2 text-[12px]">
              <span className={cn("size-1.5 shrink-0 rounded-full", armed ? "bg-status-ok" : "bg-muted-foreground/40")} />
              <PriorityPill p={r.priority} />
              <span className="min-w-0 flex-1 truncate">
                {r.name}
                <span className="text-muted-foreground"> · {r.trigger.kind === "event" ? EVENT_TYPES[r.trigger.type].label : ""}</span>
              </span>
              <span className="text-muted-foreground shrink-0">{armed ? "待命中" : "時段外"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="bg-card rounded-lg border px-2.5 py-1.5">
      <p className="text-muted-foreground text-[10px]">{label}</p>
      <p className={cn("text-[15px] font-bold tabular-nums", tone === "warn" && "text-severity-warning")}>{value}</p>
    </div>
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
        {PRIORITY[run.priority].short} {run.state === "paused" ? "暫停" : "進行中"}：{name} · {run.currentWp + 1}/{run.totalWp}
        {queued ? ` · ${queued} 個排隊` : ""}
      </span>
    );
  return <span>{count} 條規則啟用中 · 沒有進行中的任務</span>;
}
