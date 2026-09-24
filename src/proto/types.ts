/**
 * Stand-in for the buf-generated types from `SyncAI-Proto-Quadruped` (spec §12).
 *
 * Hand-written until that repo exists. The mock and the real links both import
 * from here, so when the generated file replaces this one any drift in the
 * mock shows up as a compile error — which is the whole point of the seam.
 */

// ── Identity & trust ──────────────────────────────────────────────────────────

export type Role = "owner" | "operator" | "viewer";
export type Scope = "view" | "teleop" | "mission.rw" | "media.talk" | "admin";

export const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
  owner: ["view", "teleop", "mission.rw", "media.talk", "admin"],
  operator: ["view", "teleop", "mission.rw", "media.talk"],
  viewer: ["view"],
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "擁有者",
  operator: "操作員",
  viewer: "檢視者",
};

// ── BLE / bootstrapd ─────────────────────────────────────────────────────────

export interface DogAdvert {
  id: string;
  serial: string;
  name: string;
  rssi: number;
  hasOwner: boolean;
  pairingMode: boolean;
}

export interface DogIdentity {
  serial: string;
  fingerprint: string;
  firmware: string;
  hasOwner: boolean;
}

export interface PairSession {
  dogId: string;
  identity: DogIdentity;
  attemptsLeft: number;
}

export type Enrollment =
  | { kind: "granted"; role: Role; certificate: string }
  | { kind: "needs_approval"; ownerOnline: boolean }
  | { kind: "rejected"; reason: string };

export type WifiStatus = "connecting" | "connected" | "auth_failed" | "not_found";

/** A network the dog can see, reported over BLE so the phone can offer a list instead of a text field. */
export interface WifiNetwork {
  ssid: string;
  /** dBm, as the dog hears it — what matters is the signal at the dog, not at the phone. */
  rssi: number;
  band: "2.4" | "5" | "6";
  security: "open" | "wpa2" | "wpa3" | "enterprise";
}

export interface Endpoint {
  ip: string;
  port: number;
  fingerprint: string;
}

export type GatewayHealthState = "up" | "degraded" | "down";
export interface GatewayHealth {
  state: GatewayHealthState;
  lastError?: string;
}

// ── Gateway / WS ─────────────────────────────────────────────────────────────

export interface Session {
  dogId: string;
  role: Role;
  scopes: readonly Scope[];
  jwtExpiresAt: number;
}

export interface ControlFrame {
  seq: number;
  /** Phone monotonic time, ms. */
  t: number;
  vx: number;
  vy: number;
  wz: number;
  pitch: number;
}

export type DogMode = "BOOT" | "IDLE" | "TELEOP" | "MISSION" | "PAUSED" | "CHARGING" | "ESTOP" | "FAULT";

export type Gait = "walk" | "trot" | "stairs";
export type Posture = "stand" | "sit" | "lie" | "recover";

export interface Pose {
  x: number;
  y: number;
  yaw: number;
}

export interface TelemetryFrame {
  dogTime: number;
  mode: DogMode;
  pose: Pose;
  /** Planar speed, m/s. */
  speed: number;
  battery: number;
  batteryMinutes: number;
  charging: boolean;
  lastControlSeq: number;
  /** RTT the phone should display — derived from last_control_seq on a real link. */
  rttMs: number;
  gait: Gait;
  posture: Posture;
  teleopHolder: { role: Role; phone: string; mine: boolean } | null;
  queue: QueueItem[];
  confirms: PendingConfirm[];
  estop: { by: string; at: number } | null;
  fault: { code: string; message: string; advice: string } | null;
  run: RunProgress | null;
}

export interface RunProgress {
  missionId: string;
  cause: RunCause;
  priority: Priority;
  /** Response missions: where the event was. */
  target?: { x: number; y: number };
  state: "running" | "paused";
  pausedReason?: string;
  currentWp: number;
  totalWp: number;
  etaSec: number;
  completedWp: number[];
  snapshots: { wp: number; at: number }[];
}

export type EventLevel = "info" | "warning" | "critical";
export interface DogEvent {
  id: string;
  at: number;
  kind: "perception" | "system" | "mission" | "fence" | "estop" | "teleop" | "revoked" | "approval" | "missions_changed" | "confirm_request";
  level: EventLevel;
  text: string;
  /** For approval requests: the requesting phone. */
  ref?: string;
  detection?: Detection;
}

