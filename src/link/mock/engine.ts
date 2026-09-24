import { EVENT_TYPES, PRIORITY, inWindow, jitterFor, nextSlots } from "@/lib/rules";

export { jitterFor };

import type {
  Detection,
  EventType,
  Mission,
  PendingConfirm,
  Priority,
  QueueItem,
  Rule,
  RuleLogEntry,
  RuleOutcome,
  RunCause,
} from "@/proto/types";

/**
 * The dog-side rule engine (docs/2026-09-23-mission-triggers-design.md §2–§7).
 *
 * Pure: it holds its own bookkeeping and returns decisions; the world carries
 * them out. Every decision — including every NOT-run — is logged with a
 * reason, because "why didn't it go?" is the question a guard asks first.
 */

export interface Activation {
  id: string;
  rule: Rule;
  cause: RunCause;
  detection?: Detection;
  createdAt: number;
  expiresAt: number;
  /** A preempted run coming back. */
  resumed?: boolean;
}

export interface EngineCtx {
  now: number;
  rules: Rule[];
  missions: Mission[];
  /** What is running right now, if anything. */
  running: { priority: Priority; ruleId?: string } | null;
  /** Something a rule must never override. */
  blocked: "teleop" | "estop" | "fault" | null;
  battery: number;
  licensed: (f: "mission" | "ai") => boolean;
  zoneName: (id: string) => string;
}

export type Decision =
  | { do: "start"; act: Activation }
  | { do: "preempt"; act: Activation }
  | { do: "confirm"; act: Activation }
  | { do: "notify"; act: Activation };

