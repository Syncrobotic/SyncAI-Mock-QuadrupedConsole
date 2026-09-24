"use client";

import { Lock } from "lucide-react";
import { toast } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { EDITION_LABEL } from "@/lib/license";
import { LicenseEntry } from "@/screens/onboarding/steps";
import { useStore } from "@/store";
import { clearLocalPairing, refreshDevice, rpc } from "@/store/controller";

/**
 * A licence is required (product rule): a dog with none runs nothing but the
 * E-Stop. Reachable after onboarding when the dog was factory-reset or its
 * licence revoked on the dog side. The Owner can bind a key here over WS;
 * anyone else is told who can.
 */
export function LicenseGate() {
  const owner = useStore((s) => !!s.session?.scopes.includes("admin"));

  if (!owner)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="bg-muted grid size-12 place-items-center rounded-2xl">
          <Lock className="size-5" />
        </span>
        <p className="text-[16px] font-semibold">這隻狗還沒啟用 License</p>
        <p className="text-muted-foreground text-sm">必須由擁有者輸入 License 金鑰後才能使用。E-Stop 仍然可用。</p>
        <Button variant="outline" className="mt-2" onClick={clearLocalPairing}>
          改配對別隻狗
        </Button>
      </div>
    );

  return (
    <LicenseEntry
      activate={(key) => rpc("license.activate", { key })}
      onActivated={async (l) => {
        await refreshDevice();
        toast.success(`License 已啟用 · ${EDITION_LABEL[l.edition]}`);
      }}
    />
  );
}
