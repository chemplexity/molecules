/** @module families/bridged */

import { centroid } from '../geometry/vec2.js';
import { layoutKamadaKawai } from '../geometry/kk-layout.js';
import { projectBridgePaths } from './bridge-projection.js';
import { placeTemplateCoords } from '../scaffold/template-placement.js';

/**
 * Builds the KK seed map and fixed pin list for a bridged component from the
 * current refinement/fixed-coordinate context.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Bridged component atom IDs.
 * @returns {{coords: Map<string, {x: number, y: number}>, pinnedAtomIds: string[]}} Seed coordinates and pinned atom IDs.
 */
function bridgedKamadaKawaiSeeds(layoutGraph, atomIds) {
  const coords = new Map();
  const pinnedAtomIds = [];

  for (const atomId of atomIds) {
    const fixedPosition = layoutGraph.fixedCoords.get(atomId);
    if (fixedPosition) {
      coords.set(atomId, { ...fixedPosition });
      pinnedAtomIds.push(atomId);
      continue;
    }
    const existingPosition = layoutGraph.options.existingCoords.get(atomId);
    if (existingPosition) {
      coords.set(atomId, { ...existingPosition });
    }
  }

  return { coords, pinnedAtomIds };
}

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

  const kkSeeds = bridgedKamadaKawaiSeeds(options.layoutGraph, atomIds);
  const kkResult = layoutKamadaKawai(options.layoutGraph.sourceMolecule, atomIds, {
    bondLength,
    coords: kkSeeds.coords,
    pinnedAtomIds: kkSeeds.pinnedAtomIds
  });
  if (kkResult.coords.size === 0) {
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
