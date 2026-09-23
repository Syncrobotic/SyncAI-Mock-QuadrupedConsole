"use client";

import { Camera, Ellipsis, Loader2, Lock, Megaphone, Mic, MicOff, PhoneOff, SwitchCamera, Thermometer, Video as VideoIcon, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Modal, Slider } from "@/components/kit";
import { IS_MOCK } from "@/lib/env";
import { cn } from "@/lib/utils";
import { set, useStore } from "@/store";
import { rpc } from "@/store/controller";

import { useAccess } from "../Console";
import { useNow } from "../Banners";
import { CallPip } from "./CallPip";
import { closeCall, flipCamera, openCall, setMic, setPtt, setSpeaker, useMediaSession } from "./session";
import { ThermalLayer, Video } from "./Video";

let micProbe: "unknown" | "granted" | "denied" = "unknown";

/** §9: the microphone permission is requested on the first call, and only then. */
async function startCall() {
  await openCall();
  if (micProbe !== "unknown") return;
  try {
    const s = await navigator.mediaDevices?.getUserMedia({ audio: true });
    s?.getTracks().forEach((t) => t.stop());
    micProbe = "granted";
  } catch {
    micProbe = "denied";
  }
}

/**
 * The call, inside the teleop tab. It lives on the map panel, not in the sheet — the sheet
 * is the sticks' and must never scroll them away:
 *
 *   no call      → a 「影像」 chip bottom-left (where the video will appear)
 *   map main     → the video as a draggable picture-in-picture; tap it to swap
 *   video main   → the video fills the panel, the map shrinks to a window (tap to swap back)
 *                  and the call controls float along the bottom
 *
 * On any other tab a running call stays as picture-in-picture with its audio (§9).
 */
export function CallLayer({ landscape = false }: { landscape?: boolean }) {
  const tab = useStore((s) => s.tab);
  const active = useStore((s) => s.call.active);
  const videoMain = useStore((s) => s.call.videoMain && s.tab === "teleop");
  const access = useAccess("talk");
  const [starting, setStarting] = useState(false);

  if (!active) {
    if (tab !== "teleop") return null;
    return (
      <button
        onClick={async () => {
          if (access.locked) return void toast(access.reason);
          setStarting(true);
          try {
            await startCall();
          } finally {
            setStarting(false);
          }
        }}
        aria-label={access.locked ? `影像通話：${access.reason}` : "開啟影像通話"}
        className={cn(
          "bg-surface/95 hover:bg-accent absolute z-10 flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium shadow-lg backdrop-blur transition-colors",
          landscape ? "top-[104px] left-3" : "bottom-2 left-2",
          access.locked && "text-muted-foreground"
        )}
      >
        {starting ? <Loader2 className="size-3.5 animate-spin" /> : access.locked ? <Lock className="size-3.5" /> : <VideoIcon className="size-3.5" />}
        影像
      </button>
    );
  }

  if (!videoMain) return <CallPip landscape={landscape} />;
  return <VideoMain landscape={landscape} />;
}

function VideoMain({ landscape }: { landscape: boolean }) {
  const session = useMediaSession();
  const call = useStore((s) => s.call);
  const [more, setMore] = useState(false);
  const [micState, setMicState] = useState(micProbe);
  useNow(1000);
  // The probe resolves right after the call opens; pick it up.
  useEffect(() => {
    const t = setTimeout(() => setMicState(micProbe), 600);
    return () => clearTimeout(t);
  }, []);

  const latency = session?.latencyMs ?? 0;
  const micDisabled = micState === "denied";

  return (
    <>
      <div data-call-video className="absolute inset-0 overflow-hidden bg-black">
        {session ? (
          <Video stream={session.stream} mirror={call.facing === "user"} />
        ) : (
          <div className="grid h-full place-items-center text-white/60">
            <Loader2 className="size-6 animate-spin" />
          </div>
        )}
        {call.thermal && <ThermalLayer opacity={call.thermalOpacity} />}
      </div>

      {/* Stream facts sit just above the controls — the top belongs to the status header. */}
      <div className={cn("pointer-events-none absolute z-10 flex gap-1", landscape ? "bottom-[118px] left-1/2 -translate-x-1/2" : "bottom-[60px] left-2")}>
        {session && <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white">{session.resolution}</span>}
        {session && (
          <span className={cn("rounded px-1.5 py-0.5 font-mono text-[11px]", latency > 800 ? "bg-red-600 text-white" : "bg-black/60 text-white")}>
            {latency > 800 ? "延遲高 · " : ""}
            {latency} ms
          </span>
        )}
        {call.thermal && <span className="rounded bg-orange-600/85 px-1.5 py-0.5 text-[11px] font-semibold text-white">熱像</span>}
        {IS_MOCK && <span className="rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white/85">MOCK · 手機鏡頭</span>}
      </div>

      <div className={cn("absolute z-10 grid grid-cols-5 gap-1.5", // Landscape: above the posture row, between the two sticks.
          landscape ? "bottom-[64px] left-1/2 w-[330px] -translate-x-1/2" : "inset-x-2 bottom-2")}>
        <Ctl label={call.mic ? "麥克風開" : "麥克風"} active={call.mic} disabled={micDisabled || call.ptt} onClick={() => setMic(!call.mic)} icon={call.mic ? <Mic /> : <MicOff />} />
        <button
          disabled={micDisabled || call.mic}
          onPointerDown={() => setPtt(true)}
          onPointerUp={() => setPtt(false)}
          onPointerLeave={() => call.ptt && setPtt(false)}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(ctlClass, "select-none", call.ptt ? "bg-primary border-primary text-white" : "bg-black/55 hover:bg-black/70")}
        >
          <Mic />
          {call.ptt ? "說話中" : "按住說"}
        </button>
        <Ctl label={call.speaker ? "喇叭" : "靜音"} active={call.speaker} onClick={() => setSpeaker(!call.speaker)} icon={call.speaker ? <Volume2 /> : <VolumeX />} />
        <Ctl label="更多" active={more} onClick={() => setMore(true)} icon={<Ellipsis />} />
        <Ctl label="結束" onClick={closeCall} icon={<PhoneOff />} danger />
      </div>

      <MoreSheet open={more} onClose={() => setMore(false)} micDisabled={micDisabled} />
    </>
  );
}

