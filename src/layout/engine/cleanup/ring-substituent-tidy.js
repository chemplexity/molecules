/** @module cleanup/ring-substituent-tidy */

import {
  buildAtomGrid,
  collectReadableRingSubstituentChildren,
  computeAtomDistortionCost,
  computeSubtreeOverlapCost,
  ringSubstituentRepresentativePosition,
  supportsRingSubstituentOutwardReadability
} from '../audit/invariants.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { computeBounds } from '../geometry/bounds.js';
import { add, angleOf, angularDifference, centroid, rotate, sub } from '../geometry/vec2.js';
import { RING_SUBSTITUENT_READABILITY_LIMITS, RING_SUBSTITUENT_TIDY_LIMITS } from '../constants.js';
import { collectCutSubtree } from './subtree-utils.js';

const TIDY_ROTATION_ANGLES = Array.from({ length: 24 }, (_, index) => (index * Math.PI) / 12);
const TIDY_ANGLE_EPSILON = 1e-6;
const TIDY_ATOM_EPSILON = 1e-6;
const TIDY_BOUNDS_EPSILON = 1e-6;
const IDEAL_RING_LINKER_ELEMENTS = new Set(['N', 'O', 'S', 'Se']);

function atomPairKey(firstAtomId, secondAtomId) {
  return firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
}

function incidentRingPolygons(layoutGraph, coords, anchorAtomId) {
  return (layoutGraph.atomToRings.get(anchorAtomId) ?? [])
    .map(ring => ring.atomIds.map(ringAtomId => coords.get(ringAtomId)).filter(Boolean))
    .filter(polygon => polygon.length >= 3);
}

function outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  const angles = [];
  for (const polygon of incidentRingPolygons(layoutGraph, coords, anchorAtomId)) {
    angles.push(angleOf(sub(anchorPosition, centroid(polygon))));
  }
  return angles;
}

function ringSystemAtomIds(layoutGraph, atomId, coords) {
  const ringSystemId = layoutGraph.atomToRingSystemId.get(atomId);
  if (ringSystemId == null) {
    return [];
  }
  return (layoutGraph.ringSystems.find(ringSystem => ringSystem.id === ringSystemId)?.atomIds ?? []).filter(candidateAtomId => coords.has(candidateAtomId));
}

function resolveIdealLinkedRingRepresentative(layoutGraph, coords, anchorAtomId, rootAtomId) {
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (
    !rootAtom
    || rootAtom.aromatic
    || !IDEAL_RING_LINKER_ELEMENTS.has(rootAtom.element)
    || rootAtom.heavyDegree !== 2
    || (layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) !== 0
  ) {
    return null;
  }

  const heavyNeighborIds = (layoutGraph.bondsByAtomId.get(rootAtomId) ?? [])
    .filter(bond => bond.kind === 'covalent' && !bond.aromatic && !bond.inRing && (bond.order ?? 1) === 1)
    .map(bond => (bond.a === rootAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
  if (heavyNeighborIds.length !== 2 || !heavyNeighborIds.includes(anchorAtomId)) {
    return null;
  }

  const downstreamAnchorAtomId = heavyNeighborIds.find(neighborAtomId => neighborAtomId !== anchorAtomId) ?? null;
  if (!downstreamAnchorAtomId || (layoutGraph.atomToRings.get(downstreamAnchorAtomId)?.length ?? 0) === 0) {
    return null;
  }
  if (layoutGraph.atomToRingSystemId.get(downstreamAnchorAtomId) === layoutGraph.atomToRingSystemId.get(anchorAtomId)) {
    return null;
  }

  const representativeAtomIds = ringSystemAtomIds(layoutGraph, downstreamAnchorAtomId, coords);
  if (representativeAtomIds.length === 0) {
    return null;
  }

  return {
    downstreamAnchorAtomId,
    representativeAtomIds
  };
}

function containsFrozenAtoms(atomIds, frozenAtomIds) {
  return atomIds.some(atomId => frozenAtomIds.has(atomId));
}

function orientation(firstPoint, secondPoint, thirdPoint) {
  return (secondPoint.x - firstPoint.x) * (thirdPoint.y - firstPoint.y) - (secondPoint.y - firstPoint.y) * (thirdPoint.x - firstPoint.x);
}

function segmentsProperlyIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstAgainstSecondStart = orientation(firstStart, firstEnd, secondStart);
  const firstAgainstSecondEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondAgainstFirstStart = orientation(secondStart, secondEnd, firstStart);
  const secondAgainstFirstEnd = orientation(secondStart, secondEnd, firstEnd);
  const epsilon = 1e-9;
  return firstAgainstSecondStart * firstAgainstSecondEnd < -epsilon && secondAgainstFirstStart * secondAgainstFirstEnd < -epsilon;
}

function distancePointToSegment(point, firstPoint, secondPoint) {
  const deltaX = secondPoint.x - firstPoint.x;
  const deltaY = secondPoint.y - firstPoint.y;
  const spanSquared = deltaX * deltaX + deltaY * deltaY;
  if (spanSquared <= TIDY_ATOM_EPSILON) {
    return Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y);
  }
  const projection = ((point.x - firstPoint.x) * deltaX + (point.y - firstPoint.y) * deltaY) / spanSquared;
  const clampedProjection = Math.max(0, Math.min(1, projection));
  const closestPoint = {
    x: firstPoint.x + deltaX * clampedProjection,
    y: firstPoint.y + deltaY * clampedProjection
  };
  return Math.hypot(point.x - closestPoint.x, point.y - closestPoint.y);
}

