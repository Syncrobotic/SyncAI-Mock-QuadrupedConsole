import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** True only in the browser after hydration — the whole app is client-side state. */
export function useIsHydrated() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false
  );
}
