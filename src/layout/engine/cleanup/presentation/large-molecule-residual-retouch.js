/** @module cleanup/presentation/large-molecule-residual-retouch */

import { auditLayout } from '../../audit/audit.js';
import {
  buildAtomGrid,
  countVisibleHeavyBondCrossings,
  findSevereOverlaps,
  findVisibleHeavyBondCrossings
} from '../../audit/invariants.js';
import { atomPairKey, IDEAL_DIVALENT_CONTINUATION_ELEMENTS, SEVERE_OVERLAP_FACTOR } from '../../constants.js';
import { cloneCoords, rotateAround } from '../../geometry/transforms.js';
import { angleOf, angularDifference, sub, wrapAngle } from '../../geometry/vec2.js';
import {
  isExactVisibleTrigonalBisectorEligible,
  isPlanarDivalentNitrogenContinuationPair
} from '../../placement/branch-placement/angle-selection.js';
import { collectCutSubtree } from '../subtree-utils.js';
import { visibleHeavyCovalentBonds } from '../bond-utils.js';

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
const FINAL_ANGLE_POLISH_CENTER_PRIORITY_MIN_IMPROVEMENT = 0.02;
const FINAL_ANGLE_POLISH_CENTER_PRIORITY_TOTAL_WORSENING_LIMIT = 0.2;
const FINAL_ANGLE_POLISH_CENTER_PRIORITY_WORST_WORSENING_LIMIT = 0.05;
const FINAL_ANGLE_POLISH_CENTER_PRIORITY_MAX_HEAVY_ATOMS = 100;
const RING_FAN_ANGLE_POLISH_MAX_PASSES = 20;
const RING_FAN_ANGLE_POLISH_CENTER_SCAN_LIMIT = 10;
const RING_FAN_ANGLE_POLISH_DIRECTION_COUNT = 12;
const RING_FAN_ANGLE_POLISH_MIN_DEVIATION_DEGREES = 25;
const RING_FAN_ANGLE_POLISH_MIN_MAX_IMPROVEMENT = Math.PI / 180;
const RING_FAN_ANGLE_POLISH_MIN_TOTAL_IMPROVEMENT = 0.015;
const RING_FAN_ANGLE_POLISH_WORST_TOLERANCE = Math.PI / 180;
const RING_FAN_ANGLE_POLISH_BOND_DEVIATION_TOLERANCE = 0.04;
const RING_FAN_ANGLE_POLISH_AGGREGATE_NEIGHBOR_WEIGHT = 0.45;
const RING_FAN_ANGLE_POLISH_SOFT_CONTACT_FACTOR = 0.85;
const RING_FAN_ANGLE_POLISH_SOFT_CONTACT_MIN_PENALTY_IMPROVEMENT = 0.001;
const RING_FAN_ANGLE_POLISH_CONTACT_LEAF_MAX_PASSES = 4;
const RING_FAN_ANGLE_POLISH_CONTACT_LEAF_MAX_DEVIATION_SLACK = Math.PI / 18;
const RING_FAN_ANGLE_POLISH_CONTACT_LEAF_TOTAL_SLACK = 0.75;
const RING_FAN_ANGLE_POLISH_STEP_FACTORS = Object.freeze([0.045, 0.027, 0.015, 0.01]);
const RING_FAN_ANGLE_POLISH_CONTACT_LEAF_BACKOFF_FACTORS = Object.freeze([0.9, 0.8, 0.7, 0.6, 0.55, 0.5]);
const RING_FAN_ANGLE_POLISH_CONTACT_LEAF_ANGLE_OFFSETS = Object.freeze([
  Math.PI / 18,
  -Math.PI / 18,
  Math.PI / 12,
  -Math.PI / 12,
  Math.PI / 9,
  -Math.PI / 9,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 4,
  -Math.PI / 4,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2
]);
const EXACT_THREE_HEAVY_PROTECTION_INITIAL_TOTAL_THRESHOLD = 1e-10;
const EXACT_THREE_HEAVY_PROTECTION_RETRY_TOTAL_THRESHOLD = 0.09;
const EXACT_THREE_HEAVY_PROTECTION_RETRY_CENTER_LIMIT = 4;
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

function residualScoreAtomIds(score) {
  const atomIds = new Set();
  for (const overlap of score.overlaps ?? []) {
    atomIds.add(overlap.firstAtomId);
    atomIds.add(overlap.secondAtomId);
  }
  for (const crossing of score.crossings ?? []) {
    for (const atomId of crossing.firstAtomIds ?? []) {
      atomIds.add(atomId);
    }
    for (const atomId of crossing.secondAtomIds ?? []) {
      atomIds.add(atomId);
    }
  }
  return atomIds;
}

function collectExactThreeHeavyProtectionCenters(layoutGraph, coords, trackedAngularContexts, score) {
  const residualAtomIds = residualScoreAtomIds(score);
  const centerAtomIds = [];
  for (const [atomId, context] of trackedAngularContexts) {
    if (!context.measureThreeHeavy || residualAtomIds.has(atomId)) {
      continue;
    }
    const distortion = measureTrackedAngularDistortionAtAtom(layoutGraph, coords, atomId, trackedAngularContexts);
    if (distortion.totalDeviation <= EXACT_THREE_HEAVY_PROTECTION_INITIAL_TOTAL_THRESHOLD) {
      centerAtomIds.push(atomId);
    }
  }
  return centerAtomIds;
}

function harmedExactThreeHeavyProtectionCenters(layoutGraph, coords, protectedCenterAtomIds, trackedAngularContexts) {
  return protectedCenterAtomIds
    .map(atomId => ({
      atomId,
      distortion: measureTrackedAngularDistortionAtAtom(layoutGraph, coords, atomId, trackedAngularContexts)
    }))
    .filter(({ distortion }) => distortion.totalDeviation > EXACT_THREE_HEAVY_PROTECTION_RETRY_TOTAL_THRESHOLD)
    .sort((first, second) => second.distortion.totalDeviation - first.distortion.totalDeviation)
    .slice(0, EXACT_THREE_HEAVY_PROTECTION_RETRY_CENTER_LIMIT);
}

function protectedCenterDistortionTotal(layoutGraph, coords, protectedCenterAtomIds, trackedAngularContexts) {
  return protectedCenterAtomIds.reduce((total, atomId) => (
    total + measureTrackedAngularDistortionAtAtom(layoutGraph, coords, atomId, trackedAngularContexts).totalDeviation
  ), 0);
}

