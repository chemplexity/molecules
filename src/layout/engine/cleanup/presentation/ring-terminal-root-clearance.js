/** @module cleanup/presentation/ring-terminal-root-clearance */

import { auditLayout } from '../../audit/audit.js';
import { findSevereOverlaps, findVisibleHeavyBondCrossings } from '../../audit/invariants.js';
import { CLEANUP_EPSILON, PRESENTATION_METRIC_EPSILON } from '../../constants.js';
import { angleOf, angularDifference, sub, wrapAngle } from '../../geometry/vec2.js';
import { rotateAround } from '../../geometry/transforms.js';
import { runUnifiedCleanup } from '../unified-cleanup.js';
import { collectCutSubtree } from '../subtree-utils.js';

const IDEAL_TRIGONAL_ANGLE = (2 * Math.PI) / 3;
const MIN_ROOT_DEVIATION = 0.1;
const MAX_TERMINAL_ROOT_HEAVY_ATOMS = 3;
const MAX_LINKED_RING_ROOT_HEAVY_ATOMS = 80;
const MAX_RELIEF_HEAVY_ATOMS = 4;
const MAX_INTERNAL_RELIEF_HEAVY_ATOMS = 8;
const RELIEF_ROTATIONS = [-Math.PI / 12, Math.PI / 12, -Math.PI / 6, Math.PI / 6];
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

function visibleHeavyCovalentBonds(layoutGraph, coords, atomId) {
  const bonds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
      continue;
    }
    bonds.push({ bond, neighborAtomId });
  }
  return bonds;
}

function countHeavyAtoms(layoutGraph, atomIds) {
  return atomIds.reduce((count, atomId) => (
    layoutGraph.atoms.get(atomId)?.element === 'H' ? count : count + 1
  ), 0);
}

/**
 * Returns whether an atom collection contains at least one ring atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Candidate atom IDs.
 * @returns {boolean} True when any atom belongs to a ring.
 */
