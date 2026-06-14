/** @module audit/invariants */

import { collectLabelBoxes, summarizeLabelOverlaps } from '../geometry/label-box.js';
import { computeBounds } from '../geometry/bounds.js';
import { AtomGrid } from '../geometry/atom-grid.js';
import { distancePointToSegment, segmentsIntersect, segmentsProperlyIntersect } from '../geometry/segments.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { incidentRingPolygonsForAtom } from '../geometry/ring-polygons.js';
import { angleOf, angularDifference, centroid, sub } from '../geometry/vec2.js';
import { computeIncidentRingOutwardAngles } from '../geometry/ring-direction.js';
import {
  describeChargedSulfoxideTrigonalCenter,
  isExactVisibleTrigonalBisectorEligible,
  isPlanarDivalentNitrogenContinuationPair,
  isRingConstrainedBenzylicCarbonRoot,
  preferredSharedJunctionContinuationAngle
} from '../placement/branch-placement/angle-selection.js';
import { isMetalAtom } from '../topology/metal-centers.js';
import { describePathLikeIsolatedRingChain } from '../topology/isolated-ring-chain.js';
import { atomPairKey, AUDIT_PLANAR_VALIDATION, BRIDGED_VALIDATION, HAPTIC_VALIDATION, RING_SUBSTITUENT_READABILITY_LIMITS, SEVERE_OVERLAP_FACTOR } from '../constants.js';

const SUBTREE_BOND_CROWDING_FACTOR = 0.5;
const SUBTREE_BOND_CROWDING_WEIGHT = 25;
const IDEAL_DIVALENT_CONTINUATION_ELEMENTS = new Set(['C', 'O', 'S', 'Se']);
const LINKED_RING_REPRESENTATIVE_OUTWARD_READABILITY_SLACK = Math.PI / 180;
const COMPRESSIBLE_TERMINAL_RING_LEAF_ELEMENTS = new Set(['C', 'F', 'Cl', 'Br', 'I', 'O', 'S', 'Se']);
const COMPRESSED_TERMINAL_RING_LEAF_ANGLE_TOLERANCE = Math.PI / 180;
const COMPRESSED_TERMINAL_CARBONYL_LEAF_MIN_FACTOR = 0.4;
const COMPRESSED_TERMINAL_CARBONYL_LEAF_CLASH_FACTOR = 0.45;
const COMPRESSED_TERMINAL_CARBONYL_LINEAR_RING_MIN_FACTOR = 0.75;
const COMPRESSED_TERMINAL_CARBONYL_LINEAR_RING_ANGLE_TOLERANCE = Math.PI / 12;
const MARGINAL_STRETCHED_FUSED_AZA_BRIDGE_MAX_FACTOR = BRIDGED_VALIDATION.maxBondLengthFactor + 0.03;
const COMPRESSED_AZACAGE_TERMINAL_CARBON_LEAF_MAX_FACTOR = BRIDGED_VALIDATION.minBondLengthFactor;
const COMPACT_AZABICYCLIC_LACTAM_MIN_FACTOR = 0.45;
const COMPACT_AZABICYCLIC_LACTAM_MAX_FACTOR = 1.62;
const COMPACT_TRIAPEX_AMINOKETONE_MIN_FACTOR = 0.35;
const COMPACT_BRIDGED_ETHER_MIN_FACTOR = 0.5;
const COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_OVERLAP_MAX_HEAVY_ATOMS = 40;
const COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_OVERLAP_MIN_FACTOR = 0.5;
const COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_OVERLAP_TWO_RING_MIN_FACTOR = 0.4;
const COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_OVERLAP_RELAXED_MIN_FACTOR = 0.45;
const COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_OVERLAP_MAX_HEAVY_ATOMS = 40;
const COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_OVERLAP_MIN_FACTOR = 0.4;
const COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_OVERLAP_RELAXED_MIN_FACTOR = 0.24;
const COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_ELEMENTS = new Set(['O', 'S', 'Se']);
const COMPACT_BRIDGED_SMALL_ACYCLIC_HETERO_LEAF_OVERLAP_MAX_HEAVY_ATOMS = 40;
const COMPACT_BRIDGED_SMALL_ACYCLIC_HETERO_LEAF_OVERLAP_MIN_FACTOR = 0.4;
const COMPACT_BRIDGED_SMALL_ACYCLIC_HETERO_LEAF_OVERLAP_MAX_SUBTREE_HEAVY_ATOMS = 2;
const COMPACT_FUSED_SMALL_ACYCLIC_CARBON_ROOT_OVERLAP_MAX_HEAVY_ATOMS = 40;
const COMPACT_FUSED_SMALL_ACYCLIC_CARBON_ROOT_OVERLAP_MIN_FACTOR = 0.45;
const COMPACT_BRIDGED_ATTACHED_AROMATIC_ROOT_MAX_FACTOR = 1.12;
const SEPARATE_SMALL_RING_TERMINAL_AMINO_LEAF_OVERLAP_MAX_HEAVY_ATOMS = 120;
const SEPARATE_SMALL_RING_TERMINAL_AMINO_LEAF_OVERLAP_MIN_FACTOR = 0.4;
const SEPARATE_SMALL_RING_TERMINAL_AMINO_LEAF_SLOT_STEP = Math.PI / 180;
const COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_SLOT_STEP = Math.PI / 12;
const IMINO_DIONE_TRICYCLO_MIN_FACTOR = 0.5;
const IMINO_DIONE_TRICYCLO_MAX_FACTOR = 1.62;
const LARGE_GLYCAN_MACROCYCLE_PYRANOSE_MAX_FACTOR = 1.625;
const BRIDGED_RING_SUBSTITUENT_SLOT_SCAN_STEP = Math.PI / 36;
const BRIDGED_RING_SUBSTITUENT_SLOT_CLEARANCE_FACTOR = 0.55;
const BRIDGED_RING_SUBSTITUENT_SMALL_CHAIN_MAX_HEAVY_ATOMS = 5;
const COMPLEX_RING_EXACT_OUTWARD_INSIDE_TOLERANCE = Math.PI / 18;
const COMPACT_BRIDGED_NEUTRAL_HETERO_OUTWARD_MAX_DEVIATION = Math.PI / 2 + Math.PI / 36;
const LARGE_MACROCYCLE_SIDECHAIN_INSIDE_MIN_RING_SIZE = 12;
const NEAR_OUTWARD_CARBONYL_RING_ROOT_MAX_DEVIATION = (7 * Math.PI) / 18;
const TETRAHEDRAL_BRANCH_LINKED_RING_CENTROID_MAX_DEVIATION = Math.PI / 3;
const ARYL_PHOSPHONIUM_BRANCH_LINKED_RING_CENTROID_MAX_DEVIATION = (7 * Math.PI) / 18;
const GEMINAL_TERMINAL_RING_SUBSTITUENT_SLOT_MAX_DEVIATION = Math.PI / 2 + Math.PI / 180;
const GEMINAL_TERMINAL_RING_SUBSTITUENT_OUTWARD_SIBLING_MAX_DEVIATION = Math.PI / 9;
const TETRAHEDRAL_BRANCH_LINKED_RING_ROOT_ELEMENTS = new Set(['C', 'Si', 'P']);
const COMPACT_BRIDGED_AZA_CYCLOPROPANE_MAX_FACTOR = BRIDGED_VALIDATION.maxBondLengthFactor + 0.05;
const BOND_LENGTH_DEVIATION_EPSILON = 1e-9;
const FOCUSED_PLACEMENT_COST_GRID_MIN_COORDS = 16;

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
 * @param {'planar'|'bridged'|'haptic'|undefined} validationClass - Bond validation class.
 * @returns {{minBondLengthFactor: number, maxBondLengthFactor: number, maxMeanDeviation: number, maxSevereOverlapCount: number}} Validation settings.
 */
function validationSettingsForClass(validationClass) {
  if (validationClass === 'haptic') {
    return HAPTIC_VALIDATION;
  }
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

function visibleHeavyAuditBonds(layoutGraph) {
  if (Array.isArray(layoutGraph._visibleHeavyAuditBonds)) {
    return layoutGraph._visibleHeavyAuditBonds;
  }

  const bonds = [];
  const bondValues = layoutGraph.bonds?.values?.();
  if (bondValues) {
    for (const bond of bondValues) {
      if (isAuditableBond(layoutGraph, bond)) {
        bonds.push(bond);
      }
    }
    layoutGraph._visibleHeavyAuditBonds = bonds;
    return bonds;
  }

  const seenBonds = new Set();
  for (const atomBonds of layoutGraph.bondsByAtomId?.values?.() ?? []) {
    for (const bond of atomBonds) {
      if (seenBonds.has(bond)) {
        continue;
      }
      seenBonds.add(bond);
      if (isAuditableBond(layoutGraph, bond)) {
        bonds.push(bond);
      }
    }
  }
  layoutGraph._visibleHeavyAuditBonds = bonds;
  return bonds;
}

function normalizedFocusAtomSet(focusAtomIds) {
  if (!focusAtomIds) {
    return null;
  }
  if (focusAtomIds instanceof Set) {
    return focusAtomIds.size > 0 ? focusAtomIds : null;
  }
  const focusAtomSet = new Set(focusAtomIds);
  return focusAtomSet.size > 0 ? focusAtomSet : null;
}

function collectVisibleHeavyBondSegments(layoutGraph, coords, focusAtomSet, options = {}) {
  const visibleBonds = [];
  const includeBond = options.includeBond ?? null;

  for (const bond of visibleHeavyAuditBonds(layoutGraph)) {
    if (includeBond && !includeBond(bond)) {
      continue;
    }
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    visibleBonds.push({
      index: visibleBonds.length,
      bond,
      firstPosition,
      secondPosition,
      minX: Math.min(firstPosition.x, secondPosition.x),
      maxX: Math.max(firstPosition.x, secondPosition.x),
      minY: Math.min(firstPosition.y, secondPosition.y),
      maxY: Math.max(firstPosition.y, secondPosition.y),
      touchesFocus: !focusAtomSet || focusAtomSet.has(bond.a) || focusAtomSet.has(bond.b)
    });
  }

  if (options.sortByMinX === true) {
    visibleBonds.sort((first, second) => first.minX - second.minX);
  }
  return visibleBonds;
}

function findFocusedVisibleHeavyBondCrossings(layoutGraph, coords, focusAtomSet) {
  if (!focusAtomSet || focusAtomSet.size === 0) {
    return [];
  }
  const visibleBonds = collectVisibleHeavyBondSegments(layoutGraph, coords, focusAtomSet, { sortByMinX: true });
  const crossings = [];

  for (const focused of visibleBonds) {
    if (!focused.touchesFocus) {
      continue;
    }
    for (const other of visibleBonds) {
      if (other.minX > focused.maxX) {
        break;
      }
      if (other.index === focused.index || other.maxX < focused.minX || (other.touchesFocus && other.index < focused.index)) {
        continue;
      }
      if (!visibleHeavyBondSegmentsCanCross(focused, other, focusAtomSet)) {
        continue;
      }
      if (segmentsProperlyIntersect(focused.firstPosition, focused.secondPosition, other.firstPosition, other.secondPosition)) {
        const focusedFirst = focused.index < other.index;
        const firstBond = focusedFirst ? focused.bond : other.bond;
        const secondBond = focusedFirst ? other.bond : focused.bond;
        crossings.push({
          firstBondId: firstBond.id,
          secondBondId: secondBond.id,
          firstAtomIds: [firstBond.a, firstBond.b],
          secondAtomIds: [secondBond.a, secondBond.b]
        });
      }
    }
  }

  return crossings.sort(
    (first, second) =>
      String(first.firstBondId).localeCompare(String(second.firstBondId), 'en', { numeric: true }) || String(first.secondBondId).localeCompare(String(second.secondBondId), 'en', { numeric: true })
  );
}

function countFocusedVisibleHeavyBondCrossings(layoutGraph, coords, focusAtomSet) {
  if (!focusAtomSet || focusAtomSet.size === 0) {
    return 0;
  }
  const visibleBonds = collectVisibleHeavyBondSegments(layoutGraph, coords, focusAtomSet, { sortByMinX: true });
  let crossingCount = 0;

  for (const focused of visibleBonds) {
    if (!focused.touchesFocus) {
      continue;
    }
    for (const other of visibleBonds) {
      if (other.minX > focused.maxX) {
        break;
      }
      if (other.index === focused.index || other.maxX < focused.minX || (other.touchesFocus && other.index < focused.index)) {
        continue;
      }
      if (!visibleHeavyBondSegmentsCanCross(focused, other, focusAtomSet)) {
        continue;
      }
      if (segmentsProperlyIntersect(focused.firstPosition, focused.secondPosition, other.firstPosition, other.secondPosition)) {
        crossingCount++;
      }
    }
  }

  return crossingCount;
}

function visibleHeavyBondSegmentsCanCross(first, second, focusAtomSet) {
  if (focusAtomSet && !first.touchesFocus && !second.touchesFocus) {
    return false;
  }
  if (first.bond.a === second.bond.a || first.bond.a === second.bond.b || first.bond.b === second.bond.a || first.bond.b === second.bond.b) {
    return false;
  }
  if (first.maxX < second.minX || first.minX > second.maxX || first.maxY < second.minY || first.minY > second.maxY) {
    return false;
  }
  return true;
}

/**
 * Returns visible heavy-atom covalent bond pairs that cross strictly through
 * each other. Bonds sharing an endpoint are ignored.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{focusAtomIds?: Iterable<string>}} [options] - Optional atoms whose incident bonds should be rescored.
 * @returns {Array<{firstBondId: string, secondBondId: string, firstAtomIds: [string, string], secondAtomIds: [string, string]}>} Crossing bond pairs.
 */
export function findVisibleHeavyBondCrossings(layoutGraph, coords, options = {}) {
  const focusAtomSet = normalizedFocusAtomSet(options.focusAtomIds);
  if (focusAtomSet) {
    return findFocusedVisibleHeavyBondCrossings(layoutGraph, coords, focusAtomSet);
  }
  const visibleBonds = collectVisibleHeavyBondSegments(layoutGraph, coords, focusAtomSet, { sortByMinX: true });

  const crossings = [];
  for (let firstIndex = 0; firstIndex < visibleBonds.length; firstIndex++) {
    const first = visibleBonds[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < visibleBonds.length; secondIndex++) {
      const second = visibleBonds[secondIndex];
      if (second.minX > first.maxX) {
        break;
      }
      if (!visibleHeavyBondSegmentsCanCross(first, second, focusAtomSet)) {
        continue;
      }
      if (segmentsProperlyIntersect(first.firstPosition, first.secondPosition, second.firstPosition, second.secondPosition)) {
        crossings.push({
          firstBondId: first.bond.id,
          secondBondId: second.bond.id,
          firstAtomIds: [first.bond.a, first.bond.b],
          secondAtomIds: [second.bond.a, second.bond.b]
        });
      }
    }
  }

  return crossings;
}

/**
 * Counts visible heavy-atom covalent bond crossings.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{focusAtomIds?: Iterable<string>}} [options] - Optional atoms whose incident bonds should be rescored.
 * @returns {number} Number of strictly crossing visible heavy bond pairs.
 */
export function countVisibleHeavyBondCrossings(layoutGraph, coords, options = {}) {
  const focusAtomSet = normalizedFocusAtomSet(options.focusAtomIds);
  if (focusAtomSet) {
    return countFocusedVisibleHeavyBondCrossings(layoutGraph, coords, focusAtomSet);
  }
  const visibleBonds = collectVisibleHeavyBondSegments(layoutGraph, coords, focusAtomSet, { sortByMinX: true });
  let crossingCount = 0;

  for (let firstIndex = 0; firstIndex < visibleBonds.length; firstIndex++) {
    const first = visibleBonds[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < visibleBonds.length; secondIndex++) {
      const second = visibleBonds[secondIndex];
      if (second.minX > first.maxX) {
        break;
      }
      if (visibleHeavyBondSegmentsCanCross(first, second, focusAtomSet) && segmentsProperlyIntersect(first.firstPosition, first.secondPosition, second.firstPosition, second.secondPosition)) {
        crossingCount++;
      }
    }
  }

  return crossingCount;
}

/**
 * Counts visible heavy-bond crossings after a candidate move by rescoring only
 * pairs touching moved atoms. Crossings between untouched bonds are invariant
 * between the two coordinate sets, so callers with a known moved atom set can
 * avoid a full all-bond crossing scan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} baseCoords - Coordinates before the candidate move.
 * @param {Map<string, {x: number, y: number}>} candidateCoords - Candidate coordinates.
 * @param {Iterable<string>} focusAtomIds - Moved atom IDs.
 * @param {number|null} [baseCrossingCount] - Optional full crossing count for baseCoords.
 * @returns {number} Estimated full crossing count for candidateCoords.
 */
export function countVisibleHeavyBondCrossingsAfterFocusedMove(layoutGraph, baseCoords, candidateCoords, focusAtomIds, baseCrossingCount = null) {
  const focusAtomSet = normalizedFocusAtomSet(focusAtomIds);
  if (!focusAtomSet) {
    return countVisibleHeavyBondCrossings(layoutGraph, candidateCoords);
  }
  const baseTotal = baseCrossingCount ?? countVisibleHeavyBondCrossings(layoutGraph, baseCoords);
  const baseFocusedCount = countFocusedVisibleHeavyBondCrossings(layoutGraph, baseCoords, focusAtomSet);
  const candidateFocusedCount = countFocusedVisibleHeavyBondCrossings(layoutGraph, candidateCoords, focusAtomSet);
  return Math.max(0, baseTotal - baseFocusedCount + candidateFocusedCount);
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
      !anchorAtom ||
      !leafAtom ||
      !COMPRESSIBLE_TERMINAL_RING_LEAF_ELEMENTS.has(leafAtom.element) ||
      (leafAtom.heavyDegree ?? 0) !== 1 ||
      !layoutGraph.ringAtomIdSet.has(anchorAtomId) ||
      layoutGraph.ringAtomIdSet.has(leafAtomId)
    ) {
      continue;
    }
    return { anchorAtomId, leafAtomId };
  }

  return null;
}

/**
 * Resolves a terminal hetero leaf on a compact carbonyl/carboxyl or ring
 * carbonyl center whose ring-side geometry benefits from a shortened exact
 * trigonal leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} bond - Candidate bond descriptor.
 * @returns {{centerAtomId: string, leafAtomId: string}|null} Endpoint roles, or null.
 */
function compressibleTerminalCarbonylLeafEndpoints(layoutGraph, bond) {
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) < 1) {
    return null;
  }

  for (const [centerAtomId, leafAtomId] of [
    [bond.a, bond.b],
    [bond.b, bond.a]
  ]) {
    const centerAtom = layoutGraph.atoms.get(centerAtomId);
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    if (
      !centerAtom ||
      !leafAtom ||
      centerAtom.element !== 'C' ||
      centerAtom.aromatic ||
      centerAtom.heavyDegree !== 3 ||
      !COMPRESSIBLE_TERMINAL_RING_LEAF_ELEMENTS.has(leafAtom.element) ||
      (leafAtom.heavyDegree ?? 0) !== 1 ||
      layoutGraph.ringAtomIdSet.has(leafAtomId)
    ) {
      continue;
    }

    const centerRingCount = layoutGraph.ringCountByAtomId.get(centerAtomId) ?? 0;
    let ringNeighborCount = 0;
    let ringAdjacentNeighborCount = 0;
    let terminalHeteroNeighborCount = 0;
    let terminalMultipleHeteroNeighborCount = 0;
    for (const neighborBond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
      if (!neighborBond || neighborBond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = neighborBond.a === centerAtomId ? neighborBond.b : neighborBond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
        ringNeighborCount++;
      }
      if (
        neighborAtomId !== leafAtomId &&
        (layoutGraph.ringAtomIdSet.has(neighborAtomId) ||
          (layoutGraph.bondsByAtomId.get(neighborAtomId) ?? []).some(adjacentBond => {
            if (!adjacentBond || adjacentBond.kind !== 'covalent') {
              return false;
            }
            const adjacentAtomId = adjacentBond.a === neighborAtomId ? adjacentBond.b : adjacentBond.a;
            return adjacentAtomId !== centerAtomId && layoutGraph.ringAtomIdSet.has(adjacentAtomId);
          }))
      ) {
        ringAdjacentNeighborCount++;
      }
      if (neighborAtom.element !== 'C' && (neighborAtom.heavyDegree ?? 0) === 1 && !layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
        terminalHeteroNeighborCount++;
        if (!neighborBond.aromatic && (neighborBond.order ?? 1) >= 2) {
          terminalMultipleHeteroNeighborCount++;
        }
      }
    }
    if (centerRingCount > 0 && ringNeighborCount === 2 && terminalMultipleHeteroNeighborCount === 1) {
      return { centerAtomId, leafAtomId };
    }
    if (ringNeighborCount === 1 && terminalHeteroNeighborCount >= 2 && terminalMultipleHeteroNeighborCount >= 1) {
      return { centerAtomId, leafAtomId };
    }
    if (ringNeighborCount === 0 && ringAdjacentNeighborCount >= 1 && terminalMultipleHeteroNeighborCount >= 1) {
      return { centerAtomId, leafAtomId };
    }
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
  if (
    computeIncidentRingOutwardAngles(layoutGraph, endpoints.anchorAtomId, atomId => coords.get(atomId) ?? null).some(
      outwardAngle => angularDifference(leafAngle, outwardAngle) <= COMPRESSED_TERMINAL_RING_LEAF_ANGLE_TOLERANCE
    )
  ) {
    return true;
  }
  if (isAcceptedCompressedSharedJunctionLeafBond(layoutGraph, coords, endpoints.anchorAtomId, endpoints.leafAtomId, leafAngle)) {
    return true;
  }
  if (isAcceptedCompressedCompactAzacageTerminalCarbonLeafBond(layoutGraph, coords, endpoints.anchorAtomId, endpoints.leafAtomId, distance, bondLength)) {
    return true;
  }
  return (
    isAcceptedCompressedFusedRingSystemLeafBond(layoutGraph, coords, endpoints.anchorAtomId, endpoints.leafAtomId, leafAngle) ||
    isAcceptedCompressedCrowdedGeminalRingLeafBond(layoutGraph, coords, endpoints.anchorAtomId, endpoints.leafAtomId)
  );
}

function ringSystemHasTerminalIminiumLeaf(layoutGraph, ringSystem) {
  const ringAtomIds = new Set(ringSystem.atomIds ?? []);
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) < 2) {
      continue;
    }
    const firstInRingSystem = ringAtomIds.has(bond.a);
    const secondInRingSystem = ringAtomIds.has(bond.b);
    if (firstInRingSystem === secondInRingSystem) {
      continue;
    }
    const ringAtom = layoutGraph.atoms.get(firstInRingSystem ? bond.a : bond.b);
    const leafAtom = layoutGraph.atoms.get(firstInRingSystem ? bond.b : bond.a);
    if (ringAtom?.element === 'C' && leafAtom?.element === 'N' && (leafAtom.charge ?? 0) > 0 && (leafAtom.heavyDegree ?? 0) === 1) {
      return true;
    }
  }
  return false;
}

function ringSystemHasAnyCarbonylSubstitution(layoutGraph, ringSystem) {
  const ringAtomIds = new Set(ringSystem.atomIds ?? []);
  for (const atomId of ringAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element !== 'C') {
      continue;
    }
    const hasExocyclicOxo = (layoutGraph.bondsByAtomId.get(atomId) ?? []).some(bond => {
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !ringAtomIds.has(neighborAtomId) && neighborAtom?.element === 'O' && (bond.order ?? 1) === 2;
    });
    if (hasExocyclicOxo) {
      return true;
    }
  }
  return false;
}

function ringSystemHasExocyclicAcylAmideSubstitution(layoutGraph, ringSystem) {
  const ringAtomIds = new Set(ringSystem.atomIds ?? []);
  for (const atomId of ringAtomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
        continue;
      }
      const carbonylAtomId = bond.a === atomId ? bond.b : bond.a;
      if (ringAtomIds.has(carbonylAtomId)) {
        continue;
      }
      const carbonylAtom = layoutGraph.atoms.get(carbonylAtomId);
      if (!carbonylAtom || carbonylAtom.element !== 'C' || carbonylAtom.aromatic) {
        continue;
      }
      let hasOxo = false;
      let hasAmideNitrogen = false;
      for (const neighborBond of layoutGraph.bondsByAtomId.get(carbonylAtomId) ?? []) {
        const neighborAtomId = neighborBond.a === carbonylAtomId ? neighborBond.b : neighborBond.a;
        if (neighborAtomId === atomId) {
          continue;
        }
        const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
        if (neighborAtom?.element === 'O' && (neighborBond.order ?? 1) === 2) {
          hasOxo = true;
        }
        if (neighborAtom?.element === 'N' && (neighborBond.order ?? 1) === 1) {
          hasAmideNitrogen = true;
        }
      }
      if (hasOxo && hasAmideNitrogen) {
        return true;
      }
    }
  }
  return false;
}

