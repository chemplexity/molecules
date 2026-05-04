/** @module cleanup/presentation/ring-presentation */

import {
  collectAttachedCarbonylPresentationDescriptors
} from './attached-carbonyl.js';
import { auditLayout } from '../../audit/audit.js';
import {
  findSevereOverlaps,
  findVisibleHeavyBondCrossings,
  measureThreeHeavyContinuationDistortion
} from '../../audit/invariants.js';
import { atomPairKey } from '../../constants.js';
import { add, angleOf, angularDifference, distance, rotate, sub } from '../../geometry/vec2.js';
import {
  collectMovableAttachedRingDescriptors,
  measureAttachedRingPeripheralFocusPenalty,
  measureAttachedRingRootOutwardPresentationPenalty,
  runExactAttachedRingRootOutwardRetidy,
  runTerminalCarbonRingLeafRetidy,
  runAttachedRingRotationTouchup
} from './attached-ring-fallback.js';
import {
  measurePhosphateArylTailPresentationPenalty,
  runPhosphateArylTailTidy
} from './phosphate-aryl-tail.js';
import {
  measureTerminalCationRingProximityPenalty,
  runTerminalCationRingClearanceTidy
} from './terminal-cation-ring-clearance.js';
import { runDiarylOmittedHydrogenFanTidy } from './diaryl-omitted-h-fan.js';
import {
  measureRingSubstituentPresentationPenalty,
  measureTerminalRingCarbonylLeafContactPenalty,
  runDirectAttachedRingSystemOutwardRetidy,
  runRingSubstituentTidy
} from './ring-substituent.js';
import {
  measureRingTerminalHeteroOutwardPenalty,
  measureTerminalMultipleBondLeafFanPenalty,
  runRingTerminalHeteroTidy,
  runTerminalMultipleBondLeafFanTidy
} from './ring-terminal-hetero.js';
import { smallRingExteriorTargetAngles } from '../../placement/branch-placement.js';

const PRESENTATION_NEED_EPSILON = 1e-6;
const OMITTED_H_TRIGONAL_PRESENTATION_NEED = (Math.PI / 6) ** 2;
const EXACT_OMITTED_H_TRIGONAL_EPSILON = 1e-9;
const SMALL_RING_EXTERIOR_FAN_EPSILON = 1e-6;
const TERMINAL_MULTIPLE_BOND_LEAF_PRESENTATION_CLEARANCE_FACTOR = 0.6;

function isTerminalMultipleBondLeaf(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.element === 'C' || atom.aromatic || (atom.heavyDegree ?? 0) !== 1) {
    return false;
  }
  return (layoutGraph.bondsByAtomId.get(atomId) ?? []).some(bond => (
    bond
    && bond.kind === 'covalent'
    && !bond.aromatic
    && (bond.order ?? 1) >= 2
  ));
}

function hasTerminalMultipleBondLeafSevereOverlap(layoutGraph, coords, bondLength) {
  return findSevereOverlaps(layoutGraph, coords, bondLength).some(overlap =>
    isTerminalMultipleBondLeaf(layoutGraph, overlap.firstAtomId)
    || isTerminalMultipleBondLeaf(layoutGraph, overlap.secondAtomId)
  );
}

function terminalMultipleBondLeafClearance(layoutGraph, coords, atomId) {
  const position = coords.get(atomId);
  if (!position) {
    return Number.POSITIVE_INFINITY;
  }
  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const [otherAtomId, otherPosition] of coords) {
    if (
      otherAtomId === atomId
      || !isHeavyAtom(layoutGraph, otherAtomId)
      || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))
    ) {
      continue;
    }
    minimumDistance = Math.min(minimumDistance, distance(position, otherPosition));
  }
  return minimumDistance;
}

function hasTerminalMultipleBondLeafPresentationCrowding(layoutGraph, coords, bondLength) {
  const clearanceThreshold = bondLength * TERMINAL_MULTIPLE_BOND_LEAF_PRESENTATION_CLEARANCE_FACTOR;
  for (const atomId of coords.keys()) {
    if (!isTerminalMultipleBondLeaf(layoutGraph, atomId)) {
      continue;
    }
    if (terminalMultipleBondLeafClearance(layoutGraph, coords, atomId) < clearanceThreshold - PRESENTATION_NEED_EPSILON) {
      return true;
    }
  }
  return false;
}

function isHeavyAtom(layoutGraph, atomId) {
  return layoutGraph.atoms.get(atomId)?.element !== 'H';
}

function collectCovalentHeavyNeighborIds(layoutGraph, coords, atomId) {
  return (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === atomId ? bond.b : bond.a))
    .filter(neighborAtomId => coords.has(neighborAtomId) && isHeavyAtom(layoutGraph, neighborAtomId));
}

function isDirectAttachedAromaticRingRoot(layoutGraph, anchorAtomId, rootAtomId) {
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (rootAtom?.aromatic !== true) {
    return false;
  }
  return (layoutGraph.atomToRings.get(rootAtomId) ?? [])
    .some(ring => !(ring.atomIds ?? []).includes(anchorAtomId));
}

function collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, blockedAtomId) {
  const visitedAtomIds = new Set([blockedAtomId]);
  const pendingAtomIds = [rootAtomId];
  const subtreeAtomIds = [];

  while (pendingAtomIds.length > 0) {
    const atomId = pendingAtomIds.pop();
    if (visitedAtomIds.has(atomId)) {
      continue;
    }
    visitedAtomIds.add(atomId);
    subtreeAtomIds.push(atomId);
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (!visitedAtomIds.has(neighborAtomId)) {
        pendingAtomIds.push(neighborAtomId);
      }
    }
  }

  return subtreeAtomIds;
}

function rotateAtomIdsAroundPivot(coords, atomIds, pivotAtomId, rotationAngle) {
  const pivotPosition = coords.get(pivotAtomId);
  if (!pivotPosition) {
    return null;
  }
  const nextCoords = new Map(coords);
  for (const atomId of atomIds) {
    if (atomId === pivotAtomId) {
      continue;
    }
    const position = nextCoords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, add(pivotPosition, rotate(sub(position, pivotPosition), rotationAngle)));
  }
  return nextCoords;
}

function scoreSmallRingExteriorFanAssignment(coords, anchorAtomId, assignment) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const deviations = [];
  for (const { rootAtomId, targetAngle } of assignment) {
    const rootPosition = coords.get(rootAtomId);
    if (!rootPosition) {
      return null;
    }
    deviations.push(angularDifference(angleOf(sub(rootPosition, anchorPosition)), targetAngle));
  }
  return {
    maxDeviation: Math.max(...deviations),
    totalDeviation: deviations.reduce((sum, deviation) => sum + deviation * deviation, 0)
  };
}

function isBetterSmallRingExteriorFanScore(candidateScore, incumbentScore, epsilon = 1e-9) {
  if (!incumbentScore) {
    return true;
  }
  if (candidateScore.maxDeviation < incumbentScore.maxDeviation - epsilon) {
    return true;
  }
  if (candidateScore.maxDeviation > incumbentScore.maxDeviation + epsilon) {
    return false;
  }
  return candidateScore.totalDeviation < incumbentScore.totalDeviation - epsilon;
}

function collectSmallRingExteriorFanDescriptors(layoutGraph, coords) {
  const descriptors = [];
  const seenKeys = new Set();

  for (const anchorAtomId of coords.keys()) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (!anchorAtom || anchorAtom.element === 'H' || anchorAtom.aromatic === true) {
      continue;
    }

    const neighborAtomIds = collectCovalentHeavyNeighborIds(layoutGraph, coords, anchorAtomId);
    if (neighborAtomIds.length !== 4) {
      continue;
    }

    for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
      const ringAtomIds = new Set(ring?.atomIds ?? []);
      if (ringAtomIds.size < 3 || !ringAtomIds.has(anchorAtomId)) {
        continue;
      }

      const ringNeighborIds = neighborAtomIds.filter(neighborAtomId => ringAtomIds.has(neighborAtomId));
      const exocyclicNeighborIds = neighborAtomIds.filter(neighborAtomId => !ringAtomIds.has(neighborAtomId));
      if (ringNeighborIds.length !== 2 || exocyclicNeighborIds.length !== 2) {
        continue;
      }
      if (!exocyclicNeighborIds.every(neighborAtomId => (
        isDirectAttachedAromaticRingRoot(layoutGraph, anchorAtomId, neighborAtomId)
      ))) {
        continue;
      }

      const anchorPosition = coords.get(anchorAtomId);
      const ringNeighborAngles = ringNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
      const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, ringAtomIds.size);
      if (targetAngles.length !== 2) {
        continue;
      }

      const descriptorKey = `${anchorAtomId}:${[...ringAtomIds].sort().join(',')}`;
      if (seenKeys.has(descriptorKey)) {
        continue;
      }
      seenKeys.add(descriptorKey);

      const assignments = [
        [
          { rootAtomId: exocyclicNeighborIds[0], targetAngle: targetAngles[0] },
          { rootAtomId: exocyclicNeighborIds[1], targetAngle: targetAngles[1] }
        ],
        [
          { rootAtomId: exocyclicNeighborIds[0], targetAngle: targetAngles[1] },
          { rootAtomId: exocyclicNeighborIds[1], targetAngle: targetAngles[0] }
        ]
      ];
      const score = assignments
        .map(assignment => scoreSmallRingExteriorFanAssignment(coords, anchorAtomId, assignment))
        .filter(Boolean)
        .reduce((bestScore, candidateScore) => (
          isBetterSmallRingExteriorFanScore(candidateScore, bestScore) ? candidateScore : bestScore
        ), null);
      if (!score) {
        continue;
      }

      descriptors.push({
        anchorAtomId,
        exocyclicNeighborIds,
        assignments,
        maxDeviation: score.maxDeviation,
        totalDeviation: score.totalDeviation
      });
    }
  }

  return descriptors;
}

