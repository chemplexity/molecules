/** @module families/mixed */

import { angleOf, angularDifference, centroid, distance, fromAngle, sub, add, rotate, wrapAngle } from '../geometry/vec2.js';
import { computeBounds } from '../geometry/bounds.js';
import { alignCoordsToFixed, reflectAcrossLine } from '../geometry/transforms.js';
import { nonSharedPath } from '../geometry/ring-path.js';
import { transformAttachedBlock } from '../placement/linkers.js';
import { auditLayout } from '../audit/audit.js';
import { measureRingSubstituentPresentationPenalty } from '../cleanup/presentation/ring-substituent.js';
import { collectMovableAttachedRingDescriptors, runAttachedRingRotationTouchup } from '../cleanup/presentation/attached-ring-fallback.js';
import {
  directAttachedForeignRingJunctionContinuationAngle,
  findLayoutBond,
  isExactSmallRingExteriorContinuationEligible,
  isExactRingOutwardEligibleSubstituent,
  isExactRingTrigonalBisectorEligible,
  isExactSimpleAcyclicContinuationEligible,
  isLinearCenter,
  isExactVisibleTrigonalBisectorEligible,
  isTerminalMultipleBondLeaf,
  supportsProjectedTetrahedralGeometry
} from '../placement/branch-placement/angle-selection.js';
import { assignBondValidationClass, resolvePlacementValidationClass } from '../placement/bond-validation.js';
import { chooseAttachmentAngle, measureSmallRingExteriorGapSpreadPenalty, placeRemainingBranches, smallRingExteriorTargetAngles } from '../placement/branch-placement.js';
import {
  findSevereOverlaps,
  measureFocusedPlacementCost,
  measureLayoutCost,
  measureRingSubstituentReadability,
  measureTrigonalDistortion,
  measureThreeHeavyContinuationDistortion
} from '../audit/invariants.js';
import { layoutAcyclicFamily } from './acyclic.js';
import { layoutBridgedFamily } from './bridged.js';
import {
  isBetterBridgedRescueForFusedSystem,
  layoutFusedCageKamadaKawai,
  layoutFusedFamily,
  shouldShortCircuitToFusedCageKk,
  shouldTryBridgedRescueForFusedSystem
} from './fused.js';
import { layoutIsolatedRingFamily } from './isolated-ring.js';
import { computeMacrocycleAngularBudgets, layoutMacrocycleFamily } from './macrocycle.js';
import { layoutSpiroFamily } from './spiro.js';
import { classifyRingSystemFamily } from '../model/scaffold-plan.js';
import { IMPROVEMENT_EPSILON, RING_SYSTEM_RESCUE_LIMITS } from '../constants.js';

const LINKER_ZIGZAG_TURN_ANGLE = Math.PI / 3;
const EXACT_TRIGONAL_CONTINUATION_ANGLE = (2 * Math.PI) / 3;
const MAX_RING_LINKER_ATOMS = 3;
const LINKED_RING_ROTATION_OFFSETS = [Math.PI / 12, -(Math.PI / 12), Math.PI / 6, -(Math.PI / 6), Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, -(2 * Math.PI) / 3, Math.PI];
const LINKED_RING_PLACED_BLOCK_ROTATION_OFFSETS = [Math.PI / 18, -(Math.PI / 18), Math.PI / 12, -(Math.PI / 12), Math.PI / 9, -(Math.PI / 9)];
const LINKED_RING_SIDE_BALANCE_ROTATION_OFFSETS = [
  0,
  Math.PI / 36,
  -(Math.PI / 36),
  7 * Math.PI / 180,
  -(7 * Math.PI / 180),
  2 * Math.PI / 45,
  -(2 * Math.PI / 45),
  Math.PI / 20,
  -(Math.PI / 20),
  Math.PI / 18,
  -(Math.PI / 18),
  11 * Math.PI / 180,
  -(11 * Math.PI / 180),
  Math.PI / 15,
  -(Math.PI / 15),
  13 * Math.PI / 180,
  -(13 * Math.PI / 180),
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 9,
  -(Math.PI / 9)
];
const LINKED_METHYLENE_HYDROGEN_MIN_SEPARATION = 7 * Math.PI / 18;
const LINKED_METHYLENE_HYDROGEN_MAX_SEPARATION = 17 * Math.PI / 18;
const DIRECT_ATTACHMENT_ROTATION_OFFSETS = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3];
const DIRECT_ATTACHMENT_RING_ROTATION_OFFSETS = [0, Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, -(2 * Math.PI) / 3, Math.PI];
const DIRECT_ATTACHMENT_FINE_ANGLE_OFFSETS = [Math.PI / 12, -(Math.PI / 12)];
const DIRECT_ATTACHMENT_LOCAL_REFINEMENT_RING_ROTATION_OFFSETS = [
  0,
  Math.PI / 15,
  -(Math.PI / 15),
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 6,
  -(Math.PI / 6)
];
const DIRECT_ATTACHMENT_LOCAL_ROOT_ROTATION_REFINEMENT_OFFSETS = [
  Math.PI / 60,
  -(Math.PI / 60),
  Math.PI / 30,
  -(Math.PI / 30),
  Math.PI / 20,
  -(Math.PI / 20),
  Math.PI / 15,
  -(Math.PI / 15)
];
const SUPPRESSED_H_RING_JUNCTION_RESCUE_OFFSETS = [
  Math.PI / 72,
  -(Math.PI / 72),
  Math.PI / 36,
  -(Math.PI / 36),
  Math.PI / 24,
  -(Math.PI / 24),
  Math.PI / 18,
  -(Math.PI / 18),
  5 * Math.PI / 72,
  -(5 * Math.PI / 72),
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 9,
  -(Math.PI / 9),
  Math.PI / 6,
  -(Math.PI / 6),
  Math.PI / 4,
  -(Math.PI / 4)
];
const SUPPRESSED_H_RING_JUNCTION_BALANCE_OFFSETS = [
  Math.PI / 72,
  -(Math.PI / 72),
  Math.PI / 36,
  -(Math.PI / 36),
  Math.PI / 24,
  -(Math.PI / 24),
  Math.PI / 18,
  -(Math.PI / 18),
  5 * Math.PI / 72,
  -(5 * Math.PI / 72)
];
const MAX_DIRECT_ATTACHMENT_PARENT_SLOT_SWAP_ATOMS = 64;
const DIRECT_ATTACHMENT_MIN_JUNCTION_GAP = Math.PI / 3;
const EXACT_TERMINAL_MULTIPLE_SLOT_CLEARANCE_FACTOR = 0.8;
const ATTACHED_BLOCK_OUTWARD_READABILITY_PENALTY = 120;
const ATTACHED_BLOCK_INWARD_READABILITY_PENALTY = 360;
const EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT = 50;
const SHARED_JUNCTION_LOCAL_OUTWARD_SPREAD_LIMIT = Math.PI / 6;
const SHARED_JUNCTION_STRAIGHT_CLEARANCE_LIMIT = Math.PI / 3;
const PROJECTED_TETRAHEDRAL_TRIGONAL_RESCUE_EPSILON = 1e-6;
const MIXED_ROOT_RETRY_LIMITS = {
  maxHeavyAtomCount: 60,
  maxAlternateRootCandidates: 3,
  minSevereOverlapCount: 1
};

function expandScoringFocusAtomIds(layoutGraph, atomIds, depth = 1) {
  const expandedAtomIds = new Set(atomIds);
  let frontierAtomIds = new Set(atomIds);

  for (let level = 0; level < depth; level++) {
    const nextFrontierAtomIds = new Set();
    for (const atomId of frontierAtomIds) {
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        if (expandedAtomIds.has(neighborAtomId)) {
          continue;
        }
        expandedAtomIds.add(neighborAtomId);
        nextFrontierAtomIds.add(neighborAtomId);
      }
    }
    frontierAtomIds = nextFrontierAtomIds;
    if (frontierAtomIds.size === 0) {
      break;
    }
  }

  return expandedAtomIds;
}

function compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank) {
  const firstRank = canonicalAtomRank.get(firstAtomId) ?? Number.MAX_SAFE_INTEGER;
  const secondRank = canonicalAtomRank.get(secondAtomId) ?? Number.MAX_SAFE_INTEGER;
  return firstRank - secondRank || String(firstAtomId).localeCompare(String(secondAtomId), 'en', { numeric: true });
}

function incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId) {
  if (!coords.has(anchorAtomId)) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  return (layoutGraph.atomToRings.get(anchorAtomId) ?? []).flatMap(ring => {
    const placedRingPositions = ring.atomIds.filter(atomId => coords.has(atomId)).map(atomId => coords.get(atomId));
    if (placedRingPositions.length < 3) {
      return [];
    }
    return [angleOf(sub(anchorPosition, centroid(placedRingPositions)))];
  });
}

function measureMixedRootExactRingExitPenalty(layoutGraph, coords, focusAtomIds = null, childAtomFilter = null) {
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (const [anchorAtomId, anchorAtom] of layoutGraph.atoms) {
    if (!anchorAtom || anchorAtom.element === 'H' || !coords.has(anchorAtomId)) {
      continue;
    }
    if (focusAtomIds instanceof Set && focusAtomIds.size > 0 && !focusAtomIds.has(anchorAtomId)) {
      continue;
    }

    const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
    if (anchorRings.length === 0) {
      continue;
    }

    const incidentRingAtomIds = new Set(anchorRings.flatMap(ring => ring.atomIds));
    const heavyExocyclicNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (
        !neighborAtom
        || neighborAtom.element === 'H'
        || !coords.has(neighborAtomId)
        || incidentRingAtomIds.has(neighborAtomId)
      ) {
        continue;
      }
      heavyExocyclicNeighborIds.push(neighborAtomId);
    }
    if (heavyExocyclicNeighborIds.length !== 1) {
      continue;
    }

    const childAtomId = heavyExocyclicNeighborIds[0];
    if (typeof childAtomFilter === 'function' && !childAtomFilter(childAtomId, anchorAtomId)) {
      continue;
    }
    const targetAngles = [
      ...directAttachmentLocalOutwardAngles(layoutGraph, coords, anchorAtomId, childAtomId),
      ...incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId)
    ].filter((candidateAngle, index, angles) =>
      angles.findIndex(existingAngle => angularDifference(existingAngle, candidateAngle) <= 1e-9) === index
    );
    if (targetAngles.length === 0) {
      continue;
    }

    const actualAngle = angleOf(sub(coords.get(childAtomId), coords.get(anchorAtomId)));
    const deviation = Math.min(...targetAngles.map(targetAngle => angularDifference(targetAngle, actualAngle)));
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return {
    totalDeviation,
    maxDeviation
  };
}

function measureMixedRootTrigonalPenalty(layoutGraph, coords) {
  const trigonalDistortion = measureTrigonalDistortion(layoutGraph, coords);
  return {
    totalDeviation: trigonalDistortion.totalDeviation,
    maxDeviation: trigonalDistortion.maxDeviation
  };
}

function measureMixedRootHeteroRingExitPenalty(layoutGraph, coords) {
  return measureMixedRootExactRingExitPenalty(
    layoutGraph,
    coords,
    null,
    childAtomId => (layoutGraph.atoms.get(childAtomId)?.element ?? 'C') !== 'C'
  );
}

function largestAngularGapDetails(occupiedAngles) {
  const sortedAngles = [...occupiedAngles]
    .map(wrapAngle)
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle)
    .filter((angle, index, angles) => index === 0 || angularDifference(angle, angles[index - 1]) > 1e-9);
  if (sortedAngles.length === 0) {
    return null;
  }

  let bestBisector = null;
  let bestGap = -Infinity;
  for (let index = 0; index < sortedAngles.length; index++) {
    const gapStart = sortedAngles[index];
    let gapEnd = sortedAngles[(index + 1) % sortedAngles.length];
    if (index + 1 === sortedAngles.length) {
      gapEnd += Math.PI * 2;
    }
    const gap = gapEnd - gapStart;
    if (gap > bestGap + 1e-9) {
      bestGap = gap;
      bestBisector = wrapAngle(gapStart + gap / 2);
    }
  }
  return {
    bisector: bestBisector,
    gap: bestGap
  };
}

function largestAngularGapBisector(occupiedAngles) {
  return largestAngularGapDetails(occupiedAngles)?.bisector ?? null;
}

function directAttachmentLocalOutwardAngles(layoutGraph, coords, anchorAtomId, otherAtomId = null) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const outwardAngles = [];
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    if (otherAtomId && ring.atomIds.includes(otherAtomId)) {
      continue;
    }

    const ringNeighborAngles = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (neighborAtomId === otherAtomId || !ring.atomIds.includes(neighborAtomId) || !coords.has(neighborAtomId)) {
        continue;
      }
      ringNeighborAngles.push(angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
    }
    if (ringNeighborAngles.length !== 2) {
      continue;
    }

    const outwardAngle = largestAngularGapBisector(ringNeighborAngles);
    if (outwardAngle == null || outwardAngles.some(existingAngle => angularDifference(existingAngle, outwardAngle) <= 1e-9)) {
      continue;
    }
    outwardAngles.push(outwardAngle);
  }

  return outwardAngles;
}

function meanAngle(angles) {
  let sumX = 0;
  let sumY = 0;
  for (const angle of angles) {
    sumX += Math.cos(angle);
    sumY += Math.sin(angle);
  }
  return angleOf({ x: sumX, y: sumY });
}

function sharedJunctionTerminalLeafTargetAngle(layoutGraph, coords, anchorAtomId, childAtomId) {
  if (!coords.has(anchorAtomId) || !coords.has(childAtomId)) {
    return null;
  }

  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'C' || childAtom.heavyDegree !== 1) {
    return null;
  }

  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (anchorRings.length === 0) {
    return null;
  }

  const bond = layoutGraph.bondByAtomPair.get(
    anchorAtomId < childAtomId ? `${anchorAtomId}:${childAtomId}` : `${childAtomId}:${anchorAtomId}`
  );
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const ringNeighborIds = layoutGraph.sourceMolecule.atoms.get(anchorAtomId)
    ?.getNeighbors(layoutGraph.sourceMolecule)
    .filter(
      neighborAtom =>
        neighborAtom
        && neighborAtom.name !== 'H'
        && neighborAtom.id !== childAtomId
        && coords.has(neighborAtom.id)
        && (layoutGraph.atomToRings.get(neighborAtom.id)?.length ?? 0) > 0
    )
    .map(neighborAtom => neighborAtom.id) ?? [];
  if (ringNeighborIds.length < 3) {
    return null;
  }

  const sharedJunctionNeighborIds = ringNeighborIds.filter(neighborAtomId => {
    const neighborRings = layoutGraph.atomToRings.get(neighborAtomId) ?? [];
    return neighborRings.filter(ring => anchorRings.includes(ring)).length > 1;
  });
  if (sharedJunctionNeighborIds.length !== 1 || !coords.has(sharedJunctionNeighborIds[0])) {
    return null;
  }

  const straightJunctionAngle = angleOf(sub(anchorPosition, coords.get(sharedJunctionNeighborIds[0])));
  const ringNeighborAngles = ringNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  const straightJunctionClearance = Math.min(
    ...ringNeighborAngles.map(occupiedAngle => angularDifference(straightJunctionAngle, occupiedAngle))
  );
  const localOutwardAngles = incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId);
  if (localOutwardAngles.length >= 2) {
    let localOutwardSpread = 0;
    for (let firstIndex = 0; firstIndex < localOutwardAngles.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < localOutwardAngles.length; secondIndex++) {
        localOutwardSpread = Math.max(
          localOutwardSpread,
          angularDifference(localOutwardAngles[firstIndex], localOutwardAngles[secondIndex])
        );
      }
    }
    if (
      localOutwardSpread <= SHARED_JUNCTION_LOCAL_OUTWARD_SPREAD_LIMIT + 1e-6
      && Math.min(...localOutwardAngles.map(angle => angularDifference(angle, straightJunctionAngle)))
        >= SHARED_JUNCTION_LOCAL_OUTWARD_SPREAD_LIMIT - 1e-6
    ) {
      return meanAngle(localOutwardAngles);
    }
  }

  return straightJunctionClearance >= SHARED_JUNCTION_STRAIGHT_CLEARANCE_LIMIT - 1e-6
    ? straightJunctionAngle
    : null;
}

function snapExactSharedJunctionTerminalLeaves(layoutGraph, coords, bondLength) {
  for (const anchorAtomId of coords.keys()) {
    if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
      continue;
    }
    for (const childAtom of layoutGraph.sourceMolecule.atoms.get(anchorAtomId)?.getNeighbors(layoutGraph.sourceMolecule) ?? []) {
      if (!childAtom || childAtom.name === 'H') {
        continue;
      }
      const childAtomId = childAtom.id;
      const targetAngle = sharedJunctionTerminalLeafTargetAngle(layoutGraph, coords, anchorAtomId, childAtomId);
      if (targetAngle == null) {
        continue;
      }
      coords.set(childAtomId, add(coords.get(anchorAtomId), fromAngle(targetAngle, bondLength)));
    }
  }
}

function ringSystemDescriptors(layoutGraph, ringSystem) {
  const ringIdSet = new Set(ringSystem.ringIds);
  const rings = layoutGraph.rings.filter(ring => ringIdSet.has(ring.id));
  const connections = layoutGraph.ringConnections.filter(connection => ringIdSet.has(connection.firstRingId) && ringIdSet.has(connection.secondRingId));
  return { rings, connections };
}

function ringSystemAdjacency(layoutGraph, ringSystem) {
  const { rings, connections } = ringSystemDescriptors(layoutGraph, ringSystem);
  const ringAdj = new Map(rings.map(ring => [ring.id, []]));
  const ringConnectionByPair = new Map();
  for (const connection of connections) {
    ringAdj.get(connection.firstRingId)?.push(connection.secondRingId);
    ringAdj.get(connection.secondRingId)?.push(connection.firstRingId);
    const key = connection.firstRingId < connection.secondRingId ? `${connection.firstRingId}:${connection.secondRingId}` : `${connection.secondRingId}:${connection.firstRingId}`;
    ringConnectionByPair.set(key, connection);
  }
  for (const neighbors of ringAdj.values()) {
    neighbors.sort((firstRingId, secondRingId) => firstRingId - secondRingId);
  }
  return { rings, connections, ringAdj, ringConnectionByPair };
}

function ringSystemConnectionKinds(layoutGraph, ringSystem) {
  const { connections } = ringSystemDescriptors(layoutGraph, ringSystem);
  const kinds = new Set();
  for (const connection of connections) {
    if (connection.kind) {
      kinds.add(connection.kind);
    }
  }
  return kinds;
}

function buildFusedRingBlocks(rings, ringAdj, ringConnectionByPair) {
  const ringById = new Map(rings.map(ring => [ring.id, ring]));
  const visitedRingIds = new Set();
  const blocks = [];

  for (const ring of rings) {
    if (visitedRingIds.has(ring.id)) {
      continue;
    }
    const blockRingIds = [];
    const stack = [ring.id];
    visitedRingIds.add(ring.id);

    while (stack.length > 0) {
      const currentRingId = stack.pop();
      blockRingIds.push(currentRingId);
      for (const neighborRingId of ringAdj.get(currentRingId) ?? []) {
        const key = currentRingId < neighborRingId ? `${currentRingId}:${neighborRingId}` : `${neighborRingId}:${currentRingId}`;
        if (ringConnectionByPair.get(key)?.kind !== 'fused' || visitedRingIds.has(neighborRingId)) {
          continue;
        }
        visitedRingIds.add(neighborRingId);
        stack.push(neighborRingId);
      }
    }

    blockRingIds.sort((firstRingId, secondRingId) => firstRingId - secondRingId);
    const blockRingIdSet = new Set(blockRingIds);
    const blockRings = blockRingIds.map(ringId => ringById.get(ringId)).filter(Boolean);
    const blockRingAdj = new Map(blockRingIds.map(ringId => [ringId, []]));
    const blockRingConnectionByPair = new Map();
    for (const ringId of blockRingIds) {
      for (const neighborRingId of ringAdj.get(ringId) ?? []) {
        const key = ringId < neighborRingId ? `${ringId}:${neighborRingId}` : `${neighborRingId}:${ringId}`;
        const connection = ringConnectionByPair.get(key);
        if (connection?.kind !== 'fused' || !blockRingIdSet.has(neighborRingId)) {
          continue;
        }
        blockRingAdj.get(ringId)?.push(neighborRingId);
        blockRingConnectionByPair.set(key, connection);
      }
    }
    for (const neighbors of blockRingAdj.values()) {
      neighbors.sort((firstRingId, secondRingId) => firstRingId - secondRingId);
    }

    blocks.push({
      id: blocks.length,
      ringIds: blockRingIds,
      rings: blockRings,
      ringAdj: blockRingAdj,
      ringConnectionByPair: blockRingConnectionByPair,
      atomIds: [...new Set(blockRings.flatMap(blockRing => blockRing.atomIds))]
    });
  }

  return blocks;
}

function compareCoordMapsDeterministically(firstCoords, secondCoords, canonicalAtomRank) {
  const atomIds = (firstCoords.size === secondCoords.size ? [...firstCoords.keys()] : [...new Set([...firstCoords.keys(), ...secondCoords.keys()])]).sort(
    (firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank)
  );
  for (const atomId of atomIds) {
    const firstPosition = firstCoords.get(atomId);
    const secondPosition = secondCoords.get(atomId);
    if (!firstPosition && !secondPosition) {
      continue;
    }
    if (!firstPosition) {
      return 1;
    }
    if (!secondPosition) {
      return -1;
    }
    const roundedFirstX = Math.round(firstPosition.x * 1e6);
    const roundedSecondX = Math.round(secondPosition.x * 1e6);
    if (roundedFirstX !== roundedSecondX) {
      return roundedFirstX - roundedSecondX;
    }
    const roundedFirstY = Math.round(firstPosition.y * 1e6);
    const roundedSecondY = Math.round(secondPosition.y * 1e6);
    if (roundedFirstY !== roundedSecondY) {
      return roundedFirstY - roundedSecondY;
    }
  }
  return 0;
}

function scaffoldCandidateToPlacementSequenceEntry(candidate, kindOverride = null) {
  return {
    kind: kindOverride ?? (candidate.type === 'ring-system' ? 'ring-system' : 'acyclic'),
    candidateId: candidate.id,
    family: candidate.family,
    templateId: candidate.templateId ?? null,
    atomIds: [...candidate.atomIds],
    ringIds: [...candidate.ringIds]
  };
}

function resolveMixedRootScaffoldPlan(scaffoldPlan, rootScaffold = null) {
  if (!rootScaffold || scaffoldPlan?.rootScaffold?.id === rootScaffold.id) {
    return scaffoldPlan;
  }

  const rootCandidate = scaffoldPlan.candidates.find(candidate => candidate.id === rootScaffold.id) ?? rootScaffold;
  return {
    ...scaffoldPlan,
    rootScaffold: rootCandidate,
    placementSequence: [
      scaffoldCandidateToPlacementSequenceEntry(rootCandidate, 'root-scaffold'),
      ...scaffoldPlan.candidates
        .filter(candidate => candidate.id !== rootCandidate.id)
        .map(candidate => scaffoldCandidateToPlacementSequenceEntry(candidate)),
      ...(
        rootCandidate.type !== 'acyclic' && (scaffoldPlan.nonRingAtomIds?.length ?? 0) > 0
          ? [{
              kind: 'chains',
              candidateId: 'chains',
              family: 'acyclic',
              templateId: null,
              atomIds: [...scaffoldPlan.nonRingAtomIds],
              ringIds: []
            }]
          : []
      )
    ]
  };
}

function auditMixedPlacement(layoutGraph, placement, bondLength) {
  return auditLayout(layoutGraph, placement.coords, {
    bondLength,
    bondValidationClasses: placement.bondValidationClasses
  });
}

function isBetterMixedRootPlacement(candidatePlacement, candidateAudit, incumbentPlacement, incumbentAudit, canonicalAtomRank, layoutGraph, bondLength) {
  if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
    return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
  }
  if (candidateAudit.labelOverlapCount !== incumbentAudit.labelOverlapCount) {
    return candidateAudit.labelOverlapCount < incumbentAudit.labelOverlapCount;
  }
  if (candidateAudit.ringSubstituentReadabilityFailureCount !== incumbentAudit.ringSubstituentReadabilityFailureCount) {
    return candidateAudit.ringSubstituentReadabilityFailureCount < incumbentAudit.ringSubstituentReadabilityFailureCount;
  }
  if (candidateAudit.inwardRingSubstituentCount !== incumbentAudit.inwardRingSubstituentCount) {
    return candidateAudit.inwardRingSubstituentCount < incumbentAudit.inwardRingSubstituentCount;
  }
  if (candidateAudit.outwardAxisRingSubstituentFailureCount !== incumbentAudit.outwardAxisRingSubstituentFailureCount) {
    return candidateAudit.outwardAxisRingSubstituentFailureCount < incumbentAudit.outwardAxisRingSubstituentFailureCount;
  }
  const candidateHeteroRingExitPenalty = measureMixedRootHeteroRingExitPenalty(layoutGraph, candidatePlacement.coords);
  const incumbentHeteroRingExitPenalty = measureMixedRootHeteroRingExitPenalty(layoutGraph, incumbentPlacement.coords);
  if (Math.abs(candidateHeteroRingExitPenalty.maxDeviation - incumbentHeteroRingExitPenalty.maxDeviation) > IMPROVEMENT_EPSILON) {
    return candidateHeteroRingExitPenalty.maxDeviation < incumbentHeteroRingExitPenalty.maxDeviation;
  }
  if (Math.abs(candidateHeteroRingExitPenalty.totalDeviation - incumbentHeteroRingExitPenalty.totalDeviation) > IMPROVEMENT_EPSILON) {
    return candidateHeteroRingExitPenalty.totalDeviation < incumbentHeteroRingExitPenalty.totalDeviation;
  }
  const candidateTrigonalPenalty = measureMixedRootTrigonalPenalty(layoutGraph, candidatePlacement.coords);
  const incumbentTrigonalPenalty = measureMixedRootTrigonalPenalty(layoutGraph, incumbentPlacement.coords);
  if (Math.abs(candidateTrigonalPenalty.maxDeviation - incumbentTrigonalPenalty.maxDeviation) > IMPROVEMENT_EPSILON) {
    return candidateTrigonalPenalty.maxDeviation < incumbentTrigonalPenalty.maxDeviation;
  }
  if (Math.abs(candidateTrigonalPenalty.totalDeviation - incumbentTrigonalPenalty.totalDeviation) > IMPROVEMENT_EPSILON) {
    return candidateTrigonalPenalty.totalDeviation < incumbentTrigonalPenalty.totalDeviation;
  }
  const candidateExactRingExitPenalty = measureMixedRootExactRingExitPenalty(layoutGraph, candidatePlacement.coords);
  const incumbentExactRingExitPenalty = measureMixedRootExactRingExitPenalty(layoutGraph, incumbentPlacement.coords);
  if (Math.abs(candidateExactRingExitPenalty.maxDeviation - incumbentExactRingExitPenalty.maxDeviation) > IMPROVEMENT_EPSILON) {
    return candidateExactRingExitPenalty.maxDeviation < incumbentExactRingExitPenalty.maxDeviation;
  }
  if (Math.abs(candidateExactRingExitPenalty.totalDeviation - incumbentExactRingExitPenalty.totalDeviation) > IMPROVEMENT_EPSILON) {
    return candidateExactRingExitPenalty.totalDeviation < incumbentExactRingExitPenalty.totalDeviation;
  }
  if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
    return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
  }
  if (Math.abs(candidateAudit.severeOverlapPenalty - incumbentAudit.severeOverlapPenalty) > 1e-6) {
    return candidateAudit.severeOverlapPenalty < incumbentAudit.severeOverlapPenalty;
  }
  if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-6) {
    return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
  }
  if (Math.abs(candidateAudit.meanBondLengthDeviation - incumbentAudit.meanBondLengthDeviation) > 1e-6) {
    return candidateAudit.meanBondLengthDeviation < incumbentAudit.meanBondLengthDeviation;
  }
  const candidateLayoutCost = measureLayoutCost(layoutGraph, candidatePlacement.coords, bondLength);
  const incumbentLayoutCost = measureLayoutCost(layoutGraph, incumbentPlacement.coords, bondLength);
  if (Math.abs(candidateLayoutCost - incumbentLayoutCost) > IMPROVEMENT_EPSILON) {
    return candidateLayoutCost < incumbentLayoutCost;
  }
  return compareCoordMapsDeterministically(candidatePlacement.coords, incumbentPlacement.coords, canonicalAtomRank) < 0;
}

function shouldRetryMixedWithAlternateRoot(layoutGraph, scaffoldPlan, placementAudit, options = null) {
  if (options?.disableAlternateRootRetry === true || options?.conservativeAttachmentScoring === true) {
    return false;
  }
  const ringRootCandidates = scaffoldPlan?.candidates?.filter(candidate => candidate.type === 'ring-system') ?? [];
  if (ringRootCandidates.length < 2) {
    return false;
  }
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > MIXED_ROOT_RETRY_LIMITS.maxHeavyAtomCount) {
    return false;
  }
  if (!placementAudit || placementAudit.bondLengthFailureCount > 0) {
    return false;
  }
  return placementAudit.severeOverlapCount >= MIXED_ROOT_RETRY_LIMITS.minSevereOverlapCount;
}

function directAttachmentNeighborSignature(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return '';
  }
  return [
    atom.element ?? '',
    atom.aromatic === true ? 'aromatic' : 'aliphatic',
    atom.formalCharge ?? 0
  ].join(':');
}

function directAttachmentContinuationNeighborId(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return null;
  }
  if ((layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0) {
    return null;
  }

  const attachmentPosition = coords.get(attachmentAtomId);
  const parentAngle = angleOf(sub(coords.get(parentAtomId), attachmentPosition));
  const internalNeighborRecords = [];
  for (const bond of layoutGraph.bondsByAtomId.get(attachmentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === attachmentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === parentAtomId || !coords.has(neighborAtomId)) {
      continue;
    }
    internalNeighborRecords.push({
      atomId: neighborAtomId,
      deviation: angularDifference(angleOf(sub(coords.get(neighborAtomId), attachmentPosition)), parentAngle)
    });
  }
  if (internalNeighborRecords.length !== 2) {
    return null;
  }

  internalNeighborRecords.sort((firstRecord, secondRecord) => (
    firstRecord.deviation - secondRecord.deviation
    || compareCanonicalIds(firstRecord.atomId, secondRecord.atomId, layoutGraph.canonicalAtomRank)
  ));
  if (Math.abs(internalNeighborRecords[0].deviation - internalNeighborRecords[1].deviation) <= 1e-6) {
    return null;
  }
  return internalNeighborRecords[0].atomId;
}

function compareDirectAttachmentCanonicalContinuationPreference(layoutGraph, firstCoords, secondCoords, firstMeta = null, secondMeta = null) {
  if (firstMeta?.parentAtomId !== secondMeta?.parentAtomId || firstMeta?.attachmentAtomId !== secondMeta?.attachmentAtomId) {
    return 0;
  }
  const attachmentAtomId = firstMeta?.attachmentAtomId ?? null;
  if (!attachmentAtomId) {
    return 0;
  }
  const internalNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(attachmentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === attachmentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === firstMeta?.parentAtomId) {
      continue;
    }
    internalNeighborIds.push(neighborAtomId);
  }
  if (
    internalNeighborIds.length !== 2
    || directAttachmentNeighborSignature(layoutGraph, internalNeighborIds[0])
      === directAttachmentNeighborSignature(layoutGraph, internalNeighborIds[1])
  ) {
    return 0;
  }
  const firstNeighborAtomId = directAttachmentContinuationNeighborId(layoutGraph, firstCoords, firstMeta);
  const secondNeighborAtomId = directAttachmentContinuationNeighborId(layoutGraph, secondCoords, secondMeta);
  if (!firstNeighborAtomId || !secondNeighborAtomId || firstNeighborAtomId === secondNeighborAtomId) {
    return 0;
  }
  return compareCanonicalIds(firstNeighborAtomId, secondNeighborAtomId, layoutGraph.canonicalAtomRank);
}

function measureDirectAttachmentCanonicalContinuationPenalty(layoutGraph, coords, candidateMeta = null) {
  const continuationNeighborAtomId = directAttachmentContinuationNeighborId(layoutGraph, coords, candidateMeta);
  if (!continuationNeighborAtomId) {
    return 0;
  }
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!attachmentAtomId) {
    return 0;
  }
  const internalNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(attachmentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === attachmentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === candidateMeta?.parentAtomId || !coords.has(neighborAtomId)) {
      continue;
    }
    internalNeighborIds.push(neighborAtomId);
  }
  if (internalNeighborIds.length !== 2) {
    return 0;
  }
  if (
    directAttachmentNeighborSignature(layoutGraph, internalNeighborIds[0])
    === directAttachmentNeighborSignature(layoutGraph, internalNeighborIds[1])
  ) {
    return 0;
  }
  const preferredNeighborAtomId = [...internalNeighborIds].sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank))[0];
  return continuationNeighborAtomId === preferredNeighborAtomId ? 0 : 1;
}

function buildHybridBlockGraph(blocks, ringConnectionByPair) {
  const blockByRingId = new Map();
  for (const block of blocks) {
    for (const ringId of block.ringIds) {
      blockByRingId.set(ringId, block.id);
    }
  }

  const blockAdj = new Map(blocks.map(block => [block.id, []]));
  const blockConnectionByPair = new Map();
  for (const connection of ringConnectionByPair.values()) {
    if (!connection || connection.kind === 'fused') {
      continue;
    }
    const firstBlockId = blockByRingId.get(connection.firstRingId);
    const secondBlockId = blockByRingId.get(connection.secondRingId);
    if (firstBlockId == null || secondBlockId == null || firstBlockId === secondBlockId) {
      continue;
    }
    const key = firstBlockId < secondBlockId ? `${firstBlockId}:${secondBlockId}` : `${secondBlockId}:${firstBlockId}`;
    if (blockConnectionByPair.has(key)) {
      return null;
    }
    blockAdj.get(firstBlockId)?.push(secondBlockId);
    blockAdj.get(secondBlockId)?.push(firstBlockId);
    blockConnectionByPair.set(key, connection);
  }
  for (const neighbors of blockAdj.values()) {
    neighbors.sort((firstBlockId, secondBlockId) => firstBlockId - secondBlockId);
  }

  return { blockAdj, blockConnectionByPair, blockByRingId };
}

function scoreHybridBlockPlacement(layoutGraph, candidateCoords, placedCoords, sharedAtomIds, bondLength, maxSevereOverlapCount = Infinity) {
  const sharedAtomIdSet = new Set(sharedAtomIds);
  let severeOverlapCount = 0;
  let minDistance = Infinity;
  const threshold = bondLength * 0.55;

  outer: for (const [candidateAtomId, candidatePosition] of candidateCoords) {
    if (sharedAtomIdSet.has(candidateAtomId)) {
      continue;
    }
    for (const [placedAtomId, placedPosition] of placedCoords) {
      if (sharedAtomIdSet.has(placedAtomId)) {
        continue;
      }
      const key = candidateAtomId < placedAtomId ? `${candidateAtomId}:${placedAtomId}` : `${placedAtomId}:${candidateAtomId}`;
      if (layoutGraph.bondedPairSet.has(key)) {
        continue;
      }
      const distanceBetween = Math.hypot(candidatePosition.x - placedPosition.x, candidatePosition.y - placedPosition.y);
      minDistance = Math.min(minDistance, distanceBetween);
      if (distanceBetween < threshold) {
        severeOverlapCount++;
        if (severeOverlapCount > maxSevereOverlapCount) {
          break outer;
        }
      }
    }
  }

  return {
    severeOverlapCount,
    minDistance: Number.isFinite(minDistance) ? minDistance : Infinity
  };
}

