/** @module cleanup/presentation/ring-terminal-root-clearance */

import { auditLayout } from '../../audit/audit.js';
import { findSevereOverlaps, findVisibleHeavyBondCrossings } from '../../audit/invariants.js';
import { CLEANUP_EPSILON, PRESENTATION_METRIC_EPSILON, atomPairKey } from '../../constants.js';
import { add, angleOf, angularDifference, fromAngle, sub, wrapAngle } from '../../geometry/vec2.js';
import { rotateAround } from '../../geometry/transforms.js';
import { runUnifiedCleanup } from '../unified-cleanup.js';
import { collectCutSubtree } from '../subtree-utils.js';
import { visibleHeavyCovalentBonds } from '../bond-utils.js';
import { measureTerminalMultipleBondLeafFanPenalty } from './ring-terminal-hetero.js';

const IDEAL_TRIGONAL_ANGLE = (2 * Math.PI) / 3;
const MIN_ROOT_DEVIATION = 0.1;
const MAX_TERMINAL_ROOT_HEAVY_ATOMS = 3;
const MAX_LINKED_RING_ROOT_HEAVY_ATOMS = 80;
const MAX_RING_BLOCKER_RELIEF_HEAVY_ATOMS = 12;
const MAX_RELIEF_HEAVY_ATOMS = 4;
const MAX_INTERNAL_RELIEF_HEAVY_ATOMS = 8;
const SOFT_CONTACT_CLEARANCE_FACTOR = 0.9;
const RELIEF_ROTATIONS = [-Math.PI / 12, Math.PI / 12, -Math.PI / 6, Math.PI / 6];
const RING_BLOCKER_RELIEF_ROTATIONS = Object.freeze([-Math.PI / 6, Math.PI / 6, -Math.PI / 3, Math.PI / 3, -Math.PI / 2, Math.PI / 2, (-2 * Math.PI) / 3, (2 * Math.PI) / 3]);
const ROOT_SUBTREE_LEAF_ROTATIONS = Object.freeze([
  (-2 * Math.PI) / 3,
  (-25 * Math.PI) / 36,
  (-13 * Math.PI) / 18,
  (-3 * Math.PI) / 4,
  (-7 * Math.PI) / 9,
  (-5 * Math.PI) / 6,
  (2 * Math.PI) / 3,
  (25 * Math.PI) / 36,
  (13 * Math.PI) / 18,
  (3 * Math.PI) / 4,
  (7 * Math.PI) / 9,
  (5 * Math.PI) / 6,
  -Math.PI,
  Math.PI
]);
const ROOT_SUBTREE_CROSSING_ESCAPE_ANGLES = Object.freeze(Array.from({ length: 36 }, (_value, index) => (index * Math.PI) / 18));
const CROWDED_TERMINAL_RING_LEAF_CROSSING_ESCAPE_OFFSETS = Object.freeze(Array.from({ length: 72 }, (_value, index) => ((index + 1) * Math.PI) / 72).flatMap(offset => [offset, -offset]));
const CROWDED_TERMINAL_RING_LEAF_COMPRESSION_FACTORS = Object.freeze([1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.72, 0.7, 2 / 3, 0.65, 0.6, 0.58, 0.56, 0.55]);
const INTERNAL_RELIEF_ROTATIONS = Object.freeze([
  -Math.PI / 36,
  Math.PI / 36,
  -Math.PI / 18,
  Math.PI / 18,
  -Math.PI / 12,
  Math.PI / 12,
  -Math.PI / 9,
  Math.PI / 9,
  -Math.PI / 6,
  Math.PI / 6,
  -Math.PI / 4,
  Math.PI / 4,
  -Math.PI / 3,
  Math.PI / 3,
  -Math.PI / 2,
  Math.PI / 2,
  (-2 * Math.PI) / 3,
  (2 * Math.PI) / 3,
  -Math.PI,
  Math.PI
]);

/**
 * Returns the opposite atom ID for one endpoint of a bond.
 * @param {object} bond - Layout bond.
 * @param {string} atomId - Known endpoint atom ID.
 * @returns {string} Other endpoint atom ID.
 */
function otherBondAtomId(bond, atomId) {
  return bond.a === atomId ? bond.b : bond.a;
}

function countHeavyAtoms(layoutGraph, atomIds) {
  return atomIds.reduce((count, atomId) => (layoutGraph.atoms.get(atomId)?.element === 'H' ? count : count + 1), 0);
}

/**
 * Returns whether an atom collection contains at least one ring atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate atom IDs.
 * @returns {boolean} True when any atom belongs to a ring.
 */
function hasRingAtom(layoutGraph, atomIds) {
  return atomIds.some(atomId => layoutGraph.ringAtomIdSet.has(atomId));
}

/**
 * Returns whether a root subtree is a bounded single-hetero linker into
 * another ring system rather than a compact terminal substituent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} rootAtomId - Root atom attached to the ring center.
 * @param {string[]} rootSubtreeAtomIds - Atoms reached through the root.
 * @returns {boolean} True when the root is a linked-ring hetero bridge.
 */
function isLinkedRingRootDescriptor(layoutGraph, rootAtomId, rootSubtreeAtomIds) {
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  return (
    rootAtom &&
    rootAtom.element !== 'C' &&
    rootAtom.element !== 'H' &&
    rootAtom.heavyDegree === 2 &&
    hasRingAtom(layoutGraph, rootSubtreeAtomIds) &&
    countHeavyAtoms(layoutGraph, rootSubtreeAtomIds) <= MAX_LINKED_RING_ROOT_HEAVY_ATOMS
  );
}

function rootDeviation(coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!centerPosition || !rootPosition) {
    return Number.POSITIVE_INFINITY;
  }
  const rootAngle = angleOf(sub(rootPosition, centerPosition));
  return Math.max(
    Math.abs(angularDifference(rootAngle, angleOf(sub(coords.get(descriptor.firstRingNeighborAtomId), centerPosition))) - IDEAL_TRIGONAL_ANGLE),
    Math.abs(angularDifference(rootAngle, angleOf(sub(coords.get(descriptor.secondRingNeighborAtomId), centerPosition))) - IDEAL_TRIGONAL_ANGLE)
  );
}