function ringSystemHasExocyclicImideDioneLink(layoutGraph, ringSystem) {
  const ringAtomIds = new Set(ringSystem.atomIds ?? []);
  for (const atomId of ringAtomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
        continue;
      }
      const nitrogenAtomId = bond.a === atomId ? bond.b : bond.a;
      if (ringAtomIds.has(nitrogenAtomId) || layoutGraph.ringAtomIdSet.has(nitrogenAtomId)) {
        continue;
      }
      const nitrogenAtom = layoutGraph.atoms.get(nitrogenAtomId);
      if (!nitrogenAtom || nitrogenAtom.element !== 'N' || nitrogenAtom.aromatic || (nitrogenAtom.charge ?? 0) !== 0 || (nitrogenAtom.heavyDegree ?? 0) !== 2) {
        continue;
      }
      for (const nitrogenBond of layoutGraph.bondsByAtomId.get(nitrogenAtomId) ?? []) {
        const linkedAtomId = nitrogenBond.a === nitrogenAtomId ? nitrogenBond.b : nitrogenBond.a;
        if (linkedAtomId === atomId) {
          continue;
        }
        const linkedRingSystemId = layoutGraph.atomToRingSystemId.get(linkedAtomId);
        const linkedRingSystem = linkedRingSystemId != null && linkedRingSystemId !== ringSystem.id ? layoutGraph.ringSystemById.get(linkedRingSystemId) : null;
        if (linkedRingSystem && (linkedRingSystem.ringIds?.length ?? 0) === 1 && ringSystemHasCarbonylSubstitution(layoutGraph, linkedRingSystem)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isCompactIminiumAzacageRingSystem(layoutGraph, ringSystem) {
  const rings = (ringSystem.ringIds ?? []).map(ringId => layoutGraph.ringById.get(ringId)).filter(Boolean);
  const ringSizes = rings.map(ring => ring.atomIds.length).sort((first, second) => first - second);
  return (
    ringSizes.length === 3 &&
    ringSizes[0] === 4 &&
    ringSizes[1] === 5 &&
    ringSizes[2] === 5 &&
    (ringSystem.atomIds?.length ?? 0) <= 12 &&
    ringSystemHasAnyCarbonylSubstitution(layoutGraph, ringSystem) &&
    ringSystemHasTerminalIminiumLeaf(layoutGraph, ringSystem)
  );
}

function isAcceptedCompressedCompactAzacageTerminalCarbonLeafBond(layoutGraph, coords, anchorAtomId, leafAtomId, distance, bondLength) {
  if (distance > bondLength * COMPRESSED_AZACAGE_TERMINAL_CARBON_LEAF_MAX_FACTOR + 1e-9) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (
    !anchorAtom ||
    !leafAtom ||
    anchorAtom.element !== 'N' ||
    anchorAtom.aromatic ||
    (anchorAtom.charge ?? 0) !== 0 ||
    (anchorAtom.heavyDegree ?? 0) !== 3 ||
    (layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0) !== 1 ||
    leafAtom.element !== 'C' ||
    leafAtom.aromatic ||
    (leafAtom.heavyDegree ?? 0) !== 1 ||
    layoutGraph.ringAtomIdSet.has(leafAtomId)
  ) {
    return false;
  }

  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
  if (!ringSystem || !isCompactIminiumAzacageRingSystem(layoutGraph, ringSystem)) {
    return false;
  }
  const anchorInFourRing = (layoutGraph.atomToRings.get(anchorAtomId) ?? []).some(ring => (ring.atomIds?.length ?? 0) === 4);
  if (!anchorInFourRing) {
    return false;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (
    !anchorPosition ||
    !leafPosition ||
    incidentRingPolygons(layoutGraph, coords, anchorAtomId).some(polygon => pointInPolygon(leafPosition, polygon)) ||
    ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, leafAtomId, anchorPosition, leafPosition)
  ) {
    return false;
  }
  return true;
}

/**
 * Returns whether a compressed terminal hetero leaf on a saturated geminal
 * small-ring anchor is still within the ordinary ring-substituent readability
 * envelope. Crowded gem-dihalogen rings sometimes need one leaf shortened and
 * tucked between exact exterior slots to avoid a hard bond crossing with a
 * neighboring ring; this keeps that local escape from becoming a bond-length
 * audit failure while preserving the normal outward-readability cap.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom id.
 * @param {string} leafAtomId - Terminal leaf atom id.
 * @returns {boolean} True when the compressed leaf should be accepted.
 */
function isAcceptedCompressedCrowdedGeminalRingLeafBond(layoutGraph, coords, anchorAtomId, leafAtomId) {
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
    (layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0) !== 1
  ) {
    return false;
  }

  const terminalLeafNeighborIds = [];
  let ringNeighborCount = 0;
  for (const neighborBond of layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []) {
    if (!neighborBond || neighborBond.kind !== 'covalent' || neighborBond.aromatic || (neighborBond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = neighborBond.a === anchorAtomId ? neighborBond.b : neighborBond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    if (layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      ringNeighborCount++;
      continue;
    }
    if (neighborAtom.element !== 'C' && !neighborAtom.aromatic && (neighborAtom.heavyDegree ?? 0) === 1) {
      terminalLeafNeighborIds.push(neighborAtomId);
    }
  }
  if (ringNeighborCount !== 2 || terminalLeafNeighborIds.length !== 2 || !terminalLeafNeighborIds.includes(leafAtomId)) {
    return false;
  }

  const leafPosition = coords.get(leafAtomId);
  if (!leafPosition || incidentRingPolygons(layoutGraph, coords, anchorAtomId).some(polygon => pointInPolygon(leafPosition, polygon))) {
    return false;
  }
  const immediateDeviation = immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, leafAtomId);
  return immediateDeviation != null && immediateDeviation <= RING_SUBSTITUENT_READABILITY_LIMITS.maxSevereImmediateOutwardDeviation + 1e-9;
}

/**
 * Returns whether a compressed terminal ring leaf follows an exact
 * shared-junction continuation while staying outside the anchor's incident
 * ring faces.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom id.
 * @param {string} leafAtomId - Terminal leaf atom id.
 * @param {number} leafAngle - Current anchor-to-leaf angle.
 * @returns {boolean} True when the compressed shared-junction leaf is intentional.
 */
function isAcceptedCompressedSharedJunctionLeafBond(layoutGraph, coords, anchorAtomId, leafAtomId, leafAngle) {
  const leafPosition = coords.get(leafAtomId);
  const sharedJunctionAngle = preferredSharedJunctionContinuationAngle(layoutGraph, coords, anchorAtomId, leafAtomId);
  if (!leafPosition || sharedJunctionAngle == null) {
    return false;
  }
  if (incidentRingPolygons(layoutGraph, coords, anchorAtomId).some(polygon => pointInPolygon(leafPosition, polygon))) {
    return false;
  }
  return angularDifference(leafAngle, sharedJunctionAngle) <= COMPRESSED_TERMINAL_RING_LEAF_ANGLE_TOLERANCE;
}

/**
 * Returns whether a compressed terminal ring leaf follows the fused-ring-system
 * exterior direction while staying outside the anchor's incident ring faces.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom id.
 * @param {string} leafAtomId - Terminal leaf atom id.
 * @param {number} leafAngle - Current anchor-to-leaf angle.
 * @returns {boolean} True when the compressed fused-system leaf is intentional.
 */
function isAcceptedCompressedFusedRingSystemLeafBond(layoutGraph, coords, anchorAtomId, leafAtomId, leafAngle) {
  if ((layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0) <= 1) {
    return false;
  }
  const anchorPosition = coords.get(anchorAtomId);
  const leafPosition = coords.get(leafAtomId);
  const ringSystemOutwardAngle = fusedRingSystemOutwardAngle(layoutGraph, coords, anchorAtomId);
  if (!anchorPosition || !leafPosition || ringSystemOutwardAngle == null) {
    return false;
  }
  if (incidentRingPolygons(layoutGraph, coords, anchorAtomId).some(polygon => pointInPolygon(leafPosition, polygon))) {
    return false;
  }
  return angularDifference(leafAngle, ringSystemOutwardAngle) <= COMPRESSED_TERMINAL_RING_LEAF_ANGLE_TOLERANCE;
}

/**
 * Returns the whole-ring-system exterior direction at a fused-ring anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Ring anchor atom id.
 * @returns {number|null} Exterior angle in radians, or null when unavailable.
 */
function fusedRingSystemOutwardAngle(layoutGraph, coords, anchorAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  if (!anchorPosition || ringSystemId == null) {
    return null;
  }
  const ringSystemPositions = ringSystemAtomIds(layoutGraph, ringSystemId)
    .map(atomId => coords.get(atomId))
    .filter(Boolean);
  if (ringSystemPositions.length < 3) {
    return null;
  }
  return angleOf(sub(anchorPosition, centroid(ringSystemPositions)));
}

/**
 * Returns whether a short terminal carbonyl/carboxyl leaf is intentionally
 * compressed while preserving the exact trigonal direction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} bond - Candidate bond descriptor.
 * @param {number} distance - Current bond length.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when the compressed leaf should not count as a bond-length failure.
 */
function isAcceptedCompressedTerminalCarbonylLeafBond(layoutGraph, coords, bond, distance, bondLength) {
  if (distance >= bondLength || distance < bondLength * COMPRESSED_TERMINAL_CARBONYL_LEAF_MIN_FACTOR - 1e-9) {
    return false;
  }

  const endpoints = compressibleTerminalCarbonylLeafEndpoints(layoutGraph, bond);
  if (!endpoints) {
    return false;
  }

  const centerPosition = coords.get(endpoints.centerAtomId);
  const leafPosition = coords.get(endpoints.leafAtomId);
  if (!centerPosition || !leafPosition) {
    return false;
  }

  const leafAngle = angleOf(sub(leafPosition, centerPosition));
  const otherNeighborEntries = [];
  for (const neighborBond of layoutGraph.bondsByAtomId.get(endpoints.centerAtomId) ?? []) {
    if (!neighborBond || neighborBond.kind !== 'covalent') {
      continue;
    }
    const neighborAtomId = neighborBond.a === endpoints.centerAtomId ? neighborBond.b : neighborBond.a;
    if (neighborAtomId === endpoints.leafAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    const neighborPosition = coords.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H' || !neighborPosition) {
      continue;
    }
    otherNeighborEntries.push({
      atomId: neighborAtomId,
      angle: angleOf(sub(neighborPosition, centerPosition))
    });
  }

  if (otherNeighborEntries.length !== 2) {
    return false;
  }

  if (otherNeighborEntries.every(({ angle }) => Math.abs(angularDifference(leafAngle, angle) - (2 * Math.PI) / 3) <= COMPRESSED_TERMINAL_RING_LEAF_ANGLE_TOLERANCE)) {
    return true;
  }

  return isAcceptedLinearRingCompressedTerminalCarbonylLeafBond(layoutGraph, endpoints, otherNeighborEntries, leafAngle, distance, bondLength);
}

/**
 * Returns whether a compressed terminal carbonyl leaf is acceptable on a
 * ring-constrained center whose two fixed ring bonds are nearly linear.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {{centerAtomId: string, leafAtomId: string}} endpoints - Carbonyl center and leaf atom ids.
 * @param {Array<{atomId: string, angle: number}>} neighborEntries - Non-leaf heavy neighbors with current angles.
 * @param {number} leafAngle - Current center-to-leaf angle.
 * @param {number} distance - Current center-to-leaf distance.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when the compressed perpendicular leaf is audit-acceptable.
 */
function isAcceptedLinearRingCompressedTerminalCarbonylLeafBond(layoutGraph, endpoints, neighborEntries, leafAngle, distance, bondLength) {
  if (distance < bondLength * COMPRESSED_TERMINAL_CARBONYL_LINEAR_RING_MIN_FACTOR - 1e-9) {
    return false;
  }
  if ((layoutGraph.ringCountByAtomId.get(endpoints.centerAtomId) ?? 0) === 0) {
    return false;
  }
  for (const { atomId } of neighborEntries) {
    const neighborBond = layoutGraph.bondByAtomPair.get(atomPairKey(endpoints.centerAtomId, atomId));
    if (!layoutGraph.ringAtomIdSet.has(atomId) || neighborBond?.inRing !== true) {
      return false;
    }
  }

  const neighborSeparation = angularDifference(neighborEntries[0].angle, neighborEntries[1].angle);
  if (Math.abs(neighborSeparation - Math.PI) > COMPRESSED_TERMINAL_CARBONYL_LINEAR_RING_ANGLE_TOLERANCE) {
    return false;
  }
  return neighborEntries.every(({ angle }) => Math.abs(angularDifference(leafAngle, angle) - Math.PI / 2) <= COMPRESSED_TERMINAL_CARBONYL_LINEAR_RING_ANGLE_TOLERANCE);
}

function isAcceptedCompressedFusedHeteroBridgeBond(layoutGraph, coords, bond, distance, bondLength) {
  if (!bond || !bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1 || distance >= bondLength || distance < bondLength * BRIDGED_VALIDATION.minBondLengthFactor - 1e-9) {
    return false;
  }
  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  const firstIsHetero = firstAtom && ['O', 'S', 'Se'].includes(firstAtom.element);
  const secondIsHetero = secondAtom && ['O', 'S', 'Se'].includes(secondAtom.element);
  if (firstIsHetero === secondIsHetero) {
    return false;
  }

  const heteroAtomId = firstIsHetero ? bond.a : bond.b;
  const junctionAtomId = firstIsHetero ? bond.b : bond.a;
  const heteroAtom = layoutGraph.atoms.get(heteroAtomId);
  const junctionAtom = layoutGraph.atoms.get(junctionAtomId);
  if (
    !heteroAtom ||
    !junctionAtom ||
    heteroAtom.aromatic === true ||
    junctionAtom.aromatic === true ||
    (heteroAtom.heavyDegree ?? 0) !== 2 ||
    (layoutGraph.ringCountByAtomId.get(heteroAtomId) ?? 0) !== 1 ||
    (layoutGraph.ringCountByAtomId.get(junctionAtomId) ?? 0) < 2
  ) {
    return false;
  }

  const sharedSmallRing = (layoutGraph.atomToRings.get(heteroAtomId) ?? []).some(ring => ring.atomIds?.includes(junctionAtomId) && (ring.atomIds?.length ?? 0) <= 5);
  if (!sharedSmallRing) {
    return false;
  }

  const heteroPosition = coords.get(heteroAtomId);
  const junctionPosition = coords.get(junctionAtomId);
  return !!heteroPosition && !!junctionPosition && !ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, heteroAtomId, junctionAtomId, heteroPosition, junctionPosition);
}

function isAcceptedCompressedCompactBridgedEtherRingBond(layoutGraph, coords, bond, distance, bondLength) {
  if (
    !bond ||
    !bond.inRing ||
    bond.aromatic ||
    (bond.order ?? 1) !== 1 ||
    distance >= bondLength * BRIDGED_VALIDATION.minBondLengthFactor - 1e-9 ||
    distance < bondLength * COMPACT_BRIDGED_ETHER_MIN_FACTOR - 1e-9
  ) {
    return false;
  }

  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  const firstIsOxygen = firstAtom?.element === 'O';
  const secondIsOxygen = secondAtom?.element === 'O';
  if (firstIsOxygen === secondIsOxygen) {
    return false;
  }

  const oxygenAtomId = firstIsOxygen ? bond.a : bond.b;
  const carbonAtomId = firstIsOxygen ? bond.b : bond.a;
  const oxygenAtom = layoutGraph.atoms.get(oxygenAtomId);
  const carbonAtom = layoutGraph.atoms.get(carbonAtomId);
  if (
    !oxygenAtom ||
    !carbonAtom ||
    oxygenAtom.aromatic === true ||
    carbonAtom.element !== 'C' ||
    carbonAtom.aromatic === true ||
    (oxygenAtom.heavyDegree ?? 0) !== 2 ||
    (carbonAtom.heavyDegree ?? 0) < 2
  ) {
    return false;
  }

  const oxygenRingSystemId = layoutGraph.atomToRingSystemId.get(oxygenAtomId);
  const carbonRingSystemId = layoutGraph.atomToRingSystemId.get(carbonAtomId);
  const ringSystem = oxygenRingSystemId != null && oxygenRingSystemId === carbonRingSystemId ? layoutGraph.ringSystemById.get(oxygenRingSystemId) : null;
  if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 14 || (ringSystem.ringIds?.length ?? 0) < 3) {
    return false;
  }
  const ringSystemRingIds = new Set(ringSystem.ringIds ?? []);
  const bridgedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'bridged' && ringSystemRingIds.has(connection.firstRingId) && ringSystemRingIds.has(connection.secondRingId)
  ).length;
  if (bridgedConnectionCount < 2) {
    return false;
  }

  const bondRings = ringIdsForBond(layoutGraph, bond.a, bond.b)
    .map(ringId => layoutGraph.ringById.get(ringId))
    .filter(Boolean);
  const crampedSmallRing = bondRings.some(ring => {
    const atomIds = ring.atomIds ?? [];
    return atomIds.length <= 5 && atomIds.filter(atomId => (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) >= 3).length >= 2;
  });
  if (!crampedSmallRing) {
    return false;
  }

  const oxygenPosition = coords.get(oxygenAtomId);
  const carbonPosition = coords.get(carbonAtomId);
  return !!oxygenPosition && !!carbonPosition && !ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, oxygenAtomId, carbonAtomId, oxygenPosition, carbonPosition);
}

function isAcceptedCompressedLeafBond(layoutGraph, coords, bond, distance, bondLength) {
  return (
    isAcceptedCompressedTerminalRingLeafBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedCompressedTerminalCarbonylLeafBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedCompressedFusedHeteroBridgeBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedCompressedCompactBridgedEtherRingBond(layoutGraph, coords, bond, distance, bondLength)
  );
}

function isAcceptedMarginalStretchedFusedAzaBridgeBond(layoutGraph, coords, bond, distance, bondLength) {
  if (
    !bond ||
    !bond.inRing ||
    bond.aromatic ||
    (bond.order ?? 1) !== 1 ||
    distance <= bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + 1e-9 ||
    distance > bondLength * MARGINAL_STRETCHED_FUSED_AZA_BRIDGE_MAX_FACTOR + 1e-9
  ) {
    return false;
  }

  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  const firstIsNitrogen = firstAtom?.element === 'N';
  const secondIsNitrogen = secondAtom?.element === 'N';
  if (firstIsNitrogen === secondIsNitrogen) {
    return false;
  }

  const nitrogenAtomId = firstIsNitrogen ? bond.a : bond.b;
  const carbonAtomId = firstIsNitrogen ? bond.b : bond.a;
  const nitrogenAtom = layoutGraph.atoms.get(nitrogenAtomId);
  const carbonAtom = layoutGraph.atoms.get(carbonAtomId);
  if (
    !nitrogenAtom ||
    !carbonAtom ||
    carbonAtom.element !== 'C' ||
    nitrogenAtom.aromatic ||
    carbonAtom.aromatic ||
    (nitrogenAtom.charge ?? 0) !== 0 ||
    (nitrogenAtom.heavyDegree ?? 0) !== 3 ||
    (carbonAtom.heavyDegree ?? 0) < 3 ||
    (layoutGraph.ringCountByAtomId.get(nitrogenAtomId) ?? 0) < 2 ||
    (layoutGraph.ringCountByAtomId.get(carbonAtomId) ?? 0) < 2
  ) {
    return false;
  }

  const nitrogenRingSystemId = layoutGraph.atomToRingSystemId.get(nitrogenAtomId);
  const carbonRingSystemId = layoutGraph.atomToRingSystemId.get(carbonAtomId);
  const ringSystem = nitrogenRingSystemId != null && nitrogenRingSystemId === carbonRingSystemId ? layoutGraph.ringSystemById.get(nitrogenRingSystemId) : null;
  if (!ringSystem || (ringSystem.ringIds?.length ?? 0) < 3) {
    return false;
  }

  const nitrogenPosition = coords.get(nitrogenAtomId);
  const carbonPosition = coords.get(carbonAtomId);
  return !!nitrogenPosition && !!carbonPosition && !ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, nitrogenAtomId, carbonAtomId, nitrogenPosition, carbonPosition);
}

function ringSystemHasBisOxoSulfur(layoutGraph, ringSystem) {
  const ringAtomIds = new Set(ringSystem.atomIds ?? []);
  for (const atomId of ringAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element !== 'S' || atom.aromatic) {
      continue;
    }
    let terminalOxoCount = 0;
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!ringAtomIds.has(neighborAtomId) && neighborAtom?.element === 'O' && (bond.order ?? 1) === 2) {
        terminalOxoCount++;
      }
    }
    if (terminalOxoCount >= 2) {
      return true;
    }
  }
  return false;
}

function compactBridgedAzaCyclopropaneRingSystemIds(layoutGraph) {
  if (layoutGraph._compactBridgedAzaCyclopropaneRingSystemIds instanceof Set) {
    return layoutGraph._compactBridgedAzaCyclopropaneRingSystemIds;
  }

  const acceptedRingSystemIds = new Set();
  for (const ringSystem of layoutGraph.ringSystems ?? []) {
    if ((ringSystem.atomIds?.length ?? 0) > 16 || (ringSystem.ringIds?.length ?? 0) !== 4 || !ringSystemHasBisOxoSulfur(layoutGraph, ringSystem)) {
      continue;
    }
    const rings = (ringSystem.ringIds ?? []).map(ringId => layoutGraph.ringById.get(ringId)).filter(Boolean);
    const ringSizes = rings.map(ring => ring.atomIds.length).sort((first, second) => first - second);
    if (ringSizes.join(',') !== '3,5,5,6' || rings.some(ring => ring.aromatic)) {
      continue;
    }

    const ringSystemRingIds = new Set(ringSystem.ringIds ?? []);
    const connections = (layoutGraph.ringConnections ?? []).filter(connection => ringSystemRingIds.has(connection.firstRingId) && ringSystemRingIds.has(connection.secondRingId));
    const bridgedConnectionCount = connections.filter(connection => connection.kind === 'bridged' && (connection.sharedAtomIds?.length ?? 0) >= 2).length;
    const hasFusedCyclopropane = connections.some(connection => {
      if (connection.kind !== 'fused' || (connection.sharedAtomIds?.length ?? 0) !== 2) {
        return false;
      }
      return layoutGraph.ringById.get(connection.firstRingId)?.atomIds.length === 3 || layoutGraph.ringById.get(connection.secondRingId)?.atomIds.length === 3;
    });
    if (bridgedConnectionCount >= 2 && hasFusedCyclopropane) {
      acceptedRingSystemIds.add(ringSystem.id);
    }
  }

  layoutGraph._compactBridgedAzaCyclopropaneRingSystemIds = acceptedRingSystemIds;
  return acceptedRingSystemIds;
}

function isAcceptedMarginalStretchedCompactBridgedAzaCyclopropaneBond(layoutGraph, coords, bond, distance, bondLength) {
  if (
    !bond ||
    !bond.inRing ||
    bond.aromatic ||
    (bond.order ?? 1) !== 1 ||
    distance <= bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + 1e-9 ||
    distance > bondLength * COMPACT_BRIDGED_AZA_CYCLOPROPANE_MAX_FACTOR + 1e-9
  ) {
    return false;
  }

  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  const firstIsNitrogen = firstAtom?.element === 'N';
  const secondIsNitrogen = secondAtom?.element === 'N';
  if (firstIsNitrogen === secondIsNitrogen) {
    return false;
  }

  const nitrogenAtomId = firstIsNitrogen ? bond.a : bond.b;
  const carbonAtomId = firstIsNitrogen ? bond.b : bond.a;
  const nitrogenAtom = layoutGraph.atoms.get(nitrogenAtomId);
  const carbonAtom = layoutGraph.atoms.get(carbonAtomId);
  if (
    !nitrogenAtom ||
    !carbonAtom ||
    carbonAtom.element !== 'C' ||
    nitrogenAtom.aromatic ||
    carbonAtom.aromatic ||
    (nitrogenAtom.charge ?? 0) !== 0 ||
    (nitrogenAtom.heavyDegree ?? 0) !== 2 ||
    (carbonAtom.heavyDegree ?? 0) < 3 ||
    (layoutGraph.ringCountByAtomId.get(nitrogenAtomId) ?? 0) !== 1 ||
    (layoutGraph.ringCountByAtomId.get(carbonAtomId) ?? 0) < 3
  ) {
    return false;
  }

  const nitrogenRingSystemId = layoutGraph.atomToRingSystemId.get(nitrogenAtomId);
  const carbonRingSystemId = layoutGraph.atomToRingSystemId.get(carbonAtomId);
  if (nitrogenRingSystemId == null || nitrogenRingSystemId !== carbonRingSystemId || !compactBridgedAzaCyclopropaneRingSystemIds(layoutGraph).has(nitrogenRingSystemId)) {
    return false;
  }

  const bondRingIds = ringIdsForBond(layoutGraph, bond.a, bond.b);
  if (bondRingIds.length !== 1 || (layoutGraph.ringById.get(bondRingIds[0])?.atomIds?.length ?? 0) !== 5) {
    return false;
  }

  return coords.has(nitrogenAtomId) && coords.has(carbonAtomId);
}

