import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRings, detectRingSystems, findSharedAtoms, getRingAtomIds } from '../../../src/layoutv2/topology/ring-analysis.js';
import { computeCanonicalAtomRanks } from '../../../src/layoutv2/topology/canonical-order.js';
import { makeNaphthalene } from '../support/molecules.js';

describe('layoutv2/topology/ring-analysis', () => {
  it('finds shared atoms between ring atom lists', () => {
    assert.deepEqual(findSharedAtoms(['a0', 'a1', 'a2'], ['a3', 'a1', 'a2']), ['a1', 'a2']);
  });

  it('groups related rings into ring systems by shared atoms', () => {
    const systems = detectRingSystems([
      ['a0', 'a1', 'a2'],
      ['a2', 'a3', 'a4'],
      ['b0', 'b1', 'b2']
    ]);
    assert.equal(systems.length, 2);
    assert.deepEqual(systems[0].ringIds, [0, 1]);
    assert.deepEqual(systems[1].ringIds, [2]);
  });

  it('adapts molecule rings into deterministic ring and ring-system descriptors', () => {
    const molecule = makeNaphthalene();
    const analysis = analyzeRings(molecule, computeCanonicalAtomRanks(molecule));
    assert.equal(analysis.rings.length, 2);
    assert.equal(analysis.ringSystems.length, 1);
    assert.equal(analysis.rings[0].size, 6);
    assert.equal(analysis.rings[0].aromatic, true);
    assert.deepEqual(analysis.ringSystems[0].ringIds, [0, 1]);
    assert.equal(typeof analysis.rings[0].signature, 'string');
  });

  it('keeps raw ring access behind the adapter helper', () => {
    const molecule = makeNaphthalene();
    const rings = getRingAtomIds(molecule);

    assert.equal(rings.length, 2);
    assert.equal(Array.isArray(rings[0]), true);
  });
});