function collectTerminalRingRootDescriptors(layoutGraph, coords, frozenAtomIds) {
  const descriptors = [];
  for (const centerAtomId of coords.keys()) {
    const centerIsFrozen = frozenAtomIds?.has(centerAtomId) ?? false;
    if (!layoutGraph.ringAtomIdSet.has(centerAtomId)) {
      continue;
    }
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    if (!centerAtom || centerAtom.element === 'H') {
      continue;
    }
    const heavyBonds = visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId);
    if (heavyBonds.length !== 3) {
      continue;
    }
    const ringBonds = heavyBonds.filter(({ neighborAtomId }) => layoutGraph.ringAtomIdSet.has(neighborAtomId));
    const terminalBonds = heavyBonds.filter(({ bond, neighborAtomId }) => !layoutGraph.ringAtomIdSet.has(neighborAtomId) && !bond.aromatic && (bond.order ?? 1) === 1);
    if (ringBonds.length !== 2 || terminalBonds.length !== 1) {
      continue;
    }
    const rootAtomId = terminalBonds[0].neighborAtomId;
    const rootSubtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
    if (rootSubtreeAtomIds.length === 0 || rootSubtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId))) {
      continue;
    }
    const containsRingAtom = hasRingAtom(layoutGraph, rootSubtreeAtomIds);
    const isCompactTerminalRoot = !containsRingAtom && countHeavyAtoms(layoutGraph, rootSubtreeAtomIds) <= MAX_TERMINAL_ROOT_HEAVY_ATOMS;
    const isLinkedRingRoot = isLinkedRingRootDescriptor(layoutGraph, rootAtomId, rootSubtreeAtomIds);
    if (!isCompactTerminalRoot && !isLinkedRingRoot) {
      continue;
    }
    const descriptor = {
      centerAtomId,
      rootAtomId,
      firstRingNeighborAtomId: ringBonds[0].neighborAtomId,
      secondRingNeighborAtomId: ringBonds[1].neighborAtomId,
      rootSubtreeAtomIds,
      allowsInternalRelief: isLinkedRingRoot
    };
    const crossingCount = rootSubtreeVisibleBondCrossingCount(layoutGraph, coords, descriptor);
    if (centerIsFrozen && crossingCount === 0) {
      continue;
    }
    if (rootDeviation(coords, descriptor) > MIN_ROOT_DEVIATION || crossingCount > 0) {
      descriptors.push(descriptor);
    }
  }
  return descriptors.sort((firstDescriptor, secondDescriptor) => {
    if (firstDescriptor.allowsInternalRelief !== secondDescriptor.allowsInternalRelief) {
      return firstDescriptor.allowsInternalRelief ? -1 : 1;
    }
    return rootDeviation(coords, secondDescriptor) - rootDeviation(coords, firstDescriptor);
  });
}

function exactRootCoords(coords, descriptor) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  const firstRingPosition = coords.get(descriptor.firstRingNeighborAtomId);
  const secondRingPosition = coords.get(descriptor.secondRingNeighborAtomId);
  if (!centerPosition || !rootPosition || !firstRingPosition || !secondRingPosition) {
    return null;
  }
  const firstRingAngle = angleOf(sub(firstRingPosition, centerPosition));
  const secondRingAngle = angleOf(sub(secondRingPosition, centerPosition));
  const rootAngle = angleOf(sub(rootPosition, centerPosition));
  let targetAngle = null;
  for (const candidateAngle of [firstRingAngle + IDEAL_TRIGONAL_ANGLE, firstRingAngle - IDEAL_TRIGONAL_ANGLE]) {
    if (Math.abs(angularDifference(candidateAngle, secondRingAngle) - IDEAL_TRIGONAL_ANGLE) <= CLEANUP_EPSILON) {
      targetAngle = candidateAngle;
      break;
    }
  }
  if (targetAngle == null) {
    return null;
  }
  const rotation = wrapAngle(targetAngle - rootAngle);
  const nextCoords = new Map(coords);
  for (const atomId of descriptor.rootSubtreeAtomIds) {
    nextCoords.set(atomId, rotateAround(coords.get(atomId), centerPosition, rotation));
  }
  return nextCoords;
}

function translateRootSubtreeToAngle(coords, descriptor, targetAngle) {
  const centerPosition = coords.get(descriptor.centerAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!centerPosition || !rootPosition) {
    return null;
  }
  const targetPosition = add(centerPosition, fromAngle(targetAngle, Math.hypot(rootPosition.x - centerPosition.x, rootPosition.y - centerPosition.y)));
  const delta = sub(targetPosition, rootPosition);
  const nextCoords = new Map(coords);
  for (const atomId of descriptor.rootSubtreeAtomIds) {
    const position = coords.get(atomId);
    if (position) {
      nextCoords.set(atomId, add(position, delta));
    }
  }
  return nextCoords;
}

function auditDoesNotRegressRootEscape(candidateAudit, baseAudit) {
  return (
    (candidateAudit.severeOverlapCount ?? 0) <= (baseAudit.severeOverlapCount ?? 0) &&
    (candidateAudit.bondLengthFailureCount ?? 0) <= (baseAudit.bondLengthFailureCount ?? 0) &&
    (candidateAudit.labelOverlapCount ?? 0) <= (baseAudit.labelOverlapCount ?? 0) &&
    (candidateAudit.collapsedMacrocycleCount ?? 0) <= (baseAudit.collapsedMacrocycleCount ?? 0) &&
    (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) <= (baseAudit.ringSubstituentReadabilityFailureCount ?? 0)
  );
}

/**
 * Rotates a compact terminal root away from a visible crossing when preserving
 * the current root slot is worse than taking a nearby non-crossing slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinates.
 * @param {object} descriptor - Terminal-root descriptor.
 * @param {object} baseAudit - Audit before the escape.
 * @param {object} options - Retouch options.
 * @returns {Map<string, {x: number, y: number}>|null} Escaped coordinates, if accepted.
 */
function escapeCurrentRootSubtreeCrossing(layoutGraph, coords, descriptor, baseAudit, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const currentCrossingCount = rootSubtreeVisibleBondCrossingCount(layoutGraph, coords, descriptor);
  if (currentCrossingCount === 0) {
    return null;
  }

  const currentDeviation = rootDeviation(coords, descriptor);
  let best = null;
  for (const targetAngle of ROOT_SUBTREE_CROSSING_ESCAPE_ANGLES) {
    const candidateCoords = translateRootSubtreeToAngle(coords, descriptor, targetAngle);
    if (!candidateCoords) {
      continue;
    }
    const crossingCount = rootSubtreeVisibleBondCrossingCount(layoutGraph, candidateCoords, descriptor);
    if (crossingCount >= currentCrossingCount) {
      continue;
    }
    const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
      bondLength,
      bondValidationClasses: options.bondValidationClasses
    });
    if (!auditDoesNotRegressRootEscape(candidateAudit, baseAudit)) {
      continue;
    }
    const deviationPenalty = Math.max(0, rootDeviation(candidateCoords, descriptor) - currentDeviation);
    const score = auditPenalty(candidateAudit) + crossingCount * 1_000_000 + deviationPenalty * 10_000;
    if (!best || score < best.score - CLEANUP_EPSILON) {
      best = {
        coords: candidateCoords,
        score
      };
    }
  }
  return best?.coords ?? null;
}

function escapeCurrentRootSubtreeInwardReadability(layoutGraph, coords, descriptor, baseAudit, options) {
  if ((baseAudit.ringSubstituentReadabilityFailureCount ?? 0) === 0 && (baseAudit.inwardRingSubstituentCount ?? 0) === 0) {
    return null;
  }

  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const basePenalty = auditPenalty(baseAudit);
  let best = null;
  for (const targetAngle of ROOT_SUBTREE_CROSSING_ESCAPE_ANGLES) {
    const candidateCoords = translateRootSubtreeToAngle(coords, descriptor, targetAngle);
    if (!candidateCoords) {
      continue;
    }
    const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
      bondLength,
      bondValidationClasses: options.bondValidationClasses
    });
    if (
      candidateAudit.ok !== true ||
      (candidateAudit.bondLengthFailureCount ?? 0) > (baseAudit.bondLengthFailureCount ?? 0) ||
      (candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (baseAudit.visibleHeavyBondCrossingCount ?? 0) ||
      (candidateAudit.severeOverlapCount ?? 0) > (baseAudit.severeOverlapCount ?? 0) ||
      (candidateAudit.labelOverlapCount ?? 0) > (baseAudit.labelOverlapCount ?? 0) ||
      (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) >= (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) ||
      auditPenalty(candidateAudit) >= basePenalty
    ) {
      continue;
    }
    const rotation = angularDifference(
      targetAngle,
      angleOf(sub(coords.get(descriptor.rootAtomId), coords.get(descriptor.centerAtomId)))
    );
    const score = auditPenalty(candidateAudit) + rootDeviation(candidateCoords, descriptor) * 10_000 + rotation * 100;
    if (!best || score < best.score - CLEANUP_EPSILON) {
      best = {
        coords: candidateCoords,
        score
      };
    }
  }
  return best?.coords ?? null;
}