function ringIdsForBond(layoutGraph, firstAtomId, secondAtomId) {
  return (layoutGraph.atomToRings.get(firstAtomId) ?? []).filter(ring => ring.atomIds?.includes(secondAtomId)).map(ring => ring.id);
}

function ringSystemHasCarbonylSubstitution(layoutGraph, ringSystem) {
  let carbonylCount = 0;
  const ringAtomIds = new Set(ringSystem.atomIds ?? []);
  for (const atomId of ringAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.element !== 'C') {
      continue;
    }
    const hasExocyclicOxo = (layoutGraph.bondsByAtomId.get(atomId) ?? []).some(bond => {
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return !ringAtomIds.has(neighborAtomId) && neighborAtom?.element === 'O' && (bond.order ?? 1) === 2;
    });
    if (hasExocyclicOxo) {
      carbonylCount++;
    }
  }
  return carbonylCount >= 2;
}

function ringSystemHasIminoNitrogen(layoutGraph, ringSystem) {
  const ringAtomIds = new Set(ringSystem.atomIds ?? []);
  for (const bond of layoutGraph.bonds.values()) {
    if (!bond.inRing || bond.aromatic || (bond.order ?? 1) !== 2 || !ringAtomIds.has(bond.a) || !ringAtomIds.has(bond.b)) {
      continue;
    }
    const firstAtom = layoutGraph.atoms.get(bond.a);
    const secondAtom = layoutGraph.atoms.get(bond.b);
    if ((firstAtom?.element === 'N' && secondAtom?.element === 'C') || (firstAtom?.element === 'C' && secondAtom?.element === 'N')) {
      return true;
    }
  }
  return false;
}

function compactIminoDioneTricycloRingSystemIds(layoutGraph) {
  if (layoutGraph._compactIminoDioneTricycloRingSystemIds instanceof Set) {
    return layoutGraph._compactIminoDioneTricycloRingSystemIds;
  }
  const acceptedRingSystemIds = new Set();
  for (const ringSystem of layoutGraph.ringSystems ?? []) {
    const rings = (ringSystem.ringIds ?? []).map(ringId => layoutGraph.ringById.get(ringId)).filter(Boolean);
    const ringSizes = rings.map(ring => ring.atomIds.length).sort((first, second) => first - second);
    if (
      ringSizes.length !== 3 ||
      ringSizes[0] !== 4 ||
      ringSizes[1] !== 5 ||
      ringSizes[2] !== 6 ||
      !ringSystemHasCarbonylSubstitution(layoutGraph, ringSystem) ||
      !ringSystemHasIminoNitrogen(layoutGraph, ringSystem)
    ) {
      continue;
    }
    const hasSharedCarbonEdge = [...layoutGraph.bonds.values()].some(bond => {
      const firstAtom = layoutGraph.atoms.get(bond.a);
      const secondAtom = layoutGraph.atoms.get(bond.b);
      return (
        bond.inRing &&
        !bond.aromatic &&
        (bond.order ?? 1) === 1 &&
        firstAtom?.element === 'C' &&
        secondAtom?.element === 'C' &&
        (layoutGraph.ringCountByAtomId.get(bond.a) ?? 0) >= 3 &&
        (layoutGraph.ringCountByAtomId.get(bond.b) ?? 0) >= 3 &&
        layoutGraph.atomToRingSystemId.get(bond.a) === ringSystem.id &&
        layoutGraph.atomToRingSystemId.get(bond.b) === ringSystem.id
      );
    });
    if (hasSharedCarbonEdge) {
      acceptedRingSystemIds.add(ringSystem.id);
    }
  }
  layoutGraph._compactIminoDioneTricycloRingSystemIds = acceptedRingSystemIds;
  return acceptedRingSystemIds;
}

function isAcceptedCompactIminoDioneTricycloBond(layoutGraph, coords, bond, distance, bondLength) {
  if (
    !bond ||
    !bond.inRing ||
    bond.aromatic ||
    (bond.order ?? 1) !== 1 ||
    distance < bondLength * IMINO_DIONE_TRICYCLO_MIN_FACTOR - 1e-9 ||
    distance > bondLength * IMINO_DIONE_TRICYCLO_MAX_FACTOR + 1e-9
  ) {
    return false;
  }
  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  if (firstAtom?.element !== 'C' || secondAtom?.element !== 'C' || firstAtom.aromatic || secondAtom.aromatic) {
    return false;
  }
  const firstRingSystemId = layoutGraph.atomToRingSystemId.get(bond.a);
  const secondRingSystemId = layoutGraph.atomToRingSystemId.get(bond.b);
  if (firstRingSystemId == null || firstRingSystemId !== secondRingSystemId || !compactIminoDioneTricycloRingSystemIds(layoutGraph).has(firstRingSystemId)) {
    return false;
  }
  const firstPosition = coords.get(bond.a);
  const secondPosition = coords.get(bond.b);
  if (!firstPosition || !secondPosition || ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, bond.a, bond.b, firstPosition, secondPosition)) {
    return false;
  }

  const bondRingIds = ringIdsForBond(layoutGraph, bond.a, bond.b);
  const isSharedThreeRingEdge = (layoutGraph.ringCountByAtomId.get(bond.a) ?? 0) >= 3 && (layoutGraph.ringCountByAtomId.get(bond.b) ?? 0) >= 3 && bondRingIds.length >= 3;
  const isFourRingOuterEdge =
    bondRingIds.length === 1 &&
    (layoutGraph.ringById.get(bondRingIds[0])?.atomIds?.length ?? 0) === 4 &&
    (layoutGraph.ringCountByAtomId.get(bond.a) ?? 0) === 1 &&
    (layoutGraph.ringCountByAtomId.get(bond.b) ?? 0) === 1;
  return isSharedThreeRingEdge || isFourRingOuterEdge;
}

/**
 * Returns the tiny 4-4-6 aminoketone bridged cages where three apices share a
 * crowded junction lane, making one planar ring N-C edge intentionally short.
 * @param {object} layoutGraph - Layout graph shell.
 * @returns {Set<number|string>} Ring-system IDs that match the compact cage pattern.
 */
function compactTriapexAminoketoneRingSystemIds(layoutGraph) {
  if (layoutGraph._compactTriapexAminoketoneRingSystemIds instanceof Set) {
    return layoutGraph._compactTriapexAminoketoneRingSystemIds;
  }

  const acceptedRingSystemIds = new Set();
  for (const ringSystem of layoutGraph.ringSystems ?? []) {
    const rings = (ringSystem.ringIds ?? []).map(ringId => layoutGraph.ringById.get(ringId)).filter(Boolean);
    const ringSizes = rings.map(ring => ring.atomIds.length).sort((first, second) => first - second);
    if (ringSizes.join(',') !== '4,4,6' || (ringSystem.atomIds?.length ?? 0) > 10 || rings.some(ring => ring.aromatic) || !ringSystemHasAnyCarbonylSubstitution(layoutGraph, ringSystem)) {
      continue;
    }

    const ringNitrogenCount = (ringSystem.atomIds ?? []).filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom?.element === 'N' && atom.aromatic !== true && (atom.charge ?? 0) === 0 && (atom.heavyDegree ?? 0) === 3 && (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) === 1;
    }).length;
    if (ringNitrogenCount !== 1) {
      continue;
    }

    const ringSystemRingIds = new Set(ringSystem.ringIds ?? []);
    const bridgedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
      connection => connection.kind === 'bridged' && ringSystemRingIds.has(connection.firstRingId) && ringSystemRingIds.has(connection.secondRingId)
    ).length;
    if (bridgedConnectionCount < 2) {
      continue;
    }

    const hasThreeRingCarbonJunctionEdge = [...layoutGraph.bonds.values()].some(bond => {
      const firstAtom = layoutGraph.atoms.get(bond.a);
      const secondAtom = layoutGraph.atoms.get(bond.b);
      return (
        bond.inRing &&
        !bond.aromatic &&
        (bond.order ?? 1) === 1 &&
        firstAtom?.element === 'C' &&
        secondAtom?.element === 'C' &&
        (layoutGraph.ringCountByAtomId.get(bond.a) ?? 0) >= 3 &&
        (layoutGraph.ringCountByAtomId.get(bond.b) ?? 0) >= 3 &&
        layoutGraph.atomToRingSystemId.get(bond.a) === ringSystem.id &&
        layoutGraph.atomToRingSystemId.get(bond.b) === ringSystem.id &&
        ringIdsForBond(layoutGraph, bond.a, bond.b).length >= 3
      );
    });
    if (hasThreeRingCarbonJunctionEdge) {
      acceptedRingSystemIds.add(ringSystem.id);
    }
  }

  layoutGraph._compactTriapexAminoketoneRingSystemIds = acceptedRingSystemIds;
  return acceptedRingSystemIds;
}

/**
 * Returns whether a compressed ring N-C edge is an unavoidable planar
 * projection of a compact tri-apex aminoketone cage.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {object} bond - Candidate bond descriptor.
 * @param {number} distance - Current bond length.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True when the compact cage edge should not count as a bond-length failure.
 */
function isAcceptedCompactTriapexAminoketoneBond(layoutGraph, coords, bond, distance, bondLength) {
  if (
    !bond ||
    !bond.inRing ||
    bond.aromatic ||
    (bond.order ?? 1) !== 1 ||
    distance >= bondLength * BRIDGED_VALIDATION.minBondLengthFactor - 1e-9 ||
    distance < bondLength * COMPACT_TRIAPEX_AMINOKETONE_MIN_FACTOR - 1e-9
  ) {
    return false;
  }

  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  const firstIsNitrogen = firstAtom?.element === 'N';
  const secondIsNitrogen = secondAtom?.element === 'N';
  if (firstIsNitrogen === secondIsNitrogen) {
    return false;
  }

  const nitrogenAtomId = firstIsNitrogen ? bond.a : bond.b;
  const carbonAtomId = firstIsNitrogen ? bond.b : bond.a;
  const nitrogenAtom = layoutGraph.atoms.get(nitrogenAtomId);
  const carbonAtom = layoutGraph.atoms.get(carbonAtomId);
  if (
    !nitrogenAtom ||
    !carbonAtom ||
    carbonAtom.element !== 'C' ||
    nitrogenAtom.aromatic === true ||
    carbonAtom.aromatic === true ||
    (nitrogenAtom.charge ?? 0) !== 0 ||
    (nitrogenAtom.heavyDegree ?? 0) !== 3 ||
    (carbonAtom.heavyDegree ?? 0) < 3 ||
    (layoutGraph.ringCountByAtomId.get(nitrogenAtomId) ?? 0) !== 1 ||
    (layoutGraph.ringCountByAtomId.get(carbonAtomId) ?? 0) < 3
  ) {
    return false;
  }

  const nitrogenRingSystemId = layoutGraph.atomToRingSystemId.get(nitrogenAtomId);
  const carbonRingSystemId = layoutGraph.atomToRingSystemId.get(carbonAtomId);
  if (nitrogenRingSystemId == null || nitrogenRingSystemId !== carbonRingSystemId || !compactTriapexAminoketoneRingSystemIds(layoutGraph).has(nitrogenRingSystemId)) {
    return false;
  }

  const bondRingIds = ringIdsForBond(layoutGraph, bond.a, bond.b);
  if (bondRingIds.length !== 1) {
    return false;
  }
  const bondRing = layoutGraph.ringById.get(bondRingIds[0]);
  const highJunctionCarbonCount = (bondRing?.atomIds ?? []).filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom?.element === 'C' && atom.aromatic !== true && (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) >= 3;
  }).length;
  if ((bondRing?.atomIds?.length ?? 0) !== 4 || highJunctionCarbonCount < 2) {
    return false;
  }

  const nitrogenPosition = coords.get(nitrogenAtomId);
  const carbonPosition = coords.get(carbonAtomId);
  return !!nitrogenPosition && !!carbonPosition && !ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, nitrogenAtomId, carbonAtomId, nitrogenPosition, carbonPosition);
}

function compactAzabicyclicLactamRingSystemIds(layoutGraph) {
  if (layoutGraph._compactAzabicyclicLactamRingSystemIds instanceof Set) {
    return layoutGraph._compactAzabicyclicLactamRingSystemIds;
  }
  const acceptedRingSystemIds = new Set();
  for (const ringSystem of layoutGraph.ringSystems ?? []) {
    const rings = (ringSystem.ringIds ?? []).map(ringId => layoutGraph.ringById.get(ringId)).filter(Boolean);
    const ringSizes = rings.map(ring => ring.atomIds.length).sort((first, second) => first - second);
    if (
      ringSizes.length !== 2 ||
      ringSizes[0] !== 4 ||
      ringSizes[1] !== 5 ||
      (ringSystem.atomIds?.length ?? 0) !== 6 ||
      !ringSystemHasAnyCarbonylSubstitution(layoutGraph, ringSystem) ||
      !ringSystemHasExocyclicAcylAmideSubstitution(layoutGraph, ringSystem)
    ) {
      continue;
    }
    const ringNitrogenCount = (ringSystem.atomIds ?? []).filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom?.element === 'N' && !atom.aromatic && (atom.charge ?? 0) === 0 && (atom.heavyDegree ?? 0) === 2 && (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) === 1;
    }).length;
    if (ringNitrogenCount === 1) {
      acceptedRingSystemIds.add(ringSystem.id);
    }
  }
  layoutGraph._compactAzabicyclicLactamRingSystemIds = acceptedRingSystemIds;
  return acceptedRingSystemIds;
}

function compactAzabicyclicImideSidechainRingSystemIds(layoutGraph) {
  if (layoutGraph._compactAzabicyclicImideSidechainRingSystemIds instanceof Set) {
    return layoutGraph._compactAzabicyclicImideSidechainRingSystemIds;
  }
  const acceptedRingSystemIds = new Set();
  for (const ringSystem of layoutGraph.ringSystems ?? []) {
    const rings = (ringSystem.ringIds ?? []).map(ringId => layoutGraph.ringById.get(ringId)).filter(Boolean);
    const ringSizes = rings.map(ring => ring.atomIds.length).sort((first, second) => first - second);
    if (ringSizes.length !== 2 || ringSizes[0] !== 4 || ringSizes[1] !== 5 || (ringSystem.atomIds?.length ?? 0) !== 6 || !ringSystemHasExocyclicImideDioneLink(layoutGraph, ringSystem)) {
      continue;
    }
    const ringNitrogenCount = (ringSystem.atomIds ?? []).filter(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom?.element === 'N' && !atom.aromatic && (atom.charge ?? 0) === 0 && (atom.heavyDegree ?? 0) === 2 && (layoutGraph.ringCountByAtomId.get(atomId) ?? 0) === 1;
    }).length;
    if (ringNitrogenCount === 1) {
      acceptedRingSystemIds.add(ringSystem.id);
    }
  }
  layoutGraph._compactAzabicyclicImideSidechainRingSystemIds = acceptedRingSystemIds;
  return acceptedRingSystemIds;
}

function isCompactAzabicyclicAcceptedBond(layoutGraph, bond) {
  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  const bondRingIds = ringIdsForBond(layoutGraph, bond.a, bond.b);
  const bondRingSizes = bondRingIds.map(ringId => layoutGraph.ringById.get(ringId)?.atomIds?.length ?? 0).sort((first, second) => first - second);
  const isSharedFourFiveEdge = bondRingSizes.length === 2 && bondRingSizes[0] === 4 && bondRingSizes[1] === 5;
  const isFiveRingNitrogenEdge =
    bondRingSizes.length === 1 &&
    bondRingSizes[0] === 5 &&
    ((firstAtom?.element === 'N' && (layoutGraph.ringCountByAtomId.get(bond.a) ?? 0) === 1) || (secondAtom?.element === 'N' && (layoutGraph.ringCountByAtomId.get(bond.b) ?? 0) === 1));
  return isSharedFourFiveEdge || isFiveRingNitrogenEdge;
}

function isAcceptedCompactAzabicyclicBond(layoutGraph, coords, bond, distance, bondLength, acceptedRingSystemIds) {
  if (
    !bond ||
    !bond.inRing ||
    bond.aromatic ||
    (bond.order ?? 1) !== 1 ||
    distance < bondLength * COMPACT_AZABICYCLIC_LACTAM_MIN_FACTOR - 1e-9 ||
    distance > bondLength * COMPACT_AZABICYCLIC_LACTAM_MAX_FACTOR + 1e-9
  ) {
    return false;
  }

  const firstRingSystemId = layoutGraph.atomToRingSystemId.get(bond.a);
  const secondRingSystemId = layoutGraph.atomToRingSystemId.get(bond.b);
  if (firstRingSystemId == null || firstRingSystemId !== secondRingSystemId || !acceptedRingSystemIds.has(firstRingSystemId)) {
    return false;
  }
  const firstPosition = coords.get(bond.a);
  const secondPosition = coords.get(bond.b);
  if (!firstPosition || !secondPosition || ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, bond.a, bond.b, firstPosition, secondPosition)) {
    return false;
  }
  return isCompactAzabicyclicAcceptedBond(layoutGraph, bond);
}

function isAcceptedCompactAzabicyclicLactamBond(layoutGraph, coords, bond, distance, bondLength) {
  return isAcceptedCompactAzabicyclicBond(layoutGraph, coords, bond, distance, bondLength, compactAzabicyclicLactamRingSystemIds(layoutGraph));
}

function isAcceptedCompactAzabicyclicImideSidechainBond(layoutGraph, coords, bond, distance, bondLength) {
  return isAcceptedCompactAzabicyclicBond(layoutGraph, coords, bond, distance, bondLength, compactAzabicyclicImideSidechainRingSystemIds(layoutGraph));
}

function isPyranoseLikeRing(layoutGraph, ring) {
  if (!ring || (ring.atomIds?.length ?? 0) !== 6) {
    return false;
  }
  let oxygenCount = 0;
  let carbonCount = 0;
  for (const atomId of ring.atomIds ?? []) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom?.element === 'O' && !atom.aromatic) {
      oxygenCount++;
    } else if (atom?.element === 'C' && !atom.aromatic) {
      carbonCount++;
    } else {
      return false;
    }
  }
  return oxygenCount === 1 && carbonCount === 5;
}

function largeGlycanMacrocycleRingSystemIds(layoutGraph) {
  if (layoutGraph._largeGlycanMacrocycleRingSystemIds instanceof Set) {
    return layoutGraph._largeGlycanMacrocycleRingSystemIds;
  }
  const acceptedRingSystemIds = new Set();
  for (const ringSystem of layoutGraph.ringSystems ?? []) {
    if ((ringSystem.atomIds?.length ?? 0) < 30) {
      continue;
    }
    const atomsAreCarbonOxygenOnly = (ringSystem.atomIds ?? []).every(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return (atom?.element === 'C' || atom?.element === 'O') && atom.aromatic !== true;
    });
    if (!atomsAreCarbonOxygenOnly) {
      continue;
    }
    const rings = (ringSystem.ringIds ?? []).map(ringId => layoutGraph.ringById.get(ringId)).filter(Boolean);
    const hasLargeMacrocycle = rings.some(ring => (ring.atomIds?.length ?? 0) >= 24);
    const pyranoseRingCount = rings.filter(ring => isPyranoseLikeRing(layoutGraph, ring)).length;
    if (hasLargeMacrocycle && pyranoseRingCount >= 5) {
      acceptedRingSystemIds.add(ringSystem.id);
    }
  }
  layoutGraph._largeGlycanMacrocycleRingSystemIds = acceptedRingSystemIds;
  return acceptedRingSystemIds;
}

function isAcceptedLargeGlycanMacrocyclePyranoseBond(layoutGraph, coords, bond, distance, bondLength) {
  if (
    !bond ||
    !bond.inRing ||
    bond.aromatic ||
    (bond.order ?? 1) !== 1 ||
    distance <= bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + 1e-9 ||
    distance > bondLength * LARGE_GLYCAN_MACROCYCLE_PYRANOSE_MAX_FACTOR + 1e-9
  ) {
    return false;
  }
  const firstAtom = layoutGraph.atoms.get(bond.a);
  const secondAtom = layoutGraph.atoms.get(bond.b);
  if (!['C', 'O'].includes(firstAtom?.element) || !['C', 'O'].includes(secondAtom?.element) || firstAtom.aromatic || secondAtom.aromatic) {
    return false;
  }
  const firstRingSystemId = layoutGraph.atomToRingSystemId.get(bond.a);
  const secondRingSystemId = layoutGraph.atomToRingSystemId.get(bond.b);
  if (firstRingSystemId == null || firstRingSystemId !== secondRingSystemId || !largeGlycanMacrocycleRingSystemIds(layoutGraph).has(firstRingSystemId)) {
    return false;
  }
  const bondRingIds = ringIdsForBond(layoutGraph, bond.a, bond.b);
  if (bondRingIds.length !== 1 || !isPyranoseLikeRing(layoutGraph, layoutGraph.ringById.get(bondRingIds[0]))) {
    return false;
  }
  const firstPosition = coords.get(bond.a);
  const secondPosition = coords.get(bond.b);
  return !!firstPosition && !!secondPosition && !ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, bond.a, bond.b, firstPosition, secondPosition);
}

function isAcceptedCompactBridgedAttachedAromaticRootBond(layoutGraph, coords, bond, distance, bondLength) {
  if (
    !bond ||
    bond.kind !== 'covalent' ||
    bond.inRing ||
    bond.aromatic ||
    (bond.order ?? 1) !== 1 ||
    distance <= bondLength * AUDIT_PLANAR_VALIDATION.maxBondLengthFactor + 1e-9 ||
    distance > bondLength * COMPACT_BRIDGED_ATTACHED_AROMATIC_ROOT_MAX_FACTOR + 1e-9
  ) {
    return false;
  }

  for (const [anchorAtomId, rootAtomId] of [
    [bond.a, bond.b],
    [bond.b, bond.a]
  ]) {
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    const rootAtom = layoutGraph.atoms.get(rootAtomId);
    if (
      !anchorAtom ||
      !rootAtom ||
      anchorAtom.element !== 'C' ||
      anchorAtom.aromatic === true ||
      rootAtom.element === 'H' ||
      rootAtom.aromatic !== true ||
      (rootAtom.heavyDegree ?? 0) < 3 ||
      (layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0) < 2 ||
      (layoutGraph.ringCountByAtomId.get(rootAtomId) ?? 0) !== 1
    ) {
      continue;
    }

    const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
    const rootRingSystemId = layoutGraph.atomToRingSystemId.get(rootAtomId);
    const anchorRingSystem = anchorRingSystemId != null ? layoutGraph.ringSystemById.get(anchorRingSystemId) : null;
    const rootRingSystem = rootRingSystemId != null ? layoutGraph.ringSystemById.get(rootRingSystemId) : null;
    if (
      !anchorRingSystem ||
      !rootRingSystem ||
      anchorRingSystemId === rootRingSystemId ||
      (anchorRingSystem.atomIds?.length ?? 0) > 12 ||
      (anchorRingSystem.ringIds?.length ?? 0) !== 2 ||
      !ringSystemHasBridgedConnection(layoutGraph, anchorRingSystemId) ||
      (rootRingSystem.atomIds?.length ?? 0) > 8 ||
      (rootRingSystem.ringIds?.length ?? 0) !== 1
    ) {
      continue;
    }

    const rootRing = layoutGraph.ringById.get(rootRingSystem.ringIds[0]);
    const rootRingHasHeteroAtom = (rootRing?.atomIds ?? []).some(atomId => {
      const atom = layoutGraph.atoms.get(atomId);
      return atom && atom.element !== 'C' && atom.element !== 'H';
    });
    if (!rootRing?.aromatic || !rootRingHasHeteroAtom) {
      continue;
    }

    const anchorPosition = coords.get(anchorAtomId);
    const rootPosition = coords.get(rootAtomId);
    if (!anchorPosition || !rootPosition) {
      continue;
    }
    return true;
  }

  return false;
}

function isAcceptedBondLengthDeviation(layoutGraph, coords, bond, distance, bondLength) {
  return (
    isAcceptedCompressedLeafBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedMarginalStretchedFusedAzaBridgeBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedMarginalStretchedCompactBridgedAzaCyclopropaneBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedCompactIminoDioneTricycloBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedCompactTriapexAminoketoneBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedCompactAzabicyclicLactamBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedCompactAzabicyclicImideSidechainBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedLargeGlycanMacrocyclePyranoseBond(layoutGraph, coords, bond, distance, bondLength) ||
    isAcceptedCompactBridgedAttachedAromaticRootBond(layoutGraph, coords, bond, distance, bondLength)
  );
}

function acceptedCompressedTerminalCarbonylLeafEndpointsForAtom(layoutGraph, coords, atomId, bondLength) {
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const endpoints = compressibleTerminalCarbonylLeafEndpoints(layoutGraph, bond);
    if (!endpoints || endpoints.leafAtomId !== atomId) {
      continue;
    }
    const centerPosition = coords.get(endpoints.centerAtomId);
    const leafPosition = coords.get(endpoints.leafAtomId);
    if (!centerPosition || !leafPosition) {
      continue;
    }
    const distance = Math.hypot(leafPosition.x - centerPosition.x, leafPosition.y - centerPosition.y);
    if (isAcceptedCompressedTerminalCarbonylLeafBond(layoutGraph, coords, bond, distance, bondLength)) {
      return endpoints;
    }
  }
  return null;
}

function isAcceptedCompressedTerminalCarbonylLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) {
  if (distance < bondLength * COMPRESSED_TERMINAL_CARBONYL_LEAF_CLASH_FACTOR - 1e-9) {
    return false;
  }

  for (const [leafAtomId, otherAtomId] of [
    [firstAtomId, secondAtomId],
    [secondAtomId, firstAtomId]
  ]) {
    const endpoints = acceptedCompressedTerminalCarbonylLeafEndpointsForAtom(layoutGraph, coords, leafAtomId, bondLength);
    if (endpoints && otherAtomId !== endpoints.centerAtomId && layoutGraph.ringAtomIdSet.has(otherAtomId)) {
      return true;
    }
  }

  return false;
}

function compactBridgedTerminalCarbonLeafOverlapDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId, distance, bondLength) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (heavyAtomCount > COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_OVERLAP_MAX_HEAVY_ATOMS) {
    return null;
  }
  if (distance < bondLength * COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_OVERLAP_TWO_RING_MIN_FACTOR - 1e-9) {
    return null;
  }
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  const blockerAtom = layoutGraph.atoms.get(blockerAtomId);
  if (
    !leafAtom ||
    !blockerAtom ||
    leafAtom.element !== 'C' ||
    leafAtom.aromatic === true ||
    (leafAtom.heavyDegree ?? 0) !== 1 ||
    layoutGraph.ringAtomIdSet.has(leafAtomId) ||
    blockerAtom.element === 'H' ||
    !layoutGraph.ringAtomIdSet.has(blockerAtomId)
  ) {
    return null;
  }

  const heavyNeighborBonds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom?.element !== 'H' && coords.has(neighborAtomId);
  });
  if (heavyNeighborBonds.length !== 1) {
    return null;
  }

  const anchorAtomId = heavyNeighborBonds[0].a === leafAtomId ? heavyNeighborBonds[0].b : heavyNeighborBonds[0].a;
  if (!layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
    return null;
  }
  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const blockerRingSystemId = layoutGraph.atomToRingSystemId.get(blockerAtomId);
  const ringSystem = anchorRingSystemId != null && anchorRingSystemId === blockerRingSystemId ? layoutGraph.ringSystemById.get(anchorRingSystemId) : null;
  if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 14 || (ringSystem.ringIds?.length ?? 0) < 2) {
    return null;
  }
  const ringSystemRingIds = new Set(ringSystem.ringIds ?? []);
  const bridgedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'bridged' && ringSystemRingIds.has(connection.firstRingId) && ringSystemRingIds.has(connection.secondRingId)
  ).length;
  const hasStrictBridgedContact = bridgedConnectionCount >= 2 && distance >= bondLength * COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_OVERLAP_MIN_FACTOR - 1e-9;
  const hasBlockedSingleBridgeContact =
    bridgedConnectionCount >= 1 && (ringSystem.ringIds?.length ?? 0) >= 3 && distance >= bondLength * COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_OVERLAP_RELAXED_MIN_FACTOR - 1e-9;
  const hasBlockedTwoRingSingleBridgeContact =
    bridgedConnectionCount >= 1 && (ringSystem.ringIds?.length ?? 0) === 2 && distance >= bondLength * COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_OVERLAP_TWO_RING_MIN_FACTOR - 1e-9;
  if (!hasStrictBridgedContact && !hasBlockedSingleBridgeContact && !hasBlockedTwoRingSingleBridgeContact) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (!anchorPosition || !leafPosition || ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, leafAtomId, anchorPosition, leafPosition)) {
    return null;
  }

  return { anchorAtomId, leafAtomId };
}

function compactBridgedTerminalHeteroLeafOverlapDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId, distance, bondLength) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (heavyAtomCount > COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_OVERLAP_MAX_HEAVY_ATOMS) {
    return null;
  }
  if (distance < bondLength * COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_OVERLAP_RELAXED_MIN_FACTOR - 1e-9) {
    return null;
  }
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  const blockerAtom = layoutGraph.atoms.get(blockerAtomId);
  if (
    !leafAtom ||
    !blockerAtom ||
    !COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_ELEMENTS.has(leafAtom.element) ||
    leafAtom.aromatic === true ||
    (leafAtom.charge ?? 0) !== 0 ||
    (leafAtom.heavyDegree ?? 0) !== 1 ||
    layoutGraph.ringAtomIdSet.has(leafAtomId) ||
    blockerAtom.element === 'H' ||
    !layoutGraph.ringAtomIdSet.has(blockerAtomId)
  ) {
    return null;
  }

  const heavyNeighborBonds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom?.element !== 'H' && coords.has(neighborAtomId);
  });
  if (heavyNeighborBonds.length !== 1) {
    return null;
  }

  const anchorAtomId = heavyNeighborBonds[0].a === leafAtomId ? heavyNeighborBonds[0].b : heavyNeighborBonds[0].a;
  if (!layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
    return null;
  }
  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const blockerRingSystemId = layoutGraph.atomToRingSystemId.get(blockerAtomId);
  const ringSystem = anchorRingSystemId != null && anchorRingSystemId === blockerRingSystemId ? layoutGraph.ringSystemById.get(anchorRingSystemId) : null;
  if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 14 || (ringSystem.ringIds?.length ?? 0) !== 2) {
    return null;
  }
  const ringSystemRingIds = new Set(ringSystem.ringIds ?? []);
  const bridgedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'bridged' && ringSystemRingIds.has(connection.firstRingId) && ringSystemRingIds.has(connection.secondRingId)
  ).length;
  if (bridgedConnectionCount < 1) {
    return null;
  }
  const anchorBlockerBond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, blockerAtomId));
  const relaxedAdjacentHydroxyContact =
    distance >= bondLength * COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_OVERLAP_RELAXED_MIN_FACTOR - 1e-9 &&
    leafAtom.element === 'O' &&
    (leafAtom.heavyDegree ?? 0) === 1 &&
    (leafAtom.degree ?? leafAtom.heavyDegree ?? 0) > (leafAtom.heavyDegree ?? 0) &&
    anchorBlockerBond?.inRing === true &&
    anchorBlockerBond.kind === 'covalent';
  if (distance < bondLength * COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_OVERLAP_MIN_FACTOR - 1e-9 && !relaxedAdjacentHydroxyContact) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (!anchorPosition || !leafPosition || ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, leafAtomId, anchorPosition, leafPosition)) {
    return null;
  }

  return { anchorAtomId, leafAtomId };
}

function compactBridgedSmallAcyclicHeteroLeafOverlapDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId, distance, bondLength) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (heavyAtomCount > COMPACT_BRIDGED_SMALL_ACYCLIC_HETERO_LEAF_OVERLAP_MAX_HEAVY_ATOMS) {
    return null;
  }
  if (distance < bondLength * COMPACT_BRIDGED_SMALL_ACYCLIC_HETERO_LEAF_OVERLAP_MIN_FACTOR - 1e-9) {
    return null;
  }
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  const blockerAtom = layoutGraph.atoms.get(blockerAtomId);
  if (
    !leafAtom ||
    !blockerAtom ||
    !COMPACT_BRIDGED_TERMINAL_HETERO_LEAF_ELEMENTS.has(leafAtom.element) ||
    leafAtom.aromatic === true ||
    (leafAtom.charge ?? 0) !== 0 ||
    (leafAtom.heavyDegree ?? 0) !== 1 ||
    layoutGraph.ringAtomIdSet.has(leafAtomId) ||
    blockerAtom.element === 'H' ||
    !layoutGraph.ringAtomIdSet.has(blockerAtomId)
  ) {
    return null;
  }

  const leafNeighborBonds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom?.element !== 'H' && coords.has(neighborAtomId);
  });
  if (leafNeighborBonds.length !== 1) {
    return null;
  }

  const rootAtomId = leafNeighborBonds[0].a === leafAtomId ? leafNeighborBonds[0].b : leafNeighborBonds[0].a;
  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  if (!rootAtom || rootAtom.element !== 'C' || rootAtom.aromatic === true || (rootAtom.charge ?? 0) !== 0 || (rootAtom.heavyDegree ?? 0) !== 2 || layoutGraph.ringAtomIdSet.has(rootAtomId)) {
    return null;
  }

  const rootNeighborBonds = (layoutGraph.bondsByAtomId.get(rootAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom?.element !== 'H' && coords.has(neighborAtomId);
  });
  const ringAnchorBonds = rootNeighborBonds.filter(bond => {
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    return layoutGraph.ringAtomIdSet.has(neighborAtomId);
  });
  if (ringAnchorBonds.length !== 1) {
    return null;
  }

  const anchorAtomId = ringAnchorBonds[0].a === rootAtomId ? ringAnchorBonds[0].b : ringAnchorBonds[0].a;
  const subtree = collectSmallAcyclicRingSubstituentSubtree(layoutGraph, coords, rootAtomId, anchorAtomId, COMPACT_BRIDGED_SMALL_ACYCLIC_HETERO_LEAF_OVERLAP_MAX_SUBTREE_HEAVY_ATOMS);
  if (!subtree || subtree.heavyAtomIds.length !== 2 || !subtree.heavyAtomIds.includes(rootAtomId) || !subtree.heavyAtomIds.includes(leafAtomId)) {
    return null;
  }
  if (!isSmallUnbranchedAcyclicRingSubstituentRoot(layoutGraph, coords, rootAtomId, anchorAtomId)) {
    return null;
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const blockerRingSystemId = layoutGraph.atomToRingSystemId.get(blockerAtomId);
  const ringSystem = anchorRingSystemId != null && anchorRingSystemId === blockerRingSystemId ? layoutGraph.ringSystemById.get(anchorRingSystemId) : null;
  if (!ringSystem || (ringSystem.atomIds?.length ?? 0) > 12 || (ringSystem.ringIds?.length ?? 0) !== 2) {
    return null;
  }
  const ringSystemRingIds = new Set(ringSystem.ringIds ?? []);
  const bridgedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'bridged' && ringSystemRingIds.has(connection.firstRingId) && ringSystemRingIds.has(connection.secondRingId)
  ).length;
  if (bridgedConnectionCount < 1) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const rootPosition = coords.get(rootAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (
    !anchorPosition ||
    !rootPosition ||
    !leafPosition ||
    ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, rootAtomId, anchorPosition, rootPosition) ||
    ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, rootAtomId, leafAtomId, rootPosition, leafPosition)
  ) {
    return null;
  }

  return { anchorAtomId, rootAtomId, leafAtomId, subtreeAtomIds: subtree.atomIds };
}

function compactFusedSmallAcyclicCarbonRootOverlapDescriptor(layoutGraph, coords, rootAtomId, blockerAtomId, distance, bondLength) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (heavyAtomCount > COMPACT_FUSED_SMALL_ACYCLIC_CARBON_ROOT_OVERLAP_MAX_HEAVY_ATOMS || distance < bondLength * COMPACT_FUSED_SMALL_ACYCLIC_CARBON_ROOT_OVERLAP_MIN_FACTOR - 1e-9) {
    return null;
  }

  const rootAtom = layoutGraph.atoms.get(rootAtomId);
  const blockerAtom = layoutGraph.atoms.get(blockerAtomId);
  if (
    !rootAtom ||
    !blockerAtom ||
    rootAtom.element !== 'C' ||
    rootAtom.aromatic === true ||
    (rootAtom.charge ?? 0) !== 0 ||
    (rootAtom.heavyDegree ?? 0) !== 2 ||
    layoutGraph.ringAtomIdSet.has(rootAtomId) ||
    blockerAtom.element === 'H' ||
    !layoutGraph.ringAtomIdSet.has(blockerAtomId)
  ) {
    return null;
  }

  const rootNeighborBonds = (layoutGraph.bondsByAtomId.get(rootAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom?.element !== 'H' && coords.has(neighborAtomId);
  });
  const ringAnchorBonds = rootNeighborBonds.filter(bond => {
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    return layoutGraph.ringAtomIdSet.has(neighborAtomId);
  });
  const leafBonds = rootNeighborBonds.filter(bond => {
    const neighborAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    return !layoutGraph.ringAtomIdSet.has(neighborAtomId);
  });
  if (ringAnchorBonds.length !== 1 || leafBonds.length !== 1) {
    return null;
  }

  const anchorAtomId = ringAnchorBonds[0].a === rootAtomId ? ringAnchorBonds[0].b : ringAnchorBonds[0].a;
  const leafAtomId = leafBonds[0].a === rootAtomId ? leafBonds[0].b : leafBonds[0].a;
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (!leafAtom || leafAtom.element !== 'C' || leafAtom.aromatic === true || (leafAtom.heavyDegree ?? 0) !== 1 || layoutGraph.ringAtomIdSet.has(leafAtomId)) {
    return null;
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const blockerRingSystemId = layoutGraph.atomToRingSystemId.get(blockerAtomId);
  const ringSystem = anchorRingSystemId != null && anchorRingSystemId === blockerRingSystemId ? layoutGraph.ringSystemById.get(anchorRingSystemId) : null;
  if (!ringSystem || !ringSystemHasCompactFusedCageConnection(layoutGraph, anchorRingSystemId, anchorAtomId)) {
    return null;
  }

  const subtree = collectSmallAcyclicRingSubstituentSubtree(layoutGraph, coords, rootAtomId, anchorAtomId, BRIDGED_RING_SUBSTITUENT_SMALL_CHAIN_MAX_HEAVY_ATOMS);
  if (!subtree || subtree.heavyAtomIds.length !== 2 || !subtree.heavyAtomIds.includes(rootAtomId) || !subtree.heavyAtomIds.includes(leafAtomId)) {
    return null;
  }
  if (!isSmallUnbranchedAcyclicRingSubstituentRoot(layoutGraph, coords, rootAtomId, anchorAtomId)) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const rootPosition = coords.get(rootAtomId);
  if (!anchorPosition || !rootPosition || ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, rootAtomId, anchorPosition, rootPosition)) {
    return null;
  }

  return { anchorAtomId, rootAtomId, leafAtomId, subtreeAtomIds: subtree.atomIds };
}

function separateSmallRingTerminalAminoLeafOverlapDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId, distance, bondLength) {
  const heavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? [...layoutGraph.atoms.values()].filter(atom => atom.element !== 'H').length;
  if (heavyAtomCount > SEPARATE_SMALL_RING_TERMINAL_AMINO_LEAF_OVERLAP_MAX_HEAVY_ATOMS || distance < bondLength * SEPARATE_SMALL_RING_TERMINAL_AMINO_LEAF_OVERLAP_MIN_FACTOR - 1e-9) {
    return null;
  }

  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  const blockerAtom = layoutGraph.atoms.get(blockerAtomId);
  if (
    !leafAtom ||
    !blockerAtom ||
    leafAtom.element !== 'N' ||
    leafAtom.aromatic === true ||
    (leafAtom.charge ?? 0) !== 0 ||
    (leafAtom.heavyDegree ?? 0) !== 1 ||
    (leafAtom.degree ?? leafAtom.heavyDegree ?? 0) <= (leafAtom.heavyDegree ?? 0) ||
    layoutGraph.ringAtomIdSet.has(leafAtomId) ||
    blockerAtom.element === 'H' ||
    !layoutGraph.ringAtomIdSet.has(blockerAtomId)
  ) {
    return null;
  }

  const heavyNeighborBonds = (layoutGraph.bondsByAtomId.get(leafAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom?.element !== 'H' && coords.has(neighborAtomId);
  });
  if (heavyNeighborBonds.length !== 1) {
    return null;
  }

  const anchorAtomId = heavyNeighborBonds[0].a === leafAtomId ? heavyNeighborBonds[0].b : heavyNeighborBonds[0].a;
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (!anchorAtom || anchorAtom.element !== 'C' || anchorAtom.aromatic === true || !layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
    return null;
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const blockerRingSystemId = layoutGraph.atomToRingSystemId.get(blockerAtomId);
  const anchorRingSystem = anchorRingSystemId != null ? layoutGraph.ringSystemById.get(anchorRingSystemId) : null;
  const blockerRingSystem = blockerRingSystemId != null ? layoutGraph.ringSystemById.get(blockerRingSystemId) : null;
  if (
    !anchorRingSystem ||
    !blockerRingSystem ||
    anchorRingSystemId === blockerRingSystemId ||
    (anchorRingSystem.ringIds?.length ?? 0) > 2 ||
    (blockerRingSystem.ringIds?.length ?? 0) > 2 ||
    (anchorRingSystem.atomIds?.length ?? 0) > 12 ||
    (blockerRingSystem.atomIds?.length ?? 0) > 12
  ) {
    return null;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (!anchorPosition || !leafPosition || ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, leafAtomId, anchorPosition, leafPosition)) {
    return null;
  }

  return { anchorAtomId, leafAtomId };
}

function compactBridgedTerminalLeafHasClearSlot(layoutGraph, coords, descriptor, bondLength) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!anchorPosition || !leafPosition) {
    return true;
  }
  const radius = Math.hypot(leafPosition.x - anchorPosition.x, leafPosition.y - anchorPosition.y);
  if (!(radius > 0)) {
    return false;
  }
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const bondedAtomIds = bondedAtomIdSet(layoutGraph, descriptor.leafAtomId);
  for (let angle = 0; angle < Math.PI * 2; angle += COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_SLOT_STEP) {
    const candidatePosition = {
      x: anchorPosition.x + Math.cos(angle) * radius,
      y: anchorPosition.y + Math.sin(angle) * radius
    };
    if (ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, descriptor.anchorAtomId, descriptor.leafAtomId, anchorPosition, candidatePosition)) {
      continue;
    }
    let hasOverlap = false;
    for (const [atomId, atom] of layoutGraph.atoms) {
      if (atomId === descriptor.leafAtomId || bondedAtomIds.has(atomId) || !atom || atom.element === 'H' || !coords.has(atomId) || !isVisibleHeavyLayoutAtom(layoutGraph, atomId)) {
        continue;
      }
      const position = coords.get(atomId);
      if (Math.hypot(candidatePosition.x - position.x, candidatePosition.y - position.y) < threshold - 1e-9) {
        hasOverlap = true;
        break;
      }
    }
    if (!hasOverlap) {
      return true;
    }
  }
  return false;
}

function compactBridgedMovedSubtreeHasRawSevereOverlap(layoutGraph, coords, subtreeAtomIds, bondLength) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const subtreeAtomIdSet = new Set(subtreeAtomIds);
  for (const atomId of subtreeAtomIds) {
    if (!isVisibleHeavyLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    const atomPosition = coords.get(atomId);
    if (!atomPosition) {
      continue;
    }
    const bondedAtomIds = bondedAtomIdSet(layoutGraph, atomId);
    for (const [otherAtomId, otherAtom] of layoutGraph.atoms) {
      if (
        otherAtomId === atomId ||
        subtreeAtomIdSet.has(otherAtomId) ||
        bondedAtomIds.has(otherAtomId) ||
        !otherAtom ||
        otherAtom.element === 'H' ||
        !coords.has(otherAtomId) ||
        !isVisibleHeavyLayoutAtom(layoutGraph, otherAtomId)
      ) {
        continue;
      }
      const otherPosition = coords.get(otherAtomId);
      if (Math.hypot(atomPosition.x - otherPosition.x, atomPosition.y - otherPosition.y) < threshold - 1e-9) {
        return true;
      }
    }
  }
  return false;
}

function compactBridgedSmallAcyclicHeteroLeafHasClearSubtreeSlot(layoutGraph, coords, descriptor, bondLength) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return true;
  }
  const radius = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y);
  if (!(radius > 0)) {
    return false;
  }
  const ringPolygons = incidentRingPolygonsForAtom(layoutGraph, coords, descriptor.anchorAtomId);
  for (let angle = 0; angle < Math.PI * 2; angle += COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_SLOT_STEP) {
    const candidatePosition = {
      x: anchorPosition.x + Math.cos(angle) * radius,
      y: anchorPosition.y + Math.sin(angle) * radius
    };
    if (ringPolygons.some(polygon => pointInPolygon(candidatePosition, polygon))) {
      continue;
    }
    if (ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, descriptor.anchorAtomId, descriptor.rootAtomId, anchorPosition, candidatePosition)) {
      continue;
    }
    const candidateCoords = translatedSubtreeCoords(coords, descriptor.subtreeAtomIds, {
      x: candidatePosition.x - rootPosition.x,
      y: candidatePosition.y - rootPosition.y
    });
    if (!compactBridgedMovedSubtreeHasRawSevereOverlap(layoutGraph, candidateCoords, descriptor.subtreeAtomIds, bondLength) && countVisibleHeavyBondCrossings(layoutGraph, candidateCoords) === 0) {
      return true;
    }
  }
  return false;
}

function compactFusedSmallAcyclicCarbonRootHasClearSubtreeSlot(layoutGraph, coords, descriptor, bondLength) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const rootPosition = coords.get(descriptor.rootAtomId);
  if (!anchorPosition || !rootPosition) {
    return true;
  }
  const radius = Math.hypot(rootPosition.x - anchorPosition.x, rootPosition.y - anchorPosition.y);
  if (!(radius > 0)) {
    return false;
  }
  const ringPolygons = incidentRingPolygonsForAtom(layoutGraph, coords, descriptor.anchorAtomId);
  for (let angle = 0; angle < Math.PI * 2; angle += COMPACT_BRIDGED_TERMINAL_CARBON_LEAF_SLOT_STEP) {
    const candidatePosition = {
      x: anchorPosition.x + Math.cos(angle) * radius,
      y: anchorPosition.y + Math.sin(angle) * radius
    };
    if (ringPolygons.some(polygon => pointInPolygon(candidatePosition, polygon))) {
      continue;
    }
    if (ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, descriptor.anchorAtomId, descriptor.rootAtomId, anchorPosition, candidatePosition)) {
      continue;
    }
    const candidateCoords = translatedSubtreeCoords(coords, descriptor.subtreeAtomIds, {
      x: candidatePosition.x - rootPosition.x,
      y: candidatePosition.y - rootPosition.y
    });
    if (!compactBridgedMovedSubtreeHasRawSevereOverlap(layoutGraph, candidateCoords, descriptor.subtreeAtomIds, bondLength) && countVisibleHeavyBondCrossings(layoutGraph, candidateCoords) === 0) {
      return true;
    }
  }
  return false;
}

function movedTerminalLeafHasRawSevereOverlap(layoutGraph, coords, leafAtomId, bondLength) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const leafPosition = coords.get(leafAtomId);
  if (!leafPosition || !isVisibleHeavyLayoutAtom(layoutGraph, leafAtomId)) {
    return false;
  }

  const bondedAtomIds = bondedAtomIdSet(layoutGraph, leafAtomId);
  for (const [otherAtomId, otherAtom] of layoutGraph.atoms) {
    if (otherAtomId === leafAtomId || bondedAtomIds.has(otherAtomId) || !otherAtom || otherAtom.element === 'H' || !coords.has(otherAtomId) || !isVisibleHeavyLayoutAtom(layoutGraph, otherAtomId)) {
      continue;
    }
    const otherPosition = coords.get(otherAtomId);
    if (Math.hypot(leafPosition.x - otherPosition.x, leafPosition.y - otherPosition.y) < threshold - 1e-9) {
      return true;
    }
  }
  return false;
}

function separateSmallRingTerminalAminoLeafHasClearSlot(layoutGraph, coords, descriptor, bondLength) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  const leafPosition = coords.get(descriptor.leafAtomId);
  if (!anchorPosition || !leafPosition) {
    return true;
  }
  const radius = Math.hypot(leafPosition.x - anchorPosition.x, leafPosition.y - anchorPosition.y);
  if (!(radius > 0)) {
    return false;
  }

  for (let angle = 0; angle < Math.PI * 2; angle += SEPARATE_SMALL_RING_TERMINAL_AMINO_LEAF_SLOT_STEP) {
    const candidatePosition = {
      x: anchorPosition.x + Math.cos(angle) * radius,
      y: anchorPosition.y + Math.sin(angle) * radius
    };
    if (ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, descriptor.anchorAtomId, descriptor.leafAtomId, anchorPosition, candidatePosition)) {
      continue;
    }
    const candidateCoords = new Map(coords);
    candidateCoords.set(descriptor.leafAtomId, candidatePosition);
    if (
      !movedTerminalLeafHasRawSevereOverlap(layoutGraph, candidateCoords, descriptor.leafAtomId, bondLength) &&
      countVisibleHeavyBondCrossings(layoutGraph, candidateCoords) === 0 &&
      measureRingSubstituentReadability(layoutGraph, candidateCoords).failingSubstituentCount === 0
    ) {
      return true;
    }
  }
  return false;
}

function isAcceptedCompactBridgedTerminalCarbonLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) {
  for (const [leafAtomId, blockerAtomId] of [
    [firstAtomId, secondAtomId],
    [secondAtomId, firstAtomId]
  ]) {
    const descriptor = compactBridgedTerminalCarbonLeafOverlapDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId, distance, bondLength);
    if (descriptor && !compactBridgedTerminalLeafHasClearSlot(layoutGraph, coords, descriptor, bondLength)) {
      return true;
    }
  }
  return false;
}

