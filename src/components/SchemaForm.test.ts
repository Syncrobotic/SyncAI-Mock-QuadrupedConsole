import { describe, expect, it } from "vitest";

import { GAS_PLUGIN } from "@/link/mock/fixtures";

import { defaultsFor, isSupported } from "./SchemaForm";

describe("SchemaForm subset (§11)", () => {
  const schema = GAS_PLUGIN.missionActions[0].schema;

  it("accepts the documented subset", () => {
    expect(isSupported({ type: "string", enum: ["a"] })).toBe(true);
    expect(isSupported({ type: "string", format: "time" })).toBe(true);
    expect(isSupported({ type: "integer", minimum: 0, maximum: 5 })).toBe(true);
    expect(isSupported({ type: "boolean" })).toBe(true);
    expect(isSupported({ type: "array", items: { type: "string" } })).toBe(true);
    expect(isSupported({ type: "object", properties: { a: { type: "string" } } })).toBe(true);
  });

  it("rejects what is outside it, so the form degrades instead of crashing", () => {
    expect(isSupported({ type: "array", items: { type: "number" } })).toBe(false);
    expect(isSupported(schema.properties.calibration)).toBe(false);
  });

  it("seeds defaults from the schema", () => {
    expect(defaultsFor(schema)).toEqual({ gas: "CO", duration: 15, alarm_ppm: 35, notify: true });
  });
});
