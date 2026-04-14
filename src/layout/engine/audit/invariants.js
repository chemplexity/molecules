/** @module audit/invariants */

import { collectLabelBoxes, findLabelOverlaps } from '../geometry/label-box.js';
import { computeBounds } from '../geometry/bounds.js';
import { AtomGrid } from '../geometry/atom-grid.js';
import { AUDIT_PLANAR_VALIDATION, BRIDGED_VALIDATION, SEVERE_OVERLAP_FACTOR } from '../constants.js';

function pairKey(firstAtomId, secondAtomId) {
  return firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
}

/**
 * Returns the bond-validation settings for the requested validation class.
 * @param {'planar'|'bridged'|undefined} validationClass - Bond validation class.
 * @returns {{minBondLengthFactor: number, maxBondLengthFactor: number, maxMeanDeviation: number, maxSevereOverlapCount: number}} Validation settings.
 */
function validationSettingsForClass(validationClass) {
  return validationClass === 'bridged' ? BRIDGED_VALIDATION : AUDIT_PLANAR_VALIDATION;
}

/**
 * Returns whether a bond should contribute to layout bond-length audit stats.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} bond - Bond descriptor.
 * @returns {boolean} True when the bond is a visible heavy-atom covalent bond.
 */
function isAuditableBond(layoutGraph, bond) {
  if (!bond || bond.kind !== 'covalent') {
    return false;
  }
  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  if (!firstAtom || !secondAtom) {
    return false;
  }
  return firstAtom.element !== 'H' && secondAtom.element !== 'H';
}

/**
 * Returns whether the atom participates in visible-audit geometry.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {boolean} True when the atom should count in visible geometry checks.
 */
function isVisibleLayoutAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  if (layoutGraph.options.suppressH && atom.element === 'H') {
    return false;
  }
  return true;
}

function collectNonbondedPairs(layoutGraph, coords, includePair, atomGrid = null, queryRadius = 0) {
  if (atomGrid) {
    const seenPairs = new Set();
    const pairs = [];

    for (const [firstAtomId, firstPosition] of coords) {
      if (!isVisibleLayoutAtom(layoutGraph, firstAtomId)) {
        continue;
      }
      const nearbyAtomIds = atomGrid.queryRadius(firstPosition, queryRadius);
      for (const secondAtomId of nearbyAtomIds) {
        if (secondAtomId === firstAtomId || !isVisibleLayoutAtom(layoutGraph, secondAtomId)) {
          continue;
        }
        const key = pairKey(firstAtomId, secondAtomId);
        if (seenPairs.has(key) || layoutGraph.bondedPairSet.has(key)) {
          continue;
        }
        const secondPosition = coords.get(secondAtomId);
        if (!secondPosition) {
          continue;
        }
        const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
        if (includePair(firstAtomId, secondAtomId, distance)) {
          pairs.push({ firstAtomId, secondAtomId, distance });
        }
        seenPairs.add(key);
      }
    }

    return pairs;
  }

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

/**
 * Builds a spatial atom grid from the current placed coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {AtomGrid} Spatial atom grid.
 */
export function buildAtomGrid(layoutGraph, coords, bondLength) {
  const atomGrid = new AtomGrid(bondLength);
  for (const [atomId, position] of coords) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    atomGrid.insert(atomId, position);
  }
  return atomGrid;
}

function visibleCovalentBonds(layoutGraph, coords, atomId) {
  const bonds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent') {
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
    separations.push(rawSeparation > 0 ? rawSeparation : rawSeparation + Math.PI * 2);
  }
  return separations;
}

/**
 * Finds severe nonbonded overlaps in the current coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Overlap-query options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid.
 * @returns {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} Severe overlaps.
 */