function positionForAtom(coords, overridePositions, atomId) {
  return overridePositions?.get(atomId) ?? coords.get(atomId) ?? null;
}

function countMovedBondCrossings(layoutGraph, coords, subtreeAtomIds, overridePositions) {
  const movedAtomIds = new Set(subtreeAtomIds);
  const bonds = [...layoutGraph.bonds.values()].filter(bond => bond.kind === 'covalent');
  let crossingCount = 0;

  for (let firstIndex = 0; firstIndex < bonds.length; firstIndex++) {
    const firstBond = bonds[firstIndex];
    const firstMoved = movedAtomIds.has(firstBond.a) || movedAtomIds.has(firstBond.b);
    if (!firstMoved) {
      continue;
    }
    const firstStart = positionForAtom(coords, overridePositions, firstBond.a);
    const firstEnd = positionForAtom(coords, overridePositions, firstBond.b);
    if (!firstStart || !firstEnd) {
      continue;
    }

    for (let secondIndex = firstIndex + 1; secondIndex < bonds.length; secondIndex++) {
      const secondBond = bonds[secondIndex];
      if (new Set([firstBond.a, firstBond.b, secondBond.a, secondBond.b]).size < 4) {
        continue;
      }
      const secondStart = positionForAtom(coords, overridePositions, secondBond.a);
      const secondEnd = positionForAtom(coords, overridePositions, secondBond.b);
      if (!secondStart || !secondEnd) {
        continue;
      }
      if (segmentsProperlyIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
        crossingCount++;
      }
    }
  }

  return crossingCount;
}

function boundsAreaWithOverrides(coords, allAtomIds, overridePositions) {
  const mergedCoords =
    !overridePositions || overridePositions.size === 0
      ? coords
      : new Map([...coords.entries()].map(([atomId, position]) => [atomId, overridePositions.get(atomId) ?? position]));
  const bounds = computeBounds(mergedCoords, allAtomIds);
  return bounds ? bounds.width * bounds.height : 0;
}

function shouldReplaceTidyeableDescriptor(candidate, incumbent) {
  const candidateLinkedRing = candidate.linkedRingAnchorAtomId != null;
  const incumbentLinkedRing = incumbent.linkedRingAnchorAtomId != null;
  if (candidateLinkedRing !== incumbentLinkedRing) {
    return candidateLinkedRing;
  }
  if (!candidateLinkedRing || !incumbentLinkedRing) {
    return false;
  }
  if (candidate.subtreeHeavyAtomCount !== incumbent.subtreeHeavyAtomCount) {
    return candidate.subtreeHeavyAtomCount < incumbent.subtreeHeavyAtomCount;
  }
  return candidate.anchorAtomId < incumbent.anchorAtomId;
}

