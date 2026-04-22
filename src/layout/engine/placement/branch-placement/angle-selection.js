/** @module placement/branch-placement/angle-selection */

import { add, angleOf, angularDifference, centroid, distance, fromAngle, length, perpLeft, sub } from '../../geometry/vec2.js';
import { countPointInPolygons } from '../../geometry/polygon.js';
import { BRANCH_CLEARANCE_FLOOR_FACTOR } from '../../constants.js';
import {
  ANGLE_SCORE_TIEBREAK_RATIO,
  CENTERED_NEIGHBOR_EPSILON,
  CHAIN_CONTINUATION_OFFSET,
  CROSS_LIKE_HYPERVALENT_ELEMENTS,
  DEG15,
  DEG30,
  DEG60,
  DEG90,
  DEG120,
  DISCRETE_BRANCH_ANGLES,
  EXACT_SIMPLE_ACYCLIC_CONTINUATION_ELEMENTS,
  centerDistanceScore,
  isRingAnchor,
  neighborOrder,
  normalizeSignedAngle,
  placedNeighborIds
} from './shared.js';

/**
 * Returns the bond angles of all already placed neighbors around an anchor.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {Set<string>} _atomIdsToPlace - Eligible atom IDs for the current placement slice.
 * @returns {number[]} Occupied neighbor angles in radians.
 */
export function occupiedNeighborAngles(adjacency, coords, anchorAtomId, _atomIdsToPlace) {
  const occupiedAngles = [];
  for (const neighborAtomId of adjacency.get(anchorAtomId) ?? []) {
    if (!coords.has(neighborAtomId)) {
      continue;
    }
    occupiedAngles.push(angleOf(sub(coords.get(neighborAtomId), coords.get(anchorAtomId))));
  }
  return occupiedAngles;
}

function scoreCandidateAngle(candidateAngle, occupiedAngles, preferredAngles) {
  let minSeparation = Math.PI;
  for (const occ of occupiedAngles) {
    const d = angularDifference(candidateAngle, occ);
    if (d < minSeparation) { minSeparation = d; }
  }
  let preferredPenalty = 0;
  if (preferredAngles && preferredAngles.length > 0) {
    preferredPenalty = Infinity;
    for (const pref of preferredAngles) {
      const d = angularDifference(candidateAngle, pref);
      if (d < preferredPenalty) { preferredPenalty = d; }
    }
  }
  return minSeparation * 100 - preferredPenalty;
}

/**
 * Filters candidate angles through an optional anchor-specific angular budget.
 * @param {number[]} candidateAngles - Candidate angles in radians.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} branchConstraints - Optional branch constraints.
 * @returns {number[]} Candidate angles that satisfy the budget, or the original set when unconstrained.
 */
export function filterAnglesByBudget(candidateAngles, anchorAtomId, branchConstraints) {
  const budget = branchConstraints?.angularBudgets?.get(anchorAtomId);
  if (!budget) {
    return candidateAngles;
  }
  const filteredAngles = candidateAngles.filter(candidateAngle => {
    const offset = normalizeSignedAngle(candidateAngle - budget.centerAngle);
    return offset >= budget.minOffset - 1e-9 && offset <= budget.maxOffset + 1e-9;
  });
  return filteredAngles.length > 0 ? filteredAngles : candidateAngles;
}

/**
 * Returns any explicit preferred angle carried by an anchor-specific branch budget.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} branchConstraints - Optional branch constraints.
 * @returns {number[]} Preferred budget-derived angles.
 */
export function budgetPreferredAngles(anchorAtomId, branchConstraints) {
  const budget = branchConstraints?.angularBudgets?.get(anchorAtomId);
  if (!budget) {
    return [];
  }
  return [budget.preferredAngle ?? budget.centerAngle];
}

/**
 * Appends extra candidate angles while avoiding near-duplicate directions.
 * @param {number[]} baseAngles - Existing candidate angles.
 * @param {number[]} extraAngles - Extra candidate angles to append.
 * @returns {number[]} Deduplicated candidate angles.
 */
export function mergeCandidateAngles(baseAngles, extraAngles) {
  const mergedAngles = [...baseAngles];
  for (const extraAngle of extraAngles) {
    if (!mergedAngles.some(candidateAngle => angularDifference(candidateAngle, extraAngle) <= 1e-9)) {
      mergedAngles.push(extraAngle);
    }
  }
  return mergedAngles;
}

/**
 * Returns the bisector of the largest open angular gap between occupied bonds.
 * When multiple gaps tie, the bisector closest to an optional preferred angle wins.
 * @param {number[]} occupiedAngles - Occupied bond angles in radians.
 * @param {number|null} preferredAngle - Optional tie-break angle in radians.
 * @returns {number|null} Largest-gap bisector in radians, or null when unsupported.
 */
function largestAngularGapBisector(occupiedAngles, preferredAngle = null) {
  if (occupiedAngles.length === 0) {
    return null;
  }
  const sortedAngles = [...occupiedAngles]
    .map(normalizeSignedAngle)
    .sort((firstAngle, secondAngle) => firstAngle - secondAngle)
    .filter((angle, index, angles) => index === 0 || angularDifference(angle, angles[index - 1]) > 1e-9);

  if (sortedAngles.length === 0) {
    return null;
  }

  let bestBisector = null;
  let bestGap = -Infinity;
  let bestPenalty = Infinity;
  for (let index = 0; index < sortedAngles.length; index++) {
    const gapStart = sortedAngles[index];
    const nextIndex = (index + 1) % sortedAngles.length;
    let gapEnd = sortedAngles[nextIndex];
    if (nextIndex === 0) {
      gapEnd += 2 * Math.PI;
    }
    const gap = gapEnd - gapStart;
    const bisector = normalizeSignedAngle(gapStart + gap / 2);
    const preferredPenalty = preferredAngle == null ? 0 : angularDifference(bisector, preferredAngle);
    if (gap > bestGap + 1e-9 || (Math.abs(gap - bestGap) <= 1e-9 && preferredPenalty < bestPenalty - 1e-9)) {
      bestGap = gap;
      bestPenalty = preferredPenalty;
      bestBisector = bisector;
    }
  }
  return bestBisector;
}

/**
 * Resolves the preferred-angle set for an anchor, letting macrocycle budget
 * preferences override the generic ring-outward fallback when present.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {number[]} fallbackPreferredAngles - Existing preferred angles.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} branchConstraints - Optional branch constraints.
 * @returns {number[]} Preferred angles to score against.
 */
export function resolvedPreferredAngles(anchorAtomId, fallbackPreferredAngles, branchConstraints) {
  const budgetAngles = budgetPreferredAngles(anchorAtomId, branchConstraints);
  return budgetAngles.length > 0 ? budgetAngles : fallbackPreferredAngles;
}

/**
 * Chooses the best discrete angle from the preferred candidates only.
 * Attachment placement sometimes needs to preserve trigonal or ring-derived
 * continuation geometry rather than falling back to a wider but chemically
 * wrong direction from the full candidate set.
 * @param {number[]} preferredAngles - Preferred angles in radians.
 * @returns {number[]} Exact and snapped preferred angles.
 */
function buildPreferredCandidateAngles(preferredAngles = []) {
  return mergeCandidateAngles(preferredDiscreteAngles(preferredAngles), preferredAngles);
}

/**
 * Returns the finer rescue offsets around preferred angles.
 * These are intentionally separated from the primary candidate pool so branch
 * placement can exhaust the coarse/exact angles before exploring off-lattice
 * rescue directions.
 * @param {number[]} preferredAngles - Preferred angles in radians.
 * @returns {number[]} Fine-grained rescue angles.
 */
function buildFinePreferredCandidateAngles(preferredAngles = []) {
  return mergeCandidateAngles([], preferredAngles.flatMap(preferredAngle => [
    preferredAngle - DEG30,
    preferredAngle - DEG15,
    preferredAngle + DEG15,
    preferredAngle + DEG30
  ]));
}

function hasSafeCandidate(candidates) {
  return candidates.some(candidate => candidate.isSafe !== false);
}

function hasSafePreferredAngleInList(occupiedAngles, candidateAngles) {
  if (candidateAngles.length === 0) {
    return false;
  }
  return candidateAngles.some(candidateAngle => {
    if (occupiedAngles.length === 0) {
      return true;
    }
    let minSeparation = Infinity;
    for (const occ of occupiedAngles) {
      const d = angularDifference(candidateAngle, occ);
      if (d < minSeparation) { minSeparation = d; }
    }
    return minSeparation >= Math.PI / 6;
  });
}

function buildResolvedPreferredCandidateAngles(occupiedAngles, preferredAngles = [], allowFinePreferredAngles = false) {
  const primaryCandidateAngles = buildPreferredCandidateAngles(preferredAngles);
  if (
    !allowFinePreferredAngles
    || primaryCandidateAngles.length === 0
    || hasSafePreferredAngleInList(occupiedAngles, primaryCandidateAngles)
  ) {
    return primaryCandidateAngles;
  }
  return mergeCandidateAngles(primaryCandidateAngles, buildFinePreferredCandidateAngles(preferredAngles));
}

function choosePreferredCandidateAngle(occupiedAngles, preferredAngles = [], allowFinePreferredAngles = false) {
  const candidateAngles = buildResolvedPreferredCandidateAngles(occupiedAngles, preferredAngles, allowFinePreferredAngles);
  if (candidateAngles.length === 0) {
    return null;
  }

  let bestAngle = candidateAngles[0];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidateAngle of candidateAngles) {
    const score = scoreCandidateAngle(candidateAngle, occupiedAngles, preferredAngles);
    if (score > bestScore) {
      bestScore = score;
      bestAngle = candidateAngle;
    }
  }

  return bestAngle;
}

/**
 * Returns whether the preferred continuation candidates are clear enough to be
 * honored without forcing an obviously crowded attachment slot. Attachment
 * angle choice uses angular slot safety instead of point clearance because the
 * pending ring block can still rotate after this angle is chosen.
 * @param {number[]} occupiedAngles - Occupied neighbor angles.
 * @param {number[]} preferredAngles - Preferred angles in radians.
 * @param {boolean} [allowFinePreferredAngles] - Whether to add finer offsets around preferred angles after the primary pool fails.
 * @returns {boolean} True when a preferred candidate is acceptably separated.
 */
function hasSafePreferredCandidateAngle(occupiedAngles, preferredAngles = [], allowFinePreferredAngles = false) {
  return hasSafePreferredAngleInList(
    occupiedAngles,
    buildResolvedPreferredCandidateAngles(occupiedAngles, preferredAngles, allowFinePreferredAngles)
  );
}

function nearestDiscreteAngle(targetAngle) {
  let bestAngle = DISCRETE_BRANCH_ANGLES[0];
  let bestDifference = Number.POSITIVE_INFINITY;
  for (const candidateAngle of DISCRETE_BRANCH_ANGLES) {
    const difference = angularDifference(candidateAngle, targetAngle);
    if (difference < bestDifference) {
      bestDifference = difference;
      bestAngle = candidateAngle;
    }
  }
  return bestAngle;
}

