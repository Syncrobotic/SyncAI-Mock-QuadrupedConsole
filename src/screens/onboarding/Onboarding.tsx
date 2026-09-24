"use client";

import { AnimatePresence, m } from "framer-motion";
import { Smartphone } from "lucide-react";
import { createContext, useEffect, useState } from "react";

import { useLandscape } from "@/hooks/use-landscape";
import { getDogLink } from "@/link";

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
/** How far into its stage each screen is — the current bar fills in part. */
const SUB_OF: Record<Exclude<Step, "splash">, number> = { scan: 0.35, pair: 0.7, license: 0.5, wifi: 0.35, wait: 0.7, safety: 0.5 };

export interface Flow {
  dog: DogAdvert | null;
  session: PairSession | null;
  role: Role | null;
  ssid: string;
  psk: string;
  wifiFailures: number;
  wifiError: string | null;
  endpoint: Endpoint | null;
  /** Is the chosen Wi-Fi the phone's own network? null when typed by hand (unknown). */
  sameNet: boolean | null;
}

/**
 * What every step's Frame needs from the shell: the default top-left action (back), and the
 * state of the BLE link once a dog is paired — lost → the primary shows 重新連接中…, failed
 * (15 s) → 重試. Steps don't handle a dropped link themselves; their BLE calls just wait.
 */
export interface OnboardingCtx {
  /** False outside onboarding (the Console's licence gate reuses the key step): no top bar. */
  hasTopBar: boolean;
  back: (() => void) | null;
  ble: "ok" | "lost" | "failed";
  retryBle: () => void;
}

export const OnboardingContext = createContext<OnboardingCtx>({ hasTopBar: false, back: null, ble: "ok", retryBle: () => {} });

/** Steps that talk to the dog over BLE after pairing — where a dropped link matters. */
const BLE_STEPS: Step[] = ["pair", "license", "wifi", "wait"];

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
    // Unknown until the phone reports its own network (Wi-Fi step, with permission).
    ssid: "",
    psk: "",
    wifiFailures: 0,
    wifiError: null,
    endpoint: null,
    sameNet: null,
  });
  const patch = (p: Partial<Flow>) => setFlow((f) => ({ ...f, ...p }));
  const props: StepProps = { flow, patch, go: setStep };

  // Every step has a top-left action: back (‹) here; the automatic steps (pair, wait) put
  // a cancel (✕) there themselves.
  // Safety has none: the dog is online, there is nothing to go back and change.
  const back: Partial<Record<Step, Step>> = { scan: "splash", license: "scan", wifi: "license" };

  // BLE link watch.
  const [ble, setBle] = useState<OnboardingCtx["ble"]>("ok");
  useEffect(() => getDogLink().ble.link.subscribe((v) => setBle(v === "down" ? "lost" : "ok")), []);
  useEffect(() => {
    if (ble !== "lost" || !flow.dog) return;
    const dogId = flow.dog.id;
    // Try again every 3 s; after 15 s hand it to the guard (重試).
    const retry = setInterval(() => void getDogLink().ble.reconnect(dogId).then((ok) => ok && setBle("ok")), 3000);
    const give = setTimeout(() => setBle((b) => (b === "lost" ? "failed" : b)), 15_000);
    return () => {
      clearInterval(retry);
      clearTimeout(give);
    };
  }, [ble, flow.dog]);

  // Onboarding is portrait only. Ask the OS to lock it (honoured by installed/fullscreen
  // web apps and by the native shell); where it isn't, a sideways phone gets the rotate cover.
  const landscape = useLandscape();
  useEffect(() => {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.("portrait").catch(() => {});
    return () => o?.unlock?.();
  }, []);

  const ctx: OnboardingCtx = {
    hasTopBar: step !== "splash",
    back: back[step] ? () => setStep(back[step]!) : null,
    ble: flow.session && BLE_STEPS.includes(step) ? ble : "ok",
    retryBle: () => setBle("lost"),
  };

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
        // Top bar: [48px slot] [segmented progress] [48px slot]. The side slots belong to the
        // step (back, cancel, skip — see Frame's left/right); the progress never moves.
        <header className="relative box-content flex h-12 shrink-0 items-center gap-2 pt-[var(--safe-top)] pr-[calc(0.75rem+var(--safe-right))] pl-[calc(0.75rem+var(--safe-left))]">
          {/* Equal side slots keep the progress centred; the step's Frame fills them (back / cancel / skip). */}
          <div className="w-12 shrink-0" />
          <div className="min-w-0 flex-1">
            <Stepper phase={PHASE_OF[step]} sub={SUB_OF[step]} />
          </div>
          <div className="w-12 shrink-0" />
        </header>
      )}

      {/* One transition layer only: the step slides in the direction of travel. */}
      <OnboardingContext.Provider value={ctx}>
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
      </OnboardingContext.Provider>

      <AnimatePresence>
        {landscape && (
          <m.div
            key="rotate"
            className="bg-background absolute inset-0 z-[90] flex flex-col items-center justify-center gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* The phone turns upright: the whole message, one icon and one line. */}
            <m.span
              className="text-primary-accent"
              initial={{ rotate: -90 }}
              animate={{ rotate: [-90, 0, 0, -90] }}
              transition={{ duration: 2.4, repeat: Infinity, times: [0, 0.35, 0.75, 1], ease: "easeInOut" }}
            >
              <Smartphone className="size-10" />
            </m.span>
            <p className="text-[15px] font-medium">請轉成直式</p>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
