"use client";

import { useRef } from "react";

import { GROUP_LEN, KEY_GROUPS, normaliseKey } from "@/lib/license";
import { cn } from "@/lib/utils";

/**
 * Licence key input: four groups of four. Typing advances, Backspace on an
 * empty group steps back, and a paste of the whole key — with or without
 * dashes, any case — fills every group at once. The value is the compact
 * 16-char string; `formatKey` adds the dashes for display.
 */
export function KeyInput({
  value,
  onChange,
  invalid,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (compact: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const compact = normaliseKey(value);
  const groups = Array.from({ length: KEY_GROUPS }, (_, i) => compact.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN));

  const setGroup = (i: number, raw: string) => {
    const clean = normaliseKey(raw);
    const before = groups.slice(0, i).join("");
    // Within one group: keep what follows. Longer than a group (a paste, or a
    // fifth keystroke): it replaces everything from here on.
    const next = normaliseKey(clean.length > GROUP_LEN ? before + clean : before + clean + groups.slice(i + 1).join(""));
    onChange(next);
    if (clean.length >= GROUP_LEN) refs.current[Math.min(KEY_GROUPS - 1, Math.floor((before.length + clean.length) / GROUP_LEN))]?.focus();
  };

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="License 金鑰">
      {groups.map((g, i) => (
        <div key={i} className="flex flex-1 items-center gap-1.5">
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-label={`第 ${i + 1} 組`}
            autoFocus={autoFocus && i === 0}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={g}
            maxLength={24}
            onChange={(e) => setGroup(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && g.length === 0 && i > 0) refs.current[i - 1]?.focus();
            }}
            className={cn(
              "bg-background h-12 w-full min-w-0 rounded-lg border text-center font-mono text-[17px] font-semibold tracking-[0.12em] uppercase outline-none",
              "focus-visible:border-primary focus-visible:ring-primary/30 focus-visible:ring-2 disabled:opacity-50",
              invalid ? "border-status-error/60" : "border-input"
            )}
          />
          {i < KEY_GROUPS - 1 && <span className="text-muted-foreground/60 shrink-0">–</span>}
        </div>
      ))}
    </div>
  );
}
