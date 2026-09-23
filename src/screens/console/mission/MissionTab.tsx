"use client";

import { ChevronLeft, ChevronRight, MapPinPlus, Pause, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { useState } from "react";

import { Card, LockedPanel, Modal, Pill, SectionTitle, type Tone } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { describeTrigger, formatRelative, nextTrigger } from "@/lib/schedule";
import { cn, formatClock, formatDuration } from "@/lib/utils";
import { NO_SCOPES, set, useStore } from "@/store";
import { rpc } from "@/store/controller";
import { lockDetail } from "@/store/logic";

import { useAccess } from "../Console";
import { useNow } from "../Banners";
import { MissionEditor } from "./MissionEditor";
import { openEditor } from "./editor";

import type { Mission, RunRecord, RunResult } from "@/proto/types";

const RESULT: Record<RunResult, { label: string; tone: Tone }> = {
  success: { label: "成功", tone: "ok" },
  aborted: { label: "中止", tone: "warn" },
  failed: { label: "失敗", tone: "bad" },
};

export function MissionTab() {
  const access = useAccess("mission");
  const editor = useStore((s) => s.editor);
  const detail = useStore((s) => s.detailMissionId);
  const missions = useStore((s) => s.missions);
  const scopes = useStore((s) => s.session?.scopes ?? NO_SCOPES);

  if (access.locked) {
    // §8: offline shows the cached list read-only; locked-by-scope/licence shows why.
    return (
      <div className="space-y-4 p-4">
        <LockedPanel
          reason={access.reason}
          detail={lockDetail(access.reason)}
        />
        {missions.length > 0 && scopes.includes("view") && (
          <div className="space-y-2 opacity-70">
            <SectionTitle>快取的任務（唯讀）</SectionTitle>
            {missions.map((m) => (
              <MissionRow key={m.id} mission={m} readOnly />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (editor) return <MissionEditor />;
  const detailMission = missions.find((m) => m.id === detail);
  if (detailMission) return <MissionDetail mission={detailMission} />;
  return <MissionList />;
}

function MissionList() {
  const missions = useStore((s) => s.missions);
  const run = useStore((s) => s.telemetry?.run ?? null);

  return (
    <div className="space-y-4 px-4 pt-2 pb-6">
      {run && <RunCard />}
      <div className="space-y-2">
        <SectionTitle
          description="存在狗上，依排程或事件觸發"
          action={
            <Button size="sm" variant="ghost" className="text-primary-accent -mr-2 h-11" onClick={() => openEditor()}>
              <Plus />
              新任務
            </Button>
          }
        >
          任務 · {missions.length}
        </SectionTitle>
        {missions.length === 0 ? (
          <button
            onClick={() => openEditor()}
            className="bg-surface-sunken text-muted-foreground flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center"
          >
            <MapPinPlus className="size-6" />
            <span className="text-foreground text-sm font-medium">在地圖長按放第一個航點</span>
            <span className="text-xs">或點這裡建立新任務</span>
          </button>
        ) : (
          missions.map((m) => <MissionRow key={m.id} mission={m} />)
        )}
      </div>
    </div>
  );
}

/** §8 進行中卡片 */
function RunCard() {
  const run = useStore((s) => s.telemetry!.run!);
  const mission = useStore((s) => s.missions.find((m) => m.id === s.telemetry?.run?.missionId));
  const [confirmAbort, setConfirmAbort] = useState(false);
  const paused = run.state === "paused";
  const progress = run.totalWp ? (Math.min(run.completedWp.length, run.totalWp) / run.totalWp) * 100 : 0;

  return (
    <Card className={cn("space-y-3", paused && "border-severity-warning/40")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">{paused ? "暫停中" : "進行中"}</p>
          <p className="truncate font-semibold">{mission?.name ?? run.missionId}</p>
        </div>
        <Pill tone={paused ? "warn" : "busy"}>
          {Math.min(run.currentWp + 1, run.totalWp)}/{run.totalWp}
        </Pill>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div className={cn("h-full rounded-full transition-[width] duration-500", paused ? "bg-severity-warning" : "bg-primary")} style={{ width: `${progress}%` }} />
      </div>
      <div className="text-muted-foreground flex justify-between text-[12px] tabular-nums">
        <span>目前航點 {run.currentWp + 1}</span>
        <span>預估剩餘 {formatDuration(run.etaSec)}</span>
      </div>
      {paused && run.pausedReason && <p className="text-severity-warning text-[13px]">暫停原因：{run.pausedReason}</p>}
      <div className="grid grid-cols-2 gap-2">
        {paused ? (
          <Button className="h-11" onClick={() => void rpc("mission.resume", undefined)}>
            <Play />
            恢復
          </Button>
        ) : (
          <Button variant="secondary" className="h-11" onClick={() => void rpc("mission.pause", { reason: "使用者暫停" })}>
            <Pause />
            暫停
          </Button>
        )}
        <Button variant="outline" className="h-11" onClick={() => setConfirmAbort(true)}>
          <Square />
          中止
        </Button>
      </div>
      <Modal open={confirmAbort} onClose={() => setConfirmAbort(false)}>
        <p className="text-lg font-semibold">中止任務？</p>
        <p className="text-muted-foreground mt-1 text-sm">狗會停在原地，這次執行會記為「中止」。</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" onClick={() => setConfirmAbort(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            className="h-11"
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

function MissionRow({ mission, readOnly }: { mission: Mission; readOnly?: boolean }) {
  const history = useStore((s) => s.history);
  const now = useNow(15_000);
  const last = history.find((h) => h.missionId === mission.id);
  const next = mission.enabled ? nextTrigger(mission.trigger, now, last?.startedAt) : null;

  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border py-2.5 pr-2.5 pl-3.5">
      <button
        disabled={readOnly}
        onClick={() => set({ detailMissionId: mission.id, snap: 2 })}
        className="min-h-11 min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
      >
        <p className={cn("truncate text-[14px] font-medium", !mission.enabled && "text-muted-foreground")}>{mission.name}</p>
        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-[12px]">
          {describeTrigger(mission.trigger)}
          {next !== null && ` · ${formatRelative(next, now)}`}
          {!mission.enabled && " · 已停用"}
        </p>
      </button>
      {last && <Pill tone={RESULT[last.result].tone}>{RESULT[last.result].label}</Pill>}
      <Switch
        aria-label={`啟用 ${mission.name}`}
        checked={mission.enabled}
        disabled={readOnly}
        onCheckedChange={(v) => void rpc("mission.setEnabled", { id: mission.id, enabled: v })}
      />
      {!readOnly && <ChevronRight className="text-muted-foreground size-4 shrink-0" />}
    </div>
  );
}

// ── Detail + history (§8 歷史) ──────────────────────────────────────────────

function MissionDetail({ mission }: { mission: Mission }) {
  const allHistory = useStore((s) => s.history);
  const history = allHistory.filter((h) => h.missionId === mission.id).slice(0, 20);
  const running = useStore((s) => s.telemetry?.run?.missionId === mission.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="space-y-4 px-4 pt-1 pb-6">
      <div className="flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => set({ detailMissionId: null, snap: 1 })} aria-label="返回任務列表">
          <ChevronLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{mission.name}</p>
          <p className="text-muted-foreground text-xs">
            {describeTrigger(mission.trigger)} · {mission.route.length} 個航點
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button className="h-11" disabled={running} onClick={() => void rpc("mission.start", { id: mission.id })}>
          <Play />
          立即執行
        </Button>
        <Button variant="secondary" className="h-11" onClick={() => openEditor(mission)}>
          <Pencil />
          編輯
        </Button>
        <Button variant="outline" className="h-11" onClick={() => setConfirmDelete(true)}>
          <Trash2 />
          刪除
        </Button>
      </div>

      <div className="space-y-2">
        <SectionTitle>最近 {history.length} 次執行</SectionTitle>
        {history.length === 0 && <p className="text-muted-foreground text-sm">還沒有執行紀錄</p>}
        {history.map((r) => (
          <RunTimeline key={r.id} run={r} mission={mission} />
        ))}
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <p className="text-lg font-semibold">刪除「{mission.name}」？</p>
        <p className="text-muted-foreground mt-1 text-sm">任務與它的排程會從狗上移除，執行紀錄保留。</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
          <Button
            variant="destructive"
            className="h-11"
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

function RunTimeline({ run, mission }: { run: RunRecord; mission: Mission }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium tabular-nums">
            {new Date(run.startedAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
          </p>
          <p className="text-muted-foreground text-xs">
            {formatDuration((run.endedAt - run.startedAt) / 1000)} · 到達 {run.arrivals.length}/{mission.route.length}
          </p>
        </div>
        <Pill tone={RESULT[run.result].tone}>{RESULT[run.result].label}</Pill>
      </button>
      {open && (
        <ol className="space-y-1.5 border-t px-3.5 py-2.5">
          {mission.route.map((wp, i) => {
            const a = run.arrivals.find((x) => x.wp === i);
            return (
              <li key={wp.id} className="flex items-center gap-2 text-[12px]">
                <span className={cn("grid size-5 place-items-center rounded-full text-[10px] font-bold", a ? "bg-status-ok/20 text-status-ok" : "bg-muted text-muted-foreground")}>{i + 1}</span>
                <span className="flex-1">{a ? `${formatClock(a.at)} 到達` : "未到達"}</span>
                <span className="text-muted-foreground">{wp.actions.length ? `${wp.actions.length} 個動作` : ""}</span>
              </li>
            );
          })}
          {run.reason && <li className="text-severity-warning pt-1 text-[12px]">中止原因：{run.reason}</li>}
        </ol>
      )}
    </Card>
  );
}

export function MissionSummary() {
  const run = useStore((s) => s.telemetry?.run ?? null);
  const name = useStore((s) => s.missions.find((m) => m.id === s.telemetry?.run?.missionId)?.name);
  const count = useStore((s) => s.missions.filter((m) => m.enabled).length);
  if (run) return <span>{run.state === "paused" ? "暫停" : "進行中"}：{name} · {run.currentWp + 1}/{run.totalWp}</span>;
  return <span>{count} 個啟用中的任務 · 沒有進行中的任務</span>;
}
