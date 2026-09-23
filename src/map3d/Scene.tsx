"use client";
"use no memo";

/* eslint-disable react-hooks/immutability --
 * three.js is imperative: R3F's idiom is to mutate scene objects inside
 * `useFrame` and event handlers, never through React state (that would be a
 * 60 fps re-render). The compiler cannot reason about that, so this file opts
 * out of it ("use no memo") and of the rules that encode its assumptions.
 */

import { Grid, Html, OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { getDogLink } from "@/link";
import { insidePolygon, snapToFree } from "@/lib/geometry";
import { useStore, set, get } from "@/store";

import { useMapColors, type MapColors } from "./colors";
import { lerpAngle, usePoseRef, type PoseRef } from "./pose";

import type { Waypoint } from "@/proto/types";

/**
 * Map frame → three.js: x → X, y → −Z, z → Y (three is y-up).
 * Every conversion goes through these two so the sign lives in one place.
 */
const toV = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y);

/** Floor-plate thickness: everything that stands on the floor sits on top of it. */
const PLATE = 0.12;
const fromV = (v: THREE.Vector3) => ({ x: v.x, y: -v.z });

type OrbitControlsImpl = React.ComponentRef<typeof OrbitControls>;

export function Scene({ onLongPress }: { onLongPress: (x: number, y: number) => void }) {
  const colors = useMapColors();
  const pose = usePoseRef();
  const view = useStore((s) => s.view);
  const layers = useStore((s) => s.layers);
  const controls = useRef<OrbitControlsImpl>(null);

  return (
    <>
      <color attach="background" args={[colors.ground]} />
      {/* The dashboard's rig (map/lighting.ts): ambient carries the exposure,
          one key light for form, a weak cool fill so shaded faces do not go
          flat black. Less ambient in dark mode — its surfaces are already close
          to the page. */}
      <ambientLight intensity={colors.dark ? 2.9 : 2.6} />
      <directionalLight position={[-8, 18, 10]} intensity={colors.dark ? 1.5 : 1.7} color={colors.dark ? "#dce4ff" : "#fffaf0"} />
      <directionalLight position={[12, 9, -8]} intensity={colors.dark ? 0.5 : 0.7} color={colors.dark ? "#96a5d2" : "#e1e8ff"} />

      <Grid
        position={[0, -0.01, 0]}
        args={[60, 60]}
        cellSize={1}
        cellThickness={0.6}
        sectionSize={5}
        sectionThickness={1}
        cellColor={colors.dark ? "#1c1e29" : "#dde0ea"}
        sectionColor={colors.dark ? "#262938" : "#cdd1de"}
        fadeDistance={70}
        infiniteGrid
      />

      {/* Follow view is for driving: walls go glassy so they stop filling the
          frame, and the point cloud comes on — it is the perception layer. */}
      {layers.plan && <FloorPlanLayer colors={colors} labels={view !== "follow"} ghost={view === "follow"} />}
      {(layers.cloud || view === "follow") && <PointCloud dark={colors.dark} />}
      {layers.grid && <Occupancy colors={colors} />}
      {layers.trail && <Trail pose={pose} color={colors.trail} />}
      {layers.fence && <Fences pose={pose} colors={colors} />}
      <Route colors={colors} controls={controls} />
      <Robot pose={pose} colors={colors} />
      <CameraFrustum pose={pose} color={colors.camera} />
      <Measure pose={pose} colors={colors} />
      <Ground onLongPress={onLongPress} />
      <CameraRig pose={pose} controls={controls} />
    </>
  );
}

// ── Point cloud ──────────────────────────────────────────────────────────────

