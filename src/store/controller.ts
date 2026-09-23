import { toast } from "sonner";

import { currentScenarioId, getDogLink, switchScenario } from "@/link";
import { RpcError, type Credential, type RpcName, type RpcReq, type RpcRes } from "@/link/DogLink";

import { get, set } from ".";
import { canTransition, isLive, nextRttZone, type ConnState } from "./logic";

import type { ScenarioId } from "@/link/mock/scenarios";
import type { DogEvent } from "@/proto/types";

/**
 * Drives the client connection state machine (spec §13) and mirrors the
 * dog's streams into the store. The UI calls these functions; it never
 * talks to the link directly except for the 50 Hz control sink and the map
 * stream, both of which are too hot for a store.
 */

let unsubs: (() => void)[] = [];
let watchdog: ReturnType<typeof setInterval> | null = null;
let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
let connectAttempt = 0;
let lastTelemetryWrite = 0;

function go(to: ConnState, patch: Partial<ReturnType<typeof get>> = {}) {
  const from = get().conn;
  if (!canTransition(from, to)) {
    console.warn(`[conn] illegal transition ${from} → ${to}`);
  }
  if (from !== to) console.info(`[conn] ${from} → ${to}`);
  set({ conn: to, connSince: from === to ? get().connSince : Date.now(), ...patch });
}

// ── Boot ─────────────────────────────────────────────────────────────────────

export function boot() {
  const link = getDogLink();
  set({ scenario: currentScenarioId() });
  wire();
  const cred = link.keystore.load();
  if (!cred) {
    set({ conn: "Unpaired", credential: null });
    return;
  }
  // §3 重連: straight into the Console with no UI in between.
  set({ credential: cred, conn: "Paired" });
  void connect();
}

function wire() {
  unsubs.forEach((u) => u());
  const link = getDogLink();

  unsubs = [
    link.gateway.telemetry.subscribe((f) => {
      const now = Date.now();
      const rtt = nextRttZone(get().rtt, f.rttMs, now);
      // 10 Hz into React is plenty for bars and badges; map3d reads 20 Hz raw.
      if (now - lastTelemetryWrite < 100 && f.mode === get().telemetry?.mode) {
        set({ lastTelemetryAt: now, rtt });
        return;
      }
      lastTelemetryWrite = now;
      set({ telemetry: f, lastTelemetryAt: now, rtt });
    }),
    link.gateway.events.subscribe(onEvent),
    link.gateway.map.subscribe((c) => set({ mapLoaded: c.loaded, mapTotal: c.total, occupancy: c.occupancy, plan: c.plan ?? null })),
    link.gateway.closed.subscribe(({ reason }) => {
      if (reason === "revoked") {
        link.keystore.clear();
        stopCall();
        go("Unpaired", { credential: null, session: null, revokedNotice: true, telemetry: null });
        return;
      }
      go("BleOnly", { session: null, lastError: reason === "gateway_down" ? "Gateway 無回應" : "WS 斷線" });
    }),
    link.ble.health.subscribe((h) => {
      set({ gatewayHealth: h });
      // §13: BleOnly → Connecting once BLE says the gateway is back.
      if (h.state === "up" && get().conn === "BleOnly" && get().credential?.endpoint) void connect();
      const until = get().restartingUntil;
      if (until && h.state === "up") set({ restartingUntil: null });
    }),
  ];

  if (watchdog) clearInterval(watchdog);
  watchdog = setInterval(tickWatchdog, 250);
}

let healthySince: number | null = null;

function tickWatchdog() {
  const s = get();
  const now = Date.now();
  if (!isLive(s.conn)) return;
  // §13: RTT > 300 ms or 2 s without telemetry → Degraded; 2 s healthy → Online.
  const bad = now - s.lastTelemetryAt > 2000 || s.rtt.level === "poor";
  healthySince = bad ? null : (healthySince ?? now);
  if (s.conn === "Online" && bad) go("Degraded");
  if (s.conn === "Degraded" && healthySince !== null && now - healthySince >= 2000) go("Online");
}

// ── Connect ──────────────────────────────────────────────────────────────────

export async function connect() {
  const link = getDogLink();
  let cred = get().credential ?? link.keystore.load();
  if (!cred) return go("Unpaired");
  const attempt = ++connectAttempt;
  go("Connecting", { lastError: null });

  const tryWs = async (endpoint: NonNullable<Credential["endpoint"]>) => {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("3 秒內無回應")), 3000));
    return Promise.race([link.gateway.connect(endpoint), timeout]);
  };

  try {
    if (!cred.endpoint) throw new Error("尚未設定 Wi-Fi");
    const session = await tryWs(cred.endpoint);
    if (attempt !== connectAttempt) return;
    go("Online", { session, lastTelemetryAt: Date.now() });
    void refreshAll();
    return;
  } catch (e) {
    if (attempt !== connectAttempt) return;
    set({ lastError: (e as Error).message });
  }

  // §3: fall back to BLE to read a (possibly new) endpoint.
  if (!link.ble.reachable()) return go("Unreachable");
  try {
    const endpoint = await link.ble.readEndpoint();
    cred = { ...cred, endpoint };
    link.keystore.save(cred);
    set({ credential: cred });
    if (get().gatewayHealth.state !== "down") {
      const session = await tryWs(endpoint);
      if (attempt !== connectAttempt) return;
      go("Online", { session, lastTelemetryAt: Date.now() });
      void refreshAll();
      return;
    }
  } catch {
    /* fall through */
  }
  if (attempt !== connectAttempt) return;
  go("BleOnly");
}

