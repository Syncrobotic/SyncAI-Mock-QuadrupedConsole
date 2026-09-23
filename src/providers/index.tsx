"use client";

import { domMax, LazyMotion, MotionConfig } from "framer-motion";
import { ThemeProvider } from "next-themes";

/**
 * Dark by default, like the dashboard — and for a stronger reason here: a
 * guard on a night round is the primary user, and a white screen at 2 a.m.
 * ruins their night vision. Light stays available for daylight.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domMax} strict>
          {children}
        </LazyMotion>
      </MotionConfig>
    </ThemeProvider>
  );
}
