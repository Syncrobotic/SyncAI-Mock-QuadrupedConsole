import { clamp } from "@/lib/utils";
import { actionSeconds, nextTrigger, PATROL_SPEED } from "@/lib/schedule";

import { Emitter } from "./emitter";
import { seedDevice, seedHistory, seedMissions, seedPhones, uid, DEFAULT_FENCE } from "./fixtures";
import { buildPointCloud, DOCK, GRID, insidePolygon, isFree, PLAN } from "./floor";
import { licenseFor, mockActivate } from "@/lib/license";
import { SCENARIOS, type ScenarioId } from "./scenarios";

import type {
  DeviceInfo,
  DogEvent,
  DogMode,
  EventLevel,
  Fence,
  Gait,
  GatewayHealth,
  LicenseActivation,
  LicenseInfo,
  MapChunk,
  Mission,
  PairedPhone,
  Pose,
  Posture,
  Role,
  RunRecord,
  TelemetryFrame,
} from "@/proto/types";

/**
 * The fake dog. One instance per scenario; the mock BLE, Gateway and Media
 * channels are three windows onto it, which is what makes "WS drops but BLE
 * still reaches the dog" (§13 BleOnly) behave like the real thing.
 *
 * It ticks whether or not a phone is connected — the dog does not stop
 * existing when the WS closes — and only *emits* telemetry while one is.
 */

interface InternalRun {
  mission: Mission;
  targets: { x: number; y: number; wpIndex: number | null }[];
  idx: number;
  phase: "moving" | "acting";
  actionIdx: number;
  actionEndsAt: number;
  paused: string | null;
  arrivals: { wp: number; at: number }[];
  snapshots: { wp: number; at: number }[];
  startedAt: number;
}

export interface MockDevSettings {
  ownerOnline: boolean;
  bleFlaky: boolean;
}

const PERCEPTION = [
  { text: "偵測到人員 · 南側走廊", level: "warning" as EventLevel },
  { text: "偵測到未關閉的門 · 會議室 3", level: "info" as EventLevel },
  { text: "異常聲響 · 機房", level: "warning" as EventLevel },
  { text: "偵測到遺留物品 · 大廳", level: "info" as EventLevel },
];

export class MockWorld {
  readonly scenario;
  readonly dev: MockDevSettings = { ownerOnline: true, bleFlaky: false };

  // Dog state
  pose: Pose = { ...DOCK };
  private vel = { vx: 0, vy: 0, wz: 0 };
  speed = 0;
  mode: DogMode = "IDLE";
  gait: Gait = "walk";
  posture: Posture = "stand";
  battery: number;
  charging = false;
  estop: { by: string; at: number } | null = null;
  fault: TelemetryFrame["fault"] = null;
  rtt = 40;
  private lastControlSeq = 0;
  private cmd = { vx: 0, vy: 0, wz: 0, at: 0 };
  teleopHolder: TelemetryFrame["teleopHolder"] = null;
  private run: InternalRun | null = null;
  private estopLyingAt: number | null = null;
  private outsideFence = false;

  // Stores
  missions: Mission[] = seedMissions();
  fences: Fence[] = [DEFAULT_FENCE];
  history: RunRecord[];
  private _device: DeviceInfo;
  license: LicenseInfo;
  phones: PairedPhone[] = [];
  eventLog: DogEvent[] = [];
  private lastRunAt: Record<string, number> = {};
  private lastScheduleCheck = Date.now();

  // Transport state
  gatewayState: GatewayHealth["state"] = "up";
  wsOpen = false;
  myRole: Role = "owner";
  private connectedAt = 0;
  private firedTimeline = new Set<number>();
  private nextPerceptionAt = Date.now() + 30_000 + Math.random() * 60_000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private lastTick = Date.now();
  private mapTimer: ReturnType<typeof setInterval> | null = null;

  readonly telemetry = new Emitter<TelemetryFrame>();
  readonly events = new Emitter<DogEvent>();
  readonly map = new Emitter<MapChunk>(true);
  readonly closed = new Emitter<{ reason: "network" | "revoked" | "gateway_down" }>();
  readonly health = new Emitter<GatewayHealth>(true);

  constructor(scenarioId: ScenarioId) {
    this.scenario = SCENARIOS[scenarioId];
    const now = Date.now();
    this.battery = this.scenario.battery;
    this.history = seedHistory(now);
    this._device = seedDevice(now, this.scenario.missionLicense);
    this.license = loadLicense() ?? licenseFor("pro", "SYNC-PRO1-2026-DEMO", now);
    if (scenarioId === "low_battery") {
      this.mode = "CHARGING";
      this.charging = true;
    }
    this.health.emit({ state: "up" });
  }