function isBetterHybridBlockScore(candidateScore, incumbentScore) {
  if (!candidateScore) {
    return false;
  }
  if (!incumbentScore) {
    return true;
  }
  if (candidateScore.severeOverlapCount !== incumbentScore.severeOverlapCount) {
    return candidateScore.severeOverlapCount < incumbentScore.severeOverlapCount;
  }
  return candidateScore.minDistance > incumbentScore.minDistance;
}

function placeHybridSpiroBlock(layoutGraph, placedCoords, placedBlock, childBlock, childLayout, blockConnection, blockByRingId, bondLength) {
  const sharedAtomId = blockConnection.sharedAtomIds?.[0] ?? null;
  if (!sharedAtomId) {
    return null;
  }

  const parentRingId = blockByRingId.get(blockConnection.firstRingId) === placedBlock.id ? blockConnection.firstRingId : blockConnection.secondRingId;
  const parentRing = placedBlock.rings.find(ring => ring.id === parentRingId) ?? null;
  if (!parentRing) {
    return null;
  }

  const sharedPosition = placedCoords.get(sharedAtomId);
  const parentRingPositions = parentRing.atomIds.map(atomId => placedCoords.get(atomId)).filter(Boolean);
  if (!sharedPosition || parentRingPositions.length !== parentRing.atomIds.length) {
    return null;
  }

  const baseAngle = angleOf(sub(sharedPosition, centroid(parentRingPositions)));
  const offsets = [0, Math.PI / 6, Math.PI / 4];
  let bestCandidate = null;

  for (const offset of offsets) {
    for (const direction of [1, -1]) {
      const targetAngle = baseAngle + direction * offset;
      for (const mirror of [false, true]) {
        const transformedCoords = transformAttachedBlock(childLayout.coords, sharedAtomId, sharedPosition, targetAngle, { mirror });
        const score = scoreHybridBlockPlacement(layoutGraph, transformedCoords, placedCoords, [sharedAtomId], bondLength, bestCandidate?.score.severeOverlapCount ?? Infinity);
        if (!bestCandidate || isBetterHybridBlockScore(score, bestCandidate.score)) {
          bestCandidate = {
            coords: transformedCoords,
            score
          };
        }
      }
    }
  }

  return bestCandidate;
}

/**
 * Returns the two terminal atoms for one contiguous shared ring boundary segment.
 * @param {string[]} atomIds - Ordered cyclic ring atom IDs.
 * @param {string[]} sharedAtomIds - Shared ring-boundary atom IDs.
 * @returns {[string, string]|null} Segment endpoints or `null` when the shared boundary is not one contiguous segment.
 */
function sharedBoundarySegmentEndpoints(atomIds, sharedAtomIds) {
  const sharedAtomIdSet = new Set(sharedAtomIds);
  const sharedIndices = atomIds
    .map((atomId, index) => (sharedAtomIdSet.has(atomId) ? index : -1))
    .filter(index => index >= 0);
  if (sharedIndices.length < 2) {
    return null;
  }

  const sharedIndexSet = new Set(sharedIndices);
  const segmentEndpoints = [];
  for (const index of sharedIndices) {
    const previousShared = sharedIndexSet.has((index - 1 + atomIds.length) % atomIds.length);
    const nextShared = sharedIndexSet.has((index + 1) % atomIds.length);
    if (previousShared === nextShared) {
      continue;
    }
    segmentEndpoints.push(atomIds[index]);
  }

  return segmentEndpoints.length === 2 ? [segmentEndpoints[0], segmentEndpoints[1]] : null;
}

/**
 * Builds an exact mirrored-path candidate for a single child ring that shares a
 * contiguous multi-atom bridge with an already placed parent ring.
 * Reflecting the parent ring's non-shared arc across the shared endpoints keeps
 * all bridge atoms fixed while avoiding the collapsed regular-ring overlay that
 * a rigid single-ring alignment can otherwise produce.
 * @param {object} placedCoords - Already placed ring-block coordinates.
 * @param {object} placedBlock - Block that is already fixed in the hybrid layout.
 * @param {object} childBlock - Single-ring child block being attached.
 * @param {{sharedAtomIds?: string[], firstRingId: number, secondRingId: number}} blockConnection - Hybrid block connection descriptor.
 * @param {Map<number, number>} blockByRingId - Ring-to-block ownership map.
 * @returns {Map<string, {x: number, y: number}>|null} Mirrored child-ring coordinates or `null` when the topology is not eligible.
 */
function buildMirroredSingleRingBridgedCandidate(placedCoords, placedBlock, childBlock, blockConnection, blockByRingId) {
  if (childBlock.rings.length !== 1 || (blockConnection.sharedAtomIds?.length ?? 0) < 3) {
    return null;
  }

  const parentRingId = blockByRingId.get(blockConnection.firstRingId) === placedBlock.id ? blockConnection.firstRingId : blockConnection.secondRingId;
  const childRingId = parentRingId === blockConnection.firstRingId ? blockConnection.secondRingId : blockConnection.firstRingId;
  const parentRing = placedBlock.rings.find(ring => ring.id === parentRingId) ?? null;
  const childRing = childBlock.rings.find(ring => ring.id === childRingId) ?? null;
  if (!parentRing || !childRing) {
    return null;
  }

  const segmentEndpoints = sharedBoundarySegmentEndpoints(childRing.atomIds, blockConnection.sharedAtomIds ?? []);
  if (!segmentEndpoints) {
    return null;
  }
  const [firstSharedAtomId, secondSharedAtomId] = segmentEndpoints;
  if (!placedCoords.has(firstSharedAtomId) || !placedCoords.has(secondSharedAtomId)) {
    return null;
  }

  const parentPath = nonSharedPath(parentRing.atomIds, firstSharedAtomId, secondSharedAtomId);
  const childPath = nonSharedPath(childRing.atomIds, firstSharedAtomId, secondSharedAtomId);
  const sharedAtomIdSet = new Set(blockConnection.sharedAtomIds ?? []);
  if (
    parentPath.length !== childPath.length
    || childPath.length !== 4
    || parentPath.slice(1, -1).some(atomId => sharedAtomIdSet.has(atomId))
    || childPath.slice(1, -1).some(atomId => sharedAtomIdSet.has(atomId))
  ) {
    return null;
  }

  const firstSharedPosition = placedCoords.get(firstSharedAtomId);
  const secondSharedPosition = placedCoords.get(secondSharedAtomId);
  const mirroredCoords = new Map();
  for (const atomId of blockConnection.sharedAtomIds ?? []) {
    const position = placedCoords.get(atomId);
    if (!position) {
      return null;
    }
    mirroredCoords.set(atomId, position);
  }

  for (let index = 1; index < childPath.length - 1; index++) {
    const parentPathPosition = placedCoords.get(parentPath[index]);
    if (!parentPathPosition) {
      return null;
    }
    mirroredCoords.set(
      childPath[index],
      reflectAcrossLine(parentPathPosition, firstSharedPosition, secondSharedPosition)
    );
  }

  return mirroredCoords.size === childBlock.atomIds.length ? mirroredCoords : null;
}

function placeHybridBridgedBlock(layoutGraph, placedCoords, placedBlock, childBlock, childLayout, blockConnection, blockByRingId, bondLength) {
  const sharedAtomIds = (blockConnection.sharedAtomIds ?? []).filter(atomId => placedCoords.has(atomId) && childLayout.coords.has(atomId));
  if (sharedAtomIds.length < 2) {
    return null;
  }

  const fixedCoords = new Map(sharedAtomIds.map(atomId => [atomId, placedCoords.get(atomId)]));
  const aligned = alignCoordsToFixed(childLayout.coords, childBlock.atomIds, fixedCoords);
  let bestCandidate = {
    coords: aligned.coords,
    score: scoreHybridBlockPlacement(layoutGraph, aligned.coords, placedCoords, sharedAtomIds, bondLength)
  };

  if (bestCandidate.score.severeOverlapCount > 0) {
    const mirroredCoords = buildMirroredSingleRingBridgedCandidate(placedCoords, placedBlock, childBlock, blockConnection, blockByRingId);
    if (mirroredCoords) {
      const mirroredCandidate = {
        coords: mirroredCoords,
        score: scoreHybridBlockPlacement(layoutGraph, mirroredCoords, placedCoords, sharedAtomIds, bondLength, bestCandidate.score.severeOverlapCount)
      };
      if (isBetterHybridBlockScore(mirroredCandidate.score, bestCandidate.score)) {
        bestCandidate = mirroredCandidate;
      }
    }
  }

  return bestCandidate;
}

function layoutFusedConnectedHybridRingSystem(layoutGraph, rings, ringAdj, ringConnectionByPair, bondLength) {
  const blocks = buildFusedRingBlocks(rings, ringAdj, ringConnectionByPair);
  if (blocks.length === 0) {
    return null;
  }

  if (blocks.length === 1) {
    return layoutFusedFamily(rings, blocks[0].ringAdj, blocks[0].ringConnectionByPair, bondLength, { layoutGraph, templateId: null });
  }

  const blockGraph = buildHybridBlockGraph(blocks, ringConnectionByPair);
  if (!blockGraph || blockGraph.blockConnectionByPair.size !== blocks.length - 1) {
    return null;
  }

  const visitedBlockIds = new Set();
  const traversalQueue = [];
  const rootBlock = [...blocks].sort((firstBlock, secondBlock) => {
    if (secondBlock.atomIds.length !== firstBlock.atomIds.length) {
      return secondBlock.atomIds.length - firstBlock.atomIds.length;
    }
    return secondBlock.ringIds.length - firstBlock.ringIds.length;
  })[0];
  const rootLayout = layoutFusedFamily(rootBlock.rings, rootBlock.ringAdj, rootBlock.ringConnectionByPair, bondLength, {
    layoutGraph,
    templateId: null
  });
  if (!rootLayout || rootLayout.coords.size !== rootBlock.atomIds.length) {
    return null;
  }

  const coords = new Map(rootLayout.coords);
  const ringCenters = new Map();
  for (const ring of rootBlock.rings) {
    ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => coords.get(atomId))));
  }
  visitedBlockIds.add(rootBlock.id);
  traversalQueue.push(rootBlock.id);

  while (traversalQueue.length > 0) {
    const currentBlockId = traversalQueue.shift();
    const currentBlock = blocks.find(block => block.id === currentBlockId) ?? null;
    if (!currentBlock) {
      return null;
    }

    for (const neighborBlockId of blockGraph.blockAdj.get(currentBlockId) ?? []) {
      if (visitedBlockIds.has(neighborBlockId)) {
        continue;
      }
      const neighborBlock = blocks.find(block => block.id === neighborBlockId) ?? null;
      if (!neighborBlock) {
        return null;
      }
      const connectionKey = currentBlockId < neighborBlockId ? `${currentBlockId}:${neighborBlockId}` : `${neighborBlockId}:${currentBlockId}`;
      const blockConnection = blockGraph.blockConnectionByPair.get(connectionKey);
      const neighborLayout = layoutFusedFamily(neighborBlock.rings, neighborBlock.ringAdj, neighborBlock.ringConnectionByPair, bondLength, { layoutGraph, templateId: null });
      if (!blockConnection || !neighborLayout || neighborLayout.coords.size !== neighborBlock.atomIds.length) {
        return null;
      }

      let placedCandidate = null;
      if (blockConnection.kind === 'spiro') {
        placedCandidate = placeHybridSpiroBlock(layoutGraph, coords, currentBlock, neighborBlock, neighborLayout, blockConnection, blockGraph.blockByRingId, bondLength);
      } else if (blockConnection.kind === 'bridged') {
        placedCandidate = placeHybridBridgedBlock(layoutGraph, coords, currentBlock, neighborBlock, neighborLayout, blockConnection, blockGraph.blockByRingId, bondLength);
      }
      if (!placedCandidate) {
        return null;
      }

      for (const [atomId, position] of placedCandidate.coords) {
        coords.set(atomId, position);
      }
      for (const ring of neighborBlock.rings) {
        ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => coords.get(atomId))));
      }

      visitedBlockIds.add(neighborBlockId);
      traversalQueue.push(neighborBlockId);
    }
  }

  const atomIds = new Set(rings.flatMap(ring => ring.atomIds));
  if (coords.size !== atomIds.size) {
    return null;
  }

  return {
    coords,
    ringCenters,
    placementMode: 'constructed'
  };
}

function wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, result, templateId = null) {
  if (!result) {
    return null;
  }
  return {
    family,
    validationClass: resolvePlacementValidationClass(family, result.placementMode, templateId),
    ...result
  };
}

function auditRingSystemPlacement(layoutGraph, ringSystem, placement, bondLength) {
  if (!placement || placement.coords.size !== ringSystem.atomIds.length) {
    return null;
  }
  const bondValidationClasses = assignBondValidationClass(layoutGraph, ringSystem.atomIds, placement.validationClass);
  return auditLayout(layoutGraph, placement.coords, {
    bondLength,
    bondValidationClasses
  });
}

function isBetterRingSystemPlacement(candidatePlacement, incumbentPlacement, candidateAudit, incumbentAudit, bondFirst = false) {
  if (!candidatePlacement || !candidateAudit) {
    return false;
  }
  if (!incumbentPlacement || !incumbentAudit) {
    return true;
  }
  if (bondFirst) {
    if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
      return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
    }
    if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
      return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
    }
    if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
      return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
    }
  } else {
    if (candidateAudit.severeOverlapCount !== incumbentAudit.severeOverlapCount) {
      return candidateAudit.severeOverlapCount < incumbentAudit.severeOverlapCount;
    }
    if (candidateAudit.bondLengthFailureCount !== incumbentAudit.bondLengthFailureCount) {
      return candidateAudit.bondLengthFailureCount < incumbentAudit.bondLengthFailureCount;
    }
    if (Math.abs(candidateAudit.maxBondLengthDeviation - incumbentAudit.maxBondLengthDeviation) > 1e-9) {
      return candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation;
    }
  }
  return candidatePlacement.placementMode !== incumbentPlacement.placementMode;
}

function shouldTryCompactBridgedRingSystemRescue(ringSystem, templateId, audit) {
  if (templateId || !audit) {
    return false;
  }
  return (
    ringSystem.atomIds.length <= RING_SYSTEM_RESCUE_LIMITS.compactBridgedAtomCount &&
    ringSystem.ringIds.length <= RING_SYSTEM_RESCUE_LIMITS.compactBridgedRingCount &&
    (audit.severeOverlapCount > 0 || audit.bondLengthFailureCount > 0)
  );
}

function shouldTryBridgedRingSystemRescue(ringSystem, templateId, audit) {
  if (templateId || !audit) {
    return false;
  }
  return (
    ringSystem.atomIds.length >= RING_SYSTEM_RESCUE_LIMITS.bridgedTemplateMissAtomCount &&
    ringSystem.ringIds.length >= RING_SYSTEM_RESCUE_LIMITS.bridgedTemplateMissRingCount &&
    (audit.severeOverlapCount > 0 || audit.bondLengthFailureCount > 0)
  );
}

/**
 * Lays out one ring system inside a mixed scaffold and resolves its audit class.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Ring-system descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {string|null} [templateId] - Matched template ID.
 * @returns {{family: string, validationClass: 'planar'|'bridged', coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null} Ring-system layout result.
 */
function layoutRingSystem(layoutGraph, ringSystem, bondLength, templateId = null) {
  const family = classifyRingSystemFamily(layoutGraph, ringSystem);
  const { rings, connections, ringAdj, ringConnectionByPair } = ringSystemAdjacency(layoutGraph, ringSystem);
  if (family === 'isolated-ring') {
    return wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutIsolatedRingFamily(rings[0], bondLength, { layoutGraph, templateId }), templateId);
  }
  if (family === 'macrocycle') {
    return wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutMacrocycleFamily(rings, bondLength, { layoutGraph, templateId }), templateId);
  }
  if (family === 'bridged') {
    const connectionKinds = new Set(connections.map(connection => connection.kind).filter(Boolean));
    let bestPlacement = wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutBridgedFamily(rings, bondLength, { layoutGraph, templateId }), templateId);
    let bestAudit = auditRingSystemPlacement(layoutGraph, ringSystem, bestPlacement, bondLength);

    if (connectionKinds.has('fused') && (connectionKinds.has('spiro') || connectionKinds.has('bridged'))) {
      const hybridRescuePlacement = wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutFusedConnectedHybridRingSystem(layoutGraph, rings, ringAdj, ringConnectionByPair, bondLength),
        templateId
      );
      const hybridRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, hybridRescuePlacement, bondLength);
      if (isBetterRingSystemPlacement(hybridRescuePlacement, bestPlacement, hybridRescueAudit, bestAudit, true)) {
        bestPlacement = hybridRescuePlacement;
        bestAudit = hybridRescueAudit;
      }
    }

    if (shouldTryCompactBridgedRingSystemRescue(ringSystem, templateId, bestAudit)) {
      const fusedRescuePlacement = wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutFusedFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
        templateId
      );
      const fusedRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, fusedRescuePlacement, bondLength);
      if (isBetterRingSystemPlacement(fusedRescuePlacement, bestPlacement, fusedRescueAudit, bestAudit, true)) {
        bestPlacement = fusedRescuePlacement;
        bestAudit = fusedRescueAudit;
      }
    }

    if (!shouldTryBridgedRingSystemRescue(ringSystem, templateId, bestAudit)) {
      return bestPlacement;
    }

    const spiroRescuePlacement = wrapRingSystemPlacementResult(
      layoutGraph,
      ringSystem,
      family,
      layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
      templateId
    );
    const spiroRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, spiroRescuePlacement, bondLength);
    return isBetterRingSystemPlacement(spiroRescuePlacement, bestPlacement, spiroRescueAudit, bestAudit) ? spiroRescuePlacement : bestPlacement;
  }
  if (family === 'fused') {
    if (shouldShortCircuitToFusedCageKk(ringSystem.atomIds.length, ringSystem.ringIds.length, templateId)) {
      return wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutFusedCageKamadaKawai(rings, bondLength, { layoutGraph, templateId }) ??
          layoutFusedFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
        templateId
      );
    }

    let bestPlacement = wrapRingSystemPlacementResult(
      layoutGraph,
      ringSystem,
      family,
      layoutFusedFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
      templateId
    );
    let bestAudit = auditRingSystemPlacement(layoutGraph, ringSystem, bestPlacement, bondLength);
    if (shouldTryBridgedRescueForFusedSystem(ringSystem.atomIds.length, ringSystem.ringIds.length, templateId, bestAudit)) {
      const bridgedRescuePlacement = wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutBridgedFamily(rings, bondLength, { layoutGraph, templateId }),
        templateId
      );
      const bridgedRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, bridgedRescuePlacement, bondLength);
      if (isBetterBridgedRescueForFusedSystem(bridgedRescueAudit, bestAudit)) {
        bestPlacement = bridgedRescuePlacement;
        bestAudit = bridgedRescueAudit;
      }

      const cageKkPlacement = wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutFusedCageKamadaKawai(rings, bondLength, { layoutGraph, templateId }),
        templateId
      );
      const cageKkAudit = auditRingSystemPlacement(layoutGraph, ringSystem, cageKkPlacement, bondLength);
      if (isBetterBridgedRescueForFusedSystem(cageKkAudit, bestAudit)) {
        bestPlacement = cageKkPlacement;
      }
    }
    return bestPlacement;
  }
  if (family === 'spiro') {
    return wrapRingSystemPlacementResult(
      layoutGraph,
      ringSystem,
      family,
      layoutSpiroFamily(rings, ringAdj, ringConnectionByPair, bondLength, { layoutGraph, templateId }),
      templateId
    );
  }
  return null;
}

/**
 * Scores one pending-ring attachment candidate. When a rigid pending ring can
 * dock through multiple already placed neighbors, prefer the anchor that does
 * not consume a stricter local ring-exit geometry that branch placement could
 * still realize later, such as exocyclic trigonal alkene roots or small-ring
 * exterior continuations.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} attachmentAtomId - Pending ring-system atom ID.
 * @param {string} parentAtomId - Already placed neighbor atom ID.
 * @returns {{sensitiveAttachmentPenalty: number, parentIsRingPenalty: number, attachmentRank: number, parentRank: number}} Attachment priority tuple.
 */
function pendingRingAttachmentPriority(layoutGraph, attachmentAtomId, parentAtomId) {
  const sensitiveAttachmentPenalty =
    (isExactRingTrigonalBisectorEligible(layoutGraph, attachmentAtomId, parentAtomId) ? 1 : 0)
    + (isExactSmallRingExteriorContinuationEligible(layoutGraph, attachmentAtomId, parentAtomId) ? 1 : 0);
  const parentIsRingPenalty = (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0 ? 0 : 1;
  return {
    sensitiveAttachmentPenalty,
    parentIsRingPenalty,
    attachmentRank: layoutGraph.canonicalAtomRank.get(attachmentAtomId) ?? Number.MAX_SAFE_INTEGER,
    parentRank: layoutGraph.canonicalAtomRank.get(parentAtomId) ?? Number.MAX_SAFE_INTEGER
  };
}

/**
 * Chooses the placed-parent bond used to dock a pending ring system onto the
 * current mixed-family layout.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Pending ring-system descriptor.
 * @param {Set<string>} placedAtomIds - Already placed atom IDs.
 * @returns {{attachmentAtomId: string, parentAtomId: string}|null} Selected attachment bond or `null`.
 */
function findAttachmentBond(layoutGraph, ringSystem, placedAtomIds) {
  const ringAtomIdSet = new Set(ringSystem.atomIds);
  const orderedAtomIds = [...ringSystem.atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
  const candidates = [];
  for (const atomId of orderedAtomIds) {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    const orderedBondIds = [...atom.bonds].sort((firstBondId, secondBondId) => String(firstBondId).localeCompare(String(secondBondId), 'en', { numeric: true }));
    for (const bondId of orderedBondIds) {
      const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherAtomId = bond.getOtherAtom(atomId);
      if (ringAtomIdSet.has(otherAtomId) || !placedAtomIds.has(otherAtomId)) {
        continue;
      }
      candidates.push({
        attachmentAtomId: atomId,
        parentAtomId: otherAtomId
      });
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((firstCandidate, secondCandidate) => {
    const firstPriority = pendingRingAttachmentPriority(layoutGraph, firstCandidate.attachmentAtomId, firstCandidate.parentAtomId);
    const secondPriority = pendingRingAttachmentPriority(layoutGraph, secondCandidate.attachmentAtomId, secondCandidate.parentAtomId);
    return (
      firstPriority.sensitiveAttachmentPenalty - secondPriority.sensitiveAttachmentPenalty
      || firstPriority.parentIsRingPenalty - secondPriority.parentIsRingPenalty
      || firstPriority.attachmentRank - secondPriority.attachmentRank
      || firstPriority.parentRank - secondPriority.parentRank
      || compareCanonicalIds(firstCandidate.attachmentAtomId, secondCandidate.attachmentAtomId, layoutGraph.canonicalAtomRank)
      || compareCanonicalIds(firstCandidate.parentAtomId, secondCandidate.parentAtomId, layoutGraph.canonicalAtomRank)
    );
  });
  return candidates[0];
}

/**
 * Returns ring-system atom IDs in canonical order.
 * @param {Iterable<string>} atomIds - Atom IDs to sort.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom-rank map.
 * @returns {string[]} Canonically sorted atom IDs.
 */
function sortAtomIds(atomIds, canonicalAtomRank) {
  return [...atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank));
}

/**
 * Detects the shortest short non-ring linker between a placed ring system and a pending ring system.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} pendingRingSystem - Pending ring-system descriptor.
 * @param {Set<number>} placedRingSystemIds - Already placed ring-system IDs.
 * @param {Set<string>} participantAtomIds - Visible component atom IDs.
 * @param {Map<string, number>} atomToRingSystemId - Atom-to-ring-system lookup.
 * @param {number} [maxLinkerAtoms] - Maximum internal non-ring linker atoms to consider.
 * @returns {{firstAttachmentAtomId: string, firstRingSystemId: number, chainAtomIds: string[], secondAttachmentAtomId: string}|null} Shortest linker descriptor.
 */
function findShortestRingLinker(layoutGraph, pendingRingSystem, placedRingSystemIds, participantAtomIds, atomToRingSystemId, maxLinkerAtoms = MAX_RING_LINKER_ATOMS) {
  const pendingRingAtomIds = new Set(pendingRingSystem.atomIds);
  const canonicalAtomRank = layoutGraph.canonicalAtomRank;
  const orderedPendingAttachmentIds = sortAtomIds(pendingRingSystem.atomIds, canonicalAtomRank);
  const queue = [];
  let queueHead = 0;
  const visited = new Map();

  for (const secondAttachmentAtomId of orderedPendingAttachmentIds) {
    const atom = layoutGraph.sourceMolecule.atoms.get(secondAttachmentAtomId);
    if (!atom) {
      continue;
    }
    const orderedNeighborIds = atom
      .getNeighbors(layoutGraph.sourceMolecule)
      .filter(neighborAtom => neighborAtom && participantAtomIds.has(neighborAtom.id))
      .map(neighborAtom => neighborAtom.id)
      .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank));

    for (const neighborAtomId of orderedNeighborIds) {
      if (pendingRingAtomIds.has(neighborAtomId)) {
        continue;
      }
      const neighborRingSystemId = atomToRingSystemId.get(neighborAtomId);
      if (neighborRingSystemId != null) {
        if (placedRingSystemIds.has(neighborRingSystemId) && neighborRingSystemId !== pendingRingSystem.id) {
          return {
            firstAttachmentAtomId: neighborAtomId,
            firstRingSystemId: neighborRingSystemId,
            chainAtomIds: [],
            secondAttachmentAtomId
          };
        }
        continue;
      }

      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }

      const visitKey = `${secondAttachmentAtomId}:${neighborAtomId}`;
      visited.set(visitKey, 1);
      queue.push({
        atomId: neighborAtomId,
        chainAtomIds: [neighborAtomId],
        secondAttachmentAtomId
      });
    }
  }

  while (queueHead < queue.length) {
    const current = queue[queueHead++];
    const atom = layoutGraph.sourceMolecule.atoms.get(current.atomId);
    if (!atom) {
      continue;
    }
    const orderedNeighborIds = atom
      .getNeighbors(layoutGraph.sourceMolecule)
      .filter(neighborAtom => neighborAtom && participantAtomIds.has(neighborAtom.id))
      .map(neighborAtom => neighborAtom.id)
      .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, canonicalAtomRank));

    for (const neighborAtomId of orderedNeighborIds) {
      if (neighborAtomId === current.secondAttachmentAtomId || current.chainAtomIds.includes(neighborAtomId)) {
        continue;
      }
      const neighborRingSystemId = atomToRingSystemId.get(neighborAtomId);
      if (neighborRingSystemId != null) {
        if (placedRingSystemIds.has(neighborRingSystemId) && neighborRingSystemId !== pendingRingSystem.id) {
          return {
            firstAttachmentAtomId: neighborAtomId,
            firstRingSystemId: neighborRingSystemId,
            chainAtomIds: [...current.chainAtomIds].reverse(),
            secondAttachmentAtomId: current.secondAttachmentAtomId
          };
        }
        continue;
      }

      if (current.chainAtomIds.length >= maxLinkerAtoms) {
        continue;
      }

      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }

      const visitKey = `${current.secondAttachmentAtomId}:${neighborAtomId}`;
      const candidateLength = current.chainAtomIds.length + 1;
      if ((visited.get(visitKey) ?? Number.POSITIVE_INFINITY) <= candidateLength) {
        continue;
      }
      visited.set(visitKey, candidateLength);
      queue.push({
        atomId: neighborAtomId,
        chainAtomIds: [...current.chainAtomIds, neighborAtomId],
        secondAttachmentAtomId: current.secondAttachmentAtomId
      });
    }
  }

  return null;
}

/**
 * Builds the alternating segment directions for a short ring-to-ring linker.
 * @param {number} exitAngle - Outward angle from the first ring system.
 * @param {number} segmentCount - Number of bond segments from the first ring to the second ring.
 * @param {number} turnSign - Zigzag turn sign (`-1` or `1`).
 * @returns {number[]} Segment directions in radians.
 */
function linkerSegmentAngles(exitAngle, segmentCount, turnSign) {
  const segmentAngles = [];
  for (let index = 0; index < segmentCount; index++) {
    segmentAngles.push(index % 2 === 0 ? exitAngle : exitAngle + turnSign * LINKER_ZIGZAG_TURN_ANGLE);
  }
  return segmentAngles;
}

/**
 * Returns the outward exit angle for a ring-system attachment atom.
 * Single-ring perimeter atoms follow their local ring outward axis; fused/shared
 * atoms fall back to the whole ring-system centroid.
 * Pass `checkHeavyAtomLimit: true` when operating on a detached block layout to
 * skip the computation for molecules that exceed the exact-search atom limit.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map (placed or detached block).
 * @param {object} ringSystem - Ring-system descriptor.
 * @param {string} attachmentAtomId - Attachment atom ID.
 * @param {{checkHeavyAtomLimit?: boolean}} [options] - Options object.
 * @returns {number|null} Outward exit angle in radians.
 */
function ringLinkerExitAngle(layoutGraph, coords, ringSystem, attachmentAtomId, { checkHeavyAtomLimit = false } = {}) {
  if (checkHeavyAtomLimit && (layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return null;
  }
  const attachmentPosition = coords.get(attachmentAtomId);
  if (!attachmentPosition) {
    return null;
  }
  const attachmentRings = layoutGraph.atomToRings.get(attachmentAtomId) ?? [];
  if (attachmentRings.length === 1) {
    const ringPositions = attachmentRings[0].atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    if (ringPositions.length >= 3) {
      return angleOf(sub(attachmentPosition, centroid(ringPositions)));
    }
  }
  const ringSystemPositions = ringSystem.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
  return ringSystemPositions.length >= 3 ? angleOf(sub(attachmentPosition, centroid(ringSystemPositions))) : null;
}

/**
 * Returns whether a detected ring linker is a short single-bond connector suited
 * to the dedicated mixed-family linker placement path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} firstRingSystem - Already placed ring-system descriptor.
 * @param {object} secondRingSystem - Pending ring-system descriptor.
 * @param {object} linker - Linker descriptor.
 * @returns {boolean} True when the linker should use the dedicated short-linker path.
 */
function isSupportedRingLinker(layoutGraph, firstRingSystem, secondRingSystem, linker) {
  const ringSystemIsAromatic = ringSystem => (layoutGraph.rings ?? []).filter(ring => ringSystem.ringIds.includes(ring.id)).every(ring => ring.aromatic);
  const ringSystemHasAromaticRing = ringSystem => (layoutGraph.rings ?? []).filter(ring => ringSystem.ringIds.includes(ring.id)).some(ring => ring.aromatic);
  const ringSystemSupportsShortLinkerRoot = (ringSystem, { allowFused = false } = {}) => {
    const family = classifyRingSystemFamily(layoutGraph, ringSystem);
    if (family === 'isolated-ring') {
      return ringSystemIsAromatic(ringSystem);
    }
    if (!allowFused || family !== 'fused' || !ringSystemIsAromatic(ringSystem)) {
      return false;
    }
    const connectionKinds = ringSystemConnectionKinds(layoutGraph, ringSystem);
    return connectionKinds.size > 0 && [...connectionKinds].every(kind => kind === 'fused');
  };
  const ringSystemSupportsFusedMethyleneLinkerRoot = (ringSystem, attachmentAtomId) => {
    if (linker.chainAtomIds.length !== 1) {
      return false;
    }
    const chainAtom = layoutGraph.atoms.get(linker.chainAtomIds[0]);
    if (!chainAtom || chainAtom.element !== 'C' || chainAtom.aromatic || chainAtom.heavyDegree !== 2) {
      return false;
    }
    if ((layoutGraph.atomToRings.get(attachmentAtomId) ?? []).length !== 1) {
      return false;
    }
    if (classifyRingSystemFamily(layoutGraph, ringSystem) !== 'fused' || !ringSystemHasAromaticRing(ringSystem)) {
      return false;
    }
    const connectionKinds = ringSystemConnectionKinds(layoutGraph, ringSystem);
    return connectionKinds.size > 0 && [...connectionKinds].every(kind => kind === 'fused');
  };
  const secondRingAllowsNonAromaticIsolated =
    classifyRingSystemFamily(layoutGraph, secondRingSystem) === 'isolated-ring'
    && !ringSystemIsAromatic(secondRingSystem)
    && linker.chainAtomIds.length >= 2;
  const firstRingSupportsLinker =
    ringSystemSupportsShortLinkerRoot(firstRingSystem, { allowFused: true })
    || ringSystemSupportsFusedMethyleneLinkerRoot(firstRingSystem, linker.firstAttachmentAtomId);
  const secondRingSupportsLinker =
    ringSystemSupportsShortLinkerRoot(secondRingSystem)
    || secondRingAllowsNonAromaticIsolated
    || ringSystemSupportsFusedMethyleneLinkerRoot(secondRingSystem, linker.secondAttachmentAtomId);
  if (
    !firstRingSupportsLinker
    || !secondRingSupportsLinker
  ) {
    return false;
  }

  const pathAtomIds = [linker.firstAttachmentAtomId, ...linker.chainAtomIds, linker.secondAttachmentAtomId];
  for (let index = 0; index < pathAtomIds.length - 1; index++) {
    const [a, b] = [pathAtomIds[index], pathAtomIds[index + 1]];
    const bond = layoutGraph.bondByAtomPair.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? null;
    if (!bond || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
  }

  const chainAtomSupportsShortLinker = (chainAtomId, previousAtomId, nextAtomId) => {
    const chainAtom = layoutGraph.sourceMolecule.atoms.get(chainAtomId);
    const heavyNeighborIds = chainAtom?.getNeighbors(layoutGraph.sourceMolecule)
      .filter(neighborAtom => neighborAtom && neighborAtom.name !== 'H')
      .map(neighborAtom => neighborAtom.id) ?? [];
    if (!heavyNeighborIds.includes(previousAtomId) || !heavyNeighborIds.includes(nextAtomId)) {
      return false;
    }
    if (heavyNeighborIds.length === 2) {
      return true;
    }
    if (heavyNeighborIds.length !== 3) {
      return false;
    }
    const terminalMultipleNeighborId = heavyNeighborIds.find(
      neighborAtomId => neighborAtomId !== previousAtomId && neighborAtomId !== nextAtomId
    ) ?? null;
    const terminalMultipleBond = terminalMultipleNeighborId
      ? findLayoutBond(layoutGraph, chainAtomId, terminalMultipleNeighborId)
      : null;
    return isTerminalMultipleBondLeaf(layoutGraph, chainAtomId, terminalMultipleBond);
  };

  for (let index = 0; index < linker.chainAtomIds.length; index++) {
    if (!chainAtomSupportsShortLinker(pathAtomIds[index + 1], pathAtomIds[index], pathAtomIds[index + 2])) {
      return false;
    }
  }
  return true;
}

/**
 * Builds candidate coordinates for a short ring-to-ring linker plus the attached ring system.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {object} firstRingSystem - Already placed ring-system descriptor.
 * @param {object} linker - Linker descriptor.
 * @param {object} secondRingSystem - Pending ring-system descriptor.
 * @param {Map<string, {x: number, y: number}>} blockCoords - Pending ring-system coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {number} turnSign - Zigzag turn sign (`-1` or `1`).
 * @param {boolean} mirror - Whether to mirror the attached ring block.
 * @param {number} [ringRotationOffset] - Additional rotation offset (radians) applied to the ring block around the attachment bond.
 * @param {number} [placedRingRotationOffset] - Additional rotation offset (radians) applied to the already placed ring block around its linker atom.
 * @returns {Map<string, {x: number, y: number}>} Candidate linker plus ring coordinates.
 */
function buildRingLinkerCandidate(layoutGraph, coords, firstRingSystem, linker, secondRingSystem, blockCoords, bondLength, turnSign, mirror, ringRotationOffset = 0, placedRingRotationOffset = 0) {
  const firstAttachmentPosition = coords.get(linker.firstAttachmentAtomId);
  const exitAngle = ringLinkerExitAngle(layoutGraph, coords, firstRingSystem, linker.firstAttachmentAtomId);
  const fallbackRingCenter = centroid(firstRingSystem.atomIds.map(atomId => coords.get(atomId)).filter(Boolean));
  const resolvedExitAngle = exitAngle ?? angleOf(sub(firstAttachmentPosition, fallbackRingCenter));
  const segmentAngles = linkerSegmentAngles(resolvedExitAngle, linker.chainAtomIds.length + 1, turnSign);
  const candidateCoords = new Map();
  let currentPosition = firstAttachmentPosition;

  for (let index = 0; index < segmentAngles.length; index++) {
    currentPosition = add(currentPosition, fromAngle(segmentAngles[index], bondLength));
    if (index < linker.chainAtomIds.length) {
      candidateCoords.set(linker.chainAtomIds[index], currentPosition);
    }
  }

  const detachedAttachmentPosition = blockCoords.get(linker.secondAttachmentAtomId);
  const detachedRingCenter = centroid([...blockCoords.values()]);
  const detachedCentroidAngle =
    detachedAttachmentPosition && detachedRingCenter
      ? angleOf(sub(detachedRingCenter, detachedAttachmentPosition))
      : 0;
  const detachedExitAngle = ringLinkerExitAngle(layoutGraph, blockCoords, secondRingSystem, linker.secondAttachmentAtomId, { checkHeavyAtomLimit: true });
  const outwardAlignmentOffset = detachedExitAngle == null ? 0 : detachedCentroidAngle - detachedExitAngle;
  const transformedRingCoords = transformAttachedBlock(
    blockCoords,
    linker.secondAttachmentAtomId,
    currentPosition,
    segmentAngles[segmentAngles.length - 1] + outwardAlignmentOffset + ringRotationOffset,
    {
      mirror
    }
  );
  for (const [atomId, position] of transformedRingCoords) {
    candidateCoords.set(atomId, position);
  }
  if (Math.abs(placedRingRotationOffset) > 1e-9) {
    for (const atomId of firstRingSystem.atomIds) {
      const position = coords.get(atomId);
      if (!position) {
        continue;
      }
      candidateCoords.set(
        atomId,
        add(firstAttachmentPosition, rotate(sub(position, firstAttachmentPosition), placedRingRotationOffset))
      );
    }
  }
  return candidateCoords;
}

function normalizeRotationOffset(offset) {
  let normalizedOffset = offset;
  while (normalizedOffset <= -Math.PI) {
    normalizedOffset += 2 * Math.PI;
  }
  while (normalizedOffset > Math.PI) {
    normalizedOffset -= 2 * Math.PI;
  }
  return normalizedOffset;
}

function describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, attachmentAtomId) {
  if (!layoutGraph) {
    return null;
  }

  const atom = layoutGraph.atoms.get(attachmentAtomId);
  if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4) {
    return null;
  }

  const anchorRings = layoutGraph.atomToRings.get(attachmentAtomId) ?? [];
  if (anchorRings.length !== 1) {
    return null;
  }
  const ring = anchorRings[0];
  if ((ring?.atomIds?.length ?? 0) < 3 || (ring?.atomIds?.length ?? 0) > 5) {
    return null;
  }

  const ringNeighborIds = [];
  const exocyclicNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(attachmentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return null;
    }
    const neighborAtomId = bond.a === attachmentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (ring.atomIds.includes(neighborAtomId)) {
      ringNeighborIds.push(neighborAtomId);
      continue;
    }
    exocyclicNeighborIds.push(neighborAtomId);
  }

  return ringNeighborIds.length === 2 && exocyclicNeighborIds.length === 2 ? { ringNeighborIds, exocyclicNeighborIds } : null;
}

