import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { layoutFusedFamily } from '../../../../src/layout/engine/families/fused.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { assignBondValidationClass } from '../../../../src/layout/engine/placement/bond-validation.js';
import { AUDIT_CORPUS } from '../support/audit-corpus.js';

const CAGE = AUDIT_CORPUS.find(entry => entry.sourceIndex === 11708).smiles;

/**
 * Checks the repaired cage without weakening projected or planar validation.
 * @param {object} result - Generated layout.
 * @param {number} bondLength - Requested scale.
 * @returns {void}
 */
function assertCleanCage(result, bondLength) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  for (const key of [
    'severeOverlapCount',
    'bondLengthFailureCount',
    'visibleHeavyBondCrossingFailureCount',
    'labelOverlapCount',
    'ringSubstituentReadabilityFailureCount',
    'missingCoordinateCount',
    'nonfiniteCoordinateCount'
  ]) {
    assert.equal(audit[key], 0, key);
  }
  assert.equal(audit.stereoContradiction, false);
  assert.equal(audit.fallback.mode, null);
  assert.ok(audit.maxBondLengthDeviation <= bondLength * 0.32);
  assert.ok(audit.visibleHeavyBondCrossingCount <= 2);
}

/**
 * Places the first cage directly so aromatic-core geometry can be compared.
 * @param {object} graph - Layout graph.
 * @returns {{coords: Map, audit: object, aromaticIds: string[]}} Scaffold geometry.
 */
function placeFirstCage(graph) {
  const system = graph.ringSystemById.get(graph.atomToRingSystemId.get('N10'));
  const rings = system.ringIds.map(id => graph.ringById.get(id));
  const ids = new Set(system.ringIds);
  const adjacency = new Map(rings.map(ring => [ring.id, []]));
  const connections = new Map();
  for (const connection of graph.ringConnections) {
    const a = connection.firstRingId;
    const b = connection.secondRingId;
    if (!ids.has(a) || !ids.has(b)) {
      continue;
    }
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
    connections.set(a < b ? `${a}:${b}` : `${b}:${a}`, connection);
  }
  const placement = layoutFusedFamily(rings, adjacency, connections, graph.options.bondLength, { layoutGraph: graph });
  return {
    coords: placement.coords,
    audit: auditLayout(graph, placement.coords, { bondLength: graph.options.bondLength, bondValidationClasses: assignBondValidationClass(graph, system.atomIds, 'bridged') }),
    aromaticIds: system.atomIds.filter(id => graph.atoms.get(id).aromatic)
  };
}

describe('pericondensed projected bond retension', () => {
  for (const [name, smiles] of [
    ['original', CAGE],
    ['ethyl ester', CAGE.replace('C(=O)OC', 'C(=O)OCC')],
    ['propyl branch', CAGE.replace('[C@H](CC)', '[C@H](CCC)')]
  ]) {
    for (const bondLength of [0.75, 1.5, 3]) {
      it(`clears ${name} bond and oxo defects at scale ${bondLength}`, () => {
        const result = generateCoords(parseSMILES(smiles), { bondLength, auditTelemetry: true });
        assertCleanCage(result, bondLength);
        assert.equal(result.metadata.placementAudit.bondLengthFailureCount, 0);
      });
    }
  }

  it('preserves every aromatic-core distance while repairing cage closures', () => {
    const graph = createLayoutGraph(parseSMILES(CAGE), {});
    // A real anchor on the other cage excludes automatic seed retension.
    const fixedCoords = new Map([['C25', { x: 0, y: 0 }]]);
    const before = placeFirstCage({ ...graph, fixedCoords });
    const after = placeFirstCage(graph);
    assert.equal(after.audit.bondLengthFailureCount, 0);
    assert.equal(after.audit.severeOverlapCount, 0);
    assert.ok(after.audit.maxBondLengthDeviation <= before.audit.maxBondLengthDeviation);
    for (const a of after.aromaticIds) {
      for (const b of after.aromaticIds) {
        const distance = coords => Math.hypot(coords.get(a).x - coords.get(b).x, coords.get(a).y - coords.get(b).y);
        assert.ok(Math.abs(distance(before.coords) - distance(after.coords)) < 1e-8);
      }
    }
    assert.deepEqual(fixedCoords, new Map([['C25', { x: 0, y: 0 }]]));
  });

  it('is deterministic and does not mutate source atom coordinates', () => {
    const molecule = parseSMILES(CAGE);
    const before = [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]);
    const first = generateCoords(molecule);
    assertCleanCage(first, 1.5);
    assert.deepEqual(generateCoords(parseSMILES(CAGE)).coords, first.coords);
    assert.deepEqual(
      [...molecule.atoms].map(([id, atom]) => [id, atom.x, atom.y, atom.chirality]),
      before
    );
  });

  it('also repairs layouts with fixed preservation disabled', () => {
    assertCleanCage(generateCoords(parseSMILES(CAGE), { preserveFixed: false }), 1.5);
  });

  it('keeps planar aromatic and simple projected controls clean', () => {
    for (const smiles of ['CC', 'c1ccc2ccccc2c1', 'c1cc2ccc3cccc4ccc(c1)c2c34', 'C1CC2CCC1C2']) {
      assert.equal(generateCoords(parseSMILES(smiles)).metadata.audit.ok, true, smiles);
    }
  });
});