function smallestVisibleHeavyCutNeighborAtomId(layoutGraph, coords, centerAtomId) {
  let bestNeighbor = null;
  for (const { bond, neighborAtomId } of visibleHeavyCovalentBonds(layoutGraph, coords, centerAtomId)) {
    if (bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    const subtreeAtomIds = [...collectCutSubtree(layoutGraph, neighborAtomId, centerAtomId)].filter(atomId => coords.has(atomId));
    if (subtreeAtomIds.length === 0 || subtreeAtomIds.includes(centerAtomId)) {
      continue;
    }
    const heavyAtomCount = visibleHeavyAtomCount(layoutGraph, subtreeAtomIds);
    if (heavyAtomCount === 0) {
      continue;
    }
    if (
      !bestNeighbor
      || heavyAtomCount < bestNeighbor.heavyAtomCount
      || (heavyAtomCount === bestNeighbor.heavyAtomCount && subtreeAtomIds.length < bestNeighbor.atomCount)
    ) {
      bestNeighbor = {
        atomId: neighborAtomId,
        atomCount: subtreeAtomIds.length,
        heavyAtomCount
      };
    }
  }
  return bestNeighbor?.atomId ?? null;
}

function exactThreeHeavyProtectionRetryFrozenAtomIds(layoutGraph, coords, protectedCenterAtomIds) {
  const atomIds = new Set(protectedCenterAtomIds);
  for (const centerAtomId of protectedCenterAtomIds) {
    const neighborAtomId = smallestVisibleHeavyCutNeighborAtomId(layoutGraph, coords, centerAtomId);
    if (neighborAtomId) {
      atomIds.add(neighborAtomId);
    }
  }
  return atomIds;
}

function mergeFrozenAtomIds(firstAtomIds, secondAtomIds) {
  const additionalAtomIds = secondAtomIds ? [...secondAtomIds] : [];
  if (!(firstAtomIds instanceof Set) || firstAtomIds.size === 0) {
    return additionalAtomIds.length > 0 ? new Set(additionalAtomIds) : null;
  }
  const mergedAtomIds = new Set(firstAtomIds);
  for (const atomId of additionalAtomIds) {
    mergedAtomIds.add(atomId);
  }
  return mergedAtomIds;
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

/**
 * Returns whether a repair descriptor would move atoms from a protected local fan.
 * @param {object} descriptor - Rotation descriptor being considered.
 * @param {Set<string>|null|undefined} protectedMovedAtomIds - Atom ids that must remain fixed during repair.
 * @returns {boolean} True when the descriptor subtree includes a protected atom.
 */
function descriptorMovesProtectedAtom(descriptor, protectedMovedAtomIds) {
  if (!(protectedMovedAtomIds instanceof Set) || protectedMovedAtomIds.size === 0) {
    return false;
  }
  return descriptor.subtreeAtomIds.some(atomId => protectedMovedAtomIds.has(atomId));
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
          protectedMovedAtomIds: new Set([
            center.atomId,
            ...center.covalentBonds.map(({ neighborAtomId }) => neighborAtomId)
          ]),
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
  const maxRepairPasses = options.maxPasses ?? ANGLE_RELIEF_REPAIR_PASSES;

  while (
    passes < maxRepairPasses
    && (currentScore.severeOverlapCount > 0 || currentScore.visibleHeavyBondCrossingCount > 0)
  ) {
    const descriptors = collectCandidateDescriptors(layoutGraph, coords, currentScore, frozenAtomIds, {
      includeNearbyContainingEndpointDescriptors: options.includeNearbyContainingEndpointDescriptors === true
    }).filter(descriptor => !descriptorMovesProtectedAtom(descriptor, options.protectedMovedAtomIds));
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

/**
 * Allows a bounded final-polish candidate that materially improves the focused
 * angle center while keeping the whole large-molecule angular score close.
 * @param {object} candidateScore - Candidate score after residual repair.
 * @param {object} currentScore - Current final-polish score.
 * @param {number} centerImprovement - Local center distortion reduction.
 * @returns {boolean} True when the center-priority candidate is acceptable.
 */
function finalAnglePolishCenterPriorityCandidateIsAllowed(candidateScore, currentScore, centerImprovement) {
  if (candidateScore.severeOverlapCount !== 0 || candidateScore.visibleHeavyBondCrossingCount !== 0) {
    return false;
  }
  return (
    centerImprovement >= FINAL_ANGLE_POLISH_CENTER_PRIORITY_MIN_IMPROVEMENT
    && candidateScore.angularDistortionTotal <= currentScore.angularDistortionTotal + FINAL_ANGLE_POLISH_CENTER_PRIORITY_TOTAL_WORSENING_LIMIT
    && candidateScore.angularDistortionWorst <= currentScore.angularDistortionWorst + FINAL_ANGLE_POLISH_CENTER_PRIORITY_WORST_WORSENING_LIMIT
  );
}

/**
 * Returns whether a final angle-polish candidate is worth invoking the bounded
 * local residual repair, including small center-priority improvements that
 * would otherwise be filtered out before nearby contacts can be repaired.
 * @param {object} candidateScore - Candidate score before residual repair.
 * @param {object} currentScore - Current final-polish score.
 * @param {number} centerImprovement - Local center distortion reduction.
 * @param {boolean} allowCenterPriorityRepair - Whether bounded center-priority repair is enabled for this molecule.
 * @returns {boolean} True when repair should be attempted.
 */
function finalAnglePolishCandidateIsWorthRepair(candidateScore, currentScore, centerImprovement, allowCenterPriorityRepair) {
  if (angleCandidateIsWorthRepair(candidateScore, currentScore)) {
    return true;
  }
  if (!allowCenterPriorityRepair) {
    return false;
  }
  if (
    candidateScore.severeOverlapCount > ANGLE_RELIEF_REPAIR_OVERLAP_LIMIT
    || candidateScore.visibleHeavyBondCrossingCount > ANGLE_RELIEF_REPAIR_CROSSING_LIMIT
  ) {
    return false;
  }
  return (
    centerImprovement >= FINAL_ANGLE_POLISH_CENTER_PRIORITY_MIN_IMPROVEMENT
    && candidateScore.angularDistortionTotal + (ANGLE_RELIEF_REPAIR_MIN_TOTAL_IMPROVEMENT / 2) < currentScore.angularDistortionTotal
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

function ringFanAnglePolishAuditOptions(bondLength, bondValidationClasses) {
  return bondValidationClasses
    ? { bondLength, bondValidationClasses }
    : { bondLength };
}

function ringFanAnglePolishCenter(layoutGraph, coords, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || !coords.has(atomId)) {
    return null;
  }
  if ((layoutGraph.atomToRings.get(atomId)?.length ?? 0) === 0) {
    return null;
  }
  const covalentBonds = visibleHeavyCovalentBonds(layoutGraph, coords, atomId);
  if (covalentBonds.length !== 3) {
    return null;
  }
  const centerScore = measureLocalAngleDeviation(layoutGraph, coords, atomId);
  if (!centerScore || centerScore.totalDeviation <= 0) {
    return null;
  }
  return centerScore;
}

function ringFanAnglePolishScore(layoutGraph, coords) {
  let totalDeviation = 0;
  let maxDeviation = 0;
  const centers = [];
  for (const atomId of coords.keys()) {
    const center = ringFanAnglePolishCenter(layoutGraph, coords, atomId);
    if (!center) {
      continue;
    }
    totalDeviation += center.totalDeviation;
    maxDeviation = Math.max(maxDeviation, (center.maxDeviationDegrees * Math.PI) / 180);
    if (center.maxDeviationDegrees > RING_FAN_ANGLE_POLISH_MIN_DEVIATION_DEGREES) {
      centers.push(center);
    }
  }
  centers.sort((first, second) => {
    if (Math.abs(second.maxDeviationDegrees - first.maxDeviationDegrees) > 1e-9) {
      return second.maxDeviationDegrees - first.maxDeviationDegrees;
    }
    return second.totalDeviation - first.totalDeviation;
  });
  return {
    totalDeviation,
    maxDeviation,
    maxDeviationDegrees: (maxDeviation * 180) / Math.PI,
    centers
  };
}

function ringFanAnglePolishScoreImproves(candidateScore, incumbentScore) {
  if (candidateScore.maxDeviation + RING_FAN_ANGLE_POLISH_MIN_MAX_IMPROVEMENT < incumbentScore.maxDeviation) {
    return true;
  }
  return (
    candidateScore.maxDeviation <= incumbentScore.maxDeviation + RING_FAN_ANGLE_POLISH_WORST_TOLERANCE
    && candidateScore.totalDeviation + RING_FAN_ANGLE_POLISH_MIN_TOTAL_IMPROVEMENT < incumbentScore.totalDeviation
  );
}

function ringFanAnglePolishAuditAllows(candidateAudit, incumbentAudit, bondLength) {
  if (!candidateAudit || !incumbentAudit) {
    return false;
  }
  if (incumbentAudit.ok === true && candidateAudit.ok !== true) {
    return false;
  }
  if (candidateAudit.severeOverlapCount > incumbentAudit.severeOverlapCount) {
    return false;
  }
  if ((candidateAudit.visibleHeavyBondCrossingCount ?? 0) > (incumbentAudit.visibleHeavyBondCrossingCount ?? 0)) {
    return false;
  }
  if ((candidateAudit.labelOverlapCount ?? 0) > (incumbentAudit.labelOverlapCount ?? 0)) {
    return false;
  }
  if (candidateAudit.bondLengthFailureCount > incumbentAudit.bondLengthFailureCount) {
    return false;
  }
  return candidateAudit.maxBondLengthDeviation <= (
    incumbentAudit.maxBondLengthDeviation + bondLength * RING_FAN_ANGLE_POLISH_BOND_DEVIATION_TOLERANCE
  );
}

function ringFanAnglePolishTopologicalDistance(layoutGraph, firstAtomId, secondAtomId, maxDepth) {
  const pairKey = atomPairKey(firstAtomId, secondAtomId);
  layoutGraph._ringFanAnglePolishTopologicalDistanceCache ??= new Map();
  const cachedDistance = layoutGraph._ringFanAnglePolishTopologicalDistanceCache.get(pairKey);
  if (cachedDistance != null) {
    return cachedDistance;
  }

  let frontier = [firstAtomId];
  const seenAtomIds = new Set([firstAtomId]);
  for (let depth = 1; depth <= maxDepth; depth++) {
    const nextFrontier = [];
    for (const atomId of frontier) {
      for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
        if (!bond || bond.kind !== 'covalent') {
          continue;
        }
        const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
        if (neighborAtomId === secondAtomId) {
          layoutGraph._ringFanAnglePolishTopologicalDistanceCache.set(pairKey, depth);
          return depth;
        }
        if (!seenAtomIds.has(neighborAtomId)) {
          seenAtomIds.add(neighborAtomId);
          nextFrontier.push(neighborAtomId);
        }
      }
    }
    frontier = nextFrontier;
  }

  layoutGraph._ringFanAnglePolishTopologicalDistanceCache.set(pairKey, Number.POSITIVE_INFINITY);
  return Number.POSITIVE_INFINITY;
}

function ringFanAnglePolishVisibleHeavyAtomIds(layoutGraph, coords) {
  const atomIds = [];
  for (const atomId of coords.keys()) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom?.visible !== false && atom?.element !== 'H') {
      atomIds.push(atomId);
    }
  }
  return atomIds;
}

function ringFanAnglePolishSoftContactScore(layoutGraph, coords, bondLength, focusAtomIds = null) {
  const threshold = bondLength * RING_FAN_ANGLE_POLISH_SOFT_CONTACT_FACTOR;
  const allAtomIds = ringFanAnglePolishVisibleHeavyAtomIds(layoutGraph, coords);
  const focusSet = focusAtomIds ? new Set(focusAtomIds) : null;
  const scannedAtomIds = focusSet
    ? [...focusSet].filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom?.visible !== false && atom?.element !== 'H' && coords.has(atomId);
    })
    : allAtomIds;

  let contactCount = 0;
  let penalty = 0;
  let minDistance = Number.POSITIVE_INFINITY;
  const seenPairKeys = new Set();
  for (const firstAtomId of scannedAtomIds) {
    const firstPosition = coords.get(firstAtomId);
    if (!firstPosition) {
      continue;
    }
    for (const secondAtomId of allAtomIds) {
      if (firstAtomId === secondAtomId) {
        continue;
      }
      const pairKey = atomPairKey(firstAtomId, secondAtomId);
      if (seenPairKeys.has(pairKey) || layoutGraph.bondByAtomPair.has(pairKey)) {
        continue;
      }
      seenPairKeys.add(pairKey);
      const secondPosition = coords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      const dx = firstPosition.x - secondPosition.x;
      const dy = firstPosition.y - secondPosition.y;
      if (Math.abs(dx) >= threshold || Math.abs(dy) >= threshold) {
        continue;
      }
      if (ringFanAnglePolishTopologicalDistance(layoutGraph, firstAtomId, secondAtomId, 3) <= 3) {
        continue;
      }
      const distance = Math.hypot(
        dx,
        dy
      );
      if (distance >= threshold) {
        continue;
      }
      const deficit = threshold - distance;
      contactCount++;
      penalty += deficit * deficit;
      minDistance = Math.min(minDistance, distance);
    }
  }

  return {
    contactCount,
    penalty,
    minDistance
  };
}