function hasRingAtom(layoutGraph, atomIds) {
  return atomIds.some(atomId => (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0);
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
    rootAtom
    && rootAtom.element !== 'C'
    && rootAtom.element !== 'H'
    && rootAtom.heavyDegree === 2
    && hasRingAtom(layoutGraph, rootSubtreeAtomIds)
    && countHeavyAtoms(layoutGraph, rootSubtreeAtomIds) <= MAX_LINKED_RING_ROOT_HEAVY_ATOMS
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
    if (frozenAtomIds?.has(centerAtomId) || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) === 0) {
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
    const ringBonds = heavyBonds.filter(({ neighborAtomId }) => (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0);
    const terminalBonds = heavyBonds.filter(({ bond, neighborAtomId }) => (
      (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) === 0
      && !bond.aromatic
      && (bond.order ?? 1) === 1
    ));
    if (ringBonds.length !== 2 || terminalBonds.length !== 1) {
      continue;
    }
    const rootAtomId = terminalBonds[0].neighborAtomId;
    const rootSubtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
    if (rootSubtreeAtomIds.length === 0 || rootSubtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId))) {
      continue;
    }
    const containsRingAtom = hasRingAtom(layoutGraph, rootSubtreeAtomIds);
    const isCompactTerminalRoot = (
      !containsRingAtom
      && countHeavyAtoms(layoutGraph, rootSubtreeAtomIds) <= MAX_TERMINAL_ROOT_HEAVY_ATOMS
    );
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
    if (rootDeviation(coords, descriptor) > MIN_ROOT_DEVIATION) {
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

function collectReliefDescriptor(layoutGraph, coords, rootAtomId, parentAtomId, protectedAtomIds, frozenAtomIds) {
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, parentAtomId)].filter(atomId => coords.has(atomId));
  if (
    subtreeAtomIds.length === 0
    || subtreeAtomIds.includes(parentAtomId)
    || subtreeAtomIds.some(atomId => protectedAtomIds.has(atomId) || frozenAtomIds?.has(atomId) || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0)
    || countHeavyAtoms(layoutGraph, subtreeAtomIds) > MAX_RELIEF_HEAVY_ATOMS
  ) {
    return null;
  }
  return { rootAtomId, parentAtomId, subtreeAtomIds };
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
 * Converts an audit summary into a sortable penalty for local relief choices.
 * @param {object} audit - Layout audit summary.
 * @returns {number} Weighted audit penalty.
 */
function auditPenalty(audit) {
  return (
    (audit.bondLengthFailureCount ?? 0) * 100_000_000
    + (audit.severeOverlapCount ?? 0) * 10_000_000
    + (audit.visibleHeavyBondCrossingCount ?? 0) * 1_000_000
    + (audit.ringSubstituentReadabilityFailureCount ?? 0) * 100_000
    + (audit.inwardRingSubstituentCount ?? 0) * 100_000
    + (audit.outwardAxisRingSubstituentFailureCount ?? 0) * 100_000
    + (audit.labelOverlapCount ?? 0) * 10_000
    + (audit.severeOverlapPenalty ?? 0) * 1_000
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
  return angularDifference(
    angleOf(sub(firstPosition, centerPosition)),
    angleOf(sub(secondPosition, centerPosition))
  );
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
  const protectedAtomIds = new Set([
    targetDescriptor.centerAtomId,
    targetDescriptor.rootAtomId,
    targetDescriptor.firstRingNeighborAtomId,
    targetDescriptor.secondRingNeighborAtomId
  ]);
  for (const problemAtomId of problemAtomIds) {
    if (!movedAtomIds.has(problemAtomId)) {
      continue;
    }
    for (const bond of layoutGraph.bonds.values()) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      for (const [rootAtomId, parentAtomId] of [[bond.a, bond.b], [bond.b, bond.a]]) {
        if (!movedAtomIds.has(rootAtomId) || !movedAtomIds.has(parentAtomId) || protectedAtomIds.has(rootAtomId)) {
          continue;
        }
        const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, parentAtomId)]
          .filter(atomId => coords.has(atomId));
        if (
          subtreeAtomIds.length === 0
          || !subtreeAtomIds.includes(problemAtomId)
          || subtreeAtomIds.includes(parentAtomId)
          || subtreeAtomIds.some(atomId =>
            frozenAtomIds?.has(atomId)
            || protectedAtomIds.has(atomId)
            || !movedAtomIds.has(atomId)
            || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0
          )
          || countHeavyAtoms(layoutGraph, subtreeAtomIds) > MAX_INTERNAL_RELIEF_HEAVY_ATOMS
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
        const descriptor = collectReliefDescriptor(
          layoutGraph,
          coords,
          overlapAtomId,
          parentAtomId,
          protectedAtomIds,
          options.frozenAtomIds ?? null
        );
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
  for (const descriptor of collectInternalReliefDescriptors(
    layoutGraph,
    coords,
    targetDescriptor,
    problemAtomIds,
    options.frozenAtomIds ?? null
  )) {
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
  const baseAudit = auditLayout(layoutGraph, inputCoords, {
    bondLength,
    bondValidationClasses: options.bondValidationClasses
  });
  for (const descriptor of collectTerminalRingRootDescriptors(layoutGraph, inputCoords, options.frozenAtomIds ?? null)) {
    const exactCoords = exactRootCoords(inputCoords, descriptor);
    if (!exactCoords) {
      continue;
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
    const candidateCoords = cleanupAudit.ok === true
      ? cleanup.coords
      : (
        relieveLinkedRootInternalOverlaps(layoutGraph, cleanup.coords, descriptor, baseAudit, options)
        ?? relieveCompactOverlaps(layoutGraph, cleanup.coords, descriptor, options)
      );
    if (!candidateCoords) {
      continue;
    }
    const candidateAudit = auditLayout(layoutGraph, candidateCoords, {
      bondLength,
      bondValidationClasses: options.bondValidationClasses
    });
    if (
      candidateAudit.ok === true
      && (candidateAudit.bondLengthFailureCount ?? 0) <= (baseAudit.bondLengthFailureCount ?? 0)
      && (candidateAudit.visibleHeavyBondCrossingCount ?? 0) <= (baseAudit.visibleHeavyBondCrossingCount ?? 0)
      && rootDeviation(candidateCoords, descriptor) <= PRESENTATION_METRIC_EPSILON
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
