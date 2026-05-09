/** @module cleanup/presentation/large-molecule-residual-retouch */

import { auditLayout } from '../../audit/audit.js';
import {
  buildAtomGrid,
  countVisibleHeavyBondCrossings,
  findSevereOverlaps,
  findVisibleHeavyBondCrossings
} from '../../audit/invariants.js';
import { atomPairKey, SEVERE_OVERLAP_FACTOR } from '../../constants.js';
import { rotateAround } from '../../geometry/transforms.js';
import { angleOf, angularDifference, sub, wrapAngle } from '../../geometry/vec2.js';
import {
  isExactVisibleTrigonalBisectorEligible,
  isPlanarDivalentNitrogenContinuationPair
} from '../../placement/branch-placement/angle-selection.js';
import { collectCutSubtree } from '../subtree-utils.js';

const MAX_RETOUCH_PASSES = 8;
const MAX_ANGLE_RETOUCH_PASSES = 40;
const MAX_FINAL_ANGLE_POLISH_PASSES = 12;
const ANGLE_CENTER_SCAN_LIMIT = 10;
const FINAL_ANGLE_POLISH_CENTER_SCAN_LIMIT = 32;
const MAX_SMALL_SUBTREE_ATOMS = 96;
const MAX_SMALL_SUBTREE_HEAVY_ATOMS = 24;
const MAX_SWING_SUBTREE_ATOMS = 640;
const MAX_SWING_SUBTREE_HEAVY_ATOMS = 320;
const LARGE_SWING_OVERLAP_LIMIT = 1;
const LARGE_SWING_MIN_CROSSING_REDUCTION = 2;
const ANGLE_RELIEF_TOTAL_THRESHOLD = 1.8;
const ANGLE_RELIEF_WORST_THRESHOLD = 0.25;
const ANGLE_RELIEF_MIN_TOTAL_IMPROVEMENT = 0.02;
const ANGLE_RELIEF_MIN_WORST_IMPROVEMENT = 0.02;
const ANGLE_RELIEF_REPAIR_PASSES = 1;
const ANGLE_RELIEF_REPAIR_OVERLAP_LIMIT = 4;
const ANGLE_RELIEF_REPAIR_CROSSING_LIMIT = 2;
const ANGLE_RELIEF_REPAIR_MIN_TOTAL_IMPROVEMENT = 0.1;
const ANGLE_RELIEF_REPAIR_MIN_WORST_IMPROVEMENT = 0.12;
const ANGLE_RELIEF_REPAIR_NEARBY_RADIUS = 2;
const ANGLE_CENTER_MAX_DEVIATION_THRESHOLD = 20;
const FINAL_ANGLE_POLISH_MAX_DEVIATION_THRESHOLD = 4;
const FINAL_ANGLE_POLISH_MIN_CENTER_IMPROVEMENT = 0.002;
const FINAL_ANGLE_POLISH_MIN_TOTAL_IMPROVEMENT = 0.003;
const FINAL_ANGLE_POLISH_WORST_TOLERANCE = 0.03;
const ANGLE_CENTER_MIN_SEPARATION_THRESHOLD = 70;
const ANGLE_CENTER_MAX_SEPARATION_THRESHOLD = 160;
const ANGLE_RELIEF_TARGET_OFFSETS = [0, Math.PI / 36, -Math.PI / 36];
const ANGLE_RELIEF_FINE_STEPS = [
  Math.PI / 72,
  -Math.PI / 72,
  Math.PI / 36,
  -Math.PI / 36,
  Math.PI / 24,
  -Math.PI / 24,
  Math.PI / 18,
  -Math.PI / 18
];
const FINAL_ANGLE_POLISH_FINE_STEPS = [Math.PI / 144, -Math.PI / 144];
const RETOUCH_SCORE_EPSILON = 1e-9;
const IDEAL_DIVALENT_CONTINUATION_ELEMENTS = new Set(['C', 'O', 'S', 'Se']);
const ROTATION_STEPS = [
  Math.PI / 12,
  -Math.PI / 12,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 3,
  -Math.PI / 3,
  (5 * Math.PI) / 12,
  (-5 * Math.PI) / 12,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  (-2 * Math.PI) / 3,
  (5 * Math.PI) / 6,
  (-5 * Math.PI) / 6,
  Math.PI
];

function cloneCoords(coords) {
  return new Map([...coords].map(([atomId, position]) => [atomId, { x: position.x, y: position.y }]));
}

function visibleHeavyAtomCount(layoutGraph, atomIds) {
  let count = 0;
  for (const atomId of atomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom?.visible !== false && atom?.element !== 'H') {
      count++;
    }
  }
  return count;
}

function visibleHeavyCovalentBonds(layoutGraph, coords, atomId) {
  const bonds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom?.element !== 'H' && coords.has(neighborAtomId)) {
      bonds.push({ bond, neighborAtomId });
    }
  }
  return bonds;
}

function isVisibleLayoutAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  return !(layoutGraph.options.suppressH && atom.element === 'H');
}

function visibleCovalentBonds(layoutGraph, coords, atomId) {
  const bonds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    if (!coords.has(neighborAtomId) || !isVisibleLayoutAtom(layoutGraph, neighborAtomId)) {
      continue;
    }
    bonds.push({ bond, neighborAtomId });
  }
  return bonds;
}

function findBond(layoutGraph, firstAtomId, secondAtomId) {
  for (const bond of layoutGraph.bondsByAtomId.get(firstAtomId) ?? []) {
    if ((bond.a === firstAtomId && bond.b === secondAtomId) || (bond.a === secondAtomId && bond.b === firstAtomId)) {
      return bond;
    }
  }
  return null;
}

function isTerminalMultipleLeaf(layoutGraph, bond, rootAtomId, subtreeAtomIds) {
  if ((bond.order ?? 1) <= 1 || bond.aromatic) {
    return false;
  }
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element === 'H') {
    return false;
  }
  const rootHeavyDegree = [...(layoutGraph.bondsByAtomId.get(rootAtomId) ?? [])].filter(edge => {
    const neighborAtomId = edge.a === rootAtomId ? edge.b : edge.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return edge.kind === 'covalent' && neighborAtom?.element !== 'H';
  }).length;
  return rootHeavyDegree === 1 && visibleHeavyAtomCount(layoutGraph, subtreeAtomIds) === 1;
}

function collectRotationDescriptor(layoutGraph, coords, rootAtomId, anchorAtomId, currentScore, frozenAtomIds) {
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (
    !rootAtom
    || !anchorAtom
    || rootAtom.element === 'H'
    || !coords.has(rootAtomId)
    || !coords.has(anchorAtomId)
    || frozenAtomIds?.has(rootAtomId)
    || frozenAtomIds?.has(anchorAtomId)
  ) {
    return null;
  }

  const bond = findBond(layoutGraph, rootAtomId, anchorAtomId);
  if (!bond || bond.kind !== 'covalent') {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)].filter(atomId => coords.has(atomId));
  if (
    subtreeAtomIds.length === 0
    || subtreeAtomIds.includes(anchorAtomId)
    || subtreeAtomIds.some(atomId => frozenAtomIds?.has(atomId))
  ) {
    return null;
  }

  const isSingleBond = !bond.aromatic && (bond.order ?? 1) === 1;
  const terminalMultipleLeaf = isTerminalMultipleLeaf(layoutGraph, bond, rootAtomId, subtreeAtomIds);
  if (!isSingleBond && !terminalMultipleLeaf) {
    return null;
  }

  const heavyAtomCount = visibleHeavyAtomCount(layoutGraph, subtreeAtomIds);
  if (heavyAtomCount === 0) {
    return null;
  }
  const smallSubtree =
    subtreeAtomIds.length <= MAX_SMALL_SUBTREE_ATOMS
    && heavyAtomCount <= MAX_SMALL_SUBTREE_HEAVY_ATOMS;
  const largeSwingSubtree =
    isSingleBond
    && currentScore.severeOverlapCount <= LARGE_SWING_OVERLAP_LIMIT
    && subtreeAtomIds.length <= MAX_SWING_SUBTREE_ATOMS
    && heavyAtomCount <= MAX_SWING_SUBTREE_HEAVY_ATOMS;
  if (!smallSubtree && !largeSwingSubtree) {
    return null;
  }

  return {
    rootAtomId,
    anchorAtomId,
    subtreeAtomIds,
    subtreeAtomIdSet: new Set(subtreeAtomIds),
    heavyAtomCount,
    largeSwing: !smallSubtree,
    terminalMultipleLeaf
  };
}

