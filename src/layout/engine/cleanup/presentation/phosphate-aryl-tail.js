/** @module cleanup/presentation/phosphate-aryl-tail */

import { auditLayout } from '../../audit/audit.js';
import { countVisibleHeavyBondCrossings, findVisibleHeavyBondCrossings } from '../../audit/invariants.js';
import { add, angleOf, angularDifference, fromAngle, sub } from '../../geometry/vec2.js';
import { computeIncidentRingOutwardAngles } from '../../geometry/ring-direction.js';
import { collectCutSubtree } from '../subtree-utils.js';

const PHOSPHATE_TAIL_BEND_NEED = (Math.PI / 18) ** 2;
const PHOSPHATE_TAIL_ANCHOR_EXIT_NEED = (Math.PI / 18) ** 2;
const PHOSPHATE_LINKER_ANGLE_NEED = (Math.PI / 18) ** 2;
const IDEAL_TAIL_ROOT_BEND = (2 * Math.PI) / 3;
const IDEAL_PHOSPHATE_LINKER_ANGLE = Math.PI;
const ROOT_RESCUE_OFFSETS = Object.freeze([0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6, Math.PI / 4, -Math.PI / 4]);
const LINKER_RESCUE_OFFSETS = Object.freeze([0, Math.PI / 12, -Math.PI / 12, Math.PI / 6, -Math.PI / 6, Math.PI / 4, -Math.PI / 4]);
const BEND_OFFSETS = Object.freeze([Math.PI / 3, -Math.PI / 3]);
const MAX_JOINT_TAIL_DESCRIPTORS = 3;
const MAX_JOINT_LINKER_DESCRIPTORS = 3;
const TAIL_GEOMETRY_BEAM_WIDTH = 8;

const PHOSPHATE_LINKER_SCORE_WEIGHT = 8;
const PHOSPHATE_TAIL_ANCHOR_SCORE_WEIGHT = 6;
const PHOSPHATE_TAIL_ROOT_SCORE_WEIGHT = 20;

function findLayoutBond(layoutGraph, firstAtomId, secondAtomId) {
  for (const bond of layoutGraph?.bondsByAtomId.get(firstAtomId) ?? []) {
    const neighborAtomId = bond.a === firstAtomId ? bond.b : bond.a;
    if (neighborAtomId === secondAtomId) {
      return bond;
    }
  }
  return null;
}

function mergeAngles(angles) {
  const merged = [];
  for (const angle of angles) {
    if (!Number.isFinite(angle)) {
      continue;
    }
    if (!merged.some(existingAngle => angularDifference(existingAngle, angle) < 1e-9)) {
      merged.push(angle);
    }
  }
  return merged;
}

function isVisibleCarbon(layoutGraph, atomId) {
  const atom = layoutGraph?.atoms.get(atomId);
  return Boolean(
    atom
    && atom.element === 'C'
    && atom.visible !== false
    && atom.aromatic !== true
    && (layoutGraph.atomToRings.get(atomId)?.length ?? 0) === 0
  );
}

