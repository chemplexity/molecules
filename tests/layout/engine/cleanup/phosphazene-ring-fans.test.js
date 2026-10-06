import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { generateCoords } from '../../../../src/layout/engine/api.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { packPhosphazeneRingFans } from '../../../../src/layout/engine/cleanup/phosphazene-ring-fans.js';
import { measureOrthogonalHypervalentDeviation } from '../../../../src/layout/engine/cleanup/hypervalent-angle-tidy.js';
import { collectCutSubtree } from '../../../../src/layout/engine/cleanup/subtree-utils.js';
import { angleOf, angularDifference, rotate, add, sub } from '../../../../src/layout/engine/geometry/vec2.js';

const FAN = 'CC(C)(C)N[PH+](N1CCCC1)N(=P(N1CCCC1)(N1CCCC1)N1CCCC1)=P(N1CCCC1)(N1CCCC1)N1CCCC1';

/**
 * Checks strict planar geometry and complete, finite returned coordinates.
 * @param {object} result - Generation result.
 * @param {number} [maximumBondDeviation] - Preserved fixture bond-deviation ceiling.
 * @returns {void}
 */
function assertClean(result, maximumBondDeviation = 1e-8) {
  const audit = result.metadata.audit;
  assert.equal(audit.ok, true);
  for (const key of ['severeOverlapCount', 'visibleHeavyBondCrossingCount', 'bondLengthFailureCount', 'ringSubstituentReadabilityFailureCount', 'missingCoordinateCount', 'nonfiniteCoordinateCount']) {
    assert.equal(audit[key], 0, key);
  }
  assert.equal(audit.stereoContradiction, false);
  assert.ok(audit.maxBondLengthDeviation <= maximumBondDeviation);
}

/**
 * Overlays two pendant rings by a rigid rotation, preserving all bond lengths.
 * @param {object} result - Clean fan layout.
 * @returns {Map<string, {x: number, y: number}>} Crowded test coordinates.
 */
function crowdSiblingRings(result) {
  const graph = result.layoutGraph;
  const center = [...graph.atoms.values()].find(atom => atom.element === 'P' && atom.heavyDegree === 4);
  const roots = (graph.bondsByAtomId.get(center.id) ?? []).filter(bond => bond.order === 1).map(bond => (bond.a === center.id ? bond.b : bond.a));
  const coords = new Map(result.coords);
  const pivot = coords.get(center.id);
  const rotation = angleOf(sub(coords.get(roots[0]), pivot)) - angleOf(sub(coords.get(roots[1]), pivot));
  for (const id of collectCutSubtree(graph, roots[1], center.id)) {
    if (coords.has(id)) {
      coords.set(id, add(pivot, rotate(sub(coords.get(id), pivot), rotation)));
    }
  }
  return coords;
}

describe('coordinated phosphazene ring fans', () => {
  for (const bondLength of [0.75, 1.5, 3]) {
    it(`removes the crowded fan overlap and crossings at bond length ${bondLength}`, () => {
      const result = generateCoords(parseSMILES(FAN), { bondLength });
      assertClean(result);
      const graph = result.layoutGraph;
      const junction = [...graph.atoms.values()].find(atom => atom.element === 'N' && (graph.bondsByAtomId.get(atom.id) ?? []).filter(bond => bond.order === 2).length === 2);
      const angles = graph.bondsByAtomId.get(junction.id).map(bond => {
        const id = bond.a === junction.id ? bond.b : bond.a;
        return angleOf(sub(result.coords.get(id), result.coords.get(junction.id)));
      });
      for (let i = 0; i < angles.length; i++) {
        assert.ok(Math.abs(angularDifference(angles[i], angles[(i + 1) % angles.length]) - (2 * Math.PI) / 3) < 1e-8);
      }
    });
  }

  for (const [smiles, maximumBondDeviation] of [
    [FAN.replace('CC(C)(C)N', 'CN'), 1e-8],
    [FAN.replace('CC(C)(C)N', 'N'), 1e-8],
    // This reduced fixture already has a 0.005135942 bond deviation before repacking.
    ['PN(=P(N1CCCC1)(N1CCCC1)N1CCCC1)=P(N1CCCC1)(N1CCCC1)N1CCCC1', 0.005136]
  ]) {
    it(`separates neighboring fans with a different outer branch: ${smiles}`, () => {
      assertClean(generateCoords(parseSMILES(smiles)), maximumBondDeviation);
    });
  }

  it('is deterministic and does not need optional branch reflection', () => {
    const first = generateCoords(parseSMILES(FAN), { allowBranchReflect: false });
    const second = generateCoords(parseSMILES(FAN), { allowBranchReflect: false });
    assertClean(first);
    assertClean(second);
    assert.deepEqual(second.coords, first.coords);
  });

  it('repacks dirty sibling rings without mutating input or worsening phosphorus angles', () => {
    const result = generateCoords(parseSMILES(FAN));
    const graph = result.layoutGraph;
    const dirty = crowdSiblingRings(result);
    const before = structuredClone(dirty);
    const penalty = coords => measureOrthogonalHypervalentDeviation(graph, coords);
    assert.ok(auditLayout(graph, dirty).severeOverlapCount > 0);
    const packed = packPhosphazeneRingFans(graph, dirty, 1.5, penalty);
    assert.ok(packed);
    assert.deepEqual(dirty, before);
    assert.equal(packed.size, dirty.size);
    assert.equal(auditLayout(graph, packed).ok, true);
    assert.ok(penalty(packed) <= penalty(dirty) + 1e-9);
    for (const bond of graph.bonds.values()) {
      if (!dirty.has(bond.a) || !dirty.has(bond.b)) {
        continue;
      }
      const first = sub(dirty.get(bond.a), dirty.get(bond.b));
      const second = sub(packed.get(bond.a), packed.get(bond.b));
      assert.ok(Math.abs(Math.hypot(first.x, first.y) - Math.hypot(second.x, second.y)) < 1e-8);
    }
  });

  it('does not repack fixed or already clean coordinates', () => {
    const result = generateCoords(parseSMILES(FAN));
    const dirty = crowdSiblingRings(result);
    const fixedId = [...result.layoutGraph.atoms.values()].find(atom => atom.element === 'P').id;
    const graph = createLayoutGraph(parseSMILES(FAN), { fixedCoords: new Map([[fixedId, dirty.get(fixedId)]]) });
    assert.equal(
      packPhosphazeneRingFans(graph, dirty, 1.5, coords => measureOrthogonalHypervalentDeviation(graph, coords)),
      null
    );
    assert.equal(
      packPhosphazeneRingFans(result.layoutGraph, result.coords, 1.5, coords => measureOrthogonalHypervalentDeviation(result.layoutGraph, coords)),
      null
    );
  });

  for (const smiles of ['N=P(N1CCCC1)(N1CCCC1)N1CCCC1', 'O=P(O)(O)O']) {
    it(`leaves a simple phosphorus center unchanged: ${smiles}`, () => {
      const result = generateCoords(parseSMILES(smiles));
      assertClean(result);
      assert.equal(
        packPhosphazeneRingFans(result.layoutGraph, result.coords, 1.5, () => 0),
        null
      );
    });
  }
});
