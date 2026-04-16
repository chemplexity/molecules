/** @module cleanup/hypervalent-angle-tidy */

import { add, angleOf, angularDifference, distance, fromAngle, sub } from '../geometry/vec2.js';
import { collectCutSubtree } from './subtree-utils.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';

const ORTHOGONAL_HYPERVALENT_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);
const ANGLE_THRESHOLD = Math.PI / 18;
const FIXED_LIGAND_WEIGHT = 4;

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

function movableLigandSubtreeAtomIds(layoutGraph, centerAtomId, ligandAtomId, coords) {
  const ligandAtom = layoutGraph.atoms.get(ligandAtomId);
  if (!ligandAtom || ligandAtom.element === 'H' || !coords.has(ligandAtomId)) {
    return null;
  }
  if (ligandAtom.heavyDegree > 1) {
    return null;
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

function assignTwoNeighbors(neighborAtomIds, targetAngles, currentAngles, movableNeighborIds) {
  const directCost =
    weightedAngleCost(currentAngles, movableNeighborIds, neighborAtomIds[0], targetAngles[0])
    + weightedAngleCost(currentAngles, movableNeighborIds, neighborAtomIds[1], targetAngles[1]);
  const swappedCost =
    weightedAngleCost(currentAngles, movableNeighborIds, neighborAtomIds[0], targetAngles[1])
    + weightedAngleCost(currentAngles, movableNeighborIds, neighborAtomIds[1], targetAngles[0]);

  if (directCost <= swappedCost) {
    return {
      cost: directCost,
      assignments: new Map([
        [neighborAtomIds[0], targetAngles[0]],
        [neighborAtomIds[1], targetAngles[1]]
      ])
    };
  }
  return {
    cost: swappedCost,
    assignments: new Map([
      [neighborAtomIds[0], targetAngles[1]],
      [neighborAtomIds[1], targetAngles[0]]
    ])
  };
}

function evaluateBisOxoOrientation(alpha, descriptor, currentAngles, movableNeighborIds) {
  const normalizedAlpha = normalizeAngle(alpha);
  const singleAssignment = assignTwoNeighbors(
    descriptor.singleNeighborIds,
    [normalizedAlpha, normalizeAngle(normalizedAlpha + Math.PI)],
    currentAngles,
    movableNeighborIds
  );
  const multipleAssignment = assignTwoNeighbors(
    descriptor.multipleNeighborIds,
    [normalizeAngle(normalizedAlpha + Math.PI / 2), normalizeAngle(normalizedAlpha - Math.PI / 2)],
    currentAngles,
    movableNeighborIds
  );
  return {
    cost: singleAssignment.cost + multipleAssignment.cost,
    targetAngles: new Map([...singleAssignment.assignments, ...multipleAssignment.assignments])
  };
}

function fitBisOxoTargets(descriptor, currentAngles, movableNeighborIds) {
  const candidateAlphas = [];
  for (const singleNeighborId of descriptor.singleNeighborIds) {
    candidateAlphas.push(currentAngles.get(singleNeighborId));
    candidateAlphas.push(currentAngles.get(singleNeighborId) - Math.PI);
  }
  for (const multipleNeighborId of descriptor.multipleNeighborIds) {
    candidateAlphas.push(currentAngles.get(multipleNeighborId) - Math.PI / 2);
    candidateAlphas.push(currentAngles.get(multipleNeighborId) + Math.PI / 2);
  }

  let bestFit = null;
  for (const alpha of candidateAlphas) {
    const candidate = evaluateBisOxoOrientation(alpha, descriptor, currentAngles, movableNeighborIds);
    if (!bestFit || candidate.cost < bestFit.cost) {
      bestFit = candidate;
    }
  }
  return bestFit;
}

function evaluateMonoOxoOrientation(alpha, descriptor, axialSingleNeighborId, currentAngles, movableNeighborIds) {
  const normalizedAlpha = normalizeAngle(alpha);
  const multipleNeighborId = descriptor.multipleNeighborIds[0];
  const flankNeighborIds = descriptor.singleNeighborIds.filter(singleNeighborId => singleNeighborId !== axialSingleNeighborId);
  const flankAssignment = assignTwoNeighbors(
    flankNeighborIds,
    [normalizeAngle(normalizedAlpha + Math.PI / 2), normalizeAngle(normalizedAlpha - Math.PI / 2)],
    currentAngles,
    movableNeighborIds
  );
  const targetAngles = new Map([
    [axialSingleNeighborId, normalizedAlpha],
    [multipleNeighborId, normalizeAngle(normalizedAlpha + Math.PI)],
    ...flankAssignment.assignments
  ]);

  return {
    cost:
      weightedAngleCost(currentAngles, movableNeighborIds, axialSingleNeighborId, targetAngles.get(axialSingleNeighborId))
      + weightedAngleCost(currentAngles, movableNeighborIds, multipleNeighborId, targetAngles.get(multipleNeighborId))
      + flankAssignment.cost,
    targetAngles
  };
}

function fitMonoOxoTargets(descriptor, currentAngles, movableNeighborIds) {
  const multipleNeighborId = descriptor.multipleNeighborIds[0];
  let bestFit = null;

  for (const axialSingleNeighborId of descriptor.singleNeighborIds) {
    const flankNeighborIds = descriptor.singleNeighborIds.filter(singleNeighborId => singleNeighborId !== axialSingleNeighborId);
    const candidateAlphas = [
      currentAngles.get(axialSingleNeighborId),
      currentAngles.get(multipleNeighborId) - Math.PI,
      currentAngles.get(flankNeighborIds[0]) - Math.PI / 2,
      currentAngles.get(flankNeighborIds[0]) + Math.PI / 2,
      currentAngles.get(flankNeighborIds[1]) - Math.PI / 2,
      currentAngles.get(flankNeighborIds[1]) + Math.PI / 2
    ];

    for (const alpha of candidateAlphas) {
      const candidate = evaluateMonoOxoOrientation(alpha, descriptor, axialSingleNeighborId, currentAngles, movableNeighborIds);
      if (!bestFit || candidate.cost < bestFit.cost) {
        bestFit = candidate;
      }
    }
  }

  return bestFit;
}

function fitOrthogonalTargets(descriptor, currentAngles, movableNeighborIds) {
  if (descriptor.kind === 'bis-oxo') {
    return fitBisOxoTargets(descriptor, currentAngles, movableNeighborIds);
  }
  if (descriptor.kind === 'mono-oxo') {
    return fitMonoOxoTargets(descriptor, currentAngles, movableNeighborIds);
  }
  return null;
}

export function measureOrthogonalHypervalentDeviation(layoutGraph, coords) {
  let totalDeviation = 0;

  for (const atomId of coords.keys()) {
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
