/** @module families/bridged */

import { BRIDGED_KK_LIMITS } from '../constants.js';
import { cloneCoords } from '../geometry/transforms.js';
import { auditLayout } from '../audit/audit.js';
import { circumradiusForRegularPolygon } from '../geometry/polygon.js';
import { add, angleOf, angularDifference, centroid, fromAngle, rotate, sub } from '../geometry/vec2.js';
import { layoutKamadaKawai } from '../geometry/kk-layout.js';
import { orientBridgedSeed, projectBridgePaths } from './bridge-projection.js';
import { assignBondValidationClass } from '../placement/bond-validation.js';
import { placeRemainingBranches } from '../placement/branch-placement.js';
import { placeTemplateCoords } from '../templates/placement.js';
import { isMetalAtom } from '../topology/metal-centers.js';

const COMPACT_BRIDGED_KK_THRESHOLD = 0.02;
const COMPACT_BRIDGED_NONBONDED_COLLAPSE_FACTOR = 0.8;
const STRAINED_COMPACT_BRIDGED_KK_THRESHOLD = 0.1;
const STRAINED_COMPACT_BRIDGED_MAX_DEVIATION = 0.35;
const AROMATIC_BRIDGED_REGULARIZATION_BLEND_FACTORS = Object.freeze([
  1,
  0.95,
  0.9,
  0.85,
  0.8,
  0.75,
  0.7,
  0.65,
  0.6,
  0.55,
  0.5,
  0.45,
  0.4,
  0.35,
  0.3,
  0.25,
  0.2,
  0.15,
  0.1,
  0.05
]);
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
const SPIRO_JUNCTION_RING_SPREAD_MIN_CROSS_ANGLE = Math.PI / 3;
const SPIRO_JUNCTION_RING_SPREAD_OFFSETS = Object.freeze(
  Array.from({ length: 72 }, (_, index) => ((index + 1) * 5 * Math.PI) / 180)
    .flatMap(angle => [angle, -angle])
);
const SPIRO_JUNCTION_RING_SPREAD_EPSILON = 1e-6;

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
  return Boolean(
    audit
    && (audit.severeOverlapCount ?? 0) <= 5
    && (audit.bondLengthFailureCount ?? 0) <= 25
    && (audit.maxBondLengthDeviation ?? Number.POSITIVE_INFINITY) < 1.0
  );
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
 * @returns {object|null} Audit summary, or `null` when inputs are incomplete.
 */
function auditBridgedPlacementCandidate(layoutGraph, atomIds, coords, bondLength) {
  if (!layoutGraph || !(coords instanceof Map) || coords.size !== atomIds.length) {
    return null;
  }
  return auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: assignBondValidationClass(layoutGraph, atomIds, 'bridged')
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
  return (
    audit
    && audit.minSevereOverlapDistance != null
    && audit.minSevereOverlapDistance < bondLength * 0.1
  );
}

