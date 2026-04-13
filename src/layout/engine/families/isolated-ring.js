/** @module families/isolated-ring */

import { placeRegularPolygon } from '../geometry/polygon.js';
import { centroid } from '../geometry/vec2.js';
import { placeTemplateCoords } from '../templates/placement.js';

/**
 * Places a single isolated ring as a regular polygon centered near the origin.
 * @param {object} ring - Ring descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {{layoutGraph?: object, templateId?: string|null}} [options] - Placement options.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>}} Placement result.
 */
export function layoutIsolatedRingFamily(ring, bondLength, options = {}) {
  const templateCoords = options.layoutGraph ? placeTemplateCoords(options.layoutGraph, options.templateId, ring.atomIds, bondLength) : null;
  const coords = templateCoords ?? placeRegularPolygon(ring.atomIds, { x: 0, y: 0 }, bondLength);
  return {
    coords,
    ringCenters: new Map([[ring.id, centroid([...coords.values()])]]),
    placementMode: templateCoords ? 'template' : 'constructed'
  };
}