function preferredDiscreteAngles(preferredAngles) {
  const uniqueAngles = new Set();
  for (const preferredAngle of preferredAngles) {
    uniqueAngles.add(nearestDiscreteAngle(preferredAngle));
  }
  return [...uniqueAngles];
}

/**
 * Returns the layout bond descriptor for an unordered atom pair.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} firstAtomId - First atom ID.
 * @param {string} secondAtomId - Second atom ID.
 * @returns {object|null} Matching bond descriptor, or `null`.
 */
export function findLayoutBond(layoutGraph, firstAtomId, secondAtomId) {
  if (!layoutGraph) {
    return null;
  }
  const key = firstAtomId < secondAtomId ? `${firstAtomId}:${secondAtomId}` : `${secondAtomId}:${firstAtomId}`;
  return layoutGraph.bondByAtomPair.get(key) ?? null;
}

/**
 * Returns whether an atom has any non-aromatic multiple bond.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID.
 * @returns {boolean} True when the atom has a double or triple bond.
 */
export function hasNonAromaticMultipleBond(layoutGraph, atomId) {
  if (!layoutGraph) {
    return false;
  }
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.aromatic) {
      continue;
    }
    if ((bond.order ?? 1) >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether an atom should be treated as an `sp`-like linear center.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom ID.
 * @returns {boolean} True when the center is effectively linear.
 */
export function isLinearCenter(layoutGraph, atomId) {
  if (!layoutGraph) {
    return false;
  }
  let doubleCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.aromatic) {
      continue;
    }
    const order = bond.order ?? 1;
    if (order >= 3) {
      return true;
    }
    if (order >= 2) {
      doubleCount++;
    }
  }
  return doubleCount >= 2;
}

/**
 * Returns whether a multiple-bond neighbor is a terminal heavy substituent leaf.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Central atom ID.
 * @param {object} bond - Incident bond descriptor.
 * @returns {boolean} True when the neighbor is a terminal heavy leaf.
 */
export function isTerminalMultipleBondLeaf(layoutGraph, centerAtomId, bond) {
  if (!layoutGraph || !bond || bond.kind !== 'covalent' || bond.aromatic) {
    return false;
  }
  if ((bond.order ?? 1) < 2) {
    return false;
  }

  const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
  if (!neighborAtom || neighborAtom.element === 'H') {
    return false;
  }
  return neighborAtom.heavyDegree === 1;
}

function isTerminalMultipleBondHetero(layoutGraph, centerAtomId, bond) {
  if (!isTerminalMultipleBondLeaf(layoutGraph, centerAtomId, bond)) {
    return false;
  }
  const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  return layoutGraph.atoms.get(neighborAtomId)?.element !== 'C';
}

/**
 * Returns whether a child is a terminal carbon single-bond leaf attached to
 * the current anchor. These bridgehead methyl-like leaves usually read best on
 * the local outward ring axis rather than inheriting the exact straight-through
 * continuation reserved for larger bridgehead exits and attached foreign ring
 * blocks.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {boolean} True when the child is a terminal carbon leaf.
 */
function isTerminalHeavyLeafSubstituent(layoutGraph, anchorAtomId, childAtomId) {
  if (!layoutGraph || !childAtomId) {
    return false;
  }

  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'C' || childAtom.heavyDegree !== 1) {
    return false;
  }

  const bond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  return Boolean(
    bond
    && bond.kind === 'covalent'
    && !bond.aromatic
    && (bond.order ?? 1) === 1
  );
}

/**
 * Returns whether a child is a single-bond exocyclic heavy substituent root on
 * a ring atom that should preserve the exact ring-outward angle. This stays
 * enabled for rigid or presentation-critical roots such as hetero atoms,
 * carbonyl/nitrile carbons, and terminal alkyl leaves, but not for flexible
 * alkyl-chain carbons where forcing the exact radial direction can distort the
 * preferred chain zig-zag coming off a heteroaryl or small aromatic ring.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {boolean} True when the child qualifies for exact ring-outward placement.
 */
export function isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, childAtomId) {
  if (!layoutGraph || !childAtomId) {
    return false;
  }
  if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!anchorAtom || !childAtom || childAtom.aromatic || childAtom.element === 'H') {
    return false;
  }
  if ((layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0) {
    return false;
  }

  const bond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
    return false;
  }
  if (!anchorAtom.aromatic) {
    return true;
  }
  if (childAtom.element !== 'C') {
    return true;
  }
  if (childAtom.heavyDegree <= 1) {
    return true;
  }
  for (const childBond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!childBond || childBond === bond || childBond.kind !== 'covalent') {
      continue;
    }
    if (!childBond.aromatic && (childBond.order ?? 1) >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether a simple acyclic center should preserve the exact preferred
 * continuation angle for its remaining heavy child instead of letting nearby
 * center-of-mass scoring cant the bond off that ideal slot. This keeps safe
 * off-grid 120-degree continuations exact for simple carbon and hetero
 * linkers, for divalent conjugated nitrogens such as amides, and for
 * non-ring vinylic trigonal centers when an upstream placement already
 * established the parent-bond direction.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} parentAtomId - Already placed parent atom ID.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {boolean} True when the anchor should honor the exact continuation.
 */
export function isExactSimpleAcyclicContinuationEligible(layoutGraph, anchorAtomId, parentAtomId, childAtomId) {
  if (!layoutGraph || !parentAtomId || !childAtomId) {
    return false;
  }
  if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (
    !anchorAtom
    || anchorAtom.aromatic
    || anchorAtom.heavyDegree !== 2
  ) {
    return false;
  }

  const isConjugatedTrigonalNeighbor = neighborAtomId => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtom.aromatic || neighborAtom.heavyDegree !== 3) {
      return false;
    }
    let heavyVisibleBondCount = 0;
    let nonAromaticMultipleBondCount = 0;
    for (const bond of layoutGraph.bondsByAtomId.get(neighborAtomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const otherAtomId = bond.a === neighborAtomId ? bond.b : bond.a;
      const otherAtom = layoutGraph.atoms.get(otherAtomId);
      if (!otherAtom || otherAtom.element === 'H') {
        continue;
      }
      heavyVisibleBondCount++;
      if (!bond.aromatic && (bond.order ?? 1) >= 2) {
        nonAromaticMultipleBondCount++;
      }
    }
    return heavyVisibleBondCount === 3 && nonAromaticMultipleBondCount === 1;
  };

  const exactEligibleElement =
    EXACT_SIMPLE_ACYCLIC_CONTINUATION_ELEMENTS.has(anchorAtom.element)
    || (
      anchorAtom.element === 'N'
      && (isConjugatedTrigonalNeighbor(parentAtomId) || isConjugatedTrigonalNeighbor(childAtomId))
    );
  if (!exactEligibleElement) {
    return false;
  }

  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    anchorAtom.element === 'O'
    && parentAtom?.aromatic
    && childAtom?.element === 'C'
    && (childAtom.heavyDegree ?? 0) > 1
  ) {
    return false;
  }

  const parentBond = findLayoutBond(layoutGraph, anchorAtomId, parentAtomId);
  const childBond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  if (
    !parentBond
    || !childBond
    || parentBond.kind !== 'covalent'
    || childBond.kind !== 'covalent'
    || parentBond.aromatic
    || childBond.aromatic
  ) {
    return false;
  }

  const parentOrder = parentBond.order ?? 1;
  const childOrder = childBond.order ?? 1;
  if (parentOrder === 1 && childOrder === 1) {
    return true;
  }

  const oneSingleAndOneMultiple =
    (parentOrder === 1 && childOrder >= 2)
    || (parentOrder >= 2 && childOrder === 1);
  if (!oneSingleAndOneMultiple || anchorAtom.element !== 'C') {
    return false;
  }

  const multipleBondNeighborId = parentOrder >= 2 ? parentAtomId : childAtomId;
  return layoutGraph.atoms.get(multipleBondNeighborId)?.element === 'C';
}

/**
 * Returns whether a child should keep the exact small-ring exterior slot that
 * matches the already placed ring bonds around a four-heavy small-ring anchor.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {boolean} True when the child is an exact small-ring exterior continuation.
 */
export function isExactSmallRingExteriorContinuationEligible(layoutGraph, anchorAtomId, childAtomId) {
  if (!layoutGraph || !childAtomId) {
    return false;
  }
  const descriptor = describeSmallRingExteriorSpreadAnchor(layoutGraph, anchorAtomId);
  return Boolean(descriptor && descriptor.exocyclicNeighborIds.includes(childAtomId));
}

/**
 * Returns whether a ring trigonal center should preserve the exact bisector for
 * an exocyclic non-aromatic multiple bond. These exocyclic alkene/lactam-like
 * exits are visually sensitive: snapping them to the 30-degree lattice can
 * collapse the remaining local trigonal gap against a ring neighbor even when
 * the exact outward bisector is already safe.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {boolean} True when the exact trigonal bisector should be honored.
 */
export function isExactRingTrigonalBisectorEligible(layoutGraph, anchorAtomId, childAtomId) {
  if (!layoutGraph || !childAtomId) {
    return false;
  }
  if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0 || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || anchorAtom.aromatic || anchorAtom.element !== 'C' || anchorAtom.heavyDegree !== 3) {
    return false;
  }

  const childBond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  if (!childBond || childBond.kind !== 'covalent' || childBond.aromatic || (childBond.order ?? 1) < 2) {
    return false;
  }

  let ringNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (neighborAtomId !== childAtomId && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0) {
      ringNeighborCount++;
    }
  }
  return ringNeighborCount === 2;
}

/**
 * Returns whether a preferred continuation angle at a ring anchor should be
 * promoted into the candidate set directly, rather than used only as a soft
 * scoring preference against the discrete branch lattice.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {boolean} True when the preferred angle should be tried directly.
 */
export function shouldPromotePreferredRingAngle(layoutGraph, anchorAtomId, childAtomId) {
  if (!isRingAnchor(layoutGraph, anchorAtomId) || !childAtomId) {
    return true;
  }
  const anchorAtom = layoutGraph?.atoms?.get(anchorAtomId);
  if (anchorAtom && !anchorAtom.aromatic) {
    return true;
  }
  return isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, childAtomId)
    || isExactSmallRingExteriorContinuationEligible(layoutGraph, anchorAtomId, childAtomId);
}

/**
 * Describes a cross-like hypervalent main-group center when one is present.
 * These centers conventionally read as a 2D cross with single bonds opposite
 * each other and terminal multiple-bond hetero substituents perpendicular.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate center atom ID.
 * @returns {{kind: 'bis-oxo'|'mono-oxo', singleNeighborIds: string[], multipleNeighborIds: string[]}|null} Cross-like center descriptor or `null`.
 */
