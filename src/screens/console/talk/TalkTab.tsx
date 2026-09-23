"use client";

import { Camera, Ellipsis, Loader2, Megaphone, Mic, MicOff, PhoneOff, SwitchCamera, Thermometer, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LockedPanel, Modal, Slider } from "@/components/kit";
import { cn } from "@/lib/utils";
import { set, useStore } from "@/store";
import { rpc } from "@/store/controller";

import { useNow } from "../Banners";
import { useAccess } from "../Console";
import { lockDetail } from "@/store/logic";
import { closeCall, flipCamera, openCall, setMic, setPtt, setSpeaker, useMediaSession } from "./session";
import { ThermalLayer, Video } from "./Video";

let micProbe: "unknown" | "granted" | "denied" = "unknown";

export function TalkTab() {
  const access = useAccess("talk");
  if (access.locked)
    return (
      <div className="p-4">
        <LockedPanel reason={access.reason} detail={lockDetail(access.reason)} />
      </div>
    );
  return <Call />;
}

function Call() {
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

  return (
    <div className="space-y-2 px-3 pt-0.5 pb-4">
      <div data-call-video className={cn("relative overflow-hidden rounded-xl bg-black", snap === 2 ? "aspect-[3/4]" : "aspect-video")}>
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
        <span className="absolute right-2 bottom-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/80">Mock · 手機前鏡頭</span>
      </div>

      {/* One row of what a guard uses mid-call; the rest behind "more". Two
          full rows did not fit a 50% sheet on an SE (266px for 363px). */}
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
            "flex h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-medium select-none disabled:cursor-not-allowed disabled:opacity-40",
            call.ptt ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"
          )}
        >
          <Mic className="size-5" />
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

      {micDisabled && (
        <p className="text-muted-foreground text-xs">
          麥克風權限被拒，影像仍可看。要對現場說話，請到系統設定開啟麥克風權限。
        </p>
      )}

      {call.thermal && (
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground shrink-0 text-[12px]">熱像透明度</span>
          <Slider label="熱像透明度" min={0} max={100} step={5} value={call.thermalOpacity} onChange={(v) => set((s) => ({ call: { ...s.call, thermalOpacity: v } }))} />
          <span className="w-10 text-right text-[12px] tabular-nums">{call.thermalOpacity}%</span>
        </div>
      )}

      <Modal open={broadcastOpen} onClose={() => setBroadcastOpen(false)}>
        <p className="mb-3 text-lg font-semibold">從狗的喇叭播放</p>
        <div className="space-y-1.5">
          {(clips ?? []).map((c) => (
            <button
              key={c.id}
              onClick={async () => {
                setBroadcastOpen(false);
                const ok = await rpc("media.broadcast", { clipId: c.id });
                if (ok !== null) toast(`正在播放「${c.name}」`);
              }}
              className="hover:bg-accent flex h-12 w-full cursor-pointer items-center justify-between rounded-lg border px-3 text-left text-[14px]"
            >
              {c.name}
              <span className="text-muted-foreground text-xs tabular-nums">{c.sec}s</span>
            </button>
          ))}
        </div>
        <p className="text-muted-foreground mt-3 text-xs">Owner 可以在裝置頁上傳新的音檔。</p>
      </Modal>
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
        "flex h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-5",
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

