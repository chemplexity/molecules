/** @module geometry/ellipse */

/**
 * Returns a point on an axis-aligned ellipse.
 * @param {{x: number, y: number}} center - Ellipse center.
 * @param {number} semiMajor - Semi-major radius.
 * @param {number} semiMinor - Semi-minor radius.
 * @param {number} angle - Parameter angle in radians.
 * @returns {{x: number, y: number}} Ellipse point.
 */
export function ellipsePoint(center, semiMajor, semiMinor, angle) {
  return {
    x: center.x + Math.cos(angle) * semiMajor,
    y: center.y + Math.sin(angle) * semiMinor
  };
}

/**
 * Returns equally spaced perimeter points around an ellipse by arc length.
 * @param {number} size - Number of points to sample.
 * @param {number} semiMajor - Semi-major radius.
 * @param {number} semiMinor - Semi-minor radius.
 * @param {number} startAngle - Start angle in radians.
 * @returns {Array<{x: number, y: number}>} Perimeter points centered at the origin.
 */
function sampleEllipsePerimeter(size, semiMajor, semiMinor, startAngle) {
  const sampleCount = Math.max(size * 64, 256);
  const sampledPoints = [];
  const cumulativeLengths = [0];
  for (let index = 0; index <= sampleCount; index++) {
    const angle = startAngle + ((index / sampleCount) * Math.PI * 2);
    sampledPoints.push(ellipsePoint({ x: 0, y: 0 }, semiMajor, semiMinor, angle));
    if (index === 0) {
      continue;
    }
    const firstPoint = sampledPoints[index - 1];
    const secondPoint = sampledPoints[index];
    cumulativeLengths.push(
      cumulativeLengths[index - 1] + Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y)
    );
  }

  const perimeter = cumulativeLengths[cumulativeLengths.length - 1];
  const spacing = perimeter / size;
  const points = [];
  let segmentIndex = 1;

  for (let pointIndex = 0; pointIndex < size; pointIndex++) {
    const targetLength = pointIndex * spacing;
    while (segmentIndex < cumulativeLengths.length - 1 && cumulativeLengths[segmentIndex] < targetLength) {
      segmentIndex++;
    }
    const previousLength = cumulativeLengths[segmentIndex - 1];
    const nextLength = cumulativeLengths[segmentIndex];
    const span = Math.max(nextLength - previousLength, 1e-12);
    const fraction = (targetLength - previousLength) / span;
    const firstPoint = sampledPoints[segmentIndex - 1];
    const secondPoint = sampledPoints[segmentIndex];
    points.push({
      x: firstPoint.x + ((secondPoint.x - firstPoint.x) * fraction),
      y: firstPoint.y + ((secondPoint.y - firstPoint.y) * fraction)
    });
  }

  return points;
}

/**
 * Returns the average chord length around a regular sampling of an ellipse.
 * @param {number} size - Number of points around the ellipse.
 * @param {number} semiMajor - Semi-major radius.
 * @param {number} semiMinor - Semi-minor radius.
 * @param {number} startAngle - Start angle in radians.
 * @returns {number} Average chord length.
 */
export function averageEllipseChordLength(size, semiMajor, semiMinor, startAngle) {
  const points = sampleEllipsePerimeter(size, semiMajor, semiMinor, startAngle);
  let total = 0;
  for (let index = 0; index < points.length; index++) {
    const firstPoint = points[index];
    const secondPoint = points[(index + 1) % points.length];
    total += Math.hypot(secondPoint.x - firstPoint.x, secondPoint.y - firstPoint.y);
  }
  return total / size;
}

/**
 * Solves the ellipse scale whose average chord length matches the target bond length.
 * @param {number} size - Number of sampled points.
 * @param {number} bondLength - Target average chord length.
 * @param {number} aspectRatio - Ellipse aspect ratio.
 * @param {number} startAngle - Start angle in radians.
 * @returns {number} Base scale value.
 */
export function solveEllipseScale(size, bondLength, aspectRatio, startAngle) {
  let low = bondLength * 0.25;
  let high = bondLength * size;
  while (averageEllipseChordLength(size, high * aspectRatio, high / aspectRatio, startAngle) < bondLength) {
    high *= 1.5;
    if (high > bondLength * size * 8) {
      break;
    }
  }
  for (let iteration = 0; iteration < 32; iteration++) {
    const mid = (low + high) * 0.5;
    const average = averageEllipseChordLength(size, mid * aspectRatio, mid / aspectRatio, startAngle);
    if (average < bondLength) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return high;
}

/**
 * Returns the default macrocycle ellipse aspect ratio for a ring size.
 * @param {number} size - Macrocycle size.
 * @returns {number} Suggested aspect ratio.
 */
export function macrocycleAspectRatio(size) {
  if (size <= 12) {
    return 1.0;
  }
  if (size <= 16) {
    return 1.15;
  }
  if (size <= 20) {
    return 1.30;
  }
  if (size <= 26) {
    return 1.50;
  }
  return Math.min(1.80, 1.50 + ((size - 26) * 0.015));
}

/**
 * Returns translated equally spaced perimeter points around an ellipse.
 * @param {{x: number, y: number}} center - Ellipse center.
 * @param {number} size - Number of points to sample.
 * @param {number} semiMajor - Semi-major radius.
 * @param {number} semiMinor - Semi-minor radius.
 * @param {number} startAngle - Start angle in radians.
 * @returns {Array<{x: number, y: number}>} Perimeter points translated to the requested center.
 */
export function ellipsePerimeterPoints(center, size, semiMajor, semiMinor, startAngle) {
  return sampleEllipsePerimeter(size, semiMajor, semiMinor, startAngle).map(point => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
}