function ringFanAnglePolishSoftContactEntries(layoutGraph, coords, bondLength) {
  const threshold = bondLength * RING_FAN_ANGLE_POLISH_SOFT_CONTACT_FACTOR;
  const atomIds = ringFanAnglePolishVisibleHeavyAtomIds(layoutGraph, coords);
  const entries = [];

  for (let firstIndex = 0; firstIndex < atomIds.length; firstIndex++) {
    const firstAtomId = atomIds[firstIndex];
    const firstPosition = coords.get(firstAtomId);
    if (!firstPosition) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < atomIds.length; secondIndex++) {
      const secondAtomId = atomIds[secondIndex];
      const pairKey = atomPairKey(firstAtomId, secondAtomId);
      if (layoutGraph.bondByAtomPair.has(pairKey)) {
        continue;
      }
      const secondPosition = coords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      const dx = firstPosition.x - secondPosition.x;
      const dy = firstPosition.y - secondPosition.y;
      if (Math.abs(dx) >= threshold || Math.abs(dy) >= threshold) {
        continue;
      }
      if (ringFanAnglePolishTopologicalDistance(layoutGraph, firstAtomId, secondAtomId, 3) <= 3) {
        continue;
      }
      const distance = Math.hypot(dx, dy);
      if (distance >= threshold) {
        continue;
      }
      entries.push({
        firstAtomId,
        secondAtomId,
        distance
      });
    }
  }

  entries.sort((first, second) => first.distance - second.distance);
  return entries;
}

