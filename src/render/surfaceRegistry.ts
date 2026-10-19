import type { MeshStandardMaterial } from 'three';
import { ASPHALT_ROUGHNESS } from '../config/environmentConfig';
import { lerpRoughness } from '../environment/environmentModel';

/**
 * Asphalt materials that respond to weather. A road registers its asphalt material when it is built, and removes it when
 * it is disposed. The Environment sets their roughness from the wetness. Nothing else changes these materials.
 */
const asphalt = new Set<MeshStandardMaterial>();
let lastRoughness: number | null = null;

export function registerAsphalt(material: MeshStandardMaterial): () => void {
  asphalt.add(material);
  // A newly registered material takes the current wetness, so it never shows a stale dry look.
  if (lastRoughness !== null) material.roughness = lastRoughness;
  return () => {
    asphalt.delete(material);
  };
}

/** Applies a wetness level (0..1) to every registered asphalt material. Skips the work when nothing changed. */
export function applyAsphaltWetness(wetness: number): void {
  const roughness = lerpRoughness(ASPHALT_ROUGHNESS.dry, ASPHALT_ROUGHNESS.wet, wetness);
  if (lastRoughness !== null && Math.abs(roughness - lastRoughness) < 1e-4) return;
  lastRoughness = roughness;
  for (const material of asphalt) material.roughness = roughness;
}

/** The last roughness applied to the asphalt, or null before any wetness was applied. For the DEV read-out. */
export function currentAsphaltRoughness(): number | null {
  return lastRoughness;
}

/** Number of registered asphalt materials. For tests and the DEV panel. */
export function registeredAsphaltCount(): number {
  return asphalt.size;
}