/**
 * Measures how far paired exterior substituents on saturated small-ring atoms
 * drift from their exact two-slot fan targets.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{maxDeviation: number, totalDeviation: number, descriptorCount: number}} Penalty summary.
 */
export function measureSmallRingExteriorFanExactPenalty(layoutGraph, coords) {
  if (!(coords instanceof Map)) {
    return { maxDeviation: 0, totalDeviation: 0, descriptorCount: 0 };
  }
  const descriptors = collectSmallRingExteriorFanDescriptors(layoutGraph, coords);
  return {
    maxDeviation: descriptors.reduce((maximum, descriptor) => Math.max(maximum, descriptor.maxDeviation), 0),
    totalDeviation: descriptors.reduce((sum, descriptor) => sum + descriptor.totalDeviation, 0),
    descriptorCount: descriptors.length
  };
}

function smallRingExteriorFanCandidateAuditIsAllowed(candidateAudit, incumbentAudit) {
  if (!candidateAudit || !incumbentAudit) {
    return false;
  }
  if (incumbentAudit.ok === true && candidateAudit.ok !== true) {
    return false;
  }
  for (const key of [
    'bondLengthFailureCount',
    'mildBondLengthFailureCount',
    'severeBondLengthFailureCount',
    'collapsedMacrocycleCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount',
    'severeOverlapCount',
    'visibleHeavyBondCrossingCount',
    'labelOverlapCount'
  ]) {
    if ((candidateAudit[key] ?? 0) > (incumbentAudit[key] ?? 0)) {
      return false;
    }
  }
  if ((candidateAudit.stereoContradiction ?? false) && !(incumbentAudit.stereoContradiction ?? false)) {
    return false;
  }
  return candidateAudit.maxBondLengthDeviation <= incumbentAudit.maxBondLengthDeviation + 1e-9;
}

function smallRingExteriorFanAssignmentSubtrees(layoutGraph, coords, anchorAtomId, assignment, frozenAtomIds) {
  const subtreeAtomIdSets = [];
  for (const { rootAtomId } of assignment) {
    const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, anchorAtomId)
      .filter(atomId => coords.has(atomId));
    const subtreeAtomIdSet = new Set(subtreeAtomIds);
    if (
      subtreeAtomIds.length === 0
      || subtreeAtomIdSet.has(anchorAtomId)
      || (frozenAtomIds instanceof Set && subtreeAtomIds.some(atomId => frozenAtomIds.has(atomId)))
    ) {
      return null;
    }
    subtreeAtomIdSets.push(subtreeAtomIdSet);
  }

  for (let firstIndex = 0; firstIndex < subtreeAtomIdSets.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < subtreeAtomIdSets.length; secondIndex += 1) {
      for (const atomId of subtreeAtomIdSets[firstIndex]) {
        if (subtreeAtomIdSets[secondIndex].has(atomId)) {
          return null;
        }
      }
    }
  }

  return subtreeAtomIdSets;
}

function applySmallRingExteriorFanAssignment(layoutGraph, coords, anchorAtomId, assignment, frozenAtomIds) {
  const subtreeAtomIdSets = smallRingExteriorFanAssignmentSubtrees(layoutGraph, coords, anchorAtomId, assignment, frozenAtomIds);
  if (!subtreeAtomIdSets) {
    return null;
  }

  let nextCoords = coords;
  for (let index = 0; index < assignment.length; index += 1) {
    const { rootAtomId, targetAngle } = assignment[index];
    const anchorPosition = nextCoords.get(anchorAtomId);
    const rootPosition = nextCoords.get(rootAtomId);
    if (!anchorPosition || !rootPosition) {
      return null;
    }
    const currentAngle = angleOf(sub(rootPosition, anchorPosition));
    nextCoords = rotateAtomIdsAroundPivot(
      nextCoords,
      [...subtreeAtomIdSets[index]],
      anchorAtomId,
      targetAngle - currentAngle
    );
    if (!nextCoords) {
      return null;
    }
  }
  return nextCoords;
}

function measureSmallRingExteriorAssignmentClearance(layoutGraph, coords, anchorAtomId, assignment) {
  const subtreeAtomIdSets = smallRingExteriorFanAssignmentSubtrees(layoutGraph, coords, anchorAtomId, assignment, null);
  if (!subtreeAtomIdSets || subtreeAtomIdSets.length !== 2) {
    return Number.NEGATIVE_INFINITY;
  }

  let minimumDistance = Number.POSITIVE_INFINITY;
  for (const firstAtomId of subtreeAtomIdSets[0]) {
    if (!isHeavyAtom(layoutGraph, firstAtomId)) {
      continue;
    }
    const firstPosition = coords.get(firstAtomId);
    if (!firstPosition) {
      continue;
    }
    for (const secondAtomId of subtreeAtomIdSets[1]) {
      if (!isHeavyAtom(layoutGraph, secondAtomId)) {
        continue;
      }
      const secondPosition = coords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      minimumDistance = Math.min(
        minimumDistance,
        Math.hypot(firstPosition.x - secondPosition.x, firstPosition.y - secondPosition.y)
      );
    }
  }
  return Number.isFinite(minimumDistance) ? minimumDistance : Number.NEGATIVE_INFINITY;
}

