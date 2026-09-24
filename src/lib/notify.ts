import { useEffect, type ReactNode } from "react";
import { toast as sonner } from "sonner";

import { get, set } from "@/store";

/**
 * The Console's notifications. They do not get a strip of their own: the status island
 * (DogHeader) shows the notification — text, detail and action — in place of its status
 * row, same size and style, and gives the row back when it times out or the guard swipes it
 * away. One at a
 * time — a queue, with anything `bad` going straight to the front — so nothing ever covers
 * the E-Stop or a dialog's buttons.
 *
 * With no island on screen (onboarding, the licence gate) the same calls fall back to
 * sonner, so callers never need to know where they are.
 */

export type FlashTone = "ok" | "info" | "warn" | "bad";
export interface Flash {
  id: number;
  tone: FlashTone;
  text: string;
  sub?: string;
  icon?: ReactNode;
  action?: { label: string; icon?: ReactNode; run: () => void };
  /** A standing alert (§13 ladder): stays until swiped away or resolved. */
  alertId?: string;
}

const SHOW_MS: Record<FlashTone, number> = { ok: 2500, info: 3000, warn: 4000, bad: 5000 };
const MAX_QUEUE = 3;

let queue: Flash[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
let hosts = 0;

function show(f: Flash) {
  if (timer) clearTimeout(timer);
  timer = null;
  set({ flash: f });
  if (!f.alertId) timer = setTimeout(advance, SHOW_MS[f.tone]);
}

function advance() {
  if (timer) clearTimeout(timer);
  timer = null;
  const next = queue.shift();
  if (next) show(next);
  else set({ flash: null });
}

function push(f: Omit<Flash, "id">) {
  if (!hosts) {
    const fn = f.tone === "bad" ? sonner.error : f.tone === "warn" ? sonner.warning : f.tone === "ok" ? sonner.success : sonner;
    fn(f.text);
    return;
  }
  const cur = get().flash;
  // The same words twice in a row say nothing new.
  if (cur?.text === f.text || queue.some((q) => q.text === f.text)) return;
  const next: Flash = { ...f, id: ++seq };
  if (!cur) return show(next);
  if (next.tone === "bad" && cur.tone !== "bad") {
    // Critical jumps the queue and replaces what is showing.
    queue = [cur, ...queue].slice(0, MAX_QUEUE);
    return show(next);
  }
  queue.push(next);
  // A long queue is stale: keep the newest, and every critical one.
  while (queue.length > MAX_QUEUE) {
    const i = queue.findIndex((q) => q.tone !== "bad");
    queue.splice(i < 0 ? 0 : i, 1);
  }
}

/** Same shape as sonner's `toast`, so call sites only change their import. */
export const toast = Object.assign((text: string) => push({ tone: "info", text }), {
  info: (text: string) => push({ tone: "info", text }),
  success: (text: string) => push({ tone: "ok", text }),
  warning: (text: string) => push({ tone: "warn", text }),
  error: (text: string) => push({ tone: "bad", text }),
});

/** The guard swiped the open notification away (or it was answered). */
export function dismissFlash() {
  advance();
}

/** A standing alert appeared: announce it once, with its action. */
export function raiseAlert(a: Omit<Flash, "id" | "alertId"> & { alertId: string }) {
  if (get().flash?.alertId === a.alertId || queue.some((q) => q.alertId === a.alertId)) return;
  push(a);
}

/** The alert resolved itself: its notification goes too. */
export function retractAlert(alertId: string) {
  queue = queue.filter((q) => q.alertId !== alertId);
  if (get().flash?.alertId === alertId) advance();
}

/** Mounted by the island: while one is on screen, notifications go to it. */
export function useFlashHost() {
  useEffect(() => {
    hosts++;
    return () => {
      hosts--;
      if (hosts) return;
      queue = [];
      if (timer) clearTimeout(timer);
      timer = null;
      set({ flash: null });
    };
  }, []);
}
