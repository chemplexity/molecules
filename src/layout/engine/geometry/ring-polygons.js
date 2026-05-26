/** @module geometry/ring-polygons */

/**
 * Returns placed incident-ring polygons for an atom without intermediate
 * map/filter arrays.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>|object} coords - Coordinate map or map-like object.
 * @param {string} atomId - Atom identifier.
 * @returns {Array<Array<{x: number, y: number}>>} Incident ring polygons.
 */
export function incidentRingPolygonsForAtom(layoutGraph, coords, atomId) {
  if (!layoutGraph || !coords?.has?.(atomId)) {
    return [];
  }
  const polygons = [];
  for (const ring of layoutGraph.atomToRings.get(atomId) ?? []) {
    const polygon = [];
    for (const ringAtomId of ring.atomIds ?? []) {
      const position = coords.get(ringAtomId);
      if (position) {
        polygon.push(position);
      }
    }
    if (polygon.length >= 3) {
      polygons.push(polygon);
    }
  }
  return polygons;
}