export function findSevereOverlaps(layoutGraph, coords, bondLength, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const atomGrid = options.atomGrid ?? buildAtomGrid(layoutGraph, coords, bondLength);
  return collectNonbondedPairs(layoutGraph, coords, (_firstAtomId, _secondAtomId, distance) => distance < threshold, atomGrid, threshold);
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
    if (!isAuditableBond(layoutGraph, bond)) {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    const deviation = Math.abs(distance - bondLength);
    const validationSettings = validationSettingsForClass(bondValidationClasses.get(bond.id));
    const allowedDeviation = bondLength * Math.max(Math.abs(1 - validationSettings.minBondLengthFactor), Math.abs(validationSettings.maxBondLengthFactor - 1));
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
    const deviation = separations.reduce((sum, separation) => sum + (separation - idealSeparation) ** 2, 0);
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
    const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId).filter(({ neighborAtomId }) => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
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
    const deviation = separations.reduce((sum, separation) => sum + (separation - idealSeparation) ** 2, 0);
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
 * Computes the trigonal + tetrahedral angular distortion penalty at a single atom.
 * Accepts an optional override map so callers can evaluate a hypothetical neighbor position
 * without mutating the coordinate map.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map (not mutated).
 * @param {string} atomId - Atom to evaluate.
 * @param {Map<string, {x: number, y: number}>|null} overridePositions - Positions that override coords for specific atoms.
 * @returns {number} Distortion penalty for the atom.
 */
export function computeAtomDistortionCost(layoutGraph, coords, atomId, overridePositions) {
  if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
    return 0;
  }
  const getPos = id => overridePositions?.get(id) ?? coords.get(id);
  const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId);
  let cost = 0;

  if (covalentBonds.length === 3) {
    const multipleBondCount = covalentBonds.filter(({ bond }) => (bond.order ?? 1) >= 2).length;
    if (multipleBondCount === 1) {
      const atomPosition = getPos(atomId);
      if (atomPosition) {
        const neighborAngles = covalentBonds.map(({ neighborAtomId }) => {
          const neighborPosition = getPos(neighborAtomId);
          return Math.atan2(neighborPosition.y - atomPosition.y, neighborPosition.x - atomPosition.x);
        });
        const separations = sortedAngularSeparations(neighborAngles);
        const idealSeparation = (Math.PI * 2) / 3;
        cost += separations.reduce((sum, separation) => sum + (separation - idealSeparation) ** 2, 0) * 20;
      }
    }
  } else if (covalentBonds.length === 4) {
    const heavyBonds = covalentBonds.filter(({ neighborAtomId }) => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (heavyBonds.length === 4 && heavyBonds.every(({ bond }) => !bond.aromatic && (bond.order ?? 1) === 1)) {
      const atomPosition = getPos(atomId);
      if (atomPosition) {
        const neighborAngles = heavyBonds.map(({ neighborAtomId }) => {
          const neighborPosition = getPos(neighborAtomId);
          return Math.atan2(neighborPosition.y - atomPosition.y, neighborPosition.x - atomPosition.x);
        });
        const separations = sortedAngularSeparations(neighborAngles);
        const idealSeparation = Math.PI / 2;
        cost += separations.reduce((sum, separation) => sum + (separation - idealSeparation) ** 2, 0) * 20;
      }
    }
  }

  return cost;
}

/**
 * Computes the overlap penalty contributed by a subtree of atoms against all non-subtree atoms.
 * Used by the local cleanup pass to evaluate rotation candidates in O(k·n) instead of O(n²).
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map (not mutated).
 * @param {string[]} subtreeAtomIds - Atom IDs in the moving subtree.
 * @param {Map<string, {x: number, y: number}>|null} overridePositions - Override positions for the subtree atoms, or null to use coords.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Cost options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid built from coords.
 * @returns {number} Overlap penalty for the subtree.
 */
export function computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, overridePositions, bondLength, options = {}) {
  const subtreeSet = new Set(subtreeAtomIds);
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const atomGrid = options.atomGrid ?? buildAtomGrid(layoutGraph, coords, bondLength);
  let cost = 0;
  for (const subtreeAtomId of subtreeAtomIds) {
    if (!isVisibleLayoutAtom(layoutGraph, subtreeAtomId)) {
      continue;
    }
    const pos = overridePositions?.get(subtreeAtomId) ?? coords.get(subtreeAtomId);
    if (!pos) {
      continue;
    }
    const nearbyAtomIds = atomGrid.queryRadius(pos, threshold);
    for (const atomId of nearbyAtomIds) {
      if (subtreeSet.has(atomId) || !isVisibleLayoutAtom(layoutGraph, atomId)) {
        continue;
      }
      if (layoutGraph.bondedPairSet.has(pairKey(subtreeAtomId, atomId))) {
        continue;
      }
      const otherPos = coords.get(atomId);
      if (!otherPos) {
        continue;
      }
      const d = Math.hypot(otherPos.x - pos.x, otherPos.y - pos.y);
      if (d < threshold) {
        const deficit = threshold - d;
        cost += deficit * deficit * 100;
      }
    }
  }
  return cost;
}

