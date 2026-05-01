/** @module cleanup/presentation/diaryl-omitted-h-fan */

import { findSevereOverlaps, measureDivalentContinuationDistortion } from '../../audit/invariants.js';
import { add, angleOf, angularDifference, rotate, sub } from '../../geometry/vec2.js';
import { collectCutSubtree } from '../subtree-utils.js';
import { runUnifiedCleanup } from '../unified-cleanup.js';
import { measureTerminalCationRingProximityPenalty } from './terminal-cation-ring-clearance.js';

const IDEAL_THREE_HEAVY_ANGLE = (2 * Math.PI) / 3;
const MIN_DIARYL_FAN_DEVIATION = Math.PI / 9;
const MIN_DIARYL_FAN_IMPROVEMENT = 1e-4;
const DIARYL_FAN_ROTATIONS = Object.freeze([
  Math.PI / 6,
  -(Math.PI / 6),
  Math.PI / 12,
  -(Math.PI / 12),
  Math.PI / 4,
  -(Math.PI / 4)
]);
const COUPLED_RELIEF_ROTATIONS = Object.freeze([
  Math.PI / 6,
  -(Math.PI / 6),
  Math.PI / 4,
  -(Math.PI / 4),
  Math.PI / 3,
  -(Math.PI / 3),
  Math.PI / 2,
  -(Math.PI / 2),
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3
]);
const MAX_COUPLED_RELIEF_HEAVY_ATOMS = 28;
const TIDY_EPSILON = 1e-6;

function cloneCoords(coords) {
  return new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
}

function heavyCovalentNeighborIds(layoutGraph, atomId) {
  const neighborIds = [];
  for (const bond of layoutGraph?.bondsByAtomId?.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom && neighborAtom.element !== 'H') {
      neighborIds.push(neighborAtomId);
    }
  }
  return neighborIds;
}

function isAromaticRingRoot(layoutGraph, atomId) {
  return (layoutGraph?.atomToRings.get(atomId) ?? [])
    .some(ring => ring?.aromatic === true && Array.isArray(ring.atomIds));
}

function atomAngle(coords, centerAtomId, firstAtomId, secondAtomId) {
  const center = coords.get(centerAtomId);
  const first = coords.get(firstAtomId);
  const second = coords.get(secondAtomId);
  if (!center || !first || !second) {
    return null;
  }
  return angularDifference(
    angleOf(sub(first, center)),
    angleOf(sub(second, center))
  );
}

function measureThreeHeavyFan(coords, centerAtomId, neighborAtomIds) {
  let maxDeviation = 0;
  let totalDeviation = 0;
  for (let index = 0; index < neighborAtomIds.length; index++) {
    for (let nextIndex = index + 1; nextIndex < neighborAtomIds.length; nextIndex++) {
      const angle = atomAngle(coords, centerAtomId, neighborAtomIds[index], neighborAtomIds[nextIndex]);
      if (angle == null) {
        continue;
      }
      const deviation = Math.abs(angle - IDEAL_THREE_HEAVY_ANGLE);
      maxDeviation = Math.max(maxDeviation, deviation);
      totalDeviation += deviation * deviation;
    }
  }
  return { maxDeviation, totalDeviation };
}

function collectDiarylFanDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const [atomId, atom] of layoutGraph?.atoms ?? []) {
    if (
      !coords.has(atomId)
      || atom.element !== 'C'
      || atom.aromatic
      || atom.heavyDegree !== 3
      || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0
    ) {
      continue;
    }

    const neighborAtomIds = heavyCovalentNeighborIds(layoutGraph, atomId);
    if (neighborAtomIds.length !== 3) {
      continue;
    }
    const ringRootAtomIds = neighborAtomIds.filter(neighborAtomId => isAromaticRingRoot(layoutGraph, neighborAtomId));
    const parentAtomIds = neighborAtomIds.filter(neighborAtomId => !ringRootAtomIds.includes(neighborAtomId));
    if (ringRootAtomIds.length !== 2 || parentAtomIds.length !== 1) {
      continue;
    }

    const parentAtom = layoutGraph.atoms.get(parentAtomIds[0]);
    if (!parentAtom || parentAtom.element !== 'N' || parentAtom.heavyDegree !== 3 || parentAtom.aromatic) {
      continue;
    }

    const fan = measureThreeHeavyFan(coords, atomId, neighborAtomIds);
    if (fan.maxDeviation < MIN_DIARYL_FAN_DEVIATION) {
      continue;
    }

    descriptors.push({
      centerAtomId: atomId,
      parentAtomId: parentAtomIds[0],
      neighborAtomIds,
      ringRootAtomIds,
      baseFanPenalty: fan.totalDeviation
    });
  }
  return descriptors;
}