  /** Device info with the licence folded in (and the `no_license` scenario on top). */
  get device(): DeviceInfo {
    const license = this.license.features.map((f) =>
      f.feature === "mission" && !this.scenario.missionLicense ? { ...f, granted: false } : f
    );
    return {
      ...this._device,
      license,
      licenseExpiresAt: this.license.expiresAt ?? 0,
      licenseEdition: this.license.edition,
      licenseKeyMasked: this.license.keyMasked,
    };
  }

  patchDevice(patch: Partial<DeviceInfo>) {
    this._device = { ...this._device, ...patch };
  }

  hasFeature(f: LicenseInfo["features"][number]["feature"]) {
    return !!this.device.license.find((x) => x.feature === f)?.granted;
  }

  /** A factory-fresh dog has no licence until its first Owner binds one. */
  resetAsNewDog() {
    this.license = licenseFor("none", null, Date.now());
    saveLicense(this.license);
  }

  activateLicense(key: string): LicenseActivation {
    const r = mockActivate(key, Date.now());
    if (r.ok) {
      this.license = r.license;
      saveLicense(r.license);
      this.emitEvent("system", "info", `License 已啟用：${r.license.keyMasked}`);
    }
    return r;
  }

  start() {
    this.stop();
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), 1000 / this.scenario.telemetryHz);
    this.healthTimer = setInterval(() => this.health.emit(this.healthNow()), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.mapTimer) clearInterval(this.mapTimer);
    this.timer = this.healthTimer = this.mapTimer = null;
  }

  private healthNow(): GatewayHealth {
    return this.gatewayState === "down"
      ? { state: "down", lastError: "E_GW_CRASH 0x0B · gatewayd 未回應看門狗" }
      : { state: this.gatewayState };
  }

  // ── Connection lifecycle (called by the gateway channel) ──────────────────

  open(role: Role) {
    this.myRole = this.scenario.forceRole ?? role;
    this.wsOpen = true;
    this.connectedAt = Date.now();
    if (this.phones.length === 0) this.phones = seedPhones(this.myRole, Date.now());
    this.streamMap();
  }

  close() {
    this.wsOpen = false;
    if (this.teleopHolder?.mine) this.releaseTeleop();
    if (this.mapTimer) clearInterval(this.mapTimer);
  }

  private streamMap() {
    if (this.mapTimer) clearInterval(this.mapTimer);
    const cloud = cloudFor(this.scenario.pointBudget);
    const total = cloud.positions.length / 3;
    // §6: first frame at 20% loaded, the rest streamed in.
    let loaded = Math.round(total * 0.2);
    const emit = () =>
      this.map.emit({ positions: cloud.positions, colors: cloud.colors, loaded, total, occupancy: GRID, plan: PLAN });
    emit();
    this.mapTimer = setInterval(() => {
      loaded = Math.min(total, loaded + Math.round(total * 0.08));
      emit();
      if (loaded >= total && this.mapTimer) clearInterval(this.mapTimer);
    }, 220);
  }

  // ── Inputs ───────────────────────────────────────────────────────────────

  control(frame: { vx: number; vy: number; wz: number }) {
    this.lastControlSeq++;
    this.cmd = { ...frame, at: Date.now() };
  }

  triggerEstop(by: string) {
    if (this.mode === "ESTOP") return;
    this.estop = { by, at: Date.now() };
    this.estopLyingAt = Date.now() + this.device.safety.estopLieSec * 1000;
    if (this.run && !this.run.paused) this.run.paused = "E-Stop";
    this.setMode("ESTOP");
    this.vel = { vx: 0, vy: 0, wz: 0 };
    this.emitEvent("estop", "critical", `緊急停止 · 由 ${by} 觸發`);
  }

  releaseEstop() {
    if (this.mode !== "ESTOP") return;
    this.estop = null;
    this.estopLyingAt = null;
    this.setMode(this.teleopHolder ? "TELEOP" : this.run ? "PAUSED" : "IDLE");
    this.emitEvent("estop", "info", "E-Stop 已由擁有者解除");
  }

  acquireTeleop(): { granted: boolean; holder?: string } {
    if (this.teleopHolder && !this.teleopHolder.mine)
      return { granted: false, holder: `${this.teleopHolder.phone}（${this.teleopHolder.role}）` };
    this.teleopHolder = { role: this.myRole, phone: "本機", mine: true };
    if (this.mode === "CHARGING") this.charging = false;
    if (["IDLE", "PAUSED", "CHARGING"].includes(this.mode)) this.setMode("TELEOP");
    return { granted: true };
  }

  releaseTeleop() {
    if (!this.teleopHolder) return;
    this.teleopHolder = null;
    this.cmd = { vx: 0, vy: 0, wz: 0, at: 0 };
    if (this.mode === "TELEOP") this.setMode(this.run ? "PAUSED" : "IDLE");
  }

  /** Dev: another phone grabs the stick. */
  otherPhoneTakesTeleop() {
    this.teleopHolder = { role: "operator", phone: "夜班 · Pixel 8", mine: false };
    if (["IDLE", "PAUSED"].includes(this.mode)) this.setMode("TELEOP");
    this.emitEvent("teleop", "info", "夜班 · Pixel 8 取得操控權");
  }

  async requestTeleop(): Promise<{ granted: boolean }> {
    // §2: the holder has 5 s to refuse; the mock holder never does.
    await new Promise((r) => setTimeout(r, 5000));
    this.teleopHolder = { role: this.myRole, phone: "本機", mine: true };
    this.emitEvent("teleop", "info", "操控權已轉移至本機");
    return { granted: true };
  }

  setPosture(p: Posture) {
    this.posture = p === "recover" ? "stand" : p;
  }

  setGait(g: Gait) {
    this.gait = g;
  }

  // ── Missions ─────────────────────────────────────────────────────────────

  startMission(id: string, why = "手動啟動") {
    const mission = this.missions.find((m) => m.id === id);
    if (!mission || mission.route.length === 0) return;
    if (this.run) this.finishRun("aborted", "被新任務取代");
    const targets = mission.route.map((wp, i) => ({ x: wp.x, y: wp.y, wpIndex: i as number | null }));
    if (mission.returnToDock) targets.push({ x: DOCK.x, y: DOCK.y, wpIndex: null });
    this.charging = false;
    this.run = {
      mission,
      targets,
      idx: 0,
      phase: "moving",
      actionIdx: 0,
      actionEndsAt: 0,
      paused: null,
      arrivals: [],
      snapshots: [],
      startedAt: Date.now(),
    };
    this.lastRunAt[id] = Date.now();
    if (this.mode !== "TELEOP") this.setMode("MISSION");
    else this.run.paused = "操控中";
    this.emitEvent("mission", "info", `任務「${mission.name}」開始（${why}）`);
  }

  pauseRun(reason: string) {
    if (!this.run) return;
    this.run.paused = reason;
    if (this.mode === "MISSION") this.setMode("PAUSED");
    this.emitEvent("mission", "info", `任務暫停 · ${reason}`);
  }

  resumeRun() {
    if (!this.run || this.mode === "ESTOP" || this.mode === "FAULT") return;
    this.run.paused = null;
    if (this.teleopHolder?.mine) this.releaseTeleop();
    this.setMode("MISSION");
    this.emitEvent("mission", "info", `任務「${this.run.mission.name}」恢復`);
  }

  abortRun() {
    if (!this.run) return;
    this.finishRun("aborted", "使用者中止");
  }

  private finishRun(result: RunRecord["result"], reason?: string) {
    const run = this.run;
    if (!run) return;
    this.history.unshift({
      id: uid("run"),
      missionId: run.mission.id,
      startedAt: run.startedAt,
      endedAt: Date.now(),
      result,
      reason,
      arrivals: run.arrivals,
    });
    this.history = this.history.slice(0, 60);
    this.run = null;
    if (["MISSION", "PAUSED"].includes(this.mode)) this.setMode("IDLE");
    this.emitEvent(
      "mission",
      result === "success" ? "info" : "warning",
      result === "success" ? `任務「${run.mission.name}」完成` : `任務「${run.mission.name}」${result === "aborted" ? "中止" : "失敗"}：${reason}`
    );
    this.emitMissionsChanged();
  }

  /** Not a user-facing event: tells the phone to re-fetch `mission.list`. */
  emitMissionsChanged() {
    if (this.wsOpen) this.events.emit({ id: uid("ev"), at: Date.now(), kind: "missions_changed", level: "info", text: "" });
  }

  // ── Scenario timeline ────────────────────────────────────────────────────

  private runTimeline(now: number) {
    if (!this.wsOpen && this.gatewayState === "up") return;
    const t = (now - this.connectedAt) / 1000;
    this.scenario.timeline.forEach((step, i) => {
      if (this.firedTimeline.has(i) || t < step.at) return;
      this.firedTimeline.add(i);
      this.fire(step.do);
    });
  }

  fire(what: "estop_remote" | "gateway_down" | "revoked" | "fault") {
    switch (what) {
      case "estop_remote":
        this.triggerEstop("夜班 · Pixel 8（操作員）");
        break;
      case "gateway_down":
        this.gatewayState = "down";
        this.health.emit(this.healthNow());
        if (this.wsOpen) {
          this.close();
          this.closed.emit({ reason: "gateway_down" });
        }
        break;
      case "revoked":
        this.emitEvent("revoked", "critical", "本機已被擁有者撤銷");
        this.close();
        this.closed.emit({ reason: "revoked" });
        break;
      case "fault":
        this.fault = {
          code: "0x42",
          message: "小腦通訊逾時",
          advice: "確認狗身周圍淨空後，長按背部電源鍵 3 秒重啟小腦。若 10 分鐘內重複發生，請停止使用並聯絡維運（附上診斷日誌）。",
        };
        this.vel = { vx: 0, vy: 0, wz: 0 };
        if (this.run) this.run.paused = "FAULT";
        this.setMode("FAULT");
        this.emitEvent("system", "critical", "FAULT 0x42 · 小腦通訊逾時");
        break;
    }
  }

  async restartGateway() {
    this.gatewayState = "down";
    this.health.emit({ state: "down", lastError: "RESTART_GATEWAY（擁有者簽名指令）" });
    if (this.wsOpen) {
      this.close();
      this.closed.emit({ reason: "gateway_down" });
    }
    await new Promise((r) => setTimeout(r, 6000));
    this.gatewayState = "up";
    // The crash that caused the scenario does not recur after a restart.
    this.scenario.timeline.forEach((s, i) => s.do === "gateway_down" && this.firedTimeline.add(i));
    this.health.emit({ state: "up" });
  }

  simulateJoinRequest() {
    const phone: PairedPhone = {
      id: uid("phone"),
      nickname: "Galaxy S25（序號 4E19）",
      role: "operator",
      lastSeen: Date.now(),
      online: true,
      mine: false,
      pending: true,
    };
    this.phones.push(phone);
    this.emitEvent("approval", "warning", `序號 4E19 的手機請求加入為操作員`, phone.id);
  }

  // ── Tick ─────────────────────────────────────────────────────────────────

  private setMode(mode: DogMode) {
    this.mode = mode;
  }

  emitEvent(kind: DogEvent["kind"], level: EventLevel, text: string, ref?: string) {
    const e: DogEvent = { id: uid("ev"), at: Date.now(), kind, level, text, ref };
    this.eventLog = [e, ...this.eventLog].slice(0, 200);
    if (this.wsOpen) this.events.emit(e);
  }

  private tick() {
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const tSec = (now - this.connectedAt) / 1000;

    this.runTimeline(now);

    this.rtt = this.rtt * 0.7 + clamp(this.scenario.rtt(tSec), 5, 2000) * 0.3;

    // Battery
    if (this.charging) this.battery = Math.min(100, this.battery + dt * (1.5 / 60));
    else this.battery = Math.max(0, this.battery - dt * (this.scenario.drain / 60) * (this.speed > 0.05 ? 1.6 : 1));

    if (this.mode === "ESTOP" && this.estopLyingAt && now > this.estopLyingAt) {
      this.posture = "lie";
      this.estopLyingAt = null;
    }

    if (this.mode === "TELEOP" && this.teleopHolder?.mine) this.stepTeleop(dt, now);
    else if (this.mode === "MISSION" && this.run && !this.run.paused) this.stepMission(dt, now);
    else this.decelerate(dt);

    this.checkFence();
    this.maybeSchedule(now);
    this.maybePerception(now);

    // Low battery policy during a run.
    if (this.run && !this.run.paused && this.battery < 15) {
      if (this.run.mission.policy.onLowBattery === "pause") this.pauseRun("低電量");
      else {
        this.run.targets = [{ x: DOCK.x, y: DOCK.y, wpIndex: null }];
        this.run.idx = 0;
        this.run.phase = "moving";
      }
    }

    if (this.wsOpen) this.telemetry.emit(this.frame(now));
  }

  private decelerate(dt: number) {
    const k = Math.max(0, 1 - dt * 8);
    this.vel = { vx: this.vel.vx * k, vy: this.vel.vy * k, wz: this.vel.wz * k };
    this.speed = Math.hypot(this.vel.vx, this.vel.vy);
  }

  private stepTeleop(dt: number, now: number) {
    // Gateway dead-man (§7): 200 ms without CONTROL → zero.
    const fresh = now - this.cmd.at < 200;
    const limit = this.device.safety.speedLimit;
    const target = fresh
      ? { vx: clamp(this.cmd.vx, -limit, limit), vy: clamp(this.cmd.vy, -limit, limit), wz: clamp(this.cmd.wz, -1.6, 1.6) }
      : { vx: 0, vy: 0, wz: 0 };
    const a = Math.min(1, dt * 6);
    this.vel.vx += (target.vx - this.vel.vx) * a;
    this.vel.vy += (target.vy - this.vel.vy) * a;
    this.vel.wz += (target.wz - this.vel.wz) * a;
    if (this.posture !== "stand") {
      this.vel = { vx: 0, vy: 0, wz: 0 };
    }
    this.integrate(dt);
  }

  private integrate(dt: number) {
    const { yaw } = this.pose;
    const dx = (this.vel.vx * Math.cos(yaw) - this.vel.vy * Math.sin(yaw)) * dt;
    const dy = (this.vel.vx * Math.sin(yaw) + this.vel.vy * Math.cos(yaw)) * dt;
    const nx = this.pose.x + dx;
    const ny = this.pose.y + dy;
    // Slide along walls rather than sticking to them.
    if (isFree(GRID, nx, ny)) this.pose = { ...this.pose, x: nx, y: ny };
    else if (isFree(GRID, nx, this.pose.y)) this.pose = { ...this.pose, x: nx };
    else if (isFree(GRID, this.pose.x, ny)) this.pose = { ...this.pose, y: ny };
    this.pose.yaw = wrap(this.pose.yaw + this.vel.wz * dt);
    this.speed = Math.hypot(this.vel.vx, this.vel.vy);
  }

  private stepMission(dt: number, now: number) {
    const run = this.run!;
    const target = run.targets[run.idx];
    if (!target) return this.finishRun("success");

    if (run.phase === "moving") {
      const dx = target.x - this.pose.x;
      const dy = target.y - this.pose.y;
      const dist = Math.hypot(dx, dy);
      const tol = target.wpIndex === null ? 0.3 : run.mission.route[target.wpIndex].toleranceM;
      if (dist < tol) {
        this.vel = { vx: 0, vy: 0, wz: 0 };
        this.speed = 0;
        if (target.wpIndex === null) {
          // Home.
          run.idx++;
          this.charging = this.battery < 99;
          const done = run.idx >= run.targets.length;
          if (done) {
            this.finishRun("success");
            if (this.charging) this.setMode("CHARGING");
          }
          return;
        }
        run.arrivals.push({ wp: target.wpIndex, at: now });
        run.phase = "acting";
        run.actionIdx = -1;
        run.actionEndsAt = now;
        return;
      }
      const heading = Math.atan2(dy, dx);
      const err = wrap(heading - this.pose.yaw);
      const speed = Math.min(PATROL_SPEED, this.device.safety.speedLimit);
      this.vel = { vx: speed * Math.max(0, Math.cos(err)) * clamp(dist, 0.3, 1), vy: 0, wz: clamp(err * 2.5, -1.5, 1.5) };
      // Missions trust navd's path; the mock does not re-plan around walls.
      const { yaw } = this.pose;
      this.pose = {
        x: this.pose.x + this.vel.vx * Math.cos(yaw) * dt,
        y: this.pose.y + this.vel.vx * Math.sin(yaw) * dt,
        yaw: wrap(yaw + this.vel.wz * dt),
      };
      this.speed = this.vel.vx;
      return;
    }

    // Acting at a waypoint.
    this.decelerate(dt);
    if (now < run.actionEndsAt) return;
    const wp = run.mission.route[target.wpIndex!];
    run.actionIdx++;
    const action = wp.actions[run.actionIdx];
    if (!action) {
      run.phase = "moving";
      run.idx++;
      return;
    }
    const sec =
      action.type === "wait" ? action.sec : action.type === "snapshot" ? 2 : action.type === "thermal" ? 4 : action.type === "announce" ? 5 : 6;
    run.actionEndsAt = now + sec * 1000;
    if (action.type === "snapshot") run.snapshots.push({ wp: target.wpIndex!, at: now });
    if (action.type === "plugin")
      this.emitEvent("mission", "info", `氣體採樣完成 · CO 4 ppm（正常）@ 航點 ${target.wpIndex! + 1}`);
  }

  private checkFence() {
    const outside = this.fences.some((f) => !insidePolygon(f.points, this.pose.x, this.pose.y));
    if (outside && !this.outsideFence) this.emitEvent("fence", "critical", "狗已離開圍欄「巡邏區」");
    if (!outside && this.outsideFence) this.emitEvent("fence", "info", "狗已回到圍欄內");
    this.outsideFence = outside;
  }

  private maybeSchedule(now: number) {
    if (now - this.lastScheduleCheck < 1000) return;
    const from = this.lastScheduleCheck;
    this.lastScheduleCheck = now;
    if (!this.hasFeature("mission") || this.run) return;
    if (!["IDLE", "CHARGING"].includes(this.mode)) return;
    for (const m of this.missions) {
      if (!m.enabled || m.trigger.type === "event") continue;
      const next = nextTrigger(m.trigger, from, this.lastRunAt[m.id]);
      if (next !== null && next <= now) {
        this.startMission(m.id, "排程觸發");
        return;
      }
    }
  }

  private maybePerception(now: number) {
    if (now < this.nextPerceptionAt) return;
    // Perception events ARE the AI feature: an unlicensed dog does not raise them.
    if (!this.hasFeature("ai")) {
      this.nextPerceptionAt = now + 30_000;
      return;
    }
    this.nextPerceptionAt = now + 30_000 + Math.random() * 60_000;
    const p = PERCEPTION[Math.floor(Math.random() * PERCEPTION.length)];
    this.emitEvent("perception", p.level, p.text);
    if (!this.run && ["IDLE", "CHARGING"].includes(this.mode) && p.text.startsWith("偵測到人員")) {
      const m = this.missions.find((x) => x.enabled && x.trigger.type === "event" && x.trigger.eventType === "perception");
      if (m) this.startMission(m.id, "事件觸發");
    }
  }

  private frame(now: number): TelemetryFrame {
    const run = this.run;
    let runProgress: TelemetryFrame["run"] = null;
    if (run) {
      const remaining = run.targets.slice(run.idx);
      let meters = 0;
      let prev = { x: this.pose.x, y: this.pose.y };
      for (const t of remaining) {
        meters += Math.hypot(t.x - prev.x, t.y - prev.y);
        prev = t;
      }
      const currentWp = run.targets[run.idx]?.wpIndex ?? run.mission.route.length - 1;
      runProgress = {
        missionId: run.mission.id,
        state: run.paused ? "paused" : "running",
        pausedReason: run.paused ?? undefined,
        currentWp,
        totalWp: run.mission.route.length,
        etaSec: meters / PATROL_SPEED + actionSeconds(run.mission.route.slice(currentWp)),
        completedWp: run.arrivals.map((a) => a.wp).filter((w) => w < currentWp || run.phase === "acting"),
        snapshots: run.snapshots,
      };
    }
    const workingMinutes = this.battery / Math.max(0.3, this.scenario.drain * (this.speed > 0.05 ? 1.6 : 1));
    return {
      dogTime: now,
      mode: this.mode,
      pose: { ...this.pose },
      speed: this.speed,
      battery: this.battery,
      batteryMinutes: Math.round(workingMinutes),
      charging: this.charging,
      lastControlSeq: this.lastControlSeq,
      rttMs: Math.round(this.rtt),
      gait: this.gait,
      posture: this.posture,
      teleopHolder: this.teleopHolder,
      estop: this.estop,
      fault: this.fault,
      run: runProgress,
    };
  }
}

function wrap(a: number) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

const clouds = new Map<number, ReturnType<typeof buildPointCloud>>();
function cloudFor(budget: number) {
  let c = clouds.get(budget);
  if (!c) {
    c = buildPointCloud(budget);
    clouds.set(budget, c);
  }
  return c;
}

const LICENSE_KEY = "qc.mock.dog.license";

function loadLicense(): LicenseInfo | null {
  try {
    const raw = localStorage.getItem(LICENSE_KEY);
    return raw ? (JSON.parse(raw) as LicenseInfo) : null;
  } catch {
    return null;
  }
}

function saveLicense(l: LicenseInfo) {
  try {
    localStorage.setItem(LICENSE_KEY, JSON.stringify(l));
  } catch {}
}
