/** @module cleanup/presentation/ring-substituent */

import {
  buildAtomGrid,
  buildSubtreeOverlapContext,
  collectReadableRingSubstituentChildren,
  computeAtomDistortionCost,
  computeSubtreeOverlapCost,
  findSevereOverlaps,
  measureDirectAttachedRingJunctionContinuationDistortion,
  measureRingSubstituentReadability,
  measureTrigonalDistortion,
  ringSubstituentRepresentativePosition,
  supportsRingSubstituentOutwardReadability
} from '../../audit/invariants.js';
import { pointInPolygon } from '../../geometry/polygon.js';
import { computeBounds } from '../../geometry/bounds.js';
import { distancePointToSegment, segmentsProperlyIntersect } from '../../geometry/segments.js';
import { add, angleOf, angularDifference, centroid, fromAngle, rotate, sub } from '../../geometry/vec2.js';
import { computeIncidentRingOutwardAngles } from '../../geometry/ring-direction.js';
import { RING_SUBSTITUENT_READABILITY_LIMITS } from '../../constants.js';
import { measureAttachedCarbonylPresentationPenalty } from './attached-carbonyl.js';
import { visitPresentationDescriptorCandidates } from '../candidate-search.js';
import { containsFrozenAtom } from '../frozen-atoms.js';
import { rotateRigidDescriptorPositions } from '../rigid-rotation.js';
import { collectCutSubtree } from '../subtree-utils.js';

const TIDY_ROTATION_ANGLES = Object.freeze([
  0,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  Math.PI
]);
const TIDY_ANGLE_EPSILON = 1e-6;
const TIDY_ATOM_EPSILON = 1e-6;
const TIDY_BOUNDS_EPSILON = 1e-6;
const IDEAL_RING_LINKER_ELEMENTS = new Set(['N', 'O', 'S', 'Se']);
const IDEAL_LINKED_RING_BRIDGE_ANGLE = (2 * Math.PI) / 3;
const RING_SUBSTITUENT_TIDY_LIMITS = Object.freeze({
  maxSubtreeHeavyAtomCount: 18,
  maxSubtreeAtomCount: 28,
  maxLinkedRingSubtreeHeavyAtomCount: 24,
  maxLinkedRingSubtreeAtomCount: 36,
  minCompactAreaImprovementFraction: 0.04,
  minCompactAreaImprovementAbsolute: 4,
  minRootAnchoredCompactAreaImprovementFraction: 0.03,
  minRootAnchoredCompactAreaImprovementAbsolute: 3,
  minRootAnchoredAnchorClearanceImprovement: 0.4
});

function atomPairKey(firstAtomId, secondAtomId) {
  return firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
}

function linkedRingDescriptorKey(anchorAtomId, rootAtomId, reverseAnchorAtomId) {
  const orderedAnchorAtomIds = [anchorAtomId, reverseAnchorAtomId].sort();
  return `linked-ring:${rootAtomId}:${orderedAnchorAtomIds[0]}:${orderedAnchorAtomIds[1]}`;
}

function incidentRingPolygons(layoutGraph, coords, anchorAtomId) {
  return (layoutGraph.atomToRings.get(anchorAtomId) ?? [])
    .map(ring => ring.atomIds.map(ringAtomId => coords.get(ringAtomId)).filter(Boolean))
    .filter(polygon => polygon.length >= 3);
}

function preferredMultiRingOutwardAngle(layoutGraph, anchorPosition, positions, anchorAtomId) {
  if (!anchorPosition || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) <= 1 || positions.length < 3) {
    return null;
  }
  return angleOf(sub(anchorPosition, centroid(positions)));
}

function incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId) {
  return computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null);
}

function shouldPreferUniqueIncidentRingOutwardAngle(layoutGraph, anchorAtomId, rootAtomId, localOutwardAngles) {
  if (
    !rootAtomId
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) <= 1
    || (layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) > 0
    || localOutwardAngles.length !== 1
  ) {
    return false;
  }

  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, rootAtomId));
  return Boolean(
    rootAtom
    && rootAtom.element === 'C'
    && rootAtom.aromatic !== true
    && bond
    && bond.kind === 'covalent'
    && !bond.inRing
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

function outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId, rootAtomId = null) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  const localOutwardAngles = incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId);
  if (shouldPreferUniqueIncidentRingOutwardAngle(layoutGraph, anchorAtomId, rootAtomId, localOutwardAngles)) {
    return localOutwardAngles;
  }
  const ringSystemOutwardAngle = preferredMultiRingOutwardAngle(
    layoutGraph,
    anchorPosition,
    ringSystemAtomIds(layoutGraph, anchorAtomId, coords).map(atomId => coords.get(atomId)).filter(Boolean),
    anchorAtomId
  );
  if (ringSystemOutwardAngle != null) {
    return [ringSystemOutwardAngle];
  }
  return localOutwardAngles;
}

function ringSystemAtomIds(layoutGraph, atomId, coords, ringSystemById = null) {
  const ringSystemId = layoutGraph.atomToRingSystemId.get(atomId);
  if (ringSystemId == null) {
    return [];
  }
  const ringSystem = ringSystemById ? ringSystemById.get(ringSystemId) : layoutGraph.ringSystems.find(rs => rs.id === ringSystemId);
  return (ringSystem?.atomIds ?? []).filter(candidateAtomId => coords.has(candidateAtomId));
}

function resolveIdealLinkedRingRepresentative(layoutGraph, coords, anchorAtomId, rootAtomId, ringSystemById = null) {
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

  const representativeAtomIds = ringSystemAtomIds(layoutGraph, downstreamAnchorAtomId, coords, ringSystemById);
  if (representativeAtomIds.length === 0) {
    return null;
  }

  return {
    downstreamAnchorAtomId,
    representativeAtomIds
  };
}

/**
 * Returns a root-anchored representative for simple divalent linker atoms that
 * lead into a compact non-ring heavy subtree. This lets cleanup rotate the
 * downstream group around the linker without disturbing the ring-attachment
 * atom itself.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom id.
 * @param {string} rootAtomId - Direct substituent root atom id.
 * @returns {{downstreamAnchorAtomId: string, representativeAtomIds: string[], rootRotatingAtomIds: string[]}|null} Root-anchored representative descriptor, or null when unsupported.
 */
