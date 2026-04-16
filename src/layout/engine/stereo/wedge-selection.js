/** @module stereo/wedge-selection */

import { assignCIPRanks } from '../../../core/Molecule.js';
import { centroid, distance, normalize, scale, sub } from '../geometry/vec2.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { minimumSectorAngle, synthesizeHydrogenPosition } from './wedge-geometry.js';

function findBondBetween(molecule, firstAtomId, secondAtomId) {
  const atom = molecule.atoms.get(firstAtomId);
  if (!atom) {
    return null;
  }
  for (const bondId of atom.bonds) {
    const bond = molecule.bonds.get(bondId);
    if (bond?.connects(firstAtomId, secondAtomId)) {
      return bond;
    }
  }
  return null;
}

function findComponentAtomIds(layoutGraph, atomId) {
  return layoutGraph.components.find(component => component.atomIds.includes(atomId))?.atomIds ?? [atomId];
}

/**
 * Returns the placed incident ring polygons for a stereocenter.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerId - Stereocenter atom id.
 * @returns {Array<Array<{x: number, y: number}>>} Incident ring polygons.
 */
function incidentRingPolygons(layoutGraph, coords, centerId) {
  return (layoutGraph.atomToRings.get(centerId) ?? []).map(ring => ring.atomIds.map(atomId => coords.get(atomId)).filter(Boolean)).filter(polygon => polygon.length >= 3);
}

/**
 * Builds ranked stereocenter neighbor entries, synthesizing a hidden hydrogen
 * position when needed. Handles both explicit hidden hydrogens already present
 * in the molecular graph and implicit-hydrogen stereocenters that only expose
 * three explicit neighbors.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @param {string} centerId - Stereocenter atom id.
 * @returns {{center: object, centerPosition: {x: number, y: number}, entries: Array<object>}|null} Prepared center entries, or null when the center is unsuitable.
 */
function buildCenterEntries(layoutGraph, coords, centerId) {
  const molecule = layoutGraph.sourceMolecule;
  const center = molecule.atoms.get(centerId);
  const centerPosition = coords.get(centerId);
  if (!center || !centerPosition) {
    return null;
  }

  const neighbors = center.getNeighbors(molecule).filter(Boolean);
  const implicitHydrogenCount = center.implicitHydrogenCount(molecule);
  const hasImplicitHydrogen = neighbors.length === 3 && implicitHydrogenCount === 1;
  if (neighbors.length !== 4 && !hasImplicitHydrogen) {
    return null;
  }

  const neighborIds = neighbors.map(neighbor => neighbor.id);
  const ranks = assignCIPRanks(centerId, neighborIds, molecule);
  const entries = neighbors
    .map((neighbor, index) => ({
      atom: neighbor,
      rank: ranks[index] ?? 0,
      bond: findBondBetween(molecule, centerId, neighbor.id),
      position: coords.get(neighbor.id) ?? null
    }))
    .filter(entry => entry.bond);

  if (hasImplicitHydrogen) {
    entries.push({
      atom: {
        id: `implicit-h:${centerId}`,
        name: 'H',
        visible: false
      },
      rank: 0,
      bond: {
        id: `implicit-h:${centerId}`,
        properties: {},
        getKind() {
          return 'covalent';
        },
        getOrder() {
          return 1;
        },
        isInRing() {
          return false;
        }
      },
      position: null
    });
  }

  if (entries.length !== 4) {
    return null;
  }

  const knownPositions = entries.filter(entry => entry.position).map(entry => entry.position);
  const ringPolygons = incidentRingPolygons(layoutGraph, coords, centerId);
  for (const entry of entries) {
    if (entry.position) {
      continue;
    }
    if (entry.atom.name !== 'H') {
      return null;
    }
    entry.position = synthesizeHydrogenPosition(centerPosition, knownPositions, layoutGraph.options.bondLength, {
      incidentRingPolygons: ringPolygons
    });
  }

  return { center, centerPosition, entries };
}

function displayConflicts(entry, centerId) {
  const displayHint = entry.bond.properties.display ?? null;
  if (!displayHint || (displayHint.as !== 'wedge' && displayHint.as !== 'dash')) {
    return false;
  }
  return displayHint.centerId != null && displayHint.centerId !== centerId;
}

function bondKind(bond) {
  return typeof bond.getKind === 'function' ? bond.getKind() : (bond.properties.kind ?? 'covalent');
}

function bondOrder(bond) {
  return typeof bond.getOrder === 'function' ? bond.getOrder() : (bond.properties.order ?? 1);
}

