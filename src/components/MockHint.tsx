import { FlaskConical } from "lucide-react";

import { IS_MOCK } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * Review-only hints (demo keys, magic Wi-Fi names). One look everywhere so a
 * reviewer never mistakes them for product copy, and nothing at all when the
 * app runs against a real dog.
 */
export function MockHint({ children, className }: { children: React.ReactNode; className?: string }) {
  if (!IS_MOCK) return null;
  return (
    <div className={cn("flex gap-2 rounded-lg border border-dashed border-violet-400/35 bg-violet-500/5 px-3 py-2 text-[11px] leading-relaxed text-violet-200/80 [.light_&]:text-violet-700", className)}>
      <FlaskConical className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <span className="mr-1 font-semibold tracking-wide">MOCK</span>
        {children}
      </div>
    </div>
  );
}