export interface MapChunk {
  /** Interleaved xyz, metres, map frame (x right, y forward, z up). */
  positions: Float32Array;
  colors: Float32Array;
  loaded: number;
  total: number;
  occupancy: OccupancyGrid;
  /**
   * Semantic floor layer (zones, walls, fixed furniture). Mock-only for now:
   * the real navd publishes an octree; a zone map is a later product decision.
   */
  plan?: FloorPlan;
}

export type ZoneType = "office" | "corridor" | "lobby" | "restricted" | "public" | "utility";

export interface Box2 {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  h: number;
}

export interface Zone {
  id: string;
  name: string;
  type: ZoneType;
  rect: Box2;
}

export interface FloorPlan {
  zones: Zone[];
  walls: Box2[];
  furniture: Box2[];
}

/** 2.5D projection of the octree: 0 free, 1 occupied. Row-major, y then x. */
export interface OccupancyGrid {
  res: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  cells: Uint8Array;
}

// ── Missions (spec §8) ───────────────────────────────────────────────────────

export interface Waypoint {
  id: string;
  x: number;
  y: number;
  toleranceM: number;
  actions: Action[];
}

export type Action =
  | { type: "wait"; sec: number }
  | { type: "snapshot"; camera: "front" | "rear" }
  | { type: "thermal" }
  | { type: "announce"; clipId: string }
  | { type: "plugin"; pluginId: string; actionId: string; params: Record<string, unknown> };

// ── Rules: WHEN and WHY a mission runs (docs/2026-09-23-mission-triggers-design.md)

/** 0 emergency · 1 event response · 2 routine patrol · 3 maintenance. Lower wins. */
export type Priority = 0 | 1 | 2 | 3;

export interface TimeWindow {
  from: string; // "22:00"
  to: string; // "06:00" — may wrap past midnight
}

/** Structured for the visual picker; `toRRule` renders RFC 5545 for storage/interop. */
export type Schedule =
  | { type: "once"; at: number }
  | { type: "daily"; time: string }
  | { type: "weekly"; days: number[]; time: string }
  | { type: "interval"; minutes: number; window: TimeWindow | null };

export interface TimeTrigger {
  kind: "time";
  schedule: Schedule;
  /** ± random offset, minutes — a patrol that runs on the dot can be timed. */
  jitterMin: number;
  /** When the slot comes and the dog cannot run it. */
  missed: "skip" | "catch_up";
  graceMin: number;
}

export type EventSource = "ai" | "system" | "sensor" | "external";

export type EventType =
  | "person"
  | "intrusion"
  | "fall"
  | "smoke"
  | "abandoned"
  | "door_open"
  | "thermal"
  | "low_battery"
  | "fence_breach"
  | "mission_failed"
  | "gas_high";

export interface EventTrigger {
  kind: "event";
  source: EventSource;
  type: EventType;
  /** Zone ids from the floor plan; empty = anywhere. */
  zones: string[];
  minConfidence: number;
  /** Must be seen continuously this long — filters the one-frame false positive. */
  persistSec: number;
  /** Or: seen N times within S seconds. null = off. */
  countWithin: { n: number; sec: number } | null;
  activeWindow: TimeWindow | null;
}

export type Trigger = TimeTrigger | EventTrigger;

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  missionId: string;
  priority: Priority;
  /** auto: run · confirm: ask the phones first · notify: record + tell, do not move. */
  mode: "auto" | "confirm" | "notify";
  confirmTimeoutSec: number;
  onTimeout: "run" | "cancel";
  minBattery: number;
  cooldownSec: number;
  maxPerHour: number;
  onPreempted: "resume" | "restart" | "drop";
  /** An activation waiting longer than this is dropped — a late response is no response. */
  queueTtlSec: number;
}

export type RuleOutcome = "started" | "queued" | "skipped" | "expired" | "preempted" | "awaiting" | "cancelled" | "notified" | "filtered";

export interface RuleLogEntry {
  id: string;
  at: number;
  ruleId: string;
  outcome: RuleOutcome;
  reason: string;
}