function ringFanAnglePolishSoftContactScoreIsBetter(candidateScore, incumbentScore) {
  if (candidateScore.contactCount !== incumbentScore.contactCount) {
    return candidateScore.contactCount < incumbentScore.contactCount;
  }
  if (candidateScore.penalty + RING_FAN_ANGLE_POLISH_SOFT_CONTACT_MIN_PENALTY_IMPROVEMENT < incumbentScore.penalty) {
    return true;
  }
  return candidateScore.minDistance > incumbentScore.minDistance + 1e-6;
}

function ringFanAnglePolishSoftContactDelta(candidateScore, incumbentScore) {
  let minDistanceDelta = 0;
  if (candidateScore.contactCount === 0 && incumbentScore.contactCount > 0) {
    minDistanceDelta = Number.POSITIVE_INFINITY;
  } else if (candidateScore.contactCount > 0 && incumbentScore.contactCount === 0) {
    minDistanceDelta = Number.NEGATIVE_INFINITY;
  } else if (candidateScore.contactCount > 0 || incumbentScore.contactCount > 0) {
    minDistanceDelta = candidateScore.minDistance - incumbentScore.minDistance;
  }
  return {
    contactCount: candidateScore.contactCount - incumbentScore.contactCount,
    penalty: candidateScore.penalty - incumbentScore.penalty,
    minDistance: minDistanceDelta
  };
}

function ringFanAnglePolishSoftContactDeltaIsBetter(candidateDelta, incumbentDelta) {
  if (candidateDelta.contactCount !== incumbentDelta.contactCount) {
    return candidateDelta.contactCount < incumbentDelta.contactCount;
  }
  if (Math.abs(candidateDelta.penalty - incumbentDelta.penalty) > RING_FAN_ANGLE_POLISH_SOFT_CONTACT_MIN_PENALTY_IMPROVEMENT) {
    return candidateDelta.penalty < incumbentDelta.penalty;
  }
  return candidateDelta.minDistance > incumbentDelta.minDistance + 1e-6;
}

function ringFanAnglePolishTerminalLeafAnchor(layoutGraph, leafAtomId) {
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (
    !leafAtom
    || leafAtom.element === 'H'
    || leafAtom.heavyDegree !== 1
    || (layoutGraph.atomToRings.get(leafAtomId)?.length ?? 0) > 0
    || layoutGraph.fixedCoords.has(leafAtomId)
  ) {
    return null;
  }

  const heavyNeighborAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(leafAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom?.element !== 'H') {
      heavyNeighborAtomIds.push(neighborAtomId);
    }
  }
  if (heavyNeighborAtomIds.length !== 1) {
    return null;
  }
  return heavyNeighborAtomIds[0];
}

function ringFanAnglePolishAnchorHasPairedTerminalHeteroLeaves(layoutGraph, anchorAtomId) {
  let terminalHeteroLeafCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (
      neighborAtom
      && neighborAtom.element !== 'C'
      && neighborAtom.element !== 'H'
      && neighborAtom.heavyDegree === 1
      && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) === 0
    ) {
      terminalHeteroLeafCount++;
    }
  }
  return terminalHeteroLeafCount >= 2;
}

function ringFanAnglePolishContactLeafDescriptors(layoutGraph, coords, bondLength) {
  const descriptors = [];
  const seenLeafAtomIds = new Set();
  for (const contact of ringFanAnglePolishSoftContactEntries(layoutGraph, coords, bondLength)) {
    for (const [leafAtomId, targetAtomId] of [
      [contact.firstAtomId, contact.secondAtomId],
      [contact.secondAtomId, contact.firstAtomId]
    ]) {
      if (seenLeafAtomIds.has(leafAtomId)) {
        continue;
      }
      const anchorAtomId = ringFanAnglePolishTerminalLeafAnchor(layoutGraph, leafAtomId);
      if (!anchorAtomId || !coords.has(anchorAtomId) || !coords.has(targetAtomId)) {
        continue;
      }
      seenLeafAtomIds.add(leafAtomId);
      descriptors.push({
        leafAtomId,
        anchorAtomId,
        targetAtomId,
        distance: contact.distance,
        allowRotation: !ringFanAnglePolishAnchorHasPairedTerminalHeteroLeaves(layoutGraph, anchorAtomId)
      });
    }
  }
  return descriptors;
}

function ringFanAnglePolishBackedOffLeafCoords(coords, descriptor, factor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!anchorPosition || !leafPosition) {
    return coords;
  }

  const candidateCoords = cloneCoords(coords);
  candidateCoords.set(descriptor.leafAtomId, {
    x: anchorPosition.x + (leafPosition.x - anchorPosition.x) * factor,
    y: anchorPosition.y + (leafPosition.y - anchorPosition.y) * factor
  });
  return candidateCoords;
}