function measureSmallRingExteriorAssignmentRotationPenalty(coords, anchorAtomId, assignment) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return Number.POSITIVE_INFINITY;
  }
  let penalty = 0;
  for (const { rootAtomId, targetAngle } of assignment) {
    const rootPosition = coords.get(rootAtomId);
    if (!rootPosition) {
      return Number.POSITIVE_INFINITY;
    }
    const rotation = angularDifference(angleOf(sub(rootPosition, anchorPosition)), targetAngle);
    penalty += rotation * rotation;
  }
  return penalty;
}

function isBetterSmallRingExteriorFanCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (isBetterSmallRingExteriorFanScore(candidate.penalty, incumbent.penalty, SMALL_RING_EXTERIOR_FAN_EPSILON)) {
    return true;
  }
  if (isBetterSmallRingExteriorFanScore(incumbent.penalty, candidate.penalty, SMALL_RING_EXTERIOR_FAN_EPSILON)) {
    return false;
  }
  if (candidate.rotationPenalty < incumbent.rotationPenalty - 1e-9) {
    return true;
  }
  if (candidate.rotationPenalty > incumbent.rotationPenalty + 1e-9) {
    return false;
  }
  return candidate.siblingClearance > incumbent.siblingClearance + 1e-6;
}

function runSmallRingExteriorFanExactRetidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds ?? null;
  let coords = inputCoords;
  let nudges = 0;

  for (let pass = 0; pass < 3; pass += 1) {
    let acceptedInPass = 0;
    const descriptors = collectSmallRingExteriorFanDescriptors(layoutGraph, coords)
      .filter(descriptor => descriptor.maxDeviation > SMALL_RING_EXTERIOR_FAN_EPSILON)
      .sort((first, second) => second.maxDeviation - first.maxDeviation);

    for (const descriptor of descriptors) {
      const incumbentPenalty = measureSmallRingExteriorFanExactPenalty(layoutGraph, coords);
      const incumbentAudit = auditLayout(layoutGraph, coords, { bondLength });
      let bestCandidate = null;

      for (const assignment of descriptor.assignments) {
        const candidateCoords = applySmallRingExteriorFanAssignment(
          layoutGraph,
          coords,
          descriptor.anchorAtomId,
          assignment,
          frozenAtomIds
        );
        if (!candidateCoords) {
          continue;
        }

        const candidatePenalty = measureSmallRingExteriorFanExactPenalty(layoutGraph, candidateCoords);
        if (!isBetterSmallRingExteriorFanScore(candidatePenalty, incumbentPenalty, SMALL_RING_EXTERIOR_FAN_EPSILON)) {
          continue;
        }

        const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
        if (!smallRingExteriorFanCandidateAuditIsAllowed(candidateAudit, incumbentAudit)) {
          continue;
        }

        const candidate = {
          coords: candidateCoords,
          penalty: candidatePenalty,
          rotationPenalty: measureSmallRingExteriorAssignmentRotationPenalty(
            coords,
            descriptor.anchorAtomId,
            assignment
          ),
          siblingClearance: measureSmallRingExteriorAssignmentClearance(
            layoutGraph,
            candidateCoords,
            descriptor.anchorAtomId,
            assignment
          )
        };
        if (isBetterSmallRingExteriorFanCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }

      if (bestCandidate) {
        coords = bestCandidate.coords;
        nudges += 1;
        acceptedInPass += 1;
      }
    }

    if (acceptedInPass === 0) {
      break;
    }
  }

  return {
    coords,
    nudges,
    changed: nudges > 0
  };
}

