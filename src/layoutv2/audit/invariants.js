/** @module audit/invariants */

import { computeBounds } from '../geometry/bounds.js';
import { BRIDGED_VALIDATION, PLANAR_VALIDATION } from '../templates/library.js';

function pairKey(firstAtomId, secondAtomId) {
  return firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
}

/**
 * Returns the bond-validation settings for the requested validation class.
 * @param {'planar'|'bridged'|undefined} validationClass - Bond validation class.
 * @returns {{minBondLengthFactor: number, maxBondLengthFactor: number, maxMeanDeviation: number, maxSevereOverlapCount: number}} Validation settings.
 */
function validationSettingsForClass(validationClass) {
  return validationClass === 'bridged' ? BRIDGED_VALIDATION : PLANAR_VALIDATION;
}

function isVisibleLayoutAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  if (layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible) {
    return false;
  }
  return true;
}

function collectNonbondedPairs(layoutGraph, coords, includePair) {
  const atomIds = [...coords.keys()];
  const bondedPairs = layoutGraph.bondedPairSet;
  const pairs = [];

  for (let firstIndex = 0; firstIndex < atomIds.length; firstIndex++) {
    const firstAtomId = atomIds[firstIndex];
    if (!isVisibleLayoutAtom(layoutGraph, firstAtomId)) {
      continue;
    }
    const firstPosition = coords.get(firstAtomId);
    for (let secondIndex = firstIndex + 1; secondIndex < atomIds.length; secondIndex++) {
      const secondAtomId = atomIds[secondIndex];
      if (!isVisibleLayoutAtom(layoutGraph, secondAtomId) || bondedPairs.has(pairKey(firstAtomId, secondAtomId))) {
        continue;
      }
      const secondPosition = coords.get(secondAtomId);
      const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
      if (includePair(firstAtomId, secondAtomId, distance)) {
        pairs.push({ firstAtomId, secondAtomId, distance });
      }
    }
  }

  return pairs;
}

function visibleCovalentBonds(layoutGraph, coords, atomId) {
  const bonds = [];
  for (const bond of layoutGraph.bonds.values()) {
    if (bond.kind !== 'covalent') {
      continue;
    }
    if (bond.a !== atomId && bond.b !== atomId) {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    if (!coords.has(neighborAtomId) || !isVisibleLayoutAtom(layoutGraph, neighborAtomId)) {
      continue;
    }
    bonds.push({ bond, neighborAtomId });
  }
  return bonds;
}

function sortedAngularSeparations(angles) {
  const sortedAngles = [...angles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const separations = [];
  for (let index = 0; index < sortedAngles.length; index++) {
    const currentAngle = sortedAngles[index];
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length];
    const rawSeparation = nextAngle - currentAngle;
    separations.push(rawSeparation > 0 ? rawSeparation : rawSeparation + (Math.PI * 2));
  }
  return separations;
}

/**
 * Finds severe nonbonded overlaps in the current coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} Severe overlaps.
 */
export function findSevereOverlaps(layoutGraph, coords, bondLength) {
  const threshold = bondLength * 0.55;
  return collectNonbondedPairs(layoutGraph, coords, (_firstAtomId, _secondAtomId, distance) => distance < threshold);
}

/**
 * Measures bond-length deviation from the target depiction bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {{bondValidationClasses?: Map<string, 'planar'|'bridged'>}} [options] - Bond-validation options.
 * @returns {{sampleCount: number, maxDeviation: number, meanDeviation: number, failingBondCount: number}} Bond-length statistics.
 */
export function measureBondLengthDeviation(layoutGraph, coords, bondLength, options = {}) {
  let sampleCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;
  let failingBondCount = 0;
  const bondValidationClasses = options.bondValidationClasses ?? new Map();

  for (const bond of layoutGraph.bonds.values()) {
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    const deviation = Math.abs(distance - bondLength);
    const validationSettings = validationSettingsForClass(bondValidationClasses.get(bond.id));
    const allowedDeviation = bondLength * Math.max(
      Math.abs(1 - validationSettings.minBondLengthFactor),
      Math.abs(validationSettings.maxBondLengthFactor - 1)
    );
    sampleCount++;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
    if (deviation > allowedDeviation) {
      failingBondCount++;
    }
  }

  return {
    sampleCount,
    maxDeviation,
    meanDeviation: sampleCount === 0 ? 0 : totalDeviation / sampleCount,
    failingBondCount
  };
}

/**
 * Measures distortion at visible three-coordinate unsaturated centers that
 * should read as roughly trigonal in a publication-style 2D depiction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{centerCount: number, totalDeviation: number, maxDeviation: number}} Trigonal distortion statistics.
 */
export function measureTrigonalDistortion(layoutGraph, coords) {
  let centerCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;
  const idealSeparation = (Math.PI * 2) / 3;

  for (const atomId of coords.keys()) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId);
    if (covalentBonds.length !== 3) {
      continue;
    }
    const multipleBondCount = covalentBonds.filter(({ bond }) => (bond.order ?? 1) >= 2).length;
    if (multipleBondCount !== 1) {
      continue;
    }
    const atomPosition = coords.get(atomId);
    const neighborAngles = covalentBonds.map(({ neighborAtomId }) => {
      const neighborPosition = coords.get(neighborAtomId);
      return Math.atan2(neighborPosition.y - atomPosition.y, neighborPosition.x - atomPosition.x);
    });
    const separations = sortedAngularSeparations(neighborAngles);
    const deviation = separations.reduce((sum, separation) => sum + ((separation - idealSeparation) ** 2), 0);
    centerCount++;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return {
    centerCount,
    totalDeviation,
    maxDeviation
  };
}

