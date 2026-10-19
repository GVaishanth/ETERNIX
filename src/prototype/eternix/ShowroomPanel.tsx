import { SHOWROOM_VIEWS, type ShowroomView } from './showroomOrbit';
import type { CarSummary } from './saveSnapshot';

export interface ShowroomPanelProps {
  readonly car: CarSummary;
  readonly view: ShowroomView;
  readonly onView: (view: ShowroomView) => void;
}

/**
 * The garage text: the car's name, class, paint, and three figures from the game's own vehicle data. The view buttons
 * move the camera. Nothing here is invented: every figure comes from the car the save selects.
 */
export function ShowroomPanel({ car, view, onView }: ShowroomPanelProps) {
  const specs: ReadonlyArray<readonly [string, string]> = [
    ['Top speed', `${Math.round(car.config.maxForwardSpeedMps * 3.6)} km/h`],
    ['Length', `${car.config.bodyLengthMeters.toFixed(2)} m`],
    ['Width', `${car.config.bodyWidthMeters.toFixed(2)} m`],
  ];
  const subline = car.vehicleClass ? `${car.vehicleClass}, ${car.paintLabel}` : car.paintLabel;
  return (
    <>
      <section className="ex-garage-info" aria-label="Your car">
        <p className="ex-kicker">Garage</p>
        <h2 className="ex-garage-name">{car.name}</h2>
        <p className="ex-garage-class">{subline}</p>
        <dl className="ex-garage-specs">
          {specs.map(([term, value]) => (
            <div key={term} className="ex-garage-spec">
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="ex-garage-note">Figures from the game's vehicle data. The drawing is a prototype model.</p>
      </section>
      <div className="ex-views" role="group" aria-label="Camera view">
        {SHOWROOM_VIEWS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="ex-view"
            aria-pressed={view === option.id}
            onClick={(event) => {
              event.currentTarget.blur();
              onView(option.id);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  );
}
