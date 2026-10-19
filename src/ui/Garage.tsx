import { useState, type MouseEvent } from 'react';
import { GARAGE_CONFIG } from '../config/garageConfig';
import { PAINT_PALETTE, paintDefinition } from '../config/paintConfig';
import { MAX_UPGRADE_TIER, UPGRADE_CATEGORIES, UPGRADES, type UpgradeCategory } from '../config/upgradeConfig';
import { garageService, useGarageStore } from '../garage/garageService';
import { defaultProgress, isOwned, nextUpgradeCost, paintCost, type VehicleProgress } from '../garage/garageModel';
import { specsForVehicle } from '../garage/activeVehicle';
import { vehicleUnlock } from '../garage/vehicleUnlock';
import { useConfirmUiStore } from '../state/confirmUiStore';
import { useGarageUiStore } from '../state/garageUiStore';
import { CATALOGUE, STARTER_VEHICLE_ID, vehicleDefinition, vehicleDesign } from '../vehicles/catalogue';
import { baseConfigFor, formatSpecValue, specRows } from '../vehicles/effectiveSpecs';
import { garageRatings, performanceIndex } from '../vehicles/performance';
import { GaragePreview } from './GaragePreview';
import type { VehicleDefinition, VehicleTier } from '../config/vehicleCatalogue';

/*
 * Garage overlay. Mounted only while the garage is open. The car is parked, and the simulation is paused by the loop.
 *
 * Every action here calls the garage service. The rules decide, and the service commits. Nothing here changes credits
 * or ownership directly. A button that cannot act is disabled, and the text beside it says why.
 *
 * Each vehicle is in exactly one state: Active, Owned, Available (unlocked and affordable or not), or Locked (the
 * career rank is not reached yet). The list filter and the badge show the same state.
 */

type ListFilter = 'all' | 'owned' | 'available' | 'locked';

const TIER_LABEL: Record<VehicleTier, string> = {
  starter: 'Starter',
  street: 'Street performance',
  advanced: 'Advanced',
  elite: 'Elite',
  ultimate: 'Ultimate',
};

const FILTERS: ReadonlyArray<{ id: ListFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'available', label: 'Available' },
  { id: 'locked', label: 'Locked' },
];

function credits(amount: number): string {
  return `${amount.toLocaleString('en-US')} cr`;
}

function blurAfterClick(event: MouseEvent<HTMLButtonElement>): void {
  // Keeps Space and the arrow keys with the driving controls, as the HUD buttons do.
  event.currentTarget.blur();
}

