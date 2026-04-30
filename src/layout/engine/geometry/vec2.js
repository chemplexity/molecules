/** @module geometry/vec2 */

/**
 * Creates a 2D vector object.
 * @param {number} x - X coordinate.
 * @param {number} y - Y coordinate.
 * @returns {{x: number, y: number}} Vector object.
 */
export function vec(x, y) {
  return { x, y };
}

/**
 * Adds two vectors.
 * @param {{x: number, y: number}} first - First vector.
 * @param {{x: number, y: number}} second - Second vector.
 * @returns {{x: number, y: number}} Sum vector.
 */
export function add(first, second) {
  return { x: first.x + second.x, y: first.y + second.y };
}

/**
 * Subtracts one vector from another.
 * @param {{x: number, y: number}} first - First vector.
 * @param {{x: number, y: number}} second - Second vector.
 * @returns {{x: number, y: number}} Difference vector.
 */
export function sub(first, second) {
  return { x: first.x - second.x, y: first.y - second.y };
}

/**
 * Scales a vector by a scalar.
 * @param {{x: number, y: number}} value - Input vector.
 * @param {number} scalar - Scalar multiplier.
 * @returns {{x: number, y: number}} Scaled vector.
 */
export function scale(value, scalar) {
  return { x: value.x * scalar, y: value.y * scalar };
}

/**
 * Returns the Euclidean length of a vector.
 * @param {{x: number, y: number}} value - Input vector.
 * @returns {number} Vector length.
 */
export function length(value) {
  return Math.hypot(value.x, value.y);
}

/**
 * Returns the distance between two vectors.
 * @param {{x: number, y: number}} first - First point.
 * @param {{x: number, y: number}} second - Second point.
 * @returns {number} Euclidean distance.
 */
export function distance(first, second) {
  return length(sub(first, second));
}

/**
 * Returns a normalized vector, or the zero vector if input length is zero.
 * @param {{x: number, y: number}} value - Input vector.
 * @returns {{x: number, y: number}} Unit vector.
 */
export function normalize(value) {
  const magnitude = length(value);
  if (magnitude <= 1e-12) {
    return { x: 0, y: 0 };
  }
  return scale(value, 1 / magnitude);
}

/**
 * Returns the vector angle in radians.
 * @param {{x: number, y: number}} value - Input vector.
 * @returns {number} Polar angle in radians.
 */
export function angleOf(value) {
  return Math.atan2(value.y, value.x);
}

/**
 * Creates a vector from polar coordinates.
 * @param {number} angle - Polar angle in radians.
 * @param {number} magnitude - Vector length.
 * @returns {{x: number, y: number}} Vector value.
 */
export function fromAngle(angle, magnitude = 1) {
  return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
}

/**
 * Rotates a vector by an angle in radians.
 * @param {{x: number, y: number}} value - Input vector.
 * @param {number} angle - Rotation angle.
 * @returns {{x: number, y: number}} Rotated vector.
 */
export function rotate(value, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: value.x * cosine - value.y * sine,
    y: value.x * sine + value.y * cosine
  };
}

/**
 * Returns the midpoint of two points.
 * @param {{x: number, y: number}} first - First point.
 * @param {{x: number, y: number}} second - Second point.
 * @returns {{x: number, y: number}} Midpoint.
 */
export function midpoint(first, second) {
  return scale(add(first, second), 0.5);
}

/**
 * Returns the centroid of a point list.
 * @param {Array<{x: number, y: number}>} points - Input points.
 * @returns {{x: number, y: number}} Centroid.
 */
export function centroid(points) {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }
  const sum = points.reduce((accumulator, point) => add(accumulator, point), { x: 0, y: 0 });
  return scale(sum, 1 / points.length);
}

/**
 * Returns the left-hand perpendicular vector.
 * @param {{x: number, y: number}} value - Input vector.
 * @returns {{x: number, y: number}} Perpendicular vector.
 */
export function perpLeft(value) {
  return { x: -value.y, y: value.x };
}

/**
 * Wraps an angle into the (-pi, pi] interval.
 * @param {number} angle - Input angle.
 * @returns {number} Wrapped angle.
 */
export function wrapAngle(angle) {
  let result = angle;
  while (result <= -Math.PI) {
    result += 2 * Math.PI;
  }
  while (result > Math.PI) {
    result -= 2 * Math.PI;
  }
  return result;
}

/**
 * Wraps an angle into the [0, 2*pi) interval.
 * @param {number} angle - Input angle.
 * @returns {number} Wrapped angle.
 */
export function wrapAngleUnsigned(angle) {
  let result = angle % (2 * Math.PI);
  if (result < 0) {
    result += 2 * Math.PI;
  }
  return result;
}

/**
 * Returns the absolute angular difference between two directions.
 * @param {number} firstAngle - First angle in radians.
 * @param {number} secondAngle - Second angle in radians.
 * @returns {number} Absolute wrapped angular difference.
 */
export function angularDifference(firstAngle, secondAngle) {
  return Math.abs(wrapAngle(firstAngle - secondAngle));
}
