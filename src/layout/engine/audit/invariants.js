/** @module audit/invariants */

import { collectLabelBoxes, findLabelOverlaps } from '../geometry/label-box.js';
import { computeBounds } from '../geometry/bounds.js';
import { AtomGrid } from '../geometry/atom-grid.js';
import { distancePointToSegment, segmentsIntersect } from '../geometry/segments.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { angleOf, angularDifference, centroid, sub } from '../geometry/vec2.js';
import { computeIncidentRingOutwardAngles } from '../geometry/ring-direction.js';
import {
  isExactVisibleTrigonalBisectorEligible,
  isRingConstrainedBenzylicCarbonRoot,
  preferredSharedJunctionContinuationAngle
} from '../placement/branch-placement/angle-selection.js';
import { atomPairKey, AUDIT_PLANAR_VALIDATION, BRIDGED_VALIDATION, RING_SUBSTITUENT_READABILITY_LIMITS, SEVERE_OVERLAP_FACTOR } from '../constants.js';

const SUBTREE_BOND_CROWDING_FACTOR = 0.5;
const SUBTREE_BOND_CROWDING_WEIGHT = 25;
const IDEAL_DIVALENT_CONTINUATION_ELEMENTS = new Set(['C', 'O', 'S', 'Se']);
const LINKED_RING_REPRESENTATIVE_OUTWARD_READABILITY_SLACK = Math.PI / 180;
const COMPRESSIBLE_TERMINAL_RING_LEAF_ELEMENTS = new Set(['F', 'Cl', 'Br', 'I', 'O', 'S', 'Se']);
const COMPRESSED_TERMINAL_RING_LEAF_ANGLE_TOLERANCE = Math.PI / 180;
const BRIDGED_RING_SUBSTITUENT_SLOT_SCAN_STEP = Math.PI / 36;
const BRIDGED_RING_SUBSTITUENT_SLOT_CLEARANCE_FACTOR = 0.55;

function isConjugatedTrigonalHeavyNeighbor(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.aromatic || atom.heavyDegree !== 3) {
    return false;
  }
  let heavyVisibleBondCount = 0;
  let nonAromaticMultipleBondCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    heavyVisibleBondCount++;
    if (!bond.aromatic && (bond.order ?? 1) >= 2) {
      nonAromaticMultipleBondCount++;
    }
  }
  return heavyVisibleBondCount === 3 && nonAromaticMultipleBondCount === 1;
}

function distanceBetweenSegments(firstStart, firstEnd, secondStart, secondEnd) {
  if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
    return 0;
  }
  return Math.min(
    distancePointToSegment(firstStart, secondStart, secondEnd),
    distancePointToSegment(firstEnd, secondStart, secondEnd),
    distancePointToSegment(secondStart, firstStart, firstEnd),
    distancePointToSegment(secondEnd, firstStart, firstEnd)
  );
}

/**
 * Returns the bond-validation settings for the requested validation class.
 * @param {'planar'|'bridged'|undefined} validationClass - Bond validation class.
 * @returns {{minBondLengthFactor: number, maxBondLengthFactor: number, maxMeanDeviation: number, maxSevereOverlapCount: number}} Validation settings.
 */
function validationSettingsForClass(validationClass) {
  return validationClass === 'bridged' ? BRIDGED_VALIDATION : AUDIT_PLANAR_VALIDATION;
}

/**
 * Returns whether a bond should contribute to layout bond-length audit stats.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} bond - Bond descriptor.
 * @returns {boolean} True when the bond is a visible heavy-atom covalent bond.
 */
function isAuditableBond(layoutGraph, bond) {
  if (!bond || bond.kind !== 'covalent') {
    return false;
  }
  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  if (!firstAtom || !secondAtom) {
    return false;
  }
  return firstAtom.element !== 'H' && secondAtom.element !== 'H';
}

/**
 * Resolves a ring anchor plus terminal non-carbon leaf for a compressible
 * publication-style leaf bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} bond - Candidate bond descriptor.
 * @returns {{anchorAtomId: string, leafAtomId: string}|null} Endpoint roles, or null.
 */
function compressibleTerminalRingLeafEndpoints(layoutGraph, bond) {
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
    return null;
  }

  for (const [anchorAtomId, leafAtomId] of [
    [bond.a, bond.b],
    [bond.b, bond.a]
  ]) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    if (
      !anchorAtom
      || !leafAtom
      || !COMPRESSIBLE_TERMINAL_RING_LEAF_ELEMENTS.has(leafAtom.element)
      || (leafAtom.heavyDegree ?? 0) !== 1
      || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0
      || (layoutGraph.atomToRings.get(leafAtomId)?.length ?? 0) > 0
    ) {
      continue;
    }
    return { anchorAtomId, leafAtomId };
  }

  return null;
}

/**
 * Returns whether a short terminal ring-leaf bond is an intentional exact
 * outward depiction used to avoid local overlap.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} bond - Candidate bond descriptor.
 * @param {number} distance - Current bond length.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when the compressed leaf should not count as a bond-length failure.
 */
function isAcceptedCompressedTerminalRingLeafBond(layoutGraph, coords, bond, distance, bondLength) {
  if (distance >= bondLength || distance < bondLength * SEVERE_OVERLAP_FACTOR - 1e-9) {
    return false;
  }

  const endpoints = compressibleTerminalRingLeafEndpoints(layoutGraph, bond);
  if (!endpoints) {
    return false;
  }

  const anchorPosition = coords.get(endpoints.anchorAtomId);
  const leafPosition = coords.get(endpoints.leafAtomId);
  if (!anchorPosition || !leafPosition) {
    return false;
  }

  const leafAngle = angleOf(sub(leafPosition, anchorPosition));
  return computeIncidentRingOutwardAngles(layoutGraph, endpoints.anchorAtomId, atomId => coords.get(atomId) ?? null)
    .some(outwardAngle => angularDifference(leafAngle, outwardAngle) <= COMPRESSED_TERMINAL_RING_LEAF_ANGLE_TOLERANCE);
}

/**
 * Returns whether the atom participates in visible-audit geometry.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {boolean} True when the atom should count in visible geometry checks.
 */
function isVisibleLayoutAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  if (layoutGraph.options.suppressH && atom.element === 'H') {
    return false;
  }
  return true;
}

function collectNonbondedPairs(layoutGraph, coords, includePair, atomGrid = null, queryRadius = 0) {
  if (atomGrid) {
    const seenPairs = new Set();
    const pairs = [];

    for (const [firstAtomId, firstPosition] of coords) {
      if (!isVisibleLayoutAtom(layoutGraph, firstAtomId)) {
        continue;
      }
      const nearbyAtomIds = atomGrid.queryRadius(firstPosition, queryRadius);
      for (const secondAtomId of nearbyAtomIds) {
        if (secondAtomId === firstAtomId || !isVisibleLayoutAtom(layoutGraph, secondAtomId)) {
          continue;
        }
        const key = atomPairKey(firstAtomId, secondAtomId);
        if (seenPairs.has(key) || layoutGraph.bondedPairSet.has(key)) {
          continue;
        }
        const secondPosition = coords.get(secondAtomId);
        if (!secondPosition) {
          continue;
        }
        const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
        if (includePair(firstAtomId, secondAtomId, distance)) {
          pairs.push({ firstAtomId, secondAtomId, distance });
        }
        seenPairs.add(key);
      }
    }

    return pairs;
  }

  const atomIds = [...coords.keys()];
  const bondedPairs = layoutGraph.bondedPairSet;
  const pairs = [];

  for (let firstIndex = 0; firstIndex < atomIds.length; firstIndex++) {
    const firstAtomId = atomIds[firstIndex];
    if (!isVisibleLayoutAtom(layoutGraph, firstAtomId)) {
      continue;
    }
    const firstPosition = coords.get(firstAtomId);
    for (let secondIndex = firstIndex + 1; secondIndex < atomIds.length; secondIndex++) {
      const secondAtomId = atomIds[secondIndex];
      if (!isVisibleLayoutAtom(layoutGraph, secondAtomId) || bondedPairs.has(atomPairKey(firstAtomId, secondAtomId))) {
        continue;
      }
      const secondPosition = coords.get(secondAtomId);
      const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
      if (includePair(firstAtomId, secondAtomId, distance)) {
        pairs.push({ firstAtomId, secondAtomId, distance });
      }
    }
  }

  return pairs;
}