/**
 * Returns exact rotation offsets for a directly attached small-ring block whose
 * attachment atom has two ring bonds and two exocyclic heavy exits.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} blockCoords - Detached block coordinate map.
 * @param {string} attachmentAtomId - Ring atom used to attach the block.
 * @returns {number[]} Rotation offsets that align exterior slots with either side of the attachment axis.
 */
function exactDirectAttachmentRingRotationOffsets(layoutGraph, blockCoords, attachmentAtomId) {
  const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, attachmentAtomId);
  const attachmentPosition = blockCoords.get(attachmentAtomId);
  if (!descriptor || !attachmentPosition) {
    return [];
  }

  const ringNeighborAngles = descriptor.ringNeighborIds
    .filter(neighborAtomId => blockCoords.has(neighborAtomId))
    .map(neighborAtomId => angleOf(sub(blockCoords.get(neighborAtomId), attachmentPosition)));
  if (ringNeighborAngles.length !== 2) {
    return [];
  }

  const currentAngle = angleOf(sub(centroid([...blockCoords.values()]), attachmentPosition));
  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, (layoutGraph.atomToRings.get(attachmentAtomId) ?? [])[0]?.atomIds?.length ?? 0);
  const rotationOffsets = [];
  for (const targetAngle of targetAngles) {
    const offsets = [
      normalizeRotationOffset(currentAngle - targetAngle),
      normalizeRotationOffset(currentAngle + Math.PI - targetAngle)
    ];
    for (const offset of offsets) {
      if (!rotationOffsets.some(candidateOffset => angularDifference(candidateOffset, offset) <= 1e-9)) {
        rotationOffsets.push(offset);
      }
    }
  }
  return rotationOffsets;
}

function exactDirectAttachmentParentOutwardRotationOffsets(layoutGraph, blockCoords, attachmentAtomId, detachedExitAngle) {
  if (!blockCoords.get(attachmentAtomId) || detachedExitAngle == null) {
    return [];
  }

  const rotationOffsets = [];
  for (const outwardAngle of directAttachmentLocalOutwardAngles(layoutGraph, blockCoords, attachmentAtomId)) {
    const offset = normalizeRotationOffset(Math.PI + detachedExitAngle - outwardAngle);
    if (!rotationOffsets.some(candidateOffset => angularDifference(candidateOffset, offset) <= 1e-9)) {
      rotationOffsets.push(offset);
    }
  }
  return rotationOffsets;
}

/**
 * Returns exact ring-rotation offsets that center a direct-attached parent bond
 * on the strict trigonal-bisector exit defined by the attached block itself.
 * This gives exocyclic alkene roots and similar ring trigonal centers one
 * precise rescue pose instead of relying only on the coarse default rotation
 * menu.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} blockCoords - Detached attached-block coordinates.
 * @param {string} attachmentAtomId - Attached-block root atom ID.
 * @param {string} parentAtomId - Already placed parent atom ID.
 * @param {number} outwardAlignmentOffset - Base outward-axis alignment offset.
 * @returns {number[]} Exact ring-rotation offsets in radians.
 */
function exactDirectAttachmentTrigonalBisectorRotationOffsets(layoutGraph, blockCoords, attachmentAtomId, parentAtomId, outwardAlignmentOffset) {
  const attachmentPosition = blockCoords.get(attachmentAtomId);
  if (!attachmentPosition) {
    return [];
  }
  if (!directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, blockCoords, attachmentAtomId, parentAtomId).strict) {
    return [];
  }

  const neighborPositions = [];
  for (const bond of layoutGraph.bondsByAtomId.get(attachmentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === attachmentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === parentAtomId || !blockCoords.has(neighborAtomId)) {
      continue;
    }
    neighborPositions.push(blockCoords.get(neighborAtomId));
  }
  if (neighborPositions.length !== 2) {
    return [];
  }

  const idealParentAngle = angleOf(sub(attachmentPosition, centroid(neighborPositions)));
  return [normalizeRotationOffset(Math.PI - outwardAlignmentOffset - idealParentAngle)];
}

function measureDirectAttachmentExteriorContinuationPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, attachmentAtomId);
  if (!descriptor || !parentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const attachmentPosition = coords.get(attachmentAtomId);
  const ringNeighborAngles = descriptor.ringNeighborIds
    .filter(neighborAtomId => coords.has(neighborAtomId))
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), attachmentPosition)));
  if (ringNeighborAngles.length !== 2) {
    return 0;
  }

  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, (layoutGraph.atomToRings.get(attachmentAtomId) ?? [])[0]?.atomIds?.length ?? 0);
  const parentAngle = angleOf(sub(coords.get(parentAtomId), attachmentPosition));
  return Math.min(...targetAngles.map(targetAngle => angularDifference(parentAngle, targetAngle) ** 2));
}

function measureDirectAttachmentParentOutwardPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const computePenaltyAtAnchor = (anchorAtomId, otherAtomId) => {
    const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
    if (anchorRings.length === 0) {
      return 0;
    }

    const incidentRingAtomIds = new Set(anchorRings.flatMap(ring => ring.atomIds));
    const heavyExocyclicNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || incidentRingAtomIds.has(neighborAtomId)) {
        continue;
      }
      heavyExocyclicNeighborIds.push(neighborAtomId);
    }
    if (heavyExocyclicNeighborIds.length !== 1 || heavyExocyclicNeighborIds[0] !== otherAtomId) {
      return 0;
    }

    const anchorPosition = coords.get(anchorAtomId);
    const outwardAngles = [
      ...directAttachmentLocalOutwardAngles(layoutGraph, coords, anchorAtomId, otherAtomId),
      ...incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId)
    ].filter((outwardAngle, index, angles) =>
      angles.findIndex(existingAngle => angularDifference(existingAngle, outwardAngle) <= 1e-9) === index
    );
    if (outwardAngles.length === 0) {
      return 0;
    }

    const otherAngle = angleOf(sub(coords.get(otherAtomId), anchorPosition));
    return Math.min(...outwardAngles.map(outwardAngle => angularDifference(otherAngle, outwardAngle) ** 2));
  };

  return computePenaltyAtAnchor(parentAtomId, attachmentAtomId) + computePenaltyAtAnchor(attachmentAtomId, parentAtomId);
}

/**
 * Penalizes directly attached ring candidates that pull a safe fused-junction
 * attachment off the exact continuation of the shared junction bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {number} Fused-junction continuation penalty.
 */
function measureDirectAttachmentFusedJunctionContinuationPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const preferredAngle = directAttachedForeignRingJunctionContinuationAngle(layoutGraph, coords, parentAtomId, attachmentAtomId);
  if (preferredAngle == null) {
    return 0;
  }

  const attachmentAngle = angleOf(sub(coords.get(attachmentAtomId), coords.get(parentAtomId)));
  return angularDifference(attachmentAngle, preferredAngle) ** 2;
}

/**
 * Penalizes directly attached ring candidates that pull a precise divalent
 * linker off its ideal continuation. This is the non-ring analogue of the
 * ring-outward parent penalty above: trigonal linkers should keep their
 * attached ring near the exact `120°` slot, while `sp` alkynyl linkers should
 * stay linear at `180°` when an overlap-free pose exists.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {number} Exact-continuation penalty.
 */
function measureDirectAttachmentExactContinuationPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const placedHeavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    if (neighborAtomId === attachmentAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    placedHeavyNeighborIds.push(neighborAtomId);
  }
  if (placedHeavyNeighborIds.length !== 1) {
    return 0;
  }

  const continuationParentAtomId = placedHeavyNeighborIds[0];
  const descriptor = describeDirectAttachmentExactContinuation(
    layoutGraph,
    parentAtomId,
    continuationParentAtomId,
    attachmentAtomId
  );
  if (!descriptor) {
    return 0;
  }

  const parentAngle = angleOf(sub(coords.get(continuationParentAtomId), coords.get(parentAtomId)));
  const attachmentAngle = angleOf(sub(coords.get(attachmentAtomId), coords.get(parentAtomId)));
  return (angularDifference(parentAngle, attachmentAngle) - descriptor.idealSeparation) ** 2;
}

/**
 * Returns whether a direct-attached parent atom should keep an exact trigonal
 * attachment angle because it is either an explicitly visible trigonal center
 * or a conjugated amide-like nitrogen.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} parentAtomId - Already placed parent atom ID.
 * @param {string} attachmentAtomId - Attached-block root atom ID.
 * @returns {boolean} True when the parent-side exact trigonal angle should be enforced.
 */
function supportsExactDirectAttachmentParentPreferredAngle(layoutGraph, parentAtomId, attachmentAtomId) {
  if (!parentAtomId || !attachmentAtomId) {
    return false;
  }

  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  if (
    !attachmentBond
    || attachmentBond.kind !== 'covalent'
    || attachmentBond.aromatic
    || (attachmentBond.order ?? 1) !== 1
  ) {
    return false;
  }

  if (
    layoutGraph.atoms.get(attachmentAtomId)?.aromatic
    && isExactVisibleTrigonalBisectorEligible(layoutGraph, parentAtomId, attachmentAtomId)
  ) {
    return true;
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  if (
    !parentAtom
    || parentAtom.element !== 'N'
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 3
    || parentAtom.degree !== 3
    || (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  let otherHeavyNeighborCount = 0;
  let conjugatedHeteroMultipleNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === attachmentAtomId) {
      continue;
    }
    otherHeavyNeighborCount++;
    if (bond.aromatic || (bond.order ?? 1) !== 1 || neighborAtom.aromatic) {
      continue;
    }
    for (const neighborBond of layoutGraph.bondsByAtomId.get(neighborAtomId) ?? []) {
      if (!neighborBond || neighborBond.kind !== 'covalent' || neighborBond.aromatic || (neighborBond.order ?? 1) < 2) {
        continue;
      }
      const heteroAtomId = neighborBond.a === neighborAtomId ? neighborBond.b : neighborBond.a;
      if (heteroAtomId === parentAtomId) {
        continue;
      }
      const heteroAtom = layoutGraph.atoms.get(heteroAtomId);
      if (!heteroAtom || !new Set(['O', 'S', 'Se', 'P']).has(heteroAtom.element)) {
        continue;
      }
      conjugatedHeteroMultipleNeighborCount++;
      break;
    }
  }

  return otherHeavyNeighborCount === 2 && conjugatedHeteroMultipleNeighborCount === 1;
}

/**
 * Returns the exact parent-side trigonal target angle for one direct-attached
 * ring candidate when the parent anchor should stay centered between its two
 * already placed heavy neighbors.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} parentAtomId - Already placed parent atom ID.
 * @param {string} attachmentAtomId - Attached-block root atom ID.
 * @returns {number|null} Exact parent-side trigonal target angle in radians.
 */
function directAttachmentParentPreferredAngle(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  if (!supportsExactDirectAttachmentParentPreferredAngle(layoutGraph, parentAtomId, attachmentAtomId) || !coords.has(parentAtomId)) {
    return null;
  }

  const otherHeavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === attachmentAtomId || !coords.has(neighborAtomId)) {
      continue;
    }
    otherHeavyNeighborIds.push(neighborAtomId);
  }
  if (otherHeavyNeighborIds.length !== 2) {
    return null;
  }

  return angleOf(sub(
    coords.get(parentAtomId),
    centroid(otherHeavyNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)))
  ));
}

/**
 * Penalizes directly attached ring candidates that flatten a parent-side exact
 * trigonal center such as a carbonyl or vinylic carbon, or a conjugated
 * amide-like nitrogen. This is narrower than the generic trigonal-bisector
 * penalty: it only applies when the parent anchor has a chemically meaningful
 * exact trigonal slot, so that direct-attached ring blocks do not beat the
 * exact `120/120/120` parent geometry merely because a child-root presentation
 * term is slightly cleaner.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {number} Parent-side exact visible trigonal penalty.
 */
function measureDirectAttachmentParentVisibleTrigonalPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }
  const idealAttachmentAngle = directAttachmentParentPreferredAngle(layoutGraph, coords, parentAtomId, attachmentAtomId);
  if (idealAttachmentAngle == null) {
    return 0;
  }
  const parentPosition = coords.get(parentAtomId);
  const attachmentAngle = angleOf(sub(coords.get(attachmentAtomId), parentPosition));
  return angularDifference(attachmentAngle, idealAttachmentAngle) ** 2;
}

/**
 * Returns whether a direct-attached ring candidate should prioritise the
 * parent-side exact continuation ahead of a perfect child ring-outward exit.
 * Benzylic and similar methylene linkers read poorly when they flatten toward
 * 150 degrees just to keep the attached ring root exact.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {boolean} True when the parent linker continuation should outrank child-root outward tie-breaks.
 */
function shouldPrioritizeDirectAttachmentExactContinuation(layoutGraph, candidateMeta = null) {
  return directAttachmentContinuationParentAtomId(layoutGraph, candidateMeta) != null;
}

/**
 * Returns the already placed heavy neighbor that defines the parent-side exact
 * continuation for a direct-attached ring candidate, or `null` when no such
 * continuation applies.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {string|null} Continuation parent atom ID.
 */
function directAttachmentContinuationParentAtomId(layoutGraph, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId) {
    return null;
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  if (
    !parentAtom
    || !new Set(['C', 'N']).has(parentAtom.element)
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 2
    || (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
  ) {
    return null;
  }

  const placedHeavyNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    placedHeavyNeighborIds.push(neighborAtomId);
  }
  if (placedHeavyNeighborIds.length !== 2) {
    return null;
  }

  const continuationParentAtomId = placedHeavyNeighborIds.find(neighborAtomId => neighborAtomId !== attachmentAtomId) ?? null;
  if (!continuationParentAtomId) {
    return null;
  }

  return isExactSimpleAcyclicContinuationEligible(layoutGraph, parentAtomId, continuationParentAtomId, attachmentAtomId)
    ? continuationParentAtomId
    : null;
}

/**
 * Describes the exact direct-attachment continuation target for a divalent
 * parent linker. Conjugated trigonal linkers keep a `120°` continuation,
 * while `sp` linkers with a triple bond keep a linear `180°` continuation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} parentAtomId - Already placed parent atom ID.
 * @param {string} continuationParentAtomId - Already placed heavy neighbor that anchors the continuation.
 * @param {string} attachmentAtomId - Attached ring root atom ID.
 * @returns {{idealSeparation: number}|null} Exact continuation descriptor, or `null` when unsupported.
 */
function describeDirectAttachmentExactContinuation(layoutGraph, parentAtomId, continuationParentAtomId, attachmentAtomId) {
  if (
    !parentAtomId
    || !continuationParentAtomId
    || !attachmentAtomId
    || !isExactSimpleAcyclicContinuationEligible(layoutGraph, parentAtomId, continuationParentAtomId, attachmentAtomId)
  ) {
    return null;
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  if (
    !parentAtom
    || !new Set(['C', 'N']).has(parentAtom.element)
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 2
  ) {
    return null;
  }

  const continuationBond = findLayoutBond(layoutGraph, parentAtomId, continuationParentAtomId);
  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  if (
    !continuationBond
    || !attachmentBond
    || continuationBond.kind !== 'covalent'
    || attachmentBond.kind !== 'covalent'
    || continuationBond.aromatic
    || attachmentBond.aromatic
  ) {
    return null;
  }

  const continuationOrder = continuationBond.order ?? 1;
  const attachmentOrder = attachmentBond.order ?? 1;
  if (parentAtom.element === 'N') {
    return continuationOrder === 1 && attachmentOrder === 1
      ? { idealSeparation: EXACT_TRIGONAL_CONTINUATION_ANGLE }
      : null;
  }

  const hasSingleAndMultipleBond =
    (continuationOrder === 1 && attachmentOrder >= 2)
    || (continuationOrder >= 2 && attachmentOrder === 1);
  if (!hasSingleAndMultipleBond) {
    return null;
  }

  return {
    idealSeparation: isLinearCenter(layoutGraph, parentAtomId) ? Math.PI : EXACT_TRIGONAL_CONTINUATION_ANGLE
  };
}

/**
 * Returns exact continuation angles around a reference bond angle.
 * Trigonal continuations yield the mirrored `120°` pair, while linear
 * continuations collapse to a single `180°` continuation.
 * @param {number} referenceAngle - Reference bond angle in radians.
 * @param {number} idealSeparation - Ideal separation from the reference angle.
 * @returns {number[]} Exact continuation angles in radians.
 */
function exactContinuationAngles(referenceAngle, idealSeparation) {
  const candidateAngles = [
    referenceAngle + idealSeparation,
    referenceAngle - idealSeparation
  ];
  return candidateAngles.filter((candidateAngle, index) => (
    candidateAngles.findIndex(existingAngle => angularDifference(existingAngle, candidateAngle) <= 1e-9) === index
  ));
}

function exactDirectAttachmentContinuationAngles(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  const continuationParentAtomId = directAttachmentContinuationParentAtomId(layoutGraph, candidateMeta);
  if (!parentAtomId || !attachmentAtomId || !continuationParentAtomId) {
    return [];
  }
  if (!coords.has(parentAtomId) || !coords.has(continuationParentAtomId)) {
    return [];
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  if (
    !parentAtom
    || !new Set(['C', 'N']).has(parentAtom.element)
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 2
    || parentAtom.degree !== 3
  ) {
    return [];
  }

  const descriptor = describeDirectAttachmentExactContinuation(
    layoutGraph,
    parentAtomId,
    continuationParentAtomId,
    attachmentAtomId
  );
  if (!descriptor) {
    return [];
  }

  const parentPosition = coords.get(parentAtomId);
  const continuationAngle = angleOf(sub(coords.get(continuationParentAtomId), parentPosition));
  return exactContinuationAngles(continuationAngle, descriptor.idealSeparation);
}

function exactDirectAttachmentParentPreferredAngles(layoutGraph, adjacency, coords, atomIdsToPlace, candidateMeta = null) {
  void adjacency;
  void atomIdsToPlace;
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId)) {
    return [];
  }
  if (!supportsExactDirectAttachmentParentPreferredAngle(layoutGraph, parentAtomId, attachmentAtomId)) {
    return [];
  }
  const preferredAngle = directAttachmentParentPreferredAngle(layoutGraph, coords, parentAtomId, attachmentAtomId);
  return preferredAngle == null ? [] : [preferredAngle];
}

/**
 * Returns exact parent-side exterior-gap angles for a direct-attached ring
 * block whose placed parent is itself a small saturated ring atom with two
 * exocyclic heavy branches. This lets the incoming block occupy one of the
 * remaining exterior slots instead of inheriting only the centroid-driven
 * attachment angle.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Direct-attachment metadata.
 * @returns {number[]} Exact parent-side attachment angles in radians.
 */
function exactDirectAttachmentParentExteriorAngles(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, parentAtomId);
  if (
    !descriptor
    || !attachmentAtomId
    || !descriptor.exocyclicNeighborIds.includes(attachmentAtomId)
    || !coords.has(parentAtomId)
  ) {
    return [];
  }

  const parentPosition = coords.get(parentAtomId);
  const ringNeighborAngles = descriptor.ringNeighborIds
    .filter(neighborAtomId => coords.has(neighborAtomId))
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), parentPosition)));
  if (ringNeighborAngles.length !== 2) {
    return [];
  }

  const ringSize = (layoutGraph.atomToRings.get(parentAtomId) ?? [])[0]?.atomIds?.length ?? 0;
  return smallRingExteriorTargetAngles(ringNeighborAngles, ringSize);
}

/**
 * Returns whether an anchor participates in a direct-attachment trigonal-bisector
 * preference, and whether that preference is strict or may bend slightly to
 * recover a cleaner attached-ring presentation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} anchorAtomId - Potential trigonal-bisector anchor atom ID.
 * @param {string} otherAtomId - Attached-block atom on the opposite side of the bond.
 * @returns {{eligible: boolean, strict: boolean, omittedHydrogen: boolean}} Sensitivity summary.
 */
function directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, coords, anchorAtomId, otherAtomId) {
  if (!coords.has(anchorAtomId)) {
    return { eligible: false, strict: false, omittedHydrogen: false };
  }
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || anchorAtom.aromatic || anchorAtom.heavyDegree !== 3) {
    return { eligible: false, strict: false, omittedHydrogen: false };
  }
  const anchorRingCount = layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0;
  if (anchorRingCount > 0) {
    const strict = isExactRingTrigonalBisectorEligible(layoutGraph, anchorAtomId, otherAtomId);
    if (strict) {
      return { eligible: true, strict, omittedHydrogen: false };
    }
    let nonAromaticMultipleBondCount = 0;
    let ringNeighborCount = 0;
    let qualifyingNeighborCount = 0;
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (!bond.aromatic && (bond.order ?? 1) >= 2) {
        nonAromaticMultipleBondCount++;
      }
      if ((layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
        ringNeighborCount++;
      }
      if (neighborAtomId !== otherAtomId && coords.has(neighborAtomId)) {
        qualifyingNeighborCount++;
      }
    }
    const omittedHydrogen =
      anchorAtom.element === 'C'
      && anchorAtom.degree === 4
      && ringNeighborCount >= 2
      && nonAromaticMultipleBondCount === 0
      && qualifyingNeighborCount === 2;
    return {
      eligible: omittedHydrogen,
      strict: false,
      omittedHydrogen
    };
  }
  let nonAromaticMultipleBondCount = 0;
  let ringNeighborCount = 0;
  let qualifyingNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (!bond.aromatic && (bond.order ?? 1) >= 2) {
      nonAromaticMultipleBondCount++;
    }
    if ((layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
      ringNeighborCount++;
    }
    if (neighborAtomId !== otherAtomId && coords.has(neighborAtomId)) {
      qualifyingNeighborCount++;
    }
  }
  const strict = nonAromaticMultipleBondCount === 1 && qualifyingNeighborCount === 2;
  const omittedHydrogen =
    anchorAtom.degree === 4
    && ringNeighborCount >= 1
    && nonAromaticMultipleBondCount === 0
    && qualifyingNeighborCount === 2;
  return {
    eligible: strict || omittedHydrogen,
    strict,
    omittedHydrogen
  };
}

function isTrigonalBisectorEligibleAtAnchor(layoutGraph, coords, anchorAtomId, otherAtomId) {
  return directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, coords, anchorAtomId, otherAtomId).eligible;
}

function summarizeDirectAttachmentTrigonalBisectorSensitivity(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return { eligible: false, strict: false, omittedHydrogen: false };
  }
  const parentSensitivity = !parentAtomId || !attachmentAtomId || !coords.has(parentAtomId)
    ? { eligible: false, strict: false, omittedHydrogen: false }
    : directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, coords, parentAtomId, attachmentAtomId);
  const attachmentSensitivity = !parentAtomId || !attachmentAtomId || !coords.has(attachmentAtomId)
    ? { eligible: false, strict: false, omittedHydrogen: false }
    : directAttachmentTrigonalBisectorSensitivityAtAnchor(layoutGraph, coords, attachmentAtomId, parentAtomId);
  return {
    eligible: parentSensitivity.eligible || attachmentSensitivity.eligible,
    strict: parentSensitivity.strict || attachmentSensitivity.strict,
    omittedHydrogen: parentSensitivity.omittedHydrogen || attachmentSensitivity.omittedHydrogen
  };
}

function measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return 0;
  }
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }

  const computePenaltyAtAnchor = (anchorAtomId, otherAtomId) => {
    if (!isTrigonalBisectorEligibleAtAnchor(layoutGraph, coords, anchorAtomId, otherAtomId)) {
      return 0;
    }
    const otherHeavyNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === otherAtomId || !coords.has(neighborAtomId)) {
        continue;
      }
      otherHeavyNeighborIds.push(neighborAtomId);
    }
    if (otherHeavyNeighborIds.length !== 2) {
      return 0;
    }
    const anchorPosition = coords.get(anchorAtomId);
    const idealAngle = angleOf(sub(anchorPosition, centroid(otherHeavyNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)))));
    const attachmentAngle = angleOf(sub(coords.get(otherAtomId), anchorPosition));
    return angularDifference(attachmentAngle, idealAngle) ** 2;
  };

  return computePenaltyAtAnchor(parentAtomId, attachmentAtomId) + computePenaltyAtAnchor(attachmentAtomId, parentAtomId);
}

/**
 * Builds a small local refinement menu around an already selected direct-attached
 * ring-block pose. This lets omitted-h trigonal parents give back a small amount
 * of exact bisector alignment when that recovers a cleaner ring exit without
 * reopening overlaps.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Selected attached-block coordinates.
 * @param {{x: number, y: number}} parentPosition - Fixed parent atom position.
 * @param {string} attachmentAtomId - Attached-block root atom ID.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<{attachmentAngleOffset: number, ringRotationOffset: number, transformedCoords: Map<string, {x: number, y: number}>}>} Local refinement candidates.
 */
function buildLocalDirectAttachmentRefinementCandidates(transformedCoords, parentPosition, attachmentAtomId, bondLength) {
  const attachmentPosition = transformedCoords.get(attachmentAtomId);
  if (!attachmentPosition || !parentPosition) {
    return [];
  }

  const baseAttachmentAngle = angleOf(sub(attachmentPosition, parentPosition));
  const candidates = [];
  for (const attachmentAngleOffset of DIRECT_ATTACHMENT_FINE_ANGLE_OFFSETS) {
    const targetAttachmentPosition = add(parentPosition, fromAngle(baseAttachmentAngle + attachmentAngleOffset, bondLength));
    for (const ringRotationOffset of DIRECT_ATTACHMENT_LOCAL_REFINEMENT_RING_ROTATION_OFFSETS) {
      const nextCoords = new Map();
      for (const [atomId, position] of transformedCoords) {
        if (atomId === attachmentAtomId) {
          nextCoords.set(atomId, targetAttachmentPosition);
          continue;
        }
        const shiftedPosition = sub(position, attachmentPosition);
        nextCoords.set(
          atomId,
          add(targetAttachmentPosition, rotate(shiftedPosition, attachmentAngleOffset + ringRotationOffset))
        );
      }
      candidates.push({
        attachmentAngleOffset,
        ringRotationOffset,
        transformedCoords: nextCoords
      });
    }
  }
  return candidates;
}

/**
 * Builds fine-grained local root-rotation refinements around an already
 * selected direct-attached ring-block pose. This lets a parent-exact rescue
 * trim the remaining child-root ring-outward miss without reopening the full
 * direct-attachment search or moving the fixed parent bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Selected attached-block coordinates.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata.
 * @returns {Array<{ringRotationOffset: number, transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Local root-rotation candidates.
 */
function buildDirectAttachmentLocalRootRotationRefinementCandidates(layoutGraph, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !transformedCoords.has(attachmentAtomId)) {
    return [];
  }

  const rotatedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
    .filter(atomId => atomId !== attachmentAtomId && transformedCoords.has(atomId));
  if (rotatedAtomIds.length === 0) {
    return [];
  }

  const attachmentPosition = transformedCoords.get(attachmentAtomId);
  return DIRECT_ATTACHMENT_LOCAL_ROOT_ROTATION_REFINEMENT_OFFSETS.map(ringRotationOffset => {
    const nextCoords = new Map(transformedCoords);
    for (const atomId of rotatedAtomIds) {
      const currentPosition = transformedCoords.get(atomId);
      if (!currentPosition) {
        continue;
      }
      nextCoords.set(
        atomId,
        add(attachmentPosition, rotate(sub(currentPosition, attachmentPosition), ringRotationOffset))
      );
    }
    return {
      ringRotationOffset,
      transformedCoords: nextCoords,
      meta: {
        ...candidateMeta,
        localRootRotationRefinement: true,
        ringRotationOffset
      }
    };
  });
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

function normalizeSignedAngle(angle) {
  let normalizedAngle = angle;
  while (normalizedAngle <= -Math.PI) {
    normalizedAngle += Math.PI * 2;
  }
  while (normalizedAngle > Math.PI) {
    normalizedAngle -= Math.PI * 2;
  }
  return normalizedAngle;
}

function overwriteCoordMap(targetCoords, sourceCoords) {
  targetCoords.clear();
  for (const [atomId, position] of sourceCoords) {
    targetCoords.set(atomId, position);
  }
}

function buildLocalResnapGeometryScore(layoutGraph, coords, bondLength, focusAtomIds) {
  const readability = measureRingSubstituentReadability(layoutGraph, coords, { focusAtomIds });
  return {
    readability,
    exactRingExitPenalty: measureMixedRootExactRingExitPenalty(layoutGraph, coords, focusAtomIds).totalDeviation,
    omittedHydrogenPenalty: measureThreeHeavyContinuationDistortion(layoutGraph, coords, { focusAtomIds }).totalDeviation,
    trigonalPenalty: measureTrigonalDistortion(layoutGraph, coords, { focusAtomIds }).totalDeviation,
    overlapCount: findSevereOverlaps(layoutGraph, coords, bondLength).length,
    focusedPlacementCost: measureFocusedPlacementCost(layoutGraph, coords, bondLength, focusAtomIds)
  };
}

function compareLocalResnapGeometryCandidates(candidate, incumbent, layoutGraph) {
  if (candidate.score.readability.failingSubstituentCount !== incumbent.score.readability.failingSubstituentCount) {
    return candidate.score.readability.failingSubstituentCount - incumbent.score.readability.failingSubstituentCount;
  }
  if (candidate.score.readability.inwardSubstituentCount !== incumbent.score.readability.inwardSubstituentCount) {
    return candidate.score.readability.inwardSubstituentCount - incumbent.score.readability.inwardSubstituentCount;
  }
  if (candidate.score.readability.outwardAxisFailureCount !== incumbent.score.readability.outwardAxisFailureCount) {
    return candidate.score.readability.outwardAxisFailureCount - incumbent.score.readability.outwardAxisFailureCount;
  }
  if (Math.abs(candidate.score.exactRingExitPenalty - incumbent.score.exactRingExitPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.score.exactRingExitPenalty - incumbent.score.exactRingExitPenalty;
  }
  if (Math.abs(candidate.score.omittedHydrogenPenalty - incumbent.score.omittedHydrogenPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.score.omittedHydrogenPenalty - incumbent.score.omittedHydrogenPenalty;
  }
  if (Math.abs(candidate.score.trigonalPenalty - incumbent.score.trigonalPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.score.trigonalPenalty - incumbent.score.trigonalPenalty;
  }
  if (candidate.score.overlapCount !== incumbent.score.overlapCount) {
    return candidate.score.overlapCount - incumbent.score.overlapCount;
  }
  if (Math.abs(candidate.score.focusedPlacementCost - incumbent.score.focusedPlacementCost) > IMPROVEMENT_EPSILON) {
    return candidate.score.focusedPlacementCost - incumbent.score.focusedPlacementCost;
  }
  if (Math.abs(candidate.totalRotationMagnitude - incumbent.totalRotationMagnitude) > IMPROVEMENT_EPSILON) {
    return candidate.totalRotationMagnitude - incumbent.totalRotationMagnitude;
  }
  return compareCoordMapsDeterministically(candidate.coords, incumbent.coords, layoutGraph.canonicalAtomRank);
}

function applyCenterSubtreeRotations(coords, centerPosition, assignments) {
  const nextCoords = new Map(coords);
  const movedAtomIds = new Set();
  let totalRotationMagnitude = 0;

  for (const assignment of assignments) {
    const rotationAngle = normalizeSignedAngle(assignment.targetAngle - assignment.currentAngle);
    totalRotationMagnitude += Math.abs(rotationAngle);
    if (Math.abs(rotationAngle) <= 1e-9) {
      continue;
    }
    for (const atomId of assignment.movedAtomIds) {
      const currentPosition = coords.get(atomId);
      if (!currentPosition) {
        continue;
      }
      nextCoords.set(
        atomId,
        add(centerPosition, rotate(sub(currentPosition, centerPosition), rotationAngle))
      );
      movedAtomIds.add(atomId);
    }
  }

  if (totalRotationMagnitude <= 1e-9) {
    return null;
  }

  return {
    coords: nextCoords,
    movedAtomIds,
    totalRotationMagnitude
  };
}

function buildVisibleTrigonalRootResnapCandidates(layoutGraph, coords, centerAtomId) {
  const atom = layoutGraph.atoms.get(centerAtomId);
  if (
    !atom
    || !coords.has(centerAtomId)
    || atom.element !== 'C'
    || atom.aromatic
    || atom.heavyDegree !== 3
    || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
  ) {
    return [];
  }

  const heavyBonds = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent') {
      return false;
    }
    const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
  });
  if (heavyBonds.length !== 3) {
    return [];
  }

  const primaryBonds = heavyBonds.filter(bond => !bond.aromatic && (bond.order ?? 1) >= 2);
  if (primaryBonds.length !== 1) {
    return [];
  }

  const rootBonds = heavyBonds.filter(bond => bond !== primaryBonds[0] && !bond.aromatic && (bond.order ?? 1) === 1);
  if (rootBonds.length !== 2) {
    return [];
  }

  const centerPosition = coords.get(centerAtomId);
  const primaryAtomId = primaryBonds[0].a === centerAtomId ? primaryBonds[0].b : primaryBonds[0].a;
  const primaryPosition = coords.get(primaryAtomId);
  if (!centerPosition || !primaryPosition) {
    return [];
  }

  const assignments = rootBonds.map(bond => {
    const rootAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const rootPosition = coords.get(rootAtomId);
    if (!rootPosition) {
      return null;
    }
    return {
      rootAtomId,
      currentAngle: angleOf(sub(rootPosition, centerPosition)),
      movedAtomIds: collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, centerAtomId)
    };
  }).filter(Boolean);
  if (assignments.length !== 2) {
    return [];
  }

  const baseAngle = angleOf(sub(primaryPosition, centerPosition));
  const targetAngleSets = [
    [baseAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE, baseAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE],
    [baseAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE, baseAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE]
  ];

  return targetAngleSets
    .map(targetAngles => applyCenterSubtreeRotations(coords, centerPosition, assignments.map((assignment, index) => ({
      ...assignment,
      targetAngle: targetAngles[index]
    }))))
    .filter(Boolean);
}