function scoreCoords(layoutGraph, coords, bondLength, trackedAngularContexts = null, visibleAtomIds = null) {
  const overlaps = findSevereOverlaps(layoutGraph, coords, bondLength, { visibleAtomIds });
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const severeOverlapPenalty = overlaps.reduce((penalty, overlap) => {
    const deficit = Math.max(0, threshold - overlap.distance);
    return penalty + deficit * deficit;
  }, 0);
  const minSevereOverlapDistance =
    overlaps.length > 0
      ? overlaps.reduce((minimumDistance, overlap) => Math.min(minimumDistance, overlap.distance), Number.POSITIVE_INFINITY)
      : null;
  const crossings = findVisibleHeavyBondCrossings(layoutGraph, coords);
  const angularDistortion = measureTrackedAngularDistortion(layoutGraph, coords, trackedAngularContexts);
  return {
    severeOverlapCount: overlaps.length,
    severeOverlapPenalty,
    minSevereOverlapDistance,
    visibleHeavyBondCrossingCount: crossings.length,
    overlaps,
    crossings,
    angularDistortionTotal: angularDistortion.totalDeviation,
    angularDistortionWorst: angularDistortion.maxDeviation,
    angularDistortionSecondWorst: angularDistortion.secondMaxDeviation
  };
}

function scoreIsBetter(candidateScore, incumbentScore) {
  if (candidateScore.severeOverlapCount !== incumbentScore.severeOverlapCount) {
    return candidateScore.severeOverlapCount < incumbentScore.severeOverlapCount;
  }
  if (candidateScore.visibleHeavyBondCrossingCount !== incumbentScore.visibleHeavyBondCrossingCount) {
    return candidateScore.visibleHeavyBondCrossingCount < incumbentScore.visibleHeavyBondCrossingCount;
  }
  if (candidateScore.severeOverlapPenalty + RETOUCH_SCORE_EPSILON < incumbentScore.severeOverlapPenalty) {
    return true;
  }
  if (Math.abs(candidateScore.severeOverlapPenalty - incumbentScore.severeOverlapPenalty) <= RETOUCH_SCORE_EPSILON) {
    const candidateDistance = candidateScore.minSevereOverlapDistance ?? Number.POSITIVE_INFINITY;
    const incumbentDistance = incumbentScore.minSevereOverlapDistance ?? Number.POSITIVE_INFINITY;
    return candidateDistance > incumbentDistance + RETOUCH_SCORE_EPSILON;
  }
  return false;
}

function repairScoreIsBetter(candidateScore, incumbentScore) {
  if (scoreIsBetter(candidateScore, incumbentScore)) {
    return true;
  }
  if (
    candidateScore.severeOverlapCount !== incumbentScore.severeOverlapCount
    || candidateScore.visibleHeavyBondCrossingCount !== incumbentScore.visibleHeavyBondCrossingCount
    || Math.abs(candidateScore.severeOverlapPenalty - incumbentScore.severeOverlapPenalty) > RETOUCH_SCORE_EPSILON
  ) {
    return false;
  }

  const candidateDistance = candidateScore.minSevereOverlapDistance ?? Number.POSITIVE_INFINITY;
  const incumbentDistance = incumbentScore.minSevereOverlapDistance ?? Number.POSITIVE_INFINITY;
  if (Math.abs(candidateDistance - incumbentDistance) > RETOUCH_SCORE_EPSILON) {
    return false;
  }

  return angleCandidateIsBetter(candidateScore, incumbentScore);
}

function candidateIsAllowed(descriptor, candidateScore, currentScore) {
  if (!scoreIsBetter(candidateScore, currentScore)) {
    return false;
  }
  if (
    candidateScore.severeOverlapCount === currentScore.severeOverlapCount
    && candidateScore.visibleHeavyBondCrossingCount < currentScore.visibleHeavyBondCrossingCount
    && candidateScore.severeOverlapPenalty > currentScore.severeOverlapPenalty + RETOUCH_SCORE_EPSILON
  ) {
    return false;
  }
  if (!descriptor.largeSwing) {
    return true;
  }
  return (
    candidateScore.severeOverlapCount <= currentScore.severeOverlapCount
    && candidateScore.severeOverlapPenalty <= currentScore.severeOverlapPenalty + RETOUCH_SCORE_EPSILON
    && currentScore.visibleHeavyBondCrossingCount - candidateScore.visibleHeavyBondCrossingCount >= LARGE_SWING_MIN_CROSSING_REDUCTION
  );
}

function shouldRunAngleRelief(score) {
  return (
    score.severeOverlapCount === 0
    && score.visibleHeavyBondCrossingCount <= ANGLE_RELIEF_REPAIR_CROSSING_LIMIT
    && (
      score.angularDistortionTotal > ANGLE_RELIEF_TOTAL_THRESHOLD
      || score.angularDistortionWorst > ANGLE_RELIEF_WORST_THRESHOLD
    )
  );
}

function angleCandidateIsBetter(candidateScore, incumbentScore) {
  if (candidateScore.severeOverlapCount !== 0 || candidateScore.visibleHeavyBondCrossingCount !== 0) {
    return false;
  }
  if (
    candidateScore.angularDistortionWorst + ANGLE_RELIEF_MIN_WORST_IMPROVEMENT < incumbentScore.angularDistortionWorst
    && candidateScore.angularDistortionTotal <= incumbentScore.angularDistortionTotal + ANGLE_RELIEF_MIN_TOTAL_IMPROVEMENT
  ) {
    return true;
  }
  if (
    candidateScore.angularDistortionWorst <= incumbentScore.angularDistortionWorst + RETOUCH_SCORE_EPSILON
    && candidateScore.angularDistortionTotal + ANGLE_RELIEF_MIN_TOTAL_IMPROVEMENT < incumbentScore.angularDistortionTotal
  ) {
    return true;
  }
  return false;
}

function angleCandidateIsWorthRepair(candidateScore, incumbentScore) {
  if (
    candidateScore.severeOverlapCount > ANGLE_RELIEF_REPAIR_OVERLAP_LIMIT
    || candidateScore.visibleHeavyBondCrossingCount > ANGLE_RELIEF_REPAIR_CROSSING_LIMIT
  ) {
    return false;
  }
  if (candidateScore.angularDistortionWorst + ANGLE_RELIEF_REPAIR_MIN_WORST_IMPROVEMENT < incumbentScore.angularDistortionWorst) {
    return true;
  }
  return candidateScore.angularDistortionTotal + ANGLE_RELIEF_REPAIR_MIN_TOTAL_IMPROVEMENT < incumbentScore.angularDistortionTotal;
}

