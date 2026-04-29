/** @module cleanup/hypervalent-angle-tidy */

import { add, angleOf, distance, fromAngle, sub } from '../geometry/vec2.js';
import { computeIncidentRingOutwardAngles } from '../geometry/ring-direction.js';
import { ringEmbeddedBisOxoSpread } from '../geometry/ring-hypervalent.js';
import { collectCutSubtree } from './subtree-utils.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { atomPairKey, SEVERE_OVERLAP_FACTOR } from '../constants.js';

const ORTHOGONAL_HYPERVALENT_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);
const ANGLE_THRESHOLD = Math.PI / 18;
const FIXED_LIGAND_WEIGHT = 12;
const BRIDGE_LINKED_HYPERVALENT_LIGAND_ELEMENTS = new Set(['N', 'O', 'S', 'Se']);
const MAX_BRIDGE_LINKED_HYPERVALENT_SUBTREE_HEAVY_ATOMS = 8;
const MAX_COMPACT_HYPERVALENT_LIGAND_SUBTREE_HEAVY_ATOMS = 14;
const MAX_COMPACT_HYPERVALENT_LIGAND_SUBTREE_ATOMS = 24;
const MAX_COMPACT_HYPERVALENT_LIGAND_RING_SYSTEMS = 2;
const MAX_RING_ANCHORED_HYPERVALENT_SUBTREE_HEAVY_ATOMS = 14;
const MAX_RING_ANCHORED_HYPERVALENT_SUBTREE_ATOMS = 28;
const TERMINAL_HYPERVALENT_H_ANGLE_THRESHOLD = Math.PI / 180;
const TERMINAL_HYPERVALENT_MULTIPLE_LIGAND_ANGLE_THRESHOLD = Math.PI / 180;
const RING_ANCHORED_HYPERVALENT_ANGLE_THRESHOLD = Math.PI / 180;
const TERMINAL_MULTIPLE_LIGAND_COMPRESSION_FACTORS = [1, 0.99, 0.98, 0.97, 0.96, 0.95];
const RING_EMBEDDED_BIS_OXO_MIN_SPREAD = Math.PI / 3;
const RING_EMBEDDED_BIS_OXO_SPREAD_STEP = Math.PI / 18;

function angularDistance(firstAngle, secondAngle) {
  const rawDelta = Math.abs(firstAngle - secondAngle) % (Math.PI * 2);
  return Math.min(rawDelta, Math.PI * 2 - rawDelta);
}

function normalizeAngle(angle) {
  let wrappedAngle = angle % (Math.PI * 2);
  if (wrappedAngle < 0) {
    wrappedAngle += Math.PI * 2;
  }
  return wrappedAngle;
}

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
 * Counts severe overlaps introduced by sparse candidate positions.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {Map<string, {x: number, y: number}>} overridePositions - Candidate atom positions.
 * @param {number} bondLength - Target layout bond length.
 * @returns {{count: number, minDistance: number}} Severe-overlap count and closest moved distance.
 */