export function describeCrossLikeHypervalentCenter(layoutGraph, atomId) {
  if (!layoutGraph) {
    return null;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || !CROSS_LIKE_HYPERVALENT_ELEMENTS.has(atom.element)) {
    return null;
  }

  const singleNeighborIds = [];
  const multipleNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent' || bond.aromatic) {
      return null;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    const order = bond.order ?? 1;
    if (order === 1) {
      singleNeighborIds.push(neighborAtomId);
      continue;
    }
    if (isTerminalMultipleBondHetero(layoutGraph, atomId, bond)) {
      multipleNeighborIds.push(neighborAtomId);
      continue;
    }
    return null;
  }

  if (singleNeighborIds.length === 2 && multipleNeighborIds.length === 2) {
    return {
      kind: 'bis-oxo',
      singleNeighborIds,
      multipleNeighborIds
    };
  }
  if (singleNeighborIds.length === 3 && multipleNeighborIds.length === 1) {
    return {
      kind: 'mono-oxo',
      singleNeighborIds,
      multipleNeighborIds
    };
  }
  return null;
}

function preferredRingSystemAngle(layoutGraph, coords, anchorAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId)) {
    return null;
  }
  const anchorPosition = coords.get(anchorAtomId);
  const ringSystemId = layoutGraph.atomToRingSystemId?.get(anchorAtomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystems.find(rs => rs.id === ringSystemId) : null;
  if (!ringSystem) {
    return null;
  }
  const placedRingSystemPositions = ringSystem.atomIds.filter(atomId => coords.has(atomId)).map(atomId => coords.get(atomId));
  if (placedRingSystemPositions.length < 3) {
    return null;
  }
  const ringSystemCenter = centroid(placedRingSystemPositions);
  const outwardVector = sub(anchorPosition, ringSystemCenter);
  if (length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON) {
    return null;
  }
  return angleOf(outwardVector);
}

function incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId)) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  const ringAngles = [];
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    const placedRingPositions = ring.atomIds.filter(atomId => coords.has(atomId)).map(atomId => coords.get(atomId));
    if (placedRingPositions.length < 3) {
      continue;
    }
    const ringCenter = centroid(placedRingPositions);
    const outwardVector = sub(anchorPosition, ringCenter);
    if (length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON) {
      continue;
    }
    if (!ringAngles.some(ringAngle => angularDifference(ringAngle, angleOf(outwardVector)) <= 1e-9)) {
      ringAngles.push(angleOf(outwardVector));
    }
  }
  return ringAngles;
}

function shouldPreferUniqueIncidentRingOutwardAngle(layoutGraph, coords, anchorAtomId, childAtomId) {
  if (
    !layoutGraph
    || !childAtomId
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) <= 1
    || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'C' || childAtom.aromatic === true) {
    return false;
  }

  const childBond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  if (
    !childBond
    || childBond.kind !== 'covalent'
    || childBond.inRing
    || childBond.aromatic
    || (childBond.order ?? 1) !== 1
  ) {
    return false;
  }

  return incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId).length === 1;
}

function shouldPreferTerminalLeafLocalOutwardOverStraightJunction(layoutGraph, coords, anchorAtomId, childAtomId, straightJunctionAngle) {
  if (
    !straightJunctionAngle
    && straightJunctionAngle !== 0
    || !isTerminalHeavyLeafSubstituent(layoutGraph, anchorAtomId, childAtomId)
  ) {
    return false;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const localOutwardAngles = (layoutGraph.atomToRings.get(anchorAtomId) ?? []).flatMap(ring => {
    const placedRingPositions = ring.atomIds.filter(atomId => coords.has(atomId)).map(atomId => coords.get(atomId));
    if (placedRingPositions.length < 3) {
      return [];
    }
    const outwardVector = sub(anchorPosition, centroid(placedRingPositions));
    return length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON ? [] : [angleOf(outwardVector)];
  });
  if (localOutwardAngles.length < 2) {
    return false;
  }

  let localOutwardSpread = 0;
  for (let firstIndex = 0; firstIndex < localOutwardAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < localOutwardAngles.length; secondIndex++) {
      localOutwardSpread = Math.max(
        localOutwardSpread,
        angularDifference(localOutwardAngles[firstIndex], localOutwardAngles[secondIndex])
      );
    }
  }
  if (localOutwardSpread > DEG30 + 1e-6) {
    return false;
  }

  return Math.min(...localOutwardAngles.map(angle => angularDifference(angle, straightJunctionAngle))) >= DEG30 - 1e-6;
}

function shouldPreferSimpleChainLocalOutwardOverStraightJunction(layoutGraph, coords, anchorAtomId, childAtomId, straightJunctionAngle) {
  if (
    (!straightJunctionAngle && straightJunctionAngle !== 0)
    || !layoutGraph
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) <= 1
    || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'C' || childAtom.aromatic === true || childAtom.heavyDegree !== 2) {
    return false;
  }

  for (const bond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === childAtomId ? bond.b : bond.a;
    if (neighborAtomId === anchorAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
  }

  const anchorPosition = coords.get(anchorAtomId);
  const localOutwardAngles = (layoutGraph.atomToRings.get(anchorAtomId) ?? []).flatMap(ring => {
    const placedRingPositions = ring.atomIds.filter(atomId => coords.has(atomId)).map(atomId => coords.get(atomId));
    if (placedRingPositions.length < 3) {
      return [];
    }
    const outwardVector = sub(anchorPosition, centroid(placedRingPositions));
    return length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON ? [] : [angleOf(outwardVector)];
  });
  if (localOutwardAngles.length < 2) {
    return false;
  }

  let localOutwardSpread = 0;
  for (let firstIndex = 0; firstIndex < localOutwardAngles.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < localOutwardAngles.length; secondIndex++) {
      localOutwardSpread = Math.max(
        localOutwardSpread,
        angularDifference(localOutwardAngles[firstIndex], localOutwardAngles[secondIndex])
      );
    }
  }
  if (localOutwardSpread > DEG30 + 1e-6) {
    return false;
  }

  return Math.min(...localOutwardAngles.map(angle => angularDifference(angle, straightJunctionAngle))) >= DEG30 - 1e-6;
}

/**
 * Returns whether a child attached to a ring anchor is itself a ring atom from
 * a different ring system reached through an exocyclic single bond. These
 * attached ring blocks should inherit the same fused-junction continuation
 * preference as ordinary heavy substituents at shared junction atoms.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Ring anchor atom ID.
 * @param {string|null} childAtomId - Candidate child atom ID.
 * @returns {boolean} True when the child is a direct-attached foreign ring atom.
 */
function isDirectAttachedForeignRingChild(layoutGraph, anchorAtomId, childAtomId) {
  if (!layoutGraph || !childAtomId) {
    return false;
  }

  const childRingCount = layoutGraph.atomToRings.get(childAtomId)?.length ?? 0;
  if (childRingCount === 0) {
    return false;
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const childRingSystemId = layoutGraph.atomToRingSystemId.get(childAtomId);
  if (anchorRingSystemId == null || childRingSystemId == null || anchorRingSystemId === childRingSystemId) {
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

/**
 * Returns the exact straight-through continuation angle for a directly
 * attached foreign ring block when a shared fused-junction bond defines a
 * clear exterior exit. This extends the same exact-gap rule used for ordinary
 * heavy substituents to exocyclic attached ring systems.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Ring-junction anchor atom ID.
 * @param {string|null} childAtomId - Direct-attached foreign ring atom ID.
 * @returns {number|null} Exact continuation angle in radians, or `null`.
 */
export function directAttachedForeignRingJunctionContinuationAngle(layoutGraph, coords, anchorAtomId, childAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId) || !childAtomId) {
    return null;
  }
  if (!isDirectAttachedForeignRingChild(layoutGraph, anchorAtomId, childAtomId)) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  const ringNeighborIds = [];
  const ringNeighborAngles = [];
  for (const neighborAtom of layoutGraph.sourceMolecule.atoms.get(anchorAtomId)?.getNeighbors(layoutGraph.sourceMolecule) ?? []) {
    if (!neighborAtom || neighborAtom.name === 'H' || neighborAtom.id === childAtomId || !coords.has(neighborAtom.id)) {
      continue;
    }
    if ((layoutGraph.atomToRings.get(neighborAtom.id)?.length ?? 0) === 0) {
      continue;
    }
    ringNeighborIds.push(neighborAtom.id);
    ringNeighborAngles.push(angleOf(sub(coords.get(neighborAtom.id), anchorPosition)));
  }
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
  const straightJunctionClearance = Math.min(
    ...ringNeighborAngles.map(occupiedAngle => angularDifference(straightJunctionAngle, occupiedAngle))
  );
  return straightJunctionClearance >= DEG60 - 1e-6 ? straightJunctionAngle : null;
}

/**
 * Returns the exact shared-junction continuation angle currently preferred for
 * a branch leaving a crowded ring-junction anchor. This generalizes the
 * branch-placement shared-junction rule so cleanup scoring can protect both
 * direct-attached foreign rings and non-ring exocyclic junction exits that
 * should stay on the same exact straight-through slot once it is already
 * available.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Ring-junction anchor atom ID.
 * @param {string|null} childAtomId - Candidate branch child atom ID.
 * @returns {number|null} Exact continuation angle in radians, or `null`.
 */
export function preferredSharedJunctionContinuationAngle(layoutGraph, coords, anchorAtomId, childAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId) || !childAtomId || !coords.has(childAtomId)) {
    return null;
  }

  const placedNeighborIdsList = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    if (neighborAtomId === childAtomId || !coords.has(neighborAtomId)) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    placedNeighborIdsList.push(neighborAtomId);
  }

  return preferredRingJunctionGapAngle(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId);
}

function preferredRingJunctionGapAngle(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId) || !childAtomId) {
    return null;
  }
  const childParticipatesInForeignAttachedRing = isDirectAttachedForeignRingChild(layoutGraph, anchorAtomId, childAtomId);
  if (
    (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0
    || (
      (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0
      && !childParticipatesInForeignAttachedRing
    )
  ) {
    return null;
  }
  if (childParticipatesInForeignAttachedRing) {
    return directAttachedForeignRingJunctionContinuationAngle(layoutGraph, coords, anchorAtomId, childAtomId);
  }

  const ringNeighborIds = placedNeighborIdsList.filter(neighborAtomId => (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0);
  if (ringNeighborIds.length < 3 || ringNeighborIds.length !== placedNeighborIdsList.length) {
    return null;
  }
  const ringNeighborAngles = ringNeighborIds
    .map(neighborAtomId => coords.get(neighborAtomId))
    .filter(Boolean)
    .map(neighborPosition => angleOf(sub(neighborPosition, coords.get(anchorAtomId))));
  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  const sharedJunctionNeighborIds = ringNeighborIds.filter(neighborAtomId => {
    const neighborRings = layoutGraph.atomToRings.get(neighborAtomId) ?? [];
    return neighborRings.filter(ring => anchorRings.includes(ring)).length > 1;
  });
  if (sharedJunctionNeighborIds.length === 1 && coords.has(sharedJunctionNeighborIds[0])) {
    const sharedNeighborAngle = angleOf(sub(coords.get(sharedJunctionNeighborIds[0]), coords.get(anchorAtomId)));
    const straightJunctionAngle = normalizeSignedAngle(sharedNeighborAngle + Math.PI);
    const straightJunctionClearance = Math.min(...ringNeighborAngles.map(occupiedAngle => angularDifference(straightJunctionAngle, occupiedAngle)));
    if (straightJunctionClearance >= DEG60 - 1e-6) {
      if (shouldPreferTerminalLeafLocalOutwardOverStraightJunction(layoutGraph, coords, anchorAtomId, childAtomId, straightJunctionAngle)) {
        return null;
      }
      if (shouldPreferSimpleChainLocalOutwardOverStraightJunction(layoutGraph, coords, anchorAtomId, childAtomId, straightJunctionAngle)) {
        return null;
      }
      return straightJunctionAngle;
    }
  }
  return largestAngularGapBisector(ringNeighborAngles, preferredRingSystemAngle(layoutGraph, coords, anchorAtomId));
}

function preferredRingAngles(layoutGraph, coords, anchorAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId)) {
    return [];
  }
  const ringAngles = incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId);
  const ringSystemAngle = preferredRingSystemAngle(layoutGraph, coords, anchorAtomId);
  if (ringSystemAngle != null) {
    return mergeCandidateAngles(ringAngles, [ringSystemAngle]);
  }
  return ringAngles;
}

