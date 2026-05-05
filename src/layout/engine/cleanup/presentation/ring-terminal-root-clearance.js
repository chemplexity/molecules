/** @module cleanup/presentation/ring-terminal-root-clearance */

import { auditLayout } from '../../audit/audit.js';
import { findSevereOverlaps } from '../../audit/invariants.js';
import { CLEANUP_EPSILON, PRESENTATION_METRIC_EPSILON } from '../../constants.js';
import { angleOf, angularDifference, sub, wrapAngle } from '../../geometry/vec2.js';
import { rotateAround } from '../../geometry/transforms.js';
import { runUnifiedCleanup } from '../unified-cleanup.js';
import { collectCutSubtree } from '../subtree-utils.js';

const IDEAL_TRIGONAL_ANGLE = (2 * Math.PI) / 3;
const MIN_ROOT_DEVIATION = 0.1;
const MAX_TERMINAL_ROOT_HEAVY_ATOMS = 3;
const MAX_RELIEF_HEAVY_ATOMS = 4;
const RELIEF_ROTATIONS = [-Math.PI / 12, Math.PI / 12, -Math.PI / 6, Math.PI / 6];

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
    if (
      rootSubtreeAtomIds.length === 0
      || rootSubtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId) || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0)
      || countHeavyAtoms(layoutGraph, rootSubtreeAtomIds) > MAX_TERMINAL_ROOT_HEAVY_ATOMS
    ) {
      continue;
    }
    const descriptor = {
      centerAtomId,
      rootAtomId,
      firstRingNeighborAtomId: ringBonds[0].neighborAtomId,
      secondRingNeighborAtomId: ringBonds[1].neighborAtomId,
      rootSubtreeAtomIds
    };
    if (rootDeviation(coords, descriptor) > MIN_ROOT_DEVIATION) {
      descriptors.push(descriptor);
    }
  }
  return descriptors;
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
 * Snaps compact terminal substituents on ring trigonal centers back to exact
 * 120-degree exits, then applies bounded local relief if that exact slot is
 * blocked by a nearby acyclic branch.
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
      : relieveCompactOverlaps(layoutGraph, cleanup.coords, descriptor, options);
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
        changed: true
      };
    }
  }
  return {
    coords: inputCoords,
    nudges: 0,
    changed: false
  };
}
