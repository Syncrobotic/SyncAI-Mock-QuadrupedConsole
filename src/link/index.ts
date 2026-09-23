import { createMockDogLink, type MockDogLink } from "./mock/MockDogLink";
import { scenarioFromUrl, type ScenarioId } from "./mock/scenarios";

import type { DogLink } from "./DogLink";

/**
 * Spec §12 Mock 注入: `NEXT_PUBLIC_LINK=mock` (the default until the real
 * links exist) returns the in-memory implementation.
 */

let current: DogLink | null = null;
let currentScenario: ScenarioId = "default";

export function getDogLink(): DogLink {
  if (!current) {
    currentScenario = scenarioFromUrl();
    current = createMockDogLink(currentScenario);
  }
  return current;
}

/** Dev only: rebuild the whole mock world under another scenario. */
export function switchScenario(id: ScenarioId) {
  (current as MockDogLink | null)?.dispose();
  currentScenario = id;
  current = createMockDogLink(id);
  const url = new URL(window.location.href);
  url.searchParams.set("scenario", id);
  window.history.replaceState(null, "", url);
  return current;
}

export function currentScenarioId() {
  return currentScenario;
}

/** The dev menu's handle on the fake dog. `null` on a real link. */
export function mockWorld() {
  return (current as MockDogLink | null)?.world ?? null;
}

export type { DogLink };