function isThreeHeavyContinuationCenter(layoutGraph, coords, centerAtomId) {
  const atom = layoutGraph.atoms.get(centerAtomId);
  if (
    !atom
    || !coords.has(centerAtomId)
    || atom.element !== 'C'
    || atom.aromatic
    || atom.heavyDegree !== 3
    || atom.degree !== 4
    || layoutGraph.options.suppressH !== true
    || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  const heavyBonds = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
  });
  return heavyBonds.length === 3;
}

function permuteAssignments(assignments) {
  if (assignments.length <= 1) {
    return [assignments];
  }
  const permutations = [];
  for (let index = 0; index < assignments.length; index++) {
    const remainingAssignments = [
      ...assignments.slice(0, index),
      ...assignments.slice(index + 1)
    ];
    for (const permutation of permuteAssignments(remainingAssignments)) {
      permutations.push([assignments[index], ...permutation]);
    }
  }
  return permutations;
}

function buildThreeHeavyContinuationResnapCandidates(layoutGraph, coords, centerAtomId) {
  if (!isThreeHeavyContinuationCenter(layoutGraph, coords, centerAtomId)) {
    return [];
  }

  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return [];
  }

  const assignments = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? [])
    .filter(bond => {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
        return false;
      }
      const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    })
    .map(bond => {
      const rootAtomId = bond.a === centerAtomId ? bond.b : bond.a;
      return {
        rootAtomId,
        currentAngle: angleOf(sub(coords.get(rootAtomId), centerPosition)),
        movedAtomIds: collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, centerAtomId)
      };
    })
    .sort((firstAssignment, secondAssignment) => compareCanonicalIds(
      firstAssignment.rootAtomId,
      secondAssignment.rootAtomId,
      layoutGraph.canonicalAtomRank
    ));
  if (assignments.length !== 3) {
    return [];
  }

  const candidates = [];
  const seenSignatures = new Set();
  const assignmentPermutations = permuteAssignments(assignments);
  for (const fixedAssignment of assignments) {
    const baseAngle = fixedAssignment.currentAngle;
    for (const targetAngles of [
      [baseAngle, baseAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE, baseAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE],
      [baseAngle, baseAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE, baseAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE]
    ]) {
      for (const permutation of assignmentPermutations) {
        const targetAngleByRootAtomId = new Map(permutation.map((assignment, index) => [assignment.rootAtomId, targetAngles[index]]));
        const signature = assignments
          .map(assignment => `${assignment.rootAtomId}:${normalizeSignedAngle(targetAngleByRootAtomId.get(assignment.rootAtomId)).toFixed(9)}`)
          .join('|');
        if (seenSignatures.has(signature)) {
          continue;
        }
        seenSignatures.add(signature);

        const candidate = applyCenterSubtreeRotations(
          coords,
          centerPosition,
          assignments.map(assignment => ({
            ...assignment,
            targetAngle: targetAngleByRootAtomId.get(assignment.rootAtomId)
          }))
        );
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }
  }

  return candidates;
}

function realignPendingRingAttachmentVisibleTrigonalRoots(layoutGraph, coords, targetAtomIds, bondLength) {
  const changedAtomIds = new Set();
  const targetAtomIdSet = new Set(targetAtomIds ?? []);
  const orderedTargetAtomIds = [...targetAtomIdSet]
    .filter(atomId => coords.has(atomId))
    .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));

  for (const centerAtomId of orderedTargetAtomIds) {
    const candidates = buildVisibleTrigonalRootResnapCandidates(layoutGraph, coords, centerAtomId);
    if (candidates.length === 0) {
      continue;
    }

    const focusSeedAtomIds = new Set([centerAtomId]);
    for (const candidate of candidates) {
      for (const atomId of candidate.movedAtomIds) {
        focusSeedAtomIds.add(atomId);
      }
    }
    const focusAtomIds = expandScoringFocusAtomIds(layoutGraph, focusSeedAtomIds, 2);
    let bestCandidate = {
      coords,
      score: buildLocalResnapGeometryScore(layoutGraph, coords, bondLength, focusAtomIds),
      totalRotationMagnitude: 0
    };

    for (const candidate of candidates) {
      const candidateSnapshot = {
        ...candidate,
        score: buildLocalResnapGeometryScore(layoutGraph, candidate.coords, bondLength, focusAtomIds)
      };
      if (compareLocalResnapGeometryCandidates(candidateSnapshot, bestCandidate, layoutGraph) < 0) {
        bestCandidate = candidateSnapshot;
      }
    }

    if (bestCandidate.coords !== coords) {
      overwriteCoordMap(coords, bestCandidate.coords);
      changedAtomIds.add(centerAtomId);
      for (const atomId of bestCandidate.movedAtomIds) {
        changedAtomIds.add(atomId);
      }
    }
  }

  return changedAtomIds;
}

function restoreLocalThreeHeavyContinuationCenters(layoutGraph, coords, focusSeedAtomIds, bondLength) {
  const changedAtomIds = new Set();
  if ((focusSeedAtomIds?.size ?? 0) === 0) {
    return changedAtomIds;
  }

  const candidateCenterAtomIds = [...expandScoringFocusAtomIds(layoutGraph, focusSeedAtomIds, 2)]
    .filter(atomId => isThreeHeavyContinuationCenter(layoutGraph, coords, atomId))
    .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));

  for (const centerAtomId of candidateCenterAtomIds) {
    const candidates = buildThreeHeavyContinuationResnapCandidates(layoutGraph, coords, centerAtomId);
    if (candidates.length === 0) {
      continue;
    }

    const centerFocusSeedAtomIds = new Set([centerAtomId]);
    for (const candidate of candidates) {
      for (const atomId of candidate.movedAtomIds) {
        centerFocusSeedAtomIds.add(atomId);
      }
    }
    const focusAtomIds = expandScoringFocusAtomIds(layoutGraph, centerFocusSeedAtomIds, 2);
    let bestCandidate = {
      coords,
      score: buildLocalResnapGeometryScore(layoutGraph, coords, bondLength, focusAtomIds),
      totalRotationMagnitude: 0
    };

    for (const candidate of candidates) {
      const candidateSnapshot = {
        ...candidate,
        score: buildLocalResnapGeometryScore(layoutGraph, candidate.coords, bondLength, focusAtomIds)
      };
      if (compareLocalResnapGeometryCandidates(candidateSnapshot, bestCandidate, layoutGraph) < 0) {
        bestCandidate = candidateSnapshot;
      }
    }

    if (bestCandidate.coords !== coords) {
      overwriteCoordMap(coords, bestCandidate.coords);
      changedAtomIds.add(centerAtomId);
      for (const atomId of bestCandidate.movedAtomIds) {
        changedAtomIds.add(atomId);
      }
    }
  }

  return changedAtomIds;
}

function describeSuppressedHydrogenRingJunction(layoutGraph, coords, centerAtomId) {
  const atom = layoutGraph.atoms.get(centerAtomId);
  if (
    !atom
    || !coords.has(centerAtomId)
    || atom.element !== 'C'
    || atom.aromatic
    || atom.degree !== 4
    || atom.heavyDegree !== 3
    || layoutGraph.options.suppressH !== true
  ) {
    return null;
  }

  const heavyBonds = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
  });
  if (heavyBonds.length !== 3) {
    return null;
  }

  const heavyNeighborIds = heavyBonds.map(bond => (bond.a === centerAtomId ? bond.b : bond.a));
  for (const ring of layoutGraph.atomToRings.get(centerAtomId) ?? []) {
    if ((ring.atomIds?.length ?? 0) < 5) {
      continue;
    }
    const ringNeighborIds = heavyNeighborIds.filter(neighborAtomId => ring.atomIds.includes(neighborAtomId));
    const branchNeighborIds = heavyNeighborIds.filter(neighborAtomId => !ring.atomIds.includes(neighborAtomId));
    if (ringNeighborIds.length !== 2 || branchNeighborIds.length !== 1) {
      continue;
    }
    const ringSeparation = angularDifference(
      angleOf(sub(coords.get(ringNeighborIds[0]), coords.get(centerAtomId))),
      angleOf(sub(coords.get(ringNeighborIds[1]), coords.get(centerAtomId)))
    );
    if (Math.abs(ringSeparation - EXACT_TRIGONAL_CONTINUATION_ANGLE) > Math.PI / 36) {
      continue;
    }
    return {
      centerAtomId,
      ringNeighborIds,
      branchNeighborId: branchNeighborIds[0]
    };
  }

  return null;
}

function suppressedHydrogenRingJunctionTargetAngles(coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition) {
    return [];
  }
  const [firstRingNeighborId, secondRingNeighborId] = descriptor.ringNeighborIds;
  const firstRingAngle = angleOf(sub(coords.get(firstRingNeighborId), centerPosition));
  const secondRingAngle = angleOf(sub(coords.get(secondRingNeighborId), centerPosition));
  const targetAngles = [
    firstRingAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE,
    firstRingAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE,
    secondRingAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE,
    secondRingAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE
  ];
  const uniqueTargetAngles = [];
  for (const targetAngle of targetAngles) {
    if (
      angularDifference(targetAngle, firstRingAngle) <= Math.PI / 36
      || angularDifference(targetAngle, secondRingAngle) <= Math.PI / 36
      || Math.abs(angularDifference(targetAngle, firstRingAngle) - EXACT_TRIGONAL_CONTINUATION_ANGLE) > Math.PI / 36
      || Math.abs(angularDifference(targetAngle, secondRingAngle) - EXACT_TRIGONAL_CONTINUATION_ANGLE) > Math.PI / 36
      || uniqueTargetAngles.some(existingAngle => angularDifference(existingAngle, targetAngle) <= 1e-6)
    ) {
      continue;
    }
    uniqueTargetAngles.push(wrapAngle(targetAngle));
  }
  return uniqueTargetAngles;
}

function rotateAtomIdsAroundPivot(coords, atomIds, pivotAtomId, rotation) {
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
    nextCoords.set(atomId, add(pivotPosition, rotate(sub(position, pivotPosition), rotation)));
  }
  return nextCoords;
}

function addUniqueSuppressedHydrogenClearanceCandidate(candidates, seenSignatures, coords) {
  const signature = [...coords.entries()]
    .sort(([firstAtomId], [secondAtomId]) => String(firstAtomId).localeCompare(String(secondAtomId), 'en', { numeric: true }))
    .map(([atomId, position]) => `${atomId}:${Math.round(position.x * 1e6)}:${Math.round(position.y * 1e6)}`)
    .join('|');
  if (seenSignatures.has(signature)) {
    return;
  }
  seenSignatures.add(signature);
  candidates.push(coords);
}

function buildSuppressedHydrogenRingJunctionClearanceCandidates(layoutGraph, candidateCoords, protectedAtomIds, bondLength) {
  const overlaps = findSevereOverlaps(layoutGraph, candidateCoords, bondLength);
  if (overlaps.length === 0) {
    return [candidateCoords];
  }

  const overlapAtomIds = new Set(overlaps.flatMap(overlap => [overlap.firstAtomId, overlap.secondAtomId]));
  const candidates = [];
  const seenSignatures = new Set();
  const attachedRingDescriptors = [];
  const terminalLeafDescriptors = [];
  const terminalLeafKeys = new Set();

  for (const descriptor of collectMovableAttachedRingDescriptors(layoutGraph, candidateCoords)) {
    const subtreeAtomIds = descriptor.subtreeAtomIds.filter(atomId => candidateCoords.has(atomId));
    if (
      subtreeAtomIds.length === 0
      || subtreeAtomIds.some(atomId => protectedAtomIds.has(atomId))
      || !subtreeAtomIds.some(atomId => overlapAtomIds.has(atomId))
    ) {
      continue;
    }
    attachedRingDescriptors.push({
      ...descriptor,
      subtreeAtomIds
    });
    for (const rotation of SUPPRESSED_H_RING_JUNCTION_RESCUE_OFFSETS) {
      const rotatedCoords = rotateAtomIdsAroundPivot(candidateCoords, subtreeAtomIds, descriptor.anchorAtomId, rotation);
      if (rotatedCoords) {
        addUniqueSuppressedHydrogenClearanceCandidate(candidates, seenSignatures, rotatedCoords);
      }
    }
  }

  for (const atomId of overlapAtomIds) {
    const anchorAtomId = exactTerminalRingLeafAnchor(layoutGraph, candidateCoords, atomId);
    if (!anchorAtomId || protectedAtomIds.has(anchorAtomId)) {
      continue;
    }
    const descriptorKey = `${anchorAtomId}:${atomId}`;
    if (terminalLeafKeys.has(descriptorKey)) {
      continue;
    }
    terminalLeafKeys.add(descriptorKey);
    terminalLeafDescriptors.push({
      anchorAtomId,
      leafAtomId: atomId
    });
    for (const rotation of SUPPRESSED_H_RING_JUNCTION_RESCUE_OFFSETS) {
      const rotatedCoords = rotateAtomIdsAroundPivot(candidateCoords, [atomId], anchorAtomId, rotation);
      if (rotatedCoords) {
        addUniqueSuppressedHydrogenClearanceCandidate(candidates, seenSignatures, rotatedCoords);
      }
    }
  }

  for (const leafDescriptor of terminalLeafDescriptors) {
    for (const leafRotation of SUPPRESSED_H_RING_JUNCTION_RESCUE_OFFSETS) {
      const leafCoords = rotateAtomIdsAroundPivot(candidateCoords, [leafDescriptor.leafAtomId], leafDescriptor.anchorAtomId, leafRotation);
      if (!leafCoords) {
        continue;
      }
      for (const attachedRingDescriptor of attachedRingDescriptors) {
        for (const ringRotation of SUPPRESSED_H_RING_JUNCTION_RESCUE_OFFSETS) {
          const rotatedCoords = rotateAtomIdsAroundPivot(
            leafCoords,
            attachedRingDescriptor.subtreeAtomIds,
            attachedRingDescriptor.anchorAtomId,
            ringRotation
          );
          if (rotatedCoords) {
            addUniqueSuppressedHydrogenClearanceCandidate(candidates, seenSignatures, rotatedCoords);
          }
        }
      }
    }
  }
  return candidates;
}

function measureSuppressedHydrogenRingJunctionBalance(layoutGraph, coords) {
  const trigonalDistortion = measureTrigonalDistortion(layoutGraph, coords);
  const continuationDistortion = measureThreeHeavyContinuationDistortion(layoutGraph, coords);
  const readability = measureRingSubstituentReadability(layoutGraph, coords);
  return Math.max(
    Math.sqrt(Math.max(0, trigonalDistortion.maxDeviation) / 2),
    Math.sqrt(Math.max(0, continuationDistortion.maxDeviation) / 2),
    readability.maxOutwardDeviation
  );
}

function measureSuppressedHydrogenRingJunctionAngularBalance(layoutGraph, coords) {
  const trigonalDistortion = measureTrigonalDistortion(layoutGraph, coords);
  const continuationDistortion = measureThreeHeavyContinuationDistortion(layoutGraph, coords);
  return Math.max(
    Math.sqrt(Math.max(0, trigonalDistortion.maxDeviation) / 2),
    Math.sqrt(Math.max(0, continuationDistortion.maxDeviation) / 2)
  );
}

function compareSuppressedHydrogenRingJunctionCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount - incumbent.audit.severeOverlapCount;
  }
  if (Math.abs(candidate.hiddenHydrogenPenalty - incumbent.hiddenHydrogenPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.hiddenHydrogenPenalty - incumbent.hiddenHydrogenPenalty;
  }
  if (Math.abs(candidate.balancePenalty - incumbent.balancePenalty) > IMPROVEMENT_EPSILON) {
    return candidate.balancePenalty - incumbent.balancePenalty;
  }
  if (Math.abs(candidate.visibleTrigonalPenalty - incumbent.visibleTrigonalPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.visibleTrigonalPenalty - incumbent.visibleTrigonalPenalty;
  }
  if (candidate.audit.labelOverlapCount !== incumbent.audit.labelOverlapCount) {
    return candidate.audit.labelOverlapCount - incumbent.audit.labelOverlapCount;
  }
  if (candidate.audit.ringSubstituentReadabilityFailureCount !== incumbent.audit.ringSubstituentReadabilityFailureCount) {
    return candidate.audit.ringSubstituentReadabilityFailureCount - incumbent.audit.ringSubstituentReadabilityFailureCount;
  }
  if (Math.abs(candidate.layoutCost - incumbent.layoutCost) > IMPROVEMENT_EPSILON) {
    return candidate.layoutCost - incumbent.layoutCost;
  }
  return candidate.totalRotationMagnitude - incumbent.totalRotationMagnitude;
}

function buildSuppressedHydrogenRingJunctionCandidateScore(layoutGraph, coords, bondLength, totalRotationMagnitude = 0) {
  const audit = auditLayout(layoutGraph, coords, { bondLength });
  return {
    coords,
    audit,
    hiddenHydrogenPenalty: measureThreeHeavyContinuationDistortion(layoutGraph, coords).totalDeviation,
    balancePenalty: measureSuppressedHydrogenRingJunctionBalance(layoutGraph, coords),
    visibleTrigonalPenalty: measureTrigonalDistortion(layoutGraph, coords).totalDeviation,
    layoutCost: measureLayoutCost(layoutGraph, coords, bondLength),
    totalRotationMagnitude
  };
}

function rescueSuppressedHydrogenRingJunctions(layoutGraph, coords, bondLength) {
  if (layoutGraph.options.suppressH !== true || (layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return { changed: false };
  }

  let workingCoords = coords;
  let changed = false;
  let baseAudit = auditLayout(layoutGraph, workingCoords, { bondLength });
  let baseHiddenHydrogenPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, workingCoords).totalDeviation;
  let baseVisibleTrigonalPenalty = measureTrigonalDistortion(layoutGraph, workingCoords).totalDeviation;

  const orderedCenterAtomIds = [...workingCoords.keys()]
    .filter(atomId => describeSuppressedHydrogenRingJunction(layoutGraph, workingCoords, atomId))
    .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));

  for (const centerAtomId of orderedCenterAtomIds) {
    const centerPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, workingCoords, {
      focusAtomIds: new Set([centerAtomId])
    }).totalDeviation;
    if (centerPenalty <= IMPROVEMENT_EPSILON) {
      continue;
    }

    const descriptor = describeSuppressedHydrogenRingJunction(layoutGraph, workingCoords, centerAtomId);
    if (!descriptor) {
      continue;
    }
    const targetAngles = suppressedHydrogenRingJunctionTargetAngles(workingCoords, descriptor);
    if (targetAngles.length === 0) {
      continue;
    }
    const centerPosition = workingCoords.get(centerAtomId);
    const branchPosition = workingCoords.get(descriptor.branchNeighborId);
    if (!centerPosition || !branchPosition) {
      continue;
    }
    const branchSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, descriptor.branchNeighborId, centerAtomId)
      .filter(atomId => workingCoords.has(atomId));
    if (branchSubtreeAtomIds.length === 0 || branchSubtreeAtomIds.length > 18) {
      continue;
    }

    const branchAngle = angleOf(sub(branchPosition, centerPosition));
    const protectedAtomIds = new Set([centerAtomId, ...descriptor.ringNeighborIds, descriptor.branchNeighborId]);
    let bestCandidate = null;
    for (const targetAngle of targetAngles) {
      const rotation = normalizeSignedAngle(targetAngle - branchAngle);
      if (Math.abs(rotation) <= IMPROVEMENT_EPSILON) {
        continue;
      }
      const resnappedCoords = rotateAtomIdsAroundPivot(workingCoords, branchSubtreeAtomIds, centerAtomId, rotation);
      if (!resnappedCoords) {
        continue;
      }
      const clearanceCandidates = buildSuppressedHydrogenRingJunctionClearanceCandidates(
        layoutGraph,
        resnappedCoords,
        protectedAtomIds,
        bondLength
      );
      for (const candidateCoords of clearanceCandidates) {
        const audit = auditLayout(layoutGraph, candidateCoords, { bondLength });
        const hiddenHydrogenPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, candidateCoords).totalDeviation;
        if (
          audit.severeOverlapCount > baseAudit.severeOverlapCount
          || audit.labelOverlapCount > baseAudit.labelOverlapCount
          || audit.bondLengthFailureCount > baseAudit.bondLengthFailureCount
          || hiddenHydrogenPenalty > baseHiddenHydrogenPenalty - IMPROVEMENT_EPSILON
        ) {
          continue;
        }
        const visibleTrigonalPenalty = measureTrigonalDistortion(layoutGraph, candidateCoords).totalDeviation;
        if (visibleTrigonalPenalty > baseVisibleTrigonalPenalty + 0.35) {
          continue;
        }
        const candidate = {
          coords: candidateCoords,
          audit,
          hiddenHydrogenPenalty,
          balancePenalty: measureSuppressedHydrogenRingJunctionBalance(layoutGraph, candidateCoords),
          visibleTrigonalPenalty,
          layoutCost: measureLayoutCost(layoutGraph, candidateCoords, bondLength),
          totalRotationMagnitude: Math.abs(rotation)
        };
        if (compareSuppressedHydrogenRingJunctionCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }

    if (
      bestCandidate
      && bestCandidate.hiddenHydrogenPenalty < baseHiddenHydrogenPenalty - IMPROVEMENT_EPSILON
    ) {
      workingCoords = bestCandidate.coords;
      baseAudit = bestCandidate.audit;
      baseHiddenHydrogenPenalty = bestCandidate.hiddenHydrogenPenalty;
      baseVisibleTrigonalPenalty = bestCandidate.visibleTrigonalPenalty;
      changed = true;
    }
  }

  if (changed) {
    overwriteCoordMap(coords, workingCoords);
  }
  return { changed };
}

function minDistanceBetweenAtomSets(coords, firstAtomIds, secondAtomIds) {
  let minDistance = Infinity;
  for (const firstAtomId of firstAtomIds) {
    const firstPosition = coords.get(firstAtomId);
    if (!firstPosition) {
      continue;
    }
    for (const secondAtomId of secondAtomIds) {
      const secondPosition = coords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      minDistance = Math.min(minDistance, distance(firstPosition, secondPosition));
    }
  }
  return minDistance;
}

function balanceSuppressedHydrogenRingJunctionLeafClashes(layoutGraph, coords, bondLength) {
  if (layoutGraph.options.suppressH !== true || (layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return { changed: false };
  }

  if (measureSuppressedHydrogenRingJunctionAngularBalance(layoutGraph, coords) < Math.PI / 15) {
    return { changed: false };
  }

  const terminalLeafDescriptors = [...coords.keys()]
    .map(leafAtomId => ({
      leafAtomId,
      anchorAtomId: exactTerminalRingLeafAnchor(layoutGraph, coords, leafAtomId)
    }))
    .filter(descriptor => descriptor.anchorAtomId != null)
    .sort((firstDescriptor, secondDescriptor) => (
      compareCanonicalIds(firstDescriptor.anchorAtomId, secondDescriptor.anchorAtomId, layoutGraph.canonicalAtomRank)
      || compareCanonicalIds(firstDescriptor.leafAtomId, secondDescriptor.leafAtomId, layoutGraph.canonicalAtomRank)
    ));
  if (terminalLeafDescriptors.length === 0) {
    return { changed: false };
  }

  const suppressedHydrogenJunctions = [...coords.keys()]
    .map(atomId => describeSuppressedHydrogenRingJunction(layoutGraph, coords, atomId))
    .filter(Boolean)
    .sort((firstDescriptor, secondDescriptor) => compareCanonicalIds(
      firstDescriptor.centerAtomId,
      secondDescriptor.centerAtomId,
      layoutGraph.canonicalAtomRank
    ));
  if (suppressedHydrogenJunctions.length === 0) {
    return { changed: false };
  }

  const attachedRingDescriptors = collectMovableAttachedRingDescriptors(layoutGraph, coords)
    .map(descriptor => ({
      ...descriptor,
      subtreeAtomIds: descriptor.subtreeAtomIds.filter(atomId => coords.has(atomId))
    }))
    .filter(descriptor => descriptor.subtreeAtomIds.length > 0);
  if (attachedRingDescriptors.length === 0) {
    return { changed: false };
  }

  const candidatePairs = [];
  for (const junctionDescriptor of suppressedHydrogenJunctions) {
    const protectedAtomIds = new Set([
      junctionDescriptor.centerAtomId,
      ...junctionDescriptor.ringNeighborIds,
      junctionDescriptor.branchNeighborId
    ]);
    const movableAnchorAtomIds = new Set([
      junctionDescriptor.branchNeighborId,
      ...junctionDescriptor.ringNeighborIds
    ]);
    const branchAttachedRingDescriptors = attachedRingDescriptors.filter(descriptor => (
      movableAnchorAtomIds.has(descriptor.anchorAtomId)
      && !descriptor.subtreeAtomIds.some(atomId => protectedAtomIds.has(atomId))
    ));
    if (branchAttachedRingDescriptors.length === 0) {
      continue;
    }

    for (const attachedRingDescriptor of branchAttachedRingDescriptors) {
      const nearbyLeafDescriptors = terminalLeafDescriptors.filter(leafDescriptor =>
        minDistanceBetweenAtomSets(coords, [leafDescriptor.leafAtomId], attachedRingDescriptor.subtreeAtomIds) <= bondLength * 0.75
      );
      for (const leafDescriptor of nearbyLeafDescriptors) {
        candidatePairs.push({ attachedRingDescriptor, leafDescriptor });
      }
    }
  }

  if (candidatePairs.length === 0) {
    return { changed: false };
  }

  const baseCandidate = buildSuppressedHydrogenRingJunctionCandidateScore(layoutGraph, coords, bondLength);
  if (baseCandidate.audit.severeOverlapCount > 0 || baseCandidate.balancePenalty < Math.PI / 15) {
    return { changed: false };
  }

  let bestCandidate = baseCandidate;
  for (const { attachedRingDescriptor, leafDescriptor } of candidatePairs) {
    for (const leafRotation of SUPPRESSED_H_RING_JUNCTION_BALANCE_OFFSETS) {
      const leafCoords = rotateAtomIdsAroundPivot(coords, [leafDescriptor.leafAtomId], leafDescriptor.anchorAtomId, leafRotation);
      if (!leafCoords) {
        continue;
      }
      for (const ringRotation of SUPPRESSED_H_RING_JUNCTION_BALANCE_OFFSETS) {
        const candidateCoords = rotateAtomIdsAroundPivot(
          leafCoords,
          attachedRingDescriptor.subtreeAtomIds,
          attachedRingDescriptor.anchorAtomId,
          ringRotation
        );
        if (!candidateCoords) {
          continue;
        }
        const candidate = buildSuppressedHydrogenRingJunctionCandidateScore(
          layoutGraph,
          candidateCoords,
          bondLength,
          Math.abs(leafRotation) + Math.abs(ringRotation)
        );
        if (
          candidate.audit.severeOverlapCount > baseCandidate.audit.severeOverlapCount
          || candidate.audit.labelOverlapCount > baseCandidate.audit.labelOverlapCount
          || candidate.audit.bondLengthFailureCount > baseCandidate.audit.bondLengthFailureCount
          || candidate.audit.ringSubstituentReadabilityFailureCount > baseCandidate.audit.ringSubstituentReadabilityFailureCount
          || candidate.hiddenHydrogenPenalty > baseCandidate.hiddenHydrogenPenalty + IMPROVEMENT_EPSILON
          || candidate.visibleTrigonalPenalty > baseCandidate.visibleTrigonalPenalty + IMPROVEMENT_EPSILON
        ) {
          continue;
        }
        if (compareSuppressedHydrogenRingJunctionCandidates(candidate, bestCandidate) < 0) {
          bestCandidate = candidate;
        }
      }
    }
  }

  if (bestCandidate === baseCandidate || bestCandidate.balancePenalty >= baseCandidate.balancePenalty - Math.PI / 180) {
    return { changed: false };
  }

  overwriteCoordMap(coords, bestCandidate.coords);
  return { changed: true };
}

function heavyPlacedNeighborIds(layoutGraph, coords, atomId) {
  return (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === atomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
}

function describeProjectedTetrahedralTrigonalChild(layoutGraph, coords, anchorAtomId) {
  if (!supportsProjectedTetrahedralGeometry(layoutGraph, anchorAtomId) || !coords.has(anchorAtomId)) {
    return null;
  }

  const heavyNeighborIds = heavyPlacedNeighborIds(layoutGraph, coords, anchorAtomId);
  if (heavyNeighborIds.length !== 4) {
    return null;
  }

  const leafNeighborIds = heavyNeighborIds.filter(neighborAtomId => (layoutGraph.atoms.get(neighborAtomId)?.heavyDegree ?? 0) === 1);
  const branchNeighborIds = heavyNeighborIds.filter(neighborAtomId => !leafNeighborIds.includes(neighborAtomId));
  if (leafNeighborIds.length !== 2 || branchNeighborIds.length !== 2) {
    return null;
  }

  for (const childAtomId of branchNeighborIds) {
    const childAtom = layoutGraph.atoms.get(childAtomId);
    if (
      !childAtom
      || childAtom.element === 'H'
      || childAtom.aromatic
      || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0
    ) {
      continue;
    }

    const childHeavyNeighborIds = heavyPlacedNeighborIds(layoutGraph, coords, childAtomId);
    if (childHeavyNeighborIds.length !== 3) {
      continue;
    }

    const multipleBondLeafIds = childHeavyNeighborIds.filter(neighborAtomId => {
      const bond = findLayoutBond(layoutGraph, childAtomId, neighborAtomId);
      return !!bond
        && !bond.aromatic
        && (bond.order ?? 1) >= 2
        && (layoutGraph.atoms.get(neighborAtomId)?.heavyDegree ?? 0) === 1;
    });
    if (multipleBondLeafIds.length !== 1) {
      continue;
    }

    const singleBondNeighborIds = childHeavyNeighborIds.filter(neighborAtomId => {
      const bond = findLayoutBond(layoutGraph, childAtomId, neighborAtomId);
      return !!bond && !bond.aromatic && (bond.order ?? 1) === 1;
    });
    if (singleBondNeighborIds.length !== 2 || !singleBondNeighborIds.includes(anchorAtomId)) {
      continue;
    }

    const rotatableSingleNeighborId = singleBondNeighborIds.find(neighborAtomId => neighborAtomId !== anchorAtomId);
    if (!rotatableSingleNeighborId) {
      continue;
    }

    const anchorPosition = coords.get(anchorAtomId);
    const childAngle = angleOf(sub(coords.get(childAtomId), anchorPosition));
    const oppositeLeafId = leafNeighborIds.reduce((bestLeafId, leafNeighborId) => {
      if (!bestLeafId) {
        return leafNeighborId;
      }
      const bestDeviation = angularDifference(
        angleOf(sub(coords.get(bestLeafId), anchorPosition)),
        childAngle + Math.PI
      );
      const candidateDeviation = angularDifference(
        angleOf(sub(coords.get(leafNeighborId), anchorPosition)),
        childAngle + Math.PI
      );
      return candidateDeviation < bestDeviation ? leafNeighborId : bestLeafId;
    }, null);
    if (!oppositeLeafId) {
      continue;
    }

    return {
      anchorAtomId,
      parentAtomId: branchNeighborIds.find(neighborAtomId => neighborAtomId !== childAtomId) ?? null,
      childAtomId,
      childAngle,
      leafNeighborIds,
      oppositeLeafId,
      multipleBondLeafId: multipleBondLeafIds[0],
      rotatableSingleNeighborId
    };
  }

  return null;
}

function buildProjectedTetrahedralTrigonalChildRescueCandidate(layoutGraph, coords, bondLength, descriptor) {
  const {
    anchorAtomId,
    childAtomId,
    childAngle,
    oppositeLeafId,
    multipleBondLeafId,
    rotatableSingleNeighborId
  } = descriptor;
  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  const oppositeLeafPosition = coords.get(oppositeLeafId);
  if (!anchorPosition || !childPosition || !oppositeLeafPosition) {
    return null;
  }

  const nextCoords = new Map(coords);
  const targetChildAngle = angleOf(sub(oppositeLeafPosition, anchorPosition));
  const anchorRotation = normalizeSignedAngle(targetChildAngle - childAngle);
  const childSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, childAtomId, anchorAtomId)
    .filter(atomId => nextCoords.has(atomId));
  if (childSubtreeAtomIds.length === 0) {
    return null;
  }
  for (const atomId of childSubtreeAtomIds) {
    const relativePosition = sub(nextCoords.get(atomId), anchorPosition);
    nextCoords.set(atomId, add(anchorPosition, rotate(relativePosition, anchorRotation)));
  }
  nextCoords.set(oppositeLeafId, add(anchorPosition, fromAngle(childAngle, bondLength)));

  const nextChildPosition = nextCoords.get(childAtomId);
  const nextAnchorPosition = nextCoords.get(anchorAtomId);
  const nextMultipleBondLeafPosition = nextCoords.get(multipleBondLeafId);
  const nextRotatableSingleNeighborPosition = nextCoords.get(rotatableSingleNeighborId);
  if (!nextChildPosition || !nextAnchorPosition || !nextMultipleBondLeafPosition || !nextRotatableSingleNeighborPosition) {
    return null;
  }

  const anchorAngle = angleOf(sub(nextAnchorPosition, nextChildPosition));
  const multipleBondAngle = angleOf(sub(nextMultipleBondLeafPosition, nextChildPosition));
  const currentRotatableAngle = angleOf(sub(nextRotatableSingleNeighborPosition, nextChildPosition));
  const exactTrigonalAngles = [
    normalizeSignedAngle(multipleBondAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE),
    normalizeSignedAngle(multipleBondAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE)
  ];
  const targetRotatableAngle = exactTrigonalAngles.reduce((bestAngle, candidateAngle) => {
    if (bestAngle == null) {
      return candidateAngle;
    }
    const bestDeviation = Math.abs(angularDifference(bestAngle, anchorAngle) - EXACT_TRIGONAL_CONTINUATION_ANGLE);
    const candidateDeviation = Math.abs(angularDifference(candidateAngle, anchorAngle) - EXACT_TRIGONAL_CONTINUATION_ANGLE);
    if (candidateDeviation < bestDeviation - PROJECTED_TETRAHEDRAL_TRIGONAL_RESCUE_EPSILON) {
      return candidateAngle;
    }
    if (Math.abs(candidateDeviation - bestDeviation) <= PROJECTED_TETRAHEDRAL_TRIGONAL_RESCUE_EPSILON) {
      return Math.abs(normalizeSignedAngle(candidateAngle - currentRotatableAngle))
        < Math.abs(normalizeSignedAngle(bestAngle - currentRotatableAngle))
        ? candidateAngle
        : bestAngle;
    }
    return bestAngle;
  }, null);
  if (targetRotatableAngle == null) {
    return null;
  }

  const rotatableSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, rotatableSingleNeighborId, childAtomId)
    .filter(atomId => nextCoords.has(atomId));
  if (rotatableSubtreeAtomIds.length === 0) {
    return null;
  }
  const childRotation = normalizeSignedAngle(targetRotatableAngle - currentRotatableAngle);
  for (const atomId of rotatableSubtreeAtomIds) {
    const relativePosition = sub(nextCoords.get(atomId), nextChildPosition);
    nextCoords.set(atomId, add(nextChildPosition, rotate(relativePosition, childRotation)));
  }

  return nextCoords;
}