function ringFanAnglePolishRotatedLeafCoords(coords, descriptor, angle) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!anchorPosition || !leafPosition) {
    return coords;
  }
  const radius = Math.hypot(
    leafPosition.x - anchorPosition.x,
    leafPosition.y - anchorPosition.y
  );
  if (radius <= 1e-9) {
    return coords;
  }

  const candidateCoords = cloneCoords(coords);
  candidateCoords.set(descriptor.leafAtomId, {
    x: anchorPosition.x + Math.cos(angle) * radius,
    y: anchorPosition.y + Math.sin(angle) * radius
  });
  return candidateCoords;
}

function ringFanAnglePolishContactLeafAngles(coords, descriptor) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  const targetPosition = coords.get(descriptor.targetAtomId);
  if (!anchorPosition || !leafPosition || !targetPosition) {
    return [];
  }

  const currentAngle = Math.atan2(
    leafPosition.y - anchorPosition.y,
    leafPosition.x - anchorPosition.x
  );
  const targetAwayAngle = Math.atan2(
    anchorPosition.y - targetPosition.y,
    anchorPosition.x - targetPosition.x
  );
  return [
    targetAwayAngle,
    ...RING_FAN_ANGLE_POLISH_CONTACT_LEAF_ANGLE_OFFSETS.map(offset => currentAngle + offset)
  ];
}

function ringFanAnglePolishContactLeafSelectionIsBetter(candidate, incumbent) {
  if (ringFanAnglePolishSoftContactScoreIsBetter(candidate.softContactScore, incumbent.softContactScore)) {
    return true;
  }
  if (ringFanAnglePolishSoftContactScoreIsBetter(incumbent.softContactScore, candidate.softContactScore)) {
    return false;
  }
  if (candidate.score.maxDeviation + RETOUCH_SCORE_EPSILON < incumbent.score.maxDeviation) {
    return true;
  }
  if (incumbent.score.maxDeviation + RETOUCH_SCORE_EPSILON < candidate.score.maxDeviation) {
    return false;
  }
  return candidate.score.totalDeviation + RETOUCH_SCORE_EPSILON < incumbent.score.totalDeviation;
}

function ringFanAnglePolishContactLeafCandidateAllowed(candidateScore, currentScore) {
  return (
    candidateScore.maxDeviation <= currentScore.maxDeviation + RING_FAN_ANGLE_POLISH_CONTACT_LEAF_MAX_DEVIATION_SLACK
    && candidateScore.totalDeviation <= currentScore.totalDeviation + RING_FAN_ANGLE_POLISH_CONTACT_LEAF_TOTAL_SLACK
  );
}

