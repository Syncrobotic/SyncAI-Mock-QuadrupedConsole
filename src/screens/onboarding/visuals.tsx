"use client";

import { AnimatePresence, m } from "framer-motion";
import { Check, Hourglass, KeyRound, QrCode, Router, Smartphone } from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { DogAdvert } from "@/proto/types";

/**
 * The pairing flow's visuals. Every step shows one, in the same fixed band, so moving
 * between steps changes the picture but never moves it. One idea throughout: two nodes and
 * the link between them — phone ↔ dog while pairing, router ↔ dog on Wi-Fi. Continuous
 * motion only while something is in progress; MotionConfig reducedMotion="user" and the
 * global reduced-motion CSS switch it off.
 */

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

// ── A quadruped, in the product's line style ────────────────────────────────

export function DogGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="4" y="9" width="19" height="6" rx="2.5" />
      <path d="M21 9l2.5-3.5H28a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1h-5" />
      <circle cx="26.5" cy="7.7" r="0.9" fill="currentColor" stroke="none" />
      <path d="M7 15v6M11 15v6M16 15v6M20 15v6" />
    </svg>
  );
}

// ── Link ────────────────────────────────────────────────────────────────────

export type LinkPhase = "linking" | "key" | "linked" | "approval" | "router" | "wifi" | "online" | "failed";

type Tone = "brand" | "ok" | "warn" | "bad";
const INK: Record<Tone, string> = { brand: "text-primary-accent", ok: "text-status-ok", warn: "text-severity-warning", bad: "text-status-error" };
const LINE: Record<Tone, string> = { brand: "bg-primary-accent", ok: "bg-status-ok", warn: "bg-severity-warning", bad: "bg-status-error" };
const RING: Record<Tone, string> = { brand: "border-primary-accent", ok: "border-status-ok", warn: "border-severity-warning", bad: "border-status-error" };

/** Fills its band: nodes scale with the width, and 24px of margin keeps the pulse inside the screen. */
export function Link({ phase, progress = 0 }: { phase: LinkPhase; progress?: number }) {
  const router = phase === "router" || phase === "wifi" || phase === "online";
  const done = phase === "linked" || phase === "online";
  const tone: Tone = phase === "approval" ? "warn" : phase === "failed" ? "bad" : done ? "ok" : "brand";
  const moving = phase === "linking" || phase === "approval" || phase === "wifi";
  const solid = done || phase === "key";

  return (
    <div className="flex w-full max-w-[340px] items-center px-6" aria-hidden>
      <Node pulse={moving || phase === "key"} tone={tone}>
        {router ? <Router className="size-[42%]" /> : <Smartphone className="size-[42%]" />}
      </Node>

      <div className="relative mx-2 h-8 min-w-0 flex-1">
        <div className="border-muted-foreground/30 absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed" />
        <m.div
          className={cn("absolute inset-x-0 top-1/2 h-0.5 origin-left -translate-y-1/2 rounded-full", LINE[tone])}
          initial={false}
          animate={{ scaleX: solid ? 1 : 0, opacity: solid ? 1 : 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
        />
        {moving &&
          [0, 1, 2].map((i) => (
            <m.span
              key={`${phase}-${i}`}
              className={cn("absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full", tone === "warn" ? "bg-severity-warning" : "bg-primary-accent")}
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
              transition={{ duration: phase === "approval" ? 2.4 : 1.4, repeat: Infinity, delay: i * (phase === "approval" ? 0.8 : 0.46), ease: "easeInOut" }}
            />
          ))}
        <AnimatePresence>
          {phase === "key" && (
            <m.span
              key="key"
              className="bg-primary text-primary-foreground absolute top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-lg"
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: "100%", opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, ease: EASE_OUT }}
            >
              <KeyRound className="size-3.5" />
            </m.span>
          )}
          {(done || phase === "approval") && (
            <m.span
              key={done ? "ok" : "wait"}
              className={cn(
                "absolute top-1/2 left-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 shadow-lg",
                done ? "bg-status-ok border-status-ok text-white" : "bg-card border-severity-warning text-severity-warning"
              )}
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 22, delay: done ? 0.25 : 0 }}
            >
              {done ? <Check className="size-4" strokeWidth={3} /> : <Hourglass className="size-3.5" />}
            </m.span>
          )}
        </AnimatePresence>
      </div>

      <Node pulse={moving} tone={tone} progress={phase === "wifi" ? progress : undefined}>
        <DogGlyph className="size-[52%]" />
      </Node>
    </div>
  );
}

// ── Network: phone — router — dog ───────────────────────────────────────────

export type NetPhase = "pick" | "joining" | "online" | "failed";

/**
 * The Wi-Fi steps' picture: the topology being built. After this step the phone reaches the
 * dog THROUGH the router, so the phone's link to the router matters as much as the dog's —
 * a phone on a different network will not find the dog. That link is amber and dashed when
 * the chosen network is not the phone's; `sameNet === null` (typed by hand) stays neutral.
 */
