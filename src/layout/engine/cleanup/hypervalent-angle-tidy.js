/** @module cleanup/hypervalent-angle-tidy */

import { auditLayout } from '../audit/audit.js';
import { add, angleOf, angularDifference, distance, fromAngle, sub, wrapAngleUnsigned } from '../geometry/vec2.js';
import { computeIncidentRingOutwardAngles } from '../geometry/ring-direction.js';
import { ringEmbeddedBisOxoSpread } from '../geometry/ring-hypervalent.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { countSevereOverlapsWithOverrides, findSevereOverlaps, measureBondLengthDeviation } from '../audit/invariants.js';
import { collectCutSubtree } from './subtree-utils.js';
import { runLocalCleanup } from './local-rotation.js';
import { resolveOverlaps } from './overlap-resolution.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { atomPairKey, SEVERE_OVERLAP_FACTOR } from '../constants.js';

const ORTHOGONAL_HYPERVALENT_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);
const ORTHOGONAL_ORGANOSILICON_ELEMENTS = new Set(['Si']);
const ORTHOGONAL_ORGANOSILICON_MIN_ARYL_LIGANDS = 2;
const ANGLE_THRESHOLD = Math.PI / 18;
const FIXED_LIGAND_WEIGHT = 12;
const BRIDGE_LINKED_HYPERVALENT_LIGAND_ELEMENTS = new Set(['N', 'O', 'S', 'Se']);
const MAX_BRIDGE_LINKED_HYPERVALENT_SUBTREE_HEAVY_ATOMS = 8;
const MAX_COMPACT_HYPERVALENT_LIGAND_SUBTREE_HEAVY_ATOMS = 14;
const MAX_COMPACT_HYPERVALENT_LIGAND_SUBTREE_ATOMS = 24;
const MAX_COMPACT_HYPERVALENT_LIGAND_RING_SYSTEMS = 2;
const MAX_RING_LINKED_BISOXO_CROSS_LIGAND_HEAVY_ATOMS = 6;
const MAX_RING_LINKED_BISOXO_CROSS_LIGAND_RING_SYSTEMS = 1;
const MAX_RING_ANCHORED_HYPERVALENT_SUBTREE_HEAVY_ATOMS = 14;
const MAX_RING_ANCHORED_HYPERVALENT_SUBTREE_ATOMS = 28;
const ACYCLIC_HYPERVALENT_BRANCH_ANCHOR_ELEMENTS = new Set(['C', 'O', 'S', 'Se']);
const TERMINAL_HYPERVALENT_H_ANGLE_THRESHOLD = Math.PI / 180;
const TERMINAL_HYPERVALENT_MULTIPLE_LIGAND_ANGLE_THRESHOLD = Math.PI / 180;
const RING_ANCHORED_HYPERVALENT_ANGLE_THRESHOLD = Math.PI / 180;
const ACYCLIC_ANCHORED_HYPERVALENT_OVERLAP_RELIEF_ANGLE_THRESHOLD = Math.PI / 180;
const TERMINAL_MULTIPLE_LIGAND_COMPRESSION_FACTORS = [1, 0.99, 0.98, 0.97, 0.96, 0.95];
const TERMINAL_MULTIPLE_LEAF_HYPERVALENT_CLEARANCE_FACTOR = SEVERE_OVERLAP_FACTOR + 0.02;
const TERMINAL_MULTIPLE_LEAF_HYPERVALENT_RELIEF_STEP = Math.PI / 180;
const TERMINAL_MULTIPLE_LEAF_HYPERVALENT_RELIEF_MAX_ROTATION = Math.PI / 9;
const TERMINAL_MULTIPLE_LEAF_RIGID_RELIEF_MAX_ATOMS = 12;
const TERMINAL_MULTIPLE_LEAF_RIGID_RELIEF_MAX_HEAVY_ATOMS = 6;
const DIRECT_TERMINAL_MULTIPLE_LIGAND_RELIEF_STEP = Math.PI / 360;
const DIRECT_TERMINAL_MULTIPLE_LIGAND_RELIEF_MAX_ROTATION = Math.PI / 12;
const DIRECT_TERMINAL_MULTIPLE_LIGAND_RELIEF_MAX_HYPERVALENT_DEVIATION = (Math.PI / 12) ** 2;
const DIRECT_LIGAND_TERMINAL_LEAF_RELIEF_ANGLE_CANDIDATES = [
  -Math.PI / 12,
  Math.PI / 12,
  -Math.PI / 6,
  Math.PI / 6,
  -Math.PI / 4,
  Math.PI / 4,
  -Math.PI / 3,
  Math.PI / 3,
  -Math.PI / 2,
  Math.PI / 2,
  -2 * Math.PI / 3,
  2 * Math.PI / 3,
  -3 * Math.PI / 4,
  3 * Math.PI / 4,
  -5 * Math.PI / 6,
  5 * Math.PI / 6,
  Math.PI
];
const DIRECT_LIGAND_BRANCH_RELIEF_ANGLE_CANDIDATES = [
  -Math.PI / 6,
  Math.PI / 6,
  -Math.PI / 4,
  Math.PI / 4,
  -Math.PI / 3,
  Math.PI / 3,
  -Math.PI / 2,
  Math.PI / 2,
  -2 * Math.PI / 3,
  2 * Math.PI / 3,
  Math.PI
];
const DIRECT_LIGAND_BRANCH_RELIEF_MAX_ATOMS = 16;
const DIRECT_LIGAND_BRANCH_RELIEF_MAX_HEAVY_ATOMS = 8;
const DIRECT_LIGAND_OVERLAP_RELIEF_MAX_HYPERVALENT_DEVIATION = (Math.PI / 36) ** 2;
const RING_EMBEDDED_BIS_OXO_MIN_SPREAD = Math.PI / 3;
const RING_EMBEDDED_BIS_OXO_SPREAD_STEP = Math.PI / 18;
const RING_EMBEDDED_BIS_OXO_CENTER_SHIFT_STEP = Math.PI / 180;
const RING_EMBEDDED_BIS_OXO_MAX_CENTER_SHIFT = Math.PI / 3;
const RING_ANCHORED_HYPERVALENT_OVERLAP_RELIEF_STEP = Math.PI / 180;
const RING_ANCHORED_HYPERVALENT_OVERLAP_RELIEF_MAX_ROTATION = Math.PI / 18;
const HYPERVALENT_DIRECT_LIGAND_LOCAL_RELIEF_MAX_PASSES = 2;

/**
 * Returns whether an atom participates in visible overlap checks for the
 * current layout options.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} atomId - Candidate atom id.
 * @returns {boolean} True when the atom should be considered visible.
 */
function isVisibleLayoutAtom(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom) {
    return false;
  }
  return !(layoutGraph.options?.suppressH === true && atom.element === 'H');
}

/**
 * Returns whether placing one atom at a candidate position would create a
 * severe visible non-bonded overlap.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} atomId - Moved atom id.
 * @param {{x: number, y: number}} candidatePosition - Candidate position.
 * @param {number} bondLength - Target layout bond length.
 * @returns {boolean} True when the candidate position is severely crowded.
 */
function hasSevereOverlapAtPosition(layoutGraph, coords, atomId, candidatePosition, bondLength) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  for (const [otherAtomId, otherPosition] of coords) {
    if (
      otherAtomId === atomId
      || !isVisibleLayoutAtom(layoutGraph, otherAtomId)
      || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))
    ) {
      continue;
    }
    if (distance(candidatePosition, otherPosition) < threshold - 1e-9) {
      return true;
    }
  }
  return false;
}

/**
 * Returns whether a sparse rigid move avoids making severe local overlaps
 * worse than the current positions of the same moved atoms.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Current coordinate map.
 * @param {Map<string, {x: number, y: number}>} candidatePositions - Proposed moved atom positions.
 * @param {number} bondLength - Target layout bond length.
 * @returns {boolean} True when the proposed positions do not worsen severe overlap.
 */
function preservesSevereOverlapState(layoutGraph, coords, candidatePositions, bondLength) {
  const currentPositions = new Map();
  for (const atomId of candidatePositions.keys()) {
    const position = coords.get(atomId);
    if (position) {
      currentPositions.set(atomId, position);
    }
  }

  const currentOverlapState = countSevereOverlapsWithOverrides(layoutGraph, coords, currentPositions, bondLength);
  const candidateOverlapState = countSevereOverlapsWithOverrides(layoutGraph, coords, candidatePositions, bondLength);
  if (candidateOverlapState.count > currentOverlapState.count) {
    return false;
  }
  return !(
    candidateOverlapState.count > 0
    && candidateOverlapState.count === currentOverlapState.count
    && candidateOverlapState.minDistance < currentOverlapState.minDistance - 1e-9
  );
}


/**
 * Returns compact exterior-V spreads to try for a crowded ring-embedded sulfone.
 * @param {number} defaultSpread - Normal ring-derived oxo spread.
 * @returns {number[]} Candidate spreads from widest to most compact.
 */
function ringEmbeddedBisOxoSpreadCandidates(defaultSpread) {
  const spreads = [];
  for (
    let spread = defaultSpread;
    spread >= RING_EMBEDDED_BIS_OXO_MIN_SPREAD - 1e-9;
    spread -= RING_EMBEDDED_BIS_OXO_SPREAD_STEP
  ) {
    spreads.push(Math.max(spread, RING_EMBEDDED_BIS_OXO_MIN_SPREAD));
  }
  if (spreads.length === 0 || Math.abs(spreads[spreads.length - 1] - RING_EMBEDDED_BIS_OXO_MIN_SPREAD) > 1e-9) {
    spreads.push(RING_EMBEDDED_BIS_OXO_MIN_SPREAD);
  }
  return [...new Set(spreads.map(spread => Number(spread.toFixed(12))))];
}

/**
 * Returns candidate offsets for sliding a ring-embedded bis-oxo exterior V
 * around the outward direction when the centered V is locally blocked.
 * @returns {number[]} Center-angle offsets in radians.
 */
function ringEmbeddedBisOxoCenterOffsetCandidates() {
  const offsets = [0];
  for (
    let offset = RING_EMBEDDED_BIS_OXO_CENTER_SHIFT_STEP;
    offset <= RING_EMBEDDED_BIS_OXO_MAX_CENTER_SHIFT + 1e-9;
    offset += RING_EMBEDDED_BIS_OXO_CENTER_SHIFT_STEP
  ) {
    offsets.push(offset, -offset);
  }
  return offsets;
}

/**
 * Chooses the longest terminal multiple-bond ligand position that preserves
 * the exact hypervalent angle while clearing severe local overlap. This is
 * reserved for terminal oxo-like leaves, where a very small display bond
 * compression is preferable to bending the sulfur/phosphorus cross; if the
 * allowed compression does not clear the overlap, the full bond length is kept.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {string} ligandAtomId - Terminal multiple-bond ligand atom id.
 * @param {number} targetAngle - Exact target angle in radians.
 * @param {number} radius - Current center-to-ligand distance.
 * @returns {{x: number, y: number}} Best ligand position.
 */
function compressedTerminalMultipleLigandPosition(layoutGraph, coords, centerAtomId, ligandAtomId, targetAngle, radius) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || !isTerminalMultipleHypervalentLigand(layoutGraph, centerAtomId, ligandAtomId)) {
    return centerPosition ? add(centerPosition, fromAngle(targetAngle, radius)) : { x: 0, y: 0 };
  }

  const bondLength = layoutGraph.options?.bondLength ?? radius;
  const fullLengthPosition = add(centerPosition, fromAngle(targetAngle, radius));
  for (const compressionFactor of TERMINAL_MULTIPLE_LIGAND_COMPRESSION_FACTORS) {
    const candidatePosition = add(centerPosition, fromAngle(targetAngle, radius * compressionFactor));
    if (!hasSevereOverlapAtPosition(layoutGraph, coords, ligandAtomId, candidatePosition, bondLength)) {
      return candidatePosition;
    }
  }
  return fullLengthPosition;
}

/**
 * Returns the parent atom for a terminal multiple-bond hetero leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} leafAtomId - Candidate terminal hetero atom id.
 * @param {string} excludedParentAtomId - Parent atom id that should not be considered.
 * @returns {string|null} Parent atom id, or `null` when the atom is not a movable leaf.
 */
function terminalMultipleLeafParentAtomId(layoutGraph, leafAtomId, excludedParentAtomId) {
  const leafAtom = layoutGraph.atoms.get(leafAtomId);
  if (!leafAtom || leafAtom.element === 'H' || leafAtom.element === 'C' || leafAtom.heavyDegree !== 1) {
    return null;
  }

  for (const bond of layoutGraph.bondsByAtomId.get(leafAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) < 2) {
      continue;
    }
    const parentAtomId = bond.a === leafAtomId ? bond.b : bond.a;
    if (parentAtomId !== excludedParentAtomId && layoutGraph.atoms.get(parentAtomId)?.element !== 'H') {
      return parentAtomId;
    }
  }
  return null;
}

/**
 * Returns whether a terminal leaf position is too close to one of the direct
 * ligands around a hypervalent center.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {string} leafAtomId - Candidate terminal leaf atom id.
 * @param {{x: number, y: number}} leafPosition - Candidate terminal leaf position.
 * @param {number} clearanceDistance - Required ligand-to-leaf clearance.
 * @returns {boolean} True when the leaf still conflicts with a hypervalent ligand.
 */
function hasDirectHypervalentLigandClearanceConflict(layoutGraph, coords, centerAtomId, leafAtomId, leafPosition, clearanceDistance) {
  for (const ligandAtomId of directLigandAtomIds(layoutGraph, centerAtomId, coords)) {
    if (
      ligandAtomId === leafAtomId
      || !isVisibleLayoutAtom(layoutGraph, ligandAtomId)
      || layoutGraph.bondedPairSet.has(atomPairKey(ligandAtomId, leafAtomId))
    ) {
      continue;
    }
    const ligandPosition = coords.get(ligandAtomId);
    if (ligandPosition && distance(ligandPosition, leafPosition) < clearanceDistance - 1e-9) {
      return true;
    }
  }
  return false;
}

/**
 * Chooses the smallest rotation of a terminal multiple-bond leaf that clears a
 * nearby exact hypervalent cross without changing any bond length.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {string} leafAtomId - Terminal multiple-bond leaf atom id.
 * @param {string} parentAtomId - Leaf parent atom id.
 * @param {number} clearanceDistance - Required ligand-to-leaf clearance.
 * @returns {{x: number, y: number}|null} Accepted leaf position, or `null` when no bounded relief is safe.
 */
function terminalMultipleLeafHypervalentReliefPosition(layoutGraph, coords, centerAtomId, leafAtomId, parentAtomId, clearanceDistance) {
  const parentPosition = coords.get(parentAtomId);
  const leafPosition = coords.get(leafAtomId);
  if (!parentPosition || !leafPosition) {
    return null;
  }

  const currentPositions = new Map([[leafAtomId, leafPosition]]);
  const currentOverlapState = countSevereOverlapsWithOverrides(
    layoutGraph,
    coords,
    currentPositions,
    layoutGraph.options?.bondLength ?? distance(parentPosition, leafPosition)
  );
  const radius = distance(parentPosition, leafPosition);
  const currentAngle = angleOf(sub(leafPosition, parentPosition));
  const maxStepCount = Math.ceil(
    TERMINAL_MULTIPLE_LEAF_HYPERVALENT_RELIEF_MAX_ROTATION / TERMINAL_MULTIPLE_LEAF_HYPERVALENT_RELIEF_STEP
  );

  let bestFit = null;
  for (let stepIndex = 1; stepIndex <= maxStepCount; stepIndex++) {
    for (const direction of [-1, 1]) {
      const rotation = direction * stepIndex * TERMINAL_MULTIPLE_LEAF_HYPERVALENT_RELIEF_STEP;
      const candidatePosition = add(parentPosition, fromAngle(currentAngle + rotation, radius));
      if (
        hasDirectHypervalentLigandClearanceConflict(
          layoutGraph,
          coords,
          centerAtomId,
          leafAtomId,
          candidatePosition,
          clearanceDistance
        )
      ) {
        continue;
      }
      const candidatePositions = new Map([[leafAtomId, candidatePosition]]);
      const overlapState = countSevereOverlapsWithOverrides(
        layoutGraph,
        coords,
        candidatePositions,
        layoutGraph.options?.bondLength ?? radius
      );
      if (overlapState.count > currentOverlapState.count) {
        continue;
      }
      const candidateFit = { position: candidatePosition, overlapState, rotation };
      if (
        !bestFit
        || overlapState.count < bestFit.overlapState.count
        || (
          overlapState.count === bestFit.overlapState.count
          && Math.abs(rotation) < Math.abs(bestFit.rotation)
        )
        || (
          overlapState.count === bestFit.overlapState.count
          && Math.abs(rotation) === Math.abs(bestFit.rotation)
          && overlapState.minDistance > bestFit.overlapState.minDistance
        )
      ) {
        bestFit = candidateFit;
      }
    }
  }

  if (!bestFit || bestFit.overlapState.count > currentOverlapState.count) {
    return null;
  }
  return bestFit.position;
}

function terminalMultipleLeafRigidReliefPivotIds(layoutGraph, centerAtomId, leafAtomId, parentAtomId, coords) {
  const pivotIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent') {
      continue;
    }
    const pivotAtomId = bond.a === parentAtomId ? bond.b : bond.a;
    const pivotAtom = layoutGraph.atoms.get(pivotAtomId);
    if (
      pivotAtomId === centerAtomId
      || pivotAtomId === leafAtomId
      || !pivotAtom
      || pivotAtom.element === 'H'
      || !coords.has(pivotAtomId)
    ) {
      continue;
    }
    pivotIds.push(pivotAtomId);
  }
  return pivotIds.sort((firstAtomId, secondAtomId) => {
    const firstAtom = layoutGraph.atoms.get(firstAtomId);
    const secondAtom = layoutGraph.atoms.get(secondAtomId);
    const firstRingCount = layoutGraph.atomToRings.get(firstAtomId)?.length ?? 0;
    const secondRingCount = layoutGraph.atomToRings.get(secondAtomId)?.length ?? 0;
    if (firstRingCount !== secondRingCount) {
      return secondRingCount - firstRingCount;
    }
    if ((firstAtom?.heavyDegree ?? 0) !== (secondAtom?.heavyDegree ?? 0)) {
      return (secondAtom?.heavyDegree ?? 0) - (firstAtom?.heavyDegree ?? 0);
    }
    return compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank);
  });
}