/**
 * Measures overlapping atom-label boxes using the shared cleanup/render width model.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Label-overlap options.
 * @param {object|null} [options.labelMetrics] - Optional renderer-supplied label metrics.
 * @returns {{pairCount: number, totalPenalty: number, maxPenalty: number}} Label-overlap statistics.
 */
export function measureLabelOverlap(layoutGraph, coords, bondLength, options = {}) {
  const labelBoxes = collectLabelBoxes(layoutGraph, coords, bondLength, {
    labelMetrics: options.labelMetrics
  });
  const overlaps = findLabelOverlaps(layoutGraph, coords, bondLength, {
    labelMetrics: options.labelMetrics,
    labelBoxes
  });
  let totalPenalty = 0;
  let maxPenalty = 0;

  for (const overlap of overlaps) {
    const penalty = overlap.overlapX + overlap.overlapY;
    totalPenalty += penalty;
    maxPenalty = Math.max(maxPenalty, penalty);
  }

  return {
    pairCount: overlaps.length,
    totalPenalty,
    maxPenalty
  };
}

/**
 * Computes the current cleanup/audit state for a coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - State-measurement options.
 * @param {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} [options.overlaps] - Optional precomputed severe overlaps.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid for overlap lookup.
 * @param {object|null} [options.labelMetrics] - Optional renderer-supplied label metrics.
 * @returns {{overlaps: Array<{firstAtomId: string, secondAtomId: string, distance: number}>, overlapCount: number, overlapPenalty: number, bondDeviation: {sampleCount: number, maxDeviation: number, meanDeviation: number, failingBondCount: number}, collapsedMacrocycles: number[], labelOverlap: {pairCount: number, totalPenalty: number, maxPenalty: number}, trigonalDistortion: {centerCount: number, totalDeviation: number, maxDeviation: number}, tetrahedralDistortion: {centerCount: number, totalDeviation: number, maxDeviation: number}, cost: number}} Aggregate layout state.
 */
export function measureLayoutState(layoutGraph, coords, bondLength, options = {}) {
  const overlaps =
    options.overlaps ??
    findSevereOverlaps(layoutGraph, coords, bondLength, {
      atomGrid: options.atomGrid
    });
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
  const collapsedMacrocycles = detectCollapsedMacrocycles(layoutGraph, coords, bondLength);
  const labelOverlap = measureLabelOverlap(layoutGraph, coords, bondLength, {
    labelMetrics: options.labelMetrics ?? layoutGraph.options.labelMetrics
  });
  const trigonalDistortion = measureTrigonalDistortion(layoutGraph, coords);
  const tetrahedralDistortion = measureTetrahedralDistortion(layoutGraph, coords);

  let overlapPenalty = 0;
  for (const overlap of overlaps) {
    const deficit = bondLength * SEVERE_OVERLAP_FACTOR - overlap.distance;
    overlapPenalty += deficit * deficit * 100;
  }

  const bondPenalty = bondDeviation.meanDeviation * 10 + bondDeviation.maxDeviation * 5;
  const macrocyclePenalty = collapsedMacrocycles.length * 1000;
  const labelPenalty = labelOverlap.totalPenalty * 10;
  const trigonalPenalty = trigonalDistortion.totalDeviation * 20;
  const tetrahedralPenalty = tetrahedralDistortion.totalDeviation * 20;
  return {
    overlaps,
    overlapCount: overlaps.length,
    overlapPenalty,
    bondDeviation,
    collapsedMacrocycles,
    labelOverlap,
    trigonalDistortion,
    tetrahedralDistortion,
    cost: overlapPenalty + bondPenalty + macrocyclePenalty + labelPenalty + trigonalPenalty + tetrahedralPenalty
  };
}

/**
 * Computes the current cleanup/audit cost for a coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {number} Aggregate layout cost.
 */
export function measureLayoutCost(layoutGraph, coords, bondLength) {
  return measureLayoutState(layoutGraph, coords, bondLength).cost;
}