function isAcceptedCompactBridgedTerminalHeteroLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) {
  for (const [leafAtomId, blockerAtomId] of [
    [firstAtomId, secondAtomId],
    [secondAtomId, firstAtomId]
  ]) {
    const descriptor = compactBridgedTerminalHeteroLeafOverlapDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId, distance, bondLength);
    if (descriptor && !compactBridgedTerminalLeafHasClearSlot(layoutGraph, coords, descriptor, bondLength)) {
      return true;
    }
  }
  return false;
}

function isAcceptedCompactBridgedSmallAcyclicHeteroLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) {
  for (const [leafAtomId, blockerAtomId] of [
    [firstAtomId, secondAtomId],
    [secondAtomId, firstAtomId]
  ]) {
    const descriptor = compactBridgedSmallAcyclicHeteroLeafOverlapDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId, distance, bondLength);
    if (descriptor && !compactBridgedSmallAcyclicHeteroLeafHasClearSubtreeSlot(layoutGraph, coords, descriptor, bondLength)) {
      return true;
    }
  }
  return false;
}

function isAcceptedCompactFusedSmallAcyclicCarbonRootOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) {
  for (const [rootAtomId, blockerAtomId] of [
    [firstAtomId, secondAtomId],
    [secondAtomId, firstAtomId]
  ]) {
    const descriptor = compactFusedSmallAcyclicCarbonRootOverlapDescriptor(layoutGraph, coords, rootAtomId, blockerAtomId, distance, bondLength);
    if (descriptor && !compactFusedSmallAcyclicCarbonRootHasClearSubtreeSlot(layoutGraph, coords, descriptor, bondLength)) {
      return true;
    }
  }
  return false;
}

function isAcceptedSeparateSmallRingTerminalAminoLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) {
  if (countVisibleHeavyBondCrossings(layoutGraph, coords) !== 0) {
    return false;
  }
  for (const [leafAtomId, blockerAtomId] of [
    [firstAtomId, secondAtomId],
    [secondAtomId, firstAtomId]
  ]) {
    const descriptor = separateSmallRingTerminalAminoLeafOverlapDescriptor(layoutGraph, coords, leafAtomId, blockerAtomId, distance, bondLength);
    if (descriptor && !separateSmallRingTerminalAminoLeafHasClearSlot(layoutGraph, coords, descriptor, bondLength)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether the atom participates in visible-audit geometry.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Atom identifier.
 * @returns {boolean} True when the atom should count in visible geometry checks.
 */
function isVisibleLayoutAtom(layoutGraph, atomId) {
  return visibleLayoutAtomIdSet(layoutGraph).has(atomId);
}

function isVisibleHeavyLayoutAtom(layoutGraph, atomId) {
  return visibleHeavyLayoutAtomIdSet(layoutGraph).has(atomId);
}

function visibleLayoutAtomIdSet(layoutGraph) {
  if (layoutGraph._visibleLayoutAtomIdSet instanceof Set) {
    return layoutGraph._visibleLayoutAtomIdSet;
  }
  const atomIds = new Set();
  for (const atom of layoutGraph.atoms.values()) {
    if (layoutGraph.options.suppressH && atom.element === 'H') {
      continue;
    }
    atomIds.add(atom.id);
  }
  layoutGraph._visibleLayoutAtomIdSet = atomIds;
  return atomIds;
}

function visibleHeavyLayoutAtomIdSet(layoutGraph) {
  if (layoutGraph._visibleHeavyLayoutAtomIdSet instanceof Set) {
    return layoutGraph._visibleHeavyLayoutAtomIdSet;
  }
  const atomIds = new Set();
  const visibleAtomIds = visibleLayoutAtomIdSet(layoutGraph);
  for (const atom of layoutGraph.atoms.values()) {
    if (atom.element !== 'H' && visibleAtomIds.has(atom.id)) {
      atomIds.add(atom.id);
    }
  }
  layoutGraph._visibleHeavyLayoutAtomIdSet = atomIds;
  return atomIds;
}

function visibleHeavyAtomIdsInCoords(layoutGraph, coords, atomIds = null) {
  const heavyAtomIds = visibleHeavyLayoutAtomIdSet(layoutGraph);
  const scopedAtomIds = atomIds ?? coords.keys();
  const visibleHeavyAtomIds = [];
  for (const atomId of scopedAtomIds) {
    if (heavyAtomIds.has(atomId) && coords.has(atomId)) {
      visibleHeavyAtomIds.push(atomId);
    }
  }
  return visibleHeavyAtomIds;
}

function bondedAtomIdSet(layoutGraph, atomId) {
  if (!(layoutGraph._bondedAtomIdSetByAtomId instanceof Map)) {
    layoutGraph._bondedAtomIdSetByAtomId = new Map();
  }
  let bondedAtomIds = layoutGraph._bondedAtomIdSetByAtomId.get(atomId);
  if (bondedAtomIds) {
    return bondedAtomIds;
  }
  bondedAtomIds = new Set();
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    bondedAtomIds.add(bond.a === atomId ? bond.b : bond.a);
  }
  layoutGraph._bondedAtomIdSetByAtomId.set(atomId, bondedAtomIds);
  return bondedAtomIds;
}

function areLayoutAtomsBonded(layoutGraph, firstAtomId, secondAtomId) {
  return bondedAtomIdSet(layoutGraph, firstAtomId).has(secondAtomId);
}

function visibleAtomOrderById(layoutGraph, coords, visibleAtomIds) {
  const orderById = new Map();
  let order = 0;
  if (visibleAtomIds) {
    for (const atomId of visibleAtomIds) {
      if (coords.has(atomId) && !orderById.has(atomId)) {
        orderById.set(atomId, order++);
      }
    }
    return orderById;
  }
  for (const [atomId, position] of coords) {
    if (position && isVisibleLayoutAtom(layoutGraph, atomId)) {
      orderById.set(atomId, order++);
    }
  }
  return orderById;
}

function collectNonbondedPairs(layoutGraph, coords, includePair, atomGrid = null, queryRadius = 0, options = {}) {
  const visibleAtomIds = options.visibleAtomIds ?? null;
  const queryRadiusSquared = queryRadius > 0 ? queryRadius * queryRadius : null;
  if (atomGrid) {
    const canUseGridOrder = atomGrid.atomOrderById instanceof Map && (!visibleAtomIds || options.visibleAtomIdsMatchGrid === true);
    const visibleAtomIdList = visibleAtomIds && !canUseGridOrder ? (Array.isArray(visibleAtomIds) ? visibleAtomIds : [...visibleAtomIds]) : null;
    const atomOrderById = canUseGridOrder ? atomGrid.atomOrderById : visibleAtomOrderById(layoutGraph, coords, visibleAtomIdList);
    const pairs = [];

    const firstAtomEntries = canUseGridOrder ? atomGrid.atomOrderById.keys() : (visibleAtomIdList ?? coords);
    for (const entry of firstAtomEntries) {
      const firstAtomId = canUseGridOrder || visibleAtomIdList ? entry : entry[0];
      const firstPosition = canUseGridOrder || visibleAtomIdList ? coords.get(firstAtomId) : entry[1];
      const firstOrder = atomOrderById.get(firstAtomId);
      if (!firstPosition || firstOrder == null) {
        continue;
      }
      const firstBondedAtomIds = bondedAtomIdSet(layoutGraph, firstAtomId);
      atomGrid.forEachRadius(firstPosition, queryRadius, secondAtomId => {
        const secondOrder = atomOrderById.get(secondAtomId);
        if (secondOrder == null || secondOrder <= firstOrder) {
          return;
        }
        if (firstBondedAtomIds.has(secondAtomId)) {
          return;
        }
        const secondPosition = coords.get(secondAtomId);
        if (!secondPosition) {
          return;
        }
        const dx = secondPosition.x - firstPosition.x;
        const dy = secondPosition.y - firstPosition.y;
        const distanceSquared = dx * dx + dy * dy;
        if (queryRadiusSquared != null && distanceSquared >= queryRadiusSquared) {
          return;
        }
        const distance = Math.hypot(dx, dy);
        if (includePair(firstAtomId, secondAtomId, distance)) {
          pairs.push({ firstAtomId, secondAtomId, distance });
        }
      });
    }

    return pairs;
  }

  const atomIds = visibleAtomIds ? [...visibleAtomIds] : [...coords.keys()];
  const pairs = [];

  for (let firstIndex = 0; firstIndex < atomIds.length; firstIndex++) {
    const firstAtomId = atomIds[firstIndex];
    if (!visibleAtomIds && !isVisibleLayoutAtom(layoutGraph, firstAtomId)) {
      continue;
    }
    const firstPosition = coords.get(firstAtomId);
    const firstBondedAtomIds = bondedAtomIdSet(layoutGraph, firstAtomId);
    for (let secondIndex = firstIndex + 1; secondIndex < atomIds.length; secondIndex++) {
      const secondAtomId = atomIds[secondIndex];
      if ((!visibleAtomIds && !isVisibleLayoutAtom(layoutGraph, secondAtomId)) || firstBondedAtomIds.has(secondAtomId)) {
        continue;
      }
      const secondPosition = coords.get(secondAtomId);
      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      const distanceSquared = dx * dx + dy * dy;
      if (queryRadiusSquared != null && distanceSquared >= queryRadiusSquared) {
        continue;
      }
      const distance = Math.hypot(dx, dy);
      if (includePair(firstAtomId, secondAtomId, distance)) {
        pairs.push({ firstAtomId, secondAtomId, distance });
      }
    }
  }

  return pairs;
}

function visitNonbondedPairs(layoutGraph, coords, visitPair, atomGrid = null, queryRadius = 0, options = {}) {
  const visibleAtomIds = options.visibleAtomIds ?? null;
  const queryRadiusSquared = queryRadius > 0 ? queryRadius * queryRadius : null;
  if (atomGrid) {
    const canUseGridOrder = atomGrid.atomOrderById instanceof Map && (!visibleAtomIds || options.visibleAtomIdsMatchGrid === true);
    const visibleAtomIdList = visibleAtomIds && !canUseGridOrder ? (Array.isArray(visibleAtomIds) ? visibleAtomIds : [...visibleAtomIds]) : null;
    const atomOrderById = canUseGridOrder ? atomGrid.atomOrderById : visibleAtomOrderById(layoutGraph, coords, visibleAtomIdList);
    const firstAtomEntries = canUseGridOrder ? atomGrid.atomOrderById.keys() : (visibleAtomIdList ?? coords);
    for (const entry of firstAtomEntries) {
      const firstAtomId = canUseGridOrder || visibleAtomIdList ? entry : entry[0];
      const firstPosition = canUseGridOrder || visibleAtomIdList ? coords.get(firstAtomId) : entry[1];
      const firstOrder = atomOrderById.get(firstAtomId);
      if (!firstPosition || firstOrder == null) {
        continue;
      }
      const firstBondedAtomIds = bondedAtomIdSet(layoutGraph, firstAtomId);
      if (
        atomGrid.someRadius(firstPosition, queryRadius, secondAtomId => {
          const secondOrder = atomOrderById.get(secondAtomId);
          if (secondOrder == null || secondOrder <= firstOrder) {
            return false;
          }
          if (firstBondedAtomIds.has(secondAtomId)) {
            return false;
          }
          const secondPosition = coords.get(secondAtomId);
          if (!secondPosition) {
            return false;
          }
          const dx = secondPosition.x - firstPosition.x;
          const dy = secondPosition.y - firstPosition.y;
          const distanceSquared = dx * dx + dy * dy;
          if (queryRadiusSquared != null && distanceSquared >= queryRadiusSquared) {
            return false;
          }
          const distance = Math.hypot(dx, dy);
          return visitPair(firstAtomId, secondAtomId, distance) === true;
        })
      ) {
        return true;
      }
    }
    return false;
  }

  const atomIds = visibleAtomIds ? [...visibleAtomIds] : [...coords.keys()];
  for (let firstIndex = 0; firstIndex < atomIds.length; firstIndex++) {
    const firstAtomId = atomIds[firstIndex];
    if (!visibleAtomIds && !isVisibleLayoutAtom(layoutGraph, firstAtomId)) {
      continue;
    }
    const firstPosition = coords.get(firstAtomId);
    if (!firstPosition) {
      continue;
    }
    const firstBondedAtomIds = bondedAtomIdSet(layoutGraph, firstAtomId);
    for (let secondIndex = firstIndex + 1; secondIndex < atomIds.length; secondIndex++) {
      const secondAtomId = atomIds[secondIndex];
      if ((!visibleAtomIds && !isVisibleLayoutAtom(layoutGraph, secondAtomId)) || firstBondedAtomIds.has(secondAtomId)) {
        continue;
      }
      const secondPosition = coords.get(secondAtomId);
      if (!secondPosition) {
        continue;
      }
      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      const distanceSquared = dx * dx + dy * dy;
      if (queryRadiusSquared != null && distanceSquared >= queryRadiusSquared) {
        continue;
      }
      const distance = Math.hypot(dx, dy);
      if (visitPair(firstAtomId, secondAtomId, distance) === true) {
        return true;
      }
    }
  }
  return false;
}

function countNonbondedPairs(layoutGraph, coords, includePair, atomGrid = null, queryRadius = 0, options = {}) {
  let count = 0;
  visitNonbondedPairs(
    layoutGraph,
    coords,
    (firstAtomId, secondAtomId, distance) => {
      if (includePair(firstAtomId, secondAtomId, distance)) {
        count++;
      }
      return false;
    },
    atomGrid,
    queryRadius,
    options
  );
  return count;
}

function someNonbondedPair(layoutGraph, coords, includePair, atomGrid = null, queryRadius = 0, options = {}) {
  return visitNonbondedPairs(layoutGraph, coords, (firstAtomId, secondAtomId, distance) => includePair(firstAtomId, secondAtomId, distance), atomGrid, queryRadius, options);
}

/**
 * Builds a spatial atom grid from the current placed coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {{visibleAtomIds?: Iterable<string>}} [options] - Optional precomputed visible atom IDs.
 * @returns {AtomGrid} Spatial atom grid.
 */
export function buildAtomGrid(layoutGraph, coords, bondLength, options = {}) {
  const atomGrid = new AtomGrid(bondLength);
  atomGrid.visibleAtomIdsOnly = true;
  atomGrid.atomOrderById = new Map();
  let order = 0;
  if (options.visibleAtomIds) {
    for (const atomId of options.visibleAtomIds) {
      const position = coords.get(atomId);
      if (position) {
        atomGrid.insert(atomId, position);
        atomGrid.atomOrderById.set(atomId, order++);
      }
    }
    return atomGrid;
  }

  const visibleAtomIds = visibleLayoutAtomIdSet(layoutGraph);
  for (const [atomId, position] of coords) {
    if (!visibleAtomIds.has(atomId)) {
      continue;
    }
    atomGrid.insert(atomId, position);
    atomGrid.atomOrderById.set(atomId, order++);
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
  const includeBondCrowding = options.includeBondCrowding === true;
  const canCache = subtreeAtomIds instanceof Set && layoutGraph;
  if (canCache) {
    let contextCache = layoutGraph._subtreeOverlapContextCache;
    if (!(contextCache instanceof Map)) {
      contextCache = new Map();
      layoutGraph._subtreeOverlapContextCache = contextCache;
    }
    const cachedContext = contextCache.get(subtreeAtomIds);
    if (cachedContext) {
      if (includeBondCrowding && cachedContext.includeBondCrowding === true) {
        return cachedContext;
      }
      if (!includeBondCrowding) {
        return cachedContext;
      }
    }
  }

  const subtreeSet = subtreeAtomIds instanceof Set ? subtreeAtomIds : new Set(subtreeAtomIds);
  const seenVisibleAtomIds = new Set();
  const visibleSubtreeAtomIds = [];
  const visibleAtomIds = visibleLayoutAtomIdSet(layoutGraph);
  for (const atomId of subtreeAtomIds) {
    if (!seenVisibleAtomIds.has(atomId) && visibleAtomIds.has(atomId)) {
      seenVisibleAtomIds.add(atomId);
      visibleSubtreeAtomIds.push(atomId);
    }
  }

  if (!includeBondCrowding) {
    const context = {
      subtreeSet,
      visibleSubtreeAtomIds
    };
    if (canCache) {
      layoutGraph._subtreeOverlapContextCache.set(subtreeAtomIds, context);
    }
    return context;
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

  const context = {
    subtreeSet,
    visibleSubtreeAtomIds,
    subtreeBonds,
    externalBonds,
    includeBondCrowding: true
  };
  if (canCache) {
    layoutGraph._subtreeOverlapContextCache.set(subtreeAtomIds, context);
  }
  return context;
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

  const crossingPenalty = compactArylBranchedLeafCrossingPenalty(layoutGraph, coords, uniqueFocusAtomIds);

  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const thresholdSquared = threshold * threshold;
  const atomGrid = options.atomGrid ?? (coords.size >= FOCUSED_PLACEMENT_COST_GRID_MIN_COORDS ? buildAtomGrid(layoutGraph, coords, bondLength) : null);
  const atomGridHasVisibleAtoms = atomGrid?.visibleAtomIdsOnly === true;
  const focusOrderByAtomId = new Map(uniqueFocusAtomIds.map((atomId, index) => [atomId, index]));
  let overlapPenalty = 0;

  for (const firstAtomId of uniqueFocusAtomIds) {
    const firstPosition = coords.get(firstAtomId);
    const firstFocusOrder = focusOrderByAtomId.get(firstAtomId);
    const firstBondedAtomIds = bondedAtomIdSet(layoutGraph, firstAtomId);
    const scoreCandidate = secondAtomId => {
      if (secondAtomId === firstAtomId || (!atomGridHasVisibleAtoms && !isVisibleLayoutAtom(layoutGraph, secondAtomId))) {
        return;
      }
      const secondFocusOrder = focusOrderByAtomId.get(secondAtomId);
      if (secondFocusOrder != null && secondFocusOrder <= firstFocusOrder) {
        return;
      }
      if (firstBondedAtomIds.has(secondAtomId)) {
        return;
      }
      const secondPosition = coords.get(secondAtomId);
      if (!secondPosition) {
        return;
      }
      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= thresholdSquared) {
        return;
      }
      const distance = Math.hypot(dx, dy);
      const deficit = threshold - distance;
      overlapPenalty += deficit * deficit * 100;
    };
    if (atomGrid) {
      atomGrid.forEachRadius(firstPosition, threshold, scoreCandidate);
    } else {
      for (const secondAtomId of coords.keys()) {
        scoreCandidate(secondAtomId);
      }
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

  return overlapPenalty + crossingPenalty + (sampleCount === 0 ? 0 : (totalDeviation / sampleCount) * 10 + maxDeviation * 5);
}

function compactArylBranchedLeafCrossingPenalty(layoutGraph, coords, focusAtomIds) {
  const crossingBonds = compactArylBranchedLeafCrossingBonds(layoutGraph);
  if (crossingBonds.leafBondCount === 0 || !focusCanAffectCompactArylBranchedLeafCrossing(layoutGraph, focusAtomIds)) {
    return 0;
  }
  const focusSet = new Set(focusAtomIds);
  let penalty = 0;
  const visibleBonds = collectCompactArylCrossingBondSegments(crossingBonds.entries, coords, focusSet);

  for (const focused of visibleBonds) {
    if (!focused.touchesFocus) {
      continue;
    }
    for (const other of visibleBonds) {
      if (focused === other) {
        continue;
      }
      if (other.minX > focused.maxX) {
        break;
      }
      if (other.maxX < focused.minX) {
        continue;
      }
      if (other.touchesFocus && other.index < focused.index) {
        continue;
      }
      const first = focused.index < other.index ? focused : other;
      const second = focused.index < other.index ? other : focused;
      if (!visibleHeavyBondSegmentsCanCross(first, second, focusSet)) {
        continue;
      }
      if (!compactArylBranchedLeafRolesCanCross(first.role, second.role)) {
        continue;
      }
      if (segmentsProperlyIntersect(first.firstPosition, first.secondPosition, second.firstPosition, second.secondPosition)) {
        penalty += 1000;
      }
    }
  }
  return penalty;
}

function collectCompactArylCrossingBondSegments(entries, coords, focusAtomSet) {
  const visibleBonds = [];
  for (const entry of entries) {
    const bond = entry.bond;
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    visibleBonds.push({
      index: visibleBonds.length,
      bond,
      role: entry.role,
      firstPosition,
      secondPosition,
      minX: Math.min(firstPosition.x, secondPosition.x),
      maxX: Math.max(firstPosition.x, secondPosition.x),
      minY: Math.min(firstPosition.y, secondPosition.y),
      maxY: Math.max(firstPosition.y, secondPosition.y),
      touchesFocus: focusAtomSet.has(bond.a) || focusAtomSet.has(bond.b)
    });
  }
  visibleBonds.sort((first, second) => first.minX - second.minX);
  return visibleBonds;
}

function compactArylBranchedLeafCrossingBonds(layoutGraph) {
  if (layoutGraph._compactArylBranchedLeafCrossingBonds) {
    return layoutGraph._compactArylBranchedLeafCrossingBonds;
  }
  const entries = [];
  let leafBondCount = 0;
  for (const bond of visibleHeavyAuditBonds(layoutGraph)) {
    const role = compactArylBranchedLeafCrossingRole(layoutGraph, bond);
    if (!role) {
      continue;
    }
    entries.push({ bond, role });
    if (role === 'leaf') {
      leafBondCount++;
    }
  }
  layoutGraph._compactArylBranchedLeafCrossingBonds = { entries, leafBondCount };
  return layoutGraph._compactArylBranchedLeafCrossingBonds;
}

function compactArylBranchedLeafCrossingRole(layoutGraph, bond) {
  if (!bond || bond.kind !== 'covalent') {
    return null;
  }
  if (bond.inRing === true || bond.aromatic === true) {
    return 'ring';
  }
  return isCompactArylBranchedLeafBond(layoutGraph, bond) ? 'leaf' : null;
}

function compactArylBranchedLeafRolesCanCross(firstRole, secondRole) {
  return (firstRole === 'leaf' && secondRole === 'ring') || (firstRole === 'ring' && secondRole === 'leaf');
}

function focusCanAffectCompactArylBranchedLeafCrossing(layoutGraph, focusAtomIds) {
  for (const atomId of focusAtomIds) {
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      if (bond.inRing === true || bond.aromatic === true || isCompactArylBranchedLeafBond(layoutGraph, bond)) {
        return true;
      }
    }
  }
  return false;
}

function isCompactArylBranchedLeafBond(layoutGraph, bond) {
  if (!bond) {
    return false;
  }
  if (bond.id == null) {
    return isCompactArylBranchedLeafBondUncached(layoutGraph, bond);
  }
  if (!(layoutGraph._compactArylBranchedLeafBondCache instanceof Map)) {
    layoutGraph._compactArylBranchedLeafBondCache = new Map();
  }
  const cached = layoutGraph._compactArylBranchedLeafBondCache.get(bond.id);
  if (cached != null) {
    return cached;
  }
  const result = isCompactArylBranchedLeafBondUncached(layoutGraph, bond);
  layoutGraph._compactArylBranchedLeafBondCache.set(bond.id, result);
  return result;
}

function isCompactArylBranchedLeafBondUncached(layoutGraph, bond) {
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
    return false;
  }
  for (const [rootAtomId, leafAtomId] of [
    [bond.a, bond.b],
    [bond.b, bond.a]
  ]) {
    const rootAtom = layoutGraph.atoms.get(rootAtomId);
    const leafAtom = layoutGraph.atoms.get(leafAtomId);
    if (
      !rootAtom ||
      !leafAtom ||
      rootAtom.element !== 'C' ||
      rootAtom.aromatic ||
      rootAtom.heavyDegree !== 3 ||
      rootAtom.degree !== 4 ||
      leafAtom.element !== 'C' ||
      leafAtom.aromatic ||
      leafAtom.heavyDegree !== 1 ||
      layoutGraph.ringAtomIdSet.has(rootAtomId) ||
      layoutGraph.ringAtomIdSet.has(leafAtomId)
    ) {
      continue;
    }
    for (const neighborBond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
      if (!neighborBond || neighborBond.id === bond.id || neighborBond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = neighborBond.a === rootAtomId ? neighborBond.b : neighborBond.a;
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (neighborAtom?.aromatic === true && layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
        return true;
      }
    }
  }
  return false;
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
  if (!anchorAtom || !layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
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

function ringSystemAtomIds(layoutGraph, ringSystemId) {
  return layoutGraph.ringSystemById.get(ringSystemId)?.atomIds ?? [];
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

function isAuditConjugatedTrigonalCenter(layoutGraph, atomId) {
  const atom = layoutGraph?.atoms.get(atomId);
  if (!atom || atom.element === 'H' || atom.aromatic || atom.degree !== 3) {
    return false;
  }

  let multipleBondCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic) {
      continue;
    }
    if ((bond.order ?? 1) >= 2) {
      multipleBondCount++;
    }
  }
  return multipleBondCount === 1;
}

function hasConjugatedDivalentNitrogenBranch(layoutGraph, anchorAtomId, childAtomId) {
  for (const bond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    const nitrogenAtomId = bond.a === childAtomId ? bond.b : bond.a;
    if (nitrogenAtomId === anchorAtomId) {
      continue;
    }

    const nitrogenAtom = layoutGraph.atoms.get(nitrogenAtomId);
    if (!nitrogenAtom || nitrogenAtom.element !== 'N' || nitrogenAtom.aromatic || nitrogenAtom.heavyDegree !== 2 || layoutGraph.ringAtomIdSet.has(nitrogenAtomId)) {
      continue;
    }

    for (const nitrogenBond of layoutGraph.bondsByAtomId.get(nitrogenAtomId) ?? []) {
      if (!nitrogenBond || nitrogenBond.kind !== 'covalent' || nitrogenBond.aromatic || (nitrogenBond.order ?? 1) !== 1) {
        continue;
      }
      const downstreamAtomId = nitrogenBond.a === nitrogenAtomId ? nitrogenBond.b : nitrogenBond.a;
      if (downstreamAtomId === childAtomId) {
        continue;
      }
      if (isAuditConjugatedTrigonalCenter(layoutGraph, downstreamAtomId)) {
        return true;
      }
    }
  }
  return false;
}

function isFlexibleTertiaryAmineMethyleneLinkedRingRoot(layoutGraph, anchorAtomId, childAtomId) {
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'N' || childAtom.aromatic === true || childAtom.heavyDegree !== 3 || (childAtom.charge ?? 0) !== 0 || layoutGraph.ringAtomIdSet.has(childAtomId)) {
    return false;
  }

  let flexibleArmCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === childAtomId ? bond.b : bond.a;
    if (neighborAtomId === anchorAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (
      !neighborAtom ||
      neighborAtom.element !== 'C' ||
      neighborAtom.aromatic === true ||
      layoutGraph.ringAtomIdSet.has(neighborAtomId) ||
      isAuditConjugatedTrigonalCenter(layoutGraph, neighborAtomId)
    ) {
      return false;
    }
    flexibleArmCount++;
  }

  return flexibleArmCount >= 1;
}

function isTetrahedralMultiRingBranchingRoot(layoutGraph, anchorAtomId, childAtomId) {
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'C' || childAtom.aromatic === true || layoutGraph.ringAtomIdSet.has(childAtomId) || (childAtom.heavyDegree ?? 0) < 4) {
    return false;
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const downstreamRingSystemIds = new Set();
  let downstreamNonRingHeavyNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === childAtomId ? bond.b : bond.a;
    if (neighborAtomId === anchorAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    const neighborRingSystemId = layoutGraph.atomToRingSystemId.get(neighborAtomId);
    if (neighborRingSystemId != null && neighborRingSystemId !== anchorRingSystemId) {
      downstreamRingSystemIds.add(neighborRingSystemId);
    } else if (neighborRingSystemId == null) {
      downstreamNonRingHeavyNeighborCount++;
    }
  }

  return downstreamRingSystemIds.size >= 1 && downstreamNonRingHeavyNeighborCount >= 1;
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
  if (isFlexibleTertiaryAmineMethyleneLinkedRingRoot(layoutGraph, anchorAtomId, childAtomId)) {
    return true;
  }
  if (isTetrahedralMultiRingBranchingRoot(layoutGraph, anchorAtomId, childAtomId)) {
    return true;
  }

  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    childAtom &&
    childAtom.aromatic !== true &&
    (childAtom.heavyDegree ?? 0) > 2 &&
    !layoutGraph.ringAtomIdSet.has(childAtomId) &&
    hasConjugatedDivalentNitrogenBranch(layoutGraph, anchorAtomId, childAtomId)
  ) {
    return true;
  }
  if (
    childAtom &&
    childAtom.aromatic !== true &&
    !layoutGraph.ringAtomIdSet.has(childAtomId) &&
    (childAtom.heavyDegree ?? 0) > 2 &&
    (childAtom.element === 'C' || childAtom.element === 'N') &&
    (layoutGraph.bondsByAtomId.get(childAtomId) ?? []).some(bond => {
      if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
        return false;
      }
      const neighborAtomId = bond.a === childAtomId ? bond.b : bond.a;
      return neighborAtomId !== anchorAtomId;
    })
  ) {
    // Unsaturated branching roots have their own local trigonal geometry at the
    // ring exit; a downstream ring centroid is not a stable representative for
    // that immediate bond.
    return true;
  }
  if (!childAtom || childAtom.element !== 'C' || childAtom.aromatic === true || childAtom.heavyDegree !== 3 || layoutGraph.ringAtomIdSet.has(childAtomId)) {
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
 * @returns {{representativeAtomIds: string[]}|null} Downstream ring representative, or `null`.
 */
function _resolveLinkedSubstituentRingRepresentativeImpl(layoutGraph, coords, anchorAtomId, childAtomId) {
  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    anchorRingSystemId == null ||
    !childAtom ||
    prefersImmediateLinkedSubstituentRepresentative(layoutGraph, anchorAtomId, childAtomId) ||
    // Do not promote a remote ring through any divalent non-aromatic linker atom.
    // Divalent linkers (–O–, –N–, –CH₂–, –S–, etc.) introduce a free torsion between
    // the anchor ring exit direction and the remote ring, so the far centroid is not a
    // valid outward representative. The immediate child is used instead.
    (childAtom.aromatic !== true && childAtom.heavyDegree === 2)
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

    const currentAtom = layoutGraph.atoms.get(atomId);
    if (
      atomId === childAtomId &&
      linkerDepth === 0 &&
      currentAtom &&
      currentAtom.aromatic !== true &&
      !layoutGraph.ringAtomIdSet.has(atomId) &&
      (currentAtom.heavyDegree ?? 0) > 2 &&
      (currentAtom.degree ?? currentAtom.heavyDegree ?? 0) > (currentAtom.heavyDegree ?? 0)
    ) {
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
      const neighborInRing = layoutGraph.atomToRingSystemId.get(neighborAtomId) != null;
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
  const representativeAtomIds = ringSystemAtomIds(layoutGraph, [...reachableRingSystemIds][0]).filter(atomId => coords.has(atomId));
  return representativeAtomIds.length > 0 ? { representativeAtomIds } : null;
}

function resolveLinkedSubstituentRingRepresentative(layoutGraph, coords, anchorAtomId, childAtomId) {
  const cache = layoutGraph._linkedSubstituentRepCache ?? (layoutGraph._linkedSubstituentRepCache = new Map());
  const cacheKey = `${anchorAtomId}:${childAtomId}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const result = _resolveLinkedSubstituentRingRepresentativeImpl(layoutGraph, coords, anchorAtomId, childAtomId);
  cache.set(cacheKey, result);
  return result;
}

function incidentRingPolygons(layoutGraph, coords, atomId) {
  return incidentRingPolygonsForAtom(layoutGraph, coords, atomId);
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

function isPathLikeRingChainLinkerChild(layoutGraph, anchorAtomId, childAtomId) {
  const cache = layoutGraph._pathLikeRingChainLinkerChildCache ?? (layoutGraph._pathLikeRingChainLinkerChildCache = new Map());
  const cacheKey = `${anchorAtomId}:${childAtomId}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  let result = false;
  for (const component of layoutGraph.components ?? []) {
    const ringChain = describePathLikeIsolatedRingChain(layoutGraph, component);
    if (!ringChain) {
      continue;
    }
    result = (ringChain.edges ?? []).some(edge => {
      const linkerAtomIds = new Set(edge.linkerAtomIds ?? []);
      return (edge.firstAttachmentAtomId === anchorAtomId && linkerAtomIds.has(childAtomId)) || (edge.secondAttachmentAtomId === anchorAtomId && linkerAtomIds.has(childAtomId));
    });
    if (result) {
      break;
    }
  }
  cache.set(cacheKey, result);
  return result;
}

/**
 * Returns whether a ring substituent is an exact charged-sulfoxide linker whose
 * branched trigonal fan should not replace the immediate outward bond as the
 * readability direction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Ring atom carrying the substituent.
 * @param {string} childAtomId - Immediate non-ring substituent atom.
 * @param {number|null} severeImmediateOutwardDeviation - Immediate child-bond outward deviation.
 * @returns {boolean} True when the immediate outward bond should satisfy readability.
 */
function isExactChargedSulfoxideLinkerChild(layoutGraph, anchorAtomId, childAtomId, severeImmediateOutwardDeviation) {
  if (severeImmediateOutwardDeviation == null || severeImmediateOutwardDeviation > 1e-6) {
    return false;
  }

  const descriptor = describeChargedSulfoxideTrigonalCenter(layoutGraph, childAtomId);
  return descriptor?.ligandNeighborIds.includes(anchorAtomId) === true;
}

function ringSystemHasBridgedConnection(layoutGraph, ringSystemId) {
  if (ringSystemId == null) {
    return false;
  }
  const ringSystem = layoutGraph.ringSystemById.get(ringSystemId);
  if (!ringSystem || (ringSystem.ringIds?.length ?? 0) <= 1) {
    return false;
  }
  const ringIds = new Set(ringSystem.ringIds);
  return (layoutGraph.ringConnections ?? []).some(connection => connection.kind === 'bridged' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId));
}

function ringSystemHasCompactFusedCageConnection(layoutGraph, ringSystemId, anchorAtomId) {
  if (ringSystemId == null || (layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0) < 3) {
    return false;
  }
  const ringSystem = layoutGraph.ringSystemById.get(ringSystemId);
  const ringCount = ringSystem?.ringIds?.length ?? 0;
  const atomCount = ringSystem?.atomIds?.length ?? 0;
  if (!ringSystem || ringCount < 3 || atomCount > 18) {
    return false;
  }
  const ringIds = new Set(ringSystem.ringIds);
  const fusedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'fused' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)
  ).length;
  return fusedConnectionCount >= ringIds.size;
}

function hasClearExteriorRingSubstituentSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons, options = {}) {
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
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
  const blockerAtomIds =
    options.considerGlobalHeavyBlockers === true
      ? [...coords.keys()].filter(atomId => atomId !== anchorAtomId && atomId !== childAtomId && isVisibleHeavyLayoutAtom(layoutGraph, atomId))
      : (ringSystem?.atomIds?.filter(atomId => atomId !== anchorAtomId && atomId !== childAtomId && coords.has(atomId)) ?? []);
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
    if (supportsRingSubstituentOutwardReadability(layoutGraph, anchorAtomId) || options.considerOutwardReadability === true) {
      const outwardDeviation = bestRingOutwardDeviation(layoutGraph, coords, anchorAtomId, candidatePosition);
      const maxOutwardDeviation = options.maxOutwardDeviation ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation;
      if (outwardDeviation != null && outwardDeviation > maxOutwardDeviation) {
        continue;
      }
    }
    if (
      options.considerSegmentCrossing === true &&
      (options.considerGlobalSegmentCrossing === true
        ? ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, candidatePosition)
        : ringSubstituentSegmentCrossesRingSystemBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, candidatePosition, ringSystem))
    ) {
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

function ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, candidatePosition) {
  for (const bond of layoutGraph.bonds.values()) {
    if (
      bond.kind !== 'covalent' ||
      bond.a === anchorAtomId ||
      bond.b === anchorAtomId ||
      bond.a === childAtomId ||
      bond.b === childAtomId ||
      !coords.has(bond.a) ||
      !coords.has(bond.b) ||
      !isVisibleHeavyLayoutAtom(layoutGraph, bond.a) ||
      !isVisibleHeavyLayoutAtom(layoutGraph, bond.b)
    ) {
      continue;
    }
    if (segmentsProperlyIntersect(anchorPosition, candidatePosition, coords.get(bond.a), coords.get(bond.b))) {
      return true;
    }
  }
  return false;
}