function collectTerminalMultipleLeafRigidReliefSubtree(layoutGraph, centerAtomId, leafAtomId, parentAtomId, pivotAtomId, coords) {
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, parentAtomId, pivotAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId));
  if (
    subtreeAtomIds.length === 0
    || subtreeAtomIds.length > TERMINAL_MULTIPLE_LEAF_RIGID_RELIEF_MAX_ATOMS
    || !subtreeAtomIds.includes(parentAtomId)
    || !subtreeAtomIds.includes(leafAtomId)
    || subtreeAtomIds.includes(centerAtomId)
    || subtreeAtomIds.includes(pivotAtomId)
  ) {
    return null;
  }

  let heavyAtomCount = 0;
  for (const subtreeAtomId of subtreeAtomIds) {
    const subtreeAtom = layoutGraph.atoms.get(subtreeAtomId);
    if (!subtreeAtom) {
      return null;
    }
    if (subtreeAtom.element !== 'H') {
      heavyAtomCount++;
      if (heavyAtomCount > TERMINAL_MULTIPLE_LEAF_RIGID_RELIEF_MAX_HEAVY_ATOMS) {
        return null;
      }
    }
  }
  return subtreeAtomIds;
}

function rotatedSubtreePositions(coords, subtreeAtomIds, pivotAtomId, rotation) {
  const pivotPosition = coords.get(pivotAtomId);
  if (!pivotPosition) {
    return null;
  }
  const candidatePositions = new Map();
  for (const subtreeAtomId of subtreeAtomIds) {
    const currentPosition = coords.get(subtreeAtomId);
    if (!currentPosition) {
      return null;
    }
    const offset = sub(currentPosition, pivotPosition);
    candidatePositions.set(
      subtreeAtomId,
      add(pivotPosition, fromAngle(angleOf(offset) + rotation, distance(pivotPosition, currentPosition)))
    );
  }
  return candidatePositions;
}

/**
 * Chooses a small rigid rotation of the parent-side terminal group that clears
 * a hypervalent ligand clash while preserving the terminal leaf's local fan.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {string} leafAtomId - Terminal multiple-bond leaf atom id.
 * @param {string} parentAtomId - Leaf parent atom id.
 * @param {number} clearanceDistance - Required ligand-to-leaf clearance.
 * @returns {Map<string, {x: number, y: number}>|null} Accepted subtree positions, or `null`.
 */
function terminalMultipleLeafRigidReliefPositions(layoutGraph, coords, centerAtomId, leafAtomId, parentAtomId, clearanceDistance) {
  if (parentAtomId === centerAtomId) {
    return null;
  }

  const bondLength = layoutGraph.options?.bondLength ?? distance(coords.get(parentAtomId), coords.get(leafAtomId));
  const maxStepCount = Math.ceil(
    TERMINAL_MULTIPLE_LEAF_HYPERVALENT_RELIEF_MAX_ROTATION / TERMINAL_MULTIPLE_LEAF_HYPERVALENT_RELIEF_STEP
  );
  let bestFit = null;

  for (const pivotAtomId of terminalMultipleLeafRigidReliefPivotIds(layoutGraph, centerAtomId, leafAtomId, parentAtomId, coords)) {
    const subtreeAtomIds = collectTerminalMultipleLeafRigidReliefSubtree(
      layoutGraph,
      centerAtomId,
      leafAtomId,
      parentAtomId,
      pivotAtomId,
      coords
    );
    if (!subtreeAtomIds) {
      continue;
    }
    const currentPositions = new Map(subtreeAtomIds.map(subtreeAtomId => [subtreeAtomId, coords.get(subtreeAtomId)]));
    const currentOverlapState = countSevereOverlapsWithOverrides(layoutGraph, coords, currentPositions, bondLength);

    for (let stepIndex = 1; stepIndex <= maxStepCount; stepIndex++) {
      for (const direction of [-1, 1]) {
        const rotation = direction * stepIndex * TERMINAL_MULTIPLE_LEAF_HYPERVALENT_RELIEF_STEP;
        const candidatePositions = rotatedSubtreePositions(coords, subtreeAtomIds, pivotAtomId, rotation);
        const leafPosition = candidatePositions?.get(leafAtomId);
        if (
          !candidatePositions
          || !leafPosition
          || hasDirectHypervalentLigandClearanceConflict(
            layoutGraph,
            coords,
            centerAtomId,
            leafAtomId,
            leafPosition,
            clearanceDistance
          )
        ) {
          continue;
        }
        const overlapState = countSevereOverlapsWithOverrides(layoutGraph, coords, candidatePositions, bondLength);
        if (overlapState.count > currentOverlapState.count) {
          continue;
        }
        const candidateFit = {
          positions: candidatePositions,
          overlapState,
          rotation,
          pivotAtomId
        };
        if (
          !bestFit
          || overlapState.count < bestFit.overlapState.count
          || (
            overlapState.count === bestFit.overlapState.count
            && Math.abs(rotation) < Math.abs(bestFit.rotation)
          )
          || (
            overlapState.count === bestFit.overlapState.count
            && Math.abs(rotation) === Math.abs(bestFit.rotation)
            && compareCanonicalAtomIds(pivotAtomId, bestFit.pivotAtomId, layoutGraph.canonicalAtomRank) < 0
          )
        ) {
          bestFit = candidateFit;
        }
      }
    }
  }

  return bestFit?.positions ?? null;
}

/**
 * Rotates nearby terminal multiple-bond leaves away from a freshly squared
 * hypervalent center when the exact S/P cross would otherwise be rejected for
 * a tiny local clash with a carbonyl-like leaf.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @returns {number} Number of accepted terminal-leaf rotations.
 */
function relieveTerminalMultipleLeafOverlapsNearHypervalentCenter(layoutGraph, coords, centerAtomId) {
  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const clearanceDistance = bondLength * TERMINAL_MULTIPLE_LEAF_HYPERVALENT_CLEARANCE_FACTOR;
  let nudges = 0;

  for (const leafAtomId of coords.keys()) {
    const parentAtomId = terminalMultipleLeafParentAtomId(layoutGraph, leafAtomId, centerAtomId);
    if (!parentAtomId || !coords.has(parentAtomId)) {
      continue;
    }
    const leafPosition = coords.get(leafAtomId);
    if (
      !leafPosition
      || !hasDirectHypervalentLigandClearanceConflict(
        layoutGraph,
        coords,
        centerAtomId,
        leafAtomId,
        leafPosition,
        clearanceDistance
      )
    ) {
      continue;
    }
    const rigidCandidatePositions = terminalMultipleLeafRigidReliefPositions(
      layoutGraph,
      coords,
      centerAtomId,
      leafAtomId,
      parentAtomId,
      clearanceDistance
    );
    if (rigidCandidatePositions) {
      for (const [subtreeAtomId, candidatePosition] of rigidCandidatePositions) {
        coords.set(subtreeAtomId, candidatePosition);
      }
      nudges++;
      continue;
    }
    const candidatePosition = terminalMultipleLeafHypervalentReliefPosition(
      layoutGraph,
      coords,
      centerAtomId,
      leafAtomId,
      parentAtomId,
      clearanceDistance
    );
    if (!candidatePosition) {
      continue;
    }
    coords.set(leafAtomId, candidatePosition);
    nudges++;
  }

  return nudges;
}

function directLigandAtomIds(layoutGraph, centerAtomId, coords) {
  const ligandAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
    const ligandAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const ligandAtom = layoutGraph.atoms.get(ligandAtomId);
    if (!ligandAtom || !coords.has(ligandAtomId)) {
      continue;
    }
    ligandAtomIds.push(ligandAtomId);
  }
  return ligandAtomIds.sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
}

function isTerminalMultipleBondHetero(layoutGraph, centerAtomId, bond) {
  if (!layoutGraph || !bond || bond.kind !== 'covalent' || bond.aromatic) {
    return false;
  }
  if ((bond.order ?? 1) < 2) {
    return false;
  }

  const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
  if (!neighborAtom || neighborAtom.element === 'H' || neighborAtom.element === 'C') {
    return false;
  }
  return neighborAtom.heavyDegree === 1;
}

/**
 * Returns whether a direct ligand bond should behave like a fixed single
 * ligand for orthogonal hypervalent cleanup. Aromatic ring bonds can surround
 * formally hypervalent sulfone-like centers in fused heterocycles; for 2D
 * presentation they still occupy the two non-oxo ligand slots.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} bond - Direct ligand bond descriptor.
 * @returns {boolean} True when the bond should count as a single ligand.
 */
function isHypervalentSingleLigandBond(layoutGraph, centerAtomId, bond) {
  if (!layoutGraph || !bond || bond.kind !== 'covalent') {
    return false;
  }
  if ((bond.order ?? 1) === 1 && !bond.aromatic) {
    return true;
  }
  if (!bond.aromatic) {
    return false;
  }
  const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
  return Boolean(
    neighborAtom
    && neighborAtom.element !== 'H'
    && neighborAtom.heavyDegree > 1
    && (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
    && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
  );
}

function isOrthogonalOrganosiliconSingleLigand(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  return Boolean(atom && atom.element === 'C');
}

function isOrthogonalOrganosiliconArylLigand(layoutGraph, atomId) {
  const atom = layoutGraph.atoms.get(atomId);
  return Boolean(
    atom
    && atom.element === 'C'
    && atom.aromatic === true
    && (layoutGraph.atomToRings.get(atomId)?.length ?? 0) > 0
  );
}

function isOrthogonalOrganosiliconLigandSet(layoutGraph, atomIds) {
  return (
    atomIds.every(atomId => isOrthogonalOrganosiliconSingleLigand(layoutGraph, atomId))
    && atomIds.filter(atomId => isOrthogonalOrganosiliconArylLigand(layoutGraph, atomId)).length
      >= ORTHOGONAL_ORGANOSILICON_MIN_ARYL_LIGANDS
  );
}

/**
 * Returns whether a bis-oxo center has a hydrogen hidden from the published
 * heavy-atom drawing. Once hydrogens are suppressed, a center with one visible
 * single-bond ligand and two oxo ligands reads as a three-heavy trigonal fan,
 * so terminal multiple-bond presentation cleanup owns the visible angles.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string[]} atomIds - Direct ligand atom ids.
 * @returns {boolean} True when orthogonal cleanup should defer to visible fan cleanup.
 */
function hasSuppressedHydrogenVisibleFanLigand(layoutGraph, atomIds) {
  if (layoutGraph.options?.suppressH !== true) {
    return false;
  }
  let hasHydrogen = false;
  const visibleSingleLigandElements = [];
  for (const atomId of atomIds) {
    const atom = layoutGraph.atoms.get(atomId);
    if (atom?.element === 'H') {
      hasHydrogen = true;
    } else if (atom) {
      visibleSingleLigandElements.push(atom.element);
    }
  }
  return (
    hasHydrogen
    && visibleSingleLigandElements.length === 1
  );
}

function describeOrthogonalHypervalentCenter(layoutGraph, atomId, coords) {
  if (!layoutGraph) {
    return null;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (
    !atom
    || (
      !ORTHOGONAL_HYPERVALENT_ELEMENTS.has(atom.element)
      && !ORTHOGONAL_ORGANOSILICON_ELEMENTS.has(atom.element)
    )
    || !coords.has(atomId)
  ) {
    return null;
  }

  const ligandAtomIds = directLigandAtomIds(layoutGraph, atomId, coords);
  const singleNeighborIds = [];
  const multipleNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent') {
      return null;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || !coords.has(neighborAtomId)) {
      continue;
    }
    if (isHypervalentSingleLigandBond(layoutGraph, atomId, bond)) {
      singleNeighborIds.push(neighborAtomId);
      continue;
    }
    if (isTerminalMultipleBondHetero(layoutGraph, atomId, bond)) {
      multipleNeighborIds.push(neighborAtomId);
      continue;
    }
    return null;
  }

  if (ligandAtomIds.length !== 4) {
    return null;
  }
  if (singleNeighborIds.length === 2 && multipleNeighborIds.length === 2) {
    if (hasSuppressedHydrogenVisibleFanLigand(layoutGraph, singleNeighborIds)) {
      return null;
    }
    return { kind: 'bis-oxo', singleNeighborIds, multipleNeighborIds };
  }
  if (singleNeighborIds.length === 3 && multipleNeighborIds.length === 1) {
    if (singleNeighborIds.some(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element === 'H')) {
      return null;
    }
    return { kind: 'mono-oxo', singleNeighborIds, multipleNeighborIds };
  }
  if (
    singleNeighborIds.length === 4
    && multipleNeighborIds.length === 0
    && ORTHOGONAL_ORGANOSILICON_ELEMENTS.has(atom.element)
    && isOrthogonalOrganosiliconLigandSet(layoutGraph, singleNeighborIds)
  ) {
    return { kind: 'organosilicon', singleNeighborIds, multipleNeighborIds };
  }
  return null;
}

/**
 * Returns whether a bis-oxo hypervalent center is itself a ring atom whose two
 * single-bond ligands are the adjacent ring atoms. These centers read better
 * when the terminal oxo leaves share the ring exterior instead of forming the
 * default orthogonal cross through the ring interior.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {boolean} True when the center should use an exterior oxo V.
 */
function isRingEmbeddedBisOxoCenter(layoutGraph, centerAtomId, descriptor) {
  if (
    descriptor?.kind !== 'bis-oxo'
    || descriptor.singleNeighborIds.length !== 2
    || descriptor.multipleNeighborIds.length !== 2
  ) {
    return false;
  }

  const incidentRings = layoutGraph.atomToRings.get(centerAtomId) ?? [];
  return incidentRings.some(ring =>
    descriptor.singleNeighborIds.every(neighborAtomId => ring.atomIds.includes(neighborAtomId))
  );
}

/**
 * Assigns two terminal oxo ligands to a pair of target angles with the least
 * angular movement from their current positions.
 * @param {string[]} ligandAtomIds - Two terminal oxo ligand atom ids.
 * @param {Map<string, number>} currentAngles - Current center-relative ligand angles.
 * @param {number[]} targetAngles - Two candidate target angles.
 * @returns {{cost: number, targetAngles: Map<string, number>}|null} Best pair assignment.
 */
function fitTwoLigandTargets(ligandAtomIds, currentAngles, targetAngles) {
  if (ligandAtomIds.length !== 2 || targetAngles.length !== 2) {
    return null;
  }

  const assignments = [
    [
      [ligandAtomIds[0], targetAngles[0]],
      [ligandAtomIds[1], targetAngles[1]]
    ],
    [
      [ligandAtomIds[0], targetAngles[1]],
      [ligandAtomIds[1], targetAngles[0]]
    ]
  ];
  let bestFit = null;
  for (const assignment of assignments) {
    let cost = 0;
    const assignedTargets = new Map();
    for (const [ligandAtomId, targetAngle] of assignment) {
      cost += angularDifference(currentAngles.get(ligandAtomId), targetAngle) ** 2;
      assignedTargets.set(ligandAtomId, targetAngle);
    }
    if (!bestFit || cost < bestFit.cost) {
      bestFit = { cost, targetAngles: assignedTargets };
    }
  }
  return bestFit;
}

function isBetterRingEmbeddedBisOxoFit(candidateFit, incumbentFit) {
  if (!incumbentFit) {
    return true;
  }
  if ((candidateFit.overlapCount ?? 0) !== (incumbentFit.overlapCount ?? 0)) {
    return (candidateFit.overlapCount ?? 0) < (incumbentFit.overlapCount ?? 0);
  }
  if ((candidateFit.overlapCount ?? 0) === 0 && Math.abs((candidateFit.spread ?? 0) - (incumbentFit.spread ?? 0)) > 1e-9) {
    return (candidateFit.spread ?? 0) > (incumbentFit.spread ?? 0);
  }
  if (
    (candidateFit.overlapCount ?? 0) === 0
    && Math.abs((candidateFit.centerOffset ?? 0) - (incumbentFit.centerOffset ?? 0)) > 1e-9
  ) {
    return (candidateFit.centerOffset ?? 0) < (incumbentFit.centerOffset ?? 0);
  }
  if (Math.abs((candidateFit.minOverlapDistance ?? Infinity) - (incumbentFit.minOverlapDistance ?? Infinity)) > 1e-9) {
    return (candidateFit.minOverlapDistance ?? Infinity) > (incumbentFit.minOverlapDistance ?? Infinity);
  }
  return candidateFit.cost < incumbentFit.cost;
}

/**
 * Returns whether proposed terminal oxo positions stay outside every incident
 * ring containing the hypervalent center.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {Map<string, {x: number, y: number}>} overridePositions - Proposed oxo positions.
 * @returns {boolean} True when no proposed oxo position falls inside an incident ring.
 */