export async function retry() {
  if (get().conn === "Unreachable" || get().conn === "BleOnly") {
    if (get().conn === "BleOnly") go("Connecting");
    await connect();
  }
}

/** §13 BleOnly → Connecting: a new endpoint was read over BLE (e.g. after a Wi-Fi change). */
export async function adoptNewEndpoint() {
  const link = getDogLink();
  const cred = get().credential;
  if (!cred) return;
  const endpoint = await link.ble.readEndpoint();
  const next = { ...cred, endpoint };
  link.keystore.save(next);
  set({ credential: next });
  if (get().conn === "BleOnly") void connect();
}

// ── Onboarding exits ─────────────────────────────────────────────────────────

export function beginOnboarding() {
  set({ revokedNotice: false });
  go("Onboarding");
}

export function finishOnboarding(cred: Credential) {
  const link = getDogLink();
  link.keystore.save(cred);
  set({ credential: cred, tab: cred.role === "viewer" ? "device" : "teleop" });
  if (cred.endpoint) {
    go("Paired");
    void connect();
  } else {
    // Wi-Fi skipped (§4): BLE only, device page and E-Stop.
    go("BleOnly", { tab: "device" });
  }
}

export function clearLocalPairing() {
  const link = getDogLink();
  link.gateway.disconnect();
  link.keystore.clear();
  stopCall();
  go("Unpaired", { credential: null, session: null, telemetry: null, missions: [], editor: null });
}

// ── Background / foreground (§13) ────────────────────────────────────────────

export function onVisibility(hidden: boolean) {
  if (hidden) {
    if (backgroundTimer) return;
    backgroundTimer = setTimeout(() => {
      backgroundTimer = null;
      if (!isLive(get().conn)) return;
      // Safety, not battery: never keep driving from a phone in a pocket.
      getDogLink().gateway.disconnect();
      stopCall();
      go("Paired", { session: null });
    }, 5000);
  } else {
    if (backgroundTimer) clearTimeout(backgroundTimer);
    backgroundTimer = null;
    if (get().conn === "Paired") void connect();
  }
}

// ── Streams → store ─────────────────────────────────────────────────────────

function onEvent(e: DogEvent) {
  if (e.kind === "missions_changed") {
    void refreshMissions();
    return;
  }
  set({ events: [e, ...get().events].slice(0, 200) });
  if (e.kind === "approval") {
    if (get().session?.scopes.includes("admin")) set({ approval: e });
    void refreshPhones();
    return;
  }
  if (e.level === "critical") toast.error(e.text);
  else if (e.level === "warning") toast.warning(e.text);
  else if (e.kind === "mission") toast(e.text);
}

export async function refreshAll() {
  await Promise.all([refreshMissions(), refreshDevice(), refreshPhones()]);
}

export async function refreshMissions() {
  const r = await rpc("mission.list", undefined, { quiet: true });
  if (r) set({ missions: r.missions, fences: r.fences, history: r.history });
}

export async function refreshDevice() {
  const d = await rpc("device.info", undefined, { quiet: true });
  if (d) set({ device: d });
}

export async function refreshPhones() {
  const p = await rpc("device.phones", undefined, { quiet: true });
  if (p) set({ phones: p });
}

/** RPC with the §13 toast tier for failures. Returns null on failure. */
export async function rpc<T extends RpcName>(name: T, req: RpcReq<T>, opts: { quiet?: boolean } = {}): Promise<RpcRes<T> | null> {
  try {
    return await getDogLink().gateway.rpc(name, req);
  } catch (e) {
    if (!opts.quiet) toast.error(e instanceof RpcError ? e.message : `${name} 失敗`);
    return null;
  }
}

// ── E-Stop ──────────────────────────────────────────────────────────────────

export async function estop() {
  const link = getDogLink();
  const c = get().conn;
  navigator.vibrate?.([80, 40, 80]);
  if (isLive(c)) await link.gateway.estop();
  else await link.ble.estop();
}

export async function releaseEstop() {
  await rpc("estop.release", undefined);
}

// ── Gateway restart (§10: the one write that always goes over BLE) ─────────

export async function restartGateway() {
  set({ restartingUntil: Date.now() + 8000 });
  await getDogLink().ble.restartGateway();
}

// ── Call ─────────────────────────────────────────────────────────────────────

export function stopCall() {
  set((s) => ({ call: { ...s.call, active: false, mic: false } }));
}

// ── Dev ──────────────────────────────────────────────────────────────────────

export function changeScenario(id: ScenarioId) {
  getDogLink().gateway.disconnect();
  switchScenario(id);
  stopCall();
  set((s) => ({
    linkEpoch: s.linkEpoch + 1,
    scenario: id,
    telemetry: null,
    events: [],
    missions: [],
    device: null,
    phones: [],
    editor: null,
    approval: null,
    restartingUntil: null,
    mapLoaded: 0,
    gatewayHealth: { state: "up" },
    rtt: { level: "good", goodSince: 0 },
  }));
  const cred = getDogLink().keystore.load();
  wire();
  if (cred) {
    set({ credential: cred });
    go("Paired");
    void connect();
  }
}