function buildPresentationState(layoutGraph, coords, nudges, steps, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const attachedRingPeripheralPenalty = measureAttachedRingPeripheralFocusPenalty(layoutGraph, coords, bondLength);
  const attachedRingRootOutwardPenalty = measureAttachedRingRootOutwardPresentationPenalty(
    layoutGraph,
    coords,
    options.frozenAtomIds ?? null
  );
  const terminalHeteroOutwardPenalty = measureRingTerminalHeteroOutwardPenalty(layoutGraph, coords);
  const terminalMultipleBondLeafFanPenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, coords);
  const smallRingExteriorFanExactPenalty = measureSmallRingExteriorFanExactPenalty(layoutGraph, coords);
  const omittedHydrogenTrigonalPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, coords).totalDeviation;
  const phosphateArylTailPenalty = measurePhosphateArylTailPresentationPenalty(layoutGraph, coords);
  const terminalCationRingProximityPenalty = measureTerminalCationRingProximityPenalty(layoutGraph, coords, { bondLength });
  const terminalRingCarbonylLeafContactPenalty = measureTerminalRingCarbonylLeafContactPenalty(layoutGraph, coords, { bondLength });
  const visibleBondCrossingCount = findVisibleHeavyBondCrossings(layoutGraph, coords).length;
  const presentationPenalty = measureRingSubstituentPresentationPenalty(layoutGraph, coords, {
    includeLinkedRingBridgePenalty: true
  });
  return {
    coords,
    nudges,
    steps,
    presentationPenalty,
    attachedRingPeripheralPenalty,
    attachedRingRootOutwardPenalty,
    omittedHydrogenTrigonalPenalty,
    terminalHeteroOutwardMaxPenalty: terminalHeteroOutwardPenalty.maxDeviation,
    terminalHeteroOutwardPenalty: terminalHeteroOutwardPenalty.totalDeviation,
    terminalRingCarbonylLeafContactPenalty,
    terminalMultipleBondLeafFanMaxPenalty: terminalMultipleBondLeafFanPenalty.maxDeviation,
    terminalMultipleBondLeafFanPenalty: terminalMultipleBondLeafFanPenalty.totalDeviation,
    smallRingExteriorFanExactMaxPenalty: smallRingExteriorFanExactPenalty.maxDeviation,
    smallRingExteriorFanExactPenalty: smallRingExteriorFanExactPenalty.totalDeviation,
    phosphateArylTailPenalty,
    terminalCationRingProximityPenalty,
    visibleBondCrossingCount,
    score:
      {
        coords,
        presentationPenalty,
        attachedRingPeripheralPenalty,
        attachedRingRootOutwardPenalty,
        omittedHydrogenTrigonalPenalty,
        terminalHeteroOutwardMaxPenalty: terminalHeteroOutwardPenalty.maxDeviation,
        terminalHeteroOutwardPenalty: terminalHeteroOutwardPenalty.totalDeviation,
        terminalRingCarbonylLeafContactPenalty,
        terminalMultipleBondLeafFanMaxPenalty: terminalMultipleBondLeafFanPenalty.maxDeviation,
        terminalMultipleBondLeafFanPenalty: terminalMultipleBondLeafFanPenalty.totalDeviation,
        smallRingExteriorFanExactMaxPenalty: smallRingExteriorFanExactPenalty.maxDeviation,
        smallRingExteriorFanExactPenalty: smallRingExteriorFanExactPenalty.totalDeviation,
        phosphateArylTailPenalty,
        terminalCationRingProximityPenalty,
        visibleBondCrossingCount,
        ...(typeof options.scoreCoordsFn === 'function' ? (options.scoreCoordsFn(coords) ?? {}) : {})
      }
  };
}

function isBetterPresentationState(candidateState, incumbentState, options) {
  if (!incumbentState) {
    return true;
  }
  if (candidateState.visibleBondCrossingCount !== incumbentState.visibleBondCrossingCount) {
    return candidateState.visibleBondCrossingCount < incumbentState.visibleBondCrossingCount;
  }
  if (
    incumbentState.omittedHydrogenTrigonalPenalty <= EXACT_OMITTED_H_TRIGONAL_EPSILON
    && candidateState.omittedHydrogenTrigonalPenalty > EXACT_OMITTED_H_TRIGONAL_EPSILON
  ) {
    return false;
  }
  if (typeof options.comparatorFn === 'function') {
    return options.comparatorFn(candidateState.score, incumbentState.score);
  }
  return candidateState.nudges > incumbentState.nudges;
}

function collectPresentationDescriptorSummary(layoutGraph, coords, options = {}) {
  return {
    attachedCarbonylDescriptorCount: collectAttachedCarbonylPresentationDescriptors(
      layoutGraph,
      coords
    ).length,
    attachedRingDescriptorCount: collectMovableAttachedRingDescriptors(
      layoutGraph,
      coords,
      options.frozenAtomIds ?? null
    ).length
  };
}

function evaluatePresentationStep(layoutGraph, currentState, stepName, stepResult, options) {
  if (!stepResult || !(stepResult.coords instanceof Map) || (stepResult.nudges ?? 0) <= 0) {
    return currentState;
  }
  const candidateState = buildPresentationState(
    layoutGraph,
    stepResult.coords,
    currentState.nudges + (stepResult.nudges ?? 0),
    [
      ...currentState.steps,
      {
        name: stepName,
        nudges: stepResult.nudges ?? 0
      }
    ],
    options
  );
  return isBetterPresentationState(candidateState, currentState, options) ? candidateState : currentState;
}

/**
 * Returns whether a stage result still needs ring-presentation cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{coords?: Map<string, {x: number, y: number}>, audit?: object|null, presentationPenalty?: number, terminalMultipleBondLeafFanPenalty?: number}} stageResult - Stage-like result.
 * @returns {boolean} True when ring-presentation cleanup should still be considered.
 */
