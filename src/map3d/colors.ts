"use client";

import { useTheme } from "next-themes";
import { useMemo } from "react";

/**
 * The map's palette — read from the dashboard's `--map-*` hex tokens so the
 * two products draw robots, paths and severities in the same colours. Hex,
 * not oklch, for the reason the dashboard gives: three.js parses it directly.
 */
const KEYS = {
  quadruped: "--map-quadruped",
  planned: "--map-path-planned",
  trail: "--map-path-trail",
  camera: "--map-camera",
  selected: "--map-selected",
  critical: "--map-severity-critical",
  warning: "--map-severity-warning",
  line: "--map-unit-line",
  office: "--map-unit-office",
  ground: "--map-ground",
  bg: "--map-bg",
} as const;

export type MapColors = Record<keyof typeof KEYS, string> & { dark: boolean };

function read(dark: boolean): MapColors {
  const style = getComputedStyle(document.documentElement);
  const out = { dark } as MapColors;
  for (const [k, v] of Object.entries(KEYS)) (out as Record<string, unknown>)[k] = style.getPropertyValue(v).trim() || "#888888";
  return out;
}

export function useMapColors(): MapColors {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  // next-themes flips the class before `resolvedTheme` changes, so the tokens
  // read here are already the new theme's.
  return useMemo(() => read(dark), [dark]);
}
