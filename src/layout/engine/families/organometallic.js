/** @module families/organometallic */

import { add, angleOf, centroid, fromAngle, rotate, sub } from '../geometry/vec2.js';
import { compareCanonicalAtomIds } from '../topology/canonical-order.js';
import { buildSliceAdjacency, createAtomSlice, layoutAtomSlice } from '../placement/atom-slice.js';
import { organometallicArrangementSpecs, organometallicGeometryKind } from './organometallic-geometry.js';

function isMetalAtom(layoutGraph, atomId) {
  const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
  if (!atom || atom.name === 'H') {
    return false;
  }
  const group = atom.properties.group ?? 0;
  return group >= 3 && group <= 12;
}

function sortAtomIds(layoutGraph, atomIds) {
  return [...atomIds].sort((firstAtomId, secondAtomId) => compareCanonicalAtomIds(firstAtomId, secondAtomId, layoutGraph.canonicalAtomRank));
}

function connectedFragments(adjacency, orderedAtomIds) {
  const seen = new Set();
  const fragments = [];

  for (const seedAtomId of orderedAtomIds) {
    if (seen.has(seedAtomId)) {
      continue;
    }
    const queue = [seedAtomId];
    const atomIds = [];
    seen.add(seedAtomId);
    let queueHead = 0;

    while (queueHead < queue.length) {
      const atomId = queue[queueHead++];
      atomIds.push(atomId);
      for (const neighborAtomId of adjacency.get(atomId) ?? []) {
        if (seen.has(neighborAtomId)) {
          continue;
        }
        seen.add(neighborAtomId);
        queue.push(neighborAtomId);
      }
    }

    fragments.push(atomIds);
  }

  return fragments;
}

/**
 * Returns the supported publication-style geometry for one metal center and its ligand records.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} metalAtomId - Metal atom ID.
 * @param {object[]} records - Ligand-fragment records attached to the metal.
 * @returns {ReturnType<typeof organometallicGeometryKind>} Geometry kind.
 */
function coordinationGeometryKind(layoutGraph, metalAtomId, records) {
  const element = layoutGraph.sourceMolecule.atoms.get(metalAtomId)?.name ?? '';
  return organometallicGeometryKind(element, records.length, {
    allLigandsMonodentate: records.every(record => record.anchorAtomIds.length === 1)
  });
}

/**
 * Returns placement specs for one metal center based on safe coordination rules.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} metalAtomId - Metal atom ID.
 * @param {object[]} records - Ligand-fragment records attached to the metal.
 * @returns {Array<{angle: number, displayType: ('wedge'|'dash'|null)}>} Placement specs.
 */
function arrangementSpecs(layoutGraph, metalAtomId, records) {
  const geometryKind = coordinationGeometryKind(layoutGraph, metalAtomId, records);
  return organometallicArrangementSpecs(geometryKind, records.length);
}

/**
 * Finds the bond that joins a metal center to a ligand anchor atom.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {string} metalAtomId - Metal atom ID.
 * @param {string} anchorAtomId - Ligand anchor atom ID.
 * @returns {string|null} Bond ID, or null when the atoms are not directly bonded.
 */
function findMetalAnchorBondId(layoutGraph, metalAtomId, anchorAtomId) {
  for (const bond of layoutGraph.bondsByAtomId.get(metalAtomId) ?? []) {
    if (!bond) {
      continue;
    }
    const otherAtomId = bond.a === metalAtomId ? bond.b : bond.a;
    if (otherAtomId === anchorAtomId) {
      return bond.id;
    }
  }
  return null;
}

function transformFragment(coords, anchorAtomIds, targetAnchorCenter, desiredAngle) {
  const anchorCenter = centroid(anchorAtomIds.map(atomId => coords.get(atomId)).filter(Boolean));
  const fragmentCenter = centroid([...coords.values()]);
  const localDirection = sub(fragmentCenter, anchorCenter);
  const currentAngle = Math.hypot(localDirection.x, localDirection.y) <= 1e-12 ? 0 : angleOf(localDirection);
  const rotation = desiredAngle - currentAngle;
  const transformed = new Map();

  for (const [atomId, position] of coords) {
    const shifted = sub(position, anchorCenter);
    const rotated = rotate(shifted, rotation);
    transformed.set(atomId, add(targetAnchorCenter, rotated));
  }

  return transformed;
}

/**
 * Places a simple organometallic component by laying out ligand fragments as
 * organic slices, arranging them around provisional metal centers, and then
 * placing metals from their bonded-neighbor centroids when possible.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {object} component - Connected-component descriptor.
 * @param {number} bondLength - Target bond length.
 * @returns {{coords: Map<string, {x: number, y: number}>, placementMode: string, displayAssignments: Array<{bondId: string, type: 'wedge'|'dash', centerId: string}>}|null} Placement result.
 */
