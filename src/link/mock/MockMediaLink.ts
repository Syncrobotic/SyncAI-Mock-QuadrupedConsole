import type { MediaChannel, MediaSession } from "../DogLink";
import type { MockWorld } from "./world";

/**
 * Spec §9 Mock: the "dog camera" is the phone's own front camera, the dog's
 * microphone is a local loopback. When there is no camera (desktop without
 * one, or permission denied) a generated test card stands in, so the call tab
 * is always reviewable.
 */
export function createMockMedia(world: MockWorld): MediaChannel {
  return {
    async open({ facing }) {
      let stream: MediaStream | null = null;
      try {
        // A permission prompt nobody answers must not leave the call tab spinning.
        stream = await Promise.race([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing, width: 1280, height: 720 },
            audio: false,
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("camera timeout")), 4000)),
        ]);
      } catch {
        stream = testCard();
      }

      let mic: MediaStream | null = null;
      let ctx: AudioContext | null = null;
      let speaker = true;

      const reconnectLoopback = () => {
        if (!ctx || !mic) return;
        ctx.close();
        ctx = null;
        if (speaker) startLoopback();
      };
      const startLoopback = () => {
        if (!mic) return;
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(mic);
        const gain = ctx.createGain();
        gain.gain.value = 0.8;
        src.connect(gain).connect(ctx.destination);
      };

      const session: MediaSession = {
        stream,
        get resolution() {
          return world.rtt > 250 ? "360p15" : "720p30";
        },
        get latencyMs() {
          return Math.round(180 + world.rtt * 1.6);
        },
        setMic(on) {
          if (on && !mic) {
            navigator.mediaDevices
              .getUserMedia({ audio: { echoCancellation: true } })
              .then((m) => {
                mic = m;
                if (speaker) startLoopback();
              })
              .catch(() => {});
          } else if (!on && mic) {
            mic.getTracks().forEach((t) => t.stop());
            mic = null;
            ctx?.close();
            ctx = null;
          }
        },
        setSpeaker(on) {
          speaker = on;
          reconnectLoopback();
        },
        close() {
          stream?.getTracks().forEach((t) => t.stop());
          mic?.getTracks().forEach((t) => t.stop());
          ctx?.close();
        },
      } as MediaSession;
      return session;
    },
  };
}

/** A moving test card from a canvas, so there is always *something* live on screen. */
function testCard(): MediaStream {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const g = canvas.getContext("2d")!;
  let frame = 0;
  const draw = () => {
    frame++;
    const grd = g.createLinearGradient(0, 0, 640, 360);
    grd.addColorStop(0, "#1b1d2a");
    grd.addColorStop(1, "#2a2350");
    g.fillStyle = grd;
    g.fillRect(0, 0, 640, 360);
    // Corridor perspective lines.
    g.strokeStyle = "rgba(170,160,255,0.35)";
    g.lineWidth = 2;
    for (const [x1, x2] of [
      [0, 260],
      [640, 380],
    ]) {
      g.beginPath();
      g.moveTo(x1, 360);
      g.lineTo(x2, 170);
      g.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const y = 180 + ((i * 40 + frame * 2) % 200);
      const w = (y - 170) * 3.4;
      g.strokeStyle = `rgba(170,160,255,${0.08 + (y - 170) / 900})`;
      g.beginPath();
      g.moveTo(320 - w / 2, y);
      g.lineTo(320 + w / 2, y);
      g.stroke();
    }
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.font = "600 14px ui-monospace, monospace";
    g.fillText("MOCK CAM · 無相機時的測試畫面", 16, 28);
    g.fillText(new Date().toLocaleTimeString("zh-TW", { hour12: false }), 16, 48);
    requestAnimationFrame(draw);
  };
  draw();
  return canvas.captureStream(30);
}