function ringEmbeddedBisOxoTargetsStayOutsideRings(layoutGraph, coords, centerAtomId, overridePositions) {
  const incidentRingPolygons = (layoutGraph.atomToRings.get(centerAtomId) ?? [])
    .map(ring => ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean))
    .filter(polygon => polygon.length >= 3);
  if (incidentRingPolygons.length === 0) {
    return true;
  }
  for (const position of overridePositions.values()) {
    for (const polygon of incidentRingPolygons) {
      if (pointInPolygon(position, polygon)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Fits the terminal oxo ligands of a ring-embedded bis-oxo center to an
 * exterior V centered on the local ring-outward direction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {{cost: number, targetAngles: Map<string, number>, overlapCount?: number, minOverlapDistance?: number, spread?: number, centerOffset?: number}|null} Exterior-V fit, or `null`.
 */
function fitRingEmbeddedBisOxoTargets(layoutGraph, coords, centerAtomId, descriptor) {
  if (!isRingEmbeddedBisOxoCenter(layoutGraph, centerAtomId, descriptor)) {
    return null;
  }

  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return null;
  }

  const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, centerAtomId, atomId => coords.get(atomId) ?? null);
  if (outwardAngles.length === 0) {
    return null;
  }

  const currentAngles = new Map(
    descriptor.multipleNeighborIds.map(neighborAtomId => [
      neighborAtomId,
      angleOf(sub(coords.get(neighborAtomId), centerPosition))
    ])
  );
  let bestFit = null;
  const centerOffsetCandidates = ringEmbeddedBisOxoCenterOffsetCandidates();
  const incidentRings = (layoutGraph.atomToRings.get(centerAtomId) ?? []).filter(ring =>
    descriptor.singleNeighborIds.every(neighborAtomId => ring.atomIds.includes(neighborAtomId))
  );
  for (const outwardAngle of outwardAngles) {
    for (const ring of incidentRings) {
      for (const spread of ringEmbeddedBisOxoSpreadCandidates(ringEmbeddedBisOxoSpread(ring.atomIds.length))) {
        for (const centerOffset of centerOffsetCandidates) {
          const targetCenterAngle = outwardAngle + centerOffset;
          const targetAngles = [
            wrapAngleUnsigned(targetCenterAngle - spread / 2),
            wrapAngleUnsigned(targetCenterAngle + spread / 2)
          ];
          const fit = fitTwoLigandTargets(descriptor.multipleNeighborIds, currentAngles, targetAngles);
          if (!fit) {
            continue;
          }
          const overridePositions = new Map(
            descriptor.multipleNeighborIds.map(neighborAtomId => [
              neighborAtomId,
              add(centerPosition, fromAngle(fit.targetAngles.get(neighborAtomId), distance(centerPosition, coords.get(neighborAtomId))))
            ])
          );
          if (!ringEmbeddedBisOxoTargetsStayOutsideRings(layoutGraph, coords, centerAtomId, overridePositions)) {
            continue;
          }
          const overlapState = countSevereOverlapsWithOverrides(
            layoutGraph,
            coords,
            overridePositions,
            layoutGraph.options?.bondLength ?? 1.5
          );
          const candidateFit = {
            ...fit,
            overlapCount: overlapState.count,
            minOverlapDistance: overlapState.minDistance,
            spread,
            centerOffset: Math.abs(centerOffset)
          };
          if (isBetterRingEmbeddedBisOxoFit(candidateFit, bestFit)) {
            bestFit = candidateFit;
          }
        }
      }
    }
  }
  if (!bestFit) {
    const targetAngles = [
      wrapAngleUnsigned(outwardAngles[0] - ringEmbeddedBisOxoSpread(3) / 2),
      wrapAngleUnsigned(outwardAngles[0] + ringEmbeddedBisOxoSpread(3) / 2)
    ];
    bestFit = fitTwoLigandTargets(descriptor.multipleNeighborIds, currentAngles, targetAngles);
  }
  return bestFit;
}

/**
 * Returns whether a bis-oxo center is linked between two ring atoms without
 * being part of either ring. These diaryl-like sulfones often cannot make an
 * exact four-way cross without rotating bulky rings into each other; the safer
 * local presentation is to keep the ring ligands fixed and oppose the oxo
 * leaves across the open ring-ligand gap.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {boolean} True when the center should use constrained oxo targets.
 */
function isRingLinkedBisOxoCenter(layoutGraph, centerAtomId, descriptor) {
  if (
    descriptor?.kind !== 'bis-oxo'
    || descriptor.singleNeighborIds.length !== 2
    || descriptor.multipleNeighborIds.length !== 2
    || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
  ) {
    return false;
  }
  return descriptor.singleNeighborIds.every(
    neighborAtomId => {
      const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
      return (
        neighborAtom?.element === 'C'
        && neighborAtom.aromatic === true
        && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
      );
    }
  );
}

/**
 * Returns whether a ring-linked bis-oxo center has a small terminal aryl
 * ligand that can rotate to complete the exact four-way cross. Bulky diaryl
 * sulfones still use the constrained oxo-only fit.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {boolean} True when normal orthogonal fitting should handle it.
 */
function hasCompactRingLinkedBisOxoCrossLigand(layoutGraph, coords, centerAtomId, descriptor) {
  if (!isRingLinkedBisOxoCenter(layoutGraph, centerAtomId, descriptor)) {
    return false;
  }

  return descriptor.singleNeighborIds.some(neighborAtomId => {
    const subtreeAtomIds = movableCompactHypervalentLigandSubtreeAtomIds(layoutGraph, centerAtomId, neighborAtomId, coords);
    if (!Array.isArray(subtreeAtomIds) || subtreeAtomIds.length === 0) {
      return false;
    }

    const ringSystemIds = new Set();
    let heavyAtomCount = 0;
    for (const subtreeAtomId of subtreeAtomIds) {
      const subtreeAtom = layoutGraph.atoms.get(subtreeAtomId);
      if (!subtreeAtom) {
        return false;
      }
      if (subtreeAtom.element !== 'H') {
        heavyAtomCount++;
      }
      const ringSystemId = layoutGraph.atomToRingSystemId?.get(subtreeAtomId) ?? null;
      if (ringSystemId != null) {
        ringSystemIds.add(ringSystemId);
      }
    }

    return (
      heavyAtomCount <= MAX_RING_LINKED_BISOXO_CROSS_LIGAND_HEAVY_ATOMS
      && ringSystemIds.size > 0
      && ringSystemIds.size <= MAX_RING_LINKED_BISOXO_CROSS_LIGAND_RING_SYSTEMS
    );
  });
}

/**
 * Returns whether a diaryl-like bis-oxo center should keep both ring ligands
 * fixed and only oppose its oxo leaves.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {boolean} True when constrained ring-linked oxo targets should run.
 */
function shouldUseRingLinkedBisOxoTargets(layoutGraph, coords, centerAtomId, descriptor) {
  return (
    isRingLinkedBisOxoCenter(layoutGraph, centerAtomId, descriptor)
    && !hasCompactRingLinkedBisOxoCrossLigand(layoutGraph, coords, centerAtomId, descriptor)
  );
}

/**
 * Returns the opposed oxo-axis seed that bisects the smaller angle between the
 * two fixed ring ligands of a constrained ring-linked bis-oxo center.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {number|null} Axis angle in radians, or `null` when unavailable.
 */
function ringLinkedBisOxoAxis(layoutGraph, coords, centerAtomId, descriptor) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || descriptor.singleNeighborIds.length !== 2) {
    return null;
  }
  const firstPosition = coords.get(descriptor.singleNeighborIds[0]);
  const secondPosition = coords.get(descriptor.singleNeighborIds[1]);
  if (!firstPosition || !secondPosition) {
    return null;
  }
  const firstAngle = angleOf(sub(firstPosition, centerPosition));
  const secondAngle = angleOf(sub(secondPosition, centerPosition));
  const signedDelta = Math.atan2(Math.sin(secondAngle - firstAngle), Math.cos(secondAngle - firstAngle));
  return wrapAngleUnsigned(firstAngle + signedDelta / 2);
}

/**
 * Returns whether a constrained ring-linked bis-oxo fit should replace the
 * incumbent candidate.
 * @param {{cost: number, overlapCount: number, minOverlapDistance: number, centerOffset: number}} candidateFit - Candidate fit.
 * @param {{cost: number, overlapCount: number, minOverlapDistance: number, centerOffset: number}|null} incumbentFit - Current best fit.
 * @returns {boolean} True when the candidate is preferable.
 */
function isBetterRingLinkedBisOxoFit(candidateFit, incumbentFit) {
  if (!incumbentFit) {
    return true;
  }
  if ((candidateFit.overlapCount ?? 0) !== (incumbentFit.overlapCount ?? 0)) {
    return (candidateFit.overlapCount ?? 0) < (incumbentFit.overlapCount ?? 0);
  }
  if (
    (candidateFit.overlapCount ?? 0) === 0
    && Math.abs((candidateFit.centerOffset ?? 0) - (incumbentFit.centerOffset ?? 0)) > 1e-9
  ) {
    return (candidateFit.centerOffset ?? 0) < (incumbentFit.centerOffset ?? 0);
  }
  if (Math.abs((candidateFit.minOverlapDistance ?? Infinity) - (incumbentFit.minOverlapDistance ?? Infinity)) > 1e-9) {
    return (candidateFit.minOverlapDistance ?? Infinity) > (incumbentFit.minOverlapDistance ?? Infinity);
  }
  return candidateFit.cost < incumbentFit.cost;
}

/**
 * Fits terminal oxo ligands for ring-linked bis-oxo centers by keeping both
 * ring ligands fixed and scanning a small slide of the opposed oxo axis around
 * the ring-ligand gap bisector until the leaves clear nearby ring atoms.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {{cost: number, targetAngles: Map<string, number>, overlapCount: number, minOverlapDistance: number, centerOffset: number}|null} Best constrained fit, or `null`.
 */
function fitRingLinkedBisOxoTargets(layoutGraph, coords, centerAtomId, descriptor) {
  if (!shouldUseRingLinkedBisOxoTargets(layoutGraph, coords, centerAtomId, descriptor)) {
    return null;
  }
  const centerPosition = coords.get(centerAtomId);
  const baseAxis = ringLinkedBisOxoAxis(layoutGraph, coords, centerAtomId, descriptor);
  if (!centerPosition || baseAxis == null) {
    return null;
  }

  const currentAngles = new Map(
    descriptor.multipleNeighborIds.map(neighborAtomId => [
      neighborAtomId,
      angleOf(sub(coords.get(neighborAtomId), centerPosition))
    ])
  );
  let bestFit = null;
  for (const axisOffset of ringEmbeddedBisOxoCenterOffsetCandidates()) {
    const targetAngles = [
      wrapAngleUnsigned(baseAxis + axisOffset),
      wrapAngleUnsigned(baseAxis + axisOffset + Math.PI)
    ];
    const fit = fitTwoLigandTargets(descriptor.multipleNeighborIds, currentAngles, targetAngles);
    if (!fit) {
      continue;
    }
    const overridePositions = new Map(
      descriptor.multipleNeighborIds.map(neighborAtomId => [
        neighborAtomId,
        add(centerPosition, fromAngle(fit.targetAngles.get(neighborAtomId), distance(centerPosition, coords.get(neighborAtomId))))
      ])
    );
    const overlapState = countSevereOverlapsWithOverrides(
      layoutGraph,
      coords,
      overridePositions,
      layoutGraph.options?.bondLength ?? 1.5
    );
    const candidateFit = {
      ...fit,
      overlapCount: overlapState.count,
      minOverlapDistance: overlapState.minDistance,
      centerOffset: Math.abs(axisOffset)
    };
    if (isBetterRingLinkedBisOxoFit(candidateFit, bestFit)) {
      bestFit = candidateFit;
    }
  }

  return bestFit && bestFit.overlapCount === 0 ? bestFit : null;
}

/**
 * Returns a compact bridge-linked hypervalent subtree that can be rotated as a
 * rigid block around the current center without disturbing its internal bond
 * geometry. This enables cleanup to re-square short polyphosphate and similar
 * chains without authorizing swings of arbitrarily large downstream fragments.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Current hypervalent center atom id.
 * @param {string} ligandAtomId - Candidate single-bond ligand atom id.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {string[]|null} Movable subtree atom ids, or `null` when the bridge block should stay fixed.
 */
function movableBridgeLinkedHypervalentSubtreeAtomIds(layoutGraph, centerAtomId, ligandAtomId, coords) {
  const ligandAtom = layoutGraph.atoms.get(ligandAtomId);
  if (
    !ligandAtom
    || !coords.has(ligandAtomId)
    || ligandAtom.heavyDegree !== 2
    || !BRIDGE_LINKED_HYPERVALENT_LIGAND_ELEMENTS.has(ligandAtom.element)
    || (layoutGraph.atomToRings.get(ligandAtomId)?.length ?? 0) > 0
  ) {
    return null;
  }

  const downstreamCenterIds = (layoutGraph.bondsByAtomId.get(ligandAtomId) ?? [])
    .filter(bond => bond.kind === 'covalent' && !bond.aromatic && (bond.order ?? 1) === 1)
    .map(bond => (bond.a === ligandAtomId ? bond.b : bond.a))
    .filter(neighborAtomId => neighborAtomId !== centerAtomId && layoutGraph.atoms.get(neighborAtomId)?.element !== 'H' && coords.has(neighborAtomId));
  if (downstreamCenterIds.length !== 1 || !describeOrthogonalHypervalentCenter(layoutGraph, downstreamCenterIds[0], coords)) {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, ligandAtomId, centerAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId));
  let heavyAtomCount = 0;
  for (const subtreeAtomId of subtreeAtomIds) {
    const subtreeAtom = layoutGraph.atoms.get(subtreeAtomId);
    if (!subtreeAtom) {
      return null;
    }
    if (subtreeAtom.element !== 'H') {
      heavyAtomCount++;
      if (heavyAtomCount > MAX_BRIDGE_LINKED_HYPERVALENT_SUBTREE_HEAVY_ATOMS) {
        return null;
      }
    }
  }

  return subtreeAtomIds;
}

function movableCompactHypervalentLigandSubtreeAtomIds(layoutGraph, centerAtomId, ligandAtomId, coords) {
  const ligandAtom = layoutGraph.atoms.get(ligandAtomId);
  if (
    !ligandAtom
    || ligandAtom.element === 'H'
    || !coords.has(ligandAtomId)
  ) {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, ligandAtomId, centerAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId));
  const ringSystemIds = new Set(
    subtreeAtomIds
      .map(subtreeAtomId => layoutGraph.atomToRingSystemId?.get(subtreeAtomId) ?? null)
      .filter(ringSystemId => ringSystemId != null)
  );
  if (
    subtreeAtomIds.length === 0
    || subtreeAtomIds.length > MAX_COMPACT_HYPERVALENT_LIGAND_SUBTREE_ATOMS
    || ringSystemIds.size > MAX_COMPACT_HYPERVALENT_LIGAND_RING_SYSTEMS
  ) {
    return null;
  }

  let heavyAtomCount = 0;
  for (const subtreeAtomId of subtreeAtomIds) {
    const subtreeAtom = layoutGraph.atoms.get(subtreeAtomId);
    if (!subtreeAtom) {
      return null;
    }
    if (subtreeAtom.element !== 'H') {
      heavyAtomCount++;
      if (heavyAtomCount > MAX_COMPACT_HYPERVALENT_LIGAND_SUBTREE_HEAVY_ATOMS) {
        return null;
      }
    }
  }

  return heavyAtomCount > 1 ? subtreeAtomIds : null;
}

function movableLigandSubtreeAtomIds(layoutGraph, centerAtomId, ligandAtomId, coords) {
  const ligandAtom = layoutGraph.atoms.get(ligandAtomId);
  if (!ligandAtom || !coords.has(ligandAtomId)) {
    return null;
  }
  if (ligandAtom.heavyDegree > 1) {
    return (
      movableBridgeLinkedHypervalentSubtreeAtomIds(layoutGraph, centerAtomId, ligandAtomId, coords)
      ?? movableCompactHypervalentLigandSubtreeAtomIds(layoutGraph, centerAtomId, ligandAtomId, coords)
    );
  }
  const subtreeAtomIds = collectCutSubtree(layoutGraph, ligandAtomId, centerAtomId);
  for (const subtreeAtomId of subtreeAtomIds) {
    const subtreeAtom = layoutGraph.atoms.get(subtreeAtomId);
    if (!subtreeAtom) {
      return null;
    }
    if (subtreeAtom.element !== 'H' && subtreeAtomId !== ligandAtomId) {
      return null;
    }
  }
  return [...subtreeAtomIds].filter(subtreeAtomId => coords.has(subtreeAtomId));
}

/**
 * Returns whether a direct hypervalent ligand is a terminal multiple-bond
 * hetero atom, such as one oxo ligand on a sulfone or phosphate.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {string} ligandAtomId - Direct ligand atom id.
 * @returns {boolean} True when the ligand is terminal and multiply bonded.
 */
function isTerminalMultipleHypervalentLigand(layoutGraph, centerAtomId, ligandAtomId) {
  const bond = (layoutGraph.bondsByAtomId.get(centerAtomId) ?? []).find(candidateBond => {
    if (!candidateBond || candidateBond.kind !== 'covalent') {
      return false;
    }
    const neighborAtomId = candidateBond.a === centerAtomId ? candidateBond.b : candidateBond.a;
    return neighborAtomId === ligandAtomId;
  });
  return isTerminalMultipleBondHetero(layoutGraph, centerAtomId, bond);
}

/**
 * Returns the angular tolerance for moving one direct hypervalent ligand.
 * Hidden hydrogens and terminal oxo-like ligands are cheap to move, so they
 * should snap to the exact opposing slot instead of stopping inside the broader
 * heavy-ligand tolerance.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {string} ligandAtomId - Direct ligand atom id.
 * @param {number} defaultThreshold - Default angular tolerance in radians.
 * @returns {number} Ligand-specific angular tolerance in radians.
 */
function hypervalentLigandAngleThreshold(layoutGraph, centerAtomId, ligandAtomId, defaultThreshold) {
  if (layoutGraph.atoms.get(ligandAtomId)?.element === 'H') {
    return TERMINAL_HYPERVALENT_H_ANGLE_THRESHOLD;
  }
  if (isTerminalMultipleHypervalentLigand(layoutGraph, centerAtomId, ligandAtomId)) {
    return TERMINAL_HYPERVALENT_MULTIPLE_LIGAND_ANGLE_THRESHOLD;
  }
  return defaultThreshold;
}

/**
 * Returns a compact hypervalent-center subtree that may rotate around a ring
 * ligand to put the center on the ligand's exact local ring-outward bisector.
 * This is intended for sulfonyl/phosphoryl branches attached to ring nitrogens
 * or similar anchors, while rejecting moves that would swing the principal
 * scaffold through the hypervalent center.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {string} ringAnchorAtomId - Ring ligand atom id used as pivot.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {string[]|null} Center-side subtree atom ids, or `null` when too broad.
 */
