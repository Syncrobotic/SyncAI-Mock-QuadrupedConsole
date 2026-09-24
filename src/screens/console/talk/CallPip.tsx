"use client";

import { Mic, MicOff } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { set, useStore } from "@/store";

import { useMediaSession } from "./session";
import { Video } from "./Video";

type Corner = "tl" | "tr" | "bl" | "br";

/** Portrait corners of the small window. The swapped map window uses the same corner (Console). */
export const PIP_CORNER: Record<Corner, string> = {
  tl: "top-[72px] left-2",
  tr: "top-[72px] right-2",
  // Bottom corners sit above the E-Stop's row; br also clears the view buttons (right column).
  bl: "bottom-[60px] left-2",
  br: "right-[60px] bottom-[60px]",
};

/**
 * §9: the call's picture-in-picture over the map — video beside the joysticks
 * (the patrol mode), and what stays of a call on the other tabs, audio and all.
 * A tap swaps it with the map.
 *
 * It can be dragged, and snaps to the nearest corner. The corners are inset
 * so it never lands on the status header (top) or the view buttons (right
 * column) — on an SE it used to sit on "follow".
 */
export function CallPip({ landscape = false }: { landscape?: boolean }) {
  const active = useStore((s) => s.call.active);
  const mic = useStore((s) => s.call.mic || s.call.ptt);
  const facing = useStore((s) => s.call.facing);
  const session = useMediaSession();
  const corner = useStore((s) => s.call.corner);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const el = useRef<HTMLButtonElement>(null);

  if (!active || !session) return null;

  const onDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.hypot(dx, dy) > 6) s.moved = true;
    if (s.moved) setDrag({ dx, dy });
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (!s?.moved || landscape) {
      // A tap swaps: the video takes the panel, the map becomes the window.
      set((st) => ({ tab: "teleop", call: { ...st.call, videoMain: true } }));
      return;
    }
    const b = el.current?.getBoundingClientRect();
    const parent = el.current?.parentElement?.getBoundingClientRect();
    if (b && parent) {
      const cx = b.left + b.width / 2 - parent.left;
      const cy = b.top + b.height / 2 - parent.top;
      const next = `${cy < parent.height / 2 ? "t" : "b"}${cx < parent.width / 2 ? "l" : "r"}` as Corner;
      set((st) => ({ call: { ...st.call, corner: next } }));
    }
    setDrag(null);
  };

  return (
    <button
      ref={el}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        start.current = null;
        setDrag(null);
      }}
      className={cn(
        "absolute z-10 aspect-video w-32 cursor-pointer touch-none overflow-hidden rounded-xl border bg-black shadow-2xl ring-1 ring-white/15",
        !drag && "transition-[top,left,right,bottom] duration-200 ease-out",
        // Landscape: the bottom corners are the joysticks and the top-right is the E-Stop,
        // so it lives top-left just under the island (and clear of the left stick), and stays.
        landscape && "top-[60px] left-2 w-36",
        !landscape && PIP_CORNER[corner]
      )}
      style={drag ? { translate: `${drag.dx}px ${drag.dy}px` } : undefined}
      aria-label="放大影像（可拖曳）"
    >
      <Video stream={session.stream} mirror={facing === "user"} />
      <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-black/60 text-white">
        {mic ? <Mic className="size-3" /> : <MicOff className="size-3" />}
      </span>
    </button>
  );
}