/**
 * Builds a spatial atom grid from the current placed coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {AtomGrid} Spatial atom grid.
 */
export function buildAtomGrid(layoutGraph, coords, bondLength) {
  const atomGrid = new AtomGrid(bondLength);
  for (const [atomId, position] of coords) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    atomGrid.insert(atomId, position);
  }
  return atomGrid;
}

/**
 * Builds reusable membership and bond partitions for subtree-overlap scoring.
 * This lets callers reuse the same subtree/bond classification across many
 * candidate evaluations instead of rescanning the full bond list each time.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} subtreeAtomIds - Atom IDs in the moving subtree.
 * @param {object} [options] - Context options.
 * @param {boolean} [options.includeBondCrowding] - Whether to also partition auditable bonds.
 * @returns {{subtreeSet: Set<string>, visibleSubtreeAtomIds: string[], subtreeBonds?: object[], externalBonds?: object[]}} Reusable subtree-overlap context.
 */
export function buildSubtreeOverlapContext(layoutGraph, subtreeAtomIds, options = {}) {
  const subtreeSet = new Set(subtreeAtomIds);
  const seenVisibleAtomIds = new Set();
  const visibleSubtreeAtomIds = [];
  for (const atomId of subtreeAtomIds) {
    if (!seenVisibleAtomIds.has(atomId) && isVisibleLayoutAtom(layoutGraph, atomId)) {
      seenVisibleAtomIds.add(atomId);
      visibleSubtreeAtomIds.push(atomId);
    }
  }

  if (options.includeBondCrowding !== true) {
    return {
      subtreeSet,
      visibleSubtreeAtomIds
    };
  }

  const subtreeBonds = [];
  const externalBonds = [];
  for (const bond of layoutGraph.bonds.values()) {
    if (!isAuditableBond(layoutGraph, bond)) {
      continue;
    }
    const firstInSubtree = subtreeSet.has(bond.a);
    const secondInSubtree = subtreeSet.has(bond.b);
    if (!firstInSubtree && !secondInSubtree) {
      externalBonds.push(bond);
      continue;
    }
    subtreeBonds.push(bond);
  }

  return {
    subtreeSet,
    visibleSubtreeAtomIds,
    subtreeBonds,
    externalBonds
  };
}

/**
 * Computes a lightweight exploratory placement cost focused on a subset of
 * atoms. This is intentionally cheaper than the full audit cost and is meant
 * only for internal branch/orientation search where unchanged distant geometry
 * does not affect the choice being evaluated.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {Iterable<string>} focusAtomIds - Atoms whose local neighborhood should be rescored.
 * @param {{atomGrid?: AtomGrid|null}} [options] - Optional reused spatial grid built from coords.
 * @returns {number} Focused exploratory placement cost.
 */
export function measureFocusedPlacementCost(layoutGraph, coords, bondLength, focusAtomIds, options = {}) {
  const seen = new Set();
  const uniqueFocusAtomIds = [];
  for (const atomId of focusAtomIds) {
    if (!seen.has(atomId) && coords.has(atomId) && isVisibleLayoutAtom(layoutGraph, atomId)) {
      seen.add(atomId);
      uniqueFocusAtomIds.push(atomId);
    }
  }
  if (uniqueFocusAtomIds.length === 0) {
    return 0;
  }

  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const atomGrid = options.atomGrid ?? (coords.size >= 160 ? buildAtomGrid(layoutGraph, coords, bondLength) : null);
  const seenPairs = new Set();
  let overlapPenalty = 0;

  for (const firstAtomId of uniqueFocusAtomIds) {
    const firstPosition = coords.get(firstAtomId);
    const candidateAtomIds = atomGrid ? atomGrid.queryRadius(firstPosition, threshold) : coords.keys();
    for (const secondAtomId of candidateAtomIds) {
      if (secondAtomId === firstAtomId || !isVisibleLayoutAtom(layoutGraph, secondAtomId)) {
        continue;
      }
      const key = atomPairKey(firstAtomId, secondAtomId);
      if (seenPairs.has(key) || layoutGraph.bondedPairSet.has(key)) {
        continue;
      }
      seenPairs.add(key);
      const secondPosition = coords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
      if (distance >= threshold) {
        continue;
      }
      const deficit = threshold - distance;
      overlapPenalty += deficit * deficit * 100;
    }
  }

  const seenBonds = new Set();
  let totalDeviation = 0;
  let maxDeviation = 0;
  let sampleCount = 0;

  for (const atomId of uniqueFocusAtomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!isAuditableBond(layoutGraph, bond) || seenBonds.has(bond.id)) {
        continue;
      }
      seenBonds.add(bond.id);
      const firstPosition = coords.get(bond.a);
      const secondPosition = coords.get(bond.b);
      if (!firstPosition || !secondPosition) {
        continue;
      }
      const deviation = Math.abs(Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y) - bondLength);
      totalDeviation += deviation;
      maxDeviation = Math.max(maxDeviation, deviation);
      sampleCount++;
    }
  }

  return overlapPenalty + (sampleCount === 0 ? 0 : (totalDeviation / sampleCount) * 10 + maxDeviation * 5);
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

/**
 * Returns whether a ring anchor participates in a planar-looking ring bond
 * pattern where an outward substituent direction is a meaningful readability
 * target.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Candidate ring anchor atom id.
 * @returns {boolean} True when the anchor should use outward-direction checks.
 */
export function supportsRingSubstituentOutwardReadability(layoutGraph, anchorAtomId) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
    return false;
  }
  if (anchorAtom.aromatic === true) {
    return true;
  }
  for (const bond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (bond.kind !== 'covalent' || !bond.inRing) {
      continue;
    }
    if (bond.aromatic || (bond.order ?? 1) >= 2) {
      return true;
    }
  }
  return false;
}

function ringSystemAtomIds(layoutGraph, ringSystemId, ringSystemById = null) {
  return (ringSystemById ? ringSystemById.get(ringSystemId) : layoutGraph.ringSystems.find(ringSystem => ringSystem.id === ringSystemId))?.atomIds ?? [];
}

/**
 * Returns whether a nominal non-ring "substituent" actually reconnects into
 * the same ring system as the anchor through another path. Those bridge-like
 * linkers are part of the scaffold, not ordinary ring substituents, so the
 * local outward-axis readability check should not treat them like pendant
 * leaves.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Candidate ring anchor atom id.
 * @param {string} childAtomId - Candidate non-ring child atom id.
 * @returns {boolean} True when the child reconnects into the anchor ring system.
 */
function _reconnectsToAnchorRingSystemImpl(layoutGraph, coords, anchorAtomId, childAtomId) {
  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  if (anchorRingSystemId == null) {
    return false;
  }

  const visitedAtomIds = new Set([anchorAtomId]);
  const queue = [childAtomId];
  while (queue.length > 0) {
    const atomId = queue.shift();
    if (visitedAtomIds.has(atomId)) {
      continue;
    }
    visitedAtomIds.add(atomId);

    if (atomId !== childAtomId && layoutGraph.atomToRingSystemId.get(atomId) === anchorRingSystemId) {
      return true;
    }

    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId) || visitedAtomIds.has(neighborAtomId)) {
        continue;
      }
      queue.push(neighborAtomId);
    }
  }

  return false;
}