function ringSubstituentSegmentCrossesRingSystemBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, candidatePosition, ringSystem) {
  const ringAtomIds = new Set(ringSystem?.atomIds ?? []);
  if (ringAtomIds.size === 0) {
    return false;
  }

  for (const bond of layoutGraph.bonds.values()) {
    if (
      bond.kind !== 'covalent' ||
      bond.a === anchorAtomId ||
      bond.b === anchorAtomId ||
      bond.a === childAtomId ||
      bond.b === childAtomId ||
      !ringAtomIds.has(bond.a) ||
      !ringAtomIds.has(bond.b) ||
      !coords.has(bond.a) ||
      !coords.has(bond.b)
    ) {
      continue;
    }
    if (segmentsProperlyIntersect(anchorPosition, candidatePosition, coords.get(bond.a), coords.get(bond.b))) {
      return true;
    }
  }
  return false;
}

function isUnavoidableBridgedRingSubstituentSlot(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds, ringPolygons) {
  if (!layoutGraph || representativeAtomIds.length !== 1 || representativeAtomIds[0] !== childAtomId) {
    return false;
  }
  if (!layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
    return false;
  }
  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const hasCompactFusedCageConnection = ringSystemHasCompactFusedCageConnection(layoutGraph, ringSystemId, anchorAtomId);
  if (!ringSystemHasBridgedConnection(layoutGraph, ringSystemId) && !hasCompactFusedCageConnection) {
    return false;
  }
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element === 'H' || childAtom.aromatic === true || layoutGraph.ringAtomIdSet.has(childAtomId)) {
    return false;
  }
  const smallAcyclicRoot = isSmallUnbranchedAcyclicRingSubstituentRoot(layoutGraph, coords, childAtomId, anchorAtomId);
  const isCarbonLeaf = childAtom.element === 'C';
  const isSmallAcyclicCarbonRoot = childAtom.element === 'C' && smallAcyclicRoot;
  const isTerminalHeteroLeaf = childAtom.element !== 'C' && childAtom.element !== 'H' && childAtom.heavyDegree <= 1;
  const isPositiveTerminalHetero = isTerminalHeteroLeaf && (childAtom.charge ?? 0) > 0;
  const isNeutralTerminalHetero = isTerminalHeteroLeaf && (childAtom.charge ?? 0) === 0;
  const isNeutralSmallAcyclicHeteroRoot = childAtom.element !== 'C' && childAtom.element !== 'H' && (childAtom.charge ?? 0) === 0 && smallAcyclicRoot;
  if (!isCarbonLeaf && !isSmallAcyclicCarbonRoot && !isPositiveTerminalHetero && !isNeutralTerminalHetero && !isNeutralSmallAcyclicHeteroRoot) {
    return false;
  }
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (isCarbonLeaf && !isSmallAcyclicCarbonRoot && anchorAtom && anchorAtom.element !== 'C' && (anchorAtom.charge ?? 0) > 0) {
    return false;
  }
  const shouldScanSmallAcyclicSubtree = (isSmallAcyclicCarbonRoot || isNeutralSmallAcyclicHeteroRoot) && (childAtom.heavyDegree ?? 0) > 1;
  const shouldConsiderOutwardReadability = isNeutralTerminalHetero || isNeutralSmallAcyclicHeteroRoot;
  const hasClearExteriorSlot = shouldScanSmallAcyclicSubtree
    ? hasClearExteriorSmallAcyclicRingSubstituentSubtreeSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons, {
        considerOutwardReadability: shouldConsiderOutwardReadability,
        maxOutwardDeviation: RING_SUBSTITUENT_READABILITY_LIMITS.maxSevereImmediateOutwardDeviation
      })
    : hasClearExteriorRingSubstituentSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons, {
        considerSegmentCrossing: isCarbonLeaf || isTerminalHeteroLeaf,
        considerOutwardReadability: shouldConsiderOutwardReadability,
        maxOutwardDeviation: RING_SUBSTITUENT_READABILITY_LIMITS.maxSevereImmediateOutwardDeviation,
        considerGlobalHeavyBlockers: hasCompactFusedCageConnection,
        considerGlobalSegmentCrossing: hasCompactFusedCageConnection || shouldConsiderOutwardReadability
      });
  if (shouldConsiderOutwardReadability && hasClearExteriorSlot) {
    const outwardDeviation = immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, childAtomId);
    if (outwardDeviation == null || outwardDeviation > RING_SUBSTITUENT_READABILITY_LIMITS.maxSevereImmediateOutwardDeviation) {
      return false;
    }
  }
  return !hasClearExteriorSlot;
}

function isSmallUnbranchedAcyclicRingSubstituentRoot(layoutGraph, coords, rootAtomId, blockedAtomId) {
  const subtree = collectSmallAcyclicRingSubstituentSubtree(layoutGraph, coords, rootAtomId, blockedAtomId, BRIDGED_RING_SUBSTITUENT_SMALL_CHAIN_MAX_HEAVY_ATOMS);
  if (!subtree || subtree.heavyAtomIds.length === 0) {
    return false;
  }
  const subtreeHeavyAtomIds = new Set(subtree.heavyAtomIds);
  for (const atomId of subtree.heavyAtomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom || atom.aromatic === true || isMetalAtom(atom) || layoutGraph.ringAtomIdSet.has(atomId)) {
      return false;
    }
    let subtreeHeavyNeighborCount = 0;
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (neighborAtomId === blockedAtomId) {
        continue;
      }
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      if (!neighborAtom || neighborAtom.element === 'H') {
        continue;
      }
      if (!subtreeHeavyAtomIds.has(neighborAtomId)) {
        return false;
      }
      subtreeHeavyNeighborCount++;
    }
    if (atomId === rootAtomId ? subtreeHeavyNeighborCount > 1 : subtreeHeavyNeighborCount > 2) {
      return false;
    }
  }
  return true;
}

function collectSmallAcyclicRingSubstituentSubtree(layoutGraph, coords, rootAtomId, blockedAtomId, maxHeavyAtoms = 2) {
  const visitedAtomIds = new Set([blockedAtomId]);
  const stack = [rootAtomId];
  const atomIds = [];
  const heavyAtomIds = [];
  while (stack.length > 0) {
    const atomId = stack.pop();
    if (visitedAtomIds.has(atomId)) {
      continue;
    }
    visitedAtomIds.add(atomId);
    if (!coords.has(atomId)) {
      continue;
    }
    const atom = layoutGraph.atoms.get(atomId);
    if (!atom) {
      return null;
    }
    if (atom.element !== 'H') {
      if (layoutGraph.ringAtomIdSet.has(atomId) || atom.aromatic === true) {
        return null;
      }
      heavyAtomIds.push(atomId);
      if (heavyAtomIds.length > maxHeavyAtoms) {
        return null;
      }
    }
    atomIds.push(atomId);
    for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
      if (!bond || bond.kind !== 'covalent') {
        continue;
      }
      const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
      if (!visitedAtomIds.has(neighborAtomId)) {
        stack.push(neighborAtomId);
      }
    }
  }
  return { atomIds, heavyAtomIds };
}

function translatedSubtreeCoords(coords, atomIds, delta) {
  const nextCoords = new Map(coords);
  for (const atomId of atomIds) {
    const position = coords.get(atomId);
    if (position) {
      nextCoords.set(atomId, { x: position.x + delta.x, y: position.y + delta.y });
    }
  }
  return nextCoords;
}

function hasClearExteriorSmallAcyclicRingSubstituentSubtreeSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons, options = {}) {
  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  if (!anchorPosition || !childPosition) {
    return true;
  }
  const subtree = collectSmallAcyclicRingSubstituentSubtree(layoutGraph, coords, childAtomId, anchorAtomId, BRIDGED_RING_SUBSTITUENT_SMALL_CHAIN_MAX_HEAVY_ATOMS);
  if (!subtree || subtree.heavyAtomIds.length === 0) {
    return true;
  }

  const bondLength = Math.hypot(childPosition.x - anchorPosition.x, childPosition.y - anchorPosition.y);
  if (!(bondLength > 0)) {
    return true;
  }
  const auditBondLength = layoutGraph.options?.bondLength ?? bondLength;
  const considerOutwardReadability = options.considerOutwardReadability === true;
  const maxOutwardDeviation = options.maxOutwardDeviation ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxSevereImmediateOutwardDeviation;

  for (let angle = 0; angle < 2 * Math.PI; angle += BRIDGED_RING_SUBSTITUENT_SLOT_SCAN_STEP) {
    const candidatePosition = {
      x: anchorPosition.x + Math.cos(angle) * bondLength,
      y: anchorPosition.y + Math.sin(angle) * bondLength
    };
    if (ringPolygons.some(polygon => pointInPolygon(candidatePosition, polygon))) {
      continue;
    }
    if (considerOutwardReadability) {
      const outwardDeviation = bestRingOutwardDeviation(layoutGraph, coords, anchorAtomId, candidatePosition);
      if (outwardDeviation != null && outwardDeviation > maxOutwardDeviation) {
        continue;
      }
    }
    if (ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, candidatePosition)) {
      continue;
    }

    const candidateCoords = translatedSubtreeCoords(coords, subtree.atomIds, {
      x: candidatePosition.x - childPosition.x,
      y: candidatePosition.y - childPosition.y
    });
    if (!hasSevereOverlaps(layoutGraph, candidateCoords, auditBondLength) && countVisibleHeavyBondCrossings(layoutGraph, candidateCoords) === 0) {
      return true;
    }
  }
  return false;
}

function hasClearExteriorRingSubstituentSubtreeSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons, maxOutwardDeviation) {
  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  if (!anchorPosition || !childPosition) {
    return true;
  }
  const subtree = collectSmallAcyclicRingSubstituentSubtree(layoutGraph, coords, childAtomId, anchorAtomId);
  if (!subtree || subtree.heavyAtomIds.length === 0) {
    return true;
  }

  const bondLength = Math.hypot(childPosition.x - anchorPosition.x, childPosition.y - anchorPosition.y);
  if (!(bondLength > 0)) {
    return true;
  }
  const auditBondLength = layoutGraph.options?.bondLength ?? bondLength;
  if (hasSevereOverlaps(layoutGraph, coords, auditBondLength) || countVisibleHeavyBondCrossings(layoutGraph, coords) > 0) {
    return true;
  }

  for (let angle = 0; angle < 2 * Math.PI; angle += BRIDGED_RING_SUBSTITUENT_SLOT_SCAN_STEP) {
    const candidatePosition = {
      x: anchorPosition.x + Math.cos(angle) * bondLength,
      y: anchorPosition.y + Math.sin(angle) * bondLength
    };
    if (ringPolygons.some(polygon => pointInPolygon(candidatePosition, polygon))) {
      continue;
    }
    const outwardDeviation = bestRingOutwardDeviation(layoutGraph, coords, anchorAtomId, candidatePosition);
    if (outwardDeviation != null && outwardDeviation > maxOutwardDeviation) {
      continue;
    }
    if (ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, candidatePosition)) {
      continue;
    }

    const candidateCoords = translatedSubtreeCoords(coords, subtree.atomIds, {
      x: candidatePosition.x - childPosition.x,
      y: candidatePosition.y - childPosition.y
    });
    if (!hasSevereOverlaps(layoutGraph, candidateCoords, auditBondLength) && countVisibleHeavyBondCrossings(layoutGraph, candidateCoords) === 0) {
      return true;
    }
  }
  return false;
}

function isBlockedNeutralHeteroArylOutwardAxis(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds, ringPolygons, maxOutwardDeviation) {
  if (!layoutGraph || representativeAtomIds.length !== 1 || representativeAtomIds[0] !== childAtomId) {
    return false;
  }
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    !anchorAtom ||
    !childAtom ||
    anchorAtom.aromatic !== true ||
    childAtom.aromatic === true ||
    layoutGraph.ringAtomIdSet.has(childAtomId) ||
    !['O', 'S', 'Se'].includes(childAtom.element) ||
    (childAtom.charge ?? 0) !== 0 ||
    (childAtom.heavyDegree ?? 0) > 2
  ) {
    return false;
  }
  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, childAtomId));
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
    return false;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  if (!anchorPosition || !childPosition || ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, childPosition)) {
    return false;
  }

  return !hasClearExteriorRingSubstituentSubtreeSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons, maxOutwardDeviation);
}

