"use client";

import { ReviewPanel } from "./ReviewPanel";

/**
 * Same wrapper the dashboard's resident app uses (`resident-shell.tsx`): on a
 * phone it is the whole screen; on a desktop it becomes a 390×844 phone so a
 * design review sees the real proportions, with the review panel beside it.
 *
 * 🔴 `transform-gpu` is load-bearing: a transformed element is the containing
 * block for `position: fixed` descendants, so every overlay, toast and sheet
 * in the app is clipped to the phone instead of the browser window.
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-sunken flex min-h-dvh items-center justify-center gap-10 sm:p-6">
      <div className="bg-background relative flex h-dvh w-full transform-gpu flex-col overflow-hidden sm:h-[844px] sm:max-h-[calc(100dvh-3rem)] sm:w-[390px] sm:rounded-[2.75rem] sm:border-[10px] sm:border-neutral-800 sm:shadow-2xl">
        {children}
      </div>
      <ReviewPanel />
    </div>
  );
}
