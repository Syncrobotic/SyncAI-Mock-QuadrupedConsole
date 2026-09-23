"use client";

import { ChevronLeft } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { StepConnect, StepEnroll, StepLicense, StepSafety, StepScan, StepWait, StepWelcome, StepWifi } from "./steps";

import type { DogAdvert, Endpoint, PairSession, Role } from "@/proto/types";

/**
 * §4 first-connection onboarding: eight screens, each with an explicit
 * failure branch and a way back. The only full-screen flow in the app besides
 * a landscape call (§5).
 */

export type Step = "welcome" | "scan" | "connect" | "enroll" | "license" | "wifi" | "wait" | "safety";

/**
 * §4's screens, minus the LED pairing code (not used on this dog) and plus
 * the licence key, entered before Wi-Fi because
 * it decides what the dog is allowed to do, and it has to go over BLE — the
 * dog may not have a network yet.
 */
export const STEPS: Step[] = ["welcome", "scan", "connect", "enroll", "license", "wifi", "wait", "safety"];

const TITLES: Record<Step, string> = {
  welcome: "歡迎",
  scan: "找狗",
  connect: "藍牙連線",
  enroll: "註冊",
  license: "License",
  wifi: "現場 Wi-Fi",
  wait: "等狗上線",
  safety: "安全須知",
};

export interface Flow {
  dog: DogAdvert | null;
  session: PairSession | null;
  role: Role | null;
  ssid: string;
  psk: string;
  wifiFailures: number;
  wifiError: string | null;
  endpoint: Endpoint | null;
}

export interface StepProps {
  flow: Flow;
  patch: (p: Partial<Flow>) => void;
  go: (s: Step) => void;
}

export function Onboarding() {
  const [step, setStep] = useState<Step>("welcome");
  const [flow, setFlow] = useState<Flow>({
    dog: null,
    session: null,
    role: null,
    ssid: "SyncAI-Office",
    psk: "",
    wifiFailures: 0,
    wifiError: null,
    endpoint: null,
  });
  const patch = (p: Partial<Flow>) => setFlow((f) => ({ ...f, ...p }));
  const props: StepProps = { flow, patch, go: setStep };
  const index = STEPS.indexOf(step);

  // Back is offered only where going back is safe and meaningful.
  const back: Partial<Record<Step, Step>> = { scan: "welcome" };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* The dashboard's auth backdrop (auth-shell.tsx): grid, one glow on the
          column's axis, an accent hairline on top. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-background absolute inset-0" />
        <div className="bg-grid-soft absolute inset-0" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 70% 38% at 50% 18%, rgba(124,111,208,0.16), transparent 70%)" }} />
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-violet-500/40 to-transparent" />
      </div>

      {step !== "welcome" && (
        <header className="relative shrink-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex h-10 items-center">
            {back[step] ? (
              <button onClick={() => setStep(back[step]!)} className="hover:bg-accent -ml-1.5 grid size-10 cursor-pointer place-items-center rounded-lg" aria-label="上一步">
                <ChevronLeft className="size-5" />
              </button>
            ) : (
              <span className="size-10" />
            )}
            <p className="text-muted-foreground flex-1 text-center text-[12px] font-medium tabular-nums">
              {TITLES[step]} · {index + 1} / {STEPS.length}
            </p>
            <span className="size-10" />
          </div>
          <div className="mx-auto mt-1 flex max-w-[260px] gap-1">
            {STEPS.map((s, i) => (
              <span key={s} className={cn("h-1 flex-1 rounded-full transition-colors", i < index ? "bg-primary" : i === index ? "bg-primary-accent" : "bg-muted")} />
            ))}
          </div>
        </header>
      )}
      <div className="scrollbar-none relative min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
        {step === "welcome" && <StepWelcome {...props} />}
        {step === "scan" && <StepScan {...props} />}
        {step === "connect" && <StepConnect {...props} />}
        {step === "enroll" && <StepEnroll {...props} />}
        {step === "license" && <StepLicense {...props} />}
        {step === "wifi" && <StepWifi {...props} />}
        {step === "wait" && <StepWait {...props} />}
        {step === "safety" && <StepSafety {...props} />}
      </div>
    </div>
  );
}