function isBlockedCompactBridgedNeutralHeteroOutwardAxis(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds, ringPolygons, immediateOutwardDeviation, maxOutwardDeviation) {
  if (!layoutGraph || representativeAtomIds.length !== 1 || representativeAtomIds[0] !== childAtomId || !layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
    return false;
  }

  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
  if (!ringSystem || (ringSystem.ringIds?.length ?? 0) !== 2 || (ringSystem.atomIds?.length ?? 0) > 12) {
    return false;
  }
  const ringIds = new Set(ringSystem.ringIds);
  const bridgedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'bridged' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)
  ).length;
  if (bridgedConnectionCount !== 1) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    !anchorAtom ||
    !childAtom ||
    anchorAtom.element !== 'C' ||
    anchorAtom.aromatic === true ||
    !['N', 'O', 'S', 'Se'].includes(childAtom.element) ||
    childAtom.aromatic === true ||
    layoutGraph.ringAtomIdSet.has(childAtomId) ||
    (childAtom.charge ?? 0) !== 0 ||
    (childAtom.heavyDegree ?? 0) > 2 ||
    immediateOutwardDeviation == null ||
    immediateOutwardDeviation > COMPACT_BRIDGED_NEUTRAL_HETERO_OUTWARD_MAX_DEVIATION + 1e-9
  ) {
    return false;
  }

  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, childAtomId));
  if (!bond || bond.kind !== 'covalent' || bond.inRing || bond.aromatic || (bond.order ?? 1) !== 1) {
    return false;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  if (!anchorPosition || !childPosition || ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, childPosition)) {
    return false;
  }

  const hasClearExteriorSlot =
    (childAtom.heavyDegree ?? 0) > 1
      ? hasClearExteriorSmallAcyclicRingSubstituentSubtreeSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons, {
          considerOutwardReadability: true,
          maxOutwardDeviation
        })
      : hasClearExteriorRingSubstituentSlot(layoutGraph, coords, anchorAtomId, childAtomId, ringPolygons, {
          considerSegmentCrossing: true,
          considerOutwardReadability: true,
          maxOutwardDeviation,
          considerGlobalHeavyBlockers: true,
          considerGlobalSegmentCrossing: true
        });
  return !hasClearExteriorSlot;
}

function isAcceptedExactOutwardComplexRingSubstituentInside(
  layoutGraph,
  coords,
  anchorAtomId,
  childAtomId,
  representativeAtomIds,
  maxOutwardDeviation = RING_SUBSTITUENT_READABILITY_LIMITS.maxOutwardDeviation
) {
  if (!layoutGraph || representativeAtomIds.length !== 1 || representativeAtomIds[0] !== childAtomId) {
    return false;
  }
  if (!layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
    return false;
  }
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element === 'H' || childAtom.aromatic === true || layoutGraph.ringAtomIdSet.has(childAtomId) || (childAtom.heavyDegree ?? 0) > 2) {
    return false;
  }

  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
  const ringSystemRingCount = ringSystem?.ringIds?.length ?? 0;
  const largestIncidentRingSize = Math.max(0, ...(layoutGraph.atomToRings.get(anchorAtomId) ?? []).map(ring => ring.atomIds?.length ?? 0));
  const complexRingContext =
    isMetalAtom(layoutGraph.atoms.get(anchorAtomId)) ||
    ringSystemHasBridgedConnection(layoutGraph, ringSystemId) ||
    (layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0) > 1 ||
    ringSystemRingCount > 2 ||
    largestIncidentRingSize >= 12;
  if (!complexRingContext) {
    return false;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  const isDivalentHeteroRoot = childAtom.element !== 'C' && childAtom.element !== 'H' && (childAtom.heavyDegree ?? 0) <= 2;
  if (
    isDivalentHeteroRoot &&
    anchorPosition &&
    childPosition &&
    ringSubstituentSegmentCrossesRingSystemBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, childPosition, ringSystem)
  ) {
    return false;
  }

  const immediateDeviation = immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, childAtomId);
  const acceptedDeviation = isDivalentHeteroRoot ? maxOutwardDeviation : COMPLEX_RING_EXACT_OUTWARD_INSIDE_TOLERANCE;
  return immediateDeviation != null && immediateDeviation <= acceptedDeviation + 1e-9;
}

function isAcceptedLargeMacrocycleSideChainInside(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds) {
  if (!layoutGraph || representativeAtomIds.length !== 1 || representativeAtomIds[0] !== childAtomId || !layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    !anchorAtom ||
    !childAtom ||
    anchorAtom.aromatic === true ||
    childAtom.aromatic === true ||
    childAtom.element === 'H' ||
    layoutGraph.ringAtomIdSet.has(childAtomId) ||
    isMetalAtom(anchorAtom) ||
    isMetalAtom(childAtom)
  ) {
    return false;
  }

  const anchorRingCount = layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0;
  if (anchorRingCount !== 1 && (childAtom.heavyDegree ?? 0) > 1) {
    return false;
  }

  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
  const incidentRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  const largestIncidentRingSize = Math.max(0, ...incidentRings.map(ring => ring.atomIds?.length ?? 0));
  const ringSystemRingCount = ringSystem?.ringIds?.length ?? 0;
  if (ringSystemRingCount < 1 || largestIncidentRingSize < LARGE_MACROCYCLE_SIDECHAIN_INSIDE_MIN_RING_SIZE) {
    return false;
  }
  const childHeavyDegree = childAtom.heavyDegree ?? 0;
  const canAcceptPendantArylMethyleneRoot = anchorRingCount === 1 && childAtom.element === 'C' && childHeavyDegree === 2;
  let downstreamRingNeighborCount = 0;

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
    const neighborRingSystemId = layoutGraph.atomToRingSystemId.get(neighborAtomId);
    if (neighborRingSystemId != null) {
      const downstreamRingSystem = layoutGraph.ringSystemById.get(neighborRingSystemId);
      const largestDownstreamRingSize = Math.max(0, ...(downstreamRingSystem?.ringIds ?? []).map(ringId => layoutGraph.ringById?.get(ringId)?.atomIds?.length ?? 0));
      downstreamRingNeighborCount++;
      if (
        !canAcceptPendantArylMethyleneRoot ||
        downstreamRingNeighborCount > 1 ||
        neighborRingSystemId === ringSystemId ||
        !neighborAtom ||
        neighborAtom.aromatic !== true ||
        bond.aromatic === true ||
        (bond.order ?? 1) !== 1 ||
        largestDownstreamRingSize > 7
      ) {
        return false;
      }
      continue;
    }

    if (ringSystemRingCount > 1 && childHeavyDegree > 1) {
      return false;
    }
  }

  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  return !!anchorPosition && !!childPosition && !ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, childPosition);
}

function isAcceptedFusedPolycyclicAngularTerminalLeafInside(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds) {
  if (!layoutGraph || representativeAtomIds.length !== 1 || representativeAtomIds[0] !== childAtomId || !layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    !anchorAtom ||
    !childAtom ||
    anchorAtom.element !== 'C' ||
    anchorAtom.aromatic === true ||
    childAtom.element !== 'C' ||
    childAtom.aromatic === true ||
    layoutGraph.ringAtomIdSet.has(childAtomId) ||
    (childAtom.heavyDegree ?? 0) > 1 ||
    (anchorAtom.heavyDegree ?? 0) < 4 ||
    supportsRingSubstituentOutwardReadability(layoutGraph, anchorAtomId)
  ) {
    return false;
  }

  const anchorRingCount = layoutGraph.ringCountByAtomId.get(anchorAtomId) ?? 0;
  const ringSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const ringSystem = ringSystemId != null ? layoutGraph.ringSystemById.get(ringSystemId) : null;
  const ringCount = ringSystem?.ringIds?.length ?? 0;
  const atomCount = ringSystem?.atomIds?.length ?? 0;
  const largestIncidentRingSize = Math.max(0, ...(layoutGraph.atomToRings.get(anchorAtomId) ?? []).map(ring => ring.atomIds?.length ?? 0));
  const ringIds = new Set(ringSystem?.ringIds ?? []);
  const fusedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'fused' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)
  ).length;
  const bridgedConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'bridged' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)
  ).length;
  const spiroConnectionCount = (layoutGraph.ringConnections ?? []).filter(
    connection => connection.kind === 'spiro' && ringIds.has(connection.firstRingId) && ringIds.has(connection.secondRingId)
  ).length;
  const layoutHeavyAtomCount = layoutGraph.traits?.heavyAtomCount ?? layoutGraph.atoms?.size ?? 0;
  const compactBridgedFusedAngularContext = ringCount <= 4 && atomCount <= 16 && fusedConnectionCount >= 1 && bridgedConnectionCount >= 1;
  const spiroFusedAngularContext = layoutHeavyAtomCount <= 80 && ringCount <= 6 && atomCount <= 24 && fusedConnectionCount >= Math.max(2, ringCount - 2) && spiroConnectionCount >= 1;
  const maxAcceptedIncidentRingSize = compactBridgedFusedAngularContext || spiroFusedAngularContext ? 8 : 7;
  if (
    anchorRingCount < 2 ||
    ringCount < 3 ||
    atomCount > 30 ||
    largestIncidentRingSize > maxAcceptedIncidentRingSize ||
    (fusedConnectionCount < ringCount - 1 && !compactBridgedFusedAngularContext && !spiroFusedAngularContext)
  ) {
    return false;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  return !!anchorPosition && !!childPosition && !ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, childPosition);
}

function isAcceptedNearOutwardCarbonylRingRoot(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds, outwardDeviation) {
  if (
    !layoutGraph ||
    representativeAtomIds.length !== 1 ||
    representativeAtomIds[0] !== childAtomId ||
    !Number.isFinite(outwardDeviation) ||
    outwardDeviation > NEAR_OUTWARD_CARBONYL_RING_ROOT_MAX_DEVIATION + 1e-9
  ) {
    return false;
  }

  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'C' || childAtom.aromatic === true || layoutGraph.ringAtomIdSet.has(childAtomId) || (childAtom.heavyDegree ?? 0) !== 3) {
    return false;
  }

  let heteroMultipleBondCount = 0;
  let nonAnchorHeavyNeighborCount = 0;
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
    if (neighborAtom.element === 'C' || layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      return false;
    }
    nonAnchorHeavyNeighborCount++;
    if ((bond.order ?? 1) >= 2) {
      heteroMultipleBondCount++;
    }
  }

  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  return (
    heteroMultipleBondCount === 1 &&
    nonAnchorHeavyNeighborCount >= 2 &&
    !!anchorPosition &&
    !!childPosition &&
    !ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, childPosition)
  );
}

function isAcceptedTetrahedralBranchLinkedRingCentroid(layoutGraph, anchorAtomId, childAtomId, representativeAtomIds, outwardDeviation) {
  if (!layoutGraph || representativeAtomIds.length <= 1 || !Number.isFinite(outwardDeviation)) {
    return false;
  }

  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    !childAtom ||
    !TETRAHEDRAL_BRANCH_LINKED_RING_ROOT_ELEMENTS.has(childAtom.element) ||
    childAtom.aromatic === true ||
    layoutGraph.ringAtomIdSet.has(childAtomId) ||
    isMetalAtom(childAtom) ||
    (childAtom.heavyDegree ?? 0) < 4
  ) {
    return false;
  }

  const maxOutwardDeviation = isArylPhosphoniumBranchLinkedRingRoot(layoutGraph, anchorAtomId, childAtomId)
    ? ARYL_PHOSPHONIUM_BRANCH_LINKED_RING_CENTROID_MAX_DEVIATION
    : TETRAHEDRAL_BRANCH_LINKED_RING_CENTROID_MAX_DEVIATION;
  if (outwardDeviation > maxOutwardDeviation + 1e-9) {
    return false;
  }

  let nonAnchorHeavyNeighborCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === childAtomId ? bond.b : bond.a;
    if (neighborAtomId === anchorAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || neighborAtom.element === 'H') {
      continue;
    }
    nonAnchorHeavyNeighborCount++;
  }

  return nonAnchorHeavyNeighborCount >= 2;
}

/**
 * Returns whether a tetrahedral branch root is a charged aryl-rich
 * phosphonium center. Its publication-style four-way cross can put one aryl
 * centroid slightly beyond the generic tetrahedral linked-ring outward limit
 * while still preserving the local ring exit and avoiding crossings.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} anchorAtomId - Ring atom attached to the phosphonium center.
 * @param {string} childAtomId - Candidate phosphonium atom id.
 * @returns {boolean} True when the relaxed linked-ring centroid limit applies.
 */
function isArylPhosphoniumBranchLinkedRingRoot(layoutGraph, anchorAtomId, childAtomId) {
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (!childAtom || childAtom.element !== 'P' || (childAtom.charge ?? 0) <= 0) {
    return false;
  }

  let arylLigandCount = 0;
  for (const bond of layoutGraph.bondsByAtomId.get(childAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === childAtomId ? bond.b : bond.a;
    if (neighborAtomId === anchorAtomId) {
      continue;
    }
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (neighborAtom?.element === 'C' && neighborAtom.aromatic === true && layoutGraph.ringAtomIdSet.has(neighborAtomId)) {
      arylLigandCount++;
    }
  }
  return arylLigandCount >= 2;
}

function isAcceptedExactOutwardDirectLinkedRingRoot(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds, immediateOutwardDeviation) {
  if (
    !layoutGraph ||
    representativeAtomIds.length <= 1 ||
    !Number.isFinite(immediateOutwardDeviation) ||
    immediateOutwardDeviation > 1e-6 ||
    !layoutGraph.ringAtomIdSet.has(anchorAtomId) ||
    !layoutGraph.ringAtomIdSet.has(childAtomId)
  ) {
    return false;
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const childRingSystemId = layoutGraph.atomToRingSystemId.get(childAtomId);
  if (anchorRingSystemId == null || childRingSystemId == null || anchorRingSystemId === childRingSystemId) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  const bond = layoutGraph.bondByAtomPair.get(atomPairKey(anchorAtomId, childAtomId));
  if (!anchorAtom || !childAtom || anchorAtom.aromatic !== true || childAtom.aromatic !== true || !bond || bond.kind !== 'covalent' || bond.inRing || (bond.order ?? 1) !== 1) {
    return false;
  }

  const anchorPosition = coords.get(anchorAtomId);
  const childPosition = coords.get(childAtomId);
  return !!anchorPosition && !!childPosition && !ringSubstituentSegmentCrossesVisibleHeavyBond(layoutGraph, coords, anchorAtomId, childAtomId, anchorPosition, childPosition);
}

function isAcceptedImmediateOutwardLinkedRingInside(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds, ringPolygons, maxOutwardDeviation) {
  if (!layoutGraph || representativeAtomIds.length <= 1 || !layoutGraph.ringAtomIdSet.has(anchorAtomId) || !layoutGraph.ringAtomIdSet.has(childAtomId)) {
    return false;
  }

  const anchorRingSystemId = layoutGraph.atomToRingSystemId.get(anchorAtomId);
  const childRingSystemId = layoutGraph.atomToRingSystemId.get(childAtomId);
  if (anchorRingSystemId == null || childRingSystemId == null || anchorRingSystemId === childRingSystemId) {
    return false;
  }

  const largestAnchorRingSize = Math.max(0, ...(layoutGraph.atomToRings.get(anchorAtomId) ?? []).map(ring => ring.atomIds?.length ?? 0));
  const largestChildRingSize = Math.max(0, ...(layoutGraph.atomToRings.get(childAtomId) ?? []).map(ring => ring.atomIds?.length ?? 0));
  if (Math.min(largestAnchorRingSize, largestChildRingSize) > 4) {
    return false;
  }

  const immediateSide = evaluateRingSubstituentSide(layoutGraph, coords, anchorAtomId, [childAtomId], ringPolygons, maxOutwardDeviation);
  const anchorRingSystem = layoutGraph.ringSystemById.get(anchorRingSystemId);
  const acceptsSmallRingInside =
    immediateSide.insideIncidentRing && largestChildRingSize > 0 && largestChildRingSize <= 4 && ((anchorRingSystem?.ringIds?.length ?? 0) > 1 || largestAnchorRingSize >= 7);
  if ((!acceptsSmallRingInside && immediateSide.insideIncidentRing) || immediateSide.outwardAxisFailure) {
    return false;
  }

  const immediateDeviation = immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, childAtomId);
  return immediateDeviation != null && immediateDeviation <= maxOutwardDeviation + 1e-9;
}

function ringHasMetalAtom(layoutGraph, ring) {
  return (ring?.atomIds ?? []).some(atomId => isMetalAtom(layoutGraph.sourceMolecule?.atoms?.get(atomId) ?? layoutGraph.atoms.get(atomId)));
}

function representativeIsInsideOnlyCoordinateMetalRings(layoutGraph, coords, anchorAtomId, representativeAtomIds) {
  const representativePosition = ringSubstituentRepresentativePosition(coords, representativeAtomIds);
  if (!representativePosition) {
    return false;
  }

  let insideMetalRing = false;
  for (const ring of layoutGraph.atomToRings.get(anchorAtomId) ?? []) {
    const polygon = [];
    for (const atomId of ring.atomIds ?? []) {
      const position = coords.get(atomId);
      if (position) {
        polygon.push(position);
      }
    }
    if (polygon.length < 3 || !pointInPolygon(representativePosition, polygon)) {
      continue;
    }
    if (!ringHasMetalAtom(layoutGraph, ring)) {
      return false;
    }
    insideMetalRing = true;
  }
  return insideMetalRing;
}

function isAcceptedCoordinateMetalPseudoRingSubstituentInside(layoutGraph, coords, anchorAtomId, childAtomId, representativeAtomIds, maxOutwardDeviation) {
  if (!layoutGraph || representativeAtomIds.length !== 1 || representativeAtomIds[0] !== childAtomId || !layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
    return false;
  }

  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  const childAtom = layoutGraph.atoms.get(childAtomId);
  if (
    !anchorAtom ||
    !childAtom ||
    isMetalAtom(anchorAtom) ||
    isMetalAtom(childAtom) ||
    childAtom.element === 'H' ||
    childAtom.aromatic === true ||
    layoutGraph.ringAtomIdSet.has(childAtomId) ||
    (childAtom.heavyDegree ?? 0) > 1
  ) {
    return false;
  }

  const incidentRings = layoutGraph.atomToRings.get(anchorAtomId) ?? [];
  if (!incidentRings.some(ring => ringHasMetalAtom(layoutGraph, ring)) || !representativeIsInsideOnlyCoordinateMetalRings(layoutGraph, coords, anchorAtomId, representativeAtomIds)) {
    return false;
  }

  if (!coords.has(anchorAtomId) || !coords.has(childAtomId)) {
    return false;
  }

  const immediateDeviation = immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, childAtomId);
  return immediateDeviation != null && immediateDeviation <= maxOutwardDeviation + 1e-9;
}

function isTerminalRingSubstituentLeaf(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  return !!atom && atom.element !== 'H' && atom.aromatic !== true && !layoutGraph.ringAtomIdSet.has(atomId) && (atom.heavyDegree ?? 0) <= 1;
}

function isGeminalTerminalRingSubstituentSlotAccepted(layoutGraph, coords, anchorAtomId, childAtomId, substituentChildren, ringPolygons, maxOutwardDeviation) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (
    !anchorAtom ||
    anchorAtom.aromatic === true ||
    (anchorAtom.heavyDegree ?? 0) < 4 ||
    (anchorAtom.degree ?? anchorAtom.heavyDegree ?? 0) < 4 ||
    !isTerminalRingSubstituentLeaf(layoutGraph, childAtomId)
  ) {
    return false;
  }

  const childDeviation = immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, childAtomId);
  if (childDeviation == null || childDeviation > GEMINAL_TERMINAL_RING_SUBSTITUENT_SLOT_MAX_DEVIATION) {
    return false;
  }

  for (const siblingDescriptor of substituentChildren) {
    const siblingAtomId = siblingDescriptor.childAtomId;
    if (siblingAtomId === childAtomId || siblingDescriptor.representativeAtomIds.length !== 1 || siblingDescriptor.representativeAtomIds[0] !== siblingAtomId) {
      continue;
    }
    if (!isTerminalRingSubstituentLeaf(layoutGraph, siblingAtomId)) {
      continue;
    }
    const siblingSide = evaluateRingSubstituentSide(layoutGraph, coords, anchorAtomId, siblingDescriptor.representativeAtomIds, ringPolygons, maxOutwardDeviation);
    if (siblingSide.insideIncidentRing) {
      continue;
    }
    const siblingDeviation = immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, siblingAtomId);
    if (siblingDeviation != null && siblingDeviation <= GEMINAL_TERMINAL_RING_SUBSTITUENT_OUTWARD_SIBLING_MAX_DEVIATION) {
      return true;
    }
  }

  return false;
}

/**
 * Collects exocyclic ring substituent children that should participate in
 * ring-substituent readability checks. This includes ordinary non-ring heavy
 * substituents and single-bond attached ring systems.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} anchorAtomId - Candidate ring anchor atom id.
 * @returns {Array<{childAtomId: string, representativeAtomIds: string[]}>} Readability candidates.
 */
