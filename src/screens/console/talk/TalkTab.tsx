"use client";

import { Camera, Ellipsis, Loader2, Megaphone, Mic, MicOff, PhoneOff, SwitchCamera, Thermometer, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LockedPanel, Modal, Slider } from "@/components/kit";
import { IS_MOCK } from "@/lib/env";
import { cn } from "@/lib/utils";
import { set, useStore } from "@/store";
import { rpc } from "@/store/controller";

import { useNow } from "../Banners";
import { useAccess } from "../Console";
import { lockDetail } from "@/store/logic";
import { closeCall, flipCamera, openCall, setMic, setPtt, setSpeaker, useMediaSession } from "./session";
import { ThermalLayer, Video } from "./Video";

let micProbe: "unknown" | "granted" | "denied" = "unknown";

export function TalkTab({ landscape = false, videoMain = true, onSwap }: { landscape?: boolean; videoMain?: boolean; onSwap?: () => void }) {
  const access = useAccess("talk");
  if (access.locked)
    return (
      <div className={landscape ? "grid h-full place-items-center p-4" : "p-4"}>
        <div className={landscape ? "w-full max-w-sm" : ""}>
          <LockedPanel reason={access.reason} detail={lockDetail(access.reason)} />
        </div>
      </div>
    );
  return <Call landscape={landscape} videoMain={videoMain} onSwap={onSwap} />;
}