function countHeavyAtoms(layoutGraph, atomIds) {
  return atomIds.reduce((total, atomId) => total + (layoutGraph.atoms.get(atomId)?.element === 'H' ? 0 : 1), 0);
}

function collectCoupledReliefDescriptors(layoutGraph, coords, descriptor) {
  const reliefDescriptors = [];
  for (const parentSiblingAtomId of heavyCovalentNeighborIds(layoutGraph, descriptor.parentAtomId)) {
    if (parentSiblingAtomId === descriptor.centerAtomId || !coords.has(parentSiblingAtomId)) {
      continue;
    }
    for (const reliefRootAtomId of heavyCovalentNeighborIds(layoutGraph, parentSiblingAtomId)) {
      if (reliefRootAtomId === descriptor.parentAtomId || !coords.has(reliefRootAtomId)) {
        continue;
      }
      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, reliefRootAtomId, parentSiblingAtomId)]
        .filter(atomId => coords.has(atomId));
      if (
        subtreeAtomIds.length === 0
        || subtreeAtomIds.includes(descriptor.centerAtomId)
        || countHeavyAtoms(layoutGraph, subtreeAtomIds) > MAX_COUPLED_RELIEF_HEAVY_ATOMS
      ) {
        continue;
      }
      reliefDescriptors.push({
        rootAtomId: reliefRootAtomId,
        pivotAtomId: parentSiblingAtomId
      });
    }
  }
  return reliefDescriptors;
}

function rotateSubtreeAroundPivot(layoutGraph, coords, rootAtomId, pivotAtomId, rotation) {
  const pivotPosition = coords.get(pivotAtomId);
  if (!pivotPosition) {
    return null;
  }
  const atomIds = [...collectCutSubtree(layoutGraph, rootAtomId, pivotAtomId)]
    .filter(atomId => coords.has(atomId));
  if (atomIds.length === 0) {
    return null;
  }
  const nextCoords = cloneCoords(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    nextCoords.set(atomId, add(pivotPosition, rotate(sub(position, pivotPosition), rotation)));
  }
  return nextCoords;
}

function maxCovalentBondLengthDeviation(layoutGraph, coords, bondLength) {
  let maxDeviation = 0;
  for (const bond of layoutGraph?.bonds ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const first = coords.get(bond.a);
    const second = coords.get(bond.b);
    if (!first || !second) {
      continue;
    }
    maxDeviation = Math.max(
      maxDeviation,
      Math.abs(Math.hypot(first.x - second.x, first.y - second.y) - bondLength)
    );
  }
  return maxDeviation;
}

function cleanupCandidateOverlaps(layoutGraph, coords, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  if (overlaps.length === 0) {
    return { coords, cleanupPasses: 0, cleanupMoves: 0 };
  }
  const cleanup = runUnifiedCleanup(layoutGraph, coords, {
    epsilon: bondLength * 0.001,
    bondLength,
    maxPasses: 1,
    protectLargeMoleculeBackbone: options.protectLargeMoleculeBackbone === true,
    cleanupRigidSubtreesByAtomId: options.cleanupRigidSubtreesByAtomId
  });
  return {
    coords: cleanup.coords,
    cleanupPasses: cleanup.passes ?? 0,
    cleanupMoves: cleanup.overlapMoves ?? 0
  };
}

function scoreCandidate(layoutGraph, coords, descriptor, baseMetrics, rotation, options) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const severeOverlapCount = findSevereOverlaps(layoutGraph, coords, bondLength).length;
  if (severeOverlapCount > baseMetrics.severeOverlapCount) {
    return null;
  }
  if (maxCovalentBondLengthDeviation(layoutGraph, coords, bondLength) > bondLength * 0.05) {
    return null;
  }
  const fan = measureThreeHeavyFan(coords, descriptor.centerAtomId, descriptor.neighborAtomIds);
  if (fan.totalDeviation > descriptor.baseFanPenalty - MIN_DIARYL_FAN_IMPROVEMENT) {
    return null;
  }
  const terminalCationRingProximityPenalty = measureTerminalCationRingProximityPenalty(layoutGraph, coords, {
    bondLength
  });
  if (terminalCationRingProximityPenalty > baseMetrics.terminalCationRingProximityPenalty + TIDY_EPSILON) {
    return null;
  }
  return {
    coords,
    divalentPenalty: measureDivalentContinuationDistortion(layoutGraph, coords).totalDeviation,
    fanPenalty: fan.totalDeviation,
    severeOverlapCount,
    terminalCationRingProximityPenalty,
    rotationMagnitude: Math.abs(rotation)
  };
}

