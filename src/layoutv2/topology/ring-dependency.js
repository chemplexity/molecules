/** @module topology/ring-dependency */

import { computeCanonicalAtomRanks } from './canonical-order.js';
import { analyzeRings } from './ring-analysis.js';
import { buildRingConnections } from './ring-connections.js';

function countInducedComponents(molecule, atomIds) {
  const atomIdSet = new Set(atomIds);
  const visited = new Set();
  let componentCount = 0;

  for (const atomId of atomIds) {
    if (visited.has(atomId)) {
      continue;
    }
    componentCount++;
    const queue = [atomId];
    visited.add(atomId);
    while (queue.length > 0) {
      const currentAtomId = queue.shift();
      const atom = molecule.atoms.get(currentAtomId);
      if (!atom) {
        continue;
      }
      for (const bondId of atom.bonds) {
        const bond = molecule.bonds.get(bondId);
        const neighborAtomId = bond?.getOtherAtom(currentAtomId);
        if (!bond || !neighborAtomId || !atomIdSet.has(neighborAtomId) || visited.has(neighborAtomId)) {
          continue;
        }
        visited.add(neighborAtomId);
        queue.push(neighborAtomId);
      }
    }
  }

  return componentCount;
}

function countInducedEdges(molecule, atomIds) {
  const atomIdSet = new Set(atomIds);
  let edgeCount = 0;
  for (const bond of molecule.bonds.values()) {
    if (atomIdSet.has(bond.atoms[0]) && atomIdSet.has(bond.atoms[1])) {
      edgeCount++;
    }
  }
  return edgeCount;
}

function summarizeRingSystemDependency(molecule, ringSystem, rings, connections) {
  const edgeCount = countInducedEdges(molecule, ringSystem.atomIds);
  const componentCount = countInducedComponents(molecule, ringSystem.atomIds);
  const cycleRank = edgeCount - ringSystem.atomIds.length + componentCount;
  const ringCount = ringSystem.ringIds.length;
  const systemConnections = connections.filter(
    connection => ringSystem.ringIds.includes(connection.firstRingId) && ringSystem.ringIds.includes(connection.secondRingId)
  );
  const connectionKinds = [...new Set(systemConnections.map(connection => connection.kind))].sort();
  const reasons = [];

  if (ringCount === 0 && cycleRank > 0) {
    reasons.push('missing-rings');
  }
  if (ringCount > 0 && cycleRank > 0 && ringCount < cycleRank) {
    reasons.push('insufficient-ring-basis');
  }
  if (ringCount > 1 && systemConnections.length === 0) {
    reasons.push('missing-ring-connections');
  }
  if (cycleRank > 1 && ringCount === 1) {
    reasons.push('underdetected-multicycle-system');
  }

  return {
    ringSystemId: ringSystem.id,
    ringCount,
    cycleRank,
    edgeCount,
    atomCount: ringSystem.atomIds.length,
    componentCount,
    connectionKinds,
    suspicious: reasons.length > 0,
    reasons
  };
}

/**
 * Inspects whether the current adapter-backed ring perception looks adequate
 * for fused and bridged classification on the given molecule.
 * @param {object} molecule - Molecule-like graph.
 * @returns {{ok: boolean, requiresDedicatedRingEngine: boolean, suspiciousSystemCount: number, systems: object[], rings: object[], connections: object[]}} Dependency summary.
 */
export function inspectRingDependency(molecule) {
  const canonicalAtomRank = computeCanonicalAtomRanks(molecule);
  const { rings, ringSystems } = analyzeRings(molecule, canonicalAtomRank);
  const { connections } = buildRingConnections(molecule, rings);
  const systems = ringSystems.map(ringSystem => summarizeRingSystemDependency(molecule, ringSystem, rings, connections));
  const suspiciousSystems = systems.filter(system => system.suspicious);

  return {
    ok: suspiciousSystems.length === 0,
    requiresDedicatedRingEngine: suspiciousSystems.length > 0,
    suspiciousSystemCount: suspiciousSystems.length,
    systems,
    rings,
    connections
  };
}

/**
 * Evaluates a curated ring-perception corpus against the current adapter.
 * Each entry can assert expected ring-connection kinds and/or ring count.
 * @param {Array<{id: string, molecule: object, expectedConnectionKinds?: string[], expectedRingCount?: number}>} entries - Corpus entries.
 * @returns {{ok: boolean, mismatchCount: number, requiresDedicatedRingEngine: boolean, entries: object[]}} Corpus evaluation summary.
 */
export function evaluateRingDependencyCorpus(entries) {
  const results = entries.map(entry => {
    const dependency = inspectRingDependency(entry.molecule);
    const actualConnectionKinds = [...new Set(dependency.connections.map(connection => connection.kind))].sort();
    const mismatches = [];

    if (Array.isArray(entry.expectedConnectionKinds)) {
      const expectedConnectionKinds = [...entry.expectedConnectionKinds].sort();
      if (JSON.stringify(actualConnectionKinds) !== JSON.stringify(expectedConnectionKinds)) {
        mismatches.push(`expected connection kinds ${expectedConnectionKinds.join(',') || '(none)'}, got ${actualConnectionKinds.join(',') || '(none)'}`);
      }
    }

    if (typeof entry.expectedRingCount === 'number' && dependency.rings.length !== entry.expectedRingCount) {
      mismatches.push(`expected ring count ${entry.expectedRingCount}, got ${dependency.rings.length}`);
    }

    return {
      id: entry.id,
      dependency,
      actualConnectionKinds,
      mismatches
    };
  });

  const mismatchCount = results.reduce((sum, result) => sum + result.mismatches.length, 0);
  const requiresDedicatedRingEngine = results.some(result => result.dependency.requiresDedicatedRingEngine);

  return {
    ok: mismatchCount === 0 && !requiresDedicatedRingEngine,
    mismatchCount,
    requiresDedicatedRingEngine,
    entries: results
  };
}
