# Fleet audit: the 20 current catalogue vehicles

Status: Phase 1 (audit) only. Nothing in the geometry, the roster or the catalogue has changed yet.
Method: code read (src/config/vehicleCatalogue.ts, src/config/vehicleDesigns.ts, src/render/vehicleModel/bodyParts.ts,
src/render/vehicleLayout.ts) and fleet renders from the dev-only harness (fleet.html, src/tools/fleet/fleetMain.tsx),
which draws each car through the real VehicleVisual. The contact sheet was checked by eye for the 3/4 view only. The
other views and the silhouette-only view have not been reviewed yet.

## Shared facts (true for all 20)

- Every car uses the same hull: 4.5 m long, 1.85 m wide, 2.7 m wheelbase, 1.6 m track, 0.33 m wheel radius
  (VEHICLE_CONFIG). Roof limit 1.45 m, body bottom at least 0.2 m (DESIGN_LIMITS).
- Each car is one loft for the body and one loft for the greenhouse, both from station lists in vehicleDesigns.ts.
  Every other part is a box, cylinder or arch: lights, grille, splitter, wing, diffuser, exhaust, mirrors.
- Wheels are identical in construction. Only the tyre width and rim style change.
- Traffic and AI rivals do not read the catalogue (they use the hull only).

## Audit table

| Vehicle ID | Current name | Geometry (actual) | Silhouette (from render) | Category (current class) | Distinctiveness | Problems | Redesign |
|---|---|---|---|---|---|---|---|
| kestrel-hatch | Finch S1 | body loft + tall greenhouse, round lights | Rounded minivan blob; reads as a people carrier, not a hatch | Hatchback | Tallest glasshouse of the set | Looks like a minivan. Rounded nose and bulbous body | Short bonnet, steep hatch, five-door cues, smaller wheels |
| vesper-c2 | Vesper C2 | low body + fastback greenhouse | Low, short coupe; similar to Rook RS from the side | Compact coupe | Lower roof | Close to Rook RS and Strata S | Longer bonnet, narrower shoulder line |
| rook-rs | Rook RS | body loft + roof scoop + wing | Near copy of Finch with a spoiler | Hot hatch | Spoiler only | Same body as Finch; no rally arches | Wide track, real arch flares, rally bumper |
| ember-gt | Ember GT | body loft + wing + gt spoiler | Long low wedge | Grand tourer | Wing | Looks like Talon V8 and Tempest from the side | Broad bonnet, squared cabin, haunches |
| strata-s | Strata S | body loft + dark roof | Two-box car, dark roof | Sport sedan | Roof colour | Four doors not visible; reads as a coupe | Three-box form, four window divisions |
| vandal-r | Vandal R | body loft + lip spoiler + hood vents | Flat wide body with roof vents | Muscle | Vents | No overfender geometry; not widebody | Real overfenders, splitter, diffuser |
| halcyon-gt | Nightfall GT | body loft + glass roof + wing | Long car with bright glass roof | Grand tourer | Glass roof, wing | Same as Ember GT silhouette | Long nose, rearward cabin, sweep roof |
| kestrel-mr | Kestrel MR | body loft + side intakes + ducktail | Short car with a rear hatch roof | Mid-engine | Intakes | Mid-engine not shown by cabin position | Cabin forward, haunches, intakes behind doors |
| grit-coupe | Talon V8 | body loft + wing + roof lights | Same body as Ember GT | Muscle coupe | Roof lights | Not separate from Ember GT | Upright muscle body, thick quarters |
| meridian-xr | Meridian XR | body loft + tall greenhouse | Long roof, reads as a wagon | Crossover | Long roof | Crossover looks like a van | Clear wagon cargo section |
| phantom-lx | Phantom LX | body loft + dark roof | Low, smooth body; roof is glass-coloured | Luxury GT | Dark roof | Almost identical to Obsidian X silhouette | Faceted nose, side channels |
| apex-t | Apex T | body loft + splitter + large wing | Low car with a big rear wing | Track car | Wing and glass roof | Wing is a box. Glass roof flat | Enclosed-wheel track body, real diffuser |
| volt-e | Voltaris E | body loft + glass roof | Low car with glass roof | Electric | Glass roof | Reads as Apex T and Nightfall | Clean closed nose, continuous glass |
| bastion-sedan | Sovereign S | body loft + tall greenhouse | Near copy of Strata S | Luxury sedan | Little | Not larger than Strata S in the render | Long wheelbase, separate boot |
| tarn-roadster | Zephyr R | body loft, low cabin, no roof | Open-looking cabin, low screen | Roadster | Open cabin | Cabin is a flat plate, no rollover hoops | Rebuild the upper body for an open car |
| obsidian-x | Obsidian X | body loft + black roof + wing | Same as Phantom LX with a wing | Hypercar | Wing | Duplicate of Phantom LX | Compact central cabin, large haunches |
| tempest-r | Tempest R | body loft + wing | Long body, near Havoc AWD | Track coupe | Little | Same as Havoc AWD | Very low nose, long narrow cabin |
| havoc-awd | Havoc AWD | body loft + roof | Near copy of Tempest R | All-wheel drive | Little | Duplicate of Tempest R | Wider fenders, planted stance |
| solstice-lm | Solstice LM | body loft + roof vent + wing | Same body as Apex T | Endurance GT | Roof box | Looks like Apex T | Prototype canopy, enclosed-wheel body |
| zenith-one | Zenith One | body loft + wing + roof box | Same body family as Ember GT | Ultimate | Roof box | Not a flagship silhouette | Original sculpted body |