function shouldRefineStrainedCompactBridgedSeed(layoutGraph, atomIds, audit) {
  return (
    atomIds.length <= BRIDGED_KK_LIMITS.fastAtomLimit
    && !containsMetalAtom(layoutGraph, atomIds)
    && (audit?.maxBondLengthDeviation ?? 0) > STRAINED_COMPACT_BRIDGED_MAX_DEVIATION
  );
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
      const angleDeviation = Math.abs(
        angularDifference(
          angleOf(sub(previousPosition, atomPosition)),
          angleOf(sub(nextPosition, atomPosition))
        ) - targetAngle
      );
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
  if (!layoutGraph || !ring.aromatic || ring.atomIds.length < 5) {
    return null;
  }

  const step = (2 * Math.PI) / ring.atomIds.length;
  let bestTargets = null;
  let bestError = Number.POSITIVE_INFINITY;

  for (let index = 0; index < ring.atomIds.length; index++) {
    const firstAtomId = ring.atomIds[index];
    const secondAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
    if (
      (layoutGraph.atomToRings.get(firstAtomId)?.length ?? 0) <= 1
      || (layoutGraph.atomToRings.get(secondAtomId)?.length ?? 0) <= 1
    ) {
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
  return (
    ring.atomIds[(firstIndex + 1) % ring.atomIds.length] === secondAtomId
    || ring.atomIds[(firstIndex - 1 + ring.atomIds.length) % ring.atomIds.length] === secondAtomId
  );
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
    .filter(neighborAtomId =>
      componentAtomIdSet.has(neighborAtomId)
      && layoutGraph.atoms.get(neighborAtomId)?.element !== 'H'
    );
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
    if (
      !anchorAtom
      || anchorAtom.element === 'H'
      || anchorAtom.heavyDegree < 4
      || anchorRings.length < 2
      || layoutGraph.fixedCoords.has(anchorAtomId)
    ) {
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
        const candidateCoords = rotateSpiroJunctionGroup(
          coords,
          anchorAtomId,
          groups[groupIndex].atomIds,
          rotationAngle
        );
        if (!candidateCoords) {
          continue;
        }
        const candidateScore = scoreSpiroJunctionRingSpread(layoutGraph, candidateCoords, anchorAtomId, groups);
        if (!candidateScore || candidateScore.minCrossSeparation <= baseScore.minCrossSeparation + SPIRO_JUNCTION_RING_SPREAD_EPSILON) {
          continue;
        }
        const candidateAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, candidateCoords, bondLength);
        if (
          candidateAudit.bondLengthFailureCount > baseAudit.bondLengthFailureCount
          || candidateAudit.maxBondLengthDeviation > baseAudit.maxBondLengthDeviation + SPIRO_JUNCTION_RING_SPREAD_EPSILON
        ) {
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
  return (
    (secondPosition.x - firstPosition.x) * (point.y - firstPosition.y)
    - (secondPosition.y - firstPosition.y) * (point.x - firstPosition.x)
  );
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

function fusedAromaticCyclohexanePairs(rings) {
  const pairs = [];
  for (const aromaticRing of rings) {
    if (!aromaticRing.aromatic || aromaticRing.atomIds.length !== 6) {
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
      if (
        !atomIdsAreAdjacentInRing(aromaticRing, sharedAtomIds[0], sharedAtomIds[1])
        || !atomIdsAreAdjacentInRing(cyclohexaneRing, sharedAtomIds[0], sharedAtomIds[1])
      ) {
        continue;
      }
      pairs.push({ aromaticRing, cyclohexaneRing, sharedAtomIds });
    }
  }
  return pairs;
}

function exactFusedHexagonPairTargetCandidates(pair, coords, bondLength) {
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
    x: midpoint.x - unitEdge.x * bondLength / 2,
    y: midpoint.y - unitEdge.y * bondLength / 2
  };
  const exactSecondPosition = {
    x: midpoint.x + unitEdge.x * bondLength / 2,
    y: midpoint.y + unitEdge.y * bondLength / 2
  };
  const aromaticCandidates = regularRingTargetCandidatesForFixedEdge(
    pair.aromaticRing,
    coords,
    firstAtomId,
    secondAtomId,
    exactFirstPosition,
    exactSecondPosition
  );
  const cyclohexaneCandidates = regularRingTargetCandidatesForFixedEdge(
    pair.cyclohexaneRing,
    coords,
    firstAtomId,
    secondAtomId,
    exactFirstPosition,
    exactSecondPosition
  );
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
  const internalSharedAtomIds = bridgeRing.atomIds.filter(
    atomId => coreAtomIds.has(atomId) && atomId !== run.startAtomId && atomId !== run.endAtomId
  );
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
  const avoidanceSide = avoidancePoint
    ? Math.sign(pointSideOfEdge(avoidancePoint, startPosition, endPosition))
    : 0;
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
    return Math.hypot(forwardEnd.x - endPosition.x, forwardEnd.y - endPosition.y) <= 1e-6
      ? forwardPoint
      : reversePoint;
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
  const component = layoutGraph.components.find(candidateComponent =>
    atomIds.some(atomId => candidateComponent.atomIds.includes(atomId))
  );
  if (!component) {
    return 0;
  }
  const participantAtomIds = visibleHeavyParticipantAtomIds(layoutGraph, component.atomIds);
  const hasUnplacedBranchAtom = participantAtomIds.some(atomId => !ringAtomIds.has(atomId) && !coords.has(atomId));
  if (!hasUnplacedBranchAtom) {
    return 0;
  }

  const previewCoords = cloneCoords(coords);
  placeRemainingBranches(
    componentAdjacency(layoutGraph, component.atomIds),
    layoutGraph.canonicalAtomRank,
    previewCoords,
    new Set(participantAtomIds),
    atomIds,
    bondLength,
    layoutGraph,
    null,
    0,
    {}
  );

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
      maxBondDeviation = Math.max(
        maxBondDeviation,
        Math.abs(Math.hypot(nextPosition.x - atomPosition.x, nextPosition.y - atomPosition.y) - bondLength)
      );
      maxAngleDeviation = Math.max(
        maxAngleDeviation,
        Math.abs(
          angularDifference(
            angleOf(sub(previousPosition, atomPosition)),
            angleOf(sub(nextPosition, atomPosition))
          ) - (2 * Math.PI) / 3
        )
      );
      sampleCount++;
    }
  }
  const branchSlotBlockers = measureFusedCyclohexaneBranchSlotBlockers(pair, coords, bondLength);
  const branchPreviewPenalty = fusedCyclohexaneBranchPreviewPenalty(layoutGraph, atomIds, coords, bondLength);
  return sampleCount === 0
    ? null
    : maxBondDeviation * 100000 + maxAngleDeviation * 1000 + branchSlotBlockers * 10 + branchPreviewPenalty * 0.01;
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
    const angleDeviation = Math.abs(
      angularDifference(
        angleOf(sub(previousPosition, atomPosition)),
        angleOf(sub(nextPosition, atomPosition))
      ) - targetAngle
    );
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
    shapeScore
    && rings.length > 1
    && atomIds.length <= BRIDGED_KK_LIMITS.fastAtomLimit
    && shapeScore.maxAngleDeviation > SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MIN_ANGLE_DEVIATION
    && !containsMetalAtom(layoutGraph, atomIds)
    && !rings.some(ring => ring.aromatic)
    && saturatedBridgedCyclohexaneCoreRings(rings).length === 0
    && saturatedBridgedRingJunctionAtomIds(layoutGraph, rings).length > 0
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
    shapeScore
    && rings.length > 1
    && atomIds.length <= BRIDGED_KK_LIMITS.fastAtomLimit
    && !containsMetalAtom(layoutGraph, atomIds)
    && !rings.some(ring => ring.aromatic)
    && saturatedBridgedCyclohexaneCoreRings(rings).length === 0
    && saturatedBridgedRingBalanceAtomIds(layoutGraph, rings).length > 0
    && (
      shapeScore.maxAngleDeviation > SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MIN_ANGLE_DEVIATION
      || shapeScore.maxBondDeviation > bondLength * SATURATED_BRIDGED_RING_JUNCTION_BALANCE_MAX_BOND_DEVIATION_FACTOR
    )
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
    (candidateScore, incumbentScore) => (
      candidateScore.maxAngleDeviation <= initialScore.maxAngleDeviation + 1e-9
      && (
        candidateScore.maxBondDeviation < incumbentScore.maxBondDeviation - 1e-9
        || (
          Math.abs(candidateScore.maxBondDeviation - incumbentScore.maxBondDeviation) <= 1e-9
          && candidateScore.totalBondDeviation < incumbentScore.totalBondDeviation - 1e-9
        )
      )
    )
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
    (candidateScore, incumbentScore) => (
      candidateScore.maxBondDeviation <= maxAllowedBondDeviation
      && (
        candidateScore.maxAngleDeviation < incumbentScore.maxAngleDeviation - 1e-9
        || (
          Math.abs(candidateScore.maxAngleDeviation - incumbentScore.maxAngleDeviation) <= 1e-9
          && candidateScore.totalAngleDeviation < incumbentScore.totalAngleDeviation - 1e-9
        )
      )
    )
  );
  if (
    !angleBalanced
    || angleBalanced.score.maxBondDeviation > maxAllowedBondDeviation
    || angleBalanced.score.maxAngleDeviation >= initialScore.maxAngleDeviation - 1e-9
    || angleBalanced.score.totalAngleDeviation >= initialScore.totalAngleDeviation - 1e-9
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
    shapeScore.maxAngleDeviation > SATURATED_BRIDGED_RING_REGULARIZATION_MIN_ANGLE_DEVIATION
    || shapeScore.maxBondDeviation > bondLength * SATURATED_BRIDGED_RING_REGULARIZATION_MIN_BOND_DEVIATION_FACTOR
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
    return rings.some(bridgeRing => (
      bridgeRing !== ring
      && !bridgeRing.aromatic
      && sharedRingAtomIds(ring, bridgeRing).length >= SATURATED_BRIDGED_CYCLOHEXANE_MIN_SHARED_ATOMS
    ));
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
    ringScore.totalScore
    + measureFusedCyclohexaneBranchSlotBlockers({ cyclohexaneRing: coreRing }, coords, bondLength) * 10
    + fusedCyclohexaneBranchPreviewPenalty(layoutGraph, atomIds, coords, bondLength) * 0.01
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
  let bestScore = Math.min(
    ...coreRings
      .map(coreRing => saturatedBridgedCyclohexaneScore(layoutGraph, atomIds, coreRing, coords, bondLength))
      .filter(score => score != null)
  );
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
 * Rebuilds fused aromatic/cyclohexane bridged cores on exact hexagon geometry
 * when a generic bridged placement has strained the publication-style ring
 * shapes.
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
  let bestScore = Math.min(
    ...pairs
      .map(pair => fusedCyclohexaneShapeScore(layoutGraph, atomIds, pair, coords, bondLength))
      .filter(score => score != null)
  );
  if (!bestAudit || !Number.isFinite(bestScore)) {
    return coords;
  }

  for (const pair of pairs) {
    const fusedTargetCandidates = exactFusedHexagonPairTargetCandidates(pair, coords, bondLength);
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
  if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
    return candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation;
  }
  return 0;
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

  const baselineCoords = projected.bridgeheadAtomIds
    ? orientBridgedSeed(kkCoords, projected.bridgeheadAtomIds).coords
    : new Map(kkCoords);
  const baselineAudit = auditBridgedPlacementCandidate(layoutGraph, atomIds, baselineCoords, bondLength);
  if (baselineAudit?.ok === true) {
    return baselineCoords;
  }
  return (
    hasCatastrophicBridgeProjectionCollapse(projectedAudit, bondLength)
    && compareBridgedProjectionAudits(baselineAudit, projectedAudit) < 0
  )
    ? baselineCoords
    : projectedCoords;
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
  if (shouldShortCircuitLargeProjection(atomIds, kkSeeds.pinnedAtomIds)) {
    const selectedCoords = projectBridgePaths(
      options.layoutGraph,
      atomIds,
      buildProjectionSeedCoords(options.layoutGraph, atomIds, kkSeeds.coords, bondLength),
      bondLength
    ).coords;
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
    kkSeeds.coords = projectBridgePaths(
      options.layoutGraph,
      atomIds,
      buildProjectionSeedCoords(options.layoutGraph, atomIds, kkSeeds.coords, bondLength),
      bondLength
    ).coords;
  }
  let kkResult = layoutKamadaKawai(options.layoutGraph.sourceMolecule, atomIds, {
    bondLength,
    coords: kkSeeds.coords,
    pinnedAtomIds: kkSeeds.pinnedAtomIds,
    ...(shouldTryProjectionFirst(atomIds, kkSeeds.pinnedAtomIds)
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
  const selectedAudit = auditBridgedPlacementCandidate(options.layoutGraph, atomIds, selectedCoords, bondLength);
  if (shouldRefineStrainedCompactBridgedSeed(options.layoutGraph, atomIds, selectedAudit)) {
    const refinedKkResult = layoutKamadaKawai(options.layoutGraph.sourceMolecule, atomIds, {
      bondLength,
      coords: kkSeeds.coords,
      pinnedAtomIds: kkSeeds.pinnedAtomIds,
      ...strainedCompactBridgedKamadaKawaiOptions(atomIds)
    });
    const refinedProjected = projectBridgePaths(options.layoutGraph, atomIds, refinedKkResult.coords, bondLength);
    const refinedSelectedCoords = selectBridgedProjectionCoords(
      options.layoutGraph,
      atomIds,
      refinedKkResult.coords,
      refinedProjected,
      bondLength
    );
    const refinedAudit = auditBridgedPlacementCandidate(options.layoutGraph, atomIds, refinedSelectedCoords, bondLength);
  if (compareBridgedProjectionAudits(refinedAudit, selectedAudit) < 0) {
      selectedCoords = refinedSelectedCoords;
    }
  }
  selectedCoords = regularizeSaturatedBridgedCyclohexaneCores(options.layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizeFusedAromaticCyclohexaneCores(options.layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizeSaturatedBridgedRings(options.layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = balanceSaturatedBridgedRingJunctionAngles(options.layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = balanceSaturatedBridgedRingShape(options.layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = regularizeAromaticBridgedRings(options.layoutGraph, rings, atomIds, selectedCoords, bondLength);
  selectedCoords = spreadSpiroJunctionRingBlocks(options.layoutGraph, rings, atomIds, selectedCoords, bondLength);

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