function reconnectsToAnchorRingSystem(layoutGraph, coords, anchorAtomId, childAtomId) {
  const cache = layoutGraph._reconnectsToAnchorCache ?? (layoutGraph._reconnectsToAnchorCache = new Map());
  const cacheKey = `${anchorAtomId}:${childAtomId}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const result = _reconnectsToAnchorRingSystemImpl(layoutGraph, coords, anchorAtomId, childAtomId);
  cache.set(cacheKey, result);
  return result;
}

/**
 * Returns whether a non-ring child should keep its immediate bond direction as
 * the substituent representative for readability. Carbonyl-like trigonal roots
 * and ring-constrained benzylic roots can both be publication-clean at the
 * anchor even when a farther linked-ring centroid bends inward.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Candidate ring anchor atom id.
 * @param {string} childAtomId - Candidate non-ring child atom id.
 * @returns {boolean} True when the immediate child should stay the representative.
 */
function prefersImmediateLinkedSubstituentRepresentative(layoutGraph, anchorAtomId, childAtomId) {
  if (isRingConstrainedBenzylicCarbonRoot(layoutGraph, anchorAtomId, childAtomId)) {
    return true;
  }

  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    !childAtom
    || childAtom.element !== 'C'
    || childAtom.aromatic === true
    || childAtom.heavyDegree !== 3
    || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }

  let heteroMultipleBondCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
      continue;
    }
    const neighborAtomId = bond.a === childAtomId ? bond.b : bond.a;
    if (neighborAtomId === anchorAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || neighborAtom.element === 'C') {
      continue;
    }
    heteroMultipleBondCount++;
  }

  return heteroMultipleBondCount === 1;
}

/**
 * Returns the downstream ring-system representative for a non-ring linker
 * child when that child ultimately leads into exactly one distinct ring
 * system. In those cases the overall linked ring is the visually meaningful
 * direction, not the first linker atom itself.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Candidate ring anchor atom id.
 * @param {string} childAtomId - Candidate non-ring child atom id.
 * @param {Map<number, object>|null} [ringSystemById] - Optional cached ring-system lookup.
 * @returns {{representativeAtomIds: string[]}|null} Downstream ring representative, or `null`.
 */
function _resolveLinkedSubstituentRingRepresentativeImpl(layoutGraph, coords, anchorAtomId, childAtomId, ringSystemById = null) {
  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    anchorRingSystemId == null
    || !childAtom
    || prefersImmediateLinkedSubstituentRepresentative(layoutGraph, anchorAtomId, childAtomId)
    // Do not promote a remote ring through any divalent non-aromatic linker atom.
    // Divalent linkers (–O–, –N–, –CH₂–, –S–, etc.) introduce a free torsion between
    // the anchor ring exit direction and the remote ring, so the far centroid is not a
    // valid outward representative. The immediate child is used instead.
    || (
      childAtom.aromatic !== true
      && childAtom.heavyDegree === 2
    )
  ) {
    return null;
  }

  const visitedAtomIds = new Set([anchorAtomId]);
  // Pair each queued atom with its linker depth (number of non-ring hops traversed).
  // Depth 0 = childAtomId itself. We only continue traversing through non-ring atoms
  // at depth 0 (the first hop). Beyond that, every non-ring atom introduces a free
  // torsion that decouples the far ring's orientation from the anchor exit direction,
  // making its centroid an invalid readability representative.
  const queue = [{ atomId: childAtomId, linkerDepth: 0 }];
  const reachableRingSystemIds = new Set();
  while (queue.length > 0) {
    const { atomId, linkerDepth } = queue.shift();
    if (visitedAtomIds.has(atomId)) {
      continue;
    }
    visitedAtomIds.add(atomId);

    const ringSystemId = layoutGraph.atomToRingSystemId.get(atomId);
    if (ringSystemId != null && ringSystemId !== anchorRingSystemId) {
      reachableRingSystemIds.add(ringSystemId);
      // Do not expand through ring atoms — we only need to know which ring systems
      // are reachable, not traverse their interiors.
      continue;
    }

    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId) || visitedAtomIds.has(neighborAtomId)) {
        continue;
      }
      const neighborInRing = (layoutGraph.atomToRingSystemId.get(neighborAtomId) != null);
      if (neighborInRing) {
        // Always allow traversal into ring atoms — they are the targets.
        queue.push({ atomId: neighborAtomId, linkerDepth });
        continue;
      }
      // Non-ring neighbor: only traverse at depth 0 (first linker hop).
      // Beyond depth 0 there is at least one free torsion, so the far ring
      // centroid is not a valid representative for the anchor exit direction.
      // Additionally, stop at branching sp3 centres (heavyDegree > 2) at any depth.
      if (linkerDepth === 0 && (neighborAtom.heavyDegree ?? 0) <= 2) {
        queue.push({ atomId: neighborAtomId, linkerDepth: linkerDepth + 1 });
      }
    }
  }

  if (reachableRingSystemIds.size !== 1) {
    return null;
  }
  const representativeAtomIds = ringSystemAtomIds(layoutGraph, [...reachableRingSystemIds][0], ringSystemById).filter(atomId => coords.has(atomId));
  return representativeAtomIds.length > 0 ? { representativeAtomIds } : null;
}

function resolveLinkedSubstituentRingRepresentative(layoutGraph, coords, anchorAtomId, childAtomId, ringSystemById = null) {
  const cache = layoutGraph._linkedSubstituentRepCache ?? (layoutGraph._linkedSubstituentRepCache = new Map());
  const cacheKey = `${anchorAtomId}:${childAtomId}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const result = _resolveLinkedSubstituentRingRepresentativeImpl(layoutGraph, coords, anchorAtomId, childAtomId, ringSystemById);
  cache.set(cacheKey, result);
  return result;
}

function incidentRingPolygons(layoutGraph, coords, atomId) {
  return (layoutGraph.atomToRings.get(atomId) ?? []).map(ring => ring.atomIds.map(ringAtomId => coords.get(ringAtomId)).filter(Boolean)).filter(polygon => polygon.length >= 3);
}

function evaluateRingSubstituentSide(layoutGraph, coords, anchorAtomId, representativeAtomIds, ringPolygons, maxOutwardDeviation) {
  const representativePosition = ringSubstituentRepresentativePosition(coords, representativeAtomIds);
  if (!representativePosition) {
    return {
      insideIncidentRing: false,
      outwardAxisFailure: false,
      outwardDeviation: null
    };
  }

  const insideIncidentRing = ringPolygons.some(polygon => pointInPolygon(representativePosition, polygon));
  if (insideIncidentRing) {
    return {
      insideIncidentRing: true,
      outwardAxisFailure: false,
      outwardDeviation: null
    };
  }

  if (!supportsRingSubstituentOutwardReadability(layoutGraph, anchorAtomId)) {
    return {
      insideIncidentRing: false,
      outwardAxisFailure: false,
      outwardDeviation: null
    };
  }

  const outwardDeviation = bestRingOutwardDeviation(layoutGraph, coords, anchorAtomId, representativePosition);
  return {
    insideIncidentRing: false,
    outwardAxisFailure: outwardDeviation != null && outwardDeviation > maxOutwardDeviation,
    outwardDeviation
  };
}

function ringSystemHasBridgedConnection(layoutGraph, ringSystemId) {
  if (ringSystemId == null) {
    return false;
  }
  const ringSystem = layoutGraph.ringSystems.find(candidate => candidate.id === ringSystemId);
  if (!ringSystem || (ringSystem.ringIds?.length ?? 0) <= 1) {
    return false;
  }
  const ringIds = new Set(ringSystem.ringIds);
  return (layoutGraph.ringConnections ?? []).some(connection => (
    connection.kind === 'bridged'
    && ringIds.has(connection.firstRingId)
    && ringIds.has(connection.secondRingId)
  ));
}

function hasClearExteriorRingSubstituentSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons) {
  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  if (!anchorPosition || !childPosition) {
    return true;
  }

  const bondLength = Math.hypot(childPosition.x - anchorPosition.x, childPosition.y - anchorPosition.y);
  if (!(bondLength > 0)) {
    return true;
  }

  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystems.find(candidate => candidate.id === ringSystemId) : null;
  const blockerAtomIds = ringSystem?.atomIds?.filter(atomId => atomId !== anchorAtomId && atomId !== childAtomId && coords.has(atomId)) ?? [];
  if (blockerAtomIds.length === 0) {
    return true;
  }

  const clearanceFloor = bondLength * BRIDGED_RING_SUBSTITUENT_SLOT_CLEARANCE_FACTOR;
  for (let angle = 0; angle < 2 * Math.PI; angle += BRIDGED_RING_SUBSTITUENT_SLOT_SCAN_STEP) {
    const candidatePosition = {
      x: anchorPosition.x + Math.cos(angle) * bondLength,
      y: anchorPosition.y + Math.sin(angle) * bondLength
    };
    if (ringPolygons.some(polygon => pointInPolygon(candidatePosition, polygon))) {
      continue;
    }
    if (
      blockerAtomIds.every(atomId => {
        const blockerPosition = coords.get(atomId);
        return Math.hypot(candidatePosition.x - blockerPosition.x, candidatePosition.y - blockerPosition.y) >= clearanceFloor;
      })
    ) {
      return true;
    }
  }
  return false;
}

function isUnavoidableBridgedRingSubstituentSlot(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds, ringPolygons) {
  if (!layoutGraph || representativeAtomIds.length !== 1 || representativeAtomIds[0] !== childAtomId) {
    return false;
  }
  if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) < 2) {
    return false;
  }
  if (!ringSystemHasBridgedConnection(layoutGraph, layoutGraph.atomToRingSystemId.get(anchorAtomId))) {
    return false;
  }
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'C' || childAtom.aromatic === true || (layoutGraph.atomToRings.get(childAtomId)?.length ?? 0) > 0) {
    return false;
  }
  return !hasClearExteriorRingSubstituentSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons);
}

/**
 * Collects exocyclic ring substituent children that should participate in
 * ring-substituent readability checks. This includes ordinary non-ring heavy
 * substituents and single-bond attached ring systems.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Candidate ring anchor atom id.
 * @param {Map<number, object>|null} [ringSystemById] - Optional cached ring-system lookup.
 * @returns {Array<{childAtomId: string, representativeAtomIds: string[]}>} Readability candidates.
 */
export function collectReadableRingSubstituentChildren(layoutGraph, coords, anchorAtomId, ringSystemById = null) {
  const anchorAtom = layoutGraph.sourceMolecule.atoms.get(anchorAtomId);
  if (!anchorAtom || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
    return [];
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const candidates = [];
  for (const neighborAtom of anchorAtom.getNeighbors(layoutGraph.sourceMolecule)) {
    if (!neighborAtom || neighborAtom.name === 'H' || !coords.has(neighborAtom.id)) {
      continue;
    }

    const pairId = atomPairKey(anchorAtomId, neighborAtom.id);
    const bond = layoutGraph.bondByAtomPair.get(pairId);
    if (!bond || bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) !== 1) {
      continue;
    }

    const childRingCount = layoutGraph.atomToRings.get(neighborAtom.id)?.length ?? 0;
    if (childRingCount === 0) {
      const linkedRingRepresentative = resolveLinkedSubstituentRingRepresentative(layoutGraph, coords, anchorAtomId, neighborAtom.id, ringSystemById);
      if (linkedRingRepresentative) {
        candidates.push({
          childAtomId: neighborAtom.id,
          representativeAtomIds: linkedRingRepresentative.representativeAtomIds
        });
        continue;
      }
      if (reconnectsToAnchorRingSystem(layoutGraph, coords, anchorAtomId, neighborAtom.id)) {
        continue;
      }
      candidates.push({
        childAtomId: neighborAtom.id,
        representativeAtomIds: [neighborAtom.id]
      });
      continue;
    }

    const childRingSystemId = layoutGraph.atomToRingSystemId.get(neighborAtom.id);
    if (childRingSystemId == null || childRingSystemId === anchorRingSystemId) {
      continue;
    }
    const representativeAtomIds = ringSystemAtomIds(layoutGraph, childRingSystemId, ringSystemById).filter(atomId => coords.has(atomId));
    if (representativeAtomIds.length === 0) {
      continue;
    }
    candidates.push({
      childAtomId: neighborAtom.id,
      representativeAtomIds
    });
  }

  return candidates;
}

/**
 * Computes the representative point used for ring-substituent readability
 * scoring. Single-atom substituents use their atom position; attached ring
 * systems use the centroid of the attached ring-system atoms.
 * @param {Map<string, {x: number, y: number}>} coords - Base coordinate map.
 * @param {string[]} representativeAtomIds - Atom ids describing the substituent direction.
 * @param {Map<string, {x: number, y: number}>|null} [overridePositions] - Optional override positions.
 * @returns {{x: number, y: number}|null} Representative position, or null when unavailable.
 */
export function ringSubstituentRepresentativePosition(coords, representativeAtomIds, overridePositions = null) {
  if (!Array.isArray(representativeAtomIds) || representativeAtomIds.length === 0) {
    return null;
  }
  const positions = representativeAtomIds.map(atomId => overridePositions?.get(atomId) ?? coords.get(atomId)).filter(Boolean);
  if (positions.length === 0) {
    return null;
  }
  return positions.length === 1 ? positions[0] : centroid(positions);
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

function bestRingOutwardDeviation(layoutGraph, coords, anchorAtomId, representativePosition) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition || !representativePosition) {
    return null;
  }

  const childAngle = angleOf(sub(representativePosition, anchorPosition));
  let bestDeviation = Number.POSITIVE_INFINITY;
  for (const outwardAngle of computeIncidentRingOutwardAngles(layoutGraph, anchorAtomId, atomId => coords.get(atomId) ?? null)) {
    bestDeviation = Math.min(bestDeviation, angularDifference(childAngle, outwardAngle));
  }

  return Number.isFinite(bestDeviation) ? bestDeviation : null;
}

function immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, childAtomId) {
  return bestRingOutwardDeviation(layoutGraph, coords, anchorAtomId, coords.get(childAtomId) ?? null);
}

/**
 * Measures whether ring-bound heavy substituents stay outside incident ring
 * faces and reasonably close to a local ring-outward direction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{maxOutwardDeviation?: number, maxSevereImmediateOutwardDeviation?: number, focusAtomIds?: Set<string>|null}} [options] - Readability options.
 * @returns {{failingSubstituentCount: number, inwardSubstituentCount: number, outwardAxisFailureCount: number, totalOutwardDeviation: number, maxOutwardDeviation: number}} Readability summary.
 */