## Summary of the audit

- The 20 cars are 20 variations of one body and one greenhouse. The biggest duplicate groups are Ember GT, Talon V8,
  Zenith One and Rook RS (same long wedge with a wing); Phantom LX and Obsidian X; Tempest R and Havoc AWD; Strata S and
  Sovereign S; Apex T and Solstice LM.
- Differences come from roof colour, a spoiler, or a box. A player cannot tell a rally car from a hatch, or a
  formula car from a road car, without the name.
- The hull is shared. Open-wheel cars, SUVs and flying cars do not fit the current hull without a per-vehicle hull.
- Not checked yet: the rear, top and silhouette views, and the garage camera framing at each class size.

## Decisions (answered by the user)

- **Collision hull: per design.** Each design gets its own hull. This touches road boundaries, traffic and pursuit,
  which read the hull, so it needs its own phase with tests.
- **Flying cars (33 to 36): modelled, not purchasable.** No flight controller in this pass. They stay out of the
  purchasable catalogue until a controller exists and has been driven in a browser.
- **First delivery: the 20 existing cars redesigned, plus 12 new ground cars (off-road 21 to 24, open-wheel 25 to 28, vintage 29 to 32). Flyers 33 to 36 are visual-only and deferred. Purchasable total: 32.**

## Next steps (not started)

1. Per-design hull: add the hull fields to the design profile, derive the collision footprint from them, update
   designHull()/validateDesign and the catalogue validator, and test road boundary and traffic with the new hulls.
2. Geometry recipes: add the missing parts (open-wheel exposed wheels, roadster cockpit, pickup bed, roof rack,
   overfenders, wings with pylons, vintage fenders) to bodyParts.ts, with tests for clearance.
3. Redesign the 20 existing cars, keeping the stable IDs. Review with the fleet harness (7 views plus a silhouette
   sheet) and check for duplicate silhouettes.
4. Add the 12 new ground cars, roster 21 to 32, with tiers, prices and performance bands. Check the catalogue validator. (Done in this pass; the 12 sit in the ultimate tier, see the tier note.)
5. Verify in a browser (garage framing, repeated switching, purchase and save), and run npm run check.

## Known problem found while auditing

- The brief's IDs and names differ from the code. Nightfall GT is `halcyon-gt`, Talon V8 is `grit-coupe`, Sovereign S is
  `bastion-sedan`, Zephyr R is `tarn-roadster`, Voltaris E is `volt-e`, and Finch S1 is `kestrel-hatch`. The code IDs are
  kept, because save files store them.

## Pass 2 status (this tranche)

