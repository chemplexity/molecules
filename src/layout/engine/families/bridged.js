/** @module families/bridged */

import { BRIDGED_KK_LIMITS, BRIDGED_VALIDATION } from '../constants.js';
import { cloneCoords } from '../geometry/transforms.js';
import { auditLayout } from '../audit/audit.js';
import { circumradiusForRegularPolygon } from '../geometry/polygon.js';
import { add, angleOf, angularDifference, centroid, distance, fromAngle, rotate, sub } from '../geometry/vec2.js';
import { layoutKamadaKawai } from '../geometry/kk-layout.js';
import { orientBridgedSeed, projectBridgePaths } from './bridge-projection.js';
import { assignBondValidationClass } from '../placement/bond-validation.js';
import { placeRemainingBranches } from '../placement/branch-placement.js';
import { placeTemplateCoords } from '../templates/placement.js';
import { isMetalAtom } from '../topology/metal-centers.js';
import { collectCutSubtree } from '../cleanup/subtree-utils.js';

const COMPACT_BRIDGED_KK_THRESHOLD = 0.02;
const COMPACT_BRIDGED_NONBONDED_COLLAPSE_FACTOR = 0.8;
const COLLAPSED_FOUR_MEMBERED_BRIDGE_APEX_FACTOR = 0.2;
const COMPACT_SHARED_BRIDGE_LANE_SPREAD_FACTORS = Object.freeze([1.28, 1.3, 1.32, 1.34, 1.36, 1.38]);
const COLLAPSED_SATURATED_THREE_ATOM_BRIDGE_ARC_HEIGHT_FACTORS = Object.freeze([1.7, 1.85, 2, 1.55, 2.15]);
const STRAINED_COMPACT_BRIDGED_KK_THRESHOLD = 0.1;
const STRAINED_COMPACT_BRIDGED_MAX_DEVIATION = 0.35;
const BRIDGED_PROJECTION_MAX_BOND_REGRESSION_FACTOR = 0.5;
const BRIDGED_PROJECTION_SAME_FAILURE_MAX_BASELINE_DEVIATION_FACTOR = 0.5;
const BRIDGED_PROJECTION_SAME_FAILURE_MAX_REGRESSION_FACTOR = 1.0;
const AROMATIC_BRIDGED_REGULARIZATION_BLEND_FACTORS = Object.freeze([1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1, 0.05]);
const FUSED_CYCLOHEXANE_BRIDGE_HEIGHT_FACTORS = Object.freeze([1, -1]);
const FUSED_CYCLOHEXANE_BRANCH_SLOT_BLOCKER_FACTOR = 0.65;
const FUSED_CYCLOHEXANE_BRANCH_PREVIEW_OVERLAP_FACTOR = 0.55;
const SATURATED_BRIDGED_CYCLOHEXANE_BRIDGE_HEIGHT_FACTORS = Object.freeze([1, -1]);
const SATURATED_BRIDGED_CYCLOHEXANE_MIN_SHARED_ATOMS = 3;
const SATURATED_BRIDGED_RING_REGULARIZATION_DAMPING_FACTORS = Object.freeze([0.35, 0.55, 0.7]);
const SATURATED_BRIDGED_RING_REGULARIZATION_MAX_ITERATIONS = 50;
const SATURATED_BRIDGED_RING_REGULARIZATION_MIN_ANGLE_DEVIATION = Math.PI / 12;
const SATURATED_BRIDGED_RING_REGULARIZATION_MIN_BOND_DEVIATION_FACTOR = 0.08;
const SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MIN_ANGLE_DEVIATION = Math.PI / 18;
const SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MAX_BOND_DEVIATION_FACTOR = 0.05;
const SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MAX_PASSES = 3;
const SATURATED_BRIDGED_RING_JUNCTION_BALANCE_DIRECTION_COUNT = 12;
const SATURATED_BRIDGED_RING_JUNCTION_BALANCE_STEP_FACTORS = Object.freeze([0.04, 0.027, 0.017, 0.01, 0.005, 0.003]);
const SATURATED_BRIDGED_RING_SHAPE_BALANCE_MAX_PASSES = 3;
const SATURATED_BRIDGED_RING_SHAPE_BALANCE_DIRECTION_COUNT = 12;
const SATURATED_BRIDGED_RING_SHAPE_BALANCE_STEP_FACTORS = Object.freeze([0.027, 0.017, 0.01, 0.005]);
const STRICT_BRIDGED_SMALL_RING_MIN_ANGLE_DEVIATION = Math.PI / 12;
const STRICT_BRIDGED_SMALL_RING_MAX_BOND_DEVIATION_FACTOR = 0.24;
const STRICT_BRIDGED_SMALL_RING_MAX_PASSES = 10;
const STRICT_BRIDGED_SMALL_RING_DAMPING_FACTORS = Object.freeze([0.85, 0.65, 0.45, 0.3, 0.18, 0.1]);
const MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MIN_RING_COUNT = 8;
const MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MAX_ATOM_COUNT = BRIDGED_KK_LIMITS.mediumAtomLimit + 20;
const MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MIN_ANGLE_DEVIATION = Math.PI / 15;
const MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MAX_BOND_DEVIATION_FACTOR = 0.47;
const MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_DAMPING_FACTORS = Object.freeze([0.15, 0.08, 0.04]);
const MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MAX_ITERATIONS = 48;
const MEDIUM_BRIDGED_RING_ANGLE_POLISH_MIN_ANGLE_DEVIATION = Math.PI / 15;
const MEDIUM_BRIDGED_RING_ANGLE_POLISH_MAX_BOND_DEVIATION_FACTOR = 0.48;
const MEDIUM_BRIDGED_RING_ANGLE_POLISH_MAX_PASSES = 8;
const MEDIUM_BRIDGED_RING_ANGLE_POLISH_DIRECTION_COUNT = 12;
const MEDIUM_BRIDGED_RING_ANGLE_POLISH_STEP_FACTORS = Object.freeze([0.04, 0.027, 0.017]);
const MEDIUM_BRIDGED_AROMATIC_RING_POLISH_MIN_BOND_DEVIATION_FACTOR = 0.28;
const MEDIUM_BRIDGED_AROMATIC_RING_POLISH_MAX_ANGLE_DEVIATION = Math.PI / 10;
const MEDIUM_BRIDGED_AROMATIC_RING_POLISH_ABSOLUTE_MAX_ANGLE_DEVIATION = Math.PI / 12;
const MEDIUM_BRIDGED_AROMATIC_RING_POLISH_ANGLE_WORSENING_LIMIT = Math.PI / 60;
const MEDIUM_BRIDGED_AROMATIC_RING_POLISH_TOTAL_ANGLE_WORSENING_LIMIT = Math.PI / 6;
const MEDIUM_BRIDGED_AROMATIC_RING_POLISH_MAX_PASSES = 4;
const MEDIUM_BRIDGED_AROMATIC_RING_POLISH_DIRECTION_COUNT = 12;
const MEDIUM_BRIDGED_AROMATIC_RING_POLISH_STEP_FACTORS = Object.freeze([0.027, 0.017, 0.01, 0.006]);
const MEDIUM_BRIDGED_RING_BOND_POLISH_MIN_BOND_DEVIATION_FACTOR = 0.32;
const MEDIUM_BRIDGED_RING_BOND_POLISH_MAX_ANGLE_DEVIATION = Math.PI / 15;
const MEDIUM_BRIDGED_RING_BOND_POLISH_ANGLE_WORSENING_LIMIT = Math.PI / 60;
const MEDIUM_BRIDGED_RING_BOND_POLISH_TOTAL_ANGLE_WORSENING_LIMIT = Math.PI / 6;
const MEDIUM_BRIDGED_RING_BOND_POLISH_MAX_PASSES = 4;
const MEDIUM_BRIDGED_RING_BOND_POLISH_DIRECTION_COUNT = 12;
const MEDIUM_BRIDGED_RING_BOND_POLISH_STEP_FACTORS = Object.freeze([0.027, 0.017, 0.01]);
const MEDIUM_BRIDGED_RING_EDGE_POLISH_MIN_BOND_DEVIATION_FACTOR = 0.22;
const MEDIUM_BRIDGED_RING_EDGE_POLISH_MAX_PASSES = 4;
const MEDIUM_BRIDGED_RING_EDGE_POLISH_STEP_FACTORS = Object.freeze([0.03, 0.02, 0.012]);
const MEDIUM_BRIDGED_RING_POLISH_MAX_PENDANT_HEAVY_ATOMS = 4;
const AROMATIC_CAPPED_FUSED_SQUARE_BRIDGE_STRETCH_FACTORS = Object.freeze([1.15, 1.2, 1.1, 1.05, 1]);
const PERIPHERAL_BRIDGED_RING_REGULARIZATION_MIN_ANGLE_DEVIATION = Math.PI / 4;
const PERIPHERAL_BRIDGED_RING_REGULARIZATION_BLEND_FACTORS = Object.freeze([1, 0.9, 0.8, 0.7, 0.6]);
const SINGLE_ANCHOR_BRIDGED_RING_REGULARIZATION_MIN_ANGLE_DEVIATION = Math.PI / 8;
const SINGLE_ANCHOR_BRIDGED_RING_REGULARIZATION_BLEND_FACTORS = Object.freeze([1, 0.9, 0.8, 0.7, 0.6]);
const SPIRO_JUNCTION_RING_SPREAD_MIN_CROSS_ANGLE = Math.PI / 3;
const SPIRO_JUNCTION_RING_SPREAD_OFFSETS = Object.freeze(Array.from({ length: 72 }, (_, index) => ((index + 1) * 5 * Math.PI) / 180).flatMap(angle => [angle, -angle]));
const SPIRO_JUNCTION_RING_SPREAD_EPSILON = 1e-6;
const MARGINAL_STRETCHED_BRIDGED_RING_BOND_RETOUCH_MAX_EXCESS_FACTOR = 0.08;
const MARGINAL_STRETCHED_BRIDGED_RING_BOND_RETOUCH_BUFFER_FACTOR = 0.004;
const MARGINAL_STRETCHED_BRIDGED_RING_BOND_RETOUCH_MIN_ATOMS = 30;
const MARGINAL_STRETCHED_BRIDGED_RING_BOND_RETOUCH_MIN_RINGS = 8;

/**
 * Returns tuned KK options for small unmatched bridged systems.
 * Unmatched bridged cages often produce acceptable projected layouts well before
 * the generic KK default threshold of `0.1`, so let larger systems stop once
 * they reach the same practical bridged target already used by smaller cages.
 * @param {string[]} atomIds - Bridged-system atom IDs.
 * @returns {object} Optional KK overrides.
 */
function bridgedKamadaKawaiOptions(atomIds) {
  if (atomIds.length <= BRIDGED_KK_LIMITS.fastAtomLimit) {
    return {
      threshold: BRIDGED_KK_LIMITS.threshold,
      innerThreshold: BRIDGED_KK_LIMITS.threshold,
      maxIterations: BRIDGED_KK_LIMITS.baseMaxIterations,
      maxInnerIterations: BRIDGED_KK_LIMITS.baseMaxInnerIterations
    };
  }
  if (atomIds.length <= BRIDGED_KK_LIMITS.mediumAtomLimit) {
    return {
      threshold: BRIDGED_KK_LIMITS.threshold,
      innerThreshold: BRIDGED_KK_LIMITS.threshold,
      maxIterations: BRIDGED_KK_LIMITS.mediumMaxIterations,
      maxInnerIterations: BRIDGED_KK_LIMITS.baseMaxInnerIterations
    };
  }
  if (atomIds.length <= BRIDGED_KK_LIMITS.mediumAtomLimit + 20) {
    return {
      threshold: BRIDGED_KK_LIMITS.threshold,
      innerThreshold: BRIDGED_KK_LIMITS.threshold,
      maxIterations: BRIDGED_KK_LIMITS.largeMaxIterations,
      maxInnerIterations: BRIDGED_KK_LIMITS.largeMaxInnerIterations
    };
  }
  return {
    threshold: BRIDGED_KK_LIMITS.threshold,
    innerThreshold: BRIDGED_KK_LIMITS.threshold,
    maxIterations: Math.min(BRIDGED_KK_LIMITS.largeMaxIterations, 1800),
    maxInnerIterations: Math.min(BRIDGED_KK_LIMITS.largeMaxInnerIterations, BRIDGED_KK_LIMITS.baseMaxInnerIterations)
  };
}

/**
 * Returns stricter KK options for compact bridged seeds that visibly collapsed
 * non-bonded ring atoms under the ordinary fast threshold.
 * @param {string[]} atomIds - Bridged-system atom IDs.
 * @returns {object} Optional KK overrides.
 */
function compactBridgedKamadaKawaiOptions(atomIds) {
  return {
    ...bridgedKamadaKawaiOptions(atomIds),
    threshold: COMPACT_BRIDGED_KK_THRESHOLD,
    innerThreshold: COMPACT_BRIDGED_KK_THRESHOLD
  };
}

function strainedCompactBridgedKamadaKawaiOptions(atomIds) {
  return {
    ...bridgedKamadaKawaiOptions(atomIds),
    threshold: STRAINED_COMPACT_BRIDGED_KK_THRESHOLD,
    innerThreshold: STRAINED_COMPACT_BRIDGED_KK_THRESHOLD
  };
}

function bridgedProjectionSeededKamadaKawaiOptions(atomIds) {
  const baseOptions = bridgedKamadaKawaiOptions(atomIds);
  if (atomIds.length <= BRIDGED_KK_LIMITS.mediumAtomLimit) {
    return {
      ...baseOptions,
      maxIterations: Math.min(baseOptions.maxIterations, BRIDGED_KK_LIMITS.baseMaxIterations),
      maxInnerIterations: Math.min(baseOptions.maxInnerIterations, BRIDGED_KK_LIMITS.baseMaxInnerIterations)
    };
  }
  return {
    ...baseOptions,
    maxIterations: Math.min(baseOptions.maxIterations, 1800),
    maxInnerIterations: Math.min(baseOptions.maxInnerIterations, BRIDGED_KK_LIMITS.baseMaxInnerIterations)
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

function buildProjectionSeedCoords(layoutGraph, atomIds, seedCoords, bondLength) {
  const coords = new Map();
  for (const atomId of atomIds) {
    const fixedPosition = layoutGraph.fixedCoords.get(atomId);
    if (fixedPosition) {
      coords.set(atomId, { ...fixedPosition });
      continue;
    }
    const existingPosition = seedCoords.get(atomId);
    if (existingPosition && Number.isFinite(existingPosition.x) && Number.isFinite(existingPosition.y)) {
      coords.set(atomId, { ...existingPosition });
    }
  }

  if (coords.size === atomIds.length) {
    return coords;
  }

  const seededPoints = [...coords.values()];
  const center = seededPoints.length > 0 ? centroid(seededPoints) : { x: 0, y: 0 };
  const remainingAtomIds = atomIds.filter(atomId => !coords.has(atomId));
  const radius = circumradiusForRegularPolygon(Math.max(atomIds.length, 3), bondLength);
  const step = (2 * Math.PI) / Math.max(remainingAtomIds.length, 1);
  for (let index = 0; index < remainingAtomIds.length; index++) {
    coords.set(remainingAtomIds[index], {
      x: center.x + Math.cos(index * step) * radius,
      y: center.y + Math.sin(index * step) * radius
    });
  }
  return coords;
}

function shouldTryProjectionFirst(atomIds, pinnedAtomIds) {
  return atomIds.length > BRIDGED_KK_LIMITS.mediumAtomLimit + 40 && pinnedAtomIds.length === 0;
}

function shouldShortCircuitLargeProjection(atomIds, pinnedAtomIds) {
  return atomIds.length > BRIDGED_KK_LIMITS.mediumAtomLimit + 20 && pinnedAtomIds.length === 0;
}

function acceptsLargeProjectionAudit(audit) {
  return Boolean(audit && (audit.severeOverlapCount ?? 0) <= 5 && (audit.bondLengthFailureCount ?? 0) <= 25 && (audit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) < 1.0);
}

function containsMetalAtom(layoutGraph, atomIds) {
  return atomIds.some(atomId => isMetalAtom(layoutGraph.sourceMolecule.atoms.get(atomId)));
}

/**
 * Returns whether a compact bridged KK seed has placed non-bonded ring atoms
 * close enough to read as an atom collision even if the relaxed bridged audit
 * would still tolerate the local bond geometry. Aromatic fused systems keep the
 * ordinary projection seed because their bridgehead exits depend on that frame.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Bridged-system atom IDs.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when a stricter KK pass should be attempted.
 */
function hasCompactBridgedNonbondedCollapse(layoutGraph, atomIds, coords, bondLength) {
  if (atomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || !(coords instanceof Map)) {
    return false;
  }
  if (containsMetalAtom(layoutGraph, atomIds)) {
    return false;
  }
  if (atomIds.some(atomId => layoutGraph.atoms.get(atomId)?.aromatic === true)) {
    return false;
  }
  const threshold = bondLength * COMPACT_BRIDGED_NONBONDED_COLLAPSE_FACTOR;
  for (let firstIndex = 0; firstIndex < atomIds.length; firstIndex++) {
    const firstAtomId = atomIds[firstIndex];
    const firstAtom = layoutGraph.atoms.get(firstAtomId);
    const firstPosition = coords.get(firstAtomId);
    if (!firstAtom || firstAtom.element === 'H' || !firstPosition) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < atomIds.length; secondIndex++) {
      const secondAtomId = atomIds[secondIndex];
      if (layoutGraph.bondedPairSet.has(`${firstAtomId}:${secondAtomId}`) || layoutGraph.bondedPairSet.has(`${secondAtomId}:${firstAtomId}`)) {
        continue;
      }
      const secondAtom = layoutGraph.atoms.get(secondAtomId);
      const secondPosition = coords.get(secondAtomId);
      if (!secondAtom || secondAtom.element === 'H' || !secondPosition) {
        continue;
      }
      if (Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y) < threshold) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Audits one bridged placement candidate using the relaxed bridged bond class.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, 'planar'|'bridged'>|null} [bondValidationClasses] - Optional cached bond-validation classes.
 * @returns {object|null} Audit summary, or `null` when inputs are incomplete.
 */
function auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength, bondValidationClasses = null) {
  if (!layoutGraph || !(coords instanceof Map) || atomIds.some(atomId => !coords.has(atomId))) {
    return null;
  }
  return auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: bondValidationClasses ?? assignBondValidationClass(layoutGraph, atomIds, 'bridged')
  });
}

/**
 * Returns whether bridge-path projection produced an atom-pair collapse severe
 * enough that the less stylized KK baseline should be allowed to replace it
 * even when both candidates still have other bridged audit issues.
 * @param {object|null} audit - Projected coordinate audit.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when the projected bridge paths are catastrophically collapsed.
 */
function hasCatastrophicBridgeProjectionCollapse(audit, bondLength) {
  return audit && audit.minSevereOverlapDistance != null && audit.minSevereOverlapDistance < bondLength * 0.1;
}

/**
 * Returns whether bridge-path projection stretched a compact bridged seed far
 * past the KK baseline. Projection is useful for readable bridge arcs, but it
 * should not replace a seed with many fewer bond failures when the projected
 * path has created visibly malformed ring bonds.
 * @param {object|null} projectedAudit - Projected bridge-path audit.
 * @param {object|null} baselineAudit - Oriented KK baseline audit.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when the oriented KK baseline should be kept.
 */
function hasSevereBridgeProjectionBondRegression(projectedAudit, baselineAudit, bondLength) {
  if (!projectedAudit || !baselineAudit) {
    return false;
  }
  const baselineCrossings = baselineAudit.visibleHeavyBondCrossingCount ?? 0;
  const projectedCrossings = projectedAudit.visibleHeavyBondCrossingCount ?? 0;
  if (
    baselineAudit.severeOverlapCount === 0 &&
    projectedAudit.severeOverlapCount >= 2 &&
    projectedAudit.bondLengthFailureCount >= baselineAudit.bondLengthFailureCount + 3 &&
    projectedAudit.maxBondLengthDeviation > baselineAudit.maxBondLengthDeviation + bondLength * 0.25 &&
    baselineCrossings <= projectedCrossings + 1
  ) {
    return true;
  }
  if (
    baselineAudit.severeOverlapCount <= projectedAudit.severeOverlapCount &&
    baselineCrossings <= projectedCrossings &&
    projectedAudit.bondLengthFailureCount >= baselineAudit.bondLengthFailureCount &&
    baselineAudit.maxBondLengthDeviation <= bondLength * BRIDGED_PROJECTION_SAME_FAILURE_MAX_BASELINE_DEVIATION_FACTOR &&
    projectedAudit.maxBondLengthDeviation > baselineAudit.maxBondLengthDeviation + bondLength * BRIDGED_PROJECTION_SAME_FAILURE_MAX_REGRESSION_FACTOR
  ) {
    return true;
  }
  return (
    baselineAudit.severeOverlapCount <= projectedAudit.severeOverlapCount &&
    baselineCrossings <= projectedCrossings &&
    projectedAudit.bondLengthFailureCount > baselineAudit.bondLengthFailureCount &&
    projectedAudit.maxBondLengthDeviation > baselineAudit.maxBondLengthDeviation + bondLength * BRIDGED_PROJECTION_MAX_BOND_REGRESSION_FACTOR
  );
}

function shouldRefineStrainedCompactBridgedSeed(layoutGraph, atomIds, audit) {
  return atomIds.length <= BRIDGED_KK_LIMITS.fastAtomLimit && !containsMetalAtom(layoutGraph, atomIds) && (audit?.maxBondLengthDeviation ?? 0) > STRAINED_COMPACT_BRIDGED_MAX_DEVIATION;
}

function isCompactSharedPathSpiroFiveRingSystem(layoutGraph, rings, atomIds) {
  if (rings.length !== 3 || atomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || rings.some(ring => ring.aromatic) || containsMetalAtom(layoutGraph, atomIds)) {
    return false;
  }

  const ringSizes = rings.map(ring => ring.atomIds.length).sort((firstSize, secondSize) => firstSize - secondSize);
  if (ringSizes[0] !== 3 || ringSizes[1] !== 5 || ringSizes[2] !== 5) {
    return false;
  }

  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const ringIds = new Set(rings.map(ring => ring.id));
  const connections = (layoutGraph.ringConnections ?? []).filter(connection => ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId));
  return (
    connections.some(connection => connection.kind === 'bridged' && (connection.sharedAtomIds?.length ?? 0) >= 3) &&
    connections.some(connection => {
      if (connection.kind !== 'spiro' || (connection.sharedAtomIds?.length ?? 0) !== 1) {
        return false;
      }
      const firstRing = ringById.get(connection.firstRingId);
      const secondRing = ringById.get(connection.secondRingId);
      return firstRing?.atomIds.length === 3 || secondRing?.atomIds.length === 3;
    })
  );
}

function shouldTryStrictCompactBridgedBondRescue(layoutGraph, rings, atomIds, audit) {
  return Boolean(audit && audit.bondLengthFailureCount > 0 && isCompactSharedPathSpiroFiveRingSystem(layoutGraph, rings, atomIds));
}

function fitRegularRingTargets(ring, coords, bondLength) {
  const positions = ring.atomIds.map(atomId => coords.get(atomId));
  if (positions.some(position => !position)) {
    return null;
  }

  const center = centroid(positions);
  const step = (2 * Math.PI) / ring.atomIds.length;
  const radius = bondLength / (2 * Math.sin(Math.PI / ring.atomIds.length));
  const actualAngles = positions.map(position => angleOf(sub(position, center)));
  let bestTargets = null;
  let bestError = Number.POSITIVE_INFINITY;

  for (const direction of [1, -1]) {
    const offsetVector = actualAngles.reduce(
      (sum, angle, index) => {
        const offset = angle - direction * index * step;
        return {
          x: sum.x + Math.cos(offset),
          y: sum.y + Math.sin(offset)
        };
      },
      { x: 0, y: 0 }
    );
    const baseAngle = Math.atan2(offsetVector.y, offsetVector.x);
    const targets = new Map();
    let error = 0;

    for (let index = 0; index < ring.atomIds.length; index++) {
      const target = add(center, fromAngle(baseAngle + direction * index * step, radius));
      const actual = positions[index];
      error += (target.x - actual.x) ** 2 + (target.y - actual.y) ** 2;
      targets.set(ring.atomIds[index], target);
    }

    if (error < bestError) {
      bestError = error;
      bestTargets = targets;
    }
  }

  return bestTargets;
}

function aromaticRingShapeScore(rings, coords, bondLength) {
  let maxBondDeviation = 0;
  let maxAngleDeviation = 0;
  let totalBondDeviation = 0;
  let totalAngleDeviation = 0;
  let sampleCount = 0;

  for (const ring of rings) {
    if (!ring.aromatic || ring.atomIds.length < 5 || ring.atomIds.some(atomId => !coords.has(atomId))) {
      continue;
    }
    const targetAngle = Math.PI - (2 * Math.PI) / ring.atomIds.length;
    for (let index = 0; index < ring.atomIds.length; index++) {
      const atomId = ring.atomIds[index];
      const previousAtomId = ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length];
      const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
      const atomPosition = coords.get(atomId);
      const previousPosition = coords.get(previousAtomId);
      const nextPosition = coords.get(nextAtomId);
      const bondDeviation = Math.abs(Math.hypot(nextPosition.x - atomPosition.x, nextPosition.y - atomPosition.y) - bondLength);
      const angleDeviation = Math.abs(angularDifference(angleOf(sub(previousPosition, atomPosition)), angleOf(sub(nextPosition, atomPosition))) - targetAngle);
      maxBondDeviation = Math.max(maxBondDeviation, bondDeviation);
      maxAngleDeviation = Math.max(maxAngleDeviation, angleDeviation);
      totalBondDeviation += bondDeviation;
      totalAngleDeviation += angleDeviation;
      sampleCount++;
    }
  }

  return sampleCount === 0
    ? null
    : {
        maxBondDeviation,
        maxAngleDeviation,
        totalScore: maxBondDeviation * 10 + maxAngleDeviation + (totalBondDeviation + totalAngleDeviation) / sampleCount
      };
}