function isPhosphateBoundAromaticRing(layoutGraph, anchorAtomId) {
  const rings = layoutGraph?.atomToRings.get(anchorAtomId) ?? [];
  for (const ring of rings) {
    if (ring?.aromatic !== true || !Array.isArray(ring.atomIds)) {
      continue;
    }
    const ringAtomIds = new Set(ring.atomIds);
    for (const ringAtomId of ring.atomIds) {
      for (const exocyclicBond of layoutGraph.bondsByAtomId.get(ringAtomId) ?? []) {
        if (!exocyclicBond || exocyclicBond.kind !== 'covalent' || exocyclicBond.aromatic || (exocyclicBond.order ?? 1) !== 1) {
          continue;
        }
        const oxygenAtomId = exocyclicBond.a === ringAtomId ? exocyclicBond.b : exocyclicBond.a;
        if (ringAtomIds.has(oxygenAtomId) || layoutGraph.atoms.get(oxygenAtomId)?.element !== 'O') {
          continue;
        }
        for (const oxygenBond of layoutGraph.bondsByAtomId.get(oxygenAtomId) ?? []) {
          if (!oxygenBond || oxygenBond.kind !== 'covalent' || oxygenBond.aromatic) {
            continue;
          }
          const neighborAtomId = oxygenBond.a === oxygenAtomId ? oxygenBond.b : oxygenBond.a;
          if (neighborAtomId !== ringAtomId && layoutGraph.atoms.get(neighborAtomId)?.element === 'P') {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function continuationCarbonNeighborIds(layoutGraph, atomId, parentAtomId) {
  const neighborIds = [];
  for (const bond of layoutGraph?.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
      return [];
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    if (neighborAtomId === parentAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtom.visible === false) {
      continue;
    }
    if (!isVisibleCarbon(layoutGraph, neighborAtomId)) {
      return [];
    }
    neighborIds.push(neighborAtomId);
  }
  return neighborIds;
}

function collectPhosphateArylTailDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const [anchorAtomId, anchorAtom] of layoutGraph?.atoms ?? []) {
    if (
      anchorAtom?.aromatic !== true
      || !coords.has(anchorAtomId)
      || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) !== 1
      || !isPhosphateBoundAromaticRing(layoutGraph, anchorAtomId)
    ) {
      continue;
    }
    for (const anchorBond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
      if (!anchorBond || anchorBond.kind !== 'covalent' || anchorBond.aromatic || (anchorBond.order ?? 1) !== 1) {
        continue;
      }
      const rootAtomId = anchorBond.a === anchorAtomId ? anchorBond.b : anchorBond.a;
      if (!isVisibleCarbon(layoutGraph, rootAtomId) || !coords.has(rootAtomId)) {
        continue;
      }
      const middleAtomIds = continuationCarbonNeighborIds(layoutGraph, rootAtomId, anchorAtomId);
      if (middleAtomIds.length !== 1) {
        continue;
      }
      const middleAtomId = middleAtomIds[0];
      if (!coords.has(middleAtomId) || (findLayoutBond(layoutGraph, rootAtomId, middleAtomId)?.order ?? 1) !== 1) {
        continue;
      }
      const terminalAtomIds = continuationCarbonNeighborIds(layoutGraph, middleAtomId, rootAtomId);
      if (terminalAtomIds.length !== 1) {
        continue;
      }
      const terminalAtomId = terminalAtomIds[0];
      const terminalBond = findLayoutBond(layoutGraph, middleAtomId, terminalAtomId);
      if (!coords.has(terminalAtomId) || !terminalBond || terminalBond.kind !== 'covalent' || terminalBond.aromatic) {
        continue;
      }
      if (continuationCarbonNeighborIds(layoutGraph, terminalAtomId, middleAtomId).length !== 0) {
        continue;
      }
      descriptors.push({
        anchorAtomId,
        rootAtomId,
        middleAtomId,
        terminalAtomId,
        terminalBondOrder: terminalBond.order ?? 1,
        atomIds: [rootAtomId, middleAtomId, terminalAtomId]
      });
    }
  }
  return descriptors;
}

function collectPhosphateArylLinkerDescriptors(layoutGraph, coords) {
  const descriptors = [];
  for (const [oxygenAtomId, oxygenAtom] of layoutGraph?.atoms ?? []) {
    if (
      !oxygenAtom
      || oxygenAtom.element !== 'O'
      || oxygenAtom.aromatic === true
      || (layoutGraph.atomToRings.get(oxygenAtomId)?.length ?? 0) > 0
      || !coords.has(oxygenAtomId)
    ) {
      continue;
    }

    let phosphorusAtomId = null;
    let arylAtomId = null;
    for (const bond of layoutGraph.bondsByAtomId.get(oxygenAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
        continue;
      }
      const neighborAtomId = bond.a === oxygenAtomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || !coords.has(neighborAtomId)) {
        continue;
      }
      if (neighborAtom.element === 'P') {
        phosphorusAtomId = neighborAtomId;
        continue;
      }
      if (
        neighborAtom.element === 'C'
        && neighborAtom.aromatic === true
        && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) === 1
        && isPhosphateBoundAromaticRing(layoutGraph, neighborAtomId)
      ) {
        arylAtomId = neighborAtomId;
      }
    }

    if (!phosphorusAtomId || !arylAtomId) {
      continue;
    }
    const subtreeAtomIds = [...collectCutSubtree(layoutGraph, arylAtomId, oxygenAtomId)]
      .filter(atomId => coords.has(atomId));
    if (subtreeAtomIds.length === 0) {
      continue;
    }
    descriptors.push({
      phosphorusAtomId,
      oxygenAtomId,
      arylAtomId,
      subtreeAtomIds
    });
  }
  return descriptors;
}

function tailRootBendAngle(coords, descriptor) {
  const rootPosition = coords.get(descriptor.rootAtomId);
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const middlePosition = coords.get(descriptor.middleAtomId);
  if (!rootPosition || !anchorPosition || !middlePosition) {
    return IDEAL_TAIL_ROOT_BEND;
  }
  return angularDifference(
    angleOf(sub(anchorPosition, rootPosition)),
    angleOf(sub(middlePosition, rootPosition))
  );
}

function tailRootBendPenalty(coords, descriptor) {
  const bendAngle = tailRootBendAngle(coords, descriptor);
  return (bendAngle - IDEAL_TAIL_ROOT_BEND) ** 2;
}

function tailAnchorExitPenalty(layoutGraph, coords, descriptor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return 0;
  }
  const outwardAngles = computeIncidentRingOutwardAngles(
    layoutGraph,
    descriptor.anchorAtomId,
    atomId => coords.get(atomId) ?? null
  );
  if (outwardAngles.length === 0) {
    return 0;
  }
  const currentAngle = angleOf(sub(rootPosition, anchorPosition));
  const bestDeviation = Math.min(...outwardAngles.map(outwardAngle => angularDifference(currentAngle, outwardAngle)));
  return bestDeviation ** 2;
}