function prefersLinearContinuation(layoutGraph, anchorAtomId, parentAtomId, childAtomId) {
  if (!layoutGraph || !parentAtomId || !childAtomId) {
    return false;
  }
  const parentBond = findLayoutBond(layoutGraph, anchorAtomId, parentAtomId);
  const childBond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  return (parentBond?.order ?? 1) >= 3 || (childBond?.order ?? 1) >= 3;
}

function crossZ(firstVector, secondVector) {
  return firstVector.x * secondVector.y - firstVector.y * secondVector.x;
}

function isSimpleSingleBondCarbon(atom) {
  return Boolean(atom) && atom.element === 'C' && atom.aromatic !== true;
}

function isSimpleAlkylContinuationEligible(layoutGraph, anchorAtomId, parentAtomId, childAtomId) {
  if (!layoutGraph || !parentAtomId || !childAtomId) {
    return false;
  }
  if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0 || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const parentAtom = layoutGraph.atoms.get(parentAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!isSimpleSingleBondCarbon(anchorAtom) || !isSimpleSingleBondCarbon(childAtom) || !parentAtom || parentAtom.element === 'H' || parentAtom.aromatic === true) {
    return false;
  }
  if ((anchorAtom.heavyDegree ?? 0) < 2 || (anchorAtom.heavyDegree ?? 0) > 3) {
    return false;
  }

  const parentBond = findLayoutBond(layoutGraph, anchorAtomId, parentAtomId);
  const childBond = findLayoutBond(layoutGraph, anchorAtomId, childAtomId);
  if (!parentBond || !childBond || parentBond.kind !== 'covalent' || childBond.kind !== 'covalent') {
    return false;
  }
  if (parentBond.aromatic || childBond.aromatic || (parentBond.order ?? 1) !== 1 || (childBond.order ?? 1) !== 1) {
    return false;
  }

  for (const atomId of [parentAtomId, anchorAtomId, childAtomId]) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (bond?.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Returns preferred zigzag continuation angles for a simple alkyl tail growing
 * away from an already placed parent context. The alternating slot remains the
 * primary preference, but the mirrored zigzag slot is kept as a secondary
 * preference so crowded ring-adjacent tails do not collapse all the way to a
 * straight continuation when only the primary zigzag direction is blocked.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Current chain atom ID.
 * @param {string|null} parentAtomId - Already placed parent atom ID.
 * @param {string|null} childAtomId - Child atom being placed.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @returns {number[]} Preferred tail-continuation angles in radians.
 */
function preferredAlkylTailAngles(adjacency, coords, anchorAtomId, parentAtomId, childAtomId, layoutGraph) {
  if (!isSimpleAlkylContinuationEligible(layoutGraph, anchorAtomId, parentAtomId, childAtomId)) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  const parentPosition = coords.get(parentAtomId);
  if (!anchorPosition || !parentPosition) {
    return [];
  }

  const parentContextPositions = neighborOrder(
    (adjacency.get(parentAtomId) ?? []).filter(neighborAtomId => {
      if (neighborAtomId === anchorAtomId || !coords.has(neighborAtomId)) {
        return false;
      }
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return neighborAtom && neighborAtom.element !== 'H';
    }),
    layoutGraph.canonicalAtomRank ?? new Map()
  ).map(neighborAtomId => coords.get(neighborAtomId));

  if (parentContextPositions.length === 0) {
    return [];
  }

  const referencePosition = parentContextPositions.length === 1 ? parentContextPositions[0] : centroid(parentContextPositions);
  const previousVector = sub(parentPosition, referencePosition);
  const incomingVector = sub(anchorPosition, parentPosition);
  if (length(previousVector) <= CENTERED_NEIGHBOR_EPSILON || length(incomingVector) <= CENTERED_NEIGHBOR_EPSILON) {
    return [];
  }

  const previousTurn = Math.sign(crossZ(previousVector, incomingVector));
  if (previousTurn === 0) {
    return [];
  }

  const forwardAngle = angleOf(incomingVector);
  const candidateAngles = [forwardAngle + CHAIN_CONTINUATION_OFFSET, forwardAngle - CHAIN_CONTINUATION_OFFSET];
  const alternatingAngles = candidateAngles.filter(candidateAngle => {
    const candidateVector = fromAngle(candidateAngle, 1);
    return Math.sign(crossZ(incomingVector, candidateVector)) === -previousTurn;
  });
  return alternatingAngles.length > 0 ? mergeCandidateAngles(alternatingAngles, candidateAngles) : candidateAngles;
}

function candidateClearanceScore(anchorPosition, candidateAngle, bondLength, coords, excludedAtomIds) {
  const candidatePosition = add(anchorPosition, fromAngle(candidateAngle, bondLength));
  let minDistance = Number.POSITIVE_INFINITY;
  for (const [atomId, position] of coords) {
    if (excludedAtomIds.has(atomId)) {
      continue;
    }
    minDistance = Math.min(minDistance, distance(candidatePosition, position));
  }
  return Number.isFinite(minDistance) ? minDistance : 0;
}

function isCandidateSafe(anchorPosition, candidateAngle, bondLength, coords, excludedAtomIds, atomGrid = null) {
  const clearanceFloor = bondLength * BRANCH_CLEARANCE_FLOOR_FACTOR;
  const clearanceFloorSq = clearanceFloor * clearanceFloor;
  const candidatePosition = add(anchorPosition, fromAngle(candidateAngle, bondLength));
  if (atomGrid) {
    for (const atomId of atomGrid.queryRadius(candidatePosition, clearanceFloor)) {
      if (excludedAtomIds.has(atomId)) {
        continue;
      }
      const position = coords.get(atomId);
      if (!position) {
        continue;
      }
      const dx = candidatePosition.x - position.x;
      const dy = candidatePosition.y - position.y;
      if (dx * dx + dy * dy < clearanceFloorSq) {
        return false;
      }
    }
    return true;
  }
  for (const [atomId, position] of coords) {
    if (excludedAtomIds.has(atomId)) {
      continue;
    }
    const dx = candidatePosition.x - position.x;
    const dy = candidatePosition.y - position.y;
    if (dx * dx + dy * dy < clearanceFloorSq) {
      return false;
    }
  }
  return true;
}

const OMITTED_HYDROGEN_EXACT_CLEARANCE_FACTOR = 0.5;

function preferredTrigonalBisectorAngle(coords, anchorAtomId, placedNeighborIdsList) {
  if (placedNeighborIdsList.length !== 2 || !coords.has(anchorAtomId)) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const neighborPositions = placedNeighborIdsList.map(neighborAtomId => coords.get(neighborAtomId)).filter(Boolean);
  if (neighborPositions.length !== 2) {
    return null;
  }

  const neighborCenter = centroid(neighborPositions);
  const outwardVector = sub(anchorPosition, neighborCenter);
  if (length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON) {
    const neighborAxis = sub(neighborPositions[1], neighborPositions[0]);
    const perpendicular = perpLeft(neighborAxis);
    if (length(perpendicular) <= CENTERED_NEIGHBOR_EPSILON) {
      return null;
    }
    return angleOf(perpendicular);
  }

  return angleOf(outwardVector);
}

/**
 * Returns whether a hidden-hydrogen saturated carbon should keep its visible
 * three-heavy spread on the exact trigonal bisector.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Candidate center atom ID.
 * @returns {boolean} True when the center should prefer an omitted-H trigonal bisector.
 */
export function shouldPreferOmittedHydrogenTrigonalBisector(layoutGraph, anchorAtomId) {
  if (!layoutGraph) {
    return false;
  }

  const atom = layoutGraph.atoms.get(anchorAtomId);
  if (
    !atom
    || atom.element !== 'C'
    || atom.aromatic
    || layoutGraph.options.suppressH !== true
    || atom.heavyDegree !== 3
    || atom.degree !== 4
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
  }
  return true;
}

/**
 * Returns the placed incident-ring polygons for a branch anchor.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom identifier.
 * @returns {Array<Array<{x: number, y: number}>>} Incident ring polygons.
 */
export function incidentRingPolygons(layoutGraph, coords, anchorAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId)) {
    return [];
  }
  return (layoutGraph.atomToRings.get(anchorAtomId) ?? []).map(ring => ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean)).filter(polygon => polygon.length >= 3);
}

/**
 * Chooses the best branch angle from pre-scored candidate directions.
 * @param {Array<{angle: number, angleScore: number, clearanceScore: number, centerDistanceScore: number, insideRingCount?: number, minSeparation?: number}>} candidates - Candidate descriptors.
 * @param {number} bondLength - Target bond length.
 * @param {boolean} [preferClearance] - Whether to prefer candidates that satisfy the standard clearance floor.
 * @param {{anchorPosition: {x: number, y: number}, coords: Map<string, {x: number, y: number}>, excludedAtomIds: Set<string>}|null} [clearanceContext] - Lazy exact-clearance context.
 * @returns {number} Winning angle in radians.
 */