function addScoredCandidate(layoutGraph, coords, descriptor, baseMetrics, rotation, options, incumbent) {
  const candidate = scoreCandidate(layoutGraph, coords, descriptor, baseMetrics, rotation, options);
  return candidate && isBetterCandidate(candidate, incumbent) ? candidate : incumbent;
}

function isBetterCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.severeOverlapCount !== incumbent.severeOverlapCount) {
    return candidate.severeOverlapCount < incumbent.severeOverlapCount;
  }
  if (Math.abs(candidate.terminalCationRingProximityPenalty - incumbent.terminalCationRingProximityPenalty) > TIDY_EPSILON) {
    return candidate.terminalCationRingProximityPenalty < incumbent.terminalCationRingProximityPenalty;
  }
  if (Math.abs(candidate.fanPenalty - incumbent.fanPenalty) > TIDY_EPSILON) {
    return candidate.fanPenalty < incumbent.fanPenalty;
  }
  if (Math.abs(candidate.divalentPenalty - incumbent.divalentPenalty) > TIDY_EPSILON) {
    return candidate.divalentPenalty < incumbent.divalentPenalty;
  }
  return candidate.rotationMagnitude < incumbent.rotationMagnitude;
}

/**
 * Rebalances diaryl omitted-H fans at planar tertiary nitrogens. When exacting
 * the diaryl fan creates a small downstream overlap, bounded coupled rotations
 * on sibling side branches, then a single local cleanup pass, may move the
 * blocker out of the newly opened space.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{bondLength?: number, cleanupRigidSubtreesByAtomId?: Map<string, Array<object>>, protectLargeMoleculeBackbone?: boolean}} [options] - Tidy options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Tidy result.
 */
export function runDiarylOmittedHydrogenFanTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  let coords = cloneCoords(inputCoords);
  let nudges = 0;

  for (const descriptor of collectDiarylFanDescriptors(layoutGraph, coords)) {
    const baseMetrics = {
      severeOverlapCount: findSevereOverlaps(layoutGraph, coords, bondLength).length,
      terminalCationRingProximityPenalty: measureTerminalCationRingProximityPenalty(layoutGraph, coords, {
        bondLength
      })
    };
    let bestCandidate = null;

    for (const rootAtomId of descriptor.ringRootAtomIds) {
      for (const rotation of DIARYL_FAN_ROTATIONS) {
        const rotatedCoords = rotateSubtreeAroundPivot(
          layoutGraph,
          coords,
          rootAtomId,
          descriptor.centerAtomId,
          rotation
        );
        if (!rotatedCoords) {
          continue;
        }
        bestCandidate = addScoredCandidate(
          layoutGraph,
          rotatedCoords,
          descriptor,
          baseMetrics,
          rotation,
          {
            ...options,
            bondLength
          },
          bestCandidate
        );

        const reliefDescriptors = collectCoupledReliefDescriptors(layoutGraph, rotatedCoords, descriptor);
        for (const reliefDescriptor of reliefDescriptors) {
          for (const reliefRotation of COUPLED_RELIEF_ROTATIONS) {
            const relievedCoords = rotateSubtreeAroundPivot(
              layoutGraph,
              rotatedCoords,
              reliefDescriptor.rootAtomId,
              reliefDescriptor.pivotAtomId,
              reliefRotation
            );
            if (!relievedCoords) {
              continue;
            }
            bestCandidate = addScoredCandidate(
              layoutGraph,
              relievedCoords,
              descriptor,
              baseMetrics,
              rotation,
              {
                ...options,
                bondLength
              },
              bestCandidate
            );
          }
        }

        const cleaned = cleanupCandidateOverlaps(layoutGraph, rotatedCoords, {
          ...options,
          bondLength
        });
        bestCandidate = addScoredCandidate(
          layoutGraph,
          cleaned.coords,
          descriptor,
          baseMetrics,
          rotation,
          {
            ...options,
            bondLength
          },
          bestCandidate
        );
      }
    }

    if (bestCandidate) {
      coords = bestCandidate.coords;
      nudges++;
    }
  }

  return { coords, nudges };
}