export function measureRingSubstituentReadability(layoutGraph, coords, options = {}) {
  const maxOutwardDeviation = options.maxOutwardDeviation ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation;
  const maxSevereImmediateOutwardDeviation =
    options.maxSevereImmediateOutwardDeviation ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxSevereImmediateOutwardDeviation;
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  const ringSystemById = new Map(layoutGraph.ringSystems.map(rs => [rs.id, rs]));
  let failingSubstituentCount = 0;
  let inwardSubstituentCount = 0;
  let outwardAxisFailureCount = 0;
  let totalOutwardDeviation = 0;
  let maxObservedOutwardDeviation = 0;
  const seenPairs = new Set();

  for (const anchorAtomId of coords.keys()) {
    if (focusAtomIds && !focusAtomIds.has(anchorAtomId)) {
      continue;
    }
    if ((layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0 || !isVisibleLayoutAtom(layoutGraph, anchorAtomId)) {
      continue;
    }

    const substituentChildren = collectReadableRingSubstituentChildren(layoutGraph, coords, anchorAtomId, ringSystemById);
    if (substituentChildren.length === 0) {
      continue;
    }

    const ringPolygons = incidentRingPolygons(layoutGraph, coords, anchorAtomId);
    for (const childDescriptor of substituentChildren) {
      const childAtomId = childDescriptor.childAtomId;
      const childAtom = layoutGraph.atoms.get(childAtomId);
      const pairId = atomPairKey(anchorAtomId, childAtomId);
      if (seenPairs.has(pairId)) {
        continue;
      }
      seenPairs.add(pairId);

      const forwardSide = evaluateRingSubstituentSide(layoutGraph, coords, anchorAtomId, childDescriptor.representativeAtomIds, ringPolygons, maxOutwardDeviation);
      const requiresSevereImmediateOutwardCheck =
        childDescriptor.representativeAtomIds.length > 1
        || (childAtom != null && childAtom.element !== 'C' && childAtom.element !== 'H');
      const severeImmediateOutwardDeviation =
        requiresSevereImmediateOutwardCheck
          ? immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, childAtomId)
          : null;
      const severeImmediateOutwardFailure =
        severeImmediateOutwardDeviation != null && severeImmediateOutwardDeviation > maxSevereImmediateOutwardDeviation;
      const linkedRepresentativeOutwardFailureRelaxed =
        childDescriptor.representativeAtomIds.length > 1
        && severeImmediateOutwardDeviation != null
        && severeImmediateOutwardDeviation <= 1e-6
        && Number.isFinite(forwardSide.outwardDeviation)
        && forwardSide.outwardDeviation <= maxOutwardDeviation + LINKED_RING_REPRESENTATIVE_OUTWARD_READABILITY_SLACK;
      const forwardOutwardAxisFailure = forwardSide.outwardAxisFailure && !linkedRepresentativeOutwardFailureRelaxed;
      const inwardSlotIsUnavoidable = forwardSide.insideIncidentRing && isUnavoidableBridgedRingSubstituentSlot(
        layoutGraph,
        coords,
        anchorAtomId,
        childAtomId,
        childDescriptor.representativeAtomIds,
        ringPolygons
      );
      if (forwardSide.insideIncidentRing && !inwardSlotIsUnavoidable) {
        failingSubstituentCount++;
        inwardSubstituentCount++;
      } else if (forwardOutwardAxisFailure || severeImmediateOutwardFailure) {
        failingSubstituentCount++;
        outwardAxisFailureCount++;
      }
      if (Number.isFinite(forwardSide.outwardDeviation)) {
        totalOutwardDeviation += forwardSide.outwardDeviation;
        maxObservedOutwardDeviation = Math.max(maxObservedOutwardDeviation, forwardSide.outwardDeviation);
      }
      if (Number.isFinite(severeImmediateOutwardDeviation)) {
        totalOutwardDeviation += severeImmediateOutwardDeviation;
        maxObservedOutwardDeviation = Math.max(maxObservedOutwardDeviation, severeImmediateOutwardDeviation);
      }

      if (childDescriptor.representativeAtomIds.length <= 1) {
        continue;
      }
      const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
      if (anchorRingSystemId == null) {
        continue;
      }
      const reverseRepresentativeAtomIds = ringSystemAtomIds(layoutGraph, anchorRingSystemId, ringSystemById).filter(atomId => coords.has(atomId));
      if (reverseRepresentativeAtomIds.length === 0) {
        continue;
      }
      const reverseSide = evaluateRingSubstituentSide(
        layoutGraph,
        coords,
        childAtomId,
        reverseRepresentativeAtomIds,
        incidentRingPolygons(layoutGraph, coords, childAtomId),
        maxOutwardDeviation
      );
      if (reverseSide.insideIncidentRing) {
        failingSubstituentCount++;
        inwardSubstituentCount++;
      } else if (reverseSide.outwardAxisFailure) {
        failingSubstituentCount++;
        outwardAxisFailureCount++;
      }
      if (Number.isFinite(reverseSide.outwardDeviation)) {
        totalOutwardDeviation += reverseSide.outwardDeviation;
        maxObservedOutwardDeviation = Math.max(maxObservedOutwardDeviation, reverseSide.outwardDeviation);
      }
    }
  }

  return {
    failingSubstituentCount,
    inwardSubstituentCount,
    outwardAxisFailureCount,
    totalOutwardDeviation,
    maxOutwardDeviation: maxObservedOutwardDeviation
  };
}

/**
 * Finds severe nonbonded overlaps in the current coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Overlap-query options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid.
 * @returns {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} Severe overlaps.
 */
export function findSevereOverlaps(layoutGraph, coords, bondLength, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const atomGrid = options.atomGrid ?? buildAtomGrid(layoutGraph, coords, bondLength);
  return collectNonbondedPairs(layoutGraph, coords, (_firstAtomId, _secondAtomId, distance) => distance < threshold, atomGrid, threshold);
}

/**
 * Measures bond-length deviation from the target depiction bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {{bondValidationClasses?: Map<string, 'planar'|'bridged'>}} [options] - Bond-validation options.
 * @returns {{sampleCount: number, maxDeviation: number, meanDeviation: number, failingBondCount: number}} Bond-length statistics.
 */
