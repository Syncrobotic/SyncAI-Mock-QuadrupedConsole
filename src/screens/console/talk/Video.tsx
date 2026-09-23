"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** A <video> bound to a MediaStream, plus the §9 mock thermal layer. */
export function Video({ stream, className, mirror }: { stream: MediaStream | null; className?: string; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={cn("h-full w-full object-cover", mirror && "-scale-x-100", className)} />;
}

/**
 * §9 Mock: "熱像用假的偽色噪聲層". Low-res value noise with a slow hot spot,
 * pushed through an ironbow-like ramp, drawn at 12 fps.
 */
export function ThermalLayer({ opacity }: { opacity: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext("2d")!;
    const W = 64;
    const H = 36;
    c.width = W;
    c.height = H;
    const img = g.createImageData(W, H);
    let t = 0;
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 80) return;
      last = now;
      t += 0.08;
      const hx = W * (0.5 + 0.3 * Math.sin(t * 0.7));
      const hy = H * (0.55 + 0.2 * Math.cos(t * 0.5));
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const n = 0.5 + 0.25 * Math.sin(x * 0.35 + t) * Math.cos(y * 0.41 - t * 0.6) + (Math.random() - 0.5) * 0.08;
          const hot = Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / 40);
          const v = Math.min(1, Math.max(0, n * 0.55 + hot * 0.7));
          const i = (y * W + x) * 4;
          img.data[i] = Math.min(255, v * 2.2 * 255);
          img.data[i + 1] = Math.max(0, (v - 0.45) * 2 * 255);
          img.data[i + 2] = Math.max(0, (0.5 - Math.abs(v - 0.3)) * 1.6 * 255);
          img.data[i + 3] = 255;
        }
      g.putImageData(img, 0, 0);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen" style={{ opacity: opacity / 100, imageRendering: "auto" }} />;
}
