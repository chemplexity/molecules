/** @module cleanup/hypervalent-angle-tidy */

import { add, angleOf, distance, fromAngle, sub } from '../geometry/vec2.js';
import { collectCutSubtree } from './subtree-utils.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';

const ORTHOGONAL_HYPERVALENT_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);
const ANGLE_THRESHOLD = Math.PI / 18;
const FIXED_LIGAND_WEIGHT = 4;
const BRIDGE_LINKED_HYPERVALENT_LIGAND_ELEMENTS = new Set(['N', 'O', 'S', 'Se']);
const MAX_BRIDGE_LINKED_HYPERVALENT_SUBTREE_HEAVY_ATOMS = 8;
const MAX_COMPACT_HYPERVALENT_LIGAND_SUBTREE_HEAVY_ATOMS = 12;
const MAX_COMPACT_HYPERVALENT_LIGAND_SUBTREE_ATOMS = 24;

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

function directLigandAtomIds(layoutGraph, centerAtomId, coords) {
  const ligandAtomIds = [];
  for (const bond of layoutGraph.bondsByAtomId.get(centerAtomId) ?? []) {
    const ligandAtomId = bond.a === centerAtomId ? bond.b : bond.a;
    const ligandAtom = layoutGraph.atoms.get(ligandAtomId);
    if (!ligandAtom || ligandAtom.element === 'H' || !coords.has(ligandAtomId)) {
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
    if (!neighborAtom || neighborAtom.element === 'H' || !coords.has(neighborAtomId)) {
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
    return { kind: 'mono-oxo', singleNeighborIds, multipleNeighborIds };
  }
  return null;
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
    || ringSystemIds.size > 1
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
  if (!ligandAtom || ligandAtom.element === 'H' || !coords.has(ligandAtomId)) {
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

  for (const centerAtomId of coords.keys()) {
    const descriptor = describeOrthogonalHypervalentCenter(layoutGraph, centerAtomId, coords);
    if (!descriptor) {
      continue;
    }

    const centerPosition = coords.get(centerAtomId);
    const movableNeighborIds = new Set(
      [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds].filter(neighborAtomId => {
        const subtreeAtomIds = movableLigandSubtreeAtomIds(layoutGraph, centerAtomId, neighborAtomId, coords);
        return Array.isArray(subtreeAtomIds) && subtreeAtomIds.length > 0;
      })
    );
    if (movableNeighborIds.size === 0) {
      continue;
    }

    const currentAngles = new Map(
      [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds].map(neighborAtomId => [
        neighborAtomId,
        angleOf(sub(coords.get(neighborAtomId), centerPosition))
      ])
    );
    const fit = fitOrthogonalTargets(descriptor, currentAngles, movableNeighborIds);
    if (!fit) {
      continue;
    }

    for (const neighborAtomId of movableNeighborIds) {
      const targetAngle = fit.targetAngles.get(neighborAtomId);
      if (targetAngle == null) {
        continue;
      }
      if (angularDistance(currentAngles.get(neighborAtomId), targetAngle) > angleThreshold) {
        return true;
      }
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
    if (movableSubtreesByNeighborId.size === 0) {
      continue;
    }

    const centerPosition = coords.get(centerAtomId);
    const currentAngles = new Map(
      [...descriptor.singleNeighborIds, ...descriptor.multipleNeighborIds].map(neighborAtomId => [
        neighborAtomId,
        angleOf(sub(coords.get(neighborAtomId), centerPosition))
      ])
    );
    const fit = fitOrthogonalTargets(descriptor, currentAngles, movableNeighborIds);
    if (!fit) {
      continue;
    }

    for (const neighborAtomId of movableNeighborIds) {
      const targetAngle = fit.targetAngles.get(neighborAtomId);
      if (targetAngle == null || angularDistance(currentAngles.get(neighborAtomId), targetAngle) <= ANGLE_THRESHOLD) {
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
        coords.set(subtreeAtomId, add(centerPosition, fromAngle(absoluteAngle + rotation, radius)));
      }
      nudges++;
    }
  }

  return { coords, nudges };
}