- Done: 12 new ground cars (roster 21 to 32, ultimate tier, prices 10,000 to 15,500). Their handling values give performance indices from 1.340 to 1.396, all inside the ultimate band. Zenith One is at 1.396 and is the closest neighbour to 21.
- Done: duplicate-pair reshape for 12 original cars (Finch S1, Ember GT, Talon V8, Zenith One, Apex T, Solstice LM, Phantom LX, Obsidian X, Tempest R, Havoc AWD, Strata S, Sovereign S). Hulls and handling are unchanged on the originals.
- Measured: silhouette profile RMS (absolute metres, using each car's hull) is 0.053 m or more for every pair. The check is `/tmp/profile_m.py`, which reads the design data. Pixel IoU on bounding-box-normalised renders is not usable: every pair scores 0.87 or higher.
- Seen by eye (side3q contact sheet): Sovereign S, Havoc AWD and Meridian XR are now clearly different. Finch S1 still reads close to a van. Strata S, Tempest R and Zenith One are similar at contact-sheet size. Rear, top and front views are not yet reviewed.
- Gates: `npm run check` exit 0 (156 files, 1,670 tests).
- Open: Finch S1 greenhouse, the rear, top and front review of all 32, flyers 33 to 36, and the garage class filters.

## Pass 3

> Stale: this pass's silhouettes were superseded by the redesign pass below (Pass 5). Kept for history.

- Finch S1 (kestrel-hatch): shorter greenhouse peaking forward, steep tail. It now reads as a short hatch, not a van. Still a first pass: the rear view is not reviewed.
- `designProfile.test.ts`: the spoiler-clearance test set the cabin start to 0.15, which was a no-op once Finch's cabin started at 0.2. It now sets the rear station to 0.1 explicitly.
- Garage: all 12 new cars and the original cars are listed in the running game (`play.html`, press V). No page or console errors.
- Forest: the user chose 100 to 150 per centre cell, which is the current code (120 per cell, 16 centre cells, 1,920 pines in the centre). The Division 2 plan already states these numbers.
- Gates: `npm run check` exit 0 (156 files, 1,670 tests).

## Pass 4: top speed envelope 150 to 300 km/h

- Limits: `SPEC_LIMITS.maxForwardSpeedMps` is 150 / 3.6 to 300 / 3.6 m/s (`specLimits.ts`). No car may be slower or faster.
- Catalogue ladder: roster 01 (Finch S1, stock) keeps the stock 62 m/s (223.2 km/h). Roster 32 is 300 km/h. The rest rise in equal steps of about 2.5 km/h by roster.
- Each car keeps its performance index from before, so the tier bands and the neighbour gaps still hold. Lateral grip absorbs the change in top speed. Zenith One keeps lateral 20 and braking 26 (index 1.3914, inside the ultimate band).
- Engine fade speed is top speed plus 12 m/s, capped at 95 m/s (the SPEC limit).
- Tests: `rosterChecks.test.ts` now scopes the "ultimate car is strongest" check to the original 20, as `carDriving.test.ts` already does.

## Pass 4: open items from the earlier list

| Item | Status | Evidence |
|---|---|---|
| Approach card must not open for locked or hidden races | Closed. The controller skips hidden markers, and the test that was missing now exists. | `raceController.test.ts` "a hidden race never opens its approach card" (passes). Not mutation-tested. |
| Navigation shows the shortest path | Closed in code | `src/navigation/navigationShortest.test.ts` |
| All 4 lanes in race and pursuit | Closed in code | `policeRouting.test.ts`, `raceRouteDiversity.test.ts`, `raceCircuit.test.ts` |
| Race grid of 2 lanes | Closed in code | `RACE_GRID_LANES = 2`, `grid.test.ts` |
| 10 cars including the player, player 7th | Closed in code | `RACE_MIN_RACERS = 10`, `RACE_PLAYER_GRID_POSITION = 7`, `raceRules.test.ts` |
| Garage ENTER GAME goes to home page | Fixed. ENTER GAME from the garage now starts the entry in one press. | Browser check: GARAGE, then ENTER GAME, reaches the running game with the HUD and no errors. The bug was reproduced by reading the code, not in the browser before the fix. |

Browser play of race and pursuit has not been done for this pass. The statuses above are code and test evidence only.


## Pass 5: redesign of the originals, silhouette check (not accepted)

- **Scope, as found in the data.** Diff against the pre-redesign backup (`/tmp/vehicleDesigns.before.ts`) shows 14 original designs changed in body or cabin stations: kestrel-hatch, ember-gt, strata-s, grit-coupe, meridian-xr, phantom-lx, apex-t, volt-e, bastion-sedan, obsidian-x, tempest-r, havoc-awd, solstice-lm, zenith-one. Earlier notes said 11. The intended list was not recorded, so the count is reported as found. Unchanged: vesper-c2, rook-rs, halcyon-gt, kestrel-mr, vandal-r, tarn-roadster.
- **Accidental change reverted.** `vector-gp` (a new ground car, not an original) had its body and cabin stations changed by the same edit. Restored from the backup. The pre-revert copy is `/tmp/vehicleDesigns.current_before_vector_revert.ts`.
- **Validation.** `npx vitest run src/vehicles` passes alone (5 files, 49 tests), three runs in a row. The two failures seen earlier do not reproduce. Their cause is unknown and is not claimed as fixed.
- **Renders.** `/home/user/fleet-audit/pass4/` (80 PNGs: 16 cars x side3q, rear3q, top, front, silhouette). Cars: the 14 changed originals plus monarch-68 and copperhead-v8. Contact sheet: `/home/user/fleet-audit/pass4_contact_sheet.png`. Silhouette grid: `/home/user/fleet-audit/pass4_silhouette_grid.png`.
- **Silhouette overlap (IoU, fixed camera, silhouette view).** Highest pairs: kestrel-hatch / bastion-sedan 0.87, meridian-xr / bastion-sedan 0.86, kestrel-hatch / strata-s 0.86, kestrel-hatch / grit-coupe 0.86, tempest-r / solstice-lm 0.86, strata-s / grit-coupe 0.86. This measure is weak evidence because the camera and frame are shared. Visually, kestrel-hatch, bastion-sedan, meridian-xr, strata-s and copperhead-v8 still read as one wedge-shaped wagon.
- **Status.** The "distinct silhouette per vehicle" requirement is NOT met yet. No pass threshold is set. The redesign needs another geometry pass on the wagon group, then a pair review by the user.
