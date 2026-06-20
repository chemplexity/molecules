/** @module app/interactions/draw-bond-placement */

export const TAU = Math.PI * 2;

/**
 * Normalizes an angle into the [0, 2pi) range.
 * @param {number} angle - Input angle in radians.
 * @returns {number} Normalized angle in radians.
 */
export function normalizeAngle(angle) {
  const normalized = angle % TAU;
  return normalized < 0 ? normalized + TAU : normalized;
}

/**
 * Measures the smallest angular separation between two angles.
 * @param {number} firstAngle - First angle in radians.
 * @param {number} secondAngle - Second angle in radians.
 * @returns {number} Absolute angular difference in radians.
 */
export function angularDifference(firstAngle, secondAngle) {
  let diff = Math.abs(normalizeAngle(firstAngle) - normalizeAngle(secondAngle));
  if (diff > Math.PI) {
    diff = TAU - diff;
  }
  return diff;
}

/**
 * Chooses a no-drag bond auto-placement angle from visible heavy-neighbor
 * directions. A terminal atom uses the zigzag side opposite its existing bond
 * instead of capping both bonds onto the same side of the source atom.
 * @param {number[]} existingAngles - Angles from source atom to existing heavy neighbors.
 * @param {number} [steps] - Number of compass samples for crowded multi-neighbor placement.
 * @returns {number} Placement angle in radians normalized to [0, 2pi).
 */
export function chooseAutoPlacedBondAngle(existingAngles, steps = 12) {
  if (existingAngles.length === 0) {
    return (11 / 12) * TAU;
  }
  if (existingAngles.length === 1) {
    const back = existingAngles[0];
    const opt1 = back + (2 * Math.PI) / 3;
    const opt2 = back - (2 * Math.PI) / 3;
    const sBack = Math.sin(back);
    const s1 = Math.sin(opt1);
    const s2 = Math.sin(opt2);
    if (Math.abs(sBack) > 1e-6) {
      const opposite1 = s1 * sBack < 0;
      const opposite2 = s2 * sBack < 0;
      if (opposite1 && !opposite2) {
        return normalizeAngle(opt1);
      }
      if (opposite2 && !opposite1) {
        return normalizeAngle(opt2);
      }
      return normalizeAngle(Math.cos(opt1) >= Math.cos(opt2) ? opt1 : opt2);
    }
    return normalizeAngle(s1 <= s2 ? opt1 : opt2);
  }

  let bestAngle = 0;
  let bestMinSep = -1;
  for (let i = 0; i < steps; i++) {
    const candidate = (i / steps) * TAU;
    let minSep = Math.PI;
    for (const angle of existingAngles) {
      minSep = Math.min(minSep, angularDifference(candidate, angle));
    }
    if (minSep > bestMinSep) {
      bestMinSep = minSep;
      bestAngle = candidate;
    }
  }
  return bestAngle;
}
