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
        position="top-center"
        theme={(theme as "dark" | "light") ?? "dark"}
        offset={56}
        visibleToasts={3}
        duration={3000}
        toastOptions={{ className: "!text-[13px]" }}
      />
    </PhoneFrame>
  );
}
