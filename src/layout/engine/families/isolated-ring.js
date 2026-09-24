/** @module families/isolated-ring */

import { placeRegularPolygon } from '../geometry/polygon.js';
import { centroid } from '../geometry/vec2.js';
import { placeTemplateCoords } from '../templates/placement.js';
import { placeConstrainedRing } from '../geometry/constrained-ring.js';

/**
 * Places an isolated ring from a template/polygon, solving free positions around
 * three or more fixed anchors when constrained geometry is supplied.
 * @param {object} ring - Ring descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {{layoutGraph?: object, templateId?: string|null}} [options] - Placement options.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>}} Placement result.
 */
export function layoutIsolatedRingFamily(ring, bondLength, options = {}) {
  const templateCoords = options.layoutGraph ? placeTemplateCoords(options.layoutGraph, options.templateId, ring.atomIds, bondLength) : null;
  const seed = templateCoords ?? placeRegularPolygon(ring.atomIds, { x: 0, y: 0 }, bondLength);
  const constrained = placeConstrainedRing(options.layoutGraph, ring, seed, bondLength);
  const coords = constrained ?? seed;
  return {
    coords,
    ringCenters: new Map([[ring.id, centroid([...coords.values()])]]),
    placementMode: constrained ? 'constrained-ring' : templateCoords ? 'template' : 'constructed'
  };
}
