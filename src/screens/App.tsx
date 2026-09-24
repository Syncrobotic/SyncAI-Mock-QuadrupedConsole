"use client";

import { useEffect } from "react";
import { Toaster } from "sonner";

import { MockOsPrompt } from "@/components/MockOsPrompt";
import { IS_MOCK } from "@/lib/env";
import { useTheme } from "next-themes";

import { PhoneFrame } from "@/components/PhoneFrame";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useStore } from "@/store";
import { boot, onVisibility } from "@/store/controller";

import { Console } from "./console/Console";
import { Onboarding } from "./onboarding/Onboarding";

export function App() {
  const conn = useStore((s) => s.conn);
  const epoch = useStore((s) => s.linkEpoch);
  const { theme } = useTheme();

  useKeyboardInset();

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
      {IS_MOCK && <MockOsPrompt />}
      {/* Inside the frame: the frame is a containing block for `fixed`, so
          toasts land on the phone, not on the desktop around it. Only screens
          without the status island use it — in the Console, notifications are
          the island's second line (lib/notify). */}
      <Toaster
        position="top-center"
        theme={(theme as "dark" | "light") ?? "dark"}
        // Below the status bar / cutout at the top.
        offset="calc(var(--safe-top) + 12px)"
        visibleToasts={3}
        duration={3000}
        toastOptions={{ className: "!text-[13px]" }}
      />
    </PhoneFrame>
  );
}
