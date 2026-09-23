"use client";

import { Mic, MicOff } from "lucide-react";

import { set, useStore } from "@/store";

import { useMediaSession } from "./session";
import { Video } from "./Video";

/**
 * §9: a call left running while another tab is open shrinks to a picture-
 * in-picture at the map's top right. Audio keeps going. Tapping returns to
 * the call. This is the patrol mode — video beside the joysticks.
 */
export function CallPip() {
  const active = useStore((s) => s.call.active);
  const tab = useStore((s) => s.tab);
  const mic = useStore((s) => s.call.mic || s.call.ptt);
  const facing = useStore((s) => s.call.facing);
  const session = useMediaSession();
  if (!active || tab === "talk" || !session) return null;

  return (
    <button
      onClick={() => set({ tab: "talk" })}
      className="absolute top-[68px] right-2 z-20 aspect-video w-36 cursor-pointer overflow-hidden rounded-xl border bg-black shadow-2xl ring-1 ring-white/15"
      aria-label="回到通話"
    >
      <Video stream={session.stream} mirror={facing === "user"} />
      <span className="absolute bottom-1 left-1 grid size-5 place-items-center rounded-full bg-black/60 text-white">
        {mic ? <Mic className="size-3" /> : <MicOff className="size-3" />}
      </span>
    </button>
  );
}