function runProjectedTetrahedralTrigonalChildRescue(layoutGraph, coords, bondLength, focusAtomIds = null) {
  const focusSet =
    focusAtomIds instanceof Set && focusAtomIds.size > 0
      ? expandScoringFocusAtomIds(layoutGraph, focusAtomIds, 1)
      : null;
  let workingCoords = coords;
  let changed = false;
  let workingAudit = null;

  let improved = true;
  while (improved) {
    improved = false;

    for (const anchorAtomId of workingCoords.keys()) {
      if (focusSet && !focusSet.has(anchorAtomId)) {
        continue;
      }

      const descriptor = describeProjectedTetrahedralTrigonalChild(layoutGraph, workingCoords, anchorAtomId);
      if (!descriptor) {
        continue;
      }

      const currentTrigonal = measureTrigonalDistortion(layoutGraph, workingCoords, {
        focusAtomIds: new Set([descriptor.childAtomId])
      }).totalDeviation;
      if (!(currentTrigonal > PROJECTED_TETRAHEDRAL_TRIGONAL_RESCUE_EPSILON)) {
        continue;
      }

      const candidateCoords = buildProjectedTetrahedralTrigonalChildRescueCandidate(
        layoutGraph,
        workingCoords,
        bondLength,
        descriptor
      );
      if (!candidateCoords) {
        continue;
      }

      const candidateTrigonal = measureTrigonalDistortion(layoutGraph, candidateCoords, {
        focusAtomIds: new Set([descriptor.childAtomId])
      }).totalDeviation;
      if (!(candidateTrigonal + PROJECTED_TETRAHEDRAL_TRIGONAL_RESCUE_EPSILON < currentTrigonal)) {
        continue;
      }

      if (!workingAudit) {
        workingAudit = auditLayout(layoutGraph, workingCoords, { bondLength });
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (candidateAudit.severeOverlapCount > workingAudit.severeOverlapCount) {
        continue;
      }
      if (candidateAudit.labelOverlapCount > workingAudit.labelOverlapCount) {
        continue;
      }
      if (candidateAudit.ringSubstituentReadabilityFailureCount > workingAudit.ringSubstituentReadabilityFailureCount) {
        continue;
      }
      if (candidateAudit.outwardAxisRingSubstituentFailureCount > workingAudit.outwardAxisRingSubstituentFailureCount) {
        continue;
      }

      const focusCostAtomIds = [...expandScoringFocusAtomIds(
        layoutGraph,
        new Set([
          descriptor.anchorAtomId,
          descriptor.parentAtomId,
          descriptor.childAtomId,
          ...descriptor.leafNeighborIds,
          descriptor.multipleBondLeafId,
          descriptor.rotatableSingleNeighborId
        ].filter(Boolean)),
        2
      )];
      const workingCost = measureFocusedPlacementCost(layoutGraph, workingCoords, bondLength, focusCostAtomIds);
      const candidateCost = measureFocusedPlacementCost(layoutGraph, candidateCoords, bondLength, focusCostAtomIds);
      if (
        candidateAudit.severeOverlapCount === workingAudit.severeOverlapCount
        && candidateAudit.labelOverlapCount === workingAudit.labelOverlapCount
        && candidateCost > workingCost + IMPROVEMENT_EPSILON
      ) {
        continue;
      }

      workingCoords = candidateCoords;
      workingAudit = candidateAudit;
      changed = true;
      improved = true;
      break;
    }
  }

  return { coords: workingCoords, changed };
}

function isExactVisibleTrigonalContinuationEligible(layoutGraph, anchorAtomId, continuationParentAtomId, childAtomId) {
  if (!isExactSimpleAcyclicContinuationEligible(layoutGraph, anchorAtomId, continuationParentAtomId, childAtomId)) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (
    !anchorAtom
    || anchorAtom.element !== 'C'
    || anchorAtom.aromatic
    || anchorAtom.heavyDegree !== 2
    || anchorAtom.degree !== 3
  ) {
    return false;
  }

  const continuationBond = findLayoutBond(layoutGraph, anchorAtomId, continuationParentAtomId);
  const childBond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  if (
    !continuationBond
    || !childBond
    || continuationBond.kind !== 'covalent'
    || childBond.kind !== 'covalent'
    || continuationBond.aromatic
    || childBond.aromatic
  ) {
    return false;
  }

  const continuationOrder = continuationBond.order ?? 1;
  const childOrder = childBond.order ?? 1;
  return (
    (continuationOrder === 1 && childOrder >= 2)
    || (continuationOrder >= 2 && childOrder === 1)
  );
}

function hasPendingExactVisibleTrigonalContinuation(layoutGraph, coords, primaryNonRingAtomIds) {
  if (!(primaryNonRingAtomIds instanceof Set) || primaryNonRingAtomIds.size === 0) {
    return false;
  }

  for (const [anchorAtomId, anchorAtom] of layoutGraph.atoms) {
    if (!anchorAtom || anchorAtom.element === 'H' || !coords.has(anchorAtomId)) {
      continue;
    }

    const placedHeavyNeighborIds = [];
    const pendingPrimaryNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (coords.has(neighborAtomId)) {
        placedHeavyNeighborIds.push(neighborAtomId);
      } else if (primaryNonRingAtomIds.has(neighborAtomId)) {
        pendingPrimaryNeighborIds.push(neighborAtomId);
      }
    }
    if (placedHeavyNeighborIds.length < 2 || pendingPrimaryNeighborIds.length === 0) {
      continue;
    }

    for (const childAtomId of pendingPrimaryNeighborIds) {
      for (const continuationParentAtomId of placedHeavyNeighborIds) {
        if (isExactVisibleTrigonalContinuationEligible(layoutGraph, anchorAtomId, continuationParentAtomId, childAtomId)) {
          return true;
        }
      }
    }
  }

  return false;
}

function hasSensitiveDirectAttachmentCandidates(layoutGraph, coords, candidates) {
  for (const candidate of candidates) {
    const parentAtomId = candidate.meta?.parentAtomId ?? null;
    const attachmentAtomId = candidate.meta?.attachmentAtomId ?? null;
    if (!parentAtomId || !attachmentAtomId) {
      continue;
    }

    const candidateCoords = new Map(coords);
    for (const [atomId, position] of candidate.transformedCoords ?? []) {
      candidateCoords.set(atomId, position);
    }
    if (directAttachmentContinuationParentAtomId(layoutGraph, candidate.meta) != null) {
      return true;
    }
    if (summarizeDirectAttachmentTrigonalBisectorSensitivity(layoutGraph, candidateCoords, parentAtomId, attachmentAtomId).eligible) {
      return true;
    }
  }
  return false;
}

function buildExactVisibleTrigonalContinuationCandidates(layoutGraph, coords, anchorAtomId, continuationParentAtomId, childAtomId) {
  if (
    !coords.has(anchorAtomId)
    || !coords.has(continuationParentAtomId)
    || !coords.has(childAtomId)
    || !isExactVisibleTrigonalContinuationEligible(layoutGraph, anchorAtomId, continuationParentAtomId, childAtomId)
  ) {
    return [];
  }

  const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, childAtomId, anchorAtomId)
    .filter(atomId => atomId !== anchorAtomId && coords.has(atomId));
  if (subtreeAtomIds.length === 0) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  const currentChildAngle = angleOf(sub(coords.get(childAtomId), anchorPosition));
  const continuationAngle = angleOf(sub(coords.get(continuationParentAtomId), anchorPosition));
  const targetChildAngles = [
    continuationAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE,
    continuationAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE
  ];

  return targetChildAngles.flatMap(targetChildAngle => {
    const rotationAngle = wrapAngle(targetChildAngle - currentChildAngle);
    if (Math.abs(rotationAngle) <= 1e-9) {
      return [];
    }
    const transformedCoords = new Map();
    for (const atomId of subtreeAtomIds) {
      transformedCoords.set(atomId, add(anchorPosition, rotate(sub(coords.get(atomId), anchorPosition), rotationAngle)));
    }
    return [{
      transformedCoords,
      meta: {
        attachmentAtomId: childAtomId,
        parentAtomId: anchorAtomId,
        exactVisibleTrigonalContinuation: true,
        targetChildAngle
      }
    }];
  });
}

function snapExactVisibleTrigonalContinuations(layoutGraph, coords, participantAtomIds, bondLength) {
  const anchorAtomIds = [...participantAtomIds]
    .filter(atomId => coords.has(atomId))
    .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));

  for (const anchorAtomId of anchorAtomIds) {
    const heavyNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
        continue;
      }
      heavyNeighborIds.push(neighborAtomId);
    }
    if (heavyNeighborIds.length !== 2) {
      continue;
    }

    let bestCoords = coords;
    let bestScore = null;
    for (const [continuationParentAtomId, childAtomId] of [
      [heavyNeighborIds[0], heavyNeighborIds[1]],
      [heavyNeighborIds[1], heavyNeighborIds[0]]
    ]) {
      if (!isExactVisibleTrigonalContinuationEligible(layoutGraph, anchorAtomId, continuationParentAtomId, childAtomId)) {
        continue;
      }
      const candidateMeta = {
        attachmentAtomId: childAtomId,
        parentAtomId: anchorAtomId
      };
      const baseScore = measureAttachedBlockCandidateState(coords, coords, bondLength, layoutGraph, candidateMeta);
      if (baseScore.exactContinuationPenalty <= IMPROVEMENT_EPSILON) {
        continue;
      }
      if (!bestScore) {
        bestScore = baseScore;
      }

      const candidates = buildExactVisibleTrigonalContinuationCandidates(
        layoutGraph,
        coords,
        anchorAtomId,
        continuationParentAtomId,
        childAtomId
      );
      for (const candidate of candidates) {
        const candidateCoords = new Map(coords);
        for (const [atomId, position] of candidate.transformedCoords) {
          candidateCoords.set(atomId, position);
        }
        const candidateScore = measureAttachedBlockCandidateState(coords, candidateCoords, bondLength, layoutGraph, candidate.meta);
        let shouldReplaceBestCandidate =
          candidateScore.overlapCount === bestScore.overlapCount
          && candidateScore.readability.failingSubstituentCount === bestScore.readability.failingSubstituentCount
          && candidateScore.exactContinuationPenalty <= IMPROVEMENT_EPSILON
          && bestScore.exactContinuationPenalty > IMPROVEMENT_EPSILON;
        const comparison = compareAttachedBlockScores(candidateScore, bestScore);
        if (!shouldReplaceBestCandidate) {
          shouldReplaceBestCandidate = comparison < 0;
        }
        if (!shouldReplaceBestCandidate && comparison === 0) {
          ensureAttachedBlockLayoutCost(candidateScore, candidateCoords, layoutGraph, bondLength);
          ensureAttachedBlockLayoutCost(bestScore, bestCoords, layoutGraph, bondLength);
          if (candidateScore.totalCost < bestScore.totalCost - IMPROVEMENT_EPSILON) {
            shouldReplaceBestCandidate = true;
          } else if (
            Math.abs(candidateScore.totalCost - bestScore.totalCost) <= IMPROVEMENT_EPSILON
            && compareCoordMapsDeterministically(candidateCoords, bestCoords, layoutGraph.canonicalAtomRank) < 0
          ) {
            shouldReplaceBestCandidate = true;
          }
        }
        if (shouldReplaceBestCandidate) {
          bestCoords = candidateCoords;
          bestScore = candidateScore;
        }
      }
    }

    if (bestCoords !== coords) {
      coords.clear();
      for (const [atomId, position] of bestCoords) {
        coords.set(atomId, position);
      }
    }
  }
}

/**
 * Builds exact-continuation rescue candidates for direct-attached ring blocks
 * whose parent linker is already placed but too distorted. The parent atom and
 * the whole attached block move together around the already placed continuation
 * parent so trigonal linkers can recover their exact `120°` bend and `sp`
 * linkers can recover their exact `180°` linear continuation without
 * sacrificing the child block's internal orientation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Current attached-block coordinates.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Parent-linker rescue candidates.
 */
function buildDirectAttachmentExactContinuationRescueCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null, bondLength) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  const continuationParentAtomId = directAttachmentContinuationParentAtomId(layoutGraph, candidateMeta);
  if (!parentAtomId || !attachmentAtomId || !continuationParentAtomId || !coords.has(parentAtomId) || !coords.has(continuationParentAtomId)) {
    return [];
  }
  const descriptor = describeDirectAttachmentExactContinuation(
    layoutGraph,
    parentAtomId,
    continuationParentAtomId,
    attachmentAtomId
  );
  if (!descriptor) {
    return [];
  }

  const attachmentPosition = transformedCoords.get(attachmentAtomId) ?? coords.get(attachmentAtomId);
  if (!attachmentPosition) {
    return [];
  }

  const continuationParentPosition = coords.get(continuationParentAtomId);
  const parentPosition = coords.get(parentAtomId);
  const attachmentAngle = angleOf(sub(attachmentPosition, parentPosition));
  const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, parentAtomId, continuationParentAtomId)
    .filter(atomId => atomId === parentAtomId || transformedCoords.has(atomId) || coords.has(atomId));
  if (subtreeAtomIds.length === 0) {
    return [];
  }

  const rescueCandidates = [];
  for (const targetParentAngle of exactContinuationAngles(attachmentAngle - Math.PI, descriptor.idealSeparation)) {
    const targetParentPosition = add(continuationParentPosition, fromAngle(targetParentAngle, bondLength));
    const delta = sub(targetParentPosition, parentPosition);
    if (Math.hypot(delta.x, delta.y) <= IMPROVEMENT_EPSILON) {
      continue;
    }

    const nextCoords = new Map();
    for (const atomId of subtreeAtomIds) {
      const currentPosition = transformedCoords.get(atomId) ?? coords.get(atomId);
      if (!currentPosition) {
        continue;
      }
      nextCoords.set(atomId, add(currentPosition, delta));
    }
    rescueCandidates.push({
      transformedCoords: nextCoords,
      meta: {
        ...candidateMeta,
        exactContinuationRescue: true,
        targetParentAngle
      }
    });
  }

  return rescueCandidates;
}

/**
 * Builds exact child-side trigonal-bisector rescue poses for one direct-attached
 * ring block by rotating the attached block around its fixed root atom. This
 * is narrower than the general rotation search and is only used after the main
 * candidate search still leaves a strict ring trigonal exit, or an omitted-h
 * ring-root bisector, visibly skewed.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Current attached-block coordinates.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Exact trigonal rescue candidates.
 */
function buildDirectAttachmentExactTrigonalBisectorRescueCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !transformedCoords.has(attachmentAtomId)) {
    return [];
  }

  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }
  const attachmentSensitivity = directAttachmentTrigonalBisectorSensitivityAtAnchor(
    layoutGraph,
    candidateCoords,
    attachmentAtomId,
    parentAtomId
  );
  if (!attachmentSensitivity.strict && !attachmentSensitivity.omittedHydrogen) {
    return [];
  }

  const attachmentPosition = candidateCoords.get(attachmentAtomId);
  const internalNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(attachmentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === attachmentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === parentAtomId || !candidateCoords.has(neighborAtomId)) {
      continue;
    }
    internalNeighborIds.push(neighborAtomId);
  }
  if (internalNeighborIds.length !== 2) {
    return [];
  }

  const idealParentAngle = angleOf(sub(
    attachmentPosition,
    centroid(internalNeighborIds.map(neighborAtomId => candidateCoords.get(neighborAtomId)))
  ));
  const currentParentAngle = angleOf(sub(candidateCoords.get(parentAtomId), attachmentPosition));
  const rotationAngle = wrapAngle(currentParentAngle - idealParentAngle);
  if (Math.abs(rotationAngle) <= 1e-9) {
    return [];
  }

  const rotatedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
    .filter(atomId => atomId === attachmentAtomId || transformedCoords.has(atomId));
  if (rotatedAtomIds.length === 0) {
    return [];
  }

  const rescueCandidates = [];

  const nextCoords = new Map(transformedCoords);
  for (const atomId of rotatedAtomIds) {
    if (atomId === attachmentAtomId) {
      nextCoords.set(atomId, attachmentPosition);
      continue;
    }
    const currentPosition = transformedCoords.get(atomId);
    if (!currentPosition) {
      continue;
    }
    nextCoords.set(
      atomId,
      add(attachmentPosition, rotate(sub(currentPosition, attachmentPosition), rotationAngle))
    );
  }
  rescueCandidates.push({
    transformedCoords: nextCoords,
    meta: {
      ...candidateMeta,
      exactTrigonalBisectorRescue: true,
      rotationAngle
    }
  });

  const parentSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, parentAtomId, attachmentAtomId)
    .filter(atomId => atomId !== attachmentAtomId && coords.has(atomId));
  if (parentSideAtomIds.length > 0) {
    const parentRescueCoords = new Map(transformedCoords);
    for (const atomId of parentSideAtomIds) {
      const currentPosition = coords.get(atomId);
      if (!currentPosition) {
        continue;
      }
      parentRescueCoords.set(
        atomId,
        add(attachmentPosition, rotate(sub(currentPosition, attachmentPosition), -rotationAngle))
      );
    }
    rescueCandidates.push({
      transformedCoords: parentRescueCoords,
      meta: {
        ...candidateMeta,
        exactTrigonalBisectorRescue: true,
        parentSideRotation: true,
        rotationAngle: -rotationAngle
      }
    });
  }

  return rescueCandidates;
}

/**
 * Builds exact local ring-exit rescue poses for one direct-attached ring block
 * by rotating the child ring around its fixed root atom until the parent bond
 * lands on one of that root atom's exact local outward ring exits.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Current attached-block coordinates.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Exact ring-exit rescue candidates.
 */
function buildDirectAttachmentExactRingExitRescueCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !transformedCoords.has(attachmentAtomId)) {
    return [];
  }

  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }
  const targetParentAngles = directAttachmentLocalOutwardAngles(layoutGraph, candidateCoords, attachmentAtomId, parentAtomId);
  if (targetParentAngles.length === 0) {
    return [];
  }

  const attachmentPosition = candidateCoords.get(attachmentAtomId);
  const currentParentAngle = angleOf(sub(candidateCoords.get(parentAtomId), attachmentPosition));
  const rotatedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
    .filter(atomId => atomId === attachmentAtomId || transformedCoords.has(atomId));
  if (rotatedAtomIds.length === 0) {
    return [];
  }

  const rescueCandidates = [];
  for (const targetParentAngle of targetParentAngles) {
    const rotationAngle = wrapAngle(currentParentAngle - targetParentAngle);
    if (Math.abs(rotationAngle) <= 1e-9) {
      continue;
    }
    const nextCoords = new Map(transformedCoords);
    for (const atomId of rotatedAtomIds) {
      if (atomId === attachmentAtomId) {
        nextCoords.set(atomId, attachmentPosition);
        continue;
      }
      const currentPosition = transformedCoords.get(atomId);
      if (!currentPosition) {
        continue;
      }
      nextCoords.set(
        atomId,
        add(attachmentPosition, rotate(sub(currentPosition, attachmentPosition), rotationAngle))
      );
    }
    rescueCandidates.push({
      transformedCoords: nextCoords,
      meta: {
        ...candidateMeta,
        exactRingExitRescue: true,
        rotationAngle
      }
    });
  }

  return rescueCandidates;
}

/**
 * Builds parent-side slot-swap candidates for a direct-attached ring whose root
 * exit remains off the exact local ring-outward axis. The attached ring swaps
 * with one already placed sibling around a parent that should keep a visible
 * `120/120/120` spread, then the attached ring root is re-snapped internally;
 * this preserves the parent geometry while letting the ring root recover its
 * exact exterior bisector.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Current attached-block coordinates.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Slot-swap rescue candidates.
 */
function buildDirectAttachmentParentSlotSwapRescueCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !transformedCoords.has(attachmentAtomId)) {
    return [];
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  const attachmentAtom = layoutGraph.atoms.get(attachmentAtomId);
  const parentIsOmittedHydrogenCarbon =
    parentAtom?.element === 'C'
    && parentAtom.heavyDegree === 3
    && parentAtom.degree === 4;
  const parentIsExactVisibleTrigonal =
    parentAtom?.heavyDegree === 3
    && parentAtom.degree === 3
    && isExactVisibleTrigonalBisectorEligible(layoutGraph, parentAtomId, attachmentAtomId);
  if (
    !parentAtom
    || !attachmentAtom
    || parentAtom.aromatic
    || (!parentIsOmittedHydrogenCarbon && !parentIsExactVisibleTrigonal)
    || (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
    || (layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0
  ) {
    return [];
  }

  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  if (!attachmentBond || attachmentBond.kind !== 'covalent' || attachmentBond.aromatic || (attachmentBond.order ?? 1) !== 1) {
    return [];
  }

  const parentPosition = coords.get(parentAtomId);
  const attachmentPosition = transformedCoords.get(attachmentAtomId);
  const siblingAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return [];
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtomId === attachmentAtomId) {
      continue;
    }
    if (!coords.has(neighborAtomId)) {
      return [];
    }
    siblingAtomIds.push(neighborAtomId);
  }
  if (siblingAtomIds.length !== 2) {
    return [];
  }

  const attachmentSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
    .filter(atomId => transformedCoords.has(atomId));
  const attachmentSubtreeAtomIdSet = new Set(attachmentSubtreeAtomIds);
  const currentAttachmentAngle = angleOf(sub(attachmentPosition, parentPosition));
  const rescueCandidates = [];

  for (const siblingAtomId of siblingAtomIds) {
    const siblingPosition = coords.get(siblingAtomId);
    if (!siblingPosition) {
      continue;
    }
    const siblingAngle = angleOf(sub(siblingPosition, parentPosition));
    if (angularDifference(currentAttachmentAngle, siblingAngle) <= IMPROVEMENT_EPSILON) {
      continue;
    }

    const siblingSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, siblingAtomId, parentAtomId)
      .filter(atomId => coords.has(atomId) || transformedCoords.has(atomId));
    if (siblingSubtreeAtomIds.some(atomId => attachmentSubtreeAtomIdSet.has(atomId))) {
      continue;
    }
    const movedAtomIds = new Set([...attachmentSubtreeAtomIds, ...siblingSubtreeAtomIds]);
    if (movedAtomIds.size > MAX_DIRECT_ATTACHMENT_PARENT_SLOT_SWAP_ATOMS) {
      continue;
    }

    const attachmentRotation = siblingAngle - currentAttachmentAngle;
    const siblingRotation = currentAttachmentAngle - siblingAngle;
    const nextCoords = new Map(transformedCoords);
    for (const atomId of attachmentSubtreeAtomIds) {
      const position = transformedCoords.get(atomId) ?? coords.get(atomId);
      if (position) {
        nextCoords.set(atomId, add(parentPosition, rotate(sub(position, parentPosition), attachmentRotation)));
      }
    }
    for (const atomId of siblingSubtreeAtomIds) {
      const position = transformedCoords.get(atomId) ?? coords.get(atomId);
      if (position) {
        nextCoords.set(atomId, add(parentPosition, rotate(sub(position, parentPosition), siblingRotation)));
      }
    }

    const slotSwapMeta = {
      ...candidateMeta,
      parentSlotSwap: true,
      parentSlotSwapRootAtomId: siblingAtomId
    };
    const exactRingExitCandidates = buildDirectAttachmentExactRingExitRescueCandidates(
      layoutGraph,
      coords,
      nextCoords,
      slotSwapMeta
    );
    if (exactRingExitCandidates.length > 0) {
      rescueCandidates.push(...exactRingExitCandidates);
      continue;
    }
    rescueCandidates.push({
      transformedCoords: nextCoords,
      meta: slotSwapMeta
    });
  }

  return rescueCandidates;
}

/**
 * Builds exact parent-side visible trigonal rescue poses for one direct-attached
 * ring block by rotating the attached block around its fixed parent atom. This
 * keeps the attached ring's internal orientation intact while letting exact
 * carbonyl- or vinylic-style parent centers recover their `120/120/120` spread
 * if the main direct-attachment beam already pruned that exact parent angle.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Current attached-block coordinates.
 * @param {Set<string>} atomIdsToPlace - Eligible atom IDs for the current mixed placement slice.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Exact parent-angle rescue candidates.
 */
function buildDirectAttachmentExactParentTrigonalRescueCandidates(
  layoutGraph,
  adjacency,
  coords,
  transformedCoords,
  atomIdsToPlace,
  candidateMeta = null
) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !transformedCoords.has(attachmentAtomId)) {
    return [];
  }

  const targetAttachmentAngles = exactDirectAttachmentParentPreferredAngles(
    layoutGraph,
    adjacency,
    coords,
    atomIdsToPlace,
    candidateMeta
  );
  if (targetAttachmentAngles.length === 0) {
    return [];
  }

  const parentPosition = coords.get(parentAtomId);
  const attachmentPosition = transformedCoords.get(attachmentAtomId);
  const currentAttachmentAngle = angleOf(sub(attachmentPosition, parentPosition));
  const rotatedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
    .filter(atomId => atomId === attachmentAtomId || transformedCoords.has(atomId));
  if (rotatedAtomIds.length === 0) {
    return [];
  }
  const childSubtreeAtomIds = rotatedAtomIds.filter(atomId => atomId !== attachmentAtomId);
  const rootRotationOffsets = [...new Set([0, ...DIRECT_ATTACHMENT_LOCAL_REFINEMENT_RING_ROTATION_OFFSETS])];

  const rescueCandidates = [];
  for (const targetAttachmentAngle of targetAttachmentAngles) {
    const rotationAngle = wrapAngle(targetAttachmentAngle - currentAttachmentAngle);
    for (const ringRotationOffset of rootRotationOffsets) {
      if (Math.abs(rotationAngle) <= 1e-9 && Math.abs(ringRotationOffset) <= 1e-9) {
        continue;
      }
      const nextCoords = new Map(transformedCoords);
      for (const atomId of rotatedAtomIds) {
        const currentPosition = transformedCoords.get(atomId);
        if (!currentPosition) {
          continue;
        }
        nextCoords.set(
          atomId,
          add(parentPosition, rotate(sub(currentPosition, parentPosition), rotationAngle))
        );
      }
      if (Math.abs(ringRotationOffset) > 1e-9 && childSubtreeAtomIds.length > 0) {
        const nextAttachmentPosition = nextCoords.get(attachmentAtomId);
        for (const atomId of childSubtreeAtomIds) {
          const currentPosition = nextCoords.get(atomId);
          if (!currentPosition) {
            continue;
          }
          nextCoords.set(
            atomId,
            add(nextAttachmentPosition, rotate(sub(currentPosition, nextAttachmentPosition), ringRotationOffset))
          );
        }
      }
      rescueCandidates.push({
        transformedCoords: nextCoords,
        meta: {
          ...candidateMeta,
          exactParentTrigonalBisectorRescue: true,
          ringRotationOffset,
          targetAttachmentAngle
        }
      });
    }
  }

  return rescueCandidates;
}

function reflectPointAcrossAxis(point, origin, axisUnit) {
  const relativePoint = sub(point, origin);
  const projectedLength = relativePoint.x * axisUnit.x + relativePoint.y * axisUnit.y;
  const projectedPoint = {
    x: axisUnit.x * projectedLength,
    y: axisUnit.y * projectedLength
  };
  const perpendicularPoint = {
    x: relativePoint.x - projectedPoint.x,
    y: relativePoint.y - projectedPoint.y
  };
  return {
    x: origin.x + projectedPoint.x - perpendicularPoint.x,
    y: origin.y + projectedPoint.y - perpendicularPoint.y
  };
}

function buildMirroredParentSideSubtreeCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId) {
    return [];
  }

  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }

  const candidates = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const anchorAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (
      !anchorAtom
      || anchorAtom.element === 'H'
      || anchorAtomId === attachmentAtomId
      || anchorAtom.chirality
      || !candidateCoords.has(anchorAtomId)
    ) {
      continue;
    }

    for (const anchorBond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!anchorBond || anchorBond.kind !== 'covalent') {
        continue;
      }
      const rootAtomId = anchorBond.a === anchorAtomId ? anchorBond.b : anchorBond.a;
      const rootAtom = layoutGraph.atoms.get(rootAtomId);
      if (
        !rootAtom
        || rootAtom.element === 'H'
        || rootAtomId === parentAtomId
        || rootAtom.chirality
        || !candidateCoords.has(rootAtomId)
      ) {
        continue;
      }

      const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, anchorAtomId);
      if (subtreeAtomIds.some(atomId => layoutGraph.atoms.get(atomId)?.chirality)) {
        continue;
      }
      const placedSubtreeAtomIds = subtreeAtomIds.filter(atomId => candidateCoords.has(atomId));
      if (placedSubtreeAtomIds.length === 0) {
        continue;
      }

      const axisVector = sub(candidateCoords.get(rootAtomId), candidateCoords.get(anchorAtomId));
      const axisLength = Math.hypot(axisVector.x, axisVector.y);
      if (axisLength <= IMPROVEMENT_EPSILON) {
        continue;
      }
      const axisUnit = {
        x: axisVector.x / axisLength,
        y: axisVector.y / axisLength
      };

      const mirroredCoords = new Map(transformedCoords);
      for (const atomId of placedSubtreeAtomIds) {
        mirroredCoords.set(
          atomId,
          reflectPointAcrossAxis(candidateCoords.get(atomId), candidateCoords.get(anchorAtomId), axisUnit)
        );
      }
      candidates.push({
        transformedCoords: mirroredCoords,
        meta: {
          ...candidateMeta,
          mirroredParentSubtreeAnchorAtomId: anchorAtomId,
          mirroredParentSubtreeRootAtomId: rootAtomId
        }
      });
    }
  }

  return candidates;
}

/**
 * Penalizes directly attached ring candidates that squeeze the new attachment
 * bond into a pinched gap around a crowded ring anchor. When four heavy bonds
 * meet at a ring junction, the directly attached ring should still preserve a
 * visibly open local slot instead of collapsing into a near-parallel exit.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {number} Junction crowding penalty.
 */
function measureDirectAttachmentJunctionCrowdingPenalty(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return 0;
  }
  if ((layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) === 0 || (layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0) {
    return 0;
  }

  const parentPosition = coords.get(parentAtomId);
  const heavyNeighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    heavyNeighborAngles.push({
      atomId: neighborAtomId,
      angle: angleOf(sub(coords.get(neighborAtomId), parentPosition))
    });
  }
  if (heavyNeighborAngles.length < 4) {
    return 0;
  }

  heavyNeighborAngles.sort((firstRecord, secondRecord) => firstRecord.angle - secondRecord.angle);
  const attachmentIndex = heavyNeighborAngles.findIndex(record => record.atomId === attachmentAtomId);
  if (attachmentIndex < 0) {
    return 0;
  }

  const attachmentRecord = heavyNeighborAngles[attachmentIndex];
  const previousRecord = heavyNeighborAngles[(attachmentIndex + heavyNeighborAngles.length - 1) % heavyNeighborAngles.length];
  const nextRecord = heavyNeighborAngles[(attachmentIndex + 1) % heavyNeighborAngles.length];
  const gapPenalty = gap => {
    const shortfall = DIRECT_ATTACHMENT_MIN_JUNCTION_GAP - gap;
    return shortfall > 0 ? shortfall ** 2 : 0;
  };
  return gapPenalty(angularDifference(attachmentRecord.angle, previousRecord.angle)) + gapPenalty(angularDifference(nextRecord.angle, attachmentRecord.angle));
}

/**
 * Penalizes attached-block orientations that occupy the exact future slot for
 * a terminal multiple-bond leaf, such as a carbonyl oxygen on a lactone ring.
 * The branch placer can compromise the leaf angle to avoid the conflict, but
 * linked ring-system orientation should prefer a pose that leaves the exact
 * trigonal slot available in the first place.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {Iterable<string>} changedAtomIds - Candidate atoms newly placed or moved by the attached block.
 * @returns {number} Exact terminal multiple-bond slot obstruction penalty.
 */
function measureExactTerminalMultipleSlotPenalty(layoutGraph, coords, bondLength, changedAtomIds) {
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return 0;
  }
  const changedAtomIdSet = new Set(changedAtomIds);
  if (changedAtomIdSet.size === 0) {
    return 0;
  }

  const clearanceThreshold = bondLength * EXACT_TERMINAL_MULTIPLE_SLOT_CLEARANCE_FACTOR;
  let penalty = 0;
  for (const [atomId, atom] of layoutGraph.atoms) {
    if (
      !atom
      || atom.element !== 'C'
      || atom.aromatic
      || atom.heavyDegree !== 3
      || !coords.has(atomId)
    ) {
      continue;
    }

    const heavyBonds = (layoutGraph.bondsByAtomId.get(atomId) ?? []).filter(bond => {
      if (!bond || bond.kind !== 'covalent') {
        return false;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H';
    });
    if (heavyBonds.length !== 3) {
      continue;
    }

    for (const terminalBond of heavyBonds) {
      if (
        terminalBond.aromatic
        || (terminalBond.order ?? 1) < 2
        || !isTerminalMultipleBondLeaf(layoutGraph, atomId, terminalBond)
      ) {
        continue;
      }
      const terminalAtomId = terminalBond.a === atomId ? terminalBond.b : terminalBond.a;
      const terminalAtom = layoutGraph.atoms.get(terminalAtomId);
      if (!terminalAtom || terminalAtom.element === 'C') {
        continue;
      }
      const supportNeighborIds = heavyBonds
        .map(bond => (bond.a === atomId ? bond.b : bond.a))
        .filter(neighborAtomId => neighborAtomId !== terminalAtomId && coords.has(neighborAtomId));
      if (supportNeighborIds.length !== 2) {
        continue;
      }
      const slotControlledByCandidate =
        changedAtomIdSet.has(atomId)
        || changedAtomIdSet.has(terminalAtomId)
        || supportNeighborIds.some(neighborAtomId => changedAtomIdSet.has(neighborAtomId));

      const atomPosition = coords.get(atomId);
      const supportCentroid = centroid(supportNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)));
      const idealVector = sub(atomPosition, supportCentroid);
      if (Math.hypot(idealVector.x, idealVector.y) <= 1e-9) {
        continue;
      }

      const idealPosition = add(atomPosition, fromAngle(angleOf(idealVector), bondLength));
      const ignoredAtomIds = new Set([atomId, terminalAtomId, ...supportNeighborIds]);
      const blockerAtomIds = slotControlledByCandidate ? coords.keys() : changedAtomIdSet;
      for (const blockerAtomId of blockerAtomIds) {
        if (ignoredAtomIds.has(blockerAtomId) || !coords.has(blockerAtomId)) {
          continue;
        }
        const blockerAtom = layoutGraph.atoms.get(blockerAtomId);
        if (!blockerAtom || blockerAtom.element === 'H') {
          continue;
        }
        const clearance = distance(idealPosition, coords.get(blockerAtomId));
        if (clearance >= clearanceThreshold) {
          continue;
        }
        const clearanceDeficit = clearanceThreshold - clearance;
        penalty += clearanceDeficit * clearanceDeficit;
      }
    }
  }
  return penalty;
}