function angleCenterDistortion(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || !coords.has(atomId)) {
    return null;
  }
  const covalentBonds = visibleHeavyCovalentBonds(layoutGraph, coords, atomId);
  if (covalentBonds.length < 2 || covalentBonds.length > 4) {
    return null;
  }
  const centerPosition = coords.get(atomId);
  const idealSeparation =
    covalentBonds.length === 4
      ? Math.PI / 2
      : covalentBonds.length === 2 && covalentBonds.some(({ bond }) => (bond.order ?? 1) >= 3)
        ? Math.PI
        : (2 * Math.PI) / 3;
  let maxDeviation = 0;
  let minimumSeparation = Number.POSITIVE_INFINITY;
  let maximumSeparation = 0;

  for (let firstIndex = 0; firstIndex < covalentBonds.length; firstIndex++) {
    const firstPosition = coords.get(covalentBonds[firstIndex].neighborAtomId);
    if (!firstPosition) {
      return null;
    }
    const firstAngle = angleOf(sub(firstPosition, centerPosition));
    for (let secondIndex = firstIndex + 1; secondIndex < covalentBonds.length; secondIndex++) {
      const secondPosition = coords.get(covalentBonds[secondIndex].neighborAtomId);
      if (!secondPosition) {
        return null;
      }
      const separation = angularDifference(firstAngle, angleOf(sub(secondPosition, centerPosition)));
      minimumSeparation = Math.min(minimumSeparation, separation);
      maximumSeparation = Math.max(maximumSeparation, separation);
      maxDeviation = Math.max(maxDeviation, Math.abs(separation - idealSeparation));
    }
  }

  const maxDeviationDegrees = (maxDeviation * 180) / Math.PI;
  const minimumSeparationDegrees = (minimumSeparation * 180) / Math.PI;
  const maximumSeparationDegrees = (maximumSeparation * 180) / Math.PI;
  if (
    maxDeviationDegrees <= ANGLE_CENTER_MAX_DEVIATION_THRESHOLD
    && minimumSeparationDegrees >= ANGLE_CENTER_MIN_SEPARATION_THRESHOLD
    && maximumSeparationDegrees <= ANGLE_CENTER_MAX_SEPARATION_THRESHOLD
  ) {
    return null;
  }

  return {
    atomId,
    covalentBonds,
    maxDeviationDegrees,
    minimumSeparationDegrees,
    maximumSeparationDegrees
  };
}

function measureLocalAngleDeviation(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || !coords.has(atomId)) {
    return null;
  }
  const covalentBonds = visibleHeavyCovalentBonds(layoutGraph, coords, atomId);
  if (covalentBonds.length < 2 || covalentBonds.length > 4) {
    return null;
  }
  const centerPosition = coords.get(atomId);
  const idealSeparation = idealSeparationForCovalentBonds(covalentBonds);
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (let firstIndex = 0; firstIndex < covalentBonds.length; firstIndex++) {
    const firstPosition = coords.get(covalentBonds[firstIndex].neighborAtomId);
    if (!firstPosition) {
      return null;
    }
    const firstAngle = angleOf(sub(firstPosition, centerPosition));
    for (let secondIndex = firstIndex + 1; secondIndex < covalentBonds.length; secondIndex++) {
      const secondPosition = coords.get(covalentBonds[secondIndex].neighborAtomId);
      if (!secondPosition) {
        return null;
      }
      const separation = angularDifference(firstAngle, angleOf(sub(secondPosition, centerPosition)));
      const deviation = Math.abs(separation - idealSeparation);
      totalDeviation += deviation * deviation;
      maxDeviation = Math.max(maxDeviation, deviation);
    }
  }

  return {
    atomId,
    covalentBonds,
    totalDeviation,
    maxDeviationDegrees: (maxDeviation * 180) / Math.PI
  };
}

function localAngleCandidateCanImprove(candidateDistortion, currentDistortion, minTotalImprovement, minWorstImprovement) {
  return (
    candidateDistortion.maxDeviation + minWorstImprovement < currentDistortion.maxDeviation
    || candidateDistortion.totalDeviation + minTotalImprovement < currentDistortion.totalDeviation
  );
}

function sortedAngularSeparations(angles) {
  const sortedAngles = [...angles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  const separations = [];
  for (let index = 0; index < sortedAngles.length; index++) {
    const currentAngle = sortedAngles[index];
    const nextAngle = sortedAngles[(index + 1) % sortedAngles.length];
    const rawSeparation = nextAngle - currentAngle;
    separations.push(rawSeparation > 0 ? rawSeparation : rawSeparation + Math.PI * 2);
  }
  return separations;
}

function measureThreeCoordinateDeviationAtAtom(coords, covalentBonds, atomId) {
  const atomPosition = coords.get(atomId);
  if (!atomPosition) {
    return 0;
  }
  const neighborAngles = covalentBonds.map(({ neighborAtomId }) => {
    const neighborPosition = coords.get(neighborAtomId);
    return Math.atan2(neighborPosition.y - atomPosition.y, neighborPosition.x - atomPosition.x);
  });
  const idealSeparation = (Math.PI * 2) / 3;
  return sortedAngularSeparations(neighborAngles).reduce(
    (sum, separation) => sum + (separation - idealSeparation) ** 2,
    0
  );
}

function shouldMeasureTrigonalDistortionAtAtom(layoutGraph, atomId, covalentBonds) {
  if (covalentBonds.length !== 3) {
    return false;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.aromatic) {
    return false;
  }
  const multipleBondCount = covalentBonds.filter(({ bond }) => (bond.order ?? 1) >= 2).length;
  if (multipleBondCount === 1) {
    return true;
  }
  return covalentBonds.some(({ bond, neighborAtomId }) => (
    !bond.aromatic
    && (bond.order ?? 1) === 1
    && isExactVisibleTrigonalBisectorEligible(layoutGraph, atomId, neighborAtomId)
  ));
}

function shouldMeasureDivalentContinuationDistortionAtAtom(layoutGraph, atomId, covalentBonds) {
  if (covalentBonds.length !== 2) {
    return false;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.aromatic || (layoutGraph.atomToRings?.get(atomId)?.length ?? 0) > 0) {
    return false;
  }
  const isExactDivalentElement =
    IDEAL_DIVALENT_CONTINUATION_ELEMENTS.has(atom.element)
    || (atom.element === 'N' && isPlanarDivalentNitrogenContinuationPair(
      layoutGraph,
      covalentBonds[0]?.neighborAtomId,
      covalentBonds[1]?.neighborAtomId
    ));
  if (!isExactDivalentElement) {
    return false;
  }
  const allBondsVisibleNonAromaticHeavy = covalentBonds.every(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom && neighborAtom.element !== 'H' && !bond.aromatic;
  });
  if (!allBondsVisibleNonAromaticHeavy) {
    return false;
  }
  if (covalentBonds.every(({ bond }) => (bond.order ?? 1) === 1)) {
    return true;
  }
  if (atom.element !== 'N') {
    return false;
  }
  const singleBondCount = covalentBonds.filter(({ bond }) => (bond.order ?? 1) === 1).length;
  const multipleBondCount = covalentBonds.filter(({ bond }) => (bond.order ?? 1) >= 2).length;
  return singleBondCount === 1 && multipleBondCount === 1;
}

