import { cellOf, insidePolygon, isFree, snapToFree } from "@/lib/geometry";
import { mulberry32 } from "@/lib/utils";

import type { Fence, FloorPlan, OccupancyGrid, Zone } from "@/proto/types";

/**
 * The mock dog's world: one office floor, 36 × 22 m.
 *
 * Spec §15 asks for a recorded 200k-point office `.ply`. Until someone records
 * one, the floor is generated from a plan instead — a ring corridor around a
 * sealed core, five rooms above and five below. The plan was chosen for what it
 * lets a reviewer test, not for realism:
 *
 *   - the ring is the "walk the dog once around the map" path of the success
 *     criterion (§1);
 *   - the core is free space nothing can reach, so the "waypoint unreachable"
 *     conflict (§8) has a real case;
 *   - the default fence leaves out the top rooms, so "waypoint outside fence"
 *     and the fence-breach event (§6) have one too.
 *
 * Map frame: x right, y forward (up on screen), z up, metres.
 */

export const FLOOR = { minX: -18, maxX: 18, minY: -11, maxY: 11, wallHeight: 2.6 };
export const DOCK = { x: -15.5, y: 0, yaw: 0 };

type Rect = import("@/proto/types").Box2;

const DOOR = 1.6;
const WALL = 0.2;

/** An axis-aligned wall, split at door centres. */
function wall(x1: number, y1: number, x2: number, y2: number, doors: number[] = []): Rect[] {
  const horizontal = y1 === y2;
  const [a, b] = horizontal ? [Math.min(x1, x2), Math.max(x1, x2)] : [Math.min(y1, y2), Math.max(y1, y2)];
  const cuts = [...doors].sort((p, q) => p - q);
  const spans: [number, number][] = [];
  let start = a;
  for (const c of cuts) {
    spans.push([start, c - DOOR / 2]);
    start = c + DOOR / 2;
  }
  spans.push([start, b]);
  return spans
    .filter(([s, e]) => e - s > 0.05)
    .map(([s, e]) =>
      horizontal
        ? { x1: s, y1: y1 - WALL / 2, x2: e, y2: y1 + WALL / 2, h: FLOOR.wallHeight }
        : { x1: x1 - WALL / 2, y1: s, x2: x1 + WALL / 2, y2: e, h: FLOOR.wallHeight }
    );
}

const ROOM_XS = [-18, -10, -2, 6, 12, 18];
const DOORS = [-14, -6, 2, 9, 15];

function buildWalls(): Rect[] {
  const { minX, maxX, minY, maxY } = FLOOR;
  return [
    ...wall(minX, minY, maxX, minY),
    ...wall(maxX, minY, maxX, maxY),
    ...wall(minX, maxY, maxX, maxY),
    ...wall(minX, minY, minX, maxY),
    ...wall(minX, 4, maxX, 4, DOORS),
    ...wall(minX, -4, maxX, -4, DOORS),
    ...ROOM_XS.slice(1, -1).flatMap((x) => [...wall(x, 4, x, maxY), ...wall(x, minY, x, -4)]),
    // The sealed core — lifts and risers. No doors, on purpose.
    ...wall(-10, -1.5, 10, -1.5),
    ...wall(-10, 1.5, 10, 1.5),
    ...wall(-10, -1.5, -10, 1.5),
    ...wall(10, -1.5, 10, 1.5),
  ];
}

function buildFurniture(): Rect[] {
  const rand = mulberry32(7);
  const out: Rect[] = [];
  for (let i = 0; i < ROOM_XS.length - 1; i++) {
    for (const [lo, hi] of [
      [5.8, 10.4],
      [-10.4, -5.8],
    ] as const) {
      const x0 = ROOM_XS[i] + 1;
      const x1 = ROOM_XS[i + 1] - 1;
      const count = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < count; k++) {
        const w = 1.2 + rand() * 1.4;
        const d = 0.6 + rand() * 0.5;
        const x = x0 + rand() * Math.max(0.1, x1 - x0 - w);
        const y = lo + rand() * Math.max(0.1, hi - lo - d);
        out.push({ x1: x, y1: y, x2: x + w, y2: y + d, h: 0.75 });
      }
    }
  }
  // A reception desk in the left lobby and a planter bank in the right one.
  out.push({ x1: -17.4, y1: 2.2, x2: -15.8, y2: 3.4, h: 1.1 });
  out.push({ x1: 16.2, y1: -3.2, x2: 17.4, y2: -0.6, h: 0.9 });
  return out;
}

