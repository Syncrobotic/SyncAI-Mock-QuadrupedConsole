"use client";

import { useEffect, useRef } from "react";

import { getDogLink } from "@/link";

import type { Pose, TelemetryFrame } from "@/proto/types";

/**
 * The dog's pose, straight off the 20 Hz telemetry stream into a ref.
 *
 * §12: 位姿內插在 map3d 內部做，不進 store — a 60 fps store write would
 * re-render every subscriber in the app. The scene reads `target` in
 * `useFrame` and eases its own display pose toward it.
 */
export interface PoseRef {
  target: Pose;
  display: Pose;
  speed: number;
  mode: TelemetryFrame["mode"];
  has: boolean;
  trail: { x: number; y: number; t: number }[];
}

export function usePoseRef() {
  const ref = useRef<PoseRef>({
    target: { x: 0, y: 0, yaw: 0 },
    display: { x: 0, y: 0, yaw: 0 },
    speed: 0,
    mode: "IDLE",
    has: false,
    trail: [],
  });

  useEffect(() => {
    return getDogLink().gateway.telemetry.subscribe((f) => {
      const r = ref.current;
      if (!r.has) r.display = { ...f.pose };
      r.target = f.pose;
      r.speed = f.speed;
      r.mode = f.mode;
      r.has = true;
      const now = f.dogTime;
      const last = r.trail[r.trail.length - 1];
      if (!last || now - last.t > 200) r.trail.push({ x: f.pose.x, y: f.pose.y, t: now });
      // §6: trail of the last 60 s.
      while (r.trail.length && now - r.trail[0].t > 60_000) r.trail.shift();
    });
  }, []);

  return ref;
}

export function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
