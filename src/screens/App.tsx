"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";
import { useTheme } from "next-themes";

import { PhoneFrame } from "@/components/PhoneFrame";
import { useStore } from "@/store";
import { boot, onVisibility } from "@/store/controller";

import { Console } from "./console/Console";
import { Onboarding } from "./onboarding/Onboarding";

export function App() {
  const conn = useStore((s) => s.conn);
  const epoch = useStore((s) => s.linkEpoch);
  const toastBottom = useStore((s) => s.toastBottom);
  const { theme } = useTheme();

  useEffect(() => {
    boot();
    const onVis = () => onVisibility(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const onboarding = conn === "Unpaired" || conn === "Onboarding";

  return (
    <PhoneFrame>
      {onboarding ? <Onboarding /> : <Console key={epoch} />}
      {/* Inside the frame: the frame is a containing block for `fixed`, so
          toasts land on the phone, not on the desktop around it. */}
      <Toaster
        // In the Console, toasts sit just above the E-Stop: the top of the map
        // is the status header and banners, and a toast there hid both.
        position={onboarding || toastBottom === null ? "top-center" : "bottom-center"}
        theme={(theme as "dark" | "light") ?? "dark"}
        offset={onboarding || toastBottom === null ? 56 : { bottom: toastBottom }}
        visibleToasts={3}
        duration={3000}
        toastOptions={{ className: "!text-[13px]" }}
      />
    </PhoneFrame>
  );
}
