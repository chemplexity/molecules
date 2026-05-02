/** @module families/mixed */

import { angleOf, angularDifference, centroid, distance, fromAngle, sub, add, rotate, wrapAngle } from '../geometry/vec2.js';
import { computeBounds } from '../geometry/bounds.js';
import { computeIncidentRingOutwardAngles } from '../geometry/ring-direction.js';
import { alignCoordsToFixed, reflectAcrossLine } from '../geometry/transforms.js';
import { nonSharedPath } from '../geometry/ring-path.js';
import { transformAttachedBlock } from '../placement/linkers.js';
import { auditLayout } from '../audit/audit.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { measureRingSubstituentPresentationPenalty } from '../cleanup/presentation/ring-substituent.js';
import { collectMovableAttachedRingDescriptors, runAttachedRingRotationTouchup } from '../cleanup/presentation/attached-ring-fallback.js';
import {
  directAttachedForeignRingJunctionContinuationAngle,
  describeCrossLikeHypervalentCenter,
  findLayoutBond,
  isExactSmallRingExteriorContinuationEligible,
  isExactRingOutwardEligibleSubstituent,
  isExactRingTrigonalBisectorEligible,
  isExactSimpleAcyclicContinuationEligible,
  isLinearCenter,
  isExactVisibleTrigonalBisectorEligible,
  hasNonAromaticMultipleBond,
  isTerminalMultipleBondLeaf,
  supportsExteriorBranchSpreadRingSize,
  supportsProjectedTetrahedralGeometry
} from '../placement/branch-placement/angle-selection.js';
import { assignBondValidationClass, resolvePlacementValidationClass } from '../placement/bond-validation.js';
import { chooseAttachmentAngle, measureSmallRingExteriorGapSpreadPenalty, placeRemainingBranches, smallRingExteriorTargetAngles } from '../placement/branch-placement.js';
import {
  countVisibleHeavyBondCrossings,
  findVisibleHeavyBondCrossings,
  findSevereOverlaps,
  measureFocusedPlacementCost,
  measureLayoutCost,
  measureRingSubstituentReadability,
  measureTrigonalDistortion,
  measureThreeHeavyContinuationDistortion
} from '../audit/invariants.js';
import { layoutAcyclicFamily } from './acyclic.js';
import { layoutBridgedFamily, regularizeFusedAromaticCyclohexaneCores } from './bridged.js';
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
import { isMetalAtom } from '../topology/metal-centers.js';
import { BRIDGED_VALIDATION, IMPROVEMENT_EPSILON, RING_SYSTEM_RESCUE_LIMITS, atomPairKey } from '../constants.js';

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
const LINKED_HETERO_RING_OVERLAP_ROTATION_OFFSETS = Object.freeze(
  [5, 8, 10, 12, 15, 18, 20, 22, 24, 26, 28, 30, 35, 40, 45, 60]
    .flatMap(degrees => [(degrees * Math.PI) / 180, -(degrees * Math.PI) / 180])
);
const LINKED_METHYLENE_HYDROGEN_MIN_SEPARATION = 7 * Math.PI / 18;
const LINKED_METHYLENE_HYDROGEN_MAX_SEPARATION = 17 * Math.PI / 18;
const DIRECT_ATTACHMENT_ROTATION_OFFSETS = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3];
const DIRECT_ATTACHMENT_RING_ROTATION_OFFSETS = [0, Math.PI / 3, -Math.PI / 3, (2 * Math.PI) / 3, -(2 * Math.PI) / 3, Math.PI];
const DIRECT_ATTACHED_RING_ROOT_PARENT_SWEEP_OFFSETS = [
  0,
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 6,
  -(Math.PI / 6),
  2 * Math.PI / 9,
  -(2 * Math.PI / 9),
  Math.PI / 4,
  -(Math.PI / 4),
  Math.PI / 3,
  -(Math.PI / 3),
  Math.PI / 2,
  -(Math.PI / 2),
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
];
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
const SMALL_RING_EXTERIOR_FAN_REFINEMENT_FRACTIONS = [1, 0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.25];
const SMALL_RING_EXTERIOR_TAIL_ESCAPE_OFFSETS = [
  Math.PI / 36,
  -(Math.PI / 36),
  Math.PI / 18,
  -(Math.PI / 18),
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 9,
  -(Math.PI / 9),
  (5 * Math.PI) / 36,
  -(5 * Math.PI) / 36,
  Math.PI / 6,
  -(Math.PI / 6)
];
const OMITTED_HYDROGEN_PARENT_SPREAD_ROOT_ROTATION_OFFSETS = [Math.PI / 3, -(Math.PI / 3)];
const OMITTED_HYDROGEN_PARENT_SPREAD_ATTACHMENT_RING_EXIT_TRADEOFF_LIMIT = 0;
const OMITTED_HYDROGEN_PARENT_SPREAD_RING_EXIT_TRADEOFF_LIMIT = Math.PI / 3;
const OMITTED_HYDROGEN_PARENT_SPREAD_PRESENTATION_TRADEOFF_LIMIT = Math.PI / 3;
const OMITTED_HYDROGEN_DIRECT_RING_HUB_LOCAL_ROTATION_OFFSETS = [0, Math.PI / 3, -(Math.PI / 3)];
const ATTACHED_BLOCK_NEAR_CONTACT_FACTOR = 0.72;
const OMITTED_HYDROGEN_DIRECT_RING_HUB_BRANCH_LEAF_OFFSETS = [
  0,
  Math.PI / 15,
  -(Math.PI / 15),
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 10,
  -(Math.PI / 10)
];
const OMITTED_HYDROGEN_DIRECT_RING_HUB_SIBLING_BALANCE_LIMIT = Math.PI / 9;
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
const ATTACHED_BLOCK_HEAVY_BOND_CROSSING_PENALTY = 500;
const ATTACHED_BLOCK_TERMINAL_LABEL_CLEARANCE_FACTOR = 0.75;
const EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT = 50;
const SHARED_JUNCTION_LOCAL_OUTWARD_SPREAD_LIMIT = Math.PI / 6;
const SHARED_JUNCTION_STRAIGHT_CLEARANCE_LIMIT = Math.PI / 3;
const PROJECTED_TETRAHEDRAL_TRIGONAL_RESCUE_EPSILON = 1e-6;
const DIRECT_ATTACHED_RING_ROOT_REFINEMENT_TRIGGER = Math.PI / 12;
const DIRECT_ATTACHED_PARENT_EXTERIOR_ROOT_REFINEMENT_TRIGGER = Math.PI / 18;
const DIRECT_ATTACHED_RING_ROOT_REFINEMENT_MIN_IMPROVEMENT = Math.PI / 36;
const TERMINAL_CARBONYL_LEAF_ESCAPE_MAX_TRIGONAL_DEVIATION = Math.PI / 4;
const TERMINAL_CARBONYL_LEAF_ESCAPE_OFFSETS = Object.freeze([
  ...Array.from({ length: 25 }, (_value, index) => ((12 + index * 2) * Math.PI) / 180),
  ...Array.from({ length: 25 }, (_value, index) => -((12 + index * 2) * Math.PI) / 180)
]);
const TERMINAL_CARBONYL_LEAF_COMPRESSION_FACTORS = Object.freeze(
  Array.from({ length: 111 }, (_value, index) => 0.95 - index * 0.005)
);
const TERMINAL_CARBONYL_BRANCH_ESCAPE_OFFSETS = Object.freeze([
  ...[10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45].map(degrees => (degrees * Math.PI) / 180),
  ...[10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45].map(degrees => -(degrees * Math.PI) / 180),
  Math.PI / 3,
  -(Math.PI / 3),
  Math.PI / 2,
  -(Math.PI / 2)
]);
const TERMINAL_CARBONYL_RING_CONTACT_ROTATION_OFFSETS = Object.freeze([
  ...[6, 8, 10, 12, 15, 18].flatMap(degrees => [
    -(degrees * Math.PI) / 180,
    (degrees * Math.PI) / 180
  ])
]);
const TERMINAL_CARBON_RING_LEAF_CROSSING_ESCAPE_OFFSETS = Object.freeze(
  Array.from({ length: 19 }, (_value, index) => ((index + 1) * Math.PI) / 36)
    .flatMap(offset => [offset, -offset])
);
const TERMINAL_CARBON_RING_LEAF_CROSSING_ATTACHED_SIDE_OFFSETS = Object.freeze([
  Math.PI / 36,
  -(Math.PI / 36),
  Math.PI / 18,
  -(Math.PI / 18),
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 9,
  -(Math.PI / 9),
  Math.PI / 6,
  -(Math.PI / 6)
]);
const TERMINAL_CARBON_RING_LEAF_CROSSING_COMPRESSION_FACTORS = Object.freeze([
  0.9,
  0.85,
  0.8,
  0.75,
  0.7,
  2 / 3,
  0.65,
  0.6,
  0.58,
  0.56,
  0.55
]);
const TERMINAL_CARBON_RING_LEAF_CROSSING_CLEARANCE_FACTOR = 0.68;
const TERMINAL_CARBON_RING_LEAF_CROSSING_MIN_ANCHOR_SEPARATION = (4 * Math.PI) / 9;
const BRIDGEHEAD_TERMINAL_CARBON_FAN_TRIGGER_SEPARATION = Math.PI / 4;
const BRIDGEHEAD_TERMINAL_CARBON_FAN_TARGET_SEPARATION = (11 * Math.PI) / 36;
const BRIDGEHEAD_TERMINAL_CARBON_FAN_CLEARANCE_FACTOR = 0.55;
const BRIDGEHEAD_TERMINAL_CARBON_FAN_EXTENSION_FACTORS = Object.freeze([1, 1.05, 1.1, 1.15, 1.17]);
const BRIDGEHEAD_TERMINAL_CARBON_FAN_ESCAPE_OFFSETS = Object.freeze(
  Array.from({ length: 12 }, (_value, index) => ((index + 1) * Math.PI) / 36)
);
const TERMINAL_CARBONYL_RING_CONTACT_MAX_ANCHOR_DEVIATION = Math.PI / 9;
const TERMINAL_TRIPOD_LEAF_ESCAPE_OFFSETS = Object.freeze([
  Math.PI / 18,
  -(Math.PI / 18),
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 9,
  -(Math.PI / 9),
  Math.PI / 6,
  -(Math.PI / 6),
  Math.PI / 4,
  -(Math.PI / 4)
]);
const TERMINAL_TRIPOD_LEAF_MIN_SEPARATION = Math.PI / 3;
const BRIDGEHEAD_CHAIN_ESCAPE_STEP = Math.PI / 36;
const BRIDGEHEAD_CHAIN_TAIL_OFFSETS = Object.freeze([
  Math.PI / 3,
  -(Math.PI / 3),
  0,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
]);
const BRIDGEHEAD_CHAIN_LEAF_FAN_OFFSETS = Object.freeze([
  0,
  -(Math.PI / 12),
  Math.PI / 12,
  -(Math.PI / 6),
  Math.PI / 6
]);
const DIRECT_ATTACHED_PARENT_TERMINAL_LEAF_RESCUE_OFFSETS = Object.freeze([
  0,
  ...Array.from({ length: 18 }, (_value, index) => ((index + 1) * Math.PI) / 18),
  ...Array.from({ length: 18 }, (_value, index) => -(((index + 1) * Math.PI) / 18))
]);
const MIXED_ROOT_RETRY_LIMITS = {
  maxHeavyAtomCount: 60,
  maxAlternateRootCandidates: 3,
  minSevereOverlapCount: 1
};
const MACROCYCLE_AROMATIC_RESCUE_TRIGGER_ANGLE_DEVIATION = Math.PI / 6;
const MACROCYCLE_AROMATIC_RESCUE_TARGET_ANGLE_DEVIATION = Math.PI / 18;
const MACROCYCLE_AROMATIC_REGULARIZATION_BLEND_FACTORS = Object.freeze([
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
  0.5
]);
const MACROCYCLE_AROMATIC_BRIDGE_EXIT_MIN_IMPROVEMENT = Math.PI / 12;

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

function measureAttachedRootIncidentRingExitPenalty(layoutGraph, coords, attachmentAtomId, parentAtomId) {
  const attachmentPosition = coords.get(attachmentAtomId);
  const parentPosition = coords.get(parentAtomId);
  if (!attachmentPosition || !parentPosition) {
    return {
      totalDeviation: 0,
      maxDeviation: 0
    };
  }

  const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, attachmentAtomId, atomId => coords.get(atomId) ?? null);
  if (outwardAngles.length === 0) {
    return {
      totalDeviation: 0,
      maxDeviation: 0
    };
  }

  const parentAngle = angleOf(sub(parentPosition, attachmentPosition));
  const deviation = Math.min(...outwardAngles.map(outwardAngle => angularDifference(parentAngle, outwardAngle)));
  return {
    totalDeviation: deviation,
    maxDeviation: deviation
  };
}

function attachedRootIncidentRingExitCorrection(layoutGraph, coords, attachmentAtomId, parentAtomId) {
  const attachmentPosition = coords.get(attachmentAtomId);
  const parentPosition = coords.get(parentAtomId);
  if (!attachmentPosition || !parentPosition) {
    return 0;
  }

  const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, attachmentAtomId, atomId => coords.get(atomId) ?? null);
  if (outwardAngles.length === 0) {
    return 0;
  }

  const parentAngle = angleOf(sub(parentPosition, attachmentPosition));
  const targetOutwardAngle = outwardAngles.reduce((bestAngle, outwardAngle) => (
    angularDifference(parentAngle, outwardAngle) < angularDifference(parentAngle, bestAngle)
      ? outwardAngle
      : bestAngle
  ));
  return wrapAngle(targetOutwardAngle - parentAngle);
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

function isExactTerminalCarbonRingLeaf(layoutGraph, coords, anchorAtomId, leafAtomId) {
  if (
    !layoutGraph
    || !coords.has(anchorAtomId)
    || !coords.has(leafAtomId)
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) !== 1
    || !isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, leafAtomId)
  ) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || (!anchorAtom.aromatic && !hasNonAromaticMultipleBond(layoutGraph, anchorAtomId))) {
    return false;
  }

  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (!leafAtom || leafAtom.element !== 'C' || leafAtom.aromatic || leafAtom.heavyDegree !== 1) {
    return false;
  }

  const bond = findLayoutBond(layoutGraph, anchorAtomId, leafAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.inRing
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

/**
 * Returns whether a placed leaf is a terminal carbon branch on a ring atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Candidate terminal leaf atom ID.
 * @returns {boolean} True when the candidate is a terminal carbon ring branch.
 */
function isTerminalCarbonRingBranchLeaf(layoutGraph, coords, anchorAtomId, leafAtomId) {
  if (
    !layoutGraph
    || !coords.has(anchorAtomId)
    || !coords.has(leafAtomId)
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0
    || (layoutGraph.atomToRings.get(leafAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (!leafAtom || leafAtom.element !== 'C' || leafAtom.aromatic || leafAtom.chirality || leafAtom.heavyDegree !== 1) {
    return false;
  }

  const bond = findLayoutBond(layoutGraph, anchorAtomId, leafAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.inRing
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

function exactTerminalCarbonRingLeafTargetAngles(layoutGraph, coords, anchorAtomId, leafAtomId) {
  if (!isExactTerminalCarbonRingLeaf(layoutGraph, coords, anchorAtomId, leafAtomId)) {
    return [];
  }

  return [
    ...directAttachmentLocalOutwardAngles(layoutGraph, coords, anchorAtomId, leafAtomId),
    ...incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId)
  ].filter((candidateAngle, index, angles) =>
    angles.findIndex(existingAngle => angularDifference(existingAngle, candidateAngle) <= 1e-9) === index
  );
}

function exactTerminalCarbonRingLeafDeviation(layoutGraph, coords, anchorAtomId, leafAtomId) {
  const targetAngles = exactTerminalCarbonRingLeafTargetAngles(layoutGraph, coords, anchorAtomId, leafAtomId);
  if (targetAngles.length === 0) {
    return 0;
  }
  const actualAngle = angleOf(sub(coords.get(leafAtomId), coords.get(anchorAtomId)));
  return Math.min(...targetAngles.map(targetAngle => angularDifference(targetAngle, actualAngle)));
}

function translateLeafSubtreeToRingTarget(layoutGraph, coords, anchorAtomId, leafAtomId, targetAngle, bondLength, targetLength = bondLength) {
  const anchorPosition = coords.get(anchorAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (!anchorPosition || !leafPosition) {
    return null;
  }

  const targetPosition = add(anchorPosition, fromAngle(targetAngle, targetLength));
  const delta = sub(targetPosition, leafPosition);
  const nextCoords = new Map(coords);
  for (const atomId of collectCovalentSubtreeAtomIds(layoutGraph, leafAtomId, anchorAtomId)) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, add(position, delta));
  }
  return nextCoords;
}

function ringLeafCandidateAuditDoesNotRegress(candidateAudit, incumbentAudit) {
  if (incumbentAudit.ok === true && candidateAudit.ok !== true) {
    return false;
  }
  return (
    candidateAudit.severeOverlapCount <= incumbentAudit.severeOverlapCount
    && candidateAudit.bondLengthFailureCount <= incumbentAudit.bondLengthFailureCount
    && candidateAudit.collapsedMacrocycleCount <= incumbentAudit.collapsedMacrocycleCount
  );
}

function compareExactTerminalCarbonLeafCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount - incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount - incumbent.audit.bondLengthFailureCount;
  }
  if (Math.abs(candidate.leafDeviation - incumbent.leafDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.leafDeviation - incumbent.leafDeviation;
  }
  if (Math.abs(candidate.exactRingExitPenalty - incumbent.exactRingExitPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.exactRingExitPenalty - incumbent.exactRingExitPenalty;
  }
  if (Math.abs(candidate.layoutCost - incumbent.layoutCost) > IMPROVEMENT_EPSILON) {
    return candidate.layoutCost - incumbent.layoutCost;
  }
  if (candidate.audit.labelOverlapCount !== incumbent.audit.labelOverlapCount) {
    return candidate.audit.labelOverlapCount - incumbent.audit.labelOverlapCount;
  }
  return candidate.totalMove - incumbent.totalMove;
}

function exactTerminalCarbonLeafCandidate(layoutGraph, coords, bondLength, anchorAtomId, leafAtomId, audit) {
  return {
    coords,
    audit,
    leafDeviation: exactTerminalCarbonRingLeafDeviation(layoutGraph, coords, anchorAtomId, leafAtomId),
    exactRingExitPenalty: measureMixedRootExactRingExitPenalty(layoutGraph, coords, new Set([anchorAtomId, leafAtomId])).totalDeviation,
    layoutCost: measureFocusedPlacementCost(layoutGraph, coords, bondLength, [anchorAtomId, leafAtomId]),
    totalMove: 0
  };
}

/**
 * Snaps terminal carbon ring leaves back to exact local exterior slots when a
 * nearby attached-ring rotation can clear the resulting clash. Branch placement
 * avoids unsafe exact slots up front, but mixed layouts can often move the
 * neighboring attached ring instead of leaving a visible 102/138-degree methyl
 * split on an otherwise trigonal ring atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether any terminal carbon leaf was restored.
 */
function snapExactTerminalCarbonRingLeavesWithAttachedRingClearance(layoutGraph, coords, bondLength) {
  let changed = false;
  let baseAudit = auditLayout(layoutGraph, coords, { bondLength });
  const descriptors = [];

  for (const anchorAtomId of coords.keys()) {
    if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) !== 1) {
      continue;
    }
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const leafAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (isExactTerminalCarbonRingLeaf(layoutGraph, coords, anchorAtomId, leafAtomId)) {
        descriptors.push({ anchorAtomId, leafAtomId });
      }
    }
  }

  descriptors.sort((firstDescriptor, secondDescriptor) => (
    compareCanonicalIds(firstDescriptor.anchorAtomId, secondDescriptor.anchorAtomId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstDescriptor.leafAtomId, secondDescriptor.leafAtomId, layoutGraph.canonicalAtomRank)
  ));

  for (const { anchorAtomId, leafAtomId } of descriptors) {
    const targetAngles = exactTerminalCarbonRingLeafTargetAngles(layoutGraph, coords, anchorAtomId, leafAtomId);
    if (targetAngles.length === 0) {
      continue;
    }

    const incumbent = exactTerminalCarbonLeafCandidate(layoutGraph, coords, bondLength, anchorAtomId, leafAtomId, baseAudit);
    if (incumbent.leafDeviation <= IMPROVEMENT_EPSILON) {
      continue;
    }

    let bestCandidate = incumbent;
    for (const targetAngle of targetAngles) {
      const snappedCoords = translateLeafSubtreeToRingTarget(layoutGraph, coords, anchorAtomId, leafAtomId, targetAngle, bondLength);
      if (!snappedCoords) {
        continue;
      }

      const candidateCoordSets = [snappedCoords];
      const snappedAudit = auditLayout(layoutGraph, snappedCoords, { bondLength });
      if (!ringLeafCandidateAuditDoesNotRegress(snappedAudit, baseAudit)) {
        const touchup = runAttachedRingRotationTouchup(layoutGraph, snappedCoords, { bondLength });
        if ((touchup?.nudges ?? 0) > 0) {
          candidateCoordSets.push(touchup.coords);
        }
      }

      for (const candidateCoords of candidateCoordSets) {
        const candidateAudit = candidateCoords === snappedCoords
          ? snappedAudit
          : auditLayout(layoutGraph, candidateCoords, { bondLength });
        if (!ringLeafCandidateAuditDoesNotRegress(candidateAudit, baseAudit)) {
          continue;
        }

        const leafPosition = coords.get(leafAtomId);
        const candidateLeafPosition = candidateCoords.get(leafAtomId);
        const totalMove = leafPosition && candidateLeafPosition
          ? distance(leafPosition, candidateLeafPosition)
          : 0;
        const candidate = {
          ...exactTerminalCarbonLeafCandidate(layoutGraph, candidateCoords, bondLength, anchorAtomId, leafAtomId, candidateAudit),
          totalMove
        };
        if (
          candidate.leafDeviation < incumbent.leafDeviation - IMPROVEMENT_EPSILON
          && compareExactTerminalCarbonLeafCandidates(candidate, bestCandidate) < 0
        ) {
          bestCandidate = candidate;
        }
      }
    }

    if (bestCandidate.coords !== coords) {
      overwriteCoordMap(coords, bestCandidate.coords);
      baseAudit = bestCandidate.audit;
      changed = true;
    }
  }

  return { changed };
}

/**
 * Counts visible heavy-bond crossings involving a terminal carbon leaf bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Terminal carbon leaf atom ID.
 * @returns {number} Number of visible crossings involving the leaf bond.
 */
function terminalCarbonRingLeafVisibleCrossingCount(layoutGraph, coords, anchorAtomId, leafAtomId) {
  return countVisibleHeavyBondCrossings(layoutGraph, coords, {
    focusAtomIds: [anchorAtomId, leafAtomId]
  });
}

/**
 * Measures the nearest visible heavy-atom clearance for a terminal carbon leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Terminal carbon leaf atom ID.
 * @returns {number} Nearest visible heavy-atom distance.
 */
function terminalCarbonRingLeafClearance(layoutGraph, coords, anchorAtomId, leafAtomId) {
  const leafPosition = coords.get(leafAtomId);
  if (!leafPosition) {
    return 0;
  }
  const movedAtomIds = new Set(collectCovalentSubtreeAtomIds(layoutGraph, leafAtomId, anchorAtomId));
  let clearance = Number.POSITIVE_INFINITY;
  for (const [atomId, atom] of layoutGraph.atoms) {
    if (
      !atom
      || atom.element === 'H'
      || atomId === anchorAtomId
      || movedAtomIds.has(atomId)
      || !coords.has(atomId)
    ) {
      continue;
    }
    clearance = Math.min(clearance, distance(leafPosition, coords.get(atomId)));
  }
  return Number.isFinite(clearance) ? clearance : Number.POSITIVE_INFINITY;
}

/**
 * Measures the narrowest heavy-neighbor angle around the leaf anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Leaf anchor atom ID.
 * @returns {number} Smallest heavy-neighbor separation in radians.
 */
function terminalCarbonRingLeafAnchorMinSeparation(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return 0;
  }
  const neighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
      continue;
    }
    neighborAngles.push(angleOf(sub(neighborPosition, anchorPosition)));
  }
  if (neighborAngles.length < 2) {
    return Math.PI;
  }

  let minSeparation = Math.PI;
  for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
      minSeparation = Math.min(minSeparation, angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]));
    }
  }
  return minSeparation;
}

/**
 * Describes a bridged-ring anchor whose terminal carbon leaves form a visible
 * bridgehead fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Candidate bridged-ring anchor atom ID.
 * @returns {{anchorAtomId: string, ringNeighborIds: string[], terminalLeafIds: string[]}|null} Fan descriptor.
 */
function bridgeheadTerminalCarbonFanDescriptor(layoutGraph, coords, anchorAtomId) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const ringSystem = ringSystemId == null
    ? null
    : layoutGraph.ringSystems.find(candidate => candidate.id === ringSystemId);
  if (
    !anchorAtom
    || anchorAtom.element === 'H'
    || (anchorAtom.heavyDegree ?? 0) < 4
    || !coords.has(anchorAtomId)
    || !ringSystem
    || classifyRingSystemFamily(layoutGraph, ringSystem) !== 'bridged'
  ) {
    return null;
  }

  const ringNeighborIds = [];
  const terminalLeafIds = [];
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
    if (isTerminalCarbonRingBranchLeaf(layoutGraph, coords, anchorAtomId, neighborAtomId)) {
      terminalLeafIds.push(neighborAtomId);
    } else if (bond.inRing || layoutGraph.atomToRingSystemId.get(neighborAtomId) === ringSystemId) {
      ringNeighborIds.push(neighborAtomId);
    }
  }

  if (heavyNeighborIds.length < 4 || terminalLeafIds.length < 2 || ringNeighborIds.length < 2) {
    return null;
  }

  return {
    anchorAtomId,
    ringNeighborIds,
    terminalLeafIds
  };
}

/**
 * Finds the tightest terminal-carbon/ring-neighbor gap in a bridgehead fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{anchorAtomId: string, ringNeighborIds: string[], terminalLeafIds: string[]}} descriptor - Fan descriptor.
 * @returns {{leafAtomId: string, ringNeighborId: string, leafAngle: number, ringAngle: number, separation: number}|null} Pinched pair.
 */
function bridgeheadTerminalCarbonFanPinch(layoutGraph, coords, descriptor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return null;
  }

  let pinchedPair = null;
  for (const leafAtomId of descriptor.terminalLeafIds) {
    const leafPosition = coords.get(leafAtomId);
    if (!leafPosition) {
      continue;
    }
    const leafAngle = angleOf(sub(leafPosition, anchorPosition));
    for (const ringNeighborId of descriptor.ringNeighborIds) {
      const ringPosition = coords.get(ringNeighborId);
      if (!ringPosition || !layoutGraph.atoms.has(ringNeighborId)) {
        continue;
      }
      const ringAngle = angleOf(sub(ringPosition, anchorPosition));
      const separation = angularDifference(leafAngle, ringAngle);
      if (!pinchedPair || separation < pinchedPair.separation) {
        pinchedPair = {
          leafAtomId,
          ringNeighborId,
          leafAngle,
          ringAngle,
          separation
        };
      }
    }
  }

  if (!pinchedPair || pinchedPair.separation >= BRIDGEHEAD_TERMINAL_CARBON_FAN_TRIGGER_SEPARATION - 1e-9) {
    return null;
  }
  return pinchedPair;
}

/**
 * Builds a candidate validation map for a stretched bridgehead terminal leaf.
 * @param {Map<string, 'planar'|'bridged'>} bondValidationClasses - Current validation classes.
 * @param {object} leafBond - Anchor-to-leaf bond descriptor.
 * @param {number} extensionFactor - Candidate bond-length factor.
 * @returns {Map<string, 'planar'|'bridged'>} Candidate validation classes.
 */
function bridgeheadTerminalCarbonFanValidationClasses(bondValidationClasses, leafBond, extensionFactor) {
  const candidateValidationClasses = new Map(bondValidationClasses);
  if (extensionFactor > 1 + IMPROVEMENT_EPSILON) {
    candidateValidationClasses.set(leafBond.id, 'bridged');
  }
  return candidateValidationClasses;
}

/**
 * Builds the score bundle for a bridgehead terminal-carbon fan candidate.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {{anchorAtomId: string}} descriptor - Fan descriptor.
 * @param {string} leafAtomId - Moved terminal carbon leaf atom ID.
 * @param {object} audit - Candidate audit result.
 * @param {Map<string, 'planar'|'bridged'>} bondValidationClasses - Candidate validation classes.
 * @param {number} extensionFactor - Candidate bond-length factor.
 * @param {number} rotationMagnitude - Candidate angular adjustment.
 * @param {number} totalMove - Distance moved by the target leaf.
 * @returns {{coords: Map<string, {x: number, y: number}>, audit: object, bondValidationClasses: Map<string, 'planar'|'bridged'>, leafClearance: number, anchorMinSeparation: number, layoutCost: number, extensionFactor: number, rotationMagnitude: number, totalMove: number}} Candidate score bundle.
 */
function bridgeheadTerminalCarbonFanCandidate(
  layoutGraph,
  coords,
  bondLength,
  descriptor,
  leafAtomId,
  audit,
  bondValidationClasses,
  extensionFactor,
  rotationMagnitude,
  totalMove
) {
  return {
    coords,
    audit,
    bondValidationClasses,
    leafClearance: terminalCarbonRingLeafClearance(layoutGraph, coords, descriptor.anchorAtomId, leafAtomId),
    anchorMinSeparation: terminalCarbonRingLeafAnchorMinSeparation(layoutGraph, coords, descriptor.anchorAtomId),
    layoutCost: measureFocusedPlacementCost(layoutGraph, coords, bondLength, [descriptor.anchorAtomId, leafAtomId]),
    extensionFactor,
    rotationMagnitude,
    totalMove
  };
}

/**
 * Compares bridgehead terminal-carbon fan candidates.
 * @param {object} candidate - Candidate score bundle.
 * @param {object|null} incumbent - Current best score bundle.
 * @param {number} clearanceThreshold - Desired leaf clearance.
 * @returns {number} Negative when candidate wins, positive when incumbent wins.
 */
function compareBridgeheadTerminalCarbonFanCandidates(candidate, incumbent, clearanceThreshold) {
  if (!incumbent) {
    return -1;
  }
  if (candidate.audit.ok !== incumbent.audit.ok) {
    return candidate.audit.ok ? -1 : 1;
  }
  for (const key of [
    'severeOverlapCount',
    'bondLengthFailureCount',
    'labelOverlapCount',
    'collapsedMacrocycleCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount'
  ]) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }

  const candidateHitsTarget = candidate.anchorMinSeparation >= BRIDGEHEAD_TERMINAL_CARBON_FAN_TARGET_SEPARATION - 1e-9;
  const incumbentHitsTarget = incumbent.anchorMinSeparation >= BRIDGEHEAD_TERMINAL_CARBON_FAN_TARGET_SEPARATION - 1e-9;
  if (candidateHitsTarget !== incumbentHitsTarget) {
    return candidateHitsTarget ? -1 : 1;
  }
  if (!candidateHitsTarget && Math.abs(candidate.anchorMinSeparation - incumbent.anchorMinSeparation) > IMPROVEMENT_EPSILON) {
    return incumbent.anchorMinSeparation - candidate.anchorMinSeparation;
  }

  const candidateClears = candidate.leafClearance >= clearanceThreshold - 1e-9;
  const incumbentClears = incumbent.leafClearance >= clearanceThreshold - 1e-9;
  if (candidateClears !== incumbentClears) {
    return candidateClears ? -1 : 1;
  }
  if (!candidateClears && Math.abs(candidate.leafClearance - incumbent.leafClearance) > IMPROVEMENT_EPSILON) {
    return incumbent.leafClearance - candidate.leafClearance;
  }
  if (Math.abs(candidate.extensionFactor - incumbent.extensionFactor) > IMPROVEMENT_EPSILON) {
    return candidate.extensionFactor - incumbent.extensionFactor;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > IMPROVEMENT_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  if (Math.abs(candidate.layoutCost - incumbent.layoutCost) > IMPROVEMENT_EPSILON) {
    return candidate.layoutCost - incumbent.layoutCost;
  }
  if (Math.abs(candidate.anchorMinSeparation - incumbent.anchorMinSeparation) > IMPROVEMENT_EPSILON) {
    return incumbent.anchorMinSeparation - candidate.anchorMinSeparation;
  }
  return candidate.totalMove - incumbent.totalMove;
}

/**
 * Relieves pinched bridged-ring terminal-carbon fans by rotating the blocked
 * terminal leaf away from the closest ring bond and, when needed, allowing a
 * bounded bridged-validation stretch for that exocyclic leaf bond. This is
 * reserved for bridged anchors where normal-length rotation would overlap the
 * bridge core.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {Map<string, 'planar'|'bridged'>} bondValidationClasses - Mutable validation-class map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether any bridgehead fan was adjusted.
 */
function resolveBridgeheadTerminalCarbonLeafFanPinches(layoutGraph, coords, bondValidationClasses, bondLength) {
  let changed = false;
  let baseAudit = auditMixedPlacement(layoutGraph, { coords, bondValidationClasses }, bondLength);
  const anchorAtomIds = [...coords.keys()]
    .filter(anchorAtomId => bridgeheadTerminalCarbonFanDescriptor(layoutGraph, coords, anchorAtomId))
    .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));

  for (const anchorAtomId of anchorAtomIds) {
    const descriptor = bridgeheadTerminalCarbonFanDescriptor(layoutGraph, coords, anchorAtomId);
    if (!descriptor) {
      continue;
    }
    const pinch = bridgeheadTerminalCarbonFanPinch(layoutGraph, coords, descriptor);
    if (!pinch) {
      continue;
    }

    const leafBond = findLayoutBond(layoutGraph, descriptor.anchorAtomId, pinch.leafAtomId);
    if (!leafBond) {
      continue;
    }
    const incumbent = bridgeheadTerminalCarbonFanCandidate(
      layoutGraph,
      coords,
      bondLength,
      descriptor,
      pinch.leafAtomId,
      baseAudit,
      bondValidationClasses,
      1,
      0,
      0
    );
    const originalLeafPosition = coords.get(pinch.leafAtomId);
    const direction = normalizeSignedAngle(pinch.leafAngle - pinch.ringAngle) >= 0 ? 1 : -1;
    const clearanceThreshold = bondLength * BRIDGEHEAD_TERMINAL_CARBON_FAN_CLEARANCE_FACTOR;
    let bestCandidate = incumbent;

    for (const rotationOffset of BRIDGEHEAD_TERMINAL_CARBON_FAN_ESCAPE_OFFSETS) {
      const targetAngle = wrapAngle(pinch.leafAngle + direction * rotationOffset);
      for (const extensionFactor of BRIDGEHEAD_TERMINAL_CARBON_FAN_EXTENSION_FACTORS) {
        const candidateCoords = translateLeafSubtreeToRingTarget(
          layoutGraph,
          coords,
          descriptor.anchorAtomId,
          pinch.leafAtomId,
          targetAngle,
          bondLength,
          bondLength * extensionFactor
        );
        if (!candidateCoords) {
          continue;
        }

        const candidateValidationClasses = bridgeheadTerminalCarbonFanValidationClasses(
          bondValidationClasses,
          leafBond,
          extensionFactor
        );
        const candidateAudit = auditMixedPlacement(
          layoutGraph,
          { coords: candidateCoords, bondValidationClasses: candidateValidationClasses },
          bondLength
        );
        if (!terminalCarbonRingLeafCrossingAuditDoesNotRegress(candidateAudit, baseAudit)) {
          continue;
        }

        const candidateLeafPosition = candidateCoords.get(pinch.leafAtomId);
        const totalMove = originalLeafPosition && candidateLeafPosition
          ? distance(originalLeafPosition, candidateLeafPosition)
          : 0;
        const candidate = bridgeheadTerminalCarbonFanCandidate(
          layoutGraph,
          candidateCoords,
          bondLength,
          descriptor,
          pinch.leafAtomId,
          candidateAudit,
          candidateValidationClasses,
          extensionFactor,
          rotationOffset,
          totalMove
        );
        if (
          candidate.anchorMinSeparation > incumbent.anchorMinSeparation + IMPROVEMENT_EPSILON
          && compareBridgeheadTerminalCarbonFanCandidates(candidate, bestCandidate, clearanceThreshold) < 0
        ) {
          bestCandidate = candidate;
        }
      }
    }

    if (bestCandidate.coords !== coords) {
      overwriteCoordMap(coords, bestCandidate.coords);
      for (const [bondId, validationClass] of bestCandidate.bondValidationClasses) {
        bondValidationClasses.set(bondId, validationClass);
      }
      baseAudit = bestCandidate.audit;
      changed = true;
    }
  }

  return { changed };
}

/**
 * Returns local ring-outward target angles for a terminal carbon leaf anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Leaf anchor atom ID.
 * @returns {number[]} Target angles in radians.
 */
function terminalCarbonRingLeafAnchorOutwardAngles(layoutGraph, coords, anchorAtomId) {
  return computeIncidentRingOutwardAngles(
    layoutGraph,
    anchorAtomId,
    atomId => coords.get(atomId) ?? null
  );
}

function bondAtomIdsMatch(atomIds, firstAtomId, secondAtomId) {
  return (
    atomIds.length === 2
    && (
      (atomIds[0] === firstAtomId && atomIds[1] === secondAtomId)
      || (atomIds[0] === secondAtomId && atomIds[1] === firstAtomId)
    )
  );
}

/**
 * Finds the non-leaf atoms involved in current crossings with a terminal leaf bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Terminal carbon leaf atom ID.
 * @returns {Set<string>} Atom IDs from the crossing bond opposite the leaf bond.
 */
function terminalCarbonRingLeafCrossingBlockingAtomIds(layoutGraph, coords, anchorAtomId, leafAtomId) {
  const blockingAtomIds = new Set();
  for (const crossing of findVisibleHeavyBondCrossings(layoutGraph, coords, { focusAtomIds: [anchorAtomId, leafAtomId] })) {
    const firstIsLeafBond = bondAtomIdsMatch(crossing.firstAtomIds, anchorAtomId, leafAtomId);
    const secondIsLeafBond = bondAtomIdsMatch(crossing.secondAtomIds, anchorAtomId, leafAtomId);
    if (firstIsLeafBond === secondIsLeafBond) {
      continue;
    }
    const crossingAtomIds = firstIsLeafBond ? crossing.secondAtomIds : crossing.firstAtomIds;
    for (const atomId of crossingAtomIds) {
      blockingAtomIds.add(atomId);
    }
  }
  return blockingAtomIds;
}

/**
 * Collects attached-ring subtrees that can share a terminal leaf crossing fix.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Terminal carbon leaf atom ID.
 * @returns {Array<{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[], matchCount: number, heavyAtomCount: number}>} Movable descriptors.
 */
function terminalCarbonRingLeafCrossingAttachedSideDescriptors(layoutGraph, coords, anchorAtomId, leafAtomId) {
  const blockingAtomIds = terminalCarbonRingLeafCrossingBlockingAtomIds(layoutGraph, coords, anchorAtomId, leafAtomId);
  if (blockingAtomIds.size === 0) {
    return [];
  }

  const frozenAtomIds = new Set([anchorAtomId, leafAtomId]);
  const descriptorMap = new Map();
  for (const descriptor of collectMovableAttachedRingDescriptors(layoutGraph, coords, frozenAtomIds)) {
    if (!coords.has(descriptor.anchorAtomId) || !coords.has(descriptor.rootAtomId)) {
      continue;
    }
    const subtreeAtomIds = descriptor.subtreeAtomIds.filter(atomId => coords.has(atomId));
    const subtreeAtomIdSet = new Set(subtreeAtomIds);
    if (subtreeAtomIdSet.has(anchorAtomId) || subtreeAtomIdSet.has(leafAtomId)) {
      continue;
    }
    let matchCount = 0;
    for (const atomId of blockingAtomIds) {
      if (subtreeAtomIdSet.has(atomId)) {
        matchCount += 1;
      }
    }
    if (matchCount === 0) {
      continue;
    }
    const heavyAtomCount = subtreeAtomIds.reduce(
      (count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1),
      0
    );
    const key = `${descriptor.anchorAtomId}:${descriptor.rootAtomId}:${subtreeAtomIds.join(',')}`;
    descriptorMap.set(key, {
      anchorAtomId: descriptor.anchorAtomId,
      rootAtomId: descriptor.rootAtomId,
      subtreeAtomIds,
      matchCount,
      heavyAtomCount
    });
  }

  return [...descriptorMap.values()].sort((firstDescriptor, secondDescriptor) => (
    secondDescriptor.matchCount - firstDescriptor.matchCount
    || firstDescriptor.heavyAtomCount - secondDescriptor.heavyAtomCount
    || firstDescriptor.subtreeAtomIds.length - secondDescriptor.subtreeAtomIds.length
    || compareCanonicalIds(firstDescriptor.anchorAtomId, secondDescriptor.anchorAtomId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstDescriptor.rootAtomId, secondDescriptor.rootAtomId, layoutGraph.canonicalAtomRank)
  ));
}

/**
 * Returns whether a crossing-escape candidate preserves public audit quality.
 * @param {object} candidateAudit - Candidate audit result.
 * @param {object} incumbentAudit - Incumbent audit result.
 * @returns {boolean} True when the candidate does not regress audit counters.
 */
function terminalCarbonRingLeafCrossingAuditDoesNotRegress(candidateAudit, incumbentAudit) {
  if (incumbentAudit.ok === true && candidateAudit.ok !== true) {
    return false;
  }
  for (const key of [
    'severeOverlapCount',
    'bondLengthFailureCount',
    'labelOverlapCount',
    'collapsedMacrocycleCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount'
  ]) {
    if ((candidateAudit[key] ?? 0) > (incumbentAudit[key] ?? 0)) {
      return false;
    }
  }
  return true;
}

/**
 * Builds the score bundle for a terminal carbon leaf crossing-escape candidate.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Terminal carbon leaf atom ID.
 * @param {object} audit - Candidate audit result.
 * @param {number} [totalMove] - Distance moved by the target leaf.
 * @param {number} [rotationMagnitude] - Total angular adjustment applied.
 * @returns {{coords: Map<string, {x: number, y: number}>, audit: object, visibleCrossingCount: number, leafClearance: number, anchorMinSeparation: number, leafDeviation: number, exactRingExitPenalty: number, layoutCost: number, totalMove: number, rotationMagnitude: number}} Candidate score bundle.
 */
function terminalCarbonRingLeafCrossingEscapeCandidate(
  layoutGraph,
  coords,
  bondLength,
  anchorAtomId,
  leafAtomId,
  audit,
  totalMove = 0,
  rotationMagnitude = 0
) {
  return {
    coords,
    audit,
    visibleCrossingCount: terminalCarbonRingLeafVisibleCrossingCount(layoutGraph, coords, anchorAtomId, leafAtomId),
    leafClearance: terminalCarbonRingLeafClearance(layoutGraph, coords, anchorAtomId, leafAtomId),
    anchorMinSeparation: terminalCarbonRingLeafAnchorMinSeparation(layoutGraph, coords, anchorAtomId),
    leafDeviation: exactTerminalCarbonRingLeafDeviation(layoutGraph, coords, anchorAtomId, leafAtomId),
    exactRingExitPenalty: measureMixedRootExactRingExitPenalty(layoutGraph, coords, new Set([anchorAtomId, leafAtomId])).totalDeviation,
    layoutCost: measureFocusedPlacementCost(layoutGraph, coords, bondLength, [anchorAtomId, leafAtomId]),
    totalMove,
    rotationMagnitude
  };
}

/**
 * Compares terminal carbon leaf crossing-escape candidates.
 * @param {object} candidate - Candidate score bundle.
 * @param {object|null} incumbent - Current best score bundle.
 * @param {number} clearanceThreshold - Desired terminal leaf clearance.
 * @returns {number} Negative when candidate wins, positive when incumbent wins.
 */
function compareTerminalCarbonRingLeafCrossingEscapeCandidates(candidate, incumbent, clearanceThreshold) {
  if (!incumbent) {
    return -1;
  }
  if (candidate.visibleCrossingCount !== incumbent.visibleCrossingCount) {
    return candidate.visibleCrossingCount - incumbent.visibleCrossingCount;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount - incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount - incumbent.audit.bondLengthFailureCount;
  }
  const candidateClears = candidate.leafClearance >= clearanceThreshold - 1e-9;
  const incumbentClears = incumbent.leafClearance >= clearanceThreshold - 1e-9;
  const candidateFanPenalty = Math.max(
    0,
    TERMINAL_CARBON_RING_LEAF_CROSSING_MIN_ANCHOR_SEPARATION - candidate.anchorMinSeparation
  );
  const incumbentFanPenalty = Math.max(
    0,
    TERMINAL_CARBON_RING_LEAF_CROSSING_MIN_ANCHOR_SEPARATION - incumbent.anchorMinSeparation
  );
  const candidateHasCompleteLocalClearance = candidateClears && candidateFanPenalty <= 1e-9;
  const incumbentHasCompleteLocalClearance = incumbentClears && incumbentFanPenalty <= 1e-9;
  if (candidateHasCompleteLocalClearance !== incumbentHasCompleteLocalClearance) {
    return candidateHasCompleteLocalClearance ? -1 : 1;
  }
  if (Math.abs(candidateFanPenalty - incumbentFanPenalty) > IMPROVEMENT_EPSILON) {
    return candidateFanPenalty - incumbentFanPenalty;
  }
  if (candidateClears !== incumbentClears) {
    return candidateClears ? -1 : 1;
  }
  if (!candidateClears && Math.abs(candidate.leafClearance - incumbent.leafClearance) > IMPROVEMENT_EPSILON) {
    return incumbent.leafClearance - candidate.leafClearance;
  }
  if (Math.abs(candidate.leafDeviation - incumbent.leafDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.leafDeviation - incumbent.leafDeviation;
  }
  if (Math.abs(candidate.exactRingExitPenalty - incumbent.exactRingExitPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.exactRingExitPenalty - incumbent.exactRingExitPenalty;
  }
  if (Math.abs(candidate.layoutCost - incumbent.layoutCost) > IMPROVEMENT_EPSILON) {
    return candidate.layoutCost - incumbent.layoutCost;
  }
  if (candidate.audit.labelOverlapCount !== incumbent.audit.labelOverlapCount) {
    return candidate.audit.labelOverlapCount - incumbent.audit.labelOverlapCount;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > IMPROVEMENT_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  return candidate.totalMove - incumbent.totalMove;
}

/**
 * Rotates terminal carbon ring leaves away from visible bond crossings that
 * appear only after a neighboring attached ring has been placed. The rescue is
 * deliberately local: it moves the terminal leaf subtree around its ring
 * anchor, requires audit-clean candidates, and only accepts a move that reduces
 * crossings involving that leaf bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether any terminal carbon leaf was rotated.
 */
function resolveTerminalCarbonRingLeafBondCrossings(layoutGraph, coords, bondLength) {
  let changed = false;
  let baseAudit = auditLayout(layoutGraph, coords, { bondLength });
  const descriptors = [];

  for (const anchorAtomId of coords.keys()) {
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const leafAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (
        isTerminalCarbonRingBranchLeaf(layoutGraph, coords, anchorAtomId, leafAtomId)
        && terminalCarbonRingLeafVisibleCrossingCount(layoutGraph, coords, anchorAtomId, leafAtomId) > 0
      ) {
        descriptors.push({ anchorAtomId, leafAtomId });
      }
    }
  }

  descriptors.sort((firstDescriptor, secondDescriptor) => (
    compareCanonicalIds(firstDescriptor.anchorAtomId, secondDescriptor.anchorAtomId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstDescriptor.leafAtomId, secondDescriptor.leafAtomId, layoutGraph.canonicalAtomRank)
  ));

  for (const { anchorAtomId, leafAtomId } of descriptors) {
    const incumbent = terminalCarbonRingLeafCrossingEscapeCandidate(
      layoutGraph,
      coords,
      bondLength,
      anchorAtomId,
      leafAtomId,
      baseAudit
    );
    if (incumbent.visibleCrossingCount === 0) {
      continue;
    }
    let bestCandidate = incumbent;
    const leafMovedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, leafAtomId, anchorAtomId)
      .filter(atomId => coords.has(atomId));
    const originalLeafPosition = coords.get(leafAtomId);
    const clearanceThreshold = bondLength * TERMINAL_CARBON_RING_LEAF_CROSSING_CLEARANCE_FACTOR;
    const candidateBases = [{ coords, sideRotationMagnitude: 0 }];

    for (const sideDescriptor of terminalCarbonRingLeafCrossingAttachedSideDescriptors(layoutGraph, coords, anchorAtomId, leafAtomId)) {
      for (const sideRotationOffset of TERMINAL_CARBON_RING_LEAF_CROSSING_ATTACHED_SIDE_OFFSETS) {
        const sideCoords = rotateAtomIdsAroundPivot(
          coords,
          sideDescriptor.subtreeAtomIds,
          sideDescriptor.anchorAtomId,
          sideRotationOffset
        );
        if (!sideCoords) {
          continue;
        }
        candidateBases.push({
          coords: sideCoords,
          sideRotationMagnitude: Math.abs(sideRotationOffset)
        });
      }
    }

    for (const candidateBase of candidateBases) {
      const leafRotationOffsets = candidateBase.coords === coords
        ? TERMINAL_CARBON_RING_LEAF_CROSSING_ESCAPE_OFFSETS
        : [0, ...TERMINAL_CARBON_RING_LEAF_CROSSING_ESCAPE_OFFSETS];
      const leafCandidateInputs = leafRotationOffsets.map(leafRotationOffset => ({
        coords: leafRotationOffset === 0
          ? new Map(candidateBase.coords)
          : rotateAtomIdsAroundPivot(candidateBase.coords, leafMovedAtomIds, anchorAtomId, leafRotationOffset),
        leafRotationMagnitude: Math.abs(leafRotationOffset)
      }));
      for (const targetAngle of terminalCarbonRingLeafAnchorOutwardAngles(layoutGraph, candidateBase.coords, anchorAtomId)) {
        for (const compressionFactor of TERMINAL_CARBON_RING_LEAF_CROSSING_COMPRESSION_FACTORS) {
          leafCandidateInputs.push({
            coords: translateLeafSubtreeToRingTarget(
              layoutGraph,
              candidateBase.coords,
              anchorAtomId,
              leafAtomId,
              targetAngle,
              bondLength,
              bondLength * compressionFactor
            ),
            leafRotationMagnitude: angularDifference(
              angleOf(sub(candidateBase.coords.get(leafAtomId), candidateBase.coords.get(anchorAtomId))),
              targetAngle
            )
          });
        }
      }
      for (const { coords: candidateCoords, leafRotationMagnitude } of leafCandidateInputs) {
        if (!candidateCoords) {
          continue;
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
        if (!terminalCarbonRingLeafCrossingAuditDoesNotRegress(candidateAudit, baseAudit)) {
          continue;
        }
        const candidateLeafPosition = candidateCoords.get(leafAtomId);
        const totalMove = originalLeafPosition && candidateLeafPosition
          ? distance(originalLeafPosition, candidateLeafPosition)
          : 0;
        const candidate = terminalCarbonRingLeafCrossingEscapeCandidate(
          layoutGraph,
          candidateCoords,
          bondLength,
          anchorAtomId,
          leafAtomId,
          candidateAudit,
          totalMove,
          candidateBase.sideRotationMagnitude + leafRotationMagnitude
        );
        if (
          candidate.visibleCrossingCount < incumbent.visibleCrossingCount
          && compareTerminalCarbonRingLeafCrossingEscapeCandidates(candidate, bestCandidate, clearanceThreshold) < 0
        ) {
          bestCandidate = candidate;
        }
      }
    }

    if (bestCandidate.coords !== coords) {
      overwriteCoordMap(coords, bestCandidate.coords);
      baseAudit = bestCandidate.audit;
      changed = true;
    }
  }

  return { changed };
}

/**
 * Returns whether a terminal hetero leaf should be restored to an exact
 * aromatic ring-outward slot by moving neighboring attached rings instead.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Candidate terminal leaf atom ID.
 * @returns {boolean} True when the hetero leaf qualifies for exact-slot rescue.
 */
function isExactTerminalHeteroRingLeaf(layoutGraph, coords, anchorAtomId, leafAtomId) {
  if (
    !layoutGraph
    || !coords.has(anchorAtomId)
    || !coords.has(leafAtomId)
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) !== 1
    || !isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, leafAtomId)
  ) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (
    !anchorAtom
    || !anchorAtom.aromatic
    || !leafAtom
    || leafAtom.element === 'C'
    || leafAtom.element === 'H'
    || leafAtom.aromatic
    || leafAtom.heavyDegree !== 1
  ) {
    return false;
  }

  const bond = findLayoutBond(layoutGraph, anchorAtomId, leafAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.inRing
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

/**
 * Returns exact local ring-outward targets for a terminal hetero leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Candidate terminal leaf atom ID.
 * @returns {number[]} Candidate target angles in radians.
 */
function exactTerminalHeteroRingLeafTargetAngles(layoutGraph, coords, anchorAtomId, leafAtomId) {
  if (!isExactTerminalHeteroRingLeaf(layoutGraph, coords, anchorAtomId, leafAtomId)) {
    return [];
  }
  return incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId);
}

/**
 * Measures how far a terminal hetero leaf is from its exact ring-outward slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Candidate terminal leaf atom ID.
 * @returns {number} Smallest angular deviation in radians.
 */
function exactTerminalHeteroRingLeafDeviation(layoutGraph, coords, anchorAtomId, leafAtomId) {
  const targetAngles = exactTerminalHeteroRingLeafTargetAngles(layoutGraph, coords, anchorAtomId, leafAtomId);
  if (targetAngles.length === 0) {
    return 0;
  }
  const actualAngle = angleOf(sub(coords.get(leafAtomId), coords.get(anchorAtomId)));
  return Math.min(...targetAngles.map(targetAngle => angularDifference(targetAngle, actualAngle)));
}

/**
 * Builds the score bundle used to compare exact terminal hetero leaf rescues.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string} leafAtomId - Candidate terminal leaf atom ID.
 * @param {object} audit - Candidate audit result.
 * @param {number} [totalMove] - Distance moved by the target leaf.
 * @returns {{coords: Map<string, {x: number, y: number}>, audit: object, leafDeviation: number, exactRingExitPenalty: number, layoutCost: number, totalMove: number}} Candidate score bundle.
 */
function exactTerminalHeteroLeafCandidate(layoutGraph, coords, bondLength, anchorAtomId, leafAtomId, audit, totalMove = 0) {
  return {
    coords,
    audit,
    leafDeviation: exactTerminalHeteroRingLeafDeviation(layoutGraph, coords, anchorAtomId, leafAtomId),
    exactRingExitPenalty: measureMixedRootExactRingExitPenalty(layoutGraph, coords, new Set([anchorAtomId, leafAtomId])).totalDeviation,
    layoutCost: measureFocusedPlacementCost(layoutGraph, coords, bondLength, [anchorAtomId, leafAtomId]),
    totalMove
  };
}

/**
 * Snaps terminal hetero ring leaves back to exact local exterior slots when an
 * attached-ring touchup can clear the slot without bending the label.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether any terminal hetero leaf was restored.
 */
function snapExactTerminalHeteroRingLeavesWithAttachedRingClearance(layoutGraph, coords, bondLength) {
  let changed = false;
  let baseAudit = auditLayout(layoutGraph, coords, { bondLength });
  const descriptors = [];

  for (const anchorAtomId of coords.keys()) {
    if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) !== 1) {
      continue;
    }
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const leafAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (isExactTerminalHeteroRingLeaf(layoutGraph, coords, anchorAtomId, leafAtomId)) {
        descriptors.push({ anchorAtomId, leafAtomId });
      }
    }
  }

  descriptors.sort((firstDescriptor, secondDescriptor) => (
    compareCanonicalIds(firstDescriptor.anchorAtomId, secondDescriptor.anchorAtomId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstDescriptor.leafAtomId, secondDescriptor.leafAtomId, layoutGraph.canonicalAtomRank)
  ));

  for (const { anchorAtomId, leafAtomId } of descriptors) {
    const targetAngles = exactTerminalHeteroRingLeafTargetAngles(layoutGraph, coords, anchorAtomId, leafAtomId);
    if (targetAngles.length === 0) {
      continue;
    }

    const incumbent = exactTerminalHeteroLeafCandidate(layoutGraph, coords, bondLength, anchorAtomId, leafAtomId, baseAudit);
    if (incumbent.leafDeviation <= IMPROVEMENT_EPSILON) {
      continue;
    }

    let bestCandidate = incumbent;
    for (const targetAngle of targetAngles) {
      const snappedCoords = translateLeafSubtreeToRingTarget(layoutGraph, coords, anchorAtomId, leafAtomId, targetAngle, bondLength);
      if (!snappedCoords) {
        continue;
      }

      const candidateCoordSets = [snappedCoords];
      const snappedAudit = auditLayout(layoutGraph, snappedCoords, { bondLength });
      if (!ringLeafCandidateAuditDoesNotRegress(snappedAudit, baseAudit)) {
        const touchup = runAttachedRingRotationTouchup(layoutGraph, snappedCoords, {
          bondLength,
          frozenAtomIds: new Set([anchorAtomId, leafAtomId]),
          maxPasses: 3
        });
        if ((touchup?.nudges ?? 0) > 0) {
          candidateCoordSets.push(touchup.coords);
        }
      }

      for (const candidateCoords of candidateCoordSets) {
        const candidateAudit = candidateCoords === snappedCoords
          ? snappedAudit
          : auditLayout(layoutGraph, candidateCoords, { bondLength });
        if (!ringLeafCandidateAuditDoesNotRegress(candidateAudit, baseAudit)) {
          continue;
        }

        const leafPosition = coords.get(leafAtomId);
        const candidateLeafPosition = candidateCoords.get(leafAtomId);
        const totalMove = leafPosition && candidateLeafPosition
          ? distance(leafPosition, candidateLeafPosition)
          : 0;
        const candidate = exactTerminalHeteroLeafCandidate(
          layoutGraph,
          candidateCoords,
          bondLength,
          anchorAtomId,
          leafAtomId,
          candidateAudit,
          totalMove
        );
        if (
          candidate.leafDeviation < incumbent.leafDeviation - IMPROVEMENT_EPSILON
          && compareExactTerminalCarbonLeafCandidates(candidate, bestCandidate) < 0
        ) {
          bestCandidate = candidate;
        }
      }
    }

    if (bestCandidate.coords !== coords) {
      overwriteCoordMap(coords, bestCandidate.coords);
      baseAudit = bestCandidate.audit;
      changed = true;
    }
  }

  return { changed };
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

/**
 * Returns whether mixed placement should try alternate ring roots after the
 * primary root produces a recoverable presentation problem. Alternate roots
 * can change the order in which direct-attached rings and flexible linkers are
 * placed, which often resolves ring-exit readability failures that late
 * cleanup cannot safely repair without moving a large subtree.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object|null} scaffoldPlan - Mixed scaffold plan.
 * @param {object|null} placementAudit - Audit for the primary-root placement.
 * @param {{conservativeAttachmentScoring?: boolean, disableAlternateRootRetry?: boolean}|null} [options] - Mixed placement options.
 * @returns {boolean} True when alternate root candidates should be evaluated.
 */
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
  return (
    placementAudit.severeOverlapCount >= MIXED_ROOT_RETRY_LIMITS.minSevereOverlapCount
    || (placementAudit.ringSubstituentReadabilityFailureCount ?? 0) > 0
    || (placementAudit.inwardRingSubstituentCount ?? 0) > 0
    || (placementAudit.outwardAxisRingSubstituentFailureCount ?? 0) > 0
  );
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
    || childPath.length < 3
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

/**
 * Reflects an already aligned single-ring bridged child across its shared
 * bridge endpoints. This gives compact fused/bridged hybrids the other legal
 * side of a multi-atom bridge even when the parent and child non-shared arcs
 * have different lengths, where exact atom-for-atom mirroring is impossible.
 * @param {Map<string, {x: number, y: number}>} placedCoords - Already placed block coordinates.
 * @param {object} childBlock - Single-ring child block being attached.
 * @param {Map<string, {x: number, y: number}>} alignedCoords - Child coordinates already aligned to the shared atoms.
 * @param {{sharedAtomIds?: string[]}} blockConnection - Hybrid block connection descriptor.
 * @returns {Map<string, {x: number, y: number}>|null} Reflected child-ring coordinates or `null` when ineligible.
 */
function buildReflectedAlignedBridgedCandidate(placedCoords, childBlock, alignedCoords, blockConnection) {
  if (childBlock.rings.length !== 1 || (blockConnection.sharedAtomIds?.length ?? 0) < 2) {
    return null;
  }

  const childRing = childBlock.rings[0];
  const segmentEndpoints = sharedBoundarySegmentEndpoints(childRing.atomIds, blockConnection.sharedAtomIds ?? []);
  if (!segmentEndpoints) {
    return null;
  }
  const [firstSharedAtomId, secondSharedAtomId] = segmentEndpoints;
  const firstSharedPosition = placedCoords.get(firstSharedAtomId);
  const secondSharedPosition = placedCoords.get(secondSharedAtomId);
  if (!firstSharedPosition || !secondSharedPosition) {
    return null;
  }

  const sharedAtomIdSet = new Set(blockConnection.sharedAtomIds ?? []);
  const reflectedCoords = new Map();
  for (const atomId of childBlock.atomIds) {
    const alignedPosition = alignedCoords.get(atomId);
    if (!alignedPosition) {
      return null;
    }
    if (sharedAtomIdSet.has(atomId)) {
      const sharedPosition = placedCoords.get(atomId);
      if (!sharedPosition) {
        return null;
      }
      reflectedCoords.set(atomId, sharedPosition);
      continue;
    }
    reflectedCoords.set(atomId, reflectAcrossLine(alignedPosition, firstSharedPosition, secondSharedPosition));
  }

  return reflectedCoords.size === childBlock.atomIds.length ? reflectedCoords : null;
}

/**
 * Finds non-shared child-ring runs bounded by shared ring atoms.
 * @param {string[]} atomIds - Ordered cyclic child-ring atom IDs.
 * @param {string[]} sharedAtomIds - Shared atom IDs on the child ring.
 * @returns {Array<{startSharedAtomId: string, endSharedAtomId: string, atomIds: string[]}>} Non-shared path runs.
 */
function separatedNonSharedChildRingRuns(atomIds, sharedAtomIds) {
  const sharedAtomIdSet = new Set(sharedAtomIds);
  const runs = [];
  for (let index = 0; index < atomIds.length; index++) {
    const atomId = atomIds[index];
    const previousAtomId = atomIds[(index - 1 + atomIds.length) % atomIds.length];
    if (sharedAtomIdSet.has(atomId) || !sharedAtomIdSet.has(previousAtomId)) {
      continue;
    }

    const runAtomIds = [];
    let cursor = index;
    while (!sharedAtomIdSet.has(atomIds[cursor]) && runAtomIds.length < atomIds.length) {
      runAtomIds.push(atomIds[cursor]);
      cursor = (cursor + 1) % atomIds.length;
    }
    const endSharedAtomId = atomIds[cursor];
    if (runAtomIds.length > 0 && sharedAtomIdSet.has(endSharedAtomId)) {
      runs.push({
        startSharedAtomId: previousAtomId,
        endSharedAtomId,
        atomIds: runAtomIds
      });
    }
  }
  return runs;
}

/**
 * Builds compressed interior zigzag candidates for a single child ring whose
 * only non-shared atoms bridge two separated shared parent-ring segments.
 * Some compact bridged/fused hybrids cannot satisfy full regular-hexagon bond
 * lengths without placing the bridge exactly on top of either parent arc; the
 * relaxed bridged class permits a small interior zigzag instead.
 * @param {Map<string, {x: number, y: number}>} placedCoords - Already placed block coordinates.
 * @param {object} placedBlock - Block that is already fixed in the hybrid layout.
 * @param {object} childBlock - Single-ring child block being attached.
 * @param {{sharedAtomIds?: string[], firstRingId: number, secondRingId: number}} blockConnection - Hybrid block connection descriptor.
 * @param {Map<number, number>} blockByRingId - Ring-to-block ownership map.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<Map<string, {x: number, y: number}>>} Candidate coordinate maps.
 */
function buildInteriorSeparatedBridgeCandidates(placedCoords, placedBlock, childBlock, blockConnection, blockByRingId, bondLength) {
  if (childBlock.rings.length !== 1 || (blockConnection.sharedAtomIds?.length ?? 0) < 3) {
    return [];
  }

  const parentRingId = blockByRingId.get(blockConnection.firstRingId) === placedBlock.id ? blockConnection.firstRingId : blockConnection.secondRingId;
  const childRingId = parentRingId === blockConnection.firstRingId ? blockConnection.secondRingId : blockConnection.firstRingId;
  const parentRing = placedBlock.rings.find(ring => ring.id === parentRingId) ?? null;
  const childRing = childBlock.rings.find(ring => ring.id === childRingId) ?? null;
  if (!parentRing || !childRing) {
    return [];
  }

  const runs = separatedNonSharedChildRingRuns(childRing.atomIds, blockConnection.sharedAtomIds ?? []);
  if (runs.length !== 1 || runs[0].atomIds.length !== 2) {
    return [];
  }

  const [firstBridgeAtomId, secondBridgeAtomId] = runs[0].atomIds;
  const firstSharedPosition = placedCoords.get(runs[0].startSharedAtomId);
  const secondSharedPosition = placedCoords.get(runs[0].endSharedAtomId);
  const parentPolygon = parentRing.atomIds.map(atomId => placedCoords.get(atomId));
  if (!firstSharedPosition || !secondSharedPosition || parentPolygon.some(position => !position)) {
    return [];
  }

  const span = distance(firstSharedPosition, secondSharedPosition);
  if (!(span > 1e-9)) {
    return [];
  }

  const unit = {
    x: (secondSharedPosition.x - firstSharedPosition.x) / span,
    y: (secondSharedPosition.y - firstSharedPosition.y) / span
  };
  const perpendicular = { x: -unit.y, y: unit.x };
  const step = span / 3;
  const minimumBridgeSegmentLength = bondLength * BRIDGED_VALIDATION.minBondLengthFactor * 1.02;
  const offset = step >= minimumBridgeSegmentLength
    ? 0
    : Math.sqrt(Math.max(0, minimumBridgeSegmentLength * minimumBridgeSegmentLength - step * step));
  const firstBasePosition = {
    x: firstSharedPosition.x + unit.x * step,
    y: firstSharedPosition.y + unit.y * step
  };
  const secondBasePosition = {
    x: firstSharedPosition.x + unit.x * step * 2,
    y: firstSharedPosition.y + unit.y * step * 2
  };

  const candidates = [];
  for (const sign of [1, -1]) {
    const firstBridgePosition = {
      x: firstBasePosition.x + perpendicular.x * offset * sign,
      y: firstBasePosition.y + perpendicular.y * offset * sign
    };
    const secondBridgePosition = {
      x: secondBasePosition.x - perpendicular.x * offset * sign,
      y: secondBasePosition.y - perpendicular.y * offset * sign
    };
    if (!pointInPolygon(firstBridgePosition, parentPolygon) || !pointInPolygon(secondBridgePosition, parentPolygon)) {
      continue;
    }

    const candidateCoords = new Map();
    for (const atomId of blockConnection.sharedAtomIds ?? []) {
      const position = placedCoords.get(atomId);
      if (!position) {
        return [];
      }
      candidateCoords.set(atomId, position);
    }
    candidateCoords.set(firstBridgeAtomId, firstBridgePosition);
    candidateCoords.set(secondBridgeAtomId, secondBridgePosition);
    if (candidateCoords.size === childBlock.atomIds.length) {
      candidates.push(candidateCoords);
    }
  }

  return candidates;
}

function placeHybridBridgedBlock(layoutGraph, placedCoords, placedBlock, childBlock, childLayout, blockConnection, blockByRingId, bondLength, referenceCoords = null) {
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
    for (const interiorBridgeCoords of buildInteriorSeparatedBridgeCandidates(placedCoords, placedBlock, childBlock, blockConnection, blockByRingId, bondLength)) {
      const interiorBridgeCandidate = {
        coords: interiorBridgeCoords,
        score: scoreHybridBlockPlacement(
          layoutGraph,
          interiorBridgeCoords,
          placedCoords,
          sharedAtomIds,
          bondLength,
          bestCandidate.score.severeOverlapCount
        ),
        validationClass: 'bridged'
      };
      if (isBetterHybridBlockScore(interiorBridgeCandidate.score, bestCandidate.score)) {
        bestCandidate = interiorBridgeCandidate;
      }
    }

    const reflectedAlignedCoords = buildReflectedAlignedBridgedCandidate(placedCoords, childBlock, aligned.coords, blockConnection);
    if (reflectedAlignedCoords) {
      const reflectedAlignedCandidate = {
        coords: reflectedAlignedCoords,
        score: scoreHybridBlockPlacement(
          layoutGraph,
          reflectedAlignedCoords,
          placedCoords,
          sharedAtomIds,
          bondLength,
          bestCandidate.score.severeOverlapCount
        )
      };
      if (isBetterHybridBlockScore(reflectedAlignedCandidate.score, bestCandidate.score)) {
        bestCandidate = reflectedAlignedCandidate;
      }
    }

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

  if (referenceCoords instanceof Map) {
    const referenceFixedCoords = new Map(sharedAtomIds.map(atomId => [atomId, placedCoords.get(atomId)]));
    const referenceAligned = alignCoordsToFixed(referenceCoords, childBlock.atomIds, referenceFixedCoords);
    if (referenceAligned.coords.size === childBlock.atomIds.length) {
      const referenceCandidate = {
        coords: referenceAligned.coords,
        score: scoreHybridBlockPlacement(
          layoutGraph,
          referenceAligned.coords,
          placedCoords,
          sharedAtomIds,
          bondLength,
          bestCandidate?.score.severeOverlapCount ?? Infinity
        )
      };
      if (isBetterHybridBlockScore(referenceCandidate.score, bestCandidate.score)) {
        bestCandidate = referenceCandidate;
      }
    }
  }

  return bestCandidate;
}

function layoutFusedConnectedHybridRingSystem(layoutGraph, rings, ringAdj, ringConnectionByPair, bondLength, options = {}) {
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
  let usesRelaxedBridgedValidation = false;
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
        placedCandidate = placeHybridBridgedBlock(
          layoutGraph,
          coords,
          currentBlock,
          neighborBlock,
          neighborLayout,
          blockConnection,
          blockGraph.blockByRingId,
          bondLength,
          options.referenceCoords
        );
      }
      if (!placedCandidate) {
        return null;
      }
      if (placedCandidate.validationClass === 'bridged') {
        usesRelaxedBridgedValidation = true;
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
    placementMode: usesRelaxedBridgedValidation ? 'constructed-bridged' : 'constructed'
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
  const audit = auditLayout(layoutGraph, placement.coords, {
    bondLength,
    bondValidationClasses
  });
  return {
    ...audit,
    ...measureRingSystemBranchSlotBlockers(layoutGraph, ringSystem, placement.coords, bondLength)
  };
}

function ringCentersForCoords(rings, coords) {
  const ringCenters = new Map();
  for (const ring of rings) {
    ringCenters.set(ring.id, centroid(ring.atomIds.map(atomId => coords.get(atomId))));
  }
  return ringCenters;
}

function measureRingSystemBranchSlotBlockers(layoutGraph, ringSystem, coords, bondLength) {
  const ringSystemAtomIds = new Set(ringSystem.atomIds);
  let blockerCount = 0;
  let minBlockerDistance = Infinity;

  for (const anchorAtomId of ringSystem.atomIds) {
    const anchorPosition = coords.get(anchorAtomId);
    if (!anchorPosition) {
      continue;
    }
    const ringNeighborIds = [];
    const exocyclicChildIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (ringSystemAtomIds.has(neighborAtomId)) {
        ringNeighborIds.push(neighborAtomId);
      } else {
        exocyclicChildIds.push(neighborAtomId);
      }
    }
    if (exocyclicChildIds.length === 0 || ringNeighborIds.length !== 2) {
      continue;
    }

    const ringNeighborPositions = ringNeighborIds.map(atomId => coords.get(atomId)).filter(Boolean);
    if (ringNeighborPositions.length !== 2) {
      continue;
    }
    const targetAngle = angleOf(sub(anchorPosition, centroid(ringNeighborPositions)));
    const targetPosition = add(anchorPosition, fromAngle(targetAngle, bondLength));
    for (const blockerAtomId of ringSystem.atomIds) {
      if (blockerAtomId === anchorAtomId || ringNeighborIds.includes(blockerAtomId)) {
        continue;
      }
      const pairKey = anchorAtomId < blockerAtomId ? `${anchorAtomId}:${blockerAtomId}` : `${blockerAtomId}:${anchorAtomId}`;
      if (layoutGraph.bondedPairSet.has(pairKey)) {
        continue;
      }
      const blockerPosition = coords.get(blockerAtomId);
      if (!blockerPosition) {
        continue;
      }
      const blockerDistance = distance(targetPosition, blockerPosition);
      if (blockerDistance < bondLength * 0.65) {
        blockerCount++;
        minBlockerDistance = Math.min(minBlockerDistance, blockerDistance);
      }
    }
  }

  return {
    ringBranchSlotBlockerCount: blockerCount,
    minRingBranchSlotBlockerDistance: Number.isFinite(minBlockerDistance) ? minBlockerDistance : null
  };
}

/**
 * Returns whether a ring-system rescue would turn a clean non-overlapping
 * incumbent into a visibly overlapping placement.
 * @param {object|null} candidateAudit - Candidate audit summary.
 * @param {object|null} incumbentAudit - Incumbent audit summary.
 * @returns {boolean} True when the rescue should be rejected.
 */
function introducesSevereRingSystemOverlap(candidateAudit, incumbentAudit) {
  return (
    incumbentAudit
    && candidateAudit
    && incumbentAudit.bondLengthFailureCount === 0
    && incumbentAudit.severeOverlapCount === 0
    && candidateAudit.severeOverlapCount > 0
  );
}

/**
 * Returns whether a hybrid ring-system rescue materially improves a distorted
 * bridged KK candidate without introducing severe overlaps. Compact hybrids can
 * have a few planar bond-length failures while still reading much better than a
 * relaxed KK cage, so permit that swap only when both candidates are overlap-free.
 * @param {object|null} candidateAudit - Candidate audit summary.
 * @param {object|null} incumbentAudit - Incumbent audit summary.
 * @returns {boolean} True when the bounded refinement should win.
 */
function isOverlapFreeRingSystemBondRefinement(candidateAudit, incumbentAudit) {
  if (!candidateAudit || !incumbentAudit) {
    return false;
  }
  return (
    candidateAudit.severeOverlapCount === 0
    && incumbentAudit.severeOverlapCount === 0
    && candidateAudit.bondLengthFailureCount <= Math.max(incumbentAudit.bondLengthFailureCount, 5)
    && candidateAudit.maxBondLengthDeviation < incumbentAudit.maxBondLengthDeviation - 0.15
  );
}

function measureAromaticRingRegularity(rings, coords) {
  let ringCount = 0;
  let maxAngleDeviation = 0;
  let totalAngleDeviation = 0;

  for (const ring of rings) {
    if (!ring.aromatic || ring.size < 5) {
      continue;
    }
    const expectedInteriorAngle = Math.PI - (2 * Math.PI) / ring.size;
    let complete = true;
    for (const atomId of ring.atomIds) {
      if (!coords.has(atomId)) {
        complete = false;
        break;
      }
    }
    if (!complete) {
      continue;
    }
    ringCount++;
    for (let index = 0; index < ring.atomIds.length; index++) {
      const atomId = ring.atomIds[index];
      const previousAtomId = ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length];
      const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
      const atomPosition = coords.get(atomId);
      const angle = angularDifference(
        angleOf(sub(coords.get(previousAtomId), atomPosition)),
        angleOf(sub(coords.get(nextAtomId), atomPosition))
      );
      const angleDeviation = Math.abs(angle - expectedInteriorAngle);
      maxAngleDeviation = Math.max(maxAngleDeviation, angleDeviation);
      totalAngleDeviation += angleDeviation;
    }
  }

  return {
    ringCount,
    maxAngleDeviation,
    totalAngleDeviation
  };
}

function fitMacrocycleAromaticRegularRingTargets(ring, coords, bondLength) {
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

function buildMacrocycleAromaticRegularizedCoords(rings, coords, bondLength, blendFactor) {
  const targetSums = new Map();
  const targetCounts = new Map();

  for (const ring of rings) {
    if (!ring.aromatic || ring.atomIds.length < 5) {
      continue;
    }
    const targets = fitMacrocycleAromaticRegularRingTargets(ring, coords, bondLength);
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

  const candidateCoords = new Map(coords);
  for (const [atomId, sum] of targetSums) {
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
      x: current.x * (1 - blendFactor) + target.x * blendFactor,
      y: current.y * (1 - blendFactor) + target.y * blendFactor
    });
  }

  return candidateCoords;
}

function macrocycleAromaticRegularizedRescueCandidates(rings, bondLength, basePlacement) {
  if (!basePlacement?.coords || !rings.some(ring => ring.aromatic)) {
    return [];
  }

  const candidates = [];
  for (const blendFactor of MACROCYCLE_AROMATIC_REGULARIZATION_BLEND_FACTORS) {
    const coords = buildMacrocycleAromaticRegularizedCoords(rings, basePlacement.coords, bondLength, blendFactor);
    if (!coords) {
      continue;
    }
    candidates.push({
      coords,
      ringCenters: ringCentersForCoords(rings, coords),
      placementMode: 'constructed-bridged'
    });
  }
  return candidates;
}

function aromaticRingOutwardAngles(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const outwardAngles = [];
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    if (!ring.aromatic || ring.atomIds.length < 5 || ring.atomIds.some(atomId => !coords.has(atomId))) {
      continue;
    }
    const ringCenter = centroid(ring.atomIds.map(atomId => coords.get(atomId)));
    if (distance(anchorPosition, ringCenter) <= 1e-9) {
      continue;
    }
    const outwardAngle = angleOf(sub(anchorPosition, ringCenter));
    if (outwardAngles.some(existingAngle => angularDifference(existingAngle, outwardAngle) <= 1e-9)) {
      continue;
    }
    outwardAngles.push(outwardAngle);
  }
  return outwardAngles;
}

function measureMacrocycleArylHeteroBridgeExit(layoutGraph, ringSystem, coords) {
  const ringSystemAtomIds = new Set(ringSystem.atomIds);
  let bridgeCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (const linkerAtomId of ringSystem.atomIds) {
    const linkerAtom = layoutGraph.atoms.get(linkerAtomId);
    if (
      !linkerAtom
      || linkerAtom.element === 'H'
      || linkerAtom.element === 'C'
      || linkerAtom.aromatic
      || linkerAtom.heavyDegree !== 2
      || !coords.has(linkerAtomId)
    ) {
      continue;
    }

    const aromaticAnchorAtomIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(linkerAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || !ringSystemAtomIds.has(bond.a) || !ringSystemAtomIds.has(bond.b)) {
        continue;
      }
      const neighborAtomId = bond.a === linkerAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (neighborAtom?.aromatic === true && coords.has(neighborAtomId)) {
        aromaticAnchorAtomIds.push(neighborAtomId);
      }
    }
    if (aromaticAnchorAtomIds.length !== 2) {
      continue;
    }

    let measuredBridge = false;
    for (const anchorAtomId of aromaticAnchorAtomIds) {
      const targetAngles = aromaticRingOutwardAngles(layoutGraph, coords, anchorAtomId);
      if (targetAngles.length === 0) {
        continue;
      }
      const actualAngle = angleOf(sub(coords.get(linkerAtomId), coords.get(anchorAtomId)));
      const deviation = Math.min(...targetAngles.map(targetAngle => angularDifference(targetAngle, actualAngle)));
      totalDeviation += deviation;
      maxDeviation = Math.max(maxDeviation, deviation);
      measuredBridge = true;
    }
    if (measuredBridge) {
      bridgeCount++;
    }
  }

  return {
    bridgeCount,
    totalDeviation,
    maxDeviation
  };
}

function shouldTryMacrocycleAromaticRingRescue(rings, templateId, placement) {
  if (templateId || !placement?.coords) {
    return false;
  }
  const regularity = measureAromaticRingRegularity(rings, placement.coords);
  return regularity.ringCount > 0 && regularity.maxAngleDeviation > MACROCYCLE_AROMATIC_RESCUE_TRIGGER_ANGLE_DEVIATION;
}

function isBetterMacrocycleAromaticRingRescue(candidatePlacement, incumbentPlacement, candidateAudit, incumbentAudit, rings) {
  if (!candidatePlacement?.coords || !candidateAudit || !incumbentPlacement?.coords || !incumbentAudit) {
    return false;
  }
  if (!candidateAudit.ok || candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.ringSubstituentReadabilityFailureCount > incumbentAudit.ringSubstituentReadabilityFailureCount) {
    return false;
  }
  const candidateRegularity = measureAromaticRingRegularity(rings, candidatePlacement.coords);
  const incumbentRegularity = measureAromaticRingRegularity(rings, incumbentPlacement.coords);
  if (candidateRegularity.ringCount === 0 || incumbentRegularity.ringCount === 0) {
    return false;
  }
  if (
    candidateRegularity.maxAngleDeviation > MACROCYCLE_AROMATIC_RESCUE_TARGET_ANGLE_DEVIATION
    && candidateRegularity.maxAngleDeviation >= incumbentRegularity.maxAngleDeviation - MACROCYCLE_AROMATIC_RESCUE_TARGET_ANGLE_DEVIATION
  ) {
    return false;
  }
  if (candidateRegularity.maxAngleDeviation < incumbentRegularity.maxAngleDeviation - IMPROVEMENT_EPSILON) {
    return true;
  }
  if (candidateRegularity.totalAngleDeviation < incumbentRegularity.totalAngleDeviation - IMPROVEMENT_EPSILON) {
    return true;
  }
  return false;
}

function isBetterMacrocycleAromaticBridgePoseRescue(
  layoutGraph,
  ringSystem,
  candidatePlacement,
  incumbentPlacement,
  candidateAudit,
  incumbentAudit,
  rings
) {
  if (!candidatePlacement?.coords || !candidateAudit || !incumbentPlacement?.coords || !incumbentAudit) {
    return false;
  }
  if (!candidateAudit.ok || candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  if ((candidateAudit.ringBranchSlotBlockerCount ?? 0) > (incumbentAudit.ringBranchSlotBlockerCount ?? 0)) {
    return false;
  }

  const candidateRegularity = measureAromaticRingRegularity(rings, candidatePlacement.coords);
  const incumbentRegularity = measureAromaticRingRegularity(rings, incumbentPlacement.coords);
  if (
    candidateRegularity.ringCount === 0
    || candidateRegularity.maxAngleDeviation > MACROCYCLE_AROMATIC_RESCUE_TARGET_ANGLE_DEVIATION
    || (
      incumbentRegularity.ringCount > 0
      && candidateRegularity.maxAngleDeviation > incumbentRegularity.maxAngleDeviation + Math.PI / 180
    )
  ) {
    return false;
  }

  const candidateBridgeExit = measureMacrocycleArylHeteroBridgeExit(layoutGraph, ringSystem, candidatePlacement.coords);
  const incumbentBridgeExit = measureMacrocycleArylHeteroBridgeExit(layoutGraph, ringSystem, incumbentPlacement.coords);
  if (candidateBridgeExit.bridgeCount === 0 || incumbentBridgeExit.bridgeCount === 0) {
    return false;
  }
  if (
    candidateBridgeExit.totalDeviation
    < incumbentBridgeExit.totalDeviation - MACROCYCLE_AROMATIC_BRIDGE_EXIT_MIN_IMPROVEMENT
  ) {
    return true;
  }
  if (
    candidateBridgeExit.maxDeviation
    < incumbentBridgeExit.maxDeviation - MACROCYCLE_AROMATIC_RESCUE_TARGET_ANGLE_DEVIATION
  ) {
    return true;
  }
  return false;
}

function isBetterRingSystemPlacement(candidatePlacement, incumbentPlacement, candidateAudit, incumbentAudit, bondFirst = false) {
  if (!candidatePlacement || !candidateAudit) {
    return false;
  }
  if (!incumbentPlacement || !incumbentAudit) {
    return true;
  }
  if (introducesSevereRingSystemOverlap(candidateAudit, incumbentAudit)) {
    return false;
  }
  if ((candidateAudit.ringBranchSlotBlockerCount ?? 0) > (incumbentAudit.ringBranchSlotBlockerCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.ringBranchSlotBlockerCount ?? 0) < (incumbentAudit.ringBranchSlotBlockerCount ?? 0)) {
    return true;
  }
  if (
    (candidateAudit.ringBranchSlotBlockerCount ?? 0) > 0
    && (incumbentAudit.ringBranchSlotBlockerCount ?? 0) > 0
    && Math.abs((candidateAudit.minRingBranchSlotBlockerDistance ?? 0) - (incumbentAudit.minRingBranchSlotBlockerDistance ?? 0)) > 1e-6
  ) {
    return (candidateAudit.minRingBranchSlotBlockerDistance ?? 0) > (incumbentAudit.minRingBranchSlotBlockerDistance ?? 0);
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if (
    candidateAudit.severeOverlapCount === 0
    && incumbentAudit.severeOverlapCount > 0
    && candidateAudit.bondLengthFailureCount === 0
  ) {
    return true;
  }
  if (bondFirst) {
    if (isOverlapFreeRingSystemBondRefinement(candidateAudit, incumbentAudit)) {
      return true;
    }
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
    const macrocyclePlacement = wrapRingSystemPlacementResult(layoutGraph, ringSystem, family, layoutMacrocycleFamily(rings, bondLength, { layoutGraph, templateId }), templateId);
    let bestPlacement = macrocyclePlacement;
    let bestAudit = auditRingSystemPlacement(layoutGraph, ringSystem, bestPlacement, bondLength);
    if (shouldTryMacrocycleAromaticRingRescue(rings, templateId, bestPlacement)) {
      const bridgedRescuePlacement = wrapRingSystemPlacementResult(
        layoutGraph,
        ringSystem,
        family,
        layoutBridgedFamily(rings, bondLength, { layoutGraph, templateId }),
        templateId
      );
      const bridgedRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, bridgedRescuePlacement, bondLength);
      if (isBetterMacrocycleAromaticRingRescue(bridgedRescuePlacement, bestPlacement, bridgedRescueAudit, bestAudit, rings)) {
        bestPlacement = bridgedRescuePlacement;
        bestAudit = bridgedRescueAudit;
      }
      for (const regularizedResult of macrocycleAromaticRegularizedRescueCandidates(rings, bondLength, macrocyclePlacement)) {
        const regularizedRescuePlacement = wrapRingSystemPlacementResult(
          layoutGraph,
          ringSystem,
          family,
          regularizedResult,
          templateId
        );
        const regularizedRescueAudit = auditRingSystemPlacement(layoutGraph, ringSystem, regularizedRescuePlacement, bondLength);
        if (
          isBetterMacrocycleAromaticBridgePoseRescue(
            layoutGraph,
            ringSystem,
            regularizedRescuePlacement,
            bestPlacement,
            regularizedRescueAudit,
            bestAudit,
            rings
          )
        ) {
          bestPlacement = regularizedRescuePlacement;
          bestAudit = regularizedRescueAudit;
        }
      }
    }
    return bestPlacement;
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
        layoutFusedConnectedHybridRingSystem(layoutGraph, rings, ringAdj, ringConnectionByPair, bondLength, {
          referenceCoords: bestPlacement.coords
        }),
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

    if (bestPlacement?.coords) {
      const regularizedCoords = regularizeFusedAromaticCyclohexaneCores(
        layoutGraph,
        rings,
        ringSystem.atomIds,
        bestPlacement.coords,
        bondLength
      );
      if (regularizedCoords !== bestPlacement.coords) {
        const regularizedPlacement = {
          ...bestPlacement,
          coords: regularizedCoords,
          ringCenters: ringCentersForCoords(rings, regularizedCoords),
          placementMode: bestPlacement.placementMode
            ? `${bestPlacement.placementMode}-fused-cyclohexane-regularized`
            : 'fused-cyclohexane-regularized'
        };
        const regularizedAudit = auditRingSystemPlacement(layoutGraph, ringSystem, regularizedPlacement, bondLength);
        if (isBetterRingSystemPlacement(regularizedPlacement, bestPlacement, regularizedAudit, bestAudit, true)) {
          bestPlacement = regularizedPlacement;
          bestAudit = regularizedAudit;
        }
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
  if (!supportsExteriorBranchSpreadRingSize(ring?.atomIds?.length ?? 0)) {
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

/**
 * Returns the two standard zigzag slots around a simple acyclic linker when a
 * directly attached heteroaryl ring root needs to choose the cleaner side.
 * This is effectively a hidden-H slot swap: both parent-side angles preserve
 * the acyclic `120°` continuation, but only one may let the child ring root
 * keep its own exact exterior bisector without colliding with upstream atoms.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Direct-attachment metadata.
 * @returns {number[]} Exact parent-side zigzag attachment angles in radians.
 */
function exactDirectAttachmentSimpleAcyclicHeteroarylAngles(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  const continuationParentAtomId = directAttachmentContinuationParentAtomId(layoutGraph, candidateMeta);
  if (
    !parentAtomId
    || !attachmentAtomId
    || !continuationParentAtomId
    || !coords.has(parentAtomId)
    || !coords.has(continuationParentAtomId)
  ) {
    return [];
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  const attachmentAtom = layoutGraph.atoms.get(attachmentAtomId);
  if (
    !parentAtom
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 2
    || (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
    || !attachmentAtom
    || attachmentAtom.element === 'C'
    || attachmentAtom.element === 'H'
    || attachmentAtom.aromatic !== true
    || (layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0
  ) {
    return [];
  }

  const continuationAngle = angleOf(sub(coords.get(continuationParentAtomId), coords.get(parentAtomId)));
  return exactContinuationAngles(continuationAngle, EXACT_TRIGONAL_CONTINUATION_ANGLE);
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
 * Returns whether a saturated fused-ring carbon has a single direct-attached
 * cyclopropyl branch that should occupy one of the fused junction exterior
 * slots.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} parentAtomId - Fused-ring parent atom ID.
 * @param {string} attachmentAtomId - Direct-attached ring root atom ID.
 * @returns {boolean} True when parent-side local outward angles should be considered exact targets.
 */
function supportsSaturatedFusedDirectAttachmentParentOutward(layoutGraph, parentAtomId, attachmentAtomId) {
  const parentAtom = layoutGraph?.atoms.get(parentAtomId);
  const attachmentAtom = layoutGraph?.atoms.get(attachmentAtomId);
  if (
    !layoutGraph
    || !parentAtom
    || !attachmentAtom
    || parentAtom.element !== 'C'
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 4
    || attachmentAtom.aromatic
    || attachmentAtom.element === 'H'
    || layoutGraph.atomToRingSystemId.get(parentAtomId) === layoutGraph.atomToRingSystemId.get(attachmentAtomId)
  ) {
    return false;
  }

  const attachmentRings = layoutGraph.atomToRings.get(attachmentAtomId) ?? [];
  if (attachmentRings.length !== 1 || attachmentRings[0]?.atomIds?.length !== 3) {
    return false;
  }

  const parentRings = layoutGraph.atomToRings.get(parentAtomId) ?? [];
  if (parentRings.length < 2) {
    return false;
  }

  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  if (
    !attachmentBond
    || attachmentBond.kind !== 'covalent'
    || attachmentBond.inRing
    || attachmentBond.aromatic
    || (attachmentBond.order ?? 1) !== 1
  ) {
    return false;
  }

  const incidentRingAtomIds = new Set(parentRings.flatMap(ring => ring.atomIds));
  const ringNeighborIds = [];
  const exocyclicNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (incidentRingAtomIds.has(neighborAtomId)) {
      ringNeighborIds.push(neighborAtomId);
    } else {
      exocyclicNeighborIds.push(neighborAtomId);
    }
  }

  return ringNeighborIds.length >= 3
    && exocyclicNeighborIds.length === 1
    && exocyclicNeighborIds[0] === attachmentAtomId;
}

/**
 * Describes a saturated four-heavy parent whose terminal leaves or acyclic
 * branches should keep the side slots while a direct-attached ring claims the
 * slot opposite an already placed ring/non-terminal branch.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Direct-attachment metadata.
 * @returns {{parentAtomId: string, attachmentAtomId: string, fixedNeighborAtomId: string}|null} Projected parent descriptor.
 */
function describeDirectAttachmentProjectedTetrahedralParent(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId)) {
    return null;
  }
  if (!supportsProjectedTetrahedralGeometry(layoutGraph, parentAtomId)) {
    return null;
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  const attachmentAtom = layoutGraph.atoms.get(attachmentAtomId);
  if (
    !parentAtom
    || parentAtom.element !== 'C'
    || parentAtom.aromatic
    || parentAtom.heavyDegree !== 4
    || !attachmentAtom
    || attachmentAtom.element === 'H'
    || (layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0
  ) {
    return null;
  }

  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  if (
    !attachmentBond
    || attachmentBond.kind !== 'covalent'
    || attachmentBond.aromatic
    || (attachmentBond.order ?? 1) !== 1
  ) {
    return null;
  }

  const terminalLeafNeighborIds = [];
  const fixedBranchNeighborIds = [];
  let deferredBranchNeighborCount = 0;
  let nonHalogenTerminalLeafCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    if (neighborAtomId === attachmentAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    const isTerminalLeaf =
      neighborAtom.heavyDegree === 1
      && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) === 0;
    if (isTerminalLeaf) {
      terminalLeafNeighborIds.push(neighborAtomId);
      if (!new Set(['F', 'Cl', 'Br', 'I']).has(neighborAtom.element)) {
        nonHalogenTerminalLeafCount++;
      }
      continue;
    }
    if (coords.has(neighborAtomId)) {
      fixedBranchNeighborIds.push(neighborAtomId);
    } else {
      deferredBranchNeighborCount++;
    }
  }

  if (nonHalogenTerminalLeafCount === 0 || deferredBranchNeighborCount !== 0) {
    return null;
  }

  if (terminalLeafNeighborIds.length === 2 && fixedBranchNeighborIds.length === 1) {
    return {
      parentAtomId,
      attachmentAtomId,
      fixedNeighborAtomId: fixedBranchNeighborIds[0]
    };
  }

  if (terminalLeafNeighborIds.length !== 1 || fixedBranchNeighborIds.length !== 2) {
    return null;
  }

  const fixedRingNeighborIds = fixedBranchNeighborIds.filter(
    neighborAtomId => (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
  );
  if (fixedRingNeighborIds.length !== 1) {
    return null;
  }

  return {
    parentAtomId,
    attachmentAtomId,
    fixedNeighborAtomId: fixedRingNeighborIds[0]
  };
}

/**
 * Returns the exact projected-tetrahedral parent-side angle for a directly
 * attached ring that shares a saturated projected parent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Direct-attachment metadata.
 * @returns {number[]} Exact attachment angles.
 */
function exactDirectAttachmentProjectedTetrahedralParentAngles(layoutGraph, coords, candidateMeta = null) {
  const descriptor = describeDirectAttachmentProjectedTetrahedralParent(layoutGraph, coords, candidateMeta);
  if (!descriptor || !coords.has(descriptor.fixedNeighborAtomId)) {
    return [];
  }

  return [
    angleOf(sub(coords.get(descriptor.fixedNeighborAtomId), coords.get(descriptor.parentAtomId))) + Math.PI
  ];
}

/**
 * Penalizes direct-attached ring candidates that steal the side slot reserved
 * for terminal leaves around a projected-tetrahedral saturated parent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Direct-attachment metadata.
 * @returns {number} Projected-tetrahedral parent penalty.
 */
function measureDirectAttachmentProjectedTetrahedralParentPenalty(layoutGraph, coords, candidateMeta = null) {
  const descriptor = describeDirectAttachmentProjectedTetrahedralParent(layoutGraph, coords, candidateMeta);
  if (!descriptor || !coords.has(descriptor.fixedNeighborAtomId) || !coords.has(descriptor.attachmentAtomId)) {
    return 0;
  }

  const parentPosition = coords.get(descriptor.parentAtomId);
  const fixedAngle = angleOf(sub(coords.get(descriptor.fixedNeighborAtomId), parentPosition));
  const attachmentAngle = angleOf(sub(coords.get(descriptor.attachmentAtomId), parentPosition));
  return (Math.PI - angularDifference(fixedAngle, attachmentAngle)) ** 2;
}

/**
 * Returns exact local ring-outward angles for a directly attached ring block
 * leaving a constrained parent atom. These ring-to-ring bonds are not ordinary
 * flexible branches: moving the attachment off the local outward bisector turns
 * an otherwise readable ring junction into a visible skewed split.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Direct-attachment metadata.
 * @returns {number[]} Exact parent-side ring-outward attachment angles.
 */
function exactDirectAttachmentParentRingOutwardAngles(layoutGraph, coords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId)) {
    return [];
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  const supportsSaturatedFusedCarbonParent = supportsSaturatedFusedDirectAttachmentParentOutward(
    layoutGraph,
    parentAtomId,
    attachmentAtomId
  );
  if (
    !parentAtom
    || parentAtom.element === 'H'
    || (parentAtom.heavyDegree !== 3 && !supportsSaturatedFusedCarbonParent)
  ) {
    return [];
  }
  const attachmentAtom = layoutGraph.atoms.get(attachmentAtomId);
  const supportsSaturatedRingNitrogenParent =
    parentAtom.element === 'N'
    && !parentAtom.aromatic
    && parentAtom.degree === 3;
  const maxAttachmentHeavyDegree = supportsSaturatedRingNitrogenParent ? 4 : 3;
  if (!attachmentAtom || attachmentAtom.element === 'H' || (attachmentAtom.heavyDegree ?? 0) > maxAttachmentHeavyDegree) {
    return [];
  }
  if (!parentAtom.aromatic && !supportsSaturatedRingNitrogenParent && !supportsSaturatedFusedCarbonParent) {
    return [];
  }
  const parentRingCount = layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0;
  if (
    (supportsSaturatedFusedCarbonParent ? parentRingCount < 2 : parentRingCount !== 1)
    || (layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0
  ) {
    return [];
  }
  if (layoutGraph.atomToRingSystemId.get(parentAtomId) === layoutGraph.atomToRingSystemId.get(attachmentAtomId)) {
    return [];
  }

  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  if (!attachmentBond || attachmentBond.kind !== 'covalent' || attachmentBond.inRing || attachmentBond.aromatic || (attachmentBond.order ?? 1) !== 1) {
    return [];
  }

  if (supportsSaturatedRingNitrogenParent) {
    const parentRing = (layoutGraph.atomToRings.get(parentAtomId) ?? [])[0];
    const parentRingAtomIds = new Set(parentRing?.atomIds ?? []);
    const ringNeighborIds = [];
    const exocyclicNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
        return [];
      }
      const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (parentRingAtomIds.has(neighborAtomId)) {
        ringNeighborIds.push(neighborAtomId);
        continue;
      }
      exocyclicNeighborIds.push(neighborAtomId);
    }
    if (ringNeighborIds.length !== 2 || exocyclicNeighborIds.length !== 1 || exocyclicNeighborIds[0] !== attachmentAtomId) {
      return [];
    }
  }

  return [
    ...directAttachmentLocalOutwardAngles(layoutGraph, coords, parentAtomId, attachmentAtomId),
    ...incidentRingOutwardAngles(layoutGraph, coords, parentAtomId)
  ].filter((angle, index, angles) =>
    angles.findIndex(existingAngle => angularDifference(existingAngle, angle) <= 1e-9) === index
  );
}

/**
 * Returns whether a direct-attached ring root should keep its parent bond on
 * the root atom's exact local outward axis. Acyclic amine/alkyl linkers do not
 * have a trigonal parent angle to enforce, but aromatic roots and compact
 * cyclopropyl roots still read poorly when the child ring is skewed around the
 * fixed parent bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} parentAtomId - Already placed parent atom ID.
 * @param {string} attachmentAtomId - Attached ring-root atom ID.
 * @returns {boolean} True when child-root ring-exit rescue is appropriate.
 */
function supportsExactDirectAttachmentChildRingRootOutward(layoutGraph, parentAtomId, attachmentAtomId) {
  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  const attachmentAtom = layoutGraph.atoms.get(attachmentAtomId);
  if (
    !parentAtom
    || !attachmentAtom
    || parentAtom.element === 'H'
    || attachmentAtom.element === 'H'
    || attachmentAtom.heavyDegree !== 3
    || (layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0
  ) {
    return false;
  }
  const attachmentRings = layoutGraph.atomToRings.get(attachmentAtomId) ?? [];
  const supportsSaturatedCyclopropylRoot =
    !attachmentAtom.aromatic
    && attachmentRings.length === 1
    && attachmentRings[0]?.atomIds?.length === 3;
  if (!attachmentAtom.aromatic && !supportsSaturatedCyclopropylRoot) {
    return false;
  }
  if (layoutGraph.atomToRingSystemId.get(parentAtomId) === layoutGraph.atomToRingSystemId.get(attachmentAtomId)) {
    return false;
  }

  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  return !!attachmentBond
    && attachmentBond.kind === 'covalent'
    && !attachmentBond.inRing
    && !attachmentBond.aromatic
    && (attachmentBond.order ?? 1) === 1;
}

/**
 * Measures the child-root outward miss for a direct-attached ring block.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} parentAtomId - Placed parent atom ID.
 * @param {string} attachmentAtomId - Attached ring-root atom ID.
 * @returns {number} Smallest root-outward deviation in radians.
 */
function directAttachedRingRootOutwardDeviation(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  const parentPosition = coords.get(parentAtomId);
  const attachmentPosition = coords.get(attachmentAtomId);
  if (!parentPosition || !attachmentPosition) {
    return Number.POSITIVE_INFINITY;
  }

  const rootOutwardAngles = directAttachmentLocalOutwardAngles(layoutGraph, coords, attachmentAtomId, parentAtomId);
  if (rootOutwardAngles.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const parentAngle = angleOf(sub(parentPosition, attachmentPosition));
  return Math.min(...rootOutwardAngles.map(outwardAngle => angularDifference(parentAngle, outwardAngle)));
}

/**
 * Returns the smallest rotation that would put the child ring-root outward axis
 * onto the fixed parent bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} parentAtomId - Placed parent atom ID.
 * @param {string} attachmentAtomId - Attached ring-root atom ID.
 * @returns {number|null} Rotation angle in radians, or null when unavailable.
 */
function directAttachedRingRootOutwardCorrection(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  const parentPosition = coords.get(parentAtomId);
  const attachmentPosition = coords.get(attachmentAtomId);
  if (!parentPosition || !attachmentPosition) {
    return null;
  }

  const rootOutwardAngles = directAttachmentLocalOutwardAngles(layoutGraph, coords, attachmentAtomId, parentAtomId);
  if (rootOutwardAngles.length === 0) {
    return null;
  }

  const parentAngle = angleOf(sub(parentPosition, attachmentPosition));
  let bestCorrection = null;
  let bestDeviation = Number.POSITIVE_INFINITY;
  for (const outwardAngle of rootOutwardAngles) {
    const correction = normalizeSignedAngle(parentAngle - outwardAngle);
    const deviation = Math.abs(correction);
    if (deviation < bestDeviation) {
      bestDeviation = deviation;
      bestCorrection = correction;
    }
  }
  return bestCorrection;
}

/**
 * Describes a divalent imine nitrogen whose single-bond branch starts an
 * aromatic ring. These centers have two exact 120-degree publication slots for
 * the aryl branch; choosing the wrong slot can make a downstream biphenyl exit
 * collide with the imine-side methyl while still looking locally plausible.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} centerAtomId - Candidate imine nitrogen atom ID.
 * @returns {{centerAtomId: string, multipleNeighborAtomId: string, arylRootAtomId: string}|null} Descriptor, or null when unsupported.
 */
function describeDivalentImineArylRoot(layoutGraph, coords, centerAtomId) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (
    !centerAtom
    || centerAtom.element !== 'N'
    || centerAtom.aromatic
    || centerAtom.heavyDegree !== 2
    || centerAtom.degree !== 2
    || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
    || !coords.has(centerAtomId)
  ) {
    return null;
  }

  let multipleNeighborAtomId = null;
  let arylRootAtomId = null;
  for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
      continue;
    }
    const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    if ((bond.order ?? 1) >= 2) {
      if (multipleNeighborAtomId != null) {
        return null;
      }
      multipleNeighborAtomId = neighborAtomId;
      continue;
    }
    if (
      (bond.order ?? 1) === 1
      && neighborAtom.aromatic === true
      && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
    ) {
      if (arylRootAtomId != null) {
        return null;
      }
      arylRootAtomId = neighborAtomId;
    }
  }

  return multipleNeighborAtomId && arylRootAtomId
    ? { centerAtomId, multipleNeighborAtomId, arylRootAtomId }
    : null;
}

/**
 * Returns exact 120-degree aryl branch slots around a divalent imine center.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{centerAtomId: string, multipleNeighborAtomId: string}} descriptor - Imine descriptor.
 * @returns {number[]} Exact aryl-root angles in radians.
 */
function exactDivalentImineArylRootAngles(layoutGraph, coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const multipleNeighborPosition = coords.get(descriptor.multipleNeighborAtomId);
  if (!centerPosition || !multipleNeighborPosition) {
    return [];
  }
  const multipleNeighborAngle = angleOf(sub(multipleNeighborPosition, centerPosition));
  return [
    wrapAngle(multipleNeighborAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE),
    wrapAngle(multipleNeighborAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE)
  ];
}

/**
 * Measures how far the aryl branch at a divalent imine nitrogen misses either
 * exact 120-degree publication slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {{centerAtomId: string, arylRootAtomId: string, multipleNeighborAtomId: string}} descriptor - Imine descriptor.
 * @returns {number} Squared angular deviation in radians.
 */
function measureDivalentImineArylRootPenalty(layoutGraph, coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const rootPosition = coords.get(descriptor.arylRootAtomId);
  const exactAngles = exactDivalentImineArylRootAngles(layoutGraph, coords, descriptor);
  if (!centerPosition || !rootPosition || exactAngles.length === 0) {
    return 0;
  }
  const rootAngle = angleOf(sub(rootPosition, centerPosition));
  return Math.min(...exactAngles.map(exactAngle => angularDifference(rootAngle, exactAngle) ** 2));
}

/**
 * Finds downstream direct ring-to-ring roots inside an imine aryl branch.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} branchRootAtomId - First aryl atom attached to the imine.
 * @param {Set<string>} branchAtomIds - Atom IDs on the aryl side of the imine.
 * @returns {Array<{parentAtomId: string, attachmentAtomId: string, attachmentSideAtomIds: string[], parentSideAtomCount: number}>} Downstream direct-ring descriptors.
 */
function collectDownstreamDirectAttachedRingRootDescriptors(layoutGraph, branchRootAtomId, branchAtomIds) {
  const descriptors = [];
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    if (!branchAtomIds.has(bond.a) || !branchAtomIds.has(bond.b)) {
      continue;
    }
    if ((layoutGraph.atomToRings.get(bond.a)?.length ?? 0) === 0 || (layoutGraph.atomToRings.get(bond.b)?.length ?? 0) === 0) {
      continue;
    }
    if (layoutGraph.atomToRingSystemId.get(bond.a) === layoutGraph.atomToRingSystemId.get(bond.b)) {
      continue;
    }

    for (const [parentAtomId, attachmentAtomId] of [[bond.a, bond.b], [bond.b, bond.a]]) {
      if (!supportsExactDirectAttachmentChildRingRootOutward(layoutGraph, parentAtomId, attachmentAtomId)) {
        continue;
      }
      const attachmentSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
        .filter(atomId => branchAtomIds.has(atomId));
      if (attachmentSideAtomIds.includes(branchRootAtomId)) {
        continue;
      }
      const parentSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, parentAtomId, attachmentAtomId)
        .filter(atomId => branchAtomIds.has(atomId));
      if (!parentSideAtomIds.includes(branchRootAtomId)) {
        continue;
      }
      descriptors.push({
        parentAtomId,
        attachmentAtomId,
        attachmentSideAtomIds,
        parentSideAtomCount: parentSideAtomIds.length
      });
    }
  }

  return descriptors.sort((firstDescriptor, secondDescriptor) => (
    firstDescriptor.parentSideAtomCount - secondDescriptor.parentSideAtomCount
    || compareCanonicalIds(firstDescriptor.parentAtomId, secondDescriptor.parentAtomId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstDescriptor.attachmentAtomId, secondDescriptor.attachmentAtomId, layoutGraph.canonicalAtomRank)
  ));
}

/**
 * Snaps downstream ring roots within a moved imine aryl branch so each
 * direct-attached ring keeps the fixed parent bond on the child ring's local
 * outward axis.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {Array<{parentAtomId: string, attachmentAtomId: string, attachmentSideAtomIds: string[]}>} descriptors - Downstream ring-root descriptors.
 * @returns {boolean} True when any ring root moved.
 */
function snapDownstreamDirectAttachedRingRoots(layoutGraph, coords, descriptors) {
  let changed = false;
  for (const descriptor of descriptors) {
    const correction = directAttachedRingRootOutwardCorrection(
      layoutGraph,
      coords,
      descriptor.parentAtomId,
      descriptor.attachmentAtomId
    );
    if (correction == null || Math.abs(correction) <= IMPROVEMENT_EPSILON) {
      continue;
    }
    const rotatedCoords = rotateAtomIdsAroundPivot(
      coords,
      descriptor.attachmentSideAtomIds.filter(atomId => coords.has(atomId)),
      descriptor.attachmentAtomId,
      correction
    );
    if (!rotatedCoords) {
      continue;
    }
    overwriteCoordMap(coords, rotatedCoords);
    changed = true;
  }
  return changed;
}

/**
 * Scores an imine-linked aryl-chain refinement candidate with global audit
 * gates and focused ring-exit/readability metrics for the moved branch.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {Set<string>} focusAtomIds - Atoms in the refined imine aryl branch.
 * @param {{centerAtomId: string, arylRootAtomId: string, multipleNeighborAtomId: string}} descriptor - Imine descriptor.
 * @returns {object} Candidate score.
 */
function scoreExactImineArylChainRefinement(layoutGraph, coords, bondLength, focusAtomIds, descriptor) {
  const audit = auditLayout(layoutGraph, coords, { bondLength });
  const readability = measureRingSubstituentReadability(layoutGraph, coords);
  const focusReadability = measureRingSubstituentReadability(layoutGraph, coords, { focusAtomIds });
  const ringExitPenalty = measureMixedRootExactRingExitPenalty(layoutGraph, coords, focusAtomIds);
  return {
    coords,
    audit,
    readability,
    focusReadability,
    imineRootPenalty: measureDivalentImineArylRootPenalty(layoutGraph, coords, descriptor),
    ringExitPenalty,
    trigonalPenalty: measureTrigonalDistortion(layoutGraph, coords).totalDeviation,
    layoutCost: measureFocusedPlacementCost(layoutGraph, coords, bondLength, focusAtomIds)
  };
}

/**
 * Compares imine-linked aryl-chain refinement candidates.
 * @param {object} candidate - Candidate score.
 * @param {object} incumbent - Current best score.
 * @returns {number} Negative when the candidate is better.
 */
function compareExactImineArylChainRefinementScores(candidate, incumbent) {
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount - incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount - incumbent.audit.bondLengthFailureCount;
  }
  if (candidate.readability.failingSubstituentCount !== incumbent.readability.failingSubstituentCount) {
    return candidate.readability.failingSubstituentCount - incumbent.readability.failingSubstituentCount;
  }
  if (candidate.focusReadability.failingSubstituentCount !== incumbent.focusReadability.failingSubstituentCount) {
    return candidate.focusReadability.failingSubstituentCount - incumbent.focusReadability.failingSubstituentCount;
  }
  if (Math.abs(candidate.imineRootPenalty - incumbent.imineRootPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.imineRootPenalty - incumbent.imineRootPenalty;
  }
  if (Math.abs(candidate.ringExitPenalty.maxDeviation - incumbent.ringExitPenalty.maxDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.ringExitPenalty.maxDeviation - incumbent.ringExitPenalty.maxDeviation;
  }
  if (Math.abs(candidate.ringExitPenalty.totalDeviation - incumbent.ringExitPenalty.totalDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.ringExitPenalty.totalDeviation - incumbent.ringExitPenalty.totalDeviation;
  }
  if (Math.abs(candidate.readability.totalOutwardDeviation - incumbent.readability.totalOutwardDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.readability.totalOutwardDeviation - incumbent.readability.totalOutwardDeviation;
  }
  if (Math.abs(candidate.trigonalPenalty - incumbent.trigonalPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.trigonalPenalty - incumbent.trigonalPenalty;
  }
  if (Math.abs(candidate.layoutCost - incumbent.layoutCost) > IMPROVEMENT_EPSILON) {
    return candidate.layoutCost - incumbent.layoutCost;
  }
  return 0;
}

/**
 * Refines imine-linked aryl chains by trying both exact 120-degree imine slots
 * and snapping downstream direct-attached ring roots. This resolves aryl-imine
 * chains where the locally valid slot forces a biphenyl ortho atom onto an
 * imine-side methyl, while the opposite exact slot preserves both imine and
 * biphenyl angles cleanly.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether the chain refinement changed coordinates.
 */
function refineExactImineLinkedArylRingChains(layoutGraph, coords, bondLength) {
  let changed = false;
  const descriptors = [...coords.keys()]
    .map(atomId => describeDivalentImineArylRoot(layoutGraph, coords, atomId))
    .filter(Boolean)
    .sort((firstDescriptor, secondDescriptor) =>
      compareCanonicalIds(firstDescriptor.centerAtomId, secondDescriptor.centerAtomId, layoutGraph.canonicalAtomRank)
    );

  for (const descriptor of descriptors) {
    const branchAtomIds = new Set(
      collectCovalentSubtreeAtomIds(layoutGraph, descriptor.arylRootAtomId, descriptor.centerAtomId)
        .filter(atomId => coords.has(atomId))
    );
    if (branchAtomIds.size === 0) {
      continue;
    }
    const downstreamRingRootDescriptors = collectDownstreamDirectAttachedRingRootDescriptors(
      layoutGraph,
      descriptor.arylRootAtomId,
      branchAtomIds
    );

    const focusAtomIds = new Set([
      descriptor.centerAtomId,
      descriptor.multipleNeighborAtomId,
      ...branchAtomIds
    ]);
    const baseScore = scoreExactImineArylChainRefinement(layoutGraph, coords, bondLength, focusAtomIds, descriptor);
    if (
      baseScore.imineRootPenalty <= IMPROVEMENT_EPSILON
      && baseScore.ringExitPenalty.maxDeviation <= IMPROVEMENT_EPSILON
      && baseScore.focusReadability.failingSubstituentCount === 0
    ) {
      continue;
    }

    let bestScore = baseScore;
    for (const targetAngle of exactDivalentImineArylRootAngles(layoutGraph, coords, descriptor)) {
      const candidateCoords = new Map(coords);
      const centerPosition = candidateCoords.get(descriptor.centerAtomId);
      const rootPosition = candidateCoords.get(descriptor.arylRootAtomId);
      if (!centerPosition || !rootPosition) {
        continue;
      }
      const currentRootAngle = angleOf(sub(rootPosition, centerPosition));
      const rootRotation = wrapAngle(targetAngle - currentRootAngle);
      for (const atomId of branchAtomIds) {
        const position = candidateCoords.get(atomId);
        if (!position) {
          continue;
        }
        candidateCoords.set(atomId, add(centerPosition, rotate(sub(position, centerPosition), rootRotation)));
      }
      snapDownstreamDirectAttachedRingRoots(layoutGraph, candidateCoords, downstreamRingRootDescriptors);

      const candidateScore = scoreExactImineArylChainRefinement(layoutGraph, candidateCoords, bondLength, focusAtomIds, descriptor);
      if (compareExactImineArylChainRefinementScores(candidateScore, bestScore) < 0) {
        bestScore = candidateScore;
      }
    }

    if (bestScore !== baseScore) {
      overwriteCoordMap(coords, bestScore.coords);
      changed = true;
    }
  }

  return { changed };
}

/**
 * Returns a compact terminal hetero leaf on an acyl/carboxyl-style ring branch
 * that may be locally rotated to clear an attached-ring clash.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} leafAtomId - Candidate terminal leaf atom ID.
 * @returns {{centerAtomId: string, leafAtomId: string, ringAnchorAtomId: string, movedAtomIds: string[]}|null} Escape descriptor.
 */
function terminalCarbonylLeafEscapeDescriptor(layoutGraph, coords, leafAtomId) {
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (
    !leafAtom
    || leafAtom.element === 'H'
    || leafAtom.element === 'C'
    || leafAtom.aromatic
    || leafAtom.heavyDegree !== 1
    || !coords.has(leafAtomId)
  ) {
    return null;
  }

  const centerAtomId = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === leafAtomId ? bond.b : bond.a))
    .find(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    }) ?? null;
  const centerAtom = centerAtomId ? layoutGraph.atoms.get(centerAtomId) : null;
  if (
    !centerAtomId
    || !centerAtom
    || centerAtom.element !== 'C'
    || centerAtom.aromatic
    || centerAtom.heavyDegree !== 3
    || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
  ) {
    return null;
  }

  const visibleHeavyNeighborIds = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === centerAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
  if (visibleHeavyNeighborIds.length !== 3) {
    return null;
  }

  const ringNeighborIds = visibleHeavyNeighborIds.filter(neighborAtomId =>
    (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
  );
  const heteroNeighborCount = visibleHeavyNeighborIds.filter(neighborAtomId => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom && neighborAtom.element !== 'C' && neighborAtom.element !== 'H';
  }).length;
  const terminalHeteroLeafCount = visibleHeavyNeighborIds.filter(neighborAtomId => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return (
      neighborAtom
      && neighborAtom.element !== 'C'
      && neighborAtom.element !== 'H'
      && neighborAtom.heavyDegree === 1
      && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) === 0
    );
  }).length;
  if (
    ringNeighborIds.length !== 1
    || terminalHeteroLeafCount < 1
    || heteroNeighborCount < 2
  ) {
    return null;
  }

  const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, leafAtomId, centerAtomId);
  return { centerAtomId, leafAtomId, ringAnchorAtomId: ringNeighborIds[0], movedAtomIds };
}

function translateAtomIdsToTargetPosition(coords, atomIds, atomId, targetPosition) {
  const atomPosition = coords.get(atomId);
  if (!atomPosition || !targetPosition) {
    return null;
  }

  const delta = sub(targetPosition, atomPosition);
  const nextCoords = new Map(coords);
  for (const movedAtomId of atomIds) {
    const position = coords.get(movedAtomId);
    if (!position) {
      continue;
    }
    nextCoords.set(movedAtomId, add(position, delta));
  }
  return nextCoords;
}

function terminalCarbonylLeafExactTrigonalAngles(layoutGraph, coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition) {
    return [];
  }

  const otherNeighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(descriptor.centerAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === descriptor.centerAtomId ? bond.b : bond.a;
    if (neighborAtomId === descriptor.leafAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
      continue;
    }
    otherNeighborAngles.push(angleOf(sub(neighborPosition, centerPosition)));
  }
  if (otherNeighborAngles.length !== 2) {
    return [];
  }

  const exactAngles = [];
  for (const neighborAngle of otherNeighborAngles) {
    for (const offset of [EXACT_TRIGONAL_CONTINUATION_ANGLE, -EXACT_TRIGONAL_CONTINUATION_ANGLE]) {
      const candidateAngle = neighborAngle + offset;
      if (
        otherNeighborAngles.every(angle =>
          Math.abs(angularDifference(candidateAngle, angle) - EXACT_TRIGONAL_CONTINUATION_ANGLE) <= 1e-6
        )
        && exactAngles.every(existingAngle => angularDifference(existingAngle, candidateAngle) > 1e-6)
      ) {
        exactAngles.push(candidateAngle);
      }
    }
  }
  return exactAngles;
}

function buildTerminalCarbonylLeafCompressionCandidates(layoutGraph, coords, descriptor, bondLength) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  if (!centerPosition) {
    return [];
  }

  const candidates = [];
  for (const targetAngle of terminalCarbonylLeafExactTrigonalAngles(layoutGraph, coords, descriptor)) {
    for (const compressionFactor of TERMINAL_CARBONYL_LEAF_COMPRESSION_FACTORS) {
      const targetPosition = add(centerPosition, fromAngle(targetAngle, bondLength * compressionFactor));
      const candidateCoords = translateAtomIdsToTargetPosition(
        coords,
        descriptor.movedAtomIds,
        descriptor.leafAtomId,
        targetPosition
      );
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (candidateAudit.ok !== true) {
        continue;
      }
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

function terminalCarbonylLeafTrigonalDeviation(layoutGraph, coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!centerPosition || !leafPosition) {
    return Number.POSITIVE_INFINITY;
  }
  const exactAngles = terminalCarbonylLeafExactTrigonalAngles(layoutGraph, coords, descriptor);
  if (exactAngles.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  const leafAngle = angleOf(sub(leafPosition, centerPosition));
  return Math.min(...exactAngles.map(exactAngle => angularDifference(leafAngle, exactAngle)));
}

function threeHeavyCenterMaxAngularDeviation(layoutGraph, coords, centerAtomId) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return Number.POSITIVE_INFINITY;
  }
  const neighborAngles = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === centerAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    })
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), centerPosition)));
  if (neighborAngles.length !== 3) {
    return 0;
  }

  const separations = [];
  for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
      separations.push(angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]));
    }
  }
  return Math.max(...separations.map(separation => Math.abs(separation - EXACT_TRIGONAL_CONTINUATION_ANGLE)));
}

function terminalCarbonylBranchEscapeLocalDeviation(layoutGraph, coords, descriptor) {
  return Math.max(
    terminalCarbonylLeafTrigonalDeviation(layoutGraph, coords, descriptor),
    threeHeavyCenterMaxAngularDeviation(layoutGraph, coords, descriptor.anchorAtomId)
  );
}

function terminalCarbonylBranchEscapeDescriptor(layoutGraph, coords, leafAtomId) {
  const leafDescriptor = terminalCarbonylLeafEscapeDescriptor(layoutGraph, coords, leafAtomId);
  if (!leafDescriptor) {
    return null;
  }

  const anchorAtomId = (layoutGraph.bondsByAtomId.get(leafDescriptor.centerAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === leafDescriptor.centerAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom
        && neighborAtom.element !== 'H'
        && neighborAtomId !== leafDescriptor.leafAtomId
        && coords.has(neighborAtomId);
    })
    .find(neighborAtomId => (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) ?? null;
  if (!anchorAtomId || layoutGraph.atoms.get(anchorAtomId)?.chirality) {
    return null;
  }

  const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, leafDescriptor.centerAtomId, anchorAtomId)
    .filter(atomId => coords.has(atomId));
  const movedHeavyAtomCount = movedAtomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H';
  }).length;
  if (
    movedHeavyAtomCount === 0
    || movedHeavyAtomCount > 8
    || movedAtomIds.some(atomId => (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0)
  ) {
    return null;
  }

  return {
    ...leafDescriptor,
    anchorAtomId,
    movedAtomIds
  };
}

function buildTerminalCarbonylBranchEscapeCandidates(layoutGraph, coords, rotatedRingAtomIds, bondLength) {
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  if (overlaps.length === 0) {
    return [coords];
  }

  const descriptors = [];
  const seenKeys = new Set();
  for (const { firstAtomId, secondAtomId } of overlaps) {
    for (const [leafAtomId, opposingAtomId] of [
      [firstAtomId, secondAtomId],
      [secondAtomId, firstAtomId]
    ]) {
      if (!rotatedRingAtomIds.has(opposingAtomId)) {
        continue;
      }
      const descriptor = terminalCarbonylBranchEscapeDescriptor(layoutGraph, coords, leafAtomId);
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.anchorAtomId}:${descriptor.centerAtomId}:${descriptor.leafAtomId}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      descriptors.push(descriptor);
    }
  }
  if (descriptors.length === 0) {
    return [];
  }

  const bestCandidates = [];
  let bestLocalDeviation = Number.POSITIVE_INFINITY;
  for (const descriptor of descriptors) {
    for (const rotationOffset of TERMINAL_CARBONYL_BRANCH_ESCAPE_OFFSETS) {
      const branchCoords = rotateAtomIdsAroundPivot(
        coords,
        descriptor.movedAtomIds,
        descriptor.anchorAtomId,
        rotationOffset
      );
      if (!branchCoords) {
        continue;
      }
      for (const leafRotationOffset of [0, ...TERMINAL_CARBONYL_LEAF_ESCAPE_OFFSETS]) {
        const candidateCoords = Math.abs(leafRotationOffset) <= IMPROVEMENT_EPSILON
          ? branchCoords
          : rotateAtomIdsAroundPivot(
              branchCoords,
              descriptor.movedAtomIds.filter(atomId => atomId === descriptor.leafAtomId),
              descriptor.centerAtomId,
              leafRotationOffset
            );
        if (!candidateCoords) {
          continue;
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
        if (candidateAudit.ok !== true) {
          continue;
        }
        const localDeviation = terminalCarbonylBranchEscapeLocalDeviation(layoutGraph, candidateCoords, descriptor);
        if (localDeviation < bestLocalDeviation - IMPROVEMENT_EPSILON) {
          bestCandidates.length = 0;
          bestLocalDeviation = localDeviation;
        }
        if (localDeviation <= bestLocalDeviation + IMPROVEMENT_EPSILON) {
          bestCandidates.push(candidateCoords);
        }
      }
    }
  }
  return bestCandidates;
}

/**
 * Builds terminal carbonyl-leaf rotations that clear overlaps introduced while
 * straightening a neighboring direct-attached ring root.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map before leaf escape.
 * @param {Set<string>} rotatedRingAtomIds - Atom ids moved by the root rotation.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<Map<string, {x: number, y: number}>>} Audit-clean leaf-escape candidates.
 */
function buildTerminalCarbonylLeafEscapeCandidates(layoutGraph, coords, rotatedRingAtomIds, bondLength) {
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  if (overlaps.length === 0) {
    return [coords];
  }

  const descriptors = [];
  const seenKeys = new Set();
  for (const { firstAtomId, secondAtomId } of overlaps) {
    for (const [leafAtomId, opposingAtomId] of [
      [firstAtomId, secondAtomId],
      [secondAtomId, firstAtomId]
    ]) {
      if (!rotatedRingAtomIds.has(opposingAtomId)) {
        continue;
      }
      const descriptor = terminalCarbonylLeafEscapeDescriptor(layoutGraph, coords, leafAtomId);
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.centerAtomId}:${descriptor.leafAtomId}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      descriptors.push(descriptor);
    }
  }
  if (descriptors.length === 0) {
    return [];
  }

  const candidates = [];
  for (const descriptor of descriptors) {
    candidates.push(...buildTerminalCarbonylLeafCompressionCandidates(layoutGraph, coords, descriptor, bondLength));
    for (const rotationOffset of TERMINAL_CARBONYL_LEAF_ESCAPE_OFFSETS) {
      const candidateCoords = rotateAtomIdsAroundPivot(
        coords,
        descriptor.movedAtomIds,
        descriptor.centerAtomId,
        rotationOffset
      );
      if (!candidateCoords) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (candidateAudit.ok !== true) {
        continue;
      }
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

/**
 * Builds attached-block variants where an exact child-ring root keeps its
 * placement and a compact ester branch shares the escape with its terminal
 * carbonyl leaf. This lets 180-degree flipped aryl roots stay exact without
 * forcing either the carbonyl or its hidden-H ring anchor into a severe angle.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current fixed coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Attached-block candidate coordinates.
 * @param {number} bondLength - Target bond length.
 * @param {object|null} [candidateMeta] - Optional attached-block metadata.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Leaf-escaped attached-block candidates.
 */
function buildAttachedBlockTerminalCarbonylLeafEscapeCandidates(layoutGraph, coords, transformedCoords, bondLength, candidateMeta = null) {
  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }

  const rootScore = candidateMeta?.parentAtomId && candidateMeta?.attachmentAtomId
    ? directAttachedRingRootRefinementScore(
        layoutGraph,
        candidateCoords,
        bondLength,
        candidateMeta.parentAtomId,
        candidateMeta.attachmentAtomId
      )
    : null;
  if (
    rootScore
    && (
      rootScore.rootDeviation > IMPROVEMENT_EPSILON
      || rootScore.exactRingExitPenalty > IMPROVEMENT_EPSILON
    )
  ) {
    return [];
  }

  const transformedAtomIds = new Set(transformedCoords.keys());
  const branchEscapeCoords = buildTerminalCarbonylBranchEscapeCandidates(
    layoutGraph,
    candidateCoords,
    transformedAtomIds,
    bondLength
  );
  const leafEscapeCoords = buildTerminalCarbonylLeafEscapeCandidates(
    layoutGraph,
    candidateCoords,
    transformedAtomIds,
    bondLength
  );
  const escapedCoords = (
    branchEscapeCoords.length > 0
      ? branchEscapeCoords
      : leafEscapeCoords
  ).filter(nextCoords => nextCoords !== candidateCoords);

  return escapedCoords.map(nextCoords => {
    const nextTransformedCoords = new Map(transformedCoords);
    for (const [atomId, position] of nextCoords) {
      const basePosition = coords.get(atomId);
      const transformedPosition = transformedCoords.get(atomId);
      const referencePosition = transformedPosition ?? basePosition;
      if (
        transformedCoords.has(atomId)
        || (
          referencePosition
          && Math.hypot(position.x - referencePosition.x, position.y - referencePosition.y) > IMPROVEMENT_EPSILON
        )
      ) {
        nextTransformedCoords.set(atomId, position);
      }
    }
    return {
      transformedCoords: nextTransformedCoords,
      meta: {
        ...(candidateMeta ?? {}),
        prioritizeRingExitBeforeTerminalSlots: true,
        terminalCarbonylLeafEscape: true
      }
    };
  });
}

/**
 * Returns a terminal hetero leaf on a compact parent-attached tripod branch.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} leafAtomId - Candidate terminal leaf atom ID.
 * @param {string} parentAtomId - Parent ring atom that owns the tripod branch.
 * @returns {{centerAtomId: string, leafAtomId: string, movedAtomIds: string[]}|null} Escape descriptor.
 */
function terminalTripodLeafEscapeDescriptor(layoutGraph, coords, leafAtomId, parentAtomId) {
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

  const centerAtomId = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === leafAtomId ? bond.b : bond.a))
    .find(neighborAtomId => isCompactTerminalHeteroTripodCenter(layoutGraph, neighborAtomId, parentAtomId)) ?? null;
  if (!centerAtomId || !coords.has(centerAtomId)) {
    return null;
  }

  return {
    centerAtomId,
    leafAtomId,
    movedAtomIds: collectCovalentSubtreeAtomIds(layoutGraph, leafAtomId, centerAtomId)
  };
}

/**
 * Returns whether a compact tripod center still has a readable terminal fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} centerAtomId - Tripod center atom ID.
 * @returns {boolean} True when all heavy-neighbor separations stay readable.
 */
function compactTripodLeafFanIsReadable(layoutGraph, coords, centerAtomId) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return false;
  }

  const neighborAngles = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === centerAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    })
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), centerPosition)));
  if (neighborAngles.length !== 4) {
    return false;
  }

  for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
      if (angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]) < TERMINAL_TRIPOD_LEAF_MIN_SEPARATION - IMPROVEMENT_EPSILON) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Builds terminal hetero-leaf escapes for compact CF3/CCl3-like tripod
 * siblings when an exact direct-attached ring root would otherwise collide
 * with one terminal leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map before leaf escape.
 * @param {Set<string>} rotatedRingAtomIds - Atom ids moved by the root rotation.
 * @param {string} parentAtomId - Parent ring atom that owns the tripod sibling.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<Map<string, {x: number, y: number}>>} Audit-clean tripod-leaf escape candidates.
 */
function buildTerminalTripodLeafEscapeCandidates(layoutGraph, coords, rotatedRingAtomIds, parentAtomId, bondLength) {
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  if (overlaps.length === 0) {
    return [coords];
  }

  const descriptors = [];
  const seenKeys = new Set();
  for (const { firstAtomId, secondAtomId } of overlaps) {
    for (const [leafAtomId, opposingAtomId] of [
      [firstAtomId, secondAtomId],
      [secondAtomId, firstAtomId]
    ]) {
      if (!rotatedRingAtomIds.has(opposingAtomId)) {
        continue;
      }
      const descriptor = terminalTripodLeafEscapeDescriptor(layoutGraph, coords, leafAtomId, parentAtomId);
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.centerAtomId}:${descriptor.leafAtomId}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      descriptors.push(descriptor);
    }
  }
  if (descriptors.length === 0) {
    return [];
  }

  const candidates = [];
  for (const descriptor of descriptors) {
    for (const rotationOffset of TERMINAL_TRIPOD_LEAF_ESCAPE_OFFSETS) {
      const candidateCoords = rotateAtomIdsAroundPivot(
        coords,
        descriptor.movedAtomIds,
        descriptor.centerAtomId,
        rotationOffset
      );
      if (!candidateCoords || !compactTripodLeafFanIsReadable(layoutGraph, candidateCoords, descriptor.centerAtomId)) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (candidateAudit.ok !== true) {
        continue;
      }
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

/**
 * Builds local rotations for terminal parent leaves after a direct-attached
 * child ring root has been straightened into the same exterior pocket.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} parentAtomId - Parent ring atom that owns the terminal leaf.
 * @param {string} attachmentAtomId - Direct-attached child ring root.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<Map<string, {x: number, y: number}>>} Audit-clean terminal-leaf relief candidates.
 */
function buildDirectAttachedParentTerminalLeafReliefCandidates(layoutGraph, coords, parentAtomId, attachmentAtomId, bondLength) {
  if (layoutGraph.atoms.get(parentAtomId)?.chirality) {
    return [];
  }

  const parentPosition = coords.get(parentAtomId);
  if (!parentPosition) {
    return [];
  }

  const candidates = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    if (neighborAtomId === attachmentAtomId || !coords.has(neighborAtomId)) {
      continue;
    }

    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (
      !neighborAtom
      || neighborAtom.element === 'H'
      || neighborAtom.aromatic
      || neighborAtom.heavyDegree !== 1
      || (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
    ) {
      continue;
    }

    const movedAtomIds = new Set(collectCovalentSubtreeAtomIds(layoutGraph, neighborAtomId, parentAtomId));
    const currentAngle = angleOf(sub(coords.get(neighborAtomId), parentPosition));
    for (const rotationOffset of DIRECT_ATTACHED_PARENT_TERMINAL_LEAF_RESCUE_OFFSETS) {
      if (Math.abs(rotationOffset) <= IMPROVEMENT_EPSILON) {
        continue;
      }
      const candidateCoords = rotateAtomIdsAroundPivot(coords, movedAtomIds, parentAtomId, rotationOffset);
      if (!candidateCoords) {
        continue;
      }
      const targetAngle = normalizeSignedAngle(currentAngle + rotationOffset);
      const targetPosition = add(parentPosition, fromAngle(targetAngle, bondLength));
      const candidateLeafPosition = candidateCoords.get(neighborAtomId);
      if (!candidateLeafPosition) {
        continue;
      }
      const delta = sub(targetPosition, candidateLeafPosition);
      for (const movedAtomId of movedAtomIds) {
        const movedPosition = candidateCoords.get(movedAtomId);
        if (movedPosition) {
          candidateCoords.set(movedAtomId, add(movedPosition, delta));
        }
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (candidateAudit.ok !== true) {
        continue;
      }
      candidates.push(candidateCoords);
    }
  }
  return candidates;
}

/**
 * Builds local rotations for terminal leaves on the child ring side after a
 * direct-attached root has been straightened. These leaves can occupy the same
 * exterior pocket the exact root wants, so they get a small bounded fan search
 * before an otherwise good root candidate is rejected for local contact.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} parentAtomId - Fixed parent atom ID.
 * @param {string} attachmentAtomId - Direct-attached child ring root.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<Map<string, {x: number, y: number}>>} Audit-clean terminal-leaf relief candidates.
 */
function buildDirectAttachedChildTerminalLeafReliefCandidates(layoutGraph, coords, parentAtomId, attachmentAtomId, bondLength) {
  const childSideAtomIdSet = new Set(collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId));
  if (childSideAtomIdSet.size === 0) {
    return [];
  }

  const overlapAtomIds = new Set(findSevereOverlaps(layoutGraph, coords, bondLength)
    .flatMap(overlap => [overlap.firstAtomId, overlap.secondAtomId]));
  if (overlapAtomIds.size === 0) {
    return [];
  }

  const candidates = [];
  for (const anchorAtomId of childSideAtomIdSet) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (!anchorAtom || anchorAtom.element === 'H' || anchorAtom.chirality || !coords.has(anchorAtomId)) {
      continue;
    }

    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const leafAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      if (leafAtomId === parentAtomId || !childSideAtomIdSet.has(leafAtomId) || !coords.has(leafAtomId)) {
        continue;
      }
      if (!overlapAtomIds.has(leafAtomId) && !overlapAtomIds.has(anchorAtomId)) {
        continue;
      }

      const leafAtom = layoutGraph.atoms.get(leafAtomId);
      if (
        !leafAtom
        || leafAtom.element === 'H'
        || leafAtom.aromatic
        || leafAtom.chirality
        || leafAtom.heavyDegree !== 1
        || (layoutGraph.atomToRings.get(leafAtomId)?.length ?? 0) > 0
      ) {
        continue;
      }

      const movedAtomIds = new Set(collectCovalentSubtreeAtomIds(layoutGraph, leafAtomId, anchorAtomId));
      if ([...movedAtomIds].some(atomId => layoutGraph.atoms.get(atomId)?.chirality)) {
        continue;
      }
      const currentAngle = angleOf(sub(coords.get(leafAtomId), coords.get(anchorAtomId)));
      for (const rotationOffset of DIRECT_ATTACHED_PARENT_TERMINAL_LEAF_RESCUE_OFFSETS) {
        if (Math.abs(rotationOffset) <= IMPROVEMENT_EPSILON) {
          continue;
        }
        const candidateCoords = rotateAtomIdsAroundPivot(coords, movedAtomIds, anchorAtomId, rotationOffset);
        if (!candidateCoords) {
          continue;
        }
        const targetAngle = normalizeSignedAngle(currentAngle + rotationOffset);
        const targetPosition = add(coords.get(anchorAtomId), fromAngle(targetAngle, bondLength));
        const candidateLeafPosition = candidateCoords.get(leafAtomId);
        if (!candidateLeafPosition) {
          continue;
        }
        const delta = sub(targetPosition, candidateLeafPosition);
        for (const movedAtomId of movedAtomIds) {
          const movedPosition = candidateCoords.get(movedAtomId);
          if (movedPosition) {
            candidateCoords.set(movedAtomId, add(movedPosition, delta));
          }
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
        if (candidateAudit.ok !== true) {
          continue;
        }
        candidates.push(candidateCoords);
      }
    }
  }

  return candidates;
}

/**
 * Measures short local nonbonded contacts around a saturated direct-attached
 * ring junction so exact root candidates do not win by sharing a pocket with a
 * terminal parent leaf or neighboring branch.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {string} parentAtomId - Parent ring atom ID.
 * @param {string} attachmentAtomId - Direct-attached child ring root ID.
 * @returns {number} Squared short-contact penalty.
 */
function measureDirectAttachedRingRootLocalClearancePenalty(layoutGraph, coords, bondLength, parentAtomId, attachmentAtomId) {
  const focusAtomIds = [...expandScoringFocusAtomIds(layoutGraph, [parentAtomId, attachmentAtomId], 3)]
    .filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom && atom.element !== 'H' && coords.has(atomId);
    });
  if (focusAtomIds.length < 2) {
    return 0;
  }

  const bondedPairs = new Set([...layoutGraph.bonds.values()]
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => [bond.a, bond.b].sort().join(':')));
  const clearanceThreshold = bondLength * 0.9;
  let penalty = 0;
  for (let firstIndex = 0; firstIndex < focusAtomIds.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < focusAtomIds.length; secondIndex++) {
      const firstAtomId = focusAtomIds[firstIndex];
      const secondAtomId = focusAtomIds[secondIndex];
      if (bondedPairs.has([firstAtomId, secondAtomId].sort().join(':'))) {
        continue;
      }
      const atomDistance = distance(coords.get(firstAtomId), coords.get(secondAtomId));
      const shortfall = clearanceThreshold - atomDistance;
      if (shortfall > 0) {
        penalty += shortfall ** 2;
      }
    }
  }
  return penalty;
}

/**
 * Measures short contacts between terminal hetero labels attached to ring
 * atoms on one side of an attached-block candidate and heavy atoms on the
 * other side. Mirror-equivalent aryl attachments can otherwise choose a pose
 * where an ortho halogen label sits almost on top of a neighboring ring even
 * though neither ring carbon skeleton has a severe overlap.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Coordinates before the attached block candidate is applied.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {string[]} changedAtomIds - Atom IDs introduced or moved by the candidate.
 * @returns {number} Squared terminal-label clearance penalty.
 */
function measureAttachedBlockTerminalLabelClearancePenalty(
  layoutGraph,
  baseCoords,
  candidateCoords,
  bondLength,
  changedAtomIds
) {
  const changedAtomIdSet = new Set(changedAtomIds);
  const changedHeavyAtomIds = changedAtomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && candidateCoords.has(atomId);
  });
  if (changedHeavyAtomIds.length === 0) {
    return 0;
  }

  const terminalHeteroLeafNeighborId = (leafAtomId) => {
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    if (
      !leafAtom
      || leafAtom.element === 'C'
      || leafAtom.element === 'H'
      || leafAtom.aromatic
      || (layoutGraph.atomToRings.get(leafAtomId)?.length ?? 0) > 0
    ) {
      return null;
    }

    const heavyNeighborIds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? [])
      .filter(bond => bond?.kind === 'covalent')
      .map(bond => (bond.a === leafAtomId ? bond.b : bond.a))
      .filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    return heavyNeighborIds.length === 1 ? heavyNeighborIds[0] : null;
  };

  const collectRingTerminalLabels = (anchorAtomIds) => {
    const labels = [];
    const seenKeys = new Set();
    for (const atomId of anchorAtomIds) {
      if (!candidateCoords.has(atomId) || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) === 0) {
        continue;
      }
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const leafAtomId = bond.a === atomId ? bond.b : bond.a;
        if (terminalHeteroLeafNeighborId(leafAtomId) !== atomId) {
          continue;
        }
        const key = `${atomId}:${leafAtomId}`;
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        const atomPosition = candidateCoords.get(atomId);
        const outwardAngles = incidentRingOutwardAngles(layoutGraph, candidateCoords, atomId);
        const outwardPositions = atomPosition
          ? outwardAngles.map(outwardAngle => add(atomPosition, fromAngle(outwardAngle, bondLength)))
          : [];
        if (outwardPositions.length > 0 && isExactRingOutwardEligibleSubstituent(layoutGraph, atomId, leafAtomId)) {
          labels.push({ atomId: leafAtomId, positions: outwardPositions });
          continue;
        }
        const leafPosition = candidateCoords.get(leafAtomId);
        if (leafPosition) {
          labels.push({ atomId: leafAtomId, positions: [leafPosition] });
          continue;
        }
        if (outwardPositions.length > 0) {
          labels.push({ atomId: leafAtomId, positions: outwardPositions });
        }
      }
    }
    return labels;
  };

  const bondedPairs = new Set([...layoutGraph.bonds.values()]
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => [bond.a, bond.b].sort().join(':')));
  const clearanceThreshold = bondLength * ATTACHED_BLOCK_TERMINAL_LABEL_CLEARANCE_FACTOR;
  const measureLabelPenalty = ({ atomId: labelAtomId, positions }, opposingAtomIds) => {
    let bestLabelPenalty = Number.POSITIVE_INFINITY;
    for (const labelPosition of positions) {
      let positionPenalty = 0;
      for (const opposingAtomId of opposingAtomIds) {
        const opposingAtom = layoutGraph.atoms.get(opposingAtomId);
        const opposingPosition = candidateCoords.get(opposingAtomId);
        if (
          !opposingAtom
          || opposingAtom.element === 'H'
          || opposingAtomId === labelAtomId
          || !opposingPosition
          || bondedPairs.has([labelAtomId, opposingAtomId].sort().join(':'))
        ) {
          continue;
        }
        const shortfall = clearanceThreshold - distance(labelPosition, opposingPosition);
        if (shortfall > 0) {
          positionPenalty += shortfall ** 2;
        }
      }
      bestLabelPenalty = Math.min(bestLabelPenalty, positionPenalty);
    }
    return Number.isFinite(bestLabelPenalty) ? bestLabelPenalty : 0;
  };

  const changedTerminalLabels = collectRingTerminalLabels(changedAtomIds);
  const baseHeavyAtomIds = [...baseCoords.keys()].filter(atomId => (
    !changedAtomIdSet.has(atomId)
    && layoutGraph.atoms.get(atomId)?.element !== 'H'
    && candidateCoords.has(atomId)
  ));
  const baseTerminalLabels = collectRingTerminalLabels(baseHeavyAtomIds);
  let penalty = 0;
  for (const label of changedTerminalLabels) {
    penalty += measureLabelPenalty(label, baseHeavyAtomIds);
  }
  for (const label of baseTerminalLabels) {
    penalty += measureLabelPenalty(label, changedHeavyAtomIds);
  }
  return penalty;
}

/**
 * Measures how far the two exocyclic exits on a saturated direct-attached
 * parent ring atom drift from the ring-derived exterior slots.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} parentAtomId - Parent ring atom ID.
 * @param {string} attachmentAtomId - Direct-attached child ring root ID.
 * @returns {number} Squared exterior-slot deviation.
 */
function measureDirectAttachedRingRootParentExteriorPenalty(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  const parentPosition = coords.get(parentAtomId);
  if (!parentPosition) {
    return 0;
  }

  const parentRings = layoutGraph.atomToRings.get(parentAtomId) ?? [];
  if (parentRings.length === 0) {
    return 0;
  }

  const parentRingAtomIds = new Set(parentRings.flatMap(ring => ring.atomIds));
  const ringNeighborAngles = [];
  const exocyclicNeighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    const neighborAngle = angleOf(sub(coords.get(neighborAtomId), parentPosition));
    if (parentRingAtomIds.has(neighborAtomId)) {
      ringNeighborAngles.push(neighborAngle);
      continue;
    }
    exocyclicNeighborAngles.push({ atomId: neighborAtomId, angle: neighborAngle });
  }
  if (ringNeighborAngles.length !== 2 || !exocyclicNeighborAngles.some(record => record.atomId === attachmentAtomId)) {
    return 0;
  }

  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, parentRings[0]?.atomIds?.length ?? 0);
  if (targetAngles.length !== 2) {
    return 0;
  }

  if (exocyclicNeighborAngles.length === 1) {
    return Math.min(
      ...targetAngles.map(targetAngle => angularDifference(exocyclicNeighborAngles[0].angle, targetAngle) ** 2)
    );
  }
  if (exocyclicNeighborAngles.length !== 2) {
    return 0;
  }

  const alignedDeviation = Math.max(
    angularDifference(exocyclicNeighborAngles[0].angle, targetAngles[0]),
    angularDifference(exocyclicNeighborAngles[1].angle, targetAngles[1])
  );
  const swappedDeviation = Math.max(
    angularDifference(exocyclicNeighborAngles[0].angle, targetAngles[1]),
    angularDifference(exocyclicNeighborAngles[1].angle, targetAngles[0])
  );
  return Math.min(alignedDeviation, swappedDeviation) ** 2;
}

function directAttachedRingRootRefinementScore(layoutGraph, coords, bondLength, parentAtomId, attachmentAtomId) {
  const trigonalDistortion = measureTrigonalDistortion(layoutGraph, coords);
  const scoreLocalSaturatedRootClearance = isDirectAttachedRingRootRefinementCandidate(
    layoutGraph,
    coords,
    parentAtomId,
    attachmentAtomId
  );
  const scoreParentExterior = scoreLocalSaturatedRootClearance || isDirectAttachedParentExteriorRefinementCandidate(
    layoutGraph,
    coords,
    parentAtomId,
    attachmentAtomId
  );
  return {
    coords,
    audit: auditLayout(layoutGraph, coords, { bondLength }),
    rootDeviation: directAttachedRingRootOutwardDeviation(layoutGraph, coords, parentAtomId, attachmentAtomId),
    exactRingExitPenalty: measureMixedRootExactRingExitPenalty(layoutGraph, coords, new Set([parentAtomId, attachmentAtomId])).totalDeviation,
    localClearancePenalty: (scoreLocalSaturatedRootClearance || scoreParentExterior)
      ? measureDirectAttachedRingRootLocalClearancePenalty(layoutGraph, coords, bondLength, parentAtomId, attachmentAtomId)
      : 0,
    parentExteriorPenalty: scoreParentExterior
      ? measureDirectAttachedRingRootParentExteriorPenalty(layoutGraph, coords, parentAtomId, attachmentAtomId)
      : 0,
    junctionCrowdingPenalty: scoreParentExterior
      ? measureDirectAttachmentJunctionCrowdingPenalty(layoutGraph, coords, { parentAtomId, attachmentAtomId })
      : 0,
    trigonalMaxDeviation: trigonalDistortion.maxDeviation,
    trigonalTotalDeviation: trigonalDistortion.totalDeviation,
    layoutCost: measureFocusedPlacementCost(layoutGraph, coords, bondLength, [parentAtomId, attachmentAtomId])
  };
}

function compareDirectAttachedRingRootRefinementScores(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  if (candidate.audit.ok !== incumbent.audit.ok) {
    return candidate.audit.ok === true ? -1 : 1;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount - incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount - incumbent.audit.bondLengthFailureCount;
  }
  const candidateSolvesParentExterior =
    candidate.parentExteriorPenalty <= IMPROVEMENT_EPSILON &&
    candidate.rootDeviation <= DIRECT_ATTACHED_RING_ROOT_REFINEMENT_TRIGGER + IMPROVEMENT_EPSILON;
  const incumbentSolvesParentExterior =
    incumbent.parentExteriorPenalty <= IMPROVEMENT_EPSILON &&
    incumbent.rootDeviation <= DIRECT_ATTACHED_RING_ROOT_REFINEMENT_TRIGGER + IMPROVEMENT_EPSILON;
  if (candidateSolvesParentExterior !== incumbentSolvesParentExterior) {
    return candidateSolvesParentExterior ? -1 : 1;
  }
  if (Math.abs(candidate.rootDeviation - incumbent.rootDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.rootDeviation - incumbent.rootDeviation;
  }
  if (Math.abs(candidate.exactRingExitPenalty - incumbent.exactRingExitPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.exactRingExitPenalty - incumbent.exactRingExitPenalty;
  }
  const candidateLocalPresentationPenalty = candidate.parentExteriorPenalty + candidate.localClearancePenalty;
  const incumbentLocalPresentationPenalty = incumbent.parentExteriorPenalty + incumbent.localClearancePenalty;
  if (Math.abs(candidateLocalPresentationPenalty - incumbentLocalPresentationPenalty) > IMPROVEMENT_EPSILON) {
    return candidateLocalPresentationPenalty - incumbentLocalPresentationPenalty;
  }
  if (Math.abs(candidate.parentExteriorPenalty - incumbent.parentExteriorPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.parentExteriorPenalty - incumbent.parentExteriorPenalty;
  }
  if (Math.abs(candidate.localClearancePenalty - incumbent.localClearancePenalty) > IMPROVEMENT_EPSILON) {
    return candidate.localClearancePenalty - incumbent.localClearancePenalty;
  }
  if (Math.abs(candidate.junctionCrowdingPenalty - incumbent.junctionCrowdingPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.junctionCrowdingPenalty - incumbent.junctionCrowdingPenalty;
  }
  if (Math.abs(candidate.trigonalMaxDeviation - incumbent.trigonalMaxDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.trigonalMaxDeviation - incumbent.trigonalMaxDeviation;
  }
  if (Math.abs(candidate.trigonalTotalDeviation - incumbent.trigonalTotalDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.trigonalTotalDeviation - incumbent.trigonalTotalDeviation;
  }
  return candidate.layoutCost - incumbent.layoutCost;
}

/**
 * Counts heavy atoms in a candidate atom-id set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Atom IDs to inspect.
 * @returns {number} Number of non-hydrogen atoms.
 */
function heavyAtomCountInIds(layoutGraph, atomIds) {
  return atomIds.reduce((count, atomId) => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' ? count + 1 : count;
  }, 0);
}

/**
 * Returns whether a direct-attached saturated child ring root should use the
 * stricter root-straightening refinement path.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} parentAtomId - Parent ring atom ID.
 * @param {string} attachmentAtomId - Candidate child ring root ID.
 * @returns {boolean} True when the child side is a bounded saturated direct-attached ring candidate.
 */
function isDirectAttachedRingRootRefinementCandidate(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  if (!coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return false;
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  const attachmentAtom = layoutGraph.atoms.get(attachmentAtomId);
  if (
    !parentAtom
    || !attachmentAtom
    || parentAtom.element === 'H'
    || attachmentAtom.element === 'H'
    || parentAtom.aromatic
    || attachmentAtom.aromatic
    || (parentAtom.heavyDegree ?? 0) < 4
    || (attachmentAtom.heavyDegree ?? 0) > 3
  ) {
    return false;
  }

  const parentRings = layoutGraph.atomToRings.get(parentAtomId) ?? [];
  const attachmentRings = layoutGraph.atomToRings.get(attachmentAtomId) ?? [];
  if (
    parentRings.length === 0
    || attachmentRings.length === 0
    || directAttachmentLocalOutwardAngles(layoutGraph, coords, attachmentAtomId, parentAtomId).length === 0
  ) {
    return false;
  }
  if (layoutGraph.atomToRingSystemId.get(parentAtomId) === layoutGraph.atomToRingSystemId.get(attachmentAtomId)) {
    return false;
  }

  const parentIncidentRingAtomIds = new Set(parentRings.flatMap(ring => ring.atomIds));
  const parentExocyclicHeavyNeighborIds = (layoutGraph.bondsByAtomId.get(parentAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === parentAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return neighborAtom && neighborAtom.element !== 'H' && !parentIncidentRingAtomIds.has(neighborAtomId);
    });
  if (parentExocyclicHeavyNeighborIds.length < 2 || !parentExocyclicHeavyNeighborIds.includes(attachmentAtomId)) {
    return false;
  }

  const attachmentSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId);
  const parentSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, parentAtomId, attachmentAtomId);
  return heavyAtomCountInIds(layoutGraph, attachmentSideAtomIds) <= heavyAtomCountInIds(layoutGraph, parentSideAtomIds);
}

/**
 * Returns whether an exocyclic sibling is a compact terminal hetero tripod
 * such as a CF3/CCl3 group that can make an exact parent exterior slot clash
 * with an attached aryl ring.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Candidate tripod center atom ID.
 * @param {string} parentAtomId - Saturated ring parent atom ID.
 * @returns {boolean} True when the center owns three terminal hetero leaves.
 */
function isCompactTerminalHeteroTripodCenter(layoutGraph, centerAtomId, parentAtomId) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (
    !centerAtom
    || centerAtom.element !== 'C'
    || centerAtom.aromatic
    || centerAtom.heavyDegree !== 4
    || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  const parentBond = findLayoutBond(layoutGraph, centerAtomId, parentAtomId);
  if (!parentBond || parentBond.kind !== 'covalent' || parentBond.aromatic || (parentBond.order ?? 1) !== 1) {
    return false;
  }

  const leafAtomIds = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === centerAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => neighborAtomId !== parentAtomId);
  return leafAtomIds.length === 3 && leafAtomIds.every(leafAtomId => {
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    const leafBond = findLayoutBond(layoutGraph, centerAtomId, leafAtomId);
    return Boolean(
      leafAtom
      && leafAtom.element !== 'C'
      && leafAtom.element !== 'H'
      && leafAtom.heavyDegree === 1
      && (layoutGraph.atomToRings.get(leafAtomId)?.length ?? 0) === 0
      && leafBond
      && leafBond.kind === 'covalent'
      && !leafBond.aromatic
      && (leafBond.order ?? 1) === 1
    );
  });
}

/**
 * Returns whether a neighbor is a direct-attached ring root on the exterior of
 * a saturated parent ring atom. This sibling rule is limited to aromatic roots:
 * saturated single-ring siblings such as cyclopropyl can legitimately favor
 * broader presentation goals like monosubstituted benzene orientation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} parentAtomId - Saturated ring parent atom ID.
 * @param {string} neighborAtomId - Candidate direct-attached ring root ID.
 * @returns {boolean} True when the neighbor starts a separate attached ring system.
 */
function isDirectAttachedExteriorRingRoot(layoutGraph, parentAtomId, neighborAtomId) {
  const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
  if (
    !neighborAtom
    || neighborAtom.element === 'H'
    || neighborAtom.aromatic !== true
    || (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) === 0
    || layoutGraph.atomToRingSystemId.get(parentAtomId) === layoutGraph.atomToRingSystemId.get(neighborAtomId)
  ) {
    return false;
  }

  const bond = findLayoutBond(layoutGraph, parentAtomId, neighborAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.inRing
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

/**
 * Returns whether a direct-attached child ring can be swept around a saturated
 * parent ring atom to recover the parent's exact exterior-gap branch slots.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} parentAtomId - Parent saturated ring atom ID.
 * @param {string} attachmentAtomId - Candidate child ring root ID.
 * @returns {boolean} True when the child ring subtree may be swept around the parent exterior gap.
 */
function isDirectAttachedParentExteriorRefinementCandidate(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  if (!coords.has(parentAtomId) || !coords.has(attachmentAtomId)) {
    return false;
  }

  const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, parentAtomId);
  if (!descriptor || !descriptor.exocyclicNeighborIds.includes(attachmentAtomId)) {
    return false;
  }
  const hasCompactTripodSibling = descriptor.exocyclicNeighborIds.some(neighborAtomId =>
    neighborAtomId !== attachmentAtomId &&
    isCompactTerminalHeteroTripodCenter(layoutGraph, neighborAtomId, parentAtomId)
  );
  const hasDirectAttachedRingSibling = descriptor.exocyclicNeighborIds.some(neighborAtomId =>
    neighborAtomId !== attachmentAtomId &&
    isDirectAttachedExteriorRingRoot(layoutGraph, parentAtomId, neighborAtomId)
  );
  if (!hasCompactTripodSibling && !hasDirectAttachedRingSibling) {
    return false;
  }

  const attachmentAtom = layoutGraph.atoms.get(attachmentAtomId);
  if (
    !attachmentAtom
    || attachmentAtom.element === 'H'
    || (layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0
    || directAttachmentLocalOutwardAngles(layoutGraph, coords, attachmentAtomId, parentAtomId).length === 0
  ) {
    return false;
  }
  if (layoutGraph.atomToRingSystemId.get(parentAtomId) === layoutGraph.atomToRingSystemId.get(attachmentAtomId)) {
    return false;
  }

  const attachmentBond = findLayoutBond(layoutGraph, parentAtomId, attachmentAtomId);
  if (
    !attachmentBond
    || attachmentBond.kind !== 'covalent'
    || attachmentBond.inRing
    || attachmentBond.aromatic
    || (attachmentBond.order ?? 1) !== 1
  ) {
    return false;
  }

  const attachmentSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId);
  const parentSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, parentAtomId, attachmentAtomId);
  return heavyAtomCountInIds(layoutGraph, attachmentSideAtomIds) <= heavyAtomCountInIds(layoutGraph, parentSideAtomIds);
}

/**
 * Straightens direct-attached ring roots and exact parent exterior slots when
 * a compact terminal leaf or tripod can absorb the local clash.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether any root was improved.
 */
function refineDirectAttachedRingRootsWithTerminalLeafClearance(layoutGraph, coords, bondLength) {
  let changed = false;
  const directAttachmentDescriptors = [];

  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    for (const [parentAtomId, attachmentAtomId] of [
      [bond.a, bond.b],
      [bond.b, bond.a]
    ]) {
      if (
        !coords.has(parentAtomId)
        || !coords.has(attachmentAtomId)
        || (
          exactDirectAttachmentParentRingOutwardAngles(layoutGraph, coords, { parentAtomId, attachmentAtomId }).length === 0
          && !(
            (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
            && supportsExactDirectAttachmentChildRingRootOutward(layoutGraph, parentAtomId, attachmentAtomId)
          )
          && !isDirectAttachedRingRootRefinementCandidate(layoutGraph, coords, parentAtomId, attachmentAtomId)
          && !isDirectAttachedParentExteriorRefinementCandidate(layoutGraph, coords, parentAtomId, attachmentAtomId)
        )
      ) {
        continue;
      }
      directAttachmentDescriptors.push({ parentAtomId, attachmentAtomId });
    }
  }

  directAttachmentDescriptors.sort((firstDescriptor, secondDescriptor) => (
    compareCanonicalIds(firstDescriptor.parentAtomId, secondDescriptor.parentAtomId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstDescriptor.attachmentAtomId, secondDescriptor.attachmentAtomId, layoutGraph.canonicalAtomRank)
  ));

  for (const { parentAtomId, attachmentAtomId } of directAttachmentDescriptors) {
    const baseScore = directAttachedRingRootRefinementScore(layoutGraph, coords, bondLength, parentAtomId, attachmentAtomId);
    const rotatedRingAtomIds = new Set(collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId));
    if (
      baseScore.audit.ok !== true
      && baseScore.audit.severeOverlapCount > 0
      && baseScore.rootDeviation <= IMPROVEMENT_EPSILON
      && baseScore.exactRingExitPenalty <= IMPROVEMENT_EPSILON
    ) {
      let bestLeafEscapeScore = baseScore;
      for (const candidateCoords of buildTerminalCarbonylLeafEscapeCandidates(layoutGraph, coords, rotatedRingAtomIds, bondLength)) {
        const candidateScore = directAttachedRingRootRefinementScore(layoutGraph, candidateCoords, bondLength, parentAtomId, attachmentAtomId);
        if (
          candidateScore.audit.ok !== true
          || candidateScore.rootDeviation > IMPROVEMENT_EPSILON
          || candidateScore.exactRingExitPenalty > IMPROVEMENT_EPSILON
          || candidateScore.trigonalMaxDeviation > TERMINAL_CARBONYL_LEAF_ESCAPE_MAX_TRIGONAL_DEVIATION + IMPROVEMENT_EPSILON
        ) {
          continue;
        }
        if (compareDirectAttachedRingRootRefinementScores(candidateScore, bestLeafEscapeScore) < 0) {
          bestLeafEscapeScore = candidateScore;
        }
      }
      if (bestLeafEscapeScore !== baseScore) {
        overwriteCoordMap(coords, bestLeafEscapeScore.coords);
        changed = true;
      }
      continue;
    }
    const supportsRingParentChildRootRefinement =
      (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
      && supportsExactDirectAttachmentChildRingRootOutward(layoutGraph, parentAtomId, attachmentAtomId);
    const rootRefinementTrigger = supportsRingParentChildRootRefinement
      ? Math.PI / 18
      : (
          isDirectAttachedParentExteriorRefinementCandidate(layoutGraph, coords, parentAtomId, attachmentAtomId)
            ? DIRECT_ATTACHED_PARENT_EXTERIOR_ROOT_REFINEMENT_TRIGGER
            : DIRECT_ATTACHED_RING_ROOT_REFINEMENT_TRIGGER
        );
    const shouldRefineRootDeviation = baseScore.rootDeviation >= rootRefinementTrigger;
    const shouldRefineParentExterior =
      baseScore.parentExteriorPenalty > DIRECT_ATTACHED_RING_ROOT_REFINEMENT_TRIGGER ** 2;
    const shouldRefineParentRingOutward =
      exactDirectAttachmentParentRingOutwardAngles(layoutGraph, coords, { parentAtomId, attachmentAtomId }).length > 0
      && baseScore.exactRingExitPenalty > DIRECT_ATTACHED_RING_ROOT_REFINEMENT_TRIGGER;
    if (
      baseScore.audit.ok !== true
      || (!shouldRefineRootDeviation && !shouldRefineParentExterior && !shouldRefineParentRingOutward)
    ) {
      continue;
    }

    const rootRotationCandidates = [];
    const correction = shouldRefineRootDeviation
      ? directAttachedRingRootOutwardCorrection(layoutGraph, coords, parentAtomId, attachmentAtomId)
      : null;
    if (correction != null && Math.abs(correction) > IMPROVEMENT_EPSILON) {
      for (const rootRotation of [correction, correction * 0.875, correction * 0.75, correction * 0.5]) {
        if (!rootRotationCandidates.some(existingRotation => angularDifference(existingRotation, rootRotation) <= 1e-9)) {
          rootRotationCandidates.push(rootRotation);
        }
      }
    }
    if (shouldRefineParentExterior) {
      rootRotationCandidates.push(0);
    }
    if (shouldRefineParentRingOutward) {
      rootRotationCandidates.push(0);
    }
    if (rootRotationCandidates.length === 0) {
      continue;
    }

    let bestScore = baseScore;
    for (const rootRotation of rootRotationCandidates) {
      const rotatedRootCoords = rotateAtomIdsAroundPivot(coords, rotatedRingAtomIds, attachmentAtomId, rootRotation);
      if (!rotatedRootCoords) {
        continue;
      }

      const rootPoseCoords = [
        rotatedRootCoords,
        ...buildDirectAttachedChildRootMirrorCandidates(layoutGraph, rotatedRootCoords, parentAtomId, attachmentAtomId)
      ];

      for (const rootPoseCoordSet of rootPoseCoords) {
        const parentSweepOffsets = [...DIRECT_ATTACHED_RING_ROOT_PARENT_SWEEP_OFFSETS];
          const parentPosition = rootPoseCoordSet.get(parentAtomId);
          const attachmentPosition = rootPoseCoordSet.get(attachmentAtomId);
          if (parentPosition && attachmentPosition) {
            const currentAttachmentAngle = angleOf(sub(attachmentPosition, parentPosition));
            const exactParentRingOutwardAngles = exactDirectAttachmentParentRingOutwardAngles(layoutGraph, rootPoseCoordSet, { parentAtomId, attachmentAtomId });
            for (const exactParentRingOutwardAngle of exactParentRingOutwardAngles) {
              const exactSweepOffset = normalizeSignedAngle(exactParentRingOutwardAngle - currentAttachmentAngle);
              if (!parentSweepOffsets.some(existingOffset => angularDifference(existingOffset, exactSweepOffset) <= 1e-9)) {
                parentSweepOffsets.push(exactSweepOffset);
              }
            }
            for (const exactParentExteriorAngle of exactDirectAttachmentParentExteriorAngles(layoutGraph, rootPoseCoordSet, { parentAtomId, attachmentAtomId })) {
              const exactSweepOffset = normalizeSignedAngle(exactParentExteriorAngle - currentAttachmentAngle);
              if (!parentSweepOffsets.some(existingOffset => angularDifference(existingOffset, exactSweepOffset) <= 1e-9)) {
              parentSweepOffsets.push(exactSweepOffset);
            }
          }
        }

        for (const parentSweepOffset of parentSweepOffsets) {
          const sweptRootCoords = Math.abs(parentSweepOffset) <= IMPROVEMENT_EPSILON
            ? rootPoseCoordSet
            : rotateAtomIdsAroundPivot(rootPoseCoordSet, rotatedRingAtomIds, parentAtomId, parentSweepOffset);
          if (!sweptRootCoords) {
            continue;
          }

          const rootAudit = auditLayout(layoutGraph, sweptRootCoords, { bondLength });
          const candidateCoordSets = rootAudit.ok === true
            ? [sweptRootCoords]
            : [
                sweptRootCoords,
                ...buildTerminalCarbonylLeafEscapeCandidates(layoutGraph, sweptRootCoords, rotatedRingAtomIds, bondLength),
                ...buildTerminalTripodLeafEscapeCandidates(layoutGraph, sweptRootCoords, rotatedRingAtomIds, parentAtomId, bondLength),
                ...buildDirectAttachedChildTerminalLeafReliefCandidates(layoutGraph, sweptRootCoords, parentAtomId, attachmentAtomId, bondLength)
              ];
          for (const candidateCoords of candidateCoordSets) {
            const localRootRotationCandidates = shouldRefineParentExterior
              ? buildDirectAttachmentLocalRootRotationRefinementCandidates(
                  layoutGraph,
                  candidateCoords,
                  { parentAtomId, attachmentAtomId }
                ).map(candidate => candidate.transformedCoords)
              : [];
            const localCandidateCoords = [candidateCoords, ...localRootRotationCandidates];
            for (const localCandidateCoordSet of localCandidateCoords) {
              for (const resolvedCandidateCoords of [
                localCandidateCoordSet,
                ...buildDirectAttachedParentTerminalLeafReliefCandidates(
                  layoutGraph,
                  localCandidateCoordSet,
                  parentAtomId,
                  attachmentAtomId,
                  bondLength
                )
              ]) {
                const candidateScore = directAttachedRingRootRefinementScore(layoutGraph, resolvedCandidateCoords, bondLength, parentAtomId, attachmentAtomId);
                const improvesRootDeviation =
                  shouldRefineRootDeviation &&
                  candidateScore.rootDeviation <= baseScore.rootDeviation - DIRECT_ATTACHED_RING_ROOT_REFINEMENT_MIN_IMPROVEMENT;
                const improvesParentExterior =
                  shouldRefineParentExterior &&
                  candidateScore.rootDeviation <= DIRECT_ATTACHED_RING_ROOT_REFINEMENT_TRIGGER + IMPROVEMENT_EPSILON &&
                  candidateScore.parentExteriorPenalty < baseScore.parentExteriorPenalty - IMPROVEMENT_EPSILON;
                const improvesParentRingOutward =
                  shouldRefineParentRingOutward &&
                  candidateScore.exactRingExitPenalty < baseScore.exactRingExitPenalty - DIRECT_ATTACHED_RING_ROOT_REFINEMENT_MIN_IMPROVEMENT;
                const exactRingExitLimit = improvesParentExterior
                  ? Math.max(baseScore.exactRingExitPenalty, DIRECT_ATTACHED_RING_ROOT_REFINEMENT_TRIGGER)
                  : baseScore.exactRingExitPenalty;
                if (
                  candidateScore.audit.ok !== true
                  || candidateScore.exactRingExitPenalty > exactRingExitLimit + IMPROVEMENT_EPSILON
                  || candidateScore.trigonalMaxDeviation > TERMINAL_CARBONYL_LEAF_ESCAPE_MAX_TRIGONAL_DEVIATION + IMPROVEMENT_EPSILON
                  || (!improvesRootDeviation && !improvesParentExterior && !improvesParentRingOutward)
                ) {
                  continue;
                }
                if (compareDirectAttachedRingRootRefinementScores(candidateScore, bestScore) < 0) {
                  bestScore = candidateScore;
                }
              }
            }
          }
        }
      }
    }

    if (bestScore !== baseScore) {
      overwriteCoordMap(coords, bestScore.coords);
      changed = true;
    }
  }

  return { changed };
}

function fusedCyclopropaneCapTargetPositions(coords, sharedAtomIds, bondLength) {
  const firstSharedPosition = coords.get(sharedAtomIds[0]);
  const secondSharedPosition = coords.get(sharedAtomIds[1]);
  if (!firstSharedPosition || !secondSharedPosition) {
    return [];
  }

  const span = distance(firstSharedPosition, secondSharedPosition);
  if (span <= 1e-9 || span > bondLength * 2 + 1e-6) {
    return [];
  }

  const midpoint = {
    x: (firstSharedPosition.x + secondSharedPosition.x) / 2,
    y: (firstSharedPosition.y + secondSharedPosition.y) / 2
  };
  const unit = {
    x: (secondSharedPosition.x - firstSharedPosition.x) / span,
    y: (secondSharedPosition.y - firstSharedPosition.y) / span
  };
  const perpendicular = { x: -unit.y, y: unit.x };
  const height = Math.sqrt(Math.max(0, bondLength * bondLength - (span / 2) * (span / 2)));
  if (height <= 1e-9) {
    return [];
  }

  return [-1, 1].map(sign => ({
    x: midpoint.x + perpendicular.x * height * sign,
    y: midpoint.y + perpendicular.y * height * sign
  }));
}

function collectFusedCyclopropaneCapMoveAtomIds(layoutGraph, cyclopropaneRing, capAtomId, sharedAtomIds) {
  const sharedAtomIdSet = new Set(sharedAtomIds);
  const cyclopropaneAtomIdSet = new Set(cyclopropaneRing.atomIds);
  const movedAtomIds = new Set([capAtomId]);

  for (const bond of layoutGraph.bondsByAtomId.get(capAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === capAtomId ? bond.b : bond.a;
    if (sharedAtomIdSet.has(neighborAtomId) || cyclopropaneAtomIdSet.has(neighborAtomId)) {
      continue;
    }
    for (const atomId of collectCovalentSubtreeAtomIds(layoutGraph, neighborAtomId, capAtomId)) {
      movedAtomIds.add(atomId);
    }
  }

  return movedAtomIds;
}

function fusedCyclopropaneCapSideDeviation(coords, capAtomId, sharedAtomIds, bondLength) {
  const capPosition = coords.get(capAtomId);
  if (!capPosition) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(...sharedAtomIds.map(sharedAtomId => {
    const sharedPosition = coords.get(sharedAtomId);
    return sharedPosition
      ? Math.abs(distance(capPosition, sharedPosition) - bondLength)
      : Number.POSITIVE_INFINITY;
  }));
}

function scoreFusedCyclopropaneCapCandidate(layoutGraph, coords, bondLength, parentRing, capAtomId, sharedAtomIds, audit) {
  const parentPolygon = parentRing.atomIds.map(atomId => coords.get(atomId));
  const capPosition = coords.get(capAtomId);
  const parentCentroid = parentPolygon.every(Boolean)
    ? centroid(parentPolygon)
    : null;
  return {
    coords,
    audit,
    insideParent: capPosition && parentPolygon.every(Boolean)
      ? pointInPolygon(capPosition, parentPolygon)
      : true,
    sideDeviation: fusedCyclopropaneCapSideDeviation(coords, capAtomId, sharedAtomIds, bondLength),
    parentCentroidDistance: capPosition && parentCentroid
      ? distance(capPosition, parentCentroid)
      : 0
  };
}

function fusedCyclopropaneCapAuditDoesNotRegress(candidateAudit, incumbentAudit) {
  if (incumbentAudit.ok === true && candidateAudit.ok !== true) {
    return false;
  }
  return (
    candidateAudit.severeOverlapCount <= incumbentAudit.severeOverlapCount
    && candidateAudit.bondLengthFailureCount <= incumbentAudit.bondLengthFailureCount
    && candidateAudit.collapsedMacrocycleCount <= incumbentAudit.collapsedMacrocycleCount
    && candidateAudit.ringSubstituentReadabilityFailureCount <= incumbentAudit.ringSubstituentReadabilityFailureCount
    && candidateAudit.inwardRingSubstituentCount <= incumbentAudit.inwardRingSubstituentCount
    && candidateAudit.outwardAxisRingSubstituentFailureCount <= incumbentAudit.outwardAxisRingSubstituentFailureCount
  );
}

function compareFusedCyclopropaneCapCandidates(candidate, incumbent) {
  if (candidate.insideParent !== incumbent.insideParent) {
    return candidate.insideParent ? 1 : -1;
  }
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount - incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount - incumbent.audit.bondLengthFailureCount;
  }
  if (Math.abs(candidate.audit.severeOverlapPenalty - incumbent.audit.severeOverlapPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.audit.severeOverlapPenalty - incumbent.audit.severeOverlapPenalty;
  }
  if (Math.abs(candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation;
  }
  if (Math.abs(candidate.sideDeviation - incumbent.sideDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.sideDeviation - incumbent.sideDeviation;
  }
  if (Math.abs(candidate.parentCentroidDistance - incumbent.parentCentroidDistance) > IMPROVEMENT_EPSILON) {
    return incumbent.parentCentroidDistance - candidate.parentCentroidDistance;
  }
  return 0;
}

/**
 * Rebuilds fused cyclopropane caps on the exterior side of their shared parent
 * edge. Compact bridged/fused systems can align the cap inside the parent face
 * and collapse one cyclopropane bond; holding the shared edge fixed and placing
 * the cap at the target side length restores the small ring without moving the
 * larger scaffold.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether any cap was restored.
 */
function restoreFusedCyclopropaneExteriorCaps(layoutGraph, coords, bondLength) {
  const ringById = new Map((layoutGraph.rings ?? []).map(ring => [ring.id, ring]));
  const descriptors = [];

  for (const connection of layoutGraph.ringConnections ?? []) {
    if (!connection || connection.kind !== 'fused' || (connection.sharedAtomIds?.length ?? 0) !== 2) {
      continue;
    }
    const firstRing = ringById.get(connection.firstRingId);
    const secondRing = ringById.get(connection.secondRingId);
    if (!firstRing || !secondRing) {
      continue;
    }
    const cyclopropaneRing = firstRing.atomIds.length === 3
      ? firstRing
      : secondRing.atomIds.length === 3
        ? secondRing
        : null;
    const parentRing = cyclopropaneRing === firstRing ? secondRing : firstRing;
    if (!cyclopropaneRing || parentRing.atomIds.length < 4) {
      continue;
    }
    const capAtomId = cyclopropaneRing.atomIds.find(atomId => !connection.sharedAtomIds.includes(atomId));
    if (
      !capAtomId
      || (layoutGraph.atomToRings.get(capAtomId)?.length ?? 0) !== 1
      || !coords.has(capAtomId)
      || !connection.sharedAtomIds.every(atomId => coords.has(atomId))
      || !parentRing.atomIds.every(atomId => coords.has(atomId))
    ) {
      continue;
    }
    descriptors.push({
      parentRing,
      cyclopropaneRing,
      capAtomId,
      sharedAtomIds: [...connection.sharedAtomIds]
    });
  }

  descriptors.sort((firstDescriptor, secondDescriptor) => (
    compareCanonicalIds(firstDescriptor.capAtomId, secondDescriptor.capAtomId, layoutGraph.canonicalAtomRank)
  ));

  let changed = false;
  let baseAudit = auditLayout(layoutGraph, coords, { bondLength });
  for (const descriptor of descriptors) {
    const incumbent = scoreFusedCyclopropaneCapCandidate(
      layoutGraph,
      coords,
      bondLength,
      descriptor.parentRing,
      descriptor.capAtomId,
      descriptor.sharedAtomIds,
      baseAudit
    );
    const targetPositions = fusedCyclopropaneCapTargetPositions(coords, descriptor.sharedAtomIds, bondLength);
    if (targetPositions.length === 0) {
      continue;
    }

    const movedAtomIds = collectFusedCyclopropaneCapMoveAtomIds(
      layoutGraph,
      descriptor.cyclopropaneRing,
      descriptor.capAtomId,
      descriptor.sharedAtomIds
    );
    let bestCandidate = incumbent;
    for (const targetPosition of targetPositions) {
      const capPosition = coords.get(descriptor.capAtomId);
      if (!capPosition) {
        continue;
      }
      const delta = sub(targetPosition, capPosition);
      const candidateCoords = new Map(coords);
      for (const atomId of movedAtomIds) {
        const position = coords.get(atomId);
        if (!position) {
          continue;
        }
        candidateCoords.set(atomId, add(position, delta));
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (!fusedCyclopropaneCapAuditDoesNotRegress(candidateAudit, baseAudit)) {
        continue;
      }
      const candidate = scoreFusedCyclopropaneCapCandidate(
        layoutGraph,
        candidateCoords,
        bondLength,
        descriptor.parentRing,
        descriptor.capAtomId,
        descriptor.sharedAtomIds,
        candidateAudit
      );
      if (compareFusedCyclopropaneCapCandidates(candidate, bestCandidate) < 0) {
        bestCandidate = candidate;
      }
    }

    if (bestCandidate !== incumbent) {
      overwriteCoordMap(coords, bestCandidate.coords);
      baseAudit = bestCandidate.audit;
      changed = true;
    }
  }

  return { changed };
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
 * Moves the subtree rooted at an exocyclic neighbor onto a requested angle from
 * a small-ring anchor while preserving that subtree's internal coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Small-ring anchor atom ID.
 * @param {string} rootAtomId - Exocyclic subtree root atom ID.
 * @param {number} targetAngle - Desired root angle from the anchor.
 * @param {number} bondLength - Target bond length.
 * @returns {Map<string, {x: number, y: number}>|null} Candidate coordinates.
 */
function translateExocyclicSubtreeToSmallRingExteriorAngle(layoutGraph, coords, anchorAtomId, rootAtomId, targetAngle, bondLength) {
  const anchorPosition = coords.get(anchorAtomId);
  const rootPosition = coords.get(rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return null;
  }

  const targetPosition = add(anchorPosition, fromAngle(targetAngle, bondLength));
  const delta = sub(targetPosition, rootPosition);
  const nextCoords = new Map(coords);
  for (const atomId of collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, anchorAtomId)) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, add(position, delta));
  }
  return nextCoords;
}

/**
 * Returns the downstream heavy child for a non-ring two-heavy linker root.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Parent anchor atom ID.
 * @param {string} linkerAtomId - Candidate linker root atom ID.
 * @returns {string|null} Downstream heavy child atom ID, or null.
 */
function exocyclicTwoHeavyLinkerChildAtomId(layoutGraph, coords, anchorAtomId, linkerAtomId) {
  const linkerAtom = layoutGraph.atoms.get(linkerAtomId);
  if (
    !linkerAtom
    || linkerAtom.element === 'H'
    || linkerAtom.aromatic
    || linkerAtom.chirality
    || linkerAtom.heavyDegree !== 2
    || (layoutGraph.atomToRings.get(linkerAtomId)?.length ?? 0) !== 0
    || !coords.has(linkerAtomId)
  ) {
    return null;
  }

  const childAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(linkerAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
      return null;
    }
    const neighborAtomId = bond.a === linkerAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (!coords.has(neighborAtomId)) {
      return null;
    }
    if (neighborAtomId !== anchorAtomId) {
      childAtomIds.push(neighborAtomId);
    }
  }
  return childAtomIds.length === 1 ? childAtomIds[0] : null;
}

/**
 * Penalizes a two-heavy linker root whose heavy-neighbor bend misses the
 * standard 120-degree zigzag angle.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Parent anchor atom ID.
 * @param {string} linkerAtomId - Candidate linker root atom ID.
 * @returns {number} Squared angular deviation from the standard linker bend.
 */
function twoHeavyLinkerBendPenalty(layoutGraph, coords, anchorAtomId, linkerAtomId) {
  const childAtomId = exocyclicTwoHeavyLinkerChildAtomId(layoutGraph, coords, anchorAtomId, linkerAtomId);
  if (!childAtomId) {
    return 0;
  }

  const linkerPosition = coords.get(linkerAtomId);
  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  if (!linkerPosition || !anchorPosition || !childPosition) {
    return 0;
  }

  const bendAngle = angularDifference(
    angleOf(sub(anchorPosition, linkerPosition)),
    angleOf(sub(childPosition, linkerPosition))
  );
  return (bendAngle - LINKER_ZIGZAG_TURN_ANGLE * 2) ** 2;
}

/**
 * Measures two-heavy linker bend quality for exocyclic branches on one
 * saturated-ring exterior fan anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Small-ring anchor atom ID.
 * @returns {number} Total local linker bend penalty.
 */
function smallRingExteriorLinkedBranchBendPenalty(layoutGraph, coords, anchorAtomId) {
  const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, anchorAtomId);
  if (!descriptor) {
    return 0;
  }
  return descriptor.exocyclicNeighborIds.reduce(
    (sum, neighborAtomId) => sum + twoHeavyLinkerBendPenalty(layoutGraph, coords, anchorAtomId, neighborAtomId),
    0
  );
}

/**
 * Rotates the far side of a two-heavy linker root so the local linker bend
 * stays on the normal 120-degree zigzag after the root has been moved into a
 * saturated-ring exterior slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} anchorAtomId - Small-ring anchor atom ID.
 * @param {string} linkerAtomId - Exocyclic linker root atom ID.
 * @returns {Map<string, {x: number, y: number}>|null} Bend-preserving candidate coordinates.
 */
function preserveTwoHeavyLinkerBendAfterRootMove(layoutGraph, coords, anchorAtomId, linkerAtomId) {
  const childAtomId = exocyclicTwoHeavyLinkerChildAtomId(layoutGraph, coords, anchorAtomId, linkerAtomId);
  if (!childAtomId) {
    return null;
  }

  const linkerPosition = coords.get(linkerAtomId);
  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  if (!linkerPosition || !anchorPosition || !childPosition) {
    return null;
  }

  const anchorAngle = angleOf(sub(anchorPosition, linkerPosition));
  const childAngle = angleOf(sub(childPosition, linkerPosition));
  const targetChildAngle = [
    normalizeSignedAngle(anchorAngle + LINKER_ZIGZAG_TURN_ANGLE * 2),
    normalizeSignedAngle(anchorAngle - LINKER_ZIGZAG_TURN_ANGLE * 2)
  ].reduce((bestAngle, candidateAngle) => (
    angularDifference(candidateAngle, childAngle) < angularDifference(bestAngle, childAngle)
      ? candidateAngle
      : bestAngle
  ));
  const rotationAngle = normalizeSignedAngle(targetChildAngle - childAngle);
  if (Math.abs(rotationAngle) <= IMPROVEMENT_EPSILON) {
    return null;
  }

  const downstreamAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, childAtomId, linkerAtomId);
  const candidateCoords = rotateAtomIdsAroundPivot(coords, downstreamAtomIds, linkerAtomId, rotationAngle);
  return candidateCoords;
}

/**
 * Returns both zigzag-preserving orientations for the child side of a
 * two-heavy linker root after that root is moved around a ring anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} anchorAtomId - Small-ring anchor atom ID.
 * @param {string} linkerAtomId - Exocyclic linker root atom ID.
 * @returns {Array<Map<string, {x: number, y: number}>>} Bend-preserving coordinate candidates.
 */
function twoHeavyLinkerBendOrientationCandidates(layoutGraph, coords, anchorAtomId, linkerAtomId) {
  const childAtomId = exocyclicTwoHeavyLinkerChildAtomId(layoutGraph, coords, anchorAtomId, linkerAtomId);
  if (!childAtomId) {
    return [];
  }

  const linkerPosition = coords.get(linkerAtomId);
  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  if (!linkerPosition || !anchorPosition || !childPosition) {
    return [];
  }

  const anchorAngle = angleOf(sub(anchorPosition, linkerPosition));
  const childAngle = angleOf(sub(childPosition, linkerPosition));
  const downstreamAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, childAtomId, linkerAtomId);
  return [
    normalizeSignedAngle(anchorAngle + LINKER_ZIGZAG_TURN_ANGLE * 2),
    normalizeSignedAngle(anchorAngle - LINKER_ZIGZAG_TURN_ANGLE * 2)
  ].map(targetChildAngle => (
    rotateAtomIdsAroundPivot(coords, downstreamAtomIds, linkerAtomId, normalizeSignedAngle(targetChildAngle - childAngle))
  )).filter(Boolean);
}

/**
 * Measures the smallest angular separation between visible heavy neighbors of
 * a saturated small-ring exterior fan anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Small-ring anchor atom ID.
 * @returns {number} Smallest neighbor-neighbor angle in radians.
 */
function smallRingExteriorAnchorMinSeparation(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return 0;
  }

  const neighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
      continue;
    }
    neighborAngles.push(angleOf(sub(neighborPosition, anchorPosition)));
  }

  let minSeparation = Math.PI;
  for (let firstIndex = 0; firstIndex < neighborAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAngles.length; secondIndex++) {
      minSeparation = Math.min(minSeparation, angularDifference(neighborAngles[firstIndex], neighborAngles[secondIndex]));
    }
  }
  return minSeparation;
}

/**
 * Builds slight root-angle escape candidates for a short exocyclic linker tail
 * on a saturated small-ring exterior fan anchor. These candidates let the
 * terminal bond flip to the open zigzag side when the exact exterior slot
 * would visibly cross a neighboring substituent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Small-ring anchor atom ID.
 * @param {string} linkerAtomId - Exocyclic linker root atom ID.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<Map<string, {x: number, y: number}>>} Candidate coordinate maps.
 */
function buildSmallRingExteriorTailEscapeCandidates(layoutGraph, coords, anchorAtomId, linkerAtomId, bondLength) {
  if (!exocyclicTwoHeavyLinkerChildAtomId(layoutGraph, coords, anchorAtomId, linkerAtomId)) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  const linkerPosition = coords.get(linkerAtomId);
  if (!anchorPosition || !linkerPosition) {
    return [];
  }

  const currentAngle = angleOf(sub(linkerPosition, anchorPosition));
  const candidates = [];
  for (const offset of SMALL_RING_EXTERIOR_TAIL_ESCAPE_OFFSETS) {
    const translatedCoords = translateExocyclicSubtreeToSmallRingExteriorAngle(
      layoutGraph,
      coords,
      anchorAtomId,
      linkerAtomId,
      currentAngle + offset,
      bondLength
    );
    if (!translatedCoords) {
      continue;
    }
    candidates.push(...twoHeavyLinkerBendOrientationCandidates(layoutGraph, translatedCoords, anchorAtomId, linkerAtomId));
  }
  return candidates;
}

/**
 * Builds fan candidates for a saturated small-ring anchor with two ring
 * neighbors and two exocyclic heavy branches. The larger exocyclic side stays
 * fixed while the ring side rotates and the smaller branch moves toward the
 * complementary exterior slot, including fractional moves when the exact slot
 * is blocked by a near contact.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Small-ring anchor atom ID.
 * @param {string} fixedExocyclicNeighborId - Exocyclic neighbor to keep fixed.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<Map<string, {x: number, y: number}>>} Candidate coordinate maps.
 */
function buildSmallRingExteriorFanRefinementCandidates(layoutGraph, coords, anchorAtomId, fixedExocyclicNeighborId, bondLength) {
  const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, anchorAtomId);
  if (!descriptor || !descriptor.exocyclicNeighborIds.includes(fixedExocyclicNeighborId)) {
    return [];
  }

  const otherExocyclicNeighborId = descriptor.exocyclicNeighborIds.find(neighborAtomId => neighborAtomId !== fixedExocyclicNeighborId);
  const anchorPosition = coords.get(anchorAtomId);
  const fixedPosition = coords.get(fixedExocyclicNeighborId);
  const otherPosition = otherExocyclicNeighborId ? coords.get(otherExocyclicNeighborId) : null;
  if (!otherExocyclicNeighborId || !anchorPosition || !fixedPosition || !otherPosition) {
    return [];
  }

  const ringNeighborAngles = descriptor.ringNeighborIds
    .filter(neighborAtomId => coords.has(neighborAtomId))
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  const ringSize = (layoutGraph.atomToRings.get(anchorAtomId) ?? [])[0]?.atomIds?.length ?? 0;
  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, ringSize);
  if (targetAngles.length !== 2) {
    return [];
  }

  const ringSideAtomIds = new Set();
  for (const ringNeighborId of descriptor.ringNeighborIds) {
    for (const atomId of collectCovalentSubtreeAtomIds(layoutGraph, ringNeighborId, anchorAtomId)) {
      ringSideAtomIds.add(atomId);
    }
  }
  if (ringSideAtomIds.size === 0) {
    return [];
  }

  const fixedAngle = angleOf(sub(fixedPosition, anchorPosition));
  const currentOtherAngle = angleOf(sub(otherPosition, anchorPosition));
  const candidates = [];
  for (let targetIndex = 0; targetIndex < targetAngles.length; targetIndex++) {
    const ringRotation = normalizeSignedAngle(fixedAngle - targetAngles[targetIndex]);
    const exactRotatedCoords = rotateAtomIdsAroundPivot(coords, ringSideAtomIds, anchorAtomId, ringRotation);
    if (!exactRotatedCoords) {
      continue;
    }
    const exactRotatedAnchorPosition = exactRotatedCoords.get(anchorAtomId);
    const exactRotatedRingNeighborAngles = descriptor.ringNeighborIds
      .filter(neighborAtomId => exactRotatedCoords.has(neighborAtomId))
      .map(neighborAtomId => angleOf(sub(exactRotatedCoords.get(neighborAtomId), exactRotatedAnchorPosition)));
    const exactRotatedTargetAngles = smallRingExteriorTargetAngles(exactRotatedRingNeighborAngles, ringSize);
    const exactOtherTargetAngle = exactRotatedTargetAngles[1 - targetIndex];
    if (exactOtherTargetAngle == null) {
      continue;
    }

    for (const fraction of SMALL_RING_EXTERIOR_FAN_REFINEMENT_FRACTIONS) {
      const rotatedCoords = rotateAtomIdsAroundPivot(coords, ringSideAtomIds, anchorAtomId, ringRotation * fraction);
      if (!rotatedCoords) {
        continue;
      }
      const otherTargetAngle = interpolateSignedAngle(currentOtherAngle, exactOtherTargetAngle, fraction);
      const translatedCoords = translateExocyclicSubtreeToSmallRingExteriorAngle(
        layoutGraph,
        rotatedCoords,
        anchorAtomId,
        otherExocyclicNeighborId,
        otherTargetAngle,
        bondLength
      );
      if (translatedCoords) {
        const bendPreservingCoords = preserveTwoHeavyLinkerBendAfterRootMove(
          layoutGraph,
          translatedCoords,
          anchorAtomId,
          otherExocyclicNeighborId
        );
        if (bendPreservingCoords) {
          candidates.push(bendPreservingCoords);
        }
        candidates.push(translatedCoords);
      }
    }
  }
  candidates.push(
    ...buildSmallRingExteriorTailEscapeCandidates(
      layoutGraph,
      coords,
      anchorAtomId,
      otherExocyclicNeighborId,
      bondLength
    )
  );
  return candidates;
}

/**
 * Restores the exterior fan at saturated small-ring anchors after mixed
 * attached-ring placement has introduced the second exocyclic branch. This
 * keeps already placed large scaffolds fixed and only accepts audit-clean
 * candidates that reduce the local small-ring exterior penalty.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether any fan was restored.
 */
function refineSmallRingExteriorBranchFans(layoutGraph, coords, bondLength) {
  let changed = false;
  let baseAudit = auditLayout(layoutGraph, coords, { bondLength });
  const descriptors = [];

  for (const anchorAtomId of coords.keys()) {
    const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, anchorAtomId);
    const basePenalty = descriptor ? measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, anchorAtomId) : 0;
    if (!descriptor || basePenalty <= IMPROVEMENT_EPSILON) {
      continue;
    }
    const [firstExocyclicNeighborId, secondExocyclicNeighborId] = descriptor.exocyclicNeighborIds;
    const firstSubtreeSize = heavyAtomCountInIds(layoutGraph, collectCovalentSubtreeAtomIds(layoutGraph, firstExocyclicNeighborId, anchorAtomId));
    const secondSubtreeSize = heavyAtomCountInIds(layoutGraph, collectCovalentSubtreeAtomIds(layoutGraph, secondExocyclicNeighborId, anchorAtomId));
    for (const fixedExocyclicNeighborId of descriptor.exocyclicNeighborIds) {
      const fixedSize = fixedExocyclicNeighborId === firstExocyclicNeighborId ? firstSubtreeSize : secondSubtreeSize;
      const otherSize = fixedExocyclicNeighborId === firstExocyclicNeighborId ? secondSubtreeSize : firstSubtreeSize;
      if (fixedSize < otherSize) {
        continue;
      }
      descriptors.push({ anchorAtomId, fixedExocyclicNeighborId, basePenalty, exocyclicNeighborIds: descriptor.exocyclicNeighborIds });
    }
  }

  descriptors.sort((firstDescriptor, secondDescriptor) => (
    compareCanonicalIds(firstDescriptor.anchorAtomId, secondDescriptor.anchorAtomId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstDescriptor.fixedExocyclicNeighborId, secondDescriptor.fixedExocyclicNeighborId, layoutGraph.canonicalAtomRank)
  ));

  for (const { anchorAtomId, fixedExocyclicNeighborId, basePenalty, exocyclicNeighborIds } of descriptors) {
    let bestCoords = coords;
    let bestAudit = baseAudit;
    let bestPenalty = basePenalty;
    let bestLinkerBendPenalty = smallRingExteriorLinkedBranchBendPenalty(layoutGraph, coords, anchorAtomId);
    const focusAtomIds = [anchorAtomId, fixedExocyclicNeighborId, ...exocyclicNeighborIds];
    let bestLayoutCost = measureFocusedPlacementCost(layoutGraph, coords, bondLength, focusAtomIds);
    let bestVisibleCrossingCount = countVisibleHeavyBondCrossings(layoutGraph, coords, { focusAtomIds });
    for (const candidateCoords of buildSmallRingExteriorFanRefinementCandidates(layoutGraph, coords, anchorAtomId, fixedExocyclicNeighborId, bondLength)) {
      const candidatePenalty = measureSmallRingExteriorGapSpreadPenalty(layoutGraph, candidateCoords, anchorAtomId);
      const candidateVisibleCrossingCount = countVisibleHeavyBondCrossings(layoutGraph, candidateCoords, { focusAtomIds });
      const improvesCrossings = candidateVisibleCrossingCount < bestVisibleCrossingCount;
      if (!improvesCrossings && candidatePenalty >= bestPenalty - IMPROVEMENT_EPSILON) {
        continue;
      }
      if (
        improvesCrossings
        && smallRingExteriorAnchorMinSeparation(layoutGraph, candidateCoords, anchorAtomId) < LINKER_ZIGZAG_TURN_ANGLE - IMPROVEMENT_EPSILON
      ) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (
        (baseAudit.ok === true && candidateAudit.ok !== true)
        || candidateAudit.severeOverlapCount > baseAudit.severeOverlapCount
        || candidateAudit.bondLengthFailureCount > baseAudit.bondLengthFailureCount
        || candidateAudit.ringSubstituentReadabilityFailureCount > baseAudit.ringSubstituentReadabilityFailureCount
        || candidateAudit.inwardRingSubstituentCount > baseAudit.inwardRingSubstituentCount
        || candidateAudit.outwardAxisRingSubstituentFailureCount > baseAudit.outwardAxisRingSubstituentFailureCount
      ) {
        continue;
      }
      const candidateLinkerBendPenalty = smallRingExteriorLinkedBranchBendPenalty(layoutGraph, candidateCoords, anchorAtomId);
      const candidateLayoutCost = measureFocusedPlacementCost(layoutGraph, candidateCoords, bondLength, focusAtomIds);
      if (
        candidateVisibleCrossingCount < bestVisibleCrossingCount ||
        (
          candidateVisibleCrossingCount === bestVisibleCrossingCount &&
          (
            candidatePenalty < bestPenalty - IMPROVEMENT_EPSILON
            || (
              Math.abs(candidatePenalty - bestPenalty) <= IMPROVEMENT_EPSILON &&
              (
                candidateLinkerBendPenalty < bestLinkerBendPenalty - IMPROVEMENT_EPSILON
                || (
                  Math.abs(candidateLinkerBendPenalty - bestLinkerBendPenalty) <= IMPROVEMENT_EPSILON
                  && candidateLayoutCost < bestLayoutCost - IMPROVEMENT_EPSILON
                )
              )
            )
          )
        )
      ) {
        bestCoords = candidateCoords;
        bestAudit = candidateAudit;
        bestPenalty = candidatePenalty;
        bestLinkerBendPenalty = candidateLinkerBendPenalty;
        bestLayoutCost = candidateLayoutCost;
        bestVisibleCrossingCount = candidateVisibleCrossingCount;
      }
    }

    if (bestCoords !== coords) {
      overwriteCoordMap(coords, bestCoords);
      baseAudit = bestAudit;
      changed = true;
    }
  }

  return { changed };
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
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @param {string|null} [parentAtomId] - Fixed parent atom ID.
 * @returns {Array<{attachmentAngleOffset: number, ringRotationOffset: number, transformedCoords: Map<string, {x: number, y: number}>}>} Local refinement candidates.
 */
function buildLocalDirectAttachmentRefinementCandidates(transformedCoords, parentPosition, attachmentAtomId, bondLength, layoutGraph = null, parentAtomId = null) {
  const attachmentPosition = transformedCoords.get(attachmentAtomId);
  if (!attachmentPosition || !parentPosition) {
    return [];
  }

  const movableChildAtomIds = layoutGraph && parentAtomId
    ? new Set(
        collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
          .filter(atomId => transformedCoords.has(atomId))
      )
    : new Set(transformedCoords.keys());
  movableChildAtomIds.add(attachmentAtomId);

  const baseAttachmentAngle = angleOf(sub(attachmentPosition, parentPosition));
  const candidates = [];
  for (const attachmentAngleOffset of DIRECT_ATTACHMENT_FINE_ANGLE_OFFSETS) {
    const targetAttachmentPosition = add(parentPosition, fromAngle(baseAttachmentAngle + attachmentAngleOffset, bondLength));
    for (const ringRotationOffset of DIRECT_ATTACHMENT_LOCAL_REFINEMENT_RING_ROTATION_OFFSETS) {
      const nextCoords = new Map();
      for (const [atomId, position] of transformedCoords) {
        if (!movableChildAtomIds.has(atomId)) {
          nextCoords.set(atomId, { ...position });
          continue;
        }
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

/**
 * Mirrors a direct-attached child ring side across its fixed parent-root bond.
 * This gives exact root-straightening candidates the same handedness choice as
 * initial ring attachment, which is important when the exact orientation would
 * otherwise place a terminal leaf into a neighboring ring pocket.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {string} parentAtomId - Fixed parent atom ID.
 * @param {string} attachmentAtomId - Direct-attached ring-root atom ID.
 * @returns {Array<Map<string, {x: number, y: number}>>} Mirrored candidate coordinate maps.
 */
function buildDirectAttachedChildRootMirrorCandidates(layoutGraph, coords, parentAtomId, attachmentAtomId) {
  const parentPosition = coords.get(parentAtomId);
  const attachmentPosition = coords.get(attachmentAtomId);
  if (!parentPosition || !attachmentPosition) {
    return [];
  }

  const childSideAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
    .filter(atomId => atomId !== attachmentAtomId && coords.has(atomId));
  if (
    childSideAtomIds.length === 0
    || childSideAtomIds.some(atomId => layoutGraph.atoms.get(atomId)?.chirality)
  ) {
    return [];
  }

  const mirroredCoords = new Map(coords);
  for (const atomId of childSideAtomIds) {
    mirroredCoords.set(
      atomId,
      reflectAcrossLine(coords.get(atomId), parentPosition, attachmentPosition)
    );
  }
  return [mirroredCoords];
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

/**
 * Interpolates along the shortest signed angular path between two angles.
 * @param {number} startAngle - Current angle in radians.
 * @param {number} targetAngle - Desired angle in radians.
 * @param {number} fraction - Fraction of the turn to apply.
 * @returns {number} Interpolated signed angle in radians.
 */
function interpolateSignedAngle(startAngle, targetAngle, fraction) {
  return normalizeSignedAngle(startAngle + normalizeSignedAngle(targetAngle - startAngle) * fraction);
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

/**
 * Builds local resnap candidates for exact visible trigonal centers whose
 * three heavy branches should occupy a clean 120-degree fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Center atom ID.
 * @param {object[]} heavyBonds - Three visible heavy covalent bonds at the center.
 * @returns {Array<{coords: Map<string, {x: number, y: number}>, movedAtomIds: Set<string>, totalRotationMagnitude: number}>} Candidate coordinate maps.
 */
function buildExactVisibleTrigonalSpreadResnapCandidates(layoutGraph, coords, centerAtomId, heavyBonds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return [];
  }

  const assignments = heavyBonds
    .map(bond => {
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
    })
    .filter(Boolean)
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
  for (const fixedAssignment of assignments) {
    const baseAngle = fixedAssignment.currentAngle;
    for (const targetAngles of [
      [baseAngle, baseAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE, baseAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE],
      [baseAngle, baseAngle - EXACT_TRIGONAL_CONTINUATION_ANGLE, baseAngle + EXACT_TRIGONAL_CONTINUATION_ANGLE]
    ]) {
      for (const permutation of permuteAssignments(assignments)) {
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

function buildVisibleTrigonalRootResnapCandidates(layoutGraph, coords, centerAtomId) {
  const atom = layoutGraph.atoms.get(centerAtomId);
  if (
    !atom
    || !coords.has(centerAtomId)
    || atom.element === 'H'
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
    const hasExactVisibleTrigonalSingleBond = heavyBonds.some(bond => {
      if (!bond || bond.aromatic || (bond.order ?? 1) !== 1) {
        return false;
      }
      const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
      return isExactVisibleTrigonalBisectorEligible(layoutGraph, centerAtomId, neighborAtomId);
    });
    return hasExactVisibleTrigonalSingleBond
      ? buildExactVisibleTrigonalSpreadResnapCandidates(layoutGraph, coords, centerAtomId, heavyBonds)
      : [];
  }
  if (atom.element !== 'C') {
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

function snapExactRingAnchorSubstituentAngles(layoutGraph, coords, participantAtomIds) {
  let changed = false;
  const anchorAtomIds = [...participantAtomIds]
    .filter(atomId => coords.has(atomId))
    .sort((firstAtomId, secondAtomId) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));

  for (const anchorAtomId of anchorAtomIds) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (
      !anchorAtom
      || anchorAtom.element === 'H'
      || anchorAtom.heavyDegree !== 3
      || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0
    ) {
      continue;
    }

    const ringNeighborIds = [];
    const exocyclicNeighborIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
        continue;
      }
      if (bond.inRing) {
        ringNeighborIds.push(neighborAtomId);
      } else {
        exocyclicNeighborIds.push(neighborAtomId);
      }
    }
    if (ringNeighborIds.length !== 2 || exocyclicNeighborIds.length !== 1) {
      continue;
    }

    const childAtomId = exocyclicNeighborIds[0];
    if (!isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, childAtomId)) {
      continue;
    }
    const childAtom = layoutGraph.atoms.get(childAtomId);
    const isMetalChild = isMetalAtom(layoutGraph.sourceMolecule.atoms.get(childAtomId) ?? childAtom);
    if (
      anchorAtom.element === 'C'
      && !anchorAtom.aromatic
      && !isMetalChild
    ) {
      continue;
    }
    if (anchorAtom.element === 'C' && anchorAtom.aromatic && !hasNonAromaticMultipleBond(layoutGraph, childAtomId)) {
      continue;
    }

    const anchorPosition = coords.get(anchorAtomId);
    const ringNeighborCenter = centroid(ringNeighborIds.map(neighborAtomId => coords.get(neighborAtomId)).filter(Boolean));
    if (!anchorPosition || distance(anchorPosition, ringNeighborCenter) <= 1e-9) {
      continue;
    }
    const targetChildAngles = isMetalChild
      ? computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null)
      : [angleOf(sub(anchorPosition, ringNeighborCenter))];
    if (targetChildAngles.length === 0) {
      continue;
    }
    const currentChildAngle = angleOf(sub(coords.get(childAtomId), anchorPosition));
    const targetChildAngle = targetChildAngles.reduce((bestAngle, candidateAngle) => (
      angularDifference(candidateAngle, currentChildAngle) < angularDifference(bestAngle, currentChildAngle)
        ? candidateAngle
        : bestAngle
    ));
    const rotationAngle = wrapAngle(targetChildAngle - currentChildAngle);
    if (Math.abs(rotationAngle) <= 1e-9) {
      continue;
    }

    const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, childAtomId, anchorAtomId)
      .filter(atomId => atomId !== anchorAtomId && coords.has(atomId));
    if (subtreeAtomIds.length === 0) {
      continue;
    }
    for (const atomId of subtreeAtomIds) {
      coords.set(atomId, add(anchorPosition, rotate(sub(coords.get(atomId), anchorPosition), rotationAngle)));
    }
    changed = true;
  }

  return { changed };
}

function isTerminalCarbonLeaf(layoutGraph, anchorAtomId, childAtomId) {
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'C' || childAtom.heavyDegree !== 1 || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0) {
    return false;
  }
  const bond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.inRing
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

function incidentRingPointInsideCount(layoutGraph, coords, anchorAtomId, point) {
  let insideCount = 0;
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    const polygon = ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    if (polygon.length >= 3 && pointInPolygon(point, polygon)) {
      insideCount++;
    }
  }
  return insideCount;
}

function bridgeheadChainEndpointInsideCount(layoutGraph, coords, anchorAtomId, childAtomId) {
  const childPosition = coords.get(childAtomId);
  return childPosition ? incidentRingPointInsideCount(layoutGraph, coords, anchorAtomId, childPosition) : 0;
}

function isEscapableBridgeheadChain(layoutGraph, coords, anchorAtomId, childAtomId) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    !anchorAtom
    || !childAtom
    || anchorAtom.element !== 'C'
    || anchorAtom.aromatic
    || childAtom.element !== 'C'
    || childAtom.aromatic
    || childAtom.heavyDegree !== 2
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) < 2
    || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0
    || !coords.has(anchorAtomId)
    || !coords.has(childAtomId)
  ) {
    return false;
  }

  const bond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.inRing
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

function bridgeheadChainDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const [anchorAtomId, anchorAtom] of layoutGraph.atoms) {
    if (!anchorAtom || anchorAtom.element === 'H' || !coords.has(anchorAtomId)) {
      continue;
    }

    const exocyclicChildIds = [];
    for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.inRing) {
        continue;
      }
      const childAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
      const childAtom = layoutGraph.atoms.get(childAtomId);
      if (!childAtom || childAtom.element === 'H' || !coords.has(childAtomId)) {
        continue;
      }
      if (isEscapableBridgeheadChain(layoutGraph, coords, anchorAtomId, childAtomId)) {
        exocyclicChildIds.push(childAtomId);
      }
    }

    for (const childAtomId of exocyclicChildIds) {
      descriptors.push({
        anchorAtomId,
        childAtomId,
        insideCount: bridgeheadChainEndpointInsideCount(layoutGraph, coords, anchorAtomId, childAtomId)
      });
    }
  }
  return descriptors;
}

function bridgeheadRingSystemOutwardAngle(layoutGraph, coords, anchorAtomId) {
  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const ringSystem = ringSystemId == null
    ? null
    : layoutGraph.ringSystems.find(candidate => candidate.id === ringSystemId);
  if (!ringSystem || !coords.has(anchorAtomId)) {
    return null;
  }

  const positions = ringSystem.atomIds.map(atomId => coords.get(atomId)).filter(Boolean);
  if (positions.length < 3) {
    return null;
  }
  return angleOf(sub(coords.get(anchorAtomId), centroid(positions)));
}

function bridgeheadChainEscapeAngles(layoutGraph, coords, anchorAtomId, childAtomId, bondLength) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const ringNeighborAngles = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || !bond.inRing) {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    ringNeighborAngles.push(angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  }
  if (ringNeighborAngles.length < 2) {
    return [];
  }

  const preferredAngle = bridgeheadRingSystemOutwardAngle(layoutGraph, coords, anchorAtomId);
  const rawAngles = [
    ...(preferredAngle == null ? [] : [preferredAngle]),
    ...Array.from({ length: 72 }, (_value, index) => index * BRIDGEHEAD_CHAIN_ESCAPE_STEP)
  ];
  const candidateAngles = [];
  for (const candidateAngle of rawAngles) {
    const targetPosition = add(anchorPosition, fromAngle(candidateAngle, bondLength));
    if (incidentRingPointInsideCount(layoutGraph, coords, anchorAtomId, targetPosition) > 0) {
      continue;
    }
    const minRingSeparation = Math.min(...ringNeighborAngles.map(ringAngle => angularDifference(candidateAngle, ringAngle)));
    if (minRingSeparation < Math.PI / 6 - 1e-6) {
      continue;
    }
    if (!candidateAngles.some(existingAngle => angularDifference(existingAngle, candidateAngle) <= 1e-9)) {
      candidateAngles.push(candidateAngle);
    }
  }
  if (preferredAngle == null) {
    return candidateAngles;
  }
  return candidateAngles.sort((firstAngle, secondAngle) =>
    angularDifference(firstAngle, preferredAngle) - angularDifference(secondAngle, preferredAngle)
  );
}

function translateSubtreeAtoms(coords, nextCoords, atomIds, delta) {
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    nextCoords.set(atomId, add(position, delta));
  }
}

function placeBridgeheadChainCandidate(layoutGraph, coords, anchorAtomId, childAtomId, childAngle, tailOffset, bondLength) {
  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  if (!anchorPosition || !childPosition) {
    return null;
  }

  const targetChildPosition = add(anchorPosition, fromAngle(childAngle, bondLength));
  const childDelta = sub(targetChildPosition, childPosition);
  const nextCoords = new Map(coords);
  const downstreamHeavyIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === childAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtomId !== anchorAtomId && neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId)) {
      downstreamHeavyIds.push(neighborAtomId);
    }
  }

  const childSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, childAtomId, anchorAtomId).filter(atomId => coords.has(atomId));
  translateSubtreeAtoms(coords, nextCoords, childSubtreeAtomIds, childDelta);
  nextCoords.set(childAtomId, targetChildPosition);

  if (downstreamHeavyIds.length === 1) {
    const downstreamRootAtomId = downstreamHeavyIds[0];
    const downstreamPosition = coords.get(downstreamRootAtomId);
    if (downstreamPosition) {
      const targetDownstreamPosition = add(targetChildPosition, fromAngle(childAngle + tailOffset, bondLength));
      const downstreamDelta = sub(targetDownstreamPosition, downstreamPosition);
      const downstreamSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, downstreamRootAtomId, childAtomId).filter(atomId => coords.has(atomId));
      translateSubtreeAtoms(coords, nextCoords, downstreamSubtreeAtomIds, downstreamDelta);
      nextCoords.set(downstreamRootAtomId, targetDownstreamPosition);
    }
  }

  return nextCoords;
}

function nearbyTerminalCarbonLeafFanDescriptors(layoutGraph, coords, anchorAtomId, bondLength) {
  const anchorPosition = coords.get(anchorAtomId);
  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  if (!anchorPosition || ringSystemId == null) {
    return [];
  }

  const descriptors = [];
  for (const candidateAnchorAtomId of coords.keys()) {
    if (candidateAnchorAtomId === anchorAtomId || layoutGraph.atomToRingSystemId.get(candidateAnchorAtomId) !== ringSystemId) {
      continue;
    }
    const candidatePosition = coords.get(candidateAnchorAtomId);
    if (!candidatePosition || distance(anchorPosition, candidatePosition) > bondLength * 1.7) {
      continue;
    }
    const descriptor = describeDirectAttachmentExteriorContinuationAnchor(layoutGraph, candidateAnchorAtomId);
    if (
      !descriptor
      || !descriptor.exocyclicNeighborIds.every(childAtomId => isTerminalCarbonLeaf(layoutGraph, candidateAnchorAtomId, childAtomId))
    ) {
      continue;
    }
    descriptors.push({
      anchorAtomId: candidateAnchorAtomId,
      ...descriptor
    });
  }
  return descriptors.sort((firstDescriptor, secondDescriptor) =>
    compareCanonicalIds(firstDescriptor.anchorAtomId, secondDescriptor.anchorAtomId, layoutGraph.canonicalAtomRank)
  );
}

function terminalCarbonLeafFanAngleSets(layoutGraph, coords, descriptor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return [];
  }

  const ringNeighborAngles = descriptor.ringNeighborIds
    .filter(neighborAtomId => coords.has(neighborAtomId))
    .map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  const ringSize = (layoutGraph.atomToRings.get(descriptor.anchorAtomId) ?? [])[0]?.atomIds?.length ?? 0;
  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, ringSize);
  if (targetAngles.length !== 2) {
    return [];
  }

  const angleSets = [];
  const pushAngleSet = angleSet => {
    if (angularDifference(angleSet[0], angleSet[1]) < Math.PI / 3 - 1e-6) {
      return;
    }
    if (angleSets.some(existingSet =>
      angularDifference(existingSet[0], angleSet[0]) <= 1e-9
      && angularDifference(existingSet[1], angleSet[1]) <= 1e-9
    )) {
      return;
    }
    angleSets.push(angleSet.map(wrapAngle));
  };

  for (const firstOffset of BRIDGEHEAD_CHAIN_LEAF_FAN_OFFSETS) {
    for (const secondOffset of BRIDGEHEAD_CHAIN_LEAF_FAN_OFFSETS) {
      const angleSet = [targetAngles[0] + firstOffset, targetAngles[1] + secondOffset];
      pushAngleSet(angleSet);
      pushAngleSet([angleSet[1], angleSet[0]]);
    }
  }
  return angleSets;
}

function applyTerminalCarbonLeafFan(layoutGraph, coords, descriptor, angleSet, bondLength) {
  let nextCoords = coords;
  for (let index = 0; index < descriptor.exocyclicNeighborIds.length; index++) {
    const childAtomId = descriptor.exocyclicNeighborIds[index];
    const candidateCoords = translateExocyclicSubtreeToSmallRingExteriorAngle(
      layoutGraph,
      nextCoords,
      descriptor.anchorAtomId,
      childAtomId,
      angleSet[index],
      bondLength
    );
    if (!candidateCoords) {
      return null;
    }
    nextCoords = candidateCoords;
  }
  return nextCoords;
}

function bridgeheadChainRescueScore(layoutGraph, coords, bondLength, anchorAtomId, childAtomId, focusAtomIds) {
  const audit = auditLayout(layoutGraph, coords, { bondLength });
  return {
    audit,
    insideCount: bridgeheadChainEndpointInsideCount(layoutGraph, coords, anchorAtomId, childAtomId),
    layoutCost: measureFocusedPlacementCost(layoutGraph, coords, bondLength, focusAtomIds)
  };
}

function compareBridgeheadChainRescueScores(candidate, incumbent) {
  if (candidate.insideCount !== incumbent.insideCount) {
    return candidate.insideCount - incumbent.insideCount;
  }
  for (const key of ['ringSubstituentReadabilityFailureCount', 'inwardRingSubstituentCount', 'outwardAxisRingSubstituentFailureCount', 'severeOverlapCount', 'bondLengthFailureCount']) {
    if (candidate.audit[key] !== incumbent.audit[key]) {
      return candidate.audit[key] - incumbent.audit[key];
    }
  }
  if (Math.abs(candidate.layoutCost - incumbent.layoutCost) > IMPROVEMENT_EPSILON) {
    return candidate.layoutCost - incumbent.layoutCost;
  }
  return 0;
}

function rescueBridgeheadChainExitsWithTerminalLeafFans(layoutGraph, coords, bondLength) {
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT) {
    return { changed: false };
  }

  let changed = false;
  for (const descriptor of bridgeheadChainDescriptors(layoutGraph, coords)) {
    if (descriptor.insideCount === 0) {
      continue;
    }
    const baseScore = bridgeheadChainRescueScore(
      layoutGraph,
      coords,
      bondLength,
      descriptor.anchorAtomId,
      descriptor.childAtomId,
      [descriptor.anchorAtomId, descriptor.childAtomId]
    );
    if (
      baseScore.audit.ringSubstituentReadabilityFailureCount === 0
      && baseScore.audit.severeOverlapCount === 0
    ) {
      continue;
    }

    const escapeAngles = bridgeheadChainEscapeAngles(layoutGraph, coords, descriptor.anchorAtomId, descriptor.childAtomId, bondLength);
    if (escapeAngles.length === 0) {
      continue;
    }

    const leafFanDescriptors = nearbyTerminalCarbonLeafFanDescriptors(layoutGraph, coords, descriptor.anchorAtomId, bondLength).slice(0, 1);
    const leafFanAngleSets = leafFanDescriptors.map(leafDescriptor => terminalCarbonLeafFanAngleSets(layoutGraph, coords, leafDescriptor));
    const leafFanOptions = leafFanDescriptors.length === 0
      ? [{ coords, focusAtomIds: [] }]
      : leafFanAngleSets[0].map(angleSet => ({
          descriptor: leafFanDescriptors[0],
          angleSet,
          focusAtomIds: leafFanDescriptors[0].exocyclicNeighborIds
        }));
    if (leafFanOptions.length === 0) {
      continue;
    }

    let bestCoords = coords;
    let bestScore = baseScore;
    for (const escapeAngle of escapeAngles) {
      for (const tailOffset of BRIDGEHEAD_CHAIN_TAIL_OFFSETS) {
        const chainCoords = placeBridgeheadChainCandidate(
          layoutGraph,
          coords,
          descriptor.anchorAtomId,
          descriptor.childAtomId,
          escapeAngle,
          tailOffset,
          bondLength
        );
        if (!chainCoords) {
          continue;
        }

        for (const leafFanOption of leafFanOptions) {
          const candidateCoords = leafFanOption.descriptor
            ? applyTerminalCarbonLeafFan(layoutGraph, chainCoords, leafFanOption.descriptor, leafFanOption.angleSet, bondLength)
            : chainCoords;
          if (!candidateCoords) {
            continue;
          }
          const focusAtomIds = [
            ...collectCovalentSubtreeAtomIds(layoutGraph, descriptor.childAtomId, descriptor.anchorAtomId),
            ...(leafFanOption.focusAtomIds ?? [])
          ].filter(atomId => candidateCoords.has(atomId));
          const candidateScore = bridgeheadChainRescueScore(
            layoutGraph,
            candidateCoords,
            bondLength,
            descriptor.anchorAtomId,
            descriptor.childAtomId,
            focusAtomIds
          );
          if (
            candidateScore.audit.bondLengthFailureCount > baseScore.audit.bondLengthFailureCount
            || candidateScore.audit.severeOverlapCount > Math.max(baseScore.audit.severeOverlapCount, 0)
          ) {
            continue;
          }
          if (compareBridgeheadChainRescueScores(candidateScore, bestScore) < 0) {
            bestCoords = candidateCoords;
            bestScore = candidateScore;
          }
        }
      }
    }

    if (bestCoords !== coords && compareBridgeheadChainRescueScores(bestScore, baseScore) < 0) {
      overwriteCoordMap(coords, bestCoords);
      changed = true;
    }
  }

  return { changed };
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
 * Builds exact local ring-exit rescue poses for one attached ring block by
 * rotating the child ring around its fixed root atom until the parent bond
 * lands on one of that root atom's exact local outward ring exits.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current fixed coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Current attached-block coordinates; short linkers may include the parent atom.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Exact ring-exit rescue candidates.
 */
function buildDirectAttachmentExactRingExitRescueCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !transformedCoords.has(attachmentAtomId)) {
    return [];
  }

  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }
  if (!candidateCoords.has(parentAtomId)) {
    return [];
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
 * Builds bounded child-side root-rotation variants for an omitted-H parent
 * spread rescue. The parent spread fixes the visible three-heavy angle, while
 * these variants let the moved attached ring or moved sibling subtree turn
 * around its own root so the exact parent fan does not inherit a rigid clash.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current fixed coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Candidate transformed coordinates.
 * @param {{parentAtomId?: string, attachmentAtomId?: string, rotatingSiblingAtomId?: string}|null} [candidateMeta] - Candidate metadata.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Root-rotation variants.
 */
function buildOmittedHydrogenParentSpreadRootRotationCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const rootAtomIds = [...new Set([candidateMeta?.attachmentAtomId, candidateMeta?.rotatingSiblingAtomId].filter(Boolean))];
  if (!parentAtomId || rootAtomIds.length === 0) {
    return [];
  }

  const candidateCoords = new Map(coords);
  for (const [atomId, position] of transformedCoords) {
    candidateCoords.set(atomId, position);
  }

  const candidates = [];
  for (const rootAtomId of rootAtomIds) {
    const rootAtom = layoutGraph.atoms.get(rootAtomId);
    const rootPosition = candidateCoords.get(rootAtomId);
    if (!rootAtom || rootAtom.chirality || !rootPosition) {
      continue;
    }
    if (
      rootAtom.element === 'C' &&
      rootAtomId === candidateMeta?.rotatingSiblingAtomId &&
      rootAtomId !== candidateMeta?.attachmentAtomId &&
      (layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) > 0
    ) {
      continue;
    }

    const rotatedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, parentAtomId)
      .filter(atomId => atomId !== rootAtomId && candidateCoords.has(atomId));
    if (
      rotatedAtomIds.length === 0 ||
      rotatedAtomIds.length > MAX_DIRECT_ATTACHMENT_PARENT_SLOT_SWAP_ATOMS ||
      rotatedAtomIds.some(atomId => layoutGraph.atoms.get(atomId)?.chirality)
    ) {
      continue;
    }
    const rootIncidentRingExitWasExact =
      rootAtom.element === 'C' &&
      (layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) > 0 &&
      measureAttachedRootIncidentRingExitPenalty(layoutGraph, candidateCoords, rootAtomId, parentAtomId).maxDeviation <= IMPROVEMENT_EPSILON;

    for (const rootRotationOffset of OMITTED_HYDROGEN_PARENT_SPREAD_ROOT_ROTATION_OFFSETS) {
      const nextCoords = new Map(transformedCoords);
      const nextCandidateCoords = new Map(candidateCoords);
      for (const atomId of rotatedAtomIds) {
        const position = candidateCoords.get(atomId);
        if (!position) {
          continue;
        }
        const nextPosition = add(rootPosition, rotate(sub(position, rootPosition), rootRotationOffset));
        nextCoords.set(atomId, nextPosition);
        nextCandidateCoords.set(atomId, nextPosition);
      }
      if (
        rootIncidentRingExitWasExact &&
        measureAttachedRootIncidentRingExitPenalty(layoutGraph, nextCandidateCoords, rootAtomId, parentAtomId).maxDeviation > IMPROVEMENT_EPSILON
      ) {
        continue;
      }
      candidates.push({
        transformedCoords: nextCoords,
        meta: {
          ...candidateMeta,
          omittedHydrogenParentSpreadRootRotation: true,
          rootRotationAtomId: rootAtomId,
          rootRotationOffset
        }
      });
    }
  }

  return candidates;
}

/**
 * Builds parent-side spread rescues for suppressed-H chiral carbons whose three
 * visible heavy bonds should read as an even 120-degree fan. The attached ring
 * and one already placed sibling subtree move around the fixed parent atom, and
 * optional downstream mirrors are added when a sibling branch can flip away
 * from the attached ring without changing the local parent stereocenter.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} transformedCoords - Current attached-block coordinates.
 * @param {{parentAtomId?: string, attachmentAtomId?: string}|null} [candidateMeta] - Optional candidate metadata.
 * @returns {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta: object}>} Omitted-H spread rescue candidates.
 */
function buildDirectAttachmentOmittedHydrogenParentSpreadRescueCandidates(layoutGraph, coords, transformedCoords, candidateMeta = null) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  const attachmentAtomId = candidateMeta?.attachmentAtomId ?? null;
  if (!parentAtomId || !attachmentAtomId || !coords.has(parentAtomId) || !transformedCoords.has(attachmentAtomId)) {
    return [];
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  if (
    !parentAtom
    || parentAtom.element !== 'C'
    || parentAtom.aromatic
    || parentAtom.degree !== 4
    || parentAtom.heavyDegree !== 3
    || layoutGraph.options.suppressH !== true
    || (layoutGraph.atomToRings.get(parentAtomId)?.length ?? 0) > 0
    || (layoutGraph.atomToRings.get(attachmentAtomId)?.length ?? 0) === 0
  ) {
    return [];
  }

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

  const parentPosition = coords.get(parentAtomId);
  const attachmentPosition = transformedCoords.get(attachmentAtomId);
  const currentAttachmentAngle = angleOf(sub(attachmentPosition, parentPosition));
  const attachmentSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, attachmentAtomId, parentAtomId)
    .filter(atomId => transformedCoords.has(atomId));
  const attachmentSubtreeAtomIdSet = new Set(attachmentSubtreeAtomIds);
  if (attachmentSubtreeAtomIds.length === 0) {
    return [];
  }

  const rescueCandidates = [];
  const addCandidate = (candidate) => {
    const exactRingExitVariants = [
      candidate,
      ...buildDirectAttachmentExactRingExitRescueCandidates(
        layoutGraph,
        coords,
        candidate.transformedCoords,
        candidate.meta
      )
    ];
    for (const exactRingExitVariant of exactRingExitVariants) {
      const candidateVariants = [
        exactRingExitVariant,
        ...buildOmittedHydrogenParentSpreadRootRotationCandidates(
          layoutGraph,
          coords,
          exactRingExitVariant.transformedCoords,
          exactRingExitVariant.meta
        )
      ];
      for (const candidateVariant of candidateVariants) {
        rescueCandidates.push(candidateVariant);
        for (const mirroredCandidate of buildMirroredParentSideSubtreeCandidates(
          layoutGraph,
          coords,
          candidateVariant.transformedCoords,
          candidateVariant.meta
        )) {
          rescueCandidates.push(mirroredCandidate);
        }
      }
    }
  };

  for (const fixedSiblingAtomId of siblingAtomIds) {
    const rotatingSiblingAtomId = siblingAtomIds.find(atomId => atomId !== fixedSiblingAtomId);
    if (!rotatingSiblingAtomId) {
      continue;
    }

    const rotatingSiblingSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, rotatingSiblingAtomId, parentAtomId)
      .filter(atomId => coords.has(atomId) || transformedCoords.has(atomId));
    if (
      rotatingSiblingSubtreeAtomIds.length === 0 ||
      rotatingSiblingSubtreeAtomIds.some(atomId => attachmentSubtreeAtomIdSet.has(atomId))
    ) {
      continue;
    }

    const movedAtomIds = new Set([...attachmentSubtreeAtomIds, ...rotatingSiblingSubtreeAtomIds]);
    if (movedAtomIds.size > MAX_DIRECT_ATTACHMENT_PARENT_SLOT_SWAP_ATOMS) {
      continue;
    }

    const fixedSiblingAngle = angleOf(sub(coords.get(fixedSiblingAtomId), parentPosition));
    const currentRotatingSiblingAngle = angleOf(sub(coords.get(rotatingSiblingAtomId), parentPosition));
    for (const direction of [1, -1]) {
      const targetAttachmentAngle = fixedSiblingAngle + direction * EXACT_TRIGONAL_CONTINUATION_ANGLE;
      const targetRotatingSiblingAngle = fixedSiblingAngle - direction * EXACT_TRIGONAL_CONTINUATION_ANGLE;
      const attachmentRotation = wrapAngle(targetAttachmentAngle - currentAttachmentAngle);
      const rotatingSiblingRotation = wrapAngle(targetRotatingSiblingAngle - currentRotatingSiblingAngle);
      if (
        Math.abs(attachmentRotation) <= IMPROVEMENT_EPSILON &&
        Math.abs(rotatingSiblingRotation) <= IMPROVEMENT_EPSILON
      ) {
        continue;
      }

      const nextCoords = new Map(transformedCoords);
      for (const atomId of attachmentSubtreeAtomIds) {
        const position = transformedCoords.get(atomId);
        if (position) {
          nextCoords.set(atomId, add(parentPosition, rotate(sub(position, parentPosition), attachmentRotation)));
        }
      }
      for (const atomId of rotatingSiblingSubtreeAtomIds) {
        const position = transformedCoords.get(atomId) ?? coords.get(atomId);
        if (position) {
          nextCoords.set(atomId, add(parentPosition, rotate(sub(position, parentPosition), rotatingSiblingRotation)));
        }
      }

      addCandidate({
        transformedCoords: nextCoords,
        meta: {
          ...candidateMeta,
          omittedHydrogenParentSpreadRescue: true,
          fixedSiblingAtomId,
          rotatingSiblingAtomId,
          targetAttachmentAngle,
          targetRotatingSiblingAngle
        }
      });
    }
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

function findLinkedHeteroRingAnchorOverlapDescriptors(layoutGraph, coords, bondLength) {
  if ((layoutGraph.traits.heavyAtomCount ?? 0) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT + 20) {
    return [];
  }

  const descriptors = [];
  const seenDescriptorKeys = new Set();
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  for (const overlap of overlaps) {
    for (const [linkerAtomId, blockerAtomId] of [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ]) {
      const linkerAtom = layoutGraph.atoms.get(linkerAtomId);
      if (
        !linkerAtom
        || linkerAtom.element === 'H'
        || linkerAtom.element === 'C'
        || linkerAtom.aromatic
        || linkerAtom.heavyDegree !== 2
        || (layoutGraph.atomToRings.get(linkerAtomId)?.length ?? 0) > 0
        || !coords.has(linkerAtomId)
      ) {
        continue;
      }

      const blockerRingSystemId = layoutGraph.atomToRingSystemId.get(blockerAtomId);
      if (blockerRingSystemId == null || !coords.has(blockerAtomId)) {
        continue;
      }

      const heavyNeighborIds = [];
      for (const bond of layoutGraph.bondsByAtomId.get(linkerAtomId) ?? []) {
        if (!bond || bond.kind !== 'covalent' || bond.aromatic || bond.inRing || (bond.order ?? 1) !== 1) {
          continue;
        }
        const neighborAtomId = bond.a === linkerAtomId ? bond.b : bond.a;
        const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
        if (neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId)) {
          heavyNeighborIds.push(neighborAtomId);
        }
      }
      if (heavyNeighborIds.length !== 2) {
        continue;
      }

      const anchorAtomId = heavyNeighborIds.find(neighborAtomId =>
        layoutGraph.atomToRingSystemId.get(neighborAtomId) === blockerRingSystemId
      );
      const remoteAnchorAtomId = heavyNeighborIds.find(neighborAtomId =>
        neighborAtomId !== anchorAtomId && layoutGraph.atomToRingSystemId.get(neighborAtomId) != null
      );
      if (!anchorAtomId || !remoteAnchorAtomId) {
        continue;
      }

      const anchorBond = findLayoutBond(layoutGraph, linkerAtomId, anchorAtomId);
      const remoteBond = findLayoutBond(layoutGraph, linkerAtomId, remoteAnchorAtomId);
      if (
        !anchorBond
        || !remoteBond
        || anchorBond.aromatic
        || remoteBond.aromatic
        || anchorBond.inRing
        || remoteBond.inRing
        || (anchorBond.order ?? 1) !== 1
        || (remoteBond.order ?? 1) !== 1
      ) {
        continue;
      }

      const subtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, linkerAtomId, anchorAtomId)
        .filter(atomId => coords.has(atomId));
      if (
        subtreeAtomIds.length === 0
        || subtreeAtomIds.includes(anchorAtomId)
        || subtreeAtomIds.includes(blockerAtomId)
      ) {
        continue;
      }

      const descriptorKey = `${linkerAtomId}:${anchorAtomId}`;
      if (seenDescriptorKeys.has(descriptorKey)) {
        continue;
      }
      seenDescriptorKeys.add(descriptorKey);
      descriptors.push({
        linkerAtomId,
        anchorAtomId,
        blockerAtomId,
        remoteAnchorAtomId,
        subtreeAtomIds
      });
    }
  }

  return descriptors;
}

function linkedHeteroRingAnchorOverlapCandidateScore(layoutGraph, coords, bondValidationClasses, bondLength, descriptor, totalRotationMagnitude) {
  const focusAtomIds = expandScoringFocusAtomIds(
    layoutGraph,
    new Set([
      descriptor.linkerAtomId,
      descriptor.anchorAtomId,
      descriptor.blockerAtomId,
      descriptor.remoteAnchorAtomId
    ].filter(Boolean)),
    2
  );
  return {
    coords,
    audit: auditLayout(layoutGraph, coords, { bondLength, bondValidationClasses }),
    focusedPlacementCost: measureFocusedPlacementCost(layoutGraph, coords, bondLength, focusAtomIds),
    totalRotationMagnitude
  };
}

function linkedHeteroRingAnchorOverlapCandidateIsBounded(candidate, base) {
  return (
    candidate.audit.bondLengthFailureCount <= base.audit.bondLengthFailureCount
    && candidate.audit.ringSubstituentReadabilityFailureCount <= base.audit.ringSubstituentReadabilityFailureCount
    && candidate.audit.inwardRingSubstituentCount <= base.audit.inwardRingSubstituentCount
    && candidate.audit.outwardAxisRingSubstituentFailureCount <= base.audit.outwardAxisRingSubstituentFailureCount
  );
}

function compareLinkedHeteroRingAnchorOverlapCandidates(candidate, incumbent, layoutGraph) {
  if (candidate.audit.severeOverlapCount !== incumbent.audit.severeOverlapCount) {
    return candidate.audit.severeOverlapCount - incumbent.audit.severeOverlapCount;
  }
  if (candidate.audit.bondLengthFailureCount !== incumbent.audit.bondLengthFailureCount) {
    return candidate.audit.bondLengthFailureCount - incumbent.audit.bondLengthFailureCount;
  }
  if (candidate.audit.ringSubstituentReadabilityFailureCount !== incumbent.audit.ringSubstituentReadabilityFailureCount) {
    return candidate.audit.ringSubstituentReadabilityFailureCount - incumbent.audit.ringSubstituentReadabilityFailureCount;
  }
  if (candidate.audit.inwardRingSubstituentCount !== incumbent.audit.inwardRingSubstituentCount) {
    return candidate.audit.inwardRingSubstituentCount - incumbent.audit.inwardRingSubstituentCount;
  }
  if (candidate.audit.outwardAxisRingSubstituentFailureCount !== incumbent.audit.outwardAxisRingSubstituentFailureCount) {
    return candidate.audit.outwardAxisRingSubstituentFailureCount - incumbent.audit.outwardAxisRingSubstituentFailureCount;
  }
  if (Math.abs(candidate.audit.severeOverlapPenalty - incumbent.audit.severeOverlapPenalty) > IMPROVEMENT_EPSILON) {
    return candidate.audit.severeOverlapPenalty - incumbent.audit.severeOverlapPenalty;
  }
  if (Math.abs(candidate.focusedPlacementCost - incumbent.focusedPlacementCost) > IMPROVEMENT_EPSILON) {
    return candidate.focusedPlacementCost - incumbent.focusedPlacementCost;
  }
  if (Math.abs(candidate.totalRotationMagnitude - incumbent.totalRotationMagnitude) > IMPROVEMENT_EPSILON) {
    return candidate.totalRotationMagnitude - incumbent.totalRotationMagnitude;
  }
  return compareCoordMapsDeterministically(candidate.coords, incumbent.coords, layoutGraph.canonicalAtomRank);
}

function resolveLinkedHeteroRingAnchorOverlaps(layoutGraph, coords, bondValidationClasses, bondLength) {
  const baseScore = linkedHeteroRingAnchorOverlapCandidateScore(
    layoutGraph,
    coords,
    bondValidationClasses,
    bondLength,
    {
      linkerAtomId: null,
      anchorAtomId: null,
      blockerAtomId: null,
      remoteAnchorAtomId: null
    },
    0
  );
  if (baseScore.audit.severeOverlapCount === 0) {
    return { changed: false };
  }

  const descriptors = findLinkedHeteroRingAnchorOverlapDescriptors(layoutGraph, coords, bondLength);
  if (descriptors.length === 0) {
    return { changed: false };
  }

  let bestCandidate = baseScore;
  for (const descriptor of descriptors) {
    for (const rotationOffset of LINKED_HETERO_RING_OVERLAP_ROTATION_OFFSETS) {
      const candidateCoords = rotateAtomIdsAroundPivot(coords, descriptor.subtreeAtomIds, descriptor.anchorAtomId, rotationOffset);
      if (!candidateCoords) {
        continue;
      }
      const candidate = linkedHeteroRingAnchorOverlapCandidateScore(
        layoutGraph,
        candidateCoords,
        bondValidationClasses,
        bondLength,
        descriptor,
        Math.abs(rotationOffset)
      );
      if (
        !linkedHeteroRingAnchorOverlapCandidateIsBounded(candidate, baseScore)
        || candidate.audit.severeOverlapCount >= baseScore.audit.severeOverlapCount
      ) {
        continue;
      }
      if (compareLinkedHeteroRingAnchorOverlapCandidates(candidate, bestCandidate, layoutGraph) < 0) {
        bestCandidate = candidate;
      }
    }
  }

  if (bestCandidate.coords === coords) {
    return { changed: false };
  }
  overwriteCoordMap(coords, bestCandidate.coords);
  return { changed: true };
}

function isVisibleHeavyLayoutAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  return Boolean(atom && atom.element !== 'H' && !(layoutGraph.options.suppressH && atom.visible === false));
}

function graphDistanceWithin(layoutGraph, firstAtomId, secondAtomId, maxDepth) {
  if (firstAtomId === secondAtomId) {
    return true;
  }
  let frontier = [firstAtomId];
  const visited = new Set(frontier);
  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontier = [];
    for (const atomId of frontier) {
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        if (neighborAtomId === secondAtomId) {
          return true;
        }
        if (!visited.has(neighborAtomId)) {
          visited.add(neighborAtomId);
          nextFrontier.push(neighborAtomId);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) {
      break;
    }
  }
  return false;
}

function measureAttachedBlockNearContactPenalty(layoutGraph, coords, bondLength, focusAtomIds) {
  if (!focusAtomIds || focusAtomIds.size === 0) {
    return 0;
  }
  const threshold = bondLength * ATTACHED_BLOCK_NEAR_CONTACT_FACTOR;
  const atomIds = [...coords.keys()].filter(atomId => isVisibleHeavyLayoutAtom(layoutGraph, atomId));
  let penalty = 0;
  for (let firstIndex = 0; firstIndex < atomIds.length; firstIndex++) {
    const firstAtomId = atomIds[firstIndex];
    const firstPosition = coords.get(firstAtomId);
    if (!firstPosition) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < atomIds.length; secondIndex++) {
      const secondAtomId = atomIds[secondIndex];
      if (!focusAtomIds.has(firstAtomId) && !focusAtomIds.has(secondAtomId)) {
        continue;
      }
      if (
        layoutGraph.bondedPairSet?.has(atomPairKey(firstAtomId, secondAtomId))
        || graphDistanceWithin(layoutGraph, firstAtomId, secondAtomId, 2)
      ) {
        continue;
      }
      const secondPosition = coords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      const contactDistance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
      if (contactDistance >= threshold) {
        continue;
      }
      penalty += ((threshold - contactDistance) / bondLength) ** 2;
    }
  }
  return penalty;
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
  const heavyBondCrossingCount = countVisibleHeavyBondCrossings(layoutGraph, candidateCoords, {
    focusAtomIds: changedAtomIds
  });
  const heavyBondCrossingPriorityCount = shouldPrioritizePhosphorusAdjacentAttachedBlockCrossings(layoutGraph, candidateMeta)
    ? heavyBondCrossingCount
    : 0;
  const fusedJunctionContinuationPenalty = measureDirectAttachmentFusedJunctionContinuationPenalty(layoutGraph, candidateCoords, candidateMeta);
  const exactContinuationPenalty = measureDirectAttachmentExactContinuationPenalty(layoutGraph, candidateCoords, candidateMeta);
  const parentVisibleTrigonalPenalty = measureDirectAttachmentParentVisibleTrigonalPenalty(layoutGraph, candidateCoords, candidateMeta);
  const parentOutwardPenalty = measureDirectAttachmentParentOutwardPenalty(layoutGraph, candidateCoords, candidateMeta);
  const projectedTetrahedralParentPenalty = measureDirectAttachmentProjectedTetrahedralParentPenalty(layoutGraph, candidateCoords, candidateMeta);
  const parentExteriorPenalty =
    candidateMeta?.parentAtomId
    && candidateMeta?.attachmentAtomId
    && isDirectAttachedParentExteriorRefinementCandidate(
      layoutGraph,
      candidateCoords,
      candidateMeta.parentAtomId,
      candidateMeta.attachmentAtomId
    )
    ? measureDirectAttachedRingRootParentExteriorPenalty(
        layoutGraph,
        candidateCoords,
        candidateMeta.parentAtomId,
        candidateMeta.attachmentAtomId
      )
    : 0;
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
  const terminalLabelClearancePenalty = measureAttachedBlockTerminalLabelClearancePenalty(
    layoutGraph,
    baseCoords,
    candidateCoords,
    bondLength,
    changedAtomIds
  );
  const smallRingExteriorPenalty = [...scoringFocusAtomIds].reduce(
    (sum, atomId) => sum + (candidateCoords.has(atomId) ? measureSmallRingExteriorGapSpreadPenalty(layoutGraph, candidateCoords, atomId) : 0),
    0
  );
  const nearContactPenalty = measureAttachedBlockNearContactPenalty(layoutGraph, candidateCoords, bondLength, scoringFocusAtomIds);
  const shouldScoreIdealLeafPresentation =
    changedAtomIds.length <= 12 && (layoutGraph.traits.heavyAtomCount ?? 0) <= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT;
  const idealLeafPresentationPenalty = shouldScoreIdealLeafPresentation
    ? measureRingSubstituentPresentationPenalty(layoutGraph, candidateCoords, {
        focusAtomIds: readabilityFocusAtomIds
      })
    : 0;

  return {
    overlapCount,
    heavyBondCrossingCount,
    heavyBondCrossingPriorityCount,
    fusedJunctionContinuationPenalty,
    parentVisibleTrigonalPenalty,
    parentOutwardPenalty,
    projectedTetrahedralParentPenalty,
    parentExteriorPenalty,
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
    terminalLabelClearancePenalty,
    nearContactPenalty,
    prioritizeRingExitBeforeTerminalSlots: candidateMeta?.prioritizeRingExitBeforeTerminalSlots === true,
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

function shouldPrioritizePhosphorusAdjacentAttachedBlockCrossings(layoutGraph, candidateMeta) {
  const parentAtomId = candidateMeta?.parentAtomId ?? null;
  if (!parentAtomId) {
    return false;
  }
  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  if (!parentAtom || parentAtom.element === 'H') {
    return false;
  }
  if (parentAtom.element === 'P') {
    return true;
  }
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    if (layoutGraph.atoms.get(neighborAtomId)?.element === 'P') {
      return true;
    }
  }
  return false;
}

function shouldSkipAttachedBlockBranchScoring(coords, primaryNonRingAtomIds) {
  return primaryNonRingAtomIds.size > 30 || mixedAttachedBlockWorkload(coords, primaryNonRingAtomIds) > EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT + 20;
}

function directAttachmentCandidateNeedsBranchScoring(candidate, primaryNonRingAtomIds, placedAtomIds) {
  if (!candidate?.meta?.parentAtomId || !candidate?.meta?.attachmentAtomId) {
    return false;
  }
  for (const atomId of primaryNonRingAtomIds) {
    if (!placedAtomIds.has(atomId) && !candidate.transformedCoords.has(atomId)) {
      return true;
    }
  }
  return false;
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
    bestScore.heavyBondCrossingPriorityCount !== 0 ||
    bestScore.readability.failingSubstituentCount !== 0 ||
    bestScore.fusedJunctionContinuationPenalty > IMPROVEMENT_EPSILON ||
    bestScore.parentVisibleTrigonalPenalty > IMPROVEMENT_EPSILON ||
    bestScore.parentOutwardPenalty > IMPROVEMENT_EPSILON ||
    bestScore.projectedTetrahedralParentPenalty > IMPROVEMENT_EPSILON ||
    bestScore.parentExteriorPenalty > IMPROVEMENT_EPSILON ||
    bestScore.exactContinuationPenalty > IMPROVEMENT_EPSILON ||
    bestScore.exactTerminalMultipleSlotPenalty > IMPROVEMENT_EPSILON ||
    bestScore.trigonalBisectorPenalty > IMPROVEMENT_EPSILON ||
    bestScore.ringExitPenalty > IMPROVEMENT_EPSILON ||
    bestScore.ringExitMaxPenalty > IMPROVEMENT_EPSILON ||
    bestScore.attachmentExteriorPenalty > IMPROVEMENT_EPSILON ||
    bestScore.junctionCrowdingPenalty > IMPROVEMENT_EPSILON ||
    bestScore.terminalLabelClearancePenalty > IMPROVEMENT_EPSILON ||
    bestScore.nearContactPenalty > IMPROVEMENT_EPSILON ||
    bestScore.presentationPenalty > 0.25
  ) {
    return false;
  }
  if (!runnerUpScore) {
    return true;
  }
  return (
    runnerUpScore.overlapCount > 0 ||
    runnerUpScore.heavyBondCrossingPriorityCount > 0 ||
    runnerUpScore.readability.failingSubstituentCount > 0 ||
    runnerUpScore.fusedJunctionContinuationPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.parentVisibleTrigonalPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.parentOutwardPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.projectedTetrahedralParentPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.parentExteriorPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.exactContinuationPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.exactTerminalMultipleSlotPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.trigonalBisectorPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.ringExitPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.ringExitMaxPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.attachmentExteriorPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.junctionCrowdingPenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.terminalLabelClearancePenalty > IMPROVEMENT_EPSILON ||
    runnerUpScore.nearContactPenalty > IMPROVEMENT_EPSILON ||
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
    score.heavyBondCrossingPriorityCount === 0 &&
    score.readability.failingSubstituentCount === 0 &&
    score.fusedJunctionContinuationPenalty <= IMPROVEMENT_EPSILON &&
    score.parentVisibleTrigonalPenalty <= IMPROVEMENT_EPSILON &&
    score.parentOutwardPenalty <= IMPROVEMENT_EPSILON &&
    score.projectedTetrahedralParentPenalty <= IMPROVEMENT_EPSILON &&
    score.parentExteriorPenalty <= IMPROVEMENT_EPSILON &&
    score.exactContinuationPenalty <= IMPROVEMENT_EPSILON &&
    score.exactTerminalMultipleSlotPenalty <= IMPROVEMENT_EPSILON &&
    score.trigonalBisectorPenalty <= IMPROVEMENT_EPSILON &&
    score.ringExitPenalty <= IMPROVEMENT_EPSILON &&
    score.ringExitMaxPenalty <= IMPROVEMENT_EPSILON &&
    score.attachmentExteriorPenalty <= IMPROVEMENT_EPSILON &&
    score.junctionCrowdingPenalty <= IMPROVEMENT_EPSILON &&
    score.terminalLabelClearancePenalty <= IMPROVEMENT_EPSILON &&
    score.nearContactPenalty <= IMPROVEMENT_EPSILON &&
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
 * @param {{prescore?: {coords: Map<string, {x: number, y: number}>}, placementContext?: object|null, includeCandidateCoords?: boolean}} [options] - Optional scoring reuse state.
 * @returns {{layoutCost: number|null, totalCost: number|null, overlapCount: number, heavyBondCrossingCount: number, heavyBondCrossingPriorityCount: number, presentationPenalty: number, idealLeafPresentationPenalty: number, fusedJunctionContinuationPenalty: number, parentOutwardPenalty: number, exactContinuationPenalty: number, exactTerminalMultipleSlotPenalty: number, terminalLabelClearancePenalty: number, trigonalBisectorPenalty: number, ringExitMaxPenalty: number, omittedHydrogenTrigonalPenalty: number, omittedHydrogenDirectAttachmentCompromisePenalty: number, attachmentExteriorPenalty: number, junctionCrowdingPenalty: number, smallRingExteriorPenalty: number, changedAtomIds: string[], readability: {failingSubstituentCount: number, inwardSubstituentCount: number, outwardAxisFailureCount: number, totalOutwardDeviation: number, maxOutwardDeviation: number}}} Candidate layout score.
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
  const score = {
    layoutCost: null,
    totalCost: null,
    ...measureAttachedBlockCandidateState(coords, candidateCoords, bondLength, layoutGraph, candidateMeta)
  };
  if (options.includeCandidateCoords === true) {
    score.candidateCoords = candidateCoords;
  }
  return score;
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
    candidateScore.heavyBondCrossingPriorityCount * ATTACHED_BLOCK_HEAVY_BOND_CROSSING_PENALTY +
    readabilityPenalty +
    candidateScore.fusedJunctionContinuationPenalty +
    candidateScore.parentVisibleTrigonalPenalty +
    candidateScore.parentOutwardPenalty +
    candidateScore.projectedTetrahedralParentPenalty +
    candidateScore.parentExteriorPenalty +
    candidateScore.ringExitMaxPenalty +
    candidateScore.ringExitPenalty +
    candidateScore.attachmentExteriorPenalty +
    candidateScore.trigonalBisectorPenalty +
    candidateScore.exactTerminalMultipleSlotPenalty +
    candidateScore.junctionCrowdingPenalty +
    candidateScore.terminalLabelClearancePenalty +
    candidateScore.nearContactPenalty +
    candidateScore.smallRingExteriorPenalty;
  return candidateScore;
}

function compareAttachedBlockScores(cand, inc) {
  if (cand.overlapCount !== inc.overlapCount) {
    return cand.overlapCount - inc.overlapCount;
  }
  if (cand.heavyBondCrossingPriorityCount !== inc.heavyBondCrossingPriorityCount) {
    return cand.heavyBondCrossingPriorityCount - inc.heavyBondCrossingPriorityCount;
  }
  if (cand.prioritizeRingExitBeforeTerminalSlots || inc.prioritizeRingExitBeforeTerminalSlots) {
    for (const key of ['ringExitMaxPenalty', 'ringExitPenalty']) {
      if (Math.abs(cand[key] - inc[key]) > IMPROVEMENT_EPSILON) {
        return cand[key] - inc[key];
      }
    }
  }
  if (Math.abs(cand.exactTerminalMultipleSlotPenalty - inc.exactTerminalMultipleSlotPenalty) > IMPROVEMENT_EPSILON) {
    return cand.exactTerminalMultipleSlotPenalty - inc.exactTerminalMultipleSlotPenalty;
  }
  if (cand.readability.failingSubstituentCount !== inc.readability.failingSubstituentCount) {
    return cand.readability.failingSubstituentCount - inc.readability.failingSubstituentCount;
  }
  for (const key of ['fusedJunctionContinuationPenalty', 'parentVisibleTrigonalPenalty', 'parentOutwardPenalty', 'projectedTetrahedralParentPenalty', 'parentExteriorPenalty', 'exactContinuationPenalty', 'trigonalBisectorPenalty', 'ringExitMaxPenalty', 'ringExitPenalty', 'attachmentExteriorPenalty', 'junctionCrowdingPenalty', 'terminalLabelClearancePenalty', 'smallRingExteriorPenalty']) {
    if (Math.abs(cand[key] - inc[key]) > IMPROVEMENT_EPSILON) {
      return cand[key] - inc[key];
    }
  }
  if (Math.abs(cand.nearContactPenalty - inc.nearContactPenalty) > IMPROVEMENT_EPSILON) {
    return cand.nearContactPenalty - inc.nearContactPenalty;
  }
  if (Math.abs(cand.presentationPenalty - inc.presentationPenalty) > IMPROVEMENT_EPSILON) {
    return cand.presentationPenalty - inc.presentationPenalty;
  }
  return 0;
}

function compareOmittedHydrogenDirectAttachmentRefinementScores(cand, inc) {
  if (cand.overlapCount !== inc.overlapCount) {
    return cand.overlapCount - inc.overlapCount;
  }
  if (cand.heavyBondCrossingPriorityCount !== inc.heavyBondCrossingPriorityCount) {
    return cand.heavyBondCrossingPriorityCount - inc.heavyBondCrossingPriorityCount;
  }
  if (Math.abs(cand.exactTerminalMultipleSlotPenalty - inc.exactTerminalMultipleSlotPenalty) > IMPROVEMENT_EPSILON) {
    return cand.exactTerminalMultipleSlotPenalty - inc.exactTerminalMultipleSlotPenalty;
  }
  if (cand.readability.failingSubstituentCount !== inc.readability.failingSubstituentCount) {
    return cand.readability.failingSubstituentCount - inc.readability.failingSubstituentCount;
  }
  for (const key of ['fusedJunctionContinuationPenalty', 'parentVisibleTrigonalPenalty', 'parentOutwardPenalty', 'projectedTetrahedralParentPenalty', 'parentExteriorPenalty', 'exactContinuationPenalty', 'trigonalBisectorPenalty', 'ringExitMaxPenalty', 'ringExitPenalty', 'attachmentExteriorPenalty', 'junctionCrowdingPenalty', 'terminalLabelClearancePenalty']) {
    if (Math.abs(cand[key] - inc[key]) > IMPROVEMENT_EPSILON) {
      return cand[key] - inc[key];
    }
  }
  if (Math.abs(cand.nearContactPenalty - inc.nearContactPenalty) > IMPROVEMENT_EPSILON) {
    return cand.nearContactPenalty - inc.nearContactPenalty;
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
 * Returns whether a parent-spread rescue stays within its allowed no-worsen
 * envelope while allowing only sibling-root ring-exit slack.
 * @param {object} cand - Candidate rescue score.
 * @param {object} inc - Incumbent rescue score.
 * @returns {boolean} True when the candidate is within the rescue budget.
 */
function hasBoundedOmittedHydrogenParentSpreadTradeoff(cand, inc) {
  return (
    cand.overlapCount <= inc.overlapCount
    && cand.heavyBondCrossingPriorityCount <= inc.heavyBondCrossingPriorityCount
    && cand.exactTerminalMultipleSlotPenalty <= inc.exactTerminalMultipleSlotPenalty + IMPROVEMENT_EPSILON
    && cand.readability.failingSubstituentCount <= inc.readability.failingSubstituentCount
    && cand.readability.inwardSubstituentCount <= inc.readability.inwardSubstituentCount
    && cand.readability.outwardAxisFailureCount <= inc.readability.outwardAxisFailureCount
    && cand.fusedJunctionContinuationPenalty <= inc.fusedJunctionContinuationPenalty + IMPROVEMENT_EPSILON
    && cand.parentVisibleTrigonalPenalty <= inc.parentVisibleTrigonalPenalty + IMPROVEMENT_EPSILON
    && cand.parentOutwardPenalty <= IMPROVEMENT_EPSILON
    && cand.projectedTetrahedralParentPenalty <= inc.projectedTetrahedralParentPenalty + IMPROVEMENT_EPSILON
    && cand.parentExteriorPenalty <= inc.parentExteriorPenalty + IMPROVEMENT_EPSILON
    && cand.exactContinuationPenalty <= inc.exactContinuationPenalty + IMPROVEMENT_EPSILON
    && cand.attachmentExteriorPenalty <= inc.attachmentExteriorPenalty + IMPROVEMENT_EPSILON
    && cand.junctionCrowdingPenalty <= inc.junctionCrowdingPenalty + IMPROVEMENT_EPSILON
    && cand.terminalLabelClearancePenalty <= inc.terminalLabelClearancePenalty + IMPROVEMENT_EPSILON
    && cand.nearContactPenalty <= inc.nearContactPenalty + IMPROVEMENT_EPSILON
    && cand.smallRingExteriorPenalty <= inc.smallRingExteriorPenalty + IMPROVEMENT_EPSILON
    && (cand.parentSpreadAttachmentRingExitMaxPenalty ?? cand.ringExitMaxPenalty) <= (inc.parentSpreadAttachmentRingExitMaxPenalty ?? inc.ringExitMaxPenalty) + OMITTED_HYDROGEN_PARENT_SPREAD_ATTACHMENT_RING_EXIT_TRADEOFF_LIMIT + IMPROVEMENT_EPSILON
    && (cand.parentSpreadAttachmentRingExitPenalty ?? cand.ringExitPenalty) <= (inc.parentSpreadAttachmentRingExitPenalty ?? inc.ringExitPenalty) + OMITTED_HYDROGEN_PARENT_SPREAD_ATTACHMENT_RING_EXIT_TRADEOFF_LIMIT + IMPROVEMENT_EPSILON
    && cand.ringExitMaxPenalty <= inc.ringExitMaxPenalty + OMITTED_HYDROGEN_PARENT_SPREAD_RING_EXIT_TRADEOFF_LIMIT + IMPROVEMENT_EPSILON
    && cand.ringExitPenalty <= inc.ringExitPenalty + OMITTED_HYDROGEN_PARENT_SPREAD_RING_EXIT_TRADEOFF_LIMIT + IMPROVEMENT_EPSILON
    && cand.presentationPenalty <= inc.presentationPenalty + OMITTED_HYDROGEN_PARENT_SPREAD_PRESENTATION_TRADEOFF_LIMIT + IMPROVEMENT_EPSILON
    && (cand.parentSpreadAuditSevereOverlapCount ?? cand.overlapCount) <= (inc.parentSpreadAuditSevereOverlapCount ?? inc.overlapCount)
    && (cand.parentSpreadAuditBondLengthFailureCount ?? 0) <= (inc.parentSpreadAuditBondLengthFailureCount ?? 0)
    && (cand.parentSpreadAuditRingSubstituentReadabilityFailureCount ?? cand.readability.failingSubstituentCount) <= (inc.parentSpreadAuditRingSubstituentReadabilityFailureCount ?? inc.readability.failingSubstituentCount)
    && (cand.parentSpreadAuditInwardRingSubstituentCount ?? cand.readability.inwardSubstituentCount) <= (inc.parentSpreadAuditInwardRingSubstituentCount ?? inc.readability.inwardSubstituentCount)
    && (cand.parentSpreadAuditOutwardAxisRingSubstituentFailureCount ?? cand.readability.outwardAxisFailureCount) <= (inc.parentSpreadAuditOutwardAxisRingSubstituentFailureCount ?? inc.readability.outwardAxisFailureCount)
  );
}

/**
 * Compares omitted-H parent-spread rescue scores. This rescue is allowed to
 * recover an exact three-heavy parent fan only when the attached root's strict
 * ring exit, overlaps, and user-facing readability counters do not worsen.
 * @param {object} cand - Candidate rescue score.
 * @param {object} inc - Incumbent rescue score.
 * @returns {number} Negative when the candidate wins, positive when it loses.
 */
function compareOmittedHydrogenParentSpreadRescueScores(cand, inc) {
  const candidateSpreadImprovement =
    inc.omittedHydrogenDirectAttachmentCompromisePenalty > 0.2 &&
    cand.omittedHydrogenDirectAttachmentCompromisePenalty < inc.omittedHydrogenDirectAttachmentCompromisePenalty - 0.2 &&
    hasBoundedOmittedHydrogenParentSpreadTradeoff(cand, inc);
  const incumbentSpreadImprovement =
    cand.omittedHydrogenDirectAttachmentCompromisePenalty > 0.2 &&
    inc.omittedHydrogenDirectAttachmentCompromisePenalty < cand.omittedHydrogenDirectAttachmentCompromisePenalty - 0.2 &&
    hasBoundedOmittedHydrogenParentSpreadTradeoff(inc, cand);

  if (candidateSpreadImprovement && !incumbentSpreadImprovement) {
    return -1;
  }
  if (!candidateSpreadImprovement && incumbentSpreadImprovement) {
    return 1;
  }
  const candidateAttachmentRingExitImprovement =
    (inc.parentSpreadAttachmentRingExitMaxPenalty ?? inc.ringExitMaxPenalty) > IMPROVEMENT_EPSILON &&
    (cand.parentSpreadAttachmentRingExitMaxPenalty ?? cand.ringExitMaxPenalty) < (inc.parentSpreadAttachmentRingExitMaxPenalty ?? inc.ringExitMaxPenalty) - IMPROVEMENT_EPSILON &&
    hasBoundedOmittedHydrogenParentSpreadTradeoff(cand, inc);
  const incumbentAttachmentRingExitImprovement =
    (cand.parentSpreadAttachmentRingExitMaxPenalty ?? cand.ringExitMaxPenalty) > IMPROVEMENT_EPSILON &&
    (inc.parentSpreadAttachmentRingExitMaxPenalty ?? inc.ringExitMaxPenalty) < (cand.parentSpreadAttachmentRingExitMaxPenalty ?? cand.ringExitMaxPenalty) - IMPROVEMENT_EPSILON &&
    hasBoundedOmittedHydrogenParentSpreadTradeoff(inc, cand);

  if (candidateAttachmentRingExitImprovement && !incumbentAttachmentRingExitImprovement) {
    return -1;
  }
  if (!candidateAttachmentRingExitImprovement && incumbentAttachmentRingExitImprovement) {
    return 1;
  }
  return compareOmittedHydrogenDirectAttachmentRefinementScores(cand, inc);
}

/**
 * Selects the best omitted-H parent-spread rescue using the same full
 * attached-block scoring as ordinary candidates, but with the omitted-H
 * compromise comparator so an audit-clean exact 120-degree parent fan can beat
 * a generic layout-cost tie.
 * @param {Array<{transformedCoords: Map<string, {x: number, y: number}>, meta?: object|null}>} candidates - Candidate orientations.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, number>} canonicalAtomRank - Canonical atom-rank map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} primaryNonRingAtomIds - Heavy non-ring atom IDs.
 * @param {Iterable<string>} placedAtomIds - Already placed atom IDs.
 * @param {number} bondLength - Target bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number}>}|null} [branchConstraints] - Optional branch-angle constraints.
 * @param {{placementContext?: object|null}} [options] - Optional reusable branch-placement context.
 * @returns {{transformedCoords: Map<string, {x: number, y: number}>, score: object, meta?: object|null}|null} Best rescue candidate.
 */
function pickBestOmittedHydrogenParentSpreadRescueCandidate(
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
  let bestCandidate = null;
  let bestScore = null;

  for (const candidate of candidates) {
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
        placementContext: options.placementContext ?? null,
        includeCandidateCoords: true
      }
    );
    const candidateAudit = auditLayout(layoutGraph, candidateScore.candidateCoords, { bondLength });
    candidateScore.parentSpreadAuditSevereOverlapCount = candidateAudit.severeOverlapCount;
    candidateScore.parentSpreadAuditBondLengthFailureCount = candidateAudit.bondLengthFailureCount;
    candidateScore.parentSpreadAuditRingSubstituentReadabilityFailureCount = candidateAudit.ringSubstituentReadabilityFailureCount;
    candidateScore.parentSpreadAuditInwardRingSubstituentCount = candidateAudit.inwardRingSubstituentCount;
    candidateScore.parentSpreadAuditOutwardAxisRingSubstituentFailureCount = candidateAudit.outwardAxisRingSubstituentFailureCount;
    const attachmentRingExitPenaltySummary = candidate.meta?.attachmentAtomId && candidate.meta?.parentAtomId
      ? measureAttachedRootIncidentRingExitPenalty(
          layoutGraph,
          candidateScore.candidateCoords,
          candidate.meta.attachmentAtomId,
          candidate.meta.parentAtomId
        )
      : { totalDeviation: 0, maxDeviation: 0 };
    candidateScore.parentSpreadAttachmentRingExitPenalty = attachmentRingExitPenaltySummary.totalDeviation;
    candidateScore.parentSpreadAttachmentRingExitMaxPenalty = attachmentRingExitPenaltySummary.maxDeviation;
    delete candidateScore.candidateCoords;
    if (
      candidate.meta?.omittedHydrogenParentSpreadRescue === true &&
      (
        candidateScore.parentOutwardPenalty > IMPROVEMENT_EPSILON ||
        candidateScore.parentSpreadAttachmentRingExitMaxPenalty > IMPROVEMENT_EPSILON ||
        candidateScore.parentSpreadAttachmentRingExitPenalty > IMPROVEMENT_EPSILON
      )
    ) {
      continue;
    }
    const comparison = bestScore == null
      ? -1
      : compareOmittedHydrogenParentSpreadRescueScores(candidateScore, bestScore);
    let shouldReplaceBestCandidate = comparison < 0;
    if (comparison === 0 && bestCandidate) {
      ensureAttachedBlockLayoutCost(candidateScore, candidate.transformedCoords, layoutGraph, bondLength);
      ensureAttachedBlockLayoutCost(bestScore, bestCandidate.transformedCoords, layoutGraph, bondLength);
      shouldReplaceBestCandidate =
        candidateScore.totalCost < bestScore.totalCost - IMPROVEMENT_EPSILON ||
        (
          Math.abs(candidateScore.totalCost - bestScore.totalCost) <= IMPROVEMENT_EPSILON
          && compareCoordMapsDeterministically(candidate.transformedCoords, bestCandidate.transformedCoords, layoutGraph.canonicalAtomRank) < 0
        );
    }

    if (shouldReplaceBestCandidate) {
      bestCandidate = candidate;
      bestScore = candidateScore;
    }
  }

  return bestCandidate && bestScore
    ? {
        transformedCoords: bestCandidate.transformedCoords,
        meta: bestCandidate.meta ?? null,
        score: bestScore
      }
    : null;
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
    && cand.projectedTetrahedralParentPenalty <= IMPROVEMENT_EPSILON
    && cand.parentExteriorPenalty <= IMPROVEMENT_EPSILON
    && cand.ringExitPenalty <= IMPROVEMENT_EPSILON;
  const incumbentIsExact =
    inc.parentVisibleTrigonalPenalty <= IMPROVEMENT_EPSILON
    && inc.trigonalBisectorPenalty <= IMPROVEMENT_EPSILON
    && inc.parentOutwardPenalty <= IMPROVEMENT_EPSILON
    && inc.projectedTetrahedralParentPenalty <= IMPROVEMENT_EPSILON
    && inc.parentExteriorPenalty <= IMPROVEMENT_EPSILON
    && inc.ringExitPenalty <= IMPROVEMENT_EPSILON;
  if (
    candidateIsExact
    && !incumbentIsExact
    && inc.overlapCount > 0
    && cand.overlapCount <= Math.min(inc.overlapCount + 2, 3)
    && cand.readability.failingSubstituentCount <= inc.readability.failingSubstituentCount
    && cand.fusedJunctionContinuationPenalty <= inc.fusedJunctionContinuationPenalty + IMPROVEMENT_EPSILON
    && cand.projectedTetrahedralParentPenalty <= inc.projectedTetrahedralParentPenalty + IMPROVEMENT_EPSILON
    && cand.parentExteriorPenalty <= inc.parentExteriorPenalty + IMPROVEMENT_EPSILON
    && cand.exactContinuationPenalty <= inc.exactContinuationPenalty + IMPROVEMENT_EPSILON
    && cand.ringExitPenalty <= inc.ringExitPenalty + IMPROVEMENT_EPSILON
    && cand.attachmentExteriorPenalty <= inc.attachmentExteriorPenalty + IMPROVEMENT_EPSILON
    && cand.junctionCrowdingPenalty <= inc.junctionCrowdingPenalty + IMPROVEMENT_EPSILON
    && cand.nearContactPenalty <= inc.nearContactPenalty + IMPROVEMENT_EPSILON
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
    && inc.projectedTetrahedralParentPenalty <= cand.projectedTetrahedralParentPenalty + IMPROVEMENT_EPSILON
    && inc.parentExteriorPenalty <= cand.parentExteriorPenalty + IMPROVEMENT_EPSILON
    && inc.exactContinuationPenalty <= cand.exactContinuationPenalty + IMPROVEMENT_EPSILON
    && inc.ringExitPenalty <= cand.ringExitPenalty + IMPROVEMENT_EPSILON
    && inc.attachmentExteriorPenalty <= cand.attachmentExteriorPenalty + IMPROVEMENT_EPSILON
    && inc.junctionCrowdingPenalty <= cand.junctionCrowdingPenalty + IMPROVEMENT_EPSILON
    && inc.nearContactPenalty <= cand.nearContactPenalty + IMPROVEMENT_EPSILON
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
 * @returns {{transformedCoords: Map<string, {x: number, y: number}>, score: {layoutCost: number|null, totalCost: number|null, overlapCount: number, presentationPenalty: number, exactContinuationPenalty: number, exactTerminalMultipleSlotPenalty: number, terminalLabelClearancePenalty: number, ringExitMaxPenalty: number, omittedHydrogenTrigonalPenalty: number, omittedHydrogenDirectAttachmentCompromisePenalty: number, readability: {failingSubstituentCount: number, inwardSubstituentCount: number, outwardAxisFailureCount: number, totalOutwardDeviation: number, maxOutwardDeviation: number}}, meta?: object}|null} Best scored candidate.
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
    || scoredCandidates.some(candidate =>
      directAttachmentCandidateNeedsBranchScoring(candidate, primaryNonRingAtomIds, new Set(placedAtomIds))
    )
    || hasPendingExactVisibleTrigonalContinuation(layoutGraph, coords, primaryNonRingAtomIds)
    || scoredCandidates.some(candidate => (candidate._prescore?.exactTerminalMultipleSlotPenalty ?? 0) > IMPROVEMENT_EPSILON)
    || scoredCandidates.some(candidate => (candidate._prescore?.projectedTetrahedralParentPenalty ?? 0) > IMPROVEMENT_EPSILON)
    || scoredCandidates.some(candidate => (candidate._prescore?.parentExteriorPenalty ?? 0) > IMPROVEMENT_EPSILON)
    || hasSensitiveDirectAttachmentCandidates(layoutGraph, coords, scoredCandidates);
  const [bestPrescoredCandidate, secondPrescoredCandidate] = scoredCandidates;
  const canAcceptExactChildRootPrescore =
    bestPrescoredCandidate
    && supportsExactDirectAttachmentChildRingRootOutward(
      layoutGraph,
      bestPrescoredCandidate.meta?.parentAtomId ?? null,
      bestPrescoredCandidate.meta?.attachmentAtomId ?? null
    )
    && bestPrescoredCandidate._prescore.overlapCount === 0
    && bestPrescoredCandidate._prescore.heavyBondCrossingPriorityCount === 0
    && bestPrescoredCandidate._prescore.readability.failingSubstituentCount === 0
    && bestPrescoredCandidate._prescore.ringExitPenalty <= IMPROVEMENT_EPSILON
    && bestPrescoredCandidate._prescore.presentationPenalty <= IMPROVEMENT_EPSILON;
  if (canAcceptExactChildRootPrescore) {
    return {
      transformedCoords: bestPrescoredCandidate.transformedCoords,
      score: bestPrescoredCandidate._prescore,
      meta: bestPrescoredCandidate.meta ?? null
    };
  }
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
 * @returns {{coords: Map<string, {x: number, y: number}>, overlapCount: number, heavyBondCrossingCount: number, heavyBondCrossingPriorityCount: number, failingSubstituentCount: number, fusedJunctionContinuationPenalty: number, parentExteriorPenalty: number, exactContinuationPenalty: number, exactTerminalMultipleSlotPenalty: number, terminalLabelClearancePenalty: number, trigonalBisectorPenalty: number, ringExitMaxPenalty: number, omittedHydrogenTrigonalPenalty: number, omittedHydrogenDirectAttachmentCompromisePenalty: number, presentationPenalty: number, cost: number}} Prescored candidate snapshot.
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
    if (firstCandidate.heavyBondCrossingPriorityCount !== secondCandidate.heavyBondCrossingPriorityCount) {
      return firstCandidate.heavyBondCrossingPriorityCount - secondCandidate.heavyBondCrossingPriorityCount;
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
    if (Math.abs(firstCandidate.projectedTetrahedralParentPenalty - secondCandidate.projectedTetrahedralParentPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.projectedTetrahedralParentPenalty - secondCandidate.projectedTetrahedralParentPenalty;
    }
    if (Math.abs(firstCandidate.parentExteriorPenalty - secondCandidate.parentExteriorPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.parentExteriorPenalty - secondCandidate.parentExteriorPenalty;
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
    if (Math.abs(firstCandidate.terminalLabelClearancePenalty - secondCandidate.terminalLabelClearancePenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.terminalLabelClearancePenalty - secondCandidate.terminalLabelClearancePenalty;
    }
    if (Math.abs(firstCandidate.nearContactPenalty - secondCandidate.nearContactPenalty) > IMPROVEMENT_EPSILON) {
      return firstCandidate.nearContactPenalty - secondCandidate.nearContactPenalty;
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
  const hasProjectedTetrahedralParentChoice =
    scoredCandidates.some(candidate => candidate.projectedTetrahedralParentPenalty > IMPROVEMENT_EPSILON)
    && scoredCandidates.some(candidate => candidate.projectedTetrahedralParentPenalty <= IMPROVEMENT_EPSILON);
  if (hasProjectedTetrahedralParentChoice) {
    return scoredCandidates;
  }
  const hasParentExteriorChoice =
    scoredCandidates.some(candidate => candidate.parentExteriorPenalty > IMPROVEMENT_EPSILON)
    && scoredCandidates.some(candidate => candidate.parentExteriorPenalty <= IMPROVEMENT_EPSILON);
  if (hasParentExteriorChoice) {
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
 * @param {object[]} pendingRingSystems - Ring systems not yet placed.
 * @returns {{remaining: object[], progressed: boolean}} Unplaced ring systems and whether any placement succeeded.
 */
function attachLinkerRingSystems(layoutGraph, adjacency, bondLength, state, pendingRingSystems) {
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
  const remaining = [];
  let progressed = false;
  for (const pendingRingSystem of pendingRingSystems) {
    const linker = findShortestRingLinker(layoutGraph, pendingRingSystem.ringSystem, placedRingSystemIds, participantAtomIds, atomToRingSystemId);
    if (!linker || linker.chainAtomIds.some(atomId => coords.has(atomId))) {
      remaining.push(pendingRingSystem);
      continue;
    }
    const firstRingSystem = ringSystemById.get(linker.firstRingSystemId);
    const blockLayout = getPendingRingLayout(pendingRingLayoutCache, layoutGraph, pendingRingSystem, bondLength);
    if (!firstRingSystem || !blockLayout || !isSupportedRingLinker(layoutGraph, firstRingSystem, pendingRingSystem.ringSystem, linker)) {
      remaining.push(pendingRingSystem);
      continue;
    }

    const turnSigns = linker.chainAtomIds.length === 0 ? [1] : [-1, 1];
    let bestCandidateCoords = null;
    const rawCandidates = [];
    const allowExpandedRingLinkerRotations =
      (layoutGraph.traits.heavyAtomCount ?? 0) <= EXACT_ATTACHMENT_SEARCH_HEAVY_ATOM_LIMIT && pendingRingSystem.ringSystem.atomIds.length <= 18;
    const linkedRingAttachmentMeta = {
      attachmentAtomId: linker.secondAttachmentAtomId,
      parentAtomId: linker.chainAtomIds[linker.chainAtomIds.length - 1] ?? linker.firstAttachmentAtomId
    };
    const buildLinkedRingCandidate = (turnSign, mirror, ringRotationOffset = 0, placedRingRotationOffset = 0) => ({
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
      ),
      meta: {
        ...linkedRingAttachmentMeta,
        linkedRing: true,
        mirror,
        placedRingRotationOffset,
        ringRotationOffset,
        turnSign
      }
    });
    for (const turnSign of turnSigns) {
      for (const mirror of [false, true]) {
        rawCandidates.push(buildLinkedRingCandidate(turnSign, mirror));
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
              rawCandidates.push(buildLinkedRingCandidate(turnSign, mirror, ringRotationOffset, placedRingRotationOffset));
            }
          }
        }
      }
    }
    for (const candidate of [...rawCandidates]) {
      rawCandidates.push(
        ...buildDirectAttachmentExactRingExitRescueCandidates(
          layoutGraph,
          coords,
          candidate.transformedCoords,
          candidate.meta ?? linkedRingAttachmentMeta
        )
      );
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
      remaining.push(pendingRingSystem);
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
  return { remaining, progressed };
}

function attachDirectRingSystems(layoutGraph, adjacency, bondLength, state, pendingRingSystems) {
  const {
    participantAtomIds,
    coords,
    placedAtomIds,
    bondValidationClasses,
    placedRingSystemIds,
    macrocycleBranchConstraints,
    primaryNonRingAtomIds,
    pendingRingLayoutCache,
    pendingRingAttachmentResnapAtomIds
  } = state;
  const remaining = [];
  let progressed = false;
  for (const pendingRingSystem of pendingRingSystems) {
    const attachment = findAttachmentBond(layoutGraph, pendingRingSystem.ringSystem, placedAtomIds);
    if (!attachment) {
      remaining.push(pendingRingSystem);
      continue;
    }
    const blockLayout = getPendingRingLayout(pendingRingLayoutCache, layoutGraph, pendingRingSystem, bondLength);
    if (!blockLayout) {
      remaining.push(pendingRingSystem);
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
    let prioritizeRingExitBeforeTerminalSlots = false;
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
          prioritizeRingExitBeforeTerminalSlots,
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
      ...exactDirectAttachmentProjectedTetrahedralParentAngles(
        layoutGraph,
        coords,
        {
          attachmentAtomId: attachment.attachmentAtomId,
          parentAtomId: attachment.parentAtomId
        }
      ),
      ...exactDirectAttachmentSimpleAcyclicHeteroarylAngles(
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
      ...exactDirectAttachmentParentRingOutwardAngles(
        layoutGraph,
        coords,
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
    rawAttachedBlockCandidates.push(
      ...rawAttachedBlockCandidates.flatMap(candidate =>
        buildAttachedBlockTerminalCarbonylLeafEscapeCandidates(
          layoutGraph,
          coords,
          candidate.transformedCoords,
          bondLength,
          candidate.meta ?? {
            attachmentAtomId: attachment.attachmentAtomId,
            parentAtomId: attachment.parentAtomId
          }
        )
      )
    );
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
    const exactParentRingOutwardDirectAttachment = exactDirectAttachmentParentRingOutwardAngles(
      layoutGraph,
      coords,
      {
        attachmentAtomId: attachment.attachmentAtomId,
        parentAtomId: attachment.parentAtomId
      }
    ).length > 0;
    const exactVisibleTrigonalAromaticDirectAttachment =
      layoutGraph.atoms.get(attachment.attachmentAtomId)?.aromatic
      && isExactVisibleTrigonalBisectorEligible(layoutGraph, attachment.parentAtomId, attachment.attachmentAtomId);
    const exactChildRingRootOutwardDirectAttachment = supportsExactDirectAttachmentChildRingRootOutward(
      layoutGraph,
      attachment.parentAtomId,
      attachment.attachmentAtomId
    );
    // Ring-presentation rescue may rotate the child block, but simple acyclic
    // parent continuations must stay on their exact branch angle.
    const lockDirectAttachmentAngle =
      directAttachmentTrigonalSensitivity.strict
      || directAttachmentTrigonalSensitivity.omittedHydrogen
      || exactParentRingOutwardDirectAttachment
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
      (exactVisibleTrigonalAromaticDirectAttachment || exactChildRingRootOutwardDirectAttachment) &&
      (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) > IMPROVEMENT_EPSILON;
    const shouldExpandForExactRingExit =
      (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) > IMPROVEMENT_EPSILON;
    const shouldExpandForExactParentRingOutwardOverlap =
      exactParentRingOutwardDirectAttachment && (bestAttachedBlockCandidate?.score.overlapCount ?? 0) > 0;
    if (
      allowExpandedDirectAttachmentRotations &&
      (shouldExpandForSensitiveOverlap ||
        shouldExpandForExactAromaticRingExit ||
        shouldExpandForExactRingExit ||
        shouldExpandForExactParentRingOutwardOverlap ||
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
      const allowCrowdedExactRingRootAngleExpansion =
        directAttachmentTrigonalSensitivity.omittedHydrogen &&
        (bestAttachedBlockCandidate?.score.overlapCount ?? 0) > 0 &&
        (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) === 0 &&
        (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) <= IMPROVEMENT_EPSILON &&
        (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) <= IMPROVEMENT_EPSILON &&
        (layoutGraph.atomToRings.get(attachment.attachmentAtomId)?.length ?? 0) > 0;
      const allowLockedStrictTrigonalAngleExpansion =
        directAttachmentTrigonalSensitivity.strict &&
        (layoutGraph.atomToRings.get(attachment.attachmentAtomId)?.length ?? 0) > 0;
      prioritizeRingExitBeforeTerminalSlots = allowCrowdedExactRingRootAngleExpansion;
      const directAttachmentAngleOffsets =
        lockDirectAttachmentAngle
          && !allowLockedOmittedHydrogenAngleExpansion
          && !allowCrowdedExactRingRootAngleExpansion
          && !allowLockedStrictTrigonalAngleExpansion
          ? [0]
          : DIRECT_ATTACHMENT_ROTATION_OFFSETS;
      const expandedRingRotationOffsets = [...directAttachmentRingRotationOffsets];
      if (exactParentRingOutwardDirectAttachment) {
        for (const ringRotationOffset of [
          Math.PI / 12,
          -(Math.PI / 12),
          Math.PI / 6,
          -(Math.PI / 6),
          Math.PI - (Math.PI / 6),
          -(Math.PI - (Math.PI / 6))
        ]) {
          if (!expandedRingRotationOffsets.some(candidateOffset => angularDifference(candidateOffset, ringRotationOffset) <= 1e-9)) {
            expandedRingRotationOffsets.push(ringRotationOffset);
          }
        }
      }
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
      const expandedCandidatePool = shouldProbeMirroredParentSubtrees
        ? [
            ...expandedCandidates,
            ...expandedCandidates.flatMap(candidate =>
              buildMirroredParentSideSubtreeCandidates(layoutGraph, coords, candidate.transformedCoords, candidate.meta ?? null)
            )
          ]
        : expandedCandidates;
      const candidatePool = [
        ...expandedCandidatePool,
        ...expandedCandidatePool.flatMap(candidate =>
          buildAttachedBlockTerminalCarbonylLeafEscapeCandidates(
            layoutGraph,
            coords,
            candidate.transformedCoords,
            bondLength,
            candidate.meta ?? {
              attachmentAtomId: attachment.attachmentAtomId,
              parentAtomId: attachment.parentAtomId
            }
          )
        )
      ];
      directAttachmentTrigonalRescueSources = selectAttachedBlockCandidates(candidatePool, coords, bondLength, layoutGraph).slice(0, 2);
      const shouldScoreAllExpandedDirectAttachmentCandidates =
        (bestAttachedBlockCandidate?.score.overlapCount ?? 0) > 0 ||
        (bestAttachedBlockCandidate?.score.readability.failingSubstituentCount ?? 0) > 0 ||
        (bestAttachedBlockCandidate?.score.parentOutwardPenalty ?? 0) > IMPROVEMENT_EPSILON ||
        (bestAttachedBlockCandidate?.score.trigonalBisectorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
        (bestAttachedBlockCandidate?.score.ringExitPenalty ?? 0) > IMPROVEMENT_EPSILON ||
        (bestAttachedBlockCandidate?.score.attachmentExteriorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
        exactSmallRingExteriorDirectAttachment ||
        shouldExpandForExactParentRingOutwardOverlap ||
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
        bondLength,
        layoutGraph,
        attachment.parentAtomId
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
    let omittedHydrogenAttachmentRingExitPenalty = 0;
    if (
      directAttachmentTrigonalSensitivity.omittedHydrogen &&
      bestAttachedBlockCandidate?.transformedCoords
    ) {
      const candidateCoords = new Map(coords);
      for (const [atomId, position] of bestAttachedBlockCandidate.transformedCoords) {
        candidateCoords.set(atomId, position);
      }
      const candidateMeta = bestAttachedBlockCandidate.meta ?? {
        attachmentAtomId: attachment.attachmentAtomId,
        parentAtomId: attachment.parentAtomId
      };
      omittedHydrogenAttachmentRingExitPenalty = measureAttachedRootIncidentRingExitPenalty(
        layoutGraph,
        candidateCoords,
        candidateMeta.attachmentAtomId,
        candidateMeta.parentAtomId
      ).maxDeviation;
    }
    if (
      directAttachmentTrigonalSensitivity.omittedHydrogen &&
      bestAttachedBlockCandidate?.transformedCoords &&
      (
        (bestAttachedBlockCandidate?.score.trigonalBisectorPenalty ?? 0) > IMPROVEMENT_EPSILON ||
        (bestAttachedBlockCandidate?.score.omittedHydrogenTrigonalPenalty ?? 0) > 0.2 ||
        omittedHydrogenAttachmentRingExitPenalty > IMPROVEMENT_EPSILON
      )
    ) {
      const omittedHydrogenParentSpreadCandidates = buildDirectAttachmentOmittedHydrogenParentSpreadRescueCandidates(
        layoutGraph,
        coords,
        bestAttachedBlockCandidate.transformedCoords,
        bestAttachedBlockCandidate.meta ?? {
          attachmentAtomId: attachment.attachmentAtomId,
          parentAtomId: attachment.parentAtomId
        }
      );
      if (omittedHydrogenParentSpreadCandidates.length > 0) {
        const rescueBestCandidate = pickBestOmittedHydrogenParentSpreadRescueCandidate(
          [
            {
              transformedCoords: bestAttachedBlockCandidate.transformedCoords,
              meta: bestAttachedBlockCandidate.meta ?? {
                attachmentAtomId: attachment.attachmentAtomId,
                parentAtomId: attachment.parentAtomId
              }
            },
            ...omittedHydrogenParentSpreadCandidates
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
            placementContext: state.branchPlacementContext
          }
        );
        if (rescueBestCandidate) {
          bestAttachedBlockCandidate = rescueBestCandidate;
        }
      }
    }
    const omittedHydrogenParentSpreadKeepsAttachedRootExact = (() => {
      if (
        !directAttachmentTrigonalSensitivity.omittedHydrogen ||
        bestAttachedBlockCandidate?.meta?.omittedHydrogenParentSpreadRescue !== true ||
        !bestAttachedBlockCandidate?.transformedCoords
      ) {
        return false;
      }
      const candidateCoords = new Map(coords);
      for (const [atomId, position] of bestAttachedBlockCandidate.transformedCoords) {
        candidateCoords.set(atomId, position);
      }
      const candidateMeta = bestAttachedBlockCandidate.meta ?? {
        attachmentAtomId: attachment.attachmentAtomId,
        parentAtomId: attachment.parentAtomId
      };
      return measureAttachedRootIncidentRingExitPenalty(
        layoutGraph,
        candidateCoords,
        candidateMeta.attachmentAtomId,
        candidateMeta.parentAtomId
      ).maxDeviation <= IMPROVEMENT_EPSILON;
    })();
    if (
      bestAttachedBlockCandidate?.transformedCoords
      && !omittedHydrogenParentSpreadKeepsAttachedRootExact
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
      (exactVisibleTrigonalAromaticDirectAttachment || exactChildRingRootOutwardDirectAttachment) &&
      bestAttachedBlockCandidate?.transformedCoords
      && !omittedHydrogenParentSpreadKeepsAttachedRootExact
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
        : exactVisibleTrigonalAromaticDirectAttachment
          ? [
              ...exactRingExitRescueCandidates,
              ...exactRingExitRescueCandidates.flatMap(candidate =>
                buildMirroredParentSideSubtreeCandidates(layoutGraph, coords, candidate.transformedCoords, candidate.meta ?? null)
              )
            ]
          : exactRingExitRescueCandidates;
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
      && !omittedHydrogenParentSpreadKeepsAttachedRootExact
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
        bondLength,
        layoutGraph,
        attachment.parentAtomId
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
      remaining.push(pendingRingSystem);
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
  return { remaining, progressed };
}

function attachPendingRingSystems(layoutGraph, adjacency, bondLength, state) {
  const { coords, primaryNonRingAtomIds } = state;
  let pendingRingSystems = [...state.pendingRingSystems];

  let progressed = true;
  while (progressed) {
    progressed = false;
    const linkerResult = attachLinkerRingSystems(layoutGraph, adjacency, bondLength, state, pendingRingSystems);
    pendingRingSystems = linkerResult.remaining;
    if (linkerResult.progressed) { progressed = true; }

    const sizeBeforeBranches = coords.size;
    placeMixedBranches(layoutGraph, adjacency, bondLength, state, primaryNonRingAtomIds);
    if (coords.size > sizeBeforeBranches) { progressed = true; }

    const directResult = attachDirectRingSystems(layoutGraph, adjacency, bondLength, state, pendingRingSystems);
    pendingRingSystems = directResult.remaining;
    if (directResult.progressed) { progressed = true; }
  }

  state.pendingRingSystems = pendingRingSystems;
}

function isTerminalMultipleHeteroLeaf(layoutGraph, centerAtomId, neighborAtomId) {
  const bond = findLayoutBond(layoutGraph, centerAtomId, neighborAtomId);
  const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.aromatic
    && (bond.order ?? 1) >= 2
    && neighborAtom
    && neighborAtom.element !== 'C'
    && neighborAtom.element !== 'H'
    && neighborAtom.heavyDegree === 1
  );
}

function hypervalentCarbonylRingSwapDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const [centerAtomId, centerAtom] of layoutGraph.atoms) {
    if (
      !centerAtom
      || centerAtom.element !== 'C'
      || centerAtom.aromatic
      || centerAtom.heavyDegree !== 3
      || !coords.has(centerAtomId)
    ) {
      continue;
    }

    let hypervalentNeighborId = null;
    let terminalMultipleLeafAtomId = null;
    let ringRootAtomId = null;
    for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
        continue;
      }
      const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
        continue;
      }
      if ((bond.order ?? 1) === 1 && describeCrossLikeHypervalentCenter(layoutGraph, neighborAtomId)) {
        hypervalentNeighborId = neighborAtomId;
        continue;
      }
      if (isTerminalMultipleHeteroLeaf(layoutGraph, centerAtomId, neighborAtomId)) {
        terminalMultipleLeafAtomId = neighborAtomId;
        continue;
      }
      if ((bond.order ?? 1) === 1 && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
        ringRootAtomId = neighborAtomId;
      }
    }

    if (hypervalentNeighborId && terminalMultipleLeafAtomId && ringRootAtomId) {
      descriptors.push({
        centerAtomId,
        hypervalentNeighborId,
        terminalMultipleLeafAtomId,
        ringRootAtomId
      });
    }
  }

  return descriptors.sort((firstDescriptor, secondDescriptor) => (
    compareCanonicalIds(firstDescriptor.hypervalentNeighborId, secondDescriptor.hypervalentNeighborId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstDescriptor.centerAtomId, secondDescriptor.centerAtomId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstDescriptor.ringRootAtomId, secondDescriptor.ringRootAtomId, layoutGraph.canonicalAtomRank)
  ));
}

function swapSiblingSubtreesAroundCenter(layoutGraph, coords, centerAtomId, firstRootAtomId, secondRootAtomId) {
  const centerPosition = coords.get(centerAtomId);
  const firstRootPosition = coords.get(firstRootAtomId);
  const secondRootPosition = coords.get(secondRootAtomId);
  if (!centerPosition || !firstRootPosition || !secondRootPosition) {
    return null;
  }

  const firstSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, firstRootAtomId, centerAtomId)
    .filter(atomId => coords.has(atomId));
  const secondSubtreeAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, secondRootAtomId, centerAtomId)
    .filter(atomId => coords.has(atomId));
  if (firstSubtreeAtomIds.length === 0 || secondSubtreeAtomIds.length === 0) {
    return null;
  }

  const firstRotation =
    angleOf(sub(secondRootPosition, centerPosition)) - angleOf(sub(firstRootPosition, centerPosition));
  const secondRotation =
    angleOf(sub(firstRootPosition, centerPosition)) - angleOf(sub(secondRootPosition, centerPosition));
  const candidateCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  for (const atomId of firstSubtreeAtomIds) {
    candidateCoords.set(
      atomId,
      add(secondRootPosition, rotate(sub(coords.get(atomId), firstRootPosition), firstRotation))
    );
  }
  for (const atomId of secondSubtreeAtomIds) {
    candidateCoords.set(
      atomId,
      add(firstRootPosition, rotate(sub(coords.get(atomId), secondRootPosition), secondRotation))
    );
  }
  return candidateCoords;
}

function carbonylRingSwapAuditImproves(candidateAudit, incumbentAudit) {
  if (!candidateAudit || !incumbentAudit) {
    return false;
  }
  for (const key of [
    'bondLengthFailureCount',
    'mildBondLengthFailureCount',
    'severeBondLengthFailureCount',
    'labelOverlapCount',
    'collapsedMacrocycleCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount'
  ]) {
    if ((candidateAudit[key] ?? 0) > (incumbentAudit[key] ?? 0)) {
      return false;
    }
  }
  if ((candidateAudit.stereoContradiction ?? false) && !(incumbentAudit.stereoContradiction ?? false)) {
    return false;
  }
  return (
    (candidateAudit.severeOverlapCount ?? 0) < (incumbentAudit.severeOverlapCount ?? 0)
    || (
      (candidateAudit.severeOverlapCount ?? 0) === (incumbentAudit.severeOverlapCount ?? 0)
      && (candidateAudit.severeOverlapPenalty ?? 0) < (incumbentAudit.severeOverlapPenalty ?? 0) - 1e-6
    )
  );
}

function resolveHypervalentCarbonylRingSiblingSwaps(layoutGraph, coords, bondValidationClasses, bondLength) {
  const descriptors = hypervalentCarbonylRingSwapDescriptors(layoutGraph, coords);
  if (descriptors.length === 0) {
    return { changed: false };
  }

  let bestCoords = coords;
  let bestAudit = auditMixedPlacement(layoutGraph, { coords: bestCoords, bondValidationClasses }, bondLength);
  let changed = false;
  for (const descriptor of descriptors) {
    const candidateCoords = swapSiblingSubtreesAroundCenter(
      layoutGraph,
      bestCoords,
      descriptor.centerAtomId,
      descriptor.terminalMultipleLeafAtomId,
      descriptor.ringRootAtomId
    );
    if (!candidateCoords) {
      continue;
    }
    const candidateAudit = auditMixedPlacement(layoutGraph, { coords: candidateCoords, bondValidationClasses }, bondLength);
    if (
      carbonylRingSwapAuditImproves(candidateAudit, bestAudit)
      && isBetterMixedRootPlacement(
        { coords: candidateCoords },
        candidateAudit,
        { coords: bestCoords },
        bestAudit,
        layoutGraph.canonicalAtomRank,
        layoutGraph,
        bondLength
      )
    ) {
      bestCoords = candidateCoords;
      bestAudit = candidateAudit;
      changed = true;
    }
  }

  if (changed) {
    overwriteCoordMap(coords, bestCoords);
  }
  return { changed };
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

/**
 * Returns the closest contact between an exact terminal non-carbon ring leaf
 * and any other ring atom outside its own ring system.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @returns {number} Closest ring contact distance, or infinity when absent.
 */
function exactTerminalRingLeafContactDistance(layoutGraph, coords) {
  let closestContactDistance = Number.POSITIVE_INFINITY;
  for (const [leafAtomId, leafPosition] of coords) {
    const anchorAtomId = exactTerminalRingLeafAnchor(layoutGraph, coords, leafAtomId);
    if (!anchorAtomId) {
      continue;
    }
    const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
    for (const [atomId, atom] of layoutGraph.atoms) {
      if (
        !atom
        || atom.element === 'H'
        || atomId === leafAtomId
        || !coords.has(atomId)
        || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) === 0
        || layoutGraph.atomToRingSystemId.get(atomId) === anchorRingSystemId
      ) {
        continue;
      }
      closestContactDistance = Math.min(closestContactDistance, distance(leafPosition, coords.get(atomId)));
    }
  }
  return closestContactDistance;
}

/**
 * Runs attached-ring touchup when an exact terminal hetero ring leaf is just
 * below the readable clearance threshold for a neighboring ring. The normal
 * severe-overlap trigger intentionally ignores these mild skeleton contacts,
 * but a halogen label nearly on top of a ring atom is still visibly poor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether a rigid attached-ring touchup was accepted.
 */
function resolveExactTerminalRingLeafNearContacts(layoutGraph, coords, bondLength) {
  const clearanceThreshold = bondLength * ATTACHED_BLOCK_TERMINAL_LABEL_CLEARANCE_FACTOR;
  const baseContactDistance = exactTerminalRingLeafContactDistance(layoutGraph, coords);
  if (baseContactDistance >= clearanceThreshold - 1e-6) {
    return { changed: false };
  }

  const touchup = runAttachedRingRotationTouchup(layoutGraph, coords, {
    bondLength,
    maxPasses: 3
  });
  if ((touchup?.nudges ?? 0) <= 0) {
    return { changed: false };
  }
  const candidateContactDistance = exactTerminalRingLeafContactDistance(layoutGraph, touchup.coords);
  if (candidateContactDistance <= baseContactDistance + 0.25) {
    return { changed: false };
  }
  const baseAudit = auditLayout(layoutGraph, coords, { bondLength });
  const candidateAudit = auditLayout(layoutGraph, touchup.coords, { bondLength });
  if (!ringLeafCandidateAuditDoesNotRegress(candidateAudit, baseAudit)) {
    return { changed: false };
  }

  overwriteCoordMap(coords, touchup.coords);
  return { changed: true };
}

function terminalCarbonylLeafClosestForeignRingContact(layoutGraph, coords, descriptor) {
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!leafPosition || !descriptor.ringAnchorAtomId) {
    return { atomId: null, distance: Number.POSITIVE_INFINITY };
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(descriptor.ringAnchorAtomId);
  let closestContact = { atomId: null, distance: Number.POSITIVE_INFINITY };
  for (const [atomId, atom] of layoutGraph.atoms) {
    if (
      !atom
      || atom.element === 'H'
      || atomId === descriptor.leafAtomId
      || atomId === descriptor.centerAtomId
      || !coords.has(atomId)
      || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) === 0
      || layoutGraph.atomToRingSystemId.get(atomId) === anchorRingSystemId
    ) {
      continue;
    }
    const contactDistance = distance(leafPosition, coords.get(atomId));
    if (contactDistance < closestContact.distance - IMPROVEMENT_EPSILON) {
      closestContact = { atomId, distance: contactDistance };
    }
  }
  return closestContact;
}

function terminalCarbonylLeafForeignRingIntrusion(layoutGraph, coords, descriptor) {
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!leafPosition || !descriptor.ringAnchorAtomId) {
    return null;
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(descriptor.ringAnchorAtomId);
  for (const ring of layoutGraph.rings ?? []) {
    const ringSystemId = layoutGraph.atomToRingSystemId.get(ring.atomIds[0]);
    if (
      ringSystemId === anchorRingSystemId
      || ring.atomIds.some(atomId => !coords.has(atomId))
    ) {
      continue;
    }
    if (pointInPolygon(leafPosition, ring.atomIds.map(atomId => coords.get(atomId)))) {
      return {
        ring,
        ringSystemId
      };
    }
  }
  return null;
}

function terminalCarbonylLeafForeignRingContacts(layoutGraph, coords, clearanceThreshold) {
  const records = [];
  const seenKeys = new Set();
  for (const leafAtomId of coords.keys()) {
    const descriptor = terminalCarbonylLeafEscapeDescriptor(layoutGraph, coords, leafAtomId);
    if (!descriptor) {
      continue;
    }
    const ringAnchorAtom = layoutGraph.atoms.get(descriptor.ringAnchorAtomId);
    const leafAtom = layoutGraph.atoms.get(descriptor.leafAtomId);
    if (ringAnchorAtom?.element !== 'C' || leafAtom?.element !== 'O') {
      continue;
    }
    const terminalOxygenLeafCount = (layoutGraph.bondsByAtomId.get(descriptor.centerAtomId) ?? [])
      .filter(bond => bond?.kind === 'covalent')
      .map(bond => (bond.a === descriptor.centerAtomId ? bond.b : bond.a))
      .filter(neighborAtomId => {
        const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
        return (
          neighborAtom
          && neighborAtom.element === 'O'
          && neighborAtom.heavyDegree === 1
          && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) === 0
        );
      }).length;
    if (terminalOxygenLeafCount < 2) {
      continue;
    }
    const key = `${descriptor.centerAtomId}:${descriptor.leafAtomId}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    const contact = terminalCarbonylLeafClosestForeignRingContact(layoutGraph, coords, descriptor);
    const intrusion = terminalCarbonylLeafForeignRingIntrusion(layoutGraph, coords, descriptor);
    if (!intrusion && (!contact.atomId || contact.distance >= clearanceThreshold - 1e-6)) {
      continue;
    }
    records.push({
      descriptor,
      opposingAtomId: contact.atomId ?? intrusion.ring.atomIds[0],
      distance: contact.distance,
      intrusion
    });
  }
  return records.sort((firstRecord, secondRecord) => (
    Number(firstRecord.intrusion == null) - Number(secondRecord.intrusion == null)
    ||
    firstRecord.distance - secondRecord.distance
    || compareCanonicalIds(firstRecord.descriptor.leafAtomId, secondRecord.descriptor.leafAtomId, layoutGraph.canonicalAtomRank)
    || compareCanonicalIds(firstRecord.opposingAtomId, secondRecord.opposingAtomId, layoutGraph.canonicalAtomRank)
  ));
}

function terminalCarbonylRingContactCandidateTotalMove(coords, candidateCoords, atomIds) {
  let totalMove = 0;
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    const candidatePosition = candidateCoords.get(atomId);
    if (!position || !candidatePosition) {
      continue;
    }
    totalMove += distance(position, candidatePosition);
  }
  return totalMove;
}

function compareTerminalCarbonylRingContactCandidates(candidate, incumbent, clearanceThreshold) {
  if (!incumbent) {
    return -1;
  }
  if (candidate.insideForeignRing !== incumbent.insideForeignRing) {
    return candidate.insideForeignRing ? 1 : -1;
  }
  const candidateClears = candidate.contactDistance >= clearanceThreshold - 1e-6;
  const incumbentClears = incumbent.contactDistance >= clearanceThreshold - 1e-6;
  if (candidateClears !== incumbentClears) {
    return candidateClears ? -1 : 1;
  }
  if (!candidateClears && Math.abs(candidate.contactDistance - incumbent.contactDistance) > IMPROVEMENT_EPSILON) {
    return incumbent.contactDistance - candidate.contactDistance;
  }
  if (Math.abs(candidate.localDeviation - incumbent.localDeviation) > IMPROVEMENT_EPSILON) {
    return candidate.localDeviation - incumbent.localDeviation;
  }
  if (Math.abs(candidate.layoutCost - incumbent.layoutCost) > IMPROVEMENT_EPSILON) {
    return candidate.layoutCost - incumbent.layoutCost;
  }
  if (Math.abs(candidate.rotationMagnitude - incumbent.rotationMagnitude) > IMPROVEMENT_EPSILON) {
    return candidate.rotationMagnitude - incumbent.rotationMagnitude;
  }
  if (Math.abs(candidate.contactDistance - incumbent.contactDistance) > IMPROVEMENT_EPSILON) {
    return incumbent.contactDistance - candidate.contactDistance;
  }
  return candidate.totalMove - incumbent.totalMove;
}

function buildTerminalCarbonylRingFaceFlipCandidates(layoutGraph, coords, contact) {
  if (!contact.intrusion) {
    return [];
  }

  const candidates = [];
  const descriptor = contact.descriptor;
  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(descriptor.ringAnchorAtomId);
  const seenKeys = new Set();
  for (const ring of layoutGraph.atomToRings.get(descriptor.ringAnchorAtomId) ?? []) {
    for (const rootAtomId of ring.atomIds) {
      if (!coords.has(rootAtomId)) {
        continue;
      }
      for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
        if (!bond || bond.kind !== 'covalent' || bond.inRing) {
          continue;
        }
        const outsideAtomId = bond.a === rootAtomId ? bond.b : bond.a;
        const outsideAtom = layoutGraph.atoms.get(outsideAtomId);
        if (
          !outsideAtom
          || outsideAtom.element === 'H'
          || outsideAtomId === descriptor.centerAtomId
          || !coords.has(outsideAtomId)
          || layoutGraph.atomToRingSystemId.get(outsideAtomId) === anchorRingSystemId
        ) {
          continue;
        }

        const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, descriptor.ringAnchorAtomId, rootAtomId)
          .filter(atomId => coords.has(atomId));
        const key = `${rootAtomId}:${outsideAtomId}:${movedAtomIds.join(',')}`;
        if (
          seenKeys.has(key)
          || movedAtomIds.length === 0
          || movedAtomIds.includes(rootAtomId)
          || movedAtomIds.includes(outsideAtomId)
          || movedAtomIds.some(atomId => layoutGraph.atomToRingSystemId.get(atomId) === contact.intrusion.ringSystemId)
        ) {
          continue;
        }
        seenKeys.add(key);

        const rootPosition = coords.get(rootAtomId);
        const outsidePosition = coords.get(outsideAtomId);
        const candidateCoords = new Map(coords);
        for (const movedAtomId of movedAtomIds) {
          candidateCoords.set(
            movedAtomId,
            reflectAcrossLine(coords.get(movedAtomId), outsidePosition, rootPosition)
          );
        }
        candidates.push({
          coords: candidateCoords,
          movedAtomIds,
          rootAtomId,
          outsideAtomId
        });
      }
    }
  }

  return candidates;
}

/**
 * Clears visually short contacts where a terminal carboxylate/carbonyl leaf
 * sits just under a neighboring ring atom. The severe-overlap pass allows
 * these, but the hetero label still reads as crowded; a small rotation of the
 * contacted attached ring is less disruptive than bending the carbonyl fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {{changed: boolean}} Whether an attached-ring clearance candidate was accepted.
 */
function resolveTerminalCarbonylLeafNearContacts(layoutGraph, coords, bondLength) {
  const clearanceThreshold = bondLength * ATTACHED_BLOCK_TERMINAL_LABEL_CLEARANCE_FACTOR;
  let changed = false;

  for (let passIndex = 0; passIndex < 3; passIndex++) {
    const contact = terminalCarbonylLeafForeignRingContacts(layoutGraph, coords, clearanceThreshold)[0];
    if (!contact) {
      break;
    }

    const baseAudit = auditLayout(layoutGraph, coords, { bondLength });
    const contactRingSystemId = layoutGraph.atomToRingSystemId.get(contact.opposingAtomId);
    const movableDescriptors = collectMovableAttachedRingDescriptors(layoutGraph, coords)
      .filter(descriptor => (
        layoutGraph.atomToRingSystemId.get(descriptor.rootAtomId) === contactRingSystemId
        && descriptor.subtreeAtomIds.includes(contact.opposingAtomId)
        && !descriptor.subtreeAtomIds.includes(contact.descriptor.leafAtomId)
        && !descriptor.subtreeAtomIds.includes(contact.descriptor.centerAtomId)
        && !descriptor.subtreeAtomIds.includes(contact.descriptor.ringAnchorAtomId)
      ))
      .sort((firstDescriptor, secondDescriptor) => (
        firstDescriptor.subtreeAtomIds.length - secondDescriptor.subtreeAtomIds.length
        || compareCanonicalIds(firstDescriptor.anchorAtomId, secondDescriptor.anchorAtomId, layoutGraph.canonicalAtomRank)
        || compareCanonicalIds(firstDescriptor.rootAtomId, secondDescriptor.rootAtomId, layoutGraph.canonicalAtomRank)
      ));
    if (movableDescriptors.length === 0) {
      break;
    }

    let bestCandidate = null;
    const candidateRecords = [
      ...buildTerminalCarbonylRingFaceFlipCandidates(layoutGraph, coords, contact)
        .map(record => ({
          coords: record.coords,
          movedAtomIds: record.movedAtomIds,
          anchorAtomId: record.rootAtomId,
          rootAtomId: record.outsideAtomId,
          rotationMagnitude: Math.PI
        }))
    ];
    for (const descriptor of movableDescriptors) {
      for (const rotationOffset of TERMINAL_CARBONYL_RING_CONTACT_ROTATION_OFFSETS) {
        const candidateCoords = rotateAtomIdsAroundPivot(
          coords,
          descriptor.subtreeAtomIds,
          descriptor.anchorAtomId,
          rotationOffset
        );
        if (!candidateCoords) {
          continue;
        }
        candidateRecords.push({
          coords: candidateCoords,
          movedAtomIds: descriptor.subtreeAtomIds,
          anchorAtomId: descriptor.anchorAtomId,
          rootAtomId: descriptor.rootAtomId,
          rotationMagnitude: Math.abs(rotationOffset)
        });
      }
    }

    for (const candidateRecord of candidateRecords) {
      const candidateContact = terminalCarbonylLeafClosestForeignRingContact(
        layoutGraph,
        candidateRecord.coords,
        contact.descriptor
      );
      const candidateIntrusion = terminalCarbonylLeafForeignRingIntrusion(
        layoutGraph,
        candidateRecord.coords,
        contact.descriptor
      );
      if (
        candidateIntrusion
        && candidateContact.distance <= contact.distance + bondLength * 0.05
      ) {
        continue;
      }
      const localDeviation = threeHeavyCenterMaxAngularDeviation(layoutGraph, candidateRecord.coords, candidateRecord.anchorAtomId);
      if (localDeviation > TERMINAL_CARBONYL_RING_CONTACT_MAX_ANCHOR_DEVIATION + IMPROVEMENT_EPSILON) {
        continue;
      }

      const candidateAudit = auditLayout(layoutGraph, candidateRecord.coords, { bondLength });
      if (!ringLeafCandidateAuditDoesNotRegress(candidateAudit, baseAudit)) {
        continue;
      }

      const candidate = {
        coords: candidateRecord.coords,
        insideForeignRing: candidateIntrusion != null,
        contactDistance: candidateContact.distance,
        localDeviation,
        layoutCost: measureFocusedPlacementCost(layoutGraph, candidateRecord.coords, bondLength, [
          contact.descriptor.leafAtomId,
          contact.opposingAtomId,
          candidateRecord.anchorAtomId,
          candidateRecord.rootAtomId
        ]),
        rotationMagnitude: candidateRecord.rotationMagnitude,
        totalMove: terminalCarbonylRingContactCandidateTotalMove(coords, candidateRecord.coords, candidateRecord.movedAtomIds)
      };
      if (compareTerminalCarbonylRingContactCandidates(candidate, bestCandidate, clearanceThreshold) < 0) {
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      break;
    }
    overwriteCoordMap(coords, bestCandidate.coords);
    changed = true;
  }

  return { changed };
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

function omittedHydrogenDirectRingHubNeighborIds(layoutGraph, coords, centerAtomId) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (
    !centerAtom ||
    centerAtom.element !== 'C' ||
    centerAtom.aromatic ||
    centerAtom.degree !== 4 ||
    centerAtom.heavyDegree !== 3 ||
    (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0 ||
    !coords.has(centerAtomId)
  ) {
    return [];
  }

  const neighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return [];
    }
    const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (!coords.has(neighborAtomId) || (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) === 0) {
      return [];
    }
    neighborIds.push(neighborAtomId);
  }
  return neighborIds.length === 3 ? neighborIds : [];
}

function omittedHydrogenDirectRingHubMaxFanDeviation(coords, centerAtomId, neighborIds) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || neighborIds.length !== 3 || neighborIds.some(neighborId => !coords.has(neighborId))) {
    return Number.POSITIVE_INFINITY;
  }
  const angles = neighborIds
    .map(neighborId => angleOf(sub(coords.get(neighborId), centerPosition)))
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  let maxDeviation = 0;
  for (let index = 0; index < angles.length; index++) {
    const nextAngle = angles[(index + 1) % angles.length];
    const gap = index + 1 === angles.length
      ? nextAngle + Math.PI * 2 - angles[index]
      : nextAngle - angles[index];
    maxDeviation = Math.max(maxDeviation, Math.abs(gap - EXACT_TRIGONAL_CONTINUATION_ANGLE));
  }
  return maxDeviation;
}

function omittedHydrogenDirectRingHubRootDeviation(layoutGraph, coords, centerAtomId, neighborIds) {
  let maxDeviation = 0;
  for (const neighborId of neighborIds) {
    if ((layoutGraph.atomToRings.get(neighborId)?.length ?? 0) === 0) {
      continue;
    }
    maxDeviation = Math.max(
      maxDeviation,
      measureAttachedRootIncidentRingExitPenalty(layoutGraph, coords, neighborId, centerAtomId).maxDeviation
    );
  }
  return maxDeviation;
}

function omittedHydrogenDirectRingHubCollateralRootPenalty(layoutGraph, coords) {
  let totalDeviation = 0;
  let maxDeviation = 0;
  for (const [ringAtomId, ringAtom] of layoutGraph.atoms) {
    if (
      !ringAtom
      || ringAtom.element === 'H'
      || !coords.has(ringAtomId)
      || (layoutGraph.atomToRings.get(ringAtomId)?.length ?? 0) === 0
    ) {
      continue;
    }
    for (const bond of layoutGraph.bondsByAtomId.get(ringAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === ringAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (
        !neighborAtom
        || neighborAtom.element === 'H'
        || !coords.has(neighborAtomId)
        || (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
      ) {
        continue;
      }
      const penalty = measureAttachedRootIncidentRingExitPenalty(layoutGraph, coords, ringAtomId, neighborAtomId);
      totalDeviation += penalty.totalDeviation;
      maxDeviation = Math.max(maxDeviation, penalty.maxDeviation);
    }
  }
  return {
    totalDeviation,
    maxDeviation
  };
}

function changedAtomIdsBetweenCoordMaps(baseCoords, candidateCoords) {
  const changedAtomIds = new Set();
  for (const [atomId, position] of candidateCoords) {
    const basePosition = baseCoords.get(atomId);
    if (
      !basePosition
      || Math.hypot(position.x - basePosition.x, position.y - basePosition.y) > 1e-9
    ) {
      changedAtomIds.add(atomId);
    }
  }
  return changedAtomIds;
}

function rotatePlacedSubtreeAroundPivot(layoutGraph, coords, rootAtomId, blockedAtomId, pivot, rotationAngle, includeRoot = true) {
  if (Math.abs(rotationAngle) <= IMPROVEMENT_EPSILON) {
    return;
  }
  for (const atomId of collectCovalentSubtreeAtomIds(layoutGraph, rootAtomId, blockedAtomId)) {
    if ((!includeRoot && atomId === rootAtomId) || !coords.has(atomId)) {
      continue;
    }
    const position = coords.get(atomId);
    coords.set(atomId, add(pivot, rotate(sub(position, pivot), rotationAngle)));
  }
}

function snapCarbonRingHubRootsToIncidentExits(layoutGraph, coords, centerAtomId, neighborIds) {
  for (const neighborId of neighborIds) {
    const neighborAtom = layoutGraph.atoms.get(neighborId);
    if (neighborAtom?.element !== 'C' || (layoutGraph.atomToRings.get(neighborId)?.length ?? 0) === 0) {
      continue;
    }
    const rootPosition = coords.get(neighborId);
    const centerPosition = coords.get(centerAtomId);
    if (!rootPosition || !centerPosition) {
      continue;
    }
    const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, neighborId, atomId => coords.get(atomId) ?? null);
    if (outwardAngles.length === 0) {
      continue;
    }
    const parentAngle = angleOf(sub(centerPosition, rootPosition));
    const targetOutwardAngle = outwardAngles.reduce((bestAngle, outwardAngle) => (
      angularDifference(parentAngle, outwardAngle) < angularDifference(parentAngle, bestAngle)
        ? outwardAngle
        : bestAngle
    ));
    const rotationAngle = wrapAngle(parentAngle - targetOutwardAngle);
    rotatePlacedSubtreeAroundPivot(layoutGraph, coords, neighborId, centerAtomId, rootPosition, rotationAngle, false);
  }
}

function omittedHydrogenDirectRingHubAuditDoesNotRegress(candidateAudit, baseAudit) {
  return (
    candidateAudit.severeOverlapCount <= baseAudit.severeOverlapCount &&
    candidateAudit.bondLengthFailureCount <= baseAudit.bondLengthFailureCount &&
    candidateAudit.ringSubstituentReadabilityFailureCount <= baseAudit.ringSubstituentReadabilityFailureCount &&
    candidateAudit.inwardRingSubstituentCount <= baseAudit.inwardRingSubstituentCount &&
    candidateAudit.outwardAxisRingSubstituentFailureCount <= baseAudit.outwardAxisRingSubstituentFailureCount
  );
}

function omittedHydrogenDirectRingHubBranchEscapeDescriptor(layoutGraph, coords, leafAtomId, protectedAtomIds) {
  const leafDescriptor = terminalCarbonylLeafEscapeDescriptor(layoutGraph, coords, leafAtomId);
  if (!leafDescriptor) {
    return null;
  }

  const anchorAtomId = (layoutGraph.bondsByAtomId.get(leafDescriptor.centerAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === leafDescriptor.centerAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom
        && neighborAtom.element !== 'H'
        && neighborAtomId !== leafDescriptor.leafAtomId
        && coords.has(neighborAtomId);
    })
    .find(neighborAtomId => (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) ?? null;
  if (!anchorAtomId || layoutGraph.atoms.get(anchorAtomId)?.chirality) {
    return null;
  }

  const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, leafDescriptor.centerAtomId, anchorAtomId)
    .filter(atomId => coords.has(atomId));
  const movedHeavyAtomCount = movedAtomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H';
  }).length;
  if (
    movedHeavyAtomCount === 0
    || movedHeavyAtomCount > 16
    || movedAtomIds.some(atomId => protectedAtomIds.has(atomId))
  ) {
    return null;
  }

  return {
    ...leafDescriptor,
    anchorAtomId,
    movedAtomIds
  };
}

function omittedHydrogenDirectRingHubSiblingBalanceScore(anchorAngle, leafAngle, siblingAngle) {
  const separations = [
    angularDifference(anchorAngle, leafAngle),
    angularDifference(anchorAngle, siblingAngle),
    angularDifference(leafAngle, siblingAngle)
  ];
  return separations.reduce((score, separation) => (
    score + (separation - EXACT_TRIGONAL_CONTINUATION_ANGLE) ** 2
  ), 0);
}

/**
 * Rotates the non-carbonyl side of a carbonyl center after a crowded omitted-H
 * ring-hub rescue moves the carbonyl leaf as far as it safely can. This keeps
 * the remaining C=O relief local by balancing the sibling branch instead of
 * pushing the protected direct-ring hub back off its exact fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Candidate coordinate map.
 * @param {{centerAtomId: string, leafAtomId: string, anchorAtomId: string}} descriptor - Carbonyl branch descriptor.
 * @param {Set<string>} protectedAtomIds - Atoms that must not move during hub relief.
 * @param {number} bondLength - Target bond length.
 * @returns {Array<Map<string, {x: number, y: number}>>} Audit-clean sibling-balance candidates.
 */
function buildOmittedHydrogenDirectRingHubSiblingBalanceCandidates(
  layoutGraph,
  coords,
  descriptor,
  protectedAtomIds,
  bondLength
) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!centerPosition || !anchorPosition || !leafPosition) {
    return [];
  }

  const siblingAtomIds = (layoutGraph.bondsByAtomId.get(descriptor.centerAtomId) ?? [])
    .filter(bond => bond?.kind === 'covalent')
    .map(bond => (bond.a === descriptor.centerAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !!neighborAtom
        && neighborAtom.element !== 'H'
        && neighborAtomId !== descriptor.anchorAtomId
        && neighborAtomId !== descriptor.leafAtomId
        && coords.has(neighborAtomId);
    });
  if (siblingAtomIds.length !== 1) {
    return [];
  }

  const [siblingAtomId] = siblingAtomIds;
  if (layoutGraph.atoms.get(siblingAtomId)?.chirality) {
    return [];
  }

  const movedAtomIds = collectCovalentSubtreeAtomIds(layoutGraph, siblingAtomId, descriptor.centerAtomId)
    .filter(atomId => coords.has(atomId));
  const movedHeavyAtomCount = movedAtomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H';
  }).length;
  if (
    movedHeavyAtomCount === 0
    || movedHeavyAtomCount > 16
    || movedAtomIds.some(atomId => protectedAtomIds.has(atomId) || layoutGraph.atoms.get(atomId)?.chirality)
  ) {
    return [];
  }

  const anchorAngle = angleOf(sub(anchorPosition, centerPosition));
  const leafAngle = angleOf(sub(leafPosition, centerPosition));
  const siblingAngle = angleOf(sub(coords.get(siblingAtomId), centerPosition));
  const currentScore = omittedHydrogenDirectRingHubSiblingBalanceScore(anchorAngle, leafAngle, siblingAngle);
  const shortArcMidpoint = anchorAngle + wrapAngle(leafAngle - anchorAngle) / 2;
  const targetAngles = [shortArcMidpoint, shortArcMidpoint + Math.PI]
    .sort((firstAngle, secondAngle) => (
      omittedHydrogenDirectRingHubSiblingBalanceScore(anchorAngle, leafAngle, firstAngle)
      - omittedHydrogenDirectRingHubSiblingBalanceScore(anchorAngle, leafAngle, secondAngle)
    ));

  const candidates = [];
  for (const targetAngle of targetAngles) {
    const rotationOffset = wrapAngle(targetAngle - siblingAngle);
    if (
      Math.abs(rotationOffset) <= IMPROVEMENT_EPSILON
      || Math.abs(rotationOffset) > OMITTED_HYDROGEN_DIRECT_RING_HUB_SIBLING_BALANCE_LIMIT
    ) {
      continue;
    }
    const candidateCoords = rotateAtomIdsAroundPivot(
      coords,
      movedAtomIds,
      descriptor.centerAtomId,
      rotationOffset
    );
    if (!candidateCoords) {
      continue;
    }
    const candidateScore = omittedHydrogenDirectRingHubSiblingBalanceScore(anchorAngle, leafAngle, targetAngle);
    if (candidateScore >= currentScore - IMPROVEMENT_EPSILON) {
      continue;
    }
    const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
    if (candidateAudit.ok !== true) {
      continue;
    }
    candidates.push(candidateCoords);
  }
  return candidates;
}

function buildOmittedHydrogenDirectRingHubBranchEscapeCandidates(
  layoutGraph,
  coords,
  changedHubAtomIds,
  protectedAtomIds,
  bondLength
) {
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  if (overlaps.length === 0) {
    return [coords];
  }

  const descriptors = [];
  const seenKeys = new Set();
  for (const { firstAtomId, secondAtomId } of overlaps) {
    for (const [leafAtomId, opposingAtomId] of [
      [firstAtomId, secondAtomId],
      [secondAtomId, firstAtomId]
    ]) {
      if (!changedHubAtomIds.has(opposingAtomId)) {
        continue;
      }
      const descriptor = omittedHydrogenDirectRingHubBranchEscapeDescriptor(
        layoutGraph,
        coords,
        leafAtomId,
        protectedAtomIds
      );
      if (!descriptor) {
        continue;
      }
      const key = `${descriptor.anchorAtomId}:${descriptor.centerAtomId}:${descriptor.leafAtomId}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      descriptors.push(descriptor);
    }
  }
  if (descriptors.length === 0) {
    return buildTerminalCarbonylLeafEscapeCandidates(layoutGraph, coords, changedHubAtomIds, bondLength);
  }

  const candidates = [
    ...buildTerminalCarbonylLeafEscapeCandidates(layoutGraph, coords, changedHubAtomIds, bondLength)
  ];
  for (const descriptor of descriptors) {
    for (const rotationOffset of TERMINAL_CARBONYL_BRANCH_ESCAPE_OFFSETS) {
      const branchCoords = rotateAtomIdsAroundPivot(
        coords,
        descriptor.movedAtomIds,
        descriptor.anchorAtomId,
        rotationOffset
      );
      if (!branchCoords) {
        continue;
      }
      let branchLeafCandidateCount = 0;
      for (const leafRotationOffset of OMITTED_HYDROGEN_DIRECT_RING_HUB_BRANCH_LEAF_OFFSETS) {
        const branchLeafCoords = Math.abs(leafRotationOffset) <= IMPROVEMENT_EPSILON
          ? branchCoords
          : rotateAtomIdsAroundPivot(
              branchCoords,
              [descriptor.leafAtomId],
              descriptor.centerAtomId,
              leafRotationOffset
            );
        if (!branchLeafCoords) {
          continue;
        }
        const branchLeafAudit = auditLayout(layoutGraph, branchLeafCoords, { bondLength });
        if (branchLeafAudit.ok === true) {
          candidates.push(branchLeafCoords);
          candidates.push(...buildOmittedHydrogenDirectRingHubSiblingBalanceCandidates(
            layoutGraph,
            branchLeafCoords,
            descriptor,
            protectedAtomIds,
            bondLength
          ));
          branchLeafCandidateCount++;
        }
      }
      const anchorRootCorrection = attachedRootIncidentRingExitCorrection(
        layoutGraph,
        branchCoords,
        descriptor.anchorAtomId,
        descriptor.centerAtomId
      );
      if (Math.abs(anchorRootCorrection) <= IMPROVEMENT_EPSILON) {
        continue;
      }
      const restoredRootCoords = rotateAtomIdsAroundPivot(
        branchCoords,
        descriptor.movedAtomIds,
        descriptor.anchorAtomId,
        anchorRootCorrection
      );
      if (!restoredRootCoords) {
        continue;
      }
      let restoredLeafCandidateCount = 0;
      for (const leafRotationOffset of OMITTED_HYDROGEN_DIRECT_RING_HUB_BRANCH_LEAF_OFFSETS) {
        const leafCoords = rotateAtomIdsAroundPivot(
          restoredRootCoords,
          [descriptor.leafAtomId],
          descriptor.centerAtomId,
          leafRotationOffset
        );
        if (!leafCoords) {
          continue;
        }
        const leafAudit = auditLayout(layoutGraph, leafCoords, { bondLength });
        if (leafAudit.ok === true) {
          candidates.push(leafCoords);
          candidates.push(...buildOmittedHydrogenDirectRingHubSiblingBalanceCandidates(
            layoutGraph,
            leafCoords,
            descriptor,
            protectedAtomIds,
            bondLength
          ));
          restoredLeafCandidateCount++;
        }
      }
      if (restoredLeafCandidateCount === 0 && branchLeafCandidateCount === 0) {
        const candidateAudit = auditLayout(layoutGraph, branchCoords, { bondLength });
        if (candidateAudit.ok === true) {
          candidates.push(branchCoords);
        }
      }
    }
  }
  return candidates;
}

function omittedHydrogenDirectRingHubCandidateScore(layoutGraph, coords, candidateAudit) {
  const collateralRootPenalty = omittedHydrogenDirectRingHubCollateralRootPenalty(layoutGraph, coords);
  return {
    coords,
    severeOverlapCount: candidateAudit.severeOverlapCount,
    severeOverlapPenalty: candidateAudit.severeOverlapPenalty,
    collateralRootMaxDeviation: collateralRootPenalty.maxDeviation,
    collateralRootTotalDeviation: collateralRootPenalty.totalDeviation,
    trigonalPenalty: null,
    presentationPenalty: null,
    deterministicKey: null
  };
}

function omittedHydrogenDirectRingHubTrigonalPenalty(layoutGraph, score) {
  if (score.trigonalPenalty == null) {
    score.trigonalPenalty = measureTrigonalDistortion(layoutGraph, score.coords).totalDeviation;
  }
  return score.trigonalPenalty;
}

function omittedHydrogenDirectRingHubPresentationPenalty(layoutGraph, score) {
  if (score.presentationPenalty == null) {
    score.presentationPenalty = measureRingSubstituentPresentationPenalty(layoutGraph, score.coords).totalDeviation;
  }
  return score.presentationPenalty;
}

function omittedHydrogenDirectRingHubDeterministicKey(layoutGraph, score) {
  if (score.deterministicKey == null) {
    score.deterministicKey = [...score.coords.entries()]
      .sort(([firstAtomId], [secondAtomId]) => compareCanonicalIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank))
      .map(([atomId, position]) => `${atomId}:${Math.round(position.x * 1e9)}:${Math.round(position.y * 1e9)}`)
      .join('|');
  }
  return score.deterministicKey;
}

function compareOmittedHydrogenDirectRingHubScores(layoutGraph, candidateScore, incumbentScore) {
  if (!incumbentScore) {
    return -1;
  }
  if (candidateScore.severeOverlapCount !== incumbentScore.severeOverlapCount) {
    return candidateScore.severeOverlapCount - incumbentScore.severeOverlapCount;
  }
  if (Math.abs(candidateScore.severeOverlapPenalty - incumbentScore.severeOverlapPenalty) > IMPROVEMENT_EPSILON) {
    return candidateScore.severeOverlapPenalty - incumbentScore.severeOverlapPenalty;
  }
  if (Math.abs(candidateScore.collateralRootMaxDeviation - incumbentScore.collateralRootMaxDeviation) > IMPROVEMENT_EPSILON) {
    return candidateScore.collateralRootMaxDeviation - incumbentScore.collateralRootMaxDeviation;
  }
  if (Math.abs(candidateScore.collateralRootTotalDeviation - incumbentScore.collateralRootTotalDeviation) > IMPROVEMENT_EPSILON) {
    return candidateScore.collateralRootTotalDeviation - incumbentScore.collateralRootTotalDeviation;
  }
  const candidateTrigonalPenalty = omittedHydrogenDirectRingHubTrigonalPenalty(layoutGraph, candidateScore);
  const incumbentTrigonalPenalty = omittedHydrogenDirectRingHubTrigonalPenalty(layoutGraph, incumbentScore);
  if (Math.abs(candidateTrigonalPenalty - incumbentTrigonalPenalty) > IMPROVEMENT_EPSILON) {
    return candidateTrigonalPenalty - incumbentTrigonalPenalty;
  }
  const candidatePresentationPenalty = omittedHydrogenDirectRingHubPresentationPenalty(layoutGraph, candidateScore);
  const incumbentPresentationPenalty = omittedHydrogenDirectRingHubPresentationPenalty(layoutGraph, incumbentScore);
  if (Math.abs(candidatePresentationPenalty - incumbentPresentationPenalty) > IMPROVEMENT_EPSILON) {
    return candidatePresentationPenalty - incumbentPresentationPenalty;
  }
  return omittedHydrogenDirectRingHubDeterministicKey(layoutGraph, candidateScore)
    .localeCompare(omittedHydrogenDirectRingHubDeterministicKey(layoutGraph, incumbentScore), 'en', { numeric: true });
}

function resolveOmittedHydrogenDirectRingHubGeometry(layoutGraph, coords, bondLength) {
  let bestCoords = null;
  let bestScore = null;
  const baseAudit = auditLayout(layoutGraph, coords, { bondLength });

  for (const [centerAtomId] of layoutGraph.atoms) {
    const neighborIds = omittedHydrogenDirectRingHubNeighborIds(layoutGraph, coords, centerAtomId);
    if (neighborIds.length !== 3) {
      continue;
    }
    const baseFanDeviation = omittedHydrogenDirectRingHubMaxFanDeviation(coords, centerAtomId, neighborIds);
    const baseRootDeviation = omittedHydrogenDirectRingHubRootDeviation(layoutGraph, coords, centerAtomId, neighborIds);
    const baseCollateralRootDeviation = omittedHydrogenDirectRingHubCollateralRootPenalty(layoutGraph, coords).maxDeviation;
    if (
      baseFanDeviation <= IMPROVEMENT_EPSILON
      && baseRootDeviation <= IMPROVEMENT_EPSILON
      && baseCollateralRootDeviation <= IMPROVEMENT_EPSILON
    ) {
      continue;
    }

    const centerPosition = coords.get(centerAtomId);
    const currentAngles = new Map(neighborIds.map(neighborId => [
      neighborId,
      angleOf(sub(coords.get(neighborId), centerPosition))
    ]));
    for (const fixedNeighborId of neighborIds) {
      const movableNeighborIds = neighborIds.filter(neighborId => neighborId !== fixedNeighborId);
      for (const direction of [1, -1]) {
        for (const assignment of [
          [[movableNeighborIds[0], currentAngles.get(fixedNeighborId) + direction * EXACT_TRIGONAL_CONTINUATION_ANGLE], [movableNeighborIds[1], currentAngles.get(fixedNeighborId) - direction * EXACT_TRIGONAL_CONTINUATION_ANGLE]],
          [[movableNeighborIds[1], currentAngles.get(fixedNeighborId) + direction * EXACT_TRIGONAL_CONTINUATION_ANGLE], [movableNeighborIds[0], currentAngles.get(fixedNeighborId) - direction * EXACT_TRIGONAL_CONTINUATION_ANGLE]]
        ]) {
          const parentSpreadCoords = new Map(coords);
          for (const [neighborId, targetAngle] of assignment) {
            rotatePlacedSubtreeAroundPivot(
              layoutGraph,
              parentSpreadCoords,
              neighborId,
              centerAtomId,
              centerPosition,
              wrapAngle(targetAngle - currentAngles.get(neighborId)),
              true
            );
          }

          const localRotationRoots = assignment
            .map(([neighborId]) => neighborId)
            .filter(neighborId => {
              const neighborAtom = layoutGraph.atoms.get(neighborId);
              return neighborAtom && neighborAtom.element !== 'C' && (layoutGraph.atomToRings.get(neighborId)?.length ?? 0) > 0;
            });
          const localRotationChoices = localRotationRoots.length === 0
            ? [[]]
            : OMITTED_HYDROGEN_DIRECT_RING_HUB_LOCAL_ROTATION_OFFSETS.map(offset => [[localRotationRoots[0], offset]]);
          for (const localRotationChoice of localRotationChoices) {
            const candidateCoords = new Map(parentSpreadCoords);
            for (const [neighborId, localRotationOffset] of localRotationChoice) {
              rotatePlacedSubtreeAroundPivot(
                layoutGraph,
                candidateCoords,
                neighborId,
                centerAtomId,
                candidateCoords.get(neighborId),
                localRotationOffset,
                false
              );
            }
            snapCarbonRingHubRootsToIncidentExits(layoutGraph, candidateCoords, centerAtomId, neighborIds);

            const fanDeviation = omittedHydrogenDirectRingHubMaxFanDeviation(candidateCoords, centerAtomId, neighborIds);
            const rootDeviation = omittedHydrogenDirectRingHubRootDeviation(layoutGraph, candidateCoords, centerAtomId, neighborIds);
            if (fanDeviation > IMPROVEMENT_EPSILON || rootDeviation > IMPROVEMENT_EPSILON) {
              continue;
            }

            const protectedAtomIds = new Set([centerAtomId, ...neighborIds]);
            const reliefCandidates = buildOmittedHydrogenDirectRingHubBranchEscapeCandidates(
              layoutGraph,
              candidateCoords,
              changedAtomIdsBetweenCoordMaps(coords, candidateCoords),
              protectedAtomIds,
              bondLength
            );
            for (const reliefCoords of reliefCandidates) {
              const reliefFanDeviation = omittedHydrogenDirectRingHubMaxFanDeviation(reliefCoords, centerAtomId, neighborIds);
              const reliefRootDeviation = omittedHydrogenDirectRingHubRootDeviation(layoutGraph, reliefCoords, centerAtomId, neighborIds);
              if (reliefFanDeviation > IMPROVEMENT_EPSILON || reliefRootDeviation > IMPROVEMENT_EPSILON) {
                continue;
              }
              const candidateAudit = auditLayout(layoutGraph, reliefCoords, { bondLength });
              if (!omittedHydrogenDirectRingHubAuditDoesNotRegress(candidateAudit, baseAudit)) {
                continue;
              }
              const score = omittedHydrogenDirectRingHubCandidateScore(layoutGraph, reliefCoords, candidateAudit);
              if (compareOmittedHydrogenDirectRingHubScores(layoutGraph, score, bestScore) < 0) {
                bestCoords = reliefCoords;
                bestScore = score;
              }
            }
          }
        }
      }
    }
  }

  if (!bestCoords) {
    return { changed: false };
  }
  overwriteCoordMap(coords, bestCoords);
  return { changed: true };
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
  const terminalCarbonLeafSnap = snapExactTerminalCarbonRingLeavesWithAttachedRingClearance(layoutGraph, coords, bondLength);
  if (terminalCarbonLeafSnap.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const terminalHeteroLeafSnap = snapExactTerminalHeteroRingLeavesWithAttachedRingClearance(layoutGraph, coords, bondLength);
  if (terminalHeteroLeafSnap.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const directAttachedRingRootRefinement = refineDirectAttachedRingRootsWithTerminalLeafClearance(layoutGraph, coords, bondLength);
  if (directAttachedRingRootRefinement.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const fusedCyclopropaneCapRestore = restoreFusedCyclopropaneExteriorCaps(layoutGraph, coords, bondLength);
  if (fusedCyclopropaneCapRestore.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const exactImineLinkedArylRingChainRefinement = refineExactImineLinkedArylRingChains(layoutGraph, coords, bondLength);
  if (exactImineLinkedArylRingChainRefinement.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const smallRingExteriorFanRefinement = refineSmallRingExteriorBranchFans(layoutGraph, coords, bondLength);
  if (smallRingExteriorFanRefinement.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const bridgeheadChainLeafFanRescue = rescueBridgeheadChainExitsWithTerminalLeafFans(layoutGraph, coords, bondLength);
  if (bridgeheadChainLeafFanRescue.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const terminalHeteroRingLeafClearance = resolveExactTerminalRingLeafNearContacts(layoutGraph, coords, bondLength);
  if (terminalHeteroRingLeafClearance.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const terminalCarbonylLeafClearance = resolveTerminalCarbonylLeafNearContacts(layoutGraph, coords, bondLength);
  if (terminalCarbonylLeafClearance.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  if (deferredHydrogenAtomIds.size > 0) {
    placeMixedBranches(layoutGraph, adjacency, bondLength, state, deferredHydrogenAtomIds);
    const linkedMethyleneHydrogenRefinement = refineLinkedMethyleneHydrogenSlots(layoutGraph, coords, bondLength);
    if (linkedMethyleneHydrogenRefinement.changed) {
      markMixedBranchPlacementContextDirty(state);
    }
  }
  const exactRingAnchorSubstituentSnap = snapExactRingAnchorSubstituentAngles(layoutGraph, coords, participantAtomIds);
  if (exactRingAnchorSubstituentSnap.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const linkedHeteroRingAnchorOverlapRescue = resolveLinkedHeteroRingAnchorOverlaps(
    layoutGraph,
    coords,
    bondValidationClasses,
    bondLength
  );
  if (linkedHeteroRingAnchorOverlapRescue.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const terminalCarbonLeafCrossingEscape = resolveTerminalCarbonRingLeafBondCrossings(layoutGraph, coords, bondLength);
  if (terminalCarbonLeafCrossingEscape.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const hypervalentCarbonylRingSiblingSwap = resolveHypervalentCarbonylRingSiblingSwaps(
    layoutGraph,
    coords,
    bondValidationClasses,
    bondLength
  );
  if (hypervalentCarbonylRingSiblingSwap.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const omittedHydrogenDirectRingHubGeometry = resolveOmittedHydrogenDirectRingHubGeometry(layoutGraph, coords, bondLength);
  if (omittedHydrogenDirectRingHubGeometry.changed) {
    markMixedBranchPlacementContextDirty(state);
  }
  const bridgeheadTerminalCarbonFanRescue = resolveBridgeheadTerminalCarbonLeafFanPinches(
    layoutGraph,
    coords,
    bondValidationClasses,
    bondLength
  );
  if (bridgeheadTerminalCarbonFanRescue.changed) {
    markMixedBranchPlacementContextDirty(state);
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
