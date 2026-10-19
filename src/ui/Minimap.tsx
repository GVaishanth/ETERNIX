import { useEffect, useRef } from 'react';
import type { RoadNetwork } from '../world/roadTypes';
import { getMinimapPose } from './minimapPose';
import { getRaceMarks } from './minimapRaceMarks';
import { getMinimapNavigation, routeSegmentDrawable } from './minimapNavigation';
import {
  buildMinimapModel,
  MINIMAP_PIXELS_PER_METER,
  MINIMAP_SIZE_PX,
  staticLayerSize,
  staticTileDraws,
  toStaticPixels,
  wrappedViewPixels,
  type MinimapModel,
} from './minimapModel';

/*
 * City minimap. The static map (districts, streets, junctions, landmarks) covers the whole populated map and is drawn
 * once into an offscreen canvas. Each frame the view is centred on the player: the static canvas is blitted with an
 * offset, and the marker and race marks are drawn relative to the centre. No DOM or React work per frame. Cleaned up
 * on unmount.
 */

const COLOURS = {
  background: '#11151b',
  street: '#5d636c',
  highway: '#c9a24a',
  junction: '#6b717a',
  marker: '#ff5a4e',
  race: '#ffd166',
  route: '#29d3ff',
  garage: '#ffb000',
  label: '#e9edf2',
};

const VIEW_CENTRE_PX = MINIMAP_SIZE_PX / 2;

function drawStatic(model: MinimapModel, ctx: CanvasRenderingContext2D, staticWidth: number, staticHeight: number): void {
  const bounds = model.bounds;
  const at = (x: number, z: number) => toStaticPixels(bounds, x, z);
  ctx.fillStyle = COLOURS.background;
  ctx.fillRect(0, 0, staticWidth, staticHeight);

  ctx.globalAlpha = 0.28;
  for (const district of model.districts) {
    const a = at(district.x0, district.z1);
    const b = at(district.x1, district.z0);
    ctx.fillStyle = district.tint;
    ctx.fillRect(a.px, a.py, b.px - a.px, b.py - a.py);
  }
  ctx.globalAlpha = 1;

  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  for (const street of model.streets) {
    ctx.strokeStyle = street.highway ? COLOURS.highway : COLOURS.street;
    ctx.lineWidth = Math.max(1, street.widthMeters * MINIMAP_PIXELS_PER_METER);
    ctx.beginPath();
    street.points.forEach((point, index) => {
      const p = at(point.x, point.z);
      if (index === 0) ctx.moveTo(p.px, p.py);
      else ctx.lineTo(p.px, p.py);
    });
    ctx.stroke();
  }

  ctx.fillStyle = COLOURS.junction;
  for (const junction of model.junctions) {
    const a = at(junction.centre.x - junction.halfSizeMeters, junction.centre.z + junction.halfSizeMeters);
    const side = junction.halfSizeMeters * 2 * MINIMAP_PIXELS_PER_METER;
    ctx.fillRect(a.px, a.py, side, side);
  }

  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = COLOURS.label;
  ctx.textBaseline = 'middle';
  for (const landmark of model.landmarks) {
    const p = at(landmark.x, landmark.z);
    ctx.beginPath();
    ctx.arc(p.px, p.py, 3, 0, Math.PI * 2);
    ctx.fill();
    // Labels are drawn on the static layer, so they keep their place on the map. Right-side labels flip left.
    const width = ctx.measureText(landmark.label).width;
    const flip = p.px + 5 + width > staticWidth;
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(landmark.label, flip ? p.px - 5 : p.px + 5, p.py);
  }
  ctx.textAlign = 'left';
}

function drawMarker(ctx: CanvasRenderingContext2D, yaw: number): void {
  // The view is centred on the player, so the marker is always at the centre.
  const p = { px: VIEW_CENTRE_PX, py: VIEW_CENTRE_PX };
  // Heading 0 is +Z, which is up on the map. Screen y grows downward, so the forward vector is (sin, -cos).
  const fx = Math.sin(yaw);
  const fy = -Math.cos(yaw);
  const tip = { x: p.px + fx * 8, y: p.py + fy * 8 };
  const left = { x: p.px - fy * 4.5 - fx * 4, y: p.py + fx * 4.5 - fy * 4 };
  const right = { x: p.px + fy * 4.5 - fx * 4, y: p.py - fx * 4.5 - fy * 4 };
  ctx.fillStyle = COLOURS.marker;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fill();
}