function phosphateLinkerAngle(coords, descriptor) {
  const phosphorusPosition = coords.get(descriptor.phosphorusAtomId);
  const oxygenPosition = coords.get(descriptor.oxygenAtomId);
  const arylPosition = coords.get(descriptor.arylAtomId);
  if (!phosphorusPosition || !oxygenPosition || !arylPosition) {
    return IDEAL_PHOSPHATE_LINKER_ANGLE;
  }
  return angularDifference(
    angleOf(sub(phosphorusPosition, oxygenPosition)),
    angleOf(sub(arylPosition, oxygenPosition))
  );
}

function phosphateLinkerAnglePenalty(coords, descriptor) {
  const linkerAngle = phosphateLinkerAngle(coords, descriptor);
  return (linkerAngle - IDEAL_PHOSPHATE_LINKER_ANGLE) ** 2;
}

function tailCrossingAtomIds(layoutGraph, coords) {
  const atomIds = new Set();
  for (const crossing of findVisibleHeavyBondCrossings(layoutGraph, coords)) {
    for (const atomId of [...crossing.firstAtomIds, ...crossing.secondAtomIds]) {
      atomIds.add(atomId);
    }
  }
  return atomIds;
}

function descriptorCandidatePoses(layoutGraph, coords, descriptor, bondLength) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition || !(bondLength > 0)) {
    return [];
  }
  const currentRootAngle = angleOf(sub(rootPosition, anchorPosition));
  const preferredRootAngles = computeIncidentRingOutwardAngles(
    layoutGraph,
    descriptor.anchorAtomId,
    atomId => coords.get(atomId) ?? null
  );
  const rootAngles = mergeAngles([
    currentRootAngle,
    ...preferredRootAngles.flatMap(preferredAngle =>
      ROOT_RESCUE_OFFSETS.map(offset => preferredAngle + offset)
    )
  ]);

  const poses = [];
  for (const rootAngle of rootAngles) {
    for (const bendOffset of BEND_OFFSETS) {
      const root = add(anchorPosition, fromAngle(rootAngle, bondLength));
      const middleAngle = rootAngle + bendOffset;
      const middle = add(root, fromAngle(middleAngle, bondLength));
      const terminalAngle = descriptor.terminalBondOrder >= 2 ? middleAngle : middleAngle - bendOffset;
      const terminal = add(middle, fromAngle(terminalAngle, bondLength));
      poses.push({
        root,
        middle,
        terminal
      });
    }
  }
  return poses;
}

function linkerCandidateAngles(coords, descriptor) {
  const phosphorusPosition = coords.get(descriptor.phosphorusAtomId);
  const oxygenPosition = coords.get(descriptor.oxygenAtomId);
  const arylPosition = coords.get(descriptor.arylAtomId);
  if (!phosphorusPosition || !oxygenPosition || !arylPosition) {
    return [];
  }

  const currentAngle = angleOf(sub(arylPosition, oxygenPosition));
  const straightAngle = angleOf(sub(oxygenPosition, phosphorusPosition));
  return mergeAngles([
    currentAngle,
    ...LINKER_RESCUE_OFFSETS.map(offset => straightAngle + offset)
  ]);
}

function applyTailPose(coords, descriptor, pose) {
  coords.set(descriptor.rootAtomId, pose.root);
  coords.set(descriptor.middleAtomId, pose.middle);
  coords.set(descriptor.terminalAtomId, pose.terminal);
}