function movableRingAnchoredHypervalentSubtreeAtomIds(layoutGraph, centerAtomId, ringAnchorAtomId, coords) {
  if ((layoutGraph.atomToRings.get(ringAnchorAtomId)?.length ?? 0) === 0) {
    return null;
  }
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, centerAtomId, ringAnchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId));
  if (
    subtreeAtomIds.length === 0
    || subtreeAtomIds.includes(ringAnchorAtomId)
    || subtreeAtomIds.length > MAX_RING_ANCHORED_HYPERVALENT_SUBTREE_ATOMS
  ) {
    return null;
  }

  let heavyAtomCount = 0;
  for (const subtreeAtomId of subtreeAtomIds) {
    const subtreeAtom = layoutGraph.atoms.get(subtreeAtomId);
    if (!subtreeAtom) {
      return null;
    }
    if (subtreeAtom.element !== 'H') {
      heavyAtomCount++;
      if (heavyAtomCount > MAX_RING_ANCHORED_HYPERVALENT_SUBTREE_HEAVY_ATOMS) {
        return null;
      }
    }
  }
  return subtreeAtomIds;
}

function movableAcyclicAnchoredHypervalentSubtreeAtomIds(layoutGraph, centerAtomId, anchorAtomId, coords) {
  const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
  if (
    !anchorAtom
    || anchorAtom.aromatic
    || !ACYCLIC_HYPERVALENT_BRANCH_ANCHOR_ELEMENTS.has(anchorAtom.element)
    || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) > 0
  ) {
    return null;
  }

  const visibleHeavyBonds = (layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
  });
  if (
    visibleHeavyBonds.length !== 2
    || !visibleHeavyBonds.some(bond => (bond.a === anchorAtomId ? bond.b : bond.a) === centerAtomId)
  ) {
    return null;
  }

  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, centerAtomId, anchorAtomId)].filter(subtreeAtomId => coords.has(subtreeAtomId));
  if (
    subtreeAtomIds.length === 0
    || subtreeAtomIds.includes(anchorAtomId)
    || subtreeAtomIds.length > MAX_RING_ANCHORED_HYPERVALENT_SUBTREE_ATOMS
  ) {
    return null;
  }

  let heavyAtomCount = 0;
  for (const subtreeAtomId of subtreeAtomIds) {
    const subtreeAtom = layoutGraph.atoms.get(subtreeAtomId);
    if (!subtreeAtom) {
      return null;
    }
    if (subtreeAtom.element !== 'H') {
      heavyAtomCount++;
      if (heavyAtomCount > MAX_RING_ANCHORED_HYPERVALENT_SUBTREE_HEAVY_ATOMS) {
        return null;
      }
    }
  }
  return subtreeAtomIds;
}

function acyclicDivalentContinuationTargetAngles(layoutGraph, coords, anchorAtomId, centerAtomId) {
  const anchorPosition = coords.get(anchorAtomId);
  const centerPosition = coords.get(centerAtomId);
  if (!anchorPosition || !centerPosition) {
    return [];
  }
  const visibleHeavyBonds = (layoutGraph.bondsByAtomId.get(anchorAtomId) ?? []).filter(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === anchorAtomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return !!neighborAtom && neighborAtom.element !== 'H' && coords.has(neighborAtomId);
  });
  if (visibleHeavyBonds.length !== 2) {
    return [];
  }
  const parentBond = visibleHeavyBonds.find(bond => (bond.a === anchorAtomId ? bond.b : bond.a) !== centerAtomId);
  const parentAtomId = parentBond ? (parentBond.a === anchorAtomId ? parentBond.b : parentBond.a) : null;
  const parentPosition = parentAtomId ? coords.get(parentAtomId) : null;
  if (!parentAtomId || !parentPosition) {
    return [];
  }

  const currentAngle = angleOf(sub(centerPosition, anchorPosition));
  const parentAngle = angleOf(sub(parentPosition, anchorPosition));
  return [parentAngle + ((2 * Math.PI) / 3), parentAngle - ((2 * Math.PI) / 3)]
    .sort((firstAngle, secondAngle) => angularDifference(firstAngle, currentAngle) - angularDifference(secondAngle, currentAngle));
}

/**
 * Rotates compact ring-anchored hypervalent branches so the hypervalent center
 * itself sits on the ring anchor's exact outward bisector.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Orthogonal hypervalent descriptor.
 * @returns {number} Number of accepted branch rotations.
 */
function alignRingAnchoredHypervalentBranch(layoutGraph, coords, centerAtomId, descriptor) {
  let nudges = 0;
  for (const ringAnchorAtomId of descriptor.singleNeighborIds) {
    const anchorPosition = coords.get(ringAnchorAtomId);
    const centerPosition = coords.get(centerAtomId);
    if (!anchorPosition || !centerPosition) {
      continue;
    }
    const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, ringAnchorAtomId, atomId => coords.get(atomId) ?? null);
    if (outwardAngles.length === 0) {
      continue;
    }
    const subtreeAtomIds = movableRingAnchoredHypervalentSubtreeAtomIds(layoutGraph, centerAtomId, ringAnchorAtomId, coords);
    if (!subtreeAtomIds) {
      continue;
    }
    const currentAngle = angleOf(sub(centerPosition, anchorPosition));
    const targetAngle = outwardAngles
      .slice()
      .sort((firstAngle, secondAngle) => angularDifference(currentAngle, firstAngle) - angularDifference(currentAngle, secondAngle))[0];
    if (targetAngle == null || angularDifference(currentAngle, targetAngle) <= RING_ANCHORED_HYPERVALENT_ANGLE_THRESHOLD) {
      continue;
    }
    const rotation = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
    const candidatePositions = new Map();
    for (const subtreeAtomId of subtreeAtomIds) {
      const currentPosition = coords.get(subtreeAtomId);
      if (!currentPosition) {
        continue;
      }
      const offset = sub(currentPosition, anchorPosition);
      const radius = distance(anchorPosition, currentPosition);
      const absoluteAngle = angleOf(offset);
      candidatePositions.set(subtreeAtomId, add(anchorPosition, fromAngle(absoluteAngle + rotation, radius)));
    }
    if (
      candidatePositions.size === 0
      || !preservesSevereOverlapState(
        layoutGraph,
        coords,
        candidatePositions,
        layoutGraph.options?.bondLength ?? distance(anchorPosition, centerPosition)
      )
    ) {
      continue;
    }
    for (const [subtreeAtomId, candidatePosition] of candidatePositions) {
      coords.set(subtreeAtomId, candidatePosition);
    }
    nudges++;
  }
  return nudges;
}

function severeOverlapState(overlaps) {
  if (!Array.isArray(overlaps) || overlaps.length === 0) {
    return { count: 0, minDistance: Infinity };
  }
  return {
    count: overlaps.length,
    minDistance: overlaps.reduce((minDistance, overlap) => Math.min(minDistance, overlap.distance ?? Infinity), Infinity)
  };
}

function buildRotatedBranchPositions(coords, anchorAtomId, subtreeAtomIds, rotation) {
  const anchorPosition = coords.get(anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const candidatePositions = new Map();
  for (const subtreeAtomId of subtreeAtomIds) {
    const currentPosition = coords.get(subtreeAtomId);
    if (!currentPosition) {
      continue;
    }
    const offset = sub(currentPosition, anchorPosition);
    const radius = distance(anchorPosition, currentPosition);
    const absoluteAngle = angleOf(offset);
    candidatePositions.set(subtreeAtomId, add(anchorPosition, fromAngle(absoluteAngle + rotation, radius)));
  }
  return candidatePositions.size > 0 ? candidatePositions : null;
}

function withCandidatePositions(coords, candidatePositions) {
  const candidateCoords = new Map(coords);
  for (const [atomId, position] of candidatePositions) {
    candidateCoords.set(atomId, position);
  }
  return candidateCoords;
}

function isBetterAcyclicBranchReliefFit(candidateFit, incumbentFit) {
  if (!incumbentFit) {
    return true;
  }
  if (candidateFit.directOverlapState.count !== incumbentFit.directOverlapState.count) {
    return candidateFit.directOverlapState.count < incumbentFit.directOverlapState.count;
  }
  if (candidateFit.severeOverlapState.count !== incumbentFit.severeOverlapState.count) {
    return candidateFit.severeOverlapState.count < incumbentFit.severeOverlapState.count;
  }
  if (Math.abs(candidateFit.directOverlapState.minDistance - incumbentFit.directOverlapState.minDistance) > 1e-9) {
    return candidateFit.directOverlapState.minDistance > incumbentFit.directOverlapState.minDistance;
  }
  if (Math.abs(candidateFit.severeOverlapState.minDistance - incumbentFit.severeOverlapState.minDistance) > 1e-9) {
    return candidateFit.severeOverlapState.minDistance > incumbentFit.severeOverlapState.minDistance;
  }
  return Math.abs(candidateFit.rotation) < Math.abs(incumbentFit.rotation);
}

/**
 * Rotates a compact hypervalent branch around an acyclic divalent single-bond
 * anchor when the exact oxo cross puts a direct ligand into a nearby atom.
 * This preserves the sulfur/phosphorus cross and tries the alternate zigzag
 * slot before falling back to atom-level overlap cleanup.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Orthogonal hypervalent descriptor.
 * @returns {number} Number of accepted branch rotations.
 */
function relieveAcyclicAnchoredHypervalentBranchOverlap(layoutGraph, coords, centerAtomId, descriptor) {
  const currentDirectOverlaps = severeOverlapsTouchingDirectLigands(layoutGraph, coords, centerAtomId);
  if (currentDirectOverlaps.length === 0) {
    return 0;
  }

  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const currentDirectOverlapState = severeOverlapState(currentDirectOverlaps);
  const currentSevereOverlapState = severeOverlapState(findSevereOverlaps(layoutGraph, coords, bondLength));
  const currentBondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
  const currentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, coords, {
    focusAtomIds: new Set([centerAtomId])
  });

  let bestFit = null;
  for (const anchorAtomId of descriptor.singleNeighborIds) {
    const centerPosition = coords.get(centerAtomId);
    const anchorPosition = coords.get(anchorAtomId);
    if (!centerPosition || !anchorPosition) {
      continue;
    }
    const subtreeAtomIds = movableAcyclicAnchoredHypervalentSubtreeAtomIds(layoutGraph, centerAtomId, anchorAtomId, coords);
    if (!subtreeAtomIds) {
      continue;
    }
    const currentAngle = angleOf(sub(centerPosition, anchorPosition));
    for (const targetAngle of acyclicDivalentContinuationTargetAngles(layoutGraph, coords, anchorAtomId, centerAtomId)) {
      if (angularDifference(currentAngle, targetAngle) <= ACYCLIC_ANCHORED_HYPERVALENT_OVERLAP_RELIEF_ANGLE_THRESHOLD) {
        continue;
      }
      const rotation = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
      const candidatePositions = buildRotatedBranchPositions(coords, anchorAtomId, subtreeAtomIds, rotation);
      if (!candidatePositions) {
        continue;
      }
      const candidateCoords = withCandidatePositions(coords, candidatePositions);
      const candidateDirectOverlapState = severeOverlapState(
        severeOverlapsTouchingDirectLigands(layoutGraph, candidateCoords, centerAtomId)
      );
      const candidateSevereOverlapState = countSevereOverlapsWithOverrides(layoutGraph, coords, candidatePositions, bondLength);
      const candidateBondDeviation = measureBondLengthDeviation(layoutGraph, candidateCoords, bondLength);
      const candidateDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, candidateCoords, {
        focusAtomIds: new Set([centerAtomId])
      });
      if (
        candidateDirectOverlapState.count >= currentDirectOverlapState.count
        || candidateSevereOverlapState.count > currentSevereOverlapState.count
        || candidateBondDeviation.failingBondCount > currentBondDeviation.failingBondCount
        || candidateBondDeviation.maxDeviation > currentBondDeviation.maxDeviation + 1e-9
        || candidateDeviation > currentDeviation + 1e-9
      ) {
        continue;
      }
      const candidateFit = {
        positions: candidatePositions,
        directOverlapState: candidateDirectOverlapState,
        severeOverlapState: candidateSevereOverlapState,
        rotation
      };
      if (isBetterAcyclicBranchReliefFit(candidateFit, bestFit)) {
        bestFit = candidateFit;
      }
    }
  }

  if (!bestFit) {
    return 0;
  }

  for (const [subtreeAtomId, candidatePosition] of bestFit.positions) {
    coords.set(subtreeAtomId, candidatePosition);
  }
  return 1;
}

/**
 * Returns whether one branch-overlap relief candidate is preferable.
 * @param {{overlapState: {count: number, minDistance: number}, rotation: number}} candidateFit - Candidate branch rotation.
 * @param {{overlapState: {count: number, minDistance: number}, rotation: number}|null} incumbentFit - Current best candidate.
 * @returns {boolean} True when the candidate is the better local relief.
 */
function isBetterRingAnchoredOverlapReliefFit(candidateFit, incumbentFit) {
  if (!incumbentFit) {
    return true;
  }
  if (candidateFit.overlapState.count !== incumbentFit.overlapState.count) {
    return candidateFit.overlapState.count < incumbentFit.overlapState.count;
  }
  if (candidateFit.overlapState.count === 0) {
    return Math.abs(candidateFit.rotation) < Math.abs(incumbentFit.rotation);
  }
  if (Math.abs(candidateFit.overlapState.minDistance - incumbentFit.overlapState.minDistance) > 1e-9) {
    return candidateFit.overlapState.minDistance > incumbentFit.overlapState.minDistance;
  }
  return Math.abs(candidateFit.rotation) < Math.abs(incumbentFit.rotation);
}

/**
 * Returns whether a branch-overlap relief candidate improves the current
 * severe-overlap state for the same moved atoms.
 * @param {{count: number, minDistance: number}} candidateOverlapState - Candidate local overlap state.
 * @param {{count: number, minDistance: number}} currentOverlapState - Current local overlap state.
 * @returns {boolean} True when the candidate makes the local overlap state better.
 */
function improvesRingAnchoredOverlapState(candidateOverlapState, currentOverlapState) {
  if (candidateOverlapState.count !== currentOverlapState.count) {
    return candidateOverlapState.count < currentOverlapState.count;
  }
  return (
    candidateOverlapState.count > 0
    && candidateOverlapState.minDistance > currentOverlapState.minDistance + 1e-9
  );
}

/**
 * Rotates a compact ring-anchored hypervalent branch by the smallest local
 * angle that clears severe overlaps introduced by an otherwise exact cross.
 * The whole center-side branch moves as one rigid block, preserving the
 * sulfur/phosphorus cross while allowing a crowded ring exit a tiny amount of
 * visual relief.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Orthogonal hypervalent descriptor.
 * @returns {number} Number of accepted branch rotations.
 */
function relieveRingAnchoredHypervalentBranchOverlap(layoutGraph, coords, centerAtomId, descriptor) {
  let nudges = 0;
  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const maxStepCount = Math.ceil(
    RING_ANCHORED_HYPERVALENT_OVERLAP_RELIEF_MAX_ROTATION / RING_ANCHORED_HYPERVALENT_OVERLAP_RELIEF_STEP
  );

  for (const ringAnchorAtomId of descriptor.singleNeighborIds) {
    const anchorPosition = coords.get(ringAnchorAtomId);
    if (!anchorPosition) {
      continue;
    }
    const subtreeAtomIds = movableRingAnchoredHypervalentSubtreeAtomIds(layoutGraph, centerAtomId, ringAnchorAtomId, coords);
    if (!subtreeAtomIds) {
      continue;
    }

    const currentPositions = new Map();
    for (const subtreeAtomId of subtreeAtomIds) {
      const currentPosition = coords.get(subtreeAtomId);
      if (currentPosition) {
        currentPositions.set(subtreeAtomId, currentPosition);
      }
    }
    if (currentPositions.size === 0) {
      continue;
    }

    const currentOverlapState = countSevereOverlapsWithOverrides(layoutGraph, coords, currentPositions, bondLength);
    if (currentOverlapState.count === 0) {
      continue;
    }

    let bestFit = null;
    for (let stepIndex = 1; stepIndex <= maxStepCount; stepIndex++) {
      for (const direction of [1, -1]) {
        const rotation = direction * stepIndex * RING_ANCHORED_HYPERVALENT_OVERLAP_RELIEF_STEP;
        const candidatePositions = new Map();
        for (const [subtreeAtomId, currentPosition] of currentPositions) {
          const offset = sub(currentPosition, anchorPosition);
          const radius = distance(anchorPosition, currentPosition);
          const absoluteAngle = angleOf(offset);
          candidatePositions.set(subtreeAtomId, add(anchorPosition, fromAngle(absoluteAngle + rotation, radius)));
        }
        const overlapState = countSevereOverlapsWithOverrides(layoutGraph, coords, candidatePositions, bondLength);
        const candidateFit = { positions: candidatePositions, overlapState, rotation };
        if (isBetterRingAnchoredOverlapReliefFit(candidateFit, bestFit)) {
          bestFit = candidateFit;
        }
      }
    }

    if (!bestFit || !improvesRingAnchoredOverlapState(bestFit.overlapState, currentOverlapState)) {
      continue;
    }
    for (const [subtreeAtomId, candidatePosition] of bestFit.positions) {
      coords.set(subtreeAtomId, candidatePosition);
    }
    nudges++;
  }
  return nudges;
}

/**
 * Returns whether a compact hypervalent branch attached to a ring atom is off
 * that ring atom's local outward bisector enough to merit a rigid rotation.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Orthogonal hypervalent descriptor.
 * @param {number} angleThreshold - Angular tolerance in radians.
 * @returns {boolean} True when a compact ring-anchored branch should be aligned.
 */