/*
 * Race marks: a ring for each event marker that is not in progress, and a diamond for the next gate. Both are drawn
 * from the same per-frame pass and read plain values, so they cost no allocation.
 */
function drawRaceMarks(ctx: CanvasRenderingContext2D, cx: number, cz: number, period: number | null): void {
  const marks = getRaceMarks();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOURS.race;
  marks.eventMarkers.forEach((marker, index) => {
    // A locked or retired race is not on the map. The race in progress is not drawn either (its gate is).
    if (index === marks.hiddenEventIndex || marks.eventVisible[index] === false) return;
    const p = wrappedViewPixels(marker.x, marker.z, cx, cz, period);
    ctx.beginPath();
    ctx.arc(p.px, p.py, 5, 0, Math.PI * 2);
    ctx.stroke();
  });
  const gate = marks.nextGate;
  if (gate) {
    const p = wrappedViewPixels(gate.x, gate.z, cx, cz, period);
    ctx.fillStyle = COLOURS.race;
    ctx.beginPath();
    ctx.moveTo(p.px, p.py - 6);
    ctx.lineTo(p.px + 6, p.py);
    ctx.lineTo(p.px, p.py + 6);
    ctx.lineTo(p.px - 6, p.py);
    ctx.closePath();
    ctx.fill();
  }
}

/*
 * Navigation: the route as a line, and the garage entrance as a ring. A segment that would cross the view (on a loop,
 * the far side of the map) is not drawn, so the line never spans the whole minimap.
 */
function drawNavigation(ctx: CanvasRenderingContext2D, cx: number, cz: number, period: number | null): void {
  const nav = getMinimapNavigation();
  const route = nav.route;
  if (route !== null && route.points.length > 1) {
    ctx.strokeStyle = COLOURS.route;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let previous: { px: number; py: number } | null = null;
    for (const point of route.points) {
      const p = wrappedViewPixels(point.x, point.z, cx, cz, period);
      if (previous !== null && routeSegmentDrawable(previous.px, previous.py, p.px, p.py, MINIMAP_SIZE_PX)) {
        ctx.lineTo(p.px, p.py);
      } else {
        ctx.moveTo(p.px, p.py);
      }
      previous = p;
    }
    ctx.stroke();
  }
  if (nav.garage !== null) {
    const p = wrappedViewPixels(nav.garage.x, nav.garage.z, cx, cz, period);
    ctx.strokeStyle = COLOURS.garage;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.px, p.py, 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export interface MinimapProps {
  network: RoadNetwork;
}

export function Minimap({ network }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const model = buildMinimapModel(network);
    // Null for a finite city (one copy of the static layer). On the loop the layer repeats every period.
    const period = network.periodMeters ?? null;
    const { width: staticWidth, height: staticHeight } = staticLayerSize(model.bounds);

    // Static layer, drawn once. It covers the whole populated map.
    const staticCanvas = document.createElement('canvas');
    staticCanvas.width = staticWidth;
    staticCanvas.height = staticHeight;
    const staticCtx = staticCanvas.getContext('2d');
    if (staticCtx) drawStatic(model, staticCtx, staticWidth, staticHeight);

    let frame = 0;
    const draw = () => {
      const pose = getMinimapPose();
      ctx.fillStyle = COLOURS.background;
      ctx.fillRect(0, 0, MINIMAP_SIZE_PX, MINIMAP_SIZE_PX);
      // Centre the view on the player: the static pixel under the player moves to the centre of the view. On the loop,
      // every copy of the static layer that overlaps the view is drawn, so the view has no edge at the seam.
      for (const tile of staticTileDraws(model.bounds, period, pose.x, pose.z)) {
        ctx.drawImage(staticCanvas, tile.px, tile.py);
      }
      drawNavigation(ctx, pose.x, pose.z, period);
      drawRaceMarks(ctx, pose.x, pose.z, period);
      drawMarker(ctx, pose.yaw);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      staticCanvas.width = 0;
      staticCanvas.height = 0;
    };
  }, [network]);

  return (
    <div className="minimap" aria-label="City minimap">
      <canvas ref={canvasRef} width={MINIMAP_SIZE_PX} height={MINIMAP_SIZE_PX} />
    </div>
  );
}