export const WALLS = buildWalls();
export const FURNITURE = buildFurniture();

/** Named zones, the same unit vocabulary the dashboard's floor plans use. */
function buildZones(): Zone[] {
  const { minX, maxX, minY, maxY } = FLOOR;
  const north = ["會議室 A", "會議室 B", "開放辦公區 A", "主管辦公室", "茶水間"];
  const northType: Zone["type"][] = ["office", "office", "office", "office", "public"];
  const south = ["開放辦公區 B", "開放辦公區 C", "機房", "資料室", "印刷室"];
  const southType: Zone["type"][] = ["office", "office", "utility", "restricted", "utility"];
  const zones: Zone[] = [];
  for (let i = 0; i < ROOM_XS.length - 1; i++) {
    zones.push({ id: `n${i}`, name: north[i], type: northType[i], rect: { x1: ROOM_XS[i], y1: 4, x2: ROOM_XS[i + 1], y2: maxY, h: 0 } });
    zones.push({ id: `s${i}`, name: south[i], type: southType[i], rect: { x1: ROOM_XS[i], y1: minY, x2: ROOM_XS[i + 1], y2: -4, h: 0 } });
  }
  zones.push({ id: "lobby-w", name: "西側大廳", type: "lobby", rect: { x1: minX, y1: -4, x2: -10, y2: 4, h: 0 } });
  zones.push({ id: "lobby-e", name: "東側大廳", type: "lobby", rect: { x1: 10, y1: -4, x2: maxX, y2: 4, h: 0 } });
  zones.push({ id: "corr-n", name: "北走廊", type: "corridor", rect: { x1: -10, y1: 1.5, x2: 10, y2: 4, h: 0 } });
  zones.push({ id: "corr-s", name: "南走廊", type: "corridor", rect: { x1: -10, y1: -4, x2: 10, y2: -1.5, h: 0 } });
  zones.push({ id: "core", name: "核心區（電梯・管道）", type: "restricted", rect: { x1: -10, y1: -1.5, x2: 10, y2: 1.5, h: 0 } });
  return zones;
}

export const PLAN: FloorPlan = { zones: buildZones(), walls: WALLS, furniture: FURNITURE };

export { insidePolygon, isFree, snapToFree };

// ── Occupancy ────────────────────────────────────────────────────────────────

const RES = 0.25;

function buildGrid(): OccupancyGrid {
  const width = Math.round((FLOOR.maxX - FLOOR.minX) / RES);
  const height = Math.round((FLOOR.maxY - FLOOR.minY) / RES);
  const cells = new Uint8Array(width * height);
  for (const r of [...WALLS, ...FURNITURE]) {
    const cx1 = Math.floor((r.x1 - FLOOR.minX) / RES);
    const cx2 = Math.ceil((r.x2 - FLOOR.minX) / RES) - 1;
    const cy1 = Math.floor((r.y1 - FLOOR.minY) / RES);
    const cy2 = Math.ceil((r.y2 - FLOOR.minY) / RES) - 1;
    for (let cy = Math.max(0, cy1); cy <= Math.min(height - 1, cy2); cy++)
      for (let cx = Math.max(0, cx1); cx <= Math.min(width - 1, cx2); cx++) cells[cy * width + cx] = 1;
  }
  return { res: RES, width, height, originX: FLOOR.minX, originY: FLOOR.minY, cells };
}

export const GRID = buildGrid();

/** Cells a robot can drive to from the dock. Computed once; the floor does not change. */
function buildReachable(grid: OccupancyGrid) {
  const seen = new Uint8Array(grid.width * grid.height);
  const start = cellOf(grid, DOCK.x, DOCK.y);
  const queue = [start.cy * grid.width + start.cx];
  seen[queue[0]] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    const cx = i % grid.width;
    const cy = (i - cx) / grid.width;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
      const j = ny * grid.width + nx;
      if (seen[j]) continue;
      const px = grid.originX + (nx + 0.5) * grid.res;
      const py = grid.originY + (ny + 0.5) * grid.res;
      if (!isFree(grid, px, py)) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return seen;
}