export interface RunCause {
  kind: "time" | "event" | "manual";
  ruleId?: string;
  /** "AI 偵測到人員 @ 南走廊（0.87）" / "排程 22:30" */
  text: string;
  confirmedBy?: string;
}

export interface Detection {
  type: EventType;
  zoneId: string;
  confidence: number;
  x: number;
  y: number;
  trackId: string;
}

export interface PendingConfirm {
  activationId: string;
  ruleId: string;
  ruleName: string;
  missionName: string;
  cause: string;
  priority: Priority;
  expiresAt: number;
  onTimeout: "run" | "cancel";
  detection?: Detection;
}

export interface QueueItem {
  activationId: string;
  ruleId: string;
  missionId: string;
  priority: Priority;
  cause: string;
  enqueuedAt: number;
  expiresAt: number;
  /** A suspended run waiting to resume after a preemption. */
  resumed?: boolean;
}

export interface MissionPolicy {
  onLowBattery: "return_to_dock" | "pause";
  onObstacle: "reroute" | "wait" | "abort";
  waitSec: number;
  allowTeleopPreempt: boolean;
}

/**
 * WHAT to do — a reusable template. When/why lives in `Rule`.
 * `patrol` follows `route`; `response` goes to the location of the event that
 * triggered it and does `responseActions` there.
 */
export interface Mission {
  id: string;
  name: string;
  kind: "patrol" | "response";
  route: Waypoint[];
  response: { approachM: number; actions: Action[] };
  policy: MissionPolicy;
  returnToDock: boolean;
}

export type RunResult = "success" | "aborted" | "failed";
export interface RunRecord {
  id: string;
  missionId: string;
  startedAt: number;
  endedAt: number;
  result: RunResult;
  reason?: string;
  arrivals: { wp: number; at: number }[];
  cause: RunCause;
  priority: Priority;
}

export interface Fence {
  id: string;
  name: string;
  points: { x: number; y: number }[];
}

// ── Device page (spec §10) ───────────────────────────────────────────────────

export interface PairedPhone {
  id: string;
  nickname: string;
  role: Role;
  lastSeen: number;
  online: boolean;
  mine: boolean;
  pending?: boolean;
}

export type LicenseFeature = "teleop" | "map" | "mission" | "talk" | "ai";

/** What a licence key unlocks on this dog. Activated over BLE, before Wi-Fi. */
export interface LicenseInfo {
  /** `none` = never activated. The Console refuses to run until it is not. */
  edition: "pro" | "basic" | "control" | "none";
  /** Masked for display: SYNC-••••-••••-DEMO */
  keyMasked: string | null;
  features: { feature: LicenseFeature; granted: boolean }[];
  expiresAt: number | null;
}

export type LicenseActivation =
  | { ok: true; license: LicenseInfo }
  | { ok: false; reason: "format" | "invalid" | "bound" | "expired" };

export interface DeviceInfo {
  name: string;
  serial: string;
  versions: { cerebellum: string; gateway: string; app: string };
  bootAt: number;
  services: { name: string; state: GatewayHealthState }[];
  cpu: number;
  /** Memory in use, % of total. */
  memPct: number;
  tempC: number;
  storagePct: number;
  network: { ssid: string | null; ip: string | null; signal: number };
  safety: { speedLimit: number; outsideFence: "stop" | "return" | "alert"; estopLieSec: number };
  license: { feature: LicenseFeature; granted: boolean }[];
  licenseExpiresAt: number;
  licenseEdition: LicenseInfo["edition"];
  licenseKeyMasked: string | null;
  plugins: PluginManifest[];
  clips: { id: string; name: string; sec: number }[];
}

// ── Plugins (spec §11) ───────────────────────────────────────────────────────

export interface JsonSchemaProp {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  title?: string;
  description?: string;
  enum?: string[];
  format?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  items?: { type: string };
  properties?: Record<string, JsonSchemaProp>;
}

export interface MissionActionContribution {
  id: string;
  label: string;
  icon: string;
  schema: { type: "object"; properties: Record<string, JsonSchemaProp>; required?: string[] };
  requires: string[];
  estimateSec: number;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  capabilities: string[];
  missionActions: MissionActionContribution[];
}
