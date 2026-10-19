# Car Design Overhaul: plan (written before coding)

Status: plan. Decisions below are confirmed by the user unless marked "recommended".

## Decisions (confirmed)

1. **IDs.** The seven legacy IDs stay. Each one is renamed to its roster name, so saves, rivals, career prerequisites
   and existing tests keep working with no migration. Thirteen new IDs are added.

   | Roster | ID | Legacy display name |
   |---|---|---|
   | 01 Finch S1 | `kestrel-hatch` | Kestrel Hatch (starter, owned) |
   | 04 Ember GT | `ember-gt` | Ember GT |
   | 07 Nightfall GT | `halcyon-gt` | Halcyon GT |
   | 09 Talon V8 | `grit-coupe` | Grit Coupe (drift-leaning; now a power-slide muscle car) |
   | 13 Voltaris E | `volt-e` | Volt E |
   | 14 Sovereign S | `bastion-sedan` | Bastion Sedan |
   | 15 Zephyr R | `tarn-roadster` | Tarn Roadster (Mara Quill's car) |

   New IDs: `vesper-c2`, `rook-rs`, `strata-s`, `vandal-r`, `kestrel-mr`, `meridian-xr`, `phantom-lx`, `apex-t`,
   `obsidian-x`, `tempest-r`, `havoc-awd`, `solstice-lm`, `zenith-one`.

2. **Performance ceiling.** Stay inside `SPEC_LIMITS`. No limit change in this task. The user will widen the limits
   later, as a separate task. The brief's 2.00–2.30× bands are unreachable inside the limits, so the performance index
   is compressed (see below).

3. **Collision hull is fixed.** `setVehicleConfig` throws when the footprint changes, and traffic and pursuit take the
   footprint from the starter at world start. So every car keeps `VEHICLE_CONFIG`'s footprint (4.5 × 1.85 m, rear
   overhang 0.8 m), wheelbase 2.7 m, track 1.6 m, and wheel radius 0.33 m. Per-car variety is in the visual body design
   inside that hull, and in handling values.

## Performance index (new, pure, `src/vehicles/performance.ts`)

Geometric mean of four ratios against the stock baseline (`VEHICLE_CONFIG`):
engine acceleration / 9, top speed / 62, braking / 18, max lateral acceleration / 14.
The effective values are read from `deriveEffectiveSpecs` (what the car drives), so the index is never a second
calculation. Within `SPEC_LIMITS` the index cannot exceed about 1.42.

Bands, compressed to what the limits allow:

| Tier | Cars | Index band |
|---|---|---|
| Starter | 01–05 | 1.00–1.10 |
| Street performance | 06–10 | 1.10–1.20 |
| Advanced | 11–15 | 1.20–1.28 |
| Elite | 16–19 | 1.28–1.34 |
| Ultimate | 20 | 1.34–1.40 |

## Ratings (garage display, from effective specs)

Four ratings, 1–10, linear within `SPEC_LIMITS`: acceleration (engine acceleration), top speed (max forward speed),
handling (mean of max lateral acceleration and lateral grip), and braking (brake deceleration).

## Prices and unlocks

- Prices strictly increase in roster order. Starter: 0.
- Unlock is the career rank, via the existing `rankFor(reputation)`. Enforced in `garageService.purchaseVehicle`
  through `commitProfile`, so the rule sees the profile reputation. Tier 1 needs Newcomer. Tier 2 needs Street Regular
  (40 rep). Tier 3 needs Road Name (120). Tier 4 needs Night Contender (240). Ultimate needs City Legend (380).
- The total credits a full career can earn are measured from the catalogue (rival rewards, rank rewards, milestones,
  race wins), then checked against the top price. The top price is set so the ultimate is reachable in a full career.

## Visual design system (stages)

- **Profile data** (`src/config/vehicleDesigns.ts`, types in `src/vehicles/designProfile.ts`): body stations
  `[t, bottom, top, halfWidth]` along the length, cabin stations `[t, top, halfWidth]` (belt from the body), section
  exponents, and feature enums for lights, grille, intakes, splitter, skirts, flares, spoiler, diffuser, exhaust, roof
  scoop, stripes, mirrors, wheel rim style, rim colour, tyre width, and accent colour.
- **Geometry** (`src/render/vehicleModel/`): pure lofts from stations (superellipse rings), surface projection for
  lights and aero on the curved body, and procedural primitives. No remote assets.
- **Layout** (`src/render/vehicleLayout.ts`, rewritten): builds parts from config + design. Same wheel and pivot names,
  so `vehicleRig.ts` is unchanged.
- **Rendering** (`VehicleVisual.tsx`): meshes from parts, paint on `body` role only, geometry disposed on change.

## Stages

1. Catalogue and profiles: 20 entries, stable IDs, prices, unlock ranks, handling, design data.
2. Geometry: loft, parts, wheels, validation, distinct-silhouette test.
3. Garage preview: front, side, rear, three-quarter views, rotation toggle, disposal on change.
4. Physics integration: active car switch, traffic and AI config, race grids.
5. Economy: purchase rule with rank, UI status (owned, locked, purchasable), confirmation, save and load.
6. Testing: unit, visual sheet of all 20, driving per tier, smoke, regression, memory growth on repeated switching.

## Out of scope

No new physics system, no limit change, no hull change, no new mode, no sell-back, no remote assets, no change to
traffic or police vehicles (they keep their own dimensions).
