/**
 * `NEXT_PUBLIC_LINK=real` will select the Tauri-backed links (spec §12). Until
 * then everything runs on the mock, and mock-only affordances — demo keys,
 * magic SSIDs — are shown. They must never reach a real build.
 */
export const IS_MOCK = process.env.NEXT_PUBLIC_LINK !== "real";