function countSevereOverlapsWithOverrides(layoutGraph, coords, overridePositions, bondLength) {
  const threshold = bondLength * SEVERE_OVERLAP_FACTOR;
  let count = 0;
  let minDistance = Infinity;
  const visitedPairKeys = new Set();

  for (const [atomId, position] of overridePositions) {
    if (!isVisibleLayoutAtom(layoutGraph, atomId)) {
      continue;
    }
    for (const [otherAtomId, otherBasePosition] of coords) {
      if (
        atomId === otherAtomId
        || !isVisibleLayoutAtom(layoutGraph, otherAtomId)
        || layoutGraph.bondedPairSet.has(atomPairKey(atomId, otherAtomId))
      ) {
        continue;
      }
      const pairKey = atomPairKey(atomId, otherAtomId);
      if (visitedPairKeys.has(pairKey)) {
        continue;
      }
      visitedPairKeys.add(pairKey);
      const otherPosition = overridePositions.get(otherAtomId) ?? otherBasePosition;
      const separation = distance(position, otherPosition);
      minDistance = Math.min(minDistance, separation);
      if (separation < threshold - 1e-9) {
        count++;
      }
    }
  }

  return {
    count,
    minDistance: Number.isFinite(minDistance) ? minDistance : Infinity
  };
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
 * Chooses the longest terminal multiple-bond ligand position that preserves
 * the exact hypervalent angle while clearing severe local overlap. This is
 * reserved for terminal oxo-like leaves, where a very small display bond
 * compression is preferable to bending the sulfur/phosphorus cross.
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
  let bestPosition = add(centerPosition, fromAngle(targetAngle, radius));
  for (const compressionFactor of TERMINAL_MULTIPLE_LIGAND_COMPRESSION_FACTORS) {
    const candidatePosition = add(centerPosition, fromAngle(targetAngle, radius * compressionFactor));
    if (!hasSevereOverlapAtPosition(layoutGraph, coords, ligandAtomId, candidatePosition, bondLength)) {
      return candidatePosition;
    }
    bestPosition = candidatePosition;
  }
  return bestPosition;
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

function describeOrthogonalHypervalentCenter(layoutGraph, atomId, coords) {
  if (!layoutGraph) {
    return null;
  }
  const atom = layoutGraph.atoms.get(atomId);
  if (!atom || !ORTHOGONAL_HYPERVALENT_ELEMENTS.has(atom.element) || !coords.has(atomId)) {
    return null;
  }

  const ligandAtomIds = directLigandAtomIds(layoutGraph, atomId, coords);
  const singleNeighborIds = [];
  const multipleNeighborIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(atomId) ?? []) {
    if (bond.kind !== 'covalent' || bond.aromatic) {
      return null;
    }
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = layoutGraph.atoms.get(neighborAtomId);
    if (!neighborAtom || !coords.has(neighborAtomId)) {
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

  if (ligandAtomIds.length !== 4) {
    return null;
  }
  if (singleNeighborIds.length === 2 && multipleNeighborIds.length === 2) {
    return { kind: 'bis-oxo', singleNeighborIds, multipleNeighborIds };
  }
  if (singleNeighborIds.length === 3 && multipleNeighborIds.length === 1) {
    if (singleNeighborIds.some(neighborAtomId => layoutGraph.atoms.get(neighborAtomId)?.element === 'H')) {
      return null;
    }
    return { kind: 'mono-oxo', singleNeighborIds, multipleNeighborIds };
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
      cost += angularDistance(currentAngles.get(ligandAtomId), targetAngle) ** 2;
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
  if (Math.abs((candidateFit.minOverlapDistance ?? Infinity) - (incumbentFit.minOverlapDistance ?? Infinity)) > 1e-9) {
    return (candidateFit.minOverlapDistance ?? Infinity) > (incumbentFit.minOverlapDistance ?? Infinity);
  }
  return candidateFit.cost < incumbentFit.cost;
}

/**
 * Fits the terminal oxo ligands of a ring-embedded bis-oxo center to an
 * exterior V centered on the local ring-outward direction.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} descriptor - Hypervalent center descriptor.
 * @returns {{cost: number, targetAngles: Map<string, number>}|null} Exterior-V fit, or `null`.
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
  const incidentRings = (layoutGraph.atomToRings.get(centerAtomId) ?? []).filter(ring =>
    descriptor.singleNeighborIds.every(neighborAtomId => ring.atomIds.includes(neighborAtomId))
  );
  for (const outwardAngle of outwardAngles) {
    for (const ring of incidentRings) {
      for (const spread of ringEmbeddedBisOxoSpreadCandidates(ringEmbeddedBisOxoSpread(ring.atomIds.length))) {
        const targetAngles = [
          normalizeAngle(outwardAngle - spread / 2),
          normalizeAngle(outwardAngle + spread / 2)
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
          spread
        };
        if (isBetterRingEmbeddedBisOxoFit(candidateFit, bestFit)) {
          bestFit = candidateFit;
        }
      }
    }
  }
  if (!bestFit) {
    const targetAngles = [
      normalizeAngle(outwardAngles[0] - ringEmbeddedBisOxoSpread(3) / 2),
      normalizeAngle(outwardAngles[0] + ringEmbeddedBisOxoSpread(3) / 2)
    ];
    bestFit = fitTwoLigandTargets(descriptor.multipleNeighborIds, currentAngles, targetAngles);
  }
  return bestFit;
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
      .sort((firstAngle, secondAngle) => angularDistance(currentAngle, firstAngle) - angularDistance(currentAngle, secondAngle))[0];
    if (targetAngle == null || angularDistance(currentAngle, targetAngle) <= RING_ANCHORED_HYPERVALENT_ANGLE_THRESHOLD) {
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
      .sort((firstAngle, secondAngle) => angularDistance(currentAngle, firstAngle) - angularDistance(currentAngle, secondAngle))[0];
    if (targetAngle != null && angularDistance(currentAngle, targetAngle) > angleThreshold) {
      return true;
    }
  }
  return false;
}

function weightedAngleCost(currentAngles, movableNeighborIds, neighborAtomId, targetAngle) {
  const weight = movableNeighborIds.has(neighborAtomId) ? 1 : FIXED_LIGAND_WEIGHT;
  return weight * angularDistance(currentAngles.get(neighborAtomId), targetAngle) ** 2;
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
    const targetAngles = slotOffsets.map(slotOffset => normalizeAngle(alpha + slotOffset));
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
        if (angularDistance(currentAngle, targetAngle) > ligandThreshold) {
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
          if (angularDistance(currentAngles.get(neighborAtomId), targetAngle) > ligandThreshold) {
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
        if (angularDistance(currentAngle, targetAngle) <= ligandThreshold) {
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
          if (targetAngle == null || angularDistance(currentAngles.get(neighborAtomId), targetAngle) <= ligandThreshold) {
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
  }

  return { coords, nudges };
}
