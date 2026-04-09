/** @module geometry/bounds */

/**
 * Computes an axis-aligned bounding box for a coordinate map.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Atom IDs to include.
 * @returns {{minX: number, maxX: number, minY: number, maxY: number, width: number, height: number, centerX: number, centerY: number}|null} Bounds or null.
 */
export function computeBounds(coords, atomIds) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    found = true;
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y);
  }

  if (!found) {
    return null;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

/**
 * Returns a translated copy of selected coordinates.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string[]} atomIds - Atom IDs to translate.
 * @param {number} dx - X translation.
 * @param {number} dy - Y translation.
 * @returns {Map<string, {x: number, y: number}>} Translated coordinate map.
 */
export function translateCoords(coords, atomIds, dx, dy) {
  const translated = new Map(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    translated.set(atomId, { x: position.x + dx, y: position.y + dy });
  }
  return translated;
}
