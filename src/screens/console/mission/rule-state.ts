import { toast } from "@/lib/notify";

import { EVENT_TYPES } from "@/lib/rules";
import { get, set } from "@/store";
import { refreshMissions, rpc } from "@/store/controller";

import type { EventTrigger, Rule, TimeTrigger, Trigger } from "@/proto/types";

let seq = 0;
const id = () => `r-${Date.now().toString(36)}${(seq++).toString(36)}`;

export const DEFAULT_TIME: TimeTrigger = {
  kind: "time",
  schedule: { type: "interval", minutes: 60, window: { from: "22:00", to: "06:00" } },
  jitterMin: 5,
  missed: "catch_up",
  graceMin: 15,
};

export const DEFAULT_EVENT: EventTrigger = {
  kind: "event",
  source: "ai",
  type: "person",
  zones: [],
  minConfidence: 0.8,
  persistSec: 3,
  countWithin: null,
  activeWindow: null,
};

function isOwner() {
  return !!get().session?.scopes.includes("admin");
}

/** Sensible defaults per kind — the design doc's §4.2 filters are ON by default. */
export function blankRule(kind: "time" | "event"): Rule {
  const s = get();
  const patrol = s.missions.find((m) => m.kind === "patrol");
  const response = s.missions.find((m) => m.kind === "response");
  const owner = isOwner();
  return {
    id: id(),
    name: kind === "time" ? "新排程" : "新事件規則",
    enabled: true,
    trigger: kind === "time" ? DEFAULT_TIME : DEFAULT_EVENT,
    missionId: (kind === "time" ? patrol : (response ?? patrol))?.id ?? "",
    priority: kind === "time" ? 2 : owner ? 1 : 2,
    mode: kind === "time" ? "auto" : "confirm",
    confirmTimeoutSec: 30,
    onTimeout: "run",
    minBattery: 25,
    cooldownSec: kind === "time" ? 0 : 300,
    maxPerHour: kind === "time" ? 4 : 6,
    onPreempted: "resume",
    queueTtlSec: kind === "time" ? 1800 : 300,
  };
}

export function openRuleEditor(rule?: Rule, kind: "time" | "event" = "time") {
  set({ ruleEditor: { draft: structuredClone(rule ?? blankRule(kind)), isNew: !rule, verdict: null }, snap: 2, detailRuleId: null });
}

export function closeRuleEditor() {
  set({ ruleEditor: null, snap: 1 });
}

export function patchRule(patch: Partial<Rule>) {
  const e = get().ruleEditor;
  if (!e) return;
  set({ ruleEditor: { ...e, draft: { ...e.draft, ...patch }, verdict: null } });
}

export function patchTrigger(patch: Partial<TimeTrigger> | Partial<EventTrigger>) {
  const e = get().ruleEditor;
  if (!e) return;
  patchRule({ trigger: { ...e.draft.trigger, ...patch } as Trigger });
}

/** Switching the trigger kind also moves the mission to one that fits it. */
export function setTriggerKind(kind: "time" | "event") {
  const e = get().ruleEditor;
  if (!e || e.draft.trigger.kind === kind) return;
  const s = get();
  const current = s.missions.find((m) => m.id === e.draft.missionId);
  const fits = kind === "event" || current?.kind === "patrol";
  const fallback = s.missions.find((m) => m.kind === (kind === "time" ? "patrol" : "response")) ?? s.missions[0];
  patchRule({
    trigger: kind === "time" ? DEFAULT_TIME : DEFAULT_EVENT,
    missionId: fits ? e.draft.missionId : (fallback?.id ?? ""),
    mode: kind === "time" ? "auto" : "confirm",
    queueTtlSec: kind === "time" ? 1800 : 300,
    cooldownSec: kind === "time" ? 0 : 300,
  });
}

export function ruleProblems(r: Rule): string[] {
  const s = get();
  const out: string[] = [];
  const mission = s.missions.find((m) => m.id === r.missionId);
  if (!r.name.trim()) out.push("請輸入規則名稱");
  if (!mission) out.push("請選擇要執行的任務");
  if (mission?.kind === "response" && (r.trigger.kind === "time" || !EVENT_TYPES[r.trigger.type].located))
    out.push("「事件回應」任務需要有位置的事件觸發（例如 AI 偵測）");
  if (r.trigger.kind === "time" && r.trigger.schedule.type === "weekly" && r.trigger.schedule.days.length === 0) out.push("每週至少選一天");
  if (r.priority <= 1 && !isOwner()) out.push("P0 / P1 規則只有擁有者能建立");
  return out;
}

export async function saveRule() {
  const e = get().ruleEditor;
  if (!e) return;
  const problems = ruleProblems(e.draft);
  if (problems.length) {
    toast.error(problems[0]);
    return;
  }
  const ok = await rpc("rule.save", e.draft);
  if (ok === null) return;
  await refreshMissions();
  toast.success(e.isNew ? "規則已建立" : "規則已儲存");
  set({ ruleEditor: null, detailRuleId: e.draft.id, snap: 1 });
}

export async function testRule(rule: Rule) {
  const r = await rpc("rule.test", rule);
  if (!r) return null;
  const e = get().ruleEditor;
  if (e && e.draft.id === rule.id) set({ ruleEditor: { ...e, verdict: r.verdict } });
  return r.verdict;
}