function resolveIdealLinkedSubtreeRepresentative(layoutGraph, coords, anchorAtomId, rootAtomId) {
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
  const downstreamAnchorAtom = downstreamAnchorAtomId ? layoutGraph.atoms.get(downstreamAnchorAtomId) : null;
  if (
    !downstreamAnchorAtomId
    || !downstreamAnchorAtom
    || (layoutGraph.atomToRings.get(downstreamAnchorAtomId)?.length ?? 0) > 0
    || (downstreamAnchorAtom.heavyDegree ?? 0) <= 1
  ) {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
  const rootRotatingAtomIds = subtreeAtomIds.filter(atomId => atomId !== rootAtomId);
  const representativeAtomIds = rootRotatingAtomIds.filter(atomId => layoutGraph.atoms.get(atomId)?.element !== 'H');
  if (representativeAtomIds.length < 2 || rootRotatingAtomIds.length === 0) {
    return null;
  }

  return {
    downstreamAnchorAtomId,
    representativeAtomIds,
    rootRotatingAtomIds
  };
}
function positionForAtom(coords, overridePositions, atomId) {
  return overridePositions?.get(atomId) ?? coords.get(atomId) ?? null;
}

function incidentRingPolygonsWithOverrides(layoutGraph, coords, atomId, overridePositions = null) {
  return (layoutGraph.atomToRings.get(atomId) ?? [])
    .map(ring => ring.atomIds.map(ringAtomId => positionForAtom(coords, overridePositions, ringAtomId)).filter(Boolean))
    .filter(polygon => polygon.length >= 3);
}

function incidentRingOutwardAnglesWithOverrides(layoutGraph, coords, anchorAtomId, overridePositions = null) {
  return computeIncidentRingOutwardAngles(
    layoutGraph,
    anchorAtomId,
    atomId => positionForAtom(coords, overridePositions, atomId)
  );
}

function outwardAnglesForAnchorWithOverrides(layoutGraph, coords, anchorAtomId, overridePositions = null, rootAtomId = null) {
  const anchorPosition = positionForAtom(coords, overridePositions, anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  const localOutwardAngles = incidentRingOutwardAnglesWithOverrides(layoutGraph, coords, anchorAtomId, overridePositions);
  if (shouldPreferUniqueIncidentRingOutwardAngle(layoutGraph, anchorAtomId, rootAtomId, localOutwardAngles)) {
    return localOutwardAngles;
  }
  const ringSystemAtomIdsForAnchor = ringSystemAtomIds(layoutGraph, anchorAtomId, coords);
  const ringSystemOutwardAngle = preferredMultiRingOutwardAngle(
    layoutGraph,
    anchorPosition,
    ringSystemAtomIdsForAnchor
      .map(atomId => positionForAtom(coords, overridePositions, atomId))
      .filter(Boolean),
    anchorAtomId
  );
  if (ringSystemOutwardAngle != null) {
    return [ringSystemOutwardAngle];
  }
  return localOutwardAngles;
}

function countMovedBondCrossings(layoutGraph, coords, subtreeAtomIds, overridePositions, bondIntersectionContext = null) {
  let crossingCount = 0;

  if (!bondIntersectionContext) {
    const movedAtomIds = new Set(subtreeAtomIds);
    const bonds = [...layoutGraph.bonds.values()].filter(bond => bond.kind === 'covalent');
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
        if (firstBond.a === secondBond.a || firstBond.a === secondBond.b || firstBond.b === secondBond.a || firstBond.b === secondBond.b) {
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

  const { movingBonds, staticSegments } = bondIntersectionContext;
  for (let firstIndex = 0; firstIndex < movingBonds.length; firstIndex++) {
    const firstBond = movingBonds[firstIndex];
    const firstStart = positionForAtom(coords, overridePositions, firstBond.a);
    const firstEnd = positionForAtom(coords, overridePositions, firstBond.b);
    if (!firstStart || !firstEnd) {
      continue;
    }

    for (let secondIndex = firstIndex + 1; secondIndex < movingBonds.length; secondIndex++) {
      const secondBond = movingBonds[secondIndex];
      if (firstBond.a === secondBond.a || firstBond.a === secondBond.b || firstBond.b === secondBond.a || firstBond.b === secondBond.b) {
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

    for (let i = 0; i < staticSegments.length; i++) {
      const staticSeg = staticSegments[i];
      if (firstBond.a === staticSeg.aAtomId || firstBond.a === staticSeg.bAtomId || firstBond.b === staticSeg.aAtomId || firstBond.b === staticSeg.bAtomId) {
        continue;
      }
      if (segmentsProperlyIntersect(firstStart, firstEnd, staticSeg.start, staticSeg.end)) {
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

function isRootAnchoredSubtreeDescriptor(descriptor) {
  return descriptor.supportsRootAnchoredOverlapRepair === true;
}

function shouldReplaceTidyeableDescriptor(candidate, incumbent) {
  const candidateRootAnchored = (candidate.rootRotatingAtomIds?.length ?? 0) > 0;
  const incumbentRootAnchored = (incumbent.rootRotatingAtomIds?.length ?? 0) > 0;
  if (candidateRootAnchored !== incumbentRootAnchored) {
    return candidateRootAnchored;
  }
  const candidateLinkedRing = candidate.linkedRingAnchorAtomId != null;
  const incumbentLinkedRing = incumbent.linkedRingAnchorAtomId != null;
  if (candidateLinkedRing !== incumbentLinkedRing) {
    return candidateLinkedRing;
  }
  if (!candidateLinkedRing || !incumbentLinkedRing) {
    return false;
  }
  if (candidate.prefersIdealOutwardGeometry !== incumbent.prefersIdealOutwardGeometry) {
    return candidate.prefersIdealOutwardGeometry;
  }
  if (candidate.subtreeHeavyAtomCount !== incumbent.subtreeHeavyAtomCount) {
    return candidate.subtreeHeavyAtomCount < incumbent.subtreeHeavyAtomCount;
  }
  return candidate.anchorAtomId < incumbent.anchorAtomId;
}

/**
 * Returns a tidy descriptor for a lone terminal multiple-bond leaf attached to
 * a ring trigonal center. These leaves should follow the exact outward ring
 * direction just like other idealized publication-style exocyclic trigonal
 * leaves, but they are not part of the ordinary single-bond substituent pass.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom id.
 * @param {Set<string>|null} frozenAtomIds - Frozen atom ids that must not move.
 * @returns {object|null} Multiple-bond-leaf descriptor, or null when unsupported.
 */
function resolveIdealTerminalMultipleBondLeafDescriptor(layoutGraph, coords, anchorAtomId, frozenAtomIds) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || anchorAtom.aromatic || anchorAtom.heavyDegree !== 3 || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
    return null;
  }

  const exocyclicHeavyBonds = (layoutGraph.bondsByAtomId.get(anchorAtomId) ?? [])
    .filter(bond => bond.kind === 'covalent' && !bond.inRing && !bond.aromatic)
    .map(bond => ({
      bond,
      rootAtomId: bond.a === anchorAtomId ? bond.b : bond.a
    }))
    .filter(({ rootAtomId }) => coords.has(rootAtomId) && layoutGraph.atoms.get(rootAtomId)?.element !== 'H');
  if (exocyclicHeavyBonds.length !== 1) {
    return null;
  }

  const { bond, rootAtomId } = exocyclicHeavyBonds[0];
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.aromatic || (bond.order ?? 1) < 2 || rootAtom.heavyDegree !== 1) {
    return null;
  }

  const outwardAngles = outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId, rootAtomId);
  if (outwardAngles.length === 0) {
    return null;
  }

  const subtreeAtomIds = [rootAtomId];
  if (frozenAtomIds && containsFrozenAtom(subtreeAtomIds, frozenAtomIds)) {
    return null;
  }

  return {
    anchorAtomId,
    rootAtomId,
    representativeAtomIds: [rootAtomId],
    subtreeAtomIds,
    subtreeHeavyAtomCount: 1,
    anchorRingAtomIds: [...new Set((layoutGraph.atomToRings.get(anchorAtomId) ?? []).flatMap(ring => ring.atomIds))],
    ringPolygons: incidentRingPolygons(layoutGraph, coords, anchorAtomId),
    outwardAngles,
    isRingSystemSubstituent: false,
    enforcesOutwardReadability: false,
    prefersIdealOutwardGeometry: true,
    supportsRootAnchoredOverlapRepair: false,
    linkedRingAnchorAtomId: null,
    reverseAnchorAtomId: rootAtomId,
    rootRotatingAtomIds: [],
    reverseRepresentativeAtomIds: [],
    prefersIdealReverseOutwardGeometry: false,
    reverseAnchorRingAtomIds: [],
    reverseRingPolygons: [],
    reverseOutwardAngles: [],
    reverseEnforcesOutwardReadability: false
  };
}

function descriptorTouchesFocusAtomIds(descriptor, focusAtomIds) {
  if (!(focusAtomIds instanceof Set) || focusAtomIds.size === 0) {
    return true;
  }
  for (const atomId of [
    descriptor.anchorAtomId,
    descriptor.rootAtomId,
    descriptor.reverseAnchorAtomId,
    ...descriptor.representativeAtomIds,
    ...descriptor.subtreeAtomIds,
    ...descriptor.rootRotatingAtomIds,
    ...descriptor.reverseRepresentativeAtomIds
  ]) {
    if (focusAtomIds.has(atomId)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether a linked-ring bridge child should stay eligible for tidy
 * even when the same anchor also carries simple one-atom leaves. This covers
 * aryl-ether style bridges on oxygenated fused anchors where rotating the
 * bridge subtree around the anchor can correct the inter-ring exit without
 * moving the sibling leaves.
 * @param {Array<{childAtomId: string, representativeAtomIds: string[]}>} substituentChildren - Readable substituent children for the anchor.
 * @param {string[]} linkedRingChildIds - Child atom ids that lead directly into a different ring system through an ideal linker.
 * @param {string} rootAtomId - Candidate linked-ring root atom id.
 * @returns {boolean} True when the linked-ring bridge should remain tidiable.
 */
function allowsLinkedRingBridgeWithSiblingLeaves(substituentChildren, linkedRingChildIds, rootAtomId) {
  if (substituentChildren.length <= 1 || linkedRingChildIds.length !== 1 || linkedRingChildIds[0] !== rootAtomId) {
    return false;
  }
  return substituentChildren.every(
    child => child.childAtomId === rootAtomId || child.representativeAtomIds.length === 1
  );
}

function collectTidyeableDescriptors(layoutGraph, coords, frozenAtomIds, focusAtomIds = null, options = {}) {
  const descriptorsByPair = new Map();
  const ringSystemById = new Map(layoutGraph.ringSystems.map(rs => [rs.id, rs]));
  const focusSet = focusAtomIds instanceof Set && focusAtomIds.size > 0 ? focusAtomIds : null;
  const includeRingSystemSubstituents = options.includeRingSystemSubstituents !== false;

  for (const anchorAtomId of coords.keys()) {
    if (focusSet && !focusSet.has(anchorAtomId)) {
      continue;
    }
    if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
      continue;
    }
    const terminalMultipleBondLeafDescriptor = resolveIdealTerminalMultipleBondLeafDescriptor(
      layoutGraph,
      coords,
      anchorAtomId,
      frozenAtomIds
    );
    if (terminalMultipleBondLeafDescriptor) {
      const multipleBondLeafPairId = atomPairKey(
        terminalMultipleBondLeafDescriptor.anchorAtomId,
        terminalMultipleBondLeafDescriptor.rootAtomId
      );
      const multipleBondLeafIncumbent = descriptorsByPair.get(multipleBondLeafPairId);
      if (!multipleBondLeafIncumbent || shouldReplaceTidyeableDescriptor(terminalMultipleBondLeafDescriptor, multipleBondLeafIncumbent)) {
        descriptorsByPair.set(multipleBondLeafPairId, terminalMultipleBondLeafDescriptor);
      }
    }

    const substituentChildren = collectReadableRingSubstituentChildren(layoutGraph, coords, anchorAtomId);
    const enforcesOutwardReadability = supportsRingSubstituentOutwardReadability(layoutGraph, anchorAtomId);
    const linkedRingRepresentativesByChildId = new Map(
      substituentChildren.map(child => [
        child.childAtomId,
        resolveIdealLinkedRingRepresentative(layoutGraph, coords, anchorAtomId, child.childAtomId, ringSystemById)
      ])
    );
    const linkedRingChildIds = [...linkedRingRepresentativesByChildId.entries()]
      .filter(([, representative]) => representative != null)
      .map(([childAtomId]) => childAtomId);

    for (const substituentChild of substituentChildren) {
      const rootAtomId = substituentChild.childAtomId;
      const linkedRingRepresentative = linkedRingRepresentativesByChildId.get(rootAtomId) ?? null;
      const allowSiblingLeafLinkedRingBridge = allowsLinkedRingBridgeWithSiblingLeaves(
        substituentChildren,
        linkedRingChildIds,
        rootAtomId
      );
      if (substituentChildren.length !== 1 && !allowSiblingLeafLinkedRingBridge) {
        continue;
      }

      const linkedSubtreeRepresentative = linkedRingRepresentative ? null : resolveIdealLinkedSubtreeRepresentative(layoutGraph, coords, anchorAtomId, rootAtomId);
      const isDirectAttachedRingSystemSubstituent =
        linkedRingRepresentative == null
        && substituentChild.representativeAtomIds.length > 1
        && (layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) > 0;
      const prefersIdealOutwardGeometry =
        (substituentChildren.length === 1 && (
          substituentChild.representativeAtomIds.length === 1
          || isDirectAttachedRingSystemSubstituent
        ))
        || allowSiblingLeafLinkedRingBridge;
      const allowsRingSystemCompaction =
        (substituentChildren.length === 1 && substituentChild.representativeAtomIds.length > 1)
        || allowSiblingLeafLinkedRingBridge;
      if (!enforcesOutwardReadability && !allowsRingSystemCompaction && !prefersIdealOutwardGeometry) {
        continue;
      }

      const reverseAnchorAtomId = linkedRingRepresentative?.downstreamAnchorAtomId ?? rootAtomId;
      // A downstream representative may itself be a ring (for example a sulfone
      // or amide root that leads into a terminal piperidine), but that does not
      // make the root bond a direct ring-to-ring attachment. Reserve the
      // ring-system-specific cleanup path for true direct-attached or linked
      // ring exits so ordinary rigid branches do not oscillate between mirrored
      // poses across tidy passes.
      const isRingSystemSubstituent = linkedRingRepresentative != null || isDirectAttachedRingSystemSubstituent;
      const representativeAtomIds =
        linkedRingRepresentative?.representativeAtomIds
        ?? linkedSubtreeRepresentative?.representativeAtomIds
        ?? substituentChild.representativeAtomIds;
      const bondPairId = atomPairKey(anchorAtomId, rootAtomId);
      const pairId = linkedRingRepresentative
        ? linkedRingDescriptorKey(anchorAtomId, rootAtomId, reverseAnchorAtomId)
        : bondPairId;

      const bond = layoutGraph.bondByAtomPair.get(bondPairId);
      if (!bond || bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) !== 1) {
        continue;
      }

      const maxSubtreeAtomCount = linkedRingRepresentative
        ? RING_SUBSTITUENT_TIDY_LIMITS.maxLinkedRingSubtreeAtomCount
        : RING_SUBSTITUENT_TIDY_LIMITS.maxSubtreeAtomCount;
      const maxSubtreeHeavyAtomCount = linkedRingRepresentative
        ? RING_SUBSTITUENT_TIDY_LIMITS.maxLinkedRingSubtreeHeavyAtomCount
        : RING_SUBSTITUENT_TIDY_LIMITS.maxSubtreeHeavyAtomCount;
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
      if (subtreeAtomIds.length === 0 || subtreeAtomIds.length > maxSubtreeAtomCount) {
        continue;
      }
      const subtreeHeavyAtomCount = subtreeAtomIds.reduce(
        (count, atomId) => count + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1),
        0
      );
      if (subtreeHeavyAtomCount > maxSubtreeHeavyAtomCount) {
        continue;
      }
      if (frozenAtomIds && containsFrozenAtom(subtreeAtomIds, frozenAtomIds)) {
        continue;
      }

      const outwardAngles = outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId, rootAtomId);
      if (outwardAngles.length === 0) {
        continue;
      }

      const reverseRepresentativeAtomIds = isRingSystemSubstituent ? ringSystemAtomIds(layoutGraph, anchorAtomId, coords, ringSystemById) : [];
      const descriptor = {
        anchorAtomId,
        rootAtomId,
        representativeAtomIds,
        subtreeAtomIds,
        subtreeHeavyAtomCount,
        anchorRingAtomIds: [...new Set((layoutGraph.atomToRings.get(anchorAtomId) ?? []).flatMap(ring => ring.atomIds))],
        ringPolygons: incidentRingPolygons(layoutGraph, coords, anchorAtomId),
        outwardAngles,
        isRingSystemSubstituent,
        enforcesOutwardReadability,
        prefersIdealOutwardGeometry,
        supportsRootAnchoredOverlapRepair: linkedSubtreeRepresentative != null,
        linkedRingAnchorAtomId: linkedRingRepresentative?.downstreamAnchorAtomId ?? null,
        reverseAnchorAtomId,
        rootRotatingAtomIds:
          linkedRingRepresentative
            ? subtreeAtomIds.filter(atomId => atomId !== rootAtomId)
            : (linkedSubtreeRepresentative?.rootRotatingAtomIds ?? []),
        reverseRepresentativeAtomIds,
        prefersIdealReverseOutwardGeometry: linkedRingRepresentative != null,
        reverseAnchorRingAtomIds: isRingSystemSubstituent
          ? [...new Set((layoutGraph.atomToRings.get(reverseAnchorAtomId) ?? []).flatMap(ring => ring.atomIds))]
          : [],
        reverseRingPolygons: isRingSystemSubstituent ? incidentRingPolygons(layoutGraph, coords, reverseAnchorAtomId) : [],
        reverseOutwardAngles: isRingSystemSubstituent ? outwardAnglesForAnchor(layoutGraph, coords, reverseAnchorAtomId) : [],
        reverseEnforcesOutwardReadability: isRingSystemSubstituent
          ? supportsRingSubstituentOutwardReadability(layoutGraph, reverseAnchorAtomId)
          : false
      };
      if (!descriptorTouchesFocusAtomIds(descriptor, focusSet)) {
        continue;
      }
      if (!includeRingSystemSubstituents && descriptor.isRingSystemSubstituent) {
        continue;
      }
      const incumbent = descriptorsByPair.get(pairId);
      if (!incumbent || shouldReplaceTidyeableDescriptor(descriptor, incumbent)) {
        descriptorsByPair.set(pairId, descriptor);
      }
    }
  }

  return [...descriptorsByPair.values()];
}

function refreshDescriptorGeometry(layoutGraph, coords, descriptor) {
  return {
    ...descriptor,
    anchorRingAtomIds: [...new Set((layoutGraph.atomToRings.get(descriptor.anchorAtomId) ?? []).flatMap(ring => ring.atomIds))],
    ringPolygons: incidentRingPolygons(layoutGraph, coords, descriptor.anchorAtomId),
    outwardAngles: outwardAnglesForAnchor(layoutGraph, coords, descriptor.anchorAtomId, descriptor.rootAtomId),
    reverseAnchorRingAtomIds: descriptor.isRingSystemSubstituent
      ? [...new Set((layoutGraph.atomToRings.get(descriptor.reverseAnchorAtomId) ?? []).flatMap(ring => ring.atomIds))]
      : descriptor.reverseAnchorRingAtomIds,
    reverseRingPolygons: descriptor.isRingSystemSubstituent
      ? incidentRingPolygons(layoutGraph, coords, descriptor.reverseAnchorAtomId)
      : descriptor.reverseRingPolygons,
    reverseOutwardAngles: descriptor.isRingSystemSubstituent
      ? outwardAnglesForAnchor(layoutGraph, coords, descriptor.reverseAnchorAtomId)
      : descriptor.reverseOutwardAngles,
    reverseEnforcesOutwardReadability: descriptor.isRingSystemSubstituent
      ? supportsRingSubstituentOutwardReadability(layoutGraph, descriptor.reverseAnchorAtomId)
      : descriptor.reverseEnforcesOutwardReadability
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

function linkedRingBridgeAngleDeviation(anchorPosition, rootPosition, reverseAnchorPosition) {
  if (!anchorPosition || !rootPosition || !reverseAnchorPosition) {
    return null;
  }
  const bridgeAngle = angularDifference(
    angleOf(sub(anchorPosition, rootPosition)),
    angleOf(sub(reverseAnchorPosition, rootPosition))
  );
  return Math.abs(bridgeAngle - IDEAL_LINKED_RING_BRIDGE_ANGLE);
}

/**
 * Builds the exact outward-angle candidate for an idealized single-atom leaf
 * descriptor. This lets cleanup try the true publication-style outward slot
 * before exploring the broader rotation lattice.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {AtomGrid} atomGrid - Spatial grid for the current coordinates.
 * @param {object} descriptor - Dynamic tidy descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {string[]} allAtomIds - All placed atom ids.
 * @param {object|null} [bondIntersectionContext] - Optional cached crossing context.
 * @param {object|null} [subtreeContext] - Optional cached subtree-overlap context.
 * @returns {object|null} Exact outward candidate, or null when unavailable.
 */
function buildExactIdealLeafCandidate(layoutGraph, coords, atomGrid, descriptor, bondLength, allAtomIds, bondIntersectionContext = null, subtreeContext = null) {
  if (
    descriptor.isRingSystemSubstituent
    || !descriptor.prefersIdealOutwardGeometry
    || descriptor.rootRotatingAtomIds.length > 0
    || descriptor.subtreeAtomIds.length !== 1
    || descriptor.outwardAngles.length !== 1
  ) {
    return null;
  }

  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return null;
  }

  const bondDistance = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y);
  if (bondDistance <= TIDY_ATOM_EPSILON) {
    return null;
  }

  const targetAngle = descriptor.outwardAngles[0];
  const overridePositions = new Map([
    [descriptor.rootAtomId, add(anchorPosition, fromAngle(targetAngle, bondDistance))]
  ]);
  return {
    ...buildCandidateScore(layoutGraph, coords, atomGrid, descriptor, overridePositions, bondLength, allAtomIds, bondIntersectionContext, subtreeContext),
    angleDelta: angularDifference(angleOf(sub(rootPosition, anchorPosition)), targetAngle),
    overridePositions,
    rootAnchored: false
  };
}

/**
 * Builds an exact dual-outward candidate for ideal linked-ring bridge
 * descriptors. It first re-snaps the linker root onto the anchor's exact
 * outward ray, then rotates the downstream ring system around that linker so
 * the reverse ring exit also lands on its exact outward ray.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {AtomGrid} atomGrid - Spatial grid for the current coordinates.
 * @param {object} descriptor - Dynamic tidy descriptor.
 * @param {number} bondLength - Target bond length.
 * @param {string[]} allAtomIds - All placed atom ids.
 * @param {object|null} [bondIntersectionContext] - Optional cached crossing context.
 * @param {object|null} [subtreeContext] - Optional cached subtree-overlap context.
 * @returns {object|null} Best exact linked-ring candidate, or null when unavailable.
 */
function buildExactIdealLinkedRingCandidate(layoutGraph, coords, atomGrid, descriptor, bondLength, allAtomIds, bondIntersectionContext = null, subtreeContext = null) {
  if (
    descriptor.linkedRingAnchorAtomId == null
    || !descriptor.prefersIdealOutwardGeometry
    || !descriptor.prefersIdealReverseOutwardGeometry
    || descriptor.outwardAngles.length === 0
    || descriptor.reverseOutwardAngles.length === 0
    || descriptor.rootRotatingAtomIds.length === 0
  ) {
    return null;
  }

  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  const reverseAnchorPosition = coords.get(descriptor.reverseAnchorAtomId);
  if (!anchorPosition || !rootPosition || !reverseAnchorPosition) {
    return null;
  }

  const bondDistance = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y);
  if (bondDistance <= TIDY_ATOM_EPSILON) {
    return null;
  }

  const currentForwardAngle = angleOf(sub(rootPosition, anchorPosition));
  const currentReverseAngle = angleOf(sub(reverseAnchorPosition, rootPosition));
  let bestCandidate = null;

  for (const forwardOutwardAngle of descriptor.outwardAngles) {
    const nextRootPosition = add(anchorPosition, fromAngle(forwardOutwardAngle, bondDistance));
    for (const reverseOutwardAngle of descriptor.reverseOutwardAngles) {
      const rotation = (reverseOutwardAngle + Math.PI) - currentReverseAngle;
      const overridePositions = new Map([
        [descriptor.rootAtomId, nextRootPosition]
      ]);
      for (const atomId of descriptor.rootRotatingAtomIds) {
        const currentPosition = coords.get(atomId);
        if (!currentPosition) {
          continue;
        }
        overridePositions.set(
          atomId,
          add(nextRootPosition, rotate(sub(currentPosition, rootPosition), rotation))
        );
      }
      const candidate = {
        ...buildCandidateScore(layoutGraph, coords, atomGrid, descriptor, overridePositions, bondLength, allAtomIds, bondIntersectionContext, subtreeContext),
        angleDelta: angularDifference(currentForwardAngle, forwardOutwardAngle) + Math.abs(rotation),
        overridePositions,
        rootAnchored: false
      };
      if (isBetterCandidate(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    }
  }

  return bestCandidate;
}

/**
 * Builds an exact outward-root candidate for direct-attached ring-system
 * substituents. These cases should judge exactness from the actual
 * anchor-to-root bond direction, not the downstream ring centroid.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {AtomGrid} atomGrid - Spatial grid for the current coordinates.
 * @param {object} descriptor - Dynamic tidy descriptor.
 * @param {object} baseCandidate - Current descriptor score.
 * @param {number} bondLength - Target bond length.
 * @param {string[]} allAtomIds - All placed atom ids.
 * @param {object|null} [bondIntersectionContext] - Optional cached crossing context.
 * @param {object|null} [subtreeContext] - Optional cached subtree-overlap context.
 * @returns {object|null} Exact direct-attached ring-root candidate, or null when unavailable.
 */
function buildExactDirectAttachedRingSystemRootCandidate(
  layoutGraph,
  coords,
  atomGrid,
  descriptor,
  baseCandidate,
  bondLength,
  allAtomIds,
  bondIntersectionContext = null,
  subtreeContext = null
) {
  if (
    !descriptor.isRingSystemSubstituent
    || descriptor.linkedRingAnchorAtomId != null
    || !descriptor.prefersIdealOutwardGeometry
    || descriptor.outwardAngles.length === 0
  ) {
    return null;
  }

  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return null;
  }

  const baseRootOutwardDeviation = bestOutwardDeviation(anchorPosition, rootPosition, descriptor.outwardAngles);
  if (!(baseRootOutwardDeviation > TIDY_ANGLE_EPSILON)) {
    return null;
  }

  const currentAngle = angleOf(sub(rootPosition, anchorPosition));
  let bestCandidate = null;
  for (const targetAngle of descriptor.outwardAngles) {
    const rotation = targetAngle - currentAngle;
    if (Math.abs(rotation) <= TIDY_ANGLE_EPSILON) {
      continue;
    }
    const overridePositions = rotateRigidDescriptorPositions(coords, descriptor, rotation);
    const candidate = {
      ...buildCandidateScore(
        layoutGraph,
        coords,
        atomGrid,
        descriptor,
        overridePositions,
        bondLength,
        allAtomIds,
        bondIntersectionContext,
        subtreeContext
      ),
      angleDelta: Math.abs(rotation),
      overridePositions,
      rootAnchored: false
    };
    const candidateRootPosition = positionForAtom(coords, overridePositions, descriptor.rootAtomId);
    const candidateRootOutwardDeviation = bestOutwardDeviation(anchorPosition, candidateRootPosition, descriptor.outwardAngles);
    if (
      !Number.isFinite(candidateRootOutwardDeviation)
      || candidateRootOutwardDeviation > TIDY_ANGLE_EPSILON
      || candidate.insideRingCount > baseCandidate.insideRingCount
      || candidate.outwardFailureCount > baseCandidate.outwardFailureCount
      || candidate.crossingCount > baseCandidate.crossingCount
      || candidate.overlapCost > baseCandidate.overlapCost + TIDY_ATOM_EPSILON
      || candidate.anchorDistortion > baseCandidate.anchorDistortion + TIDY_ATOM_EPSILON
    ) {
      continue;
    }
    if (isBetterCandidate(candidate, bestCandidate)) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate;
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

function anchorRingClearance(layoutGraph, coords, descriptor, overridePositions) {
  if (!descriptor.isRingSystemSubstituent) {
    return 0;
  }
  const probeAtomIds = descriptor.representativeAtomIds.filter(atomId => atomId !== descriptor.rootAtomId);
  if (probeAtomIds.length === 0) {
    return 0;
  }

  const ringPolygons = incidentRingPolygonsWithOverrides(layoutGraph, coords, descriptor.anchorAtomId, overridePositions);
  let minClearance = Number.POSITIVE_INFINITY;
  for (const atomId of probeAtomIds) {
    const position = positionForAtom(coords, overridePositions, atomId);
    if (!position) {
      continue;
    }
    for (const polygon of ringPolygons) {
      for (let index = 0; index < polygon.length; index++) {
        const firstPoint = polygon[index];
        const secondPoint = polygon[(index + 1) % polygon.length];
        minClearance = Math.min(minClearance, distancePointToSegment(position, firstPoint, secondPoint));
      }
    }
    for (const ringAtomId of descriptor.anchorRingAtomIds) {
      const ringAtomPosition = positionForAtom(coords, overridePositions, ringAtomId);
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

function buildCandidateScore(layoutGraph, coords, atomGrid, descriptor, overridePositions, bondLength, allAtomIds, bondIntersectionContext = null, subtreeContext = null) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = positionForAtom(coords, overridePositions, descriptor.rootAtomId);
  const reverseAnchorPosition = descriptor.isRingSystemSubstituent ? positionForAtom(coords, overridePositions, descriptor.reverseAnchorAtomId) : null;
  const prefersDirectAttachedRingRootOutwardGeometry =
    descriptor.isRingSystemSubstituent
    && descriptor.linkedRingAnchorAtomId == null
    && descriptor.prefersIdealOutwardGeometry;
  const scoreReverseDirectAttachedRingSystemReadability = !prefersDirectAttachedRingRootOutwardGeometry;
  const forwardRingPolygons = incidentRingPolygonsWithOverrides(layoutGraph, coords, descriptor.anchorAtomId, overridePositions);
  const reverseRingPolygons = descriptor.isRingSystemSubstituent
    ? incidentRingPolygonsWithOverrides(layoutGraph, coords, descriptor.reverseAnchorAtomId, overridePositions)
    : [];
  const forwardOutwardAngles = outwardAnglesForAnchorWithOverrides(
    layoutGraph,
    coords,
    descriptor.anchorAtomId,
    overridePositions,
    descriptor.rootAtomId
  );
  const reverseOutwardAngles = descriptor.isRingSystemSubstituent
    ? outwardAnglesForAnchorWithOverrides(layoutGraph, coords, descriptor.reverseAnchorAtomId, overridePositions)
    : [];
  const representativePosition = ringSubstituentRepresentativePosition(coords, descriptor.representativeAtomIds, overridePositions);
  const reverseRepresentativePosition = descriptor.isRingSystemSubstituent
    ? ringSubstituentRepresentativePosition(coords, descriptor.reverseRepresentativeAtomIds, overridePositions)
    : null;
  const forwardInsideRingCount = representativeInsideRingCount(
    coords,
    descriptor.representativeAtomIds,
    overridePositions,
    forwardRingPolygons
  );
  const forwardOutwardDeviation = (descriptor.linkedRingAnchorAtomId != null || prefersDirectAttachedRingRootOutwardGeometry)
    ? (
        bestOutwardDeviation(anchorPosition, rootPosition, forwardOutwardAngles)
        ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation
      )
    : (
        bestOutwardDeviation(anchorPosition, representativePosition, forwardOutwardAngles)
        ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation
      );
  const reverseInsideRingCount = descriptor.isRingSystemSubstituent && scoreReverseDirectAttachedRingSystemReadability
    ? representativeInsideRingCount(coords, descriptor.reverseRepresentativeAtomIds, overridePositions, reverseRingPolygons)
    : 0;
  const reverseOutwardDeviation = descriptor.isRingSystemSubstituent && scoreReverseDirectAttachedRingSystemReadability
    ? (
        descriptor.linkedRingAnchorAtomId != null
          ? (
              bestOutwardDeviation(reverseAnchorPosition, rootPosition, reverseOutwardAngles)
              ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation
            )
          : (
              bestOutwardDeviation(reverseAnchorPosition, reverseRepresentativePosition, reverseOutwardAngles)
              ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation
            )
      )
    : 0;
  const bridgeAngleDeviation = descriptor.linkedRingAnchorAtomId != null
    ? (
        linkedRingBridgeAngleDeviation(anchorPosition, rootPosition, reverseAnchorPosition)
        ?? Math.PI
      )
    : 0;
  const localGeometryDistortion =
    computeAtomDistortionCost(layoutGraph, coords, descriptor.anchorAtomId, overridePositions)
    + (
      descriptor.supportsRootAnchoredOverlapRepair
        ? computeAtomDistortionCost(layoutGraph, coords, descriptor.rootAtomId, overridePositions)
        : 0
    );
  const prefersIdealOutwardGeometry =
    descriptor.prefersIdealOutwardGeometry
    || descriptor.prefersIdealReverseOutwardGeometry;
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
        descriptor.isRingSystemSubstituent && (descriptor.reverseEnforcesOutwardReadability || descriptor.prefersIdealReverseOutwardGeometry)
          ? reverseOutwardDeviation
          : 0
      ),
    enforcesOutwardReadability:
      descriptor.enforcesOutwardReadability
      || (descriptor.isRingSystemSubstituent && descriptor.reverseEnforcesOutwardReadability),
    prefersIdealOutwardGeometry,
    isRingSystemSubstituent: descriptor.isRingSystemSubstituent,
    linkedRingAnchorAtomId: descriptor.linkedRingAnchorAtomId,
    bridgeAngleDeviation,
    crossingCount: countMovedBondCrossings(layoutGraph, coords, descriptor.subtreeAtomIds, overridePositions, bondIntersectionContext),
    overlapCost: computeSubtreeOverlapCost(layoutGraph, coords, descriptor.subtreeAtomIds, overridePositions, bondLength, { atomGrid, subtreeContext }),
    anchorDistortion: localGeometryDistortion,
    anchorClearance: descriptor.isRingSystemSubstituent
      ? Math.min(
          anchorRingClearance(layoutGraph, coords, descriptor, overridePositions),
          anchorRingClearance(layoutGraph, coords, {
            ...descriptor,
            anchorAtomId: descriptor.reverseAnchorAtomId,
            rootAtomId: descriptor.anchorAtomId,
            representativeAtomIds: descriptor.reverseRepresentativeAtomIds,
            anchorRingAtomIds: descriptor.reverseAnchorRingAtomIds,
            ringPolygons: descriptor.reverseRingPolygons
          }, overridePositions)
        )
      : anchorRingClearance(layoutGraph, coords, descriptor, overridePositions),
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
  if (candidate.linkedRingAnchorAtomId != null && Math.abs(candidate.bridgeAngleDeviation - incumbent.bridgeAngleDeviation) > TIDY_ANGLE_EPSILON) {
    return candidate.bridgeAngleDeviation < incumbent.bridgeAngleDeviation;
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
  const improvesOverlap = candidate.overlapCost < baseCandidate.overlapCost - TIDY_ATOM_EPSILON;
  const improvesOutwardDeviation =
    candidate.outwardFailureCount === baseCandidate.outwardFailureCount
    && candidate.outwardDeviation < baseCandidate.outwardDeviation - 0.05;
  const improvesBridgeAngle =
    descriptor.linkedRingAnchorAtomId != null
    && candidate.bridgeAngleDeviation < baseCandidate.bridgeAngleDeviation - 0.05;
  const improvesAnchorClearance =
    candidate.rootAnchored
    && candidate.anchorClearance > baseCandidate.anchorClearance + RING_SUBSTITUENT_TIDY_LIMITS.minRootAnchoredAnchorClearanceImprovement;
  const doesNotWorsenOverlap = candidate.overlapCost <= baseCandidate.overlapCost + TIDY_ATOM_EPSILON;
  const doesNotWorsenDistortion = candidate.anchorDistortion <= baseCandidate.anchorDistortion + TIDY_ATOM_EPSILON;
  const doesNotWorsenIdealOutwardGeometry =
    !descriptor.prefersIdealOutwardGeometry
    || candidate.outwardDeviation <= baseCandidate.outwardDeviation + TIDY_ANGLE_EPSILON;
  const doesNotWorsenBridgeAngle =
    descriptor.linkedRingAnchorAtomId == null
    || candidate.bridgeAngleDeviation <= baseCandidate.bridgeAngleDeviation + TIDY_ANGLE_EPSILON;
  const improvesExactLinkedRingOutwardBalance =
    descriptor.linkedRingAnchorAtomId != null
    && descriptor.prefersIdealOutwardGeometry
    && descriptor.prefersIdealReverseOutwardGeometry
    && candidate.outwardDeviation <= TIDY_ANGLE_EPSILON
    && candidate.outwardDeviation < baseCandidate.outwardDeviation - TIDY_ANGLE_EPSILON
    && candidate.bridgeAngleDeviation
      <= (baseCandidate.outwardDeviation + baseCandidate.bridgeAngleDeviation + TIDY_ANGLE_EPSILON);
  const improvesExactDirectAttachedRingOutwardGeometry =
    descriptor.linkedRingAnchorAtomId == null
    && descriptor.isRingSystemSubstituent
    && descriptor.prefersIdealOutwardGeometry
    && candidate.outwardDeviation <= TIDY_ANGLE_EPSILON
    && candidate.outwardDeviation < baseCandidate.outwardDeviation - TIDY_ANGLE_EPSILON;
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

  if (
    descriptor.supportsRootAnchoredOverlapRepair
    && candidate.rootAnchored
    && improvesOverlap
    && candidate.insideRingCount <= baseCandidate.insideRingCount
    && candidate.outwardFailureCount <= baseCandidate.outwardFailureCount
    && doesNotWorsenDistortion
    && doesNotWorsenIdealOutwardGeometry
    && doesNotWorsenBridgeAngle
    && candidate.crossingCount <= baseCandidate.crossingCount
  ) {
    return true;
  }
  if (
    improvesExactLinkedRingOutwardBalance
    && candidate.insideRingCount <= baseCandidate.insideRingCount
    && candidate.outwardFailureCount <= baseCandidate.outwardFailureCount
    && candidate.crossingCount <= baseCandidate.crossingCount
    && doesNotWorsenOverlap
    && doesNotWorsenDistortion
  ) {
    return true;
  }
  if (
    improvesExactDirectAttachedRingOutwardGeometry
    && candidate.insideRingCount <= baseCandidate.insideRingCount
    && candidate.outwardFailureCount <= baseCandidate.outwardFailureCount
    && candidate.crossingCount <= baseCandidate.crossingCount
    && doesNotWorsenOverlap
    && doesNotWorsenDistortion
  ) {
    return true;
  }
  if ((improvesInsideRing || improvesOutwardFailures || improvesOutwardDeviation || improvesBridgeAngle || improvesAnchorClearance) && doesNotWorsenOverlap && doesNotWorsenDistortion && doesNotWorsenBridgeAngle) {
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
    || !doesNotWorsenIdealOutwardGeometry
    || !doesNotWorsenBridgeAngle
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

function readabilityHardMetricsWorsen(candidate, base) {
  return (candidate.failingSubstituentCount ?? 0) > (base.failingSubstituentCount ?? 0)
    || (candidate.inwardSubstituentCount ?? 0) > (base.inwardSubstituentCount ?? 0)
    || (candidate.outwardAxisFailureCount ?? 0) > (base.outwardAxisFailureCount ?? 0)
    || (candidate.maxOutwardDeviation ?? 0) > (base.maxOutwardDeviation ?? 0) + TIDY_ANGLE_EPSILON;
}

function isBetterDirectAttachedRingRootRetidyCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.overlapCount !== incumbent.overlapCount) {
    return candidate.overlapCount < incumbent.overlapCount;
  }
  if ((candidate.readability.failingSubstituentCount ?? 0) !== (incumbent.readability.failingSubstituentCount ?? 0)) {
    return (candidate.readability.failingSubstituentCount ?? 0) < (incumbent.readability.failingSubstituentCount ?? 0);
  }
  if ((candidate.readability.inwardSubstituentCount ?? 0) !== (incumbent.readability.inwardSubstituentCount ?? 0)) {
    return (candidate.readability.inwardSubstituentCount ?? 0) < (incumbent.readability.inwardSubstituentCount ?? 0);
  }
  if ((candidate.readability.outwardAxisFailureCount ?? 0) !== (incumbent.readability.outwardAxisFailureCount ?? 0)) {
    return (candidate.readability.outwardAxisFailureCount ?? 0) < (incumbent.readability.outwardAxisFailureCount ?? 0);
  }
  if (Math.abs((candidate.readability.totalOutwardDeviation ?? 0) - (incumbent.readability.totalOutwardDeviation ?? 0)) > TIDY_ANGLE_EPSILON) {
    return (candidate.readability.totalOutwardDeviation ?? 0) < (incumbent.readability.totalOutwardDeviation ?? 0);
  }
  if (Math.abs((candidate.readability.maxOutwardDeviation ?? 0) - (incumbent.readability.maxOutwardDeviation ?? 0)) > TIDY_ANGLE_EPSILON) {
    return (candidate.readability.maxOutwardDeviation ?? 0) < (incumbent.readability.maxOutwardDeviation ?? 0);
  }
  return candidate.angleDelta < incumbent.angleDelta - TIDY_ANGLE_EPSILON;
}

/**
 * Measures the total local ring-outward angular deviation for tidiable
 * single-substituent ring roots. This is used as a presentation-only
 * tie-breaker when two pipeline stages are equally audit-clean.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{focusAtomIds?: Set<string>|null}} [options] - Optional local scoring focus.
 * @returns {number} Total outward-deviation penalty in radians.
 */
export function measureRingSubstituentPresentationPenalty(layoutGraph, coords, options = {}) {
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  const includeLinkedRingBridgePenalty = options.includeLinkedRingBridgePenalty === true;
  const descriptors = collectTidyeableDescriptors(layoutGraph, coords, null, focusAtomIds, options);
  let totalDeviation = 0;

  for (const descriptor of descriptors) {
    const anchorAtom = layoutGraph.atoms.get(descriptor.anchorAtomId);
    const rootAtom = layoutGraph.atoms.get(descriptor.rootAtomId);
    const anchorRingCount = layoutGraph.atomToRings.get(descriptor.anchorAtomId)?.length ?? 0;
    const anchorPosition = coords.get(descriptor.anchorAtomId);
    const rootPosition = coords.get(descriptor.rootAtomId);
    const reverseAnchorPosition = descriptor.isRingSystemSubstituent ? coords.get(descriptor.reverseAnchorAtomId) : null;
    const reverseAttachedRingTargetPosition = descriptor.isRingSystemSubstituent
      ? (descriptor.linkedRingAnchorAtomId != null ? rootPosition : anchorPosition)
      : null;
    const representativePosition = ringSubstituentRepresentativePosition(coords, descriptor.representativeAtomIds);
    if (!anchorPosition || !rootPosition) {
      continue;
    }

    // Attached-ring exits should read as outward continuations on both sides of
    // the inter-ring bond, not only when one anchor is aromatic.
    const forwardAttachedRingDeviation = descriptor.isRingSystemSubstituent
      ? bestOutwardDeviation(anchorPosition, rootPosition, descriptor.outwardAngles)
      : null;
    const reverseAttachedRingDeviation = descriptor.isRingSystemSubstituent
      ? bestOutwardDeviation(reverseAnchorPosition, reverseAttachedRingTargetPosition, descriptor.reverseOutwardAngles)
      : null;
    const forwardAromaticDeviation = !descriptor.isRingSystemSubstituent && anchorAtom?.aromatic === true
      ? bestOutwardDeviation(anchorPosition, rootPosition, descriptor.outwardAngles)
      : null;
    const reverseAromaticDeviation = null;
    if (Number.isFinite(forwardAttachedRingDeviation)) {
      totalDeviation += forwardAttachedRingDeviation;
    }
    if (Number.isFinite(reverseAttachedRingDeviation)) {
      totalDeviation += reverseAttachedRingDeviation;
    }
    if (Number.isFinite(forwardAromaticDeviation)) {
      totalDeviation += forwardAromaticDeviation;
    }
    if (Number.isFinite(reverseAromaticDeviation)) {
      totalDeviation += reverseAromaticDeviation;
    }
    const isIdealLeafDescriptor =
      descriptor.prefersIdealOutwardGeometry
      && !descriptor.isRingSystemSubstituent
      && !descriptor.enforcesOutwardReadability
      && !isRootAnchoredSubtreeDescriptor(descriptor)
      && descriptor.outwardAngles.length === 1
      && anchorAtom
      && !anchorAtom.aromatic
      && (anchorAtom.heavyDegree === 3 || anchorRingCount > 1);
    const isIdealLinkedRingDescriptor =
      descriptor.linkedRingAnchorAtomId != null
      && descriptor.prefersIdealOutwardGeometry
      && descriptor.isRingSystemSubstituent
      && descriptor.outwardAngles.length === 1
      && descriptor.reverseOutwardAngles.length === 1
      && rootAtom
      && IDEAL_RING_LINKER_ELEMENTS.has(rootAtom.element)
      && rootAtom.heavyDegree === 2;
    const linkedRingBridgeDeviation =
      includeLinkedRingBridgePenalty && isIdealLinkedRingDescriptor
        ? linkedRingBridgeAngleDeviation(anchorPosition, rootPosition, reverseAnchorPosition)
        : null;
    if (Number.isFinite(linkedRingBridgeDeviation)) {
      totalDeviation += linkedRingBridgeDeviation;
    }
    if (
      !isIdealLeafDescriptor
      && !isIdealLinkedRingDescriptor
    ) {
      continue;
    }
    if (!representativePosition) {
      continue;
    }
    const deviation = isIdealLinkedRingDescriptor
      ? bestOutwardDeviation(anchorPosition, rootPosition, descriptor.outwardAngles)
      : bestOutwardDeviation(anchorPosition, representativePosition, descriptor.outwardAngles);
    if (Number.isFinite(deviation) && !Number.isFinite(forwardAromaticDeviation) && !Number.isFinite(forwardAttachedRingDeviation)) {
      totalDeviation += deviation;
    }
    if (isIdealLinkedRingDescriptor) {
      const reverseDeviation = bestOutwardDeviation(reverseAnchorPosition, rootPosition, descriptor.reverseOutwardAngles);
      if (Number.isFinite(reverseDeviation) && !Number.isFinite(reverseAromaticDeviation) && !Number.isFinite(reverseAttachedRingDeviation)) {
        totalDeviation += reverseDeviation;
      }
    }
  }

  totalDeviation += measureAttachedCarbonylPresentationPenalty(layoutGraph, coords, { focusAtomIds });
  return totalDeviation;
}

/**
 * Re-snaps single direct-attached ring-system exits onto the exact local
 * outward bisector when that rigid move is overlap-safe and does not worsen
 * local trigonal or shared-junction presentation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Hook options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Set<string>|null} [options.frozenAtomIds] - Atoms that must not move.
 * @param {Set<string>|null} [options.focusAtomIds] - Optional focus atom ids.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Adjusted coordinates and move count.
 */
export function runDirectAttachedRingSystemOutwardRetidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { x: position.x, y: position.y }]));
  let nudges = 0;

  const baseReadability = measureRingSubstituentReadability(layoutGraph, coords);
  const baseOverlapCount = findSevereOverlaps(layoutGraph, coords, bondLength).length;
  let bestCandidate = null;

  for (const anchorAtomId of coords.keys()) {
    if (focusAtomIds && !focusAtomIds.has(anchorAtomId)) {
      continue;
    }
    if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
      continue;
    }
    const substituentChildren = collectReadableRingSubstituentChildren(layoutGraph, coords, anchorAtomId);
    if (substituentChildren.length !== 1) {
      continue;
    }

    const { childAtomId: rootAtomId, representativeAtomIds } = substituentChildren[0];
    if (
      representativeAtomIds.length <= 1
      || (layoutGraph.atomToRings.get(rootAtomId)?.length ?? 0) === 0
    ) {
      continue;
    }

    const bond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, rootAtomId));
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }

    const outwardAngles = outwardAnglesForAnchor(layoutGraph, coords, anchorAtomId, rootAtomId);
    if (outwardAngles.length === 0) {
      continue;
    }

    const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
    if (subtreeAtomIds.length === 0 || (frozenAtomIds && containsFrozenAtom(subtreeAtomIds, frozenAtomIds))) {
      continue;
    }

    const descriptorFocusAtomIds = new Set([anchorAtomId, rootAtomId, ...subtreeAtomIds]);
    if (focusAtomIds && !descriptorTouchesFocusAtomIds({
      anchorAtomId,
      rootAtomId,
      reverseAnchorAtomId: rootAtomId,
      representativeAtomIds,
      subtreeAtomIds,
      rootRotatingAtomIds: [],
      reverseRepresentativeAtomIds: []
    }, focusAtomIds)) {
      continue;
    }

    const anchorPosition = coords.get(anchorAtomId);
    const rootPosition = coords.get(rootAtomId);
    const baseRootDeviation = bestOutwardDeviation(anchorPosition, rootPosition, outwardAngles);
    if (!(baseRootDeviation > TIDY_ANGLE_EPSILON)) {
      continue;
    }

    const baseJunctionPenalty = measureDirectAttachedRingJunctionContinuationDistortion(layoutGraph, coords, { focusAtomIds: descriptorFocusAtomIds }).totalDeviation;
    const baseTrigonalPenalty = measureTrigonalDistortion(layoutGraph, coords, { focusAtomIds: descriptorFocusAtomIds }).totalDeviation;
    const currentAngle = angleOf(sub(rootPosition, anchorPosition));
    const descriptor = { anchorAtomId, rootAtomId, subtreeAtomIds };

    for (const targetAngle of outwardAngles) {
      const rotation = targetAngle - currentAngle;
      if (Math.abs(rotation) <= TIDY_ANGLE_EPSILON) {
        continue;
      }
      const overridePositions = rotateRigidDescriptorPositions(coords, descriptor, rotation);
      if (!overridePositions) {
        continue;
      }
      const candidateCoords = new Map(coords);
      for (const [atomId, position] of overridePositions) {
        candidateCoords.set(atomId, position);
      }
      const candidateRootDeviation = bestOutwardDeviation(candidateCoords.get(anchorAtomId), candidateCoords.get(rootAtomId), outwardAngles);
      if (!Number.isFinite(candidateRootDeviation) || candidateRootDeviation > TIDY_ANGLE_EPSILON) {
        continue;
      }

      const candidateReadability = measureRingSubstituentReadability(layoutGraph, candidateCoords);
      if (readabilityHardMetricsWorsen(candidateReadability, baseReadability)) {
        continue;
      }

      const overlapCount = findSevereOverlaps(layoutGraph, candidateCoords, bondLength).length;
      if (overlapCount > baseOverlapCount) {
        continue;
      }

      const candidateJunctionPenalty = measureDirectAttachedRingJunctionContinuationDistortion(layoutGraph, candidateCoords, { focusAtomIds: descriptorFocusAtomIds }).totalDeviation;
      if (candidateJunctionPenalty > baseJunctionPenalty + TIDY_ANGLE_EPSILON) {
        continue;
      }

      const candidateTrigonalPenalty = measureTrigonalDistortion(layoutGraph, candidateCoords, { focusAtomIds: descriptorFocusAtomIds }).totalDeviation;
      if (candidateTrigonalPenalty > baseTrigonalPenalty + TIDY_ANGLE_EPSILON) {
        continue;
      }

      const candidate = {
        coords: candidateCoords,
        overlapCount,
        readability: candidateReadability,
        angleDelta: Math.abs(rotation)
      };
      if (isBetterDirectAttachedRingRootRetidyCandidate(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    }
  }

  if (bestCandidate) {
    nudges = 1;
    return {
      coords: bestCandidate.coords,
      nudges
    };
  }

  return { coords, nudges };
}

/**
 * Rotates single-bond heavy substituent subtrees attached to ring atoms toward
 * cleaner local outward directions without distorting the subtree geometry.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Hook options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Set<string>|null} [options.frozenAtomIds] - Atoms that must not move.
 * @param {boolean} [options.includeRingSystemSubstituents] - Whether tidy may rotate ring-to-ring substituent descriptors.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Adjusted coordinates and move count.
 */
export function runRingSubstituentTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const maxPasses = Math.max(1, options.maxPasses ?? 2);
  const overridePositions = options.overridePositions ?? null;
  const coords = new Map();
  for (const [atomId, position] of inputCoords) {
    const start = overridePositions?.get(atomId) ?? position;
    coords.set(atomId, { x: start.x, y: start.y });
  }
  const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength);
  const allAtomIds = [...coords.keys()];
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  let nudges = 0;

  const covalentBonds = [...layoutGraph.bonds.values()].filter(bond => bond.kind === 'covalent');

  for (let pass = 0; pass < maxPasses; pass++) {
    const descriptors = collectTidyeableDescriptors(layoutGraph, coords, frozenAtomIds, focusAtomIds, options);
    let passNudges = 0;

    for (const descriptor of descriptors) {
      const dynamicDescriptor = refreshDescriptorGeometry(layoutGraph, coords, descriptor);
      const anchorPosition = coords.get(dynamicDescriptor.anchorAtomId);
      const rootPosition = coords.get(dynamicDescriptor.rootAtomId);
      if (!anchorPosition || !rootPosition) {
        continue;
      }

      // Pre-compute once — only depends on topology, not on positions.
      const subtreeContext = buildSubtreeOverlapContext(layoutGraph, dynamicDescriptor.subtreeAtomIds);
      const currentAngle = angleOf(sub(rootPosition, anchorPosition));
      const candidateAngles = new Set(TIDY_ROTATION_ANGLES);
      for (const angle of dynamicDescriptor.outwardAngles) { candidateAngles.add(angle); }
      if (dynamicDescriptor.isRingSystemSubstituent) {
        for (const reverseOutwardAngle of dynamicDescriptor.reverseOutwardAngles) {
          candidateAngles.add(reverseOutwardAngle + Math.PI);
        }
        for (const relativeRotation of TIDY_ROTATION_ANGLES) {
          candidateAngles.add(currentAngle + relativeRotation);
        }
      }
      const movedAtomIdsForCrossing = new Set(dynamicDescriptor.representativeAtomIds);
      const movingBonds = [];
      const staticSegments = [];
      for (let i = 0; i < covalentBonds.length; i++) {
        const bond = covalentBonds[i];
        if (movedAtomIdsForCrossing.has(bond.a) || movedAtomIdsForCrossing.has(bond.b)) {
          movingBonds.push(bond);
        } else {
          const start = coords.get(bond.a);
          const end = coords.get(bond.b);
          if (start && end) {
            staticSegments.push({ aAtomId: bond.a, bAtomId: bond.b, start, end });
          }
        }
      }
      const bondIntersectionContext = { movingBonds, staticSegments };

      const baseCandidate = {
        ...buildCandidateScore(layoutGraph, coords, atomGrid, dynamicDescriptor, null, bondLength, allAtomIds, bondIntersectionContext, subtreeContext),
        angleDelta: 0
      };
      const baseFailsReadability =
        baseCandidate.insideRingCount > 0
        || baseCandidate.outwardFailureCount > 0;
      const needsIdealOutwardGeometry =
        dynamicDescriptor.prefersIdealOutwardGeometry
        && !isRootAnchoredSubtreeDescriptor(dynamicDescriptor)
        && baseCandidate.outwardDeviation > TIDY_ANGLE_EPSILON;
      const needsRootAnchoredOverlapRepair =
        dynamicDescriptor.supportsRootAnchoredOverlapRepair
        && dynamicDescriptor.rootRotatingAtomIds.length > 0
        && baseCandidate.overlapCost > TIDY_ATOM_EPSILON;
      if (
        !baseFailsReadability
        && !dynamicDescriptor.isRingSystemSubstituent
        && !needsIdealOutwardGeometry
        && !needsRootAnchoredOverlapRepair
      ) {
        continue;
      }
      let bestCandidate = null;
      let bestZeroFailureRootCandidate = null;
      const exactIdealLeafCandidate = buildExactIdealLeafCandidate(layoutGraph, coords, atomGrid, dynamicDescriptor, bondLength, allAtomIds, bondIntersectionContext, subtreeContext);
      const exactIdealLinkedRingCandidate = buildExactIdealLinkedRingCandidate(
        layoutGraph,
        coords,
        atomGrid,
        dynamicDescriptor,
        bondLength,
        allAtomIds,
        bondIntersectionContext,
        subtreeContext
      );
      const exactDirectAttachedRingSystemRootCandidate = buildExactDirectAttachedRingSystemRootCandidate(
        layoutGraph,
        coords,
        atomGrid,
        dynamicDescriptor,
        baseCandidate,
        bondLength,
        allAtomIds,
        bondIntersectionContext,
        subtreeContext
      );
      const shouldUseExactIdealLeafCandidate =
        exactIdealLeafCandidate
        && exactIdealLeafCandidate.insideRingCount === 0
        && exactIdealLeafCandidate.crossingCount <= baseCandidate.crossingCount
        && exactIdealLeafCandidate.overlapCost <= baseCandidate.overlapCost + TIDY_ATOM_EPSILON
        && exactIdealLeafCandidate.anchorDistortion <= baseCandidate.anchorDistortion + TIDY_ATOM_EPSILON
        && exactIdealLeafCandidate.outwardDeviation < baseCandidate.outwardDeviation - TIDY_ANGLE_EPSILON;
      if (shouldUseExactIdealLeafCandidate || (exactIdealLeafCandidate && shouldAcceptCandidate(exactIdealLeafCandidate, baseCandidate, dynamicDescriptor))) {
        bestCandidate = exactIdealLeafCandidate;
      }
      if (exactIdealLinkedRingCandidate && shouldAcceptCandidate(exactIdealLinkedRingCandidate, baseCandidate, dynamicDescriptor) && isBetterCandidate(exactIdealLinkedRingCandidate, bestCandidate)) {
        bestCandidate = exactIdealLinkedRingCandidate;
      }
      if (exactDirectAttachedRingSystemRootCandidate && isBetterCandidate(exactDirectAttachedRingSystemRootCandidate, bestCandidate)) {
        bestCandidate = exactDirectAttachedRingSystemRootCandidate;
      }
      if (dynamicDescriptor.rootRotatingAtomIds.length > 0) {
        const rootAnchoredSearch = visitPresentationDescriptorCandidates(layoutGraph, coords, dynamicDescriptor, {
          context: {
            atomGrid,
            bondIntersectionContext,
            subtreeContext,
            allAtomIds,
            baseCandidate,
            bondLength
          },
          generateSeeds: () => TIDY_ROTATION_ANGLES.filter(rotation => Math.abs(rotation) > TIDY_ANGLE_EPSILON),
          materializeOverrides(inputCoords, descriptor, rotation) {
            return buildRootAnchoredRingSystemPositions(
              inputCoords,
              descriptor.rootAtomId,
              descriptor.rootRotatingAtomIds,
              rotation
            );
          },
          scoreSeed(descriptor, _candidateCoords, rotation, searchContext, overridePositions) {
            const candidate = {
              ...buildCandidateScore(
                layoutGraph,
                coords,
                searchContext.atomGrid,
                descriptor,
                overridePositions,
                searchContext.bondLength,
                searchContext.allAtomIds,
                searchContext.bondIntersectionContext,
                searchContext.subtreeContext
              ),
              angleDelta: Math.abs(rotation),
              overridePositions,
              rootAnchored: true
            };
            return shouldAcceptCandidate(candidate, searchContext.baseCandidate, descriptor) ? candidate : null;
          },
          isBetterScore: isBetterCandidate,
          onAcceptedCandidate(candidate) {
            if (
              isZeroFailureRootAnchoredRepair(candidate.seedScore, baseCandidate)
              && isBetterCandidate(candidate.seedScore, bestZeroFailureRootCandidate)
            ) {
              bestZeroFailureRootCandidate = candidate.seedScore;
            }
          }
        });
        if (rootAnchoredSearch.bestFinalCandidate && isBetterCandidate(rootAnchoredSearch.bestFinalCandidate.score, bestCandidate)) {
          bestCandidate = rootAnchoredSearch.bestFinalCandidate.score;
        }
      }

      if (!bestZeroFailureRootCandidate) {
        const rigidSearch = visitPresentationDescriptorCandidates(layoutGraph, coords, dynamicDescriptor, {
          context: {
            atomGrid,
            bondIntersectionContext,
            subtreeContext,
            allAtomIds,
            baseCandidate,
            bondLength,
            currentAngle
          },
          generateSeeds: () => [...candidateAngles],
          materializeOverrides(inputCoords, descriptor, candidateAngle) {
            const rotation = candidateAngle - currentAngle;
            if (Math.abs(rotation) <= TIDY_ANGLE_EPSILON) {
              return null;
            }
            return rotateRigidDescriptorPositions(inputCoords, descriptor, rotation);
          },
          scoreSeed(descriptor, _candidateCoords, candidateAngle, searchContext, overridePositions) {
            const candidate = {
              ...buildCandidateScore(
                layoutGraph,
                coords,
                searchContext.atomGrid,
                descriptor,
                overridePositions,
                searchContext.bondLength,
                searchContext.allAtomIds,
                searchContext.bondIntersectionContext,
                searchContext.subtreeContext
              ),
              angleDelta: Math.abs(candidateAngle - searchContext.currentAngle),
              overridePositions,
              rootAnchored: false
            };
            return shouldAcceptCandidate(candidate, searchContext.baseCandidate, descriptor) ? candidate : null;
          },
          isBetterScore: isBetterCandidate
        });
        if (rigidSearch.bestFinalCandidate && isBetterCandidate(rigidSearch.bestFinalCandidate.score, bestCandidate)) {
          bestCandidate = rigidSearch.bestFinalCandidate.score;
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
      passNudges++;
    }

    if (passNudges === 0) {
      break;
    }
  }

  return { coords, nudges };
}
