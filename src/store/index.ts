import { create } from "zustand";

import type { ConnState, RttZone, Tab } from "./logic";
import type { Credential, ValidationIssue } from "@/link/DogLink";
import type {
  DeviceInfo,
  DogEvent,
  Fence,
  FloorPlan,
  GatewayHealth,
  Mission,
  OccupancyGrid,
  PairedPhone,
  RunRecord,
  Session,
  TelemetryFrame,
} from "@/proto/types";

/**
 * One zustand store, sliced by the spec §12 names. Only the controller and
 * the link subscriptions write to `connection` and `robot`; UI writes only to
 * `ui` and `editor`. Pose at 60 fps never enters here — map3d reads the
 * telemetry stream directly (§12 Store 原則).
 */

export type SheetSnap = 0 | 1 | 2;
export const SNAP_PCT = [0.2, 0.5, 0.9] as const;
export type MapView = "free" | "follow" | "top";

export interface Editor {
  draft: Mission;
  isNew: boolean;
  selectedWp: string | null;
  issues: ValidationIssue[];
}

export interface State {
  /** Bumped when the link is rebuilt (dev scenario switch) so direct subscribers remount. */
  linkEpoch: number;
  /** Which mock scenario the link runs (dev only). */
  scenario: string;

  // connection
  conn: ConnState;
  connSince: number;
  credential: Credential | null;
  session: Session | null;
  gatewayHealth: GatewayHealth;
  lastError: string | null;
  revokedNotice: boolean;
  restartingUntil: number | null;

  // robot
  telemetry: TelemetryFrame | null;
  lastTelemetryAt: number;
  rtt: RttZone;

  // map
  mapLoaded: number;
  mapTotal: number;
  occupancy: OccupancyGrid | null;
  plan: FloorPlan | null;

  // missions
  missions: Mission[];
  fences: Fence[];
  history: RunRecord[];
  editor: Editor | null;
  detailMissionId: string | null;

  // device
  device: DeviceInfo | null;
  phones: PairedPhone[];
  events: DogEvent[];
  approval: DogEvent | null;

  // ui
  tab: Tab;
  snap: SheetSnap;
  statusOpen: boolean;
  view: MapView;
  layers: { plan: boolean; cloud: boolean; grid: boolean; trail: boolean; fence: boolean };
  measure: { x: number; y: number } | null;
  call: {
    active: boolean;
    mic: boolean;
    ptt: boolean;
    speaker: boolean;
    thermal: boolean;
    thermalOpacity: number;
    facing: "user" | "environment";
  };
  userSpeedCap: number;
  snapshotViewer: { wp: number; at: number } | null;
  /** Px from the frame bottom to just above the E-Stop — where toasts go in the Console. */
  toastBottom: number | null;
  /** Review panel: render the frame sideways to preview §5 landscape. */
  forceLandscape: boolean;
}

export const useStore = create<State>(() => ({
  linkEpoch: 0,
  scenario: "default",
  conn: "Unpaired",
  connSince: Date.now(),
  credential: null,
  session: null,
  gatewayHealth: { state: "up" },
  lastError: null,
  revokedNotice: false,
  restartingUntil: null,

  telemetry: null,
  lastTelemetryAt: 0,
  rtt: { level: "good", goodSince: 0 },

  mapLoaded: 0,
  mapTotal: 0,
  occupancy: null,
  plan: null,

  missions: [],
  fences: [],
  history: [],
  editor: null,
  detailMissionId: null,

  device: null,
  phones: [],
  events: [],
  approval: null,

  tab: "teleop",
  snap: 1,
  statusOpen: false,
  view: "free",
  layers: { plan: true, cloud: false, grid: false, trail: true, fence: true },
  measure: null,
  call: { active: false, mic: false, ptt: false, speaker: true, thermal: false, thermalOpacity: 60, facing: "user" },
  userSpeedCap: 0.8,
  snapshotViewer: null,
  toastBottom: null,
  forceLandscape: false,
}));

export const set = useStore.setState;
export const get = useStore.getState;

/** Stable empty value for selectors — a fresh `[]` per call re-renders forever. */
export const NO_SCOPES: readonly never[] = [];