function collectTidyeableDescriptors(layoutGraph, coords, frozenAtomIds) {
  const descriptorsByPair = new Map();

  for (const anchorAtomId of coords.keys()) {
    if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
      continue;
    }
    const substituentChildren = collectReadableRingSubstituentChildren(layoutGraph, coords, anchorAtomId);
    const enforcesOutwardReadability = supportsRingSubstituentOutwardReadability(layoutGraph, anchorAtomId);
    const prefersIdealOutwardGeometry =
      substituentChildren.length === 1
      && substituentChildren[0].representativeAtomIds.length === 1;
    const allowsRingSystemCompaction =
      substituentChildren.length === 1
      && substituentChildren[0].representativeAtomIds.length > 1;
    if (
      substituentChildren.length !== 1
      || (!enforcesOutwardReadability && !allowsRingSystemCompaction && !prefersIdealOutwardGeometry)
    ) {
      continue;
    }

    const rootAtomId = substituentChildren[0].childAtomId;
    const linkedRingRepresentative = resolveIdealLinkedRingRepresentative(layoutGraph, coords, anchorAtomId, rootAtomId);
    const representativeAtomIds = linkedRingRepresentative?.representativeAtomIds ?? substituentChildren[0].representativeAtomIds;
    const pairId = atomPairKey(anchorAtomId, rootAtomId);

    const bond = layoutGraph.bondByAtomPair.get(pairId);
    if (!bond || bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }

    const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
    if (subtreeAtomIds.length === 0 || subtreeAtomIds.length > RING_SUBSTITUENT_TIDY_LIMITS.maxSubtreeAtomCount) {
      continue;
    }
    const subtreeHeavyAtomCount = subtreeAtomIds.reduce(
      (count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1),
      0
    );
    if (subtreeHeavyAtomCount > RING_SUBSTITUENT_TIDY_LIMITS.maxSubtreeHeavyAtomCount) {
      continue;
    }
    if (frozenAtomIds && containsFrozenAtoms(subtreeAtomIds, frozenAtomIds)) {
      continue;
    }

    const outwardAngles = outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId);
    if (outwardAngles.length === 0) {
      continue;
    }

    const reverseRepresentativeAtomIds = representativeAtomIds.length > 1 ? ringSystemAtomIds(layoutGraph, anchorAtomId, coords) : [];
    const descriptor = {
      anchorAtomId,
      rootAtomId,
      representativeAtomIds,
      subtreeAtomIds,
      subtreeHeavyAtomCount,
      anchorRingAtomIds: [...new Set((layoutGraph.atomToRings.get(anchorAtomId) ?? []).flatMap(ring => ring.atomIds))],
      ringPolygons: incidentRingPolygons(layoutGraph, coords, anchorAtomId),
      outwardAngles,
      isRingSystemSubstituent: representativeAtomIds.length > 1,
      enforcesOutwardReadability,
      prefersIdealOutwardGeometry,
      linkedRingAnchorAtomId: linkedRingRepresentative?.downstreamAnchorAtomId ?? null,
      rootRotatingAtomIds: representativeAtomIds.length > 1 ? subtreeAtomIds.filter(atomId => atomId !== rootAtomId) : [],
      reverseRepresentativeAtomIds,
      reverseAnchorRingAtomIds: representativeAtomIds.length > 1
        ? [...new Set((layoutGraph.atomToRings.get(rootAtomId) ?? []).flatMap(ring => ring.atomIds))]
        : [],
      reverseRingPolygons: representativeAtomIds.length > 1 ? incidentRingPolygons(layoutGraph, coords, rootAtomId) : [],
      reverseOutwardAngles: representativeAtomIds.length > 1 ? outwardAnglesForAnchor(layoutGraph, coords, rootAtomId) : [],
      reverseEnforcesOutwardReadability: representativeAtomIds.length > 1
        ? supportsRingSubstituentOutwardReadability(layoutGraph, rootAtomId)
        : false
    };
    const incumbent = descriptorsByPair.get(pairId);
    if (!incumbent || shouldReplaceTidyeableDescriptor(descriptor, incumbent)) {
      descriptorsByPair.set(pairId, descriptor);
    }
  }

  return [...descriptorsByPair.values()];
}