const MIN = 60_000;
let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export class RuleEngine {
  queue: Activation[] = [];
  confirms = new Map<string, Activation>();
  log: RuleLogEntry[] = [];
  private lastTimeCheck: number;
  private fired: Record<string, number[]> = {};
  private tracks = new Map<string, { first: number; seen: number[]; done: boolean }>();
  private waitingNoted = new Set<string>();

  constructor(now: number) {
    this.lastTimeCheck = now;
  }

  // ── Logging ────────────────────────────────────────────────────────────────

  private note(ruleId: string, outcome: RuleOutcome, reason: string, now: number) {
    this.log.unshift({ id: uid("log"), at: now, ruleId, outcome, reason });
    if (this.log.length > 200) this.log.length = 200;
  }

  // ── Triggers ───────────────────────────────────────────────────────────────

  /** Time rules whose (jittered) slot fell in (lastCheck, now]. */
  tickTime(ctx: EngineCtx): Decision[] {
    const from = this.lastTimeCheck;
    this.lastTimeCheck = ctx.now;
    const out: Decision[] = [];
    for (const r of ctx.rules) {
      if (!r.enabled || r.trigger.kind !== "time") continue;
      const t = r.trigger;
      const pad = t.jitterMin * MIN + (t.missed === "catch_up" ? t.graceMin * MIN : 0);
      for (const slot of nextSlots(t.schedule, from - pad - 1, 20)) {
        const due = slot + jitterFor(r.id, slot, t.jitterMin);
        if (due > from && due <= ctx.now) {
          const hhmm = new Date(slot).toTimeString().slice(0, 5);
          const d = this.activate(ctx, r, {
            kind: "time",
            ruleId: r.id,
            text: `排程 ${hhmm}${t.jitterMin ? `（偏移 ${Math.round((due - slot) / MIN)} 分）` : ""}`,
          });
          if (d) out.push(d);
        }
        if (slot > ctx.now + pad) break;
      }
    }
    return out;
  }

  /** One AI sighting. Persistence / count / dedupe are per (rule, track). */
  onDetection(ctx: EngineCtx, det: Detection): Decision[] {
    const out: Decision[] = [];
    for (const r of ctx.rules) {
      const t = r.trigger;
      if (!r.enabled || t.kind !== "event" || t.type !== det.type) continue;
      if (t.zones.length && !t.zones.includes(det.zoneId)) continue;
      if (!inWindow(t.activeWindow, ctx.now)) continue;
      if (EVENT_TYPES[t.type].requires === "ai" && !ctx.licensed("ai")) continue;
      const key = `${r.id}:${det.trackId}`;
      if (det.confidence < t.minConfidence) {
        if (!this.tracks.has(key)) {
          this.tracks.set(key, { first: ctx.now, seen: [], done: true });
          this.note(
            r.id,
            "filtered",
            `信心 ${Math.round(det.confidence * 100)}% 低於門檻 ${Math.round(t.minConfidence * 100)}%`,
            ctx.now
          );
        }
        continue;
      }
      const tr = this.tracks.get(key) ?? { first: ctx.now, seen: [], done: false };
      tr.seen.push(ctx.now);
      this.tracks.set(key, tr);
      if (tr.done) continue;
      const persisted = (ctx.now - tr.first) / 1000 >= t.persistSec;
      const counted =
        !t.countWithin ||
        tr.seen.filter((s) => ctx.now - s <= t.countWithin!.sec * 1000).length >= t.countWithin.n;
      if (!persisted || !counted) continue;
      tr.done = true; // one fire per track: the same person does not trigger twenty times
      const text = `${EVENT_TYPES[det.type].label} @ ${ctx.zoneName(det.zoneId)}（${Math.round(det.confidence * 100)}%）`;
      const d = this.activate(ctx, r, { kind: "event", ruleId: r.id, text }, det);
      if (d) out.push(d);
    }
    return out;
  }

  /** A detection that ended before its rule's persistence was met. */
  endTrack(ctx: EngineCtx, trackId: string) {
    for (const r of ctx.rules) {
      const tr = this.tracks.get(`${r.id}:${trackId}`);
      if (tr && !tr.done && r.trigger.kind === "event") {
        this.note(
          r.id,
          "filtered",
          `只持續 ${Math.round((ctx.now - tr.first) / 1000)} 秒，未達 ${r.trigger.persistSec} 秒`,
          ctx.now
        );
      }
      this.tracks.delete(`${r.id}:${trackId}`);
    }
  }

  onSystemEvent(ctx: EngineCtx, type: EventType, text: string): Decision[] {
    const out: Decision[] = [];
    for (const r of ctx.rules) {
      if (!r.enabled || r.trigger.kind !== "event" || r.trigger.type !== type) continue;
      const d = this.activate(ctx, r, { kind: "event", ruleId: r.id, text });
      if (d) out.push(d);
    }
    return out;
  }

  /** Manual "run now" from the phone: an activation like any other, P1. */
  manual(ctx: EngineCtx, missionId: string, by: string): Decision[] {
    const rule: Rule = {
      id: `manual:${missionId}`,
      name: "手動執行",
      enabled: true,
      trigger: {
        kind: "time",
        schedule: { type: "once", at: ctx.now },
        jitterMin: 0,
        missed: "skip",
        graceMin: 0,
      },
      missionId,
      priority: 1,
      mode: "auto",
      confirmTimeoutSec: 0,
      onTimeout: "run",
      minBattery: 15,
      cooldownSec: 0,
      maxPerHour: 99,
      onPreempted: "resume",
      queueTtlSec: 600,
    };
    this.enqueue(ctx, {
      id: uid("act"),
      rule,
      cause: { kind: "manual", text: `手動 · ${by}` },
      createdAt: ctx.now,
      expiresAt: ctx.now + rule.queueTtlSec * 1000,
    });
    return this.pick(ctx);
  }

  // ── Activation → mode ──────────────────────────────────────────────────────

  private activate(
    ctx: EngineCtx,
    r: Rule,
    cause: RunCause,
    detection?: Detection
  ): Decision | null {
    const fired = (this.fired[r.id] ??= []).filter((t) => ctx.now - t < 3_600_000);
    this.fired[r.id] = fired;
    const last = fired[fired.length - 1];
    if (last && ctx.now - last < r.cooldownSec * 1000) {
      this.note(
        r.id,
        "filtered",
        `冷卻中（${Math.ceil((r.cooldownSec * 1000 - (ctx.now - last)) / 1000)} 秒後才能再觸發）`,
        ctx.now
      );
      return null;
    }
    if (fired.length >= r.maxPerHour) {
      this.note(r.id, "filtered", `已達每小時上限 ${r.maxPerHour} 次`, ctx.now);
      return null;
    }
    fired.push(ctx.now);

    const act: Activation = {
      id: uid("act"),
      rule: r,
      cause,
      detection,
      createdAt: ctx.now,
      expiresAt: ctx.now + r.queueTtlSec * 1000,
    };
    if (r.mode === "notify") {
      this.note(r.id, "notified", `${cause.text} · 只通知`, ctx.now);
      return { do: "notify", act };
    }
    if (r.mode === "confirm") {
      act.expiresAt = ctx.now + r.confirmTimeoutSec * 1000;
      this.confirms.set(act.id, act);
      this.note(r.id, "awaiting", `${cause.text} · 等待確認（${r.confirmTimeoutSec} 秒）`, ctx.now);
      return { do: "confirm", act };
    }
    this.enqueue(ctx, act);
    return null;
  }

  confirm(ctx: EngineCtx, activationId: string, approve: boolean, by: string) {
    const act = this.confirms.get(activationId);
    if (!act) return;
    this.confirms.delete(activationId);
    if (!approve) {
      this.note(act.rule.id, "cancelled", `${by} 忽略`, ctx.now);
      return;
    }
    act.cause = { ...act.cause, confirmedBy: by };
    act.expiresAt = ctx.now + act.rule.queueTtlSec * 1000;
    this.enqueue(ctx, act);
  }

  private enqueue(ctx: EngineCtx, act: Activation) {
    this.queue.push(act);
    this.waitingNoted.delete(act.id);
  }

  /** Re-queue a preempted run so it resumes after the interruption. */
  requeueResumed(ctx: EngineCtx, act: Activation) {
    act.resumed = true;
    act.expiresAt = ctx.now + 30 * MIN;
    this.queue.push(act);
    this.note(act.rule.id, "preempted", `被更高優先級打斷，稍後從中斷處繼續`, ctx.now);
  }

  // ── Queue → decision ───────────────────────────────────────────────────────

  tickQueue(ctx: EngineCtx): Decision[] {
    const out: Decision[] = [];
    for (const [id, act] of this.confirms) {
      if (ctx.now < act.expiresAt) continue;
      this.confirms.delete(id);
      if (act.rule.onTimeout === "run") {
        this.note(act.rule.id, "queued", "確認逾時 · 依設定自動執行", ctx.now);
        act.cause = { ...act.cause, confirmedBy: "逾時自動" };
        act.expiresAt = ctx.now + act.rule.queueTtlSec * 1000;
        this.enqueue(ctx, act);
      } else this.note(act.rule.id, "cancelled", "確認逾時 · 依設定取消", ctx.now);
    }
    this.queue = this.queue.filter((a) => {
      if (ctx.now < a.expiresAt) return true;
      this.note(
        a.rule.id,
        "expired",
        `排隊超過 ${Math.round((a.expiresAt - a.createdAt) / 1000)} 秒未執行，已丟棄`,
        ctx.now
      );
      return false;
    });
    out.push(...this.pick(ctx));
    return out;
  }

  private pick(ctx: EngineCtx): Decision[] {
    if (!this.queue.length) return [];
    this.queue.sort((a, b) => a.rule.priority - b.rule.priority || a.createdAt - b.createdAt);
    const best = this.queue[0];

    // Guards (§5.3): never silent — note once per activation while it waits.
    const wait = (reason: string, dropIt = false) => {
      if (dropIt) {
        this.queue.shift();
        this.note(best.rule.id, "skipped", reason, ctx.now);
      } else if (!this.waitingNoted.has(best.id)) {
        this.waitingNoted.add(best.id);
        this.note(best.rule.id, "queued", reason, ctx.now);
      }
      return [] as Decision[];
    };
    const mission = ctx.missions.find((m) => m.id === best.rule.missionId);
    if (!mission) return wait("任務範本已刪除", true);
    if (!ctx.licensed("mission")) return wait("License 不含任務排程", true);
    if (ctx.battery < best.rule.minBattery)
      return wait(
        `電量 ${Math.round(ctx.battery)}% 低於門檻 ${best.rule.minBattery}%`,
        best.rule.trigger.kind === "time" && best.rule.trigger.missed === "skip"
      );
    if (ctx.blocked === "teleop") return wait("操作員正在手動操控，排隊等待（規則不會搶走操控權）");
    if (ctx.blocked === "estop") return wait("緊急停止中");
    if (ctx.blocked === "fault") return wait("故障中");

    if (ctx.running) {
      // §5.1: only P0/P1 preempt, and only something strictly lower.
      if (best.rule.priority <= 1 && best.rule.priority < ctx.running.priority) {
        this.queue.shift();
        this.note(
          best.rule.id,
          "started",
          `${best.cause.text} · 打斷${PRIORITY[ctx.running.priority].label}任務`,
          ctx.now
        );
        return [{ do: "preempt", act: best }];
      }
      if (!this.waitingNoted.has(best.id)) {
        this.waitingNoted.add(best.id);
        this.note(
          best.rule.id,
          "queued",
          `正在執行${PRIORITY[ctx.running.priority].label}任務，排隊中`,
          ctx.now
        );
      }
      return [];
    }
    this.queue.shift();
    this.note(best.rule.id, "started", best.resumed ? "從中斷處繼續" : best.cause.text, ctx.now);
    return [{ do: "start", act: best }];
  }

  // ── Read-outs ─────────────────────────────────────────────────────────────

  queueItems(): QueueItem[] {
    return this.queue.map((a) => ({
      activationId: a.id,
      ruleId: a.rule.id,
      missionId: a.rule.missionId,
      priority: a.rule.priority,
      cause: a.cause.text,
      enqueuedAt: a.createdAt,
      expiresAt: a.expiresAt,
      resumed: a.resumed,
    }));
  }

  pendingConfirms(missions: Mission[]): PendingConfirm[] {
    return [...this.confirms.values()].map((a) => ({
      activationId: a.id,
      ruleId: a.rule.id,
      ruleName: a.rule.name,
      missionName: missions.find((m) => m.id === a.rule.missionId)?.name ?? a.rule.missionId,
      cause: a.cause.text,
      priority: a.rule.priority,
      expiresAt: a.expiresAt,
      onTimeout: a.rule.onTimeout,
      detection: a.detection,
    }));
  }

  /** Dry run (§7.4): what would this rule do right now, without moving the dog. */
  static dryRun(ctx: EngineCtx, r: Rule): string {
    if (!r.enabled) return "規則已停用，不會觸發";
    const mission = ctx.missions.find((m) => m.id === r.missionId);
    if (!mission) return "找不到任務範本";
    if (!ctx.licensed("mission")) return "會被擋下：License 不含任務排程";
    if (
      r.trigger.kind === "event" &&
      EVENT_TYPES[r.trigger.type].requires === "ai" &&
      !ctx.licensed("ai")
    )
      return "不會觸發：License 不含 AI 辨識";
    if (r.trigger.kind === "event" && !inWindow(r.trigger.activeWindow, ctx.now))
      return `現在不在生效時段（${r.trigger.activeWindow!.from}–${r.trigger.activeWindow!.to}）`;
    if (r.mode === "notify") return "觸發後只會通知，不會出動";
    const head =
      r.mode === "confirm"
        ? `會先詢問在線手機（${r.confirmTimeoutSec} 秒，逾時${r.onTimeout === "run" ? "執行" : "取消"}），核准後`
        : "觸發後";
    if (ctx.battery < r.minBattery)
      return `${head}會被擋下：電量 ${Math.round(ctx.battery)}% 低於 ${r.minBattery}%`;
    if (ctx.blocked === "teleop") return `${head}會排隊：操作員正在手動操控`;
    if (ctx.blocked) return `${head}會排隊：狗目前${ctx.blocked === "estop" ? "緊急停止" : "故障"}`;
    if (ctx.running) {
      if (r.priority <= 1 && r.priority < ctx.running.priority)
        return `${head}會打斷目前的${PRIORITY[ctx.running.priority].label}任務，立刻出動「${mission.name}」`;
      return `${head}會排隊：正在執行${PRIORITY[ctx.running.priority].label}任務`;
    }
    return `${head}會立刻出動「${mission.name}」`;
  }
}