function hasRingAnchoredHypervalentBranchNeed(layoutGraph, coords, centerAtomId, descriptor, angleThreshold) {
  for (const ringAnchorAtomId of descriptor.singleNeighborIds) {
    const anchorPosition = coords.get(ringAnchorAtomId);
    const centerPosition = coords.get(centerAtomId);
    if (!anchorPosition || !centerPosition) {
      continue;
    }
    const subtreeAtomIds = movableRingAnchoredHypervalentSubtreeAtomIds(layoutGraph, centerAtomId, ringAnchorAtomId, coords);
    if (!subtreeAtomIds) {
      continue;
    }
    const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, ringAnchorAtomId, atomId => coords.get(atomId) ?? null);
    if (outwardAngles.length === 0) {
      continue;
    }
    const currentAngle = angleOf(sub(centerPosition, anchorPosition));
    const targetAngle = outwardAngles
      .slice()
      .sort((firstAngle, secondAngle) => angularDifference(currentAngle, firstAngle) - angularDifference(currentAngle, secondAngle))[0];
    if (targetAngle != null && angularDifference(currentAngle, targetAngle) > angleThreshold) {
      const rotation = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
      const candidatePositions = new Map();
      for (const subtreeAtomId of subtreeAtomIds) {
        const currentPosition = coords.get(subtreeAtomId);
        if (!currentPosition) {
          continue;
        }
        const offset = sub(currentPosition, anchorPosition);
        const radius = distance(anchorPosition, currentPosition);
        const absoluteAngle = angleOf(offset);
        candidatePositions.set(subtreeAtomId, add(anchorPosition, fromAngle(absoluteAngle + rotation, radius)));
      }
      if (
        candidatePositions.size > 0
        && preservesSevereOverlapState(
          layoutGraph,
          coords,
          candidatePositions,
          layoutGraph.options?.bondLength ?? distance(anchorPosition, centerPosition)
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function weightedAngleCost(currentAngles, movableNeighborIds, neighborAtomId, targetAngle) {
  const weight = movableNeighborIds.has(neighborAtomId) ? 1 : FIXED_LIGAND_WEIGHT;
  return weight * angularDifference(currentAngles.get(neighborAtomId), targetAngle) ** 2;
}

function orthogonalTargetPermutations(descriptor) {
  if (descriptor?.kind !== 'bis-oxo') {
    return [
      [0, 1, 2, 3],
      [0, 1, 3, 2],
      [0, 2, 1, 3],
      [0, 2, 3, 1],
      [0, 3, 1, 2],
      [0, 3, 2, 1],
      [1, 0, 2, 3],
      [1, 0, 3, 2],
      [1, 2, 0, 3],
      [1, 2, 3, 0],
      [1, 3, 0, 2],
      [1, 3, 2, 0],
      [2, 0, 1, 3],
      [2, 0, 3, 1],
      [2, 1, 0, 3],
      [2, 1, 3, 0],
      [2, 3, 0, 1],
      [2, 3, 1, 0],
      [3, 0, 1, 2],
      [3, 0, 2, 1],
      [3, 1, 0, 2],
      [3, 1, 2, 0],
      [3, 2, 0, 1],
      [3, 2, 1, 0]
    ];
  }

  const permutations = [];
  for (const singlePair of [[0, 2], [1, 3]]) {
    const multiplePair = [0, 1, 2, 3].filter(slotIndex => !singlePair.includes(slotIndex));
    for (const singleOrder of [[singlePair[0], singlePair[1]], [singlePair[1], singlePair[0]]]) {
      for (const multipleOrder of [[multiplePair[0], multiplePair[1]], [multiplePair[1], multiplePair[0]]]) {
        permutations.push([...singleOrder, ...multipleOrder]);
      }
    }
  }
  return permutations;
}

function fitOrthogonalTargets(descriptor, currentAngles, movableNeighborIds) {
  const neighborAtomIds = [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds];
  if (neighborAtomIds.length !== 4) {
    return null;
  }

  const slotOffsets = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const permutations = orthogonalTargetPermutations(descriptor);
  const candidateAlphas = neighborAtomIds.flatMap(neighborAtomId =>
    slotOffsets.map(slotOffset => currentAngles.get(neighborAtomId) - slotOffset)
  );

  let bestFit = null;
  for (const alpha of candidateAlphas) {
    const targetAngles = slotOffsets.map(slotOffset => wrapAngleUnsigned(alpha + slotOffset));
    for (const permutation of permutations) {
      let cost = 0;
      const assignments = new Map();
      for (let neighborIndex = 0; neighborIndex < neighborAtomIds.length; neighborIndex++) {
        const neighborAtomId = neighborAtomIds[neighborIndex];
        const targetAngle = targetAngles[permutation[neighborIndex]];
        cost += weightedAngleCost(currentAngles, movableNeighborIds, neighborAtomId, targetAngle);
        assignments.set(neighborAtomId, targetAngle);
      }
      if (!bestFit || cost < bestFit.cost) {
        bestFit = {
          cost,
          targetAngles: assignments
        };
      }
    }
  }
  return bestFit;
}

function strictOrthogonalCenterDeviation(coords, centerAtomId, descriptor) {
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return 0;
  }
  const neighborAtomIds = [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds];
  const currentAngles = new Map(
    neighborAtomIds.map(neighborAtomId => [
      neighborAtomId,
      angleOf(sub(coords.get(neighborAtomId), centerPosition))
    ])
  );
  const fit = fitOrthogonalTargets(descriptor, currentAngles, new Set(neighborAtomIds));
  return fit?.cost ?? 0;
}

function rotateLigandSubtreeAroundCenter(layoutGraph, coords, centerAtomId, ligandAtomId, targetAngle) {
  const centerPosition = coords.get(centerAtomId);
  const ligandPosition = coords.get(ligandAtomId);
  if (!centerPosition || !ligandPosition) {
    return { coords, rotationMagnitude: 0 };
  }
  const currentAngle = angleOf(sub(ligandPosition, centerPosition));
  const rotation = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
  if (Math.abs(rotation) <= 1e-9) {
    return { coords, rotationMagnitude: 0 };
  }

  const nextCoords = new Map(coords);
  for (const subtreeAtomId of collectCutSubtree(layoutGraph, ligandAtomId, centerAtomId)) {
    const currentPosition = coords.get(subtreeAtomId);
    if (!currentPosition) {
      continue;
    }
    const offset = sub(currentPosition, centerPosition);
    nextCoords.set(
      subtreeAtomId,
      add(centerPosition, fromAngle(angleOf(offset) + rotation, distance(centerPosition, currentPosition)))
    );
  }
  return {
    coords: nextCoords,
    rotationMagnitude: Math.abs(rotation)
  };
}

function rotateOrganosiliconLigandSubtree(layoutGraph, coords, centerAtomId, ligandAtomId, targetAngle) {
  return rotateLigandSubtreeAroundCenter(layoutGraph, coords, centerAtomId, ligandAtomId, targetAngle);
}

function crossCandidateAuditDoesNotRegress(candidateAudit, incumbentAudit) {
  if (incumbentAudit.ok === true && candidateAudit.ok !== true) {
    return false;
  }
  for (const key of [
    'severeOverlapCount',
    'visibleHeavyBondCrossingCount',
    'bondLengthFailureCount',
    'mildBondLengthFailureCount',
    'severeBondLengthFailureCount',
    'collapsedMacrocycleCount',
    'labelOverlapCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount'
  ]) {
    if ((candidateAudit[key] ?? 0) > (incumbentAudit[key] ?? 0)) {
      return false;
    }
  }
  return !((candidateAudit.stereoContradiction ?? false) && !(incumbentAudit.stereoContradiction ?? false));
}

function compareHypervalentCrossCandidates(candidate, incumbent) {
  if (!incumbent) {
    return -1;
  }
  if (candidate.audit.ok !== incumbent.audit.ok) {
    return candidate.audit.ok ? -1 : 1;
  }
  for (const key of [
    'severeOverlapCount',
    'visibleHeavyBondCrossingCount',
    'bondLengthFailureCount',
    'collapsedMacrocycleCount',
    'ringSubstituentReadabilityFailureCount',
    'inwardRingSubstituentCount',
    'outwardAxisRingSubstituentFailureCount',
    'labelOverlapCount'
  ]) {
    if ((candidate.audit[key] ?? 0) !== (incumbent.audit[key] ?? 0)) {
      return (candidate.audit[key] ?? 0) - (incumbent.audit[key] ?? 0);
    }
  }
  if (Math.abs(candidate.deviation - incumbent.deviation) > 1e-12) {
    return candidate.deviation - incumbent.deviation;
  }
  if (Math.abs(candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation) > 1e-9) {
    return candidate.audit.maxBondLengthDeviation - incumbent.audit.maxBondLengthDeviation;
  }
  return candidate.rotationMagnitude - incumbent.rotationMagnitude;
}

function rotateTerminalMultipleLigandToAngle(layoutGraph, coords, centerAtomId, ligandAtomId, targetAngle) {
  const centerPosition = coords.get(centerAtomId);
  const ligandPosition = coords.get(ligandAtomId);
  if (!centerPosition || !ligandPosition) {
    return coords;
  }
  const nextCoords = new Map(coords);
  nextCoords.set(
    ligandAtomId,
    compressedTerminalMultipleLigandPosition(
      layoutGraph,
      coords,
      centerAtomId,
      ligandAtomId,
      targetAngle,
      distance(centerPosition, ligandPosition)
    )
  );
  return nextCoords;
}

function ringLinkedBisOxoExactCrossCandidate(layoutGraph, coords, centerAtomId, descriptor) {
  if (!isRingLinkedBisOxoCenter(layoutGraph, centerAtomId, descriptor)) {
    return null;
  }
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition || descriptor.singleNeighborIds.length !== 2 || descriptor.multipleNeighborIds.length !== 2) {
    return null;
  }

  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const incumbentAudit = auditLayout(layoutGraph, coords, { bondLength });
  const singleAngles = new Map(
    descriptor.singleNeighborIds.map(neighborAtomId => [
      neighborAtomId,
      angleOf(sub(coords.get(neighborAtomId), centerPosition))
    ])
  );
  let bestCandidate = null;

  for (const fixedSingleAtomId of descriptor.singleNeighborIds) {
    const movingSingleAtomId = descriptor.singleNeighborIds.find(neighborAtomId => neighborAtomId !== fixedSingleAtomId);
    const fixedAngle = singleAngles.get(fixedSingleAtomId);
    if (!movingSingleAtomId || fixedAngle == null) {
      continue;
    }

    for (const oxoDirection of [1, -1]) {
      const targetAngles = new Map([
        [fixedSingleAtomId, fixedAngle],
        [movingSingleAtomId, fixedAngle + Math.PI],
        [descriptor.multipleNeighborIds[0], fixedAngle + oxoDirection * Math.PI / 2],
        [descriptor.multipleNeighborIds[1], fixedAngle - oxoDirection * Math.PI / 2]
      ]);
      let candidateCoords = new Map(coords);
      let rotationMagnitude = 0;
      const rotatedSingle = rotateLigandSubtreeAroundCenter(
        layoutGraph,
        candidateCoords,
        centerAtomId,
        movingSingleAtomId,
        targetAngles.get(movingSingleAtomId)
      );
      candidateCoords = rotatedSingle.coords;
      rotationMagnitude += rotatedSingle.rotationMagnitude;

      for (const multipleNeighborId of descriptor.multipleNeighborIds) {
        const targetAngle = targetAngles.get(multipleNeighborId);
        const currentAngle = angleOf(sub(candidateCoords.get(multipleNeighborId), centerPosition));
        candidateCoords = rotateTerminalMultipleLigandToAngle(
          layoutGraph,
          candidateCoords,
          centerAtomId,
          multipleNeighborId,
          targetAngle
        );
        rotationMagnitude += angularDifference(currentAngle, targetAngle);
      }

      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (!crossCandidateAuditDoesNotRegress(candidateAudit, incumbentAudit)) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        deviation: strictOrthogonalCenterDeviation(candidateCoords, centerAtomId, descriptor),
        rotationMagnitude
      };
      if (compareHypervalentCrossCandidates(candidate, bestCandidate) < 0) {
        bestCandidate = candidate;
      }
    }
  }

  const incumbentDeviation = strictOrthogonalCenterDeviation(coords, centerAtomId, descriptor);
  if (!bestCandidate || bestCandidate.deviation >= incumbentDeviation - 1e-12) {
    return null;
  }
  return bestCandidate;
}

/**
 * Returns the fixed ring-carbon and movable nitrogen ligands for a
 * ring-attached sulfonamide center. These centers can complete a clean sulfur
 * cross by rotating the nitrogen side as one rigid branch while the aromatic
 * ring attachment stays fixed.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {{fixedSingleAtomId: string, movingSingleAtomId: string}|null} Cross ligands, or `null`.
 */
function ringAnchoredSulfonamideCrossLigands(layoutGraph, centerAtomId, descriptor) {
  const centerAtom = layoutGraph.atoms.get(centerAtomId);
  if (
    centerAtom?.element !== 'S'
    || descriptor?.kind !== 'bis-oxo'
    || descriptor.singleNeighborIds.length !== 2
    || descriptor.multipleNeighborIds.length !== 2
    || (layoutGraph.atomToRings.get(centerAtomId)?.length ?? 0) > 0
  ) {
    return null;
  }

  const ringCarbonAtomId = descriptor.singleNeighborIds.find(neighborAtomId => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return Boolean(
      neighborAtom?.element === 'C'
      && neighborAtom.aromatic === true
      && (layoutGraph.atomToRings.get(neighborAtomId)?.length ?? 0) > 0
    );
  });
  const nitrogenAtomId = descriptor.singleNeighborIds.find(neighborAtomId => {
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    return neighborAtom?.element === 'N' && neighborAtom.aromatic !== true;
  });
  if (!ringCarbonAtomId || !nitrogenAtomId || ringCarbonAtomId === nitrogenAtomId) {
    return null;
  }
  return {
    fixedSingleAtomId: ringCarbonAtomId,
    movingSingleAtomId: nitrogenAtomId
  };
}

/**
 * Builds an exact sulfur-cross candidate for bulky aryl sulfonamides by
 * leaving the ring attachment fixed, rotating the nitrogen-side subtree, and
 * snapping both terminal oxo ligands onto the perpendicular axis.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Sulfur center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {{coords: Map<string, {x: number, y: number}>, audit: object, deviation: number, rotationMagnitude: number}|null} Accepted candidate, or `null`.
 */
function ringAnchoredSulfonamideExactCrossCandidate(layoutGraph, coords, centerAtomId, descriptor) {
  const ligands = ringAnchoredSulfonamideCrossLigands(layoutGraph, centerAtomId, descriptor);
  const centerPosition = coords.get(centerAtomId);
  if (!ligands || !centerPosition) {
    return null;
  }

  const fixedPosition = coords.get(ligands.fixedSingleAtomId);
  if (!fixedPosition) {
    return null;
  }

  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const incumbentAudit = auditLayout(layoutGraph, coords, { bondLength });
  const fixedAngle = angleOf(sub(fixedPosition, centerPosition));
  const incumbentDeviation = strictOrthogonalCenterDeviation(coords, centerAtomId, descriptor);
  let bestCandidate = null;

  for (const oxoDirection of [1, -1]) {
    const targetAngles = new Map([
      [ligands.fixedSingleAtomId, fixedAngle],
      [ligands.movingSingleAtomId, fixedAngle + Math.PI],
      [descriptor.multipleNeighborIds[0], fixedAngle + oxoDirection * Math.PI / 2],
      [descriptor.multipleNeighborIds[1], fixedAngle - oxoDirection * Math.PI / 2]
    ]);
    let candidateCoords = new Map(coords);
    let rotationMagnitude = 0;
    const rotatedSingle = rotateLigandSubtreeAroundCenter(
      layoutGraph,
      candidateCoords,
      centerAtomId,
      ligands.movingSingleAtomId,
      targetAngles.get(ligands.movingSingleAtomId)
    );
    candidateCoords = rotatedSingle.coords;
    rotationMagnitude += rotatedSingle.rotationMagnitude;

    for (const multipleNeighborId of descriptor.multipleNeighborIds) {
      const targetAngle = targetAngles.get(multipleNeighborId);
      const currentAngle = angleOf(sub(candidateCoords.get(multipleNeighborId), centerPosition));
      candidateCoords = rotateTerminalMultipleLigandToAngle(
        layoutGraph,
        candidateCoords,
        centerAtomId,
        multipleNeighborId,
        targetAngle
      );
      rotationMagnitude += angularDifference(currentAngle, targetAngle);
    }

    const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
    if (!crossCandidateAuditDoesNotRegress(candidateAudit, incumbentAudit)) {
      continue;
    }
    const candidate = {
      coords: candidateCoords,
      audit: candidateAudit,
      deviation: strictOrthogonalCenterDeviation(candidateCoords, centerAtomId, descriptor),
      rotationMagnitude
    };
    if (compareHypervalentCrossCandidates(candidate, bestCandidate) < 0) {
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate || bestCandidate.deviation >= incumbentDeviation - 1e-12) {
    return null;
  }
  return bestCandidate;
}

/**
 * Aryl-bearing tetracarbon silanes read best as a four-way cross, but the
 * ligand that belongs to the principal scaffold may need to move too. Evaluate
 * full side rotations and accept only an audit-clean orthogonal pose.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Silicon center atom id.
 * @param {object} descriptor - Organosilicon descriptor.
 * @returns {number} Number of accepted ligand rotations.
 */
function orthogonalizeOrganosiliconCenter(layoutGraph, coords, centerAtomId, descriptor) {
  if (descriptor?.kind !== 'organosilicon' || descriptor.singleNeighborIds.length !== 4) {
    return 0;
  }
  const centerPosition = coords.get(centerAtomId);
  if (!centerPosition) {
    return 0;
  }

  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const incumbentAudit = auditLayout(layoutGraph, coords, { bondLength });
  const currentAngles = new Map(
    descriptor.singleNeighborIds.map(neighborAtomId => [
      neighborAtomId,
      angleOf(sub(coords.get(neighborAtomId), centerPosition))
    ])
  );
  const slotOffsets = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  const candidateAlphas = descriptor.singleNeighborIds.flatMap(neighborAtomId =>
    slotOffsets.map(slotOffset => currentAngles.get(neighborAtomId) - slotOffset)
  );
  const permutations = orthogonalTargetPermutations(descriptor);
  const visited = new Set();
  let bestCandidate = null;

  for (const alpha of candidateAlphas) {
    const targetAngles = slotOffsets.map(slotOffset => wrapAngleUnsigned(alpha + slotOffset));
    for (const permutation of permutations) {
      let candidateCoords = coords;
      let rotationMagnitude = 0;
      const signature = descriptor.singleNeighborIds
        .map((neighborAtomId, neighborIndex) => `${neighborAtomId}:${targetAngles[permutation[neighborIndex]].toFixed(9)}`)
        .join('|');
      if (visited.has(signature)) {
        continue;
      }
      visited.add(signature);

      for (let neighborIndex = 0; neighborIndex < descriptor.singleNeighborIds.length; neighborIndex++) {
        const neighborAtomId = descriptor.singleNeighborIds[neighborIndex];
        const rotated = rotateOrganosiliconLigandSubtree(
          layoutGraph,
          candidateCoords,
          centerAtomId,
          neighborAtomId,
          targetAngles[permutation[neighborIndex]]
        );
        candidateCoords = rotated.coords;
        rotationMagnitude += rotated.rotationMagnitude;
      }

      const candidateAudit = auditLayout(layoutGraph, candidateCoords, { bondLength });
      if (!crossCandidateAuditDoesNotRegress(candidateAudit, incumbentAudit)) {
        continue;
      }
      const candidate = {
        coords: candidateCoords,
        audit: candidateAudit,
        deviation: measureOrthogonalHypervalentDeviation(layoutGraph, candidateCoords, {
          focusAtomIds: new Set([centerAtomId])
        }),
        rotationMagnitude
      };
      if (compareHypervalentCrossCandidates(candidate, bestCandidate) < 0) {
        bestCandidate = candidate;
      }
    }
  }

  const incumbentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, coords, {
    focusAtomIds: new Set([centerAtomId])
  });
  if (!bestCandidate || bestCandidate.deviation >= incumbentDeviation - 1e-12) {
    return 0;
  }
  for (const [atomId, position] of bestCandidate.coords) {
    coords.set(atomId, position);
  }
  return descriptor.singleNeighborIds.filter(neighborAtomId =>
    angularDifference(currentAngles.get(neighborAtomId), angleOf(sub(coords.get(neighborAtomId), centerPosition))) > 1e-9
  ).length;
}