function buildAromaticRegularizedCoords(rings, coords, bondLength, blendFactor) {
  const targetSums = new Map();
  const targetCounts = new Map();

  for (const ring of rings) {
    if (!ring.aromatic || ring.atomIds.length < 5) {
      continue;
    }
    const targets = fitRegularRingTargets(ring, coords, bondLength);
    if (!targets) {
      continue;
    }
    for (const [atomId, target] of targets) {
      const sum = targetSums.get(atomId) ?? { x: 0, y: 0 };
      sum.x += target.x;
      sum.y += target.y;
      targetSums.set(atomId, sum);
      targetCounts.set(atomId, (targetCounts.get(atomId) ?? 0) + 1);
    }
  }

  if (targetSums.size === 0) {
    return null;
  }

  const candidateCoords = cloneCoords(coords);
  for (const [atomId, sum] of targetSums) {
    const count = targetCounts.get(atomId) ?? 0;
    const current = coords.get(atomId);
    if (!current || count <= 0) {
      continue;
    }
    const target = {
      x: sum.x / count,
      y: sum.y / count
    };
    candidateCoords.set(atomId, {
      x: current.x * (1 - blendFactor) + target.x * blendFactor,
      y: current.y * (1 - blendFactor) + target.y * blendFactor
    });
  }
  return candidateCoords;
}

function fitRegularRingTargetsFromSharedEdge(layoutGraph, ring, coords) {
  if (!layoutGraph || !ring?.aromatic || ring.atomIds.length < 5) {
    return null;
  }

  const step = (2 * Math.PI) / ring.atomIds.length;
  let bestTargets = null;
  let bestError = Number.POSITIVE_INFINITY;

  for (let index = 0; index < ring.atomIds.length; index++) {
    const firstAtomId = ring.atomIds[index];
    const secondAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
    if ((layoutGraph.ringCountByAtomId.get(firstAtomId) ?? 0) <= 1 || (layoutGraph.ringCountByAtomId.get(secondAtomId) ?? 0) <= 1) {
      continue;
    }

    const firstPosition = coords.get(firstAtomId);
    const secondPosition = coords.get(secondAtomId);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const edgeVector = sub(secondPosition, firstPosition);
    const edgeLength = Math.hypot(edgeVector.x, edgeVector.y);
    if (edgeLength <= 1e-9) {
      continue;
    }

    const radius = edgeLength / (2 * Math.sin(Math.PI / ring.atomIds.length));
    const apothem = edgeLength / (2 * Math.tan(Math.PI / ring.atomIds.length));
    const midpoint = {
      x: (firstPosition.x + secondPosition.x) / 2,
      y: (firstPosition.y + secondPosition.y) / 2
    };
    const unitNormal = {
      x: -edgeVector.y / edgeLength,
      y: edgeVector.x / edgeLength
    };

    for (const side of [1, -1]) {
      const center = {
        x: midpoint.x + unitNormal.x * apothem * side,
        y: midpoint.y + unitNormal.y * apothem * side
      };
      const firstAngle = angleOf(sub(firstPosition, center));
      for (const direction of [1, -1]) {
        const predictedSecondPosition = add(center, fromAngle(firstAngle + direction * step, radius));
        if (Math.hypot(predictedSecondPosition.x - secondPosition.x, predictedSecondPosition.y - secondPosition.y) > 1e-6) {
          continue;
        }

        const targets = new Map();
        let error = 0;
        for (let offset = 0; offset < ring.atomIds.length; offset++) {
          const atomId = ring.atomIds[(index + offset) % ring.atomIds.length];
          const target = add(center, fromAngle(firstAngle + direction * offset * step, radius));
          const actual = coords.get(atomId);
          if (!actual) {
            error = Number.POSITIVE_INFINITY;
            break;
          }
          error += (target.x - actual.x) ** 2 + (target.y - actual.y) ** 2;
          targets.set(atomId, target);
        }
        if (error < bestError) {
          bestError = error;
          bestTargets = targets;
        }
      }
    }
  }

  return bestTargets;
}

function sharedRingMembershipCounts(rings) {
  const membershipCounts = new Map();
  for (const ring of rings) {
    for (const atomId of ring.atomIds) {
      membershipCounts.set(atomId, (membershipCounts.get(atomId) ?? 0) + 1);
    }
  }
  return membershipCounts;
}

function peripheralSharedEdgeAtomIds(ring, membershipCounts) {
  const sharedAtomIds = ring.atomIds.filter(atomId => (membershipCounts.get(atomId) ?? 0) > 1);
  if (sharedAtomIds.length !== 2 || !atomIdsAreAdjacentInRing(ring, sharedAtomIds[0], sharedAtomIds[1])) {
    return null;
  }
  return sharedAtomIds;
}

function reflectPointAcrossLine(point, firstPosition, secondPosition) {
  const edgeVector = sub(secondPosition, firstPosition);
  const edgeLengthSquared = edgeVector.x ** 2 + edgeVector.y ** 2;
  if (edgeLengthSquared <= 1e-12) {
    return null;
  }
  const pointVector = sub(point, firstPosition);
  const projectionScale = (pointVector.x * edgeVector.x + pointVector.y * edgeVector.y) / edgeLengthSquared;
  const projectedPoint = {
    x: firstPosition.x + edgeVector.x * projectionScale,
    y: firstPosition.y + edgeVector.y * projectionScale
  };
  return {
    x: projectedPoint.x * 2 - point.x,
    y: projectedPoint.y * 2 - point.y
  };
}

function scalePointFromLine(point, firstPosition, secondPosition, factor) {
  const edgeVector = sub(secondPosition, firstPosition);
  const edgeLengthSquared = edgeVector.x ** 2 + edgeVector.y ** 2;
  if (edgeLengthSquared <= 1e-12) {
    return null;
  }
  const pointVector = sub(point, firstPosition);
  const projectionScale = (pointVector.x * edgeVector.x + pointVector.y * edgeVector.y) / edgeLengthSquared;
  const projectedPoint = {
    x: firstPosition.x + edgeVector.x * projectionScale,
    y: firstPosition.y + edgeVector.y * projectionScale
  };
  return {
    x: projectedPoint.x + (point.x - projectedPoint.x) * factor,
    y: projectedPoint.y + (point.y - projectedPoint.y) * factor
  };
}

function fitRegularRingTargetsFromAnchoredEdge(ring, coords, edgeAtomIds) {
  if (!ring || ring.atomIds.length < 5 || !Array.isArray(edgeAtomIds) || edgeAtomIds.length !== 2) {
    return null;
  }

  const step = (2 * Math.PI) / ring.atomIds.length;
  let bestTargets = null;
  let bestError = Number.POSITIVE_INFINITY;

  for (let index = 0; index < ring.atomIds.length; index++) {
    const firstAtomId = ring.atomIds[index];
    const secondAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
    if (!((firstAtomId === edgeAtomIds[0] && secondAtomId === edgeAtomIds[1]) || (firstAtomId === edgeAtomIds[1] && secondAtomId === edgeAtomIds[0]))) {
      continue;
    }

    const firstPosition = coords.get(firstAtomId);
    const secondPosition = coords.get(secondAtomId);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const edgeVector = sub(secondPosition, firstPosition);
    const edgeLength = Math.hypot(edgeVector.x, edgeVector.y);
    if (edgeLength <= 1e-9) {
      continue;
    }

    const radius = edgeLength / (2 * Math.sin(Math.PI / ring.atomIds.length));
    const apothem = edgeLength / (2 * Math.tan(Math.PI / ring.atomIds.length));
    const midpoint = {
      x: (firstPosition.x + secondPosition.x) / 2,
      y: (firstPosition.y + secondPosition.y) / 2
    };
    const unitNormal = {
      x: -edgeVector.y / edgeLength,
      y: edgeVector.x / edgeLength
    };

    for (const side of [1, -1]) {
      const center = {
        x: midpoint.x + unitNormal.x * apothem * side,
        y: midpoint.y + unitNormal.y * apothem * side
      };
      const firstAngle = angleOf(sub(firstPosition, center));
      for (const direction of [1, -1]) {
        const predictedSecondPosition = add(center, fromAngle(firstAngle + direction * step, radius));
        if (Math.hypot(predictedSecondPosition.x - secondPosition.x, predictedSecondPosition.y - secondPosition.y) > 1e-6) {
          continue;
        }

        const targets = new Map();
        let error = 0;
        for (let offset = 0; offset < ring.atomIds.length; offset++) {
          const atomId = ring.atomIds[(index + offset) % ring.atomIds.length];
          const target = add(center, fromAngle(firstAngle + direction * offset * step, radius));
          const actual = coords.get(atomId);
          if (!actual) {
            error = Number.POSITIVE_INFINITY;
            break;
          }
          error += (target.x - actual.x) ** 2 + (target.y - actual.y) ** 2;
          targets.set(atomId, target);
        }
        if (error < bestError) {
          bestError = error;
          bestTargets = targets;
        }
      }
    }
  }

  return bestTargets;
}

function buildAromaticSharedEdgeRegularizedCoords(layoutGraph, rings, coords) {
  const targetSums = new Map();
  const targetCounts = new Map();

  for (const ring of rings) {
    const targets = fitRegularRingTargetsFromSharedEdge(layoutGraph, ring, coords);
    if (!targets) {
      continue;
    }
    for (const [atomId, target] of targets) {
      const sum = targetSums.get(atomId) ?? { x: 0, y: 0 };
      sum.x += target.x;
      sum.y += target.y;
      targetSums.set(atomId, sum);
      targetCounts.set(atomId, (targetCounts.get(atomId) ?? 0) + 1);
    }
  }

  if (targetSums.size === 0) {
    return null;
  }

  const candidateCoords = cloneCoords(coords);
  for (const [atomId, sum] of targetSums) {
    const count = targetCounts.get(atomId) ?? 0;
    if (count <= 0) {
      continue;
    }
    candidateCoords.set(atomId, {
      x: sum.x / count,
      y: sum.y / count
    });
  }
  return candidateCoords;
}

function sharedRingAtomIds(firstRing, secondRing) {
  const secondAtomIds = new Set(secondRing.atomIds);
  return firstRing.atomIds.filter(atomId => secondAtomIds.has(atomId));
}

function atomIdsAreAdjacentInRing(ring, firstAtomId, secondAtomId) {
  const firstIndex = ring.atomIds.indexOf(firstAtomId);
  if (firstIndex < 0) {
    return false;
  }
  return ring.atomIds[(firstIndex + 1) % ring.atomIds.length] === secondAtomId || ring.atomIds[(firstIndex - 1 + ring.atomIds.length) % ring.atomIds.length] === secondAtomId;
}

/**
 * Splits a bridged ring-system atom set into covalent components after removing
 * one candidate spiro junction atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Ring-system atom IDs.
 * @param {string} anchorAtomId - Candidate shared atom.
 * @returns {string[][]} Connected components that do not include the anchor.
 */
function bridgedComponentsWithoutAnchor(layoutGraph, atomIds, anchorAtomId) {
  const remainingAtomIds = new Set(atomIds.filter(atomId => atomId !== anchorAtomId));
  const seenAtomIds = new Set();
  const components = [];

  for (const atomId of remainingAtomIds) {
    if (seenAtomIds.has(atomId)) {
      continue;
    }
    const component = [];
    const pendingAtomIds = [atomId];
    seenAtomIds.add(atomId);
    while (pendingAtomIds.length > 0) {
      const currentAtomId = pendingAtomIds.pop();
      component.push(currentAtomId);
      for (const bond of layoutGraph.bondsByAtomId.get(currentAtomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const neighborAtomId = bond.a === currentAtomId ? bond.b : bond.a;
        if (!remainingAtomIds.has(neighborAtomId) || seenAtomIds.has(neighborAtomId)) {
          continue;
        }
        seenAtomIds.add(neighborAtomId);
        pendingAtomIds.push(neighborAtomId);
      }
    }
    components.push(component);
  }

  return components;
}

/**
 * Returns heavy neighbors of a candidate spiro junction that belong to one
 * component after the junction atom is removed.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Candidate shared atom.
 * @param {string[]} componentAtomIds - Atom IDs in one separated component.
 * @returns {string[]} Heavy anchor-neighbor IDs inside the component.
 */
function heavyAnchorNeighborsInComponent(layoutGraph, anchorAtomId, componentAtomIds) {
  const componentAtomIdSet = new Set(componentAtomIds);
  return (layoutGraph.bondsByAtomId.get(anchorAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === anchorAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => componentAtomIdSet.has(neighborAtomId) && layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
}

/**
 * Measures angular spacing between ring blocks sharing a single spiro atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Candidate spiro atom.
 * @param {Array<{atomIds: string[], neighborAtomIds: string[]}>} groups - Ring-block groups around the anchor.
 * @returns {{minSeparation: number, minCrossSeparation: number, crossSeparationSum: number}|null} Spacing score.
 */
function scoreSpiroJunctionRingSpread(layoutGraph, coords, anchorAtomId, groups) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const neighborRecords = [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    for (const neighborAtomId of groups[groupIndex].neighborAtomIds) {
      const neighborPosition = coords.get(neighborAtomId);
      if (!neighborPosition || layoutGraph.atoms.get(neighborAtomId)?.element === 'H') {
        continue;
      }
      neighborRecords.push({
        atomId: neighborAtomId,
        groupIndex,
        angle: angleOf(sub(neighborPosition, anchorPosition))
      });
    }
  }
  if (neighborRecords.length < 4) {
    return null;
  }

  let minSeparation = Number.POSITIVE_INFINITY;
  let minCrossSeparation = Number.POSITIVE_INFINITY;
  let crossSeparationSum = 0;
  for (let firstIndex = 0; firstIndex < neighborRecords.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborRecords.length; secondIndex++) {
      const separation = angularDifference(neighborRecords[firstIndex].angle, neighborRecords[secondIndex].angle);
      minSeparation = Math.min(minSeparation, separation);
      if (neighborRecords[firstIndex].groupIndex !== neighborRecords[secondIndex].groupIndex) {
        minCrossSeparation = Math.min(minCrossSeparation, separation);
        crossSeparationSum += separation;
      }
    }
  }
  return { minSeparation, minCrossSeparation, crossSeparationSum };
}

/**
 * Prefers candidate spiro ring-block rotations that improve local spacing
 * without making bridged-placement audit metrics worse.
 * @param {object|null} candidate - Candidate record.
 * @param {object|null} incumbent - Current best candidate record.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
function isBetterSpiroJunctionRingSpreadCandidate(candidate, incumbent) {
  if (!candidate) {
    return false;
  }
  if (!incumbent) {
    return true;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount < incumbent.audit.severeOverlapCount;
  }
  if ((candidate.audit.visibleHeavyBondCrossingCount ?? 0) !== (incumbent.audit.visibleHeavyBondCrossingCount ?? 0)) {
    return (candidate.audit.visibleHeavyBondCrossingCount ?? 0) < (incumbent.audit.visibleHeavyBondCrossingCount ?? 0);
  }
  if (candidate.score.minCrossSeparation > incumbent.score.minCrossSeparation + SPIRO_JUNCTION_RING_SPREAD_EPSILON) {
    return true;
  }
  if (candidate.score.minCrossSeparation < incumbent.score.minCrossSeparation - SPIRO_JUNCTION_RING_SPREAD_EPSILON) {
    return false;
  }
  if (candidate.score.minSeparation > incumbent.score.minSeparation + SPIRO_JUNCTION_RING_SPREAD_EPSILON) {
    return true;
  }
  if (candidate.score.minSeparation < incumbent.score.minSeparation - SPIRO_JUNCTION_RING_SPREAD_EPSILON) {
    return false;
  }
  if (Math.abs(candidate.score.crossSeparationSum - incumbent.score.crossSeparationSum) > SPIRO_JUNCTION_RING_SPREAD_EPSILON) {
    return candidate.score.crossSeparationSum > incumbent.score.crossSeparationSum;
  }
  return candidate.rotationMagnitude < incumbent.rotationMagnitude - SPIRO_JUNCTION_RING_SPREAD_EPSILON;
}

/**
 * Rotates an entire ring block around its shared spiro junction.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Shared spiro atom.
 * @param {string[]} atomIds - Ring-block atom IDs to rotate.
 * @param {number} rotationAngle - Rotation angle in radians.
 * @returns {Map<string, {x: number, y: number}>|null} Rotated coordinate map.
 */
function rotateSpiroJunctionGroup(coords, anchorAtomId, atomIds, rotationAngle) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const candidateCoords = cloneCoords(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, add(anchorPosition, rotate(sub(position, anchorPosition), rotationAngle)));
  }
  return candidateCoords;
}

/**
 * Rotates one side of a single-atom spiro junction when the generic bridged
 * fallback stacks two ring blocks into a visibly pinched local fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Adjusted coordinate map.
 */
function spreadSpiroJunctionRingBlocks(layoutGraph, rings, atomIds, inputCoords, bondLength) {
  let coords = inputCoords;
  const atomIdSet = new Set(atomIds);

  for (const anchorAtomId of atomIds) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    const anchorRings = rings.filter(ring => ring.atomIds.includes(anchorAtomId));
    if (!anchorAtom || anchorAtom.element === 'H' || anchorAtom.heavyDegree < 4 || anchorRings.length < 2 || layoutGraph.fixedCoords.has(anchorAtomId)) {
      continue;
    }

    const groups = bridgedComponentsWithoutAnchor(layoutGraph, atomIds, anchorAtomId)
      .map(componentAtomIds => ({
        atomIds: componentAtomIds,
        neighborAtomIds: heavyAnchorNeighborsInComponent(layoutGraph, anchorAtomId, componentAtomIds)
      }))
      .filter(group => group.neighborAtomIds.length === 2);
    if (groups.length !== 2 || groups.some(group => group.atomIds.some(atomId => !atomIdSet.has(atomId)))) {
      continue;
    }

    const baseScore = scoreSpiroJunctionRingSpread(layoutGraph, coords, anchorAtomId, groups);
    if (!baseScore || baseScore.minCrossSeparation >= SPIRO_JUNCTION_RING_SPREAD_MIN_CROSS_ANGLE) {
      continue;
    }
    const baseAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
    let bestCandidate = {
      coords,
      score: baseScore,
      audit: baseAudit,
      rotationMagnitude: 0
    };

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      if (groups[groupIndex].atomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))) {
        continue;
      }
      for (const rotationAngle of SPIRO_JUNCTION_RING_SPREAD_OFFSETS) {
        const candidateCoords = rotateSpiroJunctionGroup(coords, anchorAtomId, groups[groupIndex].atomIds, rotationAngle);
        if (!candidateCoords) {
          continue;
        }
        const candidateScore = scoreSpiroJunctionRingSpread(layoutGraph, candidateCoords, anchorAtomId, groups);
        if (!candidateScore || candidateScore.minCrossSeparation <= baseScore.minCrossSeparation + SPIRO_JUNCTION_RING_SPREAD_EPSILON) {
          continue;
        }
        const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
        if (candidateAudit.bondLengthFailureCount > baseAudit.bondLengthFailureCount || candidateAudit.maxBondLengthDeviation > baseAudit.maxBondLengthDeviation + SPIRO_JUNCTION_RING_SPREAD_EPSILON) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          score: candidateScore,
          audit: candidateAudit,
          rotationMagnitude: Math.abs(rotationAngle)
        };
        if (isBetterSpiroJunctionRingSpreadCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    }

    if (bestCandidate.coords !== coords) {
      coords = bestCandidate.coords;
    }
  }

  return coords;
}

function pointSideOfEdge(point, firstPosition, secondPosition) {
  return (secondPosition.x - firstPosition.x) * (point.y - firstPosition.y) - (secondPosition.y - firstPosition.y) * (point.x - firstPosition.x);
}

function regularRingTargetCandidatesForFixedEdge(ring, coords, firstAtomId, secondAtomId, firstPosition, secondPosition) {
  const step = (2 * Math.PI) / ring.atomIds.length;
  const edgeVector = sub(secondPosition, firstPosition);
  const edgeLength = Math.hypot(edgeVector.x, edgeVector.y);
  if (edgeLength <= 1e-9) {
    return [];
  }

  const radius = edgeLength / (2 * Math.sin(Math.PI / ring.atomIds.length));
  const apothem = edgeLength / (2 * Math.tan(Math.PI / ring.atomIds.length));
  const midpoint = {
    x: (firstPosition.x + secondPosition.x) / 2,
    y: (firstPosition.y + secondPosition.y) / 2
  };
  const unitNormal = {
    x: -edgeVector.y / edgeLength,
    y: edgeVector.x / edgeLength
  };
  const candidates = [];

  for (const [edgeFirstAtomId, edgeSecondAtomId, edgeFirstPosition, edgeSecondPosition] of [
    [firstAtomId, secondAtomId, firstPosition, secondPosition],
    [secondAtomId, firstAtomId, secondPosition, firstPosition]
  ]) {
    const edgeFirstIndex = ring.atomIds.indexOf(edgeFirstAtomId);
    if (edgeFirstIndex < 0 || ring.atomIds[(edgeFirstIndex + 1) % ring.atomIds.length] !== edgeSecondAtomId) {
      continue;
    }

    for (const side of [1, -1]) {
      const center = {
        x: midpoint.x + unitNormal.x * apothem * side,
        y: midpoint.y + unitNormal.y * apothem * side
      };
      const firstAngle = angleOf(sub(edgeFirstPosition, center));
      for (const direction of [1, -1]) {
        const predictedSecondPosition = add(center, fromAngle(firstAngle + direction * step, radius));
        if (Math.hypot(predictedSecondPosition.x - edgeSecondPosition.x, predictedSecondPosition.y - edgeSecondPosition.y) > 1e-6) {
          continue;
        }

        const targets = new Map();
        let error = 0;
        for (let offset = 0; offset < ring.atomIds.length; offset++) {
          const atomId = ring.atomIds[(edgeFirstIndex + offset) % ring.atomIds.length];
          const target = add(center, fromAngle(firstAngle + direction * offset * step, radius));
          const actual = coords.get(atomId);
          if (!actual) {
            error = Number.POSITIVE_INFINITY;
            break;
          }
          error += (target.x - actual.x) ** 2 + (target.y - actual.y) ** 2;
          targets.set(atomId, target);
        }
        if (Number.isFinite(error)) {
          candidates.push({ targets, error });
        }
      }
    }
  }

  return candidates.sort((firstCandidate, secondCandidate) => firstCandidate.error - secondCandidate.error);
}

function translatedFixedAnchorTargets(targets, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  const anchorTarget = targets?.get(anchorAtomId);
  if (!anchorPosition || !anchorTarget) {
    return null;
  }

  const delta = sub(anchorPosition, anchorTarget);
  const translatedTargets = new Map();
  let error = 0;
  for (const [atomId, target] of targets) {
    const translatedTarget = add(target, delta);
    const current = coords.get(atomId);
    if (!current) {
      return null;
    }
    error += (translatedTarget.x - current.x) ** 2 + (translatedTarget.y - current.y) ** 2;
    translatedTargets.set(atomId, translatedTarget);
  }
  return { targets: translatedTargets, error };
}

function regularRingTargetCandidatesForFixedAnchor(ring, coords, anchorAtomId, bondLength) {
  const anchorPosition = coords.get(anchorAtomId);
  const anchorIndex = ring.atomIds.indexOf(anchorAtomId);
  if (!anchorPosition || anchorIndex < 0) {
    return [];
  }

  const candidates = [];
  const fittedTargets = fitRegularRingTargets(ring, coords, bondLength);
  const translatedCandidate = translatedFixedAnchorTargets(fittedTargets, coords, anchorAtomId);
  if (translatedCandidate) {
    candidates.push(translatedCandidate);
  }

  for (const neighborAtomId of [ring.atomIds[(anchorIndex - 1 + ring.atomIds.length) % ring.atomIds.length], ring.atomIds[(anchorIndex + 1) % ring.atomIds.length]]) {
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborPosition) {
      continue;
    }
    const neighborAngle = angleOf(sub(neighborPosition, anchorPosition));
    const exactNeighborPosition = add(anchorPosition, fromAngle(neighborAngle, bondLength));
    candidates.push(...regularRingTargetCandidatesForFixedEdge(ring, coords, anchorAtomId, neighborAtomId, anchorPosition, exactNeighborPosition));
  }

  return candidates.sort((firstCandidate, secondCandidate) => firstCandidate.error - secondCandidate.error);
}

function fusedAromaticCyclohexanePairs(rings) {
  const pairs = [];
  for (const aromaticRing of rings) {
    if (!aromaticRing.aromatic || ![5, 6].includes(aromaticRing.atomIds.length)) {
      continue;
    }
    for (const cyclohexaneRing of rings) {
      if (cyclohexaneRing === aromaticRing || cyclohexaneRing.aromatic || cyclohexaneRing.atomIds.length !== 6) {
        continue;
      }
      const sharedAtomIds = sharedRingAtomIds(aromaticRing, cyclohexaneRing);
      if (sharedAtomIds.length !== 2) {
        continue;
      }
      if (!atomIdsAreAdjacentInRing(aromaticRing, sharedAtomIds[0], sharedAtomIds[1]) || !atomIdsAreAdjacentInRing(cyclohexaneRing, sharedAtomIds[0], sharedAtomIds[1])) {
        continue;
      }
      pairs.push({ aromaticRing, cyclohexaneRing, sharedAtomIds });
    }
  }
  return pairs;
}

function exactFusedAromaticCyclohexanePairTargetCandidates(pair, coords, bondLength) {
  const [firstAtomId, secondAtomId] = pair.sharedAtomIds;
  const firstPosition = coords.get(firstAtomId);
  const secondPosition = coords.get(secondAtomId);
  if (!firstPosition || !secondPosition) {
    return [];
  }
  const edgeVector = sub(secondPosition, firstPosition);
  const edgeLength = Math.hypot(edgeVector.x, edgeVector.y);
  if (edgeLength <= 1e-9) {
    return [];
  }
  const unitEdge = {
    x: edgeVector.x / edgeLength,
    y: edgeVector.y / edgeLength
  };
  const midpoint = {
    x: (firstPosition.x + secondPosition.x) / 2,
    y: (firstPosition.y + secondPosition.y) / 2
  };
  const exactFirstPosition = {
    x: midpoint.x - (unitEdge.x * bondLength) / 2,
    y: midpoint.y - (unitEdge.y * bondLength) / 2
  };
  const exactSecondPosition = {
    x: midpoint.x + (unitEdge.x * bondLength) / 2,
    y: midpoint.y + (unitEdge.y * bondLength) / 2
  };
  const aromaticCandidates = regularRingTargetCandidatesForFixedEdge(pair.aromaticRing, coords, firstAtomId, secondAtomId, exactFirstPosition, exactSecondPosition);
  const cyclohexaneCandidates = regularRingTargetCandidatesForFixedEdge(pair.cyclohexaneRing, coords, firstAtomId, secondAtomId, exactFirstPosition, exactSecondPosition);
  if (aromaticCandidates.length === 0 || cyclohexaneCandidates.length === 0) {
    return [];
  }
  const candidates = [];
  for (const aromaticCandidate of aromaticCandidates) {
    for (const cyclohexaneCandidate of cyclohexaneCandidates) {
      candidates.push({
        targets: new Map([...aromaticCandidate.targets, ...cyclohexaneCandidate.targets]),
        error: aromaticCandidate.error + cyclohexaneCandidate.error
      });
    }
  }
  return candidates.sort((firstCandidate, secondCandidate) => firstCandidate.error - secondCandidate.error);
}

