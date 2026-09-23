"use client";

import { AnimatePresence, m } from "framer-motion";
import { Lock } from "lucide-react";
import { Component, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The console's small kit. Everything here renders inside the phone frame —
 * `fixed` resolves against the frame (see PhoneFrame), so no portals.
 */

// ── Modal ────────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  children,
  className,
  dismissable = true,
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  dismissable?: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-3 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => dismissable && onClose?.()}
        >
          <m.div
            role="dialog"
            aria-modal
            className={cn("bg-popover text-popover-foreground w-full max-w-sm rounded-2xl border p-5 shadow-2xl", className)}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

// ── Section title (resident-app style) ──────────────────────────────────────

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">{children}</h3>
      {action}
    </div>
  );
}

// ── Locked state (§5 鎖定態) ─────────────────────────────────────────────────

export function LockedPanel({ reason, detail, children }: { reason: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="bg-surface-sunken text-muted-foreground flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
      <span className="bg-muted grid size-10 place-items-center rounded-full">
        <Lock className="size-4" />
      </span>
      <p className="text-foreground text-sm font-medium">{reason}</p>
      {detail && <p className="text-xs leading-relaxed">{detail}</p>}
      {children}
    </div>
  );
}

// ── Segmented control ───────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  disabled,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" className={cn("bg-muted grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg p-0.5", disabled && "opacity-50", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-9 cursor-pointer rounded-md px-2 text-[13px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none disabled:cursor-not-allowed",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Slider ──────────────────────────────────────────────────────────────────

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  label,
  cap,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  label: string;
  /** A hard ceiling drawn on the track (e.g. the Owner's global limit). */
  cap?: number;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const capPct = cap !== undefined ? ((cap - min) / (max - min)) * 100 : null;
  return (
    <div className="relative h-11 flex-1">
      <div className="bg-muted absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full">
        <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
        {capPct !== null && capPct < 100 && (
          <div className="bg-muted-foreground/25 absolute inset-y-0 right-0 rounded-r-full" style={{ left: `${capPct}%` }} />
        )}
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(cap !== undefined ? Math.min(v, cap) : v);
        }}
        className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--primary)] [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--primary)] [&::-webkit-slider-thumb]:shadow"
      />
    </div>
  );
}

// ── Form bits ───────────────────────────────────────────────────────────────

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {error ? <span className="text-destructive block text-xs">{error}</span> : hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "bg-background border-input h-11 w-full rounded-lg border px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 aria-invalid:border-destructive";

export function Select<T extends string>({
  value,
  onChange,
  options,
  disabled,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(inputClass, "h-10 cursor-pointer text-[14px]", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A list row: label left, value/control right. 44pt minimum. */
export function Row({ label, sub, children, className }: { label: ReactNode; sub?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-11 items-center justify-between gap-3 py-1.5", className)}>
      <div className="min-w-0">
        <p className="truncate text-[14px]">{label}</p>
        {sub && <p className="text-muted-foreground truncate text-xs">{sub}</p>}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2 text-[14px] tabular-nums">{children}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-card rounded-xl border p-3.5", className)}>{children}</div>;
}

// ── Tone pill (dashboard StatusBadge semantics: dot + hue) ──────────────────

const TONE = {
  ok: "bg-status-ok/15 text-status-ok border-status-ok/30",
  busy: "bg-status-busy/15 text-status-busy border-status-busy/30",
  warn: "bg-severity-warning/15 text-severity-warning border-severity-warning/30",
  bad: "bg-status-error/15 text-status-error border-status-error/30",
  neutral: "bg-muted text-muted-foreground border-border",
} as const;

export type Tone = keyof typeof TONE;

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium whitespace-nowrap", TONE[tone], className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

// ── Error boundary (§14: a tab crash never takes the E-Stop with it) ────────

export class TabBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  render() {
    if (this.state.error)
      return (
        <div className="p-4">
          <LockedPanel reason="這個分頁發生錯誤" detail={this.state.error.message}>
            <p className="text-xs">E-Stop 不受影響。切換分頁即可重試。</p>
          </LockedPanel>
        </div>
      );
    return this.props.children;
  }
}
