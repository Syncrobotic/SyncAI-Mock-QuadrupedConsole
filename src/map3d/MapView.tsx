"use client";

import { Canvas } from "@react-three/fiber";
import { Box, Crosshair, Layers, Rotate3d } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { onMapLongPress } from "@/screens/console/mission/editor";
import { set, useStore, type MapView as MapViewMode } from "@/store";
import { isLive } from "@/store/logic";

import { Scene } from "./Scene";

/**
 * The main viewport (§5): the 3D map fills everything above the E-Stop.
 * Floating view buttons sit right, per the §5 wireframe.
 */
export function MapView({ bare = false }: { bare?: boolean }) {
  const conn = useStore((s) => s.conn);
  const view = useStore((s) => s.view);
  const statusOpen = useStore((s) => s.statusOpen);
  const stale = !isLive(conn);
  const box = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [short, setShort] = useState(false);

  // On a short map (teleop on an SE: 179px) a vertical stack of three 44px
  // buttons reaches up into the status header. Lay them out in a row instead.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setShort(el.clientHeight < 300));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={box} className="absolute inset-0">
      {/* §13: BleOnly / Unreachable show the last cache, greyed. */}
      <div className={cn("absolute inset-0 transition-[filter,opacity] duration-300", stale && "opacity-60 grayscale")}>
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

      {!statusOpen && !bare && <ViewButtons view={view} horizontal={short} />}
    </div>
  );
}

function ViewButtons({ view, horizontal }: { view: MapViewMode; horizontal: boolean }) {
  const layers = useStore((s) => s.layers);
  const tab = useStore((s) => s.tab);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Close on a tap anywhere else, and whenever the tab changes — it used to
  // stay open across tabs, stacked over the status header.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const [openTab, setOpenTab] = useState(tab);
  if (openTab !== tab) {
    setOpenTab(tab);
    setOpen(false);
  }

  const btn = (active: boolean) =>
    cn(
      "grid size-11 cursor-pointer place-items-center transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none",
      active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
    );

  return (
    <div ref={root} className="absolute right-2 bottom-2">
      {open && (
        // Opens to the LEFT of the column, bottom-aligned, so it never reaches
        // up into the header and banners.
        <div
          className={cn(
            "bg-surface/95 absolute w-40 space-y-0.5 rounded-xl border p-1.5 shadow-lg backdrop-blur",
            horizontal ? "right-0 bottom-[52px] max-h-[200px] overflow-y-auto" : "right-[52px] bottom-0"
          )}
        >
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
              className="hover:bg-accent flex h-11 w-full cursor-pointer items-center justify-between rounded-md px-2 text-[13px]"
              aria-pressed={layers[k]}
            >
              {label}
              <span className={cn("size-2 rounded-full", layers[k] ? "bg-primary-accent" : "bg-muted-foreground/30")} />
            </button>
          ))}
        </div>
      )}
      <div className={cn("bg-surface/95 flex overflow-hidden rounded-xl border shadow-lg backdrop-blur", horizontal ? "flex-row" : "flex-col")}>
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