export function pickBestCandidateAngle(candidates, bondLength, preferClearance = true, clearanceContext = null) {
  if (candidates.length === 0) {
    return DISCRETE_BRANCH_ANGLES[0];
  }

  const safeCandidates = preferClearance && bondLength > 0 ? candidates.filter(candidate => candidate.isSafe !== false) : candidates;
  const clearanceCandidates = safeCandidates.length > 0 ? safeCandidates : candidates;
  let minimumInsideRingCount = clearanceCandidates[0].insideRingCount ?? 0;
  for (let i = 1; i < clearanceCandidates.length; i++) { const v = clearanceCandidates[i].insideRingCount ?? 0; if (v < minimumInsideRingCount) { minimumInsideRingCount = v; } }
  const candidatesToConsider = clearanceCandidates.filter(candidate => (candidate.insideRingCount ?? 0) === minimumInsideRingCount);
  let bestAngleScore = candidatesToConsider[0].angleScore;
  for (let i = 1; i < candidatesToConsider.length; i++) { if (candidatesToConsider[i].angleScore > bestAngleScore) { bestAngleScore = candidatesToConsider[i].angleScore; } }
  const scoreTolerance = Math.max(Math.abs(bestAngleScore) * ANGLE_SCORE_TIEBREAK_RATIO, 1e-9);
  const nearBestCandidates = candidatesToConsider.filter(candidate => candidate.angleScore >= bestAngleScore - scoreTolerance);
  if (clearanceContext) {
    for (const candidate of nearBestCandidates) {
      if (!Number.isFinite(candidate.clearanceScore)) {
        candidate.clearanceScore = candidateClearanceScore(clearanceContext.anchorPosition, candidate.angle, bondLength, clearanceContext.coords, clearanceContext.excludedAtomIds);
      }
    }
  }

  let bestCandidate = nearBestCandidates[0];
  for (let index = 1; index < nearBestCandidates.length; index++) {
    const candidate = nearBestCandidates[index];
    if (candidate.centerDistanceScore > bestCandidate.centerDistanceScore) {
      bestCandidate = candidate;
      continue;
    }
    if (candidate.centerDistanceScore === bestCandidate.centerDistanceScore && candidate.clearanceScore > bestCandidate.clearanceScore) {
      bestCandidate = candidate;
      continue;
    }
    if (
      candidate.centerDistanceScore === bestCandidate.centerDistanceScore &&
      candidate.clearanceScore === bestCandidate.clearanceScore &&
      candidate.angleScore > bestCandidate.angleScore
    ) {
      bestCandidate = candidate;
    }
  }

  return bestCandidate.angle;
}

/**
 * Scores candidate branch angles against occupied directions, placement CoM, and incident ring faces.
 * @param {number[]} candidateAngles - Candidate angles in radians.
 * @param {number[]} occupiedAngles - Occupied neighbor angles.
 * @param {number[]} preferredAngles - Preferred angles.
 * @param {{x: number, y: number}} anchorPosition - Anchor position.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Set<string>} excludedAtomIds - Atoms to ignore when scoring clearance.
 * @param {{sumX: number, sumY: number, count: number}} placementState - Running placement CoM state.
 * @param {Array<Array<{x: number, y: number}>>} [ringPolygons] - Incident ring polygons.
 * @param {object|null} [atomGrid] - Optional spatial grid used for clearance checks.
 * @returns {Array<{angle: number, angleScore: number, clearanceScore: number|null, centerDistanceScore: number, insideRingCount: number, minSeparation: number, isSafe: boolean}>} Scored candidates.
 */
export function evaluateAngleCandidates(candidateAngles, occupiedAngles, preferredAngles, anchorPosition, bondLength, coords, excludedAtomIds, placementState, ringPolygons = [], atomGrid = null) {
  return candidateAngles.map(candidateAngle => {
    const candidatePosition = add(anchorPosition, fromAngle(candidateAngle, bondLength));
    return {
      minSeparation: (() => { let m = Math.PI; for (const occ of occupiedAngles) { const d = angularDifference(candidateAngle, occ); if (d < m) { m = d; } } return m; })(),
      angle: candidateAngle,
      angleScore: scoreCandidateAngle(candidateAngle, occupiedAngles, preferredAngles),
      clearanceScore: null,
      centerDistanceScore: centerDistanceScore(placementState, candidatePosition),
      insideRingCount: countPointInPolygons(ringPolygons, candidatePosition),
      isSafe: isCandidateSafe(anchorPosition, candidateAngle, bondLength, coords, excludedAtomIds, atomGrid)
    };
  });
}

/**
 * Chooses a continuation angle while preferring safe ring-exterior directions when available.
 * @param {{x: number, y: number}} anchorPosition - Anchor position.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number[]} occupiedAngles - Occupied neighbor angles.
 * @param {number[]} preferredAngles - Preferred continuation angles.
 * @param {number[]} candidateAngles - Candidate continuation angles after applying any optional budget.
 * @param {Set<string>} excludedAtomIds - Atoms to ignore during clearance scoring.
 * @param {{sumX: number, sumY: number, count: number}} placementState - Running placement CoM state.
 * @param {Array<Array<{x: number, y: number}>>} [ringPolygons] - Incident ring polygons.
 * @param {boolean} [allowFinePreferredAngles] - Whether to add finer offsets around preferred angles.
 * @param {boolean} [allowDirectPreferredAngle] - Whether to try the preferred angle itself as a direct candidate.
 * @param {object|null} [atomGrid] - Optional spatial grid used for clearance checks.
 * @returns {number} Chosen continuation angle in radians.
 */
export function chooseContinuationAngle(
  anchorPosition,
  bondLength,
  coords,
  occupiedAngles,
  preferredAngles,
  candidateAngles,
  excludedAtomIds,
  placementState,
  ringPolygons = [],
  allowFinePreferredAngles = false,
  allowDirectPreferredAngle = true,
  atomGrid = null
) {
  const clearanceContext = {
    anchorPosition,
    coords,
    excludedAtomIds
  };
  const preferredCandidateAngles = allowDirectPreferredAngle ? buildPreferredCandidateAngles(preferredAngles) : [];
  if (preferredCandidateAngles.length > 0) {
    const preferredCandidates = evaluateAngleCandidates(
      preferredCandidateAngles,
      occupiedAngles,
      preferredAngles,
      anchorPosition,
      bondLength,
      coords,
      excludedAtomIds,
      placementState,
      ringPolygons,
      atomGrid
    );
    const safePreferredCandidates = preferredCandidates.filter(candidate => candidate.isSafe !== false);
    let bestPreferredInsideRingCount = Number.POSITIVE_INFINITY;
    let bestPreferredSeparation = 0;
    if (safePreferredCandidates.length > 0) {
      bestPreferredInsideRingCount = safePreferredCandidates[0].insideRingCount ?? 0;
      bestPreferredSeparation = safePreferredCandidates[0].minSeparation ?? 0;
      for (let i = 1; i < safePreferredCandidates.length; i++) {
        const v = safePreferredCandidates[i].insideRingCount ?? 0;
        if (v < bestPreferredInsideRingCount) { bestPreferredInsideRingCount = v; }
        const s = safePreferredCandidates[i].minSeparation ?? 0;
        if (s > bestPreferredSeparation) { bestPreferredSeparation = s; }
      }
    }
    if (safePreferredCandidates.length > 0 && bestPreferredInsideRingCount === 0 && bestPreferredSeparation >= Math.PI / 6) {
      return pickBestCandidateAngle(safePreferredCandidates, bondLength, true, clearanceContext);
    }
  }
  const primaryCandidates = evaluateAngleCandidates(
    mergeCandidateAngles(candidateAngles, preferredCandidateAngles),
    occupiedAngles,
    preferredAngles,
    anchorPosition,
    bondLength,
    coords,
    excludedAtomIds,
    placementState,
    ringPolygons,
    atomGrid
  );
  if (hasSafeCandidate(primaryCandidates) || !allowFinePreferredAngles || preferredCandidateAngles.length === 0) {
    return pickBestCandidateAngle(primaryCandidates, bondLength, true, clearanceContext);
  }

  return pickBestCandidateAngle(
    evaluateAngleCandidates(
      mergeCandidateAngles(
        mergeCandidateAngles(candidateAngles, preferredCandidateAngles),
        buildFinePreferredCandidateAngles(preferredAngles)
      ),
      occupiedAngles,
      preferredAngles,
      anchorPosition,
      bondLength,
      coords,
      excludedAtomIds,
      placementState,
      ringPolygons,
      atomGrid
    ),
    bondLength,
    true,
    clearanceContext
  );
}

/**
 * Chooses the exact preferred angle when it is already safe and outside any incident ring face.
 * This is used for cases where the exact preferred direction is chemically
 * meaningful, such as ring-outward leaf substituents and terminal multiple-bond
 * leaves on trigonal centers, so they can follow the true idealized direction
 * instead of snapping to the discrete branch lattice.
 * @param {{x: number, y: number}} anchorPosition - Anchor position.
 * @param {number} bondLength - Target bond length.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number[]} occupiedAngles - Occupied neighbor angles.
 * @param {number[]} preferredAngles - Preferred exact continuation angles.
 * @param {Set<string>} excludedAtomIds - Atoms to ignore during clearance scoring.
 * @param {{sumX: number, sumY: number, count: number}|null} placementState - Running placement CoM state.
 * @param {Array<Array<{x: number, y: number}>>} [ringPolygons] - Incident ring polygons.
 * @param {object|null} [atomGrid] - Optional spatial grid used for clearance checks.
 * @param {{clearanceFloorFactor?: number, minimumSeparation?: number}} [options] - Optional exact-angle safety overrides.
 * @returns {number|null} Safe exact preferred angle, or `null` when it should not be forced.
 */
export function chooseExactPreferredAngle(anchorPosition, bondLength, coords, occupiedAngles, preferredAngles, excludedAtomIds, placementState, ringPolygons = [], atomGrid = null, options = {}) {
  const exactPreferredAngles = mergeCandidateAngles([], preferredAngles.filter(Number.isFinite));
  if (exactPreferredAngles.length === 0) {
    return null;
  }

  const clearanceContext = {
    anchorPosition,
    coords,
    excludedAtomIds
  };
  const exactCandidates = evaluateAngleCandidates(
    exactPreferredAngles,
    occupiedAngles,
    preferredAngles,
    anchorPosition,
    bondLength,
    coords,
    excludedAtomIds,
    placementState,
    ringPolygons,
    atomGrid
  );
  const clearanceFloor = bondLength * (options.clearanceFloorFactor ?? BRANCH_CLEARANCE_FLOOR_FACTOR);
  const safeExactCandidates = exactCandidates.filter(candidate => {
    if (!Number.isFinite(candidate.clearanceScore)) {
      candidate.clearanceScore = candidateClearanceScore(anchorPosition, candidate.angle, bondLength, coords, excludedAtomIds);
    }
    return candidate.clearanceScore >= clearanceFloor - 1e-9;
  });
  if (safeExactCandidates.length === 0) {
    return null;
  }

  let bestInsideRingCount = safeExactCandidates[0].insideRingCount ?? 0;
  let bestSeparation = safeExactCandidates[0].minSeparation ?? 0;
  for (let i = 1; i < safeExactCandidates.length; i++) {
    const v = safeExactCandidates[i].insideRingCount ?? 0;
    if (v < bestInsideRingCount) { bestInsideRingCount = v; }
    const s = safeExactCandidates[i].minSeparation ?? 0;
    if (s > bestSeparation) { bestSeparation = s; }
  }
  if (bestInsideRingCount !== 0 || bestSeparation < (options.minimumSeparation ?? (Math.PI / 6))) {
    return null;
  }
  return pickBestCandidateAngle(safeExactCandidates, bondLength, true, clearanceContext);
}