export function hasOutstandingRingPresentationNeed(layoutGraph, stageResult) {
  if (!(stageResult?.coords instanceof Map)) {
    return false;
  }
  const audit = stageResult.audit ?? null;
  const presentationPenalty = stageResult.presentationPenalty ?? measureRingSubstituentPresentationPenalty(layoutGraph, stageResult.coords, {
    includeLinkedRingBridgePenalty: true
  });
  const attachedRingPeripheralPenalty = stageResult.attachedRingPeripheralPenalty
    ?? measureAttachedRingPeripheralFocusPenalty(layoutGraph, stageResult.coords);
  const attachedRingRootOutwardPenalty = stageResult.attachedRingRootOutwardPenalty
    ?? measureAttachedRingRootOutwardPresentationPenalty(layoutGraph, stageResult.coords);
  const omittedHydrogenTrigonalPenalty = stageResult.omittedHydrogenTrigonalPenalty
    ?? measureThreeHeavyContinuationDistortion(layoutGraph, stageResult.coords).totalDeviation;
  const terminalMultipleBondLeafFanPenalty = stageResult.terminalMultipleBondLeafFanPenalty
    ?? measureTerminalMultipleBondLeafFanPenalty(layoutGraph, stageResult.coords).totalDeviation;
  const terminalRingCarbonylLeafContactPenalty = stageResult.terminalRingCarbonylLeafContactPenalty
    ?? measureTerminalRingCarbonylLeafContactPenalty(layoutGraph, stageResult.coords);
  const smallRingExteriorFanExactPenalty = stageResult.smallRingExteriorFanExactPenalty
    ?? measureSmallRingExteriorFanExactPenalty(layoutGraph, stageResult.coords).totalDeviation;
  const phosphateArylTailPenalty = stageResult.phosphateArylTailPenalty
    ?? measurePhosphateArylTailPresentationPenalty(layoutGraph, stageResult.coords);
  const terminalCationRingProximityPenalty = stageResult.terminalCationRingProximityPenalty
    ?? measureTerminalCationRingProximityPenalty(layoutGraph, stageResult.coords);
  return (
    (audit?.ringSubstituentReadabilityFailureCount ?? 0) > 0
    || (audit?.inwardRingSubstituentCount ?? 0) > 0
    || (audit?.outwardAxisRingSubstituentFailureCount ?? 0) > 0
    || (audit?.severeOverlapCount ?? 0) > 0
    || omittedHydrogenTrigonalPenalty > OMITTED_H_TRIGONAL_PRESENTATION_NEED
    || phosphateArylTailPenalty > PRESENTATION_NEED_EPSILON
    || terminalCationRingProximityPenalty > PRESENTATION_NEED_EPSILON
    || terminalMultipleBondLeafFanPenalty > PRESENTATION_NEED_EPSILON
    || terminalRingCarbonylLeafContactPenalty > PRESENTATION_NEED_EPSILON
    || smallRingExteriorFanExactPenalty > PRESENTATION_NEED_EPSILON
    || attachedRingPeripheralPenalty > PRESENTATION_NEED_EPSILON
    || attachedRingRootOutwardPenalty > PRESENTATION_NEED_EPSILON
    || presentationPenalty > PRESENTATION_NEED_EPSILON
  );
}

function hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, stageResult) {
  if (!(stageResult?.coords instanceof Map)) {
    return false;
  }
  const audit = stageResult.audit ?? null;
  const presentationPenalty = stageResult.presentationPenalty ?? measureRingSubstituentPresentationPenalty(layoutGraph, stageResult.coords, {
    includeLinkedRingBridgePenalty: true
  });
  const attachedRingPeripheralPenalty = stageResult.attachedRingPeripheralPenalty
    ?? measureAttachedRingPeripheralFocusPenalty(layoutGraph, stageResult.coords);
  const attachedRingRootOutwardPenalty = stageResult.attachedRingRootOutwardPenalty
    ?? measureAttachedRingRootOutwardPresentationPenalty(layoutGraph, stageResult.coords);
  const omittedHydrogenTrigonalPenalty = stageResult.omittedHydrogenTrigonalPenalty
    ?? measureThreeHeavyContinuationDistortion(layoutGraph, stageResult.coords).totalDeviation;
  const terminalMultipleBondLeafFanPenalty = stageResult.terminalMultipleBondLeafFanPenalty
    ?? measureTerminalMultipleBondLeafFanPenalty(layoutGraph, stageResult.coords).totalDeviation;
  const terminalRingCarbonylLeafContactPenalty = stageResult.terminalRingCarbonylLeafContactPenalty
    ?? measureTerminalRingCarbonylLeafContactPenalty(layoutGraph, stageResult.coords);
  const smallRingExteriorFanExactPenalty = stageResult.smallRingExteriorFanExactPenalty
    ?? measureSmallRingExteriorFanExactPenalty(layoutGraph, stageResult.coords).totalDeviation;
  const terminalCationRingProximityPenalty = stageResult.terminalCationRingProximityPenalty
    ?? measureTerminalCationRingProximityPenalty(layoutGraph, stageResult.coords);
  return (
    (audit?.ringSubstituentReadabilityFailureCount ?? 0) > 0
    || (audit?.inwardRingSubstituentCount ?? 0) > 0
    || (audit?.outwardAxisRingSubstituentFailureCount ?? 0) > 0
    || (audit?.severeOverlapCount ?? 0) > 0
    || omittedHydrogenTrigonalPenalty > OMITTED_H_TRIGONAL_PRESENTATION_NEED
    || terminalCationRingProximityPenalty > PRESENTATION_NEED_EPSILON
    || terminalMultipleBondLeafFanPenalty > PRESENTATION_NEED_EPSILON
    || terminalRingCarbonylLeafContactPenalty > PRESENTATION_NEED_EPSILON
    || smallRingExteriorFanExactPenalty > PRESENTATION_NEED_EPSILON
    || attachedRingPeripheralPenalty > PRESENTATION_NEED_EPSILON
    || attachedRingRootOutwardPenalty > PRESENTATION_NEED_EPSILON
    || presentationPenalty > PRESENTATION_NEED_EPSILON
  );
}