function shouldMeasureThreeHeavyContinuationDistortionAtAtom(layoutGraph, atomId, covalentBonds) {
  if (covalentBonds.length !== 3) {
    return false;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.aromatic || atom.element !== 'C') {
    return false;
  }
  const multipleBondCount = covalentBonds.filter(({ bond }) => (bond.order ?? 1) >= 2).length;
  if (multipleBondCount !== 0 || layoutGraph.options.suppressH !== true) {
    return false;
  }
  const incidentRings = layoutGraph.atomToRings?.get(atomId) ?? [];
  if (incidentRings.length > 0) {
    const hasSupportedRingContext = incidentRings.some(ring => {
      if ((ring.atomIds?.length ?? 0) < 5) {
        return false;
      }
      const ringNeighborCount = covalentBonds.filter(({ neighborAtomId }) => ring.atomIds.includes(neighborAtomId)).length;
      return ringNeighborCount === 2;
    });
    if (!hasSupportedRingContext || atom.degree !== 4 || atom.heavyDegree !== 3) {
      return false;
    }
  }
  return covalentBonds.every(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom && neighborAtom.element !== 'H' && !bond.aromatic && (bond.order ?? 1) === 1;
  });
}

function buildTrackedAngularContexts(layoutGraph, coords) {
  const contexts = new Map();
  for (const atomId of coords.keys()) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId);
    const measureTrigonal = shouldMeasureTrigonalDistortionAtAtom(layoutGraph, atomId, covalentBonds);
    const measureDivalent = shouldMeasureDivalentContinuationDistortionAtAtom(layoutGraph, atomId, covalentBonds);
    const measureThreeHeavy = shouldMeasureThreeHeavyContinuationDistortionAtAtom(layoutGraph, atomId, covalentBonds);
    if (measureTrigonal || measureDivalent || measureThreeHeavy) {
      contexts.set(atomId, {
        covalentBonds,
        measureTrigonal,
        measureDivalent,
        measureThreeHeavy
      });
    }
  }
  return contexts;
}

function collectVisibleAtomIds(layoutGraph, coords) {
  const atomIds = [];
  for (const atomId of coords.keys()) {
    if (isVisibleLayoutAtom(layoutGraph, atomId)) {
      atomIds.push(atomId);
    }
  }
  return atomIds;
}