export function measureBondLengthDeviation(layoutGraph, coords, bondLength, options = {}) {
  let sampleCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;
  let failingBondCount = 0;
  let mildFailingBondCount = 0;
  let severeFailingBondCount = 0;
  const bondValidationClasses = options.bondValidationClasses ?? new Map();

  for (const bond of layoutGraph.bonds.values()) {
    if (!isAuditableBond(layoutGraph, bond)) {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    const deviation = isAcceptedCompressedTerminalRingLeafBond(layoutGraph, coords, bond, distance, bondLength)
      ? 0
      : Math.abs(distance - bondLength);
    const validationSettings = validationSettingsForClass(bondValidationClasses.get(bond.id));
    const allowedDeviation = bondLength * Math.max(Math.abs(1 - validationSettings.minBondLengthFactor), Math.abs(validationSettings.maxBondLengthFactor - 1));
    sampleCount++;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
    if (deviation > allowedDeviation) {
      failingBondCount++;
      if (deviation > allowedDeviation * 2) {
        severeFailingBondCount++;
      } else {
        mildFailingBondCount++;
      }
    }
  }

  return {
    sampleCount,
    maxDeviation,
    meanDeviation: sampleCount === 0 ? 0 : totalDeviation / sampleCount,
    failingBondCount,
    mildFailingBondCount,
    severeFailingBondCount
  };
}

/**
 * Returns whether the center should contribute to trigonal distortion.
 * This covers atoms with an explicit multiple bond and planar conjugated
 * tertiary nitrogens whose branch placement already uses trigonal slots.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate center atom identifier.
 * @param {Array<{bond: object, neighborAtomId: string}>} covalentBonds - Visible covalent bonds for the center.
 * @returns {boolean} True when the center should be scored against trigonal separation.
 */
function shouldMeasureTrigonalDistortionAtCenter(layoutGraph, atomId, covalentBonds) {
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

/**
 * Returns whether the center should contribute to divalent zigzag-continuation distortion.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate center atom identifier.
 * @param {Array<{bond: object, neighborAtomId: string}>} covalentBonds - Visible covalent bonds for the center.
 * @returns {boolean} True when the center should be scored against a 120-degree continuation.
 */
function shouldMeasureDivalentContinuationDistortionAtCenter(layoutGraph, atomId, covalentBonds) {
  if (covalentBonds.length !== 2) {
    return false;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (
    !atom
    || atom.aromatic
    || (layoutGraph.atomToRings?.get(atomId)?.length ?? 0) > 0
  ) {
    return false;
  }
  const isExactDivalentElement =
    IDEAL_DIVALENT_CONTINUATION_ELEMENTS.has(atom.element)
    || (
      atom.element === 'N'
      && covalentBonds.some(({ neighborAtomId }) => isConjugatedTrigonalHeavyNeighbor(layoutGraph, neighborAtomId))
    );
  if (!isExactDivalentElement) {
    return false;
  }
  return covalentBonds.every(({ bond, neighborAtomId }) => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom && neighborAtom.element !== 'H' && !bond.aromatic && (bond.order ?? 1) === 1;
  });
}

/**
 * Returns whether the center should contribute to omitted-h continuation distortion.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate center atom identifier.
 * @param {Array<{bond: object, neighborAtomId: string}>} covalentBonds - Visible covalent bonds for the center.
 * @returns {boolean} True when the center should be scored against trigonal separation.
 */
function shouldMeasureThreeHeavyContinuationDistortionAtCenter(layoutGraph, atomId, covalentBonds) {
  if (covalentBonds.length !== 3) {
    return false;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || atom.aromatic || atom.element !== 'C') {
    return false;
  }
  const multipleBondCount = covalentBonds.filter(({ bond }) => (bond.order ?? 1) >= 2).length;
  if (multipleBondCount !== 0) {
    return false;
  }
  if (layoutGraph.options.suppressH !== true) {
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

/**
 * Returns the squared angular-separation deviation from an ideal three-way trigonal spread.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {Array<{bond: object, neighborAtomId: string}>} covalentBonds - Visible covalent bonds for the center.
 * @param {string} atomId - Center atom identifier.
 * @param {(atomId: string) => ({x: number, y: number}|undefined)} getPos - Position resolver.
 * @returns {number} Squared angular deviation.
 */
function measureThreeCoordinateDeviation(coords, covalentBonds, atomId, getPos) {
  const atomPosition = getPos(atomId) ?? coords.get(atomId);
  if (!atomPosition) {
    return 0;
  }
  const neighborAngles = covalentBonds.map(({ neighborAtomId }) => {
    const neighborPosition = getPos(neighborAtomId) ?? coords.get(neighborAtomId);
    return Math.atan2(neighborPosition.y - atomPosition.y, neighborPosition.x - atomPosition.x);
  });
  const separations = sortedAngularSeparations(neighborAngles);
  const idealSeparation = (Math.PI * 2) / 3;
  return separations.reduce((sum, separation) => sum + (separation - idealSeparation) ** 2, 0);
}

/**
 * Measures distortion at visible three-coordinate centers that should read as
 * roughly trigonal in a publication-style 2D depiction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{focusAtomIds?: Set<string>|null}} [options] - Optional local scoring focus.
 * @returns {{centerCount: number, totalDeviation: number, maxDeviation: number}} Trigonal distortion statistics.
 */
export function measureTrigonalDistortion(layoutGraph, coords, options = {}) {
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  let centerCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (const atomId of coords.keys()) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    if (focusAtomIds && !focusAtomIds.has(atomId)) {
      continue;
    }
    const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId);
    if (!shouldMeasureTrigonalDistortionAtCenter(layoutGraph, atomId, covalentBonds)) {
      continue;
    }
    const deviation = measureThreeCoordinateDeviation(coords, covalentBonds, atomId, () => undefined);
    centerCount++;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return {
    centerCount,
    totalDeviation,
    maxDeviation
  };
}

/**
 * Measures distortion at visible saturated three-heavy carbon centers
 * whose omitted hydrogen should still leave the drawn heavy-atom spread near 120/120/120.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{focusAtomIds?: Set<string>|null}} [options] - Optional local scoring focus.
 * @returns {{centerCount: number, totalDeviation: number, maxDeviation: number}} Continuation distortion statistics.
 */
export function measureThreeHeavyContinuationDistortion(layoutGraph, coords, options = {}) {
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  let centerCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (const atomId of coords.keys()) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    if (focusAtomIds && !focusAtomIds.has(atomId)) {
      continue;
    }
    const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId);
    if (!shouldMeasureThreeHeavyContinuationDistortionAtCenter(layoutGraph, atomId, covalentBonds)) {
      continue;
    }
    const deviation = measureThreeCoordinateDeviation(coords, covalentBonds, atomId, () => undefined);
    centerCount++;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return {
    centerCount,
    totalDeviation,
    maxDeviation
  };
}

/**
 * Measures distortion at shared-junction exits that should stay on the exact
 * continuation of the shared junction bond when that straight exterior slot is
 * already clear. This covers both direct-attached foreign ring blocks and
 * exocyclic non-ring branches that inherit the same shared-junction rule.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{focusAtomIds?: Set<string>|null}} [options] - Optional local scoring focus.
 * @returns {{centerCount: number, totalDeviation: number, maxDeviation: number}} Continuation distortion statistics.
 */
export function measureDirectAttachedRingJunctionContinuationDistortion(layoutGraph, coords, options = {}) {
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  let centerCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;

  for (const anchorAtomId of coords.keys()) {
    if (!isVisibleLayoutAtom(layoutGraph, anchorAtomId) || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0) {
      continue;
    }
    const anchorAtom = layoutGraph.sourceMolecule.atoms.get(anchorAtomId);
    if (!anchorAtom) {
      continue;
    }

    for (const childAtom of anchorAtom.getNeighbors(layoutGraph.sourceMolecule)) {
      const childAtomId = childAtom?.id;
      if (!childAtomId || !coords.has(childAtomId) || !isVisibleLayoutAtom(layoutGraph, childAtomId)) {
        continue;
      }
      if (focusAtomIds && !focusAtomIds.has(anchorAtomId) && !focusAtomIds.has(childAtomId)) {
        continue;
      }

      const preferredAngle = preferredSharedJunctionContinuationAngle(layoutGraph, coords, anchorAtomId, childAtomId);
      if (preferredAngle == null) {
        continue;
      }

      const deviation = angularDifference(angleOf(sub(coords.get(childAtomId), coords.get(anchorAtomId))), preferredAngle) ** 2;
      centerCount++;
      totalDeviation += deviation;
      maxDeviation = Math.max(maxDeviation, deviation);
    }
  }

  return {
    centerCount,
    totalDeviation,
    maxDeviation
  };
}

/**
 * Measures angular distortion at visible saturated four-coordinate heavy centers
 * that should remain roughly tetrahedral in a publication-style 2D depiction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{centerCount: number, totalDeviation: number, maxDeviation: number}} Tetrahedral distortion statistics.
 */
export function measureTetrahedralDistortion(layoutGraph, coords) {
  let centerCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;
  const idealSeparation = Math.PI / 2;

  for (const atomId of coords.keys()) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId).filter(({ neighborAtomId }) => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (covalentBonds.length !== 4) {
      continue;
    }
    if (covalentBonds.some(({ bond }) => bond.aromatic || (bond.order ?? 1) !== 1)) {
      continue;
    }

    const atomPosition = coords.get(atomId);
    const neighborAngles = covalentBonds.map(({ neighborAtomId }) => {
      const neighborPosition = coords.get(neighborAtomId);
      return Math.atan2(neighborPosition.y - atomPosition.y, neighborPosition.x - atomPosition.x);
    });
    const separations = sortedAngularSeparations(neighborAngles);
    const deviation = separations.reduce((sum, separation) => sum + (separation - idealSeparation) ** 2, 0);
    centerCount++;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
  }

  return {
    centerCount,
    totalDeviation,
    maxDeviation
  };
}

/**
 * Detects obviously collapsed macrocycle depictions.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {number[]} Macrocycle ring IDs flagged as collapsed.
 */
export function detectCollapsedMacrocycles(layoutGraph, coords, bondLength) {
  const collapsedRingIds = [];
  for (const ring of layoutGraph.rings) {
    if (ring.size < 12 || !ring.atomIds.every(atomId => coords.has(atomId))) {
      continue;
    }
    const bounds = computeBounds(coords, ring.atomIds);
    if (!bounds) {
      continue;
    }
    if (bounds.width < bondLength * 3 || bounds.height < bondLength * 1.25) {
      collapsedRingIds.push(ring.id);
    }
  }
  return collapsedRingIds;
}

/**
 * Computes the trigonal + tetrahedral angular distortion penalty at a single atom.
 * Accepts an optional override map so callers can evaluate a hypothetical neighbor position
 * without mutating the coordinate map.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map (not mutated).
 * @param {string} atomId - Atom to evaluate.
 * @param {Map<string, {x: number, y: number}>|null} overridePositions - Positions that override coords for specific atoms.
 * @returns {number} Distortion penalty for the atom.
 */
export function computeAtomDistortionCost(layoutGraph, coords, atomId, overridePositions) {
  if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
    return 0;
  }
  const getPos = id => overridePositions?.get(id) ?? coords.get(id);
  const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId);
  let cost = 0;

  if (covalentBonds.length === 2) {
    if (shouldMeasureDivalentContinuationDistortionAtCenter(layoutGraph, atomId, covalentBonds)) {
      const atomPosition = getPos(atomId);
      if (atomPosition) {
        const [firstBond, secondBond] = covalentBonds;
        const firstNeighborPosition = getPos(firstBond.neighborAtomId);
        const secondNeighborPosition = getPos(secondBond.neighborAtomId);
        if (firstNeighborPosition && secondNeighborPosition) {
          const bondAngle = angularDifference(
            Math.atan2(firstNeighborPosition.y - atomPosition.y, firstNeighborPosition.x - atomPosition.x),
            Math.atan2(secondNeighborPosition.y - atomPosition.y, secondNeighborPosition.x - atomPosition.x)
          );
          cost += (bondAngle - (2 * Math.PI) / 3) ** 2 * 20;
        }
      }
    }
  } else if (covalentBonds.length === 3) {
    if (shouldMeasureTrigonalDistortionAtCenter(layoutGraph, atomId, covalentBonds) || shouldMeasureThreeHeavyContinuationDistortionAtCenter(layoutGraph, atomId, covalentBonds)) {
      cost += measureThreeCoordinateDeviation(coords, covalentBonds, atomId, getPos) * 20;
    }
  } else if (covalentBonds.length === 4) {
    const heavyBonds = covalentBonds.filter(({ neighborAtomId }) => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (heavyBonds.length === 4 && heavyBonds.every(({ bond }) => !bond.aromatic && (bond.order ?? 1) === 1)) {
      const atomPosition = getPos(atomId);
      if (atomPosition) {
        const neighborAngles = heavyBonds.map(({ neighborAtomId }) => {
          const neighborPosition = getPos(neighborAtomId);
          return Math.atan2(neighborPosition.y - atomPosition.y, neighborPosition.x - atomPosition.x);
        });
        const separations = sortedAngularSeparations(neighborAngles);
        const idealSeparation = Math.PI / 2;
        cost += separations.reduce((sum, separation) => sum + (separation - idealSeparation) ** 2, 0) * 20;
      }
    }
  }

  return cost;
}

