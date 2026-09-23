"use client";

import { ArrowDown, ArrowUp, Camera, ChevronDown, CircleAlert, Clock, FlaskConical, Gauge, Lock, Megaphone, Plus, Thermometer, Trash2, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import { Field, SectionTitle, Segmented, Select, inputClass } from "@/components/kit";
import { SchemaForm, defaultsFor } from "@/components/SchemaForm";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { estimateMission, toCron } from "@/lib/schedule";
import { cn, formatDuration } from "@/lib/utils";
import { set, useStore } from "@/store";

import {
  addAction,
  closeEditor,
  moveWaypointOrder,
  patchDraft,
  removeAction,
  removeWaypoint,
  saveDraft,
  updateAction,
} from "./editor";

import type { Action, Mission, PluginManifest, Trigger, Waypoint } from "@/proto/types";

/** §8 Sheet 90%: mission editor. Returning is closing the sheet, not "back". */
export function MissionEditor() {
  const editor = useStore((s) => s.editor)!;
  const pose = useStore((s) => s.telemetry?.pose);
  const [saving, setSaving] = useState(false);
  const d = editor.draft;
  const errors = editor.issues.filter((i) => i.level === "error");
  const warnings = editor.issues.filter((i) => i.level === "warning");
  const est = estimateMission(d, pose);

  return (
    <div className="flex min-h-full flex-col">
      <div className="bg-surface sticky top-0 z-10 flex items-center gap-2 border-b px-4 py-2">
        <Button size="icon" variant="ghost" onClick={closeEditor} aria-label="取消編輯">
          <X />
        </Button>
        <p className="flex-1 truncate text-[15px] font-semibold">{editor.isNew ? "新任務" : "編輯任務"}</p>
        <Button
          loading={saving}
          disabled={errors.length > 0 || d.route.length === 0}
          onClick={async () => {
            setSaving(true);
            await saveDraft();
            setSaving(false);
          }}
        >
          儲存
        </Button>
      </div>

      <div className="flex-1 space-y-6 px-4 pt-4 pb-8">
        {/* 1 基本 */}
        <section className="space-y-3">
          <SectionTitle>1 · 基本</SectionTitle>
          <Field label="名稱">
            <input className={inputClass} value={d.name} onChange={(e) => patchDraft({ name: e.target.value })} />
          </Field>
          <label className="flex min-h-11 items-center justify-between">
            <span className="text-[14px]">啟用</span>
            <Switch checked={d.enabled} onCheckedChange={(v) => patchDraft({ enabled: v })} />
          </label>
        </section>

        {/* 2 路線 */}
        <section className="space-y-2">
          <SectionTitle>2 · 路線 · {d.route.length} 個航點</SectionTitle>
          <p className="text-muted-foreground text-xs">
            約 {est.meters.toFixed(0)} m · {formatDuration(est.sec)} · 耗電約 {est.batteryPct.toFixed(0)}%
          </p>
          {d.route.length === 0 && (
            <div className="bg-surface-sunken text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">在地圖上長按 0.5 秒放第一個航點</div>
          )}
          <ol className="space-y-2">
            {d.route.map((wp, i) => (
              <WaypointItem key={wp.id} wp={wp} index={i} last={i === d.route.length - 1} />
            ))}
          </ol>
        </section>

        {/* 3 觸發 */}
        <section className="space-y-3">
          <SectionTitle>3 · 觸發</SectionTitle>
          <TriggerEditor trigger={d.trigger} onChange={(trigger) => patchDraft({ trigger })} />
        </section>

        {/* 4 策略 */}
        <section className="space-y-1">
          <SectionTitle>4 · 策略</SectionTitle>
          <PolicyEditor mission={d} />
        </section>

        {/* 5 驗證 */}
        <section className="space-y-2">
          <SectionTitle>5 · 儲存前驗證</SectionTitle>
          {editor.issues.length === 0 && d.route.length > 0 && <p className="text-status-ok text-[13px]">航點可達、無時間重疊、電量足夠</p>}
          {[...errors, ...warnings].map((issue, i) => (
            <button
              key={i}
              onClick={() => issue.waypointId && set({ editor: { ...editor, selectedWp: issue.waypointId } })}
              className={cn(
                "flex w-full cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left text-[13px]",
                issue.level === "error" ? "border-status-error/30 bg-status-error/10 text-status-error" : "border-severity-warning/30 bg-severity-warning/10 text-severity-warning"
              )}
            >
              {issue.level === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
              <span>
                {issue.message}
                <span className="block text-[11px] opacity-75">{issue.level === "error" ? "無法儲存" : "可以儲存"}</span>
              </span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}

// ── Waypoints ───────────────────────────────────────────────────────────────

const BUILTIN: { label: string; icon: typeof Clock; make: () => Action }[] = [
  { label: "等待", icon: Clock, make: () => ({ type: "wait", sec: 5 }) },
  { label: "快照", icon: Camera, make: () => ({ type: "snapshot", camera: "front" }) },
  { label: "熱像掃描", icon: Thermometer, make: () => ({ type: "thermal" }) },
  { label: "廣播", icon: Megaphone, make: () => ({ type: "announce", clipId: "clip-restricted" }) },
];

const PLUGIN_ICON: Record<string, typeof Clock> = { flask: FlaskConical, gauge: Gauge };

function WaypointItem({ wp, index, last }: { wp: Waypoint; index: number; last: boolean }) {
  const selected = useStore((s) => s.editor?.selectedWp === wp.id);
  const error = useStore((s) => s.editor?.issues.some((i) => i.level === "error" && i.waypointId === wp.id));
  const plugins = useStore((s) => s.device?.plugins);
  const [menu, setMenu] = useState(false);

  return (
    <li
      className={cn("bg-card rounded-xl border", selected && "ring-primary/50 ring-2", error && "border-status-error/50")}
      ref={(el) => {
        // §8: selecting a waypoint on the map scrolls the list to it.
        if (el && selected) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }}
    >
      <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
        <button
          onClick={() => set((s) => (s.editor ? { editor: { ...s.editor, selectedWp: selected ? null : wp.id } } : {}))}
          className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
        >
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white", error ? "bg-status-error" : "bg-[var(--map-path-planned)]")}>
            {index + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium tabular-nums">
              ({wp.x.toFixed(1)}, {wp.y.toFixed(1)})
            </span>
            <span className="text-muted-foreground block truncate text-[11px]">{wp.actions.length ? wp.actions.map(actionLabel(plugins)).join(" → ") : "無動作"}</span>
          </span>
          <ChevronDown className={cn("text-muted-foreground ml-auto size-4 shrink-0 transition-transform", selected && "rotate-180")} />
        </button>
        <Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => moveWaypointOrder(wp.id, -1)} aria-label="上移">
          <ArrowUp />
        </Button>
        <Button size="icon-sm" variant="ghost" disabled={last} onClick={() => moveWaypointOrder(wp.id, 1)} aria-label="下移">
          <ArrowDown />
        </Button>
      </div>

      {selected && (
        <div className="space-y-2 border-t px-3 py-3">
          {wp.actions.map((a, i) => (
            <ActionItem key={i} wpId={wp.id} index={i} action={a} plugins={plugins ?? []} />
          ))}
          <div className="relative">
            <Button variant="outline" size="sm" className="h-10 w-full" onClick={() => setMenu((m) => !m)}>
              <Plus />
              加入節點動作
            </Button>
            {menu && (
              <div className="bg-popover mt-1.5 space-y-2 rounded-xl border p-2 shadow-lg">
                <div className="grid grid-cols-4 gap-1">
                  {BUILTIN.map((b) => (
                    <button
                      key={b.label}
                      onClick={() => {
                        addAction(wp.id, b.make());
                        setMenu(false);
                      }}
                      className="hover:bg-accent flex h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg text-[11px]"
                    >
                      <b.icon className="size-4" />
                      {b.label}
                    </button>
                  ))}
                </div>
                {/* §11: plugin actions after the built-ins, grouped by plugin. */}
                {(plugins ?? []).map((p) => (
                  <div key={p.id}>
                    <p className="text-muted-foreground px-1 pt-1 text-[10px] font-semibold tracking-wider uppercase">
                      {p.name} · v{p.version}
                    </p>
                    {p.missionActions.map((a) => {
                      const Icon = PLUGIN_ICON[a.icon] ?? FlaskConical;
                      const missing = a.requires.filter((r) => !p.capabilities.includes(r));
                      const locked = !p.enabled || missing.length > 0;
                      return (
                        <button
                          key={a.id}
                          disabled={locked}
                          onClick={() => {
                            addAction(wp.id, { type: "plugin", pluginId: p.id, actionId: a.id, params: defaultsFor(a.schema) });
                            setMenu(false);
                          }}
                          className="hover:bg-accent flex h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Icon className="size-4" />
                          {a.label}
                          {locked && (
                            <span className="text-muted-foreground ml-auto flex items-center gap-1 text-[11px]">
                              <Lock className="size-3" />
                              {!p.enabled ? "plugin 已停用" : `缺少 ${missing.join("、")}`}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" size="sm" className="text-status-error h-10 w-full" onClick={() => removeWaypoint(wp.id)}>
            <Trash2 />
            刪除航點
          </Button>
        </div>
      )}
    </li>
  );
}

function actionLabel(plugins: PluginManifest[] | undefined) {
  return (a: Action) => {
    switch (a.type) {
      case "wait":
        return `等待 ${a.sec}s`;
      case "snapshot":
        return "快照";
      case "thermal":
        return "熱像";
      case "announce":
        return "廣播";
      case "plugin":
        return plugins?.find((p) => p.id === a.pluginId)?.missionActions.find((x) => x.id === a.actionId)?.label ?? a.actionId;
    }
  };
}

function ActionItem({ wpId, index, action, plugins }: { wpId: string; index: number; action: Action; plugins: PluginManifest[] }) {
  const clips = useStore((s) => s.device?.clips);
  const [open, setOpen] = useState(action.type === "plugin");
  const plugin = action.type === "plugin" ? plugins.find((p) => p.id === action.pluginId) : undefined;
  const contribution = action.type === "plugin" ? plugin?.missionActions.find((a) => a.id === action.actionId) : undefined;

  return (
    <div className="bg-surface-sunken rounded-lg border">
      <div className="flex items-center gap-2 py-1 pr-1 pl-3">
        <button onClick={() => setOpen((o) => !o)} className="min-h-9 flex-1 cursor-pointer text-left text-[13px] font-medium">
          {index + 1}. {actionLabel(plugins)(action)}
          {plugin && <span className="text-muted-foreground ml-1.5 text-[11px] font-normal">{plugin.name}</span>}
        </button>
        <Button size="icon-sm" variant="ghost" onClick={() => removeAction(wpId, index)} aria-label="移除動作">
          <X />
        </Button>
      </div>
      {open && (
        <div className="border-t px-3 py-2.5">
          {action.type === "wait" && (
            <Field label="等待秒數">
              <input className={inputClass} type="number" min={1} max={600} value={action.sec} onChange={(e) => updateAction(wpId, index, { ...action, sec: Number(e.target.value) })} />
            </Field>
          )}
          {action.type === "snapshot" && (
            <Segmented
              value={action.camera}
              options={[
                { value: "front", label: "前鏡頭" },
                { value: "rear", label: "後鏡頭" },
              ]}
              onChange={(camera) => updateAction(wpId, index, { ...action, camera })}
            />
          )}
          {action.type === "thermal" && <p className="text-muted-foreground text-xs">在此航點做 360° 熱像掃描，約 4 秒。</p>}
          {action.type === "announce" && (
            <Select
              label="廣播音檔"
              value={action.clipId}
              options={(clips ?? []).map((c) => ({ value: c.id, label: `${c.name}（${c.sec}s）` }))}
              onChange={(clipId) => updateAction(wpId, index, { ...action, clipId })}
            />
          )}
          {action.type === "plugin" &&
            (contribution ? (
              <SchemaForm schema={contribution.schema} value={action.params} onChange={(params) => updateAction(wpId, index, { ...action, params })} />
            ) : (
              <p className="text-muted-foreground text-xs">此 plugin 已移除</p>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Trigger (§8: 三選一分段控制；Cron 用視覺化選擇器，進階才露 cron 字串) ─────────

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function TriggerEditor({ trigger, onChange }: { trigger: Trigger; onChange: (t: Trigger) => void }) {
  const kind = trigger.type === "once" ? "once" : trigger.type === "event" ? "event" : "cron";
  const [advanced, setAdvanced] = useState(false);
  const cron = toCron(trigger);

  return (
    <div className="space-y-3">
      <Segmented
        value={kind}
        options={[
          { value: "once", label: "單次" },
          { value: "cron", label: "週期" },
          { value: "event", label: "事件" },
        ]}
        onChange={(k) =>
          onChange(
            k === "once"
              ? { type: "once", at: Date.now() + 3_600_000 }
              : k === "event"
                ? { type: "event", eventType: "perception", filter: "person" }
                : { type: "daily", time: "21:00" }
          )
        }
      />

      {trigger.type === "once" && (
        <Field label="執行時間（狗的時鐘）">
          <input
            className={inputClass}
            type="datetime-local"
            value={toLocalInput(trigger.at)}
            onChange={(e) => onChange({ type: "once", at: new Date(e.target.value).getTime() })}
          />
        </Field>
      )}

      {kind === "cron" && (
        <>
          <Segmented
            value={trigger.type as "daily" | "weekly" | "interval"}
            options={[
              { value: "daily", label: "每日" },
              { value: "weekly", label: "每週" },
              { value: "interval", label: "間隔" },
            ]}
            onChange={(t) =>
              onChange(t === "daily" ? { type: "daily", time: timeOf(trigger) } : t === "weekly" ? { type: "weekly", days: [1, 2, 3, 4, 5], time: timeOf(trigger) } : { type: "interval", minutes: 30 })
            }
          />
          {trigger.type === "weekly" && (
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, d) => {
                const on = trigger.days.includes(d);
                return (
                  <button
                    key={d}
                    aria-pressed={on}
                    onClick={() => onChange({ ...trigger, days: on ? trigger.days.filter((x) => x !== d) : [...trigger.days, d].sort() })}
                    className={cn("h-10 cursor-pointer rounded-lg border text-[13px] font-medium", on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent")}
                  >
                    {w}
                  </button>
                );
              })}
            </div>
          )}
          {(trigger.type === "daily" || trigger.type === "weekly") && (
            <Field label="時間（狗的時鐘）">
              <input className={inputClass} type="time" value={trigger.time} onChange={(e) => onChange({ ...trigger, time: e.target.value })} />
            </Field>
          )}
          {trigger.type === "interval" && (
            <Field label="每隔幾分鐘">
              <input className={inputClass} type="number" min={5} max={1440} value={trigger.minutes} onChange={(e) => onChange({ type: "interval", minutes: Number(e.target.value) })} />
            </Field>
          )}
          <button onClick={() => setAdvanced((a) => !a)} className="text-muted-foreground cursor-pointer text-xs underline-offset-2 hover:underline">
            {advanced ? "隱藏進階" : "進階"}
          </button>
          {advanced && cron && <code className="bg-muted block rounded-md px-3 py-2 font-mono text-[13px]">{cron}</code>}
        </>
      )}

      {trigger.type === "event" && (
        <Select
          label="事件"
          value={trigger.eventType}
          options={[
            { value: "perception", label: "偵測到人員" },
            { value: "fence", label: "圍欄越界" },
          ]}
          onChange={(eventType) => onChange({ ...trigger, eventType })}
        />
      )}
    </div>
  );
}

function timeOf(t: Trigger) {
  return t.type === "daily" || t.type === "weekly" ? t.time : "21:00";
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Policy ──────────────────────────────────────────────────────────────────

function PolicyEditor({ mission }: { mission: Mission }) {
  const p = mission.policy;
  const patch = (x: Partial<Mission["policy"]>) => patchDraft({ policy: { ...p, ...x } });
  return (
    <div className="divide-y">
      <div className="flex min-h-12 items-center justify-between gap-3">
        <span className="text-[14px]">低電量時</span>
        <Select
          label="低電量時"
          className="w-36"
          value={p.onLowBattery}
          options={[
            { value: "return_to_dock", label: "返回充電座" },
            { value: "pause", label: "原地暫停" },
          ]}
          onChange={(onLowBattery) => patch({ onLowBattery })}
        />
      </div>
      <div className="flex min-h-12 items-center justify-between gap-3">
        <span className="text-[14px]">遇到障礙</span>
        <div className="flex items-center gap-1.5">
          {p.onObstacle === "wait" && (
            <input aria-label="等待秒數" className={cn(inputClass, "h-10 w-16 text-center")} type="number" value={p.waitSec} onChange={(e) => patch({ waitSec: Number(e.target.value) })} />
          )}
          <Select
            label="遇到障礙"
            className="w-28"
            value={p.onObstacle}
            options={[
              { value: "reroute", label: "繞路" },
              { value: "wait", label: "等待" },
              { value: "abort", label: "中止" },
            ]}
            onChange={(onObstacle) => patch({ onObstacle })}
          />
        </div>
      </div>
      <label className="flex min-h-12 items-center justify-between gap-3">
        <span className="text-[14px]">允許操控搶佔</span>
        <Switch checked={p.allowTeleopPreempt} onCheckedChange={(allowTeleopPreempt) => patch({ allowTeleopPreempt })} />
      </label>
      <label className="flex min-h-12 items-center justify-between gap-3">
        <span className="text-[14px]">結束後返回充電座</span>
        <Switch checked={mission.returnToDock} onCheckedChange={(returnToDock) => patchDraft({ returnToDock })} />
      </label>
    </div>
  );
}