function Call({ landscape, videoMain, onSwap }: { landscape: boolean; videoMain: boolean; onSwap?: () => void }) {
  const session = useMediaSession();
  const call = useStore((s) => s.call);
  const snap = useStore((s) => s.snap);
  const clips = useStore((s) => s.device?.clips);
  const [micState, setMicState] = useState(micProbe);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [more, setMore] = useState(false);
  useNow(1000);

  useEffect(() => {
    void openCall();
    // §9: the microphone permission is requested on first entry, and only then.
    if (micProbe === "unknown")
      navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((s) => {
          s.getTracks().forEach((t) => t.stop());
          micProbe = "granted";
        })
        .catch(() => (micProbe = "denied"))
        .finally(() => setMicState(micProbe));
  }, []);

  const latency = session?.latencyMs ?? 0;
  const micDisabled = micState === "denied";

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

  const videoInner = (
    <>
      {session ? (
        <Video stream={session.stream} mirror={call.facing === "user"} />
      ) : (
        <div className="grid h-full place-items-center text-white/60">
          <Loader2 className="size-6 animate-spin" />
        </div>
      )}
      {call.thermal && <ThermalLayer opacity={call.thermalOpacity} />}
      <div className="absolute top-2 left-2 flex gap-1">
        {session && <span className="rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white">{session.resolution}</span>}
        {session && (
          <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px]", latency > 800 ? "bg-red-600 text-white" : "bg-black/55 text-white")}>
            {latency > 800 ? "延遲高 · " : ""}
            {latency} ms
          </span>
        )}
        {call.thermal && <span className="rounded bg-orange-600/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">熱像</span>}
      </div>
      {IS_MOCK && <span className="absolute right-2 bottom-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/80">MOCK · 手機前鏡頭</span>}
    </>
  );

  // One row of what a guard uses mid-call; the rest behind "more". Two full
  // rows did not fit a 50% sheet on an SE (266px for 363px).
  const controls = (
    <>
      <div className="grid grid-cols-5 gap-1.5">
        <Ctl
          label={call.mic ? "麥克風開" : "麥克風"}
          active={call.mic}
          disabled={micDisabled || call.ptt}
          onClick={() => setMic(!call.mic)}
          icon={call.mic ? <Mic /> : <MicOff />}
        />
        <button
          disabled={micDisabled || call.mic}
          onPointerDown={() => setPtt(true)}
          onPointerUp={() => setPtt(false)}
          onPointerLeave={() => call.ptt && setPtt(false)}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            "flex h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border text-[10px] font-medium select-none disabled:cursor-not-allowed disabled:opacity-40",
            call.ptt ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
          )}
        >
          <Mic className="size-4" />
          {call.ptt ? "說話中" : "按住說"}
        </button>
        <Ctl label={call.speaker ? "喇叭" : "靜音"} active={call.speaker} onClick={() => setSpeaker(!call.speaker)} icon={call.speaker ? <Volume2 /> : <VolumeX />} />
        <Ctl label="更多" active={more} onClick={() => setMore((m) => !m)} icon={<Ellipsis />} />
        <Ctl label="結束" onClick={closeCall} icon={<PhoneOff />} danger />
      </div>
      {more && (
        <div className="grid grid-cols-4 gap-1.5">
          <Ctl label="熱像" active={call.thermal} onClick={() => set((s) => ({ call: { ...s.call, thermal: !s.call.thermal } }))} icon={<Thermometer />} />
          <Ctl label="切換鏡頭" onClick={() => void flipCamera()} icon={<SwitchCamera />} />
          <Ctl label="快照" onClick={() => void snapshot()} icon={<Camera />} />
          <Ctl label="廣播" onClick={() => setBroadcastOpen(true)} icon={<Megaphone />} />
        </div>
      )}
      {call.thermal && (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground shrink-0 text-[12px]">熱像透明度</span>
          <Slider label="熱像透明度" min={0} max={100} step={5} value={call.thermalOpacity} onChange={(v) => set((s) => ({ call: { ...s.call, thermalOpacity: v } }))} />
          <span className="w-10 text-right text-[12px] tabular-nums">{call.thermalOpacity}%</span>
        </div>
      )}
    </>
  );

  const broadcast = (
    <Modal open={broadcastOpen} onClose={() => setBroadcastOpen(false)}>
      <p className="mb-3 text-[16px] font-semibold">從狗的喇叭播放</p>
      <div className="space-y-1.5">
        {(clips ?? []).map((c) => (
          <button
            key={c.id}
            onClick={async () => {
              setBroadcastOpen(false);
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
    </Modal>
  );

  // §9 landscape: the video is the whole screen, controls float at the bottom,
  // and the map shrinks to a corner window — tap either small window to swap.
  if (landscape)
    return (
      <>
        <div
          data-call-video
          onClick={videoMain ? undefined : onSwap}
          className={cn(
            "overflow-hidden bg-black",
            videoMain ? "absolute inset-0" : "absolute right-3 bottom-3 z-20 aspect-video w-52 cursor-pointer rounded-xl border shadow-2xl ring-1 ring-white/15"
          )}
        >
          {videoInner}
        </div>
        <div className="bg-surface/85 absolute bottom-3 left-3 z-10 w-[400px] space-y-1.5 rounded-2xl border p-1.5 backdrop-blur">{controls}</div>
        {broadcast}
      </>
    );

  return (
    <div className="space-y-2 px-3 pt-0.5 pb-4">
      <div data-call-video className={cn("relative overflow-hidden rounded-xl bg-black", snap === 2 ? "aspect-[3/4]" : "aspect-video")}>
        {videoInner}
      </div>
      {controls}
      {micDisabled && (
        <p className="text-muted-foreground text-xs">
          麥克風權限被拒，影像仍可看。要對現場說話，請到系統設定開啟麥克風權限。
        </p>
      )}
      {broadcast}
    </div>
  );
}

function Ctl({ label, icon, onClick, active, disabled, danger }: { label: string; icon: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "flex h-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4",
        danger ? "bg-status-error/10 text-status-error border-status-error/30 hover:bg-status-error/20" : active ? "bg-primary/15 text-primary-accent border-primary/40" : "bg-card hover:bg-accent"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function TalkSummary() {
  const active = useStore((s) => s.call.active);
  const mic = useStore((s) => s.call.mic);
  return <span>{active ? `通話中 · 麥克風${mic ? "開" : "關"}` : "未通話 · 展開即開始看影像"}</span>;
}