function collectReliefDescriptor(layoutGraph, coords, rootAtomId, parentAtomId, protectedAtomIds, frozenAtomIds) {
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, parentAtomId)].filter(atomId => coords.has(atomId));
  if (
    subtreeAtomIds.length === 0 ||
    subtreeAtomIds.includes(parentAtomId) ||
    subtreeAtomIds.some(atomId => protectedAtomIds.has(atomId) || frozenAtomIds?.has(atomId) || layoutGraph.ringAtomIdSet.has(atomId)) ||
    countHeavyAtoms(layoutGraph, subtreeAtomIds) > MAX_RELIEF_HEAVY_ATOMS
  ) {
    return null;
  }
  return { rootAtomId, parentAtomId, subtreeAtomIds };
}

function collectRingBlockerReliefDescriptors(layoutGraph, coords, blockerAtomId, protectedAtomIds, frozenAtomIds) {
  const descriptors = [];
  const descriptorKeys = new Set();
  for (const ring of layoutGraph.atomToRings.get(blockerAtomId) ?? []) {
    const ringAtomIds = new Set(ring.atomIds ?? []);
    for (const ringAtomId of ringAtomIds) {
      if (protectedAtomIds.has(ringAtomId) || frozenAtomIds?.has(ringAtomId)) {
        continue;
      }
      for (const bond of layoutGraph.bondsByAtomId.get(ringAtomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const parentAtomId = otherBondAtomId(bond, ringAtomId);
        if (ringAtomIds.has(parentAtomId) || protectedAtomIds.has(parentAtomId) || frozenAtomIds?.has(parentAtomId)) {
          continue;
        }
        const subtreeAtomIds = [...collectCutSubtree(layoutGraph, ringAtomId, parentAtomId)].filter(atomId => coords.has(atomId));
        if (
          subtreeAtomIds.length === 0 ||
          !subtreeAtomIds.includes(blockerAtomId) ||
          subtreeAtomIds.includes(parentAtomId) ||
          subtreeAtomIds.some(atomId => protectedAtomIds.has(atomId) || frozenAtomIds?.has(atomId)) ||
          countHeavyAtoms(layoutGraph, subtreeAtomIds) > MAX_RING_BLOCKER_RELIEF_HEAVY_ATOMS
        ) {
          continue;
        }
        const descriptorKey = `${ringAtomId}:${parentAtomId}`;
        if (descriptorKeys.has(descriptorKey)) {
          continue;
        }
        descriptorKeys.add(descriptorKey);
        descriptors.push({
          rootAtomId: ringAtomId,
          parentAtomId,
          subtreeAtomIds
        });
      }
    }
  }
  return descriptors;
}

function rotateReliefSubtree(coords, descriptor, rotation) {
  const pivot = coords.get(descriptor.parentAtomId);
  const nextCoords = new Map(coords);
  for (const atomId of descriptor.subtreeAtomIds) {
    nextCoords.set(atomId, rotateAround(coords.get(atomId), pivot, rotation));
  }
  return nextCoords;
}

/**
 * Counts visible heavy-bond crossings touching a corrected root subtree.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} targetDescriptor - Corrected terminal-root descriptor.
 * @returns {number} Crossing count involving the root subtree.
 */
function rootSubtreeVisibleBondCrossingCount(layoutGraph, coords, targetDescriptor) {
  const rootSubtreeAtomIds = new Set(targetDescriptor.rootSubtreeAtomIds);
  return findVisibleHeavyBondCrossings(layoutGraph, coords).filter(
    crossing => (crossing.firstAtomIds ?? []).some(atomId => rootSubtreeAtomIds.has(atomId)) || (crossing.secondAtomIds ?? []).some(atomId => rootSubtreeAtomIds.has(atomId))
  ).length;
}

function bondAtomIdsMatch(atomIds, firstAtomId, secondAtomId) {
  return atomIds?.length === 2 && ((atomIds[0] === firstAtomId && atomIds[1] === secondAtomId) || (atomIds[0] === secondAtomId && atomIds[1] === firstAtomId));
}

function terminalRingLeafBondCrossingCount(layoutGraph, coords, descriptor) {
  return findVisibleHeavyBondCrossings(layoutGraph, coords, {
    focusAtomIds: [descriptor.anchorAtomId, descriptor.leafAtomId]
  }).filter(
    crossing => bondAtomIdsMatch(crossing.firstAtomIds, descriptor.anchorAtomId, descriptor.leafAtomId) || bondAtomIdsMatch(crossing.secondAtomIds, descriptor.anchorAtomId, descriptor.leafAtomId)
  ).length;
}

function terminalRingLeafMinimumClearance(layoutGraph, coords, descriptor) {
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!leafPosition) {
    return 0;
  }
  const protectedAtomIds = new Set([descriptor.anchorAtomId, ...descriptor.leafSubtreeAtomIds]);
  let minimumClearance = Number.POSITIVE_INFINITY;
  for (const [atomId, atomPosition] of coords) {
    if (protectedAtomIds.has(atomId) || layoutGraph.bondedPairSet.has(atomPairKey(descriptor.leafAtomId, atomId))) {
      continue;
    }
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element === 'H') {
      continue;
    }
    minimumClearance = Math.min(minimumClearance, Math.hypot(leafPosition.x - atomPosition.x, leafPosition.y - atomPosition.y));
  }
  return Number.isFinite(minimumClearance) ? minimumClearance : Number.POSITIVE_INFINITY;
}