function applyLinkerPose(coords, descriptor, targetAngle) {
  const oxygenPosition = coords.get(descriptor.oxygenAtomId);
  const arylPosition = coords.get(descriptor.arylAtomId);
  if (!oxygenPosition || !arylPosition) {
    return;
  }

  const currentAngle = angleOf(sub(arylPosition, oxygenPosition));
  const rotation = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
  if (Math.abs(rotation) <= 1e-12) {
    return;
  }

  for (const atomId of descriptor.subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const offset = sub(position, oxygenPosition);
    const radius = Math.hypot(offset.x, offset.y);
    coords.set(atomId, add(oxygenPosition, fromAngle(angleOf(offset) + rotation, radius)));
  }
}

function areBonded(layoutGraph, firstAtomId, secondAtomId) {
  return findLayoutBond(layoutGraph, firstAtomId, secondAtomId) != null;
}

function minimumActiveTailClearance(layoutGraph, coords, descriptors) {
  const activeAtomIds = new Set(descriptors.flatMap(descriptor => descriptor.atomIds));
  let minimumClearance = Number.POSITIVE_INFINITY;
  for (const atomId of activeAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    const position = coords.get(atomId);
    if (!atom || atom.element === 'H' || atom.visible === false || !position) {
      continue;
    }
    for (const [otherAtomId, otherPosition] of coords) {
      if (atomId === otherAtomId || areBonded(layoutGraph, atomId, otherAtomId)) {
        continue;
      }
      const otherAtom = layoutGraph.atoms.get(otherAtomId);
      if (!otherAtom || otherAtom.element === 'H' || otherAtom.visible === false || !otherPosition) {
        continue;
      }
      const clearance = Math.hypot(position.x - otherPosition.x, position.y - otherPosition.y);
      if (clearance < minimumClearance) {
        minimumClearance = clearance;
      }
    }
  }
  return Number.isFinite(minimumClearance) ? minimumClearance : 0;
}

function scorePhosphatePresentationGeometry(layoutGraph, coords, tailDescriptors, linkerDescriptors) {
  const bendPenalty = tailDescriptors.reduce((sum, descriptor) => sum + tailRootBendPenalty(coords, descriptor), 0);
  const anchorExitPenalty = tailDescriptors.reduce((sum, descriptor) => sum + tailAnchorExitPenalty(layoutGraph, coords, descriptor), 0);
  const linkerAnglePenalty = linkerDescriptors.reduce((sum, descriptor) => sum + phosphateLinkerAnglePenalty(coords, descriptor), 0);
  return {
    bendPenalty,
    anchorExitPenalty,
    linkerAnglePenalty,
    geometryScore:
      bendPenalty * PHOSPHATE_TAIL_ROOT_SCORE_WEIGHT
      + anchorExitPenalty * PHOSPHATE_TAIL_ANCHOR_SCORE_WEIGHT
      + linkerAnglePenalty * PHOSPHATE_LINKER_SCORE_WEIGHT
  };
}

function scorePhosphateTailCoords(layoutGraph, coords, bondLength, tailDescriptors, linkerDescriptors) {
  const audit = auditLayout(layoutGraph, coords, { bondLength });
  const crossingCount = countVisibleHeavyBondCrossings(layoutGraph, coords);
  const geometry = scorePhosphatePresentationGeometry(layoutGraph, coords, tailDescriptors, linkerDescriptors);
  const minimumClearance = minimumActiveTailClearance(layoutGraph, coords, tailDescriptors);
  return {
    audit,
    crossingCount,
    bendPenalty: geometry.bendPenalty,
    anchorExitPenalty: geometry.anchorExitPenalty,
    linkerAnglePenalty: geometry.linkerAnglePenalty,
    minimumClearance,
    score:
      (audit.ok ? 0 : 100000)
      + audit.severeOverlapCount * 20000
      + audit.bondLengthFailureCount * 20000
      + audit.ringSubstituentReadabilityFailureCount * 5000
      + audit.outwardAxisRingSubstituentFailureCount * 5000
      + crossingCount * 5000
      + geometry.geometryScore * 500
      - minimumClearance * 0.001
  };
}

/**
 * Measures phosphate-aryl tail presentation distortion and crossings.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {number} Presentation penalty.
 */
