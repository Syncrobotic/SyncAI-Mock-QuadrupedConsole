import { create } from "zustand";

import type { ConnState, RttZone, Tab } from "./logic";
import type { Credential, ValidationIssue } from "@/link/DogLink";
import type { Flash } from "@/lib/notify";
import type {
  DeviceInfo,
  DogEvent,
  Fence,
  FloorPlan,
  GatewayHealth,
  Mission,
  OccupancyGrid,
  PairedPhone,
  Rule,
  RuleLogEntry,
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
  rules: Rule[];
  ruleLog: RuleLogEntry[];
  /** Mission tab sub-view: rules (when/why) · missions (what) · agenda (next 24 h). */
  /** The mission tab's three lists: time rules, event rules, mission templates (routes). */
  missionView: "time" | "event" | "routes";
  ruleEditor: { draft: Rule; isNew: boolean; verdict: string | null } | null;
  detailRuleId: string | null;

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
    /** In the teleop tab: the video fills the map panel and the map shrinks to a window. */
    videoMain: boolean;
    /** Where the small window sits — the video's or, swapped, the map's: the same corner. */
    corner: "tl" | "tr" | "bl" | "br";
  };
  /** When the event tab was last open — newer warnings put a dot on it. */
  eventsSeenAt: number;
  userSpeedCap: number;
  snapshotViewer: { wp: number; at: number } | null;
  /** The notification the status island is showing in place of its second line (lib/notify). */
  flash: Flash | null;
  /** Pairing another dog from the Console: onboarding starts at the scan and can be cancelled. */
  addingDog: boolean;
  /** Review panel: render the frame sideways to preview §5 landscape. */
  forceLandscape: boolean;
  /** Review panel: which phone the desktop frame imitates — its cutout, bars and safe areas. */
  phoneModel: DeviceId;
  /** Review panel: show the in-phone MOCK hints (off: the phone looks like the product). */
  mockHints: boolean;
}

export type DeviceId = "iphone16pro" | "iphonese" | "pixel9" | "galaxys24" | "none";

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
  rules: [],
  ruleLog: [],
  missionView: "time",
  ruleEditor: null,
  detailRuleId: null,

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
  call: { active: false, mic: false, ptt: false, speaker: true, thermal: false, thermalOpacity: 60, facing: "user", videoMain: false, corner: "bl" },
  eventsSeenAt: Date.now(),
  userSpeedCap: 0.8,
  snapshotViewer: null,
  flash: null,
  addingDog: false,
  forceLandscape: false,
  phoneModel: "iphone16pro",
  mockHints: false,
}));

export const set = useStore.setState;
export const get = useStore.getState;

/** Stable empty value for selectors — a fresh `[]` per call re-renders forever. */
export const NO_SCOPES: readonly never[] = [];
