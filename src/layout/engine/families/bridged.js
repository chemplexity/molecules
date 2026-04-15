/** @module families/bridged */

import { centroid } from '../geometry/vec2.js';
import { layoutKamadaKawai } from '../geometry/kk-layout.js';
import { projectBridgePaths } from './bridge-projection.js';
import { placeTemplateCoords } from '../scaffold/template-placement.js';

const BRIDGED_KK_THRESHOLD = 0.2;
const BRIDGED_KK_MAX_ITERATIONS = 1000;
const BRIDGED_KK_MAX_INNER_ITERATIONS = 20;
const BRIDGED_FAST_KK_ATOM_LIMIT = 24;

/**
 * Returns tuned KK options for small unmatched bridged systems.
 * Larger dense cages already converge quickly with the default solver tolerances,
 * while some smaller mixed bridged systems spend a long time failing to reach
 * the stricter default thresholds.
 * @param {string[]} atomIds - Bridged-system atom IDs.
 * @returns {object} Optional KK overrides.
 */
function bridgedKamadaKawaiOptions(atomIds) {
  if (atomIds.length > BRIDGED_FAST_KK_ATOM_LIMIT) {
    return {};
  }
  return {
    threshold: BRIDGED_KK_THRESHOLD,
    innerThreshold: BRIDGED_KK_THRESHOLD,
    maxIterations: BRIDGED_KK_MAX_ITERATIONS,
    maxInnerIterations: BRIDGED_KK_MAX_INNER_ITERATIONS
  };
}

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
    pinnedAtomIds: kkSeeds.pinnedAtomIds,
    ...bridgedKamadaKawaiOptions(atomIds)
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
