/** @module stereo/enforcement */

import { measureLayoutCost } from '../audit/invariants.js';
import { actualAlkeneStereo, highestPriorityAlkeneSubstituentId, isSupportedAnnotatedDoubleBond, smallestQualifyingStereoRing } from './ez.js';

function collectSideAtoms(layoutGraph, startAtomId, blockedAtomId) {
  const sideAtomIds = new Set();
  const seen = new Set([blockedAtomId]);
  const queue = [startAtomId];

  while (queue.length > 0) {
    const atomId = queue.shift();
    if (seen.has(atomId)) {
      continue;
    }
    seen.add(atomId);
    sideAtomIds.add(atomId);

    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    for (const neighborAtom of atom.getNeighbors(layoutGraph.sourceMolecule)) {
      if (neighborAtom && !seen.has(neighborAtom.id)) {
        queue.push(neighborAtom.id);
      }
    }
  }

  return sideAtomIds;
}

/**
 * Builds a ring-only adjacency map with the alkene bond removed.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} ring - Ring descriptor.
 * @param {object} bond - Alkene bond descriptor.
 * @returns {Map<string, string[]>} Ring adjacency without the alkene bond.
 */
function buildCutRingAdjacency(layoutGraph, ring, bond) {
  const ringAtomIdSet = new Set(ring.atomIds);
  const adjacency = new Map(ring.atomIds.map(atomId => [atomId, []]));
  for (const ringAtomId of ring.atomIds) {
    for (const ringBond of layoutGraph.bondsByAtomId.get(ringAtomId) ?? []) {
      if (!ringBond || ringBond.kind !== 'covalent' || ringBond.inRing !== true) {
        continue;
      }
      const neighborAtomId = ringBond.a === ringAtomId ? ringBond.b : ringBond.a;
      if (!ringAtomIdSet.has(neighborAtomId)) {
        continue;
      }
      if ((ringBond.a === bond.a && ringBond.b === bond.b) || (ringBond.a === bond.b && ringBond.b === bond.a)) {
        continue;
      }
      adjacency.get(ringAtomId)?.push(neighborAtomId);
    }
  }
  return adjacency;
}

/**
 * Computes shortest-path distances from one ring atom through a cut ring graph.
 * @param {Map<string, string[]>} adjacency - Ring adjacency without the alkene bond.
 * @param {string} startAtomId - Starting ring atom id.
 * @returns {Map<string, number>} Distance by atom id.
 */
function cutRingDistances(adjacency, startAtomId) {
  const distances = new Map([[startAtomId, 0]]);
  const queue = [startAtomId];
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const atomId = queue[queueIndex++];
    const nextDistance = (distances.get(atomId) ?? 0) + 1;
    for (const neighborAtomId of adjacency.get(atomId) ?? []) {
      if (distances.has(neighborAtomId)) {
        continue;
      }
      distances.set(neighborAtomId, nextDistance);
      queue.push(neighborAtomId);
    }
  }

  return distances;
}

/**
 * Expands one ring side into the full movable side including attached substituents.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Set<string>} seedAtomIds - Ring atoms assigned to one side.
 * @param {Set<string>} blockedAtomIds - Ring atoms that must remain on the opposite side.
 * @returns {Set<string>} Movable side atoms including attached non-ring substituents.
 */
function expandRingSideAtoms(layoutGraph, seedAtomIds, blockedAtomIds) {
  const sideAtomIds = new Set();
  const queue = [...seedAtomIds];

  while (queue.length > 0) {
    const atomId = queue.shift();
    if (sideAtomIds.has(atomId) || blockedAtomIds.has(atomId)) {
      continue;
    }
    sideAtomIds.add(atomId);

    const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    for (const neighborAtom of atom.getNeighbors(layoutGraph.sourceMolecule)) {
      if (!neighborAtom || sideAtomIds.has(neighborAtom.id) || blockedAtomIds.has(neighborAtom.id)) {
        continue;
      }
      queue.push(neighborAtom.id);
    }
  }

  return sideAtomIds;
}

/**
 * Returns candidate movable sides for a medium/large cyclic alkene.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} bond - Alkene bond descriptor.
 * @returns {Array<Set<string>>} Candidate movable atom sets ordered from smaller to larger.
 */