function branchDepth(layoutGraph, startAtomId, blockedAtomId) {
  const molecule = layoutGraph.sourceMolecule;
  const queue = [{ atomId: startAtomId, depth: 0 }];
  const visited = new Set([blockedAtomId]);
  let maxDepth = 0;

  while (queue.length > 0) {
    const { atomId, depth } = queue.shift();
    if (visited.has(atomId)) {
      continue;
    }
    visited.add(atomId);
    const atom = molecule.atoms.get(atomId);
    if (!atom || atom.name === 'H') {
      continue;
    }
    maxDepth = Math.max(maxDepth, depth);
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      const neighborAtomId = bond?.getOtherAtom(atomId);
      if (!bond || !neighborAtomId || visited.has(neighborAtomId)) {
        continue;
      }
      queue.push({ atomId: neighborAtomId, depth: depth + 1 });
    }
  }

  return maxDepth;
}

function resolveStereoTypeForCenter(layoutGraph, coords, centerId, preferredBondId) {
  const entryData = buildCenterEntries(layoutGraph, coords, centerId);
  if (!entryData) {
    return null;
  }
  const chirality = entryData.center.getChirality();
  if (chirality !== 'R' && chirality !== 'S') {
    return null;
  }

  const chosenEntry = entryData.entries.find(entry => entry.bond.id === preferredBondId);
  if (!chosenEntry) {
    return null;
  }

  const otherEntries = entryData.entries.filter(entry => entry !== chosenEntry).sort((firstEntry, secondEntry) => secondEntry.rank - firstEntry.rank);
  const heavyOtherVectors = otherEntries.filter(entry => !(entry.atom.name === 'H' && entry.atom.visible === false)).map(entry => sub(entry.position, entryData.centerPosition));
  const safeVector = entry => {
    if (entry.atom.name === 'H' && entry.atom.visible === false && heavyOtherVectors.length === 2) {
      const x = -(heavyOtherVectors[0].x + heavyOtherVectors[1].x);
      const y = -(heavyOtherVectors[0].y + heavyOtherVectors[1].y);
      const unit = normalize({ x, y });
      return scale(unit, layoutGraph.options.bondLength);
    }
    return sub(entry.position, entryData.centerPosition);
  };

  const [firstVector, secondVector, thirdVector] = otherEntries.map(safeVector);
  const signedArea =
    firstVector.x * secondVector.y -
    firstVector.y * secondVector.x +
    (secondVector.x * thirdVector.y - secondVector.y * thirdVector.x) +
    (thirdVector.x * firstVector.y - thirdVector.y * firstVector.x);
  const lowerCount = entryData.entries.filter(entry => entry.rank < chosenEntry.rank).length;
  let computed = signedArea > 0 ? 'S' : 'R';
  if (lowerCount % 2 === 1) {
    computed = computed === 'S' ? 'R' : 'S';
  }

  return {
    bondId: chosenEntry.bond.id,
    type: computed === chirality ? 'dash' : 'wedge',
    centerId
  };
}

/**
 * Picks wedge/dash display assignments for all currently placed stereocenters.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map.
 * @returns {{annotatedCenterCount: number, chiralCenterCount: number, assignedCenterCount: number, unassignedCenterCount: number, unsupportedCenterCount: number, assignments: Array<{bondId: string, type: 'wedge'|'dash', centerId: string, manual?: boolean}>, missingCenterIds: string[], unsupportedCenterIds: string[]}} Wedge-selection summary.
 */