/**
 * Collects visible heavy atoms reachable from a side atom without crossing any
 * atom in the protected fused core.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} startAtomId - First atom outside the protected fused core.
 * @param {Set<string>} protectedAtomIds - Fused-core atoms that stop traversal.
 * @returns {Set<string>} Connected side atoms outside the protected core.
 */
function collectSideComponentExcludingProtectedAtoms(layoutGraph, startAtomId, protectedAtomIds) {
  const componentAtomIds = new Set([startAtomId]);
  const pendingAtomIds = [startAtomId];

  while (pendingAtomIds.length > 0) {
    const atomId = pendingAtomIds.pop();
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (protectedAtomIds.has(neighborAtomId) || componentAtomIds.has(neighborAtomId)) {
        continue;
      }
      if (layoutGraph.atoms.get(neighborAtomId)?.element === 'H') {
        continue;
      }
      componentAtomIds.add(neighborAtomId);
      pendingAtomIds.push(neighborAtomId);
    }
  }

  return componentAtomIds;
}

/**
 * Counts which protected fused-core atoms are adjacent to a side component.
 * Single-anchor components can move rigidly with the shifted anchor without
 * changing any in-component geometry.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Set<string>} componentAtomIds - Side component atom IDs.
 * @param {Set<string>} protectedAtomIds - Fused-core atom IDs.
 * @returns {Set<string>} Protected atom IDs adjacent to the component.
 */
function protectedNeighborsForSideComponent(layoutGraph, componentAtomIds, protectedAtomIds) {
  const protectedNeighborAtomIds = new Set();
  for (const atomId of componentAtomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (protectedAtomIds.has(neighborAtomId)) {
        protectedNeighborAtomIds.add(neighborAtomId);
      }
    }
  }
  return protectedNeighborAtomIds;
}

/**
 * Translates one-anchor branches and spiro side rings with a moved fused-core
 * atom. This keeps substituent and single-atom-spiro bond lengths unchanged
 * while exact fused aromatic/cyclohexane targets repair the protected core.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} pair - Fused aromatic/cyclohexane pair descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Original coordinates.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinates to mutate.
 * @returns {void}
 */
function translateSingleAnchorSideComponentsWithFusedCore(layoutGraph, pair, coords, candidateCoords) {
  const protectedAtomIds = new Set([...pair.aromaticRing.atomIds, ...pair.cyclohexaneRing.atomIds]);
  const movedSideAtomIds = new Set();

  for (const anchorAtomId of protectedAtomIds) {
    const originalAnchorPosition = coords.get(anchorAtomId);
    const candidateAnchorPosition = candidateCoords.get(anchorAtomId);
    if (!originalAnchorPosition || !candidateAnchorPosition) {
      continue;
    }
    const delta = {
      x: candidateAnchorPosition.x - originalAnchorPosition.x,
      y: candidateAnchorPosition.y - originalAnchorPosition.y
    };
    if (Math.hypot(delta.x, delta.y) <= 1e-9) {
      continue;
    }

    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (protectedAtomIds.has(neighborAtomId) || movedSideAtomIds.has(neighborAtomId) || layoutGraph.atoms.get(neighborAtomId)?.element === 'H') {
        continue;
      }

      const componentAtomIds = collectSideComponentExcludingProtectedAtoms(layoutGraph, neighborAtomId, protectedAtomIds);
      const protectedNeighborAtomIds = protectedNeighborsForSideComponent(layoutGraph, componentAtomIds, protectedAtomIds);
      if (protectedNeighborAtomIds.size !== 1 || !protectedNeighborAtomIds.has(anchorAtomId) || [...componentAtomIds].some(atomId => layoutGraph.fixedCoords.has(atomId))) {
        continue;
      }

      for (const atomId of componentAtomIds) {
        const position = coords.get(atomId);
        if (!position || !candidateCoords.has(atomId)) {
          continue;
        }
        candidateCoords.set(atomId, {
          x: position.x + delta.x,
          y: position.y + delta.y
        });
        movedSideAtomIds.add(atomId);
      }
    }
  }
}

function cyclicExternalRuns(ring, anchorAtomIds) {
  const runs = [];
  const atomIds = ring.atomIds;
  for (let index = 0; index < atomIds.length; index++) {
    if (anchorAtomIds.has(atomIds[index])) {
      continue;
    }
    const previousAtomId = atomIds[(index - 1 + atomIds.length) % atomIds.length];
    if (!anchorAtomIds.has(previousAtomId)) {
      continue;
    }
    const internalAtomIds = [];
    let cursor = index;
    while (!anchorAtomIds.has(atomIds[cursor])) {
      internalAtomIds.push(atomIds[cursor]);
      cursor = (cursor + 1) % atomIds.length;
    }
    runs.push({
      startAtomId: previousAtomId,
      endAtomId: atomIds[cursor],
      internalAtomIds
    });
  }
  return runs;
}

function bridgeRunAvoidancePoint(coreRing, bridgeRing, run, coords) {
  const coreAtomIds = new Set(coreRing.atomIds);
  const internalSharedAtomIds = bridgeRing.atomIds.filter(atomId => coreAtomIds.has(atomId) && atomId !== run.startAtomId && atomId !== run.endAtomId);
  const points = internalSharedAtomIds.map(atomId => coords.get(atomId)).filter(Boolean);
  return points.length > 0 ? centroid(points) : centroid(coreRing.atomIds.map(atomId => coords.get(atomId)).filter(Boolean));
}

function sineBridgePathTargets(coords, run, avoidancePoint, bondLength, heightFactor) {
  const startPosition = coords.get(run.startAtomId);
  const endPosition = coords.get(run.endAtomId);
  if (!startPosition || !endPosition || run.internalAtomIds.length === 0) {
    return null;
  }

  const chord = sub(endPosition, startPosition);
  const chordLength = Math.hypot(chord.x, chord.y);
  if (chordLength <= 1e-9) {
    return null;
  }
  const segmentCount = run.internalAtomIds.length + 1;
  const unitChord = {
    x: chord.x / chordLength,
    y: chord.y / chordLength
  };
  const unitNormal = {
    x: -unitChord.y,
    y: unitChord.x
  };
  const avoidanceSide = avoidancePoint ? Math.sign(pointSideOfEdge(avoidancePoint, startPosition, endPosition)) : 0;
  const baseSide = avoidanceSide === 0 ? 1 : -avoidanceSide;
  const side = heightFactor < 0 ? -baseSide : baseSide;
  const chordRatio = chordLength / bondLength;
  if (chordRatio >= segmentCount) {
    return null;
  }

  let lowTheta = 1e-6;
  let highTheta = 2 * Math.PI - 1e-6;
  function chordToSegmentRatio(theta) {
    return Math.sin(theta / 2) / Math.sin(theta / (2 * segmentCount));
  }
  for (let iteration = 0; iteration < 48; iteration++) {
    const midTheta = (lowTheta + highTheta) / 2;
    if (chordToSegmentRatio(midTheta) > chordRatio) {
      lowTheta = midTheta;
    } else {
      highTheta = midTheta;
    }
  }

  const theta = Math.min(2 * Math.PI - 1e-6, Math.max(1e-6, ((lowTheta + highTheta) / 2) * Math.abs(heightFactor)));
  const radius = chordLength / (2 * Math.sin(theta / 2));
  const centerOffset = chordLength / (2 * Math.tan(theta / 2));
  const midpoint = {
    x: (startPosition.x + endPosition.x) / 2,
    y: (startPosition.y + endPosition.y) / 2
  };
  const center = {
    x: midpoint.x + unitNormal.x * side * centerOffset,
    y: midpoint.y + unitNormal.y * side * centerOffset
  };
  const startAngle = angleOf(sub(startPosition, center));
  const step = theta / segmentCount;

  function pathPoint(pathIndex) {
    const forwardPoint = add(center, fromAngle(startAngle + step * pathIndex, radius));
    const reversePoint = add(center, fromAngle(startAngle - step * pathIndex, radius));
    const forwardEnd = add(center, fromAngle(startAngle + theta, radius));
    return Math.hypot(forwardEnd.x - endPosition.x, forwardEnd.y - endPosition.y) <= 1e-6 ? forwardPoint : reversePoint;
  }

  const targets = new Map();
  for (let index = 0; index < run.internalAtomIds.length; index++) {
    targets.set(run.internalAtomIds[index], pathPoint(index + 1));
  }
  return targets;
}

function addVariableBridgePathTargets(layoutGraph, rings, pair, coords, candidateCoords, bondLength, heightFactor) {
  const coreAtomIds = new Set(pair.cyclohexaneRing.atomIds);
  let changed = false;
  for (const bridgeRing of rings) {
    if (bridgeRing === pair.cyclohexaneRing || bridgeRing === pair.aromaticRing) {
      continue;
    }
    const sharedAtomIds = bridgeRing.atomIds.filter(atomId => coreAtomIds.has(atomId));
    if (sharedAtomIds.length < 3) {
      continue;
    }
    const runs = cyclicExternalRuns(bridgeRing, coreAtomIds).filter(run => run.internalAtomIds.length > 0);
    if (runs.length !== 1) {
      continue;
    }
    const avoidancePoint = bridgeRunAvoidancePoint(pair.cyclohexaneRing, bridgeRing, runs[0], candidateCoords);
    const targets = sineBridgePathTargets(candidateCoords, runs[0], avoidancePoint, bondLength, heightFactor);
    if (!targets) {
      continue;
    }
    for (const [atomId, position] of targets) {
      if (!layoutGraph.fixedCoords.has(atomId)) {
        candidateCoords.set(atomId, position);
        changed = true;
      }
    }
  }
  return changed;
}

function measureFusedCyclohexaneBranchSlotBlockers(pair, coords, bondLength) {
  const protectedAtomIds = new Set(pair.cyclohexaneRing.atomIds);
  let blockerCount = 0;
  for (const anchorAtomId of pair.cyclohexaneRing.atomIds) {
    const anchorPosition = coords.get(anchorAtomId);
    if (!anchorPosition) {
      continue;
    }
    const ringNeighborIds = [];
    for (let index = 0; index < pair.cyclohexaneRing.atomIds.length; index++) {
      if (pair.cyclohexaneRing.atomIds[index] !== anchorAtomId) {
        continue;
      }
      ringNeighborIds.push(
        pair.cyclohexaneRing.atomIds[(index - 1 + pair.cyclohexaneRing.atomIds.length) % pair.cyclohexaneRing.atomIds.length],
        pair.cyclohexaneRing.atomIds[(index + 1) % pair.cyclohexaneRing.atomIds.length]
      );
      break;
    }
    const ringNeighborPositions = ringNeighborIds.map(atomId => coords.get(atomId)).filter(Boolean);
    if (ringNeighborPositions.length !== 2) {
      continue;
    }
    const targetAngle = angleOf(sub(anchorPosition, centroid(ringNeighborPositions)));
    const targetPosition = add(anchorPosition, fromAngle(targetAngle, bondLength));
    for (const [blockerAtomId, blockerPosition] of coords) {
      if (protectedAtomIds.has(blockerAtomId) || ringNeighborIds.includes(blockerAtomId)) {
        continue;
      }
      const blockerDistance = Math.hypot(blockerPosition.x - targetPosition.x, blockerPosition.y - targetPosition.y);
      if (blockerDistance < bondLength * FUSED_CYCLOHEXANE_BRANCH_SLOT_BLOCKER_FACTOR) {
        blockerCount++;
      }
    }
  }
  return blockerCount;
}

function componentAdjacency(layoutGraph, componentAtomIds) {
  const componentAtomIdSet = new Set(componentAtomIds);
  const adjacency = new Map(componentAtomIds.map(atomId => [atomId, []]));
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || !componentAtomIdSet.has(bond.a) || !componentAtomIdSet.has(bond.b)) {
      continue;
    }
    adjacency.get(bond.a)?.push(bond.b);
    adjacency.get(bond.b)?.push(bond.a);
  }
  return adjacency;
}

function visibleHeavyParticipantAtomIds(layoutGraph, componentAtomIds) {
  return componentAtomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && atom.visible !== false;
  });
}

function fusedCyclohexaneBranchPreviewPenalty(layoutGraph, atomIds, coords, bondLength) {
  if (!layoutGraph || !(coords instanceof Map) || atomIds.length === 0) {
    return 0;
  }

  const ringAtomIds = new Set(atomIds);
  const component =
    atomIds.map(atomId => layoutGraph.componentByAtomId?.get(atomId)).find(Boolean) ??
    layoutGraph.components.find(candidateComponent => atomIds.some(atomId => candidateComponent.atomIds.includes(atomId)));
  if (!component) {
    return 0;
  }
  const participantAtomIds = visibleHeavyParticipantAtomIds(layoutGraph, component.atomIds);
  const hasUnplacedBranchAtom = participantAtomIds.some(atomId => !ringAtomIds.has(atomId) && !coords.has(atomId));
  if (!hasUnplacedBranchAtom) {
    return 0;
  }

  const previewCoords = cloneCoords(coords);
  placeRemainingBranches(componentAdjacency(layoutGraph, component.atomIds), layoutGraph.canonicalAtomRank, previewCoords, new Set(participantAtomIds), atomIds, bondLength, layoutGraph, null, 0, {});

  const threshold = bondLength * FUSED_CYCLOHEXANE_BRANCH_PREVIEW_OVERLAP_FACTOR;
  let overlapCount = 0;
  let deficitSum = 0;
  for (let firstIndex = 0; firstIndex < participantAtomIds.length; firstIndex++) {
    const firstAtomId = participantAtomIds[firstIndex];
    const firstPosition = previewCoords.get(firstAtomId);
    if (!firstPosition) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < participantAtomIds.length; secondIndex++) {
      const secondAtomId = participantAtomIds[secondIndex];
      if (ringAtomIds.has(firstAtomId) === ringAtomIds.has(secondAtomId)) {
        continue;
      }
      const pairKey = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
      if (layoutGraph.bondedPairSet.has(pairKey)) {
        continue;
      }
      const secondPosition = previewCoords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      const pairDistance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
      if (pairDistance < threshold) {
        overlapCount++;
        deficitSum += threshold - pairDistance;
      }
    }
  }
  return overlapCount * 10000 + deficitSum * 1000;
}

function fusedCyclohexaneShapeScore(layoutGraph, atomIds, pair, coords, bondLength) {
  let maxBondDeviation = 0;
  let maxAngleDeviation = 0;
  let sampleCount = 0;
  for (const ring of [pair.aromaticRing, pair.cyclohexaneRing]) {
    for (let index = 0; index < ring.atomIds.length; index++) {
      const atomId = ring.atomIds[index];
      const previousAtomId = ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length];
      const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
      const atomPosition = coords.get(atomId);
      const previousPosition = coords.get(previousAtomId);
      const nextPosition = coords.get(nextAtomId);
      if (!atomPosition || !previousPosition || !nextPosition) {
        return null;
      }
      maxBondDeviation = Math.max(maxBondDeviation, Math.abs(Math.hypot(nextPosition.x - atomPosition.x, nextPosition.y - atomPosition.y) - bondLength));
      maxAngleDeviation = Math.max(
        maxAngleDeviation,
        Math.abs(angularDifference(angleOf(sub(previousPosition, atomPosition)), angleOf(sub(nextPosition, atomPosition))) - (Math.PI - (2 * Math.PI) / ring.atomIds.length))
      );
      sampleCount++;
    }
  }
  const branchSlotBlockers = measureFusedCyclohexaneBranchSlotBlockers(pair, coords, bondLength);
  const branchPreviewPenalty = fusedCyclohexaneBranchPreviewPenalty(layoutGraph, atomIds, coords, bondLength);
  return sampleCount === 0 ? null : maxBondDeviation * 100000 + maxAngleDeviation * 1000 + branchSlotBlockers * 10 + branchPreviewPenalty * 0.01;
}

/**
 * Scores one ring against regular-polygon bond lengths and internal angles.
 * @param {object} ring - Ring descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {{maxBondDeviation: number, maxAngleDeviation: number, totalBondDeviation: number, totalAngleDeviation: number, totalScore: number}|null} Regularity score, or null for incomplete coordinates.
 */
function regularRingShapeScore(ring, coords, bondLength) {
  if (!ring || ring.atomIds.length < 3) {
    return null;
  }
  const targetAngle = Math.PI - (2 * Math.PI) / ring.atomIds.length;
  let maxBondDeviation = 0;
  let maxAngleDeviation = 0;
  let totalBondDeviation = 0;
  let totalAngleDeviation = 0;

  for (let index = 0; index < ring.atomIds.length; index++) {
    const atomId = ring.atomIds[index];
    const previousAtomId = ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length];
    const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
    const atomPosition = coords.get(atomId);
    const previousPosition = coords.get(previousAtomId);
    const nextPosition = coords.get(nextAtomId);
    if (!atomPosition || !previousPosition || !nextPosition) {
      return null;
    }

    const bondDeviation = Math.abs(Math.hypot(nextPosition.x - atomPosition.x, nextPosition.y - atomPosition.y) - bondLength);
    const angleDeviation = Math.abs(angularDifference(angleOf(sub(previousPosition, atomPosition)), angleOf(sub(nextPosition, atomPosition))) - targetAngle);
    maxBondDeviation = Math.max(maxBondDeviation, bondDeviation);
    maxAngleDeviation = Math.max(maxAngleDeviation, angleDeviation);
    totalBondDeviation += bondDeviation;
    totalAngleDeviation += angleDeviation;
  }

  return {
    maxBondDeviation,
    maxAngleDeviation,
    totalBondDeviation,
    totalAngleDeviation,
    totalScore: maxBondDeviation * 100000 + maxAngleDeviation * 1000 + totalBondDeviation + totalAngleDeviation
  };
}

/**
 * Scores all saturated bridged rings against regular-polygon bond and angle targets.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {{maxBondDeviation: number, maxAngleDeviation: number, totalBondDeviation: number, totalAngleDeviation: number, totalScore: number}|null} Aggregate regularity score, or null when incomplete.
 */
function saturatedBridgedRingShapeScore(rings, coords, bondLength) {
  let maxBondDeviation = 0;
  let maxAngleDeviation = 0;
  let totalBondDeviation = 0;
  let totalAngleDeviation = 0;
  let totalScore = 0;

  for (const ring of rings) {
    const ringScore = regularRingShapeScore(ring, coords, bondLength);
    if (!ringScore) {
      return null;
    }
    maxBondDeviation = Math.max(maxBondDeviation, ringScore.maxBondDeviation);
    maxAngleDeviation = Math.max(maxAngleDeviation, ringScore.maxAngleDeviation);
    totalBondDeviation += ringScore.totalBondDeviation;
    totalAngleDeviation += ringScore.totalAngleDeviation;
    totalScore += ringScore.totalScore;
  }

  return {
    maxBondDeviation,
    maxAngleDeviation,
    totalBondDeviation,
    totalAngleDeviation,
    totalScore
  };
}

/**
 * Returns non-fixed atoms shared by multiple rings in a compact bridged system.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @returns {string[]} Shared ring atom IDs eligible for local junction balancing.
 */
function saturatedBridgedRingJunctionAtomIds(layoutGraph, rings) {
  const ringMembershipCounts = new Map();
  for (const ring of rings) {
    for (const atomId of ring.atomIds) {
      ringMembershipCounts.set(atomId, (ringMembershipCounts.get(atomId) ?? 0) + 1);
    }
  }
  return [...ringMembershipCounts]
    .filter(([, count]) => count > 1)
    .map(([atomId]) => atomId)
    .filter(atomId => !layoutGraph.fixedCoords.has(atomId));
}

/**
 * Returns non-fixed atoms in the compact bridged ring system.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @returns {string[]} Ring atom IDs eligible for bounded shape balancing.
 */
function saturatedBridgedRingBalanceAtomIds(layoutGraph, rings) {
  const atomIds = [];
  const seenAtomIds = new Set();
  for (const ring of rings) {
    for (const atomId of ring.atomIds) {
      if (seenAtomIds.has(atomId) || layoutGraph.fixedCoords.has(atomId)) {
        continue;
      }
      seenAtomIds.add(atomId);
      atomIds.push(atomId);
    }
  }
  return atomIds;
}

/**
 * Returns whether a compact bridged system still needs local shared-junction
 * angle balancing after regular-polygon relaxation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {{maxAngleDeviation: number}|null} shapeScore - Current aggregate ring-shape score.
 * @returns {boolean} True when shared-junction balancing should run.
 */
function shouldBalanceSaturatedBridgedRingJunctions(layoutGraph, rings, atomIds, shapeScore) {
  return Boolean(
    shapeScore &&
    rings.length > 1 &&
    atomIds.length <= BRIDGED_KK_LIMITS.fastAtomLimit &&
    shapeScore.maxAngleDeviation > SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MIN_ANGLE_DEVIATION &&
    !containsMetalAtom(layoutGraph, atomIds) &&
    !rings.some(ring => ring.aromatic) &&
    saturatedBridgedCyclohexaneCoreRings(rings).length === 0 &&
    saturatedBridgedRingJunctionAtomIds(layoutGraph, rings).length > 0
  );
}

/**
 * Returns whether a local shared-junction candidate improves bridged ring
 * angles without exceeding the small bond-deviation allowance.
 * @param {object|null} candidateAudit - Candidate audit summary.
 * @param {object|null} incumbentAudit - Incumbent audit summary.
 * @param {{maxBondDeviation: number, maxAngleDeviation: number, totalBondDeviation: number, totalAngleDeviation: number}|null} candidateScore - Candidate ring-shape score.
 * @param {{maxBondDeviation: number, maxAngleDeviation: number, totalBondDeviation: number, totalAngleDeviation: number}|null} incumbentScore - Incumbent ring-shape score.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
function shouldAcceptSaturatedBridgedRingJunctionBalance(candidateAudit, incumbentAudit, candidateScore, incumbentScore, bondLength) {
  if (!candidateAudit || !incumbentAudit || !candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  const maxAllowedBondDeviation = bondLength * SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MAX_BOND_DEVIATION_FACTOR;
  if (candidateScore.maxBondDeviation > maxAllowedBondDeviation || candidateAudit.maxBondLengthDeviation > maxAllowedBondDeviation) {
    return false;
  }
  if (candidateScore.maxAngleDeviation < incumbentScore.maxAngleDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.maxAngleDeviation > incumbentScore.maxAngleDeviation + 1e-9) {
    return false;
  }
  if (candidateScore.totalAngleDeviation < incumbentScore.totalAngleDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.totalAngleDeviation > incumbentScore.totalAngleDeviation + 1e-9) {
    return false;
  }
  if (candidateScore.maxBondDeviation < incumbentScore.maxBondDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.maxBondDeviation > incumbentScore.maxBondDeviation + 1e-9) {
    return false;
  }
  return candidateScore.totalBondDeviation < incumbentScore.totalBondDeviation - 1e-9;
}

/**
 * Gently nudges shared bridged-ring junction atoms to distribute unavoidable
 * angle strain instead of leaving one ring visibly kinked.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Balanced coordinates when accepted, otherwise the original map.
 */
function balanceSaturatedBridgedRingJunctionAngles(layoutGraph, rings, atomIds, coords, bondLength) {
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  let bestScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  if (!bestAudit || !shouldBalanceSaturatedBridgedRingJunctions(layoutGraph, rings, atomIds, bestScore)) {
    return coords;
  }

  const junctionAtomIds = saturatedBridgedRingJunctionAtomIds(layoutGraph, rings);
  for (let pass = 0; pass < SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MAX_PASSES; pass++) {
    let acceptedInPass = false;
    for (const atomId of junctionAtomIds) {
      const basePosition = bestCoords.get(atomId);
      if (!basePosition) {
        continue;
      }
      for (const stepFactor of SATURATED_BRIDGED_RING_JUNCTION_BALANCE_STEP_FACTORS) {
        const step = bondLength * stepFactor;
        for (let directionIndex = 0; directionIndex < SATURATED_BRIDGED_RING_JUNCTION_BALANCE_DIRECTION_COUNT; directionIndex++) {
          const angle = (2 * Math.PI * directionIndex) / SATURATED_BRIDGED_RING_JUNCTION_BALANCE_DIRECTION_COUNT;
          const candidateCoords = cloneCoords(bestCoords);
          candidateCoords.set(atomId, {
            x: basePosition.x + Math.cos(angle) * step,
            y: basePosition.y + Math.sin(angle) * step
          });
          const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
          const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
          if (shouldAcceptSaturatedBridgedRingJunctionBalance(candidateAudit, bestAudit, candidateScore, bestScore, bondLength)) {
            bestCoords = candidateCoords;
            bestAudit = candidateAudit;
            bestScore = candidateScore;
            acceptedInPass = true;
          }
        }
      }
    }
    if (!acceptedInPass) {
      break;
    }
  }

  return bestCoords;
}

/**
 * Returns whether compact bridged rings still need whole-ring shape balancing
 * after shared-junction balancing has run.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {{maxBondDeviation: number, maxAngleDeviation: number}|null} shapeScore - Current aggregate ring-shape score.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when bounded whole-ring balancing should run.
 */
function shouldBalanceSaturatedBridgedRingShape(layoutGraph, rings, atomIds, shapeScore, bondLength) {
  return Boolean(
    shapeScore &&
    rings.length > 1 &&
    atomIds.length <= BRIDGED_KK_LIMITS.fastAtomLimit &&
    !containsMetalAtom(layoutGraph, atomIds) &&
    !rings.some(ring => ring.aromatic) &&
    saturatedBridgedCyclohexaneCoreRings(rings).length === 0 &&
    saturatedBridgedRingBalanceAtomIds(layoutGraph, rings).length > 0 &&
    (shapeScore.maxAngleDeviation > SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MIN_ANGLE_DEVIATION ||
      shapeScore.maxBondDeviation > bondLength * SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MAX_BOND_DEVIATION_FACTOR)
  );
}

/**
 * Searches bounded single-atom nudges for a better saturated bridged-ring shape.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {string[]} balanceAtomIds - Candidate atom IDs to nudge.
 * @param {Map<string, {x: number, y: number}>} coords - Starting coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {(candidateScore: object, incumbentScore: object) => boolean} shouldAcceptScore - Shape-score comparator.
 * @returns {{coords: Map<string, {x: number, y: number}>, score: object, audit: object}|null} Best accepted result, or null when incomplete.
 */