export function layoutOrganometallicFamily(layoutGraph, component, bondLength) {
  const participantAtomIds = component.atomIds.filter(atomId => {
    const atom = layoutGraph.atoms.get(atomId);
    return atom && !(layoutGraph.options.suppressH && atom.element === 'H' && !atom.visible);
  });
  const metalAtomIds = sortAtomIds(
    layoutGraph,
    participantAtomIds.filter(atomId => isMetalAtom(layoutGraph, atomId))
  );
  if (metalAtomIds.length === 0) {
    return null;
  }

  const nonMetalAtomIds = sortAtomIds(
    layoutGraph,
    participantAtomIds.filter(atomId => !isMetalAtom(layoutGraph, atomId))
  );
  const ligandAdjacency = buildSliceAdjacency(layoutGraph, nonMetalAtomIds, {
    includeBond(bond) {
      return bond.kind === 'covalent';
    }
  });
  const ligandFragments = connectedFragments(ligandAdjacency, nonMetalAtomIds);
  const fragmentRecords = ligandFragments.map((atomIds, index) => {
    const componentSlice = createAtomSlice(layoutGraph, atomIds, `ligand:${index}`);
    const anchorAtomIds = sortAtomIds(
      layoutGraph,
      atomIds.filter(atomId => {
        const atom = layoutGraph.sourceMolecule.atoms.get(atomId);
        return (
          atom?.bonds.some(bondId => {
            const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
            if (!bond) {
              return false;
            }
            const otherAtomId = bond.getOtherAtom(atomId);
            return metalAtomIds.includes(otherAtomId);
          }) ?? false
        );
      })
    );
    const anchorMetalIds = sortAtomIds(
      layoutGraph,
      metalAtomIds.filter(metalAtomId => {
        const metalAtom = layoutGraph.sourceMolecule.atoms.get(metalAtomId);
        return (
          metalAtom?.bonds.some(bondId => {
            const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
            if (!bond) {
              return false;
            }
            const otherAtomId = bond.getOtherAtom(metalAtomId);
            return atomIds.includes(otherAtomId);
          }) ?? false
        );
      })
    );
    return {
      component: componentSlice,
      anchorAtomIds,
      anchorMetalIds
    };
  });

  const metalCoords = new Map();
  if (metalAtomIds.length === 1) {
    metalCoords.set(metalAtomIds[0], { x: 0, y: 0 });
  } else {
    for (let index = 0; index < metalAtomIds.length; index++) {
      metalCoords.set(metalAtomIds[index], { x: index * bondLength * 2, y: 0 });
    }
  }

  const fragmentCoords = new Map();
  const displayAssignments = [];
  const groupedByMetal = new Map(metalAtomIds.map(metalAtomId => [metalAtomId, []]));
  for (const record of fragmentRecords) {
    const key = record.anchorMetalIds[0] ?? metalAtomIds[0];
    groupedByMetal.get(key)?.push(record);
  }
  for (const records of groupedByMetal.values()) {
    records.sort((firstRecord, secondRecord) => {
      if (secondRecord.anchorAtomIds.length !== firstRecord.anchorAtomIds.length) {
        return secondRecord.anchorAtomIds.length - firstRecord.anchorAtomIds.length;
      }
      if (secondRecord.component.atomIds.length !== firstRecord.component.atomIds.length) {
        return secondRecord.component.atomIds.length - firstRecord.component.atomIds.length;
      }
      return firstRecord.component.canonicalSignature.localeCompare(secondRecord.component.canonicalSignature, 'en', { numeric: true });
    });
  }

  for (const metalAtomId of metalAtomIds) {
    const provisionalMetalPosition = metalCoords.get(metalAtomId);
    const records = groupedByMetal.get(metalAtomId) ?? [];
    const specs = arrangementSpecs(layoutGraph, metalAtomId, records);
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      const ligandLayout = layoutAtomSlice(layoutGraph, record.component, bondLength, {
        adjacency: buildSliceAdjacency(layoutGraph, record.component.atomIds, {
          includeBond(bond) {
            return bond.kind === 'covalent';
          }
        })
      });
      if (!ligandLayout.supported || ligandLayout.coords.size === 0 || record.anchorAtomIds.length === 0) {
        return null;
      }

      const spec = specs[index] ?? { angle: 0, displayType: null };
      const targetAnchorCenter = add(provisionalMetalPosition, fromAngle(spec.angle, bondLength));
      const transformed = transformFragment(ligandLayout.coords, record.anchorAtomIds, targetAnchorCenter, spec.angle);
      for (const [atomId, position] of transformed) {
        fragmentCoords.set(atomId, position);
      }
      if (spec.displayType && record.anchorAtomIds.length === 1) {
        const bondId = findMetalAnchorBondId(layoutGraph, metalAtomId, record.anchorAtomIds[0]);
        if (bondId) {
          displayAssignments.push({
            bondId,
            type: spec.displayType,
            centerId: metalAtomId
          });
        }
      }
    }
  }

  for (const metalAtomId of metalAtomIds) {
    const records = groupedByMetal.get(metalAtomId) ?? [];
    const geometryKind = coordinationGeometryKind(layoutGraph, metalAtomId, records);
    if (geometryKind === 'projected-trigonal-bipyramidal') {
      continue;
    }
    const bondedLigandPositions = [];
    const metalAtom = layoutGraph.sourceMolecule.atoms.get(metalAtomId);
    for (const bondId of metalAtom?.bonds ?? []) {
      const bond = layoutGraph.sourceMolecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      const otherAtomId = bond.getOtherAtom(metalAtomId);
      const otherPosition = fragmentCoords.get(otherAtomId);
      if (otherPosition) {
        bondedLigandPositions.push(otherPosition);
      }
    }
    if (bondedLigandPositions.length >= 2) {
      metalCoords.set(metalAtomId, centroid(bondedLigandPositions));
    }
  }

  const coords = new Map(fragmentCoords);
  for (const [metalAtomId, position] of metalCoords) {
    coords.set(metalAtomId, position);
  }

  return {
    coords,
    placementMode: 'ligand-first',
    displayAssignments
  };
}
