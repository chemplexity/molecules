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

function buildAtomToRingSystemIdIndex(ringSystems) {
  const atomToRingSystemId = new Map();
  for (const ringSystem of ringSystems) {
    for (const atomId of ringSystem.atomIds) {
      atomToRingSystemId.set(atomId, ringSystem.id);
    }
  }
  return atomToRingSystemId;
}

function buildRingAtomIds(rings) {
  const ringAtomIdSet = new Set();
  for (const ring of rings) {
    for (const atomId of ring.atomIds) {
      ringAtomIdSet.add(atomId);
    }
  }
  return ringAtomIdSet;
}

const ORTHOGONAL_HYPERVALENT_ELEMENTS = new Set(['S', 'P', 'Se', 'As']);
const ORTHOGONAL_TETRAARYL_ELEMENTS = new Set(['Si']);

function indexedHeavyDegree(atoms, bondsByAtomId, atomId) {
  let heavyDegree = 0;
  for (const bond of bondsByAtomId.get(atomId) ?? []) {
    const neighborAtomId = bond.a === atomId ? bond.b : bond.a;
    const neighborAtom = atoms.get(neighborAtomId);
    if (neighborAtom && neighborAtom.element !== 'H') {
      heavyDegree++;
    }
  }
  return heavyDegree;
}

/**
 * Returns whether a direct bond can occupy a single-ligand slot around a
 * hypervalent center. Aromatic ring bonds still count as fixed single ligands
 * for fused sulfone-like centers so the policy enables hypervalent cleanup.
 * @param {Map<string, object>} atoms - Layout atoms indexed by id.
 * @param {Map<string, object[]>} bondsByAtomId - Bonds indexed by atom id.
 * @param {Map<string, object[]>} atomToRings - Ring membership by atom id.
 * @param {string} centerAtomId - Hypervalent center atom id.
 * @param {object} bond - Direct ligand bond descriptor.
 * @returns {boolean} True when the bond should count as a single ligand.
 */
function isHypervalentSingleLigandBond(atoms, bondsByAtomId, atomToRings, centerAtomId, bond) {
  if (!bond || bond.kind !== 'covalent') {
    return false;
  }
  if ((bond.order ?? 1) === 1 && !bond.aromatic) {
    return true;
  }
  if (!bond.aromatic) {
    return false;
  }
  const neighborAtomId = bond.a === centerAtomId ? bond.b : bond.a;
  const neighborAtom = atoms.get(neighborAtomId);
  return Boolean(
    neighborAtom
    && neighborAtom.element !== 'H'
    && indexedHeavyDegree(atoms, bondsByAtomId, neighborAtomId) > 1
    && (atomToRings.get(centerAtomId)?.length ?? 0) > 0
    && (atomToRings.get(neighborAtomId)?.length ?? 0) > 0
  );
}

function isOrthogonalTetraarylSingleLigand(atoms, atomToRings, atomId) {
  const atom = atoms.get(atomId);
  return Boolean(
    atom
    && atom.element === 'C'
    && atom.aromatic === true
    && (atomToRings.get(atomId)?.length ?? 0) > 0
  );
}

function containsOrthogonalHypervalentCenter(atoms, bondsByAtomId, atomToRings) {
  for (const atom of atoms.values()) {
    if (
      !ORTHOGONAL_HYPERVALENT_ELEMENTS.has(atom.element)
      && !ORTHOGONAL_TETRAARYL_ELEMENTS.has(atom.element)
    ) {
      continue;
    }
    let ligandCount = 0;
    let singleNeighborCount = 0;
    const singleNeighborIds = [];
    let terminalMultipleNeighborCount = 0;
    let valid = true;

    for (const bond of bondsByAtomId.get(atom.id) ?? []) {
      const neighborAtomId = bond.a === atom.id ? bond.b : bond.a;
      const neighborAtom = atoms.get(neighborAtomId);
      if (!neighborAtom) {
        continue;
      }

      ligandCount++;
      if (isHypervalentSingleLigandBond(atoms, bondsByAtomId, atomToRings, atom.id, bond)) {
        singleNeighborCount++;
        singleNeighborIds.push(neighborAtomId);
        continue;
      }
      if (neighborAtom.element === 'H') {
        valid = false;
        break;
      }
      if (neighborAtom.element !== 'C' && indexedHeavyDegree(atoms, bondsByAtomId, neighborAtomId) === 1) {
        terminalMultipleNeighborCount++;
        continue;
      }
      valid = false;
      break;
    }

    if (
      valid
      && ligandCount === 4
      && (
        (singleNeighborCount === 2 && terminalMultipleNeighborCount === 2)
        || (singleNeighborCount === 3 && terminalMultipleNeighborCount === 1)
        || (
          ORTHOGONAL_TETRAARYL_ELEMENTS.has(atom.element)
          && singleNeighborCount === 4
          && terminalMultipleNeighborCount === 0
          && singleNeighborIds.every(neighborAtomId => isOrthogonalTetraarylSingleLigand(atoms, atomToRings, neighborAtomId))
        )
      )
    ) {
      return true;
    }
  }
  return false;
}

function deriveLayoutTraits(molecule, components, ringAnalysis, ringConnections, atoms, bondsByAtomId, atomToRings) {
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
    containsOrthogonalHypervalentCenter: containsOrthogonalHypervalentCenter(atoms, bondsByAtomId, atomToRings),
    metalCenterCount: metalCenterIds.length,
    hasDisconnectedComponents: components.length > 1,
    ringSystemCount: ringAnalysis.ringSystems.length,
    ringCount: ringAnalysis.rings.length,
    bridgedRingConnectionCount: ringConnections.connections.filter(connection => connection.kind === 'bridged').length
  };
}

function buildLayoutGraph(molecule, normalizedOptions) {
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
  const atomToRingSystemId = buildAtomToRingSystemIdIndex(ringAnalysis.ringSystems);
  const ringAtomIdSet = buildRingAtomIds(ringAnalysis.rings);

  return {
    moleculeId: molecule.id,
    sourceMolecule: molecule,
    atoms,
    bonds,
    bondedPairSet,
    bondByAtomPair,
    bondsByAtomId,
    atomToRings,
    atomToRingSystemId,
    ringAtomIdSet,
    components,
    rings: ringAnalysis.rings,
    ringSystems: ringAnalysis.ringSystems,
    ringConnections: ringConnections.connections,
    ringAdj: ringConnections.ringAdj,
    ringConnectionByPair: ringConnections.connectionByPair,
    canonicalAtomRank,
    fixedCoords: normalizedOptions.fixedCoords,
    options: normalizedOptions,
    traits: deriveLayoutTraits(molecule, components, ringAnalysis, ringConnections, atoms, bondsByAtomId, atomToRings)
  };
}

/**
 * Creates the immutable layout-graph shell from an already normalized options bag.
 * This is an internal helper for callers that already paid the normalization cost.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} normalizedOptions - Normalized layout options.
 * @returns {object} Layout graph shell.
 */
export function createLayoutGraphFromNormalized(molecule, normalizedOptions) {
  return buildLayoutGraph(molecule, normalizedOptions);
}

/**
 * Creates the immutable layout-graph shell used by later phases.
 * @param {object} molecule - Molecule-like graph.
 * @param {object} [options] - Layout options.
 * @returns {object} Layout graph shell.
 */
export function createLayoutGraph(molecule, options = {}) {
  return buildLayoutGraph(molecule, normalizeOptions(options));
}
