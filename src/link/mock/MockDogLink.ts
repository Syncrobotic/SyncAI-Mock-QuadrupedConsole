import { rpcDelay, sleep } from "@/lib/utils";

import { DOGS, FIRMWARE } from "./fixtures";
import { createMockMedia } from "./MockMediaLink";
import { validateMission } from "./validate";
import { MockWorld } from "./world";

import {
  RpcError,
  type BleChannel,
  type Credential,
  type DogLink,
  type GatewayChannel,
  type KeystoreChannel,
  type RpcMap,
  type RpcName,
  type RpcReq,
  type RpcRes,
} from "../DogLink";
import type { ScenarioId } from "./scenarios";
import type { Endpoint, Enrollment, PairSession, Role, Scope, WifiStatus } from "@/proto/types";
import { ROLE_SCOPES } from "@/proto/types";

const ENDPOINT: Endpoint = { ip: "192.168.50.23", port: 8443, fingerprint: "SHA256:7f3a…c21e" };
const KEY = "qc.mock.keystore";

/**
 * The mock keystore. On a device this is Keychain / Keystore behind a Tauri
 * command and holds a private key; here it is localStorage holding only the
 * public record, which is the most the JS side would ever see anyway.
 */
function createKeystore(): KeystoreChannel {
  return {
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as Credential) : null;
      } catch {
        return null;
      }
    },
    save(c) {
      try {
        localStorage.setItem(KEY, JSON.stringify(c));
      } catch {}
    },
    clear() {
      try {
        localStorage.removeItem(KEY);
      } catch {}
    },
  };
}

function createBle(world: MockWorld): BleChannel {
  const dogIdentity = (id: string) => {
    const d = DOGS.find((x) => x.id === id)!;
    return { serial: d.serial, fingerprint: ENDPOINT.fingerprint, firmware: FIRMWARE.cerebellum, hasOwner: d.hasOwner };
  };
  let flakyFailures = 0;

  return {
    async *scan() {
      await sleep(1200);
      yield { ...DOGS[0] };
      await sleep(1300);
      yield { ...DOGS[1] };
      // Keep advertising with RSSI jitter so the list feels alive.
      for (;;) {
        await sleep(2000);
        for (const d of DOGS) yield { ...d, rssi: d.rssi + Math.round((Math.random() - 0.5) * 8) };
      }
    },

    async pair(dogId): Promise<PairSession> {
      await sleep(900);
      if (world.dev.bleFlaky && flakyFailures < 2) {
        flakyFailures++;
        throw new Error("GATT 連線逾時");
      }
      flakyFailures = 0;
      return { dogId, identity: dogIdentity(dogId), attemptsLeft: 3 };
    },

    async confirm(session, code6) {
      await sleep(700);
      if (code6 !== "123456") {
        session.attemptsLeft--;
        return { ok: false, attemptsLeft: session.attemptsLeft };
      }
      const dog = DOGS.find((d) => d.id === session.dogId)!;
      const enrollment: Enrollment = dog.hasOwner
        ? { kind: "needs_approval", ownerOnline: world.dev.ownerOnline }
        : { kind: "granted", role: "owner", certificate: "cert-owner" };
      return { ok: true, enrollment };
    },

    awaitApproval(_dogId, signal) {
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(new DOMException("cancelled", "AbortError"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (!world.dev.ownerOnline) return; // waits until the requester cancels
        setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          if (!signal.aborted) resolve({ kind: "granted", role: "operator", certificate: "cert-operator" });
        }, 4000);
      });
    },

    async requestViewer() {
      await sleep(600);
      return { kind: "granted", role: "viewer", certificate: "cert-viewer" };
    },

    async *provisionWifi(ssid): AsyncGenerator<WifiStatus> {
      yield "connecting";
      const s = ssid.toLowerCase();
      if (s.includes("fail")) {
        await sleep(2500);
        yield "auth_failed";
        return;
      }
      if (s.includes("none")) {
        await sleep(3000);
        yield "not_found";
        return;
      }
      await sleep(s.includes("slow") ? 25_000 : 3200);
      yield "connected";
    },

    async readEndpoint() {
      await sleep(400);
      return ENDPOINT;
    },

    async estop() {
      await sleep(80);
      world.triggerEstop("本機（BLE）");
    },

    async restartGateway() {
      await sleep(300);
      void world.restartGateway();
    },

    health: world.health,
    reachable: () => true,
  };
}

