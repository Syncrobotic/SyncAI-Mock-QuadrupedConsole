"use client";

import { useSyncExternalStore } from "react";

import { Modal } from "@/components/kit";
import { getDogLink, mockWorld } from "@/link";
import { useStore } from "@/store";

/**
 * Mock only: draws the stand-in for an OS permission prompt that the mock link raises (e.g.
 * the location permission behind reading the phone's SSID). On a real phone the system
 * draws this; the app adds no text of its own.
 */
export function MockOsPrompt() {
  // Re-read the world when the dev scenario rebuilds the link.
  useStore((s) => s.linkEpoch);
  getDogLink(); // make sure the (mock) link exists before we look for its world
  const world = mockWorld();
  const prompt = useSyncExternalStore(
    (fn) => world?.osPrompt.subscribe(() => fn()) ?? (() => {}),
    () => world?.osPrompt.last ?? null,
    () => null
  );
  return (
    <Modal open={!!prompt} dismissable={false} className="max-w-[280px] p-0 text-center">
      {prompt && (
        <>
          <div className="px-5 pt-5 pb-4">
            <p className="text-[15px] font-semibold">{prompt.title}</p>
            <p className="text-muted-foreground mt-1 text-[13px]">{prompt.body}</p>
          </div>
          <div className="grid grid-cols-2 border-t text-[15px]">
            <button className="text-primary-accent h-11 cursor-pointer border-r" onClick={() => prompt.answer(false)}>
              不允許
            </button>
            <button className="text-primary-accent h-11 cursor-pointer font-semibold" onClick={() => prompt.answer(true)}>
              允許
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
