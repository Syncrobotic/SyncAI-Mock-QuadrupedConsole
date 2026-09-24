import { toast } from "@/lib/notify";

import { snapToFree } from "@/lib/geometry";
import { get, set } from "@/store";
import { rpc } from "@/store/controller";

import type { Action, Mission, Waypoint } from "@/proto/types";

/**
 * Editor-draft operations. The draft is local until saved; the dog is the
 * source of truth (§8: 任務資料存在狗上), so nothing here writes a mission
 * except `save`, which goes through the gateway and its validation.
 */

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;

export function blankMission(): Mission {
  return {
    id: id("m"),
    name: "新任務",
    kind: "patrol",
    route: [],
    response: { approachM: 1.5, actions: [{ type: "snapshot", camera: "front" }] },
    policy: { onLowBattery: "return_to_dock", onObstacle: "reroute", waitSec: 10, allowTeleopPreempt: true },
    returnToDock: true,
  };
}

/**
 * Opens at 50%, not the spec's 90%: the route is edited ON the map (long-press,
 * drag), and at 90% there is no map left to press. Drag up for trigger/policy.
 */
export function openEditor(mission?: Mission) {
  set({
    editor: { draft: structuredClone(mission ?? blankMission()), isNew: !mission, selectedWp: null, issues: [] },
    snap: 1,
    view: "top",
  });
  void revalidate();
}

export function closeEditor() {
  set({ editor: null, snap: 1 });
}

export function patchDraft(patch: Partial<Mission>) {
  const e = get().editor;
  if (!e) return;
  set({ editor: { ...e, draft: { ...e.draft, ...patch } } });
  scheduleValidate();
}

export function addWaypoint(x: number, y: number) {
  const s = get();
  if (!s.editor) return;
  const p = s.occupancy ? snapToFree(s.occupancy, x, y) : { x, y };
  const wp: Waypoint = { id: id("wp"), x: p.x, y: p.y, toleranceM: 0.4, actions: [] };
  set({ editor: { ...s.editor, draft: { ...s.editor.draft, route: [...s.editor.draft.route, wp] }, selectedWp: wp.id } });
  scheduleValidate();
}

export function updateWaypoint(wpId: string, patch: Partial<Waypoint>) {
  const e = get().editor;
  if (!e) return;
  patchDraft({ route: e.draft.route.map((w) => (w.id === wpId ? { ...w, ...patch } : w)) });
}

export function removeWaypoint(wpId: string) {
  const e = get().editor;
  if (!e) return;
  patchDraft({ route: e.draft.route.filter((w) => w.id !== wpId) });
}

export function moveWaypointOrder(wpId: string, dir: -1 | 1) {
  const e = get().editor;
  if (!e) return;
  const route = [...e.draft.route];
  const i = route.findIndex((w) => w.id === wpId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= route.length) return;
  [route[i], route[j]] = [route[j], route[i]];
  patchDraft({ route });
}

export function addAction(wpId: string, action: Action) {
  const e = get().editor;
  const wp = e?.draft.route.find((w) => w.id === wpId);
  if (!wp) return;
  updateWaypoint(wpId, { actions: [...wp.actions, action] });
}

export function updateAction(wpId: string, index: number, action: Action) {
  const wp = get().editor?.draft.route.find((w) => w.id === wpId);
  if (!wp) return;
  updateWaypoint(wpId, { actions: wp.actions.map((a, i) => (i === index ? action : a)) });
}

export function removeAction(wpId: string, index: number) {
  const wp = get().editor?.draft.route.find((w) => w.id === wpId);
  if (!wp) return;
  updateWaypoint(wpId, { actions: wp.actions.filter((_, i) => i !== index) });
}

let timer: ReturnType<typeof setTimeout> | null = null;
function scheduleValidate() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void revalidate(), 250);
}

export async function revalidate() {
  const e = get().editor;
  if (!e) return;
  const r = await rpc("mission.validate", e.draft, { quiet: true });
  const cur = get().editor;
  if (r && cur && cur.draft.id === e.draft.id) set({ editor: { ...cur, issues: r.issues } });
}

export async function saveDraft() {
  const e = get().editor;
  if (!e) return false;
  const r = await rpc("mission.save", e.draft);
  if (!r) return false;
  const cur = get().editor;
  if (r.issues.some((i) => i.level === "error")) {
    if (cur) set({ editor: { ...cur, issues: r.issues } });
    toast.error("有無法儲存的問題，請先修正紅色項目");
    return false;
  }
  toast.success(r.issues.length ? `已儲存（${r.issues.length} 項警告）` : "已儲存");
  closeEditor();
  return true;
}

/** Long-press on the map (§6). With no editor open, it starts one — the empty-state promise. */
export function onMapLongPress(x: number, y: number) {
  const s = get();
  if (s.tab !== "mission") return;
  if (!s.editor) {
    if (!s.session?.scopes.includes("mission.rw") || s.device?.license.find((l) => l.feature === "mission")?.granted === false) return;
    openEditor();
  }
  addWaypoint(x, y);
}