export function measurePhosphateArylTailPresentationPenalty(layoutGraph, coords) {
  const tailDescriptors = collectPhosphateArylTailDescriptors(layoutGraph, coords);
  const linkerDescriptors = collectPhosphateArylLinkerDescriptors(layoutGraph, coords);
  if (tailDescriptors.length === 0 && linkerDescriptors.length === 0) {
    return 0;
  }
  const crossingAtomIds = tailCrossingAtomIds(layoutGraph, coords);
  const tailPenalty = tailDescriptors.reduce((sum, descriptor) => {
    const crossingPenalty = descriptor.atomIds.some(atomId => crossingAtomIds.has(atomId)) ? 1 : 0;
    return sum + tailRootBendPenalty(coords, descriptor) + tailAnchorExitPenalty(layoutGraph, coords, descriptor) + crossingPenalty;
  }, 0);
  const linkerPenalty = linkerDescriptors.reduce((sum, descriptor) => (
    sum + phosphateLinkerAnglePenalty(coords, descriptor)
  ), 0);
  const visibleCrossingPenalty = countVisibleHeavyBondCrossings(layoutGraph, coords) * 100;
  return tailPenalty + linkerPenalty + visibleCrossingPenalty;
}

function selectActiveTailDescriptors(layoutGraph, coords, descriptors) {
  const crossingAtomIds = tailCrossingAtomIds(layoutGraph, coords);
  return descriptors
    .map(descriptor => {
      const bendPenalty = tailRootBendPenalty(coords, descriptor);
      const anchorExitPenalty = tailAnchorExitPenalty(layoutGraph, coords, descriptor);
      const hasCrossing = descriptor.atomIds.some(atomId => crossingAtomIds.has(atomId));
      return {
        descriptor,
        bendPenalty,
        anchorExitPenalty,
        hasCrossing,
        need: bendPenalty + anchorExitPenalty + (hasCrossing ? 1 : 0)
      };
    })
    .filter(({ bendPenalty, anchorExitPenalty, hasCrossing }) => (
      hasCrossing
      || bendPenalty > PHOSPHATE_TAIL_BEND_NEED
      || anchorExitPenalty > PHOSPHATE_TAIL_ANCHOR_EXIT_NEED
    ))
    .sort((first, second) => second.need - first.need)
    .slice(0, MAX_JOINT_TAIL_DESCRIPTORS)
    .map(({ descriptor }) => descriptor);
}

function selectActiveLinkerDescriptors(coords, descriptors) {
  return descriptors
    .map(descriptor => ({
      descriptor,
      need: phosphateLinkerAnglePenalty(coords, descriptor)
    }))
    .filter(({ need }) => need > PHOSPHATE_LINKER_ANGLE_NEED)
    .sort((first, second) => second.need - first.need)
    .slice(0, MAX_JOINT_LINKER_DESCRIPTORS)
    .map(({ descriptor }) => descriptor);
}

function isBetterScoredPhosphateCandidate(candidateScore, bestScore, baseScore) {
  if (baseScore.audit.ok && !candidateScore.audit.ok) {
    return false;
  }
  if (candidateScore.crossingCount !== bestScore.crossingCount) {
    return candidateScore.crossingCount < bestScore.crossingCount;
  }
  return candidateScore.score < bestScore.score - 1e-9;
}

function optimizeTailPresentationCoords(layoutGraph, inputCoords, bondLength, activeTailDescriptors, allTailDescriptors, allLinkerDescriptors, baseScore) {
  if (activeTailDescriptors.length === 0) {
    return {
      coords: inputCoords,
      score: scorePhosphateTailCoords(layoutGraph, inputCoords, bondLength, allTailDescriptors, allLinkerDescriptors)
    };
  }

  const candidatePoseSets = activeTailDescriptors.map(descriptor =>
    descriptorCandidatePoses(layoutGraph, inputCoords, descriptor, bondLength)
  );
  if (candidatePoseSets.some(poses => poses.length === 0)) {
    return {
      coords: inputCoords,
      score: scorePhosphateTailCoords(layoutGraph, inputCoords, bondLength, allTailDescriptors, allLinkerDescriptors)
    };
  }

  let beam = [{
    coords: inputCoords,
    geometryScore: scorePhosphatePresentationGeometry(layoutGraph, inputCoords, allTailDescriptors, allLinkerDescriptors).geometryScore
  }];
  for (let descriptorIndex = 0; descriptorIndex < activeTailDescriptors.length; descriptorIndex++) {
    const descriptor = activeTailDescriptors[descriptorIndex];
    const nextBeam = [];
    for (const beamEntry of beam) {
      for (const pose of candidatePoseSets[descriptorIndex]) {
        const nextCoords = new Map(beamEntry.coords);
        applyTailPose(nextCoords, descriptor, pose);
        nextBeam.push({
          coords: nextCoords,
          geometryScore: scorePhosphatePresentationGeometry(layoutGraph, nextCoords, allTailDescriptors, allLinkerDescriptors).geometryScore
        });
      }
    }
    nextBeam.sort((first, second) => first.geometryScore - second.geometryScore);
    beam = nextBeam.slice(0, TAIL_GEOMETRY_BEAM_WIDTH);
  }

  let bestCoords = inputCoords;
  let bestScore = scorePhosphateTailCoords(layoutGraph, inputCoords, bondLength, allTailDescriptors, allLinkerDescriptors);
  for (const candidate of beam) {
    const candidateScore = scorePhosphateTailCoords(layoutGraph, candidate.coords, bondLength, allTailDescriptors, allLinkerDescriptors);
    if (isBetterScoredPhosphateCandidate(candidateScore, bestScore, baseScore)) {
      bestScore = candidateScore;
      bestCoords = candidate.coords;
    }
  }
  return {
    coords: bestCoords,
    score: bestScore
  };
}