/**
 * Measures angular distortion at visible saturated four-coordinate heavy centers
 * that should remain roughly tetrahedral in a publication-style 2D depiction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{centerCount: number, totalDeviation: number, maxDeviation: number}} Tetrahedral distortion statistics.
 */
export function measureTetrahedralDistortion(layoutGraph, coords) {
  let centerCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;
  const idealSeparation = Math.PI / 2;

  for (const atomId of coords.keys()) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId)
      .filter(({ neighborAtomId }) => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (covalentBonds.length !== 4) {
      continue;
    }
    if (covalentBonds.some(({ bond }) => bond.aromatic || (bond.order ?? 1) !== 1)) {
      continue;
    }

    const atomPosition = coords.get(atomId);
    const neighborAngles = covalentBonds.map(({ neighborAtomId }) => {
      const neighborPosition = coords.get(neighborAtomId);
      return Math.atan2(neighborPosition.y - atomPosition.y, neighborPosition.x - atomPosition.x);
    });
    const separations = sortedAngularSeparations(neighborAngles);
    const deviation = separations.reduce((sum, separation) => sum + ((separation - idealSeparation) ** 2), 0);
    centerCount++;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return {
    centerCount,
    totalDeviation,
    maxDeviation
  };
}

/**
 * Detects obviously collapsed macrocycle depictions.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {number[]} Macrocycle ring IDs flagged as collapsed.
 */
export function detectCollapsedMacrocycles(layoutGraph, coords, bondLength) {
  const collapsedRingIds = [];
  for (const ring of layoutGraph.rings) {
    if (ring.size < 12 || !ring.atomIds.every(atomId => coords.has(atomId))) {
      continue;
    }
    const bounds = computeBounds(coords, ring.atomIds);
    if (!bounds) {
      continue;
    }
    if (bounds.width < bondLength * 3 || bounds.height < bondLength * 1.25) {
      collapsedRingIds.push(ring.id);
    }
  }
  return collapsedRingIds;
}

/**
 * Computes the current cleanup/audit cost for a coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {number} Aggregate layout cost.
 */
export function measureLayoutCost(layoutGraph, coords, bondLength) {
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
  const collapsedMacrocycles = detectCollapsedMacrocycles(layoutGraph, coords, bondLength);
  const trigonalDistortion = measureTrigonalDistortion(layoutGraph, coords);
  const tetrahedralDistortion = measureTetrahedralDistortion(layoutGraph, coords);

  let overlapPenalty = 0;
  for (const overlap of overlaps) {
    const deficit = (bondLength * 0.55) - overlap.distance;
    overlapPenalty += deficit * deficit * 100;
  }

  const bondPenalty = bondDeviation.meanDeviation * 10 + bondDeviation.maxDeviation * 5;
  const macrocyclePenalty = collapsedMacrocycles.length * 1000;
  const trigonalPenalty = trigonalDistortion.totalDeviation * 20;
  const tetrahedralPenalty = tetrahedralDistortion.totalDeviation * 20;
  return overlapPenalty + bondPenalty + macrocyclePenalty + trigonalPenalty + tetrahedralPenalty;
}
