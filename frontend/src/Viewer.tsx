// three.js viewer: wireframe members, nodes as points, 3D orbit or orthographic plan / elevations.
// Model coordinates are used as-is (Z up, length units from meta).
import { useEffect, useId, useMemo, useRef, type ComponentRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { Bounds, Html, Line, OrbitControls, OrthographicCamera, PerspectiveCamera, useBounds } from '@react-three/drei';
import type { Result, Vec3 } from './vantageTypes';
import { type ColorBy, type DrawStyle, type ViewMode, isVisible, memberStyles, memberToChange, moves } from './data';

export type CameraMode = '3d' | 'plan' | 'N' | 'S' | 'E' | 'W';

export const COLORS: Record<DrawStyle, string> = {
  context: '#9ca3af',          // gray: unchanged
  added: '#16a34a',            // green: added geometry
  revised_position: '#16a34a', // green: new position of a moved member
  removed: '#dc2626',          // red dashed: removed geometry
  previous: '#dc2626',         // red dashed: old position of a moved member
  property: '#7c3aed',         // violet: section or material assignment changed
};

// Direction from the model centre to the camera for each view.
const VIEW_DIR: Record<CameraMode, Vec3> = {
  '3d': [1, -1.4, 0.9], plan: [0, 0, 1], N: [0, 1, 0], S: [0, -1, 0], E: [1, 0, 0], W: [-1, 0, 0],
};

/**
 * Camera shared by the two split panes. The pane the user last grabbed is the driver: it writes its
 * camera here and the other pane copies it each frame. A fit (zoom, reset, new view) clears the driver
 * so each pane frames its own model until the user orbits again.
 */
export interface CameraSync {
  driver: string | null;
  version: number;
  position: Vec3;
  target: Vec3;
  zoom: number;
}

export interface ViewerProps {
  result: Result;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewMode: ViewMode;
  cameraMode: CameraMode;
  colorBy: ColorBy;
  storyFilter: string | null;
  zoomTick: number;   // bump to zoom to the selected change
  resetTick: number;  // bump to fit the whole model
  sync?: CameraSync | null; // split view: link this pane's camera to the other pane
  legend?: boolean;
}

export default function Viewer(props: ViewerProps) {
  return (
    <div className="relative h-full w-full">
      {/* Clicking empty space clears the selection. */}
      <Canvas onPointerMissed={() => props.onSelect(null)} style={{ background: '#f8fafc' }}>
        {/* Remount per camera mode so each view starts from its own direction, then fits. */}
        <Scene key={props.cameraMode} {...props} />
      </Canvas>
      {props.legend !== false && <Legend units={props.result.meta.units.length} colorBy={props.colorBy} />}
    </div>
  );
}

function Scene({ result, selectedId, onSelect, viewMode, cameraMode, colorBy, storyFilter, zoomTick, resetTick, sync }: ViewerProps) {
  const xyz = useMemo(() => new Map(result.nodes.map((n) => [n.id, n.xyz])), [result]);
  const styles = useMemo(() => memberStyles(result, colorBy), [result, colorBy]);
  const changeOf = useMemo(() => memberToChange(result), [result]);
  const selected = result.changes.find((c) => c.id === selectedId);
  const selectedMembers = new Set(selected?.member_ids ?? []);

  // Model extents, used to place the camera and labels.
  const { center, size, min } = useMemo(() => {
    const box = new THREE.Box3();
    result.nodes.forEach((n) => box.expandByPoint(new THREE.Vector3(...n.xyz)));
    return { center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()).length(), min: box.min };
  }, [result]);

  // Box around the selected change's members, padded so a single beam is not filling the screen.
  const selectedBox = useMemo(() => {
    if (!selected) return null;
    const box = new THREE.Box3();
    for (const id of selected.member_ids) {
      const m = result.members.find((x) => x.id === id);
      m?.end_nodes.forEach((n) => box.expandByPoint(new THREE.Vector3(...xyz.get(n)!)));
    }
    return box.isEmpty() ? null : box.expandByScalar(size * 0.08);
  }, [selected, result, xyz, size]);

  const camPos = center.clone().add(new THREE.Vector3(...VIEW_DIR[cameraMode]).normalize().multiplyScalar(size * 2));
  const up: Vec3 = cameraMode === 'plan' ? [0, 1, 0] : [0, 0, 1];

  const visibleNodes = result.nodes.filter((n) => isVisible(n.side, viewMode));
  const nodePositions = useMemo(() => new Float32Array(visibleNodes.flatMap((n) => n.xyz)), [visibleNodes.length, result]);

  const arrows = useMemo(
    () => moves(result).map((mv) => {
      const from = new THREE.Vector3(...mv.from);
      const delta = new THREE.Vector3(...mv.to).sub(from);
      const len = delta.length();
      return new THREE.ArrowHelper(delta.normalize(), from, len, COLORS.added, Math.min(len * 0.4, 12), Math.min(len * 0.25, 8));
    }),
    [result],
  );

  // Camera link for split view (see CameraSync).
  const me = useId();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const seen = useRef(-1);
  useEffect(() => {
    if (sync) sync.driver = null; // new view: both panes fit first
  }, [sync, cameraMode]);
  useFrame(({ camera }) => {
    const c = controls.current;
    if (!sync || !c || sync.driver === null || sync.driver === me || sync.version === seen.current) return;
    seen.current = sync.version;
    camera.position.set(...sync.position);
    c.target.set(...sync.target);
    camera.zoom = sync.zoom;
    camera.updateProjectionMatrix();
    c.update();
  });
  const broadcast = () => {
    const c = controls.current;
    if (!sync || !c || sync.driver !== me) return;
    sync.position = c.object.position.toArray();
    sync.target = c.target.toArray();
    sync.zoom = c.object.zoom;
    sync.version += 1;
    seen.current = sync.version;
  };

  const click = (memberId: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(changeOf.get(memberId) ?? null);
  };

  return (
    <>
      {cameraMode === '3d' ? (
        <PerspectiveCamera makeDefault position={camPos} up={up} fov={40} near={1} far={size * 20} />
      ) : (
        <OrthographicCamera makeDefault position={camPos} up={up} near={0.1} far={size * 20} />
      )}
      <OrbitControls ref={controls} makeDefault target={center} enableRotate={cameraMode === '3d'}
        onStart={() => sync && (sync.driver = me)} onChange={broadcast} />

      <Bounds fit clip observe margin={1.15}>
        <ZoomController box={selectedBox} zoomTick={zoomTick} resetTick={resetTick} sync={sync} />
        {result.members.filter((m) => isVisible(m.side, viewMode)).map((m) => {
          const style = styles.get(m.id) ?? 'context';
          const isSel = selectedMembers.has(m.id);
          const faded = storyFilter !== null && m.story !== storyFilter;
          return (
            <Line
              key={m.id}
              points={m.end_nodes.map((n) => xyz.get(n)!)}
              color={COLORS[style]}
              lineWidth={isSel ? 5 : 1.5}
              dashed={style === 'removed' || style === 'previous'}
              dashSize={12}
              gapSize={8}
              transparent
              opacity={faded ? 0.12 : 1}
              onClick={click(m.id)}
              onPointerOver={() => (document.body.style.cursor = 'pointer')}
              onPointerOut={() => (document.body.style.cursor = '')}
            />
          );
        })}
      </Bounds>

      {viewMode !== 'baseline' && arrows.map((a, i) => <primitive key={i} object={a} />)}

      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nodePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial size={4} sizeAttenuation={false} color="#6b7280" />
      </points>

      {/* Story labels on the left edge, axis labels at the origin. */}
      {result.stories.filter((s) => isVisible(s.side, viewMode)).map((s) => (
        <Html key={s.name} position={[min.x - size * 0.06, min.y, s.elevation]} center style={{ pointerEvents: 'none' }}>
          <span className="whitespace-nowrap text-[10px] text-slate-500">{s.name} {s.elevation.toFixed(0)} {result.meta.units.length}</span>
        </Html>
      ))}
      <axesHelper args={[size * 0.1]} position={[min.x - size * 0.03, min.y - size * 0.03, 0]} />
      {(['X', 'Y', 'Z'] as const).map((axis, i) => {
        const p: Vec3 = [min.x - size * 0.03, min.y - size * 0.03, 0];
        p[i] += size * 0.12;
        return (
          <Html key={axis} position={p} center style={{ pointerEvents: 'none' }}>
            <span className="text-[10px] font-semibold text-slate-600">{axis}</span>
          </Html>
        );
      })}
    </>
  );
}

