import type {
  ControlFrame,
  DeviceInfo,
  DogAdvert,
  DogEvent,
  Endpoint,
  Enrollment,
  Fence,
  Gait,
  GatewayHealth,
  LicenseActivation,
  LicenseInfo,
  MapChunk,
  Mission,
  PairedPhone,
  PairSession,
  Posture,
  Role,
  RunRecord,
  Session,
  TelemetryFrame,
  WifiStatus,
} from "@/proto/types";

/**
 * The only thing the UI knows about the dog (spec §12).
 *
 * The UI never learns whether this is a mock or a real dog. `BleLink` /
 * `GatewayLink` / `MediaLink` will implement the same shape over Tauri
 * commands; `mock/` implements it in memory.
 */

export type Unsubscribe = () => void;

export interface Stream<T> {
  subscribe(fn: (value: T) => void): Unsubscribe;
}

export interface Sink<T> {
  send(value: T): void;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: "unreachable" | "outside_fence" | "overlap" | "battery";
  message: string;
  waypointId?: string;
}

/** Every RPC the Console issues: name → [request, response]. */
export interface RpcMap {
  "posture.set": [{ posture: Posture }, void];
  "gait.set": [{ gait: Gait }, void];
  "estop.release": [void, void];
  "teleop.acquire": [void, { granted: boolean; holder?: string }];
  "teleop.release": [void, void];
  /** Ask the current holder to hand over; granted if they do not refuse within 5 s (§2). */
  "teleop.request": [void, { granted: boolean }];
  "mission.list": [void, { missions: Mission[]; fences: Fence[]; history: RunRecord[] }];
  "mission.save": [Mission, { issues: ValidationIssue[] }];
  "mission.validate": [Mission, { issues: ValidationIssue[] }];
  "mission.delete": [{ id: string }, void];
  "mission.setEnabled": [{ id: string; enabled: boolean }, void];
  "mission.start": [{ id: string }, void];
  "mission.pause": [{ reason: string }, void];
  "mission.resume": [void, void];
  "mission.abort": [void, void];
  "fence.save": [Fence, void];
  "device.info": [void, DeviceInfo];
  "device.rename": [{ name: string }, void];
  "device.phones": [void, PairedPhone[]];
  "device.setRole": [{ phoneId: string; role: Role }, void];
  "device.revoke": [{ phoneId: string }, void];
  "device.approve": [{ phoneId: string; approve: boolean }, void];
  "device.setSafety": [Partial<DeviceInfo["safety"]>, void];
  "device.setPlugin": [{ id: string; enabled: boolean }, void];
  "license.activate": [{ key: string }, LicenseActivation];
  "media.broadcast": [{ clipId: string }, void];
  "media.snapshot": [void, { artifactId: string }];
  "diag.events": [void, DogEvent[]];
}

export type RpcName = keyof RpcMap;
export type RpcReq<T extends RpcName> = RpcMap[T][0];
export type RpcRes<T extends RpcName> = RpcMap[T][1];

export class RpcError extends Error {
  constructor(
    public code: "timeout" | "forbidden" | "unavailable" | "invalid",
    message: string
  ) {
    super(message);
  }
}

export interface BleChannel {
  scan(): AsyncIterable<DogAdvert>;
  pair(dogId: string): Promise<PairSession>;
  confirm(session: PairSession, code6: string): Promise<{ ok: true; enrollment: Enrollment } | { ok: false; attemptsLeft: number }>;
  /** Resolves when the Owner phone answers (or the requester gives up). */
  awaitApproval(dogId: string, signal: AbortSignal): Promise<Enrollment>;
  requestViewer(dogId: string): Promise<Enrollment>;
  /** Licence state as the dog knows it (readable before Wi-Fi). */
  readLicense(): Promise<LicenseInfo>;
  /** Owner only: bind a licence key to this dog. Goes over BLE — the dog may have no network yet. */
  activateLicense(key: string): Promise<LicenseActivation>;
  provisionWifi(ssid: string, psk: string): AsyncIterable<WifiStatus>;
  readEndpoint(): Promise<Endpoint>;
  estop(): Promise<void>;
  restartGateway(): Promise<void>;
  health: Stream<GatewayHealth>;
  reachable(): boolean;
}

export interface GatewayChannel {
  connect(endpoint: Endpoint): Promise<Session>;
  disconnect(): void;
  control: Sink<Omit<ControlFrame, "seq" | "t">>;
  telemetry: Stream<TelemetryFrame>;
  events: Stream<DogEvent>;
  map: Stream<MapChunk>;
  /** Fired when the WS drops underneath us (not on a deliberate disconnect). */
  closed: Stream<{ reason: "network" | "revoked" | "gateway_down" }>;
  estop(): Promise<void>;
  rpc<T extends RpcName>(name: T, req: RpcReq<T>): Promise<RpcRes<T>>;
}

export interface MediaSession {
  stream: MediaStream | null;
  resolution: "720p30" | "360p15";
  latencyMs: number;
  setMic(on: boolean): void;
  setSpeaker(on: boolean): void;
  close(): void;
}

export interface MediaChannel {
  open(opts: { facing: "user" | "environment" }): Promise<MediaSession>;
}

/**
 * What the phone remembers about its dog. On a device this is the Rust core's
 * keystore command set — the private key never reaches JS, only this record.
 */
export interface Credential {
  dogId: string;
  dogName: string;
  serial: string;
  role: Role;
  endpoint: Endpoint | null;
  pairedAt: number;
}

export interface KeystoreChannel {
  load(): Credential | null;
  save(credential: Credential): void;
  clear(): void;
}

export interface DogLink {
  keystore: KeystoreChannel;
  ble: BleChannel;
  gateway: GatewayChannel;
  media: MediaChannel;
}