function measureTrackedAngularDistortionAtAtom(layoutGraph, coords, atomId, trackedAngularContexts = null) {
  const context = trackedAngularContexts?.get(atomId) ?? null;
  if (trackedAngularContexts && !context) {
    return { totalDeviation: 0, maxDeviation: 0 };
  }
  if (!context && (!isVisibleLayoutAtom(layoutGraph, atomId) || !coords.has(atomId))) {
    return { totalDeviation: 0, maxDeviation: 0 };
  }
  const covalentBonds = context?.covalentBonds ?? visibleCovalentBonds(layoutGraph, coords, atomId);
  let totalDeviation = 0;
  let maxDeviation = 0;

  if (context?.measureTrigonal ?? shouldMeasureTrigonalDistortionAtAtom(layoutGraph, atomId, covalentBonds)) {
    const deviation = measureThreeCoordinateDeviationAtAtom(coords, covalentBonds, atomId);
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  if (context?.measureDivalent ?? shouldMeasureDivalentContinuationDistortionAtAtom(layoutGraph, atomId, covalentBonds)) {
    const atomPosition = coords.get(atomId);
    const firstNeighborPosition = coords.get(covalentBonds[0].neighborAtomId);
    const secondNeighborPosition = coords.get(covalentBonds[1].neighborAtomId);
    if (atomPosition && firstNeighborPosition && secondNeighborPosition) {
      const idealSeparation = (2 * Math.PI) / 3;
      const bondAngle = angularDifference(
        angleOf(sub(firstNeighborPosition, atomPosition)),
        angleOf(sub(secondNeighborPosition, atomPosition))
      );
      const deviation = (bondAngle - idealSeparation) ** 2;
      totalDeviation += deviation;
      maxDeviation = Math.max(maxDeviation, deviation);
    }
  }

  if (context?.measureThreeHeavy ?? shouldMeasureThreeHeavyContinuationDistortionAtAtom(layoutGraph, atomId, covalentBonds)) {
    const deviation = measureThreeCoordinateDeviationAtAtom(coords, covalentBonds, atomId);
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return { totalDeviation, maxDeviation };
}

function measureTrackedAngularDistortion(layoutGraph, coords, trackedAngularContexts = null) {
  let totalDeviation = 0;
  let maxDeviation = 0;
  let secondMaxDeviation = 0;

  const atomIds = trackedAngularContexts ? trackedAngularContexts.keys() : coords.keys();
  for (const atomId of atomIds) {
    const distortion = measureTrackedAngularDistortionAtAtom(layoutGraph, coords, atomId, trackedAngularContexts);
    totalDeviation += distortion.totalDeviation;
    if (distortion.maxDeviation > maxDeviation) {
      secondMaxDeviation = maxDeviation;
      maxDeviation = distortion.maxDeviation;
    } else if (distortion.maxDeviation > secondMaxDeviation) {
      secondMaxDeviation = distortion.maxDeviation;
    }
  }

  return {
    totalDeviation,
    maxDeviation,
    secondMaxDeviation
  };
}

function crossingTouchesDescriptor(crossing, descriptor) {
  return [...crossing.firstAtomIds, ...crossing.secondAtomIds].some(atomId => descriptor.subtreeAtomIdSet.has(atomId));
}

function descriptorCanResolveCurrentCrossings(currentScore, descriptor) {
  return currentScore.crossings.every(crossing => crossingTouchesDescriptor(crossing, descriptor));
}

function localSevereOverlapsForDescriptor(layoutGraph, coords, descriptor, bondLength, atomGrid) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const overlaps = [];
  const seenPairs = new Set();

  for (const atomId of descriptor.subtreeAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    const atomPosition = coords.get(atomId);
    if (!atomPosition || atom?.element === 'H') {
      continue;
    }
    for (const otherAtomId of atomGrid.queryRadius(atomPosition, threshold)) {
      if (descriptor.subtreeAtomIdSet.has(otherAtomId)) {
        continue;
      }
      const otherAtom = layoutGraph.atoms.get(otherAtomId);
      const otherPosition = coords.get(otherAtomId);
      if (!otherPosition || otherAtom?.element === 'H') {
        continue;
      }
      const pairKey = atomPairKey(atomId, otherAtomId);
      if (seenPairs.has(pairKey) || layoutGraph.bondedPairSet.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
      const atomDistance = Math.hypot(otherPosition.x - atomPosition.x, otherPosition.y - atomPosition.y);
      if (atomDistance < threshold) {
        overlaps.push({ firstAtomId: atomId, secondAtomId: otherAtomId, distance: atomDistance });
      }
    }
  }

  return overlaps;
}

function localCandidateHasNoResiduals(layoutGraph, coords, descriptor, currentScore, bondLength, atomGrid) {
  if (!descriptorCanResolveCurrentCrossings(currentScore, descriptor)) {
    return false;
  }
  if (localSevereOverlapsForDescriptor(layoutGraph, coords, descriptor, bondLength, atomGrid).length > 0) {
    return false;
  }
  return countVisibleHeavyBondCrossings(layoutGraph, coords, { focusAtomIds: descriptor.subtreeAtomIdSet }) === 0;
}

function buildCleanAngularCandidateScore(currentScore, currentLocalDistortion, candidateLocalDistortion) {
  const anchorIsCurrentWorst = currentLocalDistortion.maxDeviation >= currentScore.angularDistortionWorst - RETOUCH_SCORE_EPSILON;
  return {
    severeOverlapCount: 0,
    severeOverlapPenalty: 0,
    minSevereOverlapDistance: null,
    visibleHeavyBondCrossingCount: 0,
    overlaps: [],
    crossings: [],
    angularDistortionTotal:
      currentScore.angularDistortionTotal
      - currentLocalDistortion.totalDeviation
      + candidateLocalDistortion.totalDeviation,
    angularDistortionWorst: anchorIsCurrentWorst
      ? Math.max(currentScore.angularDistortionSecondWorst ?? 0, candidateLocalDistortion.maxDeviation)
      : Math.max(currentScore.angularDistortionWorst, candidateLocalDistortion.maxDeviation),
    angularDistortionSecondWorst: currentScore.angularDistortionSecondWorst ?? 0
  };
}

function idealSeparationForCovalentBonds(covalentBonds) {
  if (covalentBonds.length === 4) {
    return Math.PI / 2;
  }
  if (covalentBonds.length === 2 && covalentBonds.some(({ bond }) => (bond.order ?? 1) >= 3)) {
    return Math.PI;
  }
  return (2 * Math.PI) / 3;
}

function pushWrappedAngleStep(steps, seenSteps, step) {
  const wrappedStep = wrapAngle(step);
  if (Math.abs(wrappedStep) <= 1e-8) {
    return;
  }
  const key = wrappedStep.toFixed(8);
  if (seenSteps.has(key)) {
    return;
  }
  seenSteps.add(key);
  steps.push(wrappedStep);
}

function candidateAngleReliefSteps(layoutGraph, coords, descriptor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return [];
  }

  const covalentBonds = visibleHeavyCovalentBonds(layoutGraph, coords, descriptor.anchorAtomId);
  if (covalentBonds.length < 2 || covalentBonds.length > 4) {
    return [];
  }
  const rootBondIndex = covalentBonds.findIndex(({ neighborAtomId }) => neighborAtomId === descriptor.rootAtomId);
  if (rootBondIndex === -1) {
    return [];
  }

  const currentRootAngle = angleOf(sub(rootPosition, anchorPosition));
  const otherAngles = covalentBonds
    .filter(({ neighborAtomId }) => neighborAtomId !== descriptor.rootAtomId)
    .map(({ neighborAtomId }) => {
      const neighborPosition = coords.get(neighborAtomId);
      return neighborPosition ? angleOf(sub(neighborPosition, anchorPosition)) : null;
    })
    .filter(angle => angle != null);
  if (otherAngles.length !== covalentBonds.length - 1) {
    return [];
  }

  const idealSeparation = idealSeparationForCovalentBonds(covalentBonds);
  const targetAngles = [];
  for (const otherAngle of otherAngles) {
    targetAngles.push(otherAngle + idealSeparation, otherAngle - idealSeparation);
  }

  if (covalentBonds.length === 3 && otherAngles.length === 2) {
    const signedOtherSeparation = wrapAngle(otherAngles[1] - otherAngles[0]);
    targetAngles.push(otherAngles[0] + signedOtherSeparation / 2 + Math.PI);
  }

  const steps = [];
  const seenSteps = new Set();
  for (const targetAngle of targetAngles) {
    const exactStep = wrapAngle(targetAngle - currentRootAngle);
    for (const offset of ANGLE_RELIEF_TARGET_OFFSETS) {
      pushWrappedAngleStep(steps, seenSteps, exactStep + offset);
    }
  }
  return steps;
}

function candidateAnglesForDescriptor(layoutGraph, coords, descriptor, angleRelief = false) {
  const angles = angleRelief ? [] : [...ROTATION_STEPS];
  if (!angleRelief) {
    return angles;
  }
  const seenAngles = new Set(angles.map(angle => wrapAngle(angle).toFixed(8)));
  for (const angle of ANGLE_RELIEF_FINE_STEPS) {
    const key = wrapAngle(angle).toFixed(8);
    if (!seenAngles.has(key)) {
      seenAngles.add(key);
      angles.push(angle);
    }
  }
  for (const angle of candidateAngleReliefSteps(layoutGraph, coords, descriptor)) {
    const key = wrapAngle(angle).toFixed(8);
    if (!seenAngles.has(key)) {
      seenAngles.add(key);
      angles.push(angle);
    }
  }
  return angles;
}

function candidateFinalAnglePolishSteps(layoutGraph, coords, descriptor) {
  const angles = [];
  const seenAngles = new Set();
  for (const angle of FINAL_ANGLE_POLISH_FINE_STEPS) {
    const key = wrapAngle(angle).toFixed(8);
    if (!seenAngles.has(key)) {
      seenAngles.add(key);
      angles.push(angle);
    }
  }
  for (const angle of candidateAnglesForDescriptor(layoutGraph, coords, descriptor, true)) {
    const key = wrapAngle(angle).toFixed(8);
    if (!seenAngles.has(key)) {
      seenAngles.add(key);
      angles.push(angle);
    }
  }
  return angles;
}

function rotateSubtree(coords, descriptor, angle) {
  const nextCoords = cloneCoords(coords);
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return nextCoords;
  }
  for (const atomId of descriptor.subtreeAtomIds) {
    const position = coords.get(atomId);
    if (position) {
      nextCoords.set(atomId, rotateAround(position, anchorPosition, angle));
    }
  }
  return nextCoords;
}

function withRotatedSubtree(layoutGraph, coords, descriptor, angle, callback) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return callback(coords);
  }

  const originalPositions = [];
  for (const atomId of descriptor.subtreeAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const nextPosition = rotateAround(position, anchorPosition, angle);
    originalPositions.push([atomId, position]);
    coords.set(atomId, nextPosition);
  }

  try {
    return callback(coords);
  } finally {
    for (const [atomId, position] of originalPositions) {
      coords.set(atomId, position);
    }
  }
}

function addDescriptorForEndpoint(layoutGraph, coords, descriptors, seenDescriptors, atomId, currentScore, frozenAtomIds) {
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const anchorAtomId = bond.a === atomId ? bond.b : bond.a;
    const key = `${atomId}:${anchorAtomId}`;
    if (seenDescriptors.has(key)) {
      continue;
    }
    seenDescriptors.add(key);
    const descriptor = collectRotationDescriptor(layoutGraph, coords, atomId, anchorAtomId, currentScore, frozenAtomIds);
    if (descriptor) {
      descriptors.push(descriptor);
    }
  }
}

function addDescriptor(layoutGraph, coords, descriptors, seenDescriptors, rootAtomId, anchorAtomId, currentScore, frozenAtomIds) {
  const key = `${rootAtomId}:${anchorAtomId}`;
  if (seenDescriptors.has(key)) {
    return;
  }
  seenDescriptors.add(key);
  const descriptor = collectRotationDescriptor(layoutGraph, coords, rootAtomId, anchorAtomId, currentScore, frozenAtomIds);
  if (descriptor) {
    descriptors.push(descriptor);
  }
}

function addDescriptorContainingEndpoint(
  layoutGraph,
  coords,
  descriptors,
  seenDescriptors,
  rootAtomId,
  anchorAtomId,
  endpointAtomId,
  currentScore,
  frozenAtomIds
) {
  const key = `${rootAtomId}:${anchorAtomId}`;
  if (seenDescriptors.has(key)) {
    return;
  }
  seenDescriptors.add(key);
  const descriptor = collectRotationDescriptor(layoutGraph, coords, rootAtomId, anchorAtomId, currentScore, frozenAtomIds);
  if (descriptor?.subtreeAtomIds.includes(endpointAtomId)) {
    descriptors.push(descriptor);
  }
}