/**
 * Measures how far supported hypervalent centers deviate from the nearest
 * orthogonal cross-like presentation without mutating coordinates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{focusAtomIds?: Set<string>|null}} [options] - Optional local scoring focus.
 * @returns {number} Total squared angular deviation across supported centers.
 */
export function measureOrthogonalHypervalentDeviation(layoutGraph, coords, options = {}) {
  const focusAtomIds = options.focusAtomIds instanceof Set && options.focusAtomIds.size > 0 ? options.focusAtomIds : null;
  let totalDeviation = 0;

  for (const atomId of coords.keys()) {
    if (focusAtomIds && !focusAtomIds.has(atomId)) {
      continue;
    }
    const descriptor = describeOrthogonalHypervalentCenter(layoutGraph, atomId, coords);
    if (!descriptor) {
      continue;
    }
    const centerPosition = coords.get(atomId);
    const ringEmbeddedFit = fitRingEmbeddedBisOxoTargets(layoutGraph, coords, atomId, descriptor);
    if (ringEmbeddedFit) {
      totalDeviation += ringEmbeddedFit.cost;
      continue;
    }
    const ringLinkedExactCrossCandidate = ringLinkedBisOxoExactCrossCandidate(layoutGraph, coords, atomId, descriptor);
    if (ringLinkedExactCrossCandidate) {
      totalDeviation += strictOrthogonalCenterDeviation(coords, atomId, descriptor);
      continue;
    }
    const ringLinkedFit = fitRingLinkedBisOxoTargets(layoutGraph, coords, atomId, descriptor);
    if (ringLinkedFit) {
      totalDeviation += ringLinkedFit.cost;
      continue;
    }

    const currentAngles = new Map(
      [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds].map(neighborAtomId => [
        neighborAtomId,
        angleOf(sub(coords.get(neighborAtomId), centerPosition))
      ])
    );
    const allNeighborIds = new Set([...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds]);
    const fit = fitOrthogonalTargets(descriptor, currentAngles, allNeighborIds);
    totalDeviation += fit?.cost ?? 0;
  }

  return totalDeviation;
}

function severeOverlapsTouchingDirectLigands(layoutGraph, coords, centerAtomId) {
  const ligandAtomIds = new Set(directLigandAtomIds(layoutGraph, centerAtomId, coords));
  if (ligandAtomIds.size === 0) {
    return [];
  }
  return findSevereOverlaps(layoutGraph, coords, layoutGraph.options?.bondLength ?? 1.5)
    .filter(overlap => ligandAtomIds.has(overlap.firstAtomId) || ligandAtomIds.has(overlap.secondAtomId));
}

/**
 * Counts severe overlaps touching one of a center's direct ligands.
 * @param {Array<{firstAtomId: string, secondAtomId: string}>} overlaps - Severe overlap pairs.
 * @param {Set<string>} directLigandAtomIds - Direct ligand atom ids.
 * @returns {number} Number of overlaps involving a direct ligand.
 */
function countDirectLigandSevereOverlaps(overlaps, directLigandAtomIds) {
  return overlaps.filter(overlap =>
    directLigandAtomIds.has(overlap.firstAtomId) || directLigandAtomIds.has(overlap.secondAtomId)
  ).length;
}

function directTerminalMultipleLigandIds(layoutGraph, centerAtomId, coords) {
  return directLigandAtomIds(layoutGraph, centerAtomId, coords).filter(ligandAtomId =>
    isTerminalMultipleHypervalentLigand(layoutGraph, centerAtomId, ligandAtomId)
  );
}

function directTerminalMultipleLigandOppositionDeviation(coords, centerPosition, terminalLigandIds) {
  if (terminalLigandIds.length !== 2) {
    return 0;
  }
  const [firstLigandId, secondLigandId] = terminalLigandIds;
  const firstPosition = coords.get(firstLigandId);
  const secondPosition = coords.get(secondLigandId);
  if (!firstPosition || !secondPosition) {
    return 0;
  }
  return Math.abs(
    Math.PI
      - angularDifference(
          angleOf(sub(firstPosition, centerPosition)),
          angleOf(sub(secondPosition, centerPosition))
        )
  );
}

function directTerminalMultipleLigandReliefOverrides(
  coords,
  centerPosition,
  terminalLigandIds,
  ligandAtomId,
  targetAngle,
  radius
) {
  const singleLigandOverride = new Map([[ligandAtomId, add(centerPosition, fromAngle(targetAngle, radius))]]);
  if (terminalLigandIds.length !== 2) {
    return [singleLigandOverride];
  }

  const oppositeLigandId = terminalLigandIds.find(terminalLigandId => terminalLigandId !== ligandAtomId);
  const oppositeLigandPosition = oppositeLigandId ? coords.get(oppositeLigandId) : null;
  if (!oppositeLigandId || !oppositeLigandPosition) {
    return [singleLigandOverride];
  }

  const oppositeLigandRadius = distance(centerPosition, oppositeLigandPosition);
  return [
    new Map([
      ...singleLigandOverride,
      [oppositeLigandId, add(centerPosition, fromAngle(targetAngle + Math.PI, oppositeLigandRadius))]
    ]),
    singleLigandOverride
  ];
}

function isBetterDirectTerminalLigandReliefCandidate(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.severeOverlapCount !== incumbent.severeOverlapCount) {
    return candidate.severeOverlapCount < incumbent.severeOverlapCount;
  }
  if (candidate.directOverlapCount !== incumbent.directOverlapCount) {
    return candidate.directOverlapCount < incumbent.directOverlapCount;
  }
  if (Math.abs(candidate.terminalPairDeviation - incumbent.terminalPairDeviation) > 1e-9) {
    return candidate.terminalPairDeviation < incumbent.terminalPairDeviation;
  }
  if (Math.abs(candidate.hypervalentDeviation - incumbent.hypervalentDeviation) > 1e-9) {
    return candidate.hypervalentDeviation < incumbent.hypervalentDeviation;
  }
  if (Math.abs(candidate.minOverlapDistance - incumbent.minOverlapDistance) > 1e-9) {
    return candidate.minOverlapDistance > incumbent.minOverlapDistance;
  }
  return candidate.rotationMagnitude < incumbent.rotationMagnitude;
}

/**
 * Lets one direct terminal oxo-like ligand bend a few degrees off an otherwise
 * exact cross when the exact slot creates a severe clash with a nearby ring
 * atom. This is intentionally narrower than general hypervalent fitting: it
 * only accepts moves that improve the severe-overlap state and keep the center
 * within a small visual-deviation budget.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @returns {number} Number of accepted terminal ligand rotations.
 */
function relieveDirectTerminalMultipleLigandOverlaps(layoutGraph, coords, centerAtomId) {
  const terminalLigandIds = directTerminalMultipleLigandIds(layoutGraph, centerAtomId, coords);
  if (terminalLigandIds.length === 0) {
    return 0;
  }

  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const maxStepCount = Math.ceil(
    DIRECT_TERMINAL_MULTIPLE_LIGAND_RELIEF_MAX_ROTATION / DIRECT_TERMINAL_MULTIPLE_LIGAND_RELIEF_STEP
  );
  let nudges = 0;

  for (let pass = 0; pass < terminalLigandIds.length; pass++) {
    const currentOverlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
    const terminalLigandSet = new Set(terminalLigandIds);
    const currentDirectOverlapCount = countDirectLigandSevereOverlaps(currentOverlaps, terminalLigandSet);
    if (currentDirectOverlapCount === 0) {
      break;
    }

    const currentBondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
    const currentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, coords, {
      focusAtomIds: new Set([centerAtomId])
    });
    const maxAllowedDeviation = Math.max(
      currentDeviation + 1e-9,
      DIRECT_TERMINAL_MULTIPLE_LIGAND_RELIEF_MAX_HYPERVALENT_DEVIATION
    );
    const centerPosition = coords.get(centerAtomId);
    if (!centerPosition) {
      break;
    }

    let bestCandidate = null;
    for (const ligandAtomId of terminalLigandIds) {
      if (
        !currentOverlaps.some(overlap =>
          overlap.firstAtomId === ligandAtomId || overlap.secondAtomId === ligandAtomId
        )
      ) {
        continue;
      }
      const ligandPosition = coords.get(ligandAtomId);
      if (!ligandPosition) {
        continue;
      }
      const currentAngle = angleOf(sub(ligandPosition, centerPosition));
      const radius = distance(centerPosition, ligandPosition);
      for (let stepIndex = 1; stepIndex <= maxStepCount; stepIndex++) {
        for (const direction of [1, -1]) {
          const rotation = direction * stepIndex * DIRECT_TERMINAL_MULTIPLE_LIGAND_RELIEF_STEP;
          const targetAngle = currentAngle + rotation;
          const overrideOptions = directTerminalMultipleLigandReliefOverrides(
            coords,
            centerPosition,
            terminalLigandIds,
            ligandAtomId,
            targetAngle,
            radius
          );
          for (const overridePositions of overrideOptions) {
            const candidateOverlapState = countSevereOverlapsWithOverrides(
              layoutGraph,
              coords,
              overridePositions,
              bondLength
            );
            if (candidateOverlapState.count > currentOverlaps.length) {
              continue;
            }
            const candidateCoords = new Map(coords);
            for (const [candidateAtomId, candidatePosition] of overridePositions) {
              candidateCoords.set(candidateAtomId, candidatePosition);
            }
            const candidateOverlaps = findSevereOverlaps(layoutGraph, candidateCoords, bondLength);
            const candidateDirectOverlapCount = countDirectLigandSevereOverlaps(candidateOverlaps, terminalLigandSet);
            if (
              candidateOverlaps.length >= currentOverlaps.length
              && candidateDirectOverlapCount >= currentDirectOverlapCount
            ) {
              continue;
            }

            const candidateBondDeviation = measureBondLengthDeviation(layoutGraph, candidateCoords, bondLength);
            const candidateDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, candidateCoords, {
              focusAtomIds: new Set([centerAtomId])
            });
            if (
              candidateBondDeviation.failingBondCount > currentBondDeviation.failingBondCount
              || candidateBondDeviation.maxDeviation > currentBondDeviation.maxDeviation + 1e-9
              || candidateDeviation > maxAllowedDeviation
            ) {
              continue;
            }

            const candidate = {
              positions: overridePositions,
              severeOverlapCount: candidateOverlaps.length,
              directOverlapCount: candidateDirectOverlapCount,
              terminalPairDeviation: directTerminalMultipleLigandOppositionDeviation(
                candidateCoords,
                centerPosition,
                terminalLigandIds
              ),
              hypervalentDeviation: candidateDeviation,
              minOverlapDistance: severeOverlapState(candidateOverlaps).minDistance,
              rotationMagnitude: Math.abs(rotation)
            };
            if (isBetterDirectTerminalLigandReliefCandidate(candidate, bestCandidate)) {
              bestCandidate = candidate;
            }
          }
        }
      }
    }

    if (!bestCandidate) {
      break;
    }
    for (const [candidateAtomId, candidatePosition] of bestCandidate.positions) {
      coords.set(candidateAtomId, candidatePosition);
    }
    nudges++;
  }

  return nudges;
}

/**
 * Returns whether two atoms are joined by a non-aromatic single covalent bond.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} firstAtomId - First atom id.
 * @param {string} secondAtomId - Second atom id.
 * @returns {boolean} True when the bond can act as a small relief hinge.
 */
function isSingleCovalentBond(layoutGraph, firstAtomId, secondAtomId) {
  return (layoutGraph.bondsByAtomId.get(firstAtomId) ?? []).some(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === firstAtomId ? bond.b : bond.a;
    return neighborAtomId === secondAtomId;
  });
}

/**
 * Finds a terminal leaf on the non-hypervalent side of a direct-ligand overlap
 * that can rotate around its immediate parent before the parent branch bends.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {Set<string>} directLigandAtomIds - Direct ligand atom ids.
 * @param {{firstAtomId: string, secondAtomId: string}} overlap - Severe overlap touching a direct ligand.
 * @returns {{anchorAtomId: string, subtreeAtomIds: string[]}|null} Terminal relief descriptor.
 */
function terminalLeafReliefDescriptorForOverlap(layoutGraph, coords, directLigandAtomIds, overlap) {
  const directAtomId = directLigandAtomIds.has(overlap.firstAtomId)
    ? overlap.firstAtomId
    : directLigandAtomIds.has(overlap.secondAtomId)
      ? overlap.secondAtomId
      : null;
  const crowdedAtomId = directAtomId === overlap.firstAtomId ? overlap.secondAtomId : overlap.firstAtomId;
  const crowdedAtom = layoutGraph.atoms.get(crowdedAtomId);
  if (
    !directAtomId
    || !crowdedAtom
    || crowdedAtom.element === 'H'
    || crowdedAtom.heavyDegree !== 1
    || directLigandAtomIds.has(crowdedAtomId)
    || !coords.has(crowdedAtomId)
  ) {
    return null;
  }

  const parentBond = (layoutGraph.bondsByAtomId.get(crowdedAtomId) ?? []).find(bond => {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      return false;
    }
    const neighborAtomId = bond.a === crowdedAtomId ? bond.b : bond.a;
    return !directLigandAtomIds.has(neighborAtomId) && coords.has(neighborAtomId);
  });
  if (!parentBond) {
    return null;
  }

  return {
    anchorAtomId: parentBond.a === crowdedAtomId ? parentBond.b : parentBond.a,
    leafAtomId: crowdedAtomId,
    leafParentAtomId: parentBond.a === crowdedAtomId ? parentBond.b : parentBond.a,
    subtreeAtomIds: [crowdedAtomId]
  };
}

/**
 * Collects a compact branch side that may move during local direct-ligand
 * relief without touching the hypervalent center or its direct ligands.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} rootAtomId - Root atom on the movable side.
 * @param {string} anchorAtomId - Anchor atom across the cut bond.
 * @param {Set<string>} directLigandAtomIds - Direct ligand atom ids.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @returns {string[]|null} Compact movable atom ids, or null when unsafe.
 */
function compactReliefSubtreeAtomIds(layoutGraph, coords, rootAtomId, anchorAtomId, directLigandAtomIds, centerAtomId) {
  const subtreeAtomIds = [...collectCutSubtree(layoutGraph, rootAtomId, anchorAtomId)]
    .filter(subtreeAtomId => coords.has(subtreeAtomId));
  if (
    subtreeAtomIds.length === 0
    || subtreeAtomIds.length > DIRECT_LIGAND_BRANCH_RELIEF_MAX_ATOMS
    || subtreeAtomIds.includes(centerAtomId)
    || subtreeAtomIds.some(subtreeAtomId => directLigandAtomIds.has(subtreeAtomId))
  ) {
    return null;
  }

  let heavyAtomCount = 0;
  for (const subtreeAtomId of subtreeAtomIds) {
    const subtreeAtom = layoutGraph.atoms.get(subtreeAtomId);
    if (!subtreeAtom) {
      return null;
    }
    if (subtreeAtom.element !== 'H') {
      heavyAtomCount++;
      if (heavyAtomCount > DIRECT_LIGAND_BRANCH_RELIEF_MAX_HEAVY_ATOMS) {
        return null;
      }
    }
  }
  return heavyAtomCount > 0 ? subtreeAtomIds : null;
}

/**
 * Measures how far a terminal leaf's parent branch root is from the exact
 * outward slot of an aromatic ring anchor.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{leafAtomId: string, leafParentAtomId: string}} descriptor - Terminal relief descriptor.
 * @param {Set<string>} directLigandAtomIds - Direct ligand atom ids.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @returns {{anchorAtomId: string, rootAtomId: string, subtreeAtomIds: string[], targetAngle: number, currentAngle: number, deviation: number}|null} Ring-exit snap descriptor.
 */
