import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, CanvasTexture, LineBasicMaterial, SpriteMaterial, Sprite, type Texture } from 'three';
import { useDiagnosticsStore } from '../diagnostics/diagnosticsStore';
import { buildRoadDebugData, type DebugLineKind, type RoadDebugData } from '../world/roadDebugData';
import type { RoadNetwork } from '../world/roadTypes';

/*
 * Road debug overlay. DEV only: imported lazily from RenderLayer, and never mounted in production builds.
 * Read-only: it draws derived geometry and never changes the road, the boundary, or the vehicle.
 * Toggled with G. Lines are drawn without depth test, so connection points stay visible through the road.
 */

const LINE_COLORS: Record<DebugLineKind, string> = {
  centerline: '#ffd54a',
  lane: '#7fd1ff',
  boundary: '#ff5ad8',
  junction: '#37e5c0',
  segmentCut: '#ff9f43',
  heading: '#4d7cff',
  portConnected: '#3ddc84',
  portTerminal: '#4d7cff',
  portOutward: '#c4ff5e',
  connection: '#ffffff',
  issue: '#ff3b30',
};

function makeLabelTexture(text: string): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(10, 12, 16, 0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 56px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  return new CanvasTexture(canvas);
}

export interface RoadDebugOverlayProps {
  network: RoadNetwork;
}

export default function RoadDebugOverlay({ network }: RoadDebugOverlayProps) {
  const visible = useDiagnosticsStore((state) => state.roadDebug);
  const data: RoadDebugData = useMemo(() => buildRoadDebugData(network), [network]);

  const lineGeometries = useMemo(
    () =>
      data.lines.map((buffer) => {
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(buffer.positions, 3));
        return geometry;
      }),
    [data],
  );
  const lineMaterials = useMemo(() => {
    const map = new Map<DebugLineKind, LineBasicMaterial>();
    for (const kind of Object.keys(LINE_COLORS) as DebugLineKind[]) {
      map.set(kind, new LineBasicMaterial({ color: LINE_COLORS[kind], depthTest: false, transparent: true, opacity: 0.95 }));
    }
    return map;
  }, []);
  const labelSprites = useMemo(
    () =>
      data.labels.map((label) => {
        const texture = makeLabelTexture(label.text);
        const material = new SpriteMaterial({ map: texture, depthTest: false, transparent: true });
        const sprite = new Sprite(material);
        sprite.position.set(label.position.x, label.position.y, label.position.z);
        sprite.scale.set(16, 6, 1);
        sprite.renderOrder = 10;
        return sprite;
      }),
    [data],
  );

  useEffect(() => {
    return () => {
      for (const geometry of lineGeometries) geometry.dispose();
      for (const material of lineMaterials.values()) material.dispose();
      for (const sprite of labelSprites) {
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
    };
  }, [lineGeometries, lineMaterials, labelSprites]);

  if (!visible) return null;

  return (
    <group name="RoadDebug">
      {data.lines.map((buffer, index) => (
        <lineSegments
          key={buffer.kind}
          name={`RoadDebug-${buffer.kind}`}
          geometry={lineGeometries[index]}
          material={lineMaterials.get(buffer.kind)}
          renderOrder={5}
        />
      ))}
      {labelSprites.map((sprite, index) => (
        <primitive key={`label-${index}`} object={sprite} />
      ))}
    </group>
  );
}
