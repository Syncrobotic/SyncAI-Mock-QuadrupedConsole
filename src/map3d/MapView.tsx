"use client";

import { Canvas } from "@react-three/fiber";
import { Box, Crosshair, Layers, Rotate3d } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { onMapLongPress } from "@/screens/console/mission/editor";
import { set, useStore, type MapView as MapViewMode } from "@/store";
import { isLive } from "@/store/logic";

import { Scene } from "./Scene";

/**
 * The main viewport (§5): the 3D map fills everything above the E-Stop.
 * Floating view buttons sit right, per the §5 wireframe.
 */
export function MapView() {
  const conn = useStore((s) => s.conn);
  const view = useStore((s) => s.view);
  const stale = !isLive(conn);

  return (
    <div className="absolute inset-0">
      {/* §13: BleOnly / Unreachable show the last cache, greyed. */}
      <div className={cn("absolute inset-0 transition-[filter,opacity] duration-300", stale && "opacity-60 grayscale")}>
        <Canvas
          camera={{ position: [-22, 16, 12], fov: 50, near: 0.1, far: 300 }}
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onPointerMissed={() => set({ measure: null })}
        >
          <Scene onLongPress={onMapLongPress} />
        </Canvas>
      </div>

      <ViewButtons view={view} />
    </div>
  );
}

function ViewButtons({ view }: { view: MapViewMode }) {
  const layers = useStore((s) => s.layers);
  const [open, setOpen] = useState(false);

  const btn = (active: boolean) =>
    cn(
      "grid size-11 cursor-pointer place-items-center transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
      active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
    );

  return (
    <div className="absolute right-3 bottom-3 flex flex-col items-end gap-2">
      {open && (
        <div className="bg-surface/95 w-40 space-y-0.5 rounded-xl border p-1.5 shadow-lg backdrop-blur">
          {(
            [
              ["plan", "樓層平面"],
              ["cloud", "點雲"],
              ["grid", "佔據柵格"],
              ["trail", "軌跡 60 秒"],
              ["fence", "地理圍欄"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } }))}
              className="hover:bg-accent flex h-9 w-full cursor-pointer items-center justify-between rounded-md px-2 text-[13px]"
              aria-pressed={layers[k]}
            >
              {label}
              <span className={cn("size-2 rounded-full", layers[k] ? "bg-primary-accent" : "bg-muted-foreground/30")} />
            </button>
          ))}
        </div>
      )}
      <div className="bg-surface/95 flex flex-col overflow-hidden rounded-xl border shadow-lg backdrop-blur">
        <button className={btn(view === "follow")} onClick={() => set({ view: view === "follow" ? "free" : "follow" })} aria-label="跟隨" aria-pressed={view === "follow"}>
          <Crosshair className="size-[18px]" />
        </button>
        <button className={btn(view === "top")} onClick={() => set({ view: view === "top" ? "free" : "top" })} aria-label="俯視 2.5D" aria-pressed={view === "top"}>
          {view === "top" ? <Rotate3d className="size-[18px]" /> : <Box className="size-[18px]" />}
        </button>
        <button className={btn(open)} onClick={() => setOpen((o) => !o)} aria-label="圖層" aria-expanded={open}>
          <Layers className="size-[18px]" />
        </button>
      </div>
    </div>
  );
}
