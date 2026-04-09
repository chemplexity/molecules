/** @module geometry/polygon */

import { add, fromAngle } from './vec2.js';

/**
 * Returns the circumradius of a regular polygon for a target edge length.
 * @param {number} size - Polygon vertex count.
 * @param {number} edgeLength - Target edge length.
 * @returns {number} Circumradius.
 */
export function circumradiusForRegularPolygon(size, edgeLength) {
  if (!Number.isInteger(size) || size < 3) {
    throw new RangeError(`Regular polygon size must be an integer >= 3, got ${JSON.stringify(size)}.`);
  }
  return edgeLength / (2 * Math.sin(Math.PI / size));
}

/**
 * Returns the apothem of a regular polygon for a target edge length.
 * @param {number} size - Polygon vertex count.
 * @param {number} edgeLength - Target edge length.
 * @returns {number} Apothem.
 */
export function apothemForRegularPolygon(size, edgeLength) {
  const radius = circumradiusForRegularPolygon(size, edgeLength);
  return radius * Math.cos(Math.PI / size);
}

/**
 * Places the vertices of a regular polygon around a center point.
 * @param {string[]} atomIds - Ordered polygon vertex IDs.
 * @param {{x: number, y: number}} center - Polygon center.
 * @param {number} edgeLength - Target edge length.
 * @param {number} [startAngle] - Starting angle for the first vertex.
 * @returns {Map<string, {x: number, y: number}>} Vertex coordinates.
 */
export function placeRegularPolygon(atomIds, center, edgeLength, startAngle = Math.PI / 2) {
  const radius = circumradiusForRegularPolygon(atomIds.length, edgeLength);
  const step = (2 * Math.PI) / atomIds.length;
  const coords = new Map();
  for (let index = 0; index < atomIds.length; index++) {
    coords.set(atomIds[index], add(center, fromAngle(startAngle + (index * step), radius)));
  }
  return coords;
}
