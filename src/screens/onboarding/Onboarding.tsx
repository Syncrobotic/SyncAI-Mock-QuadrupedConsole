"use client";

import { ChevronLeft } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { StepCode, StepConnect, StepEnroll, StepSafety, StepScan, StepWait, StepWelcome, StepWifi } from "./steps";

import type { DogAdvert, Endpoint, Enrollment, PairSession, Role } from "@/proto/types";

/**
 * §4 first-connection onboarding: eight screens, each with an explicit
 * failure branch and a way back. The only full-screen flow in the app besides
 * a landscape call (§5).
 */

export type Step = "welcome" | "scan" | "connect" | "code" | "enroll" | "wifi" | "wait" | "safety";

export const STEPS: Step[] = ["welcome", "scan", "connect", "code", "enroll", "wifi", "wait", "safety"];

const TITLES: Record<Step, string> = {
  welcome: "歡迎",
  scan: "找狗",
  connect: "藍牙連線",
  code: "確認碼",
  enroll: "註冊",
  wifi: "現場 Wi-Fi",
  wait: "等狗上線",
  safety: "安全須知",
};

export interface Flow {
  dog: DogAdvert | null;
  session: PairSession | null;
  enrollment: Enrollment | null;
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
    enrollment: null,
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
  const back: Partial<Record<Step, Step>> = { scan: "welcome", code: "scan", wifi: undefined };

  return (
    <div className="bg-background flex h-full flex-col">
      {step !== "welcome" && (
        <header className="shrink-0 px-4 pt-3">
          <div className="flex h-10 items-center gap-2">
            {back[step] ? (
              <button onClick={() => setStep(back[step]!)} className="hover:bg-accent -ml-2 grid size-10 cursor-pointer place-items-center rounded-lg" aria-label="上一步">
                <ChevronLeft className="size-5" />
              </button>
            ) : (
              <span className="size-8" />
            )}
            <p className="text-muted-foreground flex-1 text-center text-[12px] font-medium">
              {index + 1} / {STEPS.length} · {TITLES[step]}
            </p>
            <span className="size-8" />
          </div>
          <div className="mt-2 grid grid-cols-8 gap-1">
            {STEPS.map((s, i) => (
              <span key={s} className={cn("h-1 rounded-full transition-colors", i <= index ? "bg-primary" : "bg-muted")} />
            ))}
          </div>
        </header>
      )}
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
        {step === "welcome" && <StepWelcome {...props} />}
        {step === "scan" && <StepScan {...props} />}
        {step === "connect" && <StepConnect {...props} />}
        {step === "code" && <StepCode {...props} />}
        {step === "enroll" && <StepEnroll {...props} />}
        {step === "wifi" && <StepWifi {...props} />}
        {step === "wait" && <StepWait {...props} />}
        {step === "safety" && <StepSafety {...props} />}
      </div>
    </div>
  );
}