function linkedRingSideExitDeviation(layoutGraph, coords, anchorAtomId, linkerAtomId) {
  if (!coords.has(anchorAtomId) || !coords.has(linkerAtomId)) {
    return null;
  }
  const targetAngles = [
    ...directAttachmentLocalOutwardAngles(layoutGraph, coords, anchorAtomId, linkerAtomId),
    ...incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId)
  ].filter((candidateAngle, index, angles) =>
    angles.findIndex(existingAngle => angularDifference(existingAngle, candidateAngle) <= 1e-9) === index
  );
  if (targetAngles.length === 0) {
    return null;
  }
  const actualAngle = angleOf(sub(coords.get(linkerAtomId), coords.get(anchorAtomId)));
  return Math.min(...targetAngles.map(targetAngle => angularDifference(targetAngle, actualAngle)));
}

function findLinkedRingSideBalanceDescriptors(layoutGraph, coords) {
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return [];
  }

  const descriptors = [];
  for (const [linkerAtomId, linkerAtom] of layoutGraph.atoms) {
    if (
      !linkerAtom
      || linkerAtom.element !== 'C'
      || linkerAtom.aromatic
      || linkerAtom.heavyDegree !== 2
      || (layoutGraph.atomToRings.get(linkerAtomId)?.length ?? 0) !== 0
      || !coords.has(linkerAtomId)
    ) {
      continue;
    }

    const anchorIds = [];
    let supportedLinker = true;
    for (const bond of layoutGraph.bondsByAtomId.get(linkerAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === linkerAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1 || !coords.has(neighborAtomId)) {
        supportedLinker = false;
        break;
      }
      anchorIds.push(neighborAtomId);
    }
    if (!supportedLinker || anchorIds.length !== 2) {
      continue;
    }

    const [firstAnchorAtomId, secondAnchorAtomId] = anchorIds.sort((firstAtomId, secondAtomId) =>
      compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank)
    );
    const firstRingSystemId = layoutGraph.atomToRingSystemId.get(firstAnchorAtomId);
    const secondRingSystemId = layoutGraph.atomToRingSystemId.get(secondAnchorAtomId);
    if (
      firstRingSystemId == null
      || secondRingSystemId == null
      || firstRingSystemId === secondRingSystemId
    ) {
      continue;
    }

    const firstSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, firstAnchorAtomId, linkerAtomId)
      .filter(atomId => atomId !== firstAnchorAtomId && coords.has(atomId));
    const secondSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, secondAnchorAtomId, linkerAtomId)
      .filter(atomId => atomId !== secondAnchorAtomId && coords.has(atomId));
    if (
      firstSideAtomIds.length === 0
      || secondSideAtomIds.length === 0
      || firstSideAtomIds.includes(secondAnchorAtomId)
      || secondSideAtomIds.includes(firstAnchorAtomId)
    ) {
      continue;
    }

    descriptors.push({
      linkerAtomId,
      firstAnchorAtomId,
      secondAnchorAtomId,
      firstSideAtomIds,
      secondSideAtomIds
    });
  }
  return descriptors;
}

function buildLinkedRingSideBalanceCoords(coords, descriptor, firstSideRotation, secondSideRotation) {
  const candidateCoords = new Map(coords);
  const firstAnchorPosition = coords.get(descriptor.firstAnchorAtomId);
  const secondAnchorPosition = coords.get(descriptor.secondAnchorAtomId);
  if (!firstAnchorPosition || !secondAnchorPosition) {
    return candidateCoords;
  }

  if (Math.abs(firstSideRotation) > 1e-9) {
    for (const atomId of descriptor.firstSideAtomIds) {
      const currentPosition = coords.get(atomId);
      if (currentPosition) {
        candidateCoords.set(atomId, add(firstAnchorPosition, rotate(sub(currentPosition, firstAnchorPosition), firstSideRotation)));
      }
    }
  }
  if (Math.abs(secondSideRotation) > 1e-9) {
    for (const atomId of descriptor.secondSideAtomIds) {
      const currentPosition = coords.get(atomId);
      if (currentPosition) {
        candidateCoords.set(atomId, add(secondAnchorPosition, rotate(sub(currentPosition, secondAnchorPosition), secondSideRotation)));
      }
    }
  }
  return candidateCoords;
}

function measureLinkedRingSideBalanceScore(layoutGraph, coords, bondLength, descriptor, changedAtomIds = []) {
  const firstDeviation = linkedRingSideExitDeviation(layoutGraph, coords, descriptor.firstAnchorAtomId, descriptor.linkerAtomId);
  const secondDeviation = linkedRingSideExitDeviation(layoutGraph, coords, descriptor.secondAnchorAtomId, descriptor.linkerAtomId);
  if (firstDeviation == null || secondDeviation == null) {
    return null;
  }
  const readability = measureRingSubstituentReadability(layoutGraph, coords);
  return {
    firstDeviation,
    secondDeviation,
    endpointSquaredDeviation: firstDeviation ** 2 + secondDeviation ** 2,
    endpointMaxDeviation: Math.max(firstDeviation, secondDeviation),
    overlapCount: findSevereOverlaps(layoutGraph, coords, bondLength).length,
    readability,
    trigonalPenalty: measureTrigonalDistortion(layoutGraph, coords).totalDeviation,
    exactTerminalMultipleSlotPenalty: changedAtomIds.length > 0
      ? measureExactTerminalMultipleSlotPenalty(layoutGraph, coords, bondLength, changedAtomIds)
      : 0
  };
}

function linkedRingSideBalanceCandidateIsAcceptable(candidateScore, baseScore) {
  return (
    candidateScore.overlapCount <= baseScore.overlapCount
    && candidateScore.readability.failingSubstituentCount <= baseScore.readability.failingSubstituentCount
    && candidateScore.exactTerminalMultipleSlotPenalty <= baseScore.exactTerminalMultipleSlotPenalty + IMPROVEMENT_EPSILON
    && candidateScore.trigonalPenalty <= baseScore.trigonalPenalty + Math.PI / 36
    && candidateScore.endpointSquaredDeviation < baseScore.endpointSquaredDeviation - (Math.PI / 180) ** 2
  );
}

function compareLinkedRingSideBalanceScores(candidateScore, incumbentScore) {
  if (candidateScore.overlapCount !== incumbentScore.overlapCount) {
    return candidateScore.overlapCount - incumbentScore.overlapCount;
  }
  if (candidateScore.readability.failingSubstituentCount !== incumbentScore.readability.failingSubstituentCount) {
    return candidateScore.readability.failingSubstituentCount - incumbentScore.readability.failingSubstituentCount;
  }
  if (Math.abs(candidateScore.exactTerminalMultipleSlotPenalty - incumbentScore.exactTerminalMultipleSlotPenalty) > IMPROVEMENT_EPSILON) {
    return candidateScore.exactTerminalMultipleSlotPenalty - incumbentScore.exactTerminalMultipleSlotPenalty;
  }
  if (Math.abs(candidateScore.endpointMaxDeviation - incumbentScore.endpointMaxDeviation) > IMPROVEMENT_EPSILON) {
    return candidateScore.endpointMaxDeviation - incumbentScore.endpointMaxDeviation;
  }
  if (Math.abs(candidateScore.endpointSquaredDeviation - incumbentScore.endpointSquaredDeviation) > IMPROVEMENT_EPSILON) {
    return candidateScore.endpointSquaredDeviation - incumbentScore.endpointSquaredDeviation;
  }
  if (Math.abs(candidateScore.trigonalPenalty - incumbentScore.trigonalPenalty) > IMPROVEMENT_EPSILON) {
    return candidateScore.trigonalPenalty - incumbentScore.trigonalPenalty;
  }
  if (Math.abs(candidateScore.readability.totalOutwardDeviation - incumbentScore.readability.totalOutwardDeviation) > IMPROVEMENT_EPSILON) {
    return candidateScore.readability.totalOutwardDeviation - incumbentScore.readability.totalOutwardDeviation;
  }
  return 0;
}

function balanceLinkedRingSideExits(layoutGraph, coords, bondLength) {
  let changed = false;
  for (const descriptor of findLinkedRingSideBalanceDescriptors(layoutGraph, coords)) {
    const baseScore = measureLinkedRingSideBalanceScore(layoutGraph, coords, bondLength, descriptor);
    if (!baseScore || baseScore.endpointMaxDeviation <= Math.PI / 18) {
      continue;
    }

    let bestCoords = null;
    let bestScore = baseScore;
    const changedAtomIds = [...new Set([...descriptor.firstSideAtomIds, ...descriptor.secondSideAtomIds])];
    for (const firstSideRotation of LINKED_RING_SIDE_BALANCE_ROTATION_OFFSETS) {
      for (const secondSideRotation of LINKED_RING_SIDE_BALANCE_ROTATION_OFFSETS) {
        if (Math.abs(firstSideRotation) <= 1e-9 && Math.abs(secondSideRotation) <= 1e-9) {
          continue;
        }
        const candidateCoords = buildLinkedRingSideBalanceCoords(coords, descriptor, firstSideRotation, secondSideRotation);
        const candidateScore = measureLinkedRingSideBalanceScore(
          layoutGraph,
          candidateCoords,
          bondLength,
          descriptor,
          changedAtomIds
        );
        if (
          candidateScore
          && linkedRingSideBalanceCandidateIsAcceptable(candidateScore, baseScore)
          && compareLinkedRingSideBalanceScores(candidateScore, bestScore) < 0
        ) {
          bestCoords = candidateCoords;
          bestScore = candidateScore;
        }
      }
    }

    if (bestCoords) {
      overwriteCoordMap(coords, bestCoords);
      changed = true;
    }
  }

  return { changed };
}

function linkedMethyleneHydrogenNeighborIds(layoutGraph, coords, linkerAtomId) {
  const hydrogenAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(linkerAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === linkerAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom?.element === 'H' && coords.has(neighborAtomId)) {
      hydrogenAtomIds.push(neighborAtomId);
    }
  }
  return hydrogenAtomIds.sort((firstAtomId, secondAtomId) =>
    compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank)
  );
}

function measureLinkedMethyleneHydrogenAngularScore(coords, centerAtomId, neighborAtomIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborAtomIds.length !== 4) {
    return null;
  }

  const neighborAngles = [];
  for (const neighborAtomId of neighborAtomIds) {
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborPosition) {
      return null;
    }
    neighborAngles.push(angleOf(sub(neighborPosition, centerPosition)));
  }

  let angularPenalty = 0;
  let minSeparation = Infinity;
  let maxSeparation = 0;
  for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
      const separation = angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]);
      minSeparation = Math.min(minSeparation, separation);
      maxSeparation = Math.max(maxSeparation, separation);
      angularPenalty += Math.max(0, LINKED_METHYLENE_HYDROGEN_MIN_SEPARATION - separation) ** 2;
      angularPenalty += Math.max(0, separation - LINKED_METHYLENE_HYDROGEN_MAX_SEPARATION) ** 2;
    }
  }

  return {
    angularPenalty,
    minSeparation,
    maxSeparation
  };
}

function measureLinkedMethyleneHydrogenScore(layoutGraph, coords, bondLength, linkerAtomId, neighborAtomIds) {
  const angularScore = measureLinkedMethyleneHydrogenAngularScore(coords, linkerAtomId, neighborAtomIds);
  if (!angularScore) {
    return null;
  }
  return {
    ...angularScore,
    overlapCount: findSevereOverlaps(layoutGraph, coords, bondLength).length
  };
}

function buildLinkedMethyleneHydrogenCoords(coords, bondLength, linkerAtomId, heavyNeighborAtomIds, hydrogenAtomIds) {
  const centerPosition = coords.get(linkerAtomId);
  if (!centerPosition || heavyNeighborAtomIds.length !== 2 || hydrogenAtomIds.length !== 2) {
    return null;
  }

  const heavyAngles = [];
  for (const heavyNeighborAtomId of heavyNeighborAtomIds) {
    const heavyNeighborPosition = coords.get(heavyNeighborAtomId);
    if (!heavyNeighborPosition) {
      return null;
    }
    heavyAngles.push(angleOf(sub(heavyNeighborPosition, centerPosition)));
  }

  const openGap = largestAngularGapDetails(heavyAngles);
  if (!openGap || openGap.gap <= Math.PI) {
    return null;
  }
  const hydrogenHalfSpread = openGap.gap / 6;
  const targetAngles = [
    wrapAngle(openGap.bisector - hydrogenHalfSpread),
    wrapAngle(openGap.bisector + hydrogenHalfSpread)
  ];
  const currentHydrogenAngles = hydrogenAtomIds.map(hydrogenAtomId =>
    angleOf(sub(coords.get(hydrogenAtomId), centerPosition))
  );
  const directAssignmentMovement =
    angularDifference(currentHydrogenAngles[0], targetAngles[0])
    + angularDifference(currentHydrogenAngles[1], targetAngles[1]);
  const swappedAssignmentMovement =
    angularDifference(currentHydrogenAngles[0], targetAngles[1])
    + angularDifference(currentHydrogenAngles[1], targetAngles[0]);
  const assignedTargetAngles = swappedAssignmentMovement < directAssignmentMovement
    ? [targetAngles[1], targetAngles[0]]
    : targetAngles;
  const hydrogenBondLengths = hydrogenAtomIds
    .map(hydrogenAtomId => distance(centerPosition, coords.get(hydrogenAtomId)))
    .filter(bondDistance => Number.isFinite(bondDistance) && bondDistance > 1e-9);
  const hydrogenBondLength = hydrogenBondLengths.length > 0
    ? hydrogenBondLengths.reduce((sum, bondDistance) => sum + bondDistance, 0) / hydrogenBondLengths.length
    : bondLength;
  const candidateCoords = new Map(coords);
  for (let index = 0; index < hydrogenAtomIds.length; index++) {
    candidateCoords.set(hydrogenAtomIds[index], add(centerPosition, fromAngle(assignedTargetAngles[index], hydrogenBondLength)));
  }
  return candidateCoords;
}

function refineLinkedMethyleneHydrogenSlots(layoutGraph, coords, bondLength) {
  let changed = false;
  for (const descriptor of findLinkedRingSideBalanceDescriptors(layoutGraph, coords)) {
    const hydrogenAtomIds = linkedMethyleneHydrogenNeighborIds(layoutGraph, coords, descriptor.linkerAtomId);
    if (hydrogenAtomIds.length !== 2) {
      continue;
    }

    const heavyNeighborAtomIds = [descriptor.firstAnchorAtomId, descriptor.secondAnchorAtomId];
    const neighborAtomIds = [...heavyNeighborAtomIds, ...hydrogenAtomIds];
    const baseScore = measureLinkedMethyleneHydrogenScore(layoutGraph, coords, bondLength, descriptor.linkerAtomId, neighborAtomIds);
    if (!baseScore || baseScore.angularPenalty <= IMPROVEMENT_EPSILON) {
      continue;
    }

    const candidateCoords = buildLinkedMethyleneHydrogenCoords(
      coords,
      bondLength,
      descriptor.linkerAtomId,
      heavyNeighborAtomIds,
      hydrogenAtomIds
    );
    if (!candidateCoords) {
      continue;
    }

    const candidateScore = measureLinkedMethyleneHydrogenScore(
      layoutGraph,
      candidateCoords,
      bondLength,
      descriptor.linkerAtomId,
      neighborAtomIds
    );
    if (
      candidateScore
      && candidateScore.overlapCount <= baseScore.overlapCount
      && candidateScore.angularPenalty < baseScore.angularPenalty - IMPROVEMENT_EPSILON
      && candidateScore.minSeparation >= baseScore.minSeparation - Math.PI / 180
      && candidateScore.maxSeparation <= baseScore.maxSeparation + Math.PI / 180
    ) {
      overwriteCoordMap(coords, candidateCoords);
      changed = true;
    }
  }
  return { changed };
}

function measureAttachedBlockCandidateState(baseCoords, candidateCoords, bondLength, layoutGraph, candidateMeta = null) {
  const changedAtomIds = [...candidateCoords.keys()].filter(atomId => {
    if (!baseCoords.has(atomId)) {
      return true;
    }
    const basePosition = baseCoords.get(atomId);
    const candidatePosition = candidateCoords.get(atomId);
      return Math.hypot(candidatePosition.x - basePosition.x, candidatePosition.y - basePosition.y) > 1e-9;
  });
  const scoringFocusAtomIds = expandScoringFocusAtomIds(layoutGraph, changedAtomIds);
  const readabilityFocusAtomIds = expandScoringFocusAtomIds(layoutGraph, changedAtomIds, 2);
  const readability = measureRingSubstituentReadability(layoutGraph, candidateCoords, {
    focusAtomIds: readabilityFocusAtomIds
  });
  const overlapCount = findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length;
  const fusedJunctionContinuationPenalty = measureDirectAttachmentFusedJunctionContinuationPenalty(layoutGraph, candidateCoords, candidateMeta);
  const exactContinuationPenalty = measureDirectAttachmentExactContinuationPenalty(layoutGraph, candidateCoords, candidateMeta);
  const parentVisibleTrigonalPenalty = measureDirectAttachmentParentVisibleTrigonalPenalty(layoutGraph, candidateCoords, candidateMeta);
  const parentOutwardPenalty = measureDirectAttachmentParentOutwardPenalty(layoutGraph, candidateCoords, candidateMeta);
  const trigonalBisectorPenalty = measureDirectAttachmentTrigonalBisectorPenalty(layoutGraph, candidateCoords, candidateMeta);
  const ringExitPenaltySummary = measureMixedRootExactRingExitPenalty(layoutGraph, candidateCoords, scoringFocusAtomIds);
  const ringExitPenalty = ringExitPenaltySummary.totalDeviation;
  const ringExitMaxPenalty = ringExitPenaltySummary.maxDeviation;
  const canonicalContinuationPenalty = measureDirectAttachmentCanonicalContinuationPenalty(layoutGraph, candidateCoords, candidateMeta);
  const omittedHydrogenTrigonalPenalty = measureThreeHeavyContinuationDistortion(layoutGraph, candidateCoords, {
    focusAtomIds: scoringFocusAtomIds
  }).totalDeviation;
  const omittedHydrogenDirectAttachmentCompromisePenalty = candidateMeta?.parentAtomId && candidateMeta?.attachmentAtomId
    ? (() => {
        const sensitivity = summarizeDirectAttachmentTrigonalBisectorSensitivity(
          layoutGraph,
          candidateCoords,
          candidateMeta.parentAtomId,
          candidateMeta.attachmentAtomId
        );
        return sensitivity.omittedHydrogen ? omittedHydrogenTrigonalPenalty + parentOutwardPenalty : 0;
      })()
    : 0;
  const attachmentExteriorPenalty = measureDirectAttachmentExteriorContinuationPenalty(layoutGraph, candidateCoords, candidateMeta);
  const junctionCrowdingPenalty = measureDirectAttachmentJunctionCrowdingPenalty(layoutGraph, candidateCoords, candidateMeta);
  const exactTerminalMultipleSlotPenalty = measureExactTerminalMultipleSlotPenalty(layoutGraph, candidateCoords, bondLength, changedAtomIds);
  const smallRingExteriorPenalty = [...scoringFocusAtomIds].reduce(
    (sum, atomId) => sum + (candidateCoords.has(atomId) ? measureSmallRingExteriorGapSpreadPenalty(layoutGraph, candidateCoords, atomId) : 0),
    0
  );
  const shouldScoreIdealLeafPresentation =
    changedAtomIds.length <= 12 && (layoutGraph.traits.heavyAtomCount ?? 0) <= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT;
  const idealLeafPresentationPenalty = shouldScoreIdealLeafPresentation
    ? measureRingSubstituentPresentationPenalty(layoutGraph, candidateCoords, {
        focusAtomIds: readabilityFocusAtomIds
      })
    : 0;

  return {
    overlapCount,
    fusedJunctionContinuationPenalty,
    parentVisibleTrigonalPenalty,
    parentOutwardPenalty,
    exactContinuationPenalty,
    trigonalBisectorPenalty,
    ringExitPenalty,
    ringExitMaxPenalty,
    canonicalContinuationPenalty,
    omittedHydrogenTrigonalPenalty,
    omittedHydrogenDirectAttachmentCompromisePenalty,
    attachmentExteriorPenalty,
    junctionCrowdingPenalty,
    exactTerminalMultipleSlotPenalty,
    presentationPenalty: (readability.totalOutwardDeviation ?? 0) + smallRingExteriorPenalty + idealLeafPresentationPenalty,
    idealLeafPresentationPenalty,
    smallRingExteriorPenalty,
    changedAtomIds,
    readability
  };
}

function mixedAttachedBlockWorkload(coords, primaryNonRingAtomIds) {
  return coords.size + primaryNonRingAtomIds.size;
}

function shouldSkipAttachedBlockBranchScoring(coords, primaryNonRingAtomIds) {
  return primaryNonRingAtomIds.size > 30 || mixedAttachedBlockWorkload(coords, primaryNonRingAtomIds) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT + 20;
}

function canAcceptAttachedBlockPrescore(bestScore, runnerUpScore, coords, primaryNonRingAtomIds, bondLength) {
  const workload = mixedAttachedBlockWorkload(coords, primaryNonRingAtomIds);
  const shouldPreferCheapDecision =
    primaryNonRingAtomIds.size >= 8 || workload >= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT;
  if (!shouldPreferCheapDecision || !bestScore) {
    return false;
  }
  if (
    bestScore.overlapCount !== 0 ||
    bestScore.readability.failingSubstituentCount !== 0 ||
    bestScore.fusedJunctionContinuationPenalty > IMPROVEMENT_EPSILON ||
    bestScore.parentVisibleTrigonalPenalty > IMPROVEMENT_EPSILON ||
    bestScore.parentOutwardPenalty > IMPROVEMENT_EPSILON ||
    bestScore.exactContinuationPenalty > IMPROVEMENT_EPSILON ||
    bestScore.exactTerminalMultipleSlotPenalty > IMPROVEMENT_EPSILON ||
    bestScore.trigonalBisectorPenalty > IMPROVEMENT_EPSILON ||
    bestScore.ringExitPenalty > IMPROVEMENT_EPSILON ||
    bestScore.ringExitMaxPenalty > IMPROVEMENT_EPSILON ||
    bestScore.attachmentExteriorPenalty > IMPROVEMENT_EPSILON ||
    bestScore.junctionCrowdingPenalty > IMPROVEMENT_EPSILON ||
    bestScore.presentationPenalty > 0.25
  ) {
    return false;
  }
  if (!runnerUpScore) {
    return true;
  }
  return (
    runnerUpScore.overlapCount > 0 ||
    runnerUpScore.readability.failingSubstituentCount > 0 ||
    runnerUpScore.fusedJunctionContinuationPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.parentVisibleTrigonalPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.parentOutwardPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.exactContinuationPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.exactTerminalMultipleSlotPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.trigonalBisectorPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.ringExitPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.ringExitMaxPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.attachmentExteriorPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.junctionCrowdingPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.presentationPenalty > bestScore.presentationPenalty + 0.2 ||
    runnerUpScore.cost > bestScore.cost + bondLength * 0.2
  );
}

function attachedBlockPrimaryScoreIsPerfect(score) {
  if (!score) {
    return false;
  }
  return (
    score.overlapCount === 0 &&
    score.readability.failingSubstituentCount === 0 &&
    score.fusedJunctionContinuationPenalty <= IMPROVEMENT_EPSILON &&
    score.parentVisibleTrigonalPenalty <= IMPROVEMENT_EPSILON &&
    score.parentOutwardPenalty <= IMPROVEMENT_EPSILON &&
    score.exactContinuationPenalty <= IMPROVEMENT_EPSILON &&
    score.exactTerminalMultipleSlotPenalty <= IMPROVEMENT_EPSILON &&
    score.trigonalBisectorPenalty <= IMPROVEMENT_EPSILON &&
    score.ringExitPenalty <= IMPROVEMENT_EPSILON &&
    score.ringExitMaxPenalty <= IMPROVEMENT_EPSILON &&
    score.attachmentExteriorPenalty <= IMPROVEMENT_EPSILON &&
    score.junctionCrowdingPenalty <= IMPROVEMENT_EPSILON &&
    score.presentationPenalty <= IMPROVEMENT_EPSILON
  );
}

function canSkipRemainingAttachedBlockFinalists(bestScore, finalists, nextIndex) {
  if (!attachedBlockPrimaryScoreIsPerfect(bestScore)) {
    return false;
  }
  for (let index = nextIndex; index < finalists.length; index++) {
    if (attachedBlockPrimaryScoreIsPerfect(finalists[index]?._prescore ?? null)) {
      return false;
    }
  }
  return true;
}

function attachedBlockFullScoringBeamLimit(coords, primaryNonRingAtomIds, candidateCount, forceFullScoring = false) {
  const workload = mixedAttachedBlockWorkload(coords, primaryNonRingAtomIds);
  if (forceFullScoring) {
    return candidateCount;
  }
  if (candidateCount <= 1) {
    return candidateCount;
  }
  if (primaryNonRingAtomIds.size >= 20 || workload >= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT + 20) {
    return 1;
  }
  if (primaryNonRingAtomIds.size >= 10 || workload >= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return Math.min(2, candidateCount);
  }
  return candidateCount;
}

/**
 * Scores an attached-block orientation by placing the block plus the remaining
 * heavy non-ring branches into a temporary mixed-layout snapshot.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom-rank map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} primaryNonRingAtomIds - Heavy non-ring atom IDs.
 * @param {Iterable<string>} placedAtomIds - Already placed atom IDs.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Candidate attached-block coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata for local junction tie-breaks.
 * @param {{prescore?: {coords: Map<string, {x: number, y: number}>}, placementContext?: object|null}} [options] - Optional scoring reuse state.
 * @returns {{layoutCost: number|null, totalCost: number|null, overlapCount: number, presentationPenalty: number, idealLeafPresentationPenalty: number, fusedJunctionContinuationPenalty: number, parentOutwardPenalty: number, exactContinuationPenalty: number, exactTerminalMultipleSlotPenalty: number, trigonalBisectorPenalty: number, ringExitMaxPenalty: number, omittedHydrogenTrigonalPenalty: number, omittedHydrogenDirectAttachmentCompromisePenalty: number, attachmentExteriorPenalty: number, junctionCrowdingPenalty: number, smallRingExteriorPenalty: number, changedAtomIds: string[], readability: {failingSubstituentCount: number, inwardSubstituentCount: number, outwardAxisFailureCount: number, totalOutwardDeviation: number, maxOutwardDeviation: number}}} Candidate layout score.
 */
function scoreAttachedBlockOrientation(
  adjacency,
  canonicalAtomRank,
  coords,
  primaryNonRingAtomIds,
  placedAtomIds,
  transformedCoords,
  bondLength,
  layoutGraph,
  branchConstraints = null,
  candidateMeta = null,
  options = {}
) {
  const candidateCoords = options.prescore?.coords ? new Map(options.prescore.coords) : new Map(coords);
  const candidateSeedAtomIds = new Set(placedAtomIds);

  for (const [atomId, position] of transformedCoords) {
    if (!options.prescore?.coords) {
      candidateCoords.set(atomId, position);
    }
    candidateSeedAtomIds.add(atomId);
  }

  if (!shouldSkipAttachedBlockBranchScoring(coords, primaryNonRingAtomIds)) {
    placeRemainingBranches(
      adjacency,
      canonicalAtomRank,
      candidateCoords,
      primaryNonRingAtomIds,
      [...candidateSeedAtomIds],
      bondLength,
      layoutGraph,
      branchConstraints,
      0,
      options.placementContext ?? null
    );
  }
  return {
    layoutCost: null,
    totalCost: null,
    ...measureAttachedBlockCandidateState(coords, candidateCoords, bondLength, layoutGraph, candidateMeta)
  };
}

function ensureAttachedBlockLayoutCost(candidateScore, candidateCoords, layoutGraph, bondLength) {
  if (candidateScore.layoutCost != null && candidateScore.totalCost != null) {
    return candidateScore;
  }

  const layoutCost =
    candidateScore.changedAtomIds.length >= 12
      ? measureFocusedPlacementCost(layoutGraph, candidateCoords, bondLength, candidateScore.changedAtomIds)
      : measureLayoutCost(layoutGraph, candidateCoords, bondLength);
  const readabilityPenalty =
    candidateScore.readability.outwardAxisFailureCount * ATTACHED_BLOCK_OUTWARD_READABILITY_PENALTY +
    candidateScore.readability.inwardSubstituentCount * ATTACHED_BLOCK_INWARD_READABILITY_PENALTY;
  candidateScore.layoutCost = layoutCost;
  candidateScore.totalCost =
    layoutCost +
    readabilityPenalty +
    candidateScore.fusedJunctionContinuationPenalty +
    candidateScore.parentVisibleTrigonalPenalty +
    candidateScore.parentOutwardPenalty +
    candidateScore.ringExitMaxPenalty +
    candidateScore.ringExitPenalty +
    candidateScore.attachmentExteriorPenalty +
    candidateScore.trigonalBisectorPenalty +
    candidateScore.exactTerminalMultipleSlotPenalty +
    candidateScore.junctionCrowdingPenalty +
    candidateScore.smallRingExteriorPenalty;
  return candidateScore;
}

function compareAttachedBlockScores(cand, inc) {
  if (cand.overlapCount !== inc.overlapCount) {
    return cand.overlapCount - inc.overlapCount;
  }
  if (Math.abs(cand.exactTerminalMultipleSlotPenalty - inc.exactTerminalMultipleSlotPenalty) > IMPROVEMENT_EPSILON) {
    return cand.exactTerminalMultipleSlotPenalty - inc.exactTerminalMultipleSlotPenalty;
  }
  if (cand.readability.failingSubstituentCount !== inc.readability.failingSubstituentCount) {
    return cand.readability.failingSubstituentCount - inc.readability.failingSubstituentCount;
  }
  for (const key of ['fusedJunctionContinuationPenalty', 'parentVisibleTrigonalPenalty', 'parentOutwardPenalty', 'exactContinuationPenalty', 'trigonalBisectorPenalty', 'ringExitMaxPenalty', 'ringExitPenalty', 'attachmentExteriorPenalty', 'junctionCrowdingPenalty', 'smallRingExteriorPenalty', 'presentationPenalty']) {
    if (Math.abs(cand[key] - inc[key]) > IMPROVEMENT_EPSILON) {
      return cand[key] - inc[key];
    }
  }
  return 0;
}

function compareOmittedHydrogenDirectAttachmentRefinementScores(cand, inc) {
  if (cand.overlapCount !== inc.overlapCount) {
    return cand.overlapCount - inc.overlapCount;
  }
  if (Math.abs(cand.exactTerminalMultipleSlotPenalty - inc.exactTerminalMultipleSlotPenalty) > IMPROVEMENT_EPSILON) {
    return cand.exactTerminalMultipleSlotPenalty - inc.exactTerminalMultipleSlotPenalty;
  }
  if (cand.readability.failingSubstituentCount !== inc.readability.failingSubstituentCount) {
    return cand.readability.failingSubstituentCount - inc.readability.failingSubstituentCount;
  }
  for (const key of ['fusedJunctionContinuationPenalty', 'parentVisibleTrigonalPenalty', 'parentOutwardPenalty', 'exactContinuationPenalty', 'trigonalBisectorPenalty', 'ringExitMaxPenalty', 'ringExitPenalty', 'attachmentExteriorPenalty', 'junctionCrowdingPenalty']) {
    if (Math.abs(cand[key] - inc[key]) > IMPROVEMENT_EPSILON) {
      return cand[key] - inc[key];
    }
  }
  if (Math.abs(cand.omittedHydrogenDirectAttachmentCompromisePenalty - inc.omittedHydrogenDirectAttachmentCompromisePenalty) > IMPROVEMENT_EPSILON) {
    return cand.omittedHydrogenDirectAttachmentCompromisePenalty - inc.omittedHydrogenDirectAttachmentCompromisePenalty;
  }
  if (Math.abs(cand.presentationPenalty - inc.presentationPenalty) > IMPROVEMENT_EPSILON) {
    return cand.presentationPenalty - inc.presentationPenalty;
  }
  return 0;
}

/**
 * Compares exact trigonal-bisector rescue scores. Strict exact ring exits are
 * allowed to beat an incumbent that is already overlapping when they cost only
 * a small number of extra transient overlaps and otherwise materially improve
 * the local geometry.
 * @param {object} cand - Candidate rescue score.
 * @param {object} inc - Incumbent score.
 * @returns {number} Negative when the candidate wins, positive when it loses.
 */
function compareExactTrigonalBisectorRescueScores(cand, inc) {
  const candidateIsExact =
    cand.parentVisibleTrigonalPenalty <= IMPROVEMENT_EPSILON
    && cand.trigonalBisectorPenalty <= IMPROVEMENT_EPSILON
    && cand.parentOutwardPenalty <= IMPROVEMENT_EPSILON
    && cand.ringExitPenalty <= IMPROVEMENT_EPSILON;
  const incumbentIsExact =
    inc.parentVisibleTrigonalPenalty <= IMPROVEMENT_EPSILON
    && inc.trigonalBisectorPenalty <= IMPROVEMENT_EPSILON
    && inc.parentOutwardPenalty <= IMPROVEMENT_EPSILON
    && inc.ringExitPenalty <= IMPROVEMENT_EPSILON;
  if (
    candidateIsExact
    && !incumbentIsExact
    && inc.overlapCount > 0
    && cand.overlapCount <= Math.min(inc.overlapCount + 2, 3)
    && cand.readability.failingSubstituentCount <= inc.readability.failingSubstituentCount
    && cand.fusedJunctionContinuationPenalty <= inc.fusedJunctionContinuationPenalty + IMPROVEMENT_EPSILON
    && cand.exactContinuationPenalty <= inc.exactContinuationPenalty + IMPROVEMENT_EPSILON
    && cand.ringExitPenalty <= inc.ringExitPenalty + IMPROVEMENT_EPSILON
    && cand.attachmentExteriorPenalty <= inc.attachmentExteriorPenalty + IMPROVEMENT_EPSILON
    && cand.junctionCrowdingPenalty <= inc.junctionCrowdingPenalty + IMPROVEMENT_EPSILON
  ) {
    return -1;
  }
  if (
    !candidateIsExact
    && incumbentIsExact
    && cand.overlapCount > 0
    && inc.overlapCount <= Math.min(cand.overlapCount + 2, 3)
    && inc.readability.failingSubstituentCount <= cand.readability.failingSubstituentCount
    && inc.fusedJunctionContinuationPenalty <= cand.fusedJunctionContinuationPenalty + IMPROVEMENT_EPSILON
    && inc.exactContinuationPenalty <= cand.exactContinuationPenalty + IMPROVEMENT_EPSILON
    && inc.ringExitPenalty <= cand.ringExitPenalty + IMPROVEMENT_EPSILON
    && inc.attachmentExteriorPenalty <= cand.attachmentExteriorPenalty + IMPROVEMENT_EPSILON
    && inc.junctionCrowdingPenalty <= cand.junctionCrowdingPenalty + IMPROVEMENT_EPSILON
  ) {
    return 1;
  }
  return compareAttachedBlockScores(cand, inc);
}

/**
 * Selects the best fully scored attached-block orientation from a candidate set.
 * @param {Array<{transformedCoords: Map<string, {x: number, y: number}>}>} candidates - Candidate attached-block orientations.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom-rank map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} primaryNonRingAtomIds - Heavy non-ring atom IDs.
 * @param {Iterable<string>} placedAtomIds - Already placed atom IDs.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @param {{forceFullScoring?: boolean, placementContext?: object|null}} [options] - Optional finalist-beam overrides and reusable branch-placement context.
 * @returns {{transformedCoords: Map<string, {x: number, y: number}>, score: {layoutCost: number|null, totalCost: number|null, overlapCount: number, presentationPenalty: number, exactContinuationPenalty: number, exactTerminalMultipleSlotPenalty: number, ringExitMaxPenalty: number, omittedHydrogenTrigonalPenalty: number, omittedHydrogenDirectAttachmentCompromisePenalty: number, readability: {failingSubstituentCount: number, inwardSubstituentCount: number, outwardAxisFailureCount: number, totalOutwardDeviation: number, maxOutwardDeviation: number}}, meta?: object}|null} Best scored candidate.
 */
