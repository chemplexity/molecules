/** @module families/bridged */

import { centroid } from '../geometry/vec2.js';
import { layoutKamadaKawai } from '../geometry/kk-layout.js';
import { projectBridgePaths } from './bridge-projection.js';
import { placeTemplateCoords } from '../scaffold/template-placement.js';

/**
 * Places a bridged or caged ring system using matched template coordinates
 * when available, then falls back to a Kamada-Kawai seed for unmatched cases.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {number} bondLength - Target bond length.
 * @param {{layoutGraph?: object, templateId?: string|null}} [options] - Placement options.
 * @returns {{coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null} Placement result.
 */
export function layoutBridgedFamily(rings, bondLength, options = {}) {
  if (rings.length === 0 || !options.layoutGraph) {
    return null;
  }
  const atomIds = [...new Set(rings.flatMap(ring => ring.atomIds))];
  const templateCoords = placeTemplateCoords(options.layoutGraph, options.templateId, atomIds, bondLength);
  if (templateCoords) {
    const ringCenters = new Map();
    for (const ring of rings) {
      ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => templateCoords.get(atomId))));
    }
    return {
      coords: templateCoords,
      ringCenters,
      placementMode: 'template'
    };
  }

  const kkResult = layoutKamadaKawai(options.layoutGraph.sourceMolecule, atomIds, {
    bondLength
  });
  if (!kkResult.ok) {
    return null;
  }

  const projected = projectBridgePaths(options.layoutGraph, atomIds, kkResult.coords, bondLength);

  const ringCenters = new Map();
  for (const ring of rings) {
    ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => projected.coords.get(atomId))));
  }
  return {
    coords: projected.coords,
    ringCenters,
    placementMode: 'projected-kamada-kawai'
  };
}
