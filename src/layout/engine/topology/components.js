/** @module topology/components */

import { buildCanonicalComponentSignature, sortAtomIdsCanonical } from './canonical-order.js';

function compareStrings(firstValue, secondValue) {
  return String(firstValue).localeCompare(String(secondValue), 'en', { numeric: true });
}

function componentBondIds(molecule, atomIdSet) {
  const bondIds = new Set();
  for (const atomId of atomIdSet) {
    const atom = molecule.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    for (const bondId of atom.bonds) {
      const bond = molecule.bonds.get(bondId);
      if (!bond) {
        continue;
      }
      if (atomIdSet.has(bond.atoms[0]) && atomIdSet.has(bond.atoms[1])) {
        bondIds.add(bondId);
      }
    }
  }
  return [...bondIds].sort(compareStrings);
}

function inferAuxiliaryRole(component) {
  if (component.heavyAtomCount <= 3 && component.netCharge !== 0) {
    return 'counter-ion';
  }
  if (component.heavyAtomCount <= 3 && component.netCharge === 0) {
    return 'solvent-like';
  }
  return 'spectator';
}

/**
 * Collects connected components directly from the source molecule without
 * constructing subgraph copies.
 * @param {object} molecule - Molecule-like graph.
 * @param {Map<string, number>} canonicalAtomRank - Canonical heavy-atom ranks.
 * @returns {object[]} Connected-component descriptors.
 */
export function getConnectedComponents(molecule, canonicalAtomRank = new Map()) {
  const visited = new Set();
  const components = [];
  const allAtomIds = [...molecule.atoms.keys()].sort(compareStrings);

  for (const startAtomId of allAtomIds) {
    if (visited.has(startAtomId)) {
      continue;
    }
    const atomIdSet = new Set();
    const queue = [startAtomId];
    let queueHead = 0;
    while (queueHead < queue.length) {
      const currentAtomId = queue[queueHead++];
      if (visited.has(currentAtomId)) {
        continue;
      }
      visited.add(currentAtomId);
      atomIdSet.add(currentAtomId);
      const atom = molecule.atoms.get(currentAtomId);
      if (!atom) {
        continue;
      }
      const neighborIds = atom.bonds.map(bondId => molecule.bonds.get(bondId)?.getOtherAtom(currentAtomId)).filter(Boolean);
      for (const neighborId of neighborIds) {
        if (!visited.has(neighborId)) {
          queue.push(neighborId);
        }
      }
    }

    const atomIds = sortAtomIdsCanonical([...atomIdSet], canonicalAtomRank);
    const heavyAtomCount = atomIds.filter(atomId => molecule.atoms.get(atomId)?.name !== 'H').length;
    const netCharge = atomIds.reduce((sum, atomId) => {
      const atom = molecule.atoms.get(atomId);
      return sum + (typeof atom?.getCharge === 'function' ? atom.getCharge() : (atom?.properties.charge ?? 0));
    }, 0);
    components.push({
      atomIds,
      bondIds: componentBondIds(molecule, atomIdSet),
      heavyAtomCount,
      netCharge,
      canonicalSignature: buildCanonicalComponentSignature(atomIds, canonicalAtomRank, molecule)
    });
  }

  components.sort((firstComponent, secondComponent) => {
    if (secondComponent.heavyAtomCount !== firstComponent.heavyAtomCount) {
      return secondComponent.heavyAtomCount - firstComponent.heavyAtomCount;
    }
    const signatureCompare = compareStrings(firstComponent.canonicalSignature, secondComponent.canonicalSignature);
    if (signatureCompare !== 0) {
      return signatureCompare;
    }
    return compareStrings(firstComponent.atomIds[0], secondComponent.atomIds[0]);
  });

  return components.map((component, index) => ({
    ...component,
    id: index
  }));
}

/**
 * Assigns packing/layout roles to already-sorted connected components.
 * @param {object[]} components - Connected-component descriptors.
 * @returns {object[]} Role-annotated components.
 */
export function assignComponentRoles(components) {
  return components.map((component, index) => ({
    ...component,
    role: index === 0 ? 'principal' : inferAuxiliaryRole(component)
  }));
}
