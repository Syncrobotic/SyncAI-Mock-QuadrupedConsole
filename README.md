# SyncAI Quadruped Console — Mock

Mock implementation of the phone console described in `SyncAI Quadruped Console — Client Spec v0.1.md`. The data sources are fake; the state machines and the UI are real. The UI depends only on the `DogLink` interface, so swapping in the real Gateway should not require UI changes.

```bash
pnpm install
pnpm dev          # http://localhost:3200 (on a wide screen it renders in a phone frame, with a review panel on the right)
pnpm test         # vitest: floor/reachability, state machines, RTT bands, permissions, SchemaForm
pnpm build        # static export → out/ (for packaging with Tauri later)
```

Switch scenarios with `?scenario=` (`default` `weak_signal` `low_battery` `estop_remote` `gateway_down` `revoked` `no_license` `viewer` `fault` `perf`), or from the review panel. On a phone, open the device tab and tap "App 版本" five times.

Licence key (required, entered before Wi-Fi; decides which features the dog runs): `SYNC-…` pro (everything), `BASE-…` standard (no AI), `CTRL-…` control only (teleop + map); any `0000` group → already bound, `EXPD-…` → expired. Wi-Fi SSIDs containing `fail` / `none` / `slow` → wrong password / network not found / connects after 25 s.

**Design system:** [`docs/design-system.md`](docs/design-system.md) — layout, safe areas, sizes, onboarding skeleton, motion, colour/contrast and the verification matrix.

## Structure (follows spec §12)

| Path | Contents |
| --- | --- |
| `src/proto/types.ts` | Stand-in for the buf-generated types from `SyncAI-Proto-Quadruped` |
| `src/link/DogLink.ts` | The only interface the UI depends on (plus keystore) |
| `src/link/mock/` | `world.ts` simulated dog, `floor.ts` office floor/point cloud/reachability, `MockDogLink` BLE + Gateway, `MockMediaLink`, `scenarios.ts` |
| `src/store/` | zustand store, `logic.ts` pure rules (connection state machine, RTT hysteresis, tab locks, E-Stop route), `controller.ts` drives the connection state machine |
| `src/map3d/` | react-three-fiber: point cloud (custom shader), 2.5D grid, dog, trail, waypoints, fence, camera frustum |
| `src/screens/onboarding/` | 9-step onboarding (spec's 8 + licence key) |
| `src/screens/console/` | Status bar, E-Stop, three-snap sheet, the four tabs |
| `src/styles/tokens.css` | Copied from the OrchestrationDashboard tokens (should become a shared package) |

## Deliberate deviations from the spec

- **Next.js 16, not 15**: kept in line with the dashboard repo.
- **Mission editor opens at 50%**: §8 puts it at 90%, but at 90% there's almost no map left to long-press for waypoints. Drag up to 90% to edit trigger/policy.
- **Degraded doesn't lock the whole teleop tab**: the tab stays open and the joysticks are greyed out with "訊號不足" (signal too weak), so the operator can watch RTT recover (§7 and §13 interpreted together).
- **Mic/camera permissions aren't requested at onboarding step 1**: §4 asks for them there, but §9 says "request the mic only on first use". Went with §9: the mic is requested when the first call starts; step 1 only requests Bluetooth.
- **No call tab: the call lives inside the teleop tab**, and the third tab is the **event log** (§5 has 操控 / 任務 / 通話 / 裝置). A guard watching the video is almost always driving, so video sits on the map panel: a 「影像」 chip starts it, it runs as a draggable picture-in-picture beside the joysticks, and tapping it swaps video and map (the map becomes the window and the call controls float over the video). The sheet stays the sticks'. The event tab merges the live stream with the dog's last 200 (`diag.events`), filters by AI / mission / safety / system, expands AI detections, and puts a dot on the tab for unseen warnings. Landscape is teleop-only now.
- **No LED pairing code** (§4 step 4): this dog pairs without one.
- **Onboarding adds the licence key (required)**: after enrolment, before Wi-Fi, bound over BLE. The licence decides which features the dog runs (teleop / map / missions / talk / AI); a dog without one runs only the E-Stop. QR scanning removed from the scan step.
- **The map defaults to the floor plan**: drawn like the dashboard (zone plates in `--map-unit-*`, walls). The point cloud is a layer, off by default (§6 says on).
- **Missions are split into templates (what) and rules (when/why)** — see `docs/2026-09-23-mission-triggers-design.md`. Time rules (interval-in-window, jitter, missed-run policy) and event rules (AI / system; confidence, persistence, zones, cooldown), priorities P0–P3 with preemption, auto / confirm / notify modes, a 24 h agenda, and a per-rule decision log. The review panel can inject AI detections.
- **Point cloud is generated from a floor plan**: there is no recorded `.ply` yet (§15). The plan is shaped to support testing: loop corridor (drive the dog one lap), a sealed core (unreachable waypoints), north offices outside the fence (out-of-fence case).

## Not done in v1 (known)

- i18n: strings are hard-coded in zh-TW; next-intl and en are not wired up
- Landscape call / first-person view, drag-to-reorder waypoints (up/down buttons for now), 1 Hz incremental map updates, conflict markers on the mission list (they only appear at save time)
- Haptics use `navigator.vibrate` only (no effect on iOS Safari; to be wired up once in Tauri)
