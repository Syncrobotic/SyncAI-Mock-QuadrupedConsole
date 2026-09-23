"use client";

import { useSyncExternalStore } from "react";

import { getDogLink } from "@/link";
import { get, set, useStore } from "@/store";

import type { MediaSession } from "@/link/DogLink";

/**
 * The one media session. It lives inside the teleop tab's map panel and outlives it on
 * purpose — §9: switching tabs mid-call keeps the video as picture-in-picture and the audio.
 */

let session: MediaSession | null = null;
let opening: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function useMediaSession() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => session,
    () => null
  );
}

export async function openCall() {
  if (session || opening) return opening ?? undefined;
  opening = (async () => {
    session = await getDogLink().media.open({ facing: get().call.facing });
    session.setSpeaker(get().call.speaker);
    set((s) => ({ call: { ...s.call, active: true } }));
    notify();
  })();
  try {
    await opening;
  } finally {
    opening = null;
  }
}

export function closeCall() {
  session?.close();
  session = null;
  set((s) => ({ call: { ...s.call, active: false, mic: false, ptt: false, videoMain: false } }));
  notify();
}

export async function flipCamera() {
  const facing = get().call.facing === "user" ? "environment" : "user";
  set((s) => ({ call: { ...s.call, facing } }));
  if (session) {
    const mic = get().call.mic;
    session.close();
    session = null;
    notify();
    await openCall();
    if (mic) session!.setMic(true);
  }
}

export function setMic(on: boolean) {
  session?.setMic(on);
  set((s) => ({ call: { ...s.call, mic: on } }));
}

export function setPtt(on: boolean) {
  session?.setMic(on);
  set((s) => ({ call: { ...s.call, ptt: on } }));
}

export function setSpeaker(on: boolean) {
  session?.setSpeaker(on);
  set((s) => ({ call: { ...s.call, speaker: on } }));
}

// The controller ends calls by flipping `call.active` (revoke, backgrounding);
// follow it so the camera is actually released.
let wasActive = false;
useStore.subscribe((s) => {
  if (wasActive && !s.call.active && session) {
    session.close();
    session = null;
    notify();
  }
  wasActive = s.call.active;
});