function runMacrocycleRingFanSoftContactLeafRetouch(layoutGraph, inputCoords, inputScore, inputAudit, bondLength, auditOptions) {
  let coords = inputCoords;
  let currentScore = inputScore;
  let currentAudit = inputAudit;
  let currentSoftContactScore = ringFanAnglePolishSoftContactScore(layoutGraph, coords, bondLength);
  const movedAtomIds = new Set();
  let passes = 0;

  while (passes < RING_FAN_ANGLE_POLISH_CONTACT_LEAF_MAX_PASSES && currentSoftContactScore.contactCount > 0) {
    const descriptors = ringFanAnglePolishContactLeafDescriptors(layoutGraph, coords, bondLength);
    let bestCandidate = null;

    for (const descriptor of descriptors) {
      const candidateCoordsList = [
        ...RING_FAN_ANGLE_POLISH_CONTACT_LEAF_BACKOFF_FACTORS.map(factor =>
          ringFanAnglePolishBackedOffLeafCoords(coords, descriptor, factor)
        )
      ];
      if (descriptor.allowRotation) {
        candidateCoordsList.push(
          ...ringFanAnglePolishContactLeafAngles(coords, descriptor).map(angle =>
            ringFanAnglePolishRotatedLeafCoords(coords, descriptor, angle)
          )
        );
      }

      for (const candidateCoords of candidateCoordsList) {
        const candidateScore = ringFanAnglePolishScore(layoutGraph, candidateCoords);
        if (!ringFanAnglePolishContactLeafCandidateAllowed(candidateScore, currentScore)) {
          continue;
        }
        const candidateAudit = auditLayout(layoutGraph, candidateCoords, auditOptions);
        if (!ringFanAnglePolishAuditAllows(candidateAudit, currentAudit, bondLength)) {
          continue;
        }
        const candidateSoftContactScore = ringFanAnglePolishSoftContactScore(layoutGraph, candidateCoords, bondLength);
        if (!ringFanAnglePolishSoftContactScoreIsBetter(candidateSoftContactScore, currentSoftContactScore)) {
          continue;
        }
        const candidate = {
          atomIds: [descriptor.leafAtomId],
          coords: candidateCoords,
          score: candidateScore,
          audit: candidateAudit,
          softContactScore: candidateSoftContactScore
        };
        if (!bestCandidate || ringFanAnglePolishContactLeafSelectionIsBetter(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    }

    if (!bestCandidate) {
      break;
    }
    coords = bestCandidate.coords;
    currentScore = bestCandidate.score;
    currentAudit = bestCandidate.audit;
    currentSoftContactScore = bestCandidate.softContactScore;
    for (const atomId of bestCandidate.atomIds) {
      movedAtomIds.add(atomId);
    }
    passes++;
  }

  return {
    coords,
    score: currentScore,
    audit: currentAudit,
    movedAtomIds: [...movedAtomIds],
    passes
  };
}

function ringFanAnglePolishSelectionIsBetter(candidate, incumbent) {
  if (candidate.score.maxDeviation + RETOUCH_SCORE_EPSILON < incumbent.score.maxDeviation) {
    return true;
  }
  if (incumbent.score.maxDeviation + RETOUCH_SCORE_EPSILON < candidate.score.maxDeviation) {
    return false;
  }
  if (candidate.score.totalDeviation + RETOUCH_SCORE_EPSILON < incumbent.score.totalDeviation) {
    return true;
  }
  if (incumbent.score.totalDeviation + RETOUCH_SCORE_EPSILON < candidate.score.totalDeviation) {
    return false;
  }
  return ringFanAnglePolishSoftContactDeltaIsBetter(candidate.softContactDelta, incumbent.softContactDelta);
}

function translatedSingleAtomCoords(coords, atomId, dx, dy) {
  const position = coords.get(atomId);
  if (!position) {
    return coords;
  }
  const candidateCoords = cloneCoords(coords);
  candidateCoords.set(atomId, {
    x: position.x + dx,
    y: position.y + dy
  });
  return candidateCoords;
}

function translatedMultiAtomCoords(coords, translations) {
  const candidateCoords = cloneCoords(coords);
  for (const { atomId, dx, dy } of translations) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    candidateCoords.set(atomId, {
      x: position.x + dx,
      y: position.y + dy
    });
  }
  return candidateCoords;
}

function unitVectorBetween(firstPosition, secondPosition) {
  const dx = secondPosition.x - firstPosition.x;
  const dy = secondPosition.y - firstPosition.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-9) {
    return null;
  }
  return {
    x: dx / length,
    y: dy / length
  };
}

function ringFanAnglePolishPairEntries(coords, center) {
  const centerPosition = coords.get(center.atomId);
  if (!centerPosition) {
    return [];
  }
  const pairEntries = [];
  for (let firstIndex = 0; firstIndex < center.covalentBonds.length; firstIndex++) {
    const firstAtomId = center.covalentBonds[firstIndex].neighborAtomId;
    const firstPosition = coords.get(firstAtomId);
    if (!firstPosition) {
      continue;
    }
    const firstAngle = angleOf(sub(firstPosition, centerPosition));
    for (let secondIndex = firstIndex + 1; secondIndex < center.covalentBonds.length; secondIndex++) {
      const secondAtomId = center.covalentBonds[secondIndex].neighborAtomId;
      const secondPosition = coords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      const separation = angularDifference(firstAngle, angleOf(sub(secondPosition, centerPosition)));
      pairEntries.push({
        firstAtomId,
        secondAtomId,
        separation,
        signedDeviation: separation - (2 * Math.PI) / 3,
        deviation: Math.abs(separation - (2 * Math.PI) / 3)
      });
    }
  }
  pairEntries.sort((first, second) => second.deviation - first.deviation);
  return pairEntries;
}

function ringFanAnglePolishDirectedCandidateCoords(coords, center, pair, step) {
  const centerPosition = coords.get(center.atomId);
  const firstPosition = coords.get(pair.firstAtomId);
  const secondPosition = coords.get(pair.secondAtomId);
  if (!centerPosition || !firstPosition || !secondPosition) {
    return [];
  }

  const midpoint = {
    x: (firstPosition.x + secondPosition.x) / 2,
    y: (firstPosition.y + secondPosition.y) / 2
  };
  const midpointUnit = unitVectorBetween(centerPosition, midpoint);
  const edgeUnit = unitVectorBetween(firstPosition, secondPosition);
  if (!midpointUnit || !edgeUnit) {
    return [];
  }

  const directionSign = pair.separation < (2 * Math.PI) / 3 ? 1 : -1;
  return [
    translatedSingleAtomCoords(
      coords,
      center.atomId,
      midpointUnit.x * step * directionSign,
      midpointUnit.y * step * directionSign
    ),
    translatedSingleAtomCoords(
      coords,
      center.atomId,
      -midpointUnit.x * step * directionSign,
      -midpointUnit.y * step * directionSign
    ),
    translatedMultiAtomCoords(coords, [
      {
        atomId: pair.firstAtomId,
        dx: -edgeUnit.x * step * directionSign,
        dy: -edgeUnit.y * step * directionSign
      },
      {
        atomId: pair.secondAtomId,
        dx: edgeUnit.x * step * directionSign,
        dy: edgeUnit.y * step * directionSign
      }
    ]),
    translatedMultiAtomCoords(coords, [
      {
        atomId: pair.firstAtomId,
        dx: edgeUnit.x * step * directionSign,
        dy: edgeUnit.y * step * directionSign
      },
      {
        atomId: pair.secondAtomId,
        dx: -edgeUnit.x * step * directionSign,
        dy: -edgeUnit.y * step * directionSign
      }
    ])
  ];
}

function addRingFanAnglePolishTranslation(translations, translationWeights, atomId, dx, dy, weight) {
  const current = translations.get(atomId) ?? { x: 0, y: 0 };
  current.x += dx * weight;
  current.y += dy * weight;
  translations.set(atomId, current);
  translationWeights.set(atomId, (translationWeights.get(atomId) ?? 0) + weight);
}

function ringFanAnglePolishAggregateCandidate(layoutGraph, coords, centers, step) {
  const translations = new Map();
  const translationWeights = new Map();
  const movedAtomIds = new Set();

  for (const center of centers) {
    const [pair] = ringFanAnglePolishPairEntries(coords, center);
    if (!pair || pair.deviation <= 1e-9) {
      continue;
    }
    const centerPosition = coords.get(center.atomId);
    const firstPosition = coords.get(pair.firstAtomId);
    const secondPosition = coords.get(pair.secondAtomId);
    if (!centerPosition || !firstPosition || !secondPosition) {
      continue;
    }

    const midpoint = {
      x: (firstPosition.x + secondPosition.x) / 2,
      y: (firstPosition.y + secondPosition.y) / 2
    };
    const midpointUnit = unitVectorBetween(centerPosition, midpoint);
    const edgeUnit = unitVectorBetween(firstPosition, secondPosition);
    if (!midpointUnit || !edgeUnit) {
      continue;
    }

    const directionSign = pair.signedDeviation < 0 ? 1 : -1;
    const weight = Math.min(pair.deviation / (Math.PI / 3), 1);
    const centerAtom = layoutGraph.atoms.get(center.atomId);
    if (centerAtom?.element !== 'H' && !layoutGraph.fixedCoords.has(center.atomId)) {
      addRingFanAnglePolishTranslation(
        translations,
        translationWeights,
        center.atomId,
        midpointUnit.x * step * directionSign,
        midpointUnit.y * step * directionSign,
        weight
      );
      movedAtomIds.add(center.atomId);
    }

    for (const [atomId, direction] of [
      [pair.firstAtomId, -1],
      [pair.secondAtomId, 1]
    ]) {
      const atom = layoutGraph.atoms.get(atomId);
      if (!atom || atom.element === 'H' || layoutGraph.fixedCoords.has(atomId)) {
        continue;
      }
      addRingFanAnglePolishTranslation(
        translations,
        translationWeights,
        atomId,
        edgeUnit.x * step * direction * directionSign * RING_FAN_ANGLE_POLISH_AGGREGATE_NEIGHBOR_WEIGHT,
        edgeUnit.y * step * direction * directionSign * RING_FAN_ANGLE_POLISH_AGGREGATE_NEIGHBOR_WEIGHT,
        weight
      );
      movedAtomIds.add(atomId);
    }
  }

  if (movedAtomIds.size === 0) {
    return null;
  }

  const candidateCoords = cloneCoords(coords);
  for (const [atomId, translation] of translations) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    const weight = Math.max(1, translationWeights.get(atomId) ?? 1);
    candidateCoords.set(atomId, {
      x: position.x + translation.x / weight,
      y: position.y + translation.y / weight
    });
  }

  return {
    atomIds: [...movedAtomIds],
    coords: candidateCoords
  };
}