function computeLegacyChildAngles(childCount, outAngle, fromRing, incomingAngle, isLinear) {
  if (childCount === 1) {
    if (fromRing || isLinear) {
      return [outAngle];
    }
    const cross = Math.sin(outAngle - incomingAngle);
    return [outAngle + (cross >= 0 ? -DEG60 : DEG60)];
  }
  if (childCount === 2) {
    if (isLinear) {
      return [outAngle, outAngle + Math.PI];
    }
    return [outAngle + DEG60, outAngle - DEG60];
  }
  if (childCount === 3) {
    return [outAngle, outAngle + DEG120, outAngle - DEG120];
  }
  if (childCount === 4) {
    return [outAngle + DEG60, outAngle - DEG60, outAngle + DEG120, outAngle - DEG120];
  }
  const spread = (Math.PI * 4) / 3;
  const step = spread / Math.max(childCount - 1, 1);
  return Array.from({ length: childCount }, (_, index) => outAngle - spread / 2 + index * step);
}

const PROJECTED_TETRAHEDRAL_SLOT_OFFSETS = [0, DEG90, Math.PI, Math.PI + DEG90];

/**
 * Returns whether an atom should use projected-tetrahedral branch geometry in
 * 2D. This is limited to non-ring four-heavy single-bond centers so ring
 * readability heuristics and trigonal/linear centers keep their dedicated
 * placement rules.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate center atom ID.
 * @returns {boolean} True when the center qualifies for projected-tetrahedral placement.
 */
export function supportsProjectedTetrahedralGeometry(layoutGraph, atomId) {
  if (!layoutGraph) {
    return false;
  }

  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.aromatic || (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0) {
    return false;
  }

  let heavySingleBondCount = 0;
  let presentationCriticalLeafCount = 0;
  let hasLinearNeighbor = false;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    heavySingleBondCount++;
    if (neighborAtom.heavyDegree === 1) {
      if (!['O', 'S', 'Se'].includes(neighborAtom.element)) {
        presentationCriticalLeafCount++;
      }
    }
    if (isLinearCenter(layoutGraph, neighborAtomId)) {
      hasLinearNeighbor = true;
    }
  }

  return heavySingleBondCount === 4 && (presentationCriticalLeafCount >= 2 || hasLinearNeighbor);
}

function orthogonalSlotAssignments(placedCount) {
  const assignments = [];
  const recurse = (usedSlotIndexes, nextAssignment) => {
    if (nextAssignment.length === placedCount) {
      assignments.push(nextAssignment);
      return;
    }
    for (let slotIndex = 0; slotIndex < PROJECTED_TETRAHEDRAL_SLOT_OFFSETS.length; slotIndex++) {
      if (usedSlotIndexes.has(slotIndex)) {
        continue;
      }
      const nextUsedSlotIndexes = new Set(usedSlotIndexes);
      nextUsedSlotIndexes.add(slotIndex);
      recurse(nextUsedSlotIndexes, [...nextAssignment, slotIndex]);
    }
  };
  recurse(new Set(), []);
  return assignments;
}

function slotIndexCombinations(slotIndexes, count) {
  if (count === 0) {
    return [[]];
  }
  if (slotIndexes.length < count) {
    return [];
  }

  const combinations = [];
  const recurse = (startIndex, nextCombination) => {
    if (nextCombination.length === count) {
      combinations.push(nextCombination);
      return;
    }
    for (let index = startIndex; index < slotIndexes.length; index++) {
      recurse(index + 1, [...nextCombination, slotIndexes[index]]);
    }
  };
  recurse(0, []);
  return combinations;
}

function compareAngleSets(firstAngleSet, secondAngleSet) {
  const comparableLength = Math.min(firstAngleSet.length, secondAngleSet.length);
  for (let index = 0; index < comparableLength; index++) {
    if (Math.abs(firstAngleSet[index] - secondAngleSet[index]) > 1e-9) {
      return firstAngleSet[index] - secondAngleSet[index];
    }
  }
  return firstAngleSet.length - secondAngleSet.length;
}

/**
 * Returns projected-tetrahedral candidate angle sets for the current batch of
 * neighbors while reserving any remaining heavy slots for future placement
 * passes. This lets mixed layouts handle centers that are only partially in
 * the current branch-growth slice, such as diaryl difluoromethyl linkers.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Candidate center atom ID.
 * @param {string[]} currentPlacedNeighborIds - Already placed heavy neighbors.
 * @param {string[]} assigningNeighborIds - Heavy neighbors being assigned now.
 * @returns {number[][]} Candidate angle sets ordered best-first.
 */
function projectedTetrahedralAngleSets(layoutGraph, coords, anchorAtomId, currentPlacedNeighborIds, assigningNeighborIds) {
  if (
    !supportsProjectedTetrahedralGeometry(layoutGraph, anchorAtomId)
    || !coords.has(anchorAtomId)
    || currentPlacedNeighborIds.length === 0
    || assigningNeighborIds.length === 0
  ) {
    return [];
  }

  const heavyNeighborIds = (layoutGraph.bondsByAtomId.get(anchorAtomId) ?? [])
    .map(bond => (bond.a === anchorAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
  const inBatchNeighborIds = assigningNeighborIds.filter(neighborAtomId => heavyNeighborIds.includes(neighborAtomId));
  const placedNeighborIds = currentPlacedNeighborIds.filter(neighborAtomId => heavyNeighborIds.includes(neighborAtomId) && coords.has(neighborAtomId));
  const deferredHeavyNeighborCount = heavyNeighborIds.length - placedNeighborIds.length - inBatchNeighborIds.length;
  if (deferredHeavyNeighborCount < 0 || placedNeighborIds.length + inBatchNeighborIds.length + deferredHeavyNeighborCount !== 4) {
    return [];
  }
  const isProjectedLeafBatch =
    inBatchNeighborIds.length > 1
    && placedNeighborIds.length === 2
    && deferredHeavyNeighborCount === 0
    && inBatchNeighborIds.length === 2
    && inBatchNeighborIds.every(neighborAtomId => (layoutGraph.atoms.get(neighborAtomId)?.heavyDegree ?? 0) === 1);
  if (inBatchNeighborIds.length > 1 && !isProjectedLeafBatch) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  const placedNeighborAngles = placedNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  const candidateAlphas = [...new Set(
    placedNeighborAngles.flatMap(placedAngle =>
      PROJECTED_TETRAHEDRAL_SLOT_OFFSETS.map(slotOffset => normalizeSignedAngle(placedAngle - slotOffset))
    )
  )];
  if (candidateAlphas.length === 0) {
    return [];
  }

  const bestCandidates = [];
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (const alpha of candidateAlphas) {
    const targetAngles = PROJECTED_TETRAHEDRAL_SLOT_OFFSETS.map(slotOffset => normalizeSignedAngle(alpha + slotOffset));
    for (const assignment of orthogonalSlotAssignments(placedNeighborAngles.length)) {
      let fitPenalty = 0;
      for (let index = 0; index < placedNeighborAngles.length; index++) {
        fitPenalty += angularDifference(placedNeighborAngles[index], targetAngles[assignment[index]]) ** 2;
      }

      const assignedSlotIndexes = new Set(assignment);
      const freeSlotIndexes = PROJECTED_TETRAHEDRAL_SLOT_OFFSETS
        .map((_, slotIndex) => slotIndex)
        .filter(slotIndex => !assignedSlotIndexes.has(slotIndex));
      for (const chosenSlotIndexes of slotIndexCombinations(freeSlotIndexes, inBatchNeighborIds.length)) {
        const angleSet = chosenSlotIndexes
          .map(slotIndex => targetAngles[slotIndex])
          .sort((firstAngle, secondAngle) => firstAngle - secondAngle);
        if (fitPenalty < bestPenalty - 1e-9) {
          bestPenalty = fitPenalty;
          bestCandidates.length = 0;
        }
        if (
          fitPenalty <= bestPenalty + 1e-9
          && !bestCandidates.some(candidate => compareAngleSets(candidate, angleSet) === 0)
        ) {
          bestCandidates.push(angleSet);
        }
      }
    }
  }

  return bestCandidates.sort(compareAngleSets).slice(0, 1);
}

function preferredProjectedTetrahedralAngles(layoutGraph, coords, anchorAtomId, currentPlacedNeighborIds, childAtomId) {
  return projectedTetrahedralAngleSets(layoutGraph, coords, anchorAtomId, currentPlacedNeighborIds, childAtomId ? [childAtomId] : [])
    .flatMap(angleSet => angleSet);
}

function crossLikeHypervalentAngleSets(adjacency, coords, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds, layoutGraph) {
  const descriptor = describeCrossLikeHypervalentCenter(layoutGraph, anchorAtomId);
  if (!descriptor || !coords.has(anchorAtomId)) {
    return [];
  }

  const placedSingleNeighborIds = currentPlacedNeighborIds.filter(neighborAtomId => descriptor.singleNeighborIds.includes(neighborAtomId));
  const placedMultipleNeighborIds = currentPlacedNeighborIds.filter(neighborAtomId => descriptor.multipleNeighborIds.includes(neighborAtomId));
  const unplacedSingleNeighborIds = unplacedNeighborIds.filter(neighborAtomId => descriptor.singleNeighborIds.includes(neighborAtomId));
  const unplacedMultipleNeighborIds = unplacedNeighborIds.filter(neighborAtomId => descriptor.multipleNeighborIds.includes(neighborAtomId));
  const anchorPosition = coords.get(anchorAtomId);
  const angleSets = [];

  if (unplacedNeighborIds.length === 3 && unplacedSingleNeighborIds.length === 1 && unplacedMultipleNeighborIds.length === 2 && placedSingleNeighborIds.length === 1) {
    const singleAxisAngle = angleOf(sub(coords.get(placedSingleNeighborIds[0]), anchorPosition));
    const oppositeSingleAngle = singleAxisAngle + Math.PI;
    angleSets.push([oppositeSingleAngle, oppositeSingleAngle + DEG90, oppositeSingleAngle - DEG90]);
  }

  if (unplacedNeighborIds.length === 3 && unplacedSingleNeighborIds.length === 2 && unplacedMultipleNeighborIds.length === 1 && placedSingleNeighborIds.length === 1) {
    const singleAxisAngle = angleOf(sub(coords.get(placedSingleNeighborIds[0]), anchorPosition));
    const oppositeSingleAngle = singleAxisAngle + Math.PI;
    angleSets.push([oppositeSingleAngle, oppositeSingleAngle + DEG90, oppositeSingleAngle - DEG90]);
  }

  if (unplacedNeighborIds.length === 2 && unplacedMultipleNeighborIds.length === 2 && placedSingleNeighborIds.length === 2) {
    const singleAxisAngle = angleOf(sub(coords.get(placedSingleNeighborIds[0]), anchorPosition));
    angleSets.push([singleAxisAngle + DEG90, singleAxisAngle - DEG90]);
  }

  if (unplacedNeighborIds.length === 2 && unplacedSingleNeighborIds.length === 2 && placedMultipleNeighborIds.length === 2) {
    const multipleAxisAngle = angleOf(sub(coords.get(placedMultipleNeighborIds[0]), anchorPosition));
    angleSets.push([multipleAxisAngle + DEG90, multipleAxisAngle - DEG90]);
  }

  return angleSets;
}

function largestGapAngles(fixedAngles, childCount) {
  const sortedAngles = [...fixedAngles].sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  if (sortedAngles.length === 0) {
    return DISCRETE_BRANCH_ANGLES.slice(0, childCount);
  }

  let gapStart = sortedAngles[sortedAngles.length - 1];
  let gapSize = sortedAngles[0] - sortedAngles[sortedAngles.length - 1] + Math.PI * 2;
  for (let index = 0; index < sortedAngles.length - 1; index++) {
    const gap = sortedAngles[index + 1] - sortedAngles[index];
    if (gap > gapSize) {
      gapSize = gap;
      gapStart = sortedAngles[index];
    }
  }

  const step = gapSize / (childCount + 1);
  return Array.from({ length: childCount }, (_, index) => gapStart + step * (index + 1));
}

function describeSmallRingExteriorSpreadAnchor(layoutGraph, anchorAtomId) {
  if (!layoutGraph) {
    return null;
  }

  const atom = layoutGraph.atoms.get(anchorAtomId);
  if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4) {
    return null;
  }

  const anchorRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (anchorRings.length !== 1) {
    return null;
  }
  const ring = anchorRings[0];
  if ((ring?.atomIds?.length ?? 0) < 3 || (ring?.atomIds?.length ?? 0) > 6) {
    return null;
  }

  const ringNeighborIds = [];
  const exocyclicNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return null;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
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

  if (ringNeighborIds.length !== 2 || exocyclicNeighborIds.length !== 2) {
    return null;
  }
  return {
    ringNeighborIds,
    exocyclicNeighborIds,
    ringSize: ring.atomIds.length
  };
}

function largerAngularGap(ringNeighborAngles) {
  const sortedAngles = [...ringNeighborAngles].map(normalizeSignedAngle).sort((firstAngle, secondAngle) => firstAngle - secondAngle);
  if (sortedAngles.length !== 2) {
    return null;
  }

  const [firstAngle, secondAngle] = sortedAngles;
  const forwardGap = secondAngle - firstAngle;
  const wrapGap = (firstAngle + 2 * Math.PI) - secondAngle;
  if (forwardGap >= wrapGap) {
    return { startAngle: firstAngle, size: forwardGap };
  }
  return { startAngle: secondAngle, size: wrapGap };
}

/**
 * Returns the ideal exocyclic target angles for a saturated ring atom that
 * carries two heavy external branches. Three- and four-membered rings read
 * best when the exocyclic bonds continue the ring edges exactly, while
 * five- and six-membered rings read better when the two exterior branches fan
 * symmetrically across the open side of the ring instead of pinching onto a
 * single ring-edge continuation.
 * @param {number[]} ringNeighborAngles - Already placed ring-bond angles at the anchor.
 * @param {number} ringSize - Ring size for the anchor's incident ring.
 * @returns {number[]} Target exterior angles in radians.
 */
export function smallRingExteriorTargetAngles(ringNeighborAngles, ringSize) {
  if (ringNeighborAngles.length !== 2) {
    return [];
  }
  if (ringSize >= 5) {
    const exteriorGap = largerAngularGap(ringNeighborAngles);
    if (!exteriorGap) {
      return [];
    }
    return [
      normalizeSignedAngle(exteriorGap.startAngle + exteriorGap.size / 3),
      normalizeSignedAngle(exteriorGap.startAngle + (2 * exteriorGap.size) / 3)
    ];
  }
  return ringNeighborAngles.map(ringNeighborAngle => normalizeSignedAngle(ringNeighborAngle + Math.PI));
}

function exactSmallRingExteriorAngleSets(layoutGraph, coords, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds) {
  if (!layoutGraph || !coords.has(anchorAtomId) || unplacedNeighborIds.length !== 2) {
    return [];
  }

  const descriptor = describeSmallRingExteriorSpreadAnchor(layoutGraph, anchorAtomId);
  if (!descriptor) {
    return [];
  }

  const placedRingNeighborIds = descriptor.ringNeighborIds.filter(
    neighborAtomId => currentPlacedNeighborIds.includes(neighborAtomId) && coords.has(neighborAtomId)
  );
  if (placedRingNeighborIds.length !== 2) {
    return [];
  }
  if (!unplacedNeighborIds.every(neighborAtomId => descriptor.exocyclicNeighborIds.includes(neighborAtomId))) {
    return [];
  }

  const anchorPosition = coords.get(anchorAtomId);
  const ringNeighborAngles = placedRingNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, descriptor.ringSize);
  return targetAngles.length === unplacedNeighborIds.length ? [targetAngles] : [];
}