function createGateway(world: MockWorld, keystore: KeystoreChannel): GatewayChannel {
  let session: { role: Role; scopes: readonly Scope[] } | null = null;

  const need = (scope: Scope) => {
    if (!session?.scopes.includes(scope)) throw new RpcError("forbidden", `需要 ${scope} 權限`);
  };

  const handlers: { [K in RpcName]: (req: RpcReq<K>) => RpcRes<K> | Promise<RpcRes<K>> } = {
    "posture.set": ({ posture }) => {
      need("teleop");
      if (world.speed > 0.05) throw new RpcError("invalid", "移動中不能變換姿態");
      if (["ESTOP", "FAULT"].includes(world.mode)) throw new RpcError("invalid", "目前狀態不能變換姿態");
      return sleep(700).then(() => world.setPosture(posture));
    },
    "gait.set": ({ gait }) => {
      need("teleop");
      if (world.speed > 0.05) throw new RpcError("invalid", "換步態需要狗靜止");
      world.setGait(gait);
    },
    "estop.release": () => {
      need("admin");
      world.releaseEstop();
    },
    "teleop.acquire": () => {
      need("teleop");
      return world.acquireTeleop();
    },
    "teleop.release": () => world.releaseTeleop(),
    "teleop.request": () => {
      need("teleop");
      return world.requestTeleop();
    },
    "mission.list": () => {
      need("view");
      return { missions: structuredClone(world.missions), fences: structuredClone(world.fences), history: structuredClone(world.history) };
    },
    "mission.validate": (m) => ({ issues: validate(m) }),
    "mission.save": (m) => {
      need("mission.rw");
      if (!world.scenario.missionLicense) throw new RpcError("forbidden", "任務排程未授權");
      const issues = validate(m);
      if (issues.some((i) => i.level === "error")) return { issues };
      const idx = world.missions.findIndex((x) => x.id === m.id);
      if (idx >= 0) world.missions[idx] = structuredClone(m);
      else world.missions.push(structuredClone(m));
      world.emitMissionsChanged();
      return { issues };
    },
    "mission.delete": ({ id }) => {
      need("mission.rw");
      world.missions = world.missions.filter((m) => m.id !== id);
      world.emitMissionsChanged();
    },
    "mission.setEnabled": ({ id, enabled }) => {
      need("mission.rw");
      const m = world.missions.find((x) => x.id === id);
      if (m) m.enabled = enabled;
      world.emitMissionsChanged();
    },
    "mission.start": ({ id }) => {
      need("mission.rw");
      if (!world.scenario.missionLicense) throw new RpcError("forbidden", "任務排程未授權");
      if (["ESTOP", "FAULT"].includes(world.mode)) throw new RpcError("invalid", "目前狀態不能啟動任務");
      world.startMission(id);
      world.emitMissionsChanged();
    },
    "mission.pause": ({ reason }) => {
      need("mission.rw");
      world.pauseRun(reason);
    },
    "mission.resume": () => {
      need("mission.rw");
      world.resumeRun();
    },
    "mission.abort": () => {
      need("mission.rw");
      world.abortRun();
    },
    "fence.save": (f) => {
      need("mission.rw");
      world.fences = world.fences.map((x) => (x.id === f.id ? f : x));
      world.emitMissionsChanged();
    },
    "device.info": () => structuredClone(world.device),
    "device.rename": ({ name }) => {
      need("admin");
      world.device.name = name;
    },
    "device.phones": () => structuredClone(world.phones),
    "device.setRole": ({ phoneId, role }) => {
      need("admin");
      const p = world.phones.find((x) => x.id === phoneId);
      if (p && !p.mine) p.role = role;
    },
    "device.revoke": ({ phoneId }) => {
      need("admin");
      world.phones = world.phones.filter((p) => p.id !== phoneId || p.mine);
    },
    "device.approve": ({ phoneId, approve }) => {
      need("admin");
      world.phones = approve
        ? world.phones.map((p) => (p.id === phoneId ? { ...p, pending: false } : p))
        : world.phones.filter((p) => p.id !== phoneId);
    },
    "device.setSafety": (patch) => {
      need("admin");
      world.device.safety = { ...world.device.safety, ...patch };
    },
    "device.setPlugin": ({ id, enabled }) => {
      need("admin");
      world.device.plugins = world.device.plugins.map((p) => (p.id === id ? { ...p, enabled } : p));
    },
    "media.broadcast": ({ clipId }) => {
      need("media.talk");
      const clip = world.device.clips.find((c) => c.id === clipId);
      world.emitEvent("system", "info", `狗端廣播：「${clip?.name ?? clipId}」`);
    },
    "media.snapshot": () => ({ artifactId: `snap-${Date.now()}` }),
    "diag.events": () => structuredClone(world.eventLog),
  };

  function validate(m: RpcMap["mission.validate"][0]) {
    return validateMission(m, {
      others: world.missions,
      fences: world.fences,
      battery: world.battery,
      from: world.pose,
      now: Date.now(),
    });
  }

  return {
    async connect() {
      await sleep(350 + Math.random() * 250);
      if (world.gatewayState === "down") throw new Error("TLS handshake failed: connection refused");
      const cred = keystore.load();
      if (!cred) throw new Error("本機沒有憑證");
      world.open(cred.role);
      session = { role: world.myRole, scopes: ROLE_SCOPES[world.myRole] };
      return { dogId: cred.dogId, role: world.myRole, scopes: session.scopes, jwtExpiresAt: Date.now() + 3_600_000 };
    },
    disconnect() {
      world.close();
      session = null;
    },
    control: { send: (f) => world.wsOpen && world.control(f) },
    telemetry: world.telemetry,
    events: world.events,
    map: world.map,
    closed: world.closed,
    async estop() {
      await sleep(30);
      world.triggerEstop("本機");
    },
    async rpc(name, req) {
      if (!world.wsOpen) throw new RpcError("unavailable", "WS 未連線");
      await rpcDelay();
      if (!world.wsOpen) throw new RpcError("unavailable", "WS 未連線");
      const handler = handlers[name] as (r: typeof req) => RpcRes<typeof name> | Promise<RpcRes<typeof name>>;
      return handler(req);
    },
  };
}

export interface MockDogLink extends DogLink {
  world: MockWorld;
  dispose(): void;
}

export function createMockDogLink(scenario: ScenarioId): MockDogLink {
  const world = new MockWorld(scenario);
  world.start();
  const keystore = createKeystore();
  return {
    world,
    keystore,
    ble: createBle(world),
    gateway: createGateway(world, keystore),
    media: createMockMedia(world),
    dispose: () => {
      world.close();
      world.stop();
    },
  };
}
