import { cn } from "@/lib/utils";

import type { CSSProperties } from "react";

// ============================================================
// LocalMind logomark (public/syncai-logo.svg) inlined as SVG paths so it scales
// crisply, needs no network round-trip, and takes its color from `currentColor`.
// The two paths live in a 2000×2000 viewBox. The mark sits on a transparent
// background and is tinted with the brand accent (`text-primary-accent`) — no filled
// tile — so it reads cleanly on any surface and stays cohesive with the "Mind"
// accent in the wordmark.
// ============================================================

const MARK_PATHS = [
  "M528.24,987.79l282.99,185.08c9.74,5.88,20.89,8.99,32.27,8.99h176.68c6.8,0,12.32-5.52,12.32-12.32v-34.76c0-4.02-1.96-7.78-5.25-10.09l-337.22-236.36c-12.28-8.6-19.59-22.65-19.59-37.64v-184.76c0-32.04,25.97-58.01,58.01-58.01h185.26c4.65,0,9.01-2.28,11.66-6.09l.08-.11.08-.11,113.19-152.97c3.09-4.51,3.36-10.11.7-14.94-2.55-4.61-7.55-7.33-12.82-7.33h-223.75s-129.28,0-129.28,0c-46.44,0-91.31,18.03-123.96,51.05-32,32.37-49.62,75.23-49.62,120.79v337.37c0,21.05,10.62,40.69,28.24,52.21Z",
  "M1493.14,1128.92c-16.51-88.53-74.32-143.06-96.05-163.86-44.57-42.65-178.3-120.61-179.12-121.03-5.93-2.99-10.32-8.2-11.86-14.65-1.55-6.45-.11-13.17,3.93-18.44l269.48-363.09c3-4.36,3.36-9.75.96-14.48-2.47-4.87-7.61-7.8-13.07-7.8h-197.74c-4.66,0-9.01,2.28-11.67,6.11l-.11.15-.11.15-299.68,409.79c-1.21,1.76-2.94,4.46-4.74,7.31-4.53,7.2-4.08,16.21,3.71,21.97,58.24,43.1,287.95,206.74,290.86,208.84,43.55,31.38,71.9,82.54,71.86,140.32-.05,95.6-78.6,172.64-174.2,172.64h-64.89s-382.89,0-382.89,0c-12.09,0-21.89-9.8-21.89-21.89v-78.5c0-4.96-2.52-9.49-6.74-12.1l-141.98-87.85c-2.32-1.44-4.83-2.17-7.44-2.17-3.65,0-7.28,1.47-9.97,4.04-1.97,1.88-4.31,5.18-4.31,10.23v243.13c0,19.24,8.67,37.1,23.77,49l81.56,64.27c10.95,8.63,24.67,13.39,38.61,13.39,120.71,0,484.78.03,484.92.03,202-.22,365.68-164.04,365.68-366.08,0-27.16-2.08-53.79-6.86-79.42Z",
];

function SyncaiMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 2000 2000"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {MARK_PATHS.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

// ============================================================
// BrandGlyph — the brand logomark (transparent, brand-tinted)
// ============================================================

type BrandGlyphProps = {
  className?: string;
  style?: CSSProperties;
};

export function BrandGlyph({ className, style }: BrandGlyphProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "text-primary-accent relative inline-flex items-center justify-center",
        className
      )}
      style={style}
    >
      <SyncaiMark className="h-full w-full" />
    </span>
  );
}

// ============================================================
// BrandWordmark — the brand text logotype
// ============================================================

// Canonical text logotype: "Local" in the current text color, "Mind" in the
// brand accent (`--primary`). Callers set size / weight / the "Local" color via
// `className` (it inherits `currentColor`, so the mark adapts to whatever
// surface it sits on), while the "Mind" accent and the split are owned here.
// Pass `animated` for the landing navbar's signature gradient shimmer
// (keyframes: `logo-gradient` in globals.css).

export function BrandWordmark({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <span className={cn("font-bold tracking-tight", className)}>
      Local
      {animated ? (
        <span
          className="bg-size-[300%_100%] bg-clip-text text-transparent"
          style={{
            backgroundImage: "linear-gradient(135deg, #A79BE6, #7C6FD0, #5347A8, #8577D4, #A79BE6)",
            animation: "logo-gradient 4s ease-in-out infinite",
          }}
        >
          Mind
        </span>
      ) : (
        <span className="text-primary-accent">Mind</span>
      )}
    </span>
  );
}

// ============================================================
// BrandLogo — primary brand logo lockup (icon + optional wordmark)
// ============================================================

type BrandLogoProps = {
  className?: string;
  variant?: "icon" | "full";
};

export function BrandLogo({ className, variant = "full" }: BrandLogoProps) {
  if (variant === "icon") {
    return <BrandGlyph className={cn("h-8 w-8", className)} />;
  }

  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="LocalMind">
      <BrandGlyph className="h-9 w-9 shrink-0" />
      <BrandWordmark className="text-foreground text-xl" />
    </span>
  );
}