function crowdedTerminalRingLeafDescriptor(layoutGraph, coords, anchorAtomId, leafAtomId) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (
    !anchorAtom ||
    !leafAtom ||
    anchorAtom.aromatic ||
    anchorAtom.heavyDegree !== 4 ||
    leafAtom.element === 'C' ||
    leafAtom.element === 'H' ||
    leafAtom.aromatic ||
    (leafAtom.heavyDegree ?? 0) !== 1 ||
    (layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0) !== 1 ||
    layoutGraph.ringAtomIdSet.has(leafAtomId)
  ) {
    return null;
  }

  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, leafAtomId));
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
    return null;
  }

  let ringNeighborCount = 0;
  let terminalHeteroLeafCount = 0;
  for (const neighborBond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!neighborBond || neighborBond.kind !== 'covalent' || neighborBond.aromatic || (neighborBond.order ?? 1) !== 1) {
      return null;
    }
    const neighborAtomId = otherBondAtomId(neighborBond, anchorAtomId);
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      ringNeighborCount++;
    } else if (neighborAtom.element !== 'C' && !neighborAtom.aromatic && (neighborAtom.heavyDegree ?? 0) === 1) {
      terminalHeteroLeafCount++;
    }
  }
  if (ringNeighborCount !== 2 || terminalHeteroLeafCount !== 2) {
    return null;
  }

  const leafSubtreeAtomIds = [...collectCutSubtree(layoutGraph, leafAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
  if (leafSubtreeAtomIds.length === 0 || leafSubtreeAtomIds.some(atomId => layoutGraph.ringAtomIdSet.has(atomId)) || countHeavyAtoms(layoutGraph, leafSubtreeAtomIds) > MAX_RELIEF_HEAVY_ATOMS) {
    return null;
  }
  return {
    anchorAtomId,
    leafAtomId,
    leafSubtreeAtomIds
  };
}

function collectCrowdedTerminalRingLeafCrossingDescriptors(layoutGraph, coords, frozenAtomIds) {
  const descriptorMap = new Map();
  for (const crossing of findVisibleHeavyBondCrossings(layoutGraph, coords)) {
    for (const atomIds of [crossing.firstAtomIds, crossing.secondAtomIds]) {
      if (!Array.isArray(atomIds) || atomIds.length !== 2) {
        continue;
      }
      for (const [anchorAtomId, leafAtomId] of [atomIds, [atomIds[1], atomIds[0]]]) {
        if (frozenAtomIds?.has(anchorAtomId) || frozenAtomIds?.has(leafAtomId)) {
          continue;
        }
        const descriptor = crowdedTerminalRingLeafDescriptor(layoutGraph, coords, anchorAtomId, leafAtomId);
        if (!descriptor || descriptor.leafSubtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId))) {
          continue;
        }
        if (terminalRingLeafBondCrossingCount(layoutGraph, coords, descriptor) === 0) {
          continue;
        }
        descriptorMap.set(`${anchorAtomId}:${leafAtomId}`, descriptor);
      }
    }
  }
  return [...descriptorMap.values()].sort(
    (firstDescriptor, secondDescriptor) => compareAtomIds(firstDescriptor.anchorAtomId, secondDescriptor.anchorAtomId) || compareAtomIds(firstDescriptor.leafAtomId, secondDescriptor.leafAtomId)
  );
}

function compareAtomIds(firstAtomId, secondAtomId) {
  return firstAtomId.localeCompare(secondAtomId, undefined, { numeric: true });
}

function translateTerminalRingLeafToAngle(coords, descriptor, targetAngle, targetLength) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!anchorPosition || !leafPosition || !(targetLength > 0)) {
    return null;
  }
  const targetPosition = add(anchorPosition, fromAngle(targetAngle, targetLength));
  const delta = sub(targetPosition, leafPosition);
  const nextCoords = new Map(coords);
  for (const atomId of descriptor.leafSubtreeAtomIds) {
    const position = coords.get(atomId);
    if (position) {
      nextCoords.set(atomId, add(position, delta));
    }
  }
  return nextCoords;
}

function resolveCrowdedTerminalRingLeafCrossings(layoutGraph, coords, baseAudit, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  if ((baseAudit.visibleHeavyBondCrossingCount ?? 0) === 0) {
    return null;
  }

  for (const descriptor of collectCrowdedTerminalRingLeafCrossingDescriptors(layoutGraph, coords, options.frozenAtomIds ?? null)) {
    const anchorPosition = coords.get(descriptor.anchorAtomId);
    const leafPosition = coords.get(descriptor.leafAtomId);
    if (!anchorPosition || !leafPosition) {
      continue;
    }
    const currentCrossingCount = terminalRingLeafBondCrossingCount(layoutGraph, coords, descriptor);
    if (currentCrossingCount === 0) {
      continue;
    }
    const currentAngle = angleOf(sub(leafPosition, anchorPosition));
    const currentLength = Math.hypot(leafPosition.x - anchorPosition.x, leafPosition.y - anchorPosition.y);
    let best = null;
    for (const offset of CROWDED_TERMINAL_RING_LEAF_CROSSING_ESCAPE_OFFSETS) {
      for (const compressionFactor of CROWDED_TERMINAL_RING_LEAF_COMPRESSION_FACTORS) {
        const candidateCoords = translateTerminalRingLeafToAngle(coords, descriptor, wrapAngle(currentAngle + offset), Math.min(currentLength, bondLength) * compressionFactor);
        if (!candidateCoords) {
          continue;
        }
        const candidateCrossingCount = terminalRingLeafBondCrossingCount(layoutGraph, candidateCoords, descriptor);
        if (candidateCrossingCount >= currentCrossingCount) {
          continue;
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: options.bondValidationClasses
        });
        if (
          candidateAudit.ok !== true ||
          (candidateAudit.visibleHeavyBondCrossingCount ?? 0) >= (baseAudit.visibleHeavyBondCrossingCount ?? 0) ||
          (candidateAudit.severeOverlapCount ?? 0) > (baseAudit.severeOverlapCount ?? 0) ||
          (candidateAudit.bondLengthFailureCount ?? 0) > (baseAudit.bondLengthFailureCount ?? 0) ||
          (candidateAudit.ringSubstituentReadabilityFailureCount ?? 0) > (baseAudit.ringSubstituentReadabilityFailureCount ?? 0) ||
          (candidateAudit.outwardAxisRingSubstituentFailureCount ?? 0) > (baseAudit.outwardAxisRingSubstituentFailureCount ?? 0)
        ) {
          continue;
        }
        const clearance = terminalRingLeafMinimumClearance(layoutGraph, candidateCoords, descriptor);
        const score =
          (candidateAudit.visibleHeavyBondCrossingCount ?? 0) * 1_000_000 +
          candidateCrossingCount * 100_000 +
          (candidateAudit.labelOverlapCount ?? 0) * 10_000 +
          Math.abs(1 - compressionFactor) * 1_000 +
          Math.abs(offset) * 100 -
          clearance;
        if (!best || score < best.score - CLEANUP_EPSILON) {
          best = {
            coords: candidateCoords,
            score
          };
        }
      }
    }
    if (best) {
      return best.coords;
    }
  }
  return null;
}

/**
 * Converts an audit summary into a sortable penalty for local relief choices.
 * @param {object} audit - Layout audit summary.
 * @returns {number} Weighted audit penalty.
 */
function auditPenalty(audit) {
  return (
    (audit.bondLengthFailureCount ?? 0) * 100_000_000 +
    (audit.severeOverlapCount ?? 0) * 10_000_000 +
    (audit.visibleHeavyBondCrossingCount ?? 0) * 1_000_000 +
    (audit.ringSubstituentReadabilityFailureCount ?? 0) * 100_000 +
    (audit.inwardRingSubstituentCount ?? 0) * 100_000 +
    (audit.outwardAxisRingSubstituentFailureCount ?? 0) * 100_000 +
    (audit.labelOverlapCount ?? 0) * 10_000 +
    (audit.severeOverlapPenalty ?? 0) * 1_000
  );
}

/**
 * Returns visible heavy neighbors for a placed atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Atom ID.
 * @returns {string[]} Visible heavy neighbor IDs.
 */