function refreshDescriptorGeometry(layoutGraph, coords, descriptor) {
  return {
    ...descriptor,
    anchorRingAtomIds: [...new Set((layoutGraph.atomToRings.get(descriptor.anchorAtomId) ?? []).flatMap(ring => ring.atomIds))],
    ringPolygons: incidentRingPolygons(layoutGraph, coords, descriptor.anchorAtomId),
    outwardAngles: outwardAnglesForAnchor(layoutGraph, coords, descriptor.anchorAtomId),
    reverseAnchorRingAtomIds: descriptor.isRingSystemSubstituent
      ? [...new Set((layoutGraph.atomToRings.get(descriptor.rootAtomId) ?? []).flatMap(ring => ring.atomIds))]
      : descriptor.reverseAnchorRingAtomIds,
    reverseRingPolygons: descriptor.isRingSystemSubstituent
      ? incidentRingPolygons(layoutGraph, coords, descriptor.rootAtomId)
      : descriptor.reverseRingPolygons,
    reverseOutwardAngles: descriptor.isRingSystemSubstituent
      ? outwardAnglesForAnchor(layoutGraph, coords, descriptor.rootAtomId)
      : descriptor.reverseOutwardAngles
  };
}

function representativeInsideRingCount(coords, representativeAtomIds, overridePositions, ringPolygons) {
  const representativePosition = ringSubstituentRepresentativePosition(coords, representativeAtomIds, overridePositions);
  if (!representativePosition) {
    return 0;
  }
  return ringPolygons.some(polygon => pointInPolygon(representativePosition, polygon)) ? 1 : 0;
}

function bestOutwardDeviation(anchorPosition, representativePosition, outwardAngles) {
  if (!anchorPosition || !representativePosition || outwardAngles.length === 0) {
    return null;
  }
  const rootAngle = angleOf(sub(representativePosition, anchorPosition));
  let bestDeviation = Number.POSITIVE_INFINITY;
  for (const outwardAngle of outwardAngles) {
    bestDeviation = Math.min(bestDeviation, angularDifference(rootAngle, outwardAngle));
  }
  return Number.isFinite(bestDeviation) ? bestDeviation : null;
}

function buildRotatedSubtreePositions(coords, anchorAtomId, subtreeAtomIds, rotation) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const overridePositions = new Map();
  for (const atomId of subtreeAtomIds) {
    const currentPosition = coords.get(atomId);
    if (!currentPosition) {
      continue;
    }
    overridePositions.set(atomId, add(anchorPosition, rotate(sub(currentPosition, anchorPosition), rotation)));
  }
  return overridePositions;
}

function buildRootAnchoredRingSystemPositions(coords, rootAtomId, rotatingAtomIds, rotation) {
  const rootPosition = coords.get(rootAtomId);
  if (!rootPosition) {
    return null;
  }
  const overridePositions = new Map([[rootAtomId, rootPosition]]);
  for (const atomId of rotatingAtomIds) {
    const currentPosition = coords.get(atomId);
    if (!currentPosition) {
      continue;
    }
    overridePositions.set(atomId, add(rootPosition, rotate(sub(currentPosition, rootPosition), rotation)));
  }
  return overridePositions;
}

function anchorRingClearance(coords, descriptor, overridePositions) {
  if (!descriptor.isRingSystemSubstituent) {
    return 0;
  }
  const probeAtomIds = descriptor.representativeAtomIds.filter(atomId => atomId !== descriptor.rootAtomId);
  if (probeAtomIds.length === 0) {
    return 0;
  }

  let minClearance = Number.POSITIVE_INFINITY;
  for (const atomId of probeAtomIds) {
    const position = positionForAtom(coords, overridePositions, atomId);
    if (!position) {
      continue;
    }
    for (const polygon of descriptor.ringPolygons) {
      for (let index = 0; index < polygon.length; index++) {
        const firstPoint = polygon[index];
        const secondPoint = polygon[(index + 1) % polygon.length];
        minClearance = Math.min(minClearance, distancePointToSegment(position, firstPoint, secondPoint));
      }
    }
    for (const ringAtomId of descriptor.anchorRingAtomIds) {
      const ringAtomPosition = coords.get(ringAtomId);
      if (!ringAtomPosition) {
        continue;
      }
      minClearance = Math.min(minClearance, Math.hypot(position.x - ringAtomPosition.x, position.y - ringAtomPosition.y));
    }
  }

  return Number.isFinite(minClearance) ? minClearance : 0;
}

