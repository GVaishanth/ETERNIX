/*
 * Road surfaces (Division 2). A dirt road costs the car 5% of its top speed and 5% of its grip (handling). In rain the
 * dirt costs 15%. That 15% is the total for a wet dirt road, not 5% plus 15%: the two values are the ends of one scale,
 * and the wetness of the weather moves the car along it.
 */
export const DIRT_DRY_REDUCTION = 0.05;
export const DIRT_WET_REDUCTION = 0.15;