function pickBestAttachedBlockOrientation(
  candidates,
  adjacency,
  canonicalAtomRank,
  coords,
  primaryNonRingAtomIds,
  placedAtomIds,
  bondLength,
  layoutGraph,
  branchConstraints = null,
  options = {}
) {
  if (candidates.length === 0) {
    return null;
  }

  const scoredCandidates = candidates.map(candidate => ({
    ...candidate,
    _prescore: candidate._prescore ?? preScoreAttachedBlockOrientation(coords, candidate.transformedCoords, bondLength, layoutGraph, candidate.meta ?? null)
  }));
  const requiresFullExactVisibleTrigonalScoring =
    options.forceFullScoring === true
    || hasPendingExactVisibleTrigonalContinuation(layoutGraph, coords, primaryNonRingAtomIds)
    || scoredCandidates.some(candidate => (candidate._prescore?.exactTerminalMultipleSlotPenalty ?? 0) > IMPROVEMENT_EPSILON)
    || hasSensitiveDirectAttachmentCandidates(layoutGraph, coords, scoredCandidates);
  const [bestPrescoredCandidate, secondPrescoredCandidate] = scoredCandidates;
  if (
    !requiresFullExactVisibleTrigonalScoring &&
    options.disablePrescoreAcceptance !== true &&
    canAcceptAttachedBlockPrescore(
      bestPrescoredCandidate?._prescore ?? null,
      secondPrescoredCandidate?._prescore ?? null,
      coords,
      primaryNonRingAtomIds,
      bondLength
    )
  ) {
    return {
      transformedCoords: bestPrescoredCandidate.transformedCoords,
      score: bestPrescoredCandidate._prescore,
      meta: bestPrescoredCandidate.meta ?? null
    };
  }

  const hasMultiplePerfectPrescoredCandidates =
    scoredCandidates.filter(candidate => attachedBlockPrimaryScoreIsPerfect(candidate._prescore ?? null)).length > 1;
  const finalists = scoredCandidates.slice(
    0,
    options.disableBeamReduction === true || hasMultiplePerfectPrescoredCandidates || requiresFullExactVisibleTrigonalScoring
      ? scoredCandidates.length
      : attachedBlockFullScoringBeamLimit(
          coords,
          primaryNonRingAtomIds,
          scoredCandidates.length,
          requiresFullExactVisibleTrigonalScoring
        )
  );
  let bestCandidate = null;
  let bestScore = null;

  for (let candidateIndex = 0; candidateIndex < finalists.length; candidateIndex++) {
    const candidate = finalists[candidateIndex];
    const candidateScore = scoreAttachedBlockOrientation(
      adjacency,
      canonicalAtomRank,
      coords,
      primaryNonRingAtomIds,
      placedAtomIds,
      candidate.transformedCoords,
      bondLength,
      layoutGraph,
      branchConstraints,
      candidate.meta ?? null,
      {
        prescore: candidate._prescore ?? null,
        placementContext: options.placementContext ?? null
      }
    );
    const cmp = bestScore == null ? -1 : compareAttachedBlockScores(candidateScore, bestScore);
    let shouldReplaceBestCandidate = cmp < 0;
    if (!shouldReplaceBestCandidate && cmp === 0 && bestCandidate) {
      const canonicalContinuationPreference = compareDirectAttachmentCanonicalContinuationPreference(
        layoutGraph,
        candidate.transformedCoords,
        bestCandidate.transformedCoords,
        candidate.meta ?? null,
        bestCandidate.meta ?? null
      );
      if (canonicalContinuationPreference < 0) {
        shouldReplaceBestCandidate = true;
      }
    }
    if (!shouldReplaceBestCandidate && cmp === 0 && bestCandidate) {
      ensureAttachedBlockLayoutCost(candidateScore, candidate.transformedCoords, layoutGraph, bondLength);
      ensureAttachedBlockLayoutCost(bestScore, bestCandidate.transformedCoords, layoutGraph, bondLength);
      if (candidateScore.totalCost < bestScore.totalCost - IMPROVEMENT_EPSILON) {
        shouldReplaceBestCandidate = true;
      } else if (
        Math.abs(candidateScore.totalCost - bestScore.totalCost) <= IMPROVEMENT_EPSILON
        && compareCoordMapsDeterministically(candidate.transformedCoords, bestCandidate.transformedCoords, layoutGraph.canonicalAtomRank) < 0
      ) {
        shouldReplaceBestCandidate = true;
      }
    }

    if (shouldReplaceBestCandidate) {
      bestCandidate = candidate;
      bestScore = candidateScore;
    }
    // Keep scoring any remaining finalists whose local prescore is also
    // "perfect", so engine-specific iteration differences cannot lock in the
    // first such candidate before the total-cost/deterministic tiebreak runs.
    if (canSkipRemainingAttachedBlockFinalists(bestScore, finalists, candidateIndex + 1)) {
      break;
    }
  }

  return bestCandidate && bestScore ? { transformedCoords: bestCandidate.transformedCoords, score: bestScore, meta: bestCandidate.meta ?? null } : null;
}

/**
 * Builds a cheap local prescore for one attached-block orientation before the
 * more expensive full branch-placement scoring runs. This prescore still keeps
 * local ring-substituent readability in view so exact aromatic/root exits are
 * not pruned away just because a slightly worse-presented pose has a tighter
 * bounding box.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Candidate attached-block coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate attachment metadata.
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, failingSubstituentCount: number, fusedJunctionContinuationPenalty: number, exactContinuationPenalty: number, exactTerminalMultipleSlotPenalty: number, trigonalBisectorPenalty: number, ringExitMaxPenalty: number, omittedHydrogenTrigonalPenalty: number, omittedHydrogenDirectAttachmentCompromisePenalty: number, presentationPenalty: number, cost: number}} Prescored candidate snapshot.
 */
function preScoreAttachedBlockOrientation(coords, transformedCoords, bondLength, layoutGraph, candidateMeta = null) {
  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }
  const measuredState = measureAttachedBlockCandidateState(coords, candidateCoords, bondLength, layoutGraph, candidateMeta);
  const bounds = computeBounds(candidateCoords, [...candidateCoords.keys()]);
  return {
    coords: candidateCoords,
    layoutCost: null,
    totalCost: null,
    ...measuredState,
    failingSubstituentCount: measuredState.readability.failingSubstituentCount,
    cost: bounds ? bounds.width + bounds.height : 0
  };
}

/**
 * Selects the most promising attached-block orientations for full scoring.
 * @param {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta?: object}>} candidates - Raw attached-block candidates.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta?: object}>} Candidates worth full scoring.
 */