const REACHABLE = buildReachable(GRID);

export function isReachable(x: number, y: number) {
  const { cx, cy } = cellOf(GRID, x, y);
  if (cx < 0 || cy < 0 || cx >= GRID.width || cy >= GRID.height) return false;
  return REACHABLE[cy * GRID.width + cx] === 1;
}

// ── Fence ────────────────────────────────────────────────────────────────────

export const DEFAULT_FENCE: Fence = {
  id: "fence-patrol",
  name: "巡邏區（不含北側辦公室）",
  points: [
    { x: -17.6, y: -10.6 },
    { x: 17.6, y: -10.6 },
    { x: 17.6, y: 4.3 },
    { x: -17.6, y: 4.3 },
  ],
};

// ── Point cloud ──────────────────────────────────────────────────────────────

/** Height ramp for the cloud: deep violet at the floor → cyan → near-white at the ceiling. */
function heightColour(t: number, out: number[]) {
  const stops = [
    [0.33, 0.24, 0.72],
    [0.3, 0.62, 0.86],
    [0.88, 0.92, 1.0],
  ];
  const s = t < 0.5 ? 0 : 1;
  const k = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  for (let c = 0; c < 3; c++) out[c] = stops[s][c] + (stops[s + 1][c] - stops[s][c]) * k;
}

/**
 * 0.05 m voxel samples on every wall face, furniture top, and a sparse floor.
 * `budget` is the phone's point cap (spec §6: 400k); the default lands near the
 * spec's 200k office sample.
 */
export function buildPointCloud(budget = 200_000) {
  const rand = mulberry32(42);
  const pts: number[] = [];
  const cols: number[] = [];
  const rgb = [0, 0, 0];

  const surfaces = [...WALLS, ...FURNITURE];
  const area = surfaces.reduce((sum, r) => sum + (Math.abs(r.x2 - r.x1) + Math.abs(r.y2 - r.y1)) * 2 * r.h, 0);
  const floorShare = 0.14;
  const perM2 = (budget * (1 - floorShare)) / area;

  for (const r of surfaces) {
    const perimeter = (r.x2 - r.x1 + (r.y2 - r.y1)) * 2;
    const n = Math.round(perimeter * r.h * perM2);
    for (let i = 0; i < n; i++) {
      let u = rand() * perimeter;
      let x: number;
      let y: number;
      const w = r.x2 - r.x1;
      const d = r.y2 - r.y1;
      if (u < w) [x, y] = [r.x1 + u, r.y1];
      else if ((u -= w) < d) [x, y] = [r.x2, r.y1 + u];
      else if ((u -= d) < w) [x, y] = [r.x2 - u, r.y2];
      else [x, y] = [r.x1, r.y2 - (u - w)];
      const z = rand() ** 1.15 * r.h;
      pts.push(x + (rand() - 0.5) * 0.03, y + (rand() - 0.5) * 0.03, z);
      heightColour(z / FLOOR.wallHeight, rgb);
      cols.push(rgb[0], rgb[1], rgb[2]);
    }
  }

  const floorN = Math.round(budget * floorShare);
  for (let i = 0; i < floorN; i++) {
    const x = FLOOR.minX + rand() * (FLOOR.maxX - FLOOR.minX);
    const y = FLOOR.minY + rand() * (FLOOR.maxY - FLOOR.minY);
    pts.push(x, y, 0);
    const g = 0.22 + rand() * 0.08;
    cols.push(g, g, g + 0.06);
  }

  // Shuffle in place so any prefix is a uniform sample — progressive loading
  // (§6: first frame at 20%) then fills in evenly instead of wall by wall.
  const count = pts.length / 3;
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    for (let c = 0; c < 3; c++) {
      [pts[i * 3 + c], pts[j * 3 + c]] = [pts[j * 3 + c], pts[i * 3 + c]];
      [cols[i * 3 + c], cols[j * 3 + c]] = [cols[j * 3 + c], cols[i * 3 + c]];
    }
  }
  return { positions: new Float32Array(pts), colors: new Float32Array(cols) };
}