function updateAtomGridForMove(layoutGraph, atomGrid, coords, movedPositions) {
  for (const [atomId, nextPosition] of movedPositions) {
    if (layoutGraph.atoms.get(atomId)?.visible !== true) {
      continue;
    }
    const previousPosition = coords.get(atomId);
    if (previousPosition) {
      atomGrid.remove(atomId, previousPosition);
    }
    atomGrid.insert(atomId, nextPosition);
  }
}

function buildCandidateScore(layoutGraph, coords, atomGrid, descriptor, overridePositions, bondLength, allAtomIds) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const representativePosition = ringSubstituentRepresentativePosition(coords, descriptor.representativeAtomIds, overridePositions);
  const reverseRepresentativePosition = descriptor.isRingSystemSubstituent
    ? ringSubstituentRepresentativePosition(coords, descriptor.reverseRepresentativeAtomIds, overridePositions)
    : null;
  const forwardInsideRingCount = representativeInsideRingCount(
    coords,
    descriptor.representativeAtomIds,
    overridePositions,
    descriptor.ringPolygons
  );
  const forwardOutwardDeviation =
    bestOutwardDeviation(anchorPosition, representativePosition, descriptor.outwardAngles)
    ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation;
  const reverseAnchorPosition = descriptor.isRingSystemSubstituent ? positionForAtom(coords, overridePositions, descriptor.rootAtomId) : null;
  const reverseInsideRingCount = descriptor.isRingSystemSubstituent
    ? representativeInsideRingCount(coords, descriptor.reverseRepresentativeAtomIds, overridePositions, descriptor.reverseRingPolygons)
    : 0;
  const reverseOutwardDeviation = descriptor.isRingSystemSubstituent
    ? (
        bestOutwardDeviation(reverseAnchorPosition, reverseRepresentativePosition, descriptor.reverseOutwardAngles)
        ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation
      )
    : 0;
  const outwardFailureCount =
    (descriptor.enforcesOutwardReadability && forwardInsideRingCount === 0 && forwardOutwardDeviation > RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation ? 1 : 0)
    + (
      descriptor.isRingSystemSubstituent
      && descriptor.reverseEnforcesOutwardReadability
      && reverseInsideRingCount === 0
      && reverseOutwardDeviation > RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation
        ? 1
        : 0
    );
  return {
    insideRingCount: forwardInsideRingCount + reverseInsideRingCount,
    outwardFailureCount,
    outwardDeviation:
      (descriptor.enforcesOutwardReadability || descriptor.prefersIdealOutwardGeometry ? forwardOutwardDeviation : 0)
      + (
        descriptor.isRingSystemSubstituent && descriptor.reverseEnforcesOutwardReadability
          ? reverseOutwardDeviation
          : 0
      ),
    enforcesOutwardReadability:
      descriptor.enforcesOutwardReadability
      || (descriptor.isRingSystemSubstituent && descriptor.reverseEnforcesOutwardReadability),
    prefersIdealOutwardGeometry: descriptor.prefersIdealOutwardGeometry,
    isRingSystemSubstituent: descriptor.isRingSystemSubstituent,
    crossingCount: countMovedBondCrossings(layoutGraph, coords, descriptor.subtreeAtomIds, overridePositions),
    overlapCost: computeSubtreeOverlapCost(layoutGraph, coords, descriptor.subtreeAtomIds, overridePositions, bondLength, { atomGrid }),
    anchorDistortion: computeAtomDistortionCost(layoutGraph, coords, descriptor.anchorAtomId, overridePositions),
    anchorClearance: descriptor.isRingSystemSubstituent
      ? Math.min(
          anchorRingClearance(coords, descriptor, overridePositions),
          anchorRingClearance(coords, {
            ...descriptor,
            rootAtomId: descriptor.anchorAtomId,
            representativeAtomIds: descriptor.reverseRepresentativeAtomIds,
            anchorRingAtomIds: descriptor.reverseAnchorRingAtomIds,
            ringPolygons: descriptor.reverseRingPolygons
          }, overridePositions)
        )
      : anchorRingClearance(coords, descriptor, overridePositions),
    boundsArea: boundsAreaWithOverrides(coords, allAtomIds, overridePositions)
  };
}

function isBetterCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.insideRingCount !== incumbent.insideRingCount) {
    return candidate.insideRingCount < incumbent.insideRingCount;
  }
  if (candidate.outwardFailureCount !== incumbent.outwardFailureCount) {
    return candidate.outwardFailureCount < incumbent.outwardFailureCount;
  }
  if ((candidate.enforcesOutwardReadability || candidate.prefersIdealOutwardGeometry) && Math.abs(candidate.outwardDeviation - incumbent.outwardDeviation) > TIDY_ANGLE_EPSILON) {
    return candidate.outwardDeviation < incumbent.outwardDeviation;
  }
  if (candidate.isRingSystemSubstituent && candidate.crossingCount !== incumbent.crossingCount) {
    return candidate.crossingCount < incumbent.crossingCount;
  }
  if (Math.abs(candidate.overlapCost - incumbent.overlapCost) > TIDY_ATOM_EPSILON) {
    return candidate.overlapCost < incumbent.overlapCost;
  }
  if (Math.abs(candidate.anchorDistortion - incumbent.anchorDistortion) > TIDY_ATOM_EPSILON) {
    return candidate.anchorDistortion < incumbent.anchorDistortion;
  }
  if (candidate.isRingSystemSubstituent && Math.abs(candidate.anchorClearance - incumbent.anchorClearance) > TIDY_ATOM_EPSILON) {
    return candidate.anchorClearance > incumbent.anchorClearance;
  }
  if (candidate.isRingSystemSubstituent && Math.abs(candidate.boundsArea - incumbent.boundsArea) > TIDY_BOUNDS_EPSILON) {
    return candidate.boundsArea < incumbent.boundsArea;
  }
  return candidate.angleDelta < incumbent.angleDelta - TIDY_ANGLE_EPSILON;
}

function shouldAcceptCandidate(candidate, baseCandidate, descriptor) {
  if (!candidate) {
    return false;
  }
  const improvesInsideRing = candidate.insideRingCount < baseCandidate.insideRingCount;
  const improvesOutwardFailures = candidate.outwardFailureCount < baseCandidate.outwardFailureCount;
  const improvesOutwardDeviation =
    candidate.outwardFailureCount === baseCandidate.outwardFailureCount
    && candidate.outwardDeviation < baseCandidate.outwardDeviation - 0.05;
  const improvesAnchorClearance =
    candidate.rootAnchored
    && candidate.anchorClearance > baseCandidate.anchorClearance + RING_SUBSTITUENT_TIDY_LIMITS.minRootAnchoredAnchorClearanceImprovement;
  const doesNotWorsenOverlap = candidate.overlapCost <= baseCandidate.overlapCost + TIDY_ATOM_EPSILON;
  const doesNotWorsenDistortion = candidate.anchorDistortion <= baseCandidate.anchorDistortion + TIDY_ATOM_EPSILON;
  const areaImprovement = baseCandidate.boundsArea - candidate.boundsArea;
  const requiredAreaImprovement = candidate.rootAnchored
    ? Math.max(
        RING_SUBSTITUENT_TIDY_LIMITS.minRootAnchoredCompactAreaImprovementAbsolute,
        baseCandidate.boundsArea * RING_SUBSTITUENT_TIDY_LIMITS.minRootAnchoredCompactAreaImprovementFraction
      )
    : Math.max(
        RING_SUBSTITUENT_TIDY_LIMITS.minCompactAreaImprovementAbsolute,
        baseCandidate.boundsArea * RING_SUBSTITUENT_TIDY_LIMITS.minCompactAreaImprovementFraction
      );

  if ((improvesInsideRing || improvesOutwardFailures || improvesOutwardDeviation || improvesAnchorClearance) && doesNotWorsenOverlap && doesNotWorsenDistortion) {
    return true;
  }
  if (!descriptor.isRingSystemSubstituent) {
    return false;
  }
  if (
    candidate.insideRingCount > 0
    || candidate.outwardFailureCount > 0
  ) {
    return false;
  }
  if (
    !doesNotWorsenOverlap
    || !doesNotWorsenDistortion
    || candidate.crossingCount > baseCandidate.crossingCount
  ) {
    return false;
  }
  return areaImprovement >= requiredAreaImprovement;
}

