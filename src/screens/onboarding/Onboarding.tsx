"use client";

import { AnimatePresence, m } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";

import { StepLicense, StepPair, StepSafety, StepScan, StepSplash, StepWait, StepWifi } from "./steps";
import { EASE_OUT, Stepper } from "./visuals";

import type { DogAdvert, Endpoint, PairSession, Role } from "@/proto/types";

/**
 * §4 first-connection onboarding. It opens on a splash — nothing starts until the guard
 * presses 開始配對 — then four stages the guard can see (配對 · 授權 · 網路 · 安全). The
 * automatic screens belong to the stage they serve: BLE connect and enrolment are one
 * 「配對」 screen, Wi-Fi provisioning and the wait are the 「網路」 stage.
 *
 * No LED pairing code (this dog has none); the licence key sits before Wi-Fi because it
 * decides what the dog may do and has to go over BLE — the dog may have no network yet.
 */

export type Step = "splash" | "scan" | "pair" | "license" | "wifi" | "wait" | "safety";

export const STEPS: Step[] = ["splash", "scan", "pair", "license", "wifi", "wait", "safety"];

const PHASE_OF: Record<Exclude<Step, "splash">, number> = { scan: 0, pair: 0, license: 1, wifi: 2, wait: 2, safety: 3 };

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
  const [step, setStepRaw] = useState<Step>("splash");
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
  const back: Partial<Record<Step, Step>> = { scan: "splash" };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* The dashboard's auth backdrop (auth-shell.tsx): grid, one glow on the
          column's axis, an accent hairline on top. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="bg-background absolute inset-0" />
        <div className="bg-grid-soft absolute inset-0" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 40% at 50% 26%, rgba(124,111,208,0.16), transparent 70%)" }} />
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-violet-500/40 to-transparent" />
      </div>

      {step !== "splash" && (
        <header className="relative flex h-12 shrink-0 items-center gap-2 px-3 pt-[env(safe-area-inset-top)]">
          {back[step] ? (
            <button onClick={() => setStep(back[step]!)} className="hover:bg-accent grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg" aria-label="上一步">
              <ChevronLeft className="size-5" />
            </button>
          ) : (
            <span className="size-8 shrink-0" />
          )}
          <div className="min-w-0 flex-1 pr-8">
            <Stepper phase={PHASE_OF[step]} />
          </div>
        </header>
      )}

      {/* One transition layer only: the step slides in the direction of travel. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <m.div
            key={step}
            custom={dir}
            className="flex min-h-0 flex-1 flex-col"
            variants={{
              enter: (d: number) => ({ opacity: 0, x: d * 24 }),
              center: { opacity: 1, x: 0, transition: { duration: 0.24, ease: EASE_OUT } },
              exit: (d: number) => ({ opacity: 0, x: d * -24, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
          >
            {step === "splash" && <StepSplash {...props} />}
            {step === "scan" && <StepScan {...props} />}
            {step === "pair" && <StepPair {...props} />}
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