function searchSaturatedBridgedRingShapeBalance(layoutGraph, rings, atomIds, balanceAtomIds, coords, bondLength, shouldAcceptScore) {
  let bestCoords = coords;
  let bestScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  if (!bestScore || !bestAudit) {
    return null;
  }

  for (let pass = 0; pass < SATURATED_BRIDGED_RING_SHAPE_BALANCE_MAX_PASSES; pass++) {
    let acceptedInPass = false;
    for (const atomId of balanceAtomIds) {
      const basePosition = bestCoords.get(atomId);
      if (!basePosition) {
        continue;
      }
      for (const stepFactor of SATURATED_BRIDGED_RING_SHAPE_BALANCE_STEP_FACTORS) {
        const step = bondLength * stepFactor;
        for (let directionIndex = 0; directionIndex < SATURATED_BRIDGED_RING_SHAPE_BALANCE_DIRECTION_COUNT; directionIndex++) {
          const angle = (2 * Math.PI * directionIndex) / SATURATED_BRIDGED_RING_SHAPE_BALANCE_DIRECTION_COUNT;
          const candidateCoords = cloneCoords(bestCoords);
          candidateCoords.set(atomId, {
            x: basePosition.x + Math.cos(angle) * step,
            y: basePosition.y + Math.sin(angle) * step
          });
          const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
          const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
          if (!candidateAudit || candidateAudit.ok !== true || !candidateScore || !shouldAcceptScore(candidateScore, bestScore)) {
            continue;
          }
          bestCoords = candidateCoords;
          bestScore = candidateScore;
          bestAudit = candidateAudit;
          acceptedInPass = true;
        }
      }
    }
    if (!acceptedInPass) {
      break;
    }
  }

  return {
    coords: bestCoords,
    score: bestScore,
    audit: bestAudit
  };
}

/**
 * Rebalances compact bridged rings whose unavoidable shared-junction strain has
 * left a stretched bond and a visible local kink.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Balanced coordinates when accepted, otherwise the original map.
 */
function balanceSaturatedBridgedRingShape(layoutGraph, rings, atomIds, coords, bondLength) {
  const initialScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  const initialAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  if (!initialAudit || !shouldBalanceSaturatedBridgedRingShape(layoutGraph, rings, atomIds, initialScore, bondLength)) {
    return coords;
  }

  const balanceAtomIds = saturatedBridgedRingBalanceAtomIds(layoutGraph, rings);
  const maxAllowedBondDeviation = bondLength * SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MAX_BOND_DEVIATION_FACTOR;
  const bondBalanced = searchSaturatedBridgedRingShapeBalance(
    layoutGraph,
    rings,
    atomIds,
    balanceAtomIds,
    coords,
    bondLength,
    (candidateScore, incumbentScore) =>
      candidateScore.maxAngleDeviation <= initialScore.maxAngleDeviation + 1e-9 &&
      (candidateScore.maxBondDeviation < incumbentScore.maxBondDeviation - 1e-9 ||
        (Math.abs(candidateScore.maxBondDeviation - incumbentScore.maxBondDeviation) <= 1e-9 && candidateScore.totalBondDeviation < incumbentScore.totalBondDeviation - 1e-9))
  );
  if (!bondBalanced) {
    return coords;
  }

  const angleBalanced = searchSaturatedBridgedRingShapeBalance(
    layoutGraph,
    rings,
    atomIds,
    balanceAtomIds,
    bondBalanced.coords,
    bondLength,
    (candidateScore, incumbentScore) =>
      candidateScore.maxBondDeviation <= maxAllowedBondDeviation &&
      (candidateScore.maxAngleDeviation < incumbentScore.maxAngleDeviation - 1e-9 ||
        (Math.abs(candidateScore.maxAngleDeviation - incumbentScore.maxAngleDeviation) <= 1e-9 && candidateScore.totalAngleDeviation < incumbentScore.totalAngleDeviation - 1e-9))
  );
  if (
    !angleBalanced ||
    angleBalanced.score.maxBondDeviation > maxAllowedBondDeviation ||
    angleBalanced.score.maxAngleDeviation >= initialScore.maxAngleDeviation - 1e-9 ||
    angleBalanced.score.totalAngleDeviation >= initialScore.totalAngleDeviation - 1e-9
  ) {
    return coords;
  }

  return angleBalanced.coords;
}

/**
 * Returns whether compact bridged rings are distorted enough to try
 * regular-polygon relaxation after the KK/projection fallback. Aromatic rings
 * can participate when they are part of the same compact bridged system because
 * skipping them can leave adjacent saturated bridge rings folded around a
 * strained fused frame.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {{maxBondDeviation: number, maxAngleDeviation: number}|null} shapeScore - Current aggregate ring-shape score.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when bounded saturated-ring regularization should run.
 */
function shouldRegularizeSaturatedBridgedRings(layoutGraph, rings, atomIds, shapeScore, bondLength) {
  if (!shapeScore || rings.length <= 1 || atomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit) {
    return false;
  }
  if (containsMetalAtom(layoutGraph, atomIds)) {
    return false;
  }
  return (
    shapeScore.maxAngleDeviation > SATURATED_BRIDGED_RING_REGULARIZATION_MIN_ANGLE_DEVIATION ||
    shapeScore.maxBondDeviation > bondLength * SATURATED_BRIDGED_RING_REGULARIZATION_MIN_BOND_DEVIATION_FACTOR
  );
}

/**
 * Moves each ring atom toward the averaged regular-polygon targets from its
 * incident rings, preserving fixed atoms.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {number} damping - Fraction of the target movement to apply.
 * @returns {Map<string, {x: number, y: number}>|null} Regularized coordinate candidate, or null when no targets exist.
 */
function buildSaturatedBridgedRingRegularizedCoords(layoutGraph, rings, coords, bondLength, damping) {
  const targetSums = new Map();
  const targetCounts = new Map();

  for (const ring of rings) {
    const targets = fitRegularRingTargets(ring, coords, bondLength);
    if (!targets) {
      return null;
    }
    for (const [atomId, position] of targets) {
      const sum = targetSums.get(atomId) ?? { x: 0, y: 0 };
      sum.x += position.x;
      sum.y += position.y;
      targetSums.set(atomId, sum);
      targetCounts.set(atomId, (targetCounts.get(atomId) ?? 0) + 1);
    }
  }

  if (targetSums.size === 0) {
    return null;
  }

  const candidateCoords = cloneCoords(coords);
  for (const [atomId, sum] of targetSums) {
    if (layoutGraph.fixedCoords.has(atomId)) {
      continue;
    }
    const current = coords.get(atomId);
    const count = targetCounts.get(atomId) ?? 0;
    if (!current || count <= 0) {
      continue;
    }
    const target = {
      x: sum.x / count,
      y: sum.y / count
    };
    candidateCoords.set(atomId, {
      x: current.x * (1 - damping) + target.x * damping,
      y: current.y * (1 - damping) + target.y * damping
    });
  }

  return candidateCoords;
}

/**
 * Returns whether a saturated bridged-ring regularization candidate improves
 * ring shape without making the audited layout worse.
 * @param {object|null} candidateAudit - Candidate audit summary.
 * @param {object|null} incumbentAudit - Incumbent audit summary.
 * @param {{totalScore: number}|null} candidateScore - Candidate ring-shape score.
 * @param {{totalScore: number}|null} incumbentScore - Incumbent ring-shape score.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
function shouldAcceptSaturatedBridgedRingRegularizedCoords(candidateAudit, incumbentAudit, candidateScore, incumbentScore) {
  if (!candidateAudit || !incumbentAudit || !candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  return candidateScore.totalScore < incumbentScore.totalScore - 1e-9;
}

/**
 * Iteratively regularizes compact saturated bridged rings after KK placement.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Regularized coordinates when accepted, otherwise the original map.
 */
function regularizeSaturatedBridgedRings(layoutGraph, rings, atomIds, coords, bondLength) {
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  let bestScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  if (!bestAudit || !shouldRegularizeSaturatedBridgedRings(layoutGraph, rings, atomIds, bestScore, bondLength)) {
    return coords;
  }

  for (const damping of SATURATED_BRIDGED_RING_REGULARIZATION_DAMPING_FACTORS) {
    let candidateCoords = coords;
    for (let iteration = 0; iteration < SATURATED_BRIDGED_RING_REGULARIZATION_MAX_ITERATIONS; iteration++) {
      const nextCoords = buildSaturatedBridgedRingRegularizedCoords(layoutGraph, rings, candidateCoords, bondLength, damping);
      if (!nextCoords) {
        break;
      }
      candidateCoords = nextCoords;
      const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
      const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
      if (shouldAcceptSaturatedBridgedRingRegularizedCoords(candidateAudit, bestAudit, candidateScore, bestScore)) {
        bestCoords = candidateCoords;
        bestAudit = candidateAudit;
        bestScore = candidateScore;
      }
    }
  }

  return bestCoords;
}

function strictSmallBridgedRings(rings) {
  return rings.filter(ring => ring.atomIds.length === 5 || ring.atomIds.length === 6);
}

/**
 * Scores only publication-critical small rings in a bridged system, ignoring
 * larger perimeter cycles whose SSSR shape is often a topological artifact.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {{maxBondDeviation: number, maxAngleDeviation: number, totalBondDeviation: number, totalAngleDeviation: number, totalScore: number}|null} Aggregate regularity score, or null when incomplete.
 */
export function scoreBridgedSmallRingGeometry(rings, coords, bondLength) {
  const smallRings = strictSmallBridgedRings(rings);
  return smallRings.length === 0 ? null : saturatedBridgedRingShapeScore(smallRings, coords, bondLength);
}

function shouldRegularizeStrictSmallBridgedRings(layoutGraph, rings, atomIds, shapeScore, bondLength) {
  return Boolean(
    shapeScore &&
    rings.length > 0 &&
    atomIds.length <= BRIDGED_KK_LIMITS.fastAtomLimit &&
    !containsMetalAtom(layoutGraph, atomIds) &&
    (shapeScore.maxAngleDeviation > STRICT_BRIDGED_SMALL_RING_MIN_ANGLE_DEVIATION || shapeScore.maxBondDeviation > bondLength * SATURATED_BRIDGED_RING_REGULARIZATION_MIN_BOND_DEVIATION_FACTOR)
  );
}

function buildStrictSmallBridgedRingRegularizedCoords(layoutGraph, rings, coords, bondLength, damping) {
  const targetSums = new Map();
  const targetCounts = new Map();

  for (const ring of rings) {
    const targets = fitRegularRingTargets(ring, coords, bondLength);
    if (!targets) {
      continue;
    }
    for (const [atomId, target] of targets) {
      if (layoutGraph.fixedCoords.has(atomId)) {
        continue;
      }
      const sum = targetSums.get(atomId) ?? { x: 0, y: 0 };
      sum.x += target.x;
      sum.y += target.y;
      targetSums.set(atomId, sum);
      targetCounts.set(atomId, (targetCounts.get(atomId) ?? 0) + 1);
    }
  }

  if (targetSums.size === 0) {
    return null;
  }

  const candidateCoords = cloneCoords(coords);
  for (const [atomId, sum] of targetSums) {
    const current = coords.get(atomId);
    const count = targetCounts.get(atomId);
    if (!current || !count) {
      continue;
    }
    const target = {
      x: sum.x / count,
      y: sum.y / count
    };
    candidateCoords.set(atomId, {
      x: current.x * (1 - damping) + target.x * damping,
      y: current.y * (1 - damping) + target.y * damping
    });
  }

  return candidateCoords;
}

function strictSmallBridgedRingScoreImproves(candidateScore, incumbentScore) {
  if (!candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateScore.maxAngleDeviation < incumbentScore.maxAngleDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.maxAngleDeviation > incumbentScore.maxAngleDeviation + 1e-9) {
    return false;
  }
  if (candidateScore.totalAngleDeviation < incumbentScore.totalAngleDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.totalAngleDeviation > incumbentScore.totalAngleDeviation + 1e-9) {
    return false;
  }
  if (candidateScore.maxBondDeviation < incumbentScore.maxBondDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.maxBondDeviation > incumbentScore.maxBondDeviation + 1e-9) {
    return false;
  }
  return candidateScore.totalBondDeviation < incumbentScore.totalBondDeviation - 1e-9;
}

function shouldAcceptStrictSmallBridgedRingRegularizedCoords(candidateAudit, incumbentAudit, candidateScore, incumbentScore, bondLength) {
  if (!candidateAudit || !incumbentAudit || !candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (incumbentAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.labelOverlapCount ?? 0) > (incumbentAudit.labelOverlapCount ?? 0)) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if (candidateAudit.maxBondLengthDeviation > Math.max(incumbentAudit.maxBondLengthDeviation + bondLength * 0.02, bondLength * STRICT_BRIDGED_SMALL_RING_MAX_BOND_DEVIATION_FACTOR)) {
    return false;
  }
  return strictSmallBridgedRingScoreImproves(candidateScore, incumbentScore);
}

/**
 * Prioritizes regular five- and six-membered ring geometry in compact bridged
 * systems. Larger SSSR perimeter cycles can otherwise dominate the averaged
 * regular-polygon targets, leaving cyclohexyl-style rings visibly pinched even
 * when the audit is clean.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Regularized coordinates when accepted, otherwise the original map.
 */
function regularizeStrictSmallBridgedRings(layoutGraph, rings, atomIds, coords, bondLength) {
  const smallRings = strictSmallBridgedRings(rings);
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  let bestScore = saturatedBridgedRingShapeScore(smallRings, coords, bondLength);
  if (!bestAudit || !shouldRegularizeStrictSmallBridgedRings(layoutGraph, smallRings, atomIds, bestScore, bondLength)) {
    return coords;
  }

  for (let pass = 0; pass < STRICT_BRIDGED_SMALL_RING_MAX_PASSES; pass++) {
    let acceptedInPass = false;
    for (const damping of STRICT_BRIDGED_SMALL_RING_DAMPING_FACTORS) {
      const candidateCoords = buildStrictSmallBridgedRingRegularizedCoords(layoutGraph, smallRings, bestCoords, bondLength, damping);
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
      const candidateScore = saturatedBridgedRingShapeScore(smallRings, candidateCoords, bondLength);
      if (shouldAcceptStrictSmallBridgedRingRegularizedCoords(candidateAudit, bestAudit, candidateScore, bestScore, bondLength)) {
        bestCoords = candidateCoords;
        bestAudit = candidateAudit;
        bestScore = candidateScore;
        acceptedInPass = true;
      }
    }
    if (!acceptedInPass) {
      break;
    }
  }

  return bestCoords;
}

/**
 * Returns whether a medium-sized bridged ring system is within the bounded
 * specialist budget for additional local relaxation passes.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @returns {boolean} True when medium bridged-ring specialist passes may run.
 */
function isMediumBridgedRingSystemEligible(layoutGraph, rings, atomIds) {
  return Boolean(
    rings.length >= MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MIN_RING_COUNT &&
    atomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit &&
    atomIds.length <= MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MAX_ATOM_COUNT &&
    !containsMetalAtom(layoutGraph, atomIds)
  );
}

/**
 * Returns whether a medium-sized bridged ring system should try a bounded
 * whole-cage angle relaxation. This is intentionally separate from the compact
 * saturated-cage regularizer: larger mixed alkaloid cages can be audit-clean
 * while still showing several visibly pinched rings, but they need a strict
 * atom/ring budget and relaxed bridged bond guard.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {{maxAngleDeviation: number}|null} shapeScore - Current aggregate ring-shape score.
 * @returns {boolean} True when medium bridged-ring angle relaxation should run.
 */
function shouldRelaxMediumBridgedRingAngles(layoutGraph, rings, atomIds, shapeScore) {
  return Boolean(shapeScore && isMediumBridgedRingSystemEligible(layoutGraph, rings, atomIds) && shapeScore.maxAngleDeviation > MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MIN_ANGLE_DEVIATION);
}

function mediumBridgedRingAngleScoreImproves(candidateScore, incumbentScore) {
  if (!candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateScore.maxAngleDeviation < incumbentScore.maxAngleDeviation - 1e-9) {
    return true;
  }
  return candidateScore.maxAngleDeviation <= incumbentScore.maxAngleDeviation + 1e-9 && candidateScore.totalAngleDeviation < incumbentScore.totalAngleDeviation - 1e-9;
}

function shouldAcceptMediumBridgedRingAngleRelaxation(candidateAudit, incumbentAudit, candidateScore, incumbentScore, bondLength) {
  if (!candidateAudit || !incumbentAudit || !candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > 0) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (incumbentAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.labelOverlapCount ?? 0) > (incumbentAudit.labelOverlapCount ?? 0)) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > Math.max(incumbentAudit.bondLengthFailureCount, 1)) {
    return false;
  }
  if (candidateAudit.maxBondLengthDeviation > bondLength * MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MAX_BOND_DEVIATION_FACTOR) {
    return false;
  }
  return mediumBridgedRingAngleScoreImproves(candidateScore, incumbentScore);
}

function mediumBridgedRingAnglePolishScoreImproves(candidateScore, incumbentScore) {
  if (!candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateScore.maxAngleDeviation < incumbentScore.maxAngleDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.maxAngleDeviation > incumbentScore.maxAngleDeviation + 1e-9) {
    return false;
  }
  if (candidateScore.totalAngleDeviation < incumbentScore.totalAngleDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.totalAngleDeviation > incumbentScore.totalAngleDeviation + 1e-9) {
    return false;
  }
  if (candidateScore.maxBondDeviation < incumbentScore.maxBondDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.maxBondDeviation > incumbentScore.maxBondDeviation + 1e-9) {
    return false;
  }
  return candidateScore.totalBondDeviation < incumbentScore.totalBondDeviation - 1e-9;
}

function shouldAcceptMediumBridgedRingAnglePolish(candidateAudit, incumbentAudit, candidateScore, incumbentScore, bondLength) {
  if (!candidateAudit || !incumbentAudit || !candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (incumbentAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.labelOverlapCount ?? 0) > (incumbentAudit.labelOverlapCount ?? 0)) {
    return false;
  }
  if (candidateAudit.maxBondLengthDeviation > bondLength * MEDIUM_BRIDGED_RING_ANGLE_POLISH_MAX_BOND_DEVIATION_FACTOR) {
    return false;
  }
  return mediumBridgedRingAnglePolishScoreImproves(candidateScore, incumbentScore);
}

function aromaticRingsNeedingMediumBridgedPolish(rings, coords, bondLength) {
  return rings.filter(ring => {
    if (!ring.aromatic) {
      return false;
    }
    const score = regularRingShapeScore(ring, coords, bondLength);
    return score && score.maxBondDeviation > bondLength * MEDIUM_BRIDGED_AROMATIC_RING_POLISH_MIN_BOND_DEVIATION_FACTOR;
  });
}

function mediumBridgedRingPolishMoveGroups(layoutGraph, polishAtomIds, ringSystemAtomIds, coords) {
  const ringSystemAtomIdSet = new Set(ringSystemAtomIds);
  const groups = new Map();

  for (const atomId of polishAtomIds) {
    const groupAtomIds = new Set([atomId]);
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (ringSystemAtomIdSet.has(neighborAtomId)) {
        continue;
      }
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, neighborAtomId, atomId)].filter(candidateAtomId => coords.has(candidateAtomId));
      if (subtreeAtomIds.length === 0 || subtreeAtomIds.some(candidateAtomId => ringSystemAtomIdSet.has(candidateAtomId) || layoutGraph.fixedCoords.has(candidateAtomId))) {
        continue;
      }
      const heavyAtomCount = subtreeAtomIds.filter(candidateAtomId => layoutGraph.atoms.get(candidateAtomId)?.element !== 'H').length;
      if (heavyAtomCount > MEDIUM_BRIDGED_RING_POLISH_MAX_PENDANT_HEAVY_ATOMS) {
        continue;
      }
      for (const subtreeAtomId of subtreeAtomIds) {
        groupAtomIds.add(subtreeAtomId);
      }
    }
    groups.set(atomId, [...groupAtomIds]);
  }

  return groups;
}

function translateMediumBridgedRingPolishGroup(coords, groupAtomIds, dx, dy) {
  const candidateCoords = cloneCoords(coords);
  for (const atomId of groupAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, {
      x: position.x + dx,
      y: position.y + dy
    });
  }
  return candidateCoords;
}

function translateMediumBridgedRingPolishPair(coords, firstGroupAtomIds, firstDx, firstDy, secondGroupAtomIds, secondDx, secondDy) {
  const firstGroupAtomIdSet = new Set(firstGroupAtomIds);
  if (secondGroupAtomIds.some(atomId => firstGroupAtomIdSet.has(atomId))) {
    return null;
  }

  const candidateCoords = cloneCoords(coords);
  for (const atomId of firstGroupAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, {
      x: position.x + firstDx,
      y: position.y + firstDy
    });
  }
  for (const atomId of secondGroupAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, {
      x: position.x + secondDx,
      y: position.y + secondDy
    });
  }
  return candidateCoords;
}

function shouldAcceptMediumBridgedAromaticRingPolish(candidateAudit, incumbentAudit, candidateAromaticScore, incumbentAromaticScore, candidateAllScore, incumbentAllScore, bondLength) {
  if (!candidateAudit || !incumbentAudit || !candidateAromaticScore || !incumbentAromaticScore || !candidateAllScore || !incumbentAllScore) {
    return false;
  }
  if (candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (incumbentAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.labelOverlapCount ?? 0) > (incumbentAudit.labelOverlapCount ?? 0)) {
    return false;
  }
  if (candidateAudit.maxBondLengthDeviation > bondLength * MEDIUM_BRIDGED_RING_ANGLE_POLISH_MAX_BOND_DEVIATION_FACTOR) {
    return false;
  }
  const allowedMaxAngleDeviation = Math.max(incumbentAllScore.maxAngleDeviation, MEDIUM_BRIDGED_AROMATIC_RING_POLISH_MAX_ANGLE_DEVIATION);
  if (candidateAllScore.maxAngleDeviation > allowedMaxAngleDeviation + MEDIUM_BRIDGED_AROMATIC_RING_POLISH_ANGLE_WORSENING_LIMIT) {
    return false;
  }
  const allowedAromaticMaxAngleDeviation = Math.max(incumbentAromaticScore.maxAngleDeviation, MEDIUM_BRIDGED_AROMATIC_RING_POLISH_MAX_ANGLE_DEVIATION);
  if (candidateAromaticScore.maxAngleDeviation > allowedAromaticMaxAngleDeviation + MEDIUM_BRIDGED_AROMATIC_RING_POLISH_ANGLE_WORSENING_LIMIT) {
    return false;
  }
  if (candidateAromaticScore.maxAngleDeviation > MEDIUM_BRIDGED_AROMATIC_RING_POLISH_ABSOLUTE_MAX_ANGLE_DEVIATION) {
    return false;
  }
  if (candidateAromaticScore.totalAngleDeviation > incumbentAromaticScore.totalAngleDeviation + MEDIUM_BRIDGED_AROMATIC_RING_POLISH_TOTAL_ANGLE_WORSENING_LIMIT) {
    return false;
  }
  if (candidateAromaticScore.maxBondDeviation < incumbentAromaticScore.maxBondDeviation - 1e-9) {
    return true;
  }
  if (candidateAromaticScore.maxBondDeviation > incumbentAromaticScore.maxBondDeviation + 1e-9) {
    return false;
  }
  if (candidateAromaticScore.totalBondDeviation < incumbentAromaticScore.totalBondDeviation - 1e-9) {
    return true;
  }
  if (candidateAromaticScore.totalBondDeviation > incumbentAromaticScore.totalBondDeviation + 1e-9) {
    return false;
  }
  return candidateAromaticScore.totalAngleDeviation < incumbentAromaticScore.totalAngleDeviation - 1e-9;
}

/**
 * Trims residual bond stretch in aromatic rings embedded in a medium bridged
 * cage. The preceding whole-cage angle polish can leave aromatic rings readable
 * but visibly uneven; this pass gives only aromatic atoms small audit-guarded
 * moves, capped by a strict angle-deviation guard.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Polished coordinates when accepted, otherwise the original map.
 */
function polishMediumBridgedAromaticRings(layoutGraph, rings, atomIds, coords, bondLength) {
  const aromaticRings = aromaticRingsNeedingMediumBridgedPolish(rings, coords, bondLength);
  if (aromaticRings.length === 0 || !isMediumBridgedRingSystemEligible(layoutGraph, rings, atomIds)) {
    return coords;
  }

  const bondValidationClasses = assignBondValidationClass(layoutGraph, atomIds, 'bridged');
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength, bondValidationClasses);
  let bestAromaticScore = saturatedBridgedRingShapeScore(aromaticRings, coords, bondLength);
  let bestAllScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  if (!bestAudit || !bestAromaticScore || !bestAllScore) {
    return coords;
  }

  const polishAtomIds = [...new Set(aromaticRings.flatMap(ring => ring.atomIds))].filter(atomId => !layoutGraph.fixedCoords.has(atomId));
  const moveGroups = mediumBridgedRingPolishMoveGroups(layoutGraph, polishAtomIds, atomIds, coords);
  for (let pass = 0; pass < MEDIUM_BRIDGED_AROMATIC_RING_POLISH_MAX_PASSES; pass++) {
    let acceptedInPass = false;
    for (const atomId of polishAtomIds) {
      const basePosition = bestCoords.get(atomId);
      if (!basePosition) {
        continue;
      }
      const moveGroupAtomIds = moveGroups.get(atomId) ?? [atomId];
      for (const stepFactor of MEDIUM_BRIDGED_AROMATIC_RING_POLISH_STEP_FACTORS) {
        const step = bondLength * stepFactor;
        for (let directionIndex = 0; directionIndex < MEDIUM_BRIDGED_AROMATIC_RING_POLISH_DIRECTION_COUNT; directionIndex++) {
          const angle = (2 * Math.PI * directionIndex) / MEDIUM_BRIDGED_AROMATIC_RING_POLISH_DIRECTION_COUNT;
          const candidateCoords = translateMediumBridgedRingPolishGroup(bestCoords, moveGroupAtomIds, Math.cos(angle) * step, Math.sin(angle) * step);
          const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength, bondValidationClasses);
          const candidateAromaticScore = saturatedBridgedRingShapeScore(aromaticRings, candidateCoords, bondLength);
          const candidateAllScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
          if (shouldAcceptMediumBridgedAromaticRingPolish(candidateAudit, bestAudit, candidateAromaticScore, bestAromaticScore, candidateAllScore, bestAllScore, bondLength)) {
            bestCoords = candidateCoords;
            bestAudit = candidateAudit;
            bestAromaticScore = candidateAromaticScore;
            bestAllScore = candidateAllScore;
            acceptedInPass = true;
          }
        }
      }
    }
    if (!acceptedInPass) {
      break;
    }
  }

  return bestCoords;
}