function isZeroFailureRootAnchoredRepair(candidate, baseCandidate) {
  return candidate.rootAnchored
    && candidate.insideRingCount === 0
    && candidate.outwardFailureCount === 0
    && candidate.crossingCount <= baseCandidate.crossingCount
    && candidate.overlapCost <= baseCandidate.overlapCost + TIDY_ATOM_EPSILON
    && candidate.anchorDistortion <= baseCandidate.anchorDistortion + TIDY_ATOM_EPSILON;
}

/**
 * Measures the total local ring-outward angular deviation for tidiable
 * single-substituent ring roots. This is used as a presentation-only
 * tie-breaker when two pipeline stages are equally audit-clean.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {number} Total outward-deviation penalty in radians.
 */
export function measureRingSubstituentPresentationPenalty(layoutGraph, coords) {
  const descriptors = collectTidyeableDescriptors(layoutGraph, coords, null);
  let totalDeviation = 0;

  for (const descriptor of descriptors) {
    const anchorAtom = layoutGraph.atoms.get(descriptor.anchorAtomId);
    const rootAtom = layoutGraph.atoms.get(descriptor.rootAtomId);
    const isIdealLeafDescriptor =
      descriptor.prefersIdealOutwardGeometry
      && !descriptor.isRingSystemSubstituent
      && !descriptor.enforcesOutwardReadability
      && descriptor.outwardAngles.length === 1
      && anchorAtom
      && !anchorAtom.aromatic
      && anchorAtom.heavyDegree === 3;
    const isIdealLinkedRingDescriptor =
      descriptor.linkedRingAnchorAtomId != null
      && descriptor.prefersIdealOutwardGeometry
      && descriptor.isRingSystemSubstituent
      && descriptor.outwardAngles.length === 1
      && rootAtom
      && IDEAL_RING_LINKER_ELEMENTS.has(rootAtom.element)
      && rootAtom.heavyDegree === 2;
    if (
      !isIdealLeafDescriptor
      && !isIdealLinkedRingDescriptor
    ) {
      continue;
    }
    const representativePosition = ringSubstituentRepresentativePosition(coords, descriptor.representativeAtomIds);
    const anchorPosition = coords.get(descriptor.anchorAtomId);
    if (!representativePosition || !anchorPosition) {
      continue;
    }
    const deviation = bestOutwardDeviation(anchorPosition, representativePosition, descriptor.outwardAngles);
    if (Number.isFinite(deviation)) {
      totalDeviation += deviation;
    }
  }

  return totalDeviation;
}

/**
 * Rotates single-bond heavy substituent subtrees attached to ring atoms toward
 * cleaner local outward directions without distorting the subtree geometry.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Hook options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Set<string>|null} [options.frozenAtomIds] - Atoms that must not move.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Adjusted coordinates and move count.
 */