function ringFanAnglePolishMovableAtomIds(layoutGraph, centers) {
  const atomIds = [];
  const seenAtomIds = new Set();
  for (const center of centers) {
    for (const atomId of [center.atomId, ...center.covalentBonds.map(({ neighborAtomId }) => neighborAtomId)]) {
      if (seenAtomIds.has(atomId) || layoutGraph.fixedCoords.has(atomId)) {
        continue;
      }
      const atom = layoutGraph.atoms.get(atomId);
      if (!atom || atom.element === 'H') {
        continue;
      }
      seenAtomIds.add(atomId);
      atomIds.push(atomId);
    }
  }
  return atomIds;
}

/**
 * Polishes distorted three-bond fans embedded inside macrocycle ring systems.
 * Branch-rotation cleanup cannot move these centers because every ring bond is
 * still connected through an alternate cycle. This pass uses tiny individual
 * atom translations and accepts them only when the final audit stays clean.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Retouch options.
 * @param {number} [options.bondLength] - Target bond length.
 * @param {Map<string, string>|null} [options.bondValidationClasses] - Optional bond-validation classes.
 * @returns {{changed: boolean, coords: Map<string, {x: number, y: number}>, movedAtomIds: string[], passes: number, maxDeviationBefore: number, maxDeviationAfter: number}} Retouch result.
 */
