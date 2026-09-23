import { useSyncExternalStore } from "react";

import { useStore } from "@/store";

const QUERY = "(orientation: landscape) and (max-height: 520px)";

/**
 * A phone held sideways — or the review panel's landscape preview. A desktop
 * window is "landscape" too, which is why the height cap is there.
 */
export function useLandscape() {
  const forced = useStore((s) => s.forceLandscape);
  const real = useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false
  );
  return forced || real;
}