export function NetLink({ phase, sameNet, progress = 0 }: { phase: NetPhase; sameNet: boolean | null; progress?: number }) {
  const online = phase === "online";
  const phoneTone: Tone = sameNet === false ? "warn" : online ? "ok" : "brand";
  const dogTone: Tone = phase === "failed" ? "bad" : online ? "ok" : "brand";
  return (
    <div className="flex w-full max-w-[360px] items-center px-5" aria-hidden>
      <Node pulse={false} tone={phoneTone} small>
        <Smartphone className="size-[42%]" />
      </Node>
      <Wire solid={sameNet === true} tone={phoneTone} dashed={sameNet !== true} />
      <Node pulse={phase === "joining"} tone={online ? "ok" : "brand"} small>
        <Router className="size-[44%]" />
      </Node>
      <Wire solid={online} tone={dogTone} moving={phase === "joining"} check={online} />
      <Node pulse={phase === "joining"} tone={dogTone} small progress={phase === "joining" ? progress : undefined}>
        <DogGlyph className="size-[52%]" />
      </Node>
    </div>
  );
}

function Wire({ solid, tone, moving, check, dashed = true }: { solid: boolean; tone: Tone; moving?: boolean; check?: boolean; dashed?: boolean }) {
  return (
    <div className="relative mx-1.5 h-8 min-w-0 flex-1">
      {dashed && (
        <div className={cn("absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed transition-colors duration-300", tone === "warn" ? "border-severity-warning/70" : tone === "bad" ? "border-status-error/60" : "border-muted-foreground/30")} />
      )}
      <m.div
        className={cn("absolute inset-x-0 top-1/2 h-0.5 origin-left -translate-y-1/2 rounded-full", LINE[tone])}
        initial={false}
        animate={{ scaleX: solid ? 1 : 0, opacity: solid ? 1 : 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
      />
      {moving &&
        [0, 1, 2].map((i) => (
          <m.span
            key={i}
            className="bg-primary-accent absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full"
            initial={{ left: "0%", opacity: 0 }}
            animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.46, ease: "easeInOut" }}
          />
        ))}
      <AnimatePresence>
        {check && (
          <m.span
            key="ok"
            className="bg-status-ok border-status-ok absolute top-1/2 left-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 text-white shadow-lg"
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.25 }}
          >
            <Check className="size-3.5" strokeWidth={3} />
          </m.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function Node({ children, pulse, tone, progress, small }: { children: React.ReactNode; pulse: boolean; tone: Tone; progress?: number; small?: boolean }) {
  return (
    <div className={cn("relative grid shrink-0 place-items-center", small ? "size-[clamp(46px,13vw,56px)]" : "size-[clamp(52px,16vw,64px)]")}>
      {pulse && (
        <m.span
          className={cn("absolute inset-0 rounded-full border-2", RING[tone])}
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.4, opacity: 0 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className={cn("bg-card relative grid size-full place-items-center rounded-full border shadow-lg transition-colors duration-300", INK[tone])}>{children}</span>
      {progress !== undefined && (
        <svg viewBox="0 0 68 68" className="text-primary-accent absolute -inset-1 -rotate-90" aria-hidden>
          <circle cx="34" cy="34" r="32" fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth="2.5" />
          <m.circle
            cx="34"
            cy="34"
            r="32"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: Math.min(1, Math.max(0.02, progress)) }}
            transition={{ duration: 0.8, ease: "linear" }}
          />
        </svg>
      )}
    </div>
  );
}

// ── Licence card scanner (the camera, in the visual band) ─────────────────

export type ScanState = "scanning" | "found" | "failed";

/**
 * The camera view for the licence card: a card-shaped (ID-1) window with corner marks and a
 * moving scan line — no text. Found: the corners turn green and a check pops; failed: red.
 * Mock: a dark field with a card silhouette; real: the camera stream goes behind the frame.
 */
export function CardScan({ state }: { state: ScanState }) {
  const tone = state === "found" ? "border-status-ok" : state === "failed" ? "border-status-error" : "border-white";
  return (
    <div className="relative aspect-[1.586] h-full max-h-full overflow-hidden rounded-2xl bg-black shadow-xl" aria-hidden>
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 45%, #2b2b36, #060608 75%)" }} />
      {/* the card in view */}
      <div className="absolute inset-[16%] grid place-items-center rounded-lg border border-white/10 bg-white/[0.04]">
        <QrCode className="size-[38%] text-white/25" />
      </div>
      {[
        "top-3 left-3 border-t-[3px] border-l-[3px] rounded-tl-xl",
        "top-3 right-3 border-t-[3px] border-r-[3px] rounded-tr-xl",
        "bottom-3 left-3 border-b-[3px] border-l-[3px] rounded-bl-xl",
        "bottom-3 right-3 border-b-[3px] border-r-[3px] rounded-br-xl",
      ].map((c) => (
        <span key={c} className={cn("absolute size-7 transition-colors duration-300", tone, c)} />
      ))}
      {state === "scanning" && (
        <m.span
          className="bg-primary-accent absolute inset-x-6 h-0.5 rounded-full shadow-[0_0_12px_var(--primary-accent)]"
          initial={{ top: "18%" }}
          animate={{ top: ["18%", "82%", "18%"] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <AnimatePresence>
        {state === "found" && (
          <m.span
            key="ok"
            className="bg-status-ok absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-white shadow-lg"
            initial={{ scale: 0.3, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 20 }}
          >
            <Check className="size-6" strokeWidth={3} />
          </m.span>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Radar (scan) — atmosphere only; picking happens in the list ─────────────

function angleOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (h * 137.5) % 360;
}

/** Stronger signal → nearer the centre (the phone). */
function radiusOf(rssi: number) {
  const t = Math.min(1, Math.max(0, (-rssi - 45) / 45));
  return 0.35 + t * 0.5;
}

export function Radar({ dogs }: { dogs: DogAdvert[] }) {
  return (
    <div className="relative aspect-square h-full max-h-full" aria-hidden>
      {[1, 0.66, 0.33].map((r) => (
        <span key={r} className="border-primary-accent/20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ width: `${r * 100}%`, height: `${r * 100}%` }} />
      ))}
      <div
        className="absolute inset-0 animate-[spin_2.6s_linear_infinite] rounded-full"
        style={{ background: "conic-gradient(from 0deg, transparent 0deg, transparent 290deg, color-mix(in oklab, var(--primary-accent) 40%, transparent) 360deg)" }}
      />
      <span className="bg-primary text-primary-foreground absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-lg ring-4 ring-violet-500/20">
        <Smartphone className="size-4" />
      </span>
      <AnimatePresence>
        {dogs.map((d) => {
          const a = (angleOf(d.id) * Math.PI) / 180;
          const r = radiusOf(d.rssi) * 50;
          return (
            <m.span
              key={d.id}
              className={cn(
                "absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border shadow",
                d.hasOwner ? "bg-card text-foreground" : "bg-primary text-primary-foreground border-primary"
              )}
              style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%` }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 20 }}
            >
              <DogGlyph className="size-3.5" />
            </m.span>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── Stepper ─────────────────────────────────────────────────────────────────

export const PHASES = ["配對", "授權", "網路", "安全"] as const;

/**
 * Segmented progress: one 6px bar per stage, on the same line as the back button.
 *
 * - The current stage fills in part (`sub`, 0–1) as its screens go by, so moving from 找狗
 *   to 配對中 visibly advances even though both are stage 1.
 * - No text by default. It is a real button: pressing (or focusing) it floats up the stage
 *   name, which fades 1.2 s after release; screen readers get the same from its label.
 */
export function Stepper({ phase, sub = 0.5 }: { phase: number; sub?: number }) {
  const [hint, setHint] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    setHint(true);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setHint(false), 1200);
  };
  const label = `${PHASES[phase]} · 第 ${phase + 1}/${PHASES.length} 步`;
  return (
    <button
      type="button"
      aria-label={`進度：${label}`}
      onPointerDown={show}
      onPointerUp={hide}
      onPointerLeave={hide}
      onPointerCancel={hide}
      onFocus={show}
      onBlur={hide}
      data-no-slop
      className="focus-visible:ring-primary/40 relative mx-auto flex h-11 w-full max-w-[220px] cursor-pointer touch-none items-center gap-1.5 rounded-lg outline-none select-none focus-visible:ring-2"
    >
      {PHASES.map((name, i) => (
        <span key={name} aria-hidden className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
          <m.span
            className={cn("absolute inset-0 origin-left rounded-full", i < phase ? "bg-primary" : "bg-primary-accent")}
            initial={false}
            animate={{ scaleX: i < phase ? 1 : i === phase ? Math.max(0.15, Math.min(1, sub)) : 0 }}
            transition={{ duration: 0.45, ease: EASE_OUT }}
          />
        </span>
      ))}
      <AnimatePresence>
        {hint && (
          <m.span
            key="hint"
            aria-hidden
            className="bg-popover text-popover-foreground absolute top-full left-1/2 z-10 -translate-x-1/2 rounded-lg border px-2.5 py-1 text-[12px] font-medium whitespace-nowrap shadow-lg"
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
          >
            {label}
          </m.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/** Entrance for a result card: a short rise and settle. */
export const popIn = {
  initial: { opacity: 0, y: 8, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: 0.3, ease: EASE_OUT },
} as const;

/** Stagger for list rows arriving one after another. */
export const rise = (i: number) =>
  ({
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.25, delay: i * 0.05, ease: EASE_OUT },
  }) as const;
