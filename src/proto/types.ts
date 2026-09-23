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
  owner: "Owner",
  operator: "Operator",
  viewer: "Viewer",
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
  estop: { by: string; at: number } | null;
  fault: { code: string; message: string; advice: string } | null;
  run: RunProgress | null;
}

export interface RunProgress {
  missionId: string;
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
  kind: "perception" | "system" | "mission" | "fence" | "estop" | "teleop" | "revoked" | "approval" | "missions_changed";
  level: EventLevel;
  text: string;
  /** For approval requests: the requesting phone. */
  ref?: string;
}

export interface MapChunk {
  /** Interleaved xyz, metres, map frame (x right, y forward, z up). */
  positions: Float32Array;
  colors: Float32Array;
  loaded: number;
  total: number;
  occupancy: OccupancyGrid;
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

export type Trigger =
  | { type: "once"; at: number }
  | { type: "daily"; time: string }
  | { type: "weekly"; days: number[]; time: string }
  | { type: "interval"; minutes: number }
  | { type: "event"; eventType: "perception" | "fence"; filter: string };

export interface MissionPolicy {
  onLowBattery: "return_to_dock" | "pause";
  onObstacle: "reroute" | "wait" | "abort";
  waitSec: number;
  allowTeleopPreempt: boolean;
}

export interface Mission {
  id: string;
  name: string;
  enabled: boolean;
  route: Waypoint[];
  trigger: Trigger;
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

export type LicenseFeature = "map" | "mission" | "ai" | "talk";

export interface DeviceInfo {
  name: string;
  serial: string;
  versions: { cerebellum: string; gateway: string; app: string };
  bootAt: number;
  services: { name: string; state: GatewayHealthState }[];
  cpu: number;
  tempC: number;
  storagePct: number;
  network: { ssid: string | null; ip: string | null; signal: number };
  safety: { speedLimit: number; outsideFence: "stop" | "return" | "alert"; estopLieSec: number };
  license: { feature: LicenseFeature; granted: boolean }[];
  licenseExpiresAt: number;
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