function shouldTryRingExteriorGapSpread(layoutGraph, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds) {
  if (!layoutGraph || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
    return false;
  }
  if (currentPlacedNeighborIds.length !== 2 || unplacedNeighborIds.length < 2) {
    return false;
  }
  if (!currentPlacedNeighborIds.every(neighborAtomId => (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0)) {
    return false;
  }

  for (const neighborAtomId of [...currentPlacedNeighborIds, ...unplacedNeighborIds]) {
    if ((layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0 && !currentPlacedNeighborIds.includes(neighborAtomId)) {
      return false;
    }
    const bond = findLayoutBond(layoutGraph, anchorAtomId, neighborAtomId);
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
  }

  return true;
}

function preferredSmallRingExteriorGapAngles(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId) {
  if (!layoutGraph || !coords.has(anchorAtomId) || !childAtomId) {
    return [];
  }

  const descriptor = describeSmallRingExteriorSpreadAnchor(layoutGraph, anchorAtomId);
  if (!descriptor || !descriptor.exocyclicNeighborIds.includes(childAtomId)) {
    return [];
  }

  const atomPosition = coords.get(anchorAtomId);
  const placedRingNeighborIds = descriptor.ringNeighborIds.filter(neighborAtomId => placedNeighborIdsList.includes(neighborAtomId) && coords.has(neighborAtomId));
  if (placedRingNeighborIds.length !== 2) {
    return [];
  }

  const ringNeighborAngles = placedRingNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), atomPosition)));
  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, descriptor.ringSize);
  if (targetAngles.length !== descriptor.exocyclicNeighborIds.length) {
    return [];
  }

  const placedExocyclicNeighborIds = descriptor.exocyclicNeighborIds.filter(
    neighborAtomId => neighborAtomId !== childAtomId && placedNeighborIdsList.includes(neighborAtomId) && coords.has(neighborAtomId)
  );
  if (placedExocyclicNeighborIds.length === 0) {
    return targetAngles;
  }
  if (placedExocyclicNeighborIds.length !== 1) {
    return [];
  }

  const placedExocyclicAngle = angleOf(sub(coords.get(placedExocyclicNeighborIds[0]), atomPosition));
  const firstPenalty = angularDifference(placedExocyclicAngle, targetAngles[0]);
  const secondPenalty = angularDifference(placedExocyclicAngle, targetAngles[1]);
  return [firstPenalty <= secondPenalty ? targetAngles[1] : targetAngles[0]];
}

/**
 * Returns the penalty for crowding two heavy exocyclic branches onto the same
 * side of a small non-aromatic ring atom. Three- and four-member quaternary
 * ring centers read best when their heavy exocyclic bonds follow the exact
 * outer continuations of the ring edges, while five- and six-member
 * quaternary ring centers read better when those exocyclic bonds fan across
 * the ring's open exterior gap instead of pinching into a single edge
 * continuation.
 * @param {object|null} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Candidate anchor atom ID.
 * @returns {number} Exterior-gap crowding penalty.
 */
export function measureSmallRingExteriorGapSpreadPenalty(layoutGraph, coords, atomId) {
  if (!layoutGraph) {
    return 0;
  }

  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 4) {
    return 0;
  }

  const anchorRings = layoutGraph.atomToRings.get(atomId) ?? [];
  if (anchorRings.length !== 1) {
    return 0;
  }
  const smallRing = anchorRings[0];
  if ((smallRing?.atomIds?.length ?? 0) < 3 || (smallRing?.atomIds?.length ?? 0) > 6) {
    return 0;
  }

  const atomPosition = coords.get(atomId);
  if (!atomPosition) {
    return 0;
  }

  const ringNeighborAngles = [];
  const exocyclicAngles = [];
  let exocyclicHeavyCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return 0;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (smallRing.atomIds.includes(neighborAtomId)) {
      const neighborPosition = coords.get(neighborAtomId);
      if (!neighborPosition) {
        return 0;
      }
      ringNeighborAngles.push(angleOf(sub(neighborPosition, atomPosition)));
      continue;
    }
    exocyclicHeavyCount++;
    const neighborPosition = coords.get(neighborAtomId);
    if (neighborPosition) {
      exocyclicAngles.push(angleOf(sub(neighborPosition, atomPosition)));
    }
  }

  if (ringNeighborAngles.length !== 2 || exocyclicHeavyCount !== 2) {
    return 0;
  }

  const targetAngles = smallRingExteriorTargetAngles(ringNeighborAngles, smallRing.atomIds.length);
  if (targetAngles.length !== 2) {
    return 0;
  }

  if (exocyclicAngles.length !== 2) {
    return 0;
  }

  const alignedPenalty =
    (angularDifference(exocyclicAngles[0], targetAngles[0]) ** 2)
    + (angularDifference(exocyclicAngles[1], targetAngles[1]) ** 2);
  const swappedPenalty =
    (angularDifference(exocyclicAngles[0], targetAngles[1]) ** 2)
    + (angularDifference(exocyclicAngles[1], targetAngles[0]) ** 2);
  return Math.min(alignedPenalty, swappedPenalty);
}

/**
 * Builds candidate child-angle sets for one multi-child branch placement step.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {string|null} parentAtomId - Already placed parent atom ID.
 * @param {string[]} unplacedNeighborIds - Immediate unplaced child atom IDs.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @returns {number[][]} Candidate angle sets sized to the requested child count.
 */