function PointCloud({ dark }: { dark: boolean }) {
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const source = useRef<Float32Array | null>(null);

  useEffect(() => {
    return getDogLink().gateway.map.subscribe((chunk) => {
      if (source.current !== chunk.positions) {
        source.current = chunk.positions;
        const n = chunk.positions.length / 3;
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          pos[i * 3] = chunk.positions[i * 3];
          pos[i * 3 + 1] = chunk.positions[i * 3 + 2];
          pos[i * 3 + 2] = -chunk.positions[i * 3 + 1];
        }
        geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geom.setAttribute("color", new THREE.BufferAttribute(chunk.colors, 3));
        geom.computeBoundingSphere();
      }
      // §6 progressive: the buffer is complete, the draw range grows.
      geom.setDrawRange(0, chunk.loaded);
    });
  }, [geom]);

  useEffect(() => () => geom.dispose(), [geom]);

  // §6: gl.POINTS with distance attenuation, no per-point lighting. Size is
  // clamped — unclamped attenuation turns the points next to a follow camera
  // into screen-sized squares.
  const { size, viewport } = useThree();
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uSize: { value: 0.05 },
          uScale: { value: 400 },
          uTint: { value: new THREE.Color() },
          uOpacity: { value: 0.9 },
        },
        vertexShader: `
          uniform float uSize;
          uniform float uScale;
          varying vec3 vColor;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(uSize * uScale / -mv.z, 1.0, 3.5);
          }`,
        fragmentShader: `
          uniform vec3 uTint;
          uniform float uOpacity;
          varying vec3 vColor;
          void main() {
            gl_FragColor = vec4(vColor * uTint, uOpacity);
          }`,
      }),
    []
  );
  material.uniforms.uScale.value = (size.height * viewport.dpr) / 2;
  material.uniforms.uTint.value.set(dark ? "#ffffff" : "#5a5e78");
  material.uniforms.uOpacity.value = dark ? 0.9 : 1;
  useEffect(() => () => material.dispose(), [material]);

  return <points geometry={geom} material={material} frustumCulled={false} />;
}

// ── Floor plan (the dashboard's unit layer, in three.js) ────────────────────


/**
 * Same construction as the dashboard's `units.ts`: a thin plate per zone in
 * the zone's `--map-unit-*` colour, and walls standing on it in the unit-line
 * colour darkened to 62%. Plates, not blocks — extruded rooms read as roofs
 * and hide every robot inside them.
 */
function FloorPlanLayer({ colors, labels, ghost }: { colors: MapColors; labels: boolean; ghost: boolean }) {
  const plan = useStore((s) => s.plan);
  const wallColor = useMemo(() => {
    const c = new THREE.Color(colors.line);
    return c.multiply(new THREE.Color(0.62, 0.62, 0.66));
  }, [colors.line]);
  const furnitureColor = useMemo(() => new THREE.Color(colors.line).multiplyScalar(colors.dark ? 0.45 : 0.8), [colors.line, colors.dark]);

  if (!plan) return null;
  const zoneColor = {
    office: colors.unitOffice,
    corridor: colors.unitCorridor,
    lobby: colors.unitLobby,
    restricted: colors.unitRestricted,
    public: colors.unitPublic,
    utility: colors.unitUtility,
  } as const;

  return (
    <group>
      {plan.zones.map((z) => {
        const w = z.rect.x2 - z.rect.x1;
        const d = z.rect.y2 - z.rect.y1;
        const cx = (z.rect.x1 + z.rect.x2) / 2;
        const cy = (z.rect.y1 + z.rect.y2) / 2;
        return (
          <group key={z.id}>
            <mesh position={[cx, PLATE / 2, -cy]}>
              <boxGeometry args={[w - 0.04, PLATE, d - 0.04]} />
              <meshLambertMaterial color={zoneColor[z.type]} />
            </mesh>
            {labels && (
              <Html position={[cx, PLATE + 0.5, -cy]} center zIndexRange={[4, 0]} style={{ pointerEvents: "none" }}>
                <span
                  className="text-[10px] font-medium whitespace-nowrap"
                  style={{ color: colors.poi, textShadow: `0 0 3px ${colors.ground}, 0 0 3px ${colors.ground}` }}
                >
                  {z.name}
                </span>
              </Html>
            )}
          </group>
        );
      })}
      {plan.walls.map((b, i) => (
        <mesh key={`w${i}`} position={[(b.x1 + b.x2) / 2, PLATE + b.h / 2, -(b.y1 + b.y2) / 2]}>
          <boxGeometry args={[b.x2 - b.x1, b.h, b.y2 - b.y1]} />
          <meshLambertMaterial color={wallColor} transparent={ghost} opacity={ghost ? 0.22 : 1} depthWrite={!ghost} />
        </mesh>
      ))}
      {plan.furniture.map((b, i) => (
        <mesh key={`f${i}`} position={[(b.x1 + b.x2) / 2, PLATE + b.h / 2, -(b.y1 + b.y2) / 2]}>
          <boxGeometry args={[b.x2 - b.x1, b.h, b.y2 - b.y1]} />
          <meshLambertMaterial color={furnitureColor} />
        </mesh>
      ))}
    </group>
  );
}