/**
 * Runs late ring-presentation cleanup through a single internal escalation
 * ladder while preserving the existing worker modules.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{
 *   bondLength?: number,
 *   frozenAtomIds?: Set<string>|null,
 *   cleanupRigidSubtreesByAtomId?: Map<string, Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[]}>>,
 *   protectLargeMoleculeBackbone?: boolean,
 *   includeRingSubstituent?: boolean,
 *   includeTerminalMultipleBondLeaf?: boolean,
 *   includeTerminalHetero?: boolean,
 *   includeAttachedRingFallback?: boolean,
 *   scoreCoordsFn?: ((coords: Map<string, {x: number, y: number}>) => object|null),
 *   comparatorFn?: ((candidate: object, incumbent: object) => boolean)
 * }} [options] - Presentation cleanup options.
 * @returns {{
 *   coords: Map<string, {x: number, y: number}>,
 *   nudges: number,
 *   changed: boolean,
 *   presentationPenalty: number,
 *   attachedRingPeripheralPenalty: number,
 *   attachedRingRootOutwardPenalty: number,
 *   strategiesRun: string[],
 *   steps: Array<{name: string, nudges: number}>,
 *   attachedCarbonylDescriptorCount: number,
 *   attachedRingDescriptorCount: number,
 *   usedAttachedRingFallback: boolean,
 *   stabilizationRequest: {requested: boolean, reasons: string[], maxPasses: number}|null
 * }} Best accepted presentation-cleanup result.
 */