export function Garage() {
  const garage = useGarageStore((state) => state.garage);
  const career = useGarageStore((state) => state.career);
  const persistence = useGarageStore((state) => state.persistence);
  const lastResult = useGarageStore((state) => state.lastResult);
  const focusId = useGarageUiStore((state) => state.focusVehicleId);
  const close = useGarageUiStore((state) => state.close);
  const focus = useGarageUiStore((state) => state.focus);
  const [filter, setFilter] = useState<ListFilter>('all');

  const focused: VehicleDefinition | null = vehicleDefinition(focusId ?? garage.selectedVehicleId) ?? vehicleDefinition(STARTER_VEHICLE_ID);
  if (focused === null) return null;
  const owned = isOwned(garage, focused.id);
  const unlock = vehicleUnlock(focused, career.reputation);
  const progress: VehicleProgress = garage.vehicles[focused.id] ?? defaultProgress(focused);
  const isActive = garage.selectedVehicleId === focused.id;
  const specs = specsForVehicle(focused.id, garage);
  const design = vehicleDesign(focused.id);
  const stock = specRows(baseConfigFor(focused));
  const current = specRows(specs.config);
  const ratings = garageRatings(specs.config);
  const perf = performanceIndex(specs.config);
  const paint = paintDefinition(progress.paintId) ?? paintDefinition(focused.factoryPaintId);

  // Buying a car asks first, in the popup. The car is charged only when the player confirms.
  const askBuy = () => {
    const price = focused.priceCredits;
    useConfirmUiStore.getState().ask({
      title: `Buy the ${focused.name}?`,
      message: `This costs ${credits(price)}. You have ${credits(garage.credits)}, so ${credits(garage.credits - price)} will be left.`,
      confirmLabel: `Buy for ${credits(price)}`,
      cancelLabel: 'Cancel',
      onConfirm: () => garageService.purchaseVehicle(focused.id),
    });
  };
  const select = () => garageService.selectVehicle(focused.id);

  const buyBlockedReason = owned
    ? null
    : !unlock.unlocked
      ? `Locked. Reach ${unlock.requiredName} (${unlock.requiredReputation} reputation) first, ${unlock.reputationToGo} to go.`
      : garage.credits < focused.priceCredits
        ? `Need ${credits(focused.priceCredits - garage.credits)} more.`
        : null;

  const rowStatus = (vehicle: VehicleDefinition): { label: string; kind: 'active' | 'owned' | 'available' | 'locked' } => {
    const rowUnlock = vehicleUnlock(vehicle, career.reputation);
    if (garage.selectedVehicleId === vehicle.id) return { label: 'Active', kind: 'active' };
    if (isOwned(garage, vehicle.id)) return { label: 'Owned', kind: 'owned' };
    if (!rowUnlock.unlocked) return { label: `Locked · ${rowUnlock.requiredName}`, kind: 'locked' };
    return { label: credits(vehicle.priceCredits), kind: 'available' };
  };

  const visible = CATALOGUE.filter((vehicle) => {
    const kind = rowStatus(vehicle).kind;
    if (filter === 'all') return true;
    if (filter === 'owned') return kind === 'owned' || kind === 'active';
    if (filter === 'available') return kind === 'available';
    return kind === 'locked';
  });

  return (
    <div className="garage-overlay" role="dialog" aria-modal="true" aria-label="Garage">
      <header className="garage-header">
        <div>
          <h2 className="garage-title">Garage</h2>
          <p className="garage-sub">Stopped at the entrance. The car is parked and the race clock is off.</p>
        </div>
        <div className="garage-balance" aria-label="Credits">
          <span className="garage-balance-label">Credits</span>
          <span className="garage-balance-value">{garage.credits.toLocaleString('en-US')}</span>
        </div>
        <button type="button" className="hud-button garage-primary" onClick={(event) => { blurAfterClick(event); close(); }}>
          Return to free roam
        </button>
      </header>

      {persistence.notice ? <p className="garage-notice" role="status">{persistence.notice}</p> : null}

      <div className="garage-body">
        <nav className="garage-list-wrap" aria-label="Vehicles">
          <div className="garage-filters" role="group" aria-label="Filter vehicles">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={filter === option.id ? 'garage-filter garage-filter-on' : 'garage-filter'}
                aria-pressed={filter === option.id}
                onClick={(event) => { blurAfterClick(event); setFilter(option.id); }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="garage-list" role="list">
            {visible.map((vehicle) => {
              const status = rowStatus(vehicle);
              return (
                <button
                  key={vehicle.id}
                  type="button"
                  className={vehicle.id === focused.id ? 'garage-row garage-row-focus' : 'garage-row'}
                  aria-pressed={vehicle.id === focused.id}
                  data-status={status.kind}
                  onClick={(event) => { blurAfterClick(event); focus(vehicle.id); }}
                >
                  <span className="garage-row-name">
                    <span className="garage-row-roster">{String(vehicle.roster).padStart(2, '0')}</span>
                    {vehicle.name}
                  </span>
                  <span className={`garage-row-status garage-status-${status.kind}`}>{status.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <section className="garage-stage" aria-label="Preview and details">
          <div className="garage-title-row">
            <h3 className="garage-car-name">{focused.roster.toString().padStart(2, '0')} · {focused.name}</h3>
            <span className="garage-car-meta">{TIER_LABEL[focused.tier]} · {focused.vehicleClass}</span>
          </div>
          {design ? (
            <GaragePreview config={specs.config} design={design} paintColor={paint?.color ?? '#b3261e'} />
          ) : null}
          <p className="garage-summary">{focused.summary}</p>

          <div className="garage-ratings" aria-label="Ratings">
            <Rating label="Acceleration" value={ratings.acceleration} />
            <Rating label="Top speed" value={ratings.topSpeed} />
            <Rating label="Handling" value={ratings.handling} />
            <Rating label="Braking" value={ratings.braking} />
          </div>
          <p className="garage-hint">Performance index {perf.toFixed(2)} against the factory car. Ratings are from the stats the car drives.</p>

          <div className="garage-actions">
            {owned ? (
              isActive ? (
                <button type="button" className="hud-button" disabled>Driving this car</button>
              ) : (
                <button type="button" className="hud-button garage-primary" onClick={(event) => { blurAfterClick(event); select(); }}>
                  Make active
                </button>
              )
            ) : (
              <button
                type="button"
                className="hud-button garage-primary"
                disabled={buyBlockedReason !== null}
                onClick={(event) => { blurAfterClick(event); askBuy(); }}
              >
                {!unlock.unlocked ? 'Locked' : `Buy for ${credits(focused.priceCredits)}`}
              </button>
            )}
            {!owned && buyBlockedReason ? <span className="garage-hint">{buyBlockedReason}</span> : null}
            {owned && isActive ? <span className="garage-hint">This is the car you drive in the world.</span> : null}
            {owned && !isActive ? <span className="garage-hint">Switching takes effect now. Leave the garage to drive it.</span> : null}
          </div>

          <div className="garage-specs">
            <div className="garage-spec-head">
              <span>Spec</span>
              <span>Factory</span>
              <span>Current</span>
            </div>
            {current.map((row, index) => {
              const factory = stock[index];
              const changed = factory !== undefined && factory.value.toFixed(row.decimals) !== row.value.toFixed(row.decimals);
              return (
                <div className="garage-spec-row" key={row.key}>
                  <span>{row.label}</span>
                  <span className="garage-spec-muted">{factory ? formatSpecValue(factory) : '—'}</span>
                  <span className={changed ? 'garage-spec-changed' : undefined}>{formatSpecValue(row)}</span>
                </div>
              );
            })}
          </div>

          <div className="garage-section">
            <h3>Performance upgrades</h3>
            {UPGRADE_CATEGORIES.map((category) => (
              <UpgradeRow
                key={category}
                category={category}
                vehicle={focused}
                progress={progress}
                owned={owned}
                credits={garage.credits}
              />
            ))}
            <p className="garage-hint">Tiers are bought in order and cannot be sold back. Each tier is a real controller change. A stat already at its limit does not rise further.</p>
          </div>

          <div className="garage-section">
            <h3>Paint</h3>
            <div className="garage-swatches">
              {PAINT_PALETTE.map((swatch) => {
                const isCurrent = progress.paintId === swatch.id;
                const cost = paintCost(focused, swatch.id);
                const blocked = !owned ? 'Buy the car first.' : isCurrent ? 'Current colour.' : garage.credits < cost ? `Need ${credits(cost - garage.credits)} more.` : null;
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    className={isCurrent ? 'garage-swatch garage-swatch-current' : 'garage-swatch'}
                    style={{ background: swatch.color }}
                    aria-label={`${swatch.label}${cost === 0 ? ', free' : `, ${credits(cost)}`}`}
                    title={blocked ?? `${swatch.label}: ${cost === 0 ? 'free (factory)' : credits(cost)}`}
                    disabled={blocked !== null}
                    onClick={(event) => {
                      blurAfterClick(event);
                      if (cost === 0) {
                        garageService.applyPaint(focused.id, swatch.id);
                        return;
                      }
                      useConfirmUiStore.getState().ask({
                        title: `Paint the ${focused.name} ${swatch.label}?`,
                        message: `This costs ${credits(cost)}. You have ${credits(garage.credits)}, so ${credits(garage.credits - cost)} will be left. Paint never changes handling.`,
                        confirmLabel: `Paint for ${credits(cost)}`,
                        cancelLabel: 'Cancel',
                        onConfirm: () => garageService.applyPaint(focused.id, swatch.id),
                      });
                    }}
                  />
                );
              })}
            </div>
            <p className="garage-hint">
              {!owned
                ? 'Buy the car to paint it.'
                : `Factory colour is free. Any other colour costs ${credits(GARAGE_CONFIG.paintChangeCostCredits)} per change. Paint never changes handling.`}
            </p>
            {paint ? <p className="garage-hint">Current: {paint.label}</p> : null}
          </div>

          <p className="garage-hint">Selling is not available in this version. Owned cars stay owned.</p>
          <p className="garage-message" role="status" aria-live="polite">{lastResult ? lastResult.message : ' '}</p>
        </section>
      </div>
    </div>
  );
}

function Rating({ label, value }: { label: string; value: number }) {
  return (
    <div className="garage-rating">
      <span className="garage-rating-label">{label}</span>
      <span className="garage-rating-bar" aria-hidden="true">
        <span className="garage-rating-fill" style={{ width: `${(value / 10) * 100}%` }} />
      </span>
      <span className="garage-rating-value">{value.toFixed(1)}</span>
    </div>
  );
}

interface UpgradeRowProps {
  category: UpgradeCategory;
  vehicle: VehicleDefinition;
  progress: VehicleProgress;
  owned: boolean;
  credits: number;
}

function UpgradeRow({ category, vehicle, progress, owned, credits: balance }: UpgradeRowProps) {
  const definition = UPGRADES[category];
  const tier = progress.upgrades[category];
  const supported = vehicle.upgradeSupport.includes(category);
  const cost = nextUpgradeCost(progress, category);

  let action: { label: string; disabled: boolean; reason: string | null };
  if (!supported) {
    action = { label: 'Not available', disabled: true, reason: `The ${vehicle.name} cannot take ${category} upgrades.` };
  } else if (!owned) {
    action = { label: 'Buy the car first', disabled: true, reason: null };
  } else if (cost === null) {
    action = { label: 'Top tier', disabled: true, reason: null };
  } else if (balance < cost) {
    action = { label: `Tier ${tier + 1} · ${credits(cost)}`, disabled: true, reason: `Need ${credits(cost - balance)} more.` };
  } else {
    action = { label: `Tier ${tier + 1} · ${credits(cost)}`, disabled: false, reason: null };
  }

  const pips = Array.from({ length: MAX_UPGRADE_TIER }, (_, index) => index < tier);

  return (
    <div className="garage-upgrade">
      <div className="garage-upgrade-info">
        <span className="garage-upgrade-name">{definition.label}</span>
        <span className="garage-upgrade-desc">{supported ? definition.description : `Not available on the ${vehicle.name}.`}</span>
      </div>
      <div className="garage-pips" aria-label={`${definition.label} tier ${tier} of ${MAX_UPGRADE_TIER}`}>
        {pips.map((filled, index) => (
          <span key={index} className={filled ? 'garage-pip garage-pip-on' : 'garage-pip'} />
        ))}
      </div>
      <button
        type="button"
        className="hud-button"
        disabled={action.disabled}
        title={action.reason ?? undefined}
        onClick={(event) => {
          blurAfterClick(event);
          if (cost === null) return;
          useConfirmUiStore.getState().ask({
            title: `Buy ${definition.label} tier ${tier + 1}?`,
            message: `This costs ${credits(cost)} and cannot be sold back. You have ${credits(balance)}, so ${credits(balance - cost)} will be left.`,
            confirmLabel: `Buy for ${credits(cost)}`,
            cancelLabel: 'Cancel',
            onConfirm: () => garageService.purchaseUpgrade(vehicle.id, category),
          });
        }}
      >
        {action.label}
      </button>
      {action.reason ? <span className="garage-hint garage-upgrade-reason">{action.reason}</span> : null}
    </div>
  );
}

