/** @module model/layout-graph */

import { normalizeOptions } from '../options.js';
import { assignComponentRoles, getConnectedComponents } from '../topology/components.js';
import { computeCanonicalAtomRanks } from '../topology/canonical-order.js';
import { findMetalCenterIds } from '../topology/metal-centers.js';
import { analyzeRings } from '../topology/ring-analysis.js';
import { buildRingConnections } from '../topology/ring-connections.js';
import { createLayoutAtom } from './layout-atom.js';
import { createLayoutBond } from './layout-bond.js';

function buildBondIndex(bonds) {
  const bondedPairSet = new Set();
  const bondByAtomPair = new Map();
  for (const bond of bonds.values()) {
    const key = bond.a < bond.b ? `${bond.a}:${bond.b}` : `${bond.b}:${bond.a}`;
    bondedPairSet.add(key);
    bondByAtomPair.set(key, bond);
  }
  return { bondedPairSet, bondByAtomPair };
}

function buildAtomBondsIndex(atoms, bonds) {
  const bondsByAtomId = new Map();
  for (const atomId of atoms.keys()) {
    bondsByAtomId.set(atomId, []);
  }
  for (const bond of bonds.values()) {
    bondsByAtomId.get(bond.a)?.push(bond);
    bondsByAtomId.get(bond.b)?.push(bond);
  }
  return bondsByAtomId;
}

function buildAtomToRingsIndex(rings) {
  const atomToRings = new Map();
  for (const ring of rings) {
    for (const atomId of ring.atomIds) {
      if (!atomToRings.has(atomId)) {
        atomToRings.set(atomId, []);
      }
      atomToRings.get(atomId).push(ring);
    }
  }
  return atomToRings;
}

function deriveLayoutTraits(molecule, components, ringAnalysis, ringConnections) {
  let heavyAtomCount = 0;
  let visibleHydrogenCount = 0;
  let hiddenHydrogenCount = 0;
  const metalCenterIds = findMetalCenterIds(molecule);
  const containsMetal = metalCenterIds.length > 0;

  for (const atom of molecule.atoms.values()) {
    if (atom.name === 'H') {
      if (atom.visible === false) {
        hiddenHydrogenCount++;
      } else {
        visibleHydrogenCount++;
      }
      continue;
    }
    heavyAtomCount++;
  }

  return {
    heavyAtomCount,
    visibleHydrogenCount,
    hiddenHydrogenCount,
    containsMetal,
    metalCenterCount: metalCenterIds.length,
    hasDisconnectedComponents: components.length > 1,
    ringSystemCount: ringAnalysis.ringSystems.length,
    ringCount: ringAnalysis.rings.length,
    bridgedRingConnectionCount: ringConnections.connections.filter(connection => connection.kind === 'bridged').length
  };
}

/**
 * Creates the immutable layout-graph shell used by later phases.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} [options] - Layout options.
 * @returns {object} Layout graph shell.
 */
export function createLayoutGraph(molecule, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const canonicalAtomRank = computeCanonicalAtomRanks(molecule);
  const rawComponents = getConnectedComponents(molecule, canonicalAtomRank);
  const components = assignComponentRoles(rawComponents);
  const ringAnalysis = analyzeRings(molecule, canonicalAtomRank);
  const ringConnections = buildRingConnections(molecule, ringAnalysis.rings);
  const atoms = new Map([...molecule.atoms.values()].map(atom => [atom.id, createLayoutAtom(atom, molecule)]));
  const bonds = new Map([...molecule.bonds.values()].map(bond => [bond.id, createLayoutBond(bond, molecule)]));
  const { bondedPairSet, bondByAtomPair } = buildBondIndex(bonds);
  const bondsByAtomId = buildAtomBondsIndex(atoms, bonds);
  const atomToRings = buildAtomToRingsIndex(ringAnalysis.rings);

  return {
    moleculeId: molecule.id,
    sourceMolecule: molecule,
    atoms,
    bonds,
    bondedPairSet,
    bondByAtomPair,
    bondsByAtomId,
    atomToRings,
    components,
    rings: ringAnalysis.rings,
    ringSystems: ringAnalysis.ringSystems,
    ringConnections: ringConnections.connections,
    ringAdj: ringConnections.ringAdj,
    ringConnectionByPair: ringConnections.connectionByPair,
    canonicalAtomRank,
    fixedCoords: normalizedOptions.fixedCoords,
    options: normalizedOptions,
    traits: deriveLayoutTraits(molecule, components, ringAnalysis, ringConnections)
  };
}