export function runRingPresentationCleanup(layoutGraph, inputCoords, options = {}) {
  let currentState = buildPresentationState(layoutGraph, inputCoords, 0, [], options);
  let usedAttachedRingFallback = false;
  let usedDirectAttachedRingRootRetidy = false;
  let usedPhosphateArylTailTidy = false;
  let usedRingSubstituentTidy = false;
  const includeRingSubstituent = options.includeRingSubstituent !== false;
  const includeTerminalMultipleBondLeaf =
    includeRingSubstituent || options.includeTerminalMultipleBondLeaf === true;

  const hasTerminalHeteroOutwardNeed = state => (
    measureRingTerminalHeteroOutwardPenalty(layoutGraph, state.coords).maxDeviation > PRESENTATION_NEED_EPSILON
  );

  if (includeRingSubstituent) {
    const previousStepCount = currentState.steps.length;
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'phosphate-aryl-tail',
      runPhosphateArylTailTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength
      }),
      options
    );
    usedPhosphateArylTailTidy = currentState.steps.length > previousStepCount;

    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'terminal-cation-ring-clearance',
      runTerminalCationRingClearanceTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength
      }),
      options
    );

    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'diaryl-omitted-h-fan',
      runDiarylOmittedHydrogenFanTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
        protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true
      }),
      options
    );

  }

  if (includeTerminalMultipleBondLeaf) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'terminal-multiple-bond-leaf',
      runTerminalMultipleBondLeafFanTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
  }

  if (
    includeRingSubstituent
    && (
      hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
      || hasTerminalHeteroOutwardNeed(currentState)
    )
  ) {
    const previousStepCount = currentState.steps.length;
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'ring-substituent',
      runRingSubstituentTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
    usedRingSubstituentTidy = currentState.steps.length > previousStepCount;
  }

  if (includeRingSubstituent && (!usedPhosphateArylTailTidy || usedRingSubstituentTidy)) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'phosphate-aryl-tail',
      runPhosphateArylTailTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength
      }),
      options
    );
  }

  if (includeTerminalMultipleBondLeaf) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'terminal-multiple-bond-leaf',
      runTerminalMultipleBondLeafFanTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
  }

  if (includeRingSubstituent) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'small-ring-exterior-fan-exact',
      runSmallRingExteriorFanExactRetidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
  }

  if (options.includeTerminalHetero === true) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'ring-terminal-hetero',
      runRingTerminalHeteroTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength
      }),
      options
    );
  }

  const descriptorSummary = collectPresentationDescriptorSummary(layoutGraph, currentState.coords, options);
  if (
    options.includeAttachedRingFallback === true
    && descriptorSummary.attachedRingDescriptorCount > 0
    && hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
  ) {
    const previousStepCount = currentState.steps.length;
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'attached-ring-fallback',
      runAttachedRingRotationTouchup(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null,
        cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
        protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true
      }),
      options
    );
    usedAttachedRingFallback = currentState.steps.length > previousStepCount;
  }

  const postAttachedRingFallbackBondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const terminalMultipleBondLeafCrowdedAfterAttachedFallback =
    usedAttachedRingFallback
    && options.includeRingSubstituent !== false
    && hasTerminalMultipleBondLeafPresentationCrowding(
      layoutGraph,
      currentState.coords,
      postAttachedRingFallbackBondLength
    );
  const terminalMultipleBondLeafSevereAfterAttachedFallback =
    usedAttachedRingFallback
    && options.includeRingSubstituent !== false
    && hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
    && hasTerminalMultipleBondLeafSevereOverlap(
      layoutGraph,
      currentState.coords,
      postAttachedRingFallbackBondLength
    );

  if (terminalMultipleBondLeafCrowdedAfterAttachedFallback || terminalMultipleBondLeafSevereAfterAttachedFallback) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'terminal-multiple-bond-leaf',
      runTerminalMultipleBondLeafFanTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );

    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'ring-substituent-retidy',
      runRingSubstituentTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
  }

  if (
    usedAttachedRingFallback
    && hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
  ) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'attached-ring-root-outward-retidy',
      runExactAttachedRingRootOutwardRetidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );

    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'terminal-carbon-ring-leaf-retidy',
      runTerminalCarbonRingLeafRetidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );

    const previousStepCount = currentState.steps.length;
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'direct-attached-ring-root-retidy',
      runDirectAttachedRingSystemOutwardRetidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
    usedDirectAttachedRingRootRetidy = currentState.steps.length > previousStepCount;
  }

  if (
    usedAttachedRingFallback
    && usedDirectAttachedRingRootRetidy
    && options.includeAttachedRingFallback === true
    && collectPresentationDescriptorSummary(layoutGraph, currentState.coords, options).attachedRingDescriptorCount > 0
    && hasOutstandingNonPhosphateRingPresentationNeed(layoutGraph, currentState)
  ) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'attached-ring-fallback-retouch',
      runAttachedRingRotationTouchup(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null,
        cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId,
        protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true
      }),
      options
    );
  }

  if (includeRingSubstituent) {
    const previousStepCount = currentState.steps.length;
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'direct-attached-ring-root-retidy',
      runDirectAttachedRingSystemOutwardRetidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
    usedDirectAttachedRingRootRetidy = usedDirectAttachedRingRootRetidy || currentState.steps.length > previousStepCount;
  }

  if (
    usedAttachedRingFallback
    && includeRingSubstituent
  ) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'ring-substituent-final-retidy',
      runRingSubstituentTidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
  }

  if (options.includeRingSubstituent !== false) {
    currentState = evaluatePresentationStep(
      layoutGraph,
      currentState,
      'small-ring-exterior-fan-final-retouch',
      runSmallRingExteriorFanExactRetidy(layoutGraph, currentState.coords, {
        bondLength: options.bondLength,
        frozenAtomIds: options.frozenAtomIds ?? null
      }),
      options
    );
  }

  const finalDescriptorSummary = collectPresentationDescriptorSummary(layoutGraph, currentState.coords, options);
  return {
    coords: currentState.coords,
    nudges: currentState.nudges,
    changed: currentState.nudges > 0,
    presentationPenalty: currentState.presentationPenalty,
    attachedRingPeripheralPenalty: currentState.attachedRingPeripheralPenalty,
    attachedRingRootOutwardPenalty: currentState.attachedRingRootOutwardPenalty,
    omittedHydrogenTrigonalPenalty: currentState.omittedHydrogenTrigonalPenalty,
    terminalHeteroOutwardMaxPenalty: currentState.terminalHeteroOutwardMaxPenalty,
    terminalHeteroOutwardPenalty: currentState.terminalHeteroOutwardPenalty,
    terminalMultipleBondLeafFanMaxPenalty: currentState.terminalMultipleBondLeafFanMaxPenalty,
    terminalMultipleBondLeafFanPenalty: currentState.terminalMultipleBondLeafFanPenalty,
    smallRingExteriorFanExactMaxPenalty: currentState.smallRingExteriorFanExactMaxPenalty,
    smallRingExteriorFanExactPenalty: currentState.smallRingExteriorFanExactPenalty,
    phosphateArylTailPenalty: currentState.phosphateArylTailPenalty,
    terminalCationRingProximityPenalty: currentState.terminalCationRingProximityPenalty,
    strategiesRun: currentState.steps.map(step => step.name),
    steps: currentState.steps,
    attachedCarbonylDescriptorCount: finalDescriptorSummary.attachedCarbonylDescriptorCount,
    attachedRingDescriptorCount: finalDescriptorSummary.attachedRingDescriptorCount,
    usedAttachedRingFallback,
    stabilizationRequest:
      currentState.nudges > 0
        ? {
            requested: true,
            reasons: ['presentation'],
            maxPasses: 1
          }
        : null
  };
}
