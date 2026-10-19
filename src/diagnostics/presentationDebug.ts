/*
 * DEV-only read-out of the Part 10 presentation: time of day, weather, quality, audio state, renderer counts, rain and
 * smoke, asphalt wetness, and fog. Read only. It never writes to the game, the physics, or the stores.
 * Installed by PresentationProbe only in DEV builds, so the browser tests can check real state.
 */
import type { Scene, WebGLRenderer } from 'three';
import { Color, Fog, LineSegments, InstancedMesh } from 'three';
import { QUALITY_PRESETS } from '../config/qualityConfig';
import { getAudioSession } from '../audio/audioSession';
import { useEnvironmentStore } from '../state/environmentStore';
import { useQualityStore } from '../state/qualityStore';
import { currentAsphaltRoughness, registeredAsphaltCount } from '../render/surfaceRegistry';

export interface PresentationReadout {
  readonly timeOfDay: string;
  readonly weather: string;
  readonly quality: string;
  readonly volume: number;
  readonly pixelRatio: number;
  readonly audio: {
    readonly enabled: boolean;
    readonly contextState: string | null;
    readonly loopsCreated: number;
    readonly cuesPlayed: number;
    readonly graphBuilt: boolean;
    readonly engineHz: number;
    readonly engineGain: number;
    readonly skidLevel: number;
    readonly rainGain: number;
    readonly sirenOn: boolean;
  };
  readonly renderer: {
    readonly calls: number;
    readonly triangles: number;
    readonly lines: number;
    readonly points: number;
    readonly geometries: number;
    readonly textures: number;
    readonly programs: number;
  };
  readonly rainStreaks: number;
  readonly smokeLive: number;
  readonly smokeCapacity: number;
  readonly asphaltRoughness: number | null;
  readonly asphaltMaterials: number;
  readonly fog: { readonly near: number; readonly far: number } | null;
  readonly background: string | null;
}

/** Reads the current presentation state. Called on demand by a test, never by the game loop. */
export function readPresentation(gl: WebGLRenderer, scene: Scene): PresentationReadout {
  const env = useEnvironmentStore.getState();
  const quality = useQualityStore.getState();
  const audio = getAudioSession();
  const rain = scene.getObjectByName('RainStreaks');
  const smoke = scene.getObjectByName('TireSmoke');
  const fog = scene.fog instanceof Fog ? { near: scene.fog.near, far: scene.fog.far } : null;
  const background = scene.background instanceof Color ? `#${scene.background.getHexString()}` : null;
  const info = gl.info;
  return {
    timeOfDay: env.timeOfDay,
    weather: env.weather,
    quality: quality.quality,
    volume: quality.volume,
    pixelRatio: gl.getPixelRatio(),
    audio: {
      enabled: audio.enabled,
      contextState: audio.contextState,
      loopsCreated: audio.stats.loopsCreated,
      cuesPlayed: audio.stats.cuesPlayed,
      graphBuilt: audio.stats.graphBuilt,
      engineHz: audio.live.engineHz,
      engineGain: audio.live.engineGain,
      skidLevel: audio.live.skidLevel,
      rainGain: audio.live.rainGain,
      sirenOn: audio.live.sirenOn,
    },
    renderer: {
      calls: info.render.calls,
      triangles: info.render.triangles,
      lines: info.render.lines,
      points: info.render.points,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    },
    rainStreaks: rain instanceof LineSegments && rain.visible ? rain.geometry.drawRange.count / 2 : 0,
    smokeLive: smoke instanceof InstancedMesh ? Number(smoke.userData.liveParticles ?? 0) : 0,
    smokeCapacity: QUALITY_PRESETS[quality.quality].smokeParticles,
    asphaltRoughness: currentAsphaltRoughness(),
    asphaltMaterials: registeredAsphaltCount(),
    fog,
    background,
  };
}

/** Installs the read-out on the DEV debug API. Returns a remover that deletes it again. */
export function installPresentationDebug(target: Window, read: () => PresentationReadout): () => void {
  const api = target.__STREET_RACER_DEBUG__;
  if (!api) return () => undefined;
  api.presentation = read;
  return () => {
    delete api.presentation;
  };
}