export function runRingSubstituentTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  const allAtomIds = [...coords.keys()];
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  const descriptors = collectTidyeableDescriptors(layoutGraph, coords, frozenAtomIds);
  let nudges = 0;

  for (const descriptor of descriptors) {
    const dynamicDescriptor = refreshDescriptorGeometry(layoutGraph, coords, descriptor);
    const anchorPosition = coords.get(dynamicDescriptor.anchorAtomId);
    const rootPosition = coords.get(dynamicDescriptor.rootAtomId);
    if (!anchorPosition || !rootPosition) {
      continue;
    }

    const currentAngle = angleOf(sub(rootPosition, anchorPosition));
    const candidateAngles = new Set([...TIDY_ROTATION_ANGLES, ...dynamicDescriptor.outwardAngles]);
    if (dynamicDescriptor.isRingSystemSubstituent) {
      for (const reverseOutwardAngle of dynamicDescriptor.reverseOutwardAngles) {
        candidateAngles.add(reverseOutwardAngle + Math.PI);
      }
      for (const relativeRotation of TIDY_ROTATION_ANGLES) {
        candidateAngles.add(currentAngle + relativeRotation);
      }
    }
    const baseCandidate = {
      ...buildCandidateScore(layoutGraph, coords, atomGrid, dynamicDescriptor, null, bondLength, allAtomIds),
      angleDelta: 0
    };
    const baseFailsReadability =
      baseCandidate.insideRingCount > 0
      || baseCandidate.outwardFailureCount > 0;
    const needsIdealOutwardGeometry =
      dynamicDescriptor.prefersIdealOutwardGeometry
      && baseCandidate.outwardDeviation > TIDY_ANGLE_EPSILON;
    if (!baseFailsReadability && !dynamicDescriptor.isRingSystemSubstituent && !needsIdealOutwardGeometry) {
      continue;
    }
    let bestCandidate = null;
    let bestZeroFailureRootCandidate = null;
    if (dynamicDescriptor.isRingSystemSubstituent && dynamicDescriptor.rootRotatingAtomIds.length > 0) {
      for (const rotation of TIDY_ROTATION_ANGLES) {
        if (Math.abs(rotation) <= TIDY_ANGLE_EPSILON) {
          continue;
        }
        const overridePositions = buildRootAnchoredRingSystemPositions(
          coords,
          dynamicDescriptor.rootAtomId,
          dynamicDescriptor.rootRotatingAtomIds,
          rotation
        );
        if (!overridePositions) {
          continue;
        }
        const candidate = {
          ...buildCandidateScore(layoutGraph, coords, atomGrid, dynamicDescriptor, overridePositions, bondLength, allAtomIds),
          angleDelta: Math.abs(rotation),
          overridePositions,
          rootAnchored: true
        };
        if (!shouldAcceptCandidate(candidate, baseCandidate, dynamicDescriptor)) {
          continue;
        }
        if (isZeroFailureRootAnchoredRepair(candidate, baseCandidate) && isBetterCandidate(candidate, bestZeroFailureRootCandidate)) {
          bestZeroFailureRootCandidate = candidate;
        }
        if (isBetterCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    }

    if (!bestZeroFailureRootCandidate) {
      for (const candidateAngle of candidateAngles) {
        const rotation = candidateAngle - currentAngle;
        if (Math.abs(rotation) <= TIDY_ANGLE_EPSILON) {
          continue;
        }
        const overridePositions = buildRotatedSubtreePositions(coords, dynamicDescriptor.anchorAtomId, dynamicDescriptor.subtreeAtomIds, rotation);
        if (!overridePositions) {
          continue;
        }
        const candidate = {
          ...buildCandidateScore(layoutGraph, coords, atomGrid, dynamicDescriptor, overridePositions, bondLength, allAtomIds),
          angleDelta: Math.abs(rotation),
          overridePositions,
          rootAnchored: false
        };
        if (shouldAcceptCandidate(candidate, baseCandidate, dynamicDescriptor) && isBetterCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    }

    if (bestZeroFailureRootCandidate) {
      bestCandidate = bestZeroFailureRootCandidate;
    }

    if (!bestCandidate) {
      continue;
    }

    const movedPositions = [...bestCandidate.overridePositions.entries()];
    updateAtomGridForMove(layoutGraph, atomGrid, coords, movedPositions);
    for (const [atomId, position] of movedPositions) {
      coords.set(atomId, position);
    }
    nudges++;
  }

  return { coords, nudges };
}