function ringsNeedingMediumBridgedBondPolish(rings, coords, bondLength) {
  return rings.filter(ring => {
    const score = regularRingShapeScore(ring, coords, bondLength);
    return score && score.maxBondDeviation > bondLength * MEDIUM_BRIDGED_RING_BOND_POLISH_MIN_BOND_DEVIATION_FACTOR;
  });
}

function mediumBridgedRingEdgePolishPairs(rings, coords, bondLength) {
  const pairsByKey = new Map();
  for (const ring of rings) {
    for (let index = 0; index < ring.atomIds.length; index++) {
      const firstAtomId = ring.atomIds[index];
      const secondAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
      const firstPosition = coords.get(firstAtomId);
      const secondPosition = coords.get(secondAtomId);
      if (!firstPosition || !secondPosition) {
        continue;
      }
      const length = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
      const deviation = Math.abs(length - bondLength);
      if (deviation <= bondLength * MEDIUM_BRIDGED_RING_EDGE_POLISH_MIN_BOND_DEVIATION_FACTOR) {
        continue;
      }
      const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
      const existingPair = pairsByKey.get(key);
      if (!existingPair || deviation > existingPair.deviation) {
        pairsByKey.set(key, {
          firstAtomId,
          secondAtomId,
          deviation
        });
      }
    }
  }
  return [...pairsByKey.values()].sort((firstPair, secondPair) => secondPair.deviation - firstPair.deviation);
}

function mediumBridgedRingBondPolishScoreImproves(candidateScore, incumbentScore) {
  if (!candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateScore.maxBondDeviation < incumbentScore.maxBondDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.maxBondDeviation > incumbentScore.maxBondDeviation + 1e-9) {
    return false;
  }
  if (candidateScore.totalBondDeviation < incumbentScore.totalBondDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.totalBondDeviation > incumbentScore.totalBondDeviation + 1e-9) {
    return false;
  }
  if (candidateScore.maxAngleDeviation < incumbentScore.maxAngleDeviation - 1e-9) {
    return true;
  }
  if (candidateScore.maxAngleDeviation > incumbentScore.maxAngleDeviation + 1e-9) {
    return false;
  }
  return candidateScore.totalAngleDeviation < incumbentScore.totalAngleDeviation - 1e-9;
}

function shouldAcceptMediumBridgedRingBondPolish(candidateAudit, incumbentAudit, candidateScore, incumbentScore, bondLength) {
  if (!candidateAudit || !incumbentAudit || !candidateScore || !incumbentScore) {
    return false;
  }
  if (candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (incumbentAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.labelOverlapCount ?? 0) > (incumbentAudit.labelOverlapCount ?? 0)) {
    return false;
  }
  if (candidateAudit.maxBondLengthDeviation > bondLength * MEDIUM_BRIDGED_RING_ANGLE_POLISH_MAX_BOND_DEVIATION_FACTOR) {
    return false;
  }
  if (candidateScore.maxAngleDeviation > MEDIUM_BRIDGED_RING_BOND_POLISH_MAX_ANGLE_DEVIATION) {
    return false;
  }
  if (candidateScore.maxAngleDeviation > incumbentScore.maxAngleDeviation + MEDIUM_BRIDGED_RING_BOND_POLISH_ANGLE_WORSENING_LIMIT) {
    return false;
  }
  if (candidateScore.totalAngleDeviation > incumbentScore.totalAngleDeviation + MEDIUM_BRIDGED_RING_BOND_POLISH_TOTAL_ANGLE_WORSENING_LIMIT) {
    return false;
  }
  return mediumBridgedRingBondPolishScoreImproves(candidateScore, incumbentScore);
}

/**
 * Distributes residual long/short ring bonds after the angle and aromatic
 * polishes have made the cage readable. This final pass may trade a small
 * amount of aggregate angle ideality for visibly more even ring edges, but it
 * keeps strict audit and angle caps so it cannot reopen the original collapse.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Polished coordinates when accepted, otherwise the original map.
 */
function polishMediumBridgedRingBonds(layoutGraph, rings, atomIds, coords, bondLength) {
  const bondPolishRings = ringsNeedingMediumBridgedBondPolish(rings, coords, bondLength);
  if (bondPolishRings.length === 0 || !isMediumBridgedRingSystemEligible(layoutGraph, rings, atomIds)) {
    return coords;
  }

  const bondValidationClasses = assignBondValidationClass(layoutGraph, atomIds, 'bridged');
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength, bondValidationClasses);
  let bestScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  if (!bestAudit || !bestScore) {
    return coords;
  }

  const polishAtomIds = [...new Set(bondPolishRings.flatMap(ring => ring.atomIds))].filter(atomId => !layoutGraph.fixedCoords.has(atomId));
  const moveGroups = mediumBridgedRingPolishMoveGroups(layoutGraph, polishAtomIds, atomIds, coords);
  for (let pass = 0; pass < MEDIUM_BRIDGED_RING_BOND_POLISH_MAX_PASSES; pass++) {
    let acceptedInPass = false;
    for (const atomId of polishAtomIds) {
      const basePosition = bestCoords.get(atomId);
      if (!basePosition) {
        continue;
      }
      const moveGroupAtomIds = moveGroups.get(atomId) ?? [atomId];
      for (const stepFactor of MEDIUM_BRIDGED_RING_BOND_POLISH_STEP_FACTORS) {
        const step = bondLength * stepFactor;
        for (let directionIndex = 0; directionIndex < MEDIUM_BRIDGED_RING_BOND_POLISH_DIRECTION_COUNT; directionIndex++) {
          const angle = (2 * Math.PI * directionIndex) / MEDIUM_BRIDGED_RING_BOND_POLISH_DIRECTION_COUNT;
          const candidateCoords = translateMediumBridgedRingPolishGroup(bestCoords, moveGroupAtomIds, Math.cos(angle) * step, Math.sin(angle) * step);
          const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength, bondValidationClasses);
          const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
          if (shouldAcceptMediumBridgedRingBondPolish(candidateAudit, bestAudit, candidateScore, bestScore, bondLength)) {
            bestCoords = candidateCoords;
            bestAudit = candidateAudit;
            bestScore = candidateScore;
            acceptedInPass = true;
          }
        }
      }
    }
    if (!acceptedInPass) {
      break;
    }
  }

  for (let pass = 0; pass < MEDIUM_BRIDGED_RING_EDGE_POLISH_MAX_PASSES; pass++) {
    let acceptedInPass = false;
    const polishPairs = mediumBridgedRingEdgePolishPairs(bondPolishRings, bestCoords, bondLength);
    for (const { firstAtomId, secondAtomId, deviation } of polishPairs) {
      if (layoutGraph.fixedCoords.has(firstAtomId) || layoutGraph.fixedCoords.has(secondAtomId)) {
        continue;
      }
      const firstPosition = bestCoords.get(firstAtomId);
      const secondPosition = bestCoords.get(secondAtomId);
      if (!firstPosition || !secondPosition) {
        continue;
      }
      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      const length = Math.hypot(dx, dy);
      if (length <= 1e-9) {
        continue;
      }
      const unitX = dx / length;
      const unitY = dy / length;
      const directionSign = length > bondLength ? 1 : -1;
      const firstGroupAtomIds = moveGroups.get(firstAtomId) ?? [firstAtomId];
      const secondGroupAtomIds = moveGroups.get(secondAtomId) ?? [secondAtomId];
      for (const stepFactor of MEDIUM_BRIDGED_RING_EDGE_POLISH_STEP_FACTORS) {
        const endpointStep = Math.min(deviation * 0.25, bondLength * stepFactor);
        const candidateCoords = translateMediumBridgedRingPolishPair(
          bestCoords,
          firstGroupAtomIds,
          unitX * endpointStep * directionSign,
          unitY * endpointStep * directionSign,
          secondGroupAtomIds,
          -unitX * endpointStep * directionSign,
          -unitY * endpointStep * directionSign
        );
        if (!candidateCoords) {
          continue;
        }
        const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength, bondValidationClasses);
        const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
        if (shouldAcceptMediumBridgedRingBondPolish(candidateAudit, bestAudit, candidateScore, bestScore, bondLength)) {
          bestCoords = candidateCoords;
          bestAudit = candidateAudit;
          bestScore = candidateScore;
          acceptedInPass = true;
          break;
        }
      }
    }
    if (!acceptedInPass) {
      break;
    }
  }

  return bestCoords;
}

/**
 * Performs a bounded local coordinate polish after whole-cage relaxation. The
 * averaged regular-ring projection removes gross kinks, then this pass lets
 * individual ring atoms take small audit-guarded steps that reduce residual
 * angle strain without reopening overlaps or stretched bonds.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Polished coordinates when accepted, otherwise the original map.
 */
function polishMediumBridgedRingAngles(layoutGraph, rings, atomIds, coords, bondLength) {
  const bondValidationClasses = assignBondValidationClass(layoutGraph, atomIds, 'bridged');
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength, bondValidationClasses);
  let bestScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  if (!bestAudit || !bestScore || !shouldRelaxMediumBridgedRingAngles(layoutGraph, rings, atomIds, bestScore) || bestScore.maxAngleDeviation <= MEDIUM_BRIDGED_RING_ANGLE_POLISH_MIN_ANGLE_DEVIATION) {
    return coords;
  }

  const balanceAtomIds = saturatedBridgedRingBalanceAtomIds(layoutGraph, rings);
  for (let pass = 0; pass < MEDIUM_BRIDGED_RING_ANGLE_POLISH_MAX_PASSES; pass++) {
    let acceptedInPass = false;
    for (const atomId of balanceAtomIds) {
      const basePosition = bestCoords.get(atomId);
      if (!basePosition) {
        continue;
      }
      for (const stepFactor of MEDIUM_BRIDGED_RING_ANGLE_POLISH_STEP_FACTORS) {
        const step = bondLength * stepFactor;
        for (let directionIndex = 0; directionIndex < MEDIUM_BRIDGED_RING_ANGLE_POLISH_DIRECTION_COUNT; directionIndex++) {
          const angle = (2 * Math.PI * directionIndex) / MEDIUM_BRIDGED_RING_ANGLE_POLISH_DIRECTION_COUNT;
          const candidateCoords = cloneCoords(bestCoords);
          candidateCoords.set(atomId, {
            x: basePosition.x + Math.cos(angle) * step,
            y: basePosition.y + Math.sin(angle) * step
          });
          const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength, bondValidationClasses);
          const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
          if (shouldAcceptMediumBridgedRingAnglePolish(candidateAudit, bestAudit, candidateScore, bestScore, bondLength)) {
            bestCoords = candidateCoords;
            bestAudit = candidateAudit;
            bestScore = candidateScore;
            acceptedInPass = true;
          }
        }
      }
    }
    if (!acceptedInPass) {
      break;
    }
  }

  return bestCoords;
}

/**
 * Relaxes medium-sized bridged cages toward averaged regular-ring targets when
 * the unmatched KK/projection seed has left many rings visibly kinked. The pass
 * is bounded by atom count, ring count, iteration count, and a relaxed bridged
 * bond-deviation ceiling so it cannot turn a readable cage into a stretched
 * graph just to improve angles.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Relaxed coordinates when accepted, otherwise the original map.
 */
function relaxMediumBridgedRingAngles(layoutGraph, rings, atomIds, coords, bondLength) {
  const bondValidationClasses = assignBondValidationClass(layoutGraph, atomIds, 'bridged');
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength, bondValidationClasses);
  let bestScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  if (!bestAudit || !shouldRelaxMediumBridgedRingAngles(layoutGraph, rings, atomIds, bestScore)) {
    return coords;
  }

  for (const damping of MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_DAMPING_FACTORS) {
    let candidateCoords = bestCoords;
    for (let iteration = 0; iteration < MEDIUM_BRIDGED_RING_ANGLE_RELAXATION_MAX_ITERATIONS; iteration++) {
      const nextCoords = buildSaturatedBridgedRingRegularizedCoords(layoutGraph, rings, candidateCoords, bondLength, damping);
      if (!nextCoords) {
        break;
      }
      candidateCoords = nextCoords;
      const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength, bondValidationClasses);
      const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
      if (shouldAcceptMediumBridgedRingAngleRelaxation(candidateAudit, bestAudit, candidateScore, bestScore, bondLength)) {
        bestCoords = candidateCoords;
        bestAudit = candidateAudit;
        bestScore = candidateScore;
      }
    }
  }

  return bestCoords;
}

function mediumBridgedRingAngleRelaxationSystems(layoutGraph) {
  const ringById = layoutGraph.ringById ?? new Map((layoutGraph.rings ?? []).map(ring => [ring.id, ring]));
  return (layoutGraph.ringSystems ?? [])
    .map(ringSystem => ({
      ringSystem,
      atomIds: ringSystem.atomIds ?? [],
      rings: (ringSystem.ringIds ?? []).map(ringId => ringById.get(ringId)).filter(Boolean)
    }))
    .filter(entry => entry.atomIds.length > 0 && entry.rings.length > 0);
}

/**
 * Returns whether the full layout has a medium bridged ring system with enough
 * aggregate ring-angle strain to try the specialist angle relaxation hook.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Full coordinate map.
 * @param {{bondLength?: number}} [options] - Optional bond-length override.
 * @returns {boolean} True when the medium bridged-ring angle hook should run.
 */
export function hasMediumBridgedRingAngleRelaxationNeed(layoutGraph, coords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  for (const { rings, atomIds } of mediumBridgedRingAngleRelaxationSystems(layoutGraph)) {
    const score = saturatedBridgedRingShapeScore(rings, coords, bondLength);
    if (shouldRelaxMediumBridgedRingAngles(layoutGraph, rings, atomIds, score)) {
      return true;
    }
  }
  return false;
}

/**
 * Runs the bounded medium bridged-ring angle relaxation against a full layout.
 * Coordinates outside the target ring systems are left in place; full-layout
 * audit checks still guard against branch-bond or overlap regressions.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Full coordinate map.
 * @param {{bondLength?: number}} [options] - Optional bond-length override.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Relaxed coordinates and move count.
 */
export function runMediumBridgedRingAngleRelaxation(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  let coords = inputCoords;
  let nudges = 0;

  for (const { rings, atomIds } of mediumBridgedRingAngleRelaxationSystems(layoutGraph)) {
    const relaxedCoords = relaxMediumBridgedRingAngles(layoutGraph, rings, atomIds, coords, bondLength);
    const flippedCoords = flipPeripheralBridgedRingsAcrossSharedEdges(layoutGraph, rings, atomIds, relaxedCoords, bondLength);
    const anglePolishedCoords = polishMediumBridgedRingAngles(layoutGraph, rings, atomIds, flippedCoords, bondLength);
    const aromaticPolishedCoords = polishMediumBridgedAromaticRings(layoutGraph, rings, atomIds, anglePolishedCoords, bondLength);
    const bondPolishedCoords = polishMediumBridgedRingBonds(layoutGraph, rings, atomIds, aromaticPolishedCoords, bondLength);
    const finalRelaxedCoords = relaxMediumBridgedRingAngles(layoutGraph, rings, atomIds, bondPolishedCoords, bondLength);
    const finalAngleCoords = polishMediumBridgedRingAngles(layoutGraph, rings, atomIds, finalRelaxedCoords, bondLength);
    const finalBondCoords = polishMediumBridgedRingBonds(layoutGraph, rings, atomIds, finalAngleCoords, bondLength);
    const nextCoords = finalBondCoords;
    if (nextCoords === coords) {
      continue;
    }
    for (const atomId of atomIds) {
      const previous = coords.get(atomId);
      const next = nextCoords.get(atomId);
      if (previous && next && Math.hypot(next.x - previous.x, next.y - previous.y) > 1e-6) {
        nudges++;
      }
    }
    coords = nextCoords;
  }

  return { coords, nudges };
}

function buildPeripheralBridgedRingFlippedCoords(coords, ring, edgeAtomIds) {
  const firstPosition = coords.get(edgeAtomIds[0]);
  const secondPosition = coords.get(edgeAtomIds[1]);
  if (!firstPosition || !secondPosition) {
    return null;
  }

  const edgeAtomSet = new Set(edgeAtomIds);
  const candidateCoords = cloneCoords(coords);
  for (const atomId of ring.atomIds) {
    if (edgeAtomSet.has(atomId)) {
      continue;
    }
    const position = coords.get(atomId);
    if (!position) {
      return null;
    }
    const reflectedPosition = reflectPointAcrossLine(position, firstPosition, secondPosition);
    if (!reflectedPosition) {
      return null;
    }
    candidateCoords.set(atomId, reflectedPosition);
  }
  return candidateCoords;
}

function shouldAcceptPeripheralBridgedRingFlip(candidateAudit, incumbentAudit, candidateScore, incumbentScore, candidateRingScore, incumbentRingScore) {
  if (!candidateAudit || !incumbentAudit || !candidateScore || !incumbentScore || !candidateRingScore || !incumbentRingScore) {
    return false;
  }
  if (candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if ((candidateAudit.labelOverlapCount ?? 0) > (incumbentAudit.labelOverlapCount ?? 0)) {
    return false;
  }
  if (candidateRingScore.maxAngleDeviation > incumbentRingScore.maxAngleDeviation + 1e-9) {
    return false;
  }
  if (candidateScore.maxBondDeviation > incumbentScore.maxBondDeviation + 1e-9) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) < (incumbentAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return true;
  }
  return (
    (candidateAudit.visibleHeavyBondCrossingCount ?? 0) === (incumbentAudit.visibleHeavyBondCrossingCount ?? 0) &&
    candidateRingScore.totalAngleDeviation < incumbentRingScore.totalAngleDeviation - 1e-9
  );
}

/**
 * Mirrors peripheral bridged rings across their shared edge when the opposite
 * side removes an audited crossing without changing the shared core. This is a
 * narrow retouch for leaf rings whose side choice is visually important but not
 * strongly encoded by the KK distance layout.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Flipped coordinates when accepted, otherwise the original map.
 */
function flipPeripheralBridgedRingsAcrossSharedEdges(layoutGraph, rings, atomIds, coords, bondLength) {
  const membershipCounts = sharedRingMembershipCounts(rings);
  const bondValidationClasses = assignBondValidationClass(layoutGraph, atomIds, 'bridged');
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, bestCoords, bondLength, bondValidationClasses);
  let bestScore = saturatedBridgedRingShapeScore(rings, bestCoords, bondLength);
  if (!bestAudit || !bestScore || containsMetalAtom(layoutGraph, atomIds)) {
    return coords;
  }

  for (const ring of rings) {
    const edgeAtomIds = peripheralSharedEdgeAtomIds(ring, membershipCounts);
    if (!edgeAtomIds) {
      continue;
    }
    const incumbentRingScore = regularRingShapeScore(ring, bestCoords, bondLength);
    const candidateCoords = buildPeripheralBridgedRingFlippedCoords(bestCoords, ring, edgeAtomIds);
    if (!candidateCoords || !incumbentRingScore) {
      continue;
    }
    const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength, bondValidationClasses);
    const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
    const candidateRingScore = regularRingShapeScore(ring, candidateCoords, bondLength);
    if (shouldAcceptPeripheralBridgedRingFlip(candidateAudit, bestAudit, candidateScore, bestScore, candidateRingScore, incumbentRingScore)) {
      bestCoords = candidateCoords;
      bestAudit = candidateAudit;
      bestScore = candidateScore;
    }
  }

  return bestCoords;
}

function singleAnchorSharedAtomId(ring, membershipCounts) {
  const sharedAtomIds = ring.atomIds.filter(atomId => (membershipCounts.get(atomId) ?? 0) > 1);
  return sharedAtomIds.length === 1 ? sharedAtomIds[0] : null;
}

function singleAnchorBridgedRingRegularizationCandidates(layoutGraph, rings, coords, bondLength) {
  const membershipCounts = sharedRingMembershipCounts(rings);
  return rings
    .filter(ring => !ring.aromatic && (ring.atomIds.length === 5 || ring.atomIds.length === 6))
    .map(ring => ({
      ring,
      anchorAtomId: singleAnchorSharedAtomId(ring, membershipCounts),
      score: regularRingShapeScore(ring, coords, bondLength)
    }))
    .filter(
      candidate =>
        candidate.anchorAtomId &&
        !candidate.ring.atomIds.some(atomId => atomId !== candidate.anchorAtomId && layoutGraph.fixedCoords.has(atomId)) &&
        candidate.score &&
        candidate.score.maxAngleDeviation > SINGLE_ANCHOR_BRIDGED_RING_REGULARIZATION_MIN_ANGLE_DEVIATION
    )
    .sort(
      (firstCandidate, secondCandidate) =>
        secondCandidate.score.maxAngleDeviation - firstCandidate.score.maxAngleDeviation || secondCandidate.score.maxBondDeviation - firstCandidate.score.maxBondDeviation
    );
}

function buildSingleAnchorBridgedRingRegularizedCoords(coords, candidate, targetCandidate, blendFactor) {
  const candidateCoords = cloneCoords(coords);
  for (const [atomId, target] of targetCandidate.targets) {
    if (atomId === candidate.anchorAtomId) {
      continue;
    }
    const current = coords.get(atomId);
    if (!current) {
      return null;
    }
    candidateCoords.set(atomId, {
      x: current.x * (1 - blendFactor) + target.x * blendFactor,
      y: current.y * (1 - blendFactor) + target.y * blendFactor
    });
  }
  return candidateCoords;
}

function shouldAcceptSingleAnchorBridgedRingRegularizedCoords(candidateAudit, incumbentAudit, candidateScore, incumbentScore, candidateRingScore, incumbentRingScore) {
  if (!candidateAudit || !incumbentAudit || !candidateScore || !incumbentScore || !candidateRingScore || !incumbentRingScore) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (incumbentAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.labelOverlapCount ?? 0) > (incumbentAudit.labelOverlapCount ?? 0)) {
    return false;
  }
  if (candidateAudit.maxBondLengthDeviation > incumbentAudit.maxBondLengthDeviation + 1e-9) {
    return false;
  }
  if (candidateRingScore.maxAngleDeviation >= incumbentRingScore.maxAngleDeviation - 1e-9) {
    return false;
  }
  if (candidateScore.totalScore < incumbentScore.totalScore - 1e-9) {
    return true;
  }
  return candidateRingScore.totalScore < incumbentRingScore.totalScore - 1e-9;
}

/**
 * Regularizes single-anchor saturated rings in bridged mixed systems while
 * keeping the shared junction atom fixed. This repairs spiro leaf rings that
 * are not eligible for shared-edge regularization.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Regularized coordinates when accepted, otherwise the original map.
 */
export function regularizeSingleAnchorBridgedRings(layoutGraph, rings, atomIds, coords, bondLength) {
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  let bestScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  if (!bestAudit || !bestScore || containsMetalAtom(layoutGraph, atomIds)) {
    return coords;
  }

  for (const candidate of singleAnchorBridgedRingRegularizationCandidates(layoutGraph, rings, bestCoords, bondLength)) {
    let incumbentRingScore = regularRingShapeScore(candidate.ring, bestCoords, bondLength);
    if (!incumbentRingScore) {
      continue;
    }
    const targetCandidates = regularRingTargetCandidatesForFixedAnchor(candidate.ring, bestCoords, candidate.anchorAtomId, bondLength);
    for (const targetCandidate of targetCandidates.slice(0, 8)) {
      for (const blendFactor of SINGLE_ANCHOR_BRIDGED_RING_REGULARIZATION_BLEND_FACTORS) {
        const candidateCoords = buildSingleAnchorBridgedRingRegularizedCoords(bestCoords, candidate, targetCandidate, blendFactor);
        if (!candidateCoords) {
          continue;
        }
        const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
        const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
        const candidateRingScore = regularRingShapeScore(candidate.ring, candidateCoords, bondLength);
        if (shouldAcceptSingleAnchorBridgedRingRegularizedCoords(candidateAudit, bestAudit, candidateScore, bestScore, candidateRingScore, incumbentRingScore)) {
          bestCoords = candidateCoords;
          bestAudit = candidateAudit;
          bestScore = candidateScore;
          incumbentRingScore = candidateRingScore;
        }
      }
    }
  }

  return bestCoords;
}

function peripheralBridgedRingRegularizationCandidates(rings, coords, bondLength) {
  const membershipCounts = sharedRingMembershipCounts(rings);
  return rings
    .filter(ring => !ring.aromatic && (ring.atomIds.length === 5 || ring.atomIds.length === 6) && peripheralSharedEdgeAtomIds(ring, membershipCounts))
    .map(ring => ({
      ring,
      edgeAtomIds: peripheralSharedEdgeAtomIds(ring, membershipCounts),
      score: regularRingShapeScore(ring, coords, bondLength)
    }))
    .filter(candidate => candidate.edgeAtomIds && candidate.score && candidate.score.maxAngleDeviation > PERIPHERAL_BRIDGED_RING_REGULARIZATION_MIN_ANGLE_DEVIATION)
    .sort(
      (firstCandidate, secondCandidate) =>
        secondCandidate.score.maxAngleDeviation - firstCandidate.score.maxAngleDeviation || secondCandidate.score.maxBondDeviation - firstCandidate.score.maxBondDeviation
    );
}

function buildPeripheralBridgedRingRegularizedCoords(coords, candidate, blendFactor) {
  const targets = fitRegularRingTargetsFromAnchoredEdge(candidate.ring, coords, candidate.edgeAtomIds);
  if (!targets) {
    return null;
  }
  const anchoredAtomIds = new Set(candidate.edgeAtomIds);
  const candidateCoords = cloneCoords(coords);
  for (const [atomId, target] of targets) {
    if (anchoredAtomIds.has(atomId)) {
      continue;
    }
    const current = coords.get(atomId);
    if (!current) {
      return null;
    }
    candidateCoords.set(atomId, {
      x: current.x * (1 - blendFactor) + target.x * blendFactor,
      y: current.y * (1 - blendFactor) + target.y * blendFactor
    });
  }
  return candidateCoords;
}