function heavyNeighborAtomIds(layoutGraph, coords, atomId) {
  return (layoutGraph.bondsByAtomId.get(atomId) ?? [])
    .map(bond => otherBondAtomId(bond, atomId))
    .filter(neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
    });
}

/**
 * Measures the smaller angle between two neighbors around a center atom.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Center atom ID.
 * @param {string} firstNeighborAtomId - First neighbor atom ID.
 * @param {string} secondNeighborAtomId - Second neighbor atom ID.
 * @returns {number|null} Angle in radians, or null if unavailable.
 */
function angleBetweenNeighbors(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  const centerPosition = coords.get(centerAtomId);
  const firstPosition = coords.get(firstNeighborAtomId);
  const secondPosition = coords.get(secondNeighborAtomId);
  if (!centerPosition || !firstPosition || !secondPosition) {
    return null;
  }
  return angularDifference(angleOf(sub(firstPosition, centerPosition)), angleOf(sub(secondPosition, centerPosition)));
}

/**
 * Measures the largest trigonal fan deviation around a relief parent.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} parentAtomId - Parent atom whose fan is affected.
 * @returns {number} Maximum deviation from 120 degrees in radians.
 */
function parentFanDeviation(layoutGraph, coords, parentAtomId) {
  const neighborAtomIds = heavyNeighborAtomIds(layoutGraph, coords, parentAtomId);
  if (neighborAtomIds.length < 2 || neighborAtomIds.length > 3) {
    return 0;
  }
  let maxDeviation = 0;
  for (let firstIndex = 0; firstIndex < neighborAtomIds.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < neighborAtomIds.length; secondIndex++) {
      const angle = angleBetweenNeighbors(coords, parentAtomId, neighborAtomIds[firstIndex], neighborAtomIds[secondIndex]);
      if (angle == null) {
        continue;
      }
      maxDeviation = Math.max(maxDeviation, Math.abs(angle - IDEAL_TRIGONAL_ANGLE));
    }
  }
  return maxDeviation;
}

function terminalMultipleBondLeafFanRegression(layoutGraph, candidateCoords, baseCoords) {
  const candidatePenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, candidateCoords);
  const basePenalty = measureTerminalMultipleBondLeafFanPenalty(layoutGraph, baseCoords);
  return Math.max((candidatePenalty.maxDeviation ?? 0) - (basePenalty.maxDeviation ?? 0), (candidatePenalty.totalDeviation ?? 0) - (basePenalty.totalDeviation ?? 0));
}

/**
 * Collects atoms involved in current overlaps or visible heavy-bond crossings.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Standard bond length.
 * @returns {Set<string>} Problem atom IDs.
 */
function linkedRootProblemAtomIds(layoutGraph, coords, bondLength) {
  const atomIds = new Set();
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    atomIds.add(overlap.firstAtomId);
    atomIds.add(overlap.secondAtomId);
  }
  for (const crossing of findVisibleHeavyBondCrossings(layoutGraph, coords)) {
    for (const atomId of crossing.firstAtomIds ?? []) {
      atomIds.add(atomId);
    }
    for (const atomId of crossing.secondAtomIds ?? []) {
      atomIds.add(atomId);
    }
  }
  return atomIds;
}

/**
 * Finds small acyclic branches inside a moved linked-ring subtree that can
 * rotate without moving ring atoms or the corrected linker root.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} targetDescriptor - Corrected linked-root descriptor.
 * @param {Set<string>} problemAtomIds - Atoms participating in local failures.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms to avoid.
 * @returns {{rootAtomId: string, parentAtomId: string, subtreeAtomIds: string[]}[]} Relief descriptors.
 */
function collectInternalReliefDescriptors(layoutGraph, coords, targetDescriptor, problemAtomIds, frozenAtomIds) {
  const descriptors = [];
  const descriptorKeys = new Set();
  const movedAtomIds = new Set(targetDescriptor.rootSubtreeAtomIds);
  const protectedAtomIds = new Set([targetDescriptor.centerAtomId, targetDescriptor.rootAtomId, targetDescriptor.firstRingNeighborAtomId, targetDescriptor.secondRingNeighborAtomId]);
  for (const problemAtomId of problemAtomIds) {
    if (!movedAtomIds.has(problemAtomId)) {
      continue;
    }
    for (const bond of layoutGraph.bonds.values()) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      for (const [rootAtomId, parentAtomId] of [
        [bond.a, bond.b],
        [bond.b, bond.a]
      ]) {
        if (!movedAtomIds.has(rootAtomId) || !movedAtomIds.has(parentAtomId) || protectedAtomIds.has(rootAtomId)) {
          continue;
        }
        const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, parentAtomId)].filter(atomId => coords.has(atomId));
        if (
          subtreeAtomIds.length === 0 ||
          !subtreeAtomIds.includes(problemAtomId) ||
          subtreeAtomIds.includes(parentAtomId) ||
          subtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId) || protectedAtomIds.has(atomId) || !movedAtomIds.has(atomId) || layoutGraph.ringAtomIdSet.has(atomId)) ||
          countHeavyAtoms(layoutGraph, subtreeAtomIds) > MAX_INTERNAL_RELIEF_HEAVY_ATOMS
        ) {
          continue;
        }
        const descriptorKey = `${rootAtomId}:${parentAtomId}`;
        if (descriptorKeys.has(descriptorKey)) {
          continue;
        }
        descriptorKeys.add(descriptorKey);
        descriptors.push({ rootAtomId, parentAtomId, subtreeAtomIds });
      }
    }
  }
  return descriptors;
}

