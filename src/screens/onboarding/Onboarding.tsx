"use client";

import { AnimatePresence, m } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";

import { StepConnect, StepEnroll, StepLicense, StepSafety, StepScan, StepWait, StepWelcome, StepWifi } from "./steps";
import { Stepper } from "./visuals";

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

/**
 * What the guard experiences is four stages, not eight screens: the automatic
 * screens (connect, enroll, wait) belong to the stage they serve.
 */
const PHASE_OF: Record<Step, number> = { welcome: 0, scan: 0, connect: 0, enroll: 0, license: 1, wifi: 2, wait: 2, safety: 3 };

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
  const [step, setStepRaw] = useState<Step>("welcome");
  // Direction of travel, so going back slides the other way.
  const [dir, setDir] = useState(1);
  const setStep = (s: Step) => {
    setDir(STEPS.indexOf(s) >= STEPS.indexOf(step) ? 1 : -1);
    setStepRaw(s);
  };
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
        <header className="relative shrink-0 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-1">
          <div className="flex items-start">
            {back[step] ? (
              <button onClick={() => setStep(back[step]!)} className="hover:bg-accent -ml-1.5 grid size-9 cursor-pointer place-items-center rounded-lg" aria-label="上一步">
                <ChevronLeft className="size-5" />
              </button>
            ) : (
              <span className="size-9" />
            )}
            <div className="flex-1 pt-1">
              <Stepper phase={PHASE_OF[step]} />
            </div>
            <span className="size-9" />
          </div>
        </header>
      )}
      {/* Each step owns its scroll: content scrolls, the action bar does not.
          Steps slide in the direction of travel — enter ease-out, exit ease-in. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <m.div
            key={step}
            custom={dir}
            className="flex min-h-0 flex-1 flex-col"
            variants={{
              enter: (d: number) => ({ opacity: 0, x: d * 28 }),
              center: { opacity: 1, x: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } },
              exit: (d: number) => ({ opacity: 0, x: d * -28, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {step === "welcome" && <StepWelcome {...props} />}
            {step === "scan" && <StepScan {...props} />}
            {step === "connect" && <StepConnect {...props} />}
            {step === "enroll" && <StepEnroll {...props} />}
            {step === "license" && <StepLicense {...props} />}
            {step === "wifi" && <StepWifi {...props} />}
            {step === "wait" && <StepWait {...props} />}
            {step === "safety" && <StepSafety {...props} />}
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