function addNearbyContainingEndpointDescriptors(
  layoutGraph,
  coords,
  descriptors,
  seenDescriptors,
  endpointAtomId,
  currentScore,
  frozenAtomIds
) {
  const endpointAtom = layoutGraph.atoms.get(endpointAtomId);
  if (!endpointAtom || endpointAtom.element === 'H' || !coords.has(endpointAtomId)) {
    return;
  }

  const visitedAtomIds = new Set([endpointAtomId]);
  const queue = [{ atomId: endpointAtomId, depth: 0 }];
  while (queue.length > 0) {
    const { atomId, depth } = queue.shift();
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (neighborAtom?.element === 'H' || !coords.has(neighborAtomId)) {
        continue;
      }
      addDescriptorContainingEndpoint(
        layoutGraph,
        coords,
        descriptors,
        seenDescriptors,
        atomId,
        neighborAtomId,
        endpointAtomId,
        currentScore,
        frozenAtomIds
      );
      addDescriptorContainingEndpoint(
        layoutGraph,
        coords,
        descriptors,
        seenDescriptors,
        neighborAtomId,
        atomId,
        endpointAtomId,
        currentScore,
        frozenAtomIds
      );
      if (depth < ANGLE_RELIEF_REPAIR_NEARBY_RADIUS && !visitedAtomIds.has(neighborAtomId)) {
        visitedAtomIds.add(neighborAtomId);
        queue.push({ atomId: neighborAtomId, depth: depth + 1 });
      }
    }
  }
}

function collectCandidateDescriptors(layoutGraph, coords, currentScore, frozenAtomIds, options = {}) {
  const descriptors = [];
  const seenDescriptors = new Set();
  const sortedOverlaps = [...currentScore.overlaps].sort((first, second) => first.distance - second.distance);
  for (const overlap of sortedOverlaps) {
    addDescriptorForEndpoint(layoutGraph, coords, descriptors, seenDescriptors, overlap.firstAtomId, currentScore, frozenAtomIds);
    addDescriptorForEndpoint(layoutGraph, coords, descriptors, seenDescriptors, overlap.secondAtomId, currentScore, frozenAtomIds);
    if (options.includeNearbyContainingEndpointDescriptors) {
      addNearbyContainingEndpointDescriptors(
        layoutGraph,
        coords,
        descriptors,
        seenDescriptors,
        overlap.firstAtomId,
        currentScore,
        frozenAtomIds
      );
      addNearbyContainingEndpointDescriptors(
        layoutGraph,
        coords,
        descriptors,
        seenDescriptors,
        overlap.secondAtomId,
        currentScore,
        frozenAtomIds
      );
    }
  }

  for (const crossing of currentScore.crossings) {
    for (const atomId of [...crossing.firstAtomIds, ...crossing.secondAtomIds]) {
      addDescriptorForEndpoint(layoutGraph, coords, descriptors, seenDescriptors, atomId, currentScore, frozenAtomIds);
      if (options.includeNearbyContainingEndpointDescriptors) {
        addNearbyContainingEndpointDescriptors(
          layoutGraph,
          coords,
          descriptors,
          seenDescriptors,
          atomId,
          currentScore,
          frozenAtomIds
        );
      }
    }
  }

  return descriptors;
}