function relieveCompactOverlaps(layoutGraph, coords, targetDescriptor, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const protectedAtomIds = new Set([targetDescriptor.centerAtomId, ...targetDescriptor.rootSubtreeAtomIds]);
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  let bestCoords = null;
  for (const overlap of overlaps) {
    for (const overlapAtomId of [overlap.firstAtomId, overlap.secondAtomId]) {
      if (protectedAtomIds.has(overlapAtomId)) {
        continue;
      }
      for (const bond of layoutGraph.bondsByAtomId.get(overlapAtomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const parentAtomId = bond.a === overlapAtomId ? bond.b : bond.a;
        const descriptor = collectReliefDescriptor(layoutGraph, coords, overlapAtomId, parentAtomId, protectedAtomIds, options.frozenAtomIds ?? null);
        if (!descriptor) {
          continue;
        }
        for (const rotation of RELIEF_ROTATIONS) {
          const candidateCoords = rotateReliefSubtree(coords, descriptor, rotation);
          if (rootDeviation(candidateCoords, targetDescriptor) > PRESENTATION_METRIC_EPSILON) {
            continue;
          }
          const audit = auditLayout(layoutGraph, candidateCoords, {
            bondLength,
            bondValidationClasses: options.bondValidationClasses
          });
          if (audit.ok === true) {
            bestCoords = candidateCoords;
            break;
          }
        }
        if (bestCoords) {
          return bestCoords;
        }
      }
    }
  }
  return null;
}

function relieveExactRootRingBlockerOverlaps(layoutGraph, coords, targetDescriptor, baseAudit, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const protectedAtomIds = new Set([targetDescriptor.centerAtomId, targetDescriptor.firstRingNeighborAtomId, targetDescriptor.secondRingNeighborAtomId, ...targetDescriptor.rootSubtreeAtomIds]);
  const descriptorKeys = new Set();
  const descriptors = [];
  for (const overlap of findSevereOverlaps(layoutGraph, coords, bondLength)) {
    const overlapPairs = [
      [overlap.firstAtomId, overlap.secondAtomId],
      [overlap.secondAtomId, overlap.firstAtomId]
    ];
    for (const [protectedAtomId, blockerAtomId] of overlapPairs) {
      if (!protectedAtomIds.has(protectedAtomId) || protectedAtomIds.has(blockerAtomId)) {
        continue;
      }
      for (const descriptor of collectRingBlockerReliefDescriptors(layoutGraph, coords, blockerAtomId, protectedAtomIds, options.frozenAtomIds ?? null)) {
        const descriptorKey = `${descriptor.rootAtomId}:${descriptor.parentAtomId}`;
        if (descriptorKeys.has(descriptorKey)) {
          continue;
        }
        descriptorKeys.add(descriptorKey);
        descriptors.push(descriptor);
      }
    }
  }
  let best = null;
  for (const descriptor of descriptors) {
    for (const rotation of RING_BLOCKER_RELIEF_ROTATIONS) {
      const candidateCoords = rotateReliefSubtree(coords, descriptor, rotation);
      if (rootDeviation(candidateCoords, targetDescriptor) > PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      if (terminalMultipleBondLeafFanRegression(layoutGraph, candidateCoords, coords) > PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      if (candidateAudit.ok !== true || auditPenalty(candidateAudit) > auditPenalty(baseAudit)) {
        continue;
      }
      const fanDeviation = parentFanDeviation(layoutGraph, candidateCoords, descriptor.parentAtomId);
      const clearance = rootSubtreeMinimumClearance(layoutGraph, candidateCoords, targetDescriptor);
      const score = auditPenalty(candidateAudit) + fanDeviation * 1_000 + Math.abs(rotation) - clearance;
      if (!best || score < best.score - CLEANUP_EPSILON) {
        best = {
          coords: candidateCoords,
          score
        };
      }
    }
  }
  return best?.coords ?? null;
}

/**
 * Returns root-subtree atoms whose visual clearance can be improved without
 * moving the corrected exact root slot itself.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} targetDescriptor - Corrected terminal-root descriptor.
 * @returns {string[]} Visible heavy atoms to use for soft-clearance scoring.
 */
function rootSubtreeClearanceAtomIds(layoutGraph, coords, targetDescriptor) {
  const heavySubtreeAtomIds = targetDescriptor.rootSubtreeAtomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && atom.element !== 'H' && coords.has(atomId);
  });
  const downstreamAtomIds = heavySubtreeAtomIds.filter(atomId => atomId !== targetDescriptor.rootAtomId);
  return downstreamAtomIds.length > 0 ? downstreamAtomIds : heavySubtreeAtomIds;
}

/**
 * Measures the minimum non-bonded clearance from a corrected root subtree to
 * the rest of the visible heavy-atom graph.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} targetDescriptor - Corrected terminal-root descriptor.
 * @returns {number} Minimum visible non-bonded distance.
 */
function rootSubtreeMinimumClearance(layoutGraph, coords, targetDescriptor) {
  const protectedAtomIds = new Set([targetDescriptor.centerAtomId, ...targetDescriptor.rootSubtreeAtomIds]);
  let minimumClearance = Number.POSITIVE_INFINITY;
  const searchAtomIds = rootSubtreeClearanceAtomIds(layoutGraph, coords, targetDescriptor);
  for (const rootAtomId of searchAtomIds) {
    const rootPosition = coords.get(rootAtomId);
    for (const [otherAtomId, otherPosition] of coords) {
      if (protectedAtomIds.has(otherAtomId) || layoutGraph.bondedPairSet.has(atomPairKey(rootAtomId, otherAtomId))) {
        continue;
      }
      const otherAtom = layoutGraph.atoms.get(otherAtomId);
      if (!otherAtom || otherAtom.element === 'H') {
        continue;
      }
      minimumClearance = Math.min(minimumClearance, Math.hypot(rootPosition.x - otherPosition.x, rootPosition.y - otherPosition.y));
    }
  }
  return minimumClearance;
}

/**
 * Collects soft non-bonded contacts created around a corrected terminal-root
 * subtree. These are below the visual-clearance floor but may still pass the
 * hard overlap audit.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} targetDescriptor - Corrected terminal-root descriptor.
 * @param {number} bondLength - Standard bond length.
 * @returns {{rootAtomId: string, otherAtomId: string, distance: number}[]} Soft contact records.
 */
function rootSubtreeSoftContacts(layoutGraph, coords, targetDescriptor, bondLength) {
  const protectedAtomIds = new Set([targetDescriptor.centerAtomId, ...targetDescriptor.rootSubtreeAtomIds]);
  const threshold = bondLength * SOFT_CONTACT_CLEARANCE_FACTOR;
  const contacts = [];
  for (const rootAtomId of rootSubtreeClearanceAtomIds(layoutGraph, coords, targetDescriptor)) {
    const rootPosition = coords.get(rootAtomId);
    if (!rootPosition) {
      continue;
    }
    for (const [otherAtomId, otherPosition] of coords) {
      if (protectedAtomIds.has(otherAtomId) || layoutGraph.bondedPairSet.has(atomPairKey(rootAtomId, otherAtomId))) {
        continue;
      }
      const otherAtom = layoutGraph.atoms.get(otherAtomId);
      if (!otherAtom || otherAtom.element === 'H') {
        continue;
      }
      const clearance = Math.hypot(rootPosition.x - otherPosition.x, rootPosition.y - otherPosition.y);
      if (clearance < threshold - CLEANUP_EPSILON) {
        contacts.push({ rootAtomId, otherAtomId, distance: clearance });
      }
    }
  }
  return contacts.sort((firstContact, secondContact) => firstContact.distance - secondContact.distance);
}

/**
 * Finds small downstream pieces of a corrected root subtree that can rotate
 * around an internal single bond without moving the exact root slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} targetDescriptor - Corrected terminal-root descriptor.
 * @param {Set<string>|null} frozenAtomIds - Frozen atoms to avoid.
 * @returns {{rootAtomId: string, parentAtomId: string, subtreeAtomIds: string[]}[]} Relief descriptors.
 */
function collectRootSubtreeLeafReliefDescriptors(layoutGraph, coords, targetDescriptor, frozenAtomIds) {
  const descriptors = [];
  const descriptorKeys = new Set();
  const rootSubtreeAtomIds = new Set(targetDescriptor.rootSubtreeAtomIds);
  const protectedAtomIds = new Set([targetDescriptor.centerAtomId, targetDescriptor.rootAtomId, targetDescriptor.firstRingNeighborAtomId, targetDescriptor.secondRingNeighborAtomId]);
  for (const atomId of targetDescriptor.rootSubtreeAtomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      for (const [rootAtomId, parentAtomId] of [
        [bond.a, bond.b],
        [bond.b, bond.a]
      ]) {
        if (protectedAtomIds.has(rootAtomId) || !rootSubtreeAtomIds.has(rootAtomId) || !rootSubtreeAtomIds.has(parentAtomId)) {
          continue;
        }
        const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, parentAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId));
        if (
          subtreeAtomIds.length === 0 ||
          subtreeAtomIds.includes(parentAtomId) ||
          subtreeAtomIds.some(
            subtreeAtomId => frozenAtomIds?.has(subtreeAtomId) || protectedAtomIds.has(subtreeAtomId) || !rootSubtreeAtomIds.has(subtreeAtomId) || layoutGraph.ringAtomIdSet.has(subtreeAtomId)
          ) ||
          countHeavyAtoms(layoutGraph, subtreeAtomIds) > MAX_RELIEF_HEAVY_ATOMS
        ) {
          continue;
        }
        const descriptorKey = `${rootAtomId}:${parentAtomId}`;
        if (descriptorKeys.has(descriptorKey)) {
          continue;
        }
        descriptorKeys.add(descriptorKey);
        descriptors.push({ rootAtomId, parentAtomId, subtreeAtomIds });
      }
    }
  }
  return descriptors;
}