function shouldAcceptPeripheralBridgedRingRegularizedCoords(candidateAudit, incumbentAudit, candidateScore, incumbentScore, candidateRingScore, incumbentRingScore) {
  if (!candidateAudit || !incumbentAudit || !candidateScore || !incumbentScore || !candidateRingScore || !incumbentRingScore) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (incumbentAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.labelOverlapCount ?? 0) > (incumbentAudit.labelOverlapCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.severeOverlapPenalty ?? 0) > (incumbentAudit.severeOverlapPenalty ?? 0) + 1e-9) {
    return false;
  }
  if (candidateAudit.maxBondLengthDeviation > incumbentAudit.maxBondLengthDeviation + 1e-9) {
    return false;
  }
  if (candidateRingScore.maxAngleDeviation >= incumbentRingScore.maxAngleDeviation - 1e-9) {
    return false;
  }
  if (candidateScore.totalScore < incumbentScore.totalScore - 1e-9) {
    return true;
  }
  return candidateRingScore.totalScore < incumbentRingScore.totalScore - 1e-9;
}

/**
 * Regularizes peripheral bridged rings around their one shared edge while
 * leaving the shared core atoms fixed. Large bridged alkaloid-like systems can
 * have one oxolane/cyclohexane leaf collapse around an otherwise acceptable KK
 * seed; anchoring only the shared edge repairs that local ring without forcing
 * the whole cage through compact-ring balancing.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Regularized coordinates when accepted, otherwise the original map.
 */
function regularizePeripheralBridgedRings(layoutGraph, rings, atomIds, coords, bondLength) {
  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  let bestScore = saturatedBridgedRingShapeScore(rings, coords, bondLength);
  if (!bestAudit || !bestScore || containsMetalAtom(layoutGraph, atomIds)) {
    return coords;
  }

  for (const candidate of peripheralBridgedRingRegularizationCandidates(rings, bestCoords, bondLength)) {
    let incumbentRingScore = regularRingShapeScore(candidate.ring, bestCoords, bondLength);
    if (!incumbentRingScore) {
      continue;
    }
    for (const blendFactor of PERIPHERAL_BRIDGED_RING_REGULARIZATION_BLEND_FACTORS) {
      const candidateCoords = buildPeripheralBridgedRingRegularizedCoords(bestCoords, candidate, blendFactor);
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
      const candidateScore = saturatedBridgedRingShapeScore(rings, candidateCoords, bondLength);
      const candidateRingScore = regularRingShapeScore(candidate.ring, candidateCoords, bondLength);
      if (shouldAcceptPeripheralBridgedRingRegularizedCoords(candidateAudit, bestAudit, candidateScore, bestScore, candidateRingScore, incumbentRingScore)) {
        bestCoords = candidateCoords;
        bestAudit = candidateAudit;
        bestScore = candidateScore;
        incumbentRingScore = candidateRingScore;
      }
    }
  }

  return bestCoords;
}

function shouldAcceptFusedCyclohexaneCoords(candidateAudit, incumbentAudit, candidateScore, incumbentScore) {
  if (!candidateAudit || !incumbentAudit || candidateScore == null || incumbentScore == null) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if (candidateAudit.ok === true && incumbentAudit.ok !== true) {
    return true;
  }
  if (candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount) {
    return true;
  }
  if (candidateScore < incumbentScore - 1e-9) {
    return true;
  }
  return false;
}

/**
 * Returns compact saturated six-rings that are acting as a core for another
 * bridged ring rather than an ordinary fused edge.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @returns {object[]} Saturated six-ring core candidates.
 */
function saturatedBridgedCyclohexaneCoreRings(rings) {
  return rings.filter(ring => {
    if (ring.aromatic || ring.atomIds.length !== 6) {
      return false;
    }
    return rings.some(bridgeRing => bridgeRing !== ring && !bridgeRing.aromatic && sharedRingAtomIds(ring, bridgeRing).length >= SATURATED_BRIDGED_CYCLOHEXANE_MIN_SHARED_ATOMS);
  });
}

/**
 * Adds exact circular bridge-run targets for non-core atoms in rings that share
 * three or more atoms with the saturated six-ring core.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {object} coreRing - Six-member saturated core ring.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinates to update.
 * @param {number} bondLength - Target bond length.
 * @param {number} heightFactor - Signed bridge arc height selector.
 * @returns {boolean} True when at least one bridge run was placed.
 */
function addSaturatedBridgePathTargets(layoutGraph, rings, coreRing, candidateCoords, bondLength, heightFactor) {
  const coreAtomIds = new Set(coreRing.atomIds);
  let changed = false;

  for (const bridgeRing of rings) {
    if (bridgeRing === coreRing || bridgeRing.aromatic) {
      continue;
    }
    const sharedAtomIds = bridgeRing.atomIds.filter(atomId => coreAtomIds.has(atomId));
    if (sharedAtomIds.length < SATURATED_BRIDGED_CYCLOHEXANE_MIN_SHARED_ATOMS) {
      continue;
    }
    const runs = cyclicExternalRuns(bridgeRing, coreAtomIds).filter(run => run.internalAtomIds.length > 0);
    if (runs.length === 0) {
      continue;
    }
    for (const run of runs) {
      const avoidancePoint = bridgeRunAvoidancePoint(coreRing, bridgeRing, run, candidateCoords);
      const targets = sineBridgePathTargets(candidateCoords, run, avoidancePoint, bondLength, heightFactor);
      if (!targets) {
        continue;
      }
      for (const [atomId, position] of targets) {
        if (!layoutGraph.fixedCoords.has(atomId)) {
          candidateCoords.set(atomId, position);
          changed = true;
        }
      }
    }
  }

  return changed;
}

/**
 * Scores a saturated bridged-core candidate, prioritizing the six-member core
 * while still penalizing branch-preview collisions around it.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {object} coreRing - Six-member saturated core ring.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {number|null} Candidate score, or null for incomplete coordinates.
 */
function saturatedBridgedCyclohexaneScore(layoutGraph, atomIds, coreRing, coords, bondLength) {
  const ringScore = regularRingShapeScore(coreRing, coords, bondLength);
  if (!ringScore) {
    return null;
  }
  return (
    ringScore.totalScore +
    measureFusedCyclohexaneBranchSlotBlockers({ cyclohexaneRing: coreRing }, coords, bondLength) * 10 +
    fusedCyclohexaneBranchPreviewPenalty(layoutGraph, atomIds, coords, bondLength) * 0.01
  );
}

/**
 * Returns whether an exact saturated-bridged core candidate is a safer shape
 * than the incumbent bridged fallback.
 * @param {object|null} candidateAudit - Candidate audit summary.
 * @param {object|null} incumbentAudit - Incumbent audit summary.
 * @param {number|null} candidateScore - Candidate shape score.
 * @param {number|null} incumbentScore - Incumbent shape score.
 * @returns {boolean} True when the candidate should replace the incumbent.
 */
function shouldAcceptSaturatedBridgedCyclohexaneCoords(candidateAudit, incumbentAudit, candidateScore, incumbentScore) {
  if (!candidateAudit || !incumbentAudit || candidateScore == null || incumbentScore == null) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if (candidateAudit.ok === true && incumbentAudit.ok !== true) {
    return true;
  }
  if (candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount) {
    return true;
  }
  return candidateScore < incumbentScore - 1e-9;
}

/**
 * Rebuilds compact fully saturated bridged six-rings as exact regular rings
 * and routes the non-core bridge run around that fixed core.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Regularized coordinates when accepted, otherwise the original map.
 */
export function regularizeSaturatedBridgedCyclohexaneCores(layoutGraph, rings, atomIds, coords, bondLength) {
  if (rings.some(ring => ring.aromatic)) {
    return coords;
  }
  const coreRings = saturatedBridgedCyclohexaneCoreRings(rings);
  if (coreRings.length === 0 || containsMetalAtom(layoutGraph, atomIds)) {
    return coords;
  }

  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  let bestScore = Math.min(...coreRings.map(coreRing => saturatedBridgedCyclohexaneScore(layoutGraph, atomIds, coreRing, coords, bondLength)).filter(score => score != null));
  if (!bestAudit || !Number.isFinite(bestScore)) {
    return coords;
  }

  for (const coreRing of coreRings) {
    const coreTargets = fitRegularRingTargets(coreRing, coords, bondLength);
    if (!coreTargets) {
      continue;
    }
    for (const heightFactor of SATURATED_BRIDGED_CYCLOHEXANE_BRIDGE_HEIGHT_FACTORS) {
      const candidateCoords = cloneCoords(coords);
      for (const [atomId, position] of coreTargets) {
        if (!layoutGraph.fixedCoords.has(atomId)) {
          candidateCoords.set(atomId, position);
        }
      }
      addSaturatedBridgePathTargets(layoutGraph, rings, coreRing, candidateCoords, bondLength, heightFactor);
      const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
      const candidateScore = saturatedBridgedCyclohexaneScore(layoutGraph, atomIds, coreRing, candidateCoords, bondLength);
      if (shouldAcceptSaturatedBridgedCyclohexaneCoords(candidateAudit, bestAudit, candidateScore, bestScore)) {
        bestCoords = candidateCoords;
        bestAudit = candidateAudit;
        bestScore = candidateScore;
      }
    }
  }

  return bestCoords;
}

/**
 * Rebuilds fused aromatic/cyclohexane bridged cores on exact regular-ring
 * geometry when a generic bridged placement has strained the publication-style
 * ring shapes.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Regularized coordinates when accepted, otherwise the original map.
 */
export function regularizeFusedAromaticCyclohexaneCores(layoutGraph, rings, atomIds, coords, bondLength) {
  const pairs = fusedAromaticCyclohexanePairs(rings);
  if (pairs.length === 0) {
    return coords;
  }

  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  let bestScore = Math.min(...pairs.map(pair => fusedCyclohexaneShapeScore(layoutGraph, atomIds, pair, coords, bondLength)).filter(score => score != null));
  if (!bestAudit || !Number.isFinite(bestScore)) {
    return coords;
  }

  for (const pair of pairs) {
    const fusedTargetCandidates = exactFusedAromaticCyclohexanePairTargetCandidates(pair, coords, bondLength);
    if (fusedTargetCandidates.length === 0) {
      continue;
    }
    for (const { targets: fusedTargets } of fusedTargetCandidates) {
      for (const heightFactor of FUSED_CYCLOHEXANE_BRIDGE_HEIGHT_FACTORS) {
        const candidateCoords = cloneCoords(coords);
        for (const [atomId, position] of fusedTargets) {
          if (!layoutGraph.fixedCoords.has(atomId)) {
            candidateCoords.set(atomId, position);
          }
        }
        translateSingleAnchorSideComponentsWithFusedCore(layoutGraph, pair, coords, candidateCoords);
        addVariableBridgePathTargets(layoutGraph, rings, pair, coords, candidateCoords, bondLength, heightFactor);
        const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
        const candidateScore = fusedCyclohexaneShapeScore(layoutGraph, atomIds, pair, candidateCoords, bondLength);
        if (shouldAcceptFusedCyclohexaneCoords(candidateAudit, bestAudit, candidateScore, bestScore)) {
          bestCoords = candidateCoords;
          bestAudit = candidateAudit;
          bestScore = candidateScore;
        }
      }
    }
  }

  return bestCoords;
}

function shouldAcceptAromaticRegularizedCoords(candidateAudit, incumbentAudit, candidateScore, incumbentScore) {
  if (!candidateAudit || !candidateScore || !incumbentAudit || !incumbentScore) {
    return false;
  }
  if (candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if (candidateScore.totalScore >= incumbentScore.totalScore - 1e-9) {
    return false;
  }
  return true;
}

function regularizeAromaticBridgedRings(layoutGraph, rings, atomIds, coords, bondLength) {
  if (!rings.some(ring => ring.aromatic)) {
    return coords;
  }

  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, bestCoords, bondLength);
  let bestScore = aromaticRingShapeScore(rings, bestCoords, bondLength);
  if (!bestAudit || !bestScore) {
    return coords;
  }

  for (const blendFactor of AROMATIC_BRIDGED_REGULARIZATION_BLEND_FACTORS) {
    const candidateCoords = buildAromaticRegularizedCoords(rings, coords, bondLength, blendFactor);
    if (!candidateCoords) {
      continue;
    }
    const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
    const candidateScore = aromaticRingShapeScore(rings, candidateCoords, bondLength);
    if (shouldAcceptAromaticRegularizedCoords(candidateAudit, bestAudit, candidateScore, bestScore)) {
      bestCoords = candidateCoords;
      bestAudit = candidateAudit;
      bestScore = candidateScore;
    }
  }

  const sharedEdgeCoords = buildAromaticSharedEdgeRegularizedCoords(layoutGraph, rings, bestCoords);
  if (sharedEdgeCoords) {
    const sharedEdgeAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, sharedEdgeCoords, bondLength);
    const sharedEdgeScore = aromaticRingShapeScore(rings, sharedEdgeCoords, bondLength);
    if (shouldAcceptAromaticRegularizedCoords(sharedEdgeAudit, bestAudit, sharedEdgeScore, bestScore)) {
      bestCoords = sharedEdgeCoords;
    }
  }

  return bestCoords;
}

/**
 * Compares two bridged placement audits for projection fallback selection.
 * Projection is preferred when it stays audit-clean, but a severe-overlap-free
 * KK seed should beat a stylized bridge projection that collapsed atoms.
 * @param {object|null} candidateAudit - Candidate audit summary.
 * @param {object|null} incumbentAudit - Incumbent audit summary.
 * @returns {number} Negative when the candidate is better.
 */
function compareBridgedProjectionAudits(candidateAudit, incumbentAudit) {
  if (!candidateAudit) {
    return 1;
  }
  if (!incumbentAudit) {
    return -1;
  }
  if (candidateAudit.ok !== incumbentAudit.ok) {
    return candidateAudit.ok ? -1 : 1;
  }
  if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
    return candidateAudit.severeOverlapCount - incumbentAudit.severeOverlapCount;
  }
  if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
    return candidateAudit.bondLengthFailureCount - incumbentAudit.bondLengthFailureCount;
  }
  const candidateCrossings = candidateAudit.visibleHeavyBondCrossingCount ?? 0;
  const incumbentCrossings = incumbentAudit.visibleHeavyBondCrossingCount ?? 0;
  if (candidateCrossings !== incumbentCrossings) {
    return candidateCrossings - incumbentCrossings;
  }
  if (
    candidateAudit.minSevereOverlapDistance != null &&
    incumbentAudit.minSevereOverlapDistance != null &&
    Math.abs(candidateAudit.minSevereOverlapDistance - incumbentAudit.minSevereOverlapDistance) > 1e-9
  ) {
    return incumbentAudit.minSevereOverlapDistance - candidateAudit.minSevereOverlapDistance;
  }
  if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
    return candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation;
  }
  return 0;
}

function retouchMarginalStretchedBridgedRingBonds(layoutGraph, atomIds, coords, bondLength, baseAudit = null) {
  const atomIdSet = new Set(atomIds);
  const maxDistance = bondLength * BRIDGED_VALIDATION.maxBondLengthFactor;
  const maxRetouchDistance = maxDistance + bondLength * MARGINAL_STRETCHED_BRIDGED_RING_BOND_RETOUCH_MAX_EXCESS_FACTOR;
  const buffer = bondLength * MARGINAL_STRETCHED_BRIDGED_RING_BOND_RETOUCH_BUFFER_FACTOR;
  let bestCoords = coords;
  let bestAudit = baseAudit ?? auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  if (!bestAudit || (bestAudit.bondLengthFailureCount ?? 0) === 0) {
    return coords;
  }

  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing || !atomIdSet.has(bond.a) || !atomIdSet.has(bond.b)) {
      continue;
    }
    const firstPosition = bestCoords.get(bond.a);
    const secondPosition = bestCoords.get(bond.b);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const dx = secondPosition.x - firstPosition.x;
    const dy = secondPosition.y - firstPosition.y;
    const currentDistance = Math.hypot(dx, dy);
    if (currentDistance <= maxDistance + 1e-9 || currentDistance > maxRetouchDistance || currentDistance <= 1e-9) {
      continue;
    }

    const unitX = dx / currentDistance;
    const unitY = dy / currentDistance;
    const reduction = currentDistance - maxDistance + buffer;
    for (const movedAtomId of [bond.b, bond.a]) {
      if (layoutGraph.fixedCoords.has(movedAtomId)) {
        continue;
      }
      const candidateCoords = cloneCoords(bestCoords);
      const movedPosition = candidateCoords.get(movedAtomId);
      if (!movedPosition) {
        continue;
      }
      const direction = movedAtomId === bond.b ? -1 : 1;
      candidateCoords.set(movedAtomId, {
        x: movedPosition.x + direction * unitX * reduction,
        y: movedPosition.y + direction * unitY * reduction
      });
      const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
      if (compareBridgedProjectionAudits(candidateAudit, bestAudit) < 0) {
        bestCoords = candidateCoords;
        bestAudit = candidateAudit;
        break;
      }
    }
  }

  return bestCoords;
}

/**
 * Selects the projected bridge coordinates unless a clean KK seed or a clearly
 * better catastrophic-collapse fallback should replace it.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} kkCoords - Raw KK coordinates.
 * @param {{coords: Map<string, {x: number, y: number}>, bridgeheadAtomIds: [string, string]|null}} projected - Projected bridge-path result.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Selected coordinate map.
 */
function selectBridgedProjectionCoords(layoutGraph, atomIds, kkCoords, projected, bondLength) {
  const projectedCoords = projected.coords;
  const projectedAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, projectedCoords, bondLength);
  if (projectedAudit?.ok === true) {
    return projectedCoords;
  }

  const baselineCoords = projected.bridgeheadAtomIds ? orientBridgedSeed(kkCoords, projected.bridgeheadAtomIds).coords : new Map(kkCoords);
  const baselineAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, baselineCoords, bondLength);
  if (baselineAudit?.ok === true) {
    return baselineCoords;
  }
  if (hasSevereBridgeProjectionBondRegression(projectedAudit, baselineAudit, bondLength)) {
    return baselineCoords;
  }
  return hasCatastrophicBridgeProjectionCollapse(projectedAudit, bondLength) && compareBridgedProjectionAudits(baselineAudit, projectedAudit) < 0 ? baselineCoords : projectedCoords;
}

function heavyNeighborCount(layoutGraph, atomId) {
  let count = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    const neighborId = bond.a === atomId ? bond.b : bond.a;
    if (layoutGraph.atoms.get(neighborId)?.element !== 'H') {
      count++;
    }
  }
  return count;
}

function collapsedFourMemberedBridgeApexMovableAtomId(layoutGraph, firstAtomId, secondAtomId) {
  const firstRingCount = layoutGraph.atomToRings.get(firstAtomId)?.length ?? 0;
  const secondRingCount = layoutGraph.atomToRings.get(secondAtomId)?.length ?? 0;
  if (firstRingCount !== secondRingCount) {
    return firstRingCount < secondRingCount ? firstAtomId : secondAtomId;
  }

  const firstHeavyNeighborCount = heavyNeighborCount(layoutGraph, firstAtomId);
  const secondHeavyNeighborCount = heavyNeighborCount(layoutGraph, secondAtomId);
  if (firstHeavyNeighborCount !== secondHeavyNeighborCount) {
    return firstHeavyNeighborCount < secondHeavyNeighborCount ? firstAtomId : secondAtomId;
  }

  return firstAtomId;
}

function shouldAcceptBridgedRegularizationCandidate(candidateAudit, incumbentAudit) {
  if (!candidateAudit) {
    return false;
  }
  if (!incumbentAudit) {
    return true;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if (candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount) {
    return true;
  }
  return compareBridgedProjectionAudits(candidateAudit, incumbentAudit) < 0;
}

function resolveCollapsedFourMemberedBridgeApexes(layoutGraph, rings, atomIds, coords, bondLength) {
  if (rings.length < 3 || atomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || containsMetalAtom(layoutGraph, atomIds)) {
    return coords;
  }

  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, bestCoords, bondLength);
  const collapseThreshold = bondLength * COLLAPSED_FOUR_MEMBERED_BRIDGE_APEX_FACTOR;

  for (const ring of rings) {
    if (ring.aromatic || ring.atomIds.length !== 4) {
      continue;
    }
    for (const [firstIndex, secondIndex] of [
      [0, 2],
      [1, 3]
    ]) {
      const firstAtomId = ring.atomIds[firstIndex];
      const secondAtomId = ring.atomIds[secondIndex];
      const firstPosition = bestCoords.get(firstAtomId);
      const secondPosition = bestCoords.get(secondAtomId);
      if (!firstPosition || !secondPosition || distance(firstPosition, secondPosition) > collapseThreshold) {
        continue;
      }

      const movableAtomId = collapsedFourMemberedBridgeApexMovableAtomId(layoutGraph, firstAtomId, secondAtomId);
      const movableIndex = ring.atomIds.indexOf(movableAtomId);
      if (movableIndex < 0) {
        continue;
      }
      const previousAtomId = ring.atomIds[(movableIndex - 1 + ring.atomIds.length) % ring.atomIds.length];
      const nextAtomId = ring.atomIds[(movableIndex + 1) % ring.atomIds.length];
      const movablePosition = bestCoords.get(movableAtomId);
      const previousPosition = bestCoords.get(previousAtomId);
      const nextPosition = bestCoords.get(nextAtomId);
      if (!movablePosition || !previousPosition || !nextPosition) {
        continue;
      }

      const reflectedPosition = reflectPointAcrossLine(movablePosition, previousPosition, nextPosition);
      if (!reflectedPosition) {
        continue;
      }
      const candidateCoords = cloneCoords(bestCoords);
      candidateCoords.set(movableAtomId, reflectedPosition);
      const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
      if (shouldAcceptBridgedRegularizationCandidate(candidateAudit, bestAudit)) {
        bestCoords = candidateCoords;
        bestAudit = candidateAudit;
      }
    }
  }

  return bestCoords;
}

function longestSharedRunInRing(ring, sharedAtomIdSet) {
  const ringSize = ring.atomIds.length;
  if (ringSize === 0 || ring.atomIds.every(atomId => sharedAtomIdSet.has(atomId))) {
    return null;
  }

  let bestRun = null;
  for (let index = 0; index < ringSize; index++) {
    const atomId = ring.atomIds[index];
    const previousAtomId = ring.atomIds[(index - 1 + ringSize) % ringSize];
    if (!sharedAtomIdSet.has(atomId) || sharedAtomIdSet.has(previousAtomId)) {
      continue;
    }

    let length = 0;
    while (length < ringSize && sharedAtomIdSet.has(ring.atomIds[(index + length) % ringSize])) {
      length++;
    }
    if (!bestRun || length > bestRun.length) {
      bestRun = { startIndex: index, length };
    }
  }

  return bestRun && bestRun.length >= 2 ? bestRun : null;
}

function sharedBridgeLaneDescriptor(ring, sharedAtomIdSet) {
  const sharedRun = longestSharedRunInRing(ring, sharedAtomIdSet);
  if (!sharedRun) {
    return null;
  }

  const ringSize = ring.atomIds.length;
  const firstEndpointAtomId = ring.atomIds[sharedRun.startIndex];
  const secondEndpointAtomId = ring.atomIds[(sharedRun.startIndex + sharedRun.length - 1) % ringSize];
  const laneAtomIds = [];
  let index = (sharedRun.startIndex + sharedRun.length) % ringSize;
  while (index !== sharedRun.startIndex) {
    laneAtomIds.push(ring.atomIds[index]);
    index = (index + 1) % ringSize;
  }
  if (laneAtomIds.some(atomId => sharedAtomIdSet.has(atomId))) {
    return null;
  }

  return {
    firstEndpointAtomId,
    secondEndpointAtomId,
    laneAtomIds
  };
}

function sameEndpointPair(firstDescriptor, secondDescriptor) {
  return (
    (firstDescriptor.firstEndpointAtomId === secondDescriptor.firstEndpointAtomId && firstDescriptor.secondEndpointAtomId === secondDescriptor.secondEndpointAtomId) ||
    (firstDescriptor.firstEndpointAtomId === secondDescriptor.secondEndpointAtomId && firstDescriptor.secondEndpointAtomId === secondDescriptor.firstEndpointAtomId)
  );
}

function compactSharedBridgeLaneDescriptors(rings) {
  const descriptors = [];
  for (let firstIndex = 0; firstIndex < rings.length; firstIndex++) {
    const firstRing = rings[firstIndex];
    if (firstRing.aromatic) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < rings.length; secondIndex++) {
      const secondRing = rings[secondIndex];
      if (secondRing.aromatic) {
        continue;
      }

      const sharedAtomIds = sharedRingAtomIds(firstRing, secondRing);
      if (sharedAtomIds.length < 4) {
        continue;
      }
      const sharedAtomIdSet = new Set(sharedAtomIds);
      const firstDescriptor = sharedBridgeLaneDescriptor(firstRing, sharedAtomIdSet);
      const secondDescriptor = sharedBridgeLaneDescriptor(secondRing, sharedAtomIdSet);
      if (!firstDescriptor || !secondDescriptor || !sameEndpointPair(firstDescriptor, secondDescriptor)) {
        continue;
      }

      const longerDescriptor = firstDescriptor.laneAtomIds.length >= secondDescriptor.laneAtomIds.length ? firstDescriptor : secondDescriptor;
      if (longerDescriptor.laneAtomIds.length < 3) {
        continue;
      }
      descriptors.push(longerDescriptor);
    }
  }
  return descriptors;
}

function spreadCompactSharedBridgeLanes(layoutGraph, rings, atomIds, coords, bondLength) {
  if (rings.length < 3 || atomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || containsMetalAtom(layoutGraph, atomIds)) {
    return coords;
  }

  const laneDescriptors = compactSharedBridgeLaneDescriptors(rings);
  if (laneDescriptors.length === 0) {
    return coords;
  }

  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, bestCoords, bondLength);
  for (const descriptor of laneDescriptors) {
    const firstEndpointPosition = bestCoords.get(descriptor.firstEndpointAtomId);
    const secondEndpointPosition = bestCoords.get(descriptor.secondEndpointAtomId);
    if (!firstEndpointPosition || !secondEndpointPosition) {
      continue;
    }

    for (const spreadFactor of COMPACT_SHARED_BRIDGE_LANE_SPREAD_FACTORS) {
      const candidateCoords = cloneCoords(bestCoords);
      let complete = true;
      for (const atomId of descriptor.laneAtomIds) {
        const position = bestCoords.get(atomId);
        const scaledPosition = position ? scalePointFromLine(position, firstEndpointPosition, secondEndpointPosition, spreadFactor) : null;
        if (!scaledPosition) {
          complete = false;
          break;
        }
        candidateCoords.set(atomId, scaledPosition);
      }
      if (!complete) {
        continue;
      }

      const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
      if (shouldAcceptBridgedRegularizationCandidate(candidateAudit, bestAudit)) {
        bestCoords = candidateCoords;
        bestAudit = candidateAudit;
        if (bestAudit?.ok === true) {
          break;
        }
      }
    }
  }

  return bestCoords;
}