export function collectReadableRingSubstituentChildren(layoutGraph, coords, anchorAtomId) {
  const anchorAtom = layoutGraph.sourceMolecule.atoms.get(anchorAtomId);
  if (!anchorAtom || !layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
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

    if (!layoutGraph.ringAtomIdSet.has(neighborAtom.id)) {
      if (isMetalAtom(neighborAtom)) {
        // Metal branches read by the immediate coordination bond, not a downstream ligand centroid.
        candidates.push({
          childAtomId: neighborAtom.id,
          representativeAtomIds: [neighborAtom.id]
        });
        continue;
      }
      const linkedRingRepresentative = resolveLinkedSubstituentRingRepresentative(layoutGraph, coords, anchorAtomId, neighborAtom.id);
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
    const representativeAtomIds = ringSystemAtomIds(layoutGraph, childRingSystemId).filter(atomId => coords.has(atomId));
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

  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let firstPosition = null;
  for (const atomId of representativeAtomIds) {
    const position = overridePositions?.get(atomId) ?? coords.get(atomId);
    if (!position) {
      continue;
    }
    if (!firstPosition) {
      firstPosition = position;
    }
    sumX += position.x;
    sumY += position.y;
    count++;
  }
  if (count === 0) {
    return null;
  }
  return count === 1 ? firstPosition : { x: sumX / count, y: sumY / count };
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
  const maxSevereImmediateOutwardDeviation = options.maxSevereImmediateOutwardDeviation ?? RING_SUBSTITUENT_READABILITY_LIMITS.maxSevereImmediateOutwardDeviation;
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  let failingSubstituentCount = 0;
  let inwardSubstituentCount = 0;
  let outwardAxisFailureCount = 0;
  let totalOutwardDeviation = 0;
  let maxObservedOutwardDeviation = 0;
  const seenPairs = new Set();

  const anchorAtomIds = focusAtomIds ?? coords.keys();
  for (const anchorAtomId of anchorAtomIds) {
    if (!coords.has(anchorAtomId)) {
      continue;
    }
    if (!layoutGraph.ringAtomIdSet.has(anchorAtomId) || !isVisibleLayoutAtom(layoutGraph, anchorAtomId)) {
      continue;
    }

    const substituentChildren = collectReadableRingSubstituentChildren(layoutGraph, coords, anchorAtomId);
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
      const requiresSevereImmediateOutwardCheck = childDescriptor.representativeAtomIds.length > 1 || (childAtom != null && childAtom.element !== 'C' && childAtom.element !== 'H');
      const severeImmediateOutwardDeviation = requiresSevereImmediateOutwardCheck ? immediateRingSubstituentOutwardDeviation(layoutGraph, coords, anchorAtomId, childAtomId) : null;
      const severeImmediateOutwardFailure = severeImmediateOutwardDeviation != null && severeImmediateOutwardDeviation > maxSevereImmediateOutwardDeviation;
      const linkedRepresentativeOutwardFailureRelaxed =
        childDescriptor.representativeAtomIds.length > 1 &&
        severeImmediateOutwardDeviation != null &&
        severeImmediateOutwardDeviation <= 1e-6 &&
        Number.isFinite(forwardSide.outwardDeviation) &&
        forwardSide.outwardDeviation <= maxOutwardDeviation + LINKED_RING_REPRESENTATIVE_OUTWARD_READABILITY_SLACK;
      const tetrahedralBranchLinkedCentroidAccepted =
        childDescriptor.representativeAtomIds.length > 1 &&
        severeImmediateOutwardDeviation != null &&
        severeImmediateOutwardDeviation <= 1e-6 &&
        isAcceptedTetrahedralBranchLinkedRingCentroid(layoutGraph, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds, forwardSide.outwardDeviation);
      const exactOutwardDirectLinkedRingRootAccepted =
        childDescriptor.representativeAtomIds.length > 1 &&
        severeImmediateOutwardDeviation != null &&
        isAcceptedExactOutwardDirectLinkedRingRoot(layoutGraph, coords, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds, severeImmediateOutwardDeviation);
      const nearOutwardCarbonylRingRootAccepted =
        forwardSide.outwardAxisFailure && isAcceptedNearOutwardCarbonylRingRoot(layoutGraph, coords, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds, forwardSide.outwardDeviation);
      const pathLikeRingChainLinkerChild = isPathLikeRingChainLinkerChild(layoutGraph, anchorAtomId, childAtomId);
      const exactChargedSulfoxideLinkerChild = isExactChargedSulfoxideLinkerChild(layoutGraph, anchorAtomId, childAtomId, severeImmediateOutwardDeviation);
      const geminalTerminalSlotAccepted =
        !forwardSide.insideIncidentRing && isGeminalTerminalRingSubstituentSlotAccepted(layoutGraph, coords, anchorAtomId, childAtomId, substituentChildren, ringPolygons, maxOutwardDeviation);
      const blockedNeutralHeteroArylOutwardAxis =
        forwardSide.outwardAxisFailure &&
        isBlockedNeutralHeteroArylOutwardAxis(layoutGraph, coords, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds, ringPolygons, maxSevereImmediateOutwardDeviation);
      const blockedCompactBridgedNeutralHeteroOutwardAxis = isBlockedCompactBridgedNeutralHeteroOutwardAxis(
        layoutGraph,
        coords,
        anchorAtomId,
        childAtomId,
        childDescriptor.representativeAtomIds,
        ringPolygons,
        severeImmediateOutwardDeviation,
        maxSevereImmediateOutwardDeviation
      );
      const forwardOutwardAxisFailure =
        forwardSide.outwardAxisFailure &&
        !linkedRepresentativeOutwardFailureRelaxed &&
        !tetrahedralBranchLinkedCentroidAccepted &&
        !exactOutwardDirectLinkedRingRootAccepted &&
        !nearOutwardCarbonylRingRootAccepted &&
        !pathLikeRingChainLinkerChild &&
        !exactChargedSulfoxideLinkerChild &&
        !geminalTerminalSlotAccepted &&
        !blockedNeutralHeteroArylOutwardAxis &&
        !blockedCompactBridgedNeutralHeteroOutwardAxis;
      const inwardSlotIsUnavoidable =
        forwardSide.insideIncidentRing && isUnavoidableBridgedRingSubstituentSlot(layoutGraph, coords, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds, ringPolygons);
      const exactOutwardComplexInsideAccepted =
        forwardSide.insideIncidentRing &&
        isAcceptedExactOutwardComplexRingSubstituentInside(layoutGraph, coords, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds, maxOutwardDeviation);
      const largeMacrocycleSideChainInsideAccepted =
        forwardSide.insideIncidentRing && isAcceptedLargeMacrocycleSideChainInside(layoutGraph, coords, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds);
      const fusedPolycyclicAngularTerminalLeafInsideAccepted =
        forwardSide.insideIncidentRing && isAcceptedFusedPolycyclicAngularTerminalLeafInside(layoutGraph, coords, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds);
      const immediateOutwardLinkedRingInsideAccepted =
        forwardSide.insideIncidentRing &&
        isAcceptedImmediateOutwardLinkedRingInside(layoutGraph, coords, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds, ringPolygons, maxOutwardDeviation);
      const coordinateMetalPseudoRingInsideAccepted =
        forwardSide.insideIncidentRing &&
        isAcceptedCoordinateMetalPseudoRingSubstituentInside(layoutGraph, coords, anchorAtomId, childAtomId, childDescriptor.representativeAtomIds, maxOutwardDeviation);
      const forwardInsideAccepted =
        inwardSlotIsUnavoidable ||
        exactOutwardComplexInsideAccepted ||
        largeMacrocycleSideChainInsideAccepted ||
        fusedPolycyclicAngularTerminalLeafInsideAccepted ||
        immediateOutwardLinkedRingInsideAccepted ||
        coordinateMetalPseudoRingInsideAccepted;
      if (forwardSide.insideIncidentRing && !forwardInsideAccepted) {
        failingSubstituentCount++;
        inwardSubstituentCount++;
      } else if (
        forwardOutwardAxisFailure ||
        (severeImmediateOutwardFailure &&
          !forwardInsideAccepted &&
          !pathLikeRingChainLinkerChild &&
          !exactChargedSulfoxideLinkerChild &&
          !geminalTerminalSlotAccepted &&
          !blockedNeutralHeteroArylOutwardAxis &&
          !blockedCompactBridgedNeutralHeteroOutwardAxis)
      ) {
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
      const reverseRepresentativeAtomIds = ringSystemAtomIds(layoutGraph, anchorRingSystemId).filter(atomId => coords.has(atomId));
      if (reverseRepresentativeAtomIds.length === 0) {
        continue;
      }
      const reverseRingPolygons = incidentRingPolygons(layoutGraph, coords, childAtomId);
      const reverseSide = evaluateRingSubstituentSide(layoutGraph, coords, childAtomId, reverseRepresentativeAtomIds, reverseRingPolygons, maxOutwardDeviation);
      const reverseImmediateOutwardLinkedRingInsideAccepted =
        reverseSide.insideIncidentRing &&
        isAcceptedImmediateOutwardLinkedRingInside(layoutGraph, coords, childAtomId, anchorAtomId, reverseRepresentativeAtomIds, reverseRingPolygons, maxOutwardDeviation);
      if (reverseSide.insideIncidentRing && !reverseImmediateOutwardLinkedRingInsideAccepted) {
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
 * Counts severe nonbonded overlaps with a set of overridden atom positions, avoiding
 * a full O(V^2) or O(V log V) search when only a small subtree moves.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Base coordinate map.
 * @param {Map<string, {x: number, y: number}>} overridePositions - Moved atom positions.
 * @param {number} bondLength - Target layout bond length.
 * @param {{atomGrid?: AtomGrid|null}} [options] - Optional spatial grid built from the base coordinates.
 * @returns {{count: number, minDistance: number}} Severe-overlap count and closest moved distance.
 */
export function countSevereOverlapsWithOverrides(layoutGraph, coords, overridePositions, bondLength, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const thresholdSquared = threshold * threshold;
  let count = 0;
  let minDistanceSquared = Infinity;
  const overrideAtomIds = new Set(overridePositions.keys());
  const allAtomIds = options.atomGrid ? null : visibleHeavyAtomIdsInCoords(layoutGraph, coords);
  let mergedCoords = null;
  const coordsWithOverrides = () => {
    if (!mergedCoords) {
      mergedCoords = new Map(coords);
      for (const [atomId, position] of overridePositions) {
        mergedCoords.set(atomId, position);
      }
    }
    return mergedCoords;
  };
  const scorePair = (atomId, position, otherAtomId, otherPositionOverride = null) => {
    if (atomId === otherAtomId || !isVisibleHeavyLayoutAtom(layoutGraph, otherAtomId) || areLayoutAtomsBonded(layoutGraph, atomId, otherAtomId)) {
      return;
    }
    const otherPosition = otherPositionOverride ?? coords.get(otherAtomId);
    if (!otherPosition) {
      return;
    }
    const dx = otherPosition.x - position.x;
    const dy = otherPosition.y - position.y;
    const separationSquared = dx * dx + dy * dy;
    if (separationSquared < minDistanceSquared) {
      minDistanceSquared = separationSquared;
    }
    if (separationSquared < thresholdSquared) {
      const separation = Math.sqrt(separationSquared);
      if (!isAcceptedCompressedTerminalCarbonylLeafOverlap(layoutGraph, coordsWithOverrides(), atomId, otherAtomId, separation, bondLength)) {
        count++;
      }
    }
  };

  for (const [atomId, position] of overridePositions) {
    if (!isVisibleHeavyLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    if (options.atomGrid) {
      options.atomGrid.forEachRadius(position, threshold, otherAtomId => {
        if (!overrideAtomIds.has(otherAtomId)) {
          scorePair(atomId, position, otherAtomId);
        }
      });
    } else {
      for (const otherAtomId of allAtomIds) {
        if (overrideAtomIds.has(otherAtomId)) {
          continue;
        }
        scorePair(atomId, position, otherAtomId);
      }
    }
  }

  const overrideEntries = [...overridePositions];
  for (let firstIndex = 0; firstIndex < overrideEntries.length; firstIndex++) {
    const [firstAtomId, firstPosition] = overrideEntries[firstIndex];
    if (!isVisibleHeavyLayoutAtom(layoutGraph, firstAtomId)) {
      continue;
    }
    for (let secondIndex = firstIndex + 1; secondIndex < overrideEntries.length; secondIndex++) {
      const [secondAtomId, secondPosition] = overrideEntries[secondIndex];
      if (!isVisibleHeavyLayoutAtom(layoutGraph, secondAtomId)) {
        continue;
      }
      scorePair(firstAtomId, firstPosition, secondAtomId, secondPosition);
    }
  }

  return {
    count,
    minDistance: Number.isFinite(minDistanceSquared) ? Math.sqrt(minDistanceSquared) : Infinity
  };
}

function severeOverlapVisibleHeavyAtomIds(layoutGraph, coords, options) {
  return options.visibleHeavyAtomIds
    ? Array.isArray(options.visibleHeavyAtomIds)
      ? options.visibleHeavyAtomIds
      : [...options.visibleHeavyAtomIds]
    : visibleHeavyAtomIdsInCoords(layoutGraph, coords, options.visibleAtomIds ?? null);
}

function isSevereOverlapPair(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength, threshold) {
  return (
    distance < threshold &&
    layoutGraph.atoms.get(firstAtomId)?.element !== 'H' &&
    layoutGraph.atoms.get(secondAtomId)?.element !== 'H' &&
    !isAcceptedCompressedTerminalCarbonylLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) &&
    !isAcceptedCompactBridgedTerminalCarbonLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) &&
    !isAcceptedCompactBridgedTerminalHeteroLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) &&
    !isAcceptedCompactBridgedSmallAcyclicHeteroLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) &&
    !isAcceptedCompactFusedSmallAcyclicCarbonRootOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength) &&
    !isAcceptedSeparateSmallRingTerminalAminoLeafOverlap(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength)
  );
}

/**
 * Counts severe nonbonded overlaps in the current coordinate set without
 * materializing overlap pair records.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Overlap-query options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid.
 * @param {Iterable<string>} [options.visibleHeavyAtomIds] - Optional precomputed visible heavy atom ids.
 * @returns {number} Severe overlap count.
 */
export function countSevereOverlaps(layoutGraph, coords, bondLength, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const visibleHeavyAtomIds = severeOverlapVisibleHeavyAtomIds(layoutGraph, coords, options);
  const ownsAtomGrid = !options.atomGrid;
  const atomGrid =
    options.atomGrid ??
    buildAtomGrid(layoutGraph, coords, bondLength, {
      visibleAtomIds: visibleHeavyAtomIds
    });
  return countNonbondedPairs(
    layoutGraph,
    coords,
    (firstAtomId, secondAtomId, distance) => isSevereOverlapPair(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength, threshold),
    atomGrid,
    threshold,
    {
      visibleAtomIds: visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid === true || ownsAtomGrid
    }
  );
}

/**
 * Counts severe overlaps satisfying an additional pair predicate without
 * materializing overlap records.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {(firstAtomId: string, secondAtomId: string, distance: number) => boolean} matchPair - Additional pair predicate.
 * @param {object} [options] - Overlap-query options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid.
 * @param {Iterable<string>} [options.visibleHeavyAtomIds] - Optional precomputed visible heavy atom ids.
 * @returns {number} Matching severe overlap count.
 */
export function countSevereOverlapsMatching(layoutGraph, coords, bondLength, matchPair, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const visibleHeavyAtomIds = severeOverlapVisibleHeavyAtomIds(layoutGraph, coords, options);
  const ownsAtomGrid = !options.atomGrid;
  const atomGrid =
    options.atomGrid ??
    buildAtomGrid(layoutGraph, coords, bondLength, {
      visibleAtomIds: visibleHeavyAtomIds
    });
  return countNonbondedPairs(
    layoutGraph,
    coords,
    (firstAtomId, secondAtomId, distance) => isSevereOverlapPair(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength, threshold) && matchPair(firstAtomId, secondAtomId, distance),
    atomGrid,
    threshold,
    {
      visibleAtomIds: visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid === true || ownsAtomGrid
    }
  );
}

/**
 * Collects atom ids participating in severe overlaps without allocating
 * overlap-pair records.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Overlap-query options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid.
 * @param {Iterable<string>} [options.visibleHeavyAtomIds] - Optional precomputed visible heavy atom ids.
 * @returns {Set<string>} Atom ids participating in severe overlaps.
 */
export function collectSevereOverlapAtomIds(layoutGraph, coords, bondLength, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const visibleHeavyAtomIds = severeOverlapVisibleHeavyAtomIds(layoutGraph, coords, options);
  const ownsAtomGrid = !options.atomGrid;
  const atomGrid =
    options.atomGrid ??
    buildAtomGrid(layoutGraph, coords, bondLength, {
      visibleAtomIds: visibleHeavyAtomIds
    });
  const atomIds = new Set();
  visitNonbondedPairs(
    layoutGraph,
    coords,
    (firstAtomId, secondAtomId, distance) => {
      if (isSevereOverlapPair(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength, threshold)) {
        atomIds.add(firstAtomId);
        atomIds.add(secondAtomId);
      }
      return false;
    },
    atomGrid,
    threshold,
    {
      visibleAtomIds: visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid === true || ownsAtomGrid
    }
  );
  return atomIds;
}

/**
 * Checks whether a severe overlap satisfies an additional pair predicate.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {(firstAtomId: string, secondAtomId: string, distance: number) => boolean} matchPair - Additional pair predicate.
 * @param {object} [options] - Overlap-query options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid.
 * @param {Iterable<string>} [options.visibleHeavyAtomIds] - Optional precomputed visible heavy atom ids.
 * @returns {boolean} True when a matching severe overlap exists.
 */
export function hasSevereOverlapMatching(layoutGraph, coords, bondLength, matchPair, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const visibleHeavyAtomIds = severeOverlapVisibleHeavyAtomIds(layoutGraph, coords, options);
  const ownsAtomGrid = !options.atomGrid;
  const atomGrid =
    options.atomGrid ??
    buildAtomGrid(layoutGraph, coords, bondLength, {
      visibleAtomIds: visibleHeavyAtomIds
    });
  return someNonbondedPair(
    layoutGraph,
    coords,
    (firstAtomId, secondAtomId, distance) => isSevereOverlapPair(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength, threshold) && matchPair(firstAtomId, secondAtomId, distance),
    atomGrid,
    threshold,
    {
      visibleAtomIds: visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid === true || ownsAtomGrid
    }
  );
}

/**
 * Finds severe overlaps satisfying an additional pair predicate.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {(firstAtomId: string, secondAtomId: string, distance: number) => boolean} matchPair - Additional pair predicate.
 * @param {object} [options] - Overlap-query options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid.
 * @param {Iterable<string>} [options.visibleHeavyAtomIds] - Optional precomputed visible heavy atom ids.
 * @returns {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} Matching severe overlaps.
 */
export function findSevereOverlapsMatching(layoutGraph, coords, bondLength, matchPair, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const visibleHeavyAtomIds = severeOverlapVisibleHeavyAtomIds(layoutGraph, coords, options);
  const ownsAtomGrid = !options.atomGrid;
  const atomGrid =
    options.atomGrid ??
    buildAtomGrid(layoutGraph, coords, bondLength, {
      visibleAtomIds: visibleHeavyAtomIds
    });
  return collectNonbondedPairs(
    layoutGraph,
    coords,
    (firstAtomId, secondAtomId, distance) => isSevereOverlapPair(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength, threshold) && matchPair(firstAtomId, secondAtomId, distance),
    atomGrid,
    threshold,
    {
      visibleAtomIds: visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid === true || ownsAtomGrid
    }
  );
}

/**
 * Checks whether the current coordinate set has any severe nonbonded overlap.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Overlap-query options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid.
 * @param {Iterable<string>} [options.visibleHeavyAtomIds] - Optional precomputed visible heavy atom ids.
 * @returns {boolean} True when at least one severe overlap exists.
 */
export function hasSevereOverlaps(layoutGraph, coords, bondLength, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const visibleHeavyAtomIds = severeOverlapVisibleHeavyAtomIds(layoutGraph, coords, options);
  const ownsAtomGrid = !options.atomGrid;
  const atomGrid =
    options.atomGrid ??
    buildAtomGrid(layoutGraph, coords, bondLength, {
      visibleAtomIds: visibleHeavyAtomIds
    });
  return someNonbondedPair(
    layoutGraph,
    coords,
    (firstAtomId, secondAtomId, distance) => isSevereOverlapPair(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength, threshold),
    atomGrid,
    threshold,
    {
      visibleAtomIds: visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid === true || ownsAtomGrid
    }
  );
}

/**
 * Finds severe nonbonded overlaps in the current coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {object} [options] - Overlap-query options.
 * @param {AtomGrid|null} [options.atomGrid] - Optional reused spatial grid.
 * @param {Iterable<string>} [options.visibleHeavyAtomIds] - Optional precomputed visible heavy atom ids.
 * @returns {Array<{firstAtomId: string, secondAtomId: string, distance: number}>} Severe overlaps.
 */
export function findSevereOverlaps(layoutGraph, coords, bondLength, options = {}) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  const visibleHeavyAtomIds = severeOverlapVisibleHeavyAtomIds(layoutGraph, coords, options);
  const ownsAtomGrid = !options.atomGrid;
  const atomGrid =
    options.atomGrid ??
    buildAtomGrid(layoutGraph, coords, bondLength, {
      visibleAtomIds: visibleHeavyAtomIds
    });
  return collectNonbondedPairs(
    layoutGraph,
    coords,
    (firstAtomId, secondAtomId, distance) => isSevereOverlapPair(layoutGraph, coords, firstAtomId, secondAtomId, distance, bondLength, threshold),
    atomGrid,
    threshold,
    {
      visibleAtomIds: visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid === true || ownsAtomGrid
    }
  );
}

/**
 * Measures bond-length deviation from the target depiction bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {number} bondLength - Target bond length.
 * @param {{bondValidationClasses?: Map<string, 'planar'|'bridged'|'haptic'>}} [options] - Bond-validation options.
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

  for (const bond of visibleHeavyAuditBonds(layoutGraph)) {
    const firstPosition = coords.get(bond.a);
    const secondPosition = coords.get(bond.b);
    if (!firstPosition || !secondPosition) {
      continue;
    }
    const distance = Math.hypot(secondPosition.x - firstPosition.x, secondPosition.y - firstPosition.y);
    const deviation = isAcceptedBondLengthDeviation(layoutGraph, coords, bond, distance, bondLength) ? 0 : Math.abs(distance - bondLength);
    const validationSettings = validationSettingsForClass(bondValidationClasses.get(bond.id));
    const allowedDeviation = bondLength * Math.max(Math.abs(1 - validationSettings.minBondLengthFactor), Math.abs(validationSettings.maxBondLengthFactor - 1));
    sampleCount++;
    totalDeviation += deviation;
    maxDeviation = Math.max(maxDeviation, deviation);
    if (deviation > allowedDeviation + BOND_LENGTH_DEVIATION_EPSILON) {
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
  return covalentBonds.some(({ bond, neighborAtomId }) => !bond.aromatic && (bond.order ?? 1) === 1 && isExactVisibleTrigonalBisectorEligible(layoutGraph, atomId, neighborAtomId));
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
  if (!atom || atom.aromatic || (layoutGraph.atomToRings?.get(atomId)?.length ?? 0) > 0) {
    return false;
  }
  const isExactDivalentElement =
    IDEAL_DIVALENT_CONTINUATION_ELEMENTS.has(atom.element) ||
    (atom.element === 'N' && isPlanarDivalentNitrogenContinuationPair(layoutGraph, covalentBonds[0]?.neighborAtomId, covalentBonds[1]?.neighborAtomId));
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

  const atomIds = focusAtomIds ?? coords.keys();
  for (const atomId of atomIds) {
    if (!coords.has(atomId) || !isVisibleLayoutAtom(layoutGraph, atomId)) {
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
 * Measures distortion at visible divalent centers that should keep a simple
 * 120-degree zigzag continuation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{focusAtomIds?: Set<string>|null}} [options] - Optional local scoring focus.
 * @returns {{centerCount: number, totalDeviation: number, maxDeviation: number}} Continuation distortion statistics.
 */
export function measureDivalentContinuationDistortion(layoutGraph, coords, options = {}) {
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  let centerCount = 0;
  let totalDeviation = 0;
  let maxDeviation = 0;
  const idealSeparation = (2 * Math.PI) / 3;

  const atomIds = focusAtomIds ?? coords.keys();
  for (const atomId of atomIds) {
    if (!coords.has(atomId) || !isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    const covalentBonds = visibleCovalentBonds(layoutGraph, coords, atomId);
    if (!shouldMeasureDivalentContinuationDistortionAtCenter(layoutGraph, atomId, covalentBonds)) {
      continue;
    }
    const atomPosition = coords.get(atomId);
    const firstNeighborPosition = coords.get(covalentBonds[0].neighborAtomId);
    const secondNeighborPosition = coords.get(covalentBonds[1].neighborAtomId);
    if (!atomPosition || !firstNeighborPosition || !secondNeighborPosition) {
      continue;
    }
    const bondAngle = angularDifference(angleOf(sub(firstNeighborPosition, atomPosition)), angleOf(sub(secondNeighborPosition, atomPosition)));
    const deviation = (bondAngle - idealSeparation) ** 2;
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

  const atomIds = focusAtomIds ?? coords.keys();
  for (const atomId of atomIds) {
    if (!coords.has(atomId) || !isVisibleLayoutAtom(layoutGraph, atomId)) {
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
    if (!isVisibleLayoutAtom(layoutGraph, anchorAtomId) || !layoutGraph.ringAtomIdSet.has(anchorAtomId)) {
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
  const thresholdSquared = threshold * threshold;
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
  const atomGridHasVisibleAtoms = atomGrid.visibleAtomIdsOnly === true;

  if (includeAtomOverlaps) {
    const hasExternalCandidates = atomGrid.someBoundingBox(
      minX - threshold,
      minY - threshold,
      maxX + threshold,
      maxY + threshold,
      candidateId => !subtreeSet.has(candidateId) && (atomGridHasVisibleAtoms || isVisibleLayoutAtom(layoutGraph, candidateId))
    );

    if (hasExternalCandidates) {
      for (const subtreeAtomId of subtreeContext.visibleSubtreeAtomIds) {
        const pos = overridePositions?.get(subtreeAtomId) ?? coords.get(subtreeAtomId);
        if (!pos) {
          continue;
        }
        atomGrid.forEachRadius(pos, threshold, atomId => {
          if (subtreeSet.has(atomId) || (!atomGridHasVisibleAtoms && !isVisibleLayoutAtom(layoutGraph, atomId))) {
            return;
          }
          if (areLayoutAtomsBonded(layoutGraph, subtreeAtomId, atomId)) {
            return;
          }
          const otherPos = coords.get(atomId);
          if (!otherPos) {
            return;
          }
          const dx = otherPos.x - pos.x;
          const dy = otherPos.y - pos.y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < thresholdSquared) {
            const distance = Math.hypot(dx, dy);
            const deficit = threshold - distance;
            cost += deficit * deficit * 100;
          }
        });
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
  return summarizeLabelOverlaps(labelBoxes, options.padding ?? bondLength * 0.08);
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

    if (covalentBonds.length === 3 && shouldMeasureTrigonalDistortionAtCenter(layoutGraph, atomId, covalentBonds)) {
      const deviation = measureThreeCoordinateDeviation(coords, covalentBonds, atomId, () => undefined);
      trigCenterCount++;
      trigTotalDeviation += deviation;
      trigMaxDeviation = Math.max(trigMaxDeviation, deviation);
    }

    if (covalentBonds.length !== 4) {
      continue;
    }
    const heavyBonds = [];
    let allHeavySingleNonAromatic = true;
    for (const record of covalentBonds) {
      const neighborAtom = layoutGraph.atoms.get(record.neighborAtomId);
      if (neighborAtom?.element === 'H') {
        allHeavySingleNonAromatic = false;
        break;
      }
      if (record.bond.aromatic || (record.bond.order ?? 1) !== 1) {
        allHeavySingleNonAromatic = false;
        break;
      }
      heavyBonds.push(record);
    }
    if (allHeavySingleNonAromatic && heavyBonds.length === 4) {
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
 * @returns {{overlaps: object[], bondDeviation: {max: number, mean: number, failureCount: number, mildFailureCount: number, severeFailureCount: number, sampleCount: number}, visibleHeavyBondCrossingCount: number, collapsedMacrocycles: number[], labelOverlap: {count: number}, trigonalDistortion: {centerCount: number, totalDeviation: number, maxDeviation: number}, tetrahedralDistortion: {centerCount: number, totalDeviation: number, maxDeviation: number}, cost: number}} Aggregated layout state metrics.
 */
export function measureLayoutState(layoutGraph, coords, bondLength, options = {}) {
  const overlaps =
    options.overlaps ??
    findSevereOverlaps(layoutGraph, coords, bondLength, {
      atomGrid: options.atomGrid,
      visibleHeavyAtomIds: options.visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid
    });
  const bondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
  const visibleHeavyBondCrossingCount = countVisibleHeavyBondCrossings(layoutGraph, coords);
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
    visibleHeavyBondCrossingCount,
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
 * @param {Map<string, 'planar'|'bridged'|'haptic'>} [options.bondValidationClasses] - Optional bond-validation classes.
 * @returns {{overlaps: Array<{firstAtomId: string, secondAtomId: string, distance: number}>, overlapCount: number, overlapPenalty: number, bondDeviation: {sampleCount: number, maxDeviation: number, meanDeviation: number, failingBondCount: number}, cost: number}} Reduced overlap-focused layout state.
 */
export function measureOverlapState(layoutGraph, coords, bondLength, options = {}) {
  const overlaps =
    options.overlaps ??
    findSevereOverlaps(layoutGraph, coords, bondLength, {
      atomGrid: options.atomGrid,
      visibleHeavyAtomIds: options.visibleHeavyAtomIds,
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid
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