/**
 * Jointly retidies crowded compact alkyl/propargyl tails on phosphate-bound
 * aryl rings and their phosphate ester linkers, preferring straight P-O-C
 * spokes, outward aryl tail exits, and 120-degree tail-root bends while
 * rejecting visible bond crossings.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {{bondLength?: number}} [options] - Cleanup options.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Retidied coordinates and accepted move count.
 */
export function runPhosphateArylTailTidy(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph?.options?.bondLength;
  if (!layoutGraph || !(bondLength > 0)) {
    return { coords: inputCoords, nudges: 0 };
  }

  const tailDescriptors = collectPhosphateArylTailDescriptors(layoutGraph, inputCoords);
  const linkerDescriptors = collectPhosphateArylLinkerDescriptors(layoutGraph, inputCoords);
  if (tailDescriptors.length === 0 && linkerDescriptors.length === 0) {
    return { coords: inputCoords, nudges: 0 };
  }

  const activeTailDescriptors = selectActiveTailDescriptors(layoutGraph, inputCoords, tailDescriptors);
  const activeLinkerDescriptors = selectActiveLinkerDescriptors(inputCoords, linkerDescriptors);
  if (activeTailDescriptors.length === 0 && activeLinkerDescriptors.length === 0) {
    return { coords: inputCoords, nudges: 0 };
  }

  const linkerCandidateSets = activeLinkerDescriptors.map(descriptor => linkerCandidateAngles(inputCoords, descriptor));
  if (linkerCandidateSets.some(angles => angles.length === 0)) {
    return { coords: inputCoords, nudges: 0 };
  }

  const baseScore = scorePhosphateTailCoords(layoutGraph, inputCoords, bondLength, tailDescriptors, linkerDescriptors);
  let bestCoords = inputCoords;
  let bestScore = baseScore;

  const visitLinkers = (descriptorIndex, coords) => {
    if (descriptorIndex >= activeLinkerDescriptors.length) {
      const tailOptimized = optimizeTailPresentationCoords(
        layoutGraph,
        coords,
        bondLength,
        activeTailDescriptors,
        tailDescriptors,
        linkerDescriptors,
        baseScore
      );
      if (isBetterScoredPhosphateCandidate(tailOptimized.score, bestScore, baseScore)) {
        bestScore = tailOptimized.score;
        bestCoords = tailOptimized.coords;
      }
      return;
    }

    const descriptor = activeLinkerDescriptors[descriptorIndex];
    for (const targetAngle of linkerCandidateSets[descriptorIndex]) {
      const nextCoords = new Map(coords);
      applyLinkerPose(nextCoords, descriptor, targetAngle);
      visitLinkers(descriptorIndex + 1, nextCoords);
    }
  };
  visitLinkers(0, new Map(inputCoords));

  if (bestCoords === inputCoords) {
    return { coords: inputCoords, nudges: 0 };
  }
  const movedAtomIds = new Set([
    ...activeTailDescriptors.flatMap(descriptor => descriptor.atomIds),
    ...activeLinkerDescriptors.flatMap(descriptor => descriptor.subtreeAtomIds)
  ]);
  return {
    coords: bestCoords,
    nudges: movedAtomIds.size
  };
}