function moveAtomAndAttachedHydrogens(layoutGraph, coords, atomId, targetPosition) {
  const currentPosition = coords.get(atomId);
  if (!currentPosition) {
    return;
  }
  const dx = targetPosition.x - currentPosition.x;
  const dy = targetPosition.y - currentPosition.y;
  coords.set(atomId, targetPosition);
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    if (layoutGraph.atoms.get(neighborAtomId)?.element !== 'H') {
      continue;
    }
    const neighborPosition = coords.get(neighborAtomId);
    if (neighborPosition) {
      coords.set(neighborAtomId, {
        x: neighborPosition.x + dx,
        y: neighborPosition.y + dy
      });
    }
  }
}

function collapsedThreeAtomBridgeRunDescriptors(layoutGraph, rings, coords, bondLength) {
  const descriptors = [];
  for (const ring of rings) {
    if (ring.aromatic || ring.atomIds.length !== 6) {
      continue;
    }
    const ringSize = ring.atomIds.length;
    for (let startIndex = 0; startIndex < ringSize; startIndex++) {
      const firstEndpointAtomId = ring.atomIds[startIndex];
      const internalAtomIds = [1, 2, 3].map(offset => ring.atomIds[(startIndex + offset) % ringSize]);
      const secondEndpointAtomId = ring.atomIds[(startIndex + 4) % ringSize];
      if (internalAtomIds.some(atomId => layoutGraph.fixedCoords.has(atomId))) {
        continue;
      }
      if (
        internalAtomIds.some(atomId => {
          const atom = layoutGraph.atoms.get(atomId);
          return atom?.element !== 'C' || (atom.heavyDegree ?? 0) > 2;
        })
      ) {
        continue;
      }
      const firstEndpointPosition = coords.get(firstEndpointAtomId);
      const secondEndpointPosition = coords.get(secondEndpointAtomId);
      if (!firstEndpointPosition || !secondEndpointPosition || distance(firstEndpointPosition, secondEndpointPosition) > bondLength * 1.6) {
        continue;
      }
      let minInternalBondDistance = Number.POSITIVE_INFINITY;
      const pathAtomIds = [firstEndpointAtomId, ...internalAtomIds, secondEndpointAtomId];
      for (let index = 0; index < pathAtomIds.length - 1; index++) {
        const firstPosition = coords.get(pathAtomIds[index]);
        const secondPosition = coords.get(pathAtomIds[index + 1]);
        if (!firstPosition || !secondPosition) {
          minInternalBondDistance = Number.POSITIVE_INFINITY;
          break;
        }
        minInternalBondDistance = Math.min(minInternalBondDistance, distance(firstPosition, secondPosition));
      }
      if (minInternalBondDistance > bondLength * 0.72) {
        continue;
      }
      descriptors.push({
        firstEndpointAtomId,
        secondEndpointAtomId,
        internalAtomIds
      });
    }
  }
  return descriptors;
}

function retouchCollapsedSaturatedThreeAtomBridgeLanes(layoutGraph, rings, atomIds, coords, bondLength) {
  const descriptors = collapsedThreeAtomBridgeRunDescriptors(layoutGraph, rings, coords, bondLength);
  if (descriptors.length === 0) {
    return coords;
  }

  let bestCoords = coords;
  let bestAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, bestCoords, bondLength);
  for (const descriptor of descriptors) {
    const firstEndpointPosition = bestCoords.get(descriptor.firstEndpointAtomId);
    const secondEndpointPosition = bestCoords.get(descriptor.secondEndpointAtomId);
    if (!firstEndpointPosition || !secondEndpointPosition) {
      continue;
    }
    const dx = secondEndpointPosition.x - firstEndpointPosition.x;
    const dy = secondEndpointPosition.y - firstEndpointPosition.y;
    const spanLength = Math.hypot(dx, dy);
    if (spanLength <= 1e-9) {
      continue;
    }
    const normals = [
      { x: dy / spanLength, y: -dx / spanLength },
      { x: -dy / spanLength, y: dx / spanLength }
    ];
    for (const normal of normals) {
      for (const heightFactor of COLLAPSED_SATURATED_THREE_ATOM_BRIDGE_ARC_HEIGHT_FACTORS) {
        const candidateCoords = cloneCoords(bestCoords);
        for (let index = 0; index < descriptor.internalAtomIds.length; index++) {
          const t = (index + 1) / (descriptor.internalAtomIds.length + 1);
          const bulge = Math.sin(Math.PI * t) * bondLength * heightFactor;
          moveAtomAndAttachedHydrogens(layoutGraph, candidateCoords, descriptor.internalAtomIds[index], {
            x: firstEndpointPosition.x + dx * t + normal.x * bulge,
            y: firstEndpointPosition.y + dy * t + normal.y * bulge
          });
        }
        const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
        if (shouldAcceptBridgedRegularizationCandidate(candidateAudit, bestAudit)) {
          bestCoords = candidateCoords;
          bestAudit = candidateAudit;
          if (bestAudit?.ok === true) {
            return bestCoords;
          }
        }
      }
    }
  }

  return bestCoords;
}

/**
 * Applies the bridged-family ring regularization stack to an existing ring
 * system placement. Mixed-family layouts can pick a hybrid fused/bridged seed
 * before this point, so this keeps their final ring geometry aligned with the
 * pure bridged path without forcing them through a different seed selector.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Ring descriptors in the bridged system.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>} Regularized coordinates when accepted, otherwise the original map.
 */
