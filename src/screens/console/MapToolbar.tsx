"use client";

import { Box, Crosshair, Layers, Rotate3d } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { set, useStore } from "@/store";

import { EStopBar } from "./EStopBar";
import { CallButton } from "./talk/CallLayer";

/**
 * The map's one tool row, along its bottom edge:
 *
 *   [影像][跟隨]   ( ⊗ E-STOP )   [俯視][圖層]
 *
 * The E-Stop is the only red, wide, labelled thing, in the middle. The four tools are the same
 * 40 pt frosted icon keys (44 pt to the touch), pinned to the two edges; a tool that does not
 * apply goes invisible or disabled, not away, so nothing slides.
 *
 * Stacking: the row has no z-index of its own, so the E-Stop's z-[60] lifts it over a dialog's
 * backdrop while the tools stay under it (z-20).
 */
export const TOOL =
  "bg-surface/90 text-foreground hover:bg-accent grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl border shadow-sm backdrop-blur transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none [&_svg]:size-[18px]";
export const TOOL_ON = "bg-primary/15 text-primary-accent border-primary/40 hover:bg-primary/20";

// The side tools leave at once when the E-Stop starts to widen, and come back only once it
// has narrowed (the delay), so the two never overlap mid-animation.
const SIDE = "transition-opacity duration-150 motion-reduce:transition-none";
const SIDE_ON = "pointer-events-auto opacity-100 delay-200";
const SIDE_OFF = "pointer-events-none opacity-0";

export function MapToolbar({ estopRef, collapsed }: { estopRef: React.Ref<HTMLDivElement>; collapsed: boolean }) {
  const tab = useStore((s) => s.tab);
  const view = useStore((s) => s.view);
  const videoMain = useStore((s) => s.call.active && s.call.videoMain && s.tab === "teleop");
  const showView = !collapsed && !videoMain;

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 h-11">
      <div inert={collapsed} className={cn("absolute top-0.5 left-0 z-20 flex gap-1.5", SIDE, collapsed ? SIDE_OFF : SIDE_ON)}>
        {/* Always in its place; the call is the teleop tab's, so elsewhere it is disabled. */}
        <CallButton className={cn(TOOL, videoMain && TOOL_ON)} disabled={tab !== "teleop"} />
        <button
          className={cn(TOOL, view === "follow" && TOOL_ON, !showView && "invisible")}
          onClick={() => set({ view: view === "follow" ? "free" : "follow" })}
          aria-label="跟隨"
          aria-pressed={view === "follow"}
        >
          <Crosshair />
        </button>
      </div>

      {/* Centred, fixed width between the tools; when the map is down to the island and the
          E-Stop (the sheet all the way up), the tools go and the E-Stop grows to the full width. */}
      <div
        ref={estopRef}
        className={cn(
          "pointer-events-auto absolute top-0 left-1/2 z-[60] -translate-x-1/2 transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
          // 152 pt, but never closer than 12 pt to the tools (two 40 pt keys + 6 each side).
          collapsed ? "w-full" : "w-[min(152px,calc(100%-196px))]"
        )}
      >
        <EStopBar compact />
      </div>

      <div inert={collapsed} className={cn("absolute top-0.5 right-0 z-20 flex gap-1.5", SIDE, collapsed ? SIDE_OFF : SIDE_ON)}>
        <button
          className={cn(TOOL, view === "top" && TOOL_ON, !showView && "invisible")}
          onClick={() => set({ view: view === "top" ? "free" : "top" })}
          aria-label="俯視 2.5D"
          aria-pressed={view === "top"}
        >
          {view === "top" ? <Rotate3d /> : <Box />}
        </button>
        <LayersTool hidden={!showView} />
      </div>
    </div>
  );
}

const LAYERS = [
  ["plan", "樓層平面"],
  ["cloud", "點雲"],
  ["grid", "佔據柵格"],
  ["trail", "軌跡 60 秒"],
  ["fence", "地理圍欄"],
] as const;

/** 圖層: a menu that opens upward from the key, right-aligned, so it stays inside the map. */
function LayersTool({ hidden }: { hidden: boolean }) {
  const layers = useStore((s) => s.layers);
  const tab = useStore((s) => s.tab);
  const [open, setOpen] = useState(false);
  const [maxH, setMaxH] = useState(232);
  const root = useRef<HTMLDivElement>(null);
  // On a short map (SE, 任務 at half height) five rows would climb over the status island:
  // the menu takes the room between the key and the island, and scrolls past that.
  const toggle = () => {
    const key = root.current?.getBoundingClientRect();
    const bounds = root.current?.closest("[data-island-bounds]")?.getBoundingClientRect();
    if (!open && key && bounds) setMaxH(Math.max(120, Math.round(key.top - bounds.top - 64 - 12)));
    setOpen((o) => !o);
  };

  // Close on a tap anywhere else, and whenever the tab changes.
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
  if (hidden && open) setOpen(false);

  return (
    <div ref={root} className={cn("relative", hidden && "invisible")}>
      {open && (
        <div
          className="bg-surface/95 scrollbar-none absolute right-0 bottom-12 w-40 space-y-0.5 overflow-y-auto overscroll-contain rounded-xl border p-1.5 shadow-lg backdrop-blur"
          style={{ maxHeight: maxH }}
        >
          {LAYERS.map(([k, label]) => (
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
      <button className={cn(TOOL, open && TOOL_ON)} onClick={toggle} aria-label="圖層" aria-expanded={open}>
        <Layers />
      </button>
    </div>
  );
}
