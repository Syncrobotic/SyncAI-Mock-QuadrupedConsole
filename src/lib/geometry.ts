import type { OccupancyGrid } from "@/proto/types";

/**
 * Geometry over the occupancy grid and fence polygons. Pure and shared: the
 * phone uses it to snap waypoints and colour the fence; the mock dog uses it
 * for collision and reachability.
 */

export const ROBOT_RADIUS = 0.35;

export function cellOf(grid: OccupancyGrid, x: number, y: number) {
  return {
    cx: Math.floor((x - grid.originX) / grid.res),
    cy: Math.floor((y - grid.originY) / grid.res),
  };
}

function occupiedCell(grid: OccupancyGrid, cx: number, cy: number) {
  if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return true;
  return grid.cells[cy * grid.width + cx] === 1;
}

/** Is a robot-sized disc at (x, y) clear of every occupied cell? */
export function isFree(grid: OccupancyGrid, x: number, y: number, radius = ROBOT_RADIUS) {
  const rf = radius / grid.res;
  const r = Math.ceil(rf);
  const { cx, cy } = cellOf(grid, x, y);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > rf * rf) continue;
      if (occupiedCell(grid, cx + dx, cy + dy)) return false;
    }
  return true;
}

/** Nearest free (robot-sized) cell centre — spec §6: 航點吸附到最近可通行 voxel. */
export function snapToFree(grid: OccupancyGrid, x: number, y: number) {
  const { cx, cy } = cellOf(grid, x, y);
  for (let ring = 0; ring < 16; ring++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -ring; dy <= ring; dy++)
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const px = grid.originX + (cx + dx + 0.5) * grid.res;
        const py = grid.originY + (cy + dy + 0.5) * grid.res;
        if (!isFree(grid, px, py)) continue;
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (!best || d < best.d) best = { x: px, y: py, d };
      }
    if (best) return { x: best.x, y: best.y };
  }
  return { x, y };
}

export function insidePolygon(points: { x: number; y: number }[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