export function buildCandidateAngleSets(adjacency, coords, anchorAtomId, parentAtomId, unplacedNeighborIds, layoutGraph = null, branchConstraints = null) {
  const anchorPosition = coords.get(anchorAtomId);
  const currentPlacedNeighborIds = placedNeighborIds(adjacency, coords, anchorAtomId);
  const currentPlacedNeighborAngles = currentPlacedNeighborIds.map(neighborAtomId => angleOf(sub(coords.get(neighborAtomId), anchorPosition)));
  const ringAngles = preferredRingAngles(layoutGraph, coords, anchorAtomId);
  const fromRing = ringAngles.length > 0;
  const incomingAngle = parentAtomId && coords.has(parentAtomId) ? angleOf(sub(coords.get(parentAtomId), anchorPosition)) : ringAngles[0] == null ? 0 : ringAngles[0] + Math.PI;
  const outAngle = ringAngles[0] ?? incomingAngle + Math.PI;
  const hasMultipleBond = hasNonAromaticMultipleBond(layoutGraph, anchorAtomId);
  const isLinear = isLinearCenter(layoutGraph, anchorAtomId);

  const shouldUseGapStrategy =
    !fromRing &&
    currentPlacedNeighborIds.length > 0 &&
    (currentPlacedNeighborIds.length >= 2 ||
      (!isLinear && !hasMultipleBond && unplacedNeighborIds.length >= 2) ||
      (unplacedNeighborIds.length === 1 && currentPlacedNeighborIds.length >= 2));

  const fallbackAngleSets = shouldUseGapStrategy
    ? [
        largestGapAngles(currentPlacedNeighborAngles, unplacedNeighborIds.length)
      ]
    : [computeLegacyChildAngles(unplacedNeighborIds.length, outAngle, fromRing, incomingAngle, isLinear)];

  const ringExteriorGapAngleSets =
    shouldTryRingExteriorGapSpread(layoutGraph, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds) && !hasMultipleBond && !isLinear
      ? [largestGapAngles(currentPlacedNeighborAngles, unplacedNeighborIds.length)]
      : [];
  const exactExteriorAngleSets =
    !hasMultipleBond && !isLinear
      ? exactSmallRingExteriorAngleSets(layoutGraph, coords, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds)
      : [];
  const projectedTetrahedralAngleSetCandidates =
    !hasMultipleBond && !isLinear
      ? projectedTetrahedralAngleSets(layoutGraph, coords, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds)
      : [];

  return [
    ...crossLikeHypervalentAngleSets(adjacency, coords, anchorAtomId, currentPlacedNeighborIds, unplacedNeighborIds, layoutGraph),
    ...exactExteriorAngleSets,
    ...projectedTetrahedralAngleSetCandidates,
    ...ringExteriorGapAngleSets,
    ...fallbackAngleSets
  ]
    .map(angleSet => filterAnglesByBudget(angleSet, anchorAtomId, branchConstraints))
    .filter(angleSet => angleSet.length === unplacedNeighborIds.length);
}

/**
 * Returns preferred continuation angles for a child branch at the current anchor.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {Set<string>} _atomIdsToPlace - Eligible atom IDs for the current placement slice.
 * @param {string|null} parentAtomId - Already placed parent atom ID.
 * @param {string|null} childAtomId - Child atom being placed.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @returns {number[]} Preferred angles in radians.
 */
export function preferredBranchAngles(adjacency, coords, anchorAtomId, _atomIdsToPlace, parentAtomId, childAtomId, layoutGraph = null) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return [];
  }
  const placedNeighborIdsList = (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId));
  const projectedTetrahedralAngles = preferredProjectedTetrahedralAngles(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId);
  if (projectedTetrahedralAngles.length > 0) {
    return projectedTetrahedralAngles;
  }
  const ringJunctionGapAngle = preferredRingJunctionGapAngle(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId);
  if (ringJunctionGapAngle != null) {
    return [ringJunctionGapAngle];
  }
  const smallRingExteriorAngles = preferredSmallRingExteriorGapAngles(layoutGraph, coords, anchorAtomId, placedNeighborIdsList, childAtomId);
  if (smallRingExteriorAngles.length > 0) {
    return smallRingExteriorAngles;
  }
  const childBond = childAtomId ? findLayoutBond(layoutGraph, anchorAtomId, childAtomId) : null;
  if (
    placedNeighborIdsList.length === 2
    && childBond
    && !childBond.aromatic
    && (
      (childBond.order ?? 1) >= 2
      || shouldPreferOmittedHydrogenTrigonalBisector(layoutGraph, anchorAtomId)
    )
  ) {
    const trigonalBisectorAngle = preferredTrigonalBisectorAngle(coords, anchorAtomId, placedNeighborIdsList);
    if (trigonalBisectorAngle != null) {
      return [trigonalBisectorAngle];
    }
  }
  const ringAngles = shouldPreferUniqueIncidentRingOutwardAngle(layoutGraph, coords, anchorAtomId, childAtomId)
    ? incidentRingOutwardAngles(layoutGraph, coords, anchorAtomId)
    : preferredRingAngles(layoutGraph, coords, anchorAtomId);
  if (ringAngles.length > 0) {
    return ringAngles;
  }
  if (placedNeighborIdsList.length >= 2) {
    if (placedNeighborIdsList.length === 2) {
      const neighborCenter = centroid(placedNeighborIdsList.map(neighborAtomId => coords.get(neighborAtomId)));
      const outwardVector = sub(anchorPosition, neighborCenter);
      if (length(outwardVector) <= CENTERED_NEIGHBOR_EPSILON) {
        const neighborAxis = sub(coords.get(placedNeighborIdsList[1]), coords.get(placedNeighborIdsList[0]));
        const perpendicular = perpLeft(neighborAxis);
        if (length(perpendicular) > CENTERED_NEIGHBOR_EPSILON) {
          const perpendicularAngle = angleOf(perpendicular);
          return [perpendicularAngle, perpendicularAngle + Math.PI];
        }
      }
    }
    const neighborCenter = centroid(placedNeighborIdsList.map(neighborAtomId => coords.get(neighborAtomId)));
    return [angleOf(sub(anchorPosition, neighborCenter))];
  }
  const resolvedParentAtomId = parentAtomId ?? placedNeighborIdsList[0] ?? null;
  if (!resolvedParentAtomId || !coords.has(resolvedParentAtomId)) {
    return [];
  }
  const forwardAngle = angleOf(sub(anchorPosition, coords.get(resolvedParentAtomId)));
  if (prefersLinearContinuation(layoutGraph, anchorAtomId, resolvedParentAtomId, childAtomId)) {
    return [forwardAngle];
  }
  const alkylTailAngles = preferredAlkylTailAngles(adjacency, coords, anchorAtomId, resolvedParentAtomId, childAtomId, layoutGraph);
  if (alkylTailAngles.length > 0) {
    return alkylTailAngles;
  }
  return [forwardAngle + CHAIN_CONTINUATION_OFFSET, forwardAngle - CHAIN_CONTINUATION_OFFSET];
}

/**
 * Chooses a discrete outward angle for a new attachment on an already placed
 * anchor atom.
 * @param {Map<string, string[]>} adjacency - Component adjacency map.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {string} anchorAtomId - Anchor atom ID.
 * @param {Set<string>} atomIdsToPlace - Eligible atom IDs.
 * @param {number|null} [preferredAngle] - Preferred angle in radians.
 * @param {object|null} [layoutGraph] - Layout graph shell.
 * @param {string|null} [attachedAtomId] - Unplaced atom being attached to the anchor.
 * @param {{angularBudgets?: Map<string, {centerAngle: number, minOffset: number, maxOffset: number, preferredAngle: number}>}|null} [branchConstraints] - Optional branch-angle constraints keyed by anchor atom ID.
 * @returns {number} Chosen attachment angle.
 */
export function chooseAttachmentAngle(adjacency, coords, anchorAtomId, atomIdsToPlace, preferredAngle = null, layoutGraph = null, attachedAtomId = null, branchConstraints = null) {
  const occupiedAngles = occupiedNeighborAngles(adjacency, coords, anchorAtomId, atomIdsToPlace);
  if (attachedAtomId) {
    const allowFinePreferredAngles = isRingAnchor(layoutGraph, anchorAtomId);
    const allowDirectPreferredAngle = shouldPromotePreferredRingAngle(layoutGraph, anchorAtomId, attachedAtomId);
    const placedNeighborIdsList = neighborOrder(
      (adjacency.get(anchorAtomId) ?? []).filter(neighborAtomId => coords.has(neighborAtomId) && atomIdsToPlace.has(neighborAtomId)),
      layoutGraph?.canonicalAtomRank ?? new Map()
    );
    const parentAtomId = placedNeighborIdsList.length === 1 ? placedNeighborIdsList[0] : null;
    const childBond = findLayoutBond(layoutGraph, anchorAtomId, attachedAtomId);
    const continuationAngles = preferredBranchAngles(adjacency, coords, anchorAtomId, atomIdsToPlace, parentAtomId, attachedAtomId, layoutGraph);
    const constrainedContinuationAngles = mergeCandidateAngles(
      filterAnglesByBudget(continuationAngles, anchorAtomId, branchConstraints),
      budgetPreferredAngles(anchorAtomId, branchConstraints)
    );
    const exactDirectAttachedRingJunctionAngle = directAttachedForeignRingJunctionContinuationAngle(
      layoutGraph,
      coords,
      anchorAtomId,
      attachedAtomId
    );
    const exactOmittedHydrogenTrigonalAngle =
      placedNeighborIdsList.length === 2
      && childBond
      && !childBond.aromatic
      && (childBond.order ?? 1) === 1
      && shouldPreferOmittedHydrogenTrigonalBisector(layoutGraph, anchorAtomId);
    if (
      exactDirectAttachedRingJunctionAngle != null
      || exactOmittedHydrogenTrigonalAngle
      || isExactRingOutwardEligibleSubstituent(layoutGraph, anchorAtomId, attachedAtomId)
      || isExactSmallRingExteriorContinuationEligible(layoutGraph, anchorAtomId, attachedAtomId)
      || isExactRingTrigonalBisectorEligible(layoutGraph, anchorAtomId, attachedAtomId)
      || isExactSimpleAcyclicContinuationEligible(layoutGraph, anchorAtomId, parentAtomId, attachedAtomId)
    ) {
      const exactPreferredAngle = chooseExactPreferredAngle(
        coords.get(anchorAtomId),
        1,
        coords,
        occupiedAngles,
        constrainedContinuationAngles,
        new Set([anchorAtomId]),
        null,
        incidentRingPolygons(layoutGraph, coords, anchorAtomId),
        null,
        exactOmittedHydrogenTrigonalAngle ? { clearanceFloorFactor: OMITTED_HYDROGEN_EXACT_CLEARANCE_FACTOR } : {}
      );
      if (exactPreferredAngle != null) {
        return exactPreferredAngle;
      }
    }
    if (allowDirectPreferredAngle) {
      const preferredContinuationAngle = choosePreferredCandidateAngle(
        occupiedAngles,
        constrainedContinuationAngles,
        allowFinePreferredAngles
      );
      if (preferredContinuationAngle != null && hasSafePreferredCandidateAngle(occupiedAngles, constrainedContinuationAngles, allowFinePreferredAngles)) {
        return preferredContinuationAngle;
      }
    }
  }

  const preferredAngles = resolvedPreferredAngles(
    anchorAtomId,
    [...(preferredAngle == null ? [] : [preferredAngle]), ...preferredRingAngles(layoutGraph, coords, anchorAtomId)],
    branchConstraints
  );
  const constrainedCandidateAngles = mergeCandidateAngles(
    filterAnglesByBudget(DISCRETE_BRANCH_ANGLES, anchorAtomId, branchConstraints),
    budgetPreferredAngles(anchorAtomId, branchConstraints)
  );
  return pickBestCandidateAngle(
    evaluateAngleCandidates(
      constrainedCandidateAngles,
      occupiedAngles,
      preferredAngles,
      coords.get(anchorAtomId),
      1,
      coords,
      new Set([anchorAtomId]),
      null,
      incidentRingPolygons(layoutGraph, coords, anchorAtomId)
    ),
    1,
    false,
    {
      anchorPosition: coords.get(anchorAtomId),
      coords,
      excludedAtomIds: new Set([anchorAtomId])
    }
  );
}
