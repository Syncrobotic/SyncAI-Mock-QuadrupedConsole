"use client";

import { useIsHydrated } from "@/hooks/use-is-hydrated";
import { App } from "@/screens/App";

/**
 * Static export: this is the only route. The app has no nested pages (§5
 * 導覽原則) — everything is a function of the two state machines.
 */
export default function Page() {
  return useIsHydrated() ? <App /> : null;
}