function collectRingReflectionSides(layoutGraph, bond) {
  const ring = smallestQualifyingStereoRing(layoutGraph, bond);
  if (!ring) {
    return [];
  }

  const adjacency = buildCutRingAdjacency(layoutGraph, ring, bond);
  const firstDistances = cutRingDistances(adjacency, bond.a);
  const secondDistances = cutRingDistances(adjacency, bond.b);
  const firstSeedAtomIds = new Set([bond.a]);
  const secondSeedAtomIds = new Set([bond.b]);

  for (const atomId of ring.atomIds) {
    if (atomId === bond.a || atomId === bond.b) {
      continue;
    }
    const firstDistance = firstDistances.get(atomId) ?? Infinity;
    const secondDistance = secondDistances.get(atomId) ?? Infinity;
    if (firstDistance < secondDistance) {
      firstSeedAtomIds.add(atomId);
    } else if (secondDistance < firstDistance) {
      secondSeedAtomIds.add(atomId);
    }
  }

  const ringAtomIdSet = new Set(ring.atomIds);
  const firstBlockedAtomIds = new Set([...ringAtomIdSet].filter(atomId => !firstSeedAtomIds.has(atomId)));
  const secondBlockedAtomIds = new Set([...ringAtomIdSet].filter(atomId => !secondSeedAtomIds.has(atomId)));
  const candidates = [expandRingSideAtoms(layoutGraph, firstSeedAtomIds, firstBlockedAtomIds), expandRingSideAtoms(layoutGraph, secondSeedAtomIds, secondBlockedAtomIds)]
    .filter(sideAtomIds => sideAtomIds.size > 0)
    .sort((firstSideAtomIds, secondSideAtomIds) => firstSideAtomIds.size - secondSideAtomIds.size);

  return candidates;
}

function countHeavyAtoms(layoutGraph, atomIds, coords) {
  let count = 0;
  for (const atomId of atomIds) {
    if (coords && !coords.has(atomId)) {
      continue;
    }
    if (layoutGraph.atoms.get(atomId)?.element !== 'H') {
      count++;
    }
  }
  return count;
}

/**
 * Measures the maximum pairwise heavy-atom span in a coordinate set.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {number} Maximum squared heavy-atom distance.
 */
function measureHeavyAtomSpan(layoutGraph, coords) {
  const heavyPositions = [];
  for (const [atomId, position] of coords) {
    if (layoutGraph.atoms.get(atomId)?.element === 'H') {
      continue;
    }
    heavyPositions.push(position);
  }

  let maxDistanceSquared = 0;
  for (let firstIndex = 0; firstIndex < heavyPositions.length; firstIndex++) {
    const firstPosition = heavyPositions[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < heavyPositions.length; secondIndex++) {
      const secondPosition = heavyPositions[secondIndex];
      const dx = secondPosition.x - firstPosition.x;
      const dy = secondPosition.y - firstPosition.y;
      maxDistanceSquared = Math.max(maxDistanceSquared, dx * dx + dy * dy);
    }
  }

  return maxDistanceSquared;
}

function angleOf(firstPoint, secondPoint) {
  return Math.atan2(secondPoint.y - firstPoint.y, secondPoint.x - firstPoint.x);
}

function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized <= -Math.PI) {
    normalized += 2 * Math.PI;
  }
  while (normalized > Math.PI) {
    normalized -= 2 * Math.PI;
  }
  return normalized;
}

function reflectPointAcrossLine(position, firstPoint, secondPoint) {
  const dx = secondPoint.x - firstPoint.x;
  const dy = secondPoint.y - firstPoint.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) {
    return { ...position };
  }

  const projectionScale = ((position.x - firstPoint.x) * dx + (position.y - firstPoint.y) * dy) / lengthSquared;
  const projection = {
    x: firstPoint.x + projectionScale * dx,
    y: firstPoint.y + projectionScale * dy
  };
  return {
    x: 2 * projection.x - position.x,
    y: 2 * projection.y - position.y
  };
}

function reflectSideCoords(coords, sideAtomIds, firstAtomId, secondAtomId) {
  const firstPoint = coords.get(firstAtomId);
  const secondPoint = coords.get(secondAtomId);
  if (!firstPoint || !secondPoint) {
    return null;
  }

  const reflectedCoords = new Map();
  for (const atomId of sideAtomIds) {
    const position = coords.get(atomId);
    if (!position) {
      continue;
    }
    reflectedCoords.set(atomId, reflectPointAcrossLine(position, firstPoint, secondPoint));
  }
  return reflectedCoords;
}

function rotatePointAroundCenter(position, centerPoint, deltaAngle) {
  const dx = position.x - centerPoint.x;
  const dy = position.y - centerPoint.y;
  const cosAngle = Math.cos(deltaAngle);
  const sinAngle = Math.sin(deltaAngle);
  return {
    x: centerPoint.x + dx * cosAngle - dy * sinAngle,
    y: centerPoint.y + dx * sinAngle + dy * cosAngle
  };
}

function ringAtomIdSet(layoutGraph) {
  return layoutGraph.ringAtomIds ?? new Set((layoutGraph.rings ?? []).flatMap(ring => ring.atomIds));
}