export function pickWedgeAssignments(layoutGraph, coords) {
  const molecule = layoutGraph.sourceMolecule;
  const annotatedCenterIds = molecule
    .getChiralCenters()
    .filter(centerId => coords.has(centerId))
    .sort((firstCenterId, secondCenterId) => compareCanonicalAtomIds(firstCenterId, secondCenterId, layoutGraph.canonicalAtomRank));
  const preparedCenterEntriesById = new Map();
  const centerIds = [];
  const unsupportedCenterIds = [];
  for (const centerId of annotatedCenterIds) {
    const preparedEntries = buildCenterEntries(layoutGraph, coords, centerId);
    if (!preparedEntries) {
      unsupportedCenterIds.push(centerId);
      continue;
    }
    preparedCenterEntriesById.set(centerId, preparedEntries);
    centerIds.push(centerId);
  }
  const assignments = [];
  const missingCenterIds = [];

  for (const centerId of centerIds) {
    const center = molecule.atoms.get(centerId);
    if (!center) {
      missingCenterIds.push(centerId);
      continue;
    }

    const centerPosition = coords.get(centerId);
    const componentAtomIds = findComponentAtomIds(layoutGraph, centerId);
    const componentPoints = componentAtomIds.map(atomId => coords.get(atomId)).filter(Boolean);
    const componentCenter = centroid(componentPoints);
    const rawEntries = preparedCenterEntriesById.get(centerId) ?? buildCenterEntries(layoutGraph, coords, centerId);
    if (!rawEntries) {
      missingCenterIds.push(centerId);
      continue;
    }

    const manualAssignment = rawEntries.entries
      .filter(entry => entry.bond.properties.display?.manual === true)
      .find(entry => {
        const displayHint = entry.bond.properties.display ?? null;
        return displayHint && (displayHint.as === 'wedge' || displayHint.as === 'dash') && (displayHint.centerId == null || displayHint.centerId === centerId);
      });
    if (manualAssignment) {
      assignments.push({
        bondId: manualAssignment.bond.id,
        type: manualAssignment.bond.properties.display.as,
        centerId,
        manual: true
      });
      continue;
    }

    const candidateEntries = rawEntries.entries.filter(entry => {
      if (bondKind(entry.bond) !== 'covalent' || entry.bond.properties.aromatic === true || bondOrder(entry.bond) !== 1) {
        return false;
      }
      if (displayConflicts(entry, centerId)) {
        return false;
      }
      return true;
    });
    const nonRingCandidates = candidateEntries.filter(entry => !entry.bond.isInRing(molecule));
    const firstPassCandidates = nonRingCandidates.length > 0 ? nonRingCandidates : candidateEntries;
    const visibleHeavyCandidates = firstPassCandidates.filter(entry => !(entry.atom.name === 'H' && entry.atom.visible === false));
    const viableCandidates = visibleHeavyCandidates.length > 0 ? visibleHeavyCandidates : firstPassCandidates;
    if (viableCandidates.length === 0) {
      missingCenterIds.push(centerId);
      continue;
    }

    const storedBondId =
      viableCandidates.find(entry => {
        const displayHint = entry.bond.properties.display ?? null;
        return displayHint && (displayHint.as === 'wedge' || displayHint.as === 'dash') && (displayHint.centerId == null || displayHint.centerId === centerId);
      })?.bond.id ?? null;

    viableCandidates.sort((firstEntry, secondEntry) => {
      const firstPreferred = firstEntry.bond.id === storedBondId ? 1 : 0;
      const secondPreferred = secondEntry.bond.id === storedBondId ? 1 : 0;
      if (firstPreferred !== secondPreferred) {
        return secondPreferred - firstPreferred;
      }

      const firstOutward = distance(firstEntry.position, componentCenter) - distance(centerPosition, componentCenter);
      const secondOutward = distance(secondEntry.position, componentCenter) - distance(centerPosition, componentCenter);
      if (Math.abs(firstOutward - secondOutward) > 1e-6) {
        return secondOutward - firstOutward;
      }

      const firstSector = minimumSectorAngle(
        centerPosition,
        firstEntry.position,
        rawEntries.entries.filter(entry => entry !== firstEntry).map(entry => entry.position)
      );
      const secondSector = minimumSectorAngle(
        centerPosition,
        secondEntry.position,
        rawEntries.entries.filter(entry => entry !== secondEntry).map(entry => entry.position)
      );
      if (Math.abs(firstSector - secondSector) > 1e-6) {
        return secondSector - firstSector;
      }

      const firstDepth = branchDepth(layoutGraph, firstEntry.atom.id, centerId);
      const secondDepth = branchDepth(layoutGraph, secondEntry.atom.id, centerId);
      if (firstDepth !== secondDepth) {
        return firstDepth - secondDepth;
      }

      const firstHiddenHydrogen = firstEntry.atom.name === 'H' && firstEntry.atom.visible === false;
      const secondHiddenHydrogen = secondEntry.atom.name === 'H' && secondEntry.atom.visible === false;
      if (firstHiddenHydrogen !== secondHiddenHydrogen) {
        return firstHiddenHydrogen ? 1 : -1;
      }

      const neighborComparison = compareCanonicalAtomIds(firstEntry.atom.id, secondEntry.atom.id, layoutGraph.canonicalAtomRank);
      return neighborComparison !== 0 ? neighborComparison : String(firstEntry.bond.id).localeCompare(String(secondEntry.bond.id), 'en', { numeric: true });
    });

    const resolved = resolveStereoTypeForCenter(layoutGraph, coords, centerId, viableCandidates[0].bond.id);
    if (!resolved) {
      missingCenterIds.push(centerId);
      continue;
    }
    assignments.push(resolved);
  }

  return {
    annotatedCenterCount: annotatedCenterIds.length,
    chiralCenterCount: centerIds.length,
    assignedCenterCount: assignments.length,
    unassignedCenterCount: Math.max(0, centerIds.length - assignments.length),
    unsupportedCenterCount: unsupportedCenterIds.length,
    assignments,
    missingCenterIds,
    unsupportedCenterIds
  };
}