function terminalLeafParentRingExitDeviation(layoutGraph, coords, descriptor, directLigandAtomIds, centerAtomId) {
  const rootAtomId = descriptor.leafParentAtomId;
  if (!rootAtomId || !coords.has(rootAtomId)) {
    return null;
  }

  for (const bond of layoutGraph.bondsByAtomId.get(rootAtomId) ?? []) {
    if (!bond || bond.kind !== 'covalent' || bond.aromatic || (bond.order ?? 1) !== 1) {
      continue;
    }
    const anchorAtomId = bond.a === rootAtomId ? bond.b : bond.a;
    const anchorAtom = layoutGraph.atoms.get(anchorAtomId);
    if (
      anchorAtomId === descriptor.leafAtomId
      || !coords.has(anchorAtomId)
      || directLigandAtomIds.has(anchorAtomId)
      || anchorAtom?.element !== 'C'
      || anchorAtom.aromatic !== true
      || (layoutGraph.atomToRings.get(anchorAtomId)?.length ?? 0) === 0
    ) {
      continue;
    }
    const subtreeAtomIds = compactReliefSubtreeAtomIds(
      layoutGraph,
      coords,
      rootAtomId,
      anchorAtomId,
      directLigandAtomIds,
      centerAtomId
    );
    if (!subtreeAtomIds) {
      continue;
    }

    const anchorPosition = coords.get(anchorAtomId);
    const rootPosition = coords.get(rootAtomId);
    const outwardAngles = computeIncidentRingOutwardAngles(
      layoutGraph,
      anchorAtomId,
      atomId => coords.get(atomId) ?? null
    );
    if (!anchorPosition || !rootPosition || outwardAngles.length === 0) {
      continue;
    }
    const currentAngle = angleOf(sub(rootPosition, anchorPosition));
    const targetAngle = outwardAngles.reduce((bestAngle, candidateAngle) =>
      angularDifference(candidateAngle, currentAngle) < angularDifference(bestAngle, currentAngle)
        ? candidateAngle
        : bestAngle
    );
    return {
      anchorAtomId,
      rootAtomId,
      subtreeAtomIds,
      targetAngle,
      currentAngle,
      deviation: angularDifference(currentAngle, targetAngle)
    };
  }

  return null;
}

/**
 * Builds base coordinate variants for terminal leaf relief, including a tiny
 * exact ring-exit snap when the leaf's parent branch is already close.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{leafAtomId: string, leafParentAtomId: string}} descriptor - Terminal relief descriptor.
 * @param {Set<string>} directLigandAtomIds - Direct ligand atom ids.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @returns {Array<{coords: Map<string, {x: number, y: number}>, rootExitDeviation: number}>} Base coordinate candidates.
 */
function terminalLeafReliefBaseCandidates(layoutGraph, coords, descriptor, directLigandAtomIds, centerAtomId) {
  const candidates = [{ coords, rootExitDeviation: Number.POSITIVE_INFINITY }];
  const ringExitDeviation = terminalLeafParentRingExitDeviation(
    layoutGraph,
    coords,
    descriptor,
    directLigandAtomIds,
    centerAtomId
  );
  if (!ringExitDeviation) {
    return candidates;
  }

  candidates[0].rootExitDeviation = ringExitDeviation.deviation;
  if (ringExitDeviation.deviation <= 1e-9 || ringExitDeviation.deviation > ANGLE_THRESHOLD) {
    return candidates;
  }

  const rotation = Math.atan2(
    Math.sin(ringExitDeviation.targetAngle - ringExitDeviation.currentAngle),
    Math.cos(ringExitDeviation.targetAngle - ringExitDeviation.currentAngle)
  );
  const snappedCoords = rotatedBranchReliefCoords(
    coords,
    {
      anchorAtomId: ringExitDeviation.anchorAtomId,
      subtreeAtomIds: ringExitDeviation.subtreeAtomIds
    },
    rotation
  );
  if (snappedCoords) {
    candidates.unshift({ coords: snappedCoords, rootExitDeviation: 0 });
  }
  return candidates;
}

/**
 * Finds compact branch blocks adjacent to a direct-ligand overlap that can be
 * rotated as rigid relief candidates.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {Set<string>} directLigandAtomIds - Direct ligand atom ids.
 * @param {{firstAtomId: string, secondAtomId: string}} overlap - Severe overlap touching a direct ligand.
 * @returns {Array<{rootAtomId: string, anchorAtomId: string, subtreeAtomIds: string[]}>} Relief branch descriptors.
 */
function compactBranchReliefDescriptorsForOverlap(layoutGraph, coords, centerAtomId, directLigandAtomIds, overlap) {
  const directAtomId = directLigandAtomIds.has(overlap.firstAtomId)
    ? overlap.firstAtomId
    : directLigandAtomIds.has(overlap.secondAtomId)
      ? overlap.secondAtomId
      : null;
  const crowdedAtomId = directAtomId === overlap.firstAtomId ? overlap.secondAtomId : overlap.firstAtomId;
  if (!directAtomId || directLigandAtomIds.has(crowdedAtomId) || !coords.has(crowdedAtomId)) {
    return [];
  }

  const descriptors = [];
  const seenKeys = new Set();
  for (const parentBond of layoutGraph.bondsByAtomId.get(crowdedAtomId) ?? []) {
    if (!parentBond || parentBond.kind !== 'covalent') {
      continue;
    }
    const parentAtomId = parentBond.a === crowdedAtomId ? parentBond.b : parentBond.a;
    if (!coords.has(parentAtomId)) {
      continue;
    }
    for (const anchorBond of layoutGraph.bondsByAtomId.get(parentAtomId) ?? []) {
      if (!anchorBond || anchorBond.kind !== 'covalent') {
        continue;
      }
      const anchorAtomId = anchorBond.a === parentAtomId ? anchorBond.b : anchorBond.a;
      if (
        anchorAtomId === crowdedAtomId
        || !coords.has(anchorAtomId)
        || !isSingleCovalentBond(layoutGraph, parentAtomId, anchorAtomId)
      ) {
        continue;
      }

      const subtreeAtomIds = [...collectCutSubtree(layoutGraph, parentAtomId, anchorAtomId)]
        .filter(subtreeAtomId => coords.has(subtreeAtomId));
      if (
        subtreeAtomIds.length === 0
        || subtreeAtomIds.length > DIRECT_LIGAND_BRANCH_RELIEF_MAX_ATOMS
        || !subtreeAtomIds.includes(crowdedAtomId)
        || subtreeAtomIds.includes(centerAtomId)
        || subtreeAtomIds.some(subtreeAtomId => directLigandAtomIds.has(subtreeAtomId))
      ) {
        continue;
      }

      let heavyAtomCount = 0;
      for (const subtreeAtomId of subtreeAtomIds) {
        const subtreeAtom = layoutGraph.atoms.get(subtreeAtomId);
        if (!subtreeAtom) {
          heavyAtomCount = Number.POSITIVE_INFINITY;
          break;
        }
        if (subtreeAtom.element !== 'H') {
          heavyAtomCount++;
        }
      }
      if (heavyAtomCount === 0 || heavyAtomCount > DIRECT_LIGAND_BRANCH_RELIEF_MAX_HEAVY_ATOMS) {
        continue;
      }

      const descriptorKey = `${parentAtomId}:${anchorAtomId}`;
      if (seenKeys.has(descriptorKey)) {
        continue;
      }
      seenKeys.add(descriptorKey);
      descriptors.push({
        rootAtomId: parentAtomId,
        anchorAtomId,
        subtreeAtomIds
      });
    }
  }
  return descriptors;
}

/**
 * Builds a coordinate candidate with one compact branch rotated around its
 * anchor atom.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{anchorAtomId: string, subtreeAtomIds: string[]}} descriptor - Relief branch descriptor.
 * @param {number} angle - Rotation angle in radians.
 * @returns {Map<string, {x: number, y: number}>|null} Rotated coordinate candidate.
 */
function rotatedBranchReliefCoords(coords, descriptor, angle) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const candidateCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  for (const subtreeAtomId of descriptor.subtreeAtomIds) {
    const currentPosition = coords.get(subtreeAtomId);
    if (!currentPosition) {
      continue;
    }
    const offset = sub(currentPosition, anchorPosition);
    candidateCoords.set(
      subtreeAtomId,
      add(anchorPosition, fromAngle(angleOf(offset) + angle, distance(anchorPosition, currentPosition)))
    );
  }
  return candidateCoords;
}

/**
 * Same as `rotatedBranchReliefCoords` but returns only the moved subtree positions as a
 * sparse override map — avoiding the O(V) full-coord clone used for overlap screening.
 * @param {Map<string, {x: number, y: number}>} coords - Base coordinate map.
 * @param {{anchorAtomId: string, subtreeAtomIds: string[]}} descriptor - Rotation descriptor.
 * @param {number} angle - Rotation angle in radians.
 * @returns {Map<string, {x: number, y: number}>|null} Sparse override positions, or null when anchor is missing.
 */
function rotatedBranchReliefOverrides(coords, descriptor, angle) {
  const anchorPosition = coords.get(descriptor.anchorAtomId);
  if (!anchorPosition) {
    return null;
  }
  const overridePositions = new Map();
  for (const subtreeAtomId of descriptor.subtreeAtomIds) {
    const currentPosition = coords.get(subtreeAtomId);
    if (!currentPosition) {
      continue;
    }
    const offset = sub(currentPosition, anchorPosition);
    overridePositions.set(
      subtreeAtomId,
      add(anchorPosition, fromAngle(angleOf(offset) + angle, distance(anchorPosition, currentPosition)))
    );
  }
  return overridePositions.size > 0 ? overridePositions : null;
}


/**
 * Compares branch-relief candidates for direct-ligand overlap cleanup.
 * @param {object} candidate - Candidate relief score.
 * @param {object|null} incumbent - Current best candidate score.
 * @returns {boolean} True when the candidate is better.
 */
function isBetterDirectLigandBranchRelief(candidate, incumbent) {
  if (!incumbent) {
    return true;
  }
  if (candidate.severeOverlapCount !== incumbent.severeOverlapCount) {
    return candidate.severeOverlapCount < incumbent.severeOverlapCount;
  }
  if (candidate.directOverlapCount !== incumbent.directOverlapCount) {
    return candidate.directOverlapCount < incumbent.directOverlapCount;
  }
  if (Math.abs(candidate.maxBondDeviation - incumbent.maxBondDeviation) > 1e-9) {
    return candidate.maxBondDeviation < incumbent.maxBondDeviation;
  }
  if (Math.abs(candidate.hypervalentDeviation - incumbent.hypervalentDeviation) > 1e-9) {
    return candidate.hypervalentDeviation < incumbent.hypervalentDeviation;
  }
  if (Math.abs((candidate.rootExitDeviation ?? 0) - (incumbent.rootExitDeviation ?? 0)) > 1e-9) {
    return (candidate.rootExitDeviation ?? 0) < (incumbent.rootExitDeviation ?? 0);
  }
  return candidate.rotationMagnitude < incumbent.rotationMagnitude;
}

/**
 * Rotates a crowded terminal leaf away from a just-squared hypervalent ligand
 * before moving the larger branch root that carries it.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @returns {number} Number of accepted leaf rotations.
 */
function relieveDirectLigandOverlapsWithTerminalLeafRotation(layoutGraph, coords, centerAtomId) {
  const directLigandIds = new Set(directLigandAtomIds(layoutGraph, centerAtomId, coords));
  if (directLigandIds.size === 0) {
    return 0;
  }
  const overlapPairs = severeOverlapsTouchingDirectLigands(layoutGraph, coords, centerAtomId);
  if (overlapPairs.length === 0) {
    return 0;
  }

  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const currentOverlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  const currentDirectOverlapCount = countDirectLigandSevereOverlaps(currentOverlaps, directLigandIds);
  const currentBondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
  const currentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, coords, {
    focusAtomIds: new Set([centerAtomId])
  });
  let bestCandidate = null;

  for (const overlap of overlapPairs) {
    const descriptor = terminalLeafReliefDescriptorForOverlap(layoutGraph, coords, directLigandIds, overlap);
    if (!descriptor) {
      continue;
    }
    for (const baseCandidate of terminalLeafReliefBaseCandidates(layoutGraph, coords, descriptor, directLigandIds, centerAtomId)) {
      for (const angle of DIRECT_LIGAND_TERMINAL_LEAF_RELIEF_ANGLE_CANDIDATES) {
        const overridePositions = rotatedBranchReliefOverrides(baseCandidate.coords, descriptor, angle);
        if (!overridePositions) {
          continue;
        }
        // Fast-path: gate on overlap count using only the moved subtree.
        const candidateOverlapState = countSevereOverlapsWithOverrides(layoutGraph, baseCandidate.coords, overridePositions, bondLength);
        const candidateCoords = rotatedBranchReliefCoords(baseCandidate.coords, descriptor, angle);
        if (!candidateCoords) {
          continue;
        }
        const candidateDirectOverlapCount = countDirectLigandSevereOverlaps(
          findSevereOverlaps(layoutGraph, candidateCoords, bondLength),
          directLigandIds
        );
        if (
          candidateOverlapState.count >= currentOverlaps.length
          || candidateDirectOverlapCount >= currentDirectOverlapCount
        ) {
          continue;
        }

        const candidateBondDeviation = measureBondLengthDeviation(layoutGraph, candidateCoords, bondLength);
        const candidateDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, candidateCoords, {
          focusAtomIds: new Set([centerAtomId])
        });
        if (
          candidateBondDeviation.failingBondCount > currentBondDeviation.failingBondCount
          || candidateBondDeviation.maxDeviation > currentBondDeviation.maxDeviation + 1e-9
          || candidateDeviation > currentDeviation + 1e-9
        ) {
          continue;
        }

        const candidate = {
          coords: candidateCoords,
          severeOverlapCount: candidateOverlapState.count,
          directOverlapCount: candidateDirectOverlapCount,
          maxBondDeviation: candidateBondDeviation.maxDeviation,
          hypervalentDeviation: candidateDeviation,
          rootExitDeviation: baseCandidate.rootExitDeviation,
          rotationMagnitude: Math.abs(angle)
        };
        if (isBetterDirectLigandBranchRelief(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    }
  }

  if (!bestCandidate) {
    return 0;
  }
  for (const [atomId, position] of bestCandidate.coords) {
    coords.set(atomId, position);
  }
  return 1;
}

/**
 * Rotates a compact branch near a direct hypervalent ligand when the exact
 * cross pushes a terminal oxo into a small substituent. This keeps the newly
 * squared center intact and only accepts moves that reduce the global severe
 * overlap count.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @returns {number} Number of accepted branch rotations.
 */
function relieveDirectLigandOverlapsWithBranchRotation(layoutGraph, coords, centerAtomId) {
  const directLigandIds = new Set(directLigandAtomIds(layoutGraph, centerAtomId, coords));
  if (directLigandIds.size === 0) {
    return 0;
  }
  const overlapPairs = severeOverlapsTouchingDirectLigands(layoutGraph, coords, centerAtomId);
  if (overlapPairs.length === 0) {
    return 0;
  }

  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const currentOverlaps = findSevereOverlaps(layoutGraph, coords, bondLength);
  const currentDirectOverlapCount = countDirectLigandSevereOverlaps(currentOverlaps, directLigandIds);
  const currentBondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
  const currentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, coords, {
    focusAtomIds: new Set([centerAtomId])
  });
  let bestCandidate = null;

  for (const overlap of overlapPairs) {
    const descriptors = compactBranchReliefDescriptorsForOverlap(
      layoutGraph,
      coords,
      centerAtomId,
      directLigandIds,
      overlap
    );
    for (const descriptor of descriptors) {
      for (const angle of DIRECT_LIGAND_BRANCH_RELIEF_ANGLE_CANDIDATES) {
        const overridePositions = rotatedBranchReliefOverrides(coords, descriptor, angle);
        if (!overridePositions) {
          continue;
        }
        // Fast-path: gate on overlap count using only the moved subtree.
        const candidateOverlapState = countSevereOverlapsWithOverrides(layoutGraph, coords, overridePositions, bondLength);
        if (candidateOverlapState.count >= currentOverlaps.length) {
          continue;
        }
        const candidateCoords = rotatedBranchReliefCoords(coords, descriptor, angle);
        if (!candidateCoords) {
          continue;
        }
        const candidateDirectOverlapCount = countDirectLigandSevereOverlaps(
          findSevereOverlaps(layoutGraph, candidateCoords, bondLength),
          directLigandIds
        );
        if (candidateDirectOverlapCount >= currentDirectOverlapCount) {
          continue;
        }

        const candidateBondDeviation = measureBondLengthDeviation(layoutGraph, candidateCoords, bondLength);
        const candidateDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, candidateCoords, {
          focusAtomIds: new Set([centerAtomId])
        });
        if (
          candidateBondDeviation.failingBondCount > currentBondDeviation.failingBondCount
          || candidateBondDeviation.maxDeviation > currentBondDeviation.maxDeviation + 1e-9
          || candidateDeviation > currentDeviation + 1e-9
        ) {
          continue;
        }

        const candidate = {
          coords: candidateCoords,
          severeOverlapCount: candidateOverlapState.count,
          directOverlapCount: candidateDirectOverlapCount,
          maxBondDeviation: candidateBondDeviation.maxDeviation,
          hypervalentDeviation: candidateDeviation,
          rotationMagnitude: Math.abs(angle)
        };
        if (isBetterDirectLigandBranchRelief(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }
    }
  }

  if (!bestCandidate) {
    return 0;
  }
  for (const [atomId, position] of bestCandidate.coords) {
    coords.set(atomId, position);
  }
  return 1;
}

/**
 * Lets nearby rotatable branches clear a freshly squared hypervalent center
 * without moving the center or its direct ligands. This preserves the exact
 * sulfur/phosphorus cross while avoiding rejection when a neighboring ring
 * substituent is the atom that needs to yield.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @returns {number} Number of accepted local cleanup passes.
 */
function relieveDirectLigandOverlapsWithLocalCleanup(layoutGraph, coords, centerAtomId) {
  const overlapPairs = severeOverlapsTouchingDirectLigands(layoutGraph, coords, centerAtomId);
  if (overlapPairs.length === 0) {
    return 0;
  }

  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const currentSevereOverlapCount = findSevereOverlaps(layoutGraph, coords, bondLength).length;
  const currentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, coords, {
    focusAtomIds: new Set([centerAtomId])
  });
  const frozenAtomIds = new Set([centerAtomId, ...directLigandAtomIds(layoutGraph, centerAtomId, coords)]);
  const cleanup = runLocalCleanup(layoutGraph, coords, {
    maxPasses: HYPERVALENT_DIRECT_LIGAND_LOCAL_RELIEF_MAX_PASSES,
    bondLength,
    frozenAtomIds,
    overlapPairs
  });
  if (!cleanup || !(cleanup.coords instanceof Map) || (cleanup.passes ?? 0) <= 0) {
    return 0;
  }

  const candidateDirectOverlapCount = severeOverlapsTouchingDirectLigands(
    layoutGraph,
    cleanup.coords,
    centerAtomId
  ).length;
  const candidateSevereOverlapCount = findSevereOverlaps(layoutGraph, cleanup.coords, bondLength).length;
  const candidateDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, cleanup.coords, {
    focusAtomIds: new Set([centerAtomId])
  });
  if (
    candidateDirectOverlapCount >= overlapPairs.length
    || candidateSevereOverlapCount > currentSevereOverlapCount
    || candidateDeviation > currentDeviation + 1e-9
  ) {
    return 0;
  }

  for (const [atomId, position] of cleanup.coords) {
    coords.set(atomId, position);
  }
  return cleanup.passes ?? 0;
}