export function runMacrocycleRingFanAngleRetouch(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  const bondValidationClasses = options.bondValidationClasses ?? null;
  const auditOptions = ringFanAnglePolishAuditOptions(bondLength, bondValidationClasses);
  let coords = cloneCoords(inputCoords);
  let currentScore = ringFanAnglePolishScore(layoutGraph, coords);
  const initialScore = currentScore;
  let currentAudit = auditLayout(layoutGraph, coords, auditOptions);
  const movedAtomIds = new Set();
  let passes = 0;

  while (
    passes < RING_FAN_ANGLE_POLISH_MAX_PASSES
    && currentScore.maxDeviationDegrees > RING_FAN_ANGLE_POLISH_MIN_DEVIATION_DEGREES
  ) {
    const centers = currentScore.centers.slice(0, RING_FAN_ANGLE_POLISH_CENTER_SCAN_LIMIT);
    const movableAtomIds = ringFanAnglePolishMovableAtomIds(layoutGraph, centers);
    let bestCandidate = null;

    const evaluateCandidateCoords = (candidateCoords, movedAtomIds) => {
      const candidateScore = ringFanAnglePolishScore(layoutGraph, candidateCoords);
      if (!ringFanAnglePolishScoreImproves(candidateScore, currentScore)) {
        return;
      }
      const candidateAudit = auditLayout(layoutGraph, candidateCoords, auditOptions);
      if (!ringFanAnglePolishAuditAllows(candidateAudit, currentAudit, bondLength)) {
        return;
      }
      const currentSoftContactScore = ringFanAnglePolishSoftContactScore(layoutGraph, coords, bondLength, movedAtomIds);
      const candidateSoftContactScore = ringFanAnglePolishSoftContactScore(layoutGraph, candidateCoords, bondLength, movedAtomIds);
      const candidate = {
        atomIds: movedAtomIds,
        coords: candidateCoords,
        score: candidateScore,
        softContactDelta: ringFanAnglePolishSoftContactDelta(candidateSoftContactScore, currentSoftContactScore),
        audit: candidateAudit
      };
      if (!bestCandidate || ringFanAnglePolishSelectionIsBetter(candidate, bestCandidate)) {
        bestCandidate = candidate;
      }
    };

    for (const atomId of movableAtomIds) {
      const position = coords.get(atomId);
      if (!position) {
        continue;
      }
      for (const stepFactor of RING_FAN_ANGLE_POLISH_STEP_FACTORS) {
        const step = bondLength * stepFactor;
        for (let directionIndex = 0; directionIndex < RING_FAN_ANGLE_POLISH_DIRECTION_COUNT; directionIndex++) {
          const angle = (2 * Math.PI * directionIndex) / RING_FAN_ANGLE_POLISH_DIRECTION_COUNT;
          const candidateCoords = translatedSingleAtomCoords(
            coords,
            atomId,
            Math.cos(angle) * step,
            Math.sin(angle) * step
          );
          evaluateCandidateCoords(candidateCoords, [atomId]);
        }
      }
    }

    for (const center of centers) {
      for (const pair of ringFanAnglePolishPairEntries(coords, center).slice(0, 2)) {
        for (const stepFactor of RING_FAN_ANGLE_POLISH_STEP_FACTORS) {
          const step = bondLength * stepFactor;
          for (const candidateCoords of ringFanAnglePolishDirectedCandidateCoords(coords, center, pair, step)) {
            evaluateCandidateCoords(candidateCoords, [center.atomId, pair.firstAtomId, pair.secondAtomId]);
          }
        }
      }
    }

    for (const stepFactor of RING_FAN_ANGLE_POLISH_STEP_FACTORS) {
      const candidate = ringFanAnglePolishAggregateCandidate(
        layoutGraph,
        coords,
        centers,
        bondLength * stepFactor
      );
      if (candidate) {
        evaluateCandidateCoords(candidate.coords, candidate.atomIds);
      }
    }

    if (!bestCandidate) {
      break;
    }
    coords = bestCandidate.coords;
    currentScore = bestCandidate.score;
    currentAudit = bestCandidate.audit;
    for (const atomId of bestCandidate.atomIds) {
      movedAtomIds.add(atomId);
    }
    passes++;
  }

  const softContactLeafRetouch = runMacrocycleRingFanSoftContactLeafRetouch(
    layoutGraph,
    coords,
    currentScore,
    currentAudit,
    bondLength,
    auditOptions
  );
  if (softContactLeafRetouch.passes > 0) {
    coords = softContactLeafRetouch.coords;
    currentScore = softContactLeafRetouch.score;
    currentAudit = softContactLeafRetouch.audit;
    for (const atomId of softContactLeafRetouch.movedAtomIds) {
      movedAtomIds.add(atomId);
    }
    passes += softContactLeafRetouch.passes;
  }

  if (passes === 0) {
    return {
      changed: false,
      coords: inputCoords,
      movedAtomIds: [],
      passes: 0,
      maxDeviationBefore: initialScore.maxDeviationDegrees,
      maxDeviationAfter: initialScore.maxDeviationDegrees
    };
  }
  return {
    changed: true,
    coords,
    movedAtomIds: [...movedAtomIds],
    passes,
    maxDeviationBefore: initialScore.maxDeviationDegrees,
    maxDeviationAfter: currentScore.maxDeviationDegrees
  };
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
    const allowCenterPriorityRepair =
      visibleHeavyAtomCount(layoutGraph, visibleAtomIds) <= FINAL_ANGLE_POLISH_CENTER_PRIORITY_MAX_HEAVY_ATOMS;
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
            || (
              !finalAnglePolishCandidateIsBetter(candidateScore, currentScore)
              && (
                !allowCenterPriorityRepair
                || !finalAnglePolishCenterPriorityCandidateIsAllowed(
                  candidateScore,
                  currentScore,
                  entry.centerScore - candidateCenterScore.totalDeviation
                )
              )
            )
          ) {
            return null;
          }
          return {
            score: candidateScore,
            descriptor: entry.descriptor,
            centerImprovement: entry.centerScore - candidateCenterScore.totalDeviation,
            repairedMovedAtomIds: null
          };
        });
        let selectedCandidate = candidate;
        if (!selectedCandidate && allowCenterPriorityRepair) {
          selectedCandidate = withRotatedSubtree(layoutGraph, coords, entry.descriptor, angle, candidateCoords => {
            const candidateCenterScore = measureLocalAngleDeviation(layoutGraph, candidateCoords, entry.centerAtomId);
            if (
              !candidateCenterScore
              || candidateCenterScore.totalDeviation + FINAL_ANGLE_POLISH_MIN_CENTER_IMPROVEMENT >= entry.centerScore
            ) {
              return null;
            }
            const candidateScore = scoreCoords(layoutGraph, candidateCoords, bondLength, trackedAngularContexts, visibleAtomIds);
            const candidateCenterImprovement = entry.centerScore - candidateCenterScore.totalDeviation;
            if (!finalAnglePolishCandidateIsWorthRepair(
              candidateScore,
              currentScore,
              candidateCenterImprovement,
              allowCenterPriorityRepair
            )) {
              return null;
            }
            const repairedCandidate = repairCandidateResiduals(
              layoutGraph,
              rotateSubtree(coords, entry.descriptor, angle),
              candidateScore,
              bondLength,
              frozenAtomIds,
              trackedAngularContexts,
              visibleAtomIds,
              {
                includeNearbyContainingEndpointDescriptors: true,
                protectedMovedAtomIds: entry.protectedMovedAtomIds,
                maxPasses: 3
              }
            );
            const repairedCenterScore = measureLocalAngleDeviation(
              layoutGraph,
              repairedCandidate.coords,
              entry.centerAtomId
            );
            const repairedCenterImprovement = repairedCenterScore
              ? entry.centerScore - repairedCenterScore.totalDeviation
              : 0;
            if (
              !repairedCenterScore
              || (
                !finalAnglePolishCandidateIsBetter(repairedCandidate.score, currentScore)
                && (
                  !allowCenterPriorityRepair
                  || !finalAnglePolishCenterPriorityCandidateIsAllowed(
                    repairedCandidate.score,
                    currentScore,
                    repairedCenterImprovement
                  )
                )
              )
              || auditLayout(layoutGraph, repairedCandidate.coords, { bondLength }).ok !== true
            ) {
              return null;
            }
            return {
              score: repairedCandidate.score,
              descriptor: entry.descriptor,
              centerImprovement: repairedCenterImprovement,
              repairedCoords: repairedCandidate.coords,
              repairedMovedAtomIds: repairedCandidate.movedAtomIds
            };
          });
        }
        if (
          !selectedCandidate
          || (bestCandidate && !finalAnglePolishSelectionIsBetter(selectedCandidate, bestCandidate))
        ) {
          continue;
        }
        bestCandidate = {
          ...selectedCandidate,
          coords: selectedCandidate.repairedCoords ?? rotateSubtree(coords, entry.descriptor, angle)
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
    for (const atomId of bestCandidate.repairedMovedAtomIds ?? []) {
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
  const exactThreeHeavyProtectionCenterAtomIds = options._skipExactThreeHeavyProtectionRetry === true
    ? []
    : collectExactThreeHeavyProtectionCenters(layoutGraph, coords, trackedAngularContexts, initialScore);
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

  const harmedProtectionCenters = harmedExactThreeHeavyProtectionCenters(
    layoutGraph,
    coords,
    exactThreeHeavyProtectionCenterAtomIds,
    trackedAngularContexts
  );
  if (harmedProtectionCenters.length > 0) {
    const protectedCenterAtomIds = harmedProtectionCenters.map(({ atomId }) => atomId);
    const protectionFrozenAtomIds = exactThreeHeavyProtectionRetryFrozenAtomIds(
      layoutGraph,
      inputCoords,
      protectedCenterAtomIds
    );
    const retryFrozenAtomIds = mergeFrozenAtomIds(frozenAtomIds, protectionFrozenAtomIds);
    const retry = runLargeMoleculeResidualRetouch(layoutGraph, inputCoords, {
      ...options,
      frozenAtomIds: retryFrozenAtomIds,
      _skipExactThreeHeavyProtectionRetry: true
    });
    const retryScore = scoreCoords(layoutGraph, retry.coords, bondLength, trackedAngularContexts, visibleAtomIds);
    const retryProtectedDistortion = protectedCenterDistortionTotal(
      layoutGraph,
      retry.coords,
      protectedCenterAtomIds,
      trackedAngularContexts
    );
    const currentProtectedDistortion = protectedCenterDistortionTotal(
      layoutGraph,
      coords,
      protectedCenterAtomIds,
      trackedAngularContexts
    );
    if (
      retryScore.severeOverlapCount <= currentScore.severeOverlapCount
      && retryScore.visibleHeavyBondCrossingCount <= currentScore.visibleHeavyBondCrossingCount
      && retryProtectedDistortion + RETOUCH_SCORE_EPSILON < currentProtectedDistortion
      && auditLayout(layoutGraph, retry.coords, { bondLength }).ok === true
    ) {
      return retry;
    }
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