/**
 * Computes the overlap penalty contributed by a subtree of atoms against all non-subtree atoms.
 * Used by the local cleanup pass to evaluate rotation candidates in O(k·n) instead of O(n²).
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map (not mutated).
 * @param {string[]} subtreeAtomIds - Atom IDs in the moving subtree.
 * @param {Map<string, {x: number, y: number}>|null} overridePositions - Override positions for the subtree atoms, or null to use coords.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Cost options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid built from coords.
 * @param {boolean} [options.includeAtomOverlaps] - Whether to score nonbonded atom overlaps.
 * @param {boolean} [options.includeBondCrowding] - Whether to add nonadjacent bond-segment crowding penalties.
 * @param {{subtreeSet: Set<string>, visibleSubtreeAtomIds: string[], subtreeBonds?: object[], externalBonds?: object[]}|null} [options.subtreeContext] - Optional reusable subtree-overlap context.
 * @returns {number} Overlap penalty for the subtree.
 */
export function computeSubtreeOverlapCost(layoutGraph, coords, subtreeAtomIds, overridePositions, bondLength, options = {}) {
  const includeAtomOverlaps = options.includeAtomOverlaps !== false;
  const subtreeContext =
    options.subtreeContext ??
    buildSubtreeOverlapContext(layoutGraph, subtreeAtomIds, {
      includeBondCrowding: options.includeBondCrowding === true
    });
  const subtreeSet = subtreeContext.subtreeSet;
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  let cost = 0;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const subtreeAtomId of subtreeContext.visibleSubtreeAtomIds) {
    const pos = overridePositions?.get(subtreeAtomId) ?? coords.get(subtreeAtomId);
    if (!pos) {
      continue;
    }
    if (pos.x < minX) {
      minX = pos.x;
    }
    if (pos.y < minY) {
      minY = pos.y;
    }
    if (pos.x > maxX) {
      maxX = pos.x;
    }
    if (pos.y > maxY) {
      maxY = pos.y;
    }
  }

  if (minX === Number.POSITIVE_INFINITY) {
    return 0;
  }

  const atomGrid = options.atomGrid ?? buildAtomGrid(layoutGraph, coords, bondLength);

  if (includeAtomOverlaps) {
    const bboxCandidateIds = atomGrid.queryBoundingBox(minX - threshold, minY - threshold, maxX + threshold, maxY + threshold);
    let hasExternalCandidates = false;
    for (const candidateId of bboxCandidateIds) {
      if (!subtreeSet.has(candidateId) && isVisibleLayoutAtom(layoutGraph, candidateId)) {
        hasExternalCandidates = true;
        break;
      }
    }

    if (hasExternalCandidates) {
      for (const subtreeAtomId of subtreeContext.visibleSubtreeAtomIds) {
        const pos = overridePositions?.get(subtreeAtomId) ?? coords.get(subtreeAtomId);
        if (!pos) {
          continue;
        }
        const nearbyAtomIds = atomGrid.queryRadius(pos, threshold);
        for (const atomId of nearbyAtomIds) {
          if (subtreeSet.has(atomId) || !isVisibleLayoutAtom(layoutGraph, atomId)) {
            continue;
          }
          if (layoutGraph.bondedPairSet.has(atomPairKey(subtreeAtomId, atomId))) {
            continue;
          }
          const otherPos = coords.get(atomId);
          if (!otherPos) {
            continue;
          }
          const d = Math.hypot(otherPos.x - pos.x, otherPos.y - pos.y);
          if (d < threshold) {
            const deficit = threshold - d;
            cost += deficit * deficit * 100;
          }
        }
      }
    }
  }

  if (options.includeBondCrowding === true) {
    const bondCrowdingThreshold = bondLength * SUBTREE_BOND_CROWDING_FACTOR;
    const subtreeBonds = subtreeContext.subtreeBonds ?? [];
    const externalBonds = subtreeContext.externalBonds ?? [];

    for (const bond of subtreeBonds) {
      const firstPosition = overridePositions?.get(bond.a) ?? coords.get(bond.a);
      const secondPosition = overridePositions?.get(bond.b) ?? coords.get(bond.b);
      if (!firstPosition || !secondPosition) {
        continue;
      }
      for (const externalBond of externalBonds) {
        if (bond.a === externalBond.a || bond.a === externalBond.b || bond.b === externalBond.a || bond.b === externalBond.b) {
          continue;
        }
        const externalFirstPosition = coords.get(externalBond.a);
        const externalSecondPosition = coords.get(externalBond.b);
        if (!externalFirstPosition || !externalSecondPosition) {
          continue;
        }
        const distance = distanceBetweenSegments(firstPosition, secondPosition, externalFirstPosition, externalSecondPosition);
        if (distance < bondCrowdingThreshold) {
          const deficit = bondCrowdingThreshold - distance;
          cost += deficit * deficit * SUBTREE_BOND_CROWDING_WEIGHT;
        }
      }
    }
  }
  return cost;
}