/**
 * Lets rigid pendant-ring overlap cleanup clear severe contacts introduced by
 * an otherwise exact hypervalent cross, while rejecting any result that bends
 * the just-squared center or trades the clash for bond-length damage.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Mutable coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @returns {number} Number of accepted overlap-resolution moves.
 */
function relieveDirectLigandOverlapsWithRigidCleanup(layoutGraph, coords, centerAtomId) {
  const overlapPairs = severeOverlapsTouchingDirectLigands(layoutGraph, coords, centerAtomId);
  if (overlapPairs.length === 0) {
    return 0;
  }

  const bondLength = layoutGraph.options?.bondLength ?? 1.5;
  const currentSevereOverlapCount = findSevereOverlaps(layoutGraph, coords, bondLength).length;
  const currentBondDeviation = measureBondLengthDeviation(layoutGraph, coords, bondLength);
  const currentDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, coords, {
    focusAtomIds: new Set([centerAtomId])
  });
  const cleanup = resolveOverlaps(layoutGraph, coords, {
    maxPasses: 2,
    bondLength
  });
  if (!cleanup || !(cleanup.coords instanceof Map) || (cleanup.moves ?? 0) <= 0) {
    return 0;
  }

  const candidateDirectOverlapCount = severeOverlapsTouchingDirectLigands(
    layoutGraph,
    cleanup.coords,
    centerAtomId
  ).length;
  const candidateSevereOverlapCount = findSevereOverlaps(layoutGraph, cleanup.coords, bondLength).length;
  const candidateBondDeviation = measureBondLengthDeviation(layoutGraph, cleanup.coords, bondLength);
  const candidateDeviation = measureOrthogonalHypervalentDeviation(layoutGraph, cleanup.coords, {
    focusAtomIds: new Set([centerAtomId])
  });
  const allowsSmallReliefDeviation =
    currentDeviation <= 1e-9
    && candidateDirectOverlapCount < overlapPairs.length
    && candidateDeviation <= DIRECT_LIGAND_OVERLAP_RELIEF_MAX_HYPERVALENT_DEVIATION;
  if (
    candidateDirectOverlapCount >= overlapPairs.length
    || candidateSevereOverlapCount > currentSevereOverlapCount
    || candidateBondDeviation.failingBondCount > currentBondDeviation.failingBondCount
    || candidateBondDeviation.maxDeviation > currentBondDeviation.maxDeviation + 1e-9
    || (!allowsSmallReliefDeviation && candidateDeviation > currentDeviation + 1e-9)
  ) {
    return 0;
  }

  for (const [atomId, position] of cleanup.coords) {
    coords.set(atomId, position);
  }
  return cleanup.moves ?? 0;
}

/**
 * Returns whether the current layout still contains a supported hypervalent
 * center that can materially benefit from orthogonalization.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {{angleThreshold?: number}} [options] - Optional threshold overrides.
 * @returns {boolean} True when the tidy should run.
 */
export function hasHypervalentAngleTidyNeed(layoutGraph, coords, options = {}) {
  const angleThreshold = options.angleThreshold ?? ANGLE_THRESHOLD;
  const ringAnchoredAngleThreshold = options.ringAnchoredAngleThreshold ?? RING_ANCHORED_HYPERVALENT_ANGLE_THRESHOLD;

  for (const centerAtomId of coords.keys()) {
    const descriptor = describeOrthogonalHypervalentCenter(layoutGraph, centerAtomId, coords);
    if (!descriptor) {
      continue;
    }

    const centerPosition = coords.get(centerAtomId);
    const ringEmbeddedFit = fitRingEmbeddedBisOxoTargets(layoutGraph, coords, centerAtomId, descriptor);
    if (ringEmbeddedFit && centerPosition) {
      for (const neighborAtomId of descriptor.multipleNeighborIds) {
        const targetAngle = ringEmbeddedFit.targetAngles.get(neighborAtomId);
        if (targetAngle == null) {
          continue;
        }
        const currentAngle = angleOf(sub(coords.get(neighborAtomId), centerPosition));
        const ligandThreshold = hypervalentLigandAngleThreshold(layoutGraph, centerAtomId, neighborAtomId, angleThreshold);
        if (angularDifference(currentAngle, targetAngle) > ligandThreshold) {
          return true;
        }
      }
      continue;
    }
    const ringLinkedExactCrossCandidate = ringLinkedBisOxoExactCrossCandidate(layoutGraph, coords, centerAtomId, descriptor);
    if (
      ringLinkedExactCrossCandidate
      && strictOrthogonalCenterDeviation(coords, centerAtomId, descriptor) > angleThreshold
    ) {
      return true;
    }
    const ringAnchoredSulfonamideCrossCandidate = ringAnchoredSulfonamideExactCrossCandidate(layoutGraph, coords, centerAtomId, descriptor);
    if (
      ringAnchoredSulfonamideCrossCandidate
      && strictOrthogonalCenterDeviation(coords, centerAtomId, descriptor) > angleThreshold
    ) {
      return true;
    }
    const ringLinkedFit = fitRingLinkedBisOxoTargets(layoutGraph, coords, centerAtomId, descriptor);
    if (ringLinkedFit && centerPosition) {
      for (const neighborAtomId of descriptor.multipleNeighborIds) {
        const targetAngle = ringLinkedFit.targetAngles.get(neighborAtomId);
        if (targetAngle == null) {
          continue;
        }
        const currentAngle = angleOf(sub(coords.get(neighborAtomId), centerPosition));
        const ligandThreshold = hypervalentLigandAngleThreshold(layoutGraph, centerAtomId, neighborAtomId, angleThreshold);
        if (angularDifference(currentAngle, targetAngle) > ligandThreshold) {
          return true;
        }
      }
      continue;
    }

    const movableNeighborIds = new Set(
      [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds].filter(neighborAtomId => {
        const subtreeAtomIds = movableLigandSubtreeAtomIds(layoutGraph, centerAtomId, neighborAtomId, coords);
        return Array.isArray(subtreeAtomIds) && subtreeAtomIds.length > 0;
      })
    );
    if (movableNeighborIds.size > 0) {
      const currentAngles = new Map(
        [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds].map(neighborAtomId => [
          neighborAtomId,
          angleOf(sub(coords.get(neighborAtomId), centerPosition))
        ])
      );
      const fit = fitOrthogonalTargets(descriptor, currentAngles, movableNeighborIds);
      if (fit) {
        for (const neighborAtomId of movableNeighborIds) {
          const targetAngle = fit.targetAngles.get(neighborAtomId);
          if (targetAngle == null) {
            continue;
          }
          const ligandThreshold = hypervalentLigandAngleThreshold(layoutGraph, centerAtomId, neighborAtomId, angleThreshold);
          if (angularDifference(currentAngles.get(neighborAtomId), targetAngle) > ligandThreshold) {
            return true;
          }
        }
      }
    }

    if (hasRingAnchoredHypervalentBranchNeed(layoutGraph, coords, centerAtomId, descriptor, ringAnchoredAngleThreshold)) {
      return true;
    }
  }

  return false;
}

/**
 * Nudges supported hypervalent centers back toward orthogonal presentation
 * while preserving bond lengths by rigidly rotating movable terminal ligands.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @returns {{coords: Map<string, {x: number, y: number}>, nudges: number}} Adjusted coordinates and move count.
 */
export function runHypervalentAngleTidy(layoutGraph, inputCoords) {
  const coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const centerAtomIds = [...coords.keys()].sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
  let nudges = 0;

  for (const centerAtomId of centerAtomIds) {
    const descriptor = describeOrthogonalHypervalentCenter(layoutGraph, centerAtomId, coords);
    if (!descriptor) {
      continue;
    }
    if (descriptor.kind === 'organosilicon') {
      nudges += orthogonalizeOrganosiliconCenter(layoutGraph, coords, centerAtomId, descriptor);
      continue;
    }

    const movableSubtreesByNeighborId = new Map(
      [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds]
        .map(neighborAtomId => [neighborAtomId, movableLigandSubtreeAtomIds(layoutGraph, centerAtomId, neighborAtomId, coords)])
        .filter(([, subtreeAtomIds]) => Array.isArray(subtreeAtomIds) && subtreeAtomIds.length > 0)
    );
    const movableNeighborIds = new Set(movableSubtreesByNeighborId.keys());
    const centerPosition = coords.get(centerAtomId);
    const ringEmbeddedFit = fitRingEmbeddedBisOxoTargets(layoutGraph, coords, centerAtomId, descriptor);

    if (ringEmbeddedFit && centerPosition) {
      for (const neighborAtomId of descriptor.multipleNeighborIds) {
        const subtreeAtomIds = movableSubtreesByNeighborId.get(neighborAtomId);
        const targetAngle = ringEmbeddedFit.targetAngles.get(neighborAtomId);
        if (!subtreeAtomIds || targetAngle == null) {
          continue;
        }
        const currentAngle = angleOf(sub(coords.get(neighborAtomId), centerPosition));
        const ligandThreshold = hypervalentLigandAngleThreshold(layoutGraph, centerAtomId, neighborAtomId, ANGLE_THRESHOLD);
        if (angularDifference(currentAngle, targetAngle) <= ligandThreshold) {
          continue;
        }
        const rotation = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
        for (const subtreeAtomId of subtreeAtomIds) {
          const currentPosition = coords.get(subtreeAtomId);
          if (!currentPosition) {
            continue;
          }
          const offset = sub(currentPosition, centerPosition);
          const radius = distance(centerPosition, currentPosition);
          const absoluteAngle = angleOf(offset);
          const targetSubtreeAngle = absoluteAngle + rotation;
          const nextPosition = subtreeAtomId === neighborAtomId
            ? compressedTerminalMultipleLigandPosition(layoutGraph, coords, centerAtomId, neighborAtomId, targetSubtreeAngle, radius)
            : add(centerPosition, fromAngle(targetSubtreeAngle, radius));
          coords.set(subtreeAtomId, nextPosition);
        }
        nudges++;
      }
      nudges += relieveTerminalMultipleLeafOverlapsNearHypervalentCenter(layoutGraph, coords, centerAtomId);
      nudges += relieveAcyclicAnchoredHypervalentBranchOverlap(layoutGraph, coords, centerAtomId, descriptor);
      nudges += relieveDirectLigandOverlapsWithTerminalLeafRotation(layoutGraph, coords, centerAtomId);
      nudges += relieveDirectLigandOverlapsWithBranchRotation(layoutGraph, coords, centerAtomId);
      nudges += relieveDirectLigandOverlapsWithLocalCleanup(layoutGraph, coords, centerAtomId);
      nudges += relieveDirectLigandOverlapsWithRigidCleanup(layoutGraph, coords, centerAtomId);
      continue;
    }

    const ringLinkedExactCrossCandidate = ringLinkedBisOxoExactCrossCandidate(layoutGraph, coords, centerAtomId, descriptor);
    if (
      ringLinkedExactCrossCandidate
      && strictOrthogonalCenterDeviation(coords, centerAtomId, descriptor) > ANGLE_THRESHOLD
    ) {
      for (const [atomId, position] of ringLinkedExactCrossCandidate.coords) {
        coords.set(atomId, position);
      }
      nudges += 1;
      continue;
    }

    const ringAnchoredSulfonamideCrossCandidate = ringAnchoredSulfonamideExactCrossCandidate(layoutGraph, coords, centerAtomId, descriptor);
    if (
      ringAnchoredSulfonamideCrossCandidate
      && strictOrthogonalCenterDeviation(coords, centerAtomId, descriptor) > ANGLE_THRESHOLD
    ) {
      for (const [atomId, position] of ringAnchoredSulfonamideCrossCandidate.coords) {
        coords.set(atomId, position);
      }
      nudges += 1;
      continue;
    }

    const ringLinkedFit = fitRingLinkedBisOxoTargets(layoutGraph, coords, centerAtomId, descriptor);
    if (ringLinkedFit && centerPosition) {
      for (const neighborAtomId of descriptor.multipleNeighborIds) {
        const subtreeAtomIds = movableSubtreesByNeighborId.get(neighborAtomId);
        const targetAngle = ringLinkedFit.targetAngles.get(neighborAtomId);
        if (!subtreeAtomIds || targetAngle == null) {
          continue;
        }
        const currentAngle = angleOf(sub(coords.get(neighborAtomId), centerPosition));
        const ligandThreshold = hypervalentLigandAngleThreshold(layoutGraph, centerAtomId, neighborAtomId, ANGLE_THRESHOLD);
        if (angularDifference(currentAngle, targetAngle) <= ligandThreshold) {
          continue;
        }
        const rotation = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
        for (const subtreeAtomId of subtreeAtomIds) {
          const currentPosition = coords.get(subtreeAtomId);
          if (!currentPosition) {
            continue;
          }
          const offset = sub(currentPosition, centerPosition);
          const radius = distance(centerPosition, currentPosition);
          const absoluteAngle = angleOf(offset);
          const targetSubtreeAngle = absoluteAngle + rotation;
          const nextPosition = subtreeAtomId === neighborAtomId
            ? compressedTerminalMultipleLigandPosition(layoutGraph, coords, centerAtomId, neighborAtomId, targetSubtreeAngle, radius)
            : add(centerPosition, fromAngle(targetSubtreeAngle, radius));
          coords.set(subtreeAtomId, nextPosition);
        }
        nudges++;
      }
      nudges += relieveTerminalMultipleLeafOverlapsNearHypervalentCenter(layoutGraph, coords, centerAtomId);
      nudges += relieveAcyclicAnchoredHypervalentBranchOverlap(layoutGraph, coords, centerAtomId, descriptor);
      nudges += relieveDirectLigandOverlapsWithTerminalLeafRotation(layoutGraph, coords, centerAtomId);
      nudges += relieveDirectLigandOverlapsWithBranchRotation(layoutGraph, coords, centerAtomId);
      nudges += relieveDirectLigandOverlapsWithLocalCleanup(layoutGraph, coords, centerAtomId);
      nudges += relieveDirectLigandOverlapsWithRigidCleanup(layoutGraph, coords, centerAtomId);
      continue;
    }

    if (movableSubtreesByNeighborId.size > 0) {
      const currentAngles = new Map(
        [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds].map(neighborAtomId => [
          neighborAtomId,
          angleOf(sub(coords.get(neighborAtomId), centerPosition))
        ])
      );
      const fit = fitOrthogonalTargets(descriptor, currentAngles, movableNeighborIds);
      if (fit) {
        for (const neighborAtomId of movableNeighborIds) {
          const targetAngle = fit.targetAngles.get(neighborAtomId);
          const ligandThreshold = hypervalentLigandAngleThreshold(layoutGraph, centerAtomId, neighborAtomId, ANGLE_THRESHOLD);
          if (targetAngle == null || angularDifference(currentAngles.get(neighborAtomId), targetAngle) <= ligandThreshold) {
            continue;
          }
          const currentAngle = currentAngles.get(neighborAtomId);
          const rotation = Math.atan2(Math.sin(targetAngle - currentAngle), Math.cos(targetAngle - currentAngle));
          const subtreeAtomIds = movableSubtreesByNeighborId.get(neighborAtomId) ?? [neighborAtomId];
          for (const subtreeAtomId of subtreeAtomIds) {
            const currentPosition = coords.get(subtreeAtomId);
            if (!currentPosition) {
              continue;
            }
            const offset = sub(currentPosition, centerPosition);
            const radius = distance(centerPosition, currentPosition);
            const absoluteAngle = angleOf(offset);
            const targetSubtreeAngle = absoluteAngle + rotation;
            const nextPosition = subtreeAtomId === neighborAtomId
              ? compressedTerminalMultipleLigandPosition(layoutGraph, coords, centerAtomId, neighborAtomId, targetSubtreeAngle, radius)
              : add(centerPosition, fromAngle(targetSubtreeAngle, radius));
            coords.set(subtreeAtomId, nextPosition);
          }
          nudges++;
        }
      }
    }

    nudges += alignRingAnchoredHypervalentBranch(layoutGraph, coords, centerAtomId, descriptor);
    nudges += relieveRingAnchoredHypervalentBranchOverlap(layoutGraph, coords, centerAtomId, descriptor);
    nudges += relieveTerminalMultipleLeafOverlapsNearHypervalentCenter(layoutGraph, coords, centerAtomId);
    nudges += relieveAcyclicAnchoredHypervalentBranchOverlap(layoutGraph, coords, centerAtomId, descriptor);
    nudges += relieveDirectLigandOverlapsWithTerminalLeafRotation(layoutGraph, coords, centerAtomId);
    nudges += relieveDirectLigandOverlapsWithBranchRotation(layoutGraph, coords, centerAtomId);
    nudges += relieveDirectLigandOverlapsWithLocalCleanup(layoutGraph, coords, centerAtomId);
    nudges += relieveDirectLigandOverlapsWithRigidCleanup(layoutGraph, coords, centerAtomId);
    nudges += relieveDirectTerminalMultipleLigandOverlaps(layoutGraph, coords, centerAtomId);
  }

  return { coords, nudges };
}