const ctlClass =
  "flex h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border border-white/15 text-[11px] font-medium text-white backdrop-blur transition-colors disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4";

function Ctl({ label, icon, onClick, active, disabled, danger }: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(ctlClass, danger ? "border-red-400/40 bg-red-600/85 hover:bg-red-600" : active ? "bg-primary/80 border-primary" : "bg-black/55 hover:bg-black/70")}
    >
      {icon}
      {label}
    </button>
  );
}

/** What a guard uses less often mid-call: thermal, camera, snapshot, broadcast. */
function MoreSheet({ open, onClose, micDisabled }: { open: boolean; onClose: () => void; micDisabled: boolean }) {
  const call = useStore((s) => s.call);
  const clips = useStore((s) => s.device?.clips);
  const [broadcast, setBroadcast] = useState(false);
  if (!open && broadcast) setBroadcast(false);

  const snapshot = async () => {
    const video = document.querySelector<HTMLVideoElement>("[data-call-video] video");
    if (video && video.videoWidth) {
      const c = document.createElement("canvas");
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext("2d")!.drawImage(video, 0, 0);
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `syncai-snapshot-${Date.now()}.png`;
      a.click();
    }
    const r = await rpc("media.snapshot", undefined);
    if (r) toast.success("快照已存到手機與狗端 artifacts");
  };

  const item = "hover:bg-accent flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left text-[13px] [&_svg]:size-4 [&_svg]:text-muted-foreground";

  return (
    <Modal open={open} onClose={onClose}>
      {!broadcast ? (
        <>
          <p className="mb-2 text-[15px] font-semibold">通話選項</p>
          <div className="space-y-0.5">
            <button className={item} aria-pressed={call.thermal} onClick={() => set((s) => ({ call: { ...s.call, thermal: !s.call.thermal } }))}>
              <Thermometer />
              <span className="flex-1">熱像疊加</span>
              <span className={cn("text-[12px]", call.thermal ? "text-primary-accent font-semibold" : "text-muted-foreground")}>{call.thermal ? "開" : "關"}</span>
            </button>
            {call.thermal && (
              <div className="flex items-center gap-3 px-2 pb-1">
                <span className="text-muted-foreground shrink-0 text-[12px]">透明度</span>
                <Slider label="熱像透明度" min={0} max={100} step={5} value={call.thermalOpacity} onChange={(v) => set((s) => ({ call: { ...s.call, thermalOpacity: v } }))} />
                <span className="w-10 text-right text-[12px] tabular-nums">{call.thermalOpacity}%</span>
              </div>
            )}
            <button className={item} onClick={() => void flipCamera()}>
              <SwitchCamera />
              切換鏡頭
            </button>
            <button
              className={item}
              onClick={() => {
                onClose();
                void snapshot();
              }}
            >
              <Camera />
              快照
            </button>
            <button className={item} onClick={() => setBroadcast(true)}>
              <Megaphone />
              從狗的喇叭廣播
            </button>
          </div>
          {micDisabled && <p className="text-muted-foreground mt-2 text-xs">麥克風權限被拒，影像仍可看。要對現場說話，請到系統設定開啟麥克風權限。</p>}
        </>
      ) : (
        <>
          <p className="mb-3 text-[15px] font-semibold">從狗的喇叭播放</p>
          <div className="space-y-1.5">
            {(clips ?? []).map((c) => (
              <button
                key={c.id}
                onClick={async () => {
                  setBroadcast(false);
                  onClose();
                  const ok = await rpc("media.broadcast", { clipId: c.id });
                  if (ok !== null) toast(`正在播放「${c.name}」`);
                }}
                className="hover:bg-accent flex h-10 w-full cursor-pointer items-center justify-between rounded-lg border px-3 text-left text-[13px]"
              >
                {c.name}
                <span className="text-muted-foreground text-xs tabular-nums">{c.sec}s</span>
              </button>
            ))}
          </div>
          <p className="text-muted-foreground mt-3 text-xs">擁有者可以在裝置頁上傳新的音檔。</p>
        </>
      )}
    </Modal>
  );
}

export function useCallSummary() {
  const active = useStore((s) => s.call.active);
  const mic = useStore((s) => s.call.mic);
  return active ? ` · 通話中 · 麥克風${mic ? "開" : "關"}` : "";
}
