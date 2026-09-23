"use client";

import { ArrowDown, ArrowUp, Camera, ChevronDown, CircleAlert, Clock, FlaskConical, Gauge, Lock, Megaphone, Plus, Thermometer, Trash2, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import { Field, SectionTitle, Segmented, Select, Slider, inputClass } from "@/components/kit";
import { SchemaForm, defaultsFor } from "@/components/SchemaForm";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { estimateMission } from "@/lib/schedule";
import { cn, formatDuration } from "@/lib/utils";
import { set, useStore } from "@/store";

import { closeEditor, moveWaypointOrder, patchDraft, removeWaypoint, saveDraft, updateWaypoint } from "./editor";

import type { Action, Mission, PluginManifest, Waypoint } from "@/proto/types";

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
      <div className="bg-surface sticky top-0 z-10 flex items-center gap-2 border-b px-2 py-1">
        <Button size="icon" variant="ghost" onClick={closeEditor} aria-label="取消編輯">
          <X />
        </Button>
        <p className="flex-1 truncate text-[14px] font-semibold">{editor.isNew ? "新任務" : "編輯任務"}</p>
        <Button
          loading={saving}
          disabled={errors.length > 0 || (d.kind === "patrol" && d.route.length === 0)}
          onClick={async () => {
            setSaving(true);
            await saveDraft();
            setSaving(false);
          }}
        >
          儲存
        </Button>
      </div>

      {/* Route first: at 50% the waypoints are what you are placing on the map
          above, so they get the space; basics follow. */}
      <div className="flex flex-1 flex-col gap-5 px-3 pt-3 pb-8">
        {/* 1 基本 */}
        <section className="order-2 space-y-3">
          <SectionTitle description="任務只定義「做什麼」；什麼時候、為什麼執行，在「規則」設定">1 · 基本</SectionTitle>
          <Field label="名稱">
            <input className={inputClass} value={d.name} onChange={(e) => patchDraft({ name: e.target.value })} />
          </Field>
          <Segmented
            value={d.kind}
            options={[
              { value: "patrol", label: "巡邏路線" },
              { value: "response", label: "事件回應" },
            ]}
            onChange={(kind) => patchDraft({ kind })}
          />
          <p className="text-muted-foreground text-[11px]">
            {d.kind === "patrol" ? "沿固定航點巡邏，由時間或事件規則啟動。" : "前往觸發事件的位置，到場後執行動作。只能由事件規則啟動。"}
          </p>
        </section>

        {d.kind === "response" && (
          <section className="order-1 space-y-3">
            <SectionTitle description="狗會規劃路徑到事件位置附近，停在安全距離外">2 · 到場後</SectionTitle>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[13px]">
                停在距離事件
                <span className="font-semibold tabular-nums">{d.response.approachM.toFixed(1)} m</span>
              </div>
              <Slider label="靠近距離" min={0.5} max={6} step={0.5} value={d.response.approachM} onChange={(v) => patchDraft({ response: { ...d.response, approachM: v } })} />
            </div>
            <ActionList
              actions={d.response.actions}
              onChange={(actions) => patchDraft({ response: { ...d.response, actions } })}
            />
          </section>
        )}

        {/* 2 路線 */}
        {d.kind === "patrol" && (
        <section className="order-1 space-y-2">
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
        )}

        {/* 4 策略 */}
        <section className="order-4 space-y-1">
          <SectionTitle>3 · 策略</SectionTitle>
          <PolicyEditor mission={d} />
        </section>

        {/* 5 驗證 */}
        <section className="order-5 space-y-2">
          <SectionTitle>4 · 儲存前驗證</SectionTitle>
          {editor.issues.length === 0 && (d.kind === "response" || d.route.length > 0) && <p className="text-status-ok text-[13px]">航點可達、電量足夠</p>}
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

  return (
    <li
      className={cn("bg-card rounded-xl border", selected && "ring-primary/50 ring-2", error && "border-status-error/50")}
      ref={(el) => {
        // §8: selecting a waypoint on the map scrolls the list to it.
        if (el && selected) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }}
    >
      <div className="flex items-center gap-1 py-0.5 pr-1 pl-2.5">
        <button
          onClick={() => set((s) => (s.editor ? { editor: { ...s.editor, selectedWp: selected ? null : wp.id } } : {}))}
          className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
        >
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white", error ? "bg-status-error" : "bg-[var(--map-path-planned)]")}>
            {index + 1}
          </span>
          {/* One line per waypoint: coordinates, then what happens there. */}
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-[13px] font-medium tabular-nums">
              ({wp.x.toFixed(1)}, {wp.y.toFixed(1)})
            </span>
            <span className="text-muted-foreground truncate text-[11px]">{wp.actions.length ? wp.actions.map(actionLabel(plugins)).join(" → ") : "無動作"}</span>
          </span>
          <ChevronDown className={cn("text-muted-foreground ml-auto size-4 shrink-0 transition-transform", selected && "rotate-180")} />
        </button>
        <Button size="icon-sm" variant="ghost" className="shrink-0" disabled={index === 0} onClick={() => moveWaypointOrder(wp.id, -1)} aria-label="上移">
          <ArrowUp />
        </Button>
        <Button size="icon-sm" variant="ghost" disabled={last} onClick={() => moveWaypointOrder(wp.id, 1)} aria-label="下移">
          <ArrowDown />
        </Button>
      </div>

      {selected && (
        <div className="space-y-2 border-t px-3 py-3">
          <ActionList actions={wp.actions} onChange={(actions) => updateWaypoint(wp.id, { actions })} />
          <Button variant="ghost" size="sm" className="text-status-error w-full" onClick={() => removeWaypoint(wp.id)}>
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

/** A list of actions with an add menu — used by waypoints and by response missions. */
function ActionList({ actions, onChange }: { actions: Action[]; onChange: (a: Action[]) => void }) {
  const plugins = useStore((s) => s.device?.plugins) ?? [];
  const [menu, setMenu] = useState(false);
  const add = (a: Action) => {
    onChange([...actions, a]);
    setMenu(false);
  };
  return (
    <div className="space-y-2">
      {actions.map((a, i) => (
        <ActionItem
          key={i}
          index={i}
          action={a}
          plugins={plugins}
          onChange={(next) => onChange(actions.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(actions.filter((_, j) => j !== i))}
        />
      ))}
      <Button variant="outline" size="sm" className="w-full" onClick={() => setMenu((m) => !m)}>
        <Plus />
        加入動作
      </Button>
      {menu && (
        <div className="bg-popover space-y-2 rounded-xl border p-2 shadow-lg">
          <div className="grid grid-cols-4 gap-1">
            {BUILTIN.map((b) => (
              <button key={b.label} onClick={() => add(b.make())} className="hover:bg-accent flex h-10 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-[11px]">
                <b.icon className="size-3.5" />
                {b.label}
              </button>
            ))}
          </div>
          {/* §11: plugin actions after the built-ins, grouped by plugin. */}
          {plugins.map((p) => (
            <div key={p.id}>
              <p className="text-muted-foreground px-1 pt-1 text-[11px] font-semibold">
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
                    onClick={() => add({ type: "plugin", pluginId: p.id, actionId: a.id, params: defaultsFor(a.schema) })}
                    className="hover:bg-accent flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
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
  );
}

function ActionItem({
  index,
  action,
  plugins,
  onChange,
  onRemove,
}: {
  index: number;
  action: Action;
  plugins: PluginManifest[];
  onChange: (a: Action) => void;
  onRemove: () => void;
}) {
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
        <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label="移除動作">
          <X />
        </Button>
      </div>
      {open && (
        <div className="border-t px-3 py-2.5">
          {action.type === "wait" && (
            <Field label="等待秒數">
              <input className={inputClass} type="number" min={1} max={600} value={action.sec} onChange={(e) => onChange({ ...action, sec: Number(e.target.value) })} />
            </Field>
          )}
          {action.type === "snapshot" && (
            <Segmented
              value={action.camera}
              options={[
                { value: "front", label: "前鏡頭" },
                { value: "rear", label: "後鏡頭" },
              ]}
              onChange={(camera) => onChange({ ...action, camera })}
            />
          )}
          {action.type === "thermal" && <p className="text-muted-foreground text-xs">在此航點做 360° 熱像掃描，約 4 秒。</p>}
          {action.type === "announce" && (
            <Select
              label="廣播音檔"
              value={action.clipId}
              options={(clips ?? []).map((c) => ({ value: c.id, label: `${c.name}（${c.sec}s）` }))}
              onChange={(clipId) => onChange({ ...action, clipId })}
            />
          )}
          {action.type === "plugin" &&
            (contribution ? (
              <SchemaForm schema={contribution.schema} value={action.params} onChange={(params) => onChange({ ...action, params })} />
            ) : (
              <p className="text-muted-foreground text-xs">此 plugin 已移除</p>
            ))}
        </div>
      )}
    </div>
  );
}

// ── Policy ──────────────────────────────────────────────────────────────────

function PolicyEditor({ mission }: { mission: Mission }) {
  const p = mission.policy;
  const patch = (x: Partial<Mission["policy"]>) => patchDraft({ policy: { ...p, ...x } });
  return (
    <div className="divide-y">
      <div className="flex min-h-10 items-center justify-between gap-3 text-[13px]">
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
      <div className="flex min-h-10 items-center justify-between gap-3 text-[13px]">
        <span className="text-[14px]">遇到障礙</span>
        <div className="flex items-center gap-1.5">
          {p.onObstacle === "wait" && (
            <input aria-label="等待秒數" className={cn(inputClass, "w-16 text-center")} type="number" value={p.waitSec} onChange={(e) => patch({ waitSec: Number(e.target.value) })} />
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
      <label className="flex min-h-10 items-center justify-between gap-3 text-[13px]">
        <span className="text-[14px]">允許操控搶佔</span>
        <Switch checked={p.allowTeleopPreempt} onCheckedChange={(allowTeleopPreempt) => patch({ allowTeleopPreempt })} />
      </label>
      <label className="flex min-h-10 items-center justify-between gap-3 text-[13px]">
        <span className="text-[14px]">結束後返回充電座</span>
        <Switch checked={mission.returnToDock} onCheckedChange={(returnToDock) => patchDraft({ returnToDock })} />
      </label>
    </div>
  );
}