/** Zooms to the selected change when it changes or when "Zoom to selected" is pressed. */
function ZoomController({ box, zoomTick, resetTick, sync }: {
  box: THREE.Box3 | null; zoomTick: number; resetTick: number; sync?: CameraSync | null;
}) {
  const api = useBounds();
  const firstReset = useRef(resetTick);
  useEffect(() => {
    if (!box) return;
    if (sync) sync.driver = null; // each pane frames the selection itself
    api.refresh(box).clip().fit();
  }, [box, zoomTick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (resetTick === firstReset.current) return;
    if (sync) sync.driver = null;
    api.refresh().clip().fit();
  }, [resetTick]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Legend({ units, colorBy }: { units: string; colorBy: ColorBy }) {
  const rows: [string, string, boolean][] = [
    [COLORS.context, 'Unchanged', false],
    [COLORS.added, 'Added / new position', false],
    [COLORS.removed, 'Removed / old position', true],
    ...(colorBy === 'property' ? [[COLORS.property, 'Section or material changed', false] as [string, string, boolean]] : []),
  ];
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 whitespace-nowrap rounded border border-slate-200 bg-white/90 px-2 py-1 text-[10px] leading-4 text-slate-700">
      {rows.map(([color, label, dashed]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="inline-block w-6 border-t-2" style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} />
          {label}
        </div>
      ))}
      <div className="text-slate-500">Thick = selected · lengths in {units}</div>
    </div>
  );
}
