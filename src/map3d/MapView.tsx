"use client";

import { Canvas } from "@react-three/fiber";
import { useRef } from "react";

import { cn } from "@/lib/utils";
import { onMapLongPress } from "@/screens/console/mission/editor";
import { set, useStore } from "@/store";
import { isLive } from "@/store/logic";

import { Scene } from "./Scene";

/**
 * The main viewport (§5): the 3D map fills everything above the E-Stop.
 * The view keys are in the Console's map tool row (screens/console/MapToolbar).
 */
export function MapView({ bare = false }: { bare?: boolean }) {
  const conn = useStore((s) => s.conn);
  const stale = !isLive(conn);
  const labels = useRef<HTMLDivElement>(null);

  return (
    <div className="absolute inset-0">
      {/* §13: BleOnly / Unreachable show the last cache, greyed. */}
      {/* Portrait sets --map-stage on the panel: the canvas keeps that height, centred, while
          the panel around it grows and shrinks — clipped, never resized mid-animation. */}
      <div
        className={cn("absolute inset-x-0 top-1/2 -translate-y-1/2 transition-[filter,opacity] duration-300", stale && "opacity-60 grayscale")}
        style={{ height: bare ? "100%" : "max(100%, var(--map-stage, 100%))" }}
      >
        <Canvas
          camera={{ position: [-22, 16, 12], fov: 50, near: 0.1, far: 300 }}
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onPointerMissed={() => set({ measure: null })}
        >
          <Scene onLongPress={onMapLongPress} labelHost={labels} />
        </Canvas>
        <div ref={labels} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden" />
      </div>

    </div>
  );
}
