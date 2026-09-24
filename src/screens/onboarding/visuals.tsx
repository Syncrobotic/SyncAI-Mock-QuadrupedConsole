"use client";

import { AnimatePresence, m } from "framer-motion";
import { Check, Hourglass, KeyRound, Router, Smartphone } from "lucide-react";

import { cn } from "@/lib/utils";

import type { DogAdvert } from "@/proto/types";

/**
 * The pairing flow's visuals. One idea throughout: two nodes and the link between them —
 * phone ↔ dog while pairing, router ↔ dog while the dog joins Wi-Fi. What travels on the
 * link says what is happening (packets, a key, nothing yet). Continuous motion is used
 * only while something is in progress; MotionConfig reducedMotion="user" and the global
 * reduced-motion CSS turn it off.
 */

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

// ── A quadruped, in the product's line style ────────────────────────────────

export function DogGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {/* body */}
      <rect x="4" y="9" width="19" height="6" rx="2.5" />
      {/* raised head with its sensor */}
      <path d="M21 9l2.5-3.5H28a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1h-5" />
      <circle cx="26.5" cy="7.7" r="0.9" fill="currentColor" stroke="none" />
      {/* four legs */}
      <path d="M7 15v6M11 15v6M16 15v6M20 15v6" />
    </svg>
  );
}

// ── Link hero ───────────────────────────────────────────────────────────────

export type LinkPhase = "idle" | "linking" | "linked" | "key" | "approval" | "wifi" | "online" | "failed";

export function LinkHero({ phase, progress = 0, className }: { phase: LinkPhase; progress?: number; className?: string }) {
  const wifi = phase === "wifi" || phase === "online";
  const done = phase === "linked" || phase === "online";
  const solid = done || phase === "key";
  const tone = phase === "approval" ? "warn" : phase === "failed" ? "bad" : done ? "ok" : "brand";
  const lineTone = { brand: "bg-primary-accent", ok: "bg-status-ok", warn: "bg-severity-warning", bad: "bg-status-error" }[tone];

  return (
    <div className={cn("relative mx-auto flex h-36 w-full max-w-[320px] items-center", className)} aria-hidden>
      {/* soft glow behind the link */}
      <div
        className="absolute inset-0 -z-0 opacity-70"
        style={{ background: "radial-gradient(ellipse 60% 55% at 50% 50%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)" }}
      />

      <Node active={!done && phase !== "approval"} tone={tone}>
        {wifi ? <Router className="size-6" /> : <Smartphone className="size-6" />}
      </Node>

      {/* the link */}
      <div className="relative mx-3 h-8 flex-1">
        <div className="border-muted-foreground/30 absolute inset-x-0 top-1/2 -translate-y-1/2 border-t-2 border-dashed" />
        <m.div
          className={cn("absolute inset-x-0 top-1/2 h-0.5 origin-left -translate-y-1/2 rounded-full", lineTone)}
          initial={false}
          animate={{ scaleX: solid ? 1 : 0, opacity: solid ? 1 : 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
        />

        {/* packets while linking / waiting */}
        {(phase === "linking" || phase === "approval" || phase === "wifi") &&
          [0, 1, 2].map((i) => (
            <m.span
              key={`${phase}-${i}`}
              className={cn("absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full shadow-[0_0_8px_currentColor]", tone === "warn" ? "bg-severity-warning text-severity-warning" : "bg-primary-accent text-primary-accent")}
              initial={{ left: "0%", opacity: 0 }}
              animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
              transition={{ duration: phase === "approval" ? 2.4 : 1.4, repeat: Infinity, delay: i * (phase === "approval" ? 0.8 : 0.46), ease: "easeInOut" }}
            />
          ))}

        {/* the key travels once, then rests on the dog side */}
        <AnimatePresence>
          {phase === "key" && (
            <m.span
              key="key"
              className="bg-primary text-primary-foreground absolute top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-lg ring-2 ring-violet-300/30"
              initial={{ left: "0%", scale: 0.6, opacity: 0 }}
              animate={{ left: "100%", scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ duration: 1.1, ease: EASE_OUT }}
            >
              <KeyRound className="size-3.5" />
            </m.span>
          )}
        </AnimatePresence>

        {/* centre badge: done / waiting */}
        <AnimatePresence>
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
              transition={{ type: "spring", stiffness: 420, damping: 22, delay: done ? 0.3 : 0 }}
            >
              {done ? <Check className="size-4" strokeWidth={3} /> : <Hourglass className="size-3.5" />}
            </m.span>
          )}
        </AnimatePresence>
      </div>

      <Node active={!done} tone={tone} progress={phase === "wifi" ? progress : undefined}>
        <DogGlyph className="size-8" />
        {wifi && <WifiArcs on={phase === "wifi"} />}
      </Node>
    </div>
  );
}

