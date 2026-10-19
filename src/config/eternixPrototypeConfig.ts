/*
 * Tuning for the ETERNIX landing and loading prototype (src/prototype/eternix). Data only. Lengths in metres, times in
 * seconds, angles in radians. The prototype is a development preview. Nothing here changes gameplay or physics.
 */

export const ETERNIX_PROTOTYPE_CONFIG = {
  /** The game's modules start loading this long after the landing appears, so ENTER GAME is usually instant. */
  preloadGameAfterMs: 900,
  /** ENTER GAME: the camera moves from where it is to the back view, over this many seconds. */
  handoffMoveSeconds: 3,
  /** Then the translucent loading page holds for at least this many seconds while the game loads behind it. */
  handoffLoadSeconds: 3,
  /** The loading bars complete one at a time. Each takes a random time in this range (seconds). */
  loadingBarMinSeconds: 0.3,
  loadingBarMaxSeconds: 0.7,
  /** A camera already within this angle of the back view turns a full 360 degrees instead of a short swing. */
  handoffBackViewRadians: 0.2,
  /** The loading page and the front page fade over this long when the game is revealed. */
  revealFadeMs: 450,
  /** A slow lateral drift of the hero camera. Amplitude in radians, period in seconds. Off under reduced motion. */
  heroDriftRadians: 0.03,
  heroDriftPeriodSeconds: 22,
  /**
   * The landing camera cycles through seven fixed views (see heroViews.ts). The view changes every interval. Under
   * reduced motion it cuts to the next view; otherwise it swings there.
   */
  heroViews: {
    intervalSeconds: 15,
    /** How fast the camera swings to a new view (1/s). About 95% of the way in 1.2 s. */
    swingRatePerSecond: 2.6,
    /** Camera distance from the car centre, in car lengths, before each view's own distance scale. */
    distanceInCarLengths: 3,
  },
  /** Upper limit on the canvas pixel ratio. The hero is a static scene, so this stays low. */
  maxPixelRatio: 1.5,
  camera: {
    fovDegrees: 30,
    nearMeters: 0.1,
    farMeters: 600,
    /** Low rear three-quarter view. A low camera shows the stance and body, and the cabin reads less dominant. */
    positionMeters: [-7.4, 1.15, -10.2] as const,
    /** Where the camera looks. Offset so the car sits right of centre on wide screens. */
    targetWideMeters: [2.7, 0.55, 0] as const,
    /** Mobile and portrait: the car is centred in the frame above the controls. */
    targetNarrowMeters: [1.8, 0.55, 0] as const,
    /** Below this width/height ratio the narrow framing is used. */
    narrowAspectRatio: 0.9,
    /** Narrow frames also pull the camera back by this factor, so the car fits. */
    narrowZoomScale: 1.4,
  },
  light: {
    /** Strength of the studio reflections on the paint and glass. */
    environmentIntensity: 0.3,
    skyHemisphere: '#34466a',
    groundHemisphere: '#06080c',
    hemisphereIntensity: 0.8,
    keyPosition: [-5, 9, -6] as const,
    keyIntensity: 2.4,
    rimPosition: [5, 4, 9] as const,
    rimIntensity: 1.1,
    colourRim: '#8fb2e6',
  },
  road: {
    /** The game's road is 14.4 m wide with 3.6 m lanes (4 lanes). The stage matches that scale. */
    widthMeters: 14.4,
    lengthMeters: 520,
    centreLineGapMeters: 0.18,
    edgeInsetMeters: 0.35,
    lineWidthMeters: 0.14,
    dashLengthMeters: 3,
    dashPeriodMeters: 12,
    kerbWidthMeters: 0.35,
    kerbHeightMeters: 0.14,
    /** Wet-looking asphalt: low roughness picks up the lamps and the sky. */
    asphaltRoughness: 0.42,
    /** Centre of the right-hand lane. The hero car sits here, not on the centre line. */
    laneCentreMeters: 1.8,
    /** Lane centres across the road, metres from the centre line. Left lanes carry the red trails, right lanes the white. */
    laneOffsetsMeters: [-5.4, -1.8, 1.8, 5.4] as const,
  },
  scenery: {
    /** Fixed seed, so the street is the same on every load. */
    seed: 20261017,
    buildingSetbackMeters: 15,
    buildingSpacingMeters: 26,
    buildingMinHeightMeters: 10,
    buildingMaxHeightMeters: 26,
    buildingMinDepthMeters: 14,
    buildingMaxDepthMeters: 26,
    windowRowMeters: 3.4,
    windowColumnMeters: 3.6,
    windowLitChance: 0.2,
    /** The far skyline, behind the near buildings. Taller and denser, so the city reads as lit in the distance. */
    farSetbackMeters: 70,
    farSpacingMeters: 24,
    farMinHeightMeters: 50,
    farMaxHeightMeters: 120,
    farLitChance: 0.36,
    lampSpacingMeters: 34,
    lampHeightMeters: 8.5,
    lampSetbackMeters: 1,
    /** Light trails in each lane: thin boxes on the asphalt, spaced along the road with random lengths. */
    trailSpacingMeters: 9,
    trailMinLengthMeters: 8,
    trailMaxLengthMeters: 24,
    trailHeightMeters: 0.02,
    trailWidthMeters: 0.14,
    /** Trails are kept in this band ahead of the camera, so none sits under the lens. */
    trailZMinMeters: -8,
    trailZMaxMeters: 60,
  },
  /**
   * The hero car: an original procedural model for this prototype only. It is not the game's VehicleVisual, and it
   * does not change the car's stats or the garage. Length runs along z (nose at +z), width along x, height along y.
   */
  heroCar: {
    wheelbaseMeters: 2.5,
    /** Distance between the wheel centres across the car. The wheels sit slightly outside the body. */
    trackMeters: 1.6,
    wheelRadiusMeters: 0.32,
    wheelWidthMeters: 0.24,
    rimRadiusMeters: 0.19,
    spokeCount: 5,
    bodyWidthMeters: 1.8,
    cabinWidthMeters: 1.56,
    /** Visible side skirt under the body line. */
    skirtHeightMeters: 0.06,
    /** Smooth-surface settings. More stations and ring points give smoother curves, at a small vertex cost. */
    stations: 44,
    ringSegments: 40,
    /** Superellipse exponent for the cross-sections. Higher values give flatter sides and tighter shoulders. */
    superellipseExponent: 2.8,
  },
  colours: {
    ground: '#0b0c10',
    pavement: '#1a1c23',
    asphalt: '#262a33',
    trailRed: '#ff3b2e',
    trailWhite: '#f2efe6',
    kerb: '#4a525e',
    buildingBase: '#1c2431',
    windowWarm: '#c58648',
    lampLight: '#ffd7a1',
    paint: '#e9edf2',
    centreLine: '#d9a93a',
    /** Used only if a saved paint id is unknown. Matches the factory paint of the starter car. */
    fallbackPaint: '#b3261e',
  },
  /** A red point light at the tail. It lights the road behind the car, so the trail reads as a reflection on wet asphalt. */
  tailLight: {
    rearMeters: 2.7,
    heightMeters: 0.6,
    intensity: 2.5,
    distanceMeters: 10,
  },
  /**
   * Reflections for the paint and the wet road. A small room of light panels is turned into an environment map. Each
   * panel: colour, centre in metres, size in metres, and brightness (a multiplier on the colour).
   */
  environment: {
    wallColour: '#0b0e14',
    panels: [
      { colour: '#ffb774', position: [-18, 9, -14], size: [9, 12], brightness: 4 },
      { colour: '#ff3b2e', position: [16, 5, 12], size: [4, 6], brightness: 5 },
      { colour: '#7fa6e0', position: [12, 12, -16], size: [12, 6], brightness: 1.8 },
      { colour: '#ffd7a1', position: [0, 17, 0], size: [20, 4], brightness: 1.2 },
    ] as const,
  },
  /** The garage view: one car on a dark glossy floor, lit by a warm key and a red rim. */
  showroom: {
    radiusMeters: 9.5,
    /** Moves the car right of centre, so the garage text on the left stays clear of it. */
    framingShiftMeters: 1,
    /** Below this width/height ratio (phones), the car is framed smaller and lifted above the garage text. */
    portraitAspect: 0.9,
    portraitRadiusScale: 2.1,
    portraitLiftMeters: 0.9,
    /** No sideways aim on phones, so the car is not cropped at the edge. */
    portraitFramingShiftMeters: 0,
    heightMeters: 1.3,
    targetHeightMeters: 0.55,
    /** How fast the camera swings to a new view (1/s). */
    orbitRatePerSecond: 3.2,
    backgroundColour: '#07090d',
    floorColour: '#0c0f15',
    floorRoughness: 0.32,
    keyPosition: [2.5, 7, -3] as const,
    keyColour: '#fff1dc',
    keyIntensity: 2.2,
    rimPosition: [-3.5, 1.6, -4.5] as const,
    rimIntensity: 6,
    fillPosition: [4, 2, 4] as const,
    fillColour: '#7fa6e0',
    fillIntensity: 2,
  },
  fog: { nearMeters: 30, farMeters: 300 },
} as const;