function selectAttachedBlockCandidates(candidates, coords, bondLength, layoutGraph) {
  if (candidates.length <= 1) {
    return candidates;
  }

  const scoredCandidates = candidates.map(candidate => ({
    ...candidate,
    ...(candidate._prescore ?? preScoreAttachedBlockOrientation(coords, candidate.transformedCoords, bondLength, layoutGraph, candidate.meta ?? null))
  }));
  scoredCandidates.sort((firstCandidate, secondCandidate) => {
    if (firstCandidate.overlapCount !== secondCandidate.overlapCount) {
      return firstCandidate.overlapCount - secondCandidate.overlapCount;
    }
    if (Math.abs(firstCandidate.exactTerminalMultipleSlotPenalty - secondCandidate.exactTerminalMultipleSlotPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.exactTerminalMultipleSlotPenalty - secondCandidate.exactTerminalMultipleSlotPenalty;
    }
    if (firstCandidate.failingSubstituentCount !== secondCandidate.failingSubstituentCount) {
      return firstCandidate.failingSubstituentCount - secondCandidate.failingSubstituentCount;
    }
    if (Math.abs(firstCandidate.fusedJunctionContinuationPenalty - secondCandidate.fusedJunctionContinuationPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.fusedJunctionContinuationPenalty - secondCandidate.fusedJunctionContinuationPenalty;
    }
    if (Math.abs(firstCandidate.exactContinuationPenalty - secondCandidate.exactContinuationPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.exactContinuationPenalty - secondCandidate.exactContinuationPenalty;
    }
    if (Math.abs(firstCandidate.parentVisibleTrigonalPenalty - secondCandidate.parentVisibleTrigonalPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.parentVisibleTrigonalPenalty - secondCandidate.parentVisibleTrigonalPenalty;
    }
    if (Math.abs(firstCandidate.trigonalBisectorPenalty - secondCandidate.trigonalBisectorPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.trigonalBisectorPenalty - secondCandidate.trigonalBisectorPenalty;
    }
    if (Math.abs(firstCandidate.ringExitMaxPenalty - secondCandidate.ringExitMaxPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.ringExitMaxPenalty - secondCandidate.ringExitMaxPenalty;
    }
    if (Math.abs(firstCandidate.ringExitPenalty - secondCandidate.ringExitPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.ringExitPenalty - secondCandidate.ringExitPenalty;
    }
    if (Math.abs(firstCandidate.presentationPenalty - secondCandidate.presentationPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.presentationPenalty - secondCandidate.presentationPenalty;
    }
    if (Math.abs(firstCandidate.cost - secondCandidate.cost) > IMPROVEMENT_EPSILON) {
      return firstCandidate.cost - secondCandidate.cost;
    }
    return compareCoordMapsDeterministically(firstCandidate.transformedCoords, secondCandidate.transformedCoords, layoutGraph.canonicalAtomRank);
  });
  const hasExactTerminalMultipleSlotChoice =
    scoredCandidates.some(candidate => candidate.exactTerminalMultipleSlotPenalty > IMPROVEMENT_EPSILON)
    && scoredCandidates.some(candidate => candidate.exactTerminalMultipleSlotPenalty <= IMPROVEMENT_EPSILON);
  if (hasExactTerminalMultipleSlotChoice) {
    return scoredCandidates;
  }

  const perfectCandidates = scoredCandidates.filter(candidate => attachedBlockPrimaryScoreIsPerfect(candidate));
  if (perfectCandidates.length > 1) {
    return perfectCandidates;
  }

  const [bestCandidate, secondCandidate] = scoredCandidates;
  if (!secondCandidate) {
    return [bestCandidate];
  }
  if (secondCandidate.overlapCount === bestCandidate.overlapCount) {
    return scoredCandidates.slice(0, Math.min(4, scoredCandidates.length));
  }
  if (secondCandidate.overlapCount > bestCandidate.overlapCount || secondCandidate.cost - bestCandidate.cost > bondLength * 0.25) {
    return [bestCandidate];
  }
  return scoredCandidates.slice(0, Math.min(4, scoredCandidates.length));
}

/**
 * Returns whether a ring system contains a ring trigonal center with a lone
 * exocyclic terminal multiple-bond leaf that benefits from exact presentation.
 * Small misses at imides, lactams, and related motifs are visually obvious, so
 * direct-attached ring blocks should search a small exact-pose rescue menu for
 * these cases before settling on a merely acceptable pose.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Candidate attached ring system.
 * @returns {boolean} True when finer direct-attachment rotation search is warranted.
 */
function ringSystemHasExactLeafSensitiveTrigonalCenter(layoutGraph, ringSystem) {
  if (!ringSystem) {
    return false;
  }
  const ringAtomIdSet = new Set(ringSystem.atomIds);
  for (const atomId of ringSystem.atomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.aromatic || atom.heavyDegree !== 3) {
      continue;
    }
    let matchBond = null;
    let matchNeighborAtomId = null;
    let exocyclicCount = 0;
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (bond.kind !== 'covalent' || bond.inRing || bond.aromatic) {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (ringAtomIdSet.has(neighborAtomId) || layoutGraph.atoms.get(neighborAtomId)?.element === 'H') {
        continue;
      }
      exocyclicCount++;
      if (exocyclicCount > 1) {
        break;
      }
      matchBond = bond;
      matchNeighborAtomId = neighborAtomId;
    }
    if (exocyclicCount !== 1) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(matchNeighborAtomId);
    if (neighborAtom && !neighborAtom.aromatic && (matchBond.order ?? 1) >= 2 && neighborAtom.heavyDegree === 1) {
      return true;
    }
  }
  return false;
}

/**
 * Splits non-ring participant atoms into heavy atoms and explicit hydrogens.
 * Mixed layouts attach pending ring systems after the initial branch-growth
 * pass, so explicit hydrogens should wait until those heavier attachments are
 * resolved to avoid claiming trigonal alkene slots too early.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Iterable<string>} atomIds - Atom IDs to classify.
 * @returns {{primaryAtomIds: Set<string>, deferredHydrogenAtomIds: Set<string>}} Classified non-ring atom IDs.
 */
function splitDeferredMixedHydrogens(layoutGraph, atomIds) {
  const primaryAtomIds = new Set();
  const deferredHydrogenAtomIds = new Set();

  for (const atomId of atomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom?.element === 'H') {
      deferredHydrogenAtomIds.add(atomId);
      continue;
    }
    primaryAtomIds.add(atomId);
  }

  return { primaryAtomIds, deferredHydrogenAtomIds };
}

/**
 * Rotates a monosubstituted benzene root so its outgoing heavy substituent
 * axis is horizontal before mixed branch growth begins.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ringSystem - Root ring-system descriptor.
 * @param {Map<string, {x: number, y: number}>} coords - Root ring coordinates.
 * @param {Set<string>} participantAtomIds - Visible component atom IDs.
 * @returns {Map<string, {x: number, y: number}>} Possibly rotated root coordinates.
 */
function orientSingleAttachmentBenzeneRoot(layoutGraph, ringSystem, coords, participantAtomIds) {
  const rootRings = layoutGraph.rings.filter(ring => ringSystem.ringIds.includes(ring.id));
  if (rootRings.length !== 1) {
    return coords;
  }

  const [ring] = rootRings;
  if (!ring.aromatic || ring.atomIds.length !== 6 || !ring.atomIds.every(atomId => layoutGraph.atoms.get(atomId)?.element === 'C')) {
    return coords;
  }

  const ringAtomIdSet = new Set(ring.atomIds);
  const heavyAttachmentAnchors = ring.atomIds.filter(atomId => {
    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      return false;
    }
    return atom
      .getNeighbors(layoutGraph.sourceMolecule)
      .some(neighborAtom => neighborAtom && neighborAtom.name !== 'H' && participantAtomIds.has(neighborAtom.id) && !ringAtomIdSet.has(neighborAtom.id));
  });

  if (heavyAttachmentAnchors.length !== 1) {
    return coords;
  }

  const anchorAtomId = heavyAttachmentAnchors[0];
  const ringCenter = centroid([...coords.values()]);
  const anchorPosition = coords.get(anchorAtomId);
  const anchorVector = anchorPosition ? sub(anchorPosition, ringCenter) : null;
  if (!anchorVector || Math.hypot(anchorVector.x, anchorVector.y) <= 1e-6) {
    return coords;
  }

  const currentAngle = angleOf(anchorVector);
  const targetAngle = anchorVector.x >= 0 ? 0 : Math.PI;
  const rotationAngle = targetAngle - currentAngle;
  if (Math.abs(rotationAngle) <= 1e-6) {
    return coords;
  }

  const rotatedCoords = new Map();
  for (const [atomId, position] of coords) {
    rotatedCoords.set(atomId, add(ringCenter, rotate(sub(position, ringCenter), rotationAngle)));
  }
  return rotatedCoords;
}

/**
 * Returns the cached layout for a pending secondary ring system.
 * @param {Map<number, {family: string, validationClass: 'planar'|'bridged', coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null>} cache - Pending-ring layout cache.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{ringSystem: object, templateId?: string|null}} pendingRingSystem - Pending ring-system entry.
 * @param {number} bondLength - Target bond length.
 * @returns {{family: string, validationClass: 'planar'|'bridged', coords: Map<string, {x: number, y: number}>, ringCenters: Map<number, {x: number, y: number}>, placementMode: string}|null} Cached or computed layout.
 */
function getPendingRingLayout(cache, layoutGraph, pendingRingSystem, bondLength) {
  if (!cache.has(pendingRingSystem.ringSystem.id)) {
    cache.set(pendingRingSystem.ringSystem.id, layoutRingSystem(layoutGraph, pendingRingSystem.ringSystem, bondLength, pendingRingSystem.templateId));
  }
  return cache.get(pendingRingSystem.ringSystem.id) ?? null;
}

/**
 * Initializes the root scaffold and shared mutable state for mixed-family placement.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {object} scaffoldPlan - Scaffold plan.
 * @param {number} bondLength - Target bond length.
 * @param {{conservativeAttachmentScoring?: boolean, disableAlternateRootRetry?: boolean, rootScaffold?: object|null}|null} [options] - Optional mixed-family placement overrides.
 * @returns {{finalResult?: {family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses: Map<string, 'planar'|'bridged'>}, state?: object}} Initialization result.
 */
function initializeRootScaffold(layoutGraph, component, adjacency, scaffoldPlan, bondLength, options = null) {
  const participantAtomIds = new Set(
    component.atomIds.filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
    })
  );
  const coords = new Map();
  const placedAtomIds = new Set();
  const bondValidationClasses = new Map();
  const atomToRingSystemId = layoutGraph.atomToRingSystemId;
  const ringSystemById = new Map(layoutGraph.ringSystems.map(ringSystem => [ringSystem.id, ringSystem]));
  const root = scaffoldPlan.rootScaffold;

  if (root.type === 'acyclic') {
    const acyclicCoords = layoutAcyclicFamily(adjacency, participantAtomIds, layoutGraph.canonicalAtomRank, bondLength, { layoutGraph });
    return {
      finalResult: {
        family: 'mixed',
        supported: true,
        atomIds: [...participantAtomIds],
        coords: acyclicCoords,
        bondValidationClasses: assignBondValidationClass(layoutGraph, participantAtomIds, 'planar', bondValidationClasses)
      }
    };
  }

  const rootRingSystem = layoutGraph.ringSystems.find(ringSystem => `ring-system:${ringSystem.id}` === root.id);
  const rootLayout = rootRingSystem ? layoutRingSystem(layoutGraph, rootRingSystem, bondLength, root.templateId ?? null) : null;
  if (!rootLayout) {
    return {
      finalResult: {
        family: 'mixed',
        supported: false,
        atomIds: [...participantAtomIds],
        coords,
        bondValidationClasses
      }
    };
  }
  const rootCoords = orientSingleAttachmentBenzeneRoot(layoutGraph, rootRingSystem, rootLayout.coords, participantAtomIds);
  for (const [atomId, position] of rootCoords) {
    coords.set(atomId, position);
    placedAtomIds.add(atomId);
  }
  const placedRingSystemIds = new Set([rootRingSystem.id]);
  assignBondValidationClass(layoutGraph, rootRingSystem.atomIds, rootLayout.validationClass, bondValidationClasses);
  const macrocycleBranchConstraints =
    rootLayout.family === 'macrocycle'
      ? {
          angularBudgets: computeMacrocycleAngularBudgets(
            layoutGraph.rings.filter(ring => rootRingSystem.ringIds.includes(ring.id)),
            coords,
            layoutGraph,
            participantAtomIds
          )
        }
      : null;

  const nonRingAtomIds = new Set([...participantAtomIds].filter(atomId => !layoutGraph.ringSystems.some(ringSystem => ringSystem.atomIds.includes(atomId))));
  const { primaryAtomIds: primaryNonRingAtomIds, deferredHydrogenAtomIds } = splitDeferredMixedHydrogens(layoutGraph, nonRingAtomIds);
  const pendingRingLayoutCache = new Map();
  const pendingRingSystems = scaffoldPlan.placementSequence
    .filter(entry => entry.kind === 'ring-system' && entry.candidateId !== root.id)
    .map(entry => {
      const ringSystem = layoutGraph.ringSystems.find(candidateRingSystem => `ring-system:${candidateRingSystem.id}` === entry.candidateId);
      return ringSystem ? { ringSystem, templateId: entry.templateId ?? null } : null;
    })
    .filter(Boolean);

  return {
    state: {
      participantAtomIds,
      coords,
      placedAtomIds,
      bondValidationClasses,
      atomToRingSystemId,
      ringSystemById,
      placedRingSystemIds,
      macrocycleBranchConstraints,
      nonRingAtomIds,
      primaryNonRingAtomIds,
      deferredHydrogenAtomIds,
      pendingRingLayoutCache,
      pendingRingSystems,
      pendingRingAttachmentResnapAtomIds: new Set(),
      branchPlacementContext: {},
      mixedOptions: options ?? null
    }
  };
}

function markMixedBranchPlacementContextDirty(state) {
  if (!state?.branchPlacementContext) {
    state.branchPlacementContext = {};
  }
  state.branchPlacementContext.needsResync = true;
}

function placeMixedBranches(layoutGraph, adjacency, bondLength, state, atomIdsToPlace) {
  if (!atomIdsToPlace || atomIdsToPlace.size === 0) {
    return;
  }
  placeRemainingBranches(
    adjacency,
    layoutGraph.canonicalAtomRank,
    state.coords,
    atomIdsToPlace,
    [...state.placedAtomIds],
    bondLength,
    layoutGraph,
    state.macrocycleBranchConstraints,
    0,
    state.branchPlacementContext ?? null
  );
  const projectedTetrahedralTrigonalRescue = runProjectedTetrahedralTrigonalChildRescue(
    layoutGraph,
    state.coords,
    bondLength,
    atomIdsToPlace
  );
  if (projectedTetrahedralTrigonalRescue.changed) {
    overwriteCoordMap(state.coords, projectedTetrahedralTrigonalRescue.coords);
    markMixedBranchPlacementContextDirty(state);
  }
  for (const atomId of atomIdsToPlace) {
    if (state.coords.has(atomId)) {
      state.placedAtomIds.add(atomId);
    }
  }
}

/**
 * Attaches pending ring systems and grows primary non-ring branches until no
 * further mixed-family progress is possible.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {number} bondLength - Target bond length.
 * @param {object} state - Mutable mixed-family placement state.
 * @returns {void}
 */
function attachPendingRingSystems(layoutGraph, adjacency, bondLength, state) {
  const {
    participantAtomIds,
    coords,
    placedAtomIds,
    bondValidationClasses,
    atomToRingSystemId,
    ringSystemById,
    placedRingSystemIds,
    macrocycleBranchConstraints,
    primaryNonRingAtomIds,
    pendingRingLayoutCache,
    pendingRingAttachmentResnapAtomIds
  } = state;
  let pendingRingSystems = [...state.pendingRingSystems];

  let progressed = true;
  while (progressed) {
    progressed = false;
    const remainingAfterLinkers = [];
    for (const pendingRingSystem of pendingRingSystems) {
      const linker = findShortestRingLinker(layoutGraph, pendingRingSystem.ringSystem, placedRingSystemIds, participantAtomIds, atomToRingSystemId);
      if (!linker || linker.chainAtomIds.some(atomId => coords.has(atomId))) {
        remainingAfterLinkers.push(pendingRingSystem);
        continue;
      }
      const firstRingSystem = ringSystemById.get(linker.firstRingSystemId);
      const blockLayout = getPendingRingLayout(pendingRingLayoutCache, layoutGraph, pendingRingSystem, bondLength);
      if (!firstRingSystem || !blockLayout || !isSupportedRingLinker(layoutGraph, firstRingSystem, pendingRingSystem.ringSystem, linker)) {
        remainingAfterLinkers.push(pendingRingSystem);
        continue;
      }

      const turnSigns = linker.chainAtomIds.length === 0 ? [1] : [-1, 1];
      let bestCandidateCoords = null;
      const rawCandidates = [];
      const allowExpandedRingLinkerRotations =
        (layoutGraph.traits.heavyAtomCount ?? 0) <= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT && pendingRingSystem.ringSystem.atomIds.length <= 18;
      for (const turnSign of turnSigns) {
        for (const mirror of [false, true]) {
          rawCandidates.push({
            transformedCoords: buildRingLinkerCandidate(
              layoutGraph,
              coords,
              firstRingSystem,
              linker,
              pendingRingSystem.ringSystem,
              blockLayout.coords,
              bondLength,
              turnSign,
              mirror
            )
          });
        }
      }
      for (const candidate of rawCandidates) {
        candidate._prescore = preScoreAttachedBlockOrientation(coords, candidate.transformedCoords, bondLength, layoutGraph, candidate.meta ?? null);
      }
      const defaultOverlapFree = rawCandidates.some(candidate => candidate._prescore.overlapCount === 0);
      if (!defaultOverlapFree && allowExpandedRingLinkerRotations) {
        const allowPlacedBlockBalancing =
          linker.chainAtomIds.length === 1
          && (
            ringSystemHasExactLeafSensitiveTrigonalCenter(layoutGraph, firstRingSystem)
            || ringSystemHasExactLeafSensitiveTrigonalCenter(layoutGraph, pendingRingSystem.ringSystem)
          );
        const placedBlockRotationOffsets = allowPlacedBlockBalancing
          ? [0, ...LINKED_RING_PLACED_BLOCK_ROTATION_OFFSETS]
          : [0];
        for (const turnSign of turnSigns) {
          for (const mirror of [false, true]) {
            for (const ringRotationOffset of LINKED_RING_ROTATION_OFFSETS) {
              for (const placedRingRotationOffset of placedBlockRotationOffsets) {
                rawCandidates.push({
                  transformedCoords: buildRingLinkerCandidate(
                    layoutGraph,
                    coords,
                    firstRingSystem,
                    linker,
                    pendingRingSystem.ringSystem,
                    blockLayout.coords,
                    bondLength,
                    turnSign,
                    mirror,
                    ringRotationOffset,
                    placedRingRotationOffset
                  )
                });
              }
            }
          }
        }
      }
      const bestCandidate = pickBestAttachedBlockOrientation(
        selectAttachedBlockCandidates(rawCandidates, coords, bondLength, layoutGraph),
        adjacency,
        layoutGraph.canonicalAtomRank,
        coords,
        primaryNonRingAtomIds,
        placedAtomIds,
        bondLength,
        layoutGraph,
        macrocycleBranchConstraints,
        {
          placementContext: state.branchPlacementContext,
          disablePrescoreAcceptance: state.mixedOptions?.conservativeAttachmentScoring === true,
          disableBeamReduction: state.mixedOptions?.conservativeAttachmentScoring === true
        }
      );
      bestCandidateCoords = bestCandidate?.transformedCoords ?? null;

      if (!bestCandidateCoords) {
        remainingAfterLinkers.push(pendingRingSystem);
        continue;
      }
      for (const [atomId, position] of bestCandidateCoords) {
        coords.set(atomId, position);
        placedAtomIds.add(atomId);
      }
      for (const atomId of linker.chainAtomIds) {
        pendingRingAttachmentResnapAtomIds.add(atomId);
      }
      markMixedBranchPlacementContextDirty(state);
      placedRingSystemIds.add(pendingRingSystem.ringSystem.id);
      assignBondValidationClass(layoutGraph, pendingRingSystem.ringSystem.atomIds, blockLayout.validationClass, bondValidationClasses);
      progressed = true;
    }
    pendingRingSystems = remainingAfterLinkers;

    const sizeBeforeBranches = coords.size;
    placeMixedBranches(layoutGraph, adjacency, bondLength, state, primaryNonRingAtomIds);
    if (coords.size > sizeBeforeBranches) {
      progressed = true;
    }

    const remainingAfterAttachments = [];
    for (const pendingRingSystem of pendingRingSystems) {
      const attachment = findAttachmentBond(layoutGraph, pendingRingSystem.ringSystem, placedAtomIds);
      if (!attachment) {
        remainingAfterAttachments.push(pendingRingSystem);
        continue;
      }
      const blockLayout = getPendingRingLayout(pendingRingLayoutCache, layoutGraph, pendingRingSystem, bondLength);
      if (!blockLayout) {
        remainingAfterAttachments.push(pendingRingSystem);
        continue;
      }
      const parentPosition = coords.get(attachment.parentAtomId);
      const placedPositions = [];
      for (const atomId of placedAtomIds) {
        const pos = coords.get(atomId);
        if (pos) {
          placedPositions.push(pos);
        }
      }
      const placedCentroid = centroid(placedPositions);
      const preferredAngle = angleOf(sub(parentPosition, placedCentroid));
      const attachmentAngle = chooseAttachmentAngle(
        adjacency,
        coords,
        attachment.parentAtomId,
        participantAtomIds,
        preferredAngle,
        layoutGraph,
        attachment.attachmentAtomId,
        macrocycleBranchConstraints
      );
      const directAttachmentPlacedNeighborIds = (adjacency.get(attachment.parentAtomId) ?? [])
        .filter(neighborAtomId =>
          coords.has(neighborAtomId) && participantAtomIds.has(neighborAtomId)
        )
        .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
      const exactSimpleAcyclicDirectAttachment =
        directAttachmentPlacedNeighborIds.length === 1
        && isExactSimpleAcyclicContinuationEligible(
          layoutGraph,
          attachment.parentAtomId,
          directAttachmentPlacedNeighborIds[0],
          attachment.attachmentAtomId
        );
      const detachedAttachmentPosition = blockLayout.coords.get(attachment.attachmentAtomId);
      const detachedRingCenter = centroid([...blockLayout.coords.values()]);
      const detachedCentroidAngle =
        detachedAttachmentPosition && detachedRingCenter
          ? angleOf(sub(detachedRingCenter, detachedAttachmentPosition))
          : 0;
      const detachedExitAngle = ringLinkerExitAngle(
        layoutGraph,
        blockLayout.coords,
        pendingRingSystem.ringSystem,
        attachment.attachmentAtomId,
        { checkHeavyAtomLimit: true }
      );
      const outwardAlignmentOffset = detachedExitAngle == null ? 0 : detachedCentroidAngle - detachedExitAngle;
      const directAttachmentRingRotationOffsets = [...DIRECT_ATTACHMENT_RING_ROTATION_OFFSETS];
      const exactDirectAttachmentOffsets = [
        ...exactDirectAttachmentRingRotationOffsets(layoutGraph, blockLayout.coords, attachment.attachmentAtomId),
        ...exactDirectAttachmentTrigonalBisectorRotationOffsets(
          layoutGraph,
          blockLayout.coords,
          attachment.attachmentAtomId,
          attachment.parentAtomId,
          outwardAlignmentOffset
        ),
        ...exactDirectAttachmentParentOutwardRotationOffsets(
          layoutGraph,
          blockLayout.coords,
          attachment.attachmentAtomId,
          detachedExitAngle
        )
      ];
      for (const rotationOffset of exactDirectAttachmentOffsets) {
        if (!directAttachmentRingRotationOffsets.some(candidateOffset => angularDifference(candidateOffset, rotationOffset) <= 1e-9)) {
          directAttachmentRingRotationOffsets.push(rotationOffset);
        }
      }
      const buildDirectAttachmentCandidate = (resolvedAttachmentAngle, mirror, ringRotationOffset = 0) => {
        const resolvedTargetPosition = add(parentPosition, fromAngle(resolvedAttachmentAngle, bondLength));
        return {
          transformedCoords: transformAttachedBlock(
            blockLayout.coords,
            attachment.attachmentAtomId,
            resolvedTargetPosition,
            resolvedAttachmentAngle + outwardAlignmentOffset + ringRotationOffset,
            {
              mirror
            }
          ),
          meta: {
            attachmentAngle: resolvedAttachmentAngle,
            attachmentAtomId: attachment.attachmentAtomId,
            mirror,
            parentAtomId: attachment.parentAtomId,
            ringRotationOffset
          }
        };
      };
      const exactContinuationAttachmentAngles = [];
      for (const exactAttachmentAngle of [
        ...exactDirectAttachmentContinuationAngles(
          layoutGraph,
          coords,
          {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          }
        ),
        ...exactDirectAttachmentParentPreferredAngles(
          layoutGraph,
          adjacency,
          coords,
          participantAtomIds,
          {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          }
        ),
        ...exactDirectAttachmentParentExteriorAngles(
          layoutGraph,
          coords,
          {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          }
        )
      ]) {
        if (!exactContinuationAttachmentAngles.some(candidateAngle => angularDifference(candidateAngle, exactAttachmentAngle) <= 1e-9)) {
          exactContinuationAttachmentAngles.push(exactAttachmentAngle);
        }
      }
      const initialDirectAttachmentRingRotationOffsets = [0];
      for (const ringRotationOffset of exactDirectAttachmentOffsets) {
        if (!initialDirectAttachmentRingRotationOffsets.some(candidateOffset => angularDifference(candidateOffset, ringRotationOffset) <= 1e-9)) {
          initialDirectAttachmentRingRotationOffsets.push(ringRotationOffset);
        }
      }
      const rawAttachedBlockCandidates = [];
      for (const mirror of [false, true]) {
        for (const ringRotationOffset of initialDirectAttachmentRingRotationOffsets) {
          rawAttachedBlockCandidates.push(buildDirectAttachmentCandidate(attachmentAngle, mirror, ringRotationOffset));
        }
      }
      for (const exactAttachmentAngle of exactContinuationAttachmentAngles) {
        if (rawAttachedBlockCandidates.some(candidate => angularDifference(candidate.meta?.attachmentAngle ?? 0, exactAttachmentAngle) <= 1e-9)) {
          continue;
        }
        for (const mirror of [false, true]) {
          for (const ringRotationOffset of initialDirectAttachmentRingRotationOffsets) {
            rawAttachedBlockCandidates.push(buildDirectAttachmentCandidate(exactAttachmentAngle, mirror, ringRotationOffset));
          }
        }
      }
      let directAttachmentTrigonalRescueSources = selectAttachedBlockCandidates(rawAttachedBlockCandidates, coords, bondLength, layoutGraph).slice(0, 2);
      let bestAttachedBlockCandidate = pickBestAttachedBlockOrientation(
        directAttachmentTrigonalRescueSources,
        adjacency,
        layoutGraph.canonicalAtomRank,
        coords,
        primaryNonRingAtomIds,
        placedAtomIds,
        bondLength,
        layoutGraph,
        macrocycleBranchConstraints,
        {
          placementContext: state.branchPlacementContext,
          disablePrescoreAcceptance: state.mixedOptions?.conservativeAttachmentScoring === true,
          disableBeamReduction: state.mixedOptions?.conservativeAttachmentScoring === true
        }
      );
      const allowExpandedDirectAttachmentRotations =
        (layoutGraph.traits.heavyAtomCount ?? 0) <= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT && pendingRingSystem.ringSystem.atomIds.length <= 18;
      const smallRingExteriorDirectAttachmentDescriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, attachment.parentAtomId);
      const exactSmallRingExteriorDirectAttachment = smallRingExteriorDirectAttachmentDescriptor?.exocyclicNeighborIds.includes(attachment.attachmentAtomId) ?? false;
      const exactLeafSensitiveDirectAttachment = ringSystemHasExactLeafSensitiveTrigonalCenter(layoutGraph, pendingRingSystem.ringSystem);
      const directAttachmentTrigonalSensitivity = summarizeDirectAttachmentTrigonalBisectorSensitivity(
        layoutGraph,
        coords,
        attachment.parentAtomId,
        attachment.attachmentAtomId
      );
      const exactVisibleTrigonalAromaticDirectAttachment =
        layoutGraph.atoms.get(attachment.attachmentAtomId)?.aromatic
        && isExactVisibleTrigonalBisectorEligible(layoutGraph, attachment.parentAtomId, attachment.attachmentAtomId);
      // Ring-presentation rescue may rotate the child block, but simple acyclic
      // parent continuations must stay on their exact branch angle.
      const lockDirectAttachmentAngle =
        directAttachmentTrigonalSensitivity.strict
        || directAttachmentTrigonalSensitivity.omittedHydrogen
        || exactSimpleAcyclicDirectAttachment;
      const allowOmittedHydrogenDirectAttachmentCompromise =
        directAttachmentTrigonalSensitivity.omittedHydrogen &&
        !layoutGraph.atoms.get(attachment.parentAtomId)?.chirality &&
        !layoutGraph.atoms.get(attachment.attachmentAtomId)?.chirality &&
        (
          (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON
        );
      const idealLeafExpansionThreshold = exactLeafSensitiveDirectAttachment ? 0.2 : 0.5;
      const shouldExpandForSensitiveOverlap =
        (bestAttachedBlockCandidate?.score.overlapCount ?? 0) > 0 &&
        (exactLeafSensitiveDirectAttachment || directAttachmentTrigonalSensitivity.eligible || exactSmallRingExteriorDirectAttachment);
      const shouldExpandForExactAromaticRingExit =
        exactVisibleTrigonalAromaticDirectAttachment &&
        (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) > IMPROVEMENT_EPSILON;
      const shouldExpandForExactRingExit =
        (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) > IMPROVEMENT_EPSILON;
      if (
        allowExpandedDirectAttachmentRotations &&
        (shouldExpandForSensitiveOverlap ||
          shouldExpandForExactAromaticRingExit ||
          shouldExpandForExactRingExit ||
          (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.fusedJunctionContinuationPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.trigonalBisectorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.attachmentExteriorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.idealLeafPresentationPenalty ?? 0) > idealLeafExpansionThreshold ||
          (bestAttachedBlockCandidate?.score.junctionCrowdingPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.smallRingExteriorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          exactSmallRingExteriorDirectAttachment)
      ) {
        const allowLockedOmittedHydrogenAngleExpansion =
          directAttachmentTrigonalSensitivity.omittedHydrogen &&
          !layoutGraph.atoms.get(attachment.parentAtomId)?.chirality &&
          !layoutGraph.atoms.get(attachment.attachmentAtomId)?.chirality &&
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON &&
          (layoutGraph.atomToRings.get(attachment.attachmentAtomId)?.length ?? 0) > 0;
        const allowLockedStrictTrigonalAngleExpansion =
          directAttachmentTrigonalSensitivity.strict &&
          (layoutGraph.atomToRings.get(attachment.attachmentAtomId)?.length ?? 0) > 0;
        const directAttachmentAngleOffsets =
          lockDirectAttachmentAngle && !allowLockedOmittedHydrogenAngleExpansion && !allowLockedStrictTrigonalAngleExpansion
            ? [0]
            : DIRECT_ATTACHMENT_ROTATION_OFFSETS;
        const expandedRingRotationOffsets = [...directAttachmentRingRotationOffsets];
        const expandedCandidates = [...rawAttachedBlockCandidates];
        for (const mirror of [false, true]) {
          for (const attachmentAngleOffset of directAttachmentAngleOffsets) {
            for (const ringRotationOffset of expandedRingRotationOffsets) {
              if (Math.abs(attachmentAngleOffset) <= IMPROVEMENT_EPSILON && Math.abs(ringRotationOffset) <= IMPROVEMENT_EPSILON) {
                continue;
              }
              expandedCandidates.push(buildDirectAttachmentCandidate(attachmentAngle + attachmentAngleOffset, mirror, ringRotationOffset));
            }
          }
        }
        for (const exactAttachmentAngle of exactContinuationAttachmentAngles) {
          for (const mirror of [false, true]) {
            for (const ringRotationOffset of expandedRingRotationOffsets) {
              if (
                Math.abs(ringRotationOffset) <= IMPROVEMENT_EPSILON
                && rawAttachedBlockCandidates.some(candidate => (
                  candidate.meta?.mirror === mirror
                  && angularDifference(candidate.meta?.attachmentAngle ?? 0, exactAttachmentAngle) <= 1e-9
                ))
              ) {
                continue;
              }
              expandedCandidates.push(buildDirectAttachmentCandidate(exactAttachmentAngle, mirror, ringRotationOffset));
            }
          }
        }
        const shouldProbeMirroredParentSubtrees =
          (directAttachmentTrigonalSensitivity.omittedHydrogen || shouldExpandForExactAromaticRingExit) &&
          !layoutGraph.atoms.get(attachment.parentAtomId)?.chirality &&
          !layoutGraph.atoms.get(attachment.attachmentAtomId)?.chirality;
        const candidatePool = shouldProbeMirroredParentSubtrees
          ? [
              ...expandedCandidates,
              ...expandedCandidates.flatMap(candidate =>
                buildMirroredParentSideSubtreeCandidates(layoutGraph, coords, candidate.transformedCoords, candidate.meta ?? null)
              )
            ]
          : expandedCandidates;
        directAttachmentTrigonalRescueSources = selectAttachedBlockCandidates(candidatePool, coords, bondLength, layoutGraph).slice(0, 2);
        const shouldScoreAllExpandedDirectAttachmentCandidates =
          (bestAttachedBlockCandidate?.score.overlapCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.trigonalBisectorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          (bestAttachedBlockCandidate?.score.attachmentExteriorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
          exactSmallRingExteriorDirectAttachment ||
          shouldExpandForExactAromaticRingExit;
        bestAttachedBlockCandidate = pickBestAttachedBlockOrientation(
          shouldScoreAllExpandedDirectAttachmentCandidates ? candidatePool : selectAttachedBlockCandidates(candidatePool, coords, bondLength, layoutGraph),
          adjacency,
          layoutGraph.canonicalAtomRank,
          coords,
          primaryNonRingAtomIds,
          placedAtomIds,
          bondLength,
          layoutGraph,
          macrocycleBranchConstraints,
          {
            forceFullScoring: shouldScoreAllExpandedDirectAttachmentCandidates,
            placementContext: state.branchPlacementContext,
            disablePrescoreAcceptance: state.mixedOptions?.conservativeAttachmentScoring === true,
            disableBeamReduction: state.mixedOptions?.conservativeAttachmentScoring === true
          }
        );
      }
      if (
        allowOmittedHydrogenDirectAttachmentCompromise &&
        bestAttachedBlockCandidate?.transformedCoords &&
        (
          (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) > 0 ||
          (bestAttachedBlockCandidate?.score.omittedHydrogenTrigonalPenalty ?? 0) > 0.2 ||
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON
        )
      ) {
        const localRefinementCandidates = buildLocalDirectAttachmentRefinementCandidates(
          bestAttachedBlockCandidate.transformedCoords,
          parentPosition,
          attachment.attachmentAtomId,
          bondLength
        );
        if (localRefinementCandidates.length > 0) {
          let refinedBestCandidate = bestAttachedBlockCandidate;
          let refinedBestScore = bestAttachedBlockCandidate.score;
          for (const candidate of localRefinementCandidates) {
            const candidateMeta = {
              attachmentAtomId: attachment.attachmentAtomId,
              parentAtomId: attachment.parentAtomId,
              attachmentAngleOffset: candidate.attachmentAngleOffset,
              ringRotationOffset: candidate.ringRotationOffset,
              localRefinement: true
            };
            const candidateScore = scoreAttachedBlockOrientation(
              adjacency,
              layoutGraph.canonicalAtomRank,
              coords,
              primaryNonRingAtomIds,
              placedAtomIds,
              candidate.transformedCoords,
              bondLength,
              layoutGraph,
              macrocycleBranchConstraints,
              candidateMeta,
              {
                placementContext: state.branchPlacementContext
              }
            );
            const comparison = compareOmittedHydrogenDirectAttachmentRefinementScores(candidateScore, refinedBestScore);
            if (comparison < 0) {
              refinedBestCandidate = {
                transformedCoords: candidate.transformedCoords,
                meta: candidateMeta,
                score: candidateScore
              };
              refinedBestScore = candidateScore;
              continue;
            }
            if (comparison === 0) {
              ensureAttachedBlockLayoutCost(candidateScore, candidate.transformedCoords, layoutGraph, bondLength);
              ensureAttachedBlockLayoutCost(refinedBestScore, refinedBestCandidate.transformedCoords, layoutGraph, bondLength);
              if (candidateScore.totalCost < refinedBestScore.totalCost - IMPROVEMENT_EPSILON) {
                refinedBestCandidate = {
                  transformedCoords: candidate.transformedCoords,
                  meta: candidateMeta,
                  score: candidateScore
                };
                refinedBestScore = candidateScore;
              }
            }
          }
          if (refinedBestCandidate) {
            bestAttachedBlockCandidate = refinedBestCandidate;
          }
        }
      }
      if (
        bestAttachedBlockCandidate?.transformedCoords
        && (
          (bestAttachedBlockCandidate?.score.trigonalBisectorPenalty ?? 0) > IMPROVEMENT_EPSILON
          || (bestAttachedBlockCandidate?.score.parentVisibleTrigonalPenalty ?? 0) > IMPROVEMENT_EPSILON
        )
      ) {
        const rescueSourceCandidates = [];
        const seenRescueSourceKeys = new Set();
        for (const candidate of [
          ...directAttachmentTrigonalRescueSources,
          {
            transformedCoords: bestAttachedBlockCandidate.transformedCoords,
            meta: bestAttachedBlockCandidate.meta ?? {
              attachmentAtomId: attachment.attachmentAtomId,
              parentAtomId: attachment.parentAtomId
            }
          }
        ]) {
          const sourceKey = [
            candidate.meta?.attachmentAngle ?? 'na',
            candidate.meta?.mirror ?? 'na',
            candidate.meta?.ringRotationOffset ?? 'na',
            candidate.meta?.attachmentAngleOffset ?? 'na',
            candidate.meta?.parentSideRotation ?? 'na'
          ].join('|');
          if (seenRescueSourceKeys.has(sourceKey)) {
            continue;
          }
          seenRescueSourceKeys.add(sourceKey);
          rescueSourceCandidates.push(candidate);
        }
        const exactTrigonalBisectorRescueCandidates = rescueSourceCandidates.flatMap(candidate => {
          const resolvedCandidateMeta = candidate.meta ?? {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          };
          return [
            ...buildDirectAttachmentExactTrigonalBisectorRescueCandidates(
              layoutGraph,
              coords,
              candidate.transformedCoords,
              resolvedCandidateMeta
            ),
            ...buildDirectAttachmentExactParentTrigonalRescueCandidates(
              layoutGraph,
              adjacency,
              coords,
              candidate.transformedCoords,
              participantAtomIds,
              resolvedCandidateMeta
            )
          ];
        });
        if (exactTrigonalBisectorRescueCandidates.length > 0) {
          let rescueBestCandidate = bestAttachedBlockCandidate;
          let rescueBestScore = bestAttachedBlockCandidate.score;
          for (const candidate of exactTrigonalBisectorRescueCandidates) {
            const candidateScore = scoreAttachedBlockOrientation(
              adjacency,
              layoutGraph.canonicalAtomRank,
              coords,
              primaryNonRingAtomIds,
              placedAtomIds,
              candidate.transformedCoords,
              bondLength,
              layoutGraph,
              macrocycleBranchConstraints,
              candidate.meta ?? null,
              {
                placementContext: state.branchPlacementContext
              }
            );
            const comparison = compareExactTrigonalBisectorRescueScores(candidateScore, rescueBestScore);
            if (comparison < 0) {
              rescueBestCandidate = {
                transformedCoords: candidate.transformedCoords,
                meta: candidate.meta ?? null,
                score: candidateScore
              };
              rescueBestScore = candidateScore;
              continue;
            }
            if (comparison === 0 && rescueBestCandidate) {
              ensureAttachedBlockLayoutCost(candidateScore, candidate.transformedCoords, layoutGraph, bondLength);
              ensureAttachedBlockLayoutCost(rescueBestScore, rescueBestCandidate.transformedCoords, layoutGraph, bondLength);
              if (candidateScore.totalCost < rescueBestScore.totalCost - IMPROVEMENT_EPSILON) {
                rescueBestCandidate = {
                  transformedCoords: candidate.transformedCoords,
                  meta: candidate.meta ?? null,
                  score: candidateScore
                };
                rescueBestScore = candidateScore;
              }
            }
          }
          if (rescueBestCandidate) {
            bestAttachedBlockCandidate = rescueBestCandidate;
          }
        }
      }
      if (
        bestAttachedBlockCandidate?.transformedCoords
        && (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) > IMPROVEMENT_EPSILON
      ) {
        const parentSlotSwapCandidates = buildDirectAttachmentParentSlotSwapRescueCandidates(
          layoutGraph,
          coords,
          bestAttachedBlockCandidate.transformedCoords,
          bestAttachedBlockCandidate.meta ?? {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          }
        );
        if (parentSlotSwapCandidates.length > 0) {
          const rescueBestCandidate = pickBestAttachedBlockOrientation(
            [
              {
                transformedCoords: bestAttachedBlockCandidate.transformedCoords,
                meta: bestAttachedBlockCandidate.meta ?? {
                  attachmentAtomId: attachment.attachmentAtomId,
                  parentAtomId: attachment.parentAtomId
                }
              },
              ...parentSlotSwapCandidates
            ],
            adjacency,
            layoutGraph.canonicalAtomRank,
            coords,
            primaryNonRingAtomIds,
            placedAtomIds,
            bondLength,
            layoutGraph,
            macrocycleBranchConstraints,
            {
              forceFullScoring: true,
              disableBeamReduction: true,
              placementContext: state.branchPlacementContext
            }
          );
          if (rescueBestCandidate) {
            bestAttachedBlockCandidate = rescueBestCandidate;
          }
        }
      }
      if (
        exactVisibleTrigonalAromaticDirectAttachment &&
        bestAttachedBlockCandidate?.transformedCoords
        && (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) > IMPROVEMENT_EPSILON
        && !layoutGraph.atoms.get(attachment.parentAtomId)?.chirality
        && !layoutGraph.atoms.get(attachment.attachmentAtomId)?.chirality
      ) {
        const exactRingExitRescueCandidates = buildDirectAttachmentExactRingExitRescueCandidates(
          layoutGraph,
          coords,
          bestAttachedBlockCandidate.transformedCoords,
          bestAttachedBlockCandidate.meta ?? {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          }
        );
        const aromaticRootRescueCandidates = exactRingExitRescueCandidates.length === 0
          ? []
          : [
              ...exactRingExitRescueCandidates,
              ...exactRingExitRescueCandidates.flatMap(candidate =>
                buildMirroredParentSideSubtreeCandidates(layoutGraph, coords, candidate.transformedCoords, candidate.meta ?? null)
              )
            ];
        if (aromaticRootRescueCandidates.length > 0) {
          const rescueBestCandidate = pickBestAttachedBlockOrientation(
            [
              {
                transformedCoords: bestAttachedBlockCandidate.transformedCoords,
                meta: bestAttachedBlockCandidate.meta ?? {
                  attachmentAtomId: attachment.attachmentAtomId,
                  parentAtomId: attachment.parentAtomId
                }
              },
              ...aromaticRootRescueCandidates
            ],
            adjacency,
            layoutGraph.canonicalAtomRank,
            coords,
            primaryNonRingAtomIds,
            placedAtomIds,
            bondLength,
            layoutGraph,
            macrocycleBranchConstraints,
            {
              forceFullScoring: true,
              disableBeamReduction: true,
              placementContext: state.branchPlacementContext
            }
          );
          if (rescueBestCandidate) {
            bestAttachedBlockCandidate = rescueBestCandidate;
          }
        }
      }
      if (
        bestAttachedBlockCandidate?.transformedCoords
        && !layoutGraph.atoms.get(attachment.parentAtomId)?.chirality
        && !layoutGraph.atoms.get(attachment.attachmentAtomId)?.chirality
        && (bestAttachedBlockCandidate?.score.parentVisibleTrigonalPenalty ?? 0) <= IMPROVEMENT_EPSILON
        && (
          (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON
          || (bestAttachedBlockCandidate?.score.trigonalBisectorPenalty ?? 0) > IMPROVEMENT_EPSILON
          || (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) > IMPROVEMENT_EPSILON
        )
      ) {
        const localRootRotationRefinementCandidates = buildDirectAttachmentLocalRootRotationRefinementCandidates(
          layoutGraph,
          bestAttachedBlockCandidate.transformedCoords,
          bestAttachedBlockCandidate.meta ?? {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          }
        );
        if (localRootRotationRefinementCandidates.length > 0) {
          let refinedBestCandidate = bestAttachedBlockCandidate;
          let refinedBestScore = bestAttachedBlockCandidate.score;
          for (const candidate of localRootRotationRefinementCandidates) {
            const candidateScore = scoreAttachedBlockOrientation(
              adjacency,
              layoutGraph.canonicalAtomRank,
              coords,
              primaryNonRingAtomIds,
              placedAtomIds,
              candidate.transformedCoords,
              bondLength,
              layoutGraph,
              macrocycleBranchConstraints,
              candidate.meta ?? null,
              {
                placementContext: state.branchPlacementContext
              }
            );
            const comparison = compareExactTrigonalBisectorRescueScores(candidateScore, refinedBestScore);
            if (comparison < 0) {
              refinedBestCandidate = {
                transformedCoords: candidate.transformedCoords,
                meta: candidate.meta ?? null,
                score: candidateScore
              };
              refinedBestScore = candidateScore;
              continue;
            }
            if (comparison === 0 && refinedBestCandidate) {
              ensureAttachedBlockLayoutCost(candidateScore, candidate.transformedCoords, layoutGraph, bondLength);
              ensureAttachedBlockLayoutCost(refinedBestScore, refinedBestCandidate.transformedCoords, layoutGraph, bondLength);
              if (candidateScore.totalCost < refinedBestScore.totalCost - IMPROVEMENT_EPSILON) {
                refinedBestCandidate = {
                  transformedCoords: candidate.transformedCoords,
                  meta: candidate.meta ?? null,
                  score: candidateScore
                };
                refinedBestScore = candidateScore;
              }
            }
          }
          if (refinedBestCandidate) {
            bestAttachedBlockCandidate = refinedBestCandidate;
          }
        }
      }
      if (
        directAttachmentTrigonalSensitivity.strict
        && bestAttachedBlockCandidate?.transformedCoords
        && (bestAttachedBlockCandidate?.score.overlapCount ?? 0) > 0
      ) {
        const localRefinementCandidates = buildLocalDirectAttachmentRefinementCandidates(
          bestAttachedBlockCandidate.transformedCoords,
          parentPosition,
          attachment.attachmentAtomId,
          bondLength
        );
        if (localRefinementCandidates.length > 0) {
          let refinedBestCandidate = bestAttachedBlockCandidate;
          let refinedBestScore = bestAttachedBlockCandidate.score;
          for (const candidate of localRefinementCandidates) {
            const candidateMeta = {
              ...(bestAttachedBlockCandidate.meta ?? {
                attachmentAtomId: attachment.attachmentAtomId,
                parentAtomId: attachment.parentAtomId
              }),
              attachmentAngleOffset: candidate.attachmentAngleOffset,
              ringRotationOffset: candidate.ringRotationOffset,
              exactTrigonalBisectorLocalRefinement: true
            };
            const candidateScore = scoreAttachedBlockOrientation(
              adjacency,
              layoutGraph.canonicalAtomRank,
              coords,
              primaryNonRingAtomIds,
              placedAtomIds,
              candidate.transformedCoords,
              bondLength,
              layoutGraph,
              macrocycleBranchConstraints,
              candidateMeta,
              {
                placementContext: state.branchPlacementContext
              }
            );
            const comparison = compareExactTrigonalBisectorRescueScores(candidateScore, refinedBestScore);
            if (comparison < 0) {
              refinedBestCandidate = {
                transformedCoords: candidate.transformedCoords,
                meta: candidateMeta,
                score: candidateScore
              };
              refinedBestScore = candidateScore;
              continue;
            }
            if (comparison === 0) {
              ensureAttachedBlockLayoutCost(candidateScore, candidate.transformedCoords, layoutGraph, bondLength);
              ensureAttachedBlockLayoutCost(refinedBestScore, refinedBestCandidate.transformedCoords, layoutGraph, bondLength);
              if (candidateScore.totalCost < refinedBestScore.totalCost - IMPROVEMENT_EPSILON) {
                refinedBestCandidate = {
                  transformedCoords: candidate.transformedCoords,
                  meta: candidateMeta,
                  score: candidateScore
                };
                refinedBestScore = candidateScore;
              }
            }
          }
          if (refinedBestCandidate) {
            bestAttachedBlockCandidate = refinedBestCandidate;
          }
        }
      }
      if (
        bestAttachedBlockCandidate?.transformedCoords
        && shouldPrioritizeDirectAttachmentExactContinuation(layoutGraph, bestAttachedBlockCandidate.meta ?? {
          attachmentAtomId: attachment.attachmentAtomId,
          parentAtomId: attachment.parentAtomId
        })
        && (bestAttachedBlockCandidate?.score.exactContinuationPenalty ?? 0) > IMPROVEMENT_EPSILON
      ) {
        const exactContinuationRescueCandidates = buildDirectAttachmentExactContinuationRescueCandidates(
          layoutGraph,
          coords,
          bestAttachedBlockCandidate.transformedCoords,
          bestAttachedBlockCandidate.meta ?? {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          },
          bondLength
        );
        if (exactContinuationRescueCandidates.length > 0) {
          const rescueBestCandidate = pickBestAttachedBlockOrientation(
            [
              {
                transformedCoords: bestAttachedBlockCandidate.transformedCoords,
                meta: bestAttachedBlockCandidate.meta ?? {
                  attachmentAtomId: attachment.attachmentAtomId,
                  parentAtomId: attachment.parentAtomId
                }
              },
              ...exactContinuationRescueCandidates
            ],
            adjacency,
            layoutGraph.canonicalAtomRank,
            coords,
            primaryNonRingAtomIds,
            placedAtomIds,
            bondLength,
            layoutGraph,
            macrocycleBranchConstraints,
            {
              forceFullScoring: true,
              disableBeamReduction: true,
              placementContext: state.branchPlacementContext
            }
          );
          if (rescueBestCandidate) {
            bestAttachedBlockCandidate = rescueBestCandidate;
          }
        }
      }
      const bestAttachedBlock = bestAttachedBlockCandidate?.transformedCoords ?? null;
      if (!bestAttachedBlock) {
        remainingAfterAttachments.push(pendingRingSystem);
        continue;
      }
      for (const [atomId, position] of bestAttachedBlock) {
        coords.set(atomId, position);
        placedAtomIds.add(atomId);
      }
      pendingRingAttachmentResnapAtomIds.add(attachment.parentAtomId);
      markMixedBranchPlacementContextDirty(state);
      placedRingSystemIds.add(pendingRingSystem.ringSystem.id);
      assignBondValidationClass(layoutGraph, pendingRingSystem.ringSystem.atomIds, blockLayout.validationClass, bondValidationClasses);
      progressed = true;
    }
    pendingRingSystems = remainingAfterAttachments;
  }

  state.pendingRingSystems = pendingRingSystems;
}

/**
 * Returns the ring anchor for a terminal non-carbon leaf whose exact local
 * ring-outward slot should be protected while resolving attached-ring overlap.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} leafAtomId - Candidate terminal leaf atom ID.
 * @returns {string|null} Ring anchor atom ID, or `null` when unsupported.
 */
function exactTerminalRingLeafAnchor(layoutGraph, coords, leafAtomId) {
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (
    !leafAtom
    || leafAtom.element === 'C'
    || leafAtom.element === 'H'
    || leafAtom.aromatic
    || leafAtom.heavyDegree !== 1
    || !coords.has(leafAtomId)
  ) {
    return null;
  }

  const heavyNeighborIds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === leafAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
  if (heavyNeighborIds.length !== 1) {
    return null;
  }

  const anchorAtomId = heavyNeighborIds[0];
  return isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, leafAtomId)
    ? anchorAtomId
    : null;
}

/**
 * Returns whether a severe overlap involves a terminal non-carbon ring leaf
 * that can be protected by rotating the nearby attached ring instead of
 * bending the leaf off its exact aromatic bisector.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} firstAtomId - First overlapping atom ID.
 * @param {string} secondAtomId - Second overlapping atom ID.
 * @returns {boolean} True when attached-ring touchup should be attempted.
 */
function overlapInvolvesExactTerminalRingLeaf(layoutGraph, coords, firstAtomId, secondAtomId) {
  const firstAnchorAtomId = exactTerminalRingLeafAnchor(layoutGraph, coords, firstAtomId);
  if (firstAnchorAtomId && (layoutGraph.atomToRings.get(secondAtomId)?.length ?? 0) > 0) {
    return true;
  }

  const secondAnchorAtomId = exactTerminalRingLeafAnchor(layoutGraph, coords, secondAtomId);
  return Boolean(secondAnchorAtomId && (layoutGraph.atomToRings.get(firstAtomId)?.length ?? 0) > 0);
}

function resolvePendingRingAttachmentResnapOverlaps(layoutGraph, bondLength, state) {
  const { coords, pendingRingAttachmentResnapAtomIds } = state;
  if ((pendingRingAttachmentResnapAtomIds?.size ?? 0) === 0) {
    return new Set();
  }
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  if (overlaps.length === 0) {
    return new Set();
  }
  const hasCarbonylStyleResnapCenter = [...pendingRingAttachmentResnapAtomIds].some(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    if (
      !atom
      || atom.element !== 'C'
      || atom.aromatic
      || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0
    ) {
      return false;
    }
    const visibleHeavyBonds = (layoutGraph.bondsByAtomId.get(atomId) ?? []).filter(bond => {
      if (!bond || bond.kind !== 'covalent') {
        return false;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
    if (visibleHeavyBonds.length !== 3) {
      return false;
    }
    const terminalMultipleBondLeafBonds = visibleHeavyBonds.filter(bond => (
      !bond.aromatic
      && (bond.order ?? 1) >= 2
      && isTerminalMultipleBondLeaf(layoutGraph, atomId, bond)
    ));
    const singleHeavyBondCount = visibleHeavyBonds.filter(bond => !bond.aromatic && (bond.order ?? 1) === 1).length;
    return terminalMultipleBondLeafBonds.length === 1 && singleHeavyBondCount === 2;
  });
  const carbonylLeafAtomIds = new Set();
  if (hasCarbonylStyleResnapCenter) {
    for (const atomId of coords.keys()) {
      const atom = layoutGraph.atoms.get(atomId);
      if (
        !atom
        || atom.element !== 'C'
        || atom.aromatic
        || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0
      ) {
        continue;
      }
      const visibleHeavyBonds = (layoutGraph.bondsByAtomId.get(atomId) ?? []).filter(bond => {
        if (!bond || bond.kind !== 'covalent') {
          return false;
        }
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
        return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
      });
      if (visibleHeavyBonds.length !== 3) {
        continue;
      }
      const terminalMultipleBondLeafBonds = visibleHeavyBonds.filter(bond => (
        !bond.aromatic
        && (bond.order ?? 1) >= 2
        && isTerminalMultipleBondLeaf(layoutGraph, atomId, bond)
      ));
      const singleHeavyBondCount = visibleHeavyBonds.filter(bond => !bond.aromatic && (bond.order ?? 1) === 1).length;
      if (terminalMultipleBondLeafBonds.length !== 1 || singleHeavyBondCount !== 2) {
        continue;
      }
      carbonylLeafAtomIds.add(terminalMultipleBondLeafBonds[0].a === atomId ? terminalMultipleBondLeafBonds[0].b : terminalMultipleBondLeafBonds[0].a);
    }
  }
  const shouldRunCarbonylTouchup = carbonylLeafAtomIds.size > 0 && overlaps.some(({ firstAtomId, secondAtomId }) => {
    const firstIsRing = (layoutGraph.atomToRings.get(firstAtomId)?.length ?? 0) > 0;
    const secondIsRing = (layoutGraph.atomToRings.get(secondAtomId)?.length ?? 0) > 0;
    return (
      (carbonylLeafAtomIds.has(firstAtomId) && secondIsRing)
      || (carbonylLeafAtomIds.has(secondAtomId) && firstIsRing)
    );
  });
  const shouldRunTerminalLeafTouchup = overlaps.some(({ firstAtomId, secondAtomId }) =>
    overlapInvolvesExactTerminalRingLeaf(layoutGraph, coords, firstAtomId, secondAtomId)
  );
  if (!shouldRunCarbonylTouchup && !shouldRunTerminalLeafTouchup) {
    return new Set();
  }

  const touchup = runAttachedRingRotationTouchup(layoutGraph, coords, { bondLength });
  if ((touchup?.nudges ?? 0) <= 0) {
    return new Set();
  }
  const changedAtomIds = new Set();
  for (const [atomId, position] of touchup.coords) {
    const currentPosition = coords.get(atomId);
    if (
      !currentPosition
      || Math.hypot(position.x - currentPosition.x, position.y - currentPosition.y) > 1e-9
    ) {
      changedAtomIds.add(atomId);
    }
    coords.set(atomId, position);
  }
  markMixedBranchPlacementContextDirty(state);
  return changedAtomIds;
}

/**
 * Finalizes mixed-family placement by placing remaining non-ring atoms and
 * returning the assembled mixed-family result.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {number} bondLength - Target bond length.
 * @param {object} state - Mutable mixed-family placement state.
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses: Map<string, 'planar'|'bridged'>}} Final mixed placement result.
 */
function finalizeMixedPlacement(layoutGraph, adjacency, bondLength, state) {
  const {
    participantAtomIds,
    coords,
    placedAtomIds,
    bondValidationClasses,
    nonRingAtomIds,
    primaryNonRingAtomIds,
    deferredHydrogenAtomIds,
    pendingRingAttachmentResnapAtomIds
  } = state;

  placeMixedBranches(layoutGraph, adjacency, bondLength, state, primaryNonRingAtomIds);
  if ((state.pendingRingSystems?.length ?? 0) > 0) {
    attachPendingRingSystems(layoutGraph, adjacency, bondLength, state);
  }
  if ((pendingRingAttachmentResnapAtomIds?.size ?? 0) > 0) {
    const localRestoreFocusAtomIds = realignPendingRingAttachmentVisibleTrigonalRoots(
      layoutGraph,
      coords,
      pendingRingAttachmentResnapAtomIds,
      bondLength
    );
    if (localRestoreFocusAtomIds.size > 0) {
      markMixedBranchPlacementContextDirty(state);
    }
    const touchupChangedAtomIds = resolvePendingRingAttachmentResnapOverlaps(layoutGraph, bondLength, state);
    for (const atomId of touchupChangedAtomIds) {
      localRestoreFocusAtomIds.add(atomId);
    }
    if (localRestoreFocusAtomIds.size > 0) {
      const restoredContinuationAtomIds = restoreLocalThreeHeavyContinuationCenters(
        layoutGraph,
        coords,
        localRestoreFocusAtomIds,
        bondLength
      );
      if (restoredContinuationAtomIds.size > 0) {
        markMixedBranchPlacementContextDirty(state);
      }
    }
  }
  snapExactVisibleTrigonalContinuations(layoutGraph, coords, participantAtomIds, bondLength);
  markMixedBranchPlacementContextDirty(state);
  snapExactSharedJunctionTerminalLeaves(layoutGraph, coords, bondLength);
  markMixedBranchPlacementContextDirty(state);
  const linkedRingSideBalance = balanceLinkedRingSideExits(layoutGraph, coords, bondLength);
  if (linkedRingSideBalance.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const suppressedHydrogenRingJunctionRescue = rescueSuppressedHydrogenRingJunctions(layoutGraph, coords, bondLength);
  if (suppressedHydrogenRingJunctionRescue.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const suppressedHydrogenLeafClashBalance = balanceSuppressedHydrogenRingJunctionLeafClashes(layoutGraph, coords, bondLength);
  if (suppressedHydrogenLeafClashBalance.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  if (deferredHydrogenAtomIds.size > 0) {
    placeMixedBranches(layoutGraph, adjacency, bondLength, state, deferredHydrogenAtomIds);
    const linkedMethyleneHydrogenRefinement = refineLinkedMethyleneHydrogenSlots(layoutGraph, coords, bondLength);
    if (linkedMethyleneHydrogenRefinement.changed) {
      markMixedBranchPlacementContextDirty(state);
    }
  }
  for (const atomId of nonRingAtomIds) {
    if (coords.has(atomId)) {
      placedAtomIds.add(atomId);
    }
  }

  const supported = [...participantAtomIds].every(atomId => coords.has(atomId));
  return {
    family: 'mixed',
    supported,
    atomIds: [...participantAtomIds],
    coords,
    bondValidationClasses: assignBondValidationClass(layoutGraph, participantAtomIds, 'planar', bondValidationClasses, { overwrite: false })
  };
}

/**
 * Places a mixed component by selecting a root scaffold, growing acyclic
 * connectors from it, and attaching secondary ring systems once they become
 * reachable from the placed region.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {object} scaffoldPlan - Scaffold plan.
 * @param {number} bondLength - Target bond length.
 * @param {{conservativeAttachmentScoring?: boolean, disableAlternateRootRetry?: boolean, rootScaffold?: object|null}|null} [options] - Optional mixed-family placement overrides.
 * @returns {{family: string, supported: boolean, atomIds: string[], coords: Map<string, {x: number, y: number}>, bondValidationClasses: Map<string, 'planar'|'bridged'>, rootScaffoldId?: string|null, rootRetryAttemptCount?: number, rootRetryUsed?: boolean}} Mixed placement result.
 */
export function layoutMixedFamily(layoutGraph, component, adjacency, scaffoldPlan, bondLength, options = null) {
  const resolvedScaffoldPlan = resolveMixedRootScaffoldPlan(scaffoldPlan, options?.rootScaffold ?? null);
  const initialization = initializeRootScaffold(layoutGraph, component, adjacency, resolvedScaffoldPlan, bondLength, options);
  if (initialization.finalResult) {
    return {
      ...initialization.finalResult,
      rootScaffoldId: resolvedScaffoldPlan?.rootScaffold?.id ?? null,
      rootRetryAttemptCount: 0,
      rootRetryUsed: false
    };
  }

  attachPendingRingSystems(layoutGraph, adjacency, bondLength, initialization.state);
  const primaryPlacement = finalizeMixedPlacement(layoutGraph, adjacency, bondLength, initialization.state);
  const primaryResult = {
    ...primaryPlacement,
    rootScaffoldId: resolvedScaffoldPlan?.rootScaffold?.id ?? null,
    rootRetryAttemptCount: 0,
    rootRetryUsed: false
  };
  const primaryAudit = auditMixedPlacement(layoutGraph, primaryResult, bondLength);

  if (!shouldRetryMixedWithAlternateRoot(layoutGraph, resolvedScaffoldPlan, primaryAudit, options)) {
    return primaryResult;
  }

  let bestPlacement = primaryResult;
  let bestAudit = primaryAudit;
  let rootRetryAttemptCount = 0;
  const alternateRootCandidates = (resolvedScaffoldPlan.candidates ?? [])
    .filter(candidate => candidate.type === 'ring-system' && candidate.id !== resolvedScaffoldPlan.rootScaffold.id)
    .slice(0, MIXED_ROOT_RETRY_LIMITS.maxAlternateRootCandidates);

  for (const alternateRootCandidate of alternateRootCandidates) {
    rootRetryAttemptCount++;
    const alternatePlacement = layoutMixedFamily(
      layoutGraph,
      component,
      adjacency,
      resolvedScaffoldPlan,
      bondLength,
      {
        ...(options ?? {}),
        disableAlternateRootRetry: true,
        rootScaffold: alternateRootCandidate
      }
    );
    const alternateAudit = auditMixedPlacement(layoutGraph, alternatePlacement, bondLength);
    if (isBetterMixedRootPlacement(
      alternatePlacement,
      alternateAudit,
      bestPlacement,
      bestAudit,
      layoutGraph.canonicalAtomRank,
      layoutGraph,
      bondLength
    )) {
      bestPlacement = alternatePlacement;
      bestAudit = alternateAudit;
    }
  }

  return {
    ...bestPlacement,
    rootRetryAttemptCount,
    rootRetryUsed: bestPlacement.rootScaffoldId !== primaryResult.rootScaffoldId
  };
}