/**
 * Measures overlapping atom-label boxes using the shared cleanup/render width model.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Label-overlap options.
 * @param {object|null} [options.labelMetrics] - Optional renderer-supplied label metrics.
 * @returns {{pairCount: number, totalPenalty: number, maxPenalty: number}} Label-overlap statistics.
 */
export function measureLabelOverlap(layoutGraph, coords, bondLength, options = {}) {
  const labelBoxes = collectLabelBoxes(layoutGraph, coords, bondLength, {
    labelMetrics: options.labelMetrics
  });
  const overlaps = findLabelOverlaps(layoutGraph, coords, bondLength, {
    labelMetrics: options.labelMetrics,
    labelBoxes
  });
  let totalPenalty = 0;
  let maxPenalty = 0;

  for (const overlap of overlaps) {
    const penalty = overlap.overlapX + overlap.overlapY;
    totalPenalty += penalty;
    maxPenalty = Math.max(maxPenalty, penalty);
  }

  return {
    pairCount: overlaps.length,
    totalPenalty,
    maxPenalty
  };
}

/**
 * Fused single-pass computation of trigonal and tetrahedral angular distortion.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{trigonalDistortion: {centerCount: number, totalDeviation: number, maxDeviation: number}, tetrahedralDistortion: {centerCount: number, totalDeviation: number, maxDeviation: number}}} Combined distortion metrics.
 */
function measureAngularDistortions(layoutGraph, coords) {
  let trigCenterCount = 0;
  let trigTotalDeviation = 0;
  let trigMaxDeviation = 0;
  let tetCenterCount = 0;
  let tetTotalDeviation = 0;
  let tetMaxDeviation = 0;
  const idealTetSeparation = Math.PI / 2;

  for (const atomId of coords.keys()) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId);

    if (shouldMeasureTrigonalDistortionAtCenter(layoutGraph, atomId, covalentBonds)) {
      const deviation = measureThreeCoordinateDeviation(coords, covalentBonds, atomId, () => undefined);
      trigCenterCount++;
      trigTotalDeviation += deviation;
      trigMaxDeviation = Math.max(trigMaxDeviation, deviation);
    }

    const heavyBonds = covalentBonds.filter(({ neighborAtomId }) => layoutGraph.atoms.get(neighborAtomId)?.element !== 'H');
    if (heavyBonds.length === 4 && heavyBonds.every(({ bond }) => !bond.aromatic && (bond.order ?? 1) === 1)) {
      const atomPosition = coords.get(atomId);
      if (atomPosition) {
        const neighborAngles = heavyBonds.map(({ neighborAtomId }) => {
          const neighborPosition = coords.get(neighborAtomId);
          return Math.atan2(neighborPosition.y - atomPosition.y, neighborPosition.x - atomPosition.x);
        });
        const deviation = sortedAngularSeparations(neighborAngles).reduce((sum, sep) => sum + (sep - idealTetSeparation) ** 2, 0);
        tetCenterCount++;
        tetTotalDeviation += deviation;
        tetMaxDeviation = Math.max(tetMaxDeviation, deviation);
      }
    }
  }

  return {
    trigonalDistortion: { centerCount: trigCenterCount, totalDeviation: trigTotalDeviation, maxDeviation: trigMaxDeviation },
    tetrahedralDistortion: { centerCount: tetCenterCount, totalDeviation: tetTotalDeviation, maxDeviation: tetMaxDeviation }
  };
}

/**
 * Measures the major layout-quality signals used by branch placement and the
 * final pipeline audit.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {{overlaps?: object[], atomGrid?: object|null, labelMetrics?: object|null}} [options] - Optional cached overlap and label-scoring inputs.
 * @returns {{overlaps: object[], bondDeviation: {max: number, mean: number, failureCount: number, mildFailureCount: number, severeFailureCount: number, sampleCount: number}, collapsedMacrocycles: number[], labelOverlap: {count: number}, trigonalDistortion: {centerCount: number, totalDeviation: number, maxDeviation: number}, tetrahedralDistortion: {centerCount: number, totalDeviation: number, maxDeviation: number}, cost: number}} Aggregated layout state metrics.
 */
export function measureLayoutState(layoutGraph, coords, bondLength, options = {}) {
  const overlaps =
    options.overlaps ??
    findSevereOverlaps(layoutGraph, coords, bondLength, {
      atomGrid: options.atomGrid
    });
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
  const collapsedMacrocycles = detectCollapsedMacrocycles(layoutGraph, coords, bondLength);
  const labelOverlap = measureLabelOverlap(layoutGraph, coords, bondLength, {
    labelMetrics: options.labelMetrics ?? layoutGraph.options.labelMetrics
  });
  const { trigonalDistortion, tetrahedralDistortion } = measureAngularDistortions(layoutGraph, coords);

  let overlapPenalty = 0;
  for (const overlap of overlaps) {
    const deficit = bondLength * SEVERE_OVERLAP_FACTOR - overlap.distance;
    overlapPenalty += deficit * deficit * 100;
  }

  const bondPenalty = bondDeviation.meanDeviation * 10 + bondDeviation.maxDeviation * 5;
  const macrocyclePenalty = collapsedMacrocycles.length * 1000;
  const labelPenalty = labelOverlap.totalPenalty * 10;
  const trigonalPenalty = trigonalDistortion.totalDeviation * 20;
  const tetrahedralPenalty = tetrahedralDistortion.totalDeviation * 20;
  return {
    overlaps,
    overlapCount: overlaps.length,
    overlapPenalty,
    bondDeviation,
    collapsedMacrocycles,
    labelOverlap,
    trigonalDistortion,
    tetrahedralDistortion,
    cost: overlapPenalty + bondPenalty + macrocyclePenalty + labelPenalty + trigonalPenalty + tetrahedralPenalty
  };
}

/**
 * Computes a reduced cleanup state focused on overlaps and bond-length drift.
 * This is meant for inner-loop cleanup prescoring where label/macrocycle and
 * angular distortion penalties are too expensive to evaluate for every probe.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - State-measurement options.
 * @param {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} [options.overlaps] - Optional precomputed severe overlaps.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid for overlap lookup.
 * @param {Map<string, 'planar'|'bridged'>} [options.bondValidationClasses] - Optional bond-validation classes.
 * @returns {{overlaps: Array<{firstAtomId: string, secondAtomId: string, distance: number}>, overlapCount: number, overlapPenalty: number, bondDeviation: {sampleCount: number, maxDeviation: number, meanDeviation: number, failingBondCount: number}, cost: number}} Reduced overlap-focused layout state.
 */
export function measureOverlapState(layoutGraph, coords, bondLength, options = {}) {
  const overlaps =
    options.overlaps ??
    findSevereOverlaps(layoutGraph, coords, bondLength, {
      atomGrid: options.atomGrid
    });
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength, {
    bondValidationClasses: options.bondValidationClasses
  });

  let overlapPenalty = 0;
  for (const overlap of overlaps) {
    const deficit = bondLength * SEVERE_OVERLAP_FACTOR - overlap.distance;
    overlapPenalty += deficit * deficit * 100;
  }

  const bondPenalty = bondDeviation.meanDeviation * 10 + bondDeviation.maxDeviation * 5;
  return {
    overlaps,
    overlapCount: overlaps.length,
    overlapPenalty,
    bondDeviation,
    cost: overlapPenalty + bondPenalty
  };
}

/**
 * Computes the current cleanup/audit cost for a coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @returns {number} Aggregate layout cost.
 */
export function measureLayoutCost(layoutGraph, coords, bondLength) {
  return measureLayoutState(layoutGraph, coords, bondLength).cost;
}
