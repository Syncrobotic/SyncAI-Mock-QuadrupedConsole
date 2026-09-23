"use client";

import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

const SIZE = 116;
const KNOB = 48;
const TRAVEL = (SIZE - KNOB) / 2;

/**
 * §7 joystick. Output is raw [-1, 1] on both axes (y up = +1); shaping
 * (dead zone + curve) happens in the control loop so it is one tested
 * function. Release snaps to zero — there is no "lock forward".
 */
export function Joystick({
  onChange,
  disabled,
  label,
  hint,
}: {
  onChange: (x: number, y: number) => void;
  disabled?: boolean;
  label: string;
  hint: string;
}) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const update = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > TRAVEL) {
      dx = (dx / d) * TRAVEL;
      dy = (dy / d) * TRAVEL;
    }
    setKnob({ x: dx, y: dy });
    onChange(dx / TRAVEL, -dy / TRAVEL);
  };

  const release = () => {
    active.current = null;
    setDragging(false);
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  };

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={base}
        role="application"
        aria-label={label}
        aria-disabled={disabled}
        onPointerDown={(e) => {
          if (disabled) return;
          active.current = e.pointerId;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          update(e);
        }}
        onPointerMove={(e) => active.current === e.pointerId && update(e)}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={() => active.current !== null && release()}
        className={cn(
          "relative touch-none rounded-full border-2 select-none",
          disabled ? "bg-muted/60 border-border cursor-not-allowed" : "bg-surface-sunken border-border cursor-grab"
        )}
        style={{ width: SIZE, height: SIZE }}
      >
        {/* Crosshair + dead-zone ring */}
        <span aria-hidden className="bg-border absolute inset-x-4 top-1/2 h-px" />
        <span aria-hidden className="bg-border absolute inset-y-4 left-1/2 w-px" />
        <span aria-hidden className="border-muted-foreground/20 absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border" />
        <span
          aria-hidden
          className={cn(
            "absolute top-1/2 left-1/2 rounded-full shadow-lg",
            disabled ? "bg-muted-foreground/30" : "bg-linear-to-br from-violet-500 to-violet-600 shadow-violet-600/30 ring-1 ring-white/20"
          )}
          style={{
            width: KNOB,
            height: KNOB,
            transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
            transition: dragging ? "none" : "transform 120ms ease-out",
          }}
        />
      </div>
      <span className="text-muted-foreground text-[11px]">{hint}</span>
    </div>
  );
}