function substituentCrossSign(firstPoint, secondPoint, substituentPoint) {
  const dx = secondPoint.x - firstPoint.x;
  const dy = secondPoint.y - firstPoint.y;
  const cross = dx * (substituentPoint.y - firstPoint.y) - dy * (substituentPoint.x - firstPoint.x);
  if (Math.abs(cross) < 1e-6) {
    return 0;
  }
  return Math.sign(cross);
}

function buildStereoCandidate(layoutGraph, candidateCoords, stereoBonds, bondLength, movedAtomIds) {
  return {
    coords: candidateCoords,
    matchedStereoCount: countMatchedStereo(layoutGraph, candidateCoords, stereoBonds),
    layoutCost: measureLayoutCost(layoutGraph, candidateCoords, bondLength),
    heavyAtomSpan: measureHeavyAtomSpan(layoutGraph, candidateCoords),
    heavyAtomCount: countHeavyAtoms(layoutGraph, movedAtomIds, candidateCoords)
  };
}

function isBetterStereoCandidate(candidate, incumbent) {
  if (!candidate) {
    return false;
  }
  if (!incumbent) {
    return true;
  }
  return (
    candidate.matchedStereoCount > incumbent.matchedStereoCount
    || (
      candidate.matchedStereoCount === incumbent.matchedStereoCount
      && (
        candidate.layoutCost < incumbent.layoutCost - 1e-6
        || (
          Math.abs(candidate.layoutCost - incumbent.layoutCost) <= 1e-6
          && (
            candidate.heavyAtomSpan > incumbent.heavyAtomSpan + 1e-6
            || (
              Math.abs(candidate.heavyAtomSpan - incumbent.heavyAtomSpan) <= 1e-6
              && candidate.heavyAtomCount < incumbent.heavyAtomCount
            )
          )
        )
      )
    )
  );
}

function buildLocalBranchRotationCandidate(layoutGraph, coords, bond, stereoBonds, bondLength, centerAtomId, otherAtomId, ringAtomIds) {
  if (ringAtomIds.has(centerAtomId)) {
    return null;
  }

  const centerPoint = coords.get(centerAtomId);
  const otherPoint = coords.get(otherAtomId);
  if (!centerPoint || !otherPoint) {
    return null;
  }

  const centerAtom = layoutGraph.sourceMolecule.atoms.get(centerAtomId);
  if (!centerAtom) {
    return null;
  }

  const substituentNeighborIds = [...centerAtom.getNeighbors(layoutGraph.sourceMolecule)]
    .map(atom => atom?.id)
    .filter(atomId => atomId && atomId !== otherAtomId);
  if (substituentNeighborIds.length === 0) {
    return null;
  }

  const prioritySubstituentId = highestPriorityAlkeneSubstituentId(layoutGraph.sourceMolecule, centerAtomId, otherAtomId);
  const otherPrioritySubstituentId = highestPriorityAlkeneSubstituentId(layoutGraph.sourceMolecule, otherAtomId, centerAtomId);
  if (!prioritySubstituentId || !otherPrioritySubstituentId) {
    return null;
  }

  const otherPriorityPoint = coords.get(otherPrioritySubstituentId);
  if (!otherPriorityPoint) {
    return null;
  }

  const otherPrioritySign = substituentCrossSign(centerPoint, otherPoint, otherPriorityPoint);
  if (otherPrioritySign === 0) {
    return null;
  }

  const targetStereo = layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null;
  if (!targetStereo) {
    return null;
  }

  const desiredPrioritySign = targetStereo === 'E' ? -otherPrioritySign : otherPrioritySign;
  const branchDescriptors = [];
  const movedAtomIds = new Set();
  for (const neighborAtomId of substituentNeighborIds) {
    const atomIds = collectSideAtoms(layoutGraph, neighborAtomId, centerAtomId);
    for (const atomId of atomIds) {
      if (movedAtomIds.has(atomId)) {
        return null;
      }
      movedAtomIds.add(atomId);
    }
    branchDescriptors.push({ neighborAtomId, atomIds });
  }

  const bondAngle = angleOf(centerPoint, otherPoint);
  const candidateCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));

  for (const branch of branchDescriptors) {
    const branchPoint = candidateCoords.get(branch.neighborAtomId);
    if (!branchPoint) {
      return null;
    }
    const desiredSign =
      substituentNeighborIds.length === 1
        ? desiredPrioritySign
        : branch.neighborAtomId === prioritySubstituentId
          ? desiredPrioritySign
          : -desiredPrioritySign;
    const desiredAngle = bondAngle + desiredSign * ((2 * Math.PI) / 3);
    const currentAngle = angleOf(centerPoint, branchPoint);
    const deltaAngle = normalizeAngle(desiredAngle - currentAngle);
    for (const atomId of branch.atomIds) {
      const position = candidateCoords.get(atomId);
      if (!position) {
        continue;
      }
      candidateCoords.set(atomId, rotatePointAroundCenter(position, centerPoint, deltaAngle));
    }
  }

  if (actualAlkeneStereo(layoutGraph, candidateCoords, bond) !== targetStereo) {
    return null;
  }

  return buildStereoCandidate(layoutGraph, candidateCoords, stereoBonds, bondLength, movedAtomIds);
}

