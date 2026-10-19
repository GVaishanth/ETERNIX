import { VehicleVisual } from '../../render/VehicleVisual';
import { bodyCentreAheadOfAxle } from './heroViews';
import type { CarSummary } from './saveSnapshot';

/*
 * The player's active car, in their chosen paint, as the game draws it (VehicleVisual). The model's origin is the rear
 * axle, so this shifts it back to put the body's centre on the group's origin. The landing and the garage both frame
 * the car around that centre.
 */
export function ActiveCar({ car }: { readonly car: CarSummary }) {
  const shift = -bodyCentreAheadOfAxle(car.config);
  return (
    <group position={[0, 0, shift]}>
      <VehicleVisual config={car.config} design={car.design} paintColor={car.paintColor} />
    </group>
  );
}