function collectAngleCandidateDescriptors(layoutGraph, coords, currentScore, frozenAtomIds) {
  const descriptors = [];
  const seenDescriptors = new Set();
  const centers = [];
  for (const atomId of coords.keys()) {
    const center = angleCenterDistortion(layoutGraph, coords, atomId);
    if (center) {
      centers.push(center);
    }
  }
  centers.sort((first, second) => second.maxDeviationDegrees - first.maxDeviationDegrees);

  for (const center of centers.slice(0, ANGLE_CENTER_SCAN_LIMIT)) {
    const centerInRing = (layoutGraph.atomToRings.get(center.atomId)?.length ?? 0) > 0;
    for (const { neighborAtomId } of center.covalentBonds) {
      const neighborInRing = (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0;
      if (!neighborInRing || !centerInRing) {
        addDescriptor(layoutGraph, coords, descriptors, seenDescriptors, neighborAtomId, center.atomId, currentScore, frozenAtomIds);
      }
    }
  }

  return descriptors;
}

function collectFinalAnglePolishEntries(layoutGraph, coords, currentScore, frozenAtomIds) {
  const entries = [];
  const seenEntries = new Set();
  const centers = [];
  for (const atomId of coords.keys()) {
    const center = measureLocalAngleDeviation(layoutGraph, coords, atomId);
    if (
      center
      && center.totalDeviation > 0
      && center.maxDeviationDegrees > FINAL_ANGLE_POLISH_MAX_DEVIATION_THRESHOLD
    ) {
      centers.push(center);
    }
  }
  centers.sort((first, second) => second.totalDeviation - first.totalDeviation);

  for (const center of centers.slice(0, FINAL_ANGLE_POLISH_CENTER_SCAN_LIMIT)) {
    const centerInRing = (layoutGraph.atomToRings.get(center.atomId)?.length ?? 0) > 0;
    for (const { neighborAtomId } of center.covalentBonds) {
      const neighborInRing = (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0;
      if (neighborInRing && centerInRing) {
        continue;
      }
      const key = `${center.atomId}:${neighborAtomId}`;
      if (seenEntries.has(key)) {
        continue;
      }
      seenEntries.add(key);
      const descriptor = collectRotationDescriptor(
        layoutGraph,
        coords,
        neighborAtomId,
        center.atomId,
        currentScore,
        frozenAtomIds
      );
      if (descriptor) {
        entries.push({
          centerAtomId: center.atomId,
          centerScore: center.totalDeviation,
          descriptor
        });
      }
    }
  }

  return entries;
}

function repairCandidateResiduals(
  layoutGraph,
  inputCoords,
  inputScore,
  bondLength,
  frozenAtomIds,
  trackedAngularContexts,
  visibleAtomIds,
  options = {}
) {
  let coords = inputCoords;
  let currentScore = inputScore;
  const movedAtomIds = new Set();
  let passes = 0;

  while (
    passes < ANGLE_RELIEF_REPAIR_PASSES
    && (currentScore.severeOverlapCount > 0 || currentScore.visibleHeavyBondCrossingCount > 0)
  ) {
    const descriptors = collectCandidateDescriptors(layoutGraph, coords, currentScore, frozenAtomIds, {
      includeNearbyContainingEndpointDescriptors: options.includeNearbyContainingEndpointDescriptors === true
    });
    let bestCandidate = null;

    for (const descriptor of descriptors) {
      for (const angle of candidateAnglesForDescriptor(layoutGraph, coords, descriptor)) {
        const candidateScore = withRotatedSubtree(
          layoutGraph,
          coords,
          descriptor,
          angle,
          candidateCoords => scoreCoords(layoutGraph, candidateCoords, bondLength, trackedAngularContexts, visibleAtomIds)
        );
        if (!candidateIsAllowed(descriptor, candidateScore, currentScore)) {
          continue;
        }
        if (!bestCandidate || repairScoreIsBetter(candidateScore, bestCandidate.score)) {
          bestCandidate = {
            coords: rotateSubtree(coords, descriptor, angle),
            score: candidateScore,
            descriptor
          };
        }
      }
    }

    if (!bestCandidate) {
      break;
    }

    coords = bestCandidate.coords;
    currentScore = bestCandidate.score;
    for (const atomId of bestCandidate.descriptor.subtreeAtomIds) {
      movedAtomIds.add(atomId);
    }
    passes++;
  }

  return {
    coords,
    score: currentScore,
    movedAtomIds
  };
}

function finalAnglePolishCandidateIsBetter(candidateScore, currentScore) {
  if (candidateScore.severeOverlapCount !== 0 || candidateScore.visibleHeavyBondCrossingCount !== 0) {
    return false;
  }
  return (
    candidateScore.angularDistortionTotal + FINAL_ANGLE_POLISH_MIN_TOTAL_IMPROVEMENT < currentScore.angularDistortionTotal
    && candidateScore.angularDistortionWorst <= currentScore.angularDistortionWorst + FINAL_ANGLE_POLISH_WORST_TOLERANCE
  );
}

function finalAnglePolishSelectionIsBetter(candidate, incumbent) {
  if (candidate.centerImprovement > incumbent.centerImprovement + RETOUCH_SCORE_EPSILON) {
    return true;
  }
  if (incumbent.centerImprovement > candidate.centerImprovement + RETOUCH_SCORE_EPSILON) {
    return false;
  }
  if (candidate.score.angularDistortionWorst + RETOUCH_SCORE_EPSILON < incumbent.score.angularDistortionWorst) {
    return true;
  }
  if (incumbent.score.angularDistortionWorst + RETOUCH_SCORE_EPSILON < candidate.score.angularDistortionWorst) {
    return false;
  }
  return candidate.score.angularDistortionTotal + RETOUCH_SCORE_EPSILON < incumbent.score.angularDistortionTotal;
}

function runFinalAnglePolish(
  layoutGraph,
  inputCoords,
  inputScore,
  bondLength,
  frozenAtomIds,
  trackedAngularContexts,
  visibleAtomIds
) {
  let coords = inputCoords;
  let currentScore = inputScore;
  const movedAtomIds = new Set();
  let passes = 0;

  while (
    passes < MAX_FINAL_ANGLE_POLISH_PASSES
    && currentScore.severeOverlapCount === 0
    && currentScore.visibleHeavyBondCrossingCount === 0
  ) {
    const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength, { visibleAtomIds });
    const entries = collectFinalAnglePolishEntries(layoutGraph, coords, currentScore, frozenAtomIds);
    let bestCandidate = null;

    for (const entry of entries) {
      const currentTrackedLocalDistortion = measureTrackedAngularDistortionAtAtom(
        layoutGraph,
        coords,
        entry.descriptor.anchorAtomId,
        trackedAngularContexts
      );
      for (const angle of candidateFinalAnglePolishSteps(layoutGraph, coords, entry.descriptor)) {
        const candidate = withRotatedSubtree(layoutGraph, coords, entry.descriptor, angle, candidateCoords => {
          const candidateCenterScore = measureLocalAngleDeviation(layoutGraph, candidateCoords, entry.centerAtomId);
          if (
            !candidateCenterScore
            || candidateCenterScore.totalDeviation + FINAL_ANGLE_POLISH_MIN_CENTER_IMPROVEMENT >= entry.centerScore
          ) {
            return null;
          }

          const candidateTrackedLocalDistortion = measureTrackedAngularDistortionAtAtom(
            layoutGraph,
            candidateCoords,
            entry.descriptor.anchorAtomId,
            trackedAngularContexts
          );
          const candidateScore = buildCleanAngularCandidateScore(
            currentScore,
            currentTrackedLocalDistortion,
            candidateTrackedLocalDistortion
          );
          if (
            !localCandidateHasNoResiduals(layoutGraph, candidateCoords, entry.descriptor, currentScore, bondLength, atomGrid)
            || !finalAnglePolishCandidateIsBetter(candidateScore, currentScore)
          ) {
            return null;
          }
          return {
            score: candidateScore,
            descriptor: entry.descriptor,
            centerImprovement: entry.centerScore - candidateCenterScore.totalDeviation
          };
        });
        if (
          !candidate
          || (bestCandidate && !finalAnglePolishSelectionIsBetter(candidate, bestCandidate))
        ) {
          continue;
        }
        bestCandidate = {
          ...candidate,
          coords: rotateSubtree(coords, entry.descriptor, angle)
        };
      }
    }

    if (!bestCandidate || auditLayout(layoutGraph, bestCandidate.coords, { bondLength }).ok !== true) {
      break;
    }

    coords = bestCandidate.coords;
    currentScore = bestCandidate.score;
    for (const atomId of bestCandidate.descriptor.subtreeAtomIds) {
      movedAtomIds.add(atomId);
    }
    passes++;
  }

  return {
    coords,
    score: currentScore,
    movedAtomIds,
    passes
  };
}

/**
 * Applies a final large-molecule residual retouch by rotating only collision-
 * local subtrees around their existing covalent anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Retouch options.
 * @param {number} [options.bondLength] - Target depiction bond length.
 * @param {Set<string>|null} [options.frozenAtomIds] - Atom ids the retouch must not move.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], passes: number, angleReliefPasses: number, finalAnglePolishPasses: number, severeOverlapCountBefore: number, severeOverlapCountAfter: number, visibleHeavyBondCrossingCountBefore: number, visibleHeavyBondCrossingCountAfter: number}} Retouch result and before/after residual counts.
 */
export function runLargeMoleculeResidualRetouch(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const frozenAtomIds = options.frozenAtomIds instanceof Set && options.frozenAtomIds.size > 0 ? options.frozenAtomIds : null;
  let coords = cloneCoords(inputCoords);
  const visibleAtomIds = collectVisibleAtomIds(layoutGraph, coords);
  const trackedAngularContexts = buildTrackedAngularContexts(layoutGraph, coords);
  let currentScore = scoreCoords(layoutGraph, coords, bondLength, trackedAngularContexts, visibleAtomIds);
  const initialScore = currentScore;
  const movedAtomIds = new Set();
  let passes = 0;
  let angleReliefPasses = 0;
  let finalAnglePolishPasses = 0;

  if (
    initialScore.severeOverlapCount === 0
    && initialScore.visibleHeavyBondCrossingCount === 0
    && !shouldRunAngleRelief(initialScore)
  ) {
    return {
      changed: false,
      coords: inputCoords,
      movedAtomIds: [],
      passes: 0,
      angleReliefPasses: 0,
      finalAnglePolishPasses: 0,
      severeOverlapCountBefore: initialScore.severeOverlapCount,
      severeOverlapCountAfter: initialScore.severeOverlapCount,
      visibleHeavyBondCrossingCountBefore: initialScore.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: initialScore.visibleHeavyBondCrossingCount
    };
  }

  while (
    passes < MAX_RETOUCH_PASSES
    && (currentScore.severeOverlapCount > 0 || currentScore.visibleHeavyBondCrossingCount > 0)
  ) {
    const descriptors = collectCandidateDescriptors(layoutGraph, coords, currentScore, frozenAtomIds);
    let bestCandidate = null;

    for (const descriptor of descriptors) {
      for (const angle of candidateAnglesForDescriptor(layoutGraph, coords, descriptor)) {
        const candidateScore = withRotatedSubtree(
          layoutGraph,
          coords,
          descriptor,
          angle,
          candidateCoords => scoreCoords(layoutGraph, candidateCoords, bondLength, trackedAngularContexts, visibleAtomIds)
        );
        if (!candidateIsAllowed(descriptor, candidateScore, currentScore)) {
          continue;
        }
        if (!bestCandidate || scoreIsBetter(candidateScore, bestCandidate.score)) {
          bestCandidate = {
            coords: rotateSubtree(coords, descriptor, angle),
            score: candidateScore,
            descriptor
          };
        }
      }
    }

    if (!bestCandidate) {
      break;
    }

    coords = bestCandidate.coords;
    currentScore = bestCandidate.score;
    for (const atomId of bestCandidate.descriptor.subtreeAtomIds) {
      movedAtomIds.add(atomId);
    }
    passes++;
  }

  while (angleReliefPasses < MAX_ANGLE_RETOUCH_PASSES && shouldRunAngleRelief(currentScore)) {
    const atomGrid = buildAtomGrid(layoutGraph, coords, bondLength, { visibleAtomIds });
    const descriptors = collectAngleCandidateDescriptors(layoutGraph, coords, currentScore, frozenAtomIds);
    let bestCandidate = null;

    for (const descriptor of descriptors) {
      const currentLocalDistortion = measureTrackedAngularDistortionAtAtom(
        layoutGraph,
        coords,
        descriptor.anchorAtomId,
        trackedAngularContexts
      );
      for (const angle of candidateAnglesForDescriptor(layoutGraph, coords, descriptor, true)) {
        const candidateLocalDistortion = withRotatedSubtree(
          layoutGraph,
          coords,
          descriptor,
          angle,
          candidateCoords => measureTrackedAngularDistortionAtAtom(
            layoutGraph,
            candidateCoords,
            descriptor.anchorAtomId,
            trackedAngularContexts
          )
        );
        if (
          !localAngleCandidateCanImprove(
            candidateLocalDistortion,
            currentLocalDistortion,
            ANGLE_RELIEF_MIN_TOTAL_IMPROVEMENT,
            ANGLE_RELIEF_MIN_WORST_IMPROVEMENT
          )
        ) {
          continue;
        }
        const candidateApproximateScore = withRotatedSubtree(
          layoutGraph,
          coords,
          descriptor,
          angle,
          candidateCoords => {
            if (!localCandidateHasNoResiduals(layoutGraph, candidateCoords, descriptor, currentScore, bondLength, atomGrid)) {
              return null;
            }
            return buildCleanAngularCandidateScore(currentScore, currentLocalDistortion, candidateLocalDistortion);
          }
        );
        if (
          !candidateApproximateScore
          || !angleCandidateIsBetter(candidateApproximateScore, currentScore)
        ) {
          continue;
        }
        const candidateScore = withRotatedSubtree(
          layoutGraph,
          coords,
          descriptor,
          angle,
          candidateCoords => scoreCoords(layoutGraph, candidateCoords, bondLength, trackedAngularContexts, visibleAtomIds)
        );
        if (!angleCandidateIsBetter(candidateScore, currentScore)) {
          continue;
        }
        if (!bestCandidate || angleCandidateIsBetter(candidateScore, bestCandidate.score)) {
          bestCandidate = {
            coords: rotateSubtree(coords, descriptor, angle),
            score: candidateScore,
            descriptor
          };
        }
      }
    }

    if (!bestCandidate) {
      for (const descriptor of descriptors) {
        const currentLocalDistortion = measureTrackedAngularDistortionAtAtom(
          layoutGraph,
          coords,
          descriptor.anchorAtomId,
          trackedAngularContexts
        );
        for (const angle of candidateAnglesForDescriptor(layoutGraph, coords, descriptor, true)) {
          const candidateLocalDistortion = withRotatedSubtree(
            layoutGraph,
            coords,
            descriptor,
            angle,
            candidateCoords => measureTrackedAngularDistortionAtAtom(
              layoutGraph,
              candidateCoords,
              descriptor.anchorAtomId,
              trackedAngularContexts
            )
          );
          if (
            !localAngleCandidateCanImprove(
              candidateLocalDistortion,
              currentLocalDistortion,
              ANGLE_RELIEF_REPAIR_MIN_TOTAL_IMPROVEMENT,
              ANGLE_RELIEF_REPAIR_MIN_WORST_IMPROVEMENT
            )
          ) {
            continue;
          }
          const candidateScore = withRotatedSubtree(
            layoutGraph,
            coords,
            descriptor,
            angle,
            candidateCoords => scoreCoords(layoutGraph, candidateCoords, bondLength, trackedAngularContexts, visibleAtomIds)
          );
          if (!angleCandidateIsWorthRepair(candidateScore, currentScore)) {
            continue;
          }
          const candidateCoords = rotateSubtree(coords, descriptor, angle);
          const repairedCandidate = repairCandidateResiduals(
            layoutGraph,
            candidateCoords,
            candidateScore,
            bondLength,
            frozenAtomIds,
            trackedAngularContexts,
            visibleAtomIds,
            {
              includeNearbyContainingEndpointDescriptors: descriptor.terminalMultipleLeaf === true
            }
          );
          if (!angleCandidateIsBetter(repairedCandidate.score, currentScore)) {
            continue;
          }
          if (!bestCandidate || angleCandidateIsBetter(repairedCandidate.score, bestCandidate.score)) {
            bestCandidate = {
              coords: repairedCandidate.coords,
              score: repairedCandidate.score,
              descriptor,
              repairedMovedAtomIds: repairedCandidate.movedAtomIds
            };
          }
        }
      }
    }

    if (!bestCandidate) {
      break;
    }
    if (auditLayout(layoutGraph, bestCandidate.coords, { bondLength }).ok !== true) {
      break;
    }

    coords = bestCandidate.coords;
    currentScore = bestCandidate.score;
    for (const atomId of bestCandidate.descriptor.subtreeAtomIds) {
      movedAtomIds.add(atomId);
    }
    for (const atomId of bestCandidate.repairedMovedAtomIds ?? []) {
      movedAtomIds.add(atomId);
    }
    angleReliefPasses++;
  }

  const finalAnglePolish = runFinalAnglePolish(
    layoutGraph,
    coords,
    currentScore,
    bondLength,
    frozenAtomIds,
    trackedAngularContexts,
    visibleAtomIds
  );
  if (finalAnglePolish.passes > 0) {
    coords = finalAnglePolish.coords;
    currentScore = finalAnglePolish.score;
    for (const atomId of finalAnglePolish.movedAtomIds) {
      movedAtomIds.add(atomId);
    }
    finalAnglePolishPasses = finalAnglePolish.passes;
  }

  if (passes === 0 && angleReliefPasses === 0 && finalAnglePolishPasses === 0) {
    return {
      changed: false,
      coords: inputCoords,
      movedAtomIds: [],
      passes: 0,
      angleReliefPasses: 0,
      finalAnglePolishPasses: 0,
      severeOverlapCountBefore: initialScore.severeOverlapCount,
      severeOverlapCountAfter: initialScore.severeOverlapCount,
      visibleHeavyBondCrossingCountBefore: initialScore.visibleHeavyBondCrossingCount,
      visibleHeavyBondCrossingCountAfter: initialScore.visibleHeavyBondCrossingCount
    };
  }

  return {
    changed: true,
    coords,
    movedAtomIds: [...movedAtomIds],
    passes,
    angleReliefPasses,
    finalAnglePolishPasses,
    severeOverlapCountBefore: initialScore.severeOverlapCount,
    severeOverlapCountAfter: currentScore.severeOverlapCount,
    visibleHeavyBondCrossingCountBefore: initialScore.visibleHeavyBondCrossingCount,
    visibleHeavyBondCrossingCountAfter: currentScore.visibleHeavyBondCrossingCount
  };
}