/**
 * Clears crossings and soft contacts by rotating a terminal piece inside the
 * root subtree while keeping the root atom on its corrected exact slot.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map after exact root cleanup.
 * @param {object} targetDescriptor - Corrected terminal-root descriptor.
 * @param {object} baseAudit - Audit before the exact root move.
 * @param {object} options - Retouch options.
 * @returns {Map<string, {x: number, y: number}>|null} Repaired coordinates, if found.
 */
function relieveRootSubtreeInternalLeafContacts(layoutGraph, coords, targetDescriptor, baseAudit, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const currentCrossingCount = rootSubtreeVisibleBondCrossingCount(layoutGraph, coords, targetDescriptor);
  const currentClearance = rootSubtreeMinimumClearance(layoutGraph, coords, targetDescriptor);
  const hasSoftContact = rootSubtreeSoftContacts(layoutGraph, coords, targetDescriptor, bondLength).length > 0;
  if (currentCrossingCount === 0 && !hasSoftContact) {
    return null;
  }
  let best = null;
  for (const descriptor of collectRootSubtreeLeafReliefDescriptors(layoutGraph, coords, targetDescriptor, options.frozenAtomIds ?? null)) {
    for (const rotation of ROOT_SUBTREE_LEAF_ROTATIONS) {
      const candidateCoords = rotateReliefSubtree(coords, descriptor, rotation);
      if (rootDeviation(candidateCoords, targetDescriptor) > PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      if (candidateAudit.ok !== true || auditPenalty(candidateAudit) > auditPenalty(baseAudit)) {
        continue;
      }
      const crossingCount = rootSubtreeVisibleBondCrossingCount(layoutGraph, candidateCoords, targetDescriptor);
      if (crossingCount > currentCrossingCount) {
        continue;
      }
      const clearance = rootSubtreeMinimumClearance(layoutGraph, candidateCoords, targetDescriptor);
      if (crossingCount === currentCrossingCount && clearance <= currentClearance + CLEANUP_EPSILON) {
        continue;
      }
      const fanDeviation = parentFanDeviation(layoutGraph, candidateCoords, descriptor.parentAtomId);
      const score = auditPenalty(candidateAudit) + crossingCount * 1_000_000 + fanDeviation * 1_000 - clearance;
      if (!best || score < best.score - CLEANUP_EPSILON) {
        best = {
          coords: candidateCoords,
          score
        };
      }
    }
  }
  return best?.coords ?? null;
}

/**
 * Clears soft contacts created by an exact terminal-root snap by rotating a
 * compact non-ring blocker branch while preserving the corrected root angle.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map after exact root cleanup.
 * @param {object} targetDescriptor - Corrected terminal-root descriptor.
 * @param {object} baseAudit - Audit before the exact root move.
 * @param {object} options - Retouch options.
 * @returns {Map<string, {x: number, y: number}>|null} Repaired coordinates, if found.
 */
function relieveRootSubtreeSoftContacts(layoutGraph, coords, targetDescriptor, baseAudit, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const contacts = rootSubtreeSoftContacts(layoutGraph, coords, targetDescriptor, bondLength);
  if (contacts.length === 0) {
    return null;
  }
  const clearanceTarget = bondLength * SOFT_CONTACT_CLEARANCE_FACTOR;
  const currentClearance = rootSubtreeMinimumClearance(layoutGraph, coords, targetDescriptor);
  const protectedAtomIds = new Set([targetDescriptor.centerAtomId, ...targetDescriptor.rootSubtreeAtomIds]);
  let best = null;
  for (const contact of contacts) {
    const blockerAtomId = contact.otherAtomId;
    if (protectedAtomIds.has(blockerAtomId)) {
      continue;
    }
    for (const bond of layoutGraph.bondsByAtomId.get(blockerAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const parentAtomId = bond.a === blockerAtomId ? bond.b : bond.a;
      const descriptor = collectReliefDescriptor(layoutGraph, coords, blockerAtomId, parentAtomId, protectedAtomIds, options.frozenAtomIds ?? null);
      if (!descriptor) {
        continue;
      }
      for (const rotation of RELIEF_ROTATIONS) {
        const candidateCoords = rotateReliefSubtree(coords, descriptor, rotation);
        if (rootDeviation(candidateCoords, targetDescriptor) > PRESENTATION_METRIC_EPSILON) {
          continue;
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
          bondLength,
          bondValidationClasses: options.bondValidationClasses
        });
        if (candidateAudit.ok !== true || auditPenalty(candidateAudit) > auditPenalty(baseAudit)) {
          continue;
        }
        const clearance = rootSubtreeMinimumClearance(layoutGraph, candidateCoords, targetDescriptor);
        if (clearance < clearanceTarget - CLEANUP_EPSILON || clearance <= currentClearance + CLEANUP_EPSILON) {
          continue;
        }
        const fanDeviation = parentFanDeviation(layoutGraph, candidateCoords, descriptor.parentAtomId);
        const score = clearance * 100 - fanDeviation;
        if (!best || score > best.score + CLEANUP_EPSILON) {
          best = {
            coords: candidateCoords,
            score
          };
        }
      }
    }
  }
  return best?.coords ?? null;
}

/**
 * Clears secondary clashes created by an exact linked-ring root by rotating a
 * compact acyclic branch inside the moved subtree while preserving the root.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map after exact root cleanup.
 * @param {object} targetDescriptor - Corrected linked-root descriptor.
 * @param {object} baseAudit - Audit before the exact root move.
 * @param {object} options - Retouch options.
 * @returns {Map<string, {x: number, y: number}>|null} Repaired coordinates, if found.
 */
function relieveLinkedRootInternalOverlaps(layoutGraph, coords, targetDescriptor, baseAudit, options) {
  if (!targetDescriptor.allowsInternalRelief) {
    return null;
  }
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const problemAtomIds = linkedRootProblemAtomIds(layoutGraph, coords, bondLength);
  if (problemAtomIds.size === 0) {
    return null;
  }
  let best = null;
  for (const descriptor of collectInternalReliefDescriptors(layoutGraph, coords, targetDescriptor, problemAtomIds, options.frozenAtomIds ?? null)) {
    for (const rotation of INTERNAL_RELIEF_ROTATIONS) {
      const candidateCoords = rotateReliefSubtree(coords, descriptor, rotation);
      if (rootDeviation(candidateCoords, targetDescriptor) > PRESENTATION_METRIC_EPSILON) {
        continue;
      }
      const audit = auditLayout(layoutGraph, candidateCoords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      if (audit.ok !== true || auditPenalty(audit) > auditPenalty(baseAudit)) {
        continue;
      }
      const fanDeviation = parentFanDeviation(layoutGraph, candidateCoords, descriptor.parentAtomId);
      const score = auditPenalty(audit) + fanDeviation * 1_000;
      if (!best || score < best.score - 1e-9) {
        best = {
          coords: candidateCoords,
          score
        };
      }
    }
  }
  return best?.coords ?? null;
}

/**
 * Snaps compact substituents and single-hetero linked-ring roots on ring
 * trigonal centers back to exact 120-degree exits, then applies bounded local
 * relief if that exact slot is blocked by a nearby acyclic branch.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {object} [options] - Retouch options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number, changed: boolean}} Retouch result.
 */
export function runRingTerminalRootExactClearance(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  let coords = inputCoords;
  let baseAudit = auditLayout(layoutGraph, coords, {
    bondLength,
    bondValidationClasses: options.bondValidationClasses
  });
  const crowdedTerminalRingLeafCoords = resolveCrowdedTerminalRingLeafCrossings(layoutGraph, coords, baseAudit, {
    ...options,
    bondLength
  });
  if (crowdedTerminalRingLeafCoords) {
    return {
      coords: crowdedTerminalRingLeafCoords,
      nudges: 1,
      linkedRootNudges: 0,
      crowdedTerminalRingLeafNudges: 1,
      changed: true
    };
  }

  let crossingEscapeNudges = 0;
  let linkedRootNudges = 0;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const descriptor of collectTerminalRingRootDescriptors(layoutGraph, coords, options.frozenAtomIds ?? null)) {
      const crossingEscapeCoords = escapeCurrentRootSubtreeCrossing(layoutGraph, coords, descriptor, baseAudit, {
        ...options,
        bondLength
      });
      if (!crossingEscapeCoords) {
        continue;
      }
      coords = crossingEscapeCoords;
      baseAudit = auditLayout(layoutGraph, coords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      crossingEscapeNudges++;
      if (descriptor.allowsInternalRelief) {
        linkedRootNudges++;
      }
      moved = true;
      break;
    }
    if (!moved) {
      break;
    }
  }
  if (crossingEscapeNudges > 0) {
    return {
      coords,
      nudges: crossingEscapeNudges,
      linkedRootNudges,
      changed: true
    };
  }

  for (const descriptor of collectTerminalRingRootDescriptors(layoutGraph, coords, options.frozenAtomIds ?? null)) {
    const inwardEscapeCoords = escapeCurrentRootSubtreeInwardReadability(layoutGraph, coords, descriptor, baseAudit, {
      ...options,
      bondLength
    });
    if (!inwardEscapeCoords) {
      continue;
    }
    return {
      coords: inwardEscapeCoords,
      nudges: 1,
      linkedRootNudges: descriptor.allowsInternalRelief ? 1 : 0,
      changed: true
    };
  }

  for (const descriptor of collectTerminalRingRootDescriptors(layoutGraph, coords, options.frozenAtomIds ?? null)) {
    const exactCoords = exactRootCoords(coords, descriptor);
    if (!exactCoords) {
      continue;
    }
    const exactAudit = auditLayout(layoutGraph, exactCoords, {
      bondLength,
      bondValidationClasses: options.bondValidationClasses
    });
    let exactReliefCoords = null;
    if (exactAudit.ok === true && auditPenalty(exactAudit) <= auditPenalty(baseAudit)) {
      exactReliefCoords = exactCoords;
    } else {
      exactReliefCoords = relieveExactRootRingBlockerOverlaps(layoutGraph, exactCoords, descriptor, baseAudit, options);
    }
    if (exactReliefCoords) {
      let exactCandidateCoords = relieveRootSubtreeInternalLeafContacts(layoutGraph, exactReliefCoords, descriptor, baseAudit, options) ?? exactReliefCoords;
      const exactCandidateAudit = auditLayout(layoutGraph, exactCandidateCoords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      if (exactCandidateAudit.ok === true) {
        exactCandidateCoords = relieveRootSubtreeSoftContacts(layoutGraph, exactCandidateCoords, descriptor, baseAudit, options) ?? exactCandidateCoords;
      }
      const finalExactAudit = auditLayout(layoutGraph, exactCandidateCoords, {
        bondLength,
        bondValidationClasses: options.bondValidationClasses
      });
      if (finalExactAudit.ok === true && auditPenalty(finalExactAudit) <= auditPenalty(baseAudit) && rootDeviation(exactCandidateCoords, descriptor) <= PRESENTATION_METRIC_EPSILON) {
        return {
          coords: exactCandidateCoords,
          nudges: 1,
          linkedRootNudges: descriptor.allowsInternalRelief ? 1 : 0,
          changed: true
        };
      }
    }
    const cleanup = runUnifiedCleanup(layoutGraph, exactCoords, {
      ...options.cleanupOptions,
      bondLength,
      epsilon: options.epsilon ?? bondLength * 0.001,
      maxPasses: 1,
      protectBondIntegrity: true,
      frozenAtomIds: options.frozenAtomIds ?? null
    });
    const cleanupAudit = auditLayout(layoutGraph, cleanup.coords, {
      bondLength,
      bondValidationClasses: options.bondValidationClasses
    });
    const cleanupReliefCoords =
      cleanupAudit.ok === true
        ? cleanup.coords
        : (relieveLinkedRootInternalOverlaps(layoutGraph, cleanup.coords, descriptor, baseAudit, options) ?? relieveCompactOverlaps(layoutGraph, cleanup.coords, descriptor, options));
    let candidateCoords =
      relieveRootSubtreeInternalLeafContacts(layoutGraph, exactCoords, descriptor, baseAudit, options) ??
      relieveRootSubtreeInternalLeafContacts(layoutGraph, cleanupReliefCoords ?? cleanup.coords, descriptor, baseAudit, options) ??
      cleanupReliefCoords;
    if (!candidateCoords) {
      continue;
    }
    const softContactAudit = auditLayout(layoutGraph, candidateCoords, {
      bondLength,
      bondValidationClasses: options.bondValidationClasses
    });
    if (softContactAudit.ok === true) {
      candidateCoords = relieveRootSubtreeSoftContacts(layoutGraph, candidateCoords, descriptor, baseAudit, options) ?? candidateCoords;
    }
    const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
      bondLength,
      bondValidationClasses: options.bondValidationClasses
    });
    if (
      candidateAudit.ok === true &&
      (candidateAudit.bondLengthFailureCount ?? 0) <= (baseAudit.bondLengthFailureCount ?? 0) &&
      (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (baseAudit.visibleHeavyBondCrossingCount ?? 0) &&
      rootDeviation(candidateCoords, descriptor) <= PRESENTATION_METRIC_EPSILON
    ) {
      return {
        coords: candidateCoords,
        nudges: 1,
        linkedRootNudges: descriptor.allowsInternalRelief ? 1 : 0,
        changed: true
      };
    }
  }
  return {
    coords: inputCoords,
    nudges: 0,
    linkedRootNudges: 0,
    changed: false
  };
}
