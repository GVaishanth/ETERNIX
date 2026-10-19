import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { QUALITY_PRESETS } from '../config/qualityConfig';
import { useQualityStore } from '../state/qualityStore';
import { effectFeed } from './effectFeed';
import { TireSmokeField } from './tireSmokeField';

/** The highest particle budget any quality preset uses. The mesh is sized to this once. */
const MAX_PARTICLES = Math.max(...Object.values(QUALITY_PRESETS).map((preset) => preset.smokeParticles));

/** Tire smoke from the rear wheels (Part 10). Presentation only. Logic lives in tireSmokeField.ts. */
export function TireSmoke() {
  const quality = useQualityStore((state) => state.quality);
  const capacity = Math.min(MAX_PARTICLES, QUALITY_PRESETS[quality].smokeParticles);
  const field = useMemo(() => new TireSmokeField(MAX_PARTICLES, capacity), [capacity]);

  useEffect(() => () => field.dispose(), [field]);

  useFrame((_, dt) => {
    field.update(dt, effectFeed);
  });

  return <primitive object={field.object} />;
}
