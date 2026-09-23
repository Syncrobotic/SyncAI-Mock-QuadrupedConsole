import { describe, expect, it } from "vitest";

import { formatKey, isCompleteKey, maskKey, mockActivate, normaliseKey } from "./license";

describe("licence keys", () => {
  it("normalises pasted keys with any separators and case", () => {
    expect(normaliseKey(" sync pro1_2026–demo ")).toBe("SYNCPRO12026DEMO");
    expect(formatKey("syncpro12026demo")).toBe("SYNC-PRO1-2026-DEMO");
    expect(formatKey("SYNCPR")).toBe("SYNC-PR");
  });

  it("knows when a key is complete", () => {
    expect(isCompleteKey("SYNC-PRO1-2026")).toBe(false);
    expect(isCompleteKey("SYNC-PRO1-2026-DEMO")).toBe(true);
  });

  it("masks the middle groups", () => {
    expect(maskKey("SYNC-PRO1-2026-DEMO")).toBe("SYNC-••••-••••-DEMO");
  });

  it("maps demo keys to editions and failures", () => {
    const now = 0;
    const pro = mockActivate("SYNC-PRO1-2026-DEMO", now);
    expect(pro.ok && pro.license.edition).toBe("pro");
    const basic = mockActivate("BASE-2026-0101-DEMO", now);
    expect(basic.ok && basic.license.features.find((f) => f.feature === "mission")?.granted).toBe(false);
    expect(mockActivate("SYNC-0000-2026-DEMO", now)).toEqual({ ok: false, reason: "bound" });
    expect(mockActivate("EXPD-2020-0101-DEMO", now)).toEqual({ ok: false, reason: "expired" });
    expect(mockActivate("ABCD-EFGH-IJKL-MNOP", now)).toEqual({ ok: false, reason: "invalid" });
    expect(mockActivate("SYNC-12", now)).toEqual({ ok: false, reason: "format" });
  });
});
