"use client";

import { m } from "framer-motion";
import { useRef } from "react";

import { GROUP_LEN, KEY_GROUPS, normaliseKey } from "@/lib/license";
import { cn } from "@/lib/utils";

/**
 * Licence key input: four independent boxes of four characters.
 *
 * Each box owns its characters. Editing one box never moves characters in another — the
 * value is position-preserving (`SYNC-PR-2026-DEMO` while box 2 is half done), not one
 * 16-char string re-sliced every render. That re-slicing is what made a deletion in box 1
 * pull box 2's first character forward, and a fifth keystroke wipe everything after it.
 *
 *   typing        fills the box; reaching 4 chars at the end moves on to the next box
 *   full box      typing in the middle overwrites the next character (the box stays 4)
 *   paste         a whole key (dashes / case / spaces ignored) fills every box; a shorter
 *                 fragment fills from this box onward
 *   Backspace     in an empty box (or at its start) deletes the previous box's last char
 *   ← / →         cross into the neighbouring box at the edges
 *
 * `value` may be position-preserving (with dashes) or compact (16 chars, e.g. a prefill);
 * `normaliseKey` / `isCompleteKey` see through the dashes, so a key with a short box is
 * simply incomplete.
 */

type Boxes = string[];

function split(value: string): Boxes {
  if (value.includes("-")) {
    const parts = value.split("-");
    return Array.from({ length: KEY_GROUPS }, (_, i) => normaliseKey(parts[i] ?? "").slice(0, GROUP_LEN));
  }
  const compact = normaliseKey(value);
  return Array.from({ length: KEY_GROUPS }, (_, i) => compact.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN));
}

const join = (boxes: Boxes) => boxes.join("-");

export function KeyInput({
  value,
  onChange,
  invalid,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (key: string) => void;
  /** true: the whole key is wrong; a list: only those boxes (0-based) are. */
  invalid?: boolean | number[];
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const boxes = split(value);
  const bad = (i: number) => (Array.isArray(invalid) ? invalid.includes(i) : !!invalid);
  const shaking = Array.isArray(invalid) ? invalid.length > 0 : !!invalid;

  /** Focus a box with the caret at `pos` (after React has written the new value). */
  const focusAt = (i: number, pos: number | "end") => {
    requestAnimationFrame(() => {
      const el = refs.current[i];
      if (!el) return;
      el.focus();
      const p = pos === "end" ? el.value.length : pos;
      el.setSelectionRange(p, p);
    });
  };

  const emit = (next: Boxes) => onChange(join(next));

  /** Fill boxes from `start` with `clean` (a paste). A whole key always starts at box 0. */
  const fill = (start: number, clean: string) => {
    const from = clean.length >= KEY_GROUPS * GROUP_LEN ? 0 : start;
    const next = [...boxes];
    let rest = clean;
    let i = from;
    while (rest && i < KEY_GROUPS) {
      next[i] = rest.slice(0, GROUP_LEN);
      rest = rest.slice(GROUP_LEN);
      i++;
    }
    emit(next);
    const last = Math.min(KEY_GROUPS - 1, i - 1);
    focusAt(next[last].length === GROUP_LEN && last < KEY_GROUPS - 1 ? last + 1 : last, next[last].length === GROUP_LEN && last < KEY_GROUPS - 1 ? 0 : "end");
  };

  const onBoxChange = (i: number, el: HTMLInputElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const clean = normaliseKey(el.value);
    const next = [...boxes];

    if (clean.length <= GROUP_LEN) {
      next[i] = clean;
      emit(next);
      // Advance only when the box was completed by typing at its end.
      if (clean.length === GROUP_LEN && caret >= GROUP_LEN && boxes[i].length < GROUP_LEN && i < KEY_GROUPS - 1) focusAt(i + 1, 0);
      return;
    }

    // One character too many (typed into a full box).
    if (clean.length === GROUP_LEN + 1) {
      if (caret > GROUP_LEN) {
        // Typed at the end: the character belongs to the next box, if it has room.
        next[i] = clean.slice(0, GROUP_LEN);
        if (i < KEY_GROUPS - 1 && next[i + 1].length < GROUP_LEN) {
          next[i + 1] = clean[GROUP_LEN] + next[i + 1];
          emit(next);
          focusAt(i + 1, 1);
        } else {
          emit(next);
        }
        return;
      }
      // Typed in the middle: overwrite the character after the caret.
      next[i] = clean.slice(0, caret) + clean.slice(caret + 1);
      emit(next);
      focusAt(i, caret);
      return;
    }

    // Anything longer arrived at once (autofill / IME): treat it as a paste into this box.
    fill(i, normaliseKey(el.value));
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const atStart = start === 0 && end === 0;
    const atEnd = start === el.value.length && end === el.value.length;

    if (e.key === "Backspace" && atStart && i > 0) {
      e.preventDefault();
      const next = [...boxes];
      next[i - 1] = next[i - 1].slice(0, -1);
      emit(next);
      focusAt(i - 1, "end");
    } else if (e.key === "ArrowLeft" && atStart && i > 0) {
      e.preventDefault();
      focusAt(i - 1, "end");
    } else if (e.key === "ArrowRight" && atEnd && i < KEY_GROUPS - 1) {
      e.preventDefault();
      focusAt(i + 1, 0);
    }
  };

  return (
    // A rejected key gives a short shake, the way a wrong passcode does.
    <m.div
      className="flex items-center gap-1.5"
      role="group"
      aria-label="License 金鑰，4 組、每組 4 碼"
      animate={shaking ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
      transition={{ duration: 0.36 }}
    >
      {boxes.map((g, i) => (
        <div key={i} className="flex flex-1 items-center gap-1.5">
          <input
            ref={(el) => {
              refs.current[i] = el;
            }}
            aria-label={`第 ${i + 1} 組`}
            aria-invalid={bad(i) || undefined}
            autoFocus={autoFocus && i === 0}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint={i < KEY_GROUPS - 1 ? "next" : "done"}
            disabled={disabled}
            value={g}
            onChange={(e) => onBoxChange(i, e.currentTarget)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => {
              const text = normaliseKey(e.clipboardData.getData("text"));
              if (text.length <= 1) return; // a single character: let onChange handle it
              e.preventDefault();
              fill(i, text);
            }}
            className={cn(
              "bg-background h-11 w-full min-w-0 rounded-lg border text-center font-mono text-[16px] font-semibold tracking-[0.12em] uppercase outline-none",
              "focus-visible:border-primary focus-visible:ring-primary/30 focus-visible:ring-2 disabled:opacity-50",
              bad(i) ? "border-status-error text-status-error" : "border-input"
            )}
          />
          {i < KEY_GROUPS - 1 && <span aria-hidden className="text-muted-foreground/60 shrink-0">–</span>}
        </div>
      ))}
    </m.div>
  );
}
