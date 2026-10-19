import { TIME_OF_DAY_PRESETS, WEATHER_PRESETS } from '../config/environmentConfig';
import { QUALITY_PRESETS } from '../config/qualityConfig';
import { describeCycle } from '../state/environmentClock';
import { useEnvironmentStore } from '../state/environmentStore';
import { useQualityStore } from '../state/qualityStore';

/** A one-line readout: time of day, weather, whether they follow the automatic cycle, and quality. Read only. */
export function PresentationStatus() {
  const timeOfDay = useEnvironmentStore((state) => state.timeOfDay);
  const weather = useEnvironmentStore((state) => state.weather);
  const cycle = useEnvironmentStore((state) => state.cycle);
  const quality = useQualityStore((state) => state.quality);
  return (
    <div className="presentation-status" aria-label="Presentation settings">
      {TIME_OF_DAY_PRESETS[timeOfDay].label} · {WEATHER_PRESETS[weather].label} · {describeCycle(cycle)} · {QUALITY_PRESETS[quality].label} quality
    </div>
  );
}