export function regularizeBridgedRingSystemGeometry(layoutGraph, rings, atomIds, coords, bondLength) {
  const baseAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  let selectedCoords = coords;
  selectedCoords = regularizeSaturatedBridgedCyclohexaneCores(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizeFusedAromaticCyclohexaneCores(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizeSaturatedBridgedRings(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = balanceSaturatedBridgedRingJunctionAngles(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = balanceSaturatedBridgedRingShape(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizeSingleAnchorBridgedRings(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizePeripheralBridgedRings(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizeAromaticBridgedRings(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizeStrictSmallBridgedRings(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = spreadSpiroJunctionRingBlocks(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizeSaturatedBridgedCyclohexaneCores(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = resolveCollapsedFourMemberedBridgeApexes(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = spreadCompactSharedBridgeLanes(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = retouchCollapsedSaturatedThreeAtomBridgeLanes(layoutGraph, rings, atomIds, selectedCoords, bondLength);
  const selectedAudit = selectedCoords === coords ? baseAudit : auditBridgedPlacementCandidate(layoutGraph, atomIds, selectedCoords, bondLength);
  const canRetouchMarginalStretch = atomIds.length >= MARGINAL_STRETCHED_BRIDGED_RING_BOND_RETOUCH_MIN_ATOMS && rings.length >= MARGINAL_STRETCHED_BRIDGED_RING_BOND_RETOUCH_MIN_RINGS;
  if (canRetouchMarginalStretch && compareBridgedProjectionAudits(selectedAudit, baseAudit) > 0) {
    return retouchMarginalStretchedBridgedRingBonds(layoutGraph, atomIds, coords, bondLength, baseAudit);
  }
  return selectedCoords;
}

/**
 * Returns a shortest-ring-first atom order for compact saturated 5-5-4 cages.
 * Starting KK on the small ring keeps the two larger ether lanes from collapsing
 * into a crossed bridge projection before the ordinary bridged audit can compare
 * candidates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Rings being placed as one bridged component.
 * @param {string[]} fallbackAtomIds - Ring-list atom order used by default.
 * @returns {string[]|null} Seed atom order for compact 5-5-4 cages, or `null`.
 */
function compactSmallRingFirstBridgedAtomIds(layoutGraph, rings, fallbackAtomIds) {
  if (rings.length !== 3 || fallbackAtomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || rings.some(ring => ring.aromatic) || containsMetalAtom(layoutGraph, fallbackAtomIds)) {
    return null;
  }

  const ringSizes = rings.map(ring => ring.atomIds.length).sort((firstSize, secondSize) => firstSize - secondSize);
  if (ringSizes[0] !== 4 || ringSizes[1] !== 5 || ringSizes[2] !== 5) {
    return null;
  }

  const atomIds = [...new Set([...rings].sort((firstRing, secondRing) => firstRing.atomIds.length - secondRing.atomIds.length || firstRing.id - secondRing.id).flatMap(ring => ring.atomIds))];
  return atomIds.length === fallbackAtomIds.length ? atomIds : null;
}

function compactSaturatedSpiroLaneFirstBridgedAtomIds(layoutGraph, rings, fallbackAtomIds) {
  if (rings.length !== 3 || fallbackAtomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || rings.some(ring => ring.aromatic) || containsMetalAtom(layoutGraph, fallbackAtomIds)) {
    return null;
  }

  const ringSizes = rings.map(ring => ring.atomIds.length).sort((firstSize, secondSize) => firstSize - secondSize);
  const supportedRingSizeSet = (ringSizes[0] === 3 && ringSizes[1] === 5 && ringSizes[2] === 6) || (ringSizes[0] === 5 && ringSizes[1] === 6 && ringSizes[2] === 7);
  if (!supportedRingSizeSet) {
    return null;
  }

  const ringIds = new Set(rings.map(ring => ring.id));
  const connections = (layoutGraph.ringConnections ?? []).filter(connection => ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId));
  if (!connections.some(connection => connection.kind === 'bridged') || !connections.some(connection => connection.kind === 'spiro')) {
    return null;
  }
  if (!connections.some(connection => (connection.sharedAtomIds?.length ?? 0) >= 3)) {
    return null;
  }

  const atomIds = [...new Set([...rings].sort((firstRing, secondRing) => firstRing.atomIds.length - secondRing.atomIds.length || firstRing.id - secondRing.id).flatMap(ring => ring.atomIds))];
  return atomIds.length === fallbackAtomIds.length ? atomIds : null;
}

function compactSingleSpiroSharedPathFiveRingAtomIds(layoutGraph, rings, fallbackAtomIds) {
  if (rings.length !== 3 || fallbackAtomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || rings.some(ring => ring.aromatic) || containsMetalAtom(layoutGraph, fallbackAtomIds)) {
    return null;
  }

  const ringSizes = rings.map(ring => ring.atomIds.length).sort((firstSize, secondSize) => firstSize - secondSize);
  if (ringSizes.join(',') !== '3,5,5') {
    return null;
  }

  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const ringIds = new Set(rings.map(ring => ring.id));
  const connections = (layoutGraph.ringConnections ?? []).filter(connection => ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId));
  const bridgedConnection = connections.find(connection => connection.kind === 'bridged' && (connection.sharedAtomIds?.length ?? 0) >= 3);
  const spiroConnections = connections.filter(connection => connection.kind === 'spiro' && (connection.sharedAtomIds?.length ?? 0) === 1);
  if (!bridgedConnection || spiroConnections.length !== 1) {
    return null;
  }

  const spiroConnection = spiroConnections[0];
  const spiroRing = [ringById.get(spiroConnection.firstRingId), ringById.get(spiroConnection.secondRingId)].find(ring => ring?.atomIds.length === 3);
  const parentRing = [ringById.get(spiroConnection.firstRingId), ringById.get(spiroConnection.secondRingId)].find(ring => ring?.atomIds.length === 5);
  const bridgedMateRing = [ringById.get(bridgedConnection.firstRingId), ringById.get(bridgedConnection.secondRingId)].find(ring => ring && ring !== parentRing);
  if (!spiroRing || !parentRing || !bridgedMateRing || bridgedMateRing.atomIds.length !== 5) {
    return null;
  }

  const atomIds = [...new Set([parentRing, spiroRing, bridgedMateRing].flatMap(ring => ring.atomIds))];
  return atomIds.length === fallbackAtomIds.length ? atomIds : null;
}

function compactDoubleSharedPathSixSevenEightRingAtomIds(layoutGraph, rings, fallbackAtomIds) {
  if (rings.length !== 3 || fallbackAtomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || rings.some(ring => ring.aromatic) || containsMetalAtom(layoutGraph, fallbackAtomIds)) {
    return null;
  }

  const ringSizes = rings.map(ring => ring.atomIds.length).sort((firstSize, secondSize) => firstSize - secondSize);
  if (ringSizes.join(',') !== '6,7,8') {
    return null;
  }

  const ringIds = new Set(rings.map(ring => ring.id));
  const connections = (layoutGraph.ringConnections ?? []).filter(connection => ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId));
  if (connections.length !== 2 || connections.some(connection => connection.kind !== 'bridged' || (connection.sharedAtomIds?.length ?? 0) < 3)) {
    return null;
  }

  const connectionCountByRingId = new Map(rings.map(ring => [ring.id, 0]));
  for (const connection of connections) {
    connectionCountByRingId.set(connection.firstRingId, (connectionCountByRingId.get(connection.firstRingId) ?? 0) + 1);
    connectionCountByRingId.set(connection.secondRingId, (connectionCountByRingId.get(connection.secondRingId) ?? 0) + 1);
  }
  const centralRing = rings.find(ring => connectionCountByRingId.get(ring.id) === 2);
  if (!centralRing || centralRing.atomIds.length !== 8) {
    return null;
  }

  const sideRings = rings.filter(ring => ring !== centralRing).sort((firstRing, secondRing) => firstRing.atomIds.length - secondRing.atomIds.length || firstRing.id - secondRing.id);
  const atomIds = [...new Set([centralRing, ...sideRings].flatMap(ring => ring.atomIds))];
  return atomIds.length === fallbackAtomIds.length ? atomIds : null;
}

function isAromaticFusedBridgeLaneFirstBridgedSystem(layoutGraph, rings, atomIds) {
  if (rings.length !== 5 || atomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || containsMetalAtom(layoutGraph, atomIds)) {
    return false;
  }

  const aromaticRings = rings.filter(ring => ring.aromatic);
  const ringSizes = rings.map(ring => ring.atomIds.length).sort((firstSize, secondSize) => firstSize - secondSize);
  if (aromaticRings.length !== 1 || aromaticRings[0].atomIds.length !== 6 || ringSizes.join(',') !== '5,6,6,6,6') {
    return false;
  }

  const ringIds = new Set(rings.map(ring => ring.id));
  const connections = (layoutGraph.ringConnections ?? []).filter(connection => ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId));
  if (!connections.some(connection => connection.kind === 'bridged' && (connection.sharedAtomIds?.length ?? 0) >= 4)) {
    return false;
  }
  if (!connections.some(connection => connection.kind === 'fused') || !connections.some(connection => connection.kind === 'spiro')) {
    return false;
  }

  return true;
}

function aromaticFusedBridgeLaneFirstBridgedAtomIds(layoutGraph, rings, fallbackAtomIds) {
  if (!isAromaticFusedBridgeLaneFirstBridgedSystem(layoutGraph, rings, fallbackAtomIds)) {
    return null;
  }

  const atomIds = [
    ...new Set(
      [...rings]
        .sort((firstRing, secondRing) => {
          if (firstRing.atomIds.length !== secondRing.atomIds.length) {
            return firstRing.atomIds.length - secondRing.atomIds.length;
          }
          if (firstRing.aromatic !== secondRing.aromatic) {
            return firstRing.aromatic ? 1 : -1;
          }
          return firstRing.id - secondRing.id;
        })
        .flatMap(ring => ring.atomIds)
    )
  ];
  return atomIds.length === fallbackAtomIds.length ? atomIds : null;
}

function saturatedDoubleBridgedRingSystemAtomIds(layoutGraph, rings, fallbackAtomIds) {
  if (rings.length !== 3 || fallbackAtomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || rings.some(ring => ring.aromatic) || containsMetalAtom(layoutGraph, fallbackAtomIds)) {
    return null;
  }

  const ringSizes = rings.map(ring => ring.atomIds.length).sort((firstSize, secondSize) => firstSize - secondSize);
  if (ringSizes[0] !== 6 || ringSizes[1] !== 7 || ringSizes[2] !== 7) {
    return null;
  }

  const ringIds = rings.map(ring => ring.id);
  const ringIdSet = new Set(ringIds);
  const connections = (layoutGraph.ringConnections ?? []).filter(connection => ringIdSet.has(connection.firstRingId) && ringIdSet.has(connection.secondRingId));
  const bridgedConnections = connections.filter(connection => connection.kind === 'bridged');
  if (bridgedConnections.length !== 2 || bridgedConnections.some(connection => (connection.sharedAtomIds?.length ?? 0) < 3)) {
    return null;
  }

  const owningRingSystem = (layoutGraph.ringSystems ?? []).find(ringSystem => {
    const systemRingIds = ringSystem.ringIds ?? [];
    return systemRingIds.length === ringIds.length && systemRingIds.every(ringId => ringIdSet.has(ringId));
  });
  if (!owningRingSystem || !Array.isArray(owningRingSystem.atomIds)) {
    return null;
  }

  const fallbackAtomIdSet = new Set(fallbackAtomIds);
  return owningRingSystem.atomIds.length === fallbackAtomIds.length && owningRingSystem.atomIds.every(atomId => fallbackAtomIdSet.has(atomId)) ? [...owningRingSystem.atomIds] : null;
}

/**
 * Returns an aromatic-cap-first atom order for compact bridged systems where a
 * fused aromatic cap is attached to a saturated bridged core. Seeding KK from
 * the aromatic cap keeps the cap rigid while the saturated lanes spread around
 * it, instead of letting the default SSSR order fold the bridge underneath the
 * aromatic face.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Rings being placed as one bridged component.
 * @param {string[]} fallbackAtomIds - Ring-list atom order used by default.
 * @returns {string[]|null} Seed atom order for aromatic-capped bridged systems, or `null`.
 */
function aromaticCapFirstBridgedAtomIds(layoutGraph, rings, fallbackAtomIds) {
  if (rings.length !== 3 || fallbackAtomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || containsMetalAtom(layoutGraph, fallbackAtomIds)) {
    return null;
  }

  const aromaticRings = rings.filter(ring => ring.aromatic);
  if (aromaticRings.length !== 1) {
    return null;
  }

  const ringIdSet = new Set(rings.map(ring => ring.id));
  const connectionKinds = new Set(
    (layoutGraph.ringConnections ?? []).filter(connection => ringIdSet.has(connection.firstRingId) && ringIdSet.has(connection.secondRingId)).map(connection => connection.kind)
  );
  if (!connectionKinds.has('bridged') || !connectionKinds.has('fused')) {
    return null;
  }

  const atomIds = [
    ...new Set(
      [...rings]
        .sort((firstRing, secondRing) => {
          if (firstRing.aromatic !== secondRing.aromatic) {
            return firstRing.aromatic ? -1 : 1;
          }
          return secondRing.id - firstRing.id;
        })
        .flatMap(ring => ring.atomIds)
    )
  ];
  return atomIds.length === fallbackAtomIds.length ? atomIds : null;
}

/**
 * Returns a stable alternate seed for compact 5-5 cages that share a three-atom
 * path. Starting from the later SSSR lane keeps the longer acetal/lactone arc
 * outside the shared bridge instead of folding it through the branch side.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Rings being placed as one bridged component.
 * @param {string[]} fallbackAtomIds - Ring-list atom order used by default.
 * @returns {string[]|null} Seed atom order for compact shared-path five-rings, or `null`.
 */
function compactSharedPathFiveRingAtomIds(layoutGraph, rings, fallbackAtomIds) {
  if (
    rings.length !== 2 ||
    fallbackAtomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit ||
    rings.some(ring => ring.aromatic || ring.atomIds.length !== 5) ||
    containsMetalAtom(layoutGraph, fallbackAtomIds)
  ) {
    return null;
  }

  if (sharedRingAtomIds(rings[0], rings[1]).length !== 3) {
    return null;
  }

  const atomIds = [...new Set([...rings].sort((firstRing, secondRing) => secondRing.id - firstRing.id).flatMap(ring => ring.atomIds))];
  return atomIds.length === fallbackAtomIds.length ? atomIds : null;
}

function compactSharedPathFourFiveRingAtomIds(layoutGraph, rings, fallbackAtomIds) {
  if (rings.length !== 2 || fallbackAtomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || rings.some(ring => ring.aromatic) || containsMetalAtom(layoutGraph, fallbackAtomIds)) {
    return null;
  }

  const ringSizes = rings.map(ring => ring.atomIds.length).sort((firstSize, secondSize) => firstSize - secondSize);
  if (ringSizes[0] !== 4 || ringSizes[1] !== 5 || sharedRingAtomIds(rings[0], rings[1]).length !== 3) {
    return null;
  }

  const ringIds = rings.map(ring => ring.id);
  const ringIdSet = new Set(ringIds);
  const owningRingSystem = (layoutGraph.ringSystems ?? []).find(ringSystem => {
    const systemRingIds = ringSystem.ringIds ?? [];
    return systemRingIds.length === ringIds.length && systemRingIds.every(ringId => ringIdSet.has(ringId));
  });
  if (!owningRingSystem || !Array.isArray(owningRingSystem.atomIds)) {
    return null;
  }

  const fallbackAtomIdSet = new Set(fallbackAtomIds);
  return owningRingSystem.atomIds.length === fallbackAtomIds.length && owningRingSystem.atomIds.every(atomId => fallbackAtomIdSet.has(atomId)) ? [...owningRingSystem.atomIds] : null;
}

/**
 * Returns a stable atom order for bridged KK seeding. The order produced by
 * flattening SSSR ring atom lists can start dense tetracyclic cages in a
 * crossed state; the ring-system ordering is generated once from the whole
 * fused component and gives KK a less biased initial circle, while compact
 * 5-5-4 cages use their small ring as the initial seed and aromatic-capped
 * bridged cores seed from the fused cap.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Rings being placed as one bridged component.
 * @param {string|null} [templateId] - Matched template ID, when placement is templated.
 * @returns {string[]} Atom IDs for the bridged component.
 */
function bridgedPlacementAtomIds(layoutGraph, rings, templateId = null) {
  const fallbackAtomIds = [...new Set(rings.flatMap(ring => ring.atomIds))];
  if (templateId != null) {
    return fallbackAtomIds;
  }

  const compactSmallRingFirstAtomIds = compactSmallRingFirstBridgedAtomIds(layoutGraph, rings, fallbackAtomIds);
  if (compactSmallRingFirstAtomIds) {
    return compactSmallRingFirstAtomIds;
  }

  const compactSaturatedSpiroLaneAtomIds = compactSaturatedSpiroLaneFirstBridgedAtomIds(layoutGraph, rings, fallbackAtomIds);
  if (compactSaturatedSpiroLaneAtomIds) {
    return compactSaturatedSpiroLaneAtomIds;
  }

  const compactSingleSpiroSharedPathFiveRingAtomIdsResult = compactSingleSpiroSharedPathFiveRingAtomIds(layoutGraph, rings, fallbackAtomIds);
  if (compactSingleSpiroSharedPathFiveRingAtomIdsResult) {
    return compactSingleSpiroSharedPathFiveRingAtomIdsResult;
  }

  const compactDoubleSharedPathSixSevenEightRingAtomIdsResult = compactDoubleSharedPathSixSevenEightRingAtomIds(layoutGraph, rings, fallbackAtomIds);
  if (compactDoubleSharedPathSixSevenEightRingAtomIdsResult) {
    return compactDoubleSharedPathSixSevenEightRingAtomIdsResult;
  }

  const aromaticFusedBridgeLaneFirstAtomIds = aromaticFusedBridgeLaneFirstBridgedAtomIds(layoutGraph, rings, fallbackAtomIds);
  if (aromaticFusedBridgeLaneFirstAtomIds) {
    return aromaticFusedBridgeLaneFirstAtomIds;
  }

  const saturatedDoubleBridgedRingSystemAtomIdsResult = saturatedDoubleBridgedRingSystemAtomIds(layoutGraph, rings, fallbackAtomIds);
  if (saturatedDoubleBridgedRingSystemAtomIdsResult) {
    return saturatedDoubleBridgedRingSystemAtomIdsResult;
  }

  const aromaticCapFirstAtomIds = aromaticCapFirstBridgedAtomIds(layoutGraph, rings, fallbackAtomIds);
  if (aromaticCapFirstAtomIds) {
    return aromaticCapFirstAtomIds;
  }

  const compactSharedPathFiveRingAtomIdsResult = compactSharedPathFiveRingAtomIds(layoutGraph, rings, fallbackAtomIds);
  if (compactSharedPathFiveRingAtomIdsResult) {
    return compactSharedPathFiveRingAtomIdsResult;
  }

  const compactSharedPathFourFiveRingAtomIdsResult = compactSharedPathFourFiveRingAtomIds(layoutGraph, rings, fallbackAtomIds);
  if (compactSharedPathFourFiveRingAtomIdsResult) {
    return compactSharedPathFourFiveRingAtomIdsResult;
  }

  if (rings.length !== 4) {
    return fallbackAtomIds;
  }
  const ringIds = rings.map(ring => ring.id);
  const ringIdSet = new Set(ringIds);
  const owningRingSystem = (layoutGraph.ringSystems ?? []).find(ringSystem => {
    const systemRingIds = ringSystem.ringIds ?? [];
    if (systemRingIds.length !== ringIds.length) {
      return false;
    }
    return systemRingIds.every(ringId => ringIdSet.has(ringId));
  });
  if (!owningRingSystem || !Array.isArray(owningRingSystem.atomIds)) {
    return fallbackAtomIds;
  }

  const fallbackAtomIdSet = new Set(fallbackAtomIds);
  if (owningRingSystem.atomIds.length !== fallbackAtomIds.length || !owningRingSystem.atomIds.every(atomId => fallbackAtomIdSet.has(atomId))) {
    return fallbackAtomIds;
  }
  if (shouldKeepFallbackOrderForNitrogenRichBridgedFusedSystem(layoutGraph, rings, fallbackAtomIds)) {
    return fallbackAtomIds;
  }
  return [...owningRingSystem.atomIds];
}

function shouldKeepFallbackOrderForNitrogenRichBridgedFusedSystem(layoutGraph, rings, fallbackAtomIds) {
  if (rings.length !== 4 || fallbackAtomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || containsMetalAtom(layoutGraph, fallbackAtomIds)) {
    return false;
  }
  const ringIds = new Set(rings.map(ring => ring.id));
  const bridgedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'bridged' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)
  ).length;
  const fusedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'fused' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)
  ).length;
  if (bridgedConnectionCount < 1 || fusedConnectionCount < 1) {
    return false;
  }
  let nitrogenCount = 0;
  for (const atomId of fallbackAtomIds) {
    if (layoutGraph.atoms.get(atomId)?.element === 'N') {
      nitrogenCount++;
    }
  }
  return nitrogenCount >= 3;
}

function rotateRingAtomIdsStartingWith(ring, firstAtomId, secondAtomId) {
  const firstIndex = ring.atomIds.indexOf(firstAtomId);
  if (firstIndex < 0) {
    return null;
  }
  const ringSize = ring.atomIds.length;

  for (const direction of [1, -1]) {
    const nextIndex = (firstIndex + direction + ringSize) % ringSize;
    if (ring.atomIds[nextIndex] !== secondAtomId) {
      continue;
    }
    return Array.from({ length: ringSize }, (_, index) => {
      const ringIndex = (firstIndex + direction * index + ringSize) % ringSize;
      return ring.atomIds[ringIndex];
    });
  }

  return null;
}

function atomIdsAreBonded(layoutGraph, firstAtomId, secondAtomId) {
  const pairKey = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
  return layoutGraph.bondedPairSet.has(pairKey);
}

function aromaticCappedFiveFiveFourBridgedOrder(layoutGraph, rings) {
  if (rings.length !== 3) {
    return null;
  }
  const aromaticRing = rings.find(ring => ring.aromatic && ring.atomIds.length === 5);
  const bridgedFiveRing = rings.find(ring => !ring.aromatic && ring.atomIds.length === 5);
  const fourRing = rings.find(ring => !ring.aromatic && ring.atomIds.length === 4);
  if (!aromaticRing || !bridgedFiveRing || !fourRing) {
    return null;
  }

  const fusedAtomIds = sharedRingAtomIds(aromaticRing, bridgedFiveRing);
  const bridgePathAtomIds = sharedRingAtomIds(bridgedFiveRing, fourRing);
  if (
    fusedAtomIds.length !== 2 ||
    bridgePathAtomIds.length !== 3 ||
    !atomIdsAreAdjacentInRing(aromaticRing, fusedAtomIds[0], fusedAtomIds[1]) ||
    !atomIdsAreAdjacentInRing(bridgedFiveRing, fusedAtomIds[0], fusedAtomIds[1])
  ) {
    return null;
  }

  const bridgePathAtomIdSet = new Set(bridgePathAtomIds);
  const fusedAtomIdSet = new Set(fusedAtomIds);
  const smallRingUniqueAtomId = fourRing.atomIds.find(atomId => !bridgePathAtomIdSet.has(atomId));
  if (!smallRingUniqueAtomId) {
    return null;
  }

  for (const firstAtomId of bridgePathAtomIds) {
    for (const secondAtomId of bridgePathAtomIds) {
      if (secondAtomId === firstAtomId) {
        continue;
      }
      const orderedFiveRing = rotateRingAtomIdsStartingWith(bridgedFiveRing, firstAtomId, secondAtomId);
      if (!orderedFiveRing || !orderedFiveRing.slice(0, 3).every(atomId => bridgePathAtomIdSet.has(atomId)) || !orderedFiveRing.slice(3, 5).every(atomId => fusedAtomIdSet.has(atomId))) {
        continue;
      }

      const [bridgeStartAtomId, bridgeMiddleAtomId, bridgeEndAtomId, fusedRightAtomId, fusedLeftAtomId] = orderedFiveRing;
      if (!atomIdsAreBonded(layoutGraph, smallRingUniqueAtomId, bridgeStartAtomId) || !atomIdsAreBonded(layoutGraph, smallRingUniqueAtomId, bridgeEndAtomId)) {
        continue;
      }
      const aromaticRingOrder = rotateRingAtomIdsStartingWith(aromaticRing, fusedRightAtomId, fusedLeftAtomId);
      if (!aromaticRingOrder) {
        continue;
      }

      return {
        fusedLeftAtomId,
        fusedRightAtomId,
        aromaticTailAtomIds: aromaticRingOrder.slice(2),
        bridgeStartAtomId,
        bridgeMiddleAtomId,
        bridgeEndAtomId,
        smallRingUniqueAtomId
      };
    }
  }

  return null;
}

function regularPolygonVertexCoords(vertexCount, bondLength, mirrored = false) {
  const radius = bondLength / (2 * Math.sin(Math.PI / vertexCount));
  return Array.from({ length: vertexCount }, (_, index) => ({
    x: Math.cos((2 * Math.PI * index) / vertexCount) * radius,
    y: Math.sin((2 * Math.PI * index) / vertexCount) * radius * (mirrored ? -1 : 1)
  }));
}

function transformPolygonEdgeToCoords(points, firstIndex, secondIndex, firstTarget, secondTarget) {
  const firstPoint = points[firstIndex];
  const secondPoint = points[secondIndex];
  const sourceVector = sub(secondPoint, firstPoint);
  const targetVector = sub(secondTarget, firstTarget);
  const sourceLength = Math.hypot(sourceVector.x, sourceVector.y);
  const targetLength = Math.hypot(targetVector.x, targetVector.y);
  if (sourceLength <= 1e-9 || targetLength <= 1e-9) {
    return null;
  }
  const scale = targetLength / sourceLength;
  const rotation = angleOf(targetVector) - angleOf(sourceVector);
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  return points.map(point => {
    const localX = (point.x - firstPoint.x) * scale;
    const localY = (point.y - firstPoint.y) * scale;
    return {
      x: firstTarget.x + localX * cosRotation - localY * sinRotation,
      y: firstTarget.y + localX * sinRotation + localY * cosRotation
    };
  });
}

function edgeSideTowardPoint(firstPoint, secondPoint, point) {
  const edge = sub(secondPoint, firstPoint);
  const midpoint = {
    x: (firstPoint.x + secondPoint.x) / 2,
    y: (firstPoint.y + secondPoint.y) / 2
  };
  const normal = { x: -edge.y, y: edge.x };
  const side = (point.x - midpoint.x) * normal.x + (point.y - midpoint.y) * normal.y;
  return side >= 0 ? 1 : -1;
}

function placeRegularRingOnEdge(coords, ringAtomIds, firstEdgeAtomId, secondEdgeAtomId, side, bondLength) {
  const firstIndex = ringAtomIds.indexOf(firstEdgeAtomId);
  const secondIndex = ringAtomIds.indexOf(secondEdgeAtomId);
  if (firstIndex < 0 || secondIndex < 0 || !coords.has(firstEdgeAtomId) || !coords.has(secondEdgeAtomId)) {
    return null;
  }

  const firstTarget = coords.get(firstEdgeAtomId);
  const secondTarget = coords.get(secondEdgeAtomId);
  const edge = sub(secondTarget, firstTarget);
  const midpoint = {
    x: (firstTarget.x + secondTarget.x) / 2,
    y: (firstTarget.y + secondTarget.y) / 2
  };
  const normal = { x: -edge.y, y: edge.x };
  const candidates = [];
  for (const mirrored of [false, true]) {
    const points = regularPolygonVertexCoords(ringAtomIds.length, bondLength, mirrored);
    for (const [sourceFirstIndex, sourceSecondIndex, targetFirstPoint, targetSecondPoint] of [
      [firstIndex, secondIndex, firstTarget, secondTarget],
      [secondIndex, firstIndex, secondTarget, firstTarget]
    ]) {
      const transformed = transformPolygonEdgeToCoords(points, sourceFirstIndex, sourceSecondIndex, targetFirstPoint, targetSecondPoint);
      if (transformed) {
        candidates.push(transformed);
      }
    }
  }

  let bestCandidate = null;
  let bestScore = -Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const candidateCenter = centroid(ringAtomIds.map((atomId, index) => candidate[index]));
    const score = side * ((candidateCenter.x - midpoint.x) * normal.x + (candidateCenter.y - midpoint.y) * normal.y);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }
  if (!bestCandidate) {
    return null;
  }

  const nextCoords = cloneCoords(coords);
  for (let index = 0; index < ringAtomIds.length; index++) {
    nextCoords.set(ringAtomIds[index], bestCandidate[index]);
  }
  return nextCoords;
}

function circularBridgeLaneTargets(firstPoint, secondPoint, internalAtomCount, side, segmentLength) {
  const chord = sub(secondPoint, firstPoint);
  const chordLength = Math.hypot(chord.x, chord.y);
  const segmentCount = internalAtomCount + 1;
  if (chordLength <= 1e-9 || segmentCount <= 1 || chordLength >= segmentCount * segmentLength - 1e-9) {
    return null;
  }

  let lowTheta = 1e-6;
  let highTheta = 2 * Math.PI - 1e-6;
  const targetRatio = chordLength / segmentLength;
  for (let iteration = 0; iteration < 64; iteration++) {
    const midTheta = (lowTheta + highTheta) / 2;
    const ratio = Math.sin(midTheta / 2) / Math.sin(midTheta / (2 * segmentCount));
    if (ratio > targetRatio) {
      lowTheta = midTheta;
    } else {
      highTheta = midTheta;
    }
  }

  const theta = (lowTheta + highTheta) / 2;
  const radius = chordLength / (2 * Math.sin(theta / 2));
  const centerOffset = chordLength / (2 * Math.tan(theta / 2));
  const unitChord = {
    x: chord.x / chordLength,
    y: chord.y / chordLength
  };
  const unitNormal = {
    x: -unitChord.y,
    y: unitChord.x
  };
  const midpoint = {
    x: (firstPoint.x + secondPoint.x) / 2,
    y: (firstPoint.y + secondPoint.y) / 2
  };
  const center = {
    x: midpoint.x + unitNormal.x * side * centerOffset,
    y: midpoint.y + unitNormal.y * side * centerOffset
  };
  const startAngle = angleOf(sub(firstPoint, center));
  const endAngle = angleOf(sub(secondPoint, center));
  const sweep = side > 0 ? (endAngle - startAngle + 2 * Math.PI) % (2 * Math.PI) : -((startAngle - endAngle + 2 * Math.PI) % (2 * Math.PI));

  return Array.from({ length: internalAtomCount }, (_, index) => {
    const angle = startAngle + sweep * ((index + 1) / segmentCount);
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
    };
  });
}

function cyclicRingPathAvoidingInternalAtoms(ring, firstAtomId, secondAtomId, blockedInternalAtomIds) {
  const firstIndex = ring.atomIds.indexOf(firstAtomId);
  const secondIndex = ring.atomIds.indexOf(secondAtomId);
  if (firstIndex < 0 || secondIndex < 0) {
    return null;
  }

  for (const direction of [1, -1]) {
    const path = [firstAtomId];
    let index = firstIndex;
    for (let step = 0; step < ring.atomIds.length; step++) {
      index = (index + direction + ring.atomIds.length) % ring.atomIds.length;
      path.push(ring.atomIds[index]);
      if (index === secondIndex) {
        break;
      }
    }
    if (path[path.length - 1] === secondAtomId && path.slice(1, -1).every(atomId => !blockedInternalAtomIds.has(atomId))) {
      return path;
    }
  }
  return null;
}

function ringOrderVariants(ring) {
  const variants = [];
  for (let startIndex = 0; startIndex < ring.atomIds.length; startIndex++) {
    for (const direction of [1, -1]) {
      variants.push(
        Array.from({ length: ring.atomIds.length }, (_, offset) => {
          const index = (startIndex + direction * offset + ring.atomIds.length) % ring.atomIds.length;
          return ring.atomIds[index];
        })
      );
    }
  }
  return variants;
}

function aromaticCappedFusedSquareBridgeOrder(layoutGraph, rings, atomIds) {
  if (rings.length !== 4 || atomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || containsMetalAtom(layoutGraph, atomIds)) {
    return null;
  }
  const aromaticRing = rings.find(ring => ring.aromatic && ring.atomIds.length === 5);
  const squareRing = rings.find(ring => !ring.aromatic && ring.atomIds.length === 4);
  const sixRing = rings.find(ring => !ring.aromatic && ring.atomIds.length === 6);
  const sevenRing = rings.find(ring => !ring.aromatic && ring.atomIds.length === 7);
  if (!aromaticRing || !squareRing || !sixRing || !sevenRing) {
    return null;
  }

  const bridgeSharedAtomIds = sharedRingAtomIds(sixRing, sevenRing);
  const aromaticEdgeAtomIds = sharedRingAtomIds(sixRing, aromaticRing);
  const squareEdgeAtomIds = sharedRingAtomIds(sixRing, squareRing);
  if (
    bridgeSharedAtomIds.length !== 4 ||
    aromaticEdgeAtomIds.length !== 2 ||
    squareEdgeAtomIds.length !== 2 ||
    !aromaticEdgeAtomIds.every(atomId => bridgeSharedAtomIds.includes(atomId)) ||
    !atomIdsAreAdjacentInRing(sixRing, aromaticEdgeAtomIds[0], aromaticEdgeAtomIds[1]) ||
    !atomIdsAreAdjacentInRing(aromaticRing, aromaticEdgeAtomIds[0], aromaticEdgeAtomIds[1]) ||
    !atomIdsAreAdjacentInRing(sixRing, squareEdgeAtomIds[0], squareEdgeAtomIds[1]) ||
    !atomIdsAreAdjacentInRing(squareRing, squareEdgeAtomIds[0], squareEdgeAtomIds[1])
  ) {
    return null;
  }

  const bridgeEndpointAtomIds = bridgeSharedAtomIds.filter(atomId => !aromaticEdgeAtomIds.includes(atomId));
  if (bridgeEndpointAtomIds.length !== 2) {
    return null;
  }
  const bridgeSharedAtomIdSet = new Set(bridgeSharedAtomIds);

  for (const baseRingAtomIds of ringOrderVariants(sixRing)) {
    if (
      !bridgeEndpointAtomIds.includes(baseRingAtomIds[0]) ||
      !bridgeEndpointAtomIds.includes(baseRingAtomIds[3]) ||
      !baseRingAtomIds.slice(1, 3).every(atomId => aromaticEdgeAtomIds.includes(atomId)) ||
      !baseRingAtomIds.slice(4, 6).every(atomId => squareEdgeAtomIds.includes(atomId))
    ) {
      continue;
    }
    const outerBridgePathAtomIds = cyclicRingPathAvoidingInternalAtoms(sevenRing, baseRingAtomIds[3], baseRingAtomIds[0], bridgeSharedAtomIdSet);
    if (!outerBridgePathAtomIds || outerBridgePathAtomIds.length !== 5) {
      continue;
    }
    return {
      baseRingAtomIds,
      aromaticRingAtomIds: aromaticRing.atomIds,
      squareRingAtomIds: squareRing.atomIds,
      aromaticEdgeAtomIds: [baseRingAtomIds[2], baseRingAtomIds[1]],
      squareEdgeAtomIds: [baseRingAtomIds[4], baseRingAtomIds[5]],
      outerBridgePathAtomIds
    };
  }
  return null;
}

function buildAromaticCappedFusedSquareBridgeCoords(layoutGraph, rings, atomIds, bondLength) {
  const order = aromaticCappedFusedSquareBridgeOrder(layoutGraph, rings, atomIds);
  if (!order) {
    return null;
  }

  const baseRingCoords = regularPolygonVertexCoords(order.baseRingAtomIds.length, bondLength);
  const baseCoords = new Map();
  for (let index = 0; index < order.baseRingAtomIds.length; index++) {
    baseCoords.set(order.baseRingAtomIds[index], baseRingCoords[index]);
  }
  const baseCenter = centroid(order.baseRingAtomIds.map(atomId => baseCoords.get(atomId)));
  const aromaticSide = -edgeSideTowardPoint(baseCoords.get(order.aromaticEdgeAtomIds[0]), baseCoords.get(order.aromaticEdgeAtomIds[1]), baseCenter);
  const squareSide = -edgeSideTowardPoint(baseCoords.get(order.squareEdgeAtomIds[0]), baseCoords.get(order.squareEdgeAtomIds[1]), baseCenter);

  const aromaticCoords = placeRegularRingOnEdge(baseCoords, order.aromaticRingAtomIds, order.aromaticEdgeAtomIds[0], order.aromaticEdgeAtomIds[1], aromaticSide, bondLength);
  if (!aromaticCoords) {
    return null;
  }
  const fusedCoords = placeRegularRingOnEdge(aromaticCoords, order.squareRingAtomIds, order.squareEdgeAtomIds[0], order.squareEdgeAtomIds[1], squareSide, bondLength);
  if (!fusedCoords) {
    return null;
  }

  let bestCoords = null;
  let bestAudit = null;
  const [firstBridgeAtomId, ...bridgeTailAtomIds] = order.outerBridgePathAtomIds;
  const secondBridgeAtomId = bridgeTailAtomIds[bridgeTailAtomIds.length - 1];
  const internalBridgeAtomIds = bridgeTailAtomIds.slice(0, -1);
  for (const stretchFactor of AROMATIC_CAPPED_FUSED_SQUARE_BRIDGE_STRETCH_FACTORS) {
    for (const side of [-1, 1]) {
      const targets = circularBridgeLaneTargets(fusedCoords.get(firstBridgeAtomId), fusedCoords.get(secondBridgeAtomId), internalBridgeAtomIds.length, side, bondLength * stretchFactor);
      if (!targets) {
        continue;
      }
      const candidateCoords = cloneCoords(fusedCoords);
      for (let index = 0; index < internalBridgeAtomIds.length; index++) {
        candidateCoords.set(internalBridgeAtomIds[index], targets[index]);
      }
      const audit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
      if (audit?.ok === true) {
        return candidateCoords;
      }
      if (compareBridgedProjectionAudits(audit, bestAudit) < 0) {
        bestCoords = candidateCoords;
        bestAudit = audit;
      }
    }
  }

  return bestAudit?.ok === true ? bestCoords : null;
}

/**
 * Constructs exact normalized coordinates for aromatic-capped 5-5-4 bridged
 * systems where a square four-ring shares two adjacent bridge edges with a
 * fused five-ring. KK/projection tends to pinch the heteroatom lane in this
 * topology, while the graph has a direct unit-bond solution.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object[]} rings - Rings being placed as one bridged component.
 * @param {string[]} atomIds - Atom IDs included in the bridged placement.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>|null} Constructed coordinates, or `null`.
 */
function buildAromaticCappedFiveFiveFourBridgedCoords(layoutGraph, rings, atomIds, bondLength) {
  if (atomIds.length > BRIDGED_KK_LIMITS.fastAtomLimit || containsMetalAtom(layoutGraph, atomIds)) {
    return null;
  }
  const order = aromaticCappedFiveFiveFourBridgedOrder(layoutGraph, rings);
  if (!order) {
    return null;
  }
  const [firstAromaticTailAtomId, secondAromaticTailAtomId, thirdAromaticTailAtomId] = order.aromaticTailAtomIds;
  if (!firstAromaticTailAtomId || !secondAromaticTailAtomId || !thirdAromaticTailAtomId) {
    return null;
  }

  const normalizedCoords = new Map([
    [order.fusedLeftAtomId, { x: 0, y: 0 }],
    [order.fusedRightAtomId, { x: 1, y: 0 }],
    [firstAromaticTailAtomId, { x: -0.30901699437494745, y: -0.9510565162951535 }],
    [secondAromaticTailAtomId, { x: 0.5, y: -1.5388417685876268 }],
    [thirdAromaticTailAtomId, { x: 1.3090169943749475, y: -0.9510565162951536 }],
    [order.bridgeStartAtomId, { x: -0.20791169081775912, y: 0.9781476007338057 }],
    [order.bridgeMiddleAtomId, { x: 0.5, y: 1.6844485550043924 }],
    [order.bridgeEndAtomId, { x: 1.2079116908177594, y: 0.9781476007338056 }],
    [order.smallRingUniqueAtomId, { x: 0.5, y: 0.2718466464632191 }]
  ]);
  if (normalizedCoords.size !== atomIds.length || atomIds.some(atomId => !normalizedCoords.has(atomId))) {
    return null;
  }

  const center = centroid([...normalizedCoords.values()]);
  const coords = new Map();
  for (const [atomId, position] of normalizedCoords) {
    coords.set(atomId, {
      x: (position.x - center.x) * bondLength,
      y: (position.y - center.y) * bondLength
    });
  }
  const audit = auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength);
  return audit?.ok === true ? coords : null;
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
  const atomIds = bridgedPlacementAtomIds(options.layoutGraph, rings, options.templateId ?? null);
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

  const constructedCoords = buildAromaticCappedFiveFiveFourBridgedCoords(options.layoutGraph, rings, atomIds, bondLength);
  if (constructedCoords) {
    const ringCenters = new Map();
    for (const ring of rings) {
      ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => constructedCoords.get(atomId))));
    }
    return {
      coords: constructedCoords,
      ringCenters,
      placementMode: 'constructed-aromatic-capped-5-5-4'
    };
  }

  const fusedSquareBridgeCoords = buildAromaticCappedFusedSquareBridgeCoords(options.layoutGraph, rings, atomIds, bondLength);
  if (fusedSquareBridgeCoords) {
    const ringCenters = new Map();
    for (const ring of rings) {
      ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => fusedSquareBridgeCoords.get(atomId))));
    }
    return {
      coords: fusedSquareBridgeCoords,
      ringCenters,
      placementMode: 'constructed-aromatic-capped-fused-square-bridge'
    };
  }

  const kkSeeds = bridgedKamadaKawaiSeeds(options.layoutGraph, atomIds);
  if (shouldShortCircuitLargeProjection(atomIds, kkSeeds.pinnedAtomIds)) {
    const selectedCoords = projectBridgePaths(options.layoutGraph, atomIds, buildProjectionSeedCoords(options.layoutGraph, atomIds, kkSeeds.coords, bondLength), bondLength).coords;
    const projectedAudit = auditBridgedPlacementCandidate(options.layoutGraph, atomIds, selectedCoords, bondLength);
    if (acceptsLargeProjectionAudit(projectedAudit) || atomIds.length > BRIDGED_KK_LIMITS.mediumAtomLimit + 20) {
      const ringCenters = new Map();
      for (const ring of rings) {
        ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => selectedCoords.get(atomId))));
      }
      return {
        coords: selectedCoords,
        ringCenters,
        placementMode: 'constructed-bridged'
      };
    }
  }
  if (shouldTryProjectionFirst(atomIds, kkSeeds.pinnedAtomIds)) {
    kkSeeds.coords = projectBridgePaths(options.layoutGraph, atomIds, buildProjectionSeedCoords(options.layoutGraph, atomIds, kkSeeds.coords, bondLength), bondLength).coords;
  }
  const useTightBridgeLaneSeed = isAromaticFusedBridgeLaneFirstBridgedSystem(options.layoutGraph, rings, atomIds);
  let kkResult = layoutKamadaKawai(options.layoutGraph.sourceMolecule, atomIds, {
    bondLength,
    coords: kkSeeds.coords,
    pinnedAtomIds: kkSeeds.pinnedAtomIds,
    ...(useTightBridgeLaneSeed
      ? compactBridgedKamadaKawaiOptions(atomIds)
      : shouldTryProjectionFirst(atomIds, kkSeeds.pinnedAtomIds)
        ? bridgedProjectionSeededKamadaKawaiOptions(atomIds)
        : bridgedKamadaKawaiOptions(atomIds))
  });
  if (hasCompactBridgedNonbondedCollapse(options.layoutGraph, atomIds, kkResult.coords, bondLength)) {
    kkResult = layoutKamadaKawai(options.layoutGraph.sourceMolecule, atomIds, {
      bondLength,
      coords: kkSeeds.coords,
      pinnedAtomIds: kkSeeds.pinnedAtomIds,
      ...compactBridgedKamadaKawaiOptions(atomIds)
    });
  }
  if (kkResult.coords.size === 0) {
    return null;
  }

  const projected = projectBridgePaths(options.layoutGraph, atomIds, kkResult.coords, bondLength);
  let selectedCoords = selectBridgedProjectionCoords(options.layoutGraph, atomIds, kkResult.coords, projected, bondLength);
  let selectedAudit = auditBridgedPlacementCandidate(options.layoutGraph, atomIds, selectedCoords, bondLength);
  if (shouldRefineStrainedCompactBridgedSeed(options.layoutGraph, atomIds, selectedAudit)) {
    const refinedKkResult = layoutKamadaKawai(options.layoutGraph.sourceMolecule, atomIds, {
      bondLength,
      coords: kkSeeds.coords,
      pinnedAtomIds: kkSeeds.pinnedAtomIds,
      ...strainedCompactBridgedKamadaKawaiOptions(atomIds)
    });
    const refinedProjected = projectBridgePaths(options.layoutGraph, atomIds, refinedKkResult.coords, bondLength);
    const refinedSelectedCoords = selectBridgedProjectionCoords(options.layoutGraph, atomIds, refinedKkResult.coords, refinedProjected, bondLength);
    const refinedAudit = auditBridgedPlacementCandidate(options.layoutGraph, atomIds, refinedSelectedCoords, bondLength);
    if (compareBridgedProjectionAudits(refinedAudit, selectedAudit) < 0) {
      selectedCoords = refinedSelectedCoords;
      selectedAudit = refinedAudit;
    }
  }
  if (shouldTryStrictCompactBridgedBondRescue(options.layoutGraph, rings, atomIds, selectedAudit)) {
    const compactKkResult = layoutKamadaKawai(options.layoutGraph.sourceMolecule, atomIds, {
      bondLength,
      coords: kkSeeds.coords,
      pinnedAtomIds: kkSeeds.pinnedAtomIds,
      ...compactBridgedKamadaKawaiOptions(atomIds)
    });
    const compactProjected = projectBridgePaths(options.layoutGraph, atomIds, compactKkResult.coords, bondLength);
    const compactSelectedCoords = selectBridgedProjectionCoords(options.layoutGraph, atomIds, compactKkResult.coords, compactProjected, bondLength);
    const compactAudit = auditBridgedPlacementCandidate(options.layoutGraph, atomIds, compactSelectedCoords, bondLength);
    if (compareBridgedProjectionAudits(compactAudit, selectedAudit) < 0) {
      selectedCoords = compactSelectedCoords;
      selectedAudit = compactAudit;
    }
  }
  selectedCoords = regularizeBridgedRingSystemGeometry(options.layoutGraph, rings, atomIds, selectedCoords, bondLength);

  const ringCenters = new Map();
  for (const ring of rings) {
    ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => selectedCoords.get(atomId))));
  }
  return {
    coords: selectedCoords,
    ringCenters,
    placementMode: 'projected-kamada-kawai'
  };
}