function countMatchedStereo(layoutGraph, coords, stereoBonds) {
  let count = 0;
  for (const bond of stereoBonds) {
    const targetStereo = layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null;
    if (targetStereo && actualAlkeneStereo(layoutGraph, coords, bond) === targetStereo) {
      count++;
    }
  }
  return count;
}

/**
 * Enforces alkene E/Z geometry by reflecting one side of a mismatched
 * double bond across its bond axis. Endocyclic alkenes are only eligible when
 * they belong to a qualifying medium/large ring; acyclic and exocyclic
 * annotated alkenes are always eligible. Exocyclic and acyclic cases also get
 * a lighter-weight local rescue that rotates branch subtrees around non-ring
 * trigonal centers before falling back to whole-side reflection. Candidates
 * are ranked by total matched alkene-stereo count, then layout cost, then
 * heavy-atom span, then moved heavy-atom count.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Coordinate map.
 * @param {object} [options] - Enforcement options.
 * @param {number} [options.bondLength] - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, reflections: number}} Updated coordinates and reflection count.
 */
export function enforceAcyclicEZStereo(layoutGraph, inputCoords, options = {}) {
  const bondLength = options.bondLength ?? layoutGraph.options.bondLength;
  let coords = new Map([...inputCoords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
  const ringAtomIds = ringAtomIdSet(layoutGraph);
  const stereoBonds = [...layoutGraph.bonds.values()].filter(
    bond =>
      bond.kind === 'covalent' &&
      !bond.aromatic &&
      (bond.order ?? 1) === 2 &&
      isSupportedAnnotatedDoubleBond(layoutGraph, bond) &&
      (layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null) != null
  );

  if (stereoBonds.length === 0) {
    return { coords, reflections: 0 };
  }

  let reflections = 0;

  for (let pass = 0; pass < stereoBonds.length; pass++) {
    let changed = false;

    for (const bond of stereoBonds) {
      const targetStereo = layoutGraph.sourceMolecule.getEZStereo?.(bond.id) ?? null;
      const actualStereo = actualAlkeneStereo(layoutGraph, coords, bond);
      if (!targetStereo || actualStereo == null || actualStereo === targetStereo) {
        continue;
      }

      let bestCandidate = buildLocalBranchRotationCandidate(
        layoutGraph,
        coords,
        bond,
        stereoBonds,
        bondLength,
        bond.a,
        bond.b,
        ringAtomIds
      );
      const secondCenterLocalCandidate = buildLocalBranchRotationCandidate(
        layoutGraph,
        coords,
        bond,
        stereoBonds,
        bondLength,
        bond.b,
        bond.a,
        ringAtomIds
      );
      if (isBetterStereoCandidate(secondCenterLocalCandidate, bestCandidate)) {
        bestCandidate = secondCenterLocalCandidate;
      }

      const sideCandidates = bond.inRing
        ? collectRingReflectionSides(layoutGraph, bond)
        : [collectSideAtoms(layoutGraph, bond.a, bond.b), collectSideAtoms(layoutGraph, bond.b, bond.a)];

      for (const sideAtomIds of sideCandidates) {
        const reflectedSide = reflectSideCoords(coords, sideAtomIds, bond.a, bond.b);
        if (!reflectedSide || reflectedSide.size === 0) {
          continue;
        }

        const candidateCoords = new Map([...coords.entries()].map(([atomId, position]) => [atomId, { ...position }]));
        for (const [atomId, position] of reflectedSide) {
          candidateCoords.set(atomId, position);
        }

        if (actualAlkeneStereo(layoutGraph, candidateCoords, bond) !== targetStereo) {
          continue;
        }

        const candidate = buildStereoCandidate(layoutGraph, candidateCoords, stereoBonds, bondLength, sideAtomIds);

        if (isBetterStereoCandidate(candidate, bestCandidate)) {
          bestCandidate = candidate;
        }
      }

      if (!bestCandidate) {
        continue;
      }

      coords = bestCandidate.coords;
      reflections++;
      changed = true;
    }

    if (!changed) {
      break;
    }
  }

  return { coords, reflections };
}
