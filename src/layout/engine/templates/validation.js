/** @module templates/validation */

import { createLayoutGraph } from '../model/layout-graph.js';
import { findSevereOverlaps, measureBondLengthDeviation } from '../audit/invariants.js';
import { getTemplateCoords } from './library.js';

/**
 * Measures coverage and basic geometry quality for a single scaffold template.
 * @param {object} template - Template descriptor from the template library.
 * @param {number} [bondLength] - Target depiction bond length.
 * @returns {{
 *   coords: Map<string, {x: number, y: number}>|null,
 *   atomCount: number,
 *   coordCount: number,
 *   missingAtomIds: string[],
 *   extraCoordIds: string[],
 *   severeOverlapCount: number,
 *   minBondLength: number,
 *   maxBondLength: number,
 *   meanBondLengthDeviation: number,
 *   maxBondLengthDeviation: number
 * }} Geometry summary.
 */
export function measureTemplateGeometry(template, bondLength = 1.5) {
  const coords = getTemplateCoords(template, bondLength);
  const atomIds = [...template.molecule.atoms.keys()];
  const atomIdSet = new Set(atomIds);
  const coordIds = coords ? [...coords.keys()] : [];
  const missingAtomIds = atomIds.filter(atomId => !coords?.has(atomId));
  const extraCoordIds = coordIds.filter(atomId => !atomIdSet.has(atomId));

  if (!coords) {
    return {
      coords: null,
      atomCount: atomIds.length,
      coordCount: 0,
      missingAtomIds,
      extraCoordIds,
      severeOverlapCount: Infinity,
      minBondLength: Infinity,
      maxBondLength: Infinity,
      meanBondLengthDeviation: Infinity,
      maxBondLengthDeviation: Infinity
    };
  }

  const layoutGraph = createLayoutGraph(template.molecule, { bondLength });
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  let minBondLength = Infinity;
  let maxBondLength = -Infinity;

  for (const bond of template.molecule.bonds.values()) {
    const [firstAtomId, secondAtomId] = bond.atoms;
    const firstPosition = coords.get(firstAtomId);
    const secondPosition = coords.get(secondAtomId);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    minBondLength = Math.min(minBondLength, distance);
    maxBondLength = Math.max(maxBondLength, distance);
  }

  return {
    coords,
    atomCount: atomIds.length,
    coordCount: coords.size,
    missingAtomIds,
    extraCoordIds,
    severeOverlapCount: overlaps.length,
    minBondLength,
    maxBondLength,
    meanBondLengthDeviation: bondDeviation.meanDeviation,
    maxBondLengthDeviation: bondDeviation.maxDeviation
  };
}

/**
 * Returns whether a template clears its declared geometry validation profile.
 * @param {object} template - Template descriptor from the template library.
 * @param {number} [bondLength] - Target depiction bond length.
 * @returns {{ok: boolean, summary: ReturnType<typeof measureTemplateGeometry>, checks: object}} Validation result.
 */
export function validateTemplateGeometry(template, bondLength = 1.5) {
  const summary = measureTemplateGeometry(template, bondLength);
  const validation = template.geometryValidation ?? {};
  const minBondLengthFactor = validation.minBondLengthFactor ?? 0;
  const maxBondLengthFactor = validation.maxBondLengthFactor ?? Infinity;
  const maxMeanDeviation = validation.maxMeanDeviation ?? Infinity;
  const maxSevereOverlapCount = validation.maxSevereOverlapCount ?? Infinity;

  const coverageOk = summary.coordCount === summary.atomCount && summary.missingAtomIds.length === 0 && summary.extraCoordIds.length === 0;
  const minBondOk = Number.isFinite(summary.minBondLength) && summary.minBondLength >= bondLength * minBondLengthFactor;
  const maxBondOk = Number.isFinite(summary.maxBondLength) && summary.maxBondLength <= bondLength * maxBondLengthFactor;
  const meanDeviationOk = Number.isFinite(summary.meanBondLengthDeviation) && summary.meanBondLengthDeviation <= maxMeanDeviation;
  const overlapOk = summary.severeOverlapCount <= maxSevereOverlapCount;

  return {
    ok: coverageOk && minBondOk && maxBondOk && meanDeviationOk && overlapOk,
    summary,
    checks: {
      coverageOk,
      minBondOk,
      maxBondOk,
      meanDeviationOk,
      overlapOk
    }
  };
}