// ── 2.5D occupancy ───────────────────────────────────────────────────────────

function Occupancy({ colors }: { colors: MapColors }) {
  const grid = useStore((s) => s.occupancy);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const cells = useMemo(() => {
    if (!grid) return [];
    const out: [number, number][] = [];
    for (let cy = 0; cy < grid.height; cy++)
      for (let cx = 0; cx < grid.width; cx++)
        if (grid.cells[cy * grid.width + cx]) out.push([grid.originX + (cx + 0.5) * grid.res, grid.originY + (cy + 0.5) * grid.res]);
    return out;
  }, [grid]);

  useEffect(() => {
    if (!mesh.current || !grid) return;
    const m = new THREE.Matrix4();
    cells.forEach(([x, y], i) => {
      m.makeScale(grid.res, 0.5, grid.res);
      m.setPosition(x, 0.25, -y);
      mesh.current!.setMatrixAt(i, m);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  }, [cells, grid]);

  if (!grid) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, cells.length]} key={cells.length}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={colors.dark ? "#4a4f6e" : "#9aa1bb"} />
    </instancedMesh>
  );
}

// ── Robot ────────────────────────────────────────────────────────────────────

function Robot({ pose, colors }: { pose: React.RefObject<PoseRef>; colors: MapColors }) {
  const group = useRef<THREE.Group>(null);
  const legs = useRef<THREE.Mesh[]>([]);
  const body = useRef<THREE.MeshStandardMaterial>(null);
  const phase = useRef(0);
  const estop = useStore((s) => s.telemetry?.mode === "ESTOP" || s.telemetry?.mode === "FAULT");
  const lying = useStore((s) => s.telemetry?.posture === "lie" || s.telemetry?.posture === "sit");

  useFrame((_, dt) => {
    const p = pose.current;
    if (!group.current || !p.has) return;
    const k = Math.min(1, dt * 12);
    p.display = {
      x: p.display.x + (p.target.x - p.display.x) * k,
      y: p.display.y + (p.target.y - p.display.y) * k,
      yaw: lerpAngle(p.display.yaw, p.target.yaw, k),
    };
    group.current.position.set(p.display.x, PLATE, -p.display.y);
    group.current.rotation.y = p.display.yaw;
    phase.current += dt * (4 + p.speed * 10);
    const swing = Math.min(0.5, p.speed * 0.8);
    legs.current.forEach((leg, i) => {
      if (leg) leg.rotation.z = Math.sin(phase.current + (i % 2 === (i < 2 ? 0 : 1) ? 0 : Math.PI)) * swing;
    });
  });

  const color = estop ? colors.critical : colors.quadruped;
  const bodyY = lying ? 0.18 : 0.42;

  return (
    <group ref={group}>
      {/* Heading is +X in the dog's local frame (yaw 0 = map +x). */}
      <mesh position={[0, bodyY, 0]}>
        <boxGeometry args={[0.7, 0.2, 0.32]} />
        <meshStandardMaterial ref={body} color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0.42, bodyY + 0.06, 0]}>
        <boxGeometry args={[0.16, 0.14, 0.2]} />
        <meshStandardMaterial color={colors.dark ? "#e8e9f2" : "#2a2d3e"} />
      </mesh>
      {!lying &&
        [
          [0.26, 0.13],
          [0.26, -0.13],
          [-0.26, 0.13],
          [-0.26, -0.13],
        ].map(([x, z], i) => (
          <mesh
            key={i}
            ref={(m) => {
              if (m) legs.current[i] = m;
            }}
            position={[x, 0.18, z]}
          >
            <boxGeometry args={[0.06, 0.36, 0.06]} />
            <meshStandardMaterial color={colors.dark ? "#9aa0bd" : "#4b4f66"} />
          </mesh>
        ))}
      {/* Ground ring: the dog is findable at any zoom. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.5, 0.62, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[0.8, 0.02, 0]}>
        <circleGeometry args={[0.16, 3]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

// ── Trail (last 60 s) ────────────────────────────────────────────────────────

function Trail({ pose, color }: { pose: React.RefObject<PoseRef>; color: string }) {
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(400 * 3), 3));
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  }, [color]);

  useFrame(() => {
    const trail = pose.current.trail;
    const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const n = Math.min(trail.length, 400);
    const start = trail.length - n;
    for (let i = 0; i < n; i++) attr.setXYZ(i, trail[start + i].x, PLATE + 0.05, -trail[start + i].y);
    attr.needsUpdate = true;
    line.geometry.setDrawRange(0, n);
  });

  return <primitive object={line} />;
}

// ── Fences ──────────────────────────────────────────────────────────────────

function Fences({ pose, colors }: { pose: React.RefObject<PoseRef>; colors: MapColors }) {
  const fences = useStore((s) => s.fences);
  const objects = useMemo(
    () =>
      fences.map((f) => {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([...f.points, f.points[0]].map((p) => toV(p.x, p.y, PLATE + 0.04))),
          new THREE.LineBasicMaterial({ color: colors.warning })
        );
        const fill = new THREE.Mesh(
          new THREE.ShapeGeometry(new THREE.Shape(f.points.map((p) => new THREE.Vector2(p.x, p.y)))),
          new THREE.MeshBasicMaterial({ color: colors.warning, transparent: true, opacity: 0.05, depthWrite: false })
        );
        fill.rotation.x = -Math.PI / 2;
        fill.position.y = PLATE + 0.015;
        return { fence: f, line, fill };
      }),
    [fences, colors.warning]
  );

  // §6: the whole fence turns red while the dog is outside it.
  useFrame(() => {
    const p = pose.current.display;
    for (const o of objects) {
      const out = pose.current.has && !insidePolygon(o.fence.points, p.x, p.y);
      const c = out ? colors.critical : colors.warning;
      (o.line.material as THREE.LineBasicMaterial).color.set(c);
      (o.fill.material as THREE.MeshBasicMaterial).color.set(c);
      (o.fill.material as THREE.MeshBasicMaterial).opacity = out ? 0.12 : 0.05;
    }
  });

  return (
    <>
      {objects.map((o) => (
        <group key={o.fence.id}>
          <primitive object={o.line} />
          <primitive object={o.fill} />
        </group>
      ))}
    </>
  );
}

// ── Route & waypoints ───────────────────────────────────────────────────────

function Route({ colors, controls }: { colors: MapColors; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const editor = useStore((s) => s.editor);
  const tab = useStore((s) => s.tab);
  const run = useStore((s) => s.telemetry?.run ?? null);
  const missions = useStore((s) => s.missions);
  const detailId = useStore((s) => s.detailMissionId);

  // Precedence: the draft being edited, then the running mission, then the one
  // whose detail is open. Waypoints show while the mission tab is open (§6).
  const mission = editor?.draft ?? missions.find((m) => m.id === run?.missionId) ?? missions.find((m) => m.id === detailId);
  if (!mission || (tab !== "mission" && !run)) return null;

  const route = mission.route;
  const errorIds = new Set(editor?.issues.filter((i) => i.level === "error").map((i) => i.waypointId) ?? []);
  const live = run && run.missionId === mission.id && !editor;
  const done = new Set(live ? run.completedWp : []);

  return (
    <group>
      {route.length > 1 && <RouteLine route={route} color={colors.planned} currentWp={live ? run.currentWp : -1} />}
      {route.map((wp, i) => (
        <WaypointMarker
          key={wp.id}
          wp={wp}
          index={i}
          colors={colors}
          state={errorIds.has(wp.id) ? "error" : live && i === run.currentWp ? "current" : done.has(i) ? "done" : editor?.selectedWp === wp.id ? "selected" : "idle"}
          editable={!!editor}
          controls={controls}
          snapshot={live ? run.snapshots.find((s) => s.wp === i) : undefined}
        />
      ))}
    </group>
  );
}

function RouteLine({ route, color, currentWp }: { route: Waypoint[]; color: string; currentWp: number }) {
  const lines = useMemo(() => {
    const all = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(route.map((w) => toV(w.x, w.y, PLATE + 0.08))),
      new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.25, transparent: true, opacity: currentWp > 0 ? 0.35 : 0.9 })
    );
    all.computeLineDistances();
    // Running: the remaining route is solid, what is behind stays dashed (§8 執行中視圖).
    const remaining =
      currentWp > 0
        ? new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(route.slice(currentWp - 1).map((w) => toV(w.x, w.y, PLATE + 0.1))),
            new THREE.LineBasicMaterial({ color })
          )
        : null;
    return { all, remaining };
  }, [route, color, currentWp]);

  return (
    <>
      <primitive object={lines.all} />
      {lines.remaining && <primitive object={lines.remaining} />}
    </>
  );
}

function WaypointMarker({
  wp,
  index,
  colors,
  state,
  editable,
  controls,
  snapshot,
}: {
  wp: Waypoint;
  index: number;
  colors: MapColors;
  state: "idle" | "selected" | "current" | "done" | "error";
  editable: boolean;
  controls: React.RefObject<OrbitControlsImpl | null>;
  snapshot?: { wp: number; at: number };
}) {
  const dragging = useRef(false);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const color =
    state === "error" ? colors.critical : state === "current" ? colors.selected : state === "done" ? colors.quadruped : state === "selected" ? colors.selected : colors.planned;

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    set((s) => (s.editor ? { editor: { ...s.editor, selectedWp: wp.id } } : {}));
    if (!editable) return;
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (controls.current) controls.current.enabled = false;
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const hit = new THREE.Vector3();
    if (!e.ray.intersectPlane(plane, hit)) return;
    const { x, y } = fromV(hit);
    moveWaypoint(wp.id, x, y, false);
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    if (controls.current) controls.current.enabled = true;
    const cur = get().editor?.draft.route.find((w) => w.id === wp.id);
    if (cur) moveWaypoint(wp.id, cur.x, cur.y, true);
  };

  return (
    <group position={toV(wp.x, wp.y, PLATE)}>
      <mesh position={[0, 0.25, 0]} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <cylinderGeometry args={[0.28, 0.28, 0.5, 20]} />
        <meshStandardMaterial color={color} transparent opacity={0.85} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[Math.max(0.3, wp.toleranceM), Math.max(0.3, wp.toleranceM) + 0.06, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
      <Html position={[0, 0.8, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <span
          className="grid size-5 place-items-center rounded-full text-[10px] font-bold text-white tabular-nums shadow"
          style={{ background: color }}
        >
          {state === "done" ? "✓" : index + 1}
        </span>
      </Html>
      {snapshot && (
        <Html position={[0.7, 0.9, 0]} center zIndexRange={[5, 0]}>
          <button
            onClick={() => set({ snapshotViewer: snapshot })}
            className="block h-7 w-10 cursor-pointer overflow-hidden rounded border border-white/60 shadow-lg"
            style={{ background: "linear-gradient(135deg,#2a2350,#1b1d2a)" }}
            aria-label={`航點 ${index + 1} 快照`}
          />
        </Html>
      )}
    </group>
  );
}

function moveWaypoint(id: string, x: number, y: number, snap: boolean) {
  const s = get();
  if (!s.editor) return;
  const p = snap && s.occupancy ? snapToFree(s.occupancy, x, y) : { x, y };
  set({
    editor: {
      ...s.editor,
      draft: { ...s.editor.draft, route: s.editor.draft.route.map((w) => (w.id === id ? { ...w, x: p.x, y: p.y } : w)) },
    },
  });
}

// ── Camera frustum (call tab) ───────────────────────────────────────────────

function CameraFrustum({ pose, color }: { pose: React.RefObject<PoseRef>; color: string }) {
  const active = useStore((s) => s.call.active || s.tab === "talk");
  const group = useRef<THREE.Group>(null);
  const geom = useMemo(() => {
    // A 70° × 40° pyramid, 3.5 m deep, from the head.
    const d = 3.5;
    const w = Math.tan((35 * Math.PI) / 180) * d;
    const h = Math.tan((20 * Math.PI) / 180) * d;
    const o = new THREE.Vector3(0, 0, 0);
    const c = [new THREE.Vector3(d, h, w), new THREE.Vector3(d, h, -w), new THREE.Vector3(d, -h, -w), new THREE.Vector3(d, -h, w)];
    return new THREE.BufferGeometry().setFromPoints([o, c[0], o, c[1], o, c[2], o, c[3], c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]]);
  }, []);
  useFrame(() => {
    if (!group.current) return;
    const p = pose.current.display;
    group.current.position.set(p.x, PLATE + 0.5, -p.y);
    group.current.rotation.y = p.yaw;
  });
  if (!active) return null;
  return (
    <group ref={group}>
      <lineSegments geometry={geom} position={[0.45, 0, 0]}>
        <lineBasicMaterial color={color} transparent opacity={0.8} />
      </lineSegments>
    </group>
  );
}

// ── Measure (tap anywhere → straight-line distance, §6) ─────────────────────

function Measure({ pose, colors }: { pose: React.RefObject<PoseRef>; colors: MapColors }) {
  const measure = useStore((s) => s.measure);
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    return new THREE.Line(g, new THREE.LineDashedMaterial({ color: colors.selected, dashSize: 0.25, gapSize: 0.15 }));
  }, [colors.selected]);
  const label = useRef<HTMLSpanElement>(null);

  useFrame(() => {
    if (!measure) return;
    const p = pose.current.display;
    line.geometry.setFromPoints([toV(p.x, p.y, PLATE + 0.12), toV(measure.x, measure.y, PLATE + 0.12)]);
    line.computeLineDistances();
    if (label.current) label.current.textContent = `${Math.hypot(measure.x - p.x, measure.y - p.y).toFixed(1)} m`;
  });

  if (!measure) return null;
  return (
    <>
      <primitive object={line} />
      <mesh position={toV(measure.x, measure.y, PLATE + 0.05)} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.18, 24]} />
        <meshBasicMaterial color={colors.selected} />
      </mesh>
      <Html position={toV(measure.x, measure.y, 0.6)} center zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
        <span ref={label} className="bg-popover text-popover-foreground rounded-md border px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums shadow" />
      </Html>
    </>
  );
}

// ── Ground: tap = measure, long-press = waypoint ────────────────────────────

function Ground({ onLongPress }: { onLongPress: (x: number, y: number) => void }) {
  const press = useRef<{ x: number; y: number; sx: number; sy: number; timer: ReturnType<typeof setTimeout> | null; fired: boolean } | null>(null);

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    const { x, y } = fromV(e.point);
    const p = { x, y, sx: e.clientX, sy: e.clientY, timer: null as ReturnType<typeof setTimeout> | null, fired: false };
    // §6: 長按空地 0.5 秒 → 放航點.
    p.timer = setTimeout(() => {
      p.fired = true;
      navigator.vibrate?.(20);
      onLongPress(p.x, p.y);
    }, 500);
    press.current = p;
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 8 && p.timer) {
      clearTimeout(p.timer);
      press.current = null;
    }
  };
  const onUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    if (!p.fired) set((s) => ({ measure: s.measure && Math.hypot(s.measure.x - p.x, s.measure.y - p.y) < 0.5 ? null : { x: p.x, y: p.y } }));
  };

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => press.current?.timer && clearTimeout(press.current.timer)}>
      <planeGeometry args={[80, 60]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

// ── Camera rigs (§6 視角) ────────────────────────────────────────────────────

function CameraRig({ pose, controls }: { pose: React.RefObject<PoseRef>; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const view = useStore((s) => s.view);
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());
  const desired = useRef(new THREE.Vector3());

  useEffect(() => {
    if (view === "free") {
      camera.position.set(pose.current.display.x - 8, 14, -pose.current.display.y + 12);
      controls.current?.target.set(pose.current.display.x, 0, -pose.current.display.y);
    }
    if (view === "top") {
      // The dashboard's isometric framing: the whole floor, pitched ~50°, turned a little.
      camera.position.set(11, 35, 29);
      controls.current?.target.set(0, 0, -1);
    }
    controls.current?.update();
  }, [view, camera, controls, pose]);

  useFrame((_, dt) => {
    if (view !== "follow") return;
    const p = pose.current.display;
    // §6 跟隨: behind and above the dog. Higher than the spec's 3 m-back/eye
    // level so the camera clears 2.6 m walls instead of staring into one.
    desired.current.set(p.x - Math.cos(p.yaw) * 2.6, 3.6, -p.y + Math.sin(p.yaw) * 2.6);
    target.current.set(p.x + Math.cos(p.yaw) * 2.6, 0, -p.y - Math.sin(p.yaw) * 2.6);
    camera.position.lerp(desired.current, Math.min(1, dt * 4));
    camera.lookAt(target.current);
  });

  return (
    <OrbitControls
      ref={controls}
      enabled={view !== "follow"}
      enableRotate={view === "free"}
      enableDamping
      maxPolarAngle={Math.PI / 2.1}
      minDistance={3}
      maxDistance={60}
      makeDefault
    />
  );
}