function Node({ children, active, tone, progress }: { children: React.ReactNode; active: boolean; tone: "brand" | "ok" | "warn" | "bad"; progress?: number }) {
  const ring = { brand: "border-primary-accent", ok: "border-status-ok", warn: "border-severity-warning", bad: "border-status-error" }[tone];
  const ink = { brand: "text-primary-accent", ok: "text-status-ok", warn: "text-severity-warning", bad: "text-status-error" }[tone];
  return (
    <div className="relative z-10 grid size-16 shrink-0 place-items-center">
      {active && (
        <m.span
          className={cn("absolute inset-0 rounded-full border-2", ring)}
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.55, opacity: 0 }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className={cn("bg-card relative grid size-16 place-items-center rounded-full border shadow-lg transition-colors duration-300", ink)}>{children}</span>
      {progress !== undefined && (
        <svg viewBox="0 0 68 68" className="text-primary-accent absolute -inset-0.5 size-[68px] -rotate-90" aria-hidden>
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

function WifiArcs({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 14" className="text-primary-accent absolute -top-4 left-1/2 w-7 -translate-x-1/2" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      {["M8.5 11.5a5 5 0 0 1 7 0", "M5 8a10 10 0 0 1 14 0", "M1.5 4.5a15 15 0 0 1 21 0"].map((d, i) => (
        <m.path
          key={d}
          d={d}
          initial={{ opacity: 0.25 }}
          animate={on ? { opacity: [0.25, 1, 0.25] } : { opacity: 1 }}
          transition={on ? { duration: 1.5, repeat: Infinity, delay: i * 0.25 } : { duration: 0.3 }}
        />
      ))}
    </svg>
  );
}

// ── Radar (scan) ────────────────────────────────────────────────────────────

/** Stable angle for a dog, so its blip does not jump between adverts. */
function angleOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (h * 137.5) % 360;
}

/** Stronger signal → nearer the centre (the phone). */
function radiusOf(rssi: number) {
  const t = Math.min(1, Math.max(0, (-rssi - 45) / 45));
  return 0.3 + t * 0.6;
}

export function Radar({ dogs, onPick }: { dogs: DogAdvert[]; onPick: (d: DogAdvert) => void }) {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[220px]">
      <div className="absolute inset-0 rounded-full" style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--primary) 16%, transparent), transparent 70%)" }} />
      {[1, 0.66, 0.33].map((r) => (
        <span key={r} className="border-primary-accent/20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ width: `${r * 100}%`, height: `${r * 100}%` }} />
      ))}
      <span className="bg-primary-accent/12 absolute inset-x-0 top-1/2 h-px" />
      <span className="bg-primary-accent/12 absolute inset-y-0 left-1/2 w-px" />
      {/* the sweep — the loading indicator of this screen */}
      <div
        className="absolute inset-0 animate-[spin_2.6s_linear_infinite] rounded-full"
        style={{ background: "conic-gradient(from 0deg, transparent 0deg, transparent 290deg, color-mix(in oklab, var(--primary-accent) 45%, transparent) 360deg)" }}
      />
      {/* the phone, at the centre */}
      <span className="bg-primary text-primary-foreground absolute top-1/2 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-lg ring-4 ring-violet-500/20">
        <Smartphone className="size-4" />
      </span>

      <AnimatePresence>
        {dogs.map((d) => {
          const a = (angleOf(d.id) * Math.PI) / 180;
          const r = radiusOf(d.rssi) * 50;
          return (
            <m.button
              key={d.id}
              onClick={() => onPick(d)}
              aria-label={`選擇 ${d.name}`}
              className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center gap-0.5"
              style={{ left: `${50 + Math.cos(a) * r}%`, top: `${50 + Math.sin(a) * r}%` }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 20 }}
            >
              <span className="relative grid size-7 place-items-center">
                <m.span
                  className={cn("absolute inset-0 rounded-full", d.hasOwner ? "bg-foreground/25" : "bg-primary-accent/40")}
                  animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                />
                <span className={cn("relative grid size-7 place-items-center rounded-full border shadow", d.hasOwner ? "bg-card text-foreground" : "bg-primary text-primary-foreground border-primary")}>
                  <DogGlyph className="size-4" />
                </span>
              </span>
              <span className="bg-card/90 rounded px-1 font-mono text-[11px] leading-tight font-semibold backdrop-blur">{d.serial.slice(-4)}</span>
            </m.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ── Stepper ─────────────────────────────────────────────────────────────────

export const PHASES = ["配對", "授權", "網路", "安全"] as const;

export function Stepper({ phase }: { phase: number }) {
  return (
    <ol className="mx-auto flex w-full max-w-[300px] items-center" aria-label={`第 ${phase + 1} 階段，共 ${PHASES.length} 階段：${PHASES[phase]}`}>
      {PHASES.map((label, i) => {
        const state = i < phase ? "done" : i === phase ? "now" : "todo";
        return (
          <li key={label} className={cn("flex items-center", i < PHASES.length - 1 && "flex-1")} aria-current={state === "now" ? "step" : undefined}>
            <span className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "grid size-6 place-items-center rounded-full border text-[11px] font-semibold transition-colors duration-300",
                  state === "done" && "bg-primary border-primary text-primary-foreground",
                  state === "now" && "border-primary-accent text-primary-accent bg-primary/15 ring-4 ring-violet-500/15",
                  state === "todo" && "text-muted-foreground bg-card"
                )}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {state === "done" ? (
                    <m.span key="c" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 24 }}>
                      <Check className="size-3.5" strokeWidth={3} />
                    </m.span>
                  ) : (
                    <m.span key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                      {i + 1}
                    </m.span>
                  )}
                </AnimatePresence>
              </span>
              <span className={cn("text-[11px] font-medium", state === "todo" ? "text-muted-foreground" : "text-foreground")}>{label}</span>
            </span>
            {i < PHASES.length - 1 && (
              <span className="bg-muted relative mx-1.5 mb-5 h-0.5 flex-1 overflow-hidden rounded-full">
                <m.span className="bg-primary absolute inset-0 origin-left" initial={false} animate={{ scaleX: i < phase ? 1 : 0 }} transition={{ duration: 0.4, ease: EASE_OUT }} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Animated checklist ──────────────────────────────────────────────────────

export function CheckList({ items }: { items: { label: string; state: "done" | "doing" | "todo" }[] }) {
  return (
    <ul className="mx-auto w-full max-w-[300px] space-y-2">
      {items.map((it, i) => (
        <m.li
          key={it.label}
          className="flex items-center gap-2.5 text-[13px]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: it.state === "todo" ? 0.5 : 1, y: 0 }}
          transition={{ duration: 0.25, delay: i * 0.06, ease: EASE_OUT }}
        >
          <span
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-300",
              it.state === "done" ? "bg-status-ok border-status-ok text-white" : it.state === "doing" ? "border-primary-accent" : "border-muted-foreground/40"
            )}
          >
            {it.state === "done" ? (
              <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <m.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, ease: EASE_OUT }} />
              </svg>
            ) : it.state === "doing" ? (
              <m.span className="bg-primary-accent size-1.5 rounded-full" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1, repeat: Infinity }} />
            ) : null}
          </span>
          <span className={cn(it.state === "doing" && "text-foreground font-medium", it.state === "todo" && "text-muted-foreground")}>{it.label}</span>
        </m.li>
      ))}
    </ul>
  );
}

/** Entrance for a result card: a short rise and settle. */
export const popIn = {
  initial: { opacity: 0, y: 10, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  transition: { duration: 0.32, ease: EASE_OUT },
} as const;

/** Stagger for lists that arrive together. */
export const rise = (i: number) =>
  ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.28, delay: 0.04 + i * 0.05, ease: EASE_OUT },
  }) as const;
